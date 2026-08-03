import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer as createProbeServer, connect as connectTcp, type Socket } from 'node:net';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import type { Sql } from 'postgres';
import {
	ensureIncomingShardDir,
	generateTxId,
	incomingFilePath,
	NodeSpoolFileSystem,
	PostgresLedgerWriter,
	quarantineFilePath,
	type LedgerAppendRequest,
} from '@open-archiver/journaling';
import { acquireTestDatabase } from '../support/pg-harness';
import { postgresTransactor } from '../support/postgres-transactor';
import { seedIngestionSource, seedJournalingSource } from '../support/iam-seed';

/**
 * `apps/smtp-ingress` boot-time crash-recovery scan (`JR-4-18`), measured against the **actual
 * compiled process** -- the same "why a real subprocess" reasoning
 * `packages/journaling/tests/unit/ingress-process-boot.test.ts` gives, extended here to a process that
 * needs a real, migrated Postgres database (so it belongs in the `integration` suite, not `unit`).
 * Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * The three things this file measures, one test each
 * ---------------------------------------------------------------------------------------------
 *  1. **Before, not after.** The scan's own "crash-recovery scan complete" log line appears in this
 *     process's stdout strictly before its "listening on port" line -- read off the actual byte
 *     offsets in the captured stream, not inferred from reading `index.ts`. A never-acknowledged file
 *     seeded on disk before the process starts is quarantined by the time the port is bound; a
 *     ledgered one is left exactly where it was.
 *  2. **Two processes contending for the same spool and the same ledger database do not race each
 *     other.** Both are started at once; the pre-seeded orphan file is quarantined exactly once
 *     (never twice, never by both), and both processes still reach "listening on port" -- the lock
 *     serialises, it does not deadlock.
 *  3. **A scan that itself fails does not crash the process.** With `journal_ledger` dropped from an
 *     otherwise-migrated database (`deployment_identity` still readable, so this is specifically a
 *     scan failure, not the pre-existing "ledger database unreachable" case), the process still binds
 *     its port -- and a real SMTP transaction against it never receives `250` for `DATA`, proving
 *     "accepts nothing" rather than inferring it from the fallback code path. Since `JR-4-20` (F46),
 *     this test also drives the transaction through a seeded, matching recipient, so `RCPT TO` itself
 *     proves `250` first (the recipient ACL, not just the connect-time source ACL, genuinely gates the
 *     transaction through `apps/smtp-ingress`'s production wiring) before `DATA` proves `451` --
 *     before `JR-4-20`, `RCPT TO` never reached `250` at all here, for a reason unrelated to this
 *     test's own claim (see `bindSourceAclCache`'s doc comment in `packages/journaling`'s
 *     `source-acl-cache.ts` for the fixed defect).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const ENTRY_JS = path.resolve(REPO_ROOT, 'apps/smtp-ingress/dist/index.js');

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

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`condition not met within ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

/** Minimal SMTP client -- send a line, read one (possibly multiline) reply, write raw bytes. */
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

	nextReply(timeoutMs = 5_000): Promise<string[]> {
		const ready = this.readyReplies.shift();
		if (ready) return Promise.resolve(ready);
		return new Promise<string[]>((resolve, reject) => {
			const timer = setTimeout(() => {
				const idx = this.waiters.findIndex((w) => w.resolve === resolve);
				if (idx !== -1) this.waiters.splice(idx, 1);
				reject(new Error(`no SMTP reply within ${timeoutMs}ms`));
			}, timeoutMs);
			this.waiters.push({ resolve, timer });
		});
	}
}

const postgresProbe = await probePostgres();
const enabled = isClassSelected('ci') && postgresProbe.available;
const harness = enabled ? await acquireTestDatabase('crash-recovery-boot') : undefined;
const failHarness = enabled ? await acquireTestDatabase('crash-recovery-boot-fail') : undefined;

async function deploymentId(sql: Sql): Promise<string> {
	const rows = await sql<{ deployment_id: string }[]>`
		select deployment_id from deployment_identity
	`;
	return rows[0]!.deployment_id;
}

const BASE_MICROS = 1_785_600_000_000_000n;

const request = (chainScopeId: string, spoolTxId: string): LedgerAppendRequest => ({
	chainScopeId,
	receivedAtMicros: BASE_MICROS,
	eventType: 'receipt',
	remoteIp: '192.0.2.40',
	ehloName: 'mail.example.com',
	tlsVersion: null,
	tlsCipher: null,
	envelopeFrom: 'sender@example.com',
	envelopeRcpt: ['rcpt@example.com'],
	sizeBytes: 64n,
	contentSha256: null,
	duplicateOf: null,
	journalingSourceId: null,
	spoolTxId,
	eventPayload: null,
});

let scratchDir: string;
const runningChildren: ChildProcess[] = [];

beforeAll(() => {
	buildPackage('@open-archiver/types');
	buildPackage('@open-archiver/journaling');
	buildPackage('smtp-ingress-app');
	scratchDir = mkdtempSync(path.join(tmpdir(), 'oa-smtp-ingress-crash-boot-'));
}, 120_000);

afterAll(async () => {
	for (const child of runningChildren.splice(0)) {
		if (!child.killed) child.kill();
	}
	if (scratchDir) {
		rmSync(scratchDir, { recursive: true, force: true });
	}
});

function spawnIngress(
	env: NodeJS.ProcessEnv,
	cwd: string
): {
	child: ChildProcess;
	output: ReturnType<typeof collectOutput>;
} {
	const child = spawn(process.execPath, [ENTRY_JS], { cwd, env: { ...baseEnv(), ...env } });
	runningChildren.push(child);
	return { child, output: collectOutput(child) };
}

suiteRequiring(
	'ci',
	'apps/smtp-ingress crash-recovery scan at boot, against real Postgres (JR-4-18)',
	postgresProbe,
	() => {
		it('runs before listen(): the log line precedes "listening", a ledgered file is requeued, an orphan is quarantined', async () => {
			const deployment = await deploymentId(harness!.sql);
			const source = await seedIngestionSource(harness!.db);
			const journalingSource = await seedJournalingSource(harness!.db, {
				ingestionSourceId: source.id,
				allowedIps: ['127.0.0.1/32', '::1/128'],
			});
			const writer = new PostgresLedgerWriter({
				deploymentId: deployment,
				transactor: postgresTransactor(harness!.sql),
			});

			const cwd = mkdtempSync(path.join(scratchDir, 'ordering-'));
			const spoolRoot = path.join(cwd, 'spool');
			const fs = new NodeSpoolFileSystem();

			const ledgeredTxId = generateTxId();
			const orphanTxId = generateTxId();
			await ensureIncomingShardDir(fs, spoolRoot, ledgeredTxId);
			const ledgeredHandle = await fs.createFile(incomingFilePath(spoolRoot, ledgeredTxId));
			await ledgeredHandle.write(Buffer.from('ledgered'));
			await ledgeredHandle.close();
			await ensureIncomingShardDir(fs, spoolRoot, orphanTxId);
			const orphanHandle = await fs.createFile(incomingFilePath(spoolRoot, orphanTxId));
			await orphanHandle.write(Buffer.from('orphan'));
			await orphanHandle.close();

			await writer.append(request(source.id, ledgeredTxId));

			const port = await getFreePort();
			const { child, output } = spawnIngress(
				{
					SMTP_INGRESS_PORT: String(port),
					SMTP_INGRESS_SPOOL_ROOT_PATH: spoolRoot,
					SMTP_INGRESS_SPOOL_HIGH_WATER_BYTES: '1000000000',
					SMTP_INGRESS_DATABASE_URL: harness!.url,
					SMTP_INGRESS_LEDGER_DATABASE_URL: harness!.url,
				},
				cwd
			);
			let exited = false;
			child.once('close', () => {
				exited = true;
			});

			try {
				await waitUntil(() => output.stdout().includes('listening on port'), 15_000);
				expect(exited).toBe(false);

				const stdout = output.stdout();
				const scanIdx = stdout.indexOf('crash-recovery scan complete');
				const listenIdx = stdout.indexOf('listening on port');
				expect(scanIdx).toBeGreaterThanOrEqual(0);
				expect(listenIdx).toBeGreaterThan(scanIdx);

				await expect(
					readFile(incomingFilePath(spoolRoot, ledgeredTxId), 'utf8')
				).resolves.toBe('ledgered');
				await expect(
					readFile(quarantineFilePath(spoolRoot, orphanTxId), 'utf8')
				).resolves.toBe('orphan');
				await expect(
					readFile(incomingFilePath(spoolRoot, orphanTxId), 'utf8')
				).rejects.toThrow();

				expect(journalingSource.routingAddress).toBeTruthy();
			} finally {
				if (!exited) child.kill();
				await waitUntil(() => exited, 10_000).catch(() => undefined);
			}
		}, 30_000);

		it('two processes starting at once against the same spool and ledger do not race: the orphan is quarantined exactly once, both still bind their ports', async () => {
			const cwd = mkdtempSync(path.join(scratchDir, 'exclusivity-'));
			const spoolRoot = path.join(cwd, 'spool');
			const fs = new NodeSpoolFileSystem();

			const orphanTxId = generateTxId();
			await ensureIncomingShardDir(fs, spoolRoot, orphanTxId);
			const handle = await fs.createFile(incomingFilePath(spoolRoot, orphanTxId));
			await handle.write(Buffer.from('raced orphan'));
			await handle.close();

			const [portA, portB] = [await getFreePort(), await getFreePort()];
			const cwdA = mkdtempSync(path.join(cwd, 'proc-a-'));
			const cwdB = mkdtempSync(path.join(cwd, 'proc-b-'));
			const envFor = (port: number): NodeJS.ProcessEnv => ({
				SMTP_INGRESS_PORT: String(port),
				SMTP_INGRESS_SPOOL_ROOT_PATH: spoolRoot,
				SMTP_INGRESS_SPOOL_HIGH_WATER_BYTES: '1000000000',
				SMTP_INGRESS_DATABASE_URL: harness!.url,
				SMTP_INGRESS_LEDGER_DATABASE_URL: harness!.url,
			});

			const procA = spawnIngress(envFor(portA), cwdA);
			const procB = spawnIngress(envFor(portB), cwdB);
			let exitedA = false;
			let exitedB = false;
			procA.child.once('close', () => {
				exitedA = true;
			});
			procB.child.once('close', () => {
				exitedB = true;
			});

			try {
				await Promise.all([
					waitUntil(() => procA.output.stdout().includes('listening on port'), 15_000),
					waitUntil(() => procB.output.stdout().includes('listening on port'), 15_000),
				]);
				expect(exitedA).toBe(false);
				expect(exitedB).toBe(false);

				// pino (the process's own logger) writes every level to stdout by default -- no
				// transport/destination is configured in index.ts -- so the alert is looked for in
				// stdout, with stderr checked too in case that default ever changes underneath this
				// test.
				const alertNeedle = 'spool file quarantined';
				const alertedA =
					procA.output.stdout().includes(alertNeedle) ||
					procA.output.stderr().includes(alertNeedle);
				const alertedB =
					procB.output.stdout().includes(alertNeedle) ||
					procB.output.stderr().includes(alertNeedle);
				// Exactly one of the two processes found and quarantined the orphan -- never both
				// (that would mean the second raced the first instead of waiting for the lock; see
				// crash-recovery.ts's own doc comment for why a double-quarantine attempt would
				// otherwise be tolerated as ENOENT, but with the lock there should be nothing left
				// for the second to even find).
				expect([alertedA, alertedB].filter(Boolean)).toHaveLength(1);

				await expect(
					readFile(quarantineFilePath(spoolRoot, orphanTxId), 'utf8')
				).resolves.toBe('raced orphan');
				await expect(
					readFile(incomingFilePath(spoolRoot, orphanTxId), 'utf8')
				).rejects.toThrow();
			} finally {
				if (!exitedA) procA.child.kill();
				if (!exitedB) procB.child.kill();
				await waitUntil(() => exitedA, 10_000).catch(() => undefined);
				await waitUntil(() => exitedB, 10_000).catch(() => undefined);
			}
		}, 30_000);

		it('a scan that itself fails (journal_ledger missing) does not crash the process: RCPT still gates on the real recipient ACL, and DATA never answers 250', async () => {
			// deployment_identity stays intact -- this must be specifically a scan failure, not the
			// pre-existing "ledger database unreachable at all" case that JR-4-06a already covers.
			await failHarness!.sql`DROP TABLE journal_ledger`;

			// A journaling_sources row is seeded with a real routing address so the *recipient* ACL
			// (not just the connect-time source ACL) is genuinely exercised through
			// `apps/smtp-ingress`'s production wiring below -- see the F46/JR-4-20 note.
			const source = await seedIngestionSource(failHarness!.db);
			const journalingSource = await seedJournalingSource(failHarness!.db, {
				ingestionSourceId: source.id,
				allowedIps: ['127.0.0.1/32', '::1/128'],
			});

			const cwd = mkdtempSync(path.join(scratchDir, 'scan-fail-'));
			const spoolRoot = path.join(cwd, 'spool');
			const fs = new NodeSpoolFileSystem();
			// At least one incoming/ file, or PostgresLedgerLookup's empty-batch shortcut (see its own
			// doc comment) would never touch the now-missing table at all, and this test would prove
			// nothing.
			const txid = generateTxId();
			await ensureIncomingShardDir(fs, spoolRoot, txid);
			const handle = await fs.createFile(incomingFilePath(spoolRoot, txid));
			await handle.write(Buffer.from('present when the scan chokes on it'));
			await handle.close();

			const port = await getFreePort();
			const { child, output } = spawnIngress(
				{
					SMTP_INGRESS_PORT: String(port),
					SMTP_INGRESS_SPOOL_ROOT_PATH: spoolRoot,
					SMTP_INGRESS_SPOOL_HIGH_WATER_BYTES: '1000000000',
					SMTP_INGRESS_DATABASE_URL: failHarness!.url,
					SMTP_INGRESS_LEDGER_DATABASE_URL: failHarness!.url,
				},
				cwd
			);
			let exited = false;
			child.once('close', () => {
				exited = true;
			});
			let socket: Socket | undefined;

			try {
				await waitUntil(() => output.stdout().includes('listening on port'), 15_000);
				expect(exited).toBe(false);
				// See the "pino writes to stdout" note above.
				expect(output.stdout() + output.stderr()).toContain(
					'could not initialize the ledger database connection, or the crash-recovery scan failed'
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
				client.send('MAIL FROM:<sender@example.com>');
				await client.nextReply();
				// Since JR-4-20 (F46 fixed): RCPT TO a *real*, seeded recipient now genuinely reaches
				// 250 -- the recipient ACL runs through `evaluateRecipient()`, not the connect-time IP
				// matcher. This is the regression proof for F46 at the full-process level: before the
				// fix, this exact RCPT TO -- against this exact production wiring -- answered 451,
				// never 250, regardless of what was seeded.
				client.send(`RCPT TO:<${journalingSource.routingAddress}>`);
				const rcptReply = await client.nextReply();
				expect(rcptReply[0]).toMatch(/^250 2\.1\.5/);

				// DATA is where *this* test's own claim lives: the crash-recovery scan failed, so
				// `journalAcceptance` stayed `undefined` (see this file's module doc comment) and every
				// DATA/BDAT...LAST unconditionally answers 451 -- never 250 -- regardless of platform
				// (unlike the full accept path in `journal-smtp-accept-e2e.int.test.ts`, this reply
				// never reaches the spool/directory-fsync at all, so there is no Windows-only branch
				// here).
				client.send('DATA');
				await client.nextReply(); // 354
				client.writeRaw(
					'this process accepts nothing while journalAcceptance is unwired\r\n.\r\n'
				);
				const dataReply = await client.nextReply();
				expect(dataReply[0]).toMatch(/^451 4\.3\.0/);
			} finally {
				if (socket && !socket.destroyed) socket.destroy();
				if (!exited) child.kill();
				await waitUntil(() => exited, 10_000).catch(() => undefined);
			}
		}, 30_000);
	}
);
