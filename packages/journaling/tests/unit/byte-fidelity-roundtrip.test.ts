import { connect as connectTcp, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
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
 * `JR-4-07`, second half -- "Roundtrip-Test belegt byteidentische Speicherung inklusive
 * ungewöhnlicher Zeilenenden und 8-Bit-Inhalten" (RFC section 4.4, skill `journal-ledger` section
 * 10: "No rewriting, normalizing, re-encoding, or 'cleaning' received bytes.").
 *
 * ---------------------------------------------------------------------------------------------
 * What "roundtrip" means here, precisely
 * ---------------------------------------------------------------------------------------------
 * A real `EsmtpServer` bound to a real loopback socket, a real `JournalAcceptance` backed by the
 * real `NodeSpoolFileSystem` writing to a real temp directory (not `FakeSpoolFileSystem` -- a fake
 * cannot demonstrate that the bytes that hit the wire are the bytes a real `fsync`'d file holds). The
 * ledger backend is a minimal in-memory recorder -- this file is not about the ledger, only about
 * what ends up on disk.
 *
 * For each corpus entry, the test sends the exact same byte sequence a real sending MTA would put on
 * the wire, waits for the reply (see "Locating the stored file..." below for why that reply is
 * platform-dependent), reads the resulting spool file straight off disk with `node:fs`, and compares
 * it against the original bytes with `Buffer.equals()`/`Buffer.compare()` -- never `.toString()`
 * anywhere in the comparison chain, since a string coercion is exactly the kind of silent
 * transformation this test exists to catch (a lone `\r` or a non-UTF-8 byte would be replaced or
 * reinterpreted by a decode step, hiding the very corruption this file is supposed to find).
 *
 * ---------------------------------------------------------------------------------------------
 * Why some corpus entries only run over `BDAT`
 * ---------------------------------------------------------------------------------------------
 * `DATA`'s framing (RFC 5321 section 4.5.2) is line-oriented: content is CRLF-delimited lines, a
 * leading `.` on a line is doubled going out and undone coming in, and the transaction ends with a
 * line containing only `.`. That scheme has no representation for a bare LF, a bare CR, or a final
 * line with no line ending at all -- there is no CRLF for the dot-stuffing/terminator logic to find.
 * This is not a limitation of this server; it is why `CHUNKING`/`BDAT` (RFC 3030) exists at all, and
 * why ADR-029 makes it mandatory rather than optional: Microsoft 365 journal reports can and do
 * contain bare LFs (historically stripped by Exchange transport, no longer guaranteed), and those
 * bytes are simply not transmissible through `DATA`. `BDAT` carries a declared-length octet stream
 * with no line orientation and no dot-stuffing, so it is the only path that can carry this half of
 * the corpus -- and the only path this test sends it over.
 *
 * The entries that *are* valid CRLF-line-oriented content are sent over **both** `DATA` and `BDAT`,
 * because only `DATA` dot-(un)stuffs -- an equality proof that only ever exercised one of the two
 * paths could not tell "never transforms bytes" apart from "only happens not to transform them on
 * the path this test picked".
 *
 * ---------------------------------------------------------------------------------------------
 * Locating the stored file without going through the ledger -- and why that matters on this host
 * ---------------------------------------------------------------------------------------------
 * `NodeSpoolFileSystem.fsyncDirectory()` opens a directory and calls `fsync()` on it -- a POSIX
 * operation that fails with `EPERM` on Windows (documented on that class, measured in `JR-3-03`, and
 * this repository's own environment is Windows). `JournalAcceptance.accept()` only calls
 * `backend.append()` *after* the durable write -- including that directory-fsync step -- has fully
 * succeeded (`acceptance.ts`'s own module doc comment). So on this host every transaction below
 * fails at the `directory-fsync` stage, is quarantined (never deleted -- skill section 3) by
 * `accept()`'s own `DurableWriteError` handling, and the wire reply is `451`, never `250` -- the same
 * platform split `smtp-acceptance-wiring.test.ts`'s 150 MB streaming case already documents and
 * asserts explicitly rather than working around.
 *
 * A ledger-append-keyed lookup (reading `spoolTxId` off a `RecordingLedgerBackend`, as
 * `smtp-acceptance-wiring.test.ts`'s own `InMemoryLedgerAndLookup` does) would therefore find
 * **nothing** on this host: `append()` is never reached, so no request is ever recorded. This file
 * instead wraps `NodeSpoolFileSystem` only to observe `createFile()`'s argument -- the exact
 * `incoming/<shard>/<txid>.eml` path `writeDurableSpoolFile()` is about to write to, known the moment
 * the file is created, before any fsync (successful or not) happens. After the reply arrives (`250`
 * or the platform-dependent `451`), the test looks for the bytes at that path first and at the
 * matching `quarantine/<shard>/<txid>.eml` path second -- covering both outcomes without caring which
 * one this host produces. Either way, the assertion is the same: the bytes at rest are identical to
 * the bytes sent, which is what this task is actually about -- not the response code, and not which
 * of `incoming/`/`quarantine/` a directory-fsync quirk happens to leave them in.
 */

const RCPT_ADDRESS = 'journal@example.com';
const CHAIN_SCOPE_ID = '66666666-6666-4666-8666-666666666666';

/** Every syntactically valid recipient resolves to the one fixed test chain. Required alongside
 * `journalAcceptance` -- `tryBeginAcceptance()` (`smtp-server.ts`) refuses to start acceptance at all
 * without exactly one matched chain, and with no `recipientAclEvaluator` wired there is none. This
 * file is not about the recipient ACL itself (`smtp-recipient-acl-protocol.test.ts` covers that), it
 * only needs a `chainScopeId` for `tryBeginAcceptance()` to read. */
const SOURCE_ID = '77777777-7777-4777-8777-777777777777';
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

/** Records every `append()` request in order. On a platform where directory-fsync succeeds this is
 * reached and would be one valid way to key back to a stored file -- kept only for that platform
 * symmetry and for `requests.length` as a coarse "did an acceptance happen at all" signal; see this
 * file's module doc comment for why the actual file lookup below does not depend on it. */
class RecordingLedgerBackend implements LedgerBackend {
	readonly requests: LedgerAppendRequest[] = [];
	private seqCounter = 0n;

	async append(request: LedgerAppendRequest): Promise<LedgerAppendResult> {
		this.requests.push(request);
		this.seqCounter += 1n;
		return {
			seq: this.seqCounter,
			chainHash: Buffer.alloc(32, 0xcc),
			prevChainHash: Buffer.alloc(32, 0x00),
		};
	}
}

/** Wraps a real `SpoolFileSystem` to record every `incoming/<shard>/<txid>.eml` path
 * `writeDurableSpoolFile()` asks to create -- see this file's module doc comment for why this, and
 * not the ledger, is what this file uses to find a transaction's stored bytes afterward. Every other
 * method passes straight through to `inner`. */
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

/** Minimal SMTP client: send a command line, write raw bytes, or await the next (possibly
 * multiline) reply. Trimmed down from `smtp-acceptance-wiring.test.ts`'s own `TestSmtpClient` to
 * just what this file needs. */
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

/**
 * Dot-stuff CRLF-line-oriented content for the `DATA` path (RFC 5321 section 4.5.2): a line
 * beginning with `.` gets a second `.` prepended. Only ever called on the CRLF-only half of the
 * corpus below -- it would silently do nothing useful on bare-LF/bare-CR content, which is exactly
 * why that half is never sent over `DATA` at all.
 *
 * Decodes/re-encodes as `latin1` rather than `utf8` -- a 1:1 byte<->code-unit mapping with no
 * replacement of invalid sequences, so this helper never itself becomes a transformation the test
 * would then fail to notice.
 */
function dotStuffForData(raw: Buffer): Buffer {
	const text = raw.toString('latin1');
	const lines = text.split('\r\n');
	const stuffed = lines.map((line) => (line.startsWith('.') ? `.${line}` : line));
	return Buffer.from(stuffed.join('\r\n'), 'latin1');
}

interface StartedServer {
	readonly server: EsmtpServer;
	readonly port: number;
	readonly backend: RecordingLedgerBackend;
	readonly fs: RecordingSpoolFileSystem;
	readonly spoolRoot: string;
}

const openServers: EsmtpServer[] = [];
const openSockets: Socket[] = [];
const tempDirs: string[] = [];

async function startServer(): Promise<StartedServer> {
	const spoolRoot = await mkdtemp(path.join(tmpdir(), 'oa-byte-fidelity-'));
	tempDirs.push(spoolRoot);
	const backend = new RecordingLedgerBackend();
	const fs = new RecordingSpoolFileSystem(new NodeSpoolFileSystem());
	const acceptance = new JournalAcceptance({
		fs,
		backend,
		spoolConfig: { rootPath: spoolRoot, highWaterBytes: 500_000_000n },
		alertSink: noopAlertSink(),
	});
	const smtp = smtpServerConfigSchema.parse({ sizeLimitBytes: 50 * 1024 * 1024 });
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
	return { server, port: address.port, backend, fs, spoolRoot };
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

/** Drive a fresh connection through `EHLO`/`MAIL`/`RCPT`, positioned right before `DATA`/`BDAT`. The
 * fixed recipient ACL above resolves every syntactically valid recipient to the one test chain --
 * this file is not about access control, it just needs `tryBeginAcceptance()` to find exactly one
 * matched chain (see `fixedRecipientAcl`'s doc comment). */
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

/**
 * The reply this test can actually expect on this platform, immediately after the last content byte
 * is sent -- see this file's module doc comment. Everywhere but Windows, directory-fsync succeeds
 * and the transaction is genuinely accepted (`250`). On Windows it fails at that last durability
 * step and `accept()` reports `spool-write-failed` (`451`) -- the bytes are still on disk (written
 * and file-synced before that step runs), just not durable by this server's own definition, and the
 * file is quarantined rather than left in `incoming/`.
 */
const EXPECTED_ACCEPT_REPLY = process.platform === 'win32' ? /^451 4\.3\.0/ : /^250 2\.0\.0/;

/** Send `content` over `DATA`, dot-stuffed, and wait for the reply. Only valid for CRLF-line-oriented
 * content -- see this file's module doc comment. */
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

/** Send `content` over `BDAT ... LAST` verbatim -- no dot-stuffing, no line orientation -- and wait
 * for the reply. */
async function acceptViaBdat(started: StartedServer, content: Buffer): Promise<Buffer> {
	const client = await establishTransaction(started.port);
	client.send(`BDAT ${content.length} LAST`);
	await client.writeRawBuffer(content);
	const reply = await client.nextReply();
	expect(reply[0]).toMatch(EXPECTED_ACCEPT_REPLY);
	return readStoredBytes(started);
}

/**
 * Read the bytes the most recent transaction actually left on disk -- at whichever of `incoming/`
 * (accepted, or Windows before this test even asks) or `quarantine/` (Windows's directory-fsync
 * failure, moved there by `accept()`'s own quarantine handling) they ended up in. See this file's
 * module doc comment for why this does not go through the ledger.
 */
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

// ---------------------------------------------------------------------------------------------
// Corpus, group A: valid CRLF-line-oriented content -- sent over both DATA and BDAT.
// ---------------------------------------------------------------------------------------------

const CRLF_CORPUS: ReadonlyArray<{ readonly name: string; readonly content: Buffer }> = [
	{
		name: 'plain CRLF body',
		content: Buffer.from('Subject: test\r\n\r\nHello, world!\r\n', 'latin1'),
	},
	{
		name: 'leading-dot content line (requires dot-stuffing over DATA)',
		content: Buffer.from(
			'Subject: test\r\n\r\n.This line starts with a dot\r\nSecond line\r\n',
			'latin1'
		),
	},
	{
		name: 'a content line that is exactly "." (terminator look-alike)',
		content: Buffer.from('Subject: test\r\n\r\nfirst\r\n.\r\nlast\r\n', 'latin1'),
	},
	{
		name: 'multiple consecutive blank lines',
		content: Buffer.from(
			'Subject: test\r\n\r\n\r\n\r\nBody after two blank lines\r\n',
			'latin1'
		),
	},
	{
		name: 'UTF-8 multibyte characters (8BITMIME-shaped)',
		content: Buffer.from('Subject: Grüße\r\n\r\nUTF-8: caffè ☕ 日本語\r\n', 'utf8'),
	},
];

// ---------------------------------------------------------------------------------------------
// Corpus, group B: content that DATA's line-oriented framing cannot carry at all -- BDAT only. See
// this file's module doc comment for why.
// ---------------------------------------------------------------------------------------------

const BDAT_ONLY_CORPUS: ReadonlyArray<{ readonly name: string; readonly content: Buffer }> = [
	{
		name: 'bare LF only, no CR anywhere, no trailing CRLF (the ADR-029 case)',
		content: Buffer.from(
			'Subject: test\nFrom: sender@example.com\n\nBare LF body, no CR anywhere\nsecond line\n',
			'latin1'
		),
	},
	{
		name: 'bare CR only, no LF anywhere',
		content: Buffer.from(
			'Subject: test\rFrom: sender@example.com\r\rBare CR body, no LF anywhere\rsecond line\r',
			'latin1'
		),
	},
	{
		name: 'mixed CRLF/LF/CR with no line ending on the final line',
		content: Buffer.concat([
			Buffer.from('line-crlf\r\n', 'latin1'),
			Buffer.from('line-lf\n', 'latin1'),
			Buffer.from('line-cr\r', 'latin1'),
			Buffer.from('final-line-no-terminator-at-all', 'latin1'),
		]),
	},
	{
		name: 'a single very long line with no line ending anywhere',
		content: Buffer.from('x'.repeat(5_000), 'latin1'),
	},
	{
		// 0xE9/0xF1 are Latin-1 'é'/'ñ'; as a UTF-8 lead byte 0xE9 demands two continuation bytes,
		// which 0xF1 is not (0xF1 is itself a UTF-8 lead byte). A UTF-8 decode/re-encode step would
		// silently replace both with U+FFFD.
		name: 'Latin-1 bytes that are not valid UTF-8',
		content: Buffer.from([
			0x53, 0x75, 0x62, 0x6a, 0x3a, 0x20, 0xe9, 0xf1, 0xff, 0xfe, 0x0d, 0x0a,
		]),
	},
	{
		name: 'NUL bytes embedded in the body',
		content: Buffer.from([
			0x42, 0x6f, 0x64, 0x79, 0x3a, 0x20, 0x00, 0x00, 0x41, 0x00, 0x42, 0x0d, 0x0a,
		]),
	},
	{
		name: 'arbitrary binary content covering the full byte range',
		content: randomBytes(4_096),
	},
];

suite('ci', 'byte-identical spool storage across DATA and BDAT (JR-4-07)', () => {
	let started: StartedServer;

	beforeAll(async () => {
		started = await startServer();
	});

	afterEach(() => {
		for (const socket of openSockets.splice(0)) {
			if (!socket.destroyed) {
				socket.destroy();
			}
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

	for (const { name, content } of CRLF_CORPUS) {
		it(`${name} -- stored identically via DATA`, async () => {
			const stored = await acceptViaData(started, content);
			expect(Buffer.compare(stored, content)).toBe(0);
			expect(stored.equals(content)).toBe(true);
		});

		it(`${name} -- stored identically via BDAT`, async () => {
			const stored = await acceptViaBdat(started, content);
			expect(Buffer.compare(stored, content)).toBe(0);
			expect(stored.equals(content)).toBe(true);
		});
	}

	for (const { name, content } of BDAT_ONLY_CORPUS) {
		it(`${name} -- stored identically via BDAT (not representable over DATA)`, async () => {
			const stored = await acceptViaBdat(started, content);
			expect(Buffer.compare(stored, content)).toBe(0);
			expect(stored.equals(content)).toBe(true);
		});
	}

	it('sanity: the corpus is not accidentally empty', () => {
		expect(CRLF_CORPUS.length).toBeGreaterThan(0);
		expect(BDAT_ONLY_CORPUS.length).toBeGreaterThan(0);
	});
});
