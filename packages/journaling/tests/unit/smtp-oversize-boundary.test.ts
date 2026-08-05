import { connect as connectTcp, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	EsmtpServer,
	type EsmtpServerOptions,
	type IngressLogger,
	type RecipientAclEvaluator,
} from '../../src/ingress/smtp-server';
import { smtpServerConfigSchema } from '../../src/ingress/smtp-config';
import { JournalAcceptance } from '../../src/spool/acceptance';
import { NodeSpoolFileSystem, type SpoolFileSystem } from '../../src/spool/fs-port';
import { incomingFilePath, quarantineFilePath } from '../../src/spool/layout';
import type { QuarantineAlert, QuarantineAlertSink } from '../../src/spool/quarantine';
import type {
	LedgerAppendRequest,
	LedgerAppendResult,
	LedgerBackend,
} from '../../src/ledger/ledger-port';

/**
 * `JR-4-12` -- the `SIZE` boundary matrix (Testplan section 12.9): exactly at the limit (accepted),
 * one byte over (`552 5.3.4`, loud alert), far over (`552 5.3.4`, loud alert, connection stays
 * aligned). Classification: `ci` (real socket, real disk, in-memory ledger -- the same "unit despite a
 * real socket" precedent as `JR-4-07`/`JR-4-11`).
 *
 * ---------------------------------------------------------------------------------------------
 * Why "the alert", not just the status code
 * ---------------------------------------------------------------------------------------------
 * Testplan section 12.9, verbatim: "Ein Test, der nur den Statuscode prüft und den Alert nicht, geht
 * am Punkt vorbei" -- RFC calls oversize a **silent data-loss vector**. There are two independent
 * places this server can detect oversize, and each has its own loud signal, both proven here rather
 * than assumed:
 *
 *  1. **Declared at `MAIL FROM ... SIZE=`** (RFC 1870), before any content is transferred at all --
 *     `smtp-server.ts` logs `logger.warn(...)` with the declared size and the configured limit. There
 *     is no spool file yet at this point, so there is nothing to quarantine and no `alertSink` call --
 *     the structured log line *is* the alert for this path, and this file asserts it through an
 *     injected recording `IngressLogger`, not by grepping stdout.
 *  2. **Discovered mid-transfer** (the client under-declared or declared nothing, and the actual byte
 *     count exceeds the limit) -- `finalizeAcceptance` aborts the in-flight spool write, which
 *     `JournalAcceptance.accept()` quarantines under the **mandatory** `QuarantineAlertSink`
 *     (`reason: 'oversize-rejected'`, `quarantine.ts`) -- a real, structural, injectable call, not a
 *     log line, and this file asserts it by injecting a recording sink and reading back the quarantined
 *     file from disk.
 *
 * Both mechanisms already exist and are proven in depth elsewhere (`smtp-acceptance-wiring.test.ts`,
 * `smtp-response-code-table.test.ts`) for an arbitrary oversize amount. What this file adds is the
 * **boundary matrix itself** -- exactly-at-limit, exactly-one-over, and far-over, as three named,
 * calibrated cases, through both detection paths where each applies (Testplan section 12.9's own
 * wording, "exakt am Limit, ein Byte darüber, weit darüber") -- not just "some oversize message is
 * rejected somehow".
 *
 * ---------------------------------------------------------------------------------------------
 * Getting the boundary exact: how `DataScanner` counts bytes
 * ---------------------------------------------------------------------------------------------
 * `DataScanner.scan()` adds `contentLine.length + 2` (the line's bytes plus its CRLF) to `bytesSeen`
 * for every content line, and the terminator line itself is never counted. `contentOfLength(n)` below
 * builds a single content line of exactly `n - 2` bytes, so the transferred message counts as exactly
 * `n` bytes by the server's own accounting -- not "close to the limit" or "probably over", but the
 * precise boundary Testplan section 12.9 asks for.
 *
 * ---------------------------------------------------------------------------------------------
 * F48/F50
 * ---------------------------------------------------------------------------------------------
 * The "exactly at the limit" case settles to `451` on this Windows host (F48, `fsyncDirectory()`
 * `EPERM`), never `250` -- noted, not worked around, the same way `JR-4-10`/`JR-4-11` note it. Content
 * here is a single line of a few kilobytes at most, so F50 (per-line write cost) is immaterial.
 */

const RCPT_ADDRESS = 'journal@example.com';
const CHAIN_SCOPE_ID = '33333333-3333-4333-8333-333333333333';
const SOURCE_ID = '44444444-4444-4444-8444-444444444444';
const SIZE_LIMIT_BYTES = 4096;

const fixedRecipientAcl: RecipientAclEvaluator = {
	evaluateRecipient: () => ({
		kind: 'allowed',
		sourceId: SOURCE_ID,
		chainScopeId: CHAIN_SCOPE_ID,
	}),
};

function recordingAlertSink(): { sink: QuarantineAlertSink; alerts: QuarantineAlert[] } {
	const alerts: QuarantineAlert[] = [];
	return { sink: { alert: (event) => void alerts.push(event) }, alerts };
}

interface RecordedLog {
	readonly level: 'debug' | 'info' | 'warn' | 'error';
	readonly fields: Record<string, unknown>;
	readonly message: string;
}

/** Records every log call rather than discarding them -- the declared-SIZE path's only signal is a
 * structured log line (see the module doc comment), so this is what stands in for grepping stdout. */
function recordingLogger(): { logger: IngressLogger; logs: RecordedLog[] } {
	const logs: RecordedLog[] = [];
	const record =
		(level: RecordedLog['level']) =>
		(fields: Record<string, unknown>, message: string): void => {
			logs.push({ level, fields, message });
		};
	return {
		logger: {
			debug: record('debug'),
			info: record('info'),
			warn: record('warn'),
			error: record('error'),
		},
		logs,
	};
}

class RecordingLedgerBackend implements LedgerBackend {
	private seqCounter = 0n;
	async append(_request: LedgerAppendRequest): Promise<LedgerAppendResult> {
		this.seqCounter += 1n;
		return {
			seq: this.seqCounter,
			chainHash: Buffer.alloc(32, 0xcc),
			prevChainHash: Buffer.alloc(32, 0x00),
		};
	}
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

	writeRawBuffer(buf: Buffer): Promise<void> {
		return new Promise((resolve, reject) => {
			this.socket.write(buf, (err) => (err ? reject(err) : resolve()));
		});
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

interface StartedServer {
	readonly server: EsmtpServer;
	readonly port: number;
	readonly spoolRoot: string;
	readonly alerts: QuarantineAlert[];
	readonly logs: RecordedLog[];
}

const openServers: EsmtpServer[] = [];
const openSockets: Socket[] = [];
const tempDirs: string[] = [];

async function startServer(): Promise<StartedServer> {
	const spoolRoot = await mkdtemp(path.join(tmpdir(), 'oa-oversize-boundary-'));
	tempDirs.push(spoolRoot);
	const backend = new RecordingLedgerBackend();
	const fs: SpoolFileSystem = new NodeSpoolFileSystem();
	const { sink: alertSink, alerts } = recordingAlertSink();
	const acceptance = new JournalAcceptance({
		fs,
		backend,
		spoolConfig: { rootPath: spoolRoot, highWaterBytes: 500_000_000n },
		alertSink,
	});
	const smtp = smtpServerConfigSchema.parse({ sizeLimitBytes: SIZE_LIMIT_BYTES });
	const { logger, logs } = recordingLogger();
	const options: EsmtpServerOptions = {
		smtp,
		logger,
		recipientAclEvaluator: fixedRecipientAcl,
		journalAcceptance: acceptance,
	};
	const server = new EsmtpServer(options);
	openServers.push(server);
	await server.listen(0, '127.0.0.1');
	const address = server.address;
	if (address === null) {
		throw new Error('server did not bind');
	}
	return { server, port: address.port, spoolRoot, alerts, logs };
}

async function connectClient(port: number): Promise<TestSmtpClient> {
	const socket = connectTcp(port, '127.0.0.1');
	openSockets.push(socket);
	await new Promise<void>((resolve, reject) => {
		socket.once('connect', () => resolve());
		socket.once('error', reject);
	});
	return new TestSmtpClient(socket);
}

/** `MAIL FROM` with an optional `SIZE=` parameter, then `RCPT TO`, positioned right before `DATA`.
 * Returns the `MAIL FROM` reply so the declared-SIZE cases can assert on it directly. */
async function establishTransaction(
	port: number,
	mailFromSizeParam?: number
): Promise<{ client: TestSmtpClient; mailFromReply: string[] }> {
	const client = await connectClient(port);
	await client.nextReply();
	client.send('EHLO client.example.com');
	await client.nextReply();
	client.send(
		mailFromSizeParam === undefined
			? 'MAIL FROM:<sender@example.com>'
			: `MAIL FROM:<sender@example.com> SIZE=${mailFromSizeParam}`
	);
	const mailFromReply = await client.nextReply();
	return { client, mailFromReply };
}

async function proceedToRcpt(client: TestSmtpClient): Promise<void> {
	client.send(`RCPT TO:<${RCPT_ADDRESS}>`);
	await client.nextReply();
}

/** A single content line of exactly `n - 2` bytes, so `DataScanner` counts exactly `n` bytes for the
 * whole message (see the module doc comment). */
function contentOfLength(n: number): Buffer {
	if (n < 2) {
		throw new Error(
			`contentOfLength(${n}): DataScanner counts at least a bare CRLF as 2 bytes`
		);
	}
	return Buffer.from(`${'A'.repeat(n - 2)}\r\n`, 'latin1');
}

const EXPECTED_ACCEPT_REPLY = process.platform === 'win32' ? /^451 4\.3\.0/ : /^250 2\.0\.0/;

afterEach(() => {
	for (const socket of openSockets.splice(0)) {
		if (!socket.destroyed) socket.destroy();
	}
});

afterAll(async () => {
	for (const server of openServers.splice(0)) {
		await server.close().catch(() => {});
	}
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
});

suite('ci', 'SIZE boundary matrix: exactly at limit, one byte over, far over (JR-4-12)', () => {
	it('exactly at the limit: accepted, byte-identical, and no alert of any kind', async () => {
		const started = await startServer();
		const content = contentOfLength(SIZE_LIMIT_BYTES);

		// The declared side of the same boundary: SIZE=<limit> exactly must NOT be rejected at MAIL
		// FROM (the schema's own check is `sizeParam > limit`, strictly greater) -- a regression here
		// would reject legitimate mail that merely fills the configured limit.
		const { client, mailFromReply } = await establishTransaction(
			started.port,
			SIZE_LIMIT_BYTES
		);
		expect(mailFromReply[0]).toMatch(/^250/);
		await proceedToRcpt(client);

		client.send('DATA');
		await client.nextReply(); // 354
		await client.writeRawBuffer(Buffer.concat([content, Buffer.from('.\r\n')]));
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(EXPECTED_ACCEPT_REPLY);

		// Byte-identical storage, read straight off disk (mirrors JR-4-07/JR-4-11's own lookup: check
		// incoming/ first, quarantine/ second, since this host's reply is platform-dependent but the
		// bytes at rest are not).
		const stored = findStoredBytes(started.spoolRoot);
		expect(stored.equals(content)).toBe(true);

		// The central JR-4-12 negative assertion for this case: an accepted, at-limit message raises
		// no OVERSIZE alert or warning -- a stray one here would mean the boundary check is
		// trigger-happy on its own edge. Never a 'warn' either way: that level is reserved for the
		// declared-SIZE rejection, which correctly never fires for a message that is merely AT the
		// limit, not over it.
		expect(started.alerts.filter((a) => a.reason === 'oversize-rejected')).toHaveLength(0);
		expect(started.logs.filter((l) => l.level === 'warn')).toHaveLength(0);
		// On a platform where directory-fsync succeeds this is a genuine 250 with zero alerts/errors of
		// any kind. On Windows (F48) it settles to 451 instead, from `fsyncDirectory()`'s unrelated
		// `EPERM` -- which itself quarantines under `reason: 'write-failed'` and logs at 'error', both
		// pre-existing JR-3-09 behaviour this file does not own and must not assert against. The two
		// branches below are that split made explicit rather than silently platform-conditional.
		if (process.platform === 'win32') {
			expect(started.alerts.filter((a) => a.reason === 'write-failed')).toHaveLength(1);
		} else {
			expect(started.alerts).toHaveLength(0);
			expect(started.logs.filter((l) => l.level === 'error')).toHaveLength(0);
		}
	});

	it('one byte over the limit: 552 with a loud alert, both detection paths', async () => {
		// 2a: declared at MAIL FROM -- rejected immediately, before RCPT/DATA, with a structured warn.
		const declared = await startServer();
		const { mailFromReply } = await establishTransaction(declared.port, SIZE_LIMIT_BYTES + 1);
		expect(mailFromReply[0]).toMatch(/^552 5\.3\.4/);
		const warnLogs = declared.logs.filter((l) => l.level === 'warn');
		expect(warnLogs).toHaveLength(1);
		expect(warnLogs[0]!.fields.declaredSize).toBe(SIZE_LIMIT_BYTES + 1);
		expect(warnLogs[0]!.fields.sizeLimitBytes).toBe(SIZE_LIMIT_BYTES);
		expect(declared.alerts).toHaveLength(0); // no spool file was ever opened for this path

		// 2b: discovered mid-transfer -- one byte over is only known once the whole message (plus
		// terminator) has been read; the spool write that was already under way is aborted and
		// quarantined under the mandatory alertSink.
		const actual = await startServer();
		const { client } = await establishTransaction(actual.port);
		await proceedToRcpt(client);
		client.send('DATA');
		await client.nextReply(); // 354
		const content = contentOfLength(SIZE_LIMIT_BYTES + 1);
		await client.writeRawBuffer(Buffer.concat([content, Buffer.from('.\r\n')]));
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^552 5\.3\.4/);

		expect(actual.alerts).toHaveLength(1);
		expect(actual.alerts[0]!.reason).toBe('oversize-rejected');
		const txid = path.basename(actual.alerts[0]!.originalFilePath, '.eml');
		expect(actual.alerts[0]!.quarantineFilePath).toBe(
			quarantineFilePath(actual.spoolRoot, txid)
		);
		expect(existsSync(actual.alerts[0]!.quarantineFilePath)).toBe(true);
		expect(existsSync(incomingFilePath(actual.spoolRoot, txid))).toBe(false);
	});

	it('far over the limit: 552 with a loud alert, both detection paths, and the connection stays aligned afterward', async () => {
		// 3a: declared at MAIL FROM, far over -- same mechanism as "one byte over", a larger number.
		const declared = await startServer();
		const { mailFromReply } = await establishTransaction(
			declared.port,
			SIZE_LIMIT_BYTES * 1000
		);
		expect(mailFromReply[0]).toMatch(/^552 5\.3\.4/);
		expect(declared.logs.filter((l) => l.level === 'warn')).toHaveLength(1);
		expect(declared.alerts).toHaveLength(0);

		// 3b: discovered mid-transfer, far over -- the discard-scan must read all the way to the real
		// terminator without desyncing (the F44 concern, now for an excess of kilobytes rather than a
		// handful of bytes): after the 552, a further command on the SAME connection must still get
		// exactly one, correct reply.
		const actual = await startServer();
		const { client } = await establishTransaction(actual.port);
		await proceedToRcpt(client);
		client.send('DATA');
		await client.nextReply(); // 354
		const content = contentOfLength(SIZE_LIMIT_BYTES * 20);
		await client.writeRawBuffer(Buffer.concat([content, Buffer.from('.\r\n')]));
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^552 5\.3\.4/);
		expect(actual.alerts).toHaveLength(1);
		expect(actual.alerts[0]!.reason).toBe('oversize-rejected');

		client.send('QUIT');
		const quitReply = await client.nextReply();
		expect(quitReply[0]).toMatch(/^221/);
		// Exactly one alert total -- the discard-scan reading the rest of the oversize body did not
		// trip a second oversize/quarantine event.
		expect(actual.alerts).toHaveLength(1);
	});
});

/** Read whatever the most recent transaction left on disk, checking `incoming/` first and
 * `quarantine/` second (mirrors `byte-fidelity-roundtrip.test.ts`/`JR-4-11`'s own lookup). Locates the
 * file by walking the spool's single shard rather than tracking a `createFile()` path, since this file
 * (unlike JR-4-11) has only one transaction per server instance. */
function findStoredBytes(spoolRoot: string): Buffer {
	for (const sub of ['incoming', 'quarantine']) {
		const dir = path.join(spoolRoot, sub);
		if (!existsSync(dir)) continue;
		for (const shard of safeReaddir(dir)) {
			const shardDir = path.join(dir, shard);
			for (const file of safeReaddir(shardDir)) {
				if (file.endsWith('.eml')) {
					return readFileSync(path.join(shardDir, file));
				}
			}
		}
	}
	throw new Error(`no stored .eml file found under ${spoolRoot}`);
}

function safeReaddir(dir: string): string[] {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

/**
 * Calibration (tester role rule): the alert-shape assertions above must be shown to catch a wrong
 * alert count/reason before the three real cases are trusted. No server, no socket, no disk.
 */
suite('ci', 'oversize alert-shape assertions calibration (JR-4-12)', () => {
	function expectExactlyOneOversizeAlert(alerts: readonly QuarantineAlert[]): void {
		if (alerts.length !== 1) {
			throw new Error(`expected exactly 1 alert, got ${alerts.length}.`);
		}
		if (alerts[0]!.reason !== 'oversize-rejected') {
			throw new Error(`expected reason 'oversize-rejected', got '${alerts[0]!.reason}'.`);
		}
	}

	const sampleAlert: QuarantineAlert = {
		spoolTxId: '01JZZZZZZZZZZZZZZZZZZZZZZZ',
		originalFilePath: '/spool/incoming/aa/01JZZZZZZZZZZZZZZZZZZZZZZZ.eml',
		quarantineFilePath: '/spool/quarantine/aa/01JZZZZZZZZZZZZZZZZZZZZZZZ.eml',
		reason: 'oversize-rejected',
	};

	it('GOOD: exactly one oversize-rejected alert passes', () => {
		expect(() => expectExactlyOneOversizeAlert([sampleAlert])).not.toThrow();
	});

	it('BAD (must be caught): no alert at all', () => {
		expect(() => expectExactlyOneOversizeAlert([])).toThrow(/expected exactly 1 alert, got 0/);
	});

	it('BAD (must be caught): two alerts instead of one', () => {
		expect(() => expectExactlyOneOversizeAlert([sampleAlert, sampleAlert])).toThrow(
			/expected exactly 1 alert, got 2/
		);
	});

	it("BAD (must be caught): one alert, but the wrong reason ('write-failed' masquerading as oversize)", () => {
		expect(() =>
			expectExactlyOneOversizeAlert([{ ...sampleAlert, reason: 'write-failed' }])
		).toThrow(/expected reason 'oversize-rejected'/);
	});
});
