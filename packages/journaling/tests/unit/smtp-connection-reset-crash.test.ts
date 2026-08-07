import { connect as connectTcp, type Socket } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { coverageNotice } from '@oa-test/notice';
import {
	EsmtpServer,
	type EsmtpServerOptions,
	type IngressLogger,
	type SourceAclDecision,
	type SourceAclEvaluator,
} from '../../src/ingress/smtp-server';
import { smtpServerConfigSchema } from '../../src/ingress/smtp-config';

/**
 * **F61** -- a reset connection must not take the receiver down. Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * What was wrong, and how it was found
 * ---------------------------------------------------------------------------------------------
 * `EsmtpServer.handleConnection()`'s three rejection paths (`denied`, `unavailable`, connection limit)
 * answer with `socket.end(text)` and return **without constructing a `SmtpConnection`** -- and the only
 * `'error'` listener in the whole connection path lives in that class's constructor. A `net.Socket`
 * with no `'error'` listener does not swallow the error: `EventEmitter` throws it, and an uncaught
 * exception in the accept path ends the process.
 *
 * It surfaced sideways. `ingress-process-boot.test.ts` kept going red on CI with
 * `expected … to contain 'shutting down'`, which looked like a lost log line (**F59**) and was
 * "fixed" as one -- twice, because the failure message reported only `stdout`. Once it also reported the
 * **exit code, the signal and `stderr`**, the answer was immediate and different:
 *
 * ```
 * exit code 1, terminating signal null
 * node:events:497   throw er; // Unhandled 'error' event
 * Error: read ECONNRESET   at TCP.onStreamRead
 * ```
 *
 * The process never reached its `SIGTERM` handler, so the missing line was a **symptom**. The lesson is
 * the diagnostic, not the bug: an assertion that reports one of three available observations sends its
 * reader after the wrong cause, and it did so for two rounds of fixing.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this test is deterministic where the one that found it was not
 * ---------------------------------------------------------------------------------------------
 * `socket.resetAndDestroy()` sends a **TCP RST**, rather than the orderly FIN a plain `destroy()` may
 * produce. The peer's next read then fails with `ECONNRESET` every time instead of sometimes, so the
 * crash is provoked rather than waited for.
 *
 * Before the fix these cases fail hard: the unhandled `'error'` becomes an uncaught exception in this
 * process, which vitest reports against the file. After it, the server logs and keeps serving -- which is
 * what the second assertion of each case checks, because "did not crash" alone would also be true of a
 * server that had silently stopped accepting.
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

/** Records warnings so a case can prove the error was *handled*, not merely absent. */
function recordingLogger(): { logger: IngressLogger; warnings: unknown[] } {
	const warnings: unknown[] = [];
	return {
		logger: {
			debug: () => {},
			info: () => {},
			warn: (obj: unknown) => {
				warnings.push(obj);
			},
			error: () => {},
		} as IngressLogger,
		warnings,
	};
}

function fakeEvaluator(decision: SourceAclDecision): SourceAclEvaluator {
	return { evaluate: () => decision };
}

async function startServer(
	logger: IngressLogger,
	sourceAclEvaluator?: SourceAclEvaluator
): Promise<number> {
	const smtp = smtpServerConfigSchema.parse({});
	const options: EsmtpServerOptions = { smtp, logger, sourceAclEvaluator };
	const server = new EsmtpServer(options);
	openServers.push(server);
	await server.listen(0, '127.0.0.1');
	const address = server.address;
	if (address === null) {
		throw new Error('server did not bind');
	}
	return address.port;
}

/** Connect, then immediately send an RST -- the shape a rejected client produces when it gives up. */
async function connectThenReset(port: number): Promise<void> {
	const socket = connectTcp(port, '127.0.0.1');
	openSockets.push(socket);
	await new Promise<void>((resolve, reject) => {
		socket.once('connect', () => resolve());
		socket.once('error', reject);
	});
	socket.resetAndDestroy();
	await new Promise<void>((resolve) => socket.once('close', () => resolve()));
}

/** Prove the server is still accepting: a fresh connection gets a first line back. */
async function stillServing(port: number, timeoutMs = 2000): Promise<string> {
	const socket = connectTcp(port, '127.0.0.1');
	openSockets.push(socket);
	return new Promise<string>((resolve, reject) => {
		let buffered = '';
		const timer = setTimeout(
			() => reject(new Error('no response line after the reset')),
			timeoutMs
		);
		socket.on('data', (chunk: Buffer) => {
			buffered += chunk.toString('utf8');
			const idx = buffered.indexOf('\r\n');
			if (idx !== -1) {
				clearTimeout(timer);
				resolve(buffered.slice(0, idx));
			}
		});
		socket.once('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

/**
 * Give the event loop a few turns. An unhandled `'error'` arrives asynchronously, so a case that
 * returned immediately after the reset could finish before the crash it is meant to provoke.
 */
const drainEventLoop = async (): Promise<void> => {
	for (let i = 0; i < 5; i += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
};

suite('ci', 'EsmtpServer survives a reset connection (F61)', () => {
	it('denied: a client that resets while being refused does not kill the receiver', async () => {
		// The severe case: `denied` is the path taken by every IP that is *not* on the ACL, so this is
		// reachable by anyone who can reach the port at all.
		const { logger, warnings } = recordingLogger();
		const port = await startServer(logger, fakeEvaluator({ kind: 'denied' }));

		await connectThenReset(port);
		await drainEventLoop();

		expect(await stillServing(port)).toMatch(/^554 5\.7\.1/);
		coverageNotice(
			`[F61] denied-path reset survived; ${warnings.length} warning(s) logged by the server`
		);
	});

	it('unavailable: the fail-closed path survives a reset too', async () => {
		// This is the exact configuration `ingress-process-boot.test.ts` runs in (no reachable ACL
		// database, so the cache reports `unavailable`) -- i.e. the path that actually crashed on CI.
		const { logger } = recordingLogger();
		const port = await startServer(logger, fakeEvaluator({ kind: 'unavailable' }));

		await connectThenReset(port);
		await drainEventLoop();

		expect(await stillServing(port)).toMatch(/^421 4\.3\.2/);
	});

	it('logs the socket error instead of only not crashing', async () => {
		// "It did not crash" would also hold for a server that swallowed the error silently. The warning
		// is what makes the handling visible to an operator.
		const { logger, warnings } = recordingLogger();
		const port = await startServer(logger, fakeEvaluator({ kind: 'denied' }));

		await connectThenReset(port);
		await drainEventLoop();

		const serialised = JSON.stringify(warnings);
		expect(serialised).toContain('ECONNRESET');
		expect(warnings.length).toBeGreaterThan(0);
	});

	it('an accepted connection also survives a reset -- SmtpConnection owns it by then', async () => {
		// No source ACL configured at all: `handleConnection` constructs a `SmtpConnection`, which attaches
		// its own handler. Included so the fix cannot be mistaken for something that only matters on the
		// rejection paths -- and so a future refactor that moves the guard cannot quietly drop this case.
		const { logger } = recordingLogger();
		const port = await startServer(logger);

		await connectThenReset(port);
		await drainEventLoop();

		expect(await stillServing(port)).toMatch(/^220 /);
	});

	it('survives a burst of resets -- the denial-of-service shape', async () => {
		// One reset proves the listener exists. Twenty in a row prove nothing accumulates: a per-connection
		// listener that was attached but never released would show up here as a warning storm or a leak,
		// and a server that died on the third would fail the final assertion.
		const { logger } = recordingLogger();
		const port = await startServer(logger, fakeEvaluator({ kind: 'denied' }));

		for (let i = 0; i < 20; i += 1) {
			await connectThenReset(port);
		}
		await drainEventLoop();

		expect(await stillServing(port)).toMatch(/^554 5\.7\.1/);
	});
});
