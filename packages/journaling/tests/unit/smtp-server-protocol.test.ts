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
