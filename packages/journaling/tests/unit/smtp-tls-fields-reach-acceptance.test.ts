import { connect as connectTcp, type Socket } from 'node:net';
import * as tls from 'node:tls';
import { afterEach, expect, it } from 'vitest';
import { suiteRequiring } from '@oa-test/classification';
import {
	EsmtpServer,
	type EsmtpServerOptions,
	type IngressLogger,
	type JournalAcceptancePort,
	type RecipientAclEvaluator,
} from '../../src/ingress/smtp-server';
import { smtpServerConfigSchema } from '../../src/ingress/smtp-config';
import type { IngressTlsConfig } from '../../src/ingress/tls-config';
import type { JournalAcceptanceResult, JournalTransactionInput } from '../../src/spool/acceptance';
import {
	generateTestTlsCertificate,
	probeOpensslAvailable,
} from '../support/generate-test-tls-cert';

/**
 * `JR-4-13` acceptance follow-up (Auflage 1) -- the negotiated TLS version/cipher of a *real*
 * `STARTTLS` handshake, read back from the *client* side (`secureSocket.getProtocol()`/
 * `getCipher()`), compared against the fields `JournalAcceptancePort.accept()` actually receives
 * for that same transaction (`tryBeginAcceptance()`, `smtp-server.ts`).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this file exists -- the three escape routes the acceptance review found and closed
 * ---------------------------------------------------------------------------------------------
 * Before this file, nothing closed the loop between "TLS negotiated" and "TLS recorded":
 *
 *   - `smtp-starttls-protocol.test.ts`'s "the negotiated TLS version and cipher are read from the
 *     real handshake and logged, ready for JR-4-06" test checks a **log line** through a
 *     `RecordingLogger`, not the `accept()` call.
 *   - `journal-acceptance-bare-client.int.test.ts` builds a `LedgerAppendRequest` with a
 *     **hardcoded** `tlsVersion: 'TLSv1.3'` literal -- no real handshake anywhere near it.
 *   - `smtp-acceptance-wiring.test.ts` and `smtp-response-code-table.test.ts` (the two files that
 *     do inspect `JournalAcceptancePort.accept()`'s actual input) never configure `tls` at all --
 *     every one of their transactions is plaintext.
 *
 * None of the three is wrong for what it sets out to prove; together they leave exactly the gap
 * F46 already demonstrated once for a *different* pair of fields: a value can be correct in the
 * source, asserted nowhere against the wire, and still regress silently. This file is the missing
 * proof, built the same way `source-acl-cache-wiring.test.ts` closed F46 -- against the real,
 * production-shaped object graph (a real `EsmtpServer`, constructed with `journalAcceptance` from
 * the start, exactly as `apps/smtp-ingress/src/index.ts` does), not a hand-written stand-in for the
 * field in question.
 *
 * ---------------------------------------------------------------------------------------------
 * Why `suiteRequiring`, not `suite` -- and why a failed handshake must fail the suite, not skip it
 * ---------------------------------------------------------------------------------------------
 * `generateTestTlsCertificate()` shells out to the system `openssl` CLI (see
 * `tests/support/generate-test-tls-cert.ts`); a host without it cannot run this file, and
 * `suiteRequiring` reports that honestly instead of quietly matching nothing. Once inside the
 * suite, though, nothing here is allowed to turn a failed or skipped handshake into a passing
 * assertion the way the F48 CI outage did (fourteen slices of "no response, then a kill" reported
 * as green because the branch that mattered was never taken): `client.startTls()` below is called
 * with **no** surrounding `try`/`catch` -- a broken handshake throws, and an uncaught throw inside
 * `it()` fails the test, not a silently-skipped assertion. The sanity checks before the real
 * comparison (`getProtocol()` matches `TLSv1.[23]`, `getCipher()?.name` is a non-empty string, and
 * `acceptance.calls` has exactly one entry) exist so that a future refactor which leaves both sides
 * of the comparison `null`/`undefined` fails loudly instead of passing by coincidence.
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

const RCPT_ADDRESS = 'journal@example.com';

const fixedRecipientAcl: RecipientAclEvaluator = {
	evaluateRecipient: () => ({
		kind: 'allowed',
		sourceId: 'tls-fields-source',
		chainScopeId: 'tls-fields-chain',
	}),
};

/** Records every `JournalTransactionInput` `accept()` is actually called with -- the same shape
 * `smtp-response-code-table.test.ts`'s `fakeAcceptance` uses, duplicated rather than imported: this
 * project's own convention (that file's own module doc comment) is that each test file is
 * self-contained rather than sharing fixtures across files. */
function fakeAcceptance(): JournalAcceptancePort & { readonly calls: JournalTransactionInput[] } {
	const calls: JournalTransactionInput[] = [];
	const result: JournalAcceptanceResult = {
		kind: 'accepted',
		spoolTxId: 'tls-fields-tx',
		seq: 1n,
		chainHash: Buffer.alloc(32, 7),
	};
	return {
		calls,
		async accept(input: JournalTransactionInput): Promise<JournalAcceptanceResult> {
			calls.push(input);
			for await (const _chunk of input.chunks) {
				// Drained, not inspected -- this file is about the envelope-level fields, not the
				// body. See smtp-acceptance-wiring.test.ts's fakeAcceptance for why draining is
				// required (finalizeAcceptance's bridge.end() would otherwise hang waiting for a
				// reader).
			}
			return result;
		},
	};
}

interface StartedServer {
	readonly server: EsmtpServer;
	readonly port: number;
}

/** `journalAcceptance` is constructor-only on `EsmtpServerOptions`, matching production
 * (`apps/smtp-ingress/src/index.ts` builds it once, before `new EsmtpServer(...)`) -- so it has to
 * be supplied here from the start, never attached after the fact. */
async function startServer(
	tlsConfig: Partial<IngressTlsConfig>,
	journalAcceptance: JournalAcceptancePort
): Promise<StartedServer> {
	const smtp = smtpServerConfigSchema.parse({});
	const options: EsmtpServerOptions = {
		smtp,
		tls: tlsConfig as IngressTlsConfig,
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

/** Same shape as `smtp-starttls-protocol.test.ts`'s `TestSmtpClient` -- a buffered, "check the
 * ready-queue before waiting for a new event" line/reply reader that transparently keeps working
 * once `startTls()` re-points it at the upgraded socket. Duplicated rather than imported for the
 * same self-containment reason `fakeAcceptance` above is. */
class TestSmtpClient {
	private raw = '';
	private currentReplyLines: string[] = [];
	private readonly readyReplies: string[][] = [];
	private readonly waiters: Array<{
		resolve: (lines: string[]) => void;
		reject: (err: Error) => void;
		timer: NodeJS.Timeout;
	}> = [];
	private activeSocket: Socket;

	constructor(private readonly plainSocket: Socket) {
		this.activeSocket = plainSocket;
		this.attach(plainSocket);
	}

	private attach(socket: Socket): void {
		socket.on('data', (chunk: Buffer) => this.onData(chunk));
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

	/** The client-side half of `STARTTLS`: upgrades this connection to TLS in place. No `try`/`catch`
	 * anywhere this is called below -- a handshake failure must fail the test (module doc comment). */
	startTls(options: tls.ConnectionOptions = {}): Promise<tls.TLSSocket> {
		return new Promise((resolve, reject) => {
			this.plainSocket.removeAllListeners('data');
			const secure = tls.connect(
				{ socket: this.plainSocket, rejectUnauthorized: false, ...options },
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

/**
 * Connects, upgrades to TLS with the given client-side options, then drives one full transaction
 * (`EHLO`/`MAIL`/`RCPT`/`DATA`) over the encrypted channel and returns the negotiated
 * `tls.TLSSocket` plus the final SMTP reply. `EHLO` after the handshake is not optional here:
 * `onTlsHandshakeComplete()` (`smtp-server.ts:1820-1838`) resets `ehloName` to `null` and `state`
 * to `'initial'`, so a client that skipped the second `EHLO` would get a `503 Bad sequence of
 * commands` on `MAIL FROM` -- this helper exercises the real required sequence, not a shortcut.
 */
async function connectHandshakeAndTransact(
	port: number,
	tlsOptions: tls.ConnectionOptions
): Promise<{ secureSocket: tls.TLSSocket; finalReply: string[] }> {
	const client = await connectClient(port);
	await client.nextReply(); // 220 greeting
	client.send('EHLO client.example.com');
	await client.nextReply();
	client.send('STARTTLS');
	expect((await client.nextReply())[0]).toMatch(/^220 /);

	// No try/catch: a failed handshake must throw and fail the test (module doc comment).
	const secureSocket = await client.startTls(tlsOptions);

	client.send('EHLO client.example.com');
	await client.nextReply();
	client.send('MAIL FROM:<sender@example.com>');
	expect((await client.nextReply())[0]).toMatch(/^250 /);
	client.send(`RCPT TO:<${RCPT_ADDRESS}>`);
	expect((await client.nextReply())[0]).toMatch(/^250 /);
	client.send('DATA');
	expect((await client.nextReply())[0]).toMatch(/^354 /);
	client.writeRaw('Subject: tls fields\r\n\r\nhello\r\n.\r\n');
	const finalReply = await client.nextReply();
	return { secureSocket, finalReply };
}

const infraRequirement = probeOpensslAvailable();

suiteRequiring(
	'ci',
	'negotiated TLS version/cipher reach JournalAcceptancePort.accept() (JR-4-13 Auflage 1)',
	infraRequirement,
	() => {
		it('a real TLS 1.3 handshake: accept() receives exactly the version/cipher the client negotiated, not a placeholder', async () => {
			const { cert, key } = generateTestTlsCertificate();
			const acceptance = fakeAcceptance();
			const { port } = await startServer({ cert, key }, acceptance);

			const { secureSocket, finalReply } = await connectHandshakeAndTransact(port, {});

			// Sanity first -- a comparison of two `undefined`s would pass for the wrong reason.
			const clientProtocol = secureSocket.getProtocol();
			const clientCipher = secureSocket.getCipher()?.name;
			expect(clientProtocol).toMatch(/^TLSv1\.[23]$/);
			expect(typeof clientCipher).toBe('string');
			expect(clientCipher!.length).toBeGreaterThan(0);
			expect(finalReply[0]).toMatch(/^250 2\.0\.0/);

			expect(acceptance.calls).toHaveLength(1);
			const call = acceptance.calls[0]!;
			expect(call.tlsVersion).toBe(clientProtocol);
			expect(call.tlsCipher).toBe(clientCipher);
		});

		it('a real TLS 1.2 handshake with an explicit non-default cipher: accept() still matches exactly, not just for the TLS 1.3 default cipher set', async () => {
			const { cert, key } = generateTestTlsCertificate();
			const acceptance = fakeAcceptance();
			const { port } = await startServer({ cert, key }, acceptance);

			const { secureSocket, finalReply } = await connectHandshakeAndTransact(port, {
				maxVersion: 'TLSv1.2',
				ciphers: 'ECDHE-RSA-AES128-GCM-SHA256',
			});

			const clientProtocol = secureSocket.getProtocol();
			const clientCipher = secureSocket.getCipher()?.name;
			expect(clientProtocol).toBe('TLSv1.2');
			expect(clientCipher).toBe('ECDHE-RSA-AES128-GCM-SHA256');
			expect(finalReply[0]).toMatch(/^250 2\.0\.0/);

			expect(acceptance.calls).toHaveLength(1);
			const call = acceptance.calls[0]!;
			expect(call.tlsVersion).toBe(clientProtocol);
			expect(call.tlsCipher).toBe(clientCipher);
		});
	}
);
