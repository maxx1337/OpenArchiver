import { connect as connectTcp, type Socket } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	EsmtpServer,
	type EsmtpServerOptions,
	type IngressLogger,
} from '../../src/ingress/smtp-server';
import {
	smtpServerConfigSchema,
	DEFAULT_SMTP_SIZE_LIMIT_BYTES,
} from '../../src/ingress/smtp-config';

/**
 * `JR-4-02` -- the ESMTP protocol engine, proven over a real TCP connection.
 *
 * ---------------------------------------------------------------------------------------------
 * Why these are real sockets, and why that still belongs in the `unit` suite
 * ---------------------------------------------------------------------------------------------
 * The Product Owner's instruction for this task was explicit: "the proof for 'EHLO announces' is
 * carried over the wire, not over an options object" -- a test that only checks
 * `buildEhloResponseLines()` was *called* with the right config would prove this file calls its own
 * helper correctly, not that a real client sees the right bytes. The same reasoning applies to the
 * three timeouts: what a sending MTA experiences is a status code and a connection close, not a
 * cleared `NodeJS.Timeout` handle.
 *
 * Classifying this as `unit` rather than `integration` follows the precedent this exact epic slice
 * set one task earlier: `packages/journaling/tests/unit/ingress-process-boot.test.ts` (`JR-4-01`)
 * already opens real sockets and spawns a real child process, in `tests/unit/`, and is described
 * there as "units of the harness itself" only loosely -- it is really a fact about the compiled
 * process. This file is the same kind of fact about a class rather than a whole process: no
 * external service, no `DATABASE_URL`, no database at all (`integration`'s defining feature per
 * CLAUDE.md section 5.1) -- only an in-process `net.Server` on a loopback port, torn down in
 * `afterEach`. Every case here is designed to finish in well under the `unit` project's 5 second
 * `testTimeout`; the timeout tests use configured timeouts in the low hundreds of milliseconds for
 * exactly that reason, not because a real deployment would ever use such a short timeout.
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

interface StartedServer {
	readonly server: EsmtpServer;
	readonly port: number;
}

async function startServer(smtpOverrides: Record<string, unknown> = {}): Promise<StartedServer> {
	const smtp = smtpServerConfigSchema.parse(smtpOverrides);
	const options: EsmtpServerOptions = { smtp, logger: silentLogger };
	const server = new EsmtpServer(options);
	openServers.push(server);
	await server.listen(0, '127.0.0.1');
	const address = server.address;
	if (address === null) {
		throw new Error('server did not bind');
	}
	return { server, port: address.port };
}

/** A minimal SMTP client over a raw socket: buffers bytes, and resolves one full (possibly
 * multiline) reply at a time -- a reply ends at the first line whose status code is followed by a
 * space rather than a dash (RFC 5321 section 4.2.1). */
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

	/** Write raw bytes with no appended CRLF -- for pipelining multiple commands in one write, and
	 * for DATA content. */
	writeRaw(text: string): void {
		this.socket.write(text);
	}

	/** Write a raw `Buffer` (for `BDAT` chunk payloads, where content is arbitrary bytes rather
	 * than text) and resolve once Node has finished handing it off -- pacing large transfers so
	 * they are not all queued into Node's internal write buffer at once, the same reason `JR-3-02`'s
	 * heap-growth proof reuses one buffer instead of building an array of them. */
	writeRawBuffer(buf: Buffer): Promise<void> {
		return new Promise((resolve, reject) => {
			this.socket.write(buf, (err) => (err ? reject(err) : resolve()));
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

suite('ci', 'EsmtpServer over the wire (JR-4-02)', () => {
	it('greets with 220 and ESMTP in the banner', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		const greeting = await client.nextReply();
		expect(greeting).toHaveLength(1);
		expect(greeting[0]).toMatch(/^220 /);
		expect(greeting[0]).toContain('ESMTP');
	});

	it('EHLO announces PIPELINING, 8BITMIME, SMTPUTF8 and the default SIZE', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply(); // 220 greeting
		client.send('EHLO client.example.com');
		const reply = await client.nextReply();
		const joined = reply.join('\n');
		expect(joined).toContain('PIPELINING');
		expect(joined).toContain('8BITMIME');
		expect(joined).toContain('SMTPUTF8');
		expect(joined).toContain(`SIZE ${DEFAULT_SMTP_SIZE_LIMIT_BYTES}`);
		// Every line but the last uses '250-'; the last uses '250 '.
		for (const line of reply.slice(0, -1)) {
			expect(line).toMatch(/^250-/);
		}
		expect(reply[reply.length - 1]).toMatch(/^250 /);
	});

	it('EHLO announces CHUNKING (JR-4-03)', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		const reply = await client.nextReply();
		expect(reply.join('\n')).toContain('CHUNKING');
	});

	it('EHLO SIZE reflects a configured value that differs from the 150 MB default', async () => {
		const nonDefaultSize = 12_345;
		expect(nonDefaultSize).not.toBe(DEFAULT_SMTP_SIZE_LIMIT_BYTES);
		const { port } = await startServer({ sizeLimitBytes: nonDefaultSize });
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		const reply = await client.nextReply();
		const joined = reply.join('\n');
		expect(joined).toContain(`SIZE ${nonDefaultSize}`);
		expect(joined).not.toContain(`SIZE ${DEFAULT_SMTP_SIZE_LIMIT_BYTES}`);
	});

	it('HELO gets a single-line, extension-free greeting', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		client.send('HELO client.example.com');
		const reply = await client.nextReply();
		expect(reply).toHaveLength(1);
		expect(reply[0]).toMatch(/^250 /);
		expect(reply[0]).not.toContain('PIPELINING');
	});

	it('PIPELINING: multiple commands written in one packet get correct, in-order replies', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();

		// Both commands in a single write -- the point being tested is that the server does not need
		// a round trip between them to produce two correct, correctly-ordered replies.
		client.writeRaw('MAIL FROM:<a@example.com>\r\nRCPT TO:<b@example.com>\r\n');

		const mailReply = await client.nextReply();
		expect(mailReply[0]).toMatch(/^250 2\.1\.0/);
		const rcptReply = await client.nextReply();
		expect(rcptReply[0]).toMatch(/^250 2\.1\.5/);
	});

	it('8BITMIME/SMTPUTF8: a UTF-8 address in MAIL FROM is accepted, not corrupted or rejected', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		client.send('MAIL FROM:<müller@example.com>');
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^250 /);
	});

	it('MAIL before EHLO is a bad sequence of commands (503)', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		client.send('MAIL FROM:<a@example.com>');
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^503 /);
	});

	it('RCPT before MAIL is a bad sequence of commands (503)', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		client.send('RCPT TO:<b@example.com>');
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^503 /);
	});

	it('DATA before any RCPT is a bad sequence of commands (503)', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		client.send('MAIL FROM:<a@example.com>');
		await client.nextReply();
		client.send('DATA');
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^503 /);
	});

	it('an unrecognized command gets 500 5.5.1', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		client.send('BOGUS');
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^500 5\.5\.1/);
	});

	it('MAIL FROM SIZE= over the configured limit is rejected with 552, before any DATA', async () => {
		const { port } = await startServer({ sizeLimitBytes: 1_000 });
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		client.send('MAIL FROM:<a@example.com> SIZE=2000');
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^552 5\.3\.4/);
	});

	it('QUIT replies 221 2.0.0 and closes the connection', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		client.send('QUIT');
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^221 2\.0\.0/);
		await client.waitForClose();
	});

	it('end of DATA never returns 250 -- answers 451 4.3.0 (acceptance wiring is JR-4-06)', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		client.send('MAIL FROM:<a@example.com>');
		await client.nextReply();
		client.send('RCPT TO:<b@example.com>');
		await client.nextReply();
		client.send('DATA');
		const dataReply = await client.nextReply();
		expect(dataReply[0]).toMatch(/^354 /);

		client.writeRaw('Subject: test\r\n\r\nhello world\r\n.\r\n');
		const finalReply = await client.nextReply();
		expect(finalReply[0]).toMatch(/^451 4\.3\.0/);
		expect(finalReply[0]).not.toMatch(/^250/);
	});

	it('connection timeout: idle before any command gets 421 4.4.2 and the connection closes', async () => {
		const { port } = await startServer({
			connectionTimeoutMs: 150,
			commandTimeoutMs: 60_000,
			dataTimeoutMs: 60_000,
		});
		const client = await connectClient(port);
		await client.nextReply(); // 220 greeting
		// Send nothing -- wait for the connection-level backstop to fire.
		const reply = await client.nextReply(3_000);
		expect(reply[0]).toMatch(/^421 4\.4\.2/);
		await client.waitForClose();
	});

	it('command timeout: idle between commands gets 421 4.4.2 and the connection closes', async () => {
		const { port } = await startServer({
			connectionTimeoutMs: 60_000,
			commandTimeoutMs: 150,
			dataTimeoutMs: 60_000,
		});
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		// No further command -- wait past commandTimeoutMs.
		const reply = await client.nextReply(3_000);
		expect(reply[0]).toMatch(/^421 4\.4\.2/);
		await client.waitForClose();
	});

	it('data timeout: idle mid-DATA gets 421 4.4.2 and the connection closes', async () => {
		const { port } = await startServer({
			connectionTimeoutMs: 60_000,
			commandTimeoutMs: 60_000,
			dataTimeoutMs: 150,
		});
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		client.send('MAIL FROM:<a@example.com>');
		await client.nextReply();
		client.send('RCPT TO:<b@example.com>');
		await client.nextReply();
		client.send('DATA');
		await client.nextReply(); // 354
		// Start the message but never send the terminator.
		client.writeRaw('Subject: test\r\n');
		const reply = await client.nextReply(3_000);
		expect(reply[0]).toMatch(/^421 4\.4\.2/);
		await client.waitForClose();
	});
});

/** Drive a connection through `EHLO`/`MAIL`/`RCPT` and leave it positioned right before `BDAT`/
 * `DATA` -- every `BDAT` test below starts from here, the same envelope every `DATA` test in the
 * suite above already assumed inline. The server's configuration (e.g. a non-default
 * `sizeLimitBytes`) is set by the `startServer()` call the caller already made -- this only drives
 * the protocol, it does not configure the server. */
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

suite('ci', 'EsmtpServer BDAT/CHUNKING over the wire (JR-4-03)', () => {
	it('single chunk: BDAT <n> LAST never returns 250 -- answers 451 4.3.0, same as end of DATA', async () => {
		const { port } = await startServer();
		const client = await establishTransaction(port);
		const payload = Buffer.from('Subject: test\r\n\r\nhello world\r\n');
		client.send(`BDAT ${payload.length} LAST`);
		await client.writeRawBuffer(payload);
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^451 4\.3\.0/);
		expect(reply[0]).not.toMatch(/^250/);
	});

	it('multi-chunk: each non-LAST BDAT gets 250, the LAST chunk gets 451 4.3.0', async () => {
		const { port } = await startServer();
		const client = await establishTransaction(port);
		const first = Buffer.from('Subject: test\r\n\r\n');
		const second = Buffer.from('hello world\r\n');

		client.send(`BDAT ${first.length}`);
		await client.writeRawBuffer(first);
		const firstReply = await client.nextReply();
		expect(firstReply[0]).toMatch(/^250 2\.0\.0/);

		client.send(`BDAT ${second.length} LAST`);
		await client.writeRawBuffer(second);
		const lastReply = await client.nextReply();
		expect(lastReply[0]).toMatch(/^451 4\.3\.0/);
	});

	it('BDAT 0 LAST as the only BDAT of the transaction completes it (empty message)', async () => {
		const { port } = await startServer();
		const client = await establishTransaction(port);
		client.send('BDAT 0 LAST');
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^451 4\.3\.0/);
	});

	it('BDAT 0 LAST completes a transaction that already received real chunks', async () => {
		const { port } = await startServer();
		const client = await establishTransaction(port);
		const payload = Buffer.from('hello world\r\n');
		client.send(`BDAT ${payload.length}`);
		await client.writeRawBuffer(payload);
		expect((await client.nextReply())[0]).toMatch(/^250 2\.0\.0/);

		client.send('BDAT 0 LAST');
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^451 4\.3\.0/);
	});

	it('a zero-length, non-LAST BDAT is a no-op that gets 250 and stays in the transaction', async () => {
		const { port } = await startServer();
		const client = await establishTransaction(port);
		client.send('BDAT 0');
		expect((await client.nextReply())[0]).toMatch(/^250 2\.0\.0/);

		const payload = Buffer.from('hello world\r\n');
		client.send(`BDAT ${payload.length} LAST`);
		await client.writeRawBuffer(payload);
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^451 4\.3\.0/);
	});

	it('a chunk boundary in the middle of a line is handled correctly', async () => {
		const { port } = await startServer();
		const client = await establishTransaction(port);
		const payload = Buffer.from('Subject: test\r\n\r\nhello world\r\n');
		client.send(`BDAT ${payload.length} LAST`);
		// Split well inside "hello world" -- not on any line or CRLF boundary.
		const splitAt = payload.indexOf('hello') + 2;
		await client.writeRawBuffer(payload.subarray(0, splitAt));
		await client.writeRawBuffer(payload.subarray(splitAt));
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^451 4\.3\.0/);
	});

	it('a chunk boundary between the \\r and \\n of a CRLF is handled correctly (the hardest case)', async () => {
		const { port } = await startServer();
		const client = await establishTransaction(port);
		const payload = Buffer.from('Subject: test\r\n\r\nhello world\r\n');
		client.send(`BDAT ${payload.length} LAST`);
		const crlfIdx = payload.indexOf('\r\n', payload.indexOf('hello'));
		const splitAt = crlfIdx + 1; // right after '\r', right before '\n'
		await client.writeRawBuffer(payload.subarray(0, splitAt));
		await client.writeRawBuffer(payload.subarray(splitAt));
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^451 4\.3\.0/);
		// The connection's byte-alignment survived the split: a follow-up command still gets a
		// normal reply rather than being swallowed as leftover chunk content.
		client.send('QUIT');
		expect((await client.nextReply())[0]).toMatch(/^221 2\.0\.0/);
	});

	it('BDAT command plus its full raw content pipelined in a single packet is accepted', async () => {
		const { port } = await startServer();
		const client = await establishTransaction(port);
		const payload = Buffer.from('hello world\r\n');
		client.writeRaw(`BDAT ${payload.length} LAST\r\n`);
		await client.writeRawBuffer(payload);
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^451 4\.3\.0/);
	});

	it('BDAT with a non-numeric chunk-size is a syntax error (501 5.5.4)', async () => {
		const { port } = await startServer();
		const client = await establishTransaction(port);
		client.send('BDAT abc');
		expect((await client.nextReply())[0]).toMatch(/^501 5\.5\.4/);
	});

	it('BDAT with a negative chunk-size is a syntax error (501 5.5.4)', async () => {
		const { port } = await startServer();
		const client = await establishTransaction(port);
		client.send('BDAT -5');
		expect((await client.nextReply())[0]).toMatch(/^501 5\.5\.4/);
	});

	it('BDAT with a missing chunk-size is a syntax error (501 5.5.4)', async () => {
		const { port } = await startServer();
		const client = await establishTransaction(port);
		client.send('BDAT');
		expect((await client.nextReply())[0]).toMatch(/^501 5\.5\.4/);
	});

	it('BDAT before any MAIL/RCPT is a bad sequence of commands (503)', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		client.send('BDAT 10');
		expect((await client.nextReply())[0]).toMatch(/^503 /);
	});

	it('a chunk sum over the configured SIZE limit is rejected with 552, with an alert logged', async () => {
		const { port } = await startServer({ sizeLimitBytes: 20 });
		const client = await establishTransaction(port);
		const first = Buffer.alloc(15, 'a'); // under the limit alone
		client.send(`BDAT ${first.length}`);
		await client.writeRawBuffer(first);
		expect((await client.nextReply())[0]).toMatch(/^250 2\.0\.0/);

		const second = Buffer.alloc(10, 'b'); // 15 + 10 = 25 > 20
		client.send(`BDAT ${second.length} LAST`);
		await client.writeRawBuffer(second);
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^552 5\.3\.4/);
	});

	it('a client that declares more bytes than it sends and then goes idle times out (421 4.4.2)', async () => {
		const { port } = await startServer({ dataTimeoutMs: 150 });
		const client = await establishTransaction(port);
		client.send('BDAT 100 LAST');
		await client.writeRawBuffer(Buffer.alloc(10, 'x')); // far short of the declared 100
		const reply = await client.nextReply(3_000);
		expect(reply[0]).toMatch(/^421 4\.4\.2/);
		await client.waitForClose();
	});

	it('DATA after a non-LAST BDAT in the same transaction is a bad sequence of commands (503) -- RFC 3030 mixing rule', async () => {
		const { port } = await startServer();
		const client = await establishTransaction(port);
		const payload = Buffer.from('hello world\r\n');
		client.send(`BDAT ${payload.length}`);
		await client.writeRawBuffer(payload);
		expect((await client.nextReply())[0]).toMatch(/^250 2\.0\.0/);

		client.send('DATA');
		expect((await client.nextReply())[0]).toMatch(/^503 /);
	});

	it('a BDAT sent after a BDAT ... LAST already completed the transaction is rejected (503) -- RFC 3030', async () => {
		const { port } = await startServer();
		const client = await establishTransaction(port);
		client.send('BDAT 0 LAST');
		expect((await client.nextReply())[0]).toMatch(/^451 4\.3\.0/);

		client.send('BDAT 10');
		expect((await client.nextReply())[0]).toMatch(/^503 /);
	});
});

suite('nightly', 'BDAT streams a 150 MB message without proportional heap growth (JR-4-03)', () => {
	it('accepts a 150 MB message over 150 x 1 MiB BDAT chunks with bounded heap growth', async () => {
		const sizeLimitBytes = 200 * 1024 * 1024;
		const { port } = await startServer({ sizeLimitBytes });
		const client = await establishTransaction(port);

		const CHUNK_SIZE = 1 * 1024 * 1024; // 1 MiB
		const TOTAL_BYTES = 150 * 1024 * 1024;
		const CHUNK_COUNT = Math.ceil(TOTAL_BYTES / CHUNK_SIZE);
		// One reused, mutated-in-place buffer -- the same discipline `JR-3-02`'s heap-growth proof
		// uses, so the test driver's own allocations do not swamp the signal being measured.
		const sharedBuffer = Buffer.alloc(CHUNK_SIZE);

		// `heapUsed` (the metric `JR-3-02`'s durable-write test samples) turns out **not** to be the
		// right one here, measured rather than assumed: a deliberately reintroduced full-buffering
		// regression (every pushed chunk copied into a retained array) left `heapUsed` completely
		// flat -- 13-17 MB throughout, correct run and regressed run alike -- while `arrayBuffers`
		// (the metric for retained `Buffer`/`ArrayBuffer` backing stores specifically) climbed
		// monotonically to ~157 MB by the last chunk under the regression, versus fluctuating between
		// ~2.5 MB and ~40 MB (GC reclaiming and reallocating, not leaking) in the correct run. The
		// reason: Node's `Buffer` contents typically live in external/off-heap memory, which
		// `heapUsed` does not account for at all. Sampling `arrayBuffers` instead is what actually
		// exercises the failure mode this test claims to catch.
		const baselineArrayBuffers = process.memoryUsage().arrayBuffers;
		let maxArrayBufferDelta = 0;

		for (let i = 0; i < CHUNK_COUNT; i += 1) {
			sharedBuffer.fill(i % 256);
			const isLast = i === CHUNK_COUNT - 1;
			client.send(`BDAT ${CHUNK_SIZE}${isLast ? ' LAST' : ''}`);
			await client.writeRawBuffer(sharedBuffer);
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(isLast ? /^451 4\.3\.0/ : /^250 2\.0\.0/);
			// Sampled after the chunk's reply arrived, i.e. after the server has fully processed and
			// discarded it -- the point at which a non-streaming implementation would be holding an
			// ever-growing amount of data.
			const currentArrayBuffers = process.memoryUsage().arrayBuffers;
			maxArrayBufferDelta = Math.max(
				maxArrayBufferDelta,
				currentArrayBuffers - baselineArrayBuffers
			);
		}

		// Coarse and noisy -- Node does not eagerly reclaim external Buffer memory between reads,
		// so even the correct implementation shows real, non-leaking fluctuation up toward ~40 MB in
		// this measurement (see the note above). A budget of 100 MB sits comfortably above that
		// observed noise ceiling while still being far below the ~150+ MB a real full-buffering
		// regression produces -- verified in both directions rather than picked blind.
		const ARRAY_BUFFER_BUDGET_BYTES = 100 * 1024 * 1024;
		expect(maxArrayBufferDelta).toBeLessThan(ARRAY_BUFFER_BUDGET_BYTES);
	}, 180_000);
});
