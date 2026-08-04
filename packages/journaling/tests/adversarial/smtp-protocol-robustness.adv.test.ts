import { connect as connectTcp, type Socket } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	EsmtpServer,
	type ConnectionLimiter,
	type EsmtpServerOptions,
	type IngressLogger,
	type JournalAcceptancePort,
	type RecipientAclEvaluator,
	type SourceAclDecision,
	type SourceAclEvaluator,
} from '../../src/ingress/smtp-server';
import { smtpServerConfigSchema } from '../../src/ingress/smtp-config';
import { PerSourceConnectionLimiter } from '../../src/ingress/connection-rate-limiter';
import type { JournalAcceptanceResult, JournalTransactionInput } from '../../src/spool/acceptance';

/**
 * `JR-4-14` -- ADR-026 Auflage 1: this server is hand-rolled on `node:net` (see `smtp-server.ts`'s
 * own module doc comment for why no library was available that supported `BDAT`), which means it
 * never inherited the hardening an established SMTP server package would have brought against a
 * hostile or merely broken peer. This file is that hardening's proof, over a real loopback socket.
 * Classification: `ci` (every case is a wire-level probe against an in-process `EsmtpServer`, no
 * external service, matching the precedent every sibling `smtp-*-protocol.test.ts` file in
 * `tests/unit/` already set for this class -- placed under `tests/adversarial/` instead because,
 * unlike those files, the point of every case here is specifically hostile/malformed input, not a
 * feature's happy path plus its RFC-mandated edge cases).
 *
 * ---------------------------------------------------------------------------------------------
 * The acceptance criterion this file is measured against, verbatim from `03-backlog.md`
 * ---------------------------------------------------------------------------------------------
 * "Kein Fall bringt den Prozess zum Absturz, erzeugt ein `5xx` für einen lokalen Fehler, lässt den
 * Speicher unbegrenzt wachsen oder erzeugt eine Antwort außerhalb der Codetabelle; jeder Fall ist
 * aus Client-Sicht ausgewertet; und nach jedem Fall nimmt derselbe Prozess eine gültige Nachricht
 * weiterhin an." The last clause is the one every case here is built around:
 * {@link expectServerStillAcceptsAValidMessage} opens a **fresh** connection (most cases below
 * close or corrupt the connection under test, exactly as a real MTA would after a protocol
 * violation) against the **same** `EsmtpServer`/`net.Server` instance and drives it through a
 * complete, real `250 2.0.0` accepted transaction -- not merely a plausible-looking reply, an
 * `accepted` result out of a wired {@link JournalAcceptancePort} fake, the same strength of proof
 * `smtp-response-code-table.test.ts` uses for its own "accepted" row. A case that left the server in
 * a state where this fails is exactly the class of defect this task exists to find.
 *
 * A genuine crash (an uncaught exception escaping a socket event handler) cannot be caught as an
 * ordinary failed assertion in an in-process test the way every other file in this suite already
 * works -- it would take the whole vitest worker down instead, which is a **more** visible failure
 * than a red test, not a silent gap. No such crash was observed while building or running this file
 * (see the report accompanying this commit for what "in-process" means for this specific claim).
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

/** Same shape as `smtp-response-code-table.test.ts`'s `fakeAcceptance` -- a real accepted result out
 * of a wired `JournalAcceptancePort`, not a value that merely looks like one. Draining `chunks` is
 * required: `finalizeAcceptance`'s `bridge.end()` would otherwise hang waiting for a reader that
 * never arrives (the same note that file's own helper carries). */
function fakeAcceptance(): JournalAcceptancePort {
	let seq = 0n;
	return {
		async accept(input: JournalTransactionInput): Promise<JournalAcceptanceResult> {
			for await (const _chunk of input.chunks) {
				// discarded on purpose -- this file's cases care about the SMTP-level reply, not what
				// the ledger does with the bytes (that is JR-4-06a/JR-2-*'s territory).
			}
			seq += 1n;
			return {
				kind: 'accepted',
				spoolTxId: `adv-${seq}`,
				seq,
				chainHash: Buffer.alloc(32, 7),
			};
		},
	};
}

/** `tryBeginAcceptance()`'s `singleMatchedChainScopeId()` throws (and the connection answers `451`
 * out of the same generic "local error" bucket, not a crash) when no recipient resolved to a chain
 * -- see that method's own doc comment: "is recipientAclEvaluator configured alongside
 * journalAcceptance?". Every case in this file that wants a real `250` therefore needs a recipient
 * ACL wired too, not just `journalAcceptance` -- the same pairing
 * `smtp-response-code-table.test.ts`'s `fixedRecipientAcl` already establishes. */
const RECIPIENT_SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const RECIPIENT_CHAIN_SCOPE_ID = '22222222-2222-4222-8222-222222222222';
const fixedRecipientAcl: RecipientAclEvaluator = {
	evaluateRecipient: () => ({
		kind: 'allowed',
		sourceId: RECIPIENT_SOURCE_ID,
		chainScopeId: RECIPIENT_CHAIN_SCOPE_ID,
	}),
};

interface StartedServer {
	readonly server: EsmtpServer;
	readonly port: number;
}

async function startServer(
	options: Partial<Omit<EsmtpServerOptions, 'smtp'>> & {
		smtpOverrides?: Record<string, unknown>;
	} = {}
): Promise<StartedServer> {
	const { smtpOverrides, ...rest } = options;
	const smtp = smtpServerConfigSchema.parse(smtpOverrides ?? {});
	// Wired by default, in every case in this file: `expectServerStillAcceptsAValidMessage`'s whole
	// point is a real `250` out of a real `accept()` call, the strongest available proof of "still
	// healthy" (see this file's module doc comment). An explicit `journalAcceptance` in `options`
	// still overrides this -- none of this file's cases need to, but a future one might want to
	// prove something about the *unwired* `451` path instead.
	const server = new EsmtpServer({
		smtp,
		logger: silentLogger,
		journalAcceptance: fakeAcceptance(),
		recipientAclEvaluator: fixedRecipientAcl,
		...rest,
	});
	openServers.push(server);
	await server.listen(0, '127.0.0.1');
	const address = server.address;
	if (address === null) {
		throw new Error('server did not bind');
	}
	return { server, port: address.port };
}

/** A minimal SMTP client over a raw socket: buffers bytes, resolves one full (possibly multiline)
 * reply at a time -- a reply ends at the first line whose status code is followed by a space rather
 * than a dash (RFC 5321 section 4.2.1). Identical contract to `smtp-server-protocol.test.ts`'s own
 * `TestSmtpClient`, copied rather than imported: these two files must stay independently readable
 * (`tester.md`'s "no second harness" instruction is about production-facing test infrastructure,
 * not about two sibling test files sharing a 40-line client class each already understands fully).
 */
class TestSmtpClient {
	private raw = '';
	private currentReplyLines: string[] = [];
	private readonly readyReplies: string[][] = [];
	private readonly waiters: Array<{
		resolve: (lines: string[]) => void;
		reject: (err: Error) => void;
		timer: NodeJS.Timeout;
	}> = [];
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
			if (idx === -1) {
				return;
			}
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

	/** Write raw bytes with no appended CRLF -- for malformed input and for pacing a write across
	 * more than one TCP segment (await between calls forces a real trip through the event loop). */
	writeRaw(text: string | Buffer): Promise<void> {
		return new Promise((resolve, reject) => {
			this.socket.write(text, (err) => (err ? reject(err) : resolve()));
		});
	}

	nextReply(timeoutMs = 2_000): Promise<string[]> {
		const ready = this.readyReplies.shift();
		if (ready) {
			return Promise.resolve(ready);
		}
		return new Promise<string[]>((resolve, reject) => {
			const timer = setTimeout(() => {
				const idx = this.waiters.findIndex((w) => w.resolve === resolve);
				if (idx !== -1) this.waiters.splice(idx, 1);
				reject(new Error(`no SMTP reply within ${timeoutMs}ms`));
			}, timeoutMs);
			this.waiters.push({ resolve, reject, timer });
		});
	}

	/** Abruptly destroy the underlying socket -- for the "connection dropped mid-command" case. */
	destroy(): void {
		this.socket.destroy();
	}

	waitForClose(timeoutMs = 2_000): Promise<void> {
		if (this.closed) {
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`socket did not close within ${timeoutMs}ms`)),
				timeoutMs
			);
			this.socket.once('close', () => {
				clearTimeout(timer);
				resolve();
			});
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

/** Drive a fresh connection through `EHLO`/`MAIL`/`RCPT`/`DATA`/terminator and demand a real `250
 * 2.0.0` -- the "same process still accepts a valid message" half of every case in this file. Takes
 * the *port*, not a client, precisely so every case can call this after doing whatever damage it
 * likes to its own connection: a fresh TCP connection is the honest way to ask "is the process still
 * healthy", the same way a real sending MTA would simply retry, not reuse a connection it has reason
 * to distrust. */
async function expectServerStillAcceptsAValidMessage(port: number): Promise<void> {
	const client = await connectClient(port);
	await client.nextReply(); // 220
	client.send('EHLO client.example.com');
	await client.nextReply();
	client.send('MAIL FROM:<sender@example.com>');
	const mailReply = await client.nextReply();
	expect(mailReply[0]).toMatch(/^250 /);
	client.send('RCPT TO:<recipient@example.com>');
	const rcptReply = await client.nextReply();
	expect(rcptReply[0]).toMatch(/^250 /);
	client.send('DATA');
	const dataReply = await client.nextReply();
	expect(dataReply[0]).toMatch(/^354 /);
	await client.writeRaw('Subject: still healthy\r\n\r\nhello\r\n.\r\n');
	const finalReply = await client.nextReply();
	expect(finalReply[0]).toMatch(/^250 2\.0\.0/);
}

/** `process.memoryUsage()` fields relevant to this file's flood/oversize cases. Sampled, not
 * asserted to be monotonically bounded per iteration -- GC is not synchronous, so the only honest
 * claim is "did not end up far higher after the flood than a comfortable budget", the same
 * after-the-fact sampling discipline `smtp-server-protocol.test.ts`'s 150 MB BDAT heap test uses,
 * and the same F43 lesson (`09-befunde-bestandscode.md`): `heapUsed` alone is blind to retained
 * `Buffer`/`ArrayBuffer` backing stores, so both are sampled here even though these particular cases
 * are string/line-shaped rather than large-buffer-shaped. */
function sampleMemory(): { heapUsed: number; arrayBuffers: number } {
	const usage = process.memoryUsage();
	return { heapUsed: usage.heapUsed, arrayBuffers: usage.arrayBuffers };
}

suite(
	'ci',
	'JR-4-14 -- a line that never completes with CRLF, across every buffer boundary',
	() => {
		it('a single write far longer than the 512-byte limit, with no CRLF anywhere in it, is rejected and closed -- not left buffering forever', async () => {
			const { port } = await startServer();
			const client = await connectClient(port);
			await client.nextReply();
			// One write, well over MAX_COMMAND_LINE_BYTES (512), no CRLF at all.
			await client.writeRaw('A'.repeat(50_000));
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^500 5\.5\.1/);
			await client.waitForClose();
			await expectServerStillAcceptsAValidMessage(port);
		});

		it('the same non-terminated line arriving as many small chunks, each far under the limit alone, still gets caught once their sum crosses it', async () => {
			const { port } = await startServer();
			const client = await connectClient(port);
			await client.nextReply();
			// 40 chunks of 20 bytes = 800 bytes total, over the 512-byte limit, none individually
			// suspicious and no CRLF anywhere -- a real trip through the event loop between writes so
			// these are genuinely separate reads on the server side, not one write Node happens to
			// deliver in one 'data' event.
			for (let i = 0; i < 40 && !client.closed; i += 1) {
				await client.writeRaw('B'.repeat(20));
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^500 5\.5\.1/);
			await client.waitForClose();
			await expectServerStillAcceptsAValidMessage(port);
		});

		it('a genuinely unbounded flood with no CRLF does not grow memory without bound before the limit catches it', async () => {
			const { port } = await startServer();
			const client = await connectClient(port);
			await client.nextReply();
			const before = sampleMemory();
			// 2000 x 4 KiB = ~8 MB sent, all before any CRLF -- if the server buffered every byte without
			// ever consulting MAX_COMMAND_LINE_BYTES until the whole flood finished, this would show up
			// here as heap growth proportional to 8 MB; the limit is meant to fire within the first few
			// chunks (512 bytes in), long before that.
			let rejected = false;
			for (let i = 0; i < 2000 && !rejected; i += 1) {
				try {
					await client.writeRaw(Buffer.alloc(4096, 67 /* 'C' */));
				} catch {
					// The server closed the connection between our last check and this write (it wrote its
					// 500 and called socket.end() -- see smtp-server.ts around line 1394) -- exactly the
					// rejection this loop is racing to observe, not a test failure.
					rejected = true;
					break;
				}
				await new Promise((resolve) => setImmediate(resolve));
				rejected = client.closed;
			}
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^500 5\.5\.1/);
			const after = sampleMemory();
			// A generous budget: nowhere near the ~8 MB the flood would have produced had the limit not
			// fired early. This is a coarse sanity bound, not a leak-proof (see this file's `sampleMemory`
			// doc comment) -- it is here to catch "the limit silently stopped firing", not to certify an
			// exact ceiling.
			expect(after.heapUsed - before.heapUsed).toBeLessThan(4 * 1024 * 1024);
			await client.waitForClose();
			await expectServerStillAcceptsAValidMessage(port);
		}, 20_000);

		it('FINDING (see report/F52): a command line that is over the 512-byte limit but arrives already CRLF-terminated in one chunk bypasses MAX_COMMAND_LINE_BYTES entirely', async () => {
			const { port } = await startServer();
			const client = await connectClient(port);
			await client.nextReply();
			client.send('EHLO client.example.com');
			await client.nextReply();
			// The whole line, well over 512 bytes, PLUS its own terminating CRLF, in one single write --
			// on loopback this reliably arrives at the server as one 'data' event for a payload this
			// small, so `commandCarry.indexOf(CRLF)` finds the terminator immediately and the
			// `idx === -1` branch (the only place MAX_COMMAND_LINE_BYTES is ever consulted,
			// smtp-server.ts around line 1392) is never reached at all.
			const oversizedAddress = 'a'.repeat(2_000);
			await client.writeRaw(`MAIL FROM:<${oversizedAddress}@example.com>\r\n`);
			const reply = await client.nextReply();
			// Documented, not asserted as correct: this is the finding. If a future fix enforces the
			// limit for terminated lines too, this line starts failing here and must be updated together
			// with F52's status in 09-befunde-bestandscode.md, not silently loosened.
			expect(reply[0]).toMatch(/^250 /);
			expect(reply[0]).not.toMatch(/^500/);
			// Whatever the reply, it is still a real, in-table SMTP reply and the process is undamaged --
			// the finding is an RFC-conformance/resource-shaping gap, not a crash or an out-of-table reply.
			await expectServerStillAcceptsAValidMessage(port);
		});
	}
);

suite('ci', 'JR-4-14 -- truncated and pipelined-invalid commands', () => {
	it('a command that is never completed (no CRLF, connection abruptly dropped) leaves no residue', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		await client.writeRaw('MAI');
		const closed = client.waitForClose();
		client.destroy();
		await closed;
		await expectServerStillAcceptsAValidMessage(port);
	});

	it('command flood: thousands of pipelined NOOPs in one write all get correct, in-order replies without hanging', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();

		const FLOOD_COUNT = 20_000;
		const flood = 'NOOP\r\n'.repeat(FLOOD_COUNT);
		const startedAt = Date.now();
		await client.writeRaw(flood);
		for (let i = 0; i < FLOOD_COUNT; i += 1) {
			const reply = await client.nextReply(10_000);
			expect(reply[0]).toMatch(/^250 2\.0\.0/);
		}
		const elapsedMs = Date.now() - startedAt;
		// No hard real-time budget is specified anywhere in the backlog; this is a sanity bound
		// against an accidental O(n^2) in the command-parsing loop, not a performance SLA.
		expect(elapsedMs).toBeLessThan(15_000);
		await expectServerStillAcceptsAValidMessage(port);
	}, 30_000);

	it('DATA before MAIL is 503, and the same connection can still complete a transaction afterward', async () => {
		const { port } = await startServer({ journalAcceptance: fakeAcceptance() });
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		client.send('DATA');
		expect((await client.nextReply())[0]).toMatch(/^503 /);
		// Same connection, not a fresh one: the 503 must not have corrupted this connection's state.
		client.send('MAIL FROM:<a@example.com>');
		expect((await client.nextReply())[0]).toMatch(/^250 /);
		client.send('RCPT TO:<b@example.com>');
		expect((await client.nextReply())[0]).toMatch(/^250 /);
		client.send('DATA');
		expect((await client.nextReply())[0]).toMatch(/^354 /);
		await client.writeRaw('hello\r\n.\r\n');
		expect((await client.nextReply())[0]).toMatch(/^250 2\.0\.0/);
	});

	it('RCPT before MAIL is 503, then a fresh connection still accepts a valid message', async () => {
		const { port } = await startServer({ journalAcceptance: fakeAcceptance() });
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		client.send('RCPT TO:<b@example.com>');
		expect((await client.nextReply())[0]).toMatch(/^503 /);
		await expectServerStillAcceptsAValidMessage(port);
	});

	it('BDAT before MAIL/RCPT is 503, then a fresh connection still accepts a valid message', async () => {
		const { port } = await startServer({ journalAcceptance: fakeAcceptance() });
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		client.send('BDAT 10');
		expect((await client.nextReply())[0]).toMatch(/^503 /);
		await expectServerStillAcceptsAValidMessage(port);
	});

	it('a flood of bad-sequence commands (RCPT before MAIL, repeatedly) never escalates past 503 and never wedges the connection', async () => {
		const { port } = await startServer({ journalAcceptance: fakeAcceptance() });
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		const FLOOD_COUNT = 500;
		await client.writeRaw('RCPT TO:<b@example.com>\r\n'.repeat(FLOOD_COUNT));
		for (let i = 0; i < FLOOD_COUNT; i += 1) {
			expect((await client.nextReply(5_000))[0]).toMatch(/^503 /);
		}
		await expectServerStillAcceptsAValidMessage(port);
	}, 15_000);
});

suite('ci', 'JR-4-14 -- malformed line endings and control bytes', () => {
	it('a bare LF with no CR is never mistaken for a line terminator -- it accumulates as ordinary content until the length limit fires', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		// If a bare '\n' were (incorrectly) treated as a terminator, this would produce five separate
		// "unrecognised command" replies. The correct behaviour is silence until the accumulated,
		// still-unterminated buffer exceeds the 512-byte limit.
		await client.writeRaw('NOOP\nNOOP\nNOOP\nNOOP\nNOOP\n'.repeat(20)); // 25 * 20 = 500 bytes
		await expect(client.nextReply(300)).rejects.toThrow(/no SMTP reply/);
		await client.writeRaw('X'.repeat(50)); // push the still-unterminated buffer over 512 bytes
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^500 5\.5\.1/);
		await client.waitForClose();
		await expectServerStillAcceptsAValidMessage(port);
	});

	it('a bare CR with no LF inside an otherwise CRLF-terminated line is ordinary content, not a terminator -- the malformed verb is rejected, not executed', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		// "NOOP\rNOOP" followed by a real CRLF is one line whose "verb" (up to the first space, there
		// is none) is the literal string "NOOP\rNOOP" -- not a valid verb, and specifically not two
		// executed NOOPs.
		await client.writeRaw('NOOP\rNOOP\r\n');
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^500 5\.5\.1/);
		await expectServerStillAcceptsAValidMessage(port);
	});

	it('NUL and 8-bit bytes inside a command line produce an in-table reply, never an exception', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		const hostile = Buffer.concat([
			Buffer.from('EH'),
			Buffer.from([0x00, 0x80, 0xff]),
			Buffer.from('LO client.example.com\r\n'),
		]);
		await client.writeRaw(hostile);
		const reply = await client.nextReply();
		// The verb "EH\x00\x80\xffLO" does not match any known verb -- falls through to the ordinary
		// "not recognised" bucket, the same as any other typo. Any 3-digit in-table reply is an
		// acceptable outcome here; what would fail this test is a timeout (server wedged) or the
		// connection dying without a reply (crash).
		expect(reply[0]).toMatch(/^\d{3} /);
		await expectServerStillAcceptsAValidMessage(port);
	});

	it('NUL and 8-bit bytes inside a MAIL FROM address are accepted as address content, not rejected or crashed on', async () => {
		const { port } = await startServer({ journalAcceptance: fakeAcceptance() });
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		const hostileAddress = Buffer.concat([
			Buffer.from('MAIL FROM:<a'),
			Buffer.from([0x00, 0x01, 0x80, 0xff]),
			Buffer.from('b@example.com>\r\n'),
		]);
		await client.writeRaw(hostileAddress);
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^\d{3} /);
		expect(reply[0]).not.toMatch(/^5\d\d/); // MAIL_FROM_PATTERN's [^>]* accepts any byte but '>'
		await expectServerStillAcceptsAValidMessage(port);
	});
});

suite('ci', 'JR-4-14 -- BDAT edge cases beyond JR-4-11/JR-4-03', () => {
	async function establishTransaction(port: number): Promise<TestSmtpClient> {
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		client.send('MAIL FROM:<a@example.com>');
		await client.nextReply();
		client.send('RCPT TO:<b@example.com>');
		await client.nextReply();
		return client;
	}

	it('BDAT with a chunk-size at the edge of Number.isSafeInteger is a syntax error, not a crash or a hang', async () => {
		const { port } = await startServer();
		const client = await establishTransaction(port);
		// 2^53, one past the largest safe integer -- parses as a number but fails
		// Number.isSafeInteger, so parseBdatArguments returns null.
		client.send(`BDAT ${2 ** 53}`);
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^501 5\.5\.4/);
		await expectServerStillAcceptsAValidMessage(port);
	});

	it('BDAT declaring an astronomically large but *safe* chunk size is accepted syntactically, then the peer goes silent -- the data timeout bounds it, no unbounded wait, no crash', async () => {
		const { port } = await startServer({ smtpOverrides: { dataTimeoutMs: 200 } });
		const client = await establishTransaction(port);
		// A safe integer, deliberately far larger than any real message and than the default 150 MB
		// SIZE limit -- BDAT's own chunk-size parser has no upper bound tied to sizeLimitBytes (that
		// check only happens once bytes actually arrive, in BdatContentTracker.push). This is the
		// "BDAT mit ... zu großer Länge" case: syntactically "too large" is Number.isSafeInteger's
		// boundary (tested above); a large-but-safe declared length is a *silence* case instead.
		client.send(`BDAT ${Number.MAX_SAFE_INTEGER}`);
		// No content sent at all -- the declared chunk never arrives.
		const reply = await client.nextReply(3_000);
		expect(reply[0]).toMatch(/^421 4\.4\.2/);
		await client.waitForClose();
		await expectServerStillAcceptsAValidMessage(port);
	});

	it('a peer that announces BDAT and then sends nothing at all (no bytes, ever) times out instead of hanging the connection forever', async () => {
		const { port } = await startServer({ smtpOverrides: { dataTimeoutMs: 200 } });
		const client = await establishTransaction(port);
		client.send('BDAT 1000');
		// Total silence -- not even a partial chunk.
		const reply = await client.nextReply(3_000);
		expect(reply[0]).toMatch(/^421 4\.4\.2/);
		await client.waitForClose();
		await expectServerStillAcceptsAValidMessage(port);
	});

	it('a peer that sends a partial BDAT chunk and then goes silent still times out, not hangs', async () => {
		const { port } = await startServer({ smtpOverrides: { dataTimeoutMs: 200 } });
		const client = await establishTransaction(port);
		client.send('BDAT 1000 LAST');
		await client.writeRaw(Buffer.alloc(100, 88)); // far short of the declared 1000 bytes
		const reply = await client.nextReply(3_000);
		expect(reply[0]).toMatch(/^421 4\.4\.2/);
		await client.waitForClose();
		await expectServerStillAcceptsAValidMessage(port);
	});
});

suite(
	'ci',
	'JR-4-14 -- connections up to and beyond the per-source concurrent-connection limit',
	() => {
		function allowedDecision(sourceId: string): SourceAclDecision {
			return {
				kind: 'allowed',
				sourceId,
				chainScopeId: `${sourceId}-chain`,
				requireTls: false,
			};
		}

		function fixedEvaluator(sourceId: string): SourceAclEvaluator {
			return { evaluate: () => allowedDecision(sourceId) };
		}

		it('connections beyond the configured per-source limit get a full 421 4.7.0 reply, not a bare disconnect -- and existing connections plus later fresh ones are unaffected', async () => {
			const MAX_PER_SOURCE = 2;
			const connectionLimiter: ConnectionLimiter = new PerSourceConnectionLimiter(
				MAX_PER_SOURCE
			);
			const { port } = await startServer({
				sourceAclEvaluator: fixedEvaluator('src-1'),
				connectionLimiter,
				journalAcceptance: fakeAcceptance(),
			});

			// Fill the limit.
			const first = await connectClient(port);
			await first.nextReply();
			const second = await connectClient(port);
			await second.nextReply();

			// Over the limit: a full, in-table reply before the close, per the acceptance criterion
			// ("aus Client-Sicht ausgewertet" -- a bare RST would leave a sending MTA guessing).
			const overLimitSocket = connectTcp(port, '127.0.0.1');
			openSockets.push(overLimitSocket);
			const received = await new Promise<string>((resolve, reject) => {
				let buf = '';
				overLimitSocket.on('data', (chunk: Buffer) => {
					buf += chunk.toString('utf8');
				});
				overLimitSocket.once('close', () => resolve(buf));
				overLimitSocket.once('error', reject);
				setTimeout(() => reject(new Error('over-limit connection never closed')), 3_000);
			});
			expect(received).toMatch(/^421 4\.7\.0/);

			// A second, simultaneous over-limit attempt behaves the same way -- not just the first one.
			const overLimitSocket2 = connectTcp(port, '127.0.0.1');
			openSockets.push(overLimitSocket2);
			const received2 = await new Promise<string>((resolve, reject) => {
				let buf = '';
				overLimitSocket2.on('data', (chunk: Buffer) => {
					buf += chunk.toString('utf8');
				});
				overLimitSocket2.once('close', () => resolve(buf));
				overLimitSocket2.once('error', reject);
				setTimeout(
					() => reject(new Error('second over-limit connection never closed')),
					3_000
				);
			});
			expect(received2).toMatch(/^421 4\.7\.0/);

			// The two connections that were already inside the limit are untouched by the rejections.
			// EHLO's reply is multiline (PIPELINING/SIZE/... lines); the terminal line is the one with a
			// space after the code (RFC 5321 section 4.2.1), not the first line.
			first.send('EHLO client.example.com');
			const firstEhlo = await first.nextReply();
			expect(firstEhlo[firstEhlo.length - 1]).toMatch(/^250 /);
			second.send('EHLO client.example.com');
			const secondEhlo = await second.nextReply();
			expect(secondEhlo[secondEhlo.length - 1]).toMatch(/^250 /);

			// Release both slots, then a fresh connection from the same source succeeds and completes a
			// real transaction end to end.
			first.send('QUIT');
			await first.nextReply();
			await first.waitForClose();
			second.send('QUIT');
			await second.nextReply();
			await second.waitForClose();

			await expectServerStillAcceptsAValidMessage(port);
		});
	}
);
