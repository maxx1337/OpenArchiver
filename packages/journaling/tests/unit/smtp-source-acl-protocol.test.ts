import { connect as connectTcp, type Socket } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	EsmtpServer,
	type EsmtpServerOptions,
	type IngressLogger,
	type SourceAclDecision,
	type SourceAclEvaluator,
} from '../../src/ingress/smtp-server';
import { smtpServerConfigSchema } from '../../src/ingress/smtp-config';

/**
 * `JR-4-05a` -- the source ACL gate proven over a real TCP connection.
 *
 * ---------------------------------------------------------------------------------------------
 * Why a wire-level test, in addition to `../../src/ingress/source-acl-cache.test.ts` and
 * `../../src/ingress/cidr.test.ts`
 * ---------------------------------------------------------------------------------------------
 * The Product Owner's task note for this slice was explicit: "a test that only checks the
 * comparison function does not prove the acceptance criterion -- both are required." The unit
 * tests above prove `SourceAclCache.evaluate()`/`matchesCidr()` are correct in isolation; this file
 * proves a real client, connecting over a real socket, is actually rejected **before** the `220`
 * greeting (never offered `EHLO`, never able to attempt one) -- and that the two non-denial
 * outcomes (`unavailable`, no evaluator configured, allowed) still behave exactly as a sending MTA
 * would experience them. Classified `unit` rather than `integration` for the same reason
 * `smtp-server-protocol.test.ts`/`smtp-starttls-protocol.test.ts` already are: only an in-process
 * `net.Server` on a loopback port, no external service, no `DATABASE_URL`.
 *
 * `SourceAclCache` itself is not constructed here -- a hand-written `SourceAclEvaluator` fake
 * stands in for it, the same way `smtp-starttls-protocol.test.ts` proves the tighten-never-loosen
 * `RequireTlsResolver` contract with a hand-written resolver rather than a real `SourceAclCache`.
 * The cache's own refresh/staleness logic is `source-acl-cache.test.ts`'s job.
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

function fakeEvaluator(decision: SourceAclDecision): SourceAclEvaluator {
	return { evaluate: () => decision };
}

async function startServer(sourceAclEvaluator?: SourceAclEvaluator): Promise<{ port: number }> {
	const smtp = smtpServerConfigSchema.parse({});
	const options: EsmtpServerOptions = { smtp, logger: silentLogger, sourceAclEvaluator };
	const server = new EsmtpServer(options);
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

/** Resolves with the first CRLF-terminated line the socket delivers. */
function firstLine(socket: Socket): Promise<string> {
	return new Promise((resolve, reject) => {
		let buffered = '';
		const timer = setTimeout(() => {
			socket.off('data', onData);
			reject(new Error('timed out waiting for the first response line'));
		}, 2000);
		const onData = (chunk: Buffer): void => {
			buffered += chunk.toString('utf8');
			const idx = buffered.indexOf('\r\n');
			if (idx !== -1) {
				clearTimeout(timer);
				socket.off('data', onData);
				resolve(buffered.slice(0, idx));
			}
		};
		socket.on('data', onData);
	});
}

function waitForClose(socket: Socket): Promise<void> {
	if (socket.destroyed) {
		return Promise.resolve();
	}
	return new Promise((resolve) => socket.once('close', () => resolve()));
}

suite('ci', 'EsmtpServer source ACL gate over the wire (JR-4-05a)', () => {
	it('denied: 554 5.7.1, then the connection closes -- no 220 greeting is ever sent', async () => {
		const { port } = await startServer(fakeEvaluator({ kind: 'denied' }));
		const socket = await connectAndTrack(port);

		const line = await firstLine(socket);
		expect(line).toMatch(/^554 5\.7\.1/);
		expect(line).not.toContain('220');

		await waitForClose(socket);
		expect(socket.destroyed).toBe(true);
	});

	it('unavailable: 421 4.3.2 (never 554, never a bare 5xx) when the ACL is not currently known', async () => {
		const { port } = await startServer(fakeEvaluator({ kind: 'unavailable' }));
		const socket = await connectAndTrack(port);

		const line = await firstLine(socket);
		expect(line).toMatch(/^421 4\.3\.2/);

		await waitForClose(socket);
	});

	it('allowed: the ordinary 220 greeting still arrives -- the gate does not interfere with a legitimate sender', async () => {
		const { port } = await startServer(
			fakeEvaluator({
				kind: 'allowed',
				sourceId: 'source-1',
				chainScopeId: 'archive-1',
				requireTls: false,
			})
		);
		const socket = await connectAndTrack(port);

		const line = await firstLine(socket);
		expect(line).toMatch(/^220 /);
	});

	it('no sourceAclEvaluator configured: every connection is admitted -- pre-existing behaviour, unchanged', async () => {
		const { port } = await startServer(undefined);
		const socket = await connectAndTrack(port);

		const line = await firstLine(socket);
		expect(line).toMatch(/^220 /);
	});
});
