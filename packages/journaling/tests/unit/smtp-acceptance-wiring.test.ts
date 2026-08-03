import { connect as connectTcp, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	EsmtpServer,
	type EsmtpServerOptions,
	type IngressLogger,
	type JournalAcceptancePort,
	type RecipientAclEvaluator,
} from '../../src/ingress/smtp-server';
import { smtpServerConfigSchema } from '../../src/ingress/smtp-config';
import {
	JournalAcceptance,
	isAccepted,
	type JournalAcceptanceOptions,
	type JournalAcceptanceResult,
	type JournalTransactionInput,
} from '../../src/spool/acceptance';
import { runCrashRecoveryScan } from '../../src/spool/crash-recovery';
import type { LedgerEntryByTxId, LedgerLookup } from '../../src/ledger/ledger-lookup-port';
import type {
	LedgerAppendRequest,
	LedgerAppendResult,
	LedgerBackend,
} from '../../src/ledger/ledger-port';
import { chainHash, genesisChainHash } from '../../src/ledger/canonical-encoding';
import type { SpoolFileSystem } from '../../src/spool/fs-port';
import { NodeSpoolFileSystem } from '../../src/spool/fs-port';
import { FakeSpoolFileSystem } from '../support/fake-spool-fs';
import type { QuarantineAlert, QuarantineAlertSink } from '../../src/spool/quarantine';
import type { JournalLedgerRecord } from '@open-archiver/types';

/**
 * `JournalAcceptance.accept()` wired into `completeTransfer()` (`JR-4-06a`) -- proven over a real
 * loopback socket, the same "unit despite a real socket" classification `smtp-server-protocol.test.ts`
 * already established for this file's siblings.
 *
 * ---------------------------------------------------------------------------------------------
 * Scope: the wiring, not the exhaustive code table
 * ---------------------------------------------------------------------------------------------
 * `JR-4-06` was split (ADR-021): this task wires `accept()` and gets the mapping right; the
 * **exhaustive** check of every row of skill `journal-ledger` section 2's table, graceful shutdown
 * drain, and the loud oversize alert are `JR-4-06b`'s acceptance criterion, not this file's. What is
 * proven here: every one of `JournalAcceptanceResult`'s five `kind`s reaches the wire as the code the
 * skill's table names; oversize aborts the in-flight spool write and overrides whatever `accept()`
 * settles to, leaving nothing in `incoming/` for a crash-recovery scan to misdiagnose; a transaction
 * abandoned mid-`BDAT` (`RSET`) does not hang the connection or leak the write; and content really
 * streams through `SpoolWriteBridge` rather than being buffered whole (a calibrated `arrayBuffers`
 * proof, `nightly`-classified the same way `durable-write.test.ts`'s own 150 MB case is).
 */

const openServers: EsmtpServer[] = [];
const openSockets: Socket[] = [];

afterEach(async () => {
	for (const socket of openSockets.splice(0)) {
		if (!socket.destroyed) {
			socket.destroy();
		}
	}
	for (const server of openServers.splice(0)) {
		await server.close().catch(() => {});
	}
});

const silentLogger: IngressLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

const CHAIN_SCOPE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const RCPT_ADDRESS = 'journal@example.com';

/** Every syntactically valid recipient resolves to the one fixed test chain -- this file is not
 * about the recipient ACL itself (`smtp-recipient-acl-protocol.test.ts` already covers that), it
 * only needs a `chainScopeId` for `tryBeginAcceptance()` to read. */
const fixedRecipientAcl: RecipientAclEvaluator = {
	evaluateRecipient: () => ({ kind: 'allowed', sourceId: SOURCE_ID, chainScopeId: CHAIN_SCOPE_ID }),
};

interface StartedServer {
	readonly server: EsmtpServer;
	readonly port: number;
}

async function startServer(
	journalAcceptance: JournalAcceptancePort,
	smtpOverrides: Record<string, unknown> = {}
): Promise<StartedServer> {
	const smtp = smtpServerConfigSchema.parse(smtpOverrides);
	const options: EsmtpServerOptions = {
		smtp,
		logger: silentLogger,
		recipientAclEvaluator: fixedRecipientAcl,
		journalAcceptance,
	};
	const server = new EsmtpServer(options);
	openServers.push(server);
	await server.listen(0, '127.0.0.1');
	const address = server.address;
	if (address === null) {
		throw new Error('server did not bind');
	}
	return { server, port: address.port };
}

/** Minimal SMTP client: send a line, or read one (possibly multiline) reply. Trimmed down from
 * `smtp-server-protocol.test.ts`'s own `TestSmtpClient` to just what this file needs. */
class TestSmtpClient {
	private raw = '';
	private currentReplyLines: string[] = [];
	private readonly readyReplies: string[][] = [];
	private readonly waiters: Array<{ resolve: (lines: string[]) => void; timer: NodeJS.Timeout }> =
		[];
	public closed = false;

	constructor(private readonly socket: Socket) {
		socket.on('data', (chunk: Buffer) => this.onData(chunk));
		socket.on('close', () => {
			this.closed = true;
		});
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

	writeRawBuffer(buf: Buffer): Promise<void> {
		return new Promise((resolve, reject) => {
			this.socket.write(buf, (err) => (err ? reject(err) : resolve()));
		});
	}

	nextReply(timeoutMs = 2_000): Promise<string[]> {
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

async function connectClient(port: number): Promise<TestSmtpClient> {
	const socket = connectTcp(port, '127.0.0.1');
	openSockets.push(socket);
	await new Promise<void>((resolve, reject) => {
		socket.once('connect', () => resolve());
		socket.once('error', reject);
	});
	return new TestSmtpClient(socket);
}

/** Drive a connection through `EHLO`/`MAIL`/`RCPT`, positioned right before `DATA`/`BDAT`. */
async function establishTransaction(port: number): Promise<TestSmtpClient> {
	const client = await connectClient(port);
	await client.nextReply();
	client.send('EHLO client.example.com');
	await client.nextReply();
	client.send('MAIL FROM:<a@example.com>');
	await client.nextReply();
	client.send(`RCPT TO:<${RCPT_ADDRESS}>`);
	await client.nextReply();
	return client;
}

/** Wait until `predicate()` is true or `timeoutMs` elapses, polling every 10ms -- used only for
 * background cleanup this file cannot otherwise await directly (e.g. an abandoned acceptance's own
 * fire-and-forget quarantine). */
async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`condition not met within ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

// ---------------------------------------------------------------------------------------------
// A fake JournalAcceptancePort, for the response-code mapping table -- controllable per test,
// deliberately not exercising the real spool/ledger (that is the second and third suites below).
// ---------------------------------------------------------------------------------------------

function fakeAcceptance(
	resultOrFactory: JournalAcceptanceResult | (() => JournalAcceptanceResult)
): JournalAcceptancePort & { readonly calls: JournalTransactionInput[] } {
	const calls: JournalTransactionInput[] = [];
	return {
		calls,
		async accept(input: JournalTransactionInput): Promise<JournalAcceptanceResult> {
			calls.push(input);
			// Drain the bridge the same way a real durable write would -- otherwise the fake's promise
			// would resolve before `finalizeAcceptance` ever calls `bridge.end()`/`bridge.abort()`, and
			// the fake would misrepresent a real backend's behaviour (which always consumes `chunks`).
			for await (const _chunk of input.chunks) {
				// discarded -- this fake does not need the bytes, only needs to consume them
			}
			return typeof resultOrFactory === 'function' ? resultOrFactory() : resultOrFactory;
		},
	};
}

suite(
	'ci',
	'JournalAcceptance.accept() wired into completeTransfer() -- response mapping (JR-4-06a)',
	() => {
		it('accepted -> 250 2.0.0 with the seq in the text', async () => {
			const acceptance = fakeAcceptance({
				kind: 'accepted',
				spoolTxId: 'tx-1',
				seq: 42n,
				chainHash: Buffer.alloc(32, 0xaa),
			});
			const { port } = await startServer(acceptance);
			const client = await establishTransaction(port);
			client.send('DATA');
			await client.nextReply(); // 354
			client.writeRaw('Subject: test\r\n\r\nhello\r\n.\r\n');
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^250 2\.0\.0/);
			expect(reply[0]).toContain('42');

			// The envelope actually reached accept() -- proves the fields, not just the code.
			expect(acceptance.calls).toHaveLength(1);
			expect(acceptance.calls[0]!.chainScopeId).toBe(CHAIN_SCOPE_ID);
			expect(acceptance.calls[0]!.envelopeRcpt).toEqual([RCPT_ADDRESS]);
			expect(acceptance.calls[0]!.journalingSourceId).toBe(SOURCE_ID);
		});

		it('accepted over BDAT ... LAST -> 250 2.0.0 with the seq in the text (shared completeTransfer path)', async () => {
			const acceptance = fakeAcceptance({
				kind: 'accepted',
				spoolTxId: 'tx-2',
				seq: 7n,
				chainHash: Buffer.alloc(32, 0xbb),
			});
			const { port } = await startServer(acceptance);
			const client = await establishTransaction(port);
			const payload = Buffer.from('Subject: test\r\n\r\nhello world\r\n');
			client.send(`BDAT ${payload.length} LAST`);
			await client.writeRawBuffer(payload);
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^250 2\.0\.0/);
			expect(reply[0]).toContain('7');
		});

		const nonAcceptedResults: Record<
			Exclude<JournalAcceptanceResult['kind'], 'accepted'>,
			{
				readonly result: JournalAcceptanceResult;
				readonly code: string;
				readonly enhanced: string;
			}
		> = {
			'high-water-mark-exceeded': {
				result: {
					kind: 'high-water-mark-exceeded',
					spoolTxId: 'tx',
					status: { exceeded: true, usageBytes: 2n, highWaterBytes: 1n },
				},
				code: '452',
				enhanced: '4.3.1',
			},
			'spool-capacity-exceeded': {
				result: {
					kind: 'spool-capacity-exceeded',
					spoolTxId: 'tx',
					stage: 'write',
					cause: Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }),
				},
				code: '452',
				enhanced: '4.3.1',
			},
			'spool-write-failed': {
				result: {
					kind: 'spool-write-failed',
					spoolTxId: 'tx',
					stage: 'write',
					cause: new Error('boom'),
				},
				code: '451',
				enhanced: '4.3.0',
			},
			'ledger-append-failed': {
				result: {
					kind: 'ledger-append-failed',
					spoolTxId: 'tx',
					filePath: '/spool/incoming/00/tx.eml',
					cause: new Error('boom'),
				},
				code: '451',
				enhanced: '4.3.0',
			},
		};

		for (const [kind, { result, code, enhanced }] of Object.entries(nonAcceptedResults)) {
			it(`${kind} -> ${code} ${enhanced}`, async () => {
				const acceptance = fakeAcceptance(result);
				const { port } = await startServer(acceptance);
				const client = await establishTransaction(port);
				client.send('DATA');
				await client.nextReply();
				client.writeRaw('Subject: test\r\n\r\nhello\r\n.\r\n');
				const reply = await client.nextReply();
				expect(reply[0]).toMatch(new RegExp(`^${code} ${enhanced.replace(/\./g, '\\.')}`));
			});
		}

		it('the connection stays usable for a further transaction after a 250 (state reset correctly)', async () => {
			const acceptance = fakeAcceptance(() => ({
				kind: 'accepted',
				spoolTxId: 'tx',
				seq: 1n,
				chainHash: Buffer.alloc(32),
			}));
			const { port } = await startServer(acceptance);
			const client = await establishTransaction(port);
			client.send('DATA');
			await client.nextReply();
			client.writeRaw('hello\r\n.\r\n');
			expect((await client.nextReply())[0]).toMatch(/^250/);

			client.send('MAIL FROM:<a@example.com>');
			expect((await client.nextReply())[0]).toMatch(/^250/);
			client.send(`RCPT TO:<${RCPT_ADDRESS}>`);
			expect((await client.nextReply())[0]).toMatch(/^250/);
			client.send('DATA');
			await client.nextReply();
			client.writeRaw('second\r\n.\r\n');
			expect((await client.nextReply())[0]).toMatch(/^250/);
			expect(acceptance.calls).toHaveLength(2);
		});
	}
);

// ---------------------------------------------------------------------------------------------
// A minimal, real, in-memory LedgerBackend/LedgerLookup -- not the same file as
// packages/backend/tests/support/in-memory-ledger.ts (packages/journaling's own test tree may not
// depend on packages/backend, even in tests -- ADR-025), structurally identical for exactly the
// fields this file's assertions read.
// ---------------------------------------------------------------------------------------------

class InMemoryLedgerAndLookup implements LedgerBackend, LedgerLookup {
	private readonly entriesBySeq: { record: JournalLedgerRecord; chainHash: Buffer }[] = [];
	private readonly bySpoolTxId = new Map<string, LedgerEntryByTxId>();

	constructor(private readonly deploymentId: string) {}

	async append(request: LedgerAppendRequest): Promise<LedgerAppendResult> {
		const head = this.entriesBySeq[this.entriesBySeq.length - 1];
		const seq = head ? head.record.seq + 1n : 1n;
		const prevChainHash = head
			? head.chainHash
			: genesisChainHash(this.deploymentId, request.chainScopeId);
		const record: JournalLedgerRecord = {
			chainScopeId: request.chainScopeId,
			seq,
			receivedAtMicros: request.receivedAtMicros,
			eventType: request.eventType,
			remoteIp: request.remoteIp,
			ehloName: request.ehloName,
			tlsVersion: request.tlsVersion,
			tlsCipher: request.tlsCipher,
			envelopeFrom: request.envelopeFrom,
			envelopeRcpt: request.envelopeRcpt,
			sizeBytes: request.sizeBytes,
			contentSha256: request.contentSha256,
			duplicateOf: request.duplicateOf,
			journalingSourceId: request.journalingSourceId,
			spoolTxId: request.spoolTxId,
			eventPayload: request.eventPayload,
		};
		const computed = chainHash(record, prevChainHash);
		this.entriesBySeq.push({ record, chainHash: computed });
		if (request.spoolTxId) {
			this.bySpoolTxId.set(request.spoolTxId, {
				seq,
				chainScopeId: request.chainScopeId,
				journalingSourceId: request.journalingSourceId,
				remoteIp: request.remoteIp,
				receivedAt: new Date(Number(request.receivedAtMicros / 1000n)),
			});
		}
		return { seq, chainHash: computed, prevChainHash };
	}

	async findBySpoolTxIds(
		spoolTxIds: readonly string[]
	): Promise<ReadonlyMap<string, LedgerEntryByTxId>> {
		const out = new Map<string, LedgerEntryByTxId>();
		for (const id of spoolTxIds) {
			const entry = this.bySpoolTxId.get(id);
			if (entry) out.set(id, entry);
		}
		return out;
	}
}

function noopAlertSink(): QuarantineAlertSink {
	return { alert: () => {} };
}

function recordingAlertSink(): { sink: QuarantineAlertSink; alerts: QuarantineAlert[] } {
	const alerts: QuarantineAlert[] = [];
	return { sink: { alert: (event) => void alerts.push(event) }, alerts };
}

function realAcceptance(
	fs: SpoolFileSystem,
	backend: LedgerBackend,
	overrides: Partial<JournalAcceptanceOptions> = {}
): JournalAcceptance {
	return new JournalAcceptance({
		fs,
		backend,
		spoolConfig: { rootPath: '/spool', highWaterBytes: 100_000_000n },
		alertSink: noopAlertSink(),
		...overrides,
	});
}

suite(
	'ci',
	"oversize aborts the in-flight spool write and overrides accept()'s own result (JR-4-06a)",
	() => {
		it('answers 552 (never the DurableWriteError-mapped 451) and leaves nothing in incoming/ for a later crash-recovery scan', async () => {
			const fs = new FakeSpoolFileSystem();
			const backend = new InMemoryLedgerAndLookup('44444444-4444-4444-8444-444444444444');
			const { sink: alertSink, alerts } = recordingAlertSink();
			const acceptance = realAcceptance(fs, backend, { alertSink });

			const { port } = await startServer(acceptance, { sizeLimitBytes: 20 });
			const client = await establishTransaction(port);
			client.send('DATA');
			await client.nextReply(); // 354
			// Comfortably over the 20-byte limit; DataScanner's discard-scan (JR-4-16/F44) reads
			// through to the real terminator regardless.
			client.writeRaw(
				'Subject: test\r\n\r\nthis body is definitely over twenty bytes\r\n.\r\n'
			);
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^552 5\.3\.4/);

			// accept()'s own DurableWriteError handling already quarantined the debris under
			// 'write-failed' -- proven directly, not inferred from the 552 alone.
			expect(alerts).toHaveLength(1);
			expect(alerts[0]!.reason).toBe('write-failed');

			// And a subsequent crash-recovery scan over the same spool finds nothing left to do:
			// no incoming/ file (already moved), so no *new* quarantine and no false "crash" report.
			const scan = await runCrashRecoveryScan({
				fs,
				ledgerLookup: backend,
				spoolRoot: '/spool',
				alertSink,
			});
			expect(scan.incomingFilesScanned).toBe(0);
			expect(scan.quarantined).toHaveLength(0);
			expect(scan.requeue).toHaveLength(0);
			// The one alert on record is still the original write-failed one -- the scan raised no
			// second alert.
			expect(alerts).toHaveLength(1);

			// The connection itself is realigned and still usable (JR-4-16's own guarantee, unaffected
			// by this task).
			client.send('QUIT');
			expect((await client.nextReply())[0]).toMatch(/^221/);
		});

		it('an oversize BDAT transaction is overridden the same way as DATA (shared finalizeAcceptance path)', async () => {
			const fs = new FakeSpoolFileSystem();
			const backend = new InMemoryLedgerAndLookup('44444444-4444-4444-8444-444444444444');
			const acceptance = realAcceptance(fs, backend);
			const { port } = await startServer(acceptance, { sizeLimitBytes: 10 });
			const client = await establishTransaction(port);
			const payload = Buffer.alloc(50, 'a'); // over the 10-byte limit
			client.send(`BDAT ${payload.length} LAST`);
			await client.writeRawBuffer(payload);
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^552 5\.3\.4/);
		});
	}
);

suite(
	'ci',
	'a transaction abandoned mid-BDAT (RSET) does not hang the connection or leak the write (JR-4-06a)',
	() => {
		it('RSET between two BDAT chunks aborts the in-flight acceptance; the connection keeps working', async () => {
			const fs = new FakeSpoolFileSystem();
			const backend = new InMemoryLedgerAndLookup('44444444-4444-4444-8444-444444444444');
			const { sink: alertSink, alerts } = recordingAlertSink();
			const acceptance = realAcceptance(fs, backend, { alertSink });
			const { port } = await startServer(acceptance);
			const client = await establishTransaction(port);

			// A non-LAST BDAT opens the bridge and starts accept() (tryBeginAcceptance), but the
			// transaction never reaches BDAT ... LAST.
			const first = Buffer.from('partial content, no LAST ever follows');
			client.send(`BDAT ${first.length}`);
			await client.writeRawBuffer(first);
			expect((await client.nextReply())[0]).toMatch(/^250 2\.0\.0/);

			client.send('RSET');
			expect((await client.nextReply())[0]).toMatch(/^250 2\.0\.0/);

			// abandonInFlightAcceptance() aborts the bridge and lets accept() settle in the
			// background; give it a moment to actually quarantine the debris (DurableWriteError ->
			// 'write-failed'), the same mechanism the oversize case already proves directly above.
			await waitUntil(() => alerts.length === 1);
			expect(alerts[0]!.reason).toBe('write-failed');

			// Nothing left in incoming/, and the connection is still perfectly usable for a fresh
			// transaction -- RSET's own 250 already proved the reply path; this proves the envelope
			// underneath it is really clean.
			const scan = await runCrashRecoveryScan({
				fs,
				ledgerLookup: backend,
				spoolRoot: '/spool',
				alertSink,
			});
			expect(scan.incomingFilesScanned).toBe(0);

			client.send('MAIL FROM:<a@example.com>');
			expect((await client.nextReply())[0]).toMatch(/^250/);
			client.send(`RCPT TO:<${RCPT_ADDRESS}>`);
			expect((await client.nextReply())[0]).toMatch(/^250/);
			client.send('BDAT 0 LAST');
			expect((await client.nextReply())[0]).toMatch(/^250 2\.0\.0/); // real accept(), empty message
		});
	}
);

/**
 * The calibrated streaming-memory proof (`JR-4-06a`, F43). `process.memoryUsage().heapUsed` does not
 * see `Buffer`/`Uint8Array` backing storage (F43, `docs/dev/journaling/09-befunde-bestandscode.md`) --
 * `arrayBuffers` is the field that does.
 *
 * ---------------------------------------------------------------------------------------------
 * Three calibration attempts that measured the wrong thing, before the one below
 * ---------------------------------------------------------------------------------------------
 * 1. An artificial per-write delay added to `FakeSpoolFileSystem` (via `setTimeout`), to force the
 *    sender to outrun the consumer. This measured Windows' own timer-resolution noise
 *    (`setTimeout(fn, 2)` coalescing to the platform's ~15 ms tick) far more than anything this
 *    bridge does, stretching the transfer to tens of seconds and giving GC far more time to leave
 *    uncollected garbage sitting in `arrayBuffers` between samples.
 * 2. Plain `FakeSpoolFileSystem` (no delay) at ~40 MB. `FakeSpoolFileSystem` stores a "file" as a
 *    single `Buffer` and appends with `Buffer.concat([existing, chunk])` on every `write()` -- right
 *    for the small messages every other suite in this file uses it for, wrong at this scale: the
 *    *fake* itself legitimately holds a growing, nearly-message-sized buffer, and the superseded
 *    copies from each `Buffer.concat()` pile up as not-yet-collected garbage faster than periodic
 *    `global.gc()` calls could clear them. Measured directly: `maxDelta` came back around 240 MB for
 *    a 40 MB transfer -- six times the message size, and *unchanged* by forcing GC every 16 chunks
 *    instead of only at the start. Switching to `NodeSpoolFileSystem` against a real temp file (below)
 *    removes this confound entirely -- the same real disk `durable-write.test.ts`'s own 150 MB case
 *    already uses for the identical reason.
 * 3. Real disk, but still at ~40 MB with a 20 MB budget. Reasonable in isolation, but repeated runs
 *    on this host showed `maxDelta` ranging from the low 20s of MB up into the mid 30s -- noise from
 *    real socket buffering and GC timing (no `--expose-gc` wired into this repository's vitest
 *    invocation) that is roughly *constant* in absolute terms, not proportional to message size. At
 *    40 MB that noise floor came uncomfortably close to the ~41-42 MB full-buffering regression
 *    signal measured at the same size. Scaling the message up to 150 MB (below) -- the same size
 *    `durable-write.test.ts`'s own acceptance case uses, for the same reason -- makes the same
 *    constant noise floor a much smaller fraction of the total, restoring a real margin on both sides.
 *
 * Recorded here rather than silently dropped: the lesson in all three is the one
 * `durable-write.test.ts`'s own doc comment already states -- this measurement technique is coarse
 * and platform-sensitive, and a number that "looks wrong" needs investigating (what is actually being
 * measured?), not budget-widening until a run happens to pass.
 *
 * ---------------------------------------------------------------------------------------------
 * The calibration that held: real disk, 150 MB
 * ---------------------------------------------------------------------------------------------
 * Rerunning this exact test (real `NodeSpoolFileSystem`, real temp file, 150 MB, exactly as below)
 * against a deliberately-reintroduced full-buffering `SpoolWriteBridge` (`push()` appending to a
 * plain array instead of feeding the `Readable`, with `chunks` built from that array only once
 * `end()`/`abort()` was called -- i.e. exactly the "collect everything, then hand `accept()` a
 * generator over it" shortcut this file's and `spool-write-bridge.ts`'s own module doc comments warn
 * against) measured `maxDelta` at ~157 MB for the ~150 MB transfer -- essentially the whole message,
 * as a full-buffering regression should show. Reverting to the real `SpoolWriteBridge` brought
 * `maxDelta` back down to well under a third of that, consistently across repeated runs. That
 * regression variant was never committed -- reverted immediately once it had demonstrably turned this
 * assertion red -- but it is what makes the budget below a property of the *streaming*, not merely a
 * threshold nothing was ever going to approach.
 */
suite(
	'nightly',
	'streaming a large message keeps memory flat via SpoolWriteBridge backpressure (JR-4-06a, F43)',
	() => {
		let dir: string;

		afterEach(async () => {
			if (dir) {
				await rm(dir, { recursive: true, force: true });
			}
		});

		it('a 150 MB message streams through without a proportional arrayBuffers increase', async () => {
			dir = await mkdtemp(path.join(tmpdir(), 'oa-smtp-acceptance-wiring-'));
			const fs = new NodeSpoolFileSystem();
			const backend = new InMemoryLedgerAndLookup('44444444-4444-4444-8444-444444444444');
			const acceptance = new JournalAcceptance({
				fs,
				backend,
				spoolConfig: { rootPath: dir, highWaterBytes: 500_000_000n },
				alertSink: noopAlertSink(),
			});
			const { port } = await startServer(acceptance, {
				sizeLimitBytes: 200 * 1024 * 1024,
				dataTimeoutMs: 120_000,
			});
			const client = await establishTransaction(port);

			// 150 MB, matching `durable-write.test.ts`'s own acceptance-case size -- not 40 MB, and not
			// a smaller number for speed. The noise floor of this measurement (real socket, real disk,
			// no `--expose-gc`) turned out to be tens of MB and roughly *constant* regardless of message
			// size (scheduling/GC-timing variance, not proportional to bytes moved) -- measured directly
			// across repeated runs at 40 MB, where it came uncomfortably close to the ~41-42 MB
			// full-buffering regression signal on some runs. At 150 MB the same noise floor is a much
			// smaller fraction of the message, which is exactly why a bigger message, not a tighter
			// budget, is the fix -- the same reasoning `durable-write.test.ts`'s own 150 MB choice rests
			// on.
			const CHUNK_SIZE = 64 * 1024;
			const CHUNK_COUNT = 2400; // ~150 MB
			const TOTAL_BYTES = CHUNK_SIZE * CHUNK_COUNT;
			const sharedBuffer = Buffer.alloc(CHUNK_SIZE, 'x');

			// BDAT, not DATA: DataScanner is line-oriented (it must find a CRLF before it can
			// dot-unstuff and emit a content line), so a payload with no line breaks at all -- exactly
			// what a fixed, reused `sharedBuffer` is, the same calibration technique
			// `durable-write.test.ts`'s own 150 MB case uses -- would buffer inside *DataScanner's own
			// `carry`*, not inside `SpoolWriteBridge`, and this test would then be measuring the wrong
			// thing. `BdatContentTracker` has no such requirement (RFC 3030's declared-length octet
			// stream, forwarded verbatim per socket read) -- exactly this file's module doc comment's
			// point about `BdatContentTracker` needing no line search at all.
			client.send(`BDAT ${TOTAL_BYTES} LAST`);

			if (global.gc) global.gc();
			const baseline = process.memoryUsage().arrayBuffers;
			let maxDelta = 0;

			for (let i = 0; i < CHUNK_COUNT; i += 1) {
				await client.writeRawBuffer(sharedBuffer);
				const current = process.memoryUsage().arrayBuffers;
				maxDelta = Math.max(maxDelta, current - baseline);
			}
			const reply = await client.nextReply(30_000);
			// Directory-fsync is a POSIX operation and fails with EPERM on Windows (`fs-port.ts`'s own
			// documented limitation, the same one `durable-write.test.ts`'s real-disk suite special-cases)
			// -- accept() maps that DurableWriteError to 'spool-write-failed' (451), not a durability
			// failure this test is about. Either way, every byte was already streamed through and
			// written (and file-synced) before that stage runs, so the memory property below holds
			// regardless of which reply this platform produces.
			expect(reply[0]).toMatch(
				process.platform === 'win32' ? /^451 4\.3\.0/ : /^250 2\.0\.0/
			);

			// ~150 MB was sent; a regression to full buffering would show growth on the order of that
			// entire size. 48 MB -- the same figure and the same reasoning `durable-write.test.ts`'s own
			// 150 MB case uses -- is comfortably under a third of the message while wide enough to
			// absorb real socket buffering and GC noise (no `--expose-gc` wired into this repository's
			// vitest invocation). See this suite's doc comment for the two calibration attempts that
			// measured the wrong thing before this one, and for the actual regression measurement
			// (~150 MB, essentially the whole message) that this budget separates from.
			const BUDGET_BYTES = 48 * 1024 * 1024;
			expect(maxDelta).toBeLessThan(BUDGET_BYTES);
		}, 120_000);
	}
);
