import { connect as connectTcp, type Socket } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	EsmtpServer,
	type EsmtpServerOptions,
	type IngressLogger,
	type RecipientAclDecision,
	type RecipientAclEvaluator,
} from '../../src/ingress/smtp-server';
import { smtpServerConfigSchema } from '../../src/ingress/smtp-config';

/**
 * `JR-4-05b` -- the recipient ACL gate proven over a real TCP connection.
 *
 * ---------------------------------------------------------------------------------------------
 * Why a wire-level test, in addition to `../../src/ingress/source-acl-cache.test.ts` and
 * `../../src/ingress/recipient-address.test.ts`
 * ---------------------------------------------------------------------------------------------
 * Same instruction as `JR-4-05a` followed for the connect-time gate (see
 * `smtp-source-acl-protocol.test.ts`'s doc comment): a test against the comparison/decision logic
 * alone does not prove a real client sees the right SMTP response code at the right command. This
 * file sends a real `MAIL FROM`/`RCPT TO` over a real loopback socket and reads the reply.
 *
 * A hand-written `RecipientAclEvaluator` fake stands in for `SourceAclCache`, the same substitution
 * `smtp-source-acl-protocol.test.ts` makes for the source ACL -- this file's job is the wiring
 * inside `SmtpConnection.handleRcpt` (which code for which decision, and the multi-chain
 * bookkeeping in `recordMatchedRecipient`), not the cache's own refresh/staleness/case-folding
 * logic, which is `source-acl-cache.test.ts`'s and `recipient-address.test.ts`'s job.
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

function recordingLogger(): { logger: IngressLogger; errors: unknown[][] } {
	const errors: unknown[][] = [];
	return {
		errors,
		logger: {
			debug: () => {},
			info: () => {},
			warn: () => {},
			error: (...args) => errors.push(args),
		},
	};
}

function fakeRecipientEvaluator(
	decide: (address: string) => RecipientAclDecision
): RecipientAclEvaluator {
	return { evaluate: decide };
}

/** Buffered, repeatable CRLF-line reader over one socket -- unlike `smtp-source-acl-protocol.test.ts`'s
 * one-shot `firstLine()`, this test needs to read a reply after every one of several commands sent
 * on the same connection (`HELO`, `MAIL FROM`, one or more `RCPT TO`). */
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
	recipientAclEvaluator?: RecipientAclEvaluator;
	logger?: IngressLogger;
}): Promise<{ port: number }> {
	const smtp = smtpServerConfigSchema.parse({});
	const serverOptions: EsmtpServerOptions = {
		smtp,
		logger: options.logger ?? silentLogger,
		recipientAclEvaluator: options.recipientAclEvaluator,
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

async function connectAndGreet(port: number): Promise<{ socket: Socket; reader: LineReader }> {
	const socket = connectTcp(port, '127.0.0.1');
	openSockets.push(socket);
	await new Promise<void>((resolve, reject) => {
		socket.once('connect', () => resolve());
		socket.once('error', reject);
	});
	const reader = new LineReader(socket);
	await reader.nextLine(); // 220 greeting
	return { socket, reader };
}

async function send(socket: Socket, reader: LineReader, line: string): Promise<string> {
	socket.write(`${line}\r\n`);
	return reader.nextLine();
}

async function mailFrom(socket: Socket, reader: LineReader): Promise<void> {
	expect(await send(socket, reader, 'HELO client.example.com')).toMatch(/^250/);
	expect(await send(socket, reader, 'MAIL FROM:<sender@example.com>')).toMatch(/^250/);
}

suite('ci', 'EsmtpServer recipient ACL gate over the wire (JR-4-05b)', () => {
	it('denied: 550 5.1.1 for a recipient matching no active source', async () => {
		const { port } = await startServer({
			recipientAclEvaluator: fakeRecipientEvaluator(() => ({ kind: 'denied' })),
		});
		const { socket, reader } = await connectAndGreet(port);
		await mailFrom(socket, reader);

		const line = await send(socket, reader, 'RCPT TO:<unknown@journaling.example.com>');
		expect(line).toMatch(/^550 5\.1\.1/);
	});

	it("unavailable: 451 4.3.0 (never 550, never a bare 5xx) -- and the connection stays open, unlike the connect-time gate's 421", async () => {
		const { port } = await startServer({
			recipientAclEvaluator: fakeRecipientEvaluator(() => ({ kind: 'unavailable' })),
		});
		const { socket, reader } = await connectAndGreet(port);
		await mailFrom(socket, reader);

		const line = await send(socket, reader, 'RCPT TO:<journal-1@journaling.example.com>');
		expect(line).toMatch(/^451 4\.3\.0/);
		expect(socket.destroyed).toBe(false);

		// The client can retry the same RCPT on the still-open connection.
		const retry = await send(socket, reader, 'RCPT TO:<journal-1@journaling.example.com>');
		expect(retry).toMatch(/^451 4\.3\.0/);
	});

	it('allowed: the ordinary 250 2.1.5 reply for a recipient the ACL matches', async () => {
		const { port } = await startServer({
			recipientAclEvaluator: fakeRecipientEvaluator(() => ({
				kind: 'allowed',
				sourceId: 'source-1',
				chainScopeId: 'archive-1',
			})),
		});
		const { socket, reader } = await connectAndGreet(port);
		await mailFrom(socket, reader);

		const line = await send(socket, reader, 'RCPT TO:<journal-1@journaling.example.com>');
		expect(line).toMatch(/^250 2\.1\.5/);
	});

	it('no recipientAclEvaluator configured: every syntactically valid recipient is accepted -- pre-JR-4-05b behaviour, unchanged', async () => {
		const { port } = await startServer({});
		const { socket, reader } = await connectAndGreet(port);
		await mailFrom(socket, reader);

		const line = await send(socket, reader, 'RCPT TO:<anyone@anywhere.example.com>');
		expect(line).toMatch(/^250 2\.1\.5/);
	});

	it('two recipients resolving to different chains: both still get their own 250, and the ambiguity is logged exactly once -- never silently resolved (JR-4-05b point 4)', async () => {
		const { logger, errors } = recordingLogger();
		const { port } = await startServer({
			logger,
			recipientAclEvaluator: fakeRecipientEvaluator((address) =>
				address === 'journal-a@journaling.example.com'
					? { kind: 'allowed', sourceId: 'source-a', chainScopeId: 'archive-a' }
					: { kind: 'allowed', sourceId: 'source-b', chainScopeId: 'archive-b' }
			),
		});
		const { socket, reader } = await connectAndGreet(port);
		await mailFrom(socket, reader);

		const first = await send(socket, reader, 'RCPT TO:<journal-a@journaling.example.com>');
		const second = await send(socket, reader, 'RCPT TO:<journal-b@journaling.example.com>');
		expect(first).toMatch(/^250 2\.1\.5/);
		expect(second).toMatch(/^250 2\.1\.5/);

		const ambiguityLogs = errors.filter((call) =>
			String(call[1]).includes('more than one chain')
		);
		expect(ambiguityLogs).toHaveLength(1);
		const fields = ambiguityLogs[0]![0] as { matchedRecipients: unknown[] };
		expect(fields.matchedRecipients).toHaveLength(2);
	});

	it('the same recipient twice, or two recipients of the same source, do not log the ambiguity -- unproblematic, resolved by construction (a Set of distinct chains)', async () => {
		const { logger, errors } = recordingLogger();
		const { port } = await startServer({
			logger,
			recipientAclEvaluator: fakeRecipientEvaluator(() => ({
				kind: 'allowed',
				sourceId: 'source-a',
				chainScopeId: 'archive-a',
			})),
		});
		const { socket, reader } = await connectAndGreet(port);
		await mailFrom(socket, reader);

		await send(socket, reader, 'RCPT TO:<journal-a@journaling.example.com>');
		await send(socket, reader, 'RCPT TO:<journal-a@journaling.example.com>');
		const third = await send(socket, reader, 'RCPT TO:<other-recipient@journaling.example.com>');
		expect(third).toMatch(/^250 2\.1\.5/);

		const ambiguityLogs = errors.filter((call) =>
			String(call[1]).includes('more than one chain')
		);
		expect(ambiguityLogs).toHaveLength(0);
	});
});
