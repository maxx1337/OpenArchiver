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
 * `JR-4-21a` -- finding F56: `buildTlsSocketOptions()` used to set only `minVersion`, so cipher
 * selection under TLS 1.2 fell through to Node/OpenSSL's own default list, which a **client** could
 * narrow to something with no forward secrecy (`AES128-SHA`) and the server would not object. This
 * file proves the fix -- `TLS_CIPHERS` (`tls-config.ts`) -- end to end, over a real `STARTTLS`
 * handshake, the same "wire-level proof, not an options-object assertion" standard
 * `smtp-starttls-protocol.test.ts` and `smtp-tls11-clienthello-rejection.test.ts` already set for TLS
 * in this package. `smtp-server.test.ts`'s `buildTlsSocketOptions` suite covers the options-object
 * level (`ciphers`/`honorCipherOrder` forwarded unchanged); this file covers what Node's own TLS
 * engine actually does with them against a real peer.
 *
 * ---------------------------------------------------------------------------------------------
 * Why `suiteRequiring`, not `suite`
 * ---------------------------------------------------------------------------------------------
 * Same reason as `smtp-starttls-protocol.test.ts`: every case needs a real certificate/key pair
 * generated via the system `openssl` CLI.
 *
 * ---------------------------------------------------------------------------------------------
 * TLS 1.3 is deliberately not narrowed here, and this file proves that too
 * ---------------------------------------------------------------------------------------------
 * `ciphers` (an OpenSSL cipher-list string) governs TLS 1.2 and below only; TLS 1.3 negotiates its
 * own always-forward-secret, always-AEAD suite set independently of it. The third case below pins a
 * TLS 1.3 handshake through the same server, with the same `ciphers` option in effect, to prove the
 * F56 fix did not accidentally affect the version it was never meant to touch -- `JR-4-04`'s own
 * TLS 1.2 **and** 1.3 end-to-end coverage (`smtp-starttls-protocol.test.ts`) must stay green
 * alongside this file, unchanged.
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

/** Same minimal plaintext-reply reader `smtp-tls11-clienthello-rejection.test.ts` uses, up to the
 * point `STARTTLS` hands the socket to a real `tls.TLSSocket`. */
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

const infraRequirement = probeOpensslAvailable();

suiteRequiring(
	'ci',
	'STARTTLS cipher selection under TLS 1.2 (JR-4-21a, F56)',
	infraRequirement,
	() => {
		it('a client offering only AES128-SHA (no forward secrecy, SHA-1 MAC) is refused the handshake, not negotiated', async () => {
			const { cert, key } = generateTestTlsCertificate();
			const { port } = await startServer({ cert, key });
			const plainSocket = await connectAndStartTls(port);

			const handshake = new Promise<never>((resolve, reject) => {
				const secure = tls.connect(
					{
						socket: plainSocket,
						rejectUnauthorized: false,
						minVersion: 'TLSv1.2',
						maxVersion: 'TLSv1.2',
						ciphers: 'AES128-SHA',
					},
					() => reject(new Error('handshake unexpectedly succeeded with AES128-SHA'))
				);
				secure.once('error', (err) => reject(err));
			});

			// Before the fix (F56), this negotiated AES128-SHA without objection -- the measured
			// finding. After the fix, the server has no cipher in common with a client that only offers
			// a non-forward-secret suite, so OpenSSL fails the handshake on both sides.
			await expect(handshake).rejects.toThrow();
		});

		it('an ordinary client (no cipher restriction of its own) still negotiates a forward-secret, AEAD cipher under TLS 1.2', async () => {
			const { cert, key } = generateTestTlsCertificate();
			const { port } = await startServer({ cert, key });
			const plainSocket = await connectAndStartTls(port);

			const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
				const s = tls.connect(
					{
						socket: plainSocket,
						rejectUnauthorized: false,
						minVersion: 'TLSv1.2',
						maxVersion: 'TLSv1.2',
					},
					() => resolve(s)
				);
				s.once('error', reject);
			});
			expect(secure.getProtocol()).toBe('TLSv1.2');
			const cipherName = secure.getCipher().name;
			// Forward-secret (ECDHE/DHE) and AEAD (GCM/ChaCha20-Poly1305) -- never a CBC/SHA-1 suite,
			// never plain RSA key exchange. The exact normal-case expectation this finding's own
			// "Warum das mehr als ein Format-Detail" section names: ECDHE-RSA-AES128-GCM-SHA256 must
			// keep working, so real senders (Exchange Online included) are not locked out.
			expect(cipherName).toMatch(/^(?:ECDHE|DHE)-/);
			expect(cipherName).toMatch(/GCM|CHACHA20-POLY1305/);
			secure.destroy();
		});

		it('a TLS 1.3 handshake is unaffected by the TLS <= 1.2 cipher allow-list', async () => {
			const { cert, key } = generateTestTlsCertificate();
			const { port } = await startServer({ cert, key });
			const plainSocket = await connectAndStartTls(port);

			const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
				const s = tls.connect(
					{ socket: plainSocket, rejectUnauthorized: false, minVersion: 'TLSv1.3' },
					() => resolve(s)
				);
				s.once('error', reject);
			});
			expect(secure.getProtocol()).toBe('TLSv1.3');
			secure.destroy();
		});
	}
);
