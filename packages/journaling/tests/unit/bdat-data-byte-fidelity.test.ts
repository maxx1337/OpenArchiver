import { connect as connectTcp, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
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
import { quarantineFilePath } from '../../src/spool/layout';
import type { QuarantineAlertSink } from '../../src/spool/quarantine';
import type {
	LedgerAppendRequest,
	LedgerAppendResult,
	LedgerBackend,
} from '../../src/ledger/ledger-port';

/**
 * `JR-4-11` -- the `BDAT` path proven explicitly against `DATA`, four named cases (Testplan section
 * 12.7): single chunk, multi-chunk, `BDAT 0 LAST`, and a chunk boundary landing mid-line.
 * Classification: `ci` (real socket, real disk -- the same "unit despite a real socket" precedent
 * `byte-fidelity-roundtrip.test.ts` (`JR-4-07`) and `smtp-server-protocol.test.ts` already established;
 * the ledger backend is an in-memory recorder, so no database is needed).
 *
 * ---------------------------------------------------------------------------------------------
 * The assertion, and why it is not "each side matches a buffer I built"
 * ---------------------------------------------------------------------------------------------
 * The acceptance criterion is "byteidentisches Ergebnis zum DATA-Pfad" -- not "BDAT stores what I
 * expect". `expectStoredBytesIdentical()` below always compares **two spool objects the server itself
 * produced** against each other: the bytes `DATA` left on disk for `SHARED_CONTENT`, and the bytes each
 * `BDAT` strategy left on disk for the identical `SHARED_CONTENT`. Comparing each side only to the
 * original `SHARED_CONTENT` buffer would not catch a bug where both paths happen to transform the
 * bytes the *same* wrong way (a shared re-encoding step, say) -- an object-to-object comparison is the
 * stronger claim and the one this task actually asks for. The DATA-vs-original comparison still runs,
 * once, as a sanity backstop that the reference side itself is not accidentally empty or truncated.
 *
 * ---------------------------------------------------------------------------------------------
 * Calibration (tester role rule: a comparison that finds two empty buffers equal is worthless)
 * ---------------------------------------------------------------------------------------------
 * `expectStoredBytesIdentical()` is calibrated once, directly, against three synthetic mutations of a
 * real captured buffer (one flipped byte, one truncated byte, one appended byte) -- each must make the
 * comparison fail before any of the four real cases below are trusted to mean anything. See the
 * `calibration` suite at the bottom of this file.
 *
 * ---------------------------------------------------------------------------------------------
 * F48 (directory-fsync EPERM on Windows) and F50 (per-line write cost) both apply here, noted rather
 * than worked around
 * ---------------------------------------------------------------------------------------------
 * Same platform split `byte-fidelity-roundtrip.test.ts` documents: on Windows every transaction below
 * settles to `451`, never `250`, because `NodeSpoolFileSystem.fsyncDirectory()` fails with `EPERM`
 * before `accept()` ever reaches `backend.append()`. The byte-identity claim this file makes is
 * unaffected either way -- `writeDurableSpoolFile()` writes and file-syncs before that failing step, so
 * the bytes at rest are exactly what was received regardless of which reply the client got, and the
 * lookup below (mirroring `byte-fidelity-roundtrip.test.ts`) checks `incoming/` first and
 * `quarantine/` second precisely so the comparison does not depend on the reply. Content here is a few
 * kilobytes, chosen short enough that F50's per-line write cost is immaterial -- this file is not a
 * throughput test.
 */

const RCPT_ADDRESS = 'journal@example.com';
const CHAIN_SCOPE_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';

const fixedRecipientAcl: RecipientAclEvaluator = {
	evaluateRecipient: () => ({
		kind: 'allowed',
		sourceId: SOURCE_ID,
		chainScopeId: CHAIN_SCOPE_ID,
	}),
};

const silentLogger: IngressLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

function noopAlertSink(): QuarantineAlertSink {
	return { alert: () => {} };
}

/** Records every `append()` request. Kept only for platform symmetry (see the module doc comment) --
 * the actual file lookup below never depends on it. */
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

/** Wraps a real `SpoolFileSystem` to record every `incoming/<shard>/<txid>.eml` path
 * `writeDurableSpoolFile()` asks to create -- the same technique `byte-fidelity-roundtrip.test.ts` uses
 * to find a transaction's stored bytes without depending on the ledger (see that file's own doc
 * comment for why). */
class RecordingSpoolFileSystem implements SpoolFileSystem {
	readonly createdPaths: string[] = [];
	constructor(private readonly inner: SpoolFileSystem) {}
	mkdir(p: string, options?: { recursive?: boolean }): Promise<void> {
		return this.inner.mkdir(p, options);
	}
	createFile(p: string): ReturnType<SpoolFileSystem['createFile']> {
		this.createdPaths.push(p);
		return this.inner.createFile(p);
	}
	fsyncDirectory(p: string): Promise<void> {
		return this.inner.fsyncDirectory(p);
	}
	readdir(p: string): ReturnType<SpoolFileSystem['readdir']> {
		return this.inner.readdir(p);
	}
	stat(p: string): ReturnType<SpoolFileSystem['stat']> {
		return this.inner.stat(p);
	}
	rename(from: string, to: string): Promise<void> {
		return this.inner.rename(from, to);
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
	readonly fs: RecordingSpoolFileSystem;
	readonly spoolRoot: string;
}

const openServers: EsmtpServer[] = [];
const openSockets: Socket[] = [];
const tempDirs: string[] = [];

async function startServer(): Promise<StartedServer> {
	const spoolRoot = await mkdtemp(path.join(tmpdir(), 'oa-bdat-fidelity-'));
	tempDirs.push(spoolRoot);
	const backend = new RecordingLedgerBackend();
	const fs = new RecordingSpoolFileSystem(new NodeSpoolFileSystem());
	const acceptance = new JournalAcceptance({
		fs,
		backend,
		spoolConfig: { rootPath: spoolRoot, highWaterBytes: 500_000_000n },
		alertSink: noopAlertSink(),
	});
	const smtp = smtpServerConfigSchema.parse({ sizeLimitBytes: 10 * 1024 * 1024 });
	const options: EsmtpServerOptions = {
		smtp,
		logger: silentLogger,
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
	return { server, port: address.port, fs, spoolRoot };
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

async function establishTransaction(port: number): Promise<TestSmtpClient> {
	const client = await connectClient(port);
	await client.nextReply();
	client.send('EHLO client.example.com');
	await client.nextReply();
	client.send('MAIL FROM:<sender@example.com>');
	await client.nextReply();
	client.send(`RCPT TO:<${RCPT_ADDRESS}>`);
	await client.nextReply();
	return client;
}

/** Platform-dependent final reply -- see the module doc comment. */
const EXPECTED_ACCEPT_REPLY = process.platform === 'win32' ? /^451 4\.3\.0/ : /^250 2\.0\.0/;

function dotStuffForData(raw: Buffer): Buffer {
	const text = raw.toString('latin1');
	const lines = text.split('\r\n');
	const stuffed = lines.map((line) => (line.startsWith('.') ? `.${line}` : line));
	return Buffer.from(stuffed.join('\r\n'), 'latin1');
}

function readStoredBytes(started: StartedServer): Buffer {
	const incomingPath = started.fs.createdPaths[started.fs.createdPaths.length - 1];
	if (!incomingPath) {
		throw new Error('no spool file was ever created for this transaction');
	}
	if (existsSync(incomingPath)) {
		return readFileSync(incomingPath);
	}
	const txid = path.basename(incomingPath, '.eml');
	const quarantinedPath = quarantineFilePath(started.spoolRoot, txid);
	if (existsSync(quarantinedPath)) {
		return readFileSync(quarantinedPath);
	}
	throw new Error(
		`stored file not found at either ${incomingPath} or ${quarantinedPath} (txid ${txid})`
	);
}

async function acceptViaData(started: StartedServer, content: Buffer): Promise<Buffer> {
	const client = await establishTransaction(started.port);
	client.send('DATA');
	await client.nextReply(); // 354
	const stuffed = dotStuffForData(content);
	await client.writeRawBuffer(Buffer.concat([stuffed, Buffer.from('.\r\n')]));
	const reply = await client.nextReply();
	expect(reply[0]).toMatch(EXPECTED_ACCEPT_REPLY);
	return readStoredBytes(started);
}

/** One `BDAT <len>[ LAST]` command plus its raw content, and (for a non-`LAST` chunk) the "chunk
 * received" reply every intermediate chunk gets (`smtp-server.ts`'s `handleBdatChunkBytes`) before the
 * final chunk's real accept-or-reject reply. */
async function sendBdatChunk(
	client: TestSmtpClient,
	content: Buffer,
	isLast: boolean
): Promise<void> {
	client.send(`BDAT ${content.length}${isLast ? ' LAST' : ''}`);
	if (content.length > 0) {
		await client.writeRawBuffer(content);
	}
	if (!isLast) {
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^250 2\.0\.0/);
	}
}

/** Send `chunks` in order as separate `BDAT` commands (the last one carrying `LAST`), and return the
 * stored bytes. */
async function acceptViaBdatChunks(
	started: StartedServer,
	chunks: readonly Buffer[]
): Promise<Buffer> {
	if (chunks.length === 0) {
		throw new Error('acceptViaBdatChunks needs at least one chunk');
	}
	const client = await establishTransaction(started.port);
	for (let i = 0; i < chunks.length; i += 1) {
		await sendBdatChunk(client, chunks[i]!, i === chunks.length - 1);
	}
	const reply = await client.nextReply();
	expect(reply[0]).toMatch(EXPECTED_ACCEPT_REPLY);
	return readStoredBytes(started);
}

/** Split `content` into `count` roughly equal pieces -- deliberately not required to land on line
 * boundaries, since RFC 3030 counts bytes, not lines. */
function splitEvenly(content: Buffer, count: number): Buffer[] {
	const size = Math.ceil(content.length / count);
	const parts: Buffer[] = [];
	for (let offset = 0; offset < content.length; offset += size) {
		parts.push(content.subarray(offset, Math.min(offset + size, content.length)));
	}
	return parts;
}

/**
 * The judge: two spool objects the server itself produced must be byte-identical. Throws with the
 * first differing offset (or the differing length) rather than a bare boolean, so a real failure names
 * where the two objects diverge -- calibrated below against three synthetic mutations.
 */
function expectStoredBytesIdentical(a: Buffer, b: Buffer, label: string): void {
	if (a.length !== b.length) {
		throw new Error(`${label}: length differs (${a.length} vs ${b.length} bytes).`);
	}
	const mismatchIndex = a.findIndex((byte, index) => byte !== b[index]);
	if (mismatchIndex !== -1) {
		throw new Error(
			`${label}: byte ${mismatchIndex} differs (0x${a[mismatchIndex]!.toString(16)} vs ` +
				`0x${b[mismatchIndex]!.toString(16)}).`
		);
	}
}

/** A realistic multi-line CRLF message with a leading-dot line (dot-stuffing over DATA, never over
 * BDAT) and enough bytes to make multi-chunk splitting meaningful. About 6 KB. */
const SHARED_CONTENT: Buffer = Buffer.from(
	[
		'Subject: JR-4-11 BDAT/DATA byte fidelity',
		'From: sender@example.com',
		'To: journal@example.com',
		'',
		'.This line starts with a dot and needs dot-stuffing over DATA.',
		...Array.from(
			{ length: 90 },
			(_unused, index) =>
				`Body line ${String(index).padStart(3, '0')}: the quick brown fox jumps.`
		),
		'Last line, no trailing content after this.',
		'',
	].join('\r\n'),
	'latin1'
);

suite('ci', 'BDAT path byte-identical to DATA (JR-4-11)', () => {
	let started: StartedServer;
	let dataStored: Buffer;

	beforeAll(async () => {
		started = await startServer();
		// The DATA-path reference, established once and reused by every BDAT case below -- see the
		// module doc comment for why object-to-object is the primary comparison and this is only the
		// backstop that the reference itself is not accidentally empty/truncated.
		dataStored = await acceptViaData(started, SHARED_CONTENT);
		expectStoredBytesIdentical(
			dataStored,
			SHARED_CONTENT,
			'DATA reference vs. original content'
		);
	});

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

	it('single chunk: one BDAT ... LAST carrying the whole message', async () => {
		const stored = await acceptViaBdatChunks(started, [SHARED_CONTENT]);
		expectStoredBytesIdentical(stored, dataStored, 'BDAT single-chunk vs. DATA');
	});

	it('multi-chunk: four BDAT commands, the last one LAST', async () => {
		const chunks = splitEvenly(SHARED_CONTENT, 4);
		expect(chunks.length).toBeGreaterThan(1); // sanity: this case is pointless if it collapsed to one
		const stored = await acceptViaBdatChunks(started, chunks);
		expectStoredBytesIdentical(stored, dataStored, 'BDAT multi-chunk vs. DATA');
	});

	it('BDAT 0 LAST: all content in one non-LAST chunk, a zero-length LAST chunk finishes it', async () => {
		const stored = await acceptViaBdatChunks(started, [SHARED_CONTENT, Buffer.alloc(0)]);
		expectStoredBytesIdentical(stored, dataStored, 'BDAT 0 LAST vs. DATA');
	});

	it('chunk boundary lands mid-line, not on a CRLF', async () => {
		// "Body line 000: the quick..." -- split inside the word "quick", nowhere near a CRLF. RFC 3030
		// counts bytes only; this proves the split point does not depend on line framing at all, unlike
		// DATA's terminator search.
		const marker = Buffer.from('the quick brown fox jumps', 'latin1');
		const markerIndex = SHARED_CONTENT.indexOf(marker);
		expect(markerIndex).toBeGreaterThan(-1); // sanity: the marker must actually be in the corpus
		const splitPoint = markerIndex + 'the qu'.length; // inside the word "quick", not on a boundary
		const first = SHARED_CONTENT.subarray(0, splitPoint);
		const second = SHARED_CONTENT.subarray(splitPoint);
		expect(first.length).toBeGreaterThan(0);
		expect(second.length).toBeGreaterThan(0);
		const stored = await acceptViaBdatChunks(started, [first, second]);
		expectStoredBytesIdentical(stored, dataStored, 'BDAT mid-line-boundary vs. DATA');
	});
});

/**
 * Calibration (tester role rule, and this file's own doc comment): `expectStoredBytesIdentical()` must
 * be shown to catch a real divergence before any of the four cases above are trusted. No server, no
 * socket, no disk -- purely a property of the comparison function itself.
 */
suite('ci', 'expectStoredBytesIdentical() calibration (JR-4-11)', () => {
	const reference = Buffer.from(SHARED_CONTENT); // an independent copy, never mutated

	it('GOOD: an untouched copy of the same bytes is reported identical', () => {
		expect(() =>
			expectStoredBytesIdentical(Buffer.from(reference), reference, 'calibration')
		).not.toThrow();
	});

	it('BAD (must be caught): one flipped byte in the middle', () => {
		const mutated = Buffer.from(reference);
		mutated[Math.floor(mutated.length / 2)] = mutated[Math.floor(mutated.length / 2)]! ^ 0xff;
		expect(() => expectStoredBytesIdentical(mutated, reference, 'calibration')).toThrow(
			/byte \d+ differs/
		);
	});

	it('BAD (must be caught): the stored copy is missing its last byte', () => {
		const truncated = reference.subarray(0, reference.length - 1);
		expect(() => expectStoredBytesIdentical(truncated, reference, 'calibration')).toThrow(
			/length differs/
		);
	});

	it('BAD (must be caught): the stored copy has one extra trailing byte', () => {
		const extended = Buffer.concat([reference, Buffer.from([0x00])]);
		expect(() => expectStoredBytesIdentical(extended, reference, 'calibration')).toThrow(
			/length differs/
		);
	});
});
