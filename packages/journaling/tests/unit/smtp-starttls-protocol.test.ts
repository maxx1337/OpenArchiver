import { connect as connectTcp, type Socket } from 'node:net';
import * as tls from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';
import { suiteRequiring } from '@oa-test/classification';
import {
	EsmtpServer,
	type EsmtpServerOptions,
	type IngressLogger,
	type RequireTlsContext,
} from '../../src/ingress/smtp-server';
import { smtpServerConfigSchema } from '../../src/ingress/smtp-config';
import type { IngressTlsConfig } from '../../src/ingress/tls-config';
import { generateTestTlsCertificate, probeOpensslAvailable } from '../support/generate-test-tls-cert';

/**
 * `JR-4-04` -- `STARTTLS`, `require_tls`, the TLS >= 1.2 floor, and the session reset after a
 * handshake, proven over a real TCP connection with a real TLS handshake -- the same "wire-level
 * proof, not an options-object assertion" standard `JR-4-02`/`JR-4-03` already set in
 * `smtp-server-protocol.test.ts`, which this file follows directly (same `TestSmtpClient`-shaped
 * helper, same `unit`-despite-real-sockets classification).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this whole file is `suiteRequiring`, not `suite`
 * ---------------------------------------------------------------------------------------------
 * Every case here needs a real certificate/key pair, generated via the system `openssl` CLI (see
 * `tests/support/generate-test-tls-cert.ts` for why a checked-in key was rejected in favour of this).
 * A machine with no `openssl` on `PATH` cannot run these tests; `suiteRequiring` reports that
 * honestly (skip with a stated reason, or a loud failure under `OA_TEST_REQUIRE_INFRA=1`) rather than
 * silently reporting nothing. Measured present in this repository's own environment: `openssl 3.5.6`.
 *
 * ---------------------------------------------------------------------------------------------
 * TLS 1.1 rejection: what is, and is not, proven here
 * ---------------------------------------------------------------------------------------------
 * The Product Owner's instruction was to measure the *server's* `minVersion` setting, not the
 * client library's own limitations (the F43 lesson: a test that is green for the wrong reason proves
 * nothing). Measured directly against this repository's actual Node/OpenSSL build before writing
 * this suite: neither Node's own `tls.connect()` client nor the system `openssl s_client -tls1_1`
 * can produce a TLS 1.1 `ClientHello` at all in this environment -- both fail with
 * `"no protocols available"` *before any bytes reach the server*, and this holds even when the
 * *server's* `minVersion` is deliberately lowered to `'TLSv1.1'` in the same probe (i.e. the failure
 * is not this server rejecting a real attempt; no attempt can be constructed to reject). OpenSSL 3.x
 * disables the legacy protocol versions by default, and this environment has no legacy provider
 * enabled to re-enable them.
 *
 * Given that, an end-to-end "client offering only TLS 1.1 is refused" test is not constructible
 * honestly in this environment with the tools available -- writing one anyway would either not
 * compile (no client can offer TLS 1.1 to begin with) or silently test the client library instead of
 * the server, exactly the mistake F43 already made once. What **is** proven instead, honestly:
 *
 *   1. A unit-level proof, in `smtp-server.test.ts`, that `minVersion: TLS_MIN_VERSION`
 *      (`'TLSv1.2'`) is the exact value {@link SmtpConnection.beginTlsUpgrade} passes to
 *      `tls.TLSSocket` on every upgrade -- {@link buildTlsSocketOptions} is a small, pure, socket-free
 *      function extracted precisely so this is assertable directly, without spying on or
 *      re-implementing Node's own `tls.TLSSocket` constructor. Node's own TLS engine enforcing that
 *      value correctly is Node's own, independently-maintained and far more thoroughly tested
 *      behaviour, not something this project could usefully re-verify at the protocol level here.
 *   2. A positive proof, right here, that TLS 1.2 and TLS 1.3 handshakes -- the versions this
 *      environment's client tooling *can* actually offer -- succeed end-to-end through `STARTTLS`.
 *
 * `JR-4-14`/`JR-4-15` (later E4 tasks) are where a from-scratch, byte-level `ClientHello` -- bypassing
 * every OS/library protocol restriction -- could still give an end-to-end TLS-1.1-rejection proof, if
 * that is judged worth the engineering cost; not attempted here.
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

/** A recording logger -- for the tests that must observe what `EsmtpServer` logged (the negotiated
 * TLS version/cipher, the discarded-pipelined-bytes warning) since neither is ever sent over the
 * wire. */
class RecordingLogger implements IngressLogger {
	readonly infoCalls: Array<{ fields: Record<string, unknown>; message: string }> = [];
	readonly warnCalls: Array<{ fields: Record<string, unknown>; message: string }> = [];
	debug(): void {}
	info(fields: Record<string, unknown>, message: string): void {
		this.infoCalls.push({ fields, message });
	}
	warn(fields: Record<string, unknown>, message: string): void {
		this.warnCalls.push({ fields, message });
	}
	error(): void {}
}

interface StartedServer {
	readonly server: EsmtpServer;
	readonly port: number;
}

async function startServer(
	options: {
		smtpOverrides?: Record<string, unknown>;
		tls?: Partial<IngressTlsConfig>;
		logger?: IngressLogger;
		requireTlsResolver?: (context: RequireTlsContext) => boolean;
	} = {}
): Promise<StartedServer> {
	const smtp = smtpServerConfigSchema.parse(options.smtpOverrides ?? {});
	const serverOptions: EsmtpServerOptions = {
		smtp,
		tls: options.tls as IngressTlsConfig | undefined,
		logger: options.logger ?? silentLogger,
		requireTlsResolver: options.requireTlsResolver,
	};
	const server = new EsmtpServer(serverOptions);
	openServers.push(server);
	await server.listen(0, '127.0.0.1');
	const address = server.address;
	if (address === null) {
		throw new Error('server did not bind');
	}
	return { server, port: address.port };
}

/** Same shape as `smtp-server-protocol.test.ts`'s `TestSmtpClient`, extended with a `startTls()`
 * method that upgrades the *same* underlying TCP connection to TLS -- `tls.connect({ socket })` over
 * an already-connected plain socket is the client-side half of `STARTTLS`, exactly mirroring what a
 * real MTA does. After `startTls()`, `send`/`writeRaw`/`nextReply` all operate transparently over the
 * encrypted channel; the class does not need to know which layer it is currently talking through. */
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
	private activeSocket: Socket;

	constructor(private readonly plainSocket: Socket) {
		this.activeSocket = plainSocket;
		this.attach(plainSocket);
	}

	private attach(socket: Socket): void {
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
		this.activeSocket.write(`${line}\r\n`);
	}

	writeRaw(text: string): void {
		this.activeSocket.write(text);
	}

	/**
	 * Upgrade this connection to TLS in place, the client-side half of `STARTTLS`. Resolves once the
	 * handshake completes; from then on every `send`/`writeRaw`/`onData` goes through the returned
	 * `tls.TLSSocket` instead of the plain one -- the real client-side proof that this server's
	 * `STARTTLS` produces a genuinely usable encrypted channel, not just a `220` reply.
	 */
	startTls(): Promise<tls.TLSSocket> {
		return new Promise((resolve, reject) => {
			// Mirror the server side (`beginTlsUpgrade`'s `removeAllListeners`): once the handshake
			// starts, every byte on the wire is TLS traffic, and this class's own plaintext line
			// parser must not compete with Node's TLS engine for the same 'data' events.
			this.plainSocket.removeAllListeners('data');
			this.plainSocket.removeAllListeners('close');
			const secure = tls.connect(
				{ socket: this.plainSocket, rejectUnauthorized: false, minVersion: 'TLSv1.2' },
				() => {
					this.activeSocket = secure;
					this.attach(secure);
					resolve(secure);
				}
			);
			secure.once('error', reject);
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

const infraRequirement = probeOpensslAvailable();

suiteRequiring('ci', 'EsmtpServer STARTTLS over the wire (JR-4-04)', infraRequirement, () => {
	it('EHLO does not advertise STARTTLS when no certificate is configured', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		const reply = await client.nextReply();
		expect(reply.join('\n')).not.toContain('STARTTLS');
	});

	it('a bare STARTTLS with no certificate configured is answered 454 4.7.0', async () => {
		const { port } = await startServer();
		const client = await connectClient(port);
		await client.nextReply();
		client.send('STARTTLS');
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^454 4\.7\.0/);
	});

	it('EHLO advertises STARTTLS once a certificate is configured, and stops after the handshake', async () => {
		const { cert, key } = generateTestTlsCertificate();
		const { port } = await startServer({ tls: { cert, key } });
		const client = await connectClient(port);
		await client.nextReply();

		client.send('EHLO client.example.com');
		const beforeHandshake = await client.nextReply();
		expect(beforeHandshake.join('\n')).toContain('STARTTLS');

		client.send('STARTTLS');
		const starttlsReply = await client.nextReply();
		expect(starttlsReply[0]).toMatch(/^220 /);
		await client.startTls();

		client.send('EHLO client.example.com');
		const afterHandshake = await client.nextReply();
		expect(afterHandshake.join('\n')).not.toContain('STARTTLS');
	});

	it('STARTTLS with parameters is a syntax error (501 5.5.4)', async () => {
		const { cert, key } = generateTestTlsCertificate();
		const { port } = await startServer({ tls: { cert, key } });
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		client.send('STARTTLS with-a-parameter');
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^501 5\.5\.4/);
	});

	it('a second STARTTLS after a completed handshake is refused (503)', async () => {
		const { cert, key } = generateTestTlsCertificate();
		const { port } = await startServer({ tls: { cert, key } });
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		client.send('STARTTLS');
		await client.nextReply();
		await client.startTls();

		client.send('STARTTLS');
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^503 /);
	});

	it('the negotiated TLS version and cipher are read from the real handshake and logged, ready for JR-4-06', async () => {
		const { cert, key } = generateTestTlsCertificate();
		const logger = new RecordingLogger();
		const { port } = await startServer({ tls: { cert, key }, logger });
		const client = await connectClient(port);
		await client.nextReply();
		client.send('EHLO client.example.com');
		await client.nextReply();
		client.send('STARTTLS');
		await client.nextReply();
		const secureSocket = await client.startTls();

		// Give the server's own 'secure' handler (fired independently of the client's) a moment to run.
		await new Promise((resolve) => setTimeout(resolve, 50));

		const completion = logger.infoCalls.find((c) => c.message.includes('handshake complete'));
		expect(completion).toBeDefined();
		expect(completion!.fields.tlsVersion).toMatch(/^TLSv1\.[23]$/);
		expect(typeof completion!.fields.tlsCipher).toBe('string');
		expect(completion!.fields.tlsVersion).toBe(secureSocket.getProtocol());
	});

	describe('require_tls gate (JR-4-04)', () => {
		it('a plaintext session is refused with 530 5.7.0 on MAIL when require_tls is on', async () => {
			const { cert, key } = generateTestTlsCertificate();
			const { port } = await startServer({ tls: { cert, key, requireTls: true } });
			const client = await connectClient(port);
			await client.nextReply();
			client.send('EHLO client.example.com');
			await client.nextReply();
			client.send('MAIL FROM:<a@example.com>');
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^530 5\.7\.0/);
		});

		it.each(['RCPT TO:<b@example.com>', 'DATA', 'BDAT 10', 'RSET', 'AUTH PLAIN'])(
			'%s is also refused with 530 5.7.0 when require_tls is on and TLS is not active',
			async (command) => {
				const { cert, key } = generateTestTlsCertificate();
				const { port } = await startServer({ tls: { cert, key, requireTls: true } });
				const client = await connectClient(port);
				await client.nextReply();
				client.send('EHLO client.example.com');
				await client.nextReply();
				client.send(command);
				const reply = await client.nextReply();
				expect(reply[0]).toMatch(/^530 5\.7\.0/);
			}
		);

		it.each(['EHLO client.example.com', 'HELO client.example.com', 'NOOP', 'STARTTLS'])(
			'%s still works in plaintext when require_tls is on',
			async (command) => {
				const { cert, key } = generateTestTlsCertificate();
				const { port } = await startServer({ tls: { cert, key, requireTls: true } });
				const client = await connectClient(port);
				await client.nextReply();
				client.send(command);
				const reply = await client.nextReply();
				expect(reply[0]).not.toMatch(/^530/);
			}
		);

		it('QUIT still works in plaintext when require_tls is on', async () => {
			const { cert, key } = generateTestTlsCertificate();
			const { port } = await startServer({ tls: { cert, key, requireTls: true } });
			const client = await connectClient(port);
			await client.nextReply();
			client.send('QUIT');
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^221 2\.0\.0/);
		});

		it('MAIL/RCPT/DATA proceed normally once TLS is active, ending 451 as usual (JR-4-06 not yet wired)', async () => {
			const { cert, key } = generateTestTlsCertificate();
			const { port } = await startServer({ tls: { cert, key, requireTls: true } });
			const client = await connectClient(port);
			await client.nextReply();
			client.send('EHLO client.example.com');
			await client.nextReply();
			client.send('STARTTLS');
			await client.nextReply();
			await client.startTls();

			client.send('EHLO client.example.com');
			await client.nextReply();
			client.send('MAIL FROM:<a@example.com>');
			expect((await client.nextReply())[0]).toMatch(/^250 2\.1\.0/);
			client.send('RCPT TO:<b@example.com>');
			expect((await client.nextReply())[0]).toMatch(/^250 2\.1\.5/);
			client.send('DATA');
			expect((await client.nextReply())[0]).toMatch(/^354 /);
			client.writeRaw('Subject: test\r\n\r\nhello\r\n.\r\n');
			expect((await client.nextReply())[0]).toMatch(/^451 4\.3\.0/);
		});

		it('a source-tightening resolver can require TLS even when the process default is false (JR-4-05 seam)', async () => {
			const { cert, key } = generateTestTlsCertificate();
			// Process default is false; the injected resolver tightens it -- proving the seam
			// JR-4-05 will use, and the "tighten" direction specifically.
			const { port } = await startServer({
				tls: { cert, key, requireTls: false },
				requireTlsResolver: () => true,
			});
			const client = await connectClient(port);
			await client.nextReply();
			client.send('EHLO client.example.com');
			await client.nextReply();
			client.send('MAIL FROM:<a@example.com>');
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^530 5\.7\.0/);
		});
	});

	describe('session reset after STARTTLS (JR-4-04, RFC 3207 section 4.2)', () => {
		it('MAIL immediately after the handshake, with no fresh EHLO, is a bad sequence (503) -- the envelope/state did not survive', async () => {
			const { cert, key } = generateTestTlsCertificate();
			const { port } = await startServer({ tls: { cert, key } });
			const client = await connectClient(port);
			await client.nextReply();
			client.send('EHLO client.example.com');
			await client.nextReply();
			client.send('MAIL FROM:<pre-handshake@example.com>');
			await client.nextReply();

			client.send('STARTTLS');
			await client.nextReply();
			await client.startTls();

			// No EHLO re-issued after the handshake -- RFC 3207 requires the client to, and this
			// proves the server-side half: state was reset to 'initial', not left at 'mail'/'ready'.
			client.send('MAIL FROM:<post-handshake@example.com>');
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^503 /);
		});
	});

	describe(
		'STARTTLS pipelined-bytes discard (JR-4-04, the STARTTLS command-injection class, companion to F44/JR-4-16)',
		() => {
			it('bytes sent in the same segment as STARTTLS are discarded, never answered, before or after the handshake', async () => {
				const { cert, key } = generateTestTlsCertificate();
				const { port } = await startServer({ tls: { cert, key } });
				const client = await connectClient(port);
				await client.nextReply();
				client.send('EHLO client.example.com');
				await client.nextReply();

				// A non-conformant client, or an on-path attacker, sending a command right after
				// STARTTLS in the very same TCP segment -- RFC 2920 forbids this precisely because the
				// client cannot know whether the handshake will succeed.
				client.writeRaw(
					'STARTTLS\r\nMAIL FROM:<attacker@evil.invalid>\r\nRCPT TO:<j@example.com>\r\n'
				);

				// Exactly one reply arrives in plaintext -- the 220 for STARTTLS. If the smuggled
				// MAIL/RCPT had been processed (the pre-fix behaviour this test guards against), a
				// second plaintext reply would already be sitting here before the handshake even starts.
				const starttlsReply = await client.nextReply();
				expect(starttlsReply[0]).toMatch(/^220 /);
				await expect(client.nextReply(300)).rejects.toThrow(/no SMTP reply/);

				await client.startTls();

				// No unsolicited reply arrives after the handshake either -- the smuggled bytes were
				// discarded, not queued up to be answered once the connection became secure.
				await expect(client.nextReply(300)).rejects.toThrow(/no SMTP reply/);

				// The connection is fully usable afterward: a real EHLO/MAIL over the encrypted channel
				// gets the ordinary replies, proving this was a targeted discard, not a broken connection.
				client.send('EHLO client.example.com');
				await client.nextReply();
				client.send('MAIL FROM:<real@example.com>');
				const reply = await client.nextReply();
				expect(reply[0]).toMatch(/^250 2\.1\.0/);
			});
		}
	);
});
