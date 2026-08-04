import { connect as connectTcp, type Socket } from 'node:net';
import * as tls from 'node:tls';
import { afterEach, expect, it } from 'vitest';
import { suiteRequiring } from '@oa-test/classification';
import {
	EsmtpServer,
	type EsmtpServerOptions,
	type IngressLogger,
} from '../../src/ingress/smtp-server';
import { smtpServerConfigSchema } from '../../src/ingress/smtp-config';
import type { IngressTlsConfig } from '../../src/ingress/tls-config';
import {
	generateTestTlsCertificate,
	probeOpensslAvailable,
} from '../support/generate-test-tls-cert';

/**
 * `JR-4-14` -- the TLS 1.1 rejection proof `JR-4-04` explicitly could not construct honestly and
 * handed forward (see that task's own status entry and `smtp-starttls-protocol.test.ts`'s module doc
 * comment, "TLS 1.1 rejection: what is, and is not, proven here"). Neither Node's own `tls.connect()`
 * nor the system `openssl s_client -tls1_1` can produce a TLS 1.1 `ClientHello` in this environment --
 * both refuse before a single byte reaches the server, even against a server deliberately configured
 * with a lowered `minVersion`. That rules out every *client library* as the source of the ClientHello.
 *
 * This file is not a TLS client. It is a script that writes the exact bytes RFC 8446/RFC 5246's wire
 * format defines for a TLS 1.1 `ClientHello` directly onto the raw socket, bypassing every client-side
 * protocol-version restriction there is nothing else to route around. What is measured is the
 * *server's* reaction -- `buildTlsSocketOptions()`'s `minVersion: TLS_MIN_VERSION` (`'TLSv1.2'`,
 * `tls-config.ts`), the exact same call `beginTlsUpgrade()` makes for a real client -- to a real,
 * syntactically valid ClientHello that happens to declare `client_version = TLS 1.1`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this is safe to trust as "the server", not "a lucky decode"
 * ---------------------------------------------------------------------------------------------
 * `beginTlsUpgrade()` wraps the *same* underlying `net.Socket` STARTTLS already upgraded in a real
 * `tls.TLSSocket({ isServer: true, secureContext, minVersion: 'TLSv1.2' })` -- see `smtp-server.ts`
 * and `buildTlsSocketOptions()`. The bytes this file sends after the `220` STARTTLS reply are read by
 * that exact object, through the exact same code path a real MTA's TLS 1.1 attempt would take. There
 * is no separate "TLS 1.1 test mode" anywhere in the receive path for this to accidentally exercise.
 *
 * ---------------------------------------------------------------------------------------------
 * Calibrated, with an honest result: the rejection is real, but not provably caused by this
 * project's own `TLS_MIN_VERSION` constant in this environment
 * ---------------------------------------------------------------------------------------------
 * Temporarily changed `TLS_MIN_VERSION` in `tls-config.ts` from `'TLSv1.2'` to `'TLSv1.1'` and reran
 * this file: both cases stayed **green** -- the hand-built ClientHello was still answered with the
 * same fatal `protocol_version` alert. That is the honest, measured result, not a shortcoming of the
 * calibration attempt: this repository's OpenSSL build (3.5.6, per `smtp-starttls-protocol.test.ts`'s
 * own note) has TLS 1.0/1.1 disabled at the library level, and Node's `minVersion` option can only
 * *raise* the effective floor above whatever OpenSSL itself will still negotiate, never lower it back
 * down to something OpenSSL has already disabled. Change reverted immediately afterward (`git diff`
 * against `tls-config.ts` shows no difference).
 *
 * What this means for the acceptance criterion: "TLS 1.1 wird abgelehnt" is proven true, end to end,
 * in this environment -- that is what the two cases below measure and what passes. What is **not**
 * established is that `TLS_MIN_VERSION = 'TLSv1.2'` is *why* -- in this OpenSSL build, the rejection
 * would very likely survive that constant being set to almost anything, because the layer doing the
 * actual refusing sits below it. On a hypothetical deployment built against an OpenSSL that still
 * supports TLS 1.1 (a legacy-provider build, or an older OpenSSL 1.1.x), the `minVersion` setting
 * would become the operative control, and only then would a regression to a lower value be
 * catchable by a test running on *that* build. Recorded here rather than left implicit, per the
 * tester role's instruction to distinguish "erbracht" from "erbracht, aber aus einem anderen Grund
 * als behauptet".
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

async function startServer(tlsConfig: Partial<IngressTlsConfig>): Promise<StartedServer> {
	const smtp = smtpServerConfigSchema.parse({});
	const serverOptions: EsmtpServerOptions = {
		smtp,
		tls: tlsConfig as IngressTlsConfig,
		logger: silentLogger,
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

/** Read plaintext SMTP replies line by line -- used only for the `EHLO`/`STARTTLS` dance before the
 * raw TLS bytes take over. Deliberately minimal: once the handshake attempt starts, nothing here
 * parses lines again, the same "one parser per layer, never both at once" discipline
 * `smtp-starttls-protocol.test.ts`'s `TestSmtpClient.startTls()` already follows for the real
 * handshake case. */
class PlaintextReader {
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

	nextReply(timeoutMs = 2_000): Promise<string[]> {
		const ready = this.readyReplies.shift();
		if (ready) return Promise.resolve(ready);
		return new Promise<string[]>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`no SMTP reply within ${timeoutMs}ms`)),
				timeoutMs
			);
			this.waiters.push({ resolve, timer });
		});
	}

	/** Stop parsing plaintext lines -- the next bytes are TLS record layer, not SMTP. */
	detach(): void {
		this.socket.removeAllListeners('data');
	}
}

async function connectAndStartTls(port: number): Promise<Socket> {
	const socket = connectTcp(port, '127.0.0.1');
	openSockets.push(socket);
	await new Promise<void>((resolve, reject) => {
		socket.once('connect', () => resolve());
		socket.once('error', reject);
	});
	const reader = new PlaintextReader(socket);
	await reader.nextReply(); // 220 greeting
	reader.send('EHLO client.example.com');
	await reader.nextReply();
	reader.send('STARTTLS');
	const starttlsReply = await reader.nextReply();
	expect(starttlsReply[0]).toMatch(/^220 /);
	reader.detach();
	return socket;
}

/**
 * Build the exact bytes of a minimal, syntactically valid TLS 1.1 `ClientHello`
 * (RFC 5246 section 7.4.1.2 / TLS record layer RFC 5246 section 6.2), old-style (no
 * `supported_versions` extension -- that extension postdates TLS 1.1 and its absence is what makes
 * `client_version` the version signal a server must go by). `cipherSuites` is a list of 2-byte
 * arrays; a handful of TLS-1.0/1.1-era RSA/ECDHE suites are used by the caller so that, if a server
 * ever did accept the declared version, there would be a shared cipher to complete a handshake with
 * -- this ClientHello is not rejected for want of a matching cipher.
 */
function buildTls11ClientHello(cipherSuites: readonly (readonly [number, number])[]): Buffer {
	const random = Buffer.alloc(32, 0x42);
	const sessionId = Buffer.alloc(0);
	const cipherBytes = Buffer.concat(cipherSuites.map((c) => Buffer.from(c)));
	const compressionMethods = Buffer.from([0x00]); // null compression
	const extensions = Buffer.alloc(0); // no extensions, deliberately -- see this function's doc comment

	const body = Buffer.concat([
		Buffer.from([0x03, 0x02]), // client_version: { 3, 2 } = TLS 1.1
		random,
		Buffer.from([sessionId.length]),
		sessionId,
		Buffer.from([(cipherBytes.length >> 8) & 0xff, cipherBytes.length & 0xff]),
		cipherBytes,
		Buffer.from([compressionMethods.length]),
		compressionMethods,
		Buffer.from([(extensions.length >> 8) & 0xff, extensions.length & 0xff]),
		extensions,
	]);

	const handshake = Buffer.concat([
		Buffer.from([0x01]), // HandshakeType.client_hello
		Buffer.from([(body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff]),
		body,
	]);

	return Buffer.concat([
		Buffer.from([0x16]), // ContentType.handshake
		Buffer.from([0x03, 0x02]), // record-layer version: TLS 1.1
		Buffer.from([(handshake.length >> 8) & 0xff, handshake.length & 0xff]),
		handshake,
	]);
}

const TLS_1_1_CIPHER_SUITES: readonly (readonly [number, number])[] = [
	[0x00, 0x2f], // TLS_RSA_WITH_AES_128_CBC_SHA
	[0x00, 0x35], // TLS_RSA_WITH_AES_256_CBC_SHA
	[0x00, 0x0a], // TLS_RSA_WITH_3DES_EDE_CBC_SHA
	[0xc0, 0x13], // TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA
];

/** TLS record `ContentType` values (RFC 5246 section 6.2.1), for describing what came back. */
const CONTENT_TYPE_ALERT = 21;
const CONTENT_TYPE_HANDSHAKE = 22;
/** `AlertDescription.protocol_version` (RFC 5246 section 7.2.2). */
const ALERT_PROTOCOL_VERSION = 70;
/** `HandshakeType.server_hello` (RFC 5246 section 7.4). */
const HANDSHAKE_TYPE_SERVER_HELLO = 2;

const infraRequirement = probeOpensslAvailable();

suiteRequiring(
	'ci',
	'STARTTLS rejects a hand-built TLS 1.1 ClientHello (JR-4-14, TLS floor carried over from JR-4-04)',
	infraRequirement,
	() => {
		it('a syntactically valid TLS 1.1 ClientHello, sent byte-for-byte after STARTTLS, is answered with a fatal protocol_version alert -- never a ServerHello', async () => {
			const { cert, key } = generateTestTlsCertificate();
			const { port } = await startServer({ cert, key });
			const socket = await connectAndStartTls(port);

			const received: Buffer[] = [];
			let socketClosed = false;
			socket.on('data', (chunk: Buffer) => received.push(chunk));
			socket.on('close', () => {
				socketClosed = true;
			});

			socket.write(buildTls11ClientHello(TLS_1_1_CIPHER_SUITES));

			// Give the server's real tls.TLSSocket time to parse the ClientHello and react -- this is
			// the same object beginTlsUpgrade() constructs for a real client, reading real bytes.
			await new Promise((resolve) => setTimeout(resolve, 500));

			const response = Buffer.concat(received);
			expect(response.length).toBeGreaterThan(0);

			const contentType = response[0];
			// Decisive: never a ServerHello. A negotiated handshake here would mean minVersion did not
			// hold against a byte-level attempt, which is exactly what this test exists to rule out.
			const isServerHello =
				contentType === CONTENT_TYPE_HANDSHAKE &&
				response.length >= 6 &&
				response[5] === HANDSHAKE_TYPE_SERVER_HELLO;
			expect(isServerHello).toBe(false);

			// The measured, specific rejection: a fatal TLS alert naming protocol_version.
			expect(contentType).toBe(CONTENT_TYPE_ALERT);
			const alertLevel = response[5];
			const alertDescription = response[6];
			expect(alertLevel).toBe(2); // AlertLevel.fatal
			expect(alertDescription).toBe(ALERT_PROTOCOL_VERSION);

			socket.destroy();
			await new Promise((resolve) => setTimeout(resolve, 50));
			// Not asserted strictly (a fatal alert is sometimes followed by an immediate FIN and
			// sometimes the destroy() above races it) -- recorded for the report, not for pass/fail.
			void socketClosed;
		});

		it('the same process still completes a normal TLS 1.2 handshake through STARTTLS afterward', async () => {
			const { cert, key } = generateTestTlsCertificate();
			const { port } = await startServer({ cert, key });

			// First, the hostile attempt, exactly as the case above.
			const hostileSocket = await connectAndStartTls(port);
			hostileSocket.write(buildTls11ClientHello(TLS_1_1_CIPHER_SUITES));
			await new Promise((resolve) => setTimeout(resolve, 300));
			hostileSocket.destroy();

			// Then a fresh, real connection with a real, compliant TLS client.
			const plainSocket = connectTcp(port, '127.0.0.1');
			openSockets.push(plainSocket);
			await new Promise<void>((resolve, reject) => {
				plainSocket.once('connect', () => resolve());
				plainSocket.once('error', reject);
			});
			const reader = new PlaintextReader(plainSocket);
			await reader.nextReply();
			reader.send('EHLO client.example.com');
			await reader.nextReply();
			reader.send('STARTTLS');
			expect((await reader.nextReply())[0]).toMatch(/^220 /);
			reader.detach();

			const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
				const s = tls.connect(
					{ socket: plainSocket, rejectUnauthorized: false, minVersion: 'TLSv1.2' },
					() => resolve(s)
				);
				s.once('error', reject);
			});
			expect(secure.getProtocol()).toMatch(/^TLSv1\.[23]$/);
			secure.destroy();
		});
	}
);
