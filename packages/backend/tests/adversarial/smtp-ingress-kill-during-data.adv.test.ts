import { createHash } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer as createProbeServer, connect as connectTcp, type Socket } from 'node:net';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import { coverageNotice, announceSampling } from '@oa-test/notice';
import { resolveSeed, seededRng } from '@oa-test/seed';
import type { Sql } from 'postgres';
import { incomingFilePath } from '@open-archiver/journaling';
import { acquireTestDatabase, type PgHarness } from '../support/pg-harness';
import { seedIngestionSource, seedJournalingSource } from '../support/iam-seed';
import { readLedgerChain, verifyChain } from '../support/ledger-verifier';
import {
	checkNeverPartial,
	type KillIterationObservation,
} from '../support/kill-during-data-invariant';

/**
 * `JR-4-10` -- `SIGKILL` at randomised points during a 50 MB `DATA` transfer, judged from the
 * **client's** own view of the wire (Testplan section 12.1). Classification: `ci` (20 iterations,
 * smoke) + `nightly` (500 iterations, full).
 *
 * ---------------------------------------------------------------------------------------------
 * The central invariant this file exists to check
 * ---------------------------------------------------------------------------------------------
 * For every transaction: **either** the client never observed `250`, **or** the message is fully
 * present in the spool and correctly chained in the ledger. Never partially. `checkNeverPartial()`
 * (`../support/kill-during-data-invariant.ts`) is the judge; `kill-during-data-invariant.test.ts`
 * calibrates it against seven hand-built cases, four of which must be caught, entirely independently
 * of this file, before this file ever points it at a real kill.
 *
 * ---------------------------------------------------------------------------------------------
 * Why the kill is a real `SIGKILL` to a real, separate process, not an in-process hook
 * ---------------------------------------------------------------------------------------------
 * A hook that intercepts `accept()` and aborts it cleanly tests a simulated crash, not a crash -- it
 * always runs whatever cleanup the hook author remembered to write. `apps/smtp-ingress` is spawned as
 * a genuinely separate OS process (`spawnChild()`, the same construction
 * `smtp-ingress-crash-recovery-boot.int.test.ts` already uses), and it is killed with
 * `child.kill('SIGKILL')` -- `TerminateProcess()` on Windows, `SIGKILL` on POSIX. Neither platform
 * lets the process run any further code once that call lands; nothing in this file can look like it
 * survived a kill it did not.
 *
 * ---------------------------------------------------------------------------------------------
 * The kill point: a byte offset in the message body, derived from the seed
 * ---------------------------------------------------------------------------------------------
 * `deriveKillOffsetBytes()` draws from `seededRng()` (`@oa-test/seed`): the seed is resolved once per
 * suite, printed, and replayable via `OA_TEST_SEED`. Roughly a fifth of iterations kill exactly at the
 * full 50 MB plus a short random jitter -- the one race that actually exercises the `250`-durability
 * half of the invariant, because it is the only offset at which the server could plausibly have
 * already answered before the kill lands. Every other iteration kills at a uniformly random point
 * strictly inside the transfer, where the server cannot yet have committed anything (`DATA` has not
 * been terminated), so those iterations are expected to resolve to "the client never saw `250`, and
 * there may or may not be an orphaned, unledgered spool file" -- exactly the crash-recovery scenario
 * `JR-3-05`/`JR-4-18` already test the *recovery* of. This file's own claim is narrower and does not
 * depend on crash-recovery running at all: whatever a ledger row says happened, it must be true.
 *
 * ---------------------------------------------------------------------------------------------
 * F48, unavoidable on this host, and why the file still has to exist
 * ---------------------------------------------------------------------------------------------
 * `fsyncDirectory()` fails with `EPERM` on Windows (`fs-port.ts`'s documented limitation), and
 * `accept()` maps that to `spool-write-failed` -- **every** `DATA`/`BDAT...LAST` on this host answers
 * `451`, never `250`, independently of whether anything was killed at all
 * (`journal-smtp-accept-e2e.int.test.ts` hits the identical wall). That means the "client saw `250`"
 * branch of the invariant is structurally unreachable here: this run can prove the harness mechanics
 * (a real 50 MB transfer, a real kill at a derived offset, a real read-back of spool and ledger
 * afterwards, zero corrupted/partial ledger rows across however many iterations actually reach one)
 * but it **cannot** be the evidence that a real `250` was ever safe on this host, because no iteration
 * here can produce one. That evidence is the CI run on Linux, where directory-fsync succeeds.
 * `coverageNotice()` below states the count achieved on whichever host actually ran this, every time,
 * so a Windows run and a Linux run are never confused with each other from the log alone.
 *
 * ---------------------------------------------------------------------------------------------
 * F50: why the message body is built from 998-byte lines, not shorter ones
 * ---------------------------------------------------------------------------------------------
 * `DataScanner` calls `onContent` once per SMTP line, and `writeDurableSpoolFile()` issues one real
 * `fs` write per call it receives -- so wall-clock cost is driven by **line count**, not byte count
 * (F50, `docs/dev/journaling/09-befunde-bestandscode.md`). Measured on this host: a 50 MB body of
 * 60-byte lines (845 626 lines) takes ~54 s just to write; the same 50 MB as 998-byte lines (RFC
 * 5321 section 4.5.3.1.6's own maximum, 52 429 lines) takes ~4 s. This file uses the RFC-maximum line
 * length so that 20 (`ci`)/500 (`nightly`) real process-spawn-and-kill iterations finish in a
 * reasonable time on every host -- not to hide F50, which is filed and cited here, but because
 * reproducing it in every run of this file would make the run's true subject (the kill invariant)
 * untestable at the iteration counts Testplan section 12.1 asks for.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const ENTRY_JS = path.resolve(REPO_ROOT, 'apps/smtp-ingress/dist/index.js');

const CHUNK_BYTES = 1024 * 1024;
const CI_ITERATIONS = 20; // Testplan section 12.1 / section 5: "20x in ci"
const NIGHTLY_ITERATIONS = 500; // Testplan section 12.1 / section 5: "nightly voll"

// RFC 5321 section 4.5.3.1.6: 998 content octets is the maximum a compliant sender may transmit
// per line, excluding CRLF -- see the F50 note above for why this specific length was chosen.
const LINE_CONTENT_BYTES = 998;
const LINE_BYTES = LINE_CONTENT_BYTES + 2; // + CRLF
// The nearest whole number of lines to 50 MB (Testplan section 12.1: "eine 50-MB-Übertragung").
// Always an exact multiple of LINE_BYTES, so the body's last line is always properly
// CRLF-terminated and a "." terminator line appended after it is never ambiguous with the
// preceding content -- an unaligned trailing partial line was this file's own first bug (a kill
// offset of exactly the body length looked, from the wire, like the terminator merged into an
// unterminated line, and DATA never completed at all).
const LINE_COUNT = Math.round((50 * 1024 * 1024) / LINE_BYTES);
const TOTAL_BODY_BYTES = LINE_COUNT * LINE_BYTES;

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

function collectOutput(child: ChildProcess): { stdout: () => string } {
	let stdout = '';
	child.stdout?.on('data', (chunk: Buffer) => {
		stdout += chunk.toString('utf8');
	});
	child.stderr?.on('data', (chunk: Buffer) => {
		stdout += chunk.toString('utf8');
	});
	return { stdout: () => stdout };
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`condition not met within ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 15));
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Minimal SMTP client -- send a line, read one (possibly multiline) reply. Same shape as the other
 * integration tests' own `TestSmtpClient` (`journal-smtp-accept-e2e.int.test.ts`,
 * `smtp-ingress-crash-recovery-boot.int.test.ts`); kept local because those files are not a shared
 * module and copying twelve lines is cheaper than inventing one. */
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

/** Write `body[0, offset)` in `CHUNK_BYTES`-sized pieces, honouring backpressure so a 50 MB body
 * cannot balloon Node's internal write buffer across hundreds of iterations. */
async function writeUpTo(socket: Socket, body: Buffer, offset: number): Promise<void> {
	let written = 0;
	while (written < offset) {
		const end = Math.min(written + CHUNK_BYTES, offset);
		const chunk = body.subarray(written, end);
		const ok = socket.write(chunk);
		written = end;
		if (!ok) {
			await new Promise<void>((resolve) => socket.once('drain', () => resolve()));
		}
	}
}

/**
 * Roughly a fifth of iterations land exactly at the end of the body (the completion race, see the
 * header); everything else is uniform over the body's full range, including possibly `0`.
 */
function deriveKillOffsetBytes(rng: ReturnType<typeof seededRng>, totalBytes: number): number {
	const draw = rng.next();
	if (draw < 0.2) {
		return totalBytes;
	}
	return rng.int(totalBytes + 1);
}

/** One shared filler line, repeated `LINE_COUNT - 1` times and built once -- five hundred iterations
 * must not each allocate their own ~50 MB buffer. Every line is exactly `LINE_BYTES` long and none of
 * them is a bare `.`, so the body's last line is always properly CRLF-terminated (no iteration needs
 * dot-stuffing, and a "." terminator appended after the body is never ambiguous with the preceding
 * content -- see the F50 note in this file's own header comment for why that alignment matters). */
const FILLER_LINE_CONTENT = 'the quick brown fox jumps over the lazy dog. '
	.repeat(21)
	.slice(0, LINE_CONTENT_BYTES);
const fillerLine = Buffer.from(`${FILLER_LINE_CONTENT}\r\n`, 'utf8');
const filler = Buffer.concat(Array.from({ length: LINE_COUNT - 1 }, () => fillerLine));

/** Build this iteration's exact `TOTAL_BODY_BYTES` body: one unique header **line** (padded to
 * exactly `LINE_CONTENT_BYTES`, so it never disturbs line alignment), then `LINE_COUNT - 1` filler
 * lines. The header makes every iteration's `content_sha256` distinct, which is how a ledger row is
 * matched back to the iteration that produced it -- `spool_txid`/`seq` are never known to the client,
 * only `content_sha256` is derivable from what was sent. */
function buildIterationBody(globalIndex: number, nonceHex: string): Buffer {
	const headerText = `kill-test iter=${String(globalIndex).padStart(8, '0')} nonce=${nonceHex}`;
	const headerLine = Buffer.from(`${headerText.padEnd(LINE_CONTENT_BYTES, ' ')}\r\n`, 'utf8');
	return Buffer.concat([headerLine, filler], TOTAL_BODY_BYTES);
}

interface IterationResult {
	readonly clientSaw250: boolean;
	readonly ledgerRowFound: boolean;
	readonly violations: string[];
}

interface RunContext {
	readonly sql: Sql;
	readonly deploymentId: string;
	readonly chainScopeId: string;
	readonly routingAddress: string;
	readonly databaseUrl: string;
	readonly spoolRoot: string;
	readonly scratchDir: string;
	readonly runningChildren: ChildProcess[];
	readonly rng: ReturnType<typeof seededRng>;
}

async function runOneIteration(ctx: RunContext, globalIndex: number): Promise<IterationResult> {
	const nonceHex = Buffer.from(Array.from({ length: 8 }, () => ctx.rng.int(256))).toString('hex');
	const body = buildIterationBody(globalIndex, nonceHex);
	const killOffsetBytes = deriveKillOffsetBytes(ctx.rng, TOTAL_BODY_BYTES);
	const jitterMs = ctx.rng.int(50);

	const port = await getFreePort();
	const child = spawn(process.execPath, [ENTRY_JS], {
		cwd: ctx.scratchDir,
		env: {
			...baseEnv(),
			SMTP_INGRESS_PORT: String(port),
			SMTP_INGRESS_SPOOL_ROOT_PATH: ctx.spoolRoot,
			SMTP_INGRESS_SPOOL_HIGH_WATER_BYTES: '2000000000',
			SMTP_INGRESS_DATABASE_URL: ctx.databaseUrl,
			SMTP_INGRESS_LEDGER_DATABASE_URL: ctx.databaseUrl,
		},
	});
	ctx.runningChildren.push(child);
	const output = collectOutput(child);
	let exited = false;
	child.once('close', () => {
		exited = true;
	});

	let clientSaw250 = false;
	let socket: Socket | undefined;
	try {
		await waitUntil(() => output.stdout().includes('listening on port') || exited, 15_000);
		if (exited) {
			throw new Error(
				`process (iteration ${globalIndex}) exited before it started listening:\n${output.stdout()}`
			);
		}

		socket = connectTcp(port, '127.0.0.1');
		const connectedSocket = socket;
		await new Promise<void>((resolve, reject) => {
			connectedSocket.once('connect', () => resolve());
			connectedSocket.once('error', reject);
		});
		const client = new TestSmtpClient(connectedSocket);
		await client.nextReply(); // 220
		client.send('EHLO client.example.com');
		await client.nextReply();
		client.send('MAIL FROM:<sender@example.com>');
		await client.nextReply();
		client.send(`RCPT TO:<${ctx.routingAddress}>`);
		await client.nextReply();
		client.send('DATA');
		await client.nextReply(); // 354

		const replyRace = client.nextReply(500).catch(() => null);
		if (killOffsetBytes >= TOTAL_BODY_BYTES) {
			await writeUpTo(connectedSocket, body, TOTAL_BODY_BYTES);
			connectedSocket.write('.\r\n');
			await delay(jitterMs);
		} else {
			await writeUpTo(connectedSocket, body, killOffsetBytes);
		}
		child.kill('SIGKILL');
		const reply = await replyRace;
		clientSaw250 = !!reply && /^250 /.test(reply[0] ?? '');
	} finally {
		if (socket && !socket.destroyed) socket.destroy();
		if (!exited) child.kill('SIGKILL');
		await waitUntil(() => exited, 10_000).catch(() => undefined);
	}

	// Independent read-back: does *this iteration's own content* have a ledger row, and does that
	// row's spool file actually hold what was sent? Matched by content_sha256 -- spool_txid/seq are
	// never surfaced to the client, so hash is the only handle a client-side observer has.
	const expectedHash = createHash('sha256').update(body).digest();
	const rows = await ctx.sql<
		{ size_bytes: string; content_sha256: Uint8Array; spool_txid: string }[]
	>`
		select size_bytes::text as size_bytes, content_sha256, spool_txid
		from journal_ledger
		where chain_scope_id = ${ctx.chainScopeId} and content_sha256 = ${expectedHash}
	`;
	let ledgerRowFound = false;
	let spoolFileExists = false;
	let spoolFileBytes: Buffer | null = null;
	let ledgerContentSha256: Buffer | null = null;
	let ledgerSizeBytes: bigint | null = null;
	if (rows.length > 0) {
		ledgerRowFound = true;
		const row = rows[0]!;
		ledgerContentSha256 = Buffer.from(row.content_sha256);
		ledgerSizeBytes = BigInt(row.size_bytes);
		try {
			spoolFileBytes = await readFile(incomingFilePath(ctx.spoolRoot, row.spool_txid));
			spoolFileExists = true;
		} catch {
			spoolFileExists = false;
		}
	}

	const observation: KillIterationObservation = {
		clientSaw250,
		ledgerRowFound,
		ledgerContentSha256,
		ledgerSizeBytes,
		spoolFileExists,
		spoolFileBytes,
		expectedBytes: body,
	};
	const violations = checkNeverPartial(observation).map(
		(v) =>
			`iteration ${globalIndex} (killOffsetBytes=${killOffsetBytes}, ${ctx.rng.context({ globalIndex })}): ${v}`
	);

	return { clientSaw250, ledgerRowFound, violations };
}

async function runKillDuringDataSuite(opts: {
	label: string;
	iterations: number;
	seedName: string;
	harness: PgHarness;
	full?: { ran: number; full: number; fullVariant: string };
}): Promise<void> {
	const { harness } = opts;
	const scratchDir = mkdtempSync(path.join(tmpdir(), `oa-kill-during-data-${opts.label}-`));
	const spoolRoot = path.join(scratchDir, 'spool');
	const runningChildren: ChildProcess[] = [];

	try {
		const deploymentRows = await harness.sql<{ deployment_id: string }[]>`
			select deployment_id from deployment_identity
		`;
		const deploymentId = deploymentRows[0]!.deployment_id;
		const source = await seedIngestionSource(harness.db);
		const journalingSource = await seedJournalingSource(harness.db, {
			ingestionSourceId: source.id,
			allowedIps: ['127.0.0.1/32', '::1/128'],
		});
		const chainScopeId = source.id;
		const routingAddress = journalingSource.routingAddress;

		const seed = resolveSeed(opts.seedName);
		const rng = seededRng(seed, opts.seedName);
		if (opts.full) {
			announceSampling(opts.label, opts.full.ran, opts.full.full, opts.full.fullVariant);
		}

		const ctx: RunContext = {
			sql: harness.sql,
			deploymentId,
			chainScopeId,
			routingAddress,
			databaseUrl: harness.url,
			spoolRoot,
			scratchDir,
			runningChildren,
			rng,
		};

		const allViolations: string[] = [];
		let clientSaw250Count = 0;
		let ledgerRowFoundCount = 0;
		for (let i = 0; i < opts.iterations; i += 1) {
			const result = await runOneIteration(ctx, i);
			if (result.clientSaw250) clientSaw250Count += 1;
			if (result.ledgerRowFound) ledgerRowFoundCount += 1;
			allViolations.push(...result.violations);
		}

		coverageNotice(
			`JR-4-10 (${opts.label}): ${opts.iterations} iteration(s), seed ${seed}. ` +
				`${clientSaw250Count} iteration(s) had the client observe 250; ${ledgerRowFoundCount} ` +
				`iteration(s) produced a matching journal_ledger row. ` +
				(ledgerRowFoundCount === 0
					? "ZERO ledger rows were produced on this host -- see this file's own doc comment " +
						'on F48 (directory-fsync EPERM on Windows): the client-saw-250-implies-durable ' +
						'half of the invariant is UNVERIFIED on this run. Only a Linux CI run, where ' +
						'directory-fsync succeeds, can exercise it.'
					: 'the client-saw-250-implies-durable half of the invariant was genuinely exercised ' +
						`${clientSaw250Count} time(s) on this run.`)
		);

		if (allViolations.length > 0) {
			throw new Error(
				`JR-4-10 (${opts.label}): the never-partial invariant was violated ` +
					`${allViolations.length} time(s) out of ${opts.iterations}:\n\n` +
					allViolations.join('\n')
			);
		}

		// The whole-run, whole-chain proof: every row this run actually produced is gapless and
		// correctly chained -- "korrekt verkettet", the second half of the acceptance criterion, and
		// cheaper to check once over the accumulated chain than once per iteration.
		const entries = await readLedgerChain(harness.sql, chainScopeId);
		const findings = verifyChain({
			deploymentId,
			chainScopeId,
			entries,
			expectedLength: ledgerRowFoundCount,
		});
		expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
	} finally {
		for (const child of runningChildren.splice(0)) {
			if (!child.killed) child.kill('SIGKILL');
		}
		rmSync(scratchDir, { recursive: true, force: true });
	}
}

const postgresProbe = await probePostgres();
const ciEnabled = isClassSelected('ci') && postgresProbe.available;
const nightlyEnabled = isClassSelected('nightly') && postgresProbe.available;
const ciHarness = ciEnabled ? await acquireTestDatabase('kill-during-data-ci') : undefined;
const nightlyHarness = nightlyEnabled
	? await acquireTestDatabase('kill-during-data-nightly')
	: undefined;

beforeAll(() => {
	buildPackage('@open-archiver/types');
	buildPackage('@open-archiver/journaling');
	buildPackage('smtp-ingress-app');
}, 120_000);

suiteRequiring(
	'ci',
	'kill-during-DATA smoke: 20 real SIGKILLs during a 50 MB transfer, judged from the client (JR-4-10)',
	postgresProbe,
	() => {
		it(
			`${CI_ITERATIONS} iterations`,
			async () => {
				await runKillDuringDataSuite({
					label: 'ci-smoke',
					iterations: CI_ITERATIONS,
					seedName: 'JR-4-10-ci',
					harness: ciHarness!,
					full: {
						ran: CI_ITERATIONS,
						full: NIGHTLY_ITERATIONS,
						fullVariant: 'the nightly suite',
					},
				});
			},
			10 * 60_000
		);
	}
);

suiteRequiring(
	'nightly',
	'kill-during-DATA full soak: 500 real SIGKILLs during a 50 MB transfer, judged from the client (JR-4-10)',
	postgresProbe,
	() => {
		it(
			`${NIGHTLY_ITERATIONS} iterations`,
			async () => {
				await runKillDuringDataSuite({
					label: 'nightly-full',
					iterations: NIGHTLY_ITERATIONS,
					seedName: 'JR-4-10-nightly',
					harness: nightlyHarness!,
				});
			},
			60 * 60_000
		);
	}
);
