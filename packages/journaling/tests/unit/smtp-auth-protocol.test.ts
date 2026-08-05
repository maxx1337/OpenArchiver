import { connect as connectTcp, type Socket } from 'node:net';
import * as tls from 'node:tls';
import { afterEach, expect, it } from 'vitest';
import { suiteRequiring } from '@oa-test/classification';
import {
	AUTH_DUMMY_PASSWORD_HASH,
	EsmtpServer,
	MAX_AUTH_ATTEMPTS_PER_CONNECTION,
	type AuthCredentialEvaluator,
	type AuthCredentialLookupResult,
	type EsmtpServerOptions,
	type IngressLogger,
	type PasswordVerifier,
	type RecipientAclDecision,
	type RecipientAclEvaluator,
} from '../../src/ingress/smtp-server';
import { smtpServerConfigSchema } from '../../src/ingress/smtp-config';
import {
	generateTestTlsCertificate,
	probeOpensslAvailable,
} from '../support/generate-test-tls-cert';

/**
 * `JR-4-05c` -- `AUTH` PLAIN/LOGIN over TLS, proven over a real TCP connection with a real TLS
 * handshake, the same "wire-level proof, not an options-object assertion" standard
 * `smtp-starttls-protocol.test.ts` already set for `STARTTLS`. `AuthCredentialEvaluator` and
 * `PasswordVerifier` are hand-written fakes here, not a real `SourceAclCache`/`bcryptjs` -- the same
 * convention `smtp-source-acl-protocol.test.ts`/`smtp-recipient-acl-protocol.test.ts` already
 * established for their own evaluators: this file proves the *protocol* (codes, ordering, state),
 * `source-acl-cache.test.ts` proves the cache's own `lookupCredential()` logic in isolation, and
 * `bcryptjs` is an already-tested third-party library this project does not need to re-verify.
 *
 * ---------------------------------------------------------------------------------------------
 * Why the fake `PasswordVerifier` still proves the timing-parity design (point 5)
 * ---------------------------------------------------------------------------------------------
 * `RecordingPasswordVerifier` records every `compare()` call it receives. For a `'not_found'`
 * username, the implementation compares against {@link AUTH_DUMMY_PASSWORD_HASH} and discards the
 * result -- this file asserts the recorded call used exactly that hash, which is the structural
 * property that matters (the comparison always runs, regardless of whether the username exists) --
 * *not* wall-clock timing, which would be flaky and environment-dependent to assert in a test.
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

/** Records every recorded `compare()` call so a test can assert *which* hash a given attempt was
 * checked against -- in particular, the timing-parity dummy-hash comparison for an unknown
 * username. `hash === 'expected:<password>'` is this fake's whole comparison rule: deliberately
 * nothing like real bcrypt, since real bcrypt's own correctness is not this project's to re-prove. */
class RecordingPasswordVerifier implements PasswordVerifier {
	readonly calls: Array<{ password: string; hash: string }> = [];
	async compare(password: string, hash: string): Promise<boolean> {
		this.calls.push({ password, hash });
		return hash === `expected:${password}`;
	}
}

/** A hand-written `AuthCredentialEvaluator` -- see this file's module doc comment for why this
 * stands in for `SourceAclCache` here. */
class MapAuthEvaluator implements AuthCredentialEvaluator {
	private unavailable = false;
	private readonly byUsername = new Map<string, AuthCredentialLookupResult>();

	setUnavailable(): void {
		this.unavailable = true;
	}

	setFound(username: string, sourceId: string, chainScopeId: string, passwordHash: string): void {
		this.byUsername.set(username, { kind: 'found', sourceId, chainScopeId, passwordHash });
	}

	lookupCredential(username: string): AuthCredentialLookupResult {
		if (this.unavailable) {
			return { kind: 'unavailable' };
		}
		return this.byUsername.get(username) ?? { kind: 'not_found' };
	}
}

function fakeRecipientEvaluator(bySourceId: {
	[address: string]: { sourceId: string; chainScopeId: string };
}): RecipientAclEvaluator {
	return {
		evaluateRecipient(address: string): RecipientAclDecision {
			const match = bySourceId[address];
			if (!match) {
				return { kind: 'denied' };
			}
			return { kind: 'allowed', sourceId: match.sourceId, chainScopeId: match.chainScopeId };
		},
	};
}

interface StartedServer {
	readonly server: EsmtpServer;
	readonly port: number;
}

async function startServer(
	options: {
		authCredentialEvaluator?: AuthCredentialEvaluator;
		passwordVerifier?: PasswordVerifier;
		recipientAclEvaluator?: RecipientAclEvaluator;
	} = {}
): Promise<StartedServer> {
	const { cert, key } = generateTestTlsCertificate();
	const smtp = smtpServerConfigSchema.parse({});
	const serverOptions: EsmtpServerOptions = {
		smtp,
		tls: { cert, key, requireTls: false },
		logger: silentLogger,
		authCredentialEvaluator: options.authCredentialEvaluator,
		passwordVerifier: options.passwordVerifier,
		recipientAclEvaluator: options.recipientAclEvaluator,
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

/** Same shape as `smtp-starttls-protocol.test.ts`'s `TestSmtpClient` -- see that file for the full
 * rationale of each method. */
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

	startTls(): Promise<tls.TLSSocket> {
		return new Promise((resolve, reject) => {
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

/** Connects, completes STARTTLS, and re-issues EHLO -- the state every AUTH test starts from. */
async function connectAndUpgrade(port: number): Promise<TestSmtpClient> {
	const client = await connectClient(port);
	await client.nextReply();
	client.send('EHLO client.example.com');
	await client.nextReply();
	client.send('STARTTLS');
	await client.nextReply();
	await client.startTls();
	client.send('EHLO client.example.com');
	await client.nextReply();
	return client;
}

const infraRequirement = probeOpensslAvailable();

suiteRequiring(
	'ci',
	'EsmtpServer AUTH PLAIN/LOGIN over the wire (JR-4-05c)',
	infraRequirement,
	() => {
		it('AUTH is not advertised in EHLO before the TLS handshake, even when configured', async () => {
			const authEvaluator = new MapAuthEvaluator();
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
			});
			const client = await connectClient(port);
			await client.nextReply();
			client.send('EHLO client.example.com');
			const reply = await client.nextReply();
			expect(reply.join('\n')).not.toContain('AUTH');
		});

		it('AUTH is advertised as "AUTH PLAIN LOGIN" in EHLO once TLS is active', async () => {
			const authEvaluator = new MapAuthEvaluator();
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
			});
			const client = await connectClient(port);
			await client.nextReply();
			client.send('EHLO client.example.com');
			await client.nextReply();
			client.send('STARTTLS');
			await client.nextReply();
			await client.startTls();
			client.send('EHLO client.example.com');
			const reply = await client.nextReply();
			expect(reply.join('\n')).toContain('AUTH PLAIN LOGIN');
		});

		it('a bare AUTH command on a plaintext connection is refused 538 5.7.11, unconditionally (point 1)', async () => {
			const authEvaluator = new MapAuthEvaluator();
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
			});
			const client = await connectClient(port);
			await client.nextReply();
			client.send('EHLO client.example.com');
			await client.nextReply();
			client.send('AUTH PLAIN AGpvaG4Ac2VjcmV0');
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^538 5\.7\.11/);
			expect(reply[0]).toContain(
				'Encryption required for requested authentication mechanism'
			);
		});

		it('AUTH is not configured: falls through to the ordinary 500, even over an active TLS session', async () => {
			const { port } = await startServer();
			const client = await connectAndUpgrade(port);
			client.send('AUTH PLAIN AGpvaG4Ac2VjcmV0');
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^500 /);
		});

		it('AUTH PLAIN with an initial response and correct credentials succeeds with 235 2.7.0', async () => {
			const authEvaluator = new MapAuthEvaluator();
			authEvaluator.setFound('john', 'source-1', 'archive-1', 'expected:secret');
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
			});
			const client = await connectAndUpgrade(port);
			const initialResponse = Buffer.from('\x00john\x00secret').toString('base64');
			client.send(`AUTH PLAIN ${initialResponse}`);
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^235 2\.7\.0/);
		});

		it('AUTH PLAIN with an empty challenge (no initial response) succeeds the same way', async () => {
			const authEvaluator = new MapAuthEvaluator();
			authEvaluator.setFound('john', 'source-1', 'archive-1', 'expected:secret');
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
			});
			const client = await connectAndUpgrade(port);
			client.send('AUTH PLAIN');
			const challenge = await client.nextReply();
			expect(challenge[0]).toMatch(/^334 /);
			const response = Buffer.from('\x00john\x00secret').toString('base64');
			client.send(response);
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^235 2\.7\.0/);
		});

		it('AUTH LOGIN succeeds with the two-step Username:/Password: dialogue', async () => {
			const authEvaluator = new MapAuthEvaluator();
			authEvaluator.setFound('john', 'source-1', 'archive-1', 'expected:secret');
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
			});
			const client = await connectAndUpgrade(port);
			client.send('AUTH LOGIN');
			const usernamePrompt = await client.nextReply();
			expect(usernamePrompt[0]).toMatch(/^334 /);
			expect(Buffer.from(usernamePrompt[0]!.slice(4), 'base64').toString('utf8')).toBe(
				'Username:'
			);
			client.send(Buffer.from('john').toString('base64'));
			const passwordPrompt = await client.nextReply();
			expect(passwordPrompt[0]).toMatch(/^334 /);
			expect(Buffer.from(passwordPrompt[0]!.slice(4), 'base64').toString('utf8')).toBe(
				'Password:'
			);
			client.send(Buffer.from('secret').toString('base64'));
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^235 2\.7\.0/);
		});

		it('a wrong password for a real username is refused 535 5.7.8', async () => {
			const authEvaluator = new MapAuthEvaluator();
			authEvaluator.setFound('john', 'source-1', 'archive-1', 'expected:secret');
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
			});
			const client = await connectAndUpgrade(port);
			const initialResponse = Buffer.from('\x00john\x00wrong-password').toString('base64');
			client.send(`AUTH PLAIN ${initialResponse}`);
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^535 5\.7\.8/);
		});

		it('an unknown username is refused with the exact same 535 5.7.8 -- no distinguishing wording (point 5)', async () => {
			const authEvaluator = new MapAuthEvaluator();
			const verifier = new RecordingPasswordVerifier();
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: verifier,
			});
			const client = await connectAndUpgrade(port);
			const initialResponse = Buffer.from('\x00nobody\x00whatever').toString('base64');
			client.send(`AUTH PLAIN ${initialResponse}`);
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^535 5\.7\.8/);
			// The comparison still ran, against the fixed timing-parity dummy hash -- never skipped just
			// because the username was unknown (module doc comment "AUTH" section, point 5).
			expect(verifier.calls).toContainEqual({
				password: 'whatever',
				hash: AUTH_DUMMY_PASSWORD_HASH,
			});
		});

		it('an unrecognised mechanism is refused 504 5.5.4', async () => {
			const authEvaluator = new MapAuthEvaluator();
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
			});
			const client = await connectAndUpgrade(port);
			client.send('AUTH FOOBAR');
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^504 5\.5\.4/);
		});

		it('malformed base64 in an initial response is refused 501 5.5.2', async () => {
			const authEvaluator = new MapAuthEvaluator();
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
			});
			const client = await connectAndUpgrade(port);
			client.send('AUTH PLAIN not-valid-base64!!');
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^501 5\.5\.2/);
		});

		it('malformed base64 in a continuation response is also refused 501 5.5.2', async () => {
			const authEvaluator = new MapAuthEvaluator();
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
			});
			const client = await connectAndUpgrade(port);
			client.send('AUTH LOGIN');
			await client.nextReply();
			client.send('not-valid-base64!!');
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^501 5\.5\.2/);
		});

		it('a SASL-PLAIN payload with the wrong number of NUL-separated fields is 501 5.5.2', async () => {
			const authEvaluator = new MapAuthEvaluator();
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
			});
			const client = await connectAndUpgrade(port);
			const malformed = Buffer.from('john\x00secret').toString('base64'); // only 2 fields
			client.send(`AUTH PLAIN ${malformed}`);
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^501 5\.5\.2/);
		});

		it('client cancellation with a lone "*" is refused 501 (RFC 4954 section 4)', async () => {
			const authEvaluator = new MapAuthEvaluator();
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
			});
			const client = await connectAndUpgrade(port);
			client.send('AUTH LOGIN');
			await client.nextReply();
			client.send('*');
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^501 /);
		});

		it('a second AUTH on an already-authenticated connection is refused 503 5.5.1', async () => {
			const authEvaluator = new MapAuthEvaluator();
			authEvaluator.setFound('john', 'source-1', 'archive-1', 'expected:secret');
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
			});
			const client = await connectAndUpgrade(port);
			const initialResponse = Buffer.from('\x00john\x00secret').toString('base64');
			client.send(`AUTH PLAIN ${initialResponse}`);
			await client.nextReply();

			client.send('AUTH PLAIN AGpvaG4Ac2VjcmV0');
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^503 5\.5\.1/);
		});

		it('AUTH after MAIL FROM (mid-transaction) is refused 503 5.5.1', async () => {
			const authEvaluator = new MapAuthEvaluator();
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
			});
			const client = await connectAndUpgrade(port);
			client.send('MAIL FROM:<a@example.com>');
			await client.nextReply();

			client.send('AUTH PLAIN AGpvaG4Ac2VjcmV0');
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^503 5\.5\.1/);
		});

		it("the ACL being 'unavailable' answers 454 4.7.0, never 535", async () => {
			const authEvaluator = new MapAuthEvaluator();
			authEvaluator.setUnavailable();
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
			});
			const client = await connectAndUpgrade(port);
			const initialResponse = Buffer.from('\x00john\x00secret').toString('base64');
			client.send(`AUTH PLAIN ${initialResponse}`);
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^454 4\.7\.0/);
		});

		it(`closes the connection with 421 after ${MAX_AUTH_ATTEMPTS_PER_CONNECTION + 1} failed attempts, never a 5xx`, async () => {
			const authEvaluator = new MapAuthEvaluator();
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
			});
			const client = await connectAndUpgrade(port);
			const badResponse = Buffer.from('\x00nobody\x00wrong').toString('base64');

			for (let i = 0; i < MAX_AUTH_ATTEMPTS_PER_CONNECTION; i++) {
				client.send(`AUTH PLAIN ${badResponse}`);
				const reply = await client.nextReply();
				expect(reply[0]).toMatch(/^535 5\.7\.8/);
			}

			client.send(`AUTH PLAIN ${badResponse}`);
			const finalReply = await client.nextReply();
			expect(finalReply[0]).toMatch(/^421 /);
			expect(finalReply[0]).not.toMatch(/^5\d\d/);
		});

		it('authenticated source addressing its own recipient is accepted normally (250)', async () => {
			const authEvaluator = new MapAuthEvaluator();
			authEvaluator.setFound('john', 'source-1', 'archive-1', 'expected:secret');
			const recipientEvaluator = fakeRecipientEvaluator({
				'own@journaling.example.com': { sourceId: 'source-1', chainScopeId: 'archive-1' },
			});
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
				recipientAclEvaluator: recipientEvaluator,
			});
			const client = await connectAndUpgrade(port);
			const initialResponse = Buffer.from('\x00john\x00secret').toString('base64');
			client.send(`AUTH PLAIN ${initialResponse}`);
			await client.nextReply();

			client.send('MAIL FROM:<sender@example.com>');
			await client.nextReply();
			client.send('RCPT TO:<own@journaling.example.com>');
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^250 /);
		});

		it("authenticated source addressing a *different* source's recipient is refused 550 5.7.1 (point 2)", async () => {
			const authEvaluator = new MapAuthEvaluator();
			authEvaluator.setFound('john', 'source-1', 'archive-1', 'expected:secret');
			const recipientEvaluator = fakeRecipientEvaluator({
				'other@journaling.example.com': { sourceId: 'source-2', chainScopeId: 'archive-2' },
			});
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
				recipientAclEvaluator: recipientEvaluator,
			});
			const client = await connectAndUpgrade(port);
			const initialResponse = Buffer.from('\x00john\x00secret').toString('base64');
			client.send(`AUTH PLAIN ${initialResponse}`);
			await client.nextReply();

			client.send('MAIL FROM:<sender@example.com>');
			await client.nextReply();
			client.send('RCPT TO:<other@journaling.example.com>');
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^550 5\.7\.1/);
		});

		it('an unauthenticated connection is unaffected by the source-conflict check -- ordinary recipient ACL behaviour', async () => {
			const authEvaluator = new MapAuthEvaluator();
			const recipientEvaluator = fakeRecipientEvaluator({
				'someone@journaling.example.com': {
					sourceId: 'source-2',
					chainScopeId: 'archive-2',
				},
			});
			const { port } = await startServer({
				authCredentialEvaluator: authEvaluator,
				passwordVerifier: new RecordingPasswordVerifier(),
				recipientAclEvaluator: recipientEvaluator,
			});
			const client = await connectAndUpgrade(port);
			client.send('MAIL FROM:<sender@example.com>');
			await client.nextReply();
			client.send('RCPT TO:<someone@journaling.example.com>');
			const reply = await client.nextReply();
			expect(reply[0]).toMatch(/^250 /);
		});
	}
);
