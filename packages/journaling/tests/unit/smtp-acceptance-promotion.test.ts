import { connect as connectTcp, type Socket } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { EsmtpServer } from '../../src/ingress/smtp-server';
import type {
	EsmtpServerOptions,
	IngressLogger,
	JournalAcceptancePort,
	RecipientAclEvaluator,
} from '../../src/ingress/smtp-server';
// `smtp-server.ts` imports this type rather than re-exporting it -- take it from where it is declared.
import type { JournalTransactionInput } from '../../src/spool/acceptance';
import { smtpServerConfigSchema } from '../../src/ingress/smtp-config';

/**
 * `JR-4-19` at the wire -- a ledger connection that was unreachable at boot becomes effective on an
 * **already-open** connection, without a restart. Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why the `250` proof lives here and not in the integration suite
 * ---------------------------------------------------------------------------------------------
 * `packages/backend/tests/integration/smtp-ingress-ledger-recovery.int.test.ts` runs the real process
 * against real Postgres, but it cannot carry this claim on every platform: on Windows the
 * directory-fsync inside the durable spool write fails with `EPERM`, so a *wired* acceptance answers
 * `451 spool-write-failed` there too and the two states become indistinguishable at the SMTP level
 * (`journal-smtp-accept-e2e.int.test.ts` branches on `win32` for exactly this reason). Here the
 * acceptance port is a fake with no filesystem at all, so `451 -> 250` is measurable on every
 * platform -- which is what makes this the file that actually proves the acceptance criterion
 * "nimmt nach deren Rückkehr Nachrichten an, ohne Neustart".
 *
 * ---------------------------------------------------------------------------------------------
 * The second claim: the resolution is stable *within* a transaction
 * ---------------------------------------------------------------------------------------------
 * `journalAcceptanceProvider` is read once, at `MAIL FROM`, and the answer decides three separate
 * things (whether `tryBeginAcceptance()` opens a `SpoolWriteBridge`, whether the body scanner gets an
 * `onContent` sink that dereferences it, and whether `completeTransfer` may finalize). A provider that
 * changed its answer mid-transaction would either push into a bridge that was never opened or finish a
 * transfer that never fed one. The mid-transaction cases below flip the provider at the worst possible
 * moments and require the transaction to keep the answer it began with.
 */

const openServers: EsmtpServer[] = [];
const openSockets: Socket[] = [];

afterEach(async () => {
	for (const socket of openSockets.splice(0)) {
		if (!socket.destroyed) socket.destroy();
	}
	for (const server of openServers.splice(0)) {
		await server.close().catch(() => undefined);
	}
});

const silentLogger: IngressLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

const CHAIN_SCOPE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';

const fixedRecipientAcl: RecipientAclEvaluator = {
	evaluateRecipient: () => ({
		kind: 'allowed',
		sourceId: SOURCE_ID,
		chainScopeId: CHAIN_SCOPE_ID,
	}),
};

/** Accepts everything and records what it saw. No filesystem, no database -- see the module doc
 * comment for why that is the point of this file. */
function recordingAcceptance(): {
	port: JournalAcceptancePort;
	calls: JournalTransactionInput[];
	/** Body length per accepted transaction -- `JournalTransactionInput` carries no size field, the
	 * real acceptance measures the stream itself. */
	bodyBytes: number[];
} {
	const calls: JournalTransactionInput[] = [];
	const bodyBytes: number[] = [];
	let seq = 0n;
	return {
		calls,
		bodyBytes,
		port: {
			accept: async (input) => {
				calls.push(input);
				// Drain the body, the way a real acceptance does -- an unconsumed async iterator would
				// leave the connection waiting forever.
				let bytes = 0;
				for await (const chunk of input.chunks) {
					bytes += chunk.byteLength;
				}
				bodyBytes.push(bytes);
				seq += 1n;
				return {
					kind: 'accepted',
					// The real acceptance generates this; a fake only has to return something shaped
					// right, since nothing in this file reads it back.
					spoolTxId: `fake-tx-${seq}`,
					seq,
					chainHash: new Uint8Array(32),
					duplicateOf: null,
				};
			},
		},
	};
}

class TestSmtpClient {
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

	writeRaw(text: string): void {
		this.socket.write(text);
	}

	nextReply(timeoutMs = 5_000): Promise<string[]> {
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
}

async function startServer(
	provider: () => JournalAcceptancePort | undefined
): Promise<{ port: number }> {
	const options: EsmtpServerOptions = {
		smtp: smtpServerConfigSchema.parse({}),
		logger: silentLogger,
		recipientAclEvaluator: fixedRecipientAcl,
		journalAcceptanceProvider: provider,
	};
	const server = new EsmtpServer(options);
	openServers.push(server);
	await server.listen(0, '127.0.0.1');
	const address = server.address;
	if (address === null) throw new Error('server did not bind');
	return { port: address.port };
}

async function connectAndGreet(port: number): Promise<TestSmtpClient> {
	const socket = connectTcp(port, '127.0.0.1');
	openSockets.push(socket);
	await new Promise<void>((resolve, reject) => {
		socket.once('connect', () => resolve());
		socket.once('error', reject);
	});
	const client = new TestSmtpClient(socket);
	await client.nextReply(); // 220
	client.send('EHLO client.example.com');
	await client.nextReply();
	return client;
}

/** One `MAIL FROM` / `RCPT TO` / `DATA` transaction; returns the reply to the final dot. */
async function runDataTransaction(client: TestSmtpClient, body: string): Promise<string[]> {
	client.send('MAIL FROM:<sender@example.com>');
	await client.nextReply();
	client.send('RCPT TO:<journal@example.com>');
	await client.nextReply();
	client.send('DATA');
	await client.nextReply(); // 354
	client.writeRaw(`${body}\r\n.\r\n`);
	return client.nextReply();
}

suite('ci', 'JR-4-19 acceptance promotion at the wire', () => {
	it('the same open connection goes from 451 to 250 when acceptance appears -- no restart, no reconnect', async () => {
		const recorder = recordingAcceptance();
		let wired: JournalAcceptancePort | undefined = undefined;
		const { port } = await startServer(() => wired);
		const client = await connectAndGreet(port);

		// Before: the ledger database is unreachable, so nothing is wired.
		const before = await runDataTransaction(client, 'Subject: while the ledger is down\r\n');
		expect(before[0]).toMatch(/^451 4\.3\.0/);
		expect(recorder.calls).toHaveLength(0);

		// The bootstrap succeeds in the background. Nothing else happens: the server is not rebuilt,
		// the port is not rebound, and this connection is never closed.
		wired = recorder.port;

		const after = await runDataTransaction(client, 'Subject: after the ledger came back\r\n');
		expect(after[0]).toMatch(/^250 /);
		expect(recorder.calls).toHaveLength(1);
		// The accepted transaction really carried this message, on the same connection.
		expect(recorder.calls[0]!.envelopeFrom).toBe('sender@example.com');
	});

	it('never answers 250 while acceptance is unwired, however many transactions a client tries', async () => {
		const { port } = await startServer(() => undefined);
		const client = await connectAndGreet(port);

		for (let i = 0; i < 3; i++) {
			const reply = await runDataTransaction(client, `Subject: attempt ${i}\r\n`);
			expect(reply[0]).toMatch(/^451 4\.3\.0/);
		}
	});

	it('a transaction keeps the answer it began with when acceptance appears mid-transfer', async () => {
		const recorder = recordingAcceptance();
		let wired: JournalAcceptancePort | undefined = undefined;
		const { port } = await startServer(() => wired);
		const client = await connectAndGreet(port);

		client.send('MAIL FROM:<sender@example.com>');
		await client.nextReply();
		client.send('RCPT TO:<journal@example.com>');
		await client.nextReply();
		client.send('DATA');
		await client.nextReply(); // 354

		// The promotion lands *inside* the transfer. This transaction began with no acceptance, so it
		// must finish as it began -- if the provider were re-read at the final dot, the server would
		// try to finalize a transfer whose bytes were never fed to a bridge.
		wired = recorder.port;
		client.writeRaw('Subject: promoted mid-transfer\r\n.\r\n');
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^451 4\.3\.0/);
		expect(recorder.calls).toHaveLength(0);

		// And the *next* transaction on the same connection does see it.
		const next = await runDataTransaction(client, 'Subject: the next one\r\n');
		expect(next[0]).toMatch(/^250 /);
		expect(recorder.calls).toHaveLength(1);
	});

	it('a transaction that began wired stays wired even if acceptance disappears mid-transfer', async () => {
		const recorder = recordingAcceptance();
		let wired: JournalAcceptancePort | undefined = recorder.port;
		const { port } = await startServer(() => wired);
		const client = await connectAndGreet(port);

		client.send('MAIL FROM:<sender@example.com>');
		await client.nextReply();
		client.send('RCPT TO:<journal@example.com>');
		await client.nextReply();
		client.send('DATA');
		await client.nextReply();

		// The reverse direction of the case above, and the more dangerous one: a bridge is already
		// open and the body is already being fed to it. Losing the port here would strand the bridge.
		wired = undefined;
		client.writeRaw('Subject: unwired mid-transfer\r\n.\r\n');
		const reply = await client.nextReply();
		expect(reply[0]).toMatch(/^250 /);
		expect(recorder.calls).toHaveLength(1);
	});

	it('BDAT 0 LAST as the only chunk follows the same resolution', async () => {
		const recorder = recordingAcceptance();
		let wired: JournalAcceptancePort | undefined = undefined;
		const { port } = await startServer(() => wired);
		const client = await connectAndGreet(port);

		client.send('MAIL FROM:<sender@example.com>');
		await client.nextReply();
		client.send('RCPT TO:<journal@example.com>');
		await client.nextReply();
		client.send('BDAT 0 LAST');
		expect((await client.nextReply())[0]).toMatch(/^451 4\.3\.0/);

		wired = recorder.port;
		client.send('MAIL FROM:<sender@example.com>');
		await client.nextReply();
		client.send('RCPT TO:<journal@example.com>');
		await client.nextReply();
		client.send('BDAT 0 LAST');
		expect((await client.nextReply())[0]).toMatch(/^250 /);
		expect(recorder.calls).toHaveLength(1);
		expect(recorder.bodyBytes).toEqual([0]);
	});

	it('a provider that throws degrades to 451 instead of taking the connection or the process down', async () => {
		const { port } = await startServer(() => {
			throw new Error('bootstrap is in a bad state');
		});
		const client = await connectAndGreet(port);

		// MAIL FROM itself must still succeed -- the provider runs inside the socket's data handler,
		// so an escaping exception would be an unhandled throw in production.
		client.send('MAIL FROM:<sender@example.com>');
		expect((await client.nextReply())[0]).toMatch(/^250 /);
		client.send('RCPT TO:<journal@example.com>');
		await client.nextReply();
		client.send('DATA');
		await client.nextReply();
		client.writeRaw('Subject: provider threw\r\n.\r\n');
		expect((await client.nextReply())[0]).toMatch(/^451 4\.3\.0/);
	});

	it('a plain journalAcceptance value still works -- the constructor lifts it into a provider', async () => {
		const recorder = recordingAcceptance();
		const options: EsmtpServerOptions = {
			smtp: smtpServerConfigSchema.parse({}),
			logger: silentLogger,
			recipientAclEvaluator: fixedRecipientAcl,
			journalAcceptance: recorder.port,
		};
		const server = new EsmtpServer(options);
		openServers.push(server);
		await server.listen(0, '127.0.0.1');
		const address = server.address;
		if (address === null) throw new Error('server did not bind');

		const client = await connectAndGreet(address.port);
		const reply = await runDataTransaction(client, 'Subject: value form\r\n');
		expect(reply[0]).toMatch(/^250 /);
		expect(recorder.calls).toHaveLength(1);
	});
});
