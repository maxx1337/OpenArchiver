import { connect as connectTcp, type Socket } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	EsmtpServer,
	type ConnectionLimiter,
	type EsmtpServerOptions,
	type IngressLogger,
	type SourceAclDecision,
	type SourceAclEvaluator,
	type TransactionRateLimiter,
} from '../../src/ingress/smtp-server';
import { smtpServerConfigSchema } from '../../src/ingress/smtp-config';
import {
	PerSourceConnectionLimiter,
	PerSourceTransactionRateLimiter,
} from '../../src/ingress/connection-rate-limiter';

/**
 * `JR-4-08` -- per-source connection/transaction-rate limits, proven over a real TCP connection.
 *
 * ---------------------------------------------------------------------------------------------
 * Why a wire-level test, in addition to `../../src/ingress/connection-rate-limiter.test.ts`
 * ---------------------------------------------------------------------------------------------
 * Same instruction every `JR-4-05*` wire-level test in this directory already follows: a test
 * against the limiter classes alone does not prove a real sending MTA sees the right response
 * code, in the right order relative to the socket closing, at the right point in the protocol. That
 * unit file proves `PerSourceConnectionLimiter`/`PerSourceTransactionRateLimiter` are correct in
 * isolation; this file proves `EsmtpServer.handleConnection`/`SmtpConnection.handleMail` actually
 * gate a real connection/transaction with them, that the connect-time rejection writes its full
 * reply line **before** the socket closes (not a bare disconnect a sending MTA would read as a
 * network fault), and that a source the connect-time ACL itself rejects can never reach either
 * limiter at all, no matter how many times it tries.
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

function allowedDecision(sourceId: string): SourceAclDecision {
	return { kind: 'allowed', sourceId, chainScopeId: `${sourceId}-chain`, requireTls: false };
}

/** A `SourceAclEvaluator` whose `sourceId` can be changed between connections -- simulates several
 * distinct sources connecting to the same server without needing several server instances. */
function stubEvaluator(initialSourceId: string): SourceAclEvaluator & { sourceId: string } {
	return {
		sourceId: initialSourceId,
		evaluate(): SourceAclDecision {
			return allowedDecision(this.sourceId);
		},
	};
}

function deniedEvaluator(): SourceAclEvaluator {
	return { evaluate: () => ({ kind: 'denied' }) };
}

class LineReader {
	private buffer = '';
	private pending: { resolve: (line: string) => void; timer: NodeJS.Timeout } | null = null;

	constructor(socket: Socket) {
		socket.on('data', (chunk: Buffer) => {
			this.buffer += chunk.toString('utf8');
			this.tryResolve();
		});
	}

	private tryResolve(): void {
		if (!this.pending) {
			return;
		}
		const idx = this.buffer.indexOf('\r\n');
		if (idx === -1) {
			return;
		}
		const line = this.buffer.slice(0, idx);
		this.buffer = this.buffer.slice(idx + 2);
		const { resolve, timer } = this.pending;
		this.pending = null;
		clearTimeout(timer);
		resolve(line);
	}

	nextLine(timeoutMs = 2000): Promise<string> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending = null;
				reject(new Error('timed out waiting for the next response line'));
			}, timeoutMs);
			this.pending = { resolve, timer };
			this.tryResolve();
		});
	}
}

async function startServer(options: {
	sourceAclEvaluator?: SourceAclEvaluator;
	connectionLimiter?: ConnectionLimiter;
	transactionRateLimiter?: TransactionRateLimiter;
}): Promise<{ port: number }> {
	const smtp = smtpServerConfigSchema.parse({});
	const serverOptions: EsmtpServerOptions = {
		smtp,
		logger: silentLogger,
		sourceAclEvaluator: options.sourceAclEvaluator,
		connectionLimiter: options.connectionLimiter,
		transactionRateLimiter: options.transactionRateLimiter,
	};
	const server = new EsmtpServer(serverOptions);
	openServers.push(server);
	await server.listen(0, '127.0.0.1');
	const address = server.address;
	if (address === null) {
		throw new Error('server did not bind');
	}
	return { port: address.port };
}

async function connectAndTrack(port: number): Promise<Socket> {
	const socket = connectTcp(port, '127.0.0.1');
	openSockets.push(socket);
	await new Promise<void>((resolve, reject) => {
		socket.once('connect', () => resolve());
		socket.once('error', reject);
	});
	return socket;
}

async function connectAndGreet(port: number): Promise<{ socket: Socket; reader: LineReader }> {
	const socket = await connectAndTrack(port);
	const reader = new LineReader(socket);
	await reader.nextLine(); // 220 greeting
	return { socket, reader };
}

function waitForClose(socket: Socket): Promise<void> {
	if (socket.destroyed) {
		return Promise.resolve();
	}
	return new Promise((resolve) => socket.once('close', () => resolve()));
}

async function send(socket: Socket, reader: LineReader, line: string): Promise<string> {
	socket.write(`${line}\r\n`);
	return reader.nextLine();
}

suite('ci', 'EsmtpServer connection limit over the wire (JR-4-08)', () => {
	it('421 4.7.0 once a source is at its concurrent-connection limit, with the full line delivered before the socket closes', async () => {
		const connectionLimiter = new PerSourceConnectionLimiter(1);
		const { port } = await startServer({
			sourceAclEvaluator: stubEvaluator('source-a'),
			connectionLimiter,
		});

		const first = await connectAndGreet(port); // occupies the one available slot
		const second = await connectAndTrack(port);
		const secondReader = new LineReader(second);
		const line = await secondReader.nextLine();

		expect(line).toMatch(/^421 4\.7\.0/);
		// The greeting was never sent to the refused connection -- the gate runs before it.
		expect(line).not.toContain('220');

		await waitForClose(second);
		expect(second.destroyed).toBe(true);
		// The first connection is completely unaffected by the second one's rejection.
		expect(first.socket.destroyed).toBe(false);
	});

	it('release()s its slot when the connection closes, so a subsequent connection from the same source succeeds', async () => {
		const connectionLimiter = new PerSourceConnectionLimiter(1);
		const { port } = await startServer({
			sourceAclEvaluator: stubEvaluator('source-a'),
			connectionLimiter,
		});

		const first = await connectAndGreet(port);
		first.socket.destroy();
		await waitForClose(first.socket);

		// A slot must now be free -- the greeting arrives, proving this connection was not refused.
		const second = await connectAndGreet(port);
		expect(second.socket.destroyed).toBe(false);
	});

	it('tracks each source independently -- one source at its limit never blocks a different source', async () => {
		const connectionLimiter = new PerSourceConnectionLimiter(1);
		const evaluator = stubEvaluator('source-a');
		const { port } = await startServer({ sourceAclEvaluator: evaluator, connectionLimiter });

		await connectAndGreet(port); // source-a's one slot is now held

		evaluator.sourceId = 'source-b';
		const other = await connectAndGreet(port); // a different source, same server, same limiter
		expect(other.socket.destroyed).toBe(false);
	});

	it("a source the connect-time ACL denies can never occupy a slot, no matter how many times it connects -- so it can never exhaust a real source's budget", async () => {
		// One limiter instance, shared between a "denied" server and an "allowed" server for the
		// *same* sourceId -- exactly what JR-4-05a's ACL match means in production (one SourceAclCache
		// serving both the denial and, for a real source, the sourceId this limiter is keyed by).
		const connectionLimiter = new PerSourceConnectionLimiter(1);
		const { port: deniedPort } = await startServer({
			sourceAclEvaluator: deniedEvaluator(),
			connectionLimiter,
		});

		// Hammer the denied gate repeatedly -- if a denied connection ever touched the limiter, this
		// would eventually (or immediately) exhaust "source-a"'s budget.
		for (let i = 0; i < 5; i++) {
			const socket = await connectAndTrack(deniedPort);
			const reader = new LineReader(socket);
			expect(await reader.nextLine()).toMatch(/^554 5\.7\.1/);
			await waitForClose(socket);
		}

		const { port: allowedPort } = await startServer({
			sourceAclEvaluator: stubEvaluator('source-a'),
			connectionLimiter,
		});
		const allowed = await connectAndGreet(allowedPort);
		expect(allowed.socket.destroyed).toBe(false);
	});
});

suite('ci', 'EsmtpServer transaction rate limit over the wire (JR-4-08)', () => {
	it('450 4.7.1 once a source is at its transaction-rate limit -- and the connection stays open, unlike the connection-limit gate', async () => {
		const transactionRateLimiter = new PerSourceTransactionRateLimiter(1, 60_000);
		const { port } = await startServer({
			sourceAclEvaluator: stubEvaluator('source-a'),
			transactionRateLimiter,
		});
		const { socket, reader } = await connectAndGreet(port);

		expect(await send(socket, reader, 'HELO client.example.com')).toMatch(/^250/);
		expect(await send(socket, reader, 'MAIL FROM:<sender@example.com>')).toMatch(/^250/);
		// Free the transaction slot (state 'mail' -> 'ready') so the *next* MAIL FROM is the one the
		// rate limit -- not the state machine's own "bad sequence of commands" check -- refuses.
		expect(await send(socket, reader, 'RSET')).toMatch(/^250/);

		const throttled = await send(socket, reader, 'MAIL FROM:<sender@example.com>');
		expect(throttled).toMatch(/^450 4\.7\.1/);

		// The connection is not closed -- a further command still gets an ordinary reply.
		expect(await send(socket, reader, 'NOOP')).toMatch(/^250/);
		expect(socket.destroyed).toBe(false);
	});

	it('tracks each source independently', async () => {
		const transactionRateLimiter = new PerSourceTransactionRateLimiter(1, 60_000);
		const evaluator = stubEvaluator('source-a');
		const { port } = await startServer({
			sourceAclEvaluator: evaluator,
			transactionRateLimiter,
		});

		const a = await connectAndGreet(port);
		expect(await send(a.socket, a.reader, 'HELO client.example.com')).toMatch(/^250/);
		expect(await send(a.socket, a.reader, 'MAIL FROM:<sender@example.com>')).toMatch(/^250/);

		evaluator.sourceId = 'source-b';
		const b = await connectAndGreet(port);
		expect(await send(b.socket, b.reader, 'HELO client.example.com')).toMatch(/^250/);
		// source-b has its own, still-untouched budget.
		expect(await send(b.socket, b.reader, 'MAIL FROM:<sender@example.com>')).toMatch(/^250/);
	});

	it("never aborts a transaction already past MAIL FROM, even once the source's budget is exhausted for the next one", async () => {
		const transactionRateLimiter = new PerSourceTransactionRateLimiter(1, 60_000);
		const { port } = await startServer({
			sourceAclEvaluator: stubEvaluator('source-a'),
			transactionRateLimiter,
		});
		const { socket, reader } = await connectAndGreet(port);

		expect(await send(socket, reader, 'HELO client.example.com')).toMatch(/^250/);
		// This MAIL FROM consumes the source's one-per-window budget.
		expect(await send(socket, reader, 'MAIL FROM:<sender@example.com>')).toMatch(/^250/);
		// The gate only ever runs at MAIL FROM (SmtpConnection.handleMail) -- RCPT/DATA of this same,
		// already-admitted transaction are never re-checked against the now-exhausted budget.
		expect(await send(socket, reader, 'RCPT TO:<journal-1@journaling.example.com>')).toMatch(
			/^250/
		);
		expect(await send(socket, reader, 'DATA')).toMatch(/^354/);
		const final = await send(socket, reader, '.');
		// No JournalAcceptancePort wired in this test -- the pre-JR-4-06a default -- so the
		// transaction still ends in the ordinary 451, never anything shaped like the rate-limit's own
		// 450 4.7.1: proof this path was never consulted for a transaction already underway.
		expect(final).toMatch(/^451 4\.3\.0/);
	});

	it('no sourceAclEvaluator configured: the rate limiter has no sourceId to key by and is inert -- pre-existing behaviour unaffected', async () => {
		const transactionRateLimiter = new PerSourceTransactionRateLimiter(1, 60_000);
		const { port } = await startServer({ transactionRateLimiter });
		const { socket, reader } = await connectAndGreet(port);

		expect(await send(socket, reader, 'HELO client.example.com')).toMatch(/^250/);
		expect(await send(socket, reader, 'MAIL FROM:<sender@example.com>')).toMatch(/^250/);
		expect(await send(socket, reader, 'RSET')).toMatch(/^250/);
		// A second transaction on the same connection is still admitted -- nothing throttles it,
		// because there was never a sourceId to consume a window against.
		expect(await send(socket, reader, 'MAIL FROM:<sender@example.com>')).toMatch(/^250/);
	});
});
