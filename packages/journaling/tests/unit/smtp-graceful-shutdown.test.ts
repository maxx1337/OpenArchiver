import { connect as connectTcp, type Socket } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	EsmtpServer,
	type EsmtpServerOptions,
	type IngressLogger,
	type JournalAcceptancePort,
	type RecipientAclEvaluator,
} from '../../src/ingress/smtp-server';
import { smtpServerConfigSchema } from '../../src/ingress/smtp-config';
import type { JournalAcceptanceResult, JournalTransactionInput } from '../../src/spool/acceptance';

/**
 * `JR-4-06b` -- skill `journal-ledger` section 2's "Shutdown in progress" row (`421 4.3.2`, "Drain
 * gracefully"), proven at the class level: `EsmtpServer.close()` calling
 * `SmtpConnection.beginShutdown()` on every open connection.
 *
 * ---------------------------------------------------------------------------------------------
 * Why the class level, and not (only) a real `SIGTERM` against the compiled process
 * ---------------------------------------------------------------------------------------------
 * `ingress-process-boot.test.ts` (`JR-4-01`) already measured, on this host, that a real `SIGTERM`
 * cannot be delivered to a child process on Windows at all: `ChildProcess.kill()` there calls
 * `TerminateProcess()` directly, the process's own signal handler never runs, and `close` reports a
 * termination signal rather than the exit code the handler would have produced. That measurement is
 * why this file proves the actual acceptance criterion -- **a transaction that already earned its
 * `250` must not lose it to a shutdown** -- against `EsmtpServer` directly, with no OS signal
 * involved at all: `close()` is a plain async method, callable (and awaitable) identically on every
 * platform this suite runs on. `ingress-process-boot.test.ts`'s own POSIX-gated case is what proves
 * the *process* wires `SIGTERM` into this same `close()` call on the one platform that can actually
 * deliver the signal; this file is the one proof of the drain contract itself that is not
 * platform-gated at all.
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

const CHAIN_SCOPE_ID = '55555555-5555-4555-8555-555555555555';
const SOURCE_ID = '66666666-6666-4666-8666-666666666666';
const RCPT_ADDRESS = 'journal@example.com';

const fixedRecipientAcl: RecipientAclEvaluator = {
	evaluateRecipient: () => ({
		kind: 'allowed',
		sourceId: SOURCE_ID,
		chainScopeId: CHAIN_SCOPE_ID,
	}),
};

/**
 * A `JournalAcceptancePort` whose `accept()` drains the bridge (so `finalizeAcceptance`'s `bridge.end()`
 * does not hang waiting for a consumer -- the same requirement `smtp-acceptance-wiring.test.ts`'s own
 * `fakeAcceptance()` doc comment explains) but does not *settle* until the test explicitly resolves it.
 * `drained` flips to `true` the moment draining finishes -- observable proof that
 * `SmtpConnection.finalizeAcceptance` has already called `bridge.end()` and is now awaiting exactly the
 * promise this fake controls, i.e. that the connection is genuinely in its busy,
 * `commandProcessingSuspended` window, not merely "probably done receiving bytes by now".
 */
function deferredAcceptance(): {
	readonly port: JournalAcceptancePort;
	readonly calls: JournalTransactionInput[];
	drained: boolean;
	resolve(result: JournalAcceptanceResult): void;
} {
	const calls: JournalTransactionInput[] = [];
	let resolveGate!: (result: JournalAcceptanceResult) => void;
	const gate = new Promise<JournalAcceptanceResult>((resolve) => {
		resolveGate = resolve;
	});
	const state = {
		calls,
		drained: false,
		resolve: (result: JournalAcceptanceResult) => resolveGate(result),
		port: {
			async accept(input: JournalTransactionInput): Promise<JournalAcceptanceResult> {
				calls.push(input);
				for await (const _chunk of input.chunks) {
					// discarded -- see this function's own doc comment
				}
				state.drained = true;
				return gate;
			},
		} satisfies JournalAcceptancePort,
	};
	return state;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`condition not met within ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

interface StartedServer {
	readonly server: EsmtpServer;
	readonly port: number;
}

async function startServer(journalAcceptance?: JournalAcceptancePort): Promise<StartedServer> {
	const smtp = smtpServerConfigSchema.parse({});
	const options: EsmtpServerOptions = {
		smtp,
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

/** Minimal SMTP client: send a line, or read one reply line at a time (this file never needs a
 * multiline reply). Trimmed down the same way `smtp-acceptance-wiring.test.ts`'s own client is. */
class TestSmtpClient {
	private raw = '';
	private readonly readyLines: string[] = [];
	private readonly waiters: Array<{ resolve: (line: string) => void; timer: NodeJS.Timeout }> =
		[];
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
			if (idx === -1) return;
			const line = this.raw.slice(0, idx);
			this.raw = this.raw.slice(idx + 2);
			const waiter = this.waiters.shift();
			if (waiter) {
				clearTimeout(waiter.timer);
				waiter.resolve(line);
			} else {
				this.readyLines.push(line);
			}
		}
	}

	send(line: string): void {
		this.socket.write(`${line}\r\n`);
	}

	writeRaw(text: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this.socket.write(text, (err) => (err ? reject(err) : resolve()));
		});
	}

	nextLine(timeoutMs = 2_000): Promise<string> {
		const ready = this.readyLines.shift();
		if (ready !== undefined) return Promise.resolve(ready);
		return new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => {
				const idx = this.waiters.findIndex((w) => w.resolve === resolve);
				if (idx !== -1) this.waiters.splice(idx, 1);
				reject(new Error(`no SMTP reply line within ${timeoutMs}ms`));
			}, timeoutMs);
			this.waiters.push({ resolve, timer });
		});
	}

	/** Whether a further reply line is already sitting there, without waiting for one. Used to assert
	 * a busy connection has *not* replied yet at a given point. */
	hasBufferedLine(): boolean {
		return this.readyLines.length > 0;
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

/** Drain a full (possibly multiline) reply -- every line but the last starts "<code>-", the last
 * "<code> " (space), per `formatMultilineResponse`. `EHLO`'s reply is multiline (`PIPELINING`,
 * `SIZE`, ...); `nextLine()` alone would only consume its first line. Returns the last line. */
async function readFullReply(client: TestSmtpClient): Promise<string> {
	for (;;) {
		const line = await client.nextLine();
		if (!/^\d{3}-/.test(line)) {
			return line;
		}
	}
}

suite(
	'ci',
	'EsmtpServer.close() drains gracefully -- 421 4.3.2, and a transaction that earned its 250 keeps it (JR-4-06b)',
	() => {
		it('an idle connection (no transaction in flight) is told immediately: 421 4.3.2, then the socket closes -- no need to send another command first', async () => {
			const { server, port } = await startServer();
			const client = await connectClient(port);
			expect(await client.nextLine()).toMatch(/^220 /);
			client.send('EHLO client.example.com');
			await readFullReply(client); // the EHLO reply's last line; idle from here

			const closePromise = server.close();

			// Proactive: the server pushes 421 without the client ever sending another command.
			const line = await client.nextLine();
			expect(line).toMatch(/^421 4\.3\.2/);
			expect(line).toContain('shutting down');

			await closePromise;
			expect(client.closed).toBe(true);
		});

		it('a connection sitting between MAIL/RCPT (no DATA/BDAT started) is also idle, and is drained the same way', async () => {
			const { server, port } = await startServer();
			const client = await connectClient(port);
			await client.nextLine();
			client.send('EHLO client.example.com');
			await readFullReply(client);
			client.send('MAIL FROM:<a@example.com>');
			await client.nextLine();
			client.send(`RCPT TO:<${RCPT_ADDRESS}>`);
			await client.nextLine();

			await server.close();
			// close() only resolves once every connection has actually ended -- reaching this line at
			// all is part of the proof, not just the response line below.
			expect(client.closed).toBe(true);
		});

		it('new connection attempts are refused once close() has been called (no new connection is ever admitted mid-drain)', async () => {
			const { server, port } = await startServer();
			const closePromise = server.close();

			await new Promise<void>((resolve, reject) => {
				const socket = connectTcp(port, '127.0.0.1');
				socket.once('error', () => resolve()); // ECONNREFUSED, or platform equivalent
				socket.once('connect', () => {
					socket.destroy();
					reject(new Error('a new connection was accepted after close() began'));
				});
			});

			await closePromise;
		});

		it('a transaction mid-DATA (accept() still pending) is NOT interrupted: it earns its real 250 first, and the connection closes only afterward', async () => {
			const deferred = deferredAcceptance();
			const { server, port } = await startServer(deferred.port);
			const client = await connectClient(port);
			await client.nextLine();
			client.send('EHLO client.example.com');
			await readFullReply(client);
			client.send('MAIL FROM:<a@example.com>');
			await client.nextLine();
			client.send(`RCPT TO:<${RCPT_ADDRESS}>`);
			await client.nextLine();
			client.send('DATA');
			await client.nextLine(); // 354
			await client.writeRaw('Subject: test\r\n\r\nhello\r\n.\r\n');

			// Deterministic proof of "busy right now": finalizeAcceptance has already ended the bridge
			// and is awaiting exactly the promise this fake controls (see deferredAcceptance's doc
			// comment) -- not a timing guess.
			await waitUntil(() => deferred.drained);

			const closePromise = server.close();
			// close() must not resolve, and the connection must not receive anything, while the
			// transaction's own accept() is still unsettled -- this is the guarantee under test.
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(client.hasBufferedLine()).toBe(false);

			deferred.resolve({
				kind: 'accepted',
				spoolTxId: 'tx-shutdown',
				seq: 1n,
				chainHash: Buffer.alloc(32, 0xcc),
			});

			// The transaction's own, real reply -- never overridden by the shutdown.
			const transactionReply = await client.nextLine();
			expect(transactionReply).toMatch(/^250 2\.0\.0/);
			expect(transactionReply).toContain('queued as 1');

			// Only now -- armCommandTimer's own shutdown check, reached at completeTransfer's tail --
			// does the connection get told to drain.
			const shutdownReply = await client.nextLine();
			expect(shutdownReply).toMatch(/^421 4\.3\.2/);

			await closePromise;
			expect(client.closed).toBe(true);
			expect(deferred.calls).toHaveLength(1);
		});

		it('a rejected (non-accepted) in-flight transaction also keeps its own real reply ahead of the shutdown notice', async () => {
			const deferred = deferredAcceptance();
			const { server, port } = await startServer(deferred.port);
			const client = await connectClient(port);
			await client.nextLine();
			client.send('EHLO client.example.com');
			await readFullReply(client);
			client.send('MAIL FROM:<a@example.com>');
			await client.nextLine();
			client.send(`RCPT TO:<${RCPT_ADDRESS}>`);
			await client.nextLine();
			client.send('DATA');
			await client.nextLine();
			await client.writeRaw('hello\r\n.\r\n');
			await waitUntil(() => deferred.drained);

			const closePromise = server.close();

			deferred.resolve({
				kind: 'ledger-append-failed',
				spoolTxId: 'tx-shutdown-2',
				filePath: '/spool/incoming/00/tx-shutdown-2.eml',
				cause: new Error('boom'),
			});

			expect(await client.nextLine()).toMatch(/^451 4\.3\.0/);
			expect(await client.nextLine()).toMatch(/^421 4\.3\.2/);

			await closePromise;
		});
	}
);
