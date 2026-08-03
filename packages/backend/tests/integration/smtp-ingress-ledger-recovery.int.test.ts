import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer as createProbeServer, connect as connectTcp, type Socket } from 'node:net';
import { readdir } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import { acquireTestDatabase } from '../support/pg-harness';
import { seedIngestionSource, seedJournalingSource } from '../support/iam-seed';

/**
 * `JR-4-19` at the process level -- a ledger database that is unusable when `apps/smtp-ingress` starts
 * no longer condemns the process to answering `451` until someone restarts it. Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * How the failure is produced, and why this way
 * ---------------------------------------------------------------------------------------------
 * `deployment_identity` is **renamed away** before the process starts. Reading it is the first thing
 * `buildJournalAcceptance()` does, so the build throws deterministically -- no timing, no firewall
 * games, no waiting for a container to stop -- and renaming it back is the whole "the database came
 * back" event, instantaneous and observable. Emptying the table instead is not possible and should not
 * be: `JR-2-05`'s append-only trigger refuses a `DELETE` on it. A rename is DDL, so nothing is lost.
 * Pointing the process at a closed port would test the same code path less precisely: connection
 * errors surface at unpredictable moments and `postgres-js` retries underneath us.
 *
 * ---------------------------------------------------------------------------------------------
 * What is asserted where, and the one honest platform split
 * ---------------------------------------------------------------------------------------------
 * The `451 -> 250` transition itself is proven, on every platform, by
 * `packages/journaling/tests/unit/smtp-acceptance-promotion.test.ts` at the wire. **It cannot be
 * proven here on Windows:** the durable spool write ends in a directory `fsync`, which fails with
 * `EPERM` on this platform, so a *wired* acceptance also answers `451` (as `spool-write-failed`) and
 * the two states are indistinguishable by reply code alone
 * (`journal-smtp-accept-e2e.int.test.ts` branches on `win32` for exactly this reason, and says so).
 *
 * So this file asserts what is platform-independent and decisive either way:
 *  - while unwired, `DATA` answers `451` **and** `incoming/` stays completely empty -- no
 *    `SpoolWriteBridge` is ever opened, which is also what makes re-running the crash-recovery scan on
 *    every retry safe (`JournalAcceptanceBootstrap`'s doc comment, Product Owner decision 2026-08-03);
 *  - the promotion is visible in the log, exactly once, without a restart -- the acceptance criterion's
 *    "der Zustandswechsel ist im Protokoll sichtbar";
 *  - after the promotion, a transaction on the **same still-open connection** no longer produces the
 *    server's `'acceptance path not yet wired'` line: it went through the real acceptance path.
 * On top of that, on Linux (the deployment target, architecture doc section 7) the reply is `250` and
 * the ledger holds exactly one row for the chain.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const ENTRY_JS = path.resolve(REPO_ROOT, 'apps/smtp-ingress/dist/index.js');
const UNWIRED_LINE = 'acceptance path not yet wired';
const PROMOTION_LINE = 'journal acceptance wired after a failed start';

function buildPackage(filterName: string): void {
	if (process.platform === 'win32') {
		execFileSync(`corepack pnpm --filter ${filterName} build`, [], {
			cwd: REPO_ROOT,
			stdio: 'pipe',
			shell: true,
		});
		return;
	}
	execFileSync('corepack', ['pnpm', '--filter', filterName, 'build'], {
		cwd: REPO_ROOT,
		stdio: 'pipe',
	});
}

async function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createProbeServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			if (address === null || typeof address === 'string') {
				reject(new Error('failed to obtain a free port'));
				return;
			}
			const { port } = address;
			probe.close(() => resolve(port));
		});
	});
}

function baseEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '' };
	if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
	if (process.env.TEMP) env.TEMP = process.env.TEMP;
	if (process.env.TMP) env.TMP = process.env.TMP;
	return env;
}

function collectOutput(child: ChildProcess): { stdout: () => string; stderr: () => string } {
	let stdout = '';
	let stderr = '';
	child.stdout?.on('data', (chunk: Buffer) => {
		stdout += chunk.toString('utf8');
	});
	child.stderr?.on('data', (chunk: Buffer) => {
		stderr += chunk.toString('utf8');
	});
	return { stdout: () => stdout, stderr: () => stderr };
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`${what}: condition not met within ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

function countOccurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

class TestSmtpClient {
	private raw = '';
	private currentReplyLines: string[] = [];
	private readonly readyReplies: string[][] = [];
	private readonly waiters: Array<{ resolve: (lines: string[]) => void; timer: NodeJS.Timeout }> =
		[];

	constructor(private readonly socket: Socket) {
		socket.on('data', (chunk: Buffer) => this.onData(chunk));
	}

	private onData(chunk: Buffer): void {
		this.raw += chunk.toString('utf8');
		for (;;) {
			const idx = this.raw.indexOf('\r\n');
			if (idx === -1) return;
			const line = this.raw.slice(0, idx);
			this.raw = this.raw.slice(idx + 2);
			this.currentReplyLines.push(line);
			if (/^\d{3} /.test(line)) {
				const reply = this.currentReplyLines;
				this.currentReplyLines = [];
				const waiter = this.waiters.shift();
				if (waiter) {
					clearTimeout(waiter.timer);
					waiter.resolve(reply);
				} else {
					this.readyReplies.push(reply);
				}
			}
		}
	}

	send(line: string): void {
		this.socket.write(`${line}\r\n`);
	}

	writeRaw(text: string): void {
		this.socket.write(text);
	}

	nextReply(timeoutMs = 10_000): Promise<string[]> {
		const ready = this.readyReplies.shift();
		if (ready) return Promise.resolve(ready);
		return new Promise<string[]>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`no SMTP reply within ${timeoutMs}ms`)),
				timeoutMs
			);
			this.waiters.push({ resolve, timer });
		});
	}
}

const postgresProbe = await probePostgres();
const enabled = isClassSelected('ci') && postgresProbe.available;
const harness = enabled ? await acquireTestDatabase('ledger-recovery') : undefined;
/** The second case needs a database whose `deployment_identity` stays away for good. Acquired here,
 * in **module scope**, not inside the test: the harness's own teardown is registered per file, so an
 * `acquireTestDatabase()` inside an `it()` leaves the database acquired at the end of the run -- which
 * a full run reports as residue (F16/F24), and which is exactly how this was caught. */
const stuckHarness = enabled
	? await acquireTestDatabase('ledger-recovery-stays-broken')
	: undefined;

let scratchDir: string;
const runningChildren: ChildProcess[] = [];

beforeAll(() => {
	buildPackage('@open-archiver/types');
	buildPackage('@open-archiver/journaling');
	buildPackage('smtp-ingress-app');
	scratchDir = mkdtempSync(path.join(tmpdir(), 'oa-ledger-recovery-'));
}, 180_000);

afterAll(async () => {
	for (const child of runningChildren.splice(0)) {
		if (!child.killed) child.kill();
	}
	if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
});

function spawnIngress(
	env: NodeJS.ProcessEnv,
	cwd: string
): { child: ChildProcess; output: ReturnType<typeof collectOutput> } {
	const child = spawn(process.execPath, [ENTRY_JS], { cwd, env: { ...baseEnv(), ...env } });
	runningChildren.push(child);
	return { child, output: collectOutput(child) };
}

/** Every file under `incoming/`, across the shard directories. */
async function incomingFiles(spoolRoot: string): Promise<string[]> {
	const found: string[] = [];
	const root = path.join(spoolRoot, 'incoming');
	let shards: string[];
	try {
		shards = await readdir(root);
	} catch {
		return found;
	}
	for (const shard of shards) {
		try {
			for (const entry of await readdir(path.join(root, shard))) found.push(entry);
		} catch {
			// A shard that is a file rather than a directory would be a layout bug; not this test's
			// subject.
		}
	}
	return found;
}

async function startTransaction(client: TestSmtpClient, routingAddress: string): Promise<void> {
	client.send('MAIL FROM:<sender@example.com>');
	await client.nextReply();
	client.send(`RCPT TO:<${routingAddress}>`);
	const rcpt = await client.nextReply();
	expect(rcpt[0]).toMatch(/^250 2\.1\.5/);
	client.send('DATA');
	await client.nextReply(); // 354
}

suiteRequiring(
	'ci',
	'apps/smtp-ingress recovers a ledger connection that failed at startup (JR-4-19)',
	postgresProbe,
	() => {
		it('starts unusable, answers 451 with an untouched spool, then accepts on the same connection once the database is fixed -- no restart', async () => {
			const source = await seedIngestionSource(harness!.db);
			const journalingSource = await seedJournalingSource(harness!.db, {
				ingestionSourceId: source.id,
				allowedIps: ['127.0.0.1/32', '::1/128'],
			});

			// The failure: the first query buildJournalAcceptance() makes cannot resolve its table.
			// Renaming rather than emptying, for two reasons -- JR-2-05's append-only trigger refuses a
			// DELETE on this table outright (measured: "DELETE on deployment_identity is refused"), and
			// "not migrated" is the real-world shape of this failure anyway, which is what
			// buildJournalAcceptance()'s own error text asks about. A rename is DDL, so not one row,
			// index or trigger is lost, and renaming back is exactly the "the database came back" event.
			await harness!
				.sql`alter table deployment_identity rename to deployment_identity_hidden`;

			const cwd = mkdtempSync(path.join(scratchDir, 'recovery-'));
			const spoolRoot = path.join(cwd, 'spool');
			const port = await getFreePort();
			const { child, output } = spawnIngress(
				{
					SMTP_INGRESS_PORT: String(port),
					SMTP_INGRESS_SPOOL_ROOT_PATH: spoolRoot,
					SMTP_INGRESS_SPOOL_HIGH_WATER_BYTES: '1000000000',
					SMTP_INGRESS_DATABASE_URL: harness!.url,
					SMTP_INGRESS_LEDGER_DATABASE_URL: harness!.url,
					// Short enough for a test, and the reason this knob exists.
					SMTP_INGRESS_LEDGER_RETRY_INTERVAL_MS: '500',
				},
				cwd
			);
			let exited = false;
			child.once('close', () => {
				exited = true;
			});
			let socket: Socket | undefined;

			try {
				await waitUntil(
					() => output.stdout().includes('listening on port'),
					20_000,
					'the ingress process never bound its port'
				);
				expect(exited).toBe(false);
				expect(output.stdout() + output.stderr()).toContain(
					'could not build journal acceptance'
				);

				socket = connectTcp(port, '127.0.0.1');
				await new Promise<void>((resolve, reject) => {
					socket!.once('connect', () => resolve());
					socket!.once('error', reject);
				});
				const client = new TestSmtpClient(socket);
				await client.nextReply(); // 220
				client.send('EHLO client.example.com');
				await client.nextReply();

				// Unwired: 451, and nothing was written to the spool at all.
				await startTransaction(client, journalingSource.routingAddress);
				client.writeRaw('Subject: while the ledger is unusable\r\n.\r\n');
				const beforeReply = await client.nextReply();
				expect(beforeReply[0]).toMatch(/^451 4\.3\.0/);
				expect(await incomingFiles(spoolRoot)).toEqual([]);
				const unwiredBefore = countOccurrences(output.stdout(), UNWIRED_LINE);
				expect(unwiredBefore).toBeGreaterThanOrEqual(1);

				// The database comes back. Nothing else is touched -- the process is not signalled, the
				// connection above is not closed.
				await harness!
					.sql`alter table deployment_identity_hidden rename to deployment_identity`;

				await waitUntil(
					() => output.stdout().includes(PROMOTION_LINE),
					20_000,
					'the process never logged its promotion'
				);
				expect(exited).toBe(false);
				// Exactly once -- a per-attempt log would drown the transition it is meant to show.
				expect(countOccurrences(output.stdout(), PROMOTION_LINE)).toBe(1);

				// Same process, same open connection, next transaction.
				await startTransaction(client, journalingSource.routingAddress);
				client.writeRaw('Subject: after the ledger came back\r\n.\r\n');
				const afterReply = await client.nextReply();

				// Platform-independent and decisive: this transaction did *not* take the "not wired"
				// branch, whatever its reply code ends up being on this platform.
				expect(countOccurrences(output.stdout(), UNWIRED_LINE)).toBe(unwiredBefore);

				const ledgerRows = await harness!.sql<{ count: string }[]>`
					select count(*)::text as count from journal_ledger where chain_scope_id = ${source.id}
				`;
				if (process.platform === 'win32') {
					// Directory-fsync fails with EPERM here, so the durable write cannot complete and
					// accept() maps it to 'spool-write-failed' -> 451, never reaching the ledger. A real
					// gap in the *test host*, not in the wiring -- see this file's module doc comment.
					expect(afterReply[0]).toMatch(/^451 4\.3\.0/);
					expect(ledgerRows[0]!.count).toBe('0');
				} else {
					expect(afterReply[0]).toMatch(/^250 /);
					expect(ledgerRows[0]!.count).toBe('1');
				}
			} finally {
				if (socket && !socket.destroyed) socket.destroy();
				if (!exited) child.kill();
				await waitUntil(() => exited, 10_000, 'process did not exit').catch(
					() => undefined
				);
			}
		}, 90_000);

		it('does not claim to be wired while the database stays unusable, however many retries elapse', async () => {
			// The counter-direction: a bootstrap that "promoted" without a working build would make the
			// test above green for the wrong reason.
			const source = await seedIngestionSource(stuckHarness!.db);
			const journalingSource = await seedJournalingSource(stuckHarness!.db, {
				ingestionSourceId: source.id,
				allowedIps: ['127.0.0.1/32', '::1/128'],
			});
			await stuckHarness!
				.sql`alter table deployment_identity rename to deployment_identity_hidden`;

			const cwd = mkdtempSync(path.join(scratchDir, 'stays-broken-'));
			const spoolRoot = path.join(cwd, 'spool');
			const port = await getFreePort();
			const { child, output } = spawnIngress(
				{
					SMTP_INGRESS_PORT: String(port),
					SMTP_INGRESS_SPOOL_ROOT_PATH: spoolRoot,
					SMTP_INGRESS_SPOOL_HIGH_WATER_BYTES: '1000000000',
					SMTP_INGRESS_DATABASE_URL: stuckHarness!.url,
					SMTP_INGRESS_LEDGER_DATABASE_URL: stuckHarness!.url,
					SMTP_INGRESS_LEDGER_RETRY_INTERVAL_MS: '300',
				},
				cwd
			);
			let exited = false;
			child.once('close', () => {
				exited = true;
			});
			let socket: Socket | undefined;

			try {
				await waitUntil(
					() => output.stdout().includes('listening on port'),
					20_000,
					'the ingress process never bound its port'
				);
				// Several retry intervals worth of attempts, observed rather than slept for: the retry
				// logs are what prove the loop is running at all.
				await waitUntil(
					() =>
						countOccurrences(
							output.stdout() + output.stderr(),
							'could not build journal acceptance'
						) >= 3,
					20_000,
					'the bootstrap did not keep retrying'
				);
				expect(output.stdout()).not.toContain(PROMOTION_LINE);
				expect(exited).toBe(false);

				socket = connectTcp(port, '127.0.0.1');
				await new Promise<void>((resolve, reject) => {
					socket!.once('connect', () => resolve());
					socket!.once('error', reject);
				});
				const client = new TestSmtpClient(socket);
				await client.nextReply();
				client.send('EHLO client.example.com');
				await client.nextReply();
				await startTransaction(client, journalingSource.routingAddress);
				client.writeRaw('Subject: still unusable\r\n.\r\n');
				expect((await client.nextReply())[0]).toMatch(/^451 4\.3\.0/);
				expect(await incomingFiles(spoolRoot)).toEqual([]);
			} finally {
				if (socket && !socket.destroyed) socket.destroy();
				if (!exited) child.kill();
				await waitUntil(() => exited, 10_000, 'process did not exit').catch(
					() => undefined
				);
			}
		}, 90_000);
	}
);
