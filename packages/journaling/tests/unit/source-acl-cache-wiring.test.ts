import { connect as connectTcp, type Socket } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { EsmtpServer, type EsmtpServerOptions } from '../../src/ingress/smtp-server';
import { smtpServerConfigSchema } from '../../src/ingress/smtp-config';
import { bindSourceAclCache, SourceAclCache } from '../../src/ingress/source-acl-cache';
import type { JournalingSourceAclEntry, SourceAclLookup } from '../../src/ingress/source-acl-port';

/**
 * `JR-4-20` (F46) -- `bindSourceAclCache()` proven over a real TCP connection, through **the same
 * function `apps/smtp-ingress/src/index.ts` calls in production**, not a hand-written
 * `RecipientAclEvaluator`/`SourceAclEvaluator` fake.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this file exists alongside `smtp-source-acl-protocol.test.ts` / `smtp-recipient-acl-protocol.test.ts`
 * ---------------------------------------------------------------------------------------------
 * Both of those files (correctly) substitute a hand-written evaluator fake for `SourceAclCache`,
 * which is exactly why neither of them could ever have caught F46: the fakes were built with the
 * post-fix method names from the start, so they never exercised the one place the actual defect
 * lived -- `SourceAclCache implements` all three evaluator ports *at once*, and a real
 * `apps/smtp-ingress` process hands one instance to all three `EsmtpServerOptions` slots via
 * `bindSourceAclCache()`. This file builds a real `SourceAclCache` (against a fake
 * `SourceAclLookup` -- no database needed, same posture `source-acl-cache.test.ts` already takes),
 * calls the production `bindSourceAclCache()`, and drives a real client over a real loopback socket
 * through it. Before `JR-4-20`, the `RCPT TO` case below answered `451` (the recipient address ran
 * through the connect-time IP matcher and threw), never `250`.
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

class FakeLookup implements SourceAclLookup {
	constructor(private readonly rows: readonly JournalingSourceAclEntry[]) {}
	async listActiveSources(): Promise<readonly JournalingSourceAclEntry[]> {
		return this.rows;
	}
}

const SOURCE_ID = 'wiring-source-1';
const CHAIN_SCOPE_ID = 'wiring-chain-1';
const ROUTING_ADDRESS = 'journal-wiring@journaling.test.invalid';

/** Buffered, repeatable CRLF-line reader -- same shape as
 * `smtp-recipient-acl-protocol.test.ts`'s `LineReader`, needed because this test reads a reply
 * after each of several commands on one connection. */
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

async function send(socket: Socket, reader: LineReader, line: string): Promise<string> {
	socket.write(`${line}\r\n`);
	return reader.nextLine();
}

suite('ci', 'bindSourceAclCache wired into a real EsmtpServer over the wire (F46, JR-4-20)', () => {
	it('RCPT TO the seeded routing address reaches 250 -- the F46 regression: pre-fix, this same production wiring answered 451 for every recipient', async () => {
		const cache = new SourceAclCache({
			lookup: new FakeLookup([
				{
					id: SOURCE_ID,
					chainScopeId: CHAIN_SCOPE_ID,
					allowedIps: ['127.0.0.1/32', '::1/128'],
					requireTls: false,
					routingAddress: ROUTING_ADDRESS,
					smtpUsername: null,
					smtpPasswordHash: null,
				},
			]),
			refreshIntervalMs: 60_000,
			staleAfterMs: 60_000,
		});
		await cache.start();

		try {
			const smtp = smtpServerConfigSchema.parse({});
			const options: EsmtpServerOptions = {
				smtp,
				// The exact production call (`apps/smtp-ingress/src/index.ts`), not a hand-written
				// fake -- see this file's module doc comment.
				...bindSourceAclCache(cache),
			};
			const server = new EsmtpServer(options);
			openServers.push(server);
			await server.listen(0, '127.0.0.1');
			const address = server.address;
			if (address === null) {
				throw new Error('server did not bind');
			}

			const socket = connectTcp(address.port, '127.0.0.1');
			openSockets.push(socket);
			await new Promise<void>((resolve, reject) => {
				socket.once('connect', () => resolve());
				socket.once('error', reject);
			});
			const reader = new LineReader(socket);

			expect(await reader.nextLine()).toMatch(/^220 /); // source ACL admits 127.0.0.1
			expect(await send(socket, reader, 'HELO client.example.com')).toMatch(/^250/);
			expect(await send(socket, reader, 'MAIL FROM:<sender@example.com>')).toMatch(/^250/);

			const knownRecipient = await send(socket, reader, `RCPT TO:<${ROUTING_ADDRESS}>`);
			expect(knownRecipient).toMatch(/^250 2\.1\.5/);

			const unknownRecipient = await send(
				socket,
				reader,
				'RCPT TO:<unknown@journaling.test.invalid>'
			);
			expect(unknownRecipient).toMatch(/^550 5\.1\.1/);
		} finally {
			cache.stop();
		}
	});
});
