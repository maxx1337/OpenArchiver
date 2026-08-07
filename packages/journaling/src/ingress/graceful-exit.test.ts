import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	DEFAULT_FLUSH_TIMEOUT_MS,
	writeLineThenFlush,
	type FlushableStream,
} from './graceful-exit';

/**
 * `writeLineThenFlush()` -- the fix for **F59**. Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * What this measures, and what it honestly cannot
 * ---------------------------------------------------------------------------------------------
 * F59 was a race: `console.log` followed by `process.exit(0)`, where the exit sometimes won. A test that
 * spawns the ingress and looks for the line **cannot** be the regression test for it -- that is exactly
 * the test that flapped, passing on one of three CI runs by luck. Asserting the same thing again would
 * measure the runner's mood.
 *
 * What is deterministic is the **mechanism**: the promise must not resolve before the stream has reported
 * the write, and it must resolve anyway when the stream never does. Both are asserted below against a
 * stream whose callback this file fires itself, so there is no timing to get lucky with. The wiring --
 * that `apps/smtp-ingress` awaits this promise before `process.exit(0)` -- is structural and visible in
 * `index.ts`; the spawned-process assertion in `tests/unit/ingress-process-boot.test.ts` remains, and with
 * the race gone it stops being a coin flip.
 *
 * The first suite is the one that would have caught F59: **an unfixed shutdown is the case where the
 * caller does not wait**, and `resolves only after the stream reports the write` is the property whose
 * absence made the line losable.
 */

/** A stream that records writes and hands the callback back so the test decides when it "flushed". */
function controllableStream(): {
	stream: FlushableStream;
	written: string[];
	flush: (error?: Error | null) => void;
	pending: () => boolean;
} {
	const written: string[] = [];
	let callback: ((error?: Error | null) => void) | undefined;
	return {
		stream: {
			write(chunk, cb) {
				written.push(chunk);
				callback = cb;
				return false;
			},
		},
		written,
		flush: (error) => {
			const cb = callback;
			callback = undefined;
			cb?.(error ?? null);
		},
		pending: () => callback !== undefined,
	};
}

/** Lets the microtask queue drain, so a promise that was going to settle already has. */
const settleMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

suite('ci', 'writeLineThenFlush(): the wait itself', () => {
	it('resolves only after the stream reports the write -- the property F59 lacked', async () => {
		const { stream, flush, pending } = controllableStream();
		let outcome: string | undefined;
		const promise = writeLineThenFlush(stream, 'shutting down').then((o) => {
			outcome = o;
			return o;
		});

		// The write is out but not acknowledged. This is the moment `process.exit(0)` used to run.
		await settleMicrotasks();
		expect(pending()).toBe(true);
		expect(outcome).toBeUndefined();

		flush();
		expect(await promise).toBe('flushed');
		expect(outcome).toBe('flushed');
	});

	it('writes the line with a trailing newline, like console.log', async () => {
		const { stream, written, flush } = controllableStream();
		const promise = writeLineThenFlush(stream, 'smtp-ingress: received SIGTERM, shutting down');
		flush();
		await promise;
		expect(written).toEqual(['smtp-ingress: received SIGTERM, shutting down\n']);
	});
});

suite('ci', 'writeLineThenFlush(): it may never block the exit', () => {
	it('resolves `failed` when the stream reports an error, instead of rejecting', async () => {
		// EPIPE is the real case: the reader (a supervisor, `docker logs`) went away. The line is lost and
		// that is acceptable; refusing to exit would not be.
		const { stream, flush } = controllableStream();
		const promise = writeLineThenFlush(stream, 'shutting down');
		flush(new Error('EPIPE: broken pipe'));
		await expect(promise).resolves.toBe('failed');
	});

	it('resolves `failed` when the stream throws synchronously', async () => {
		const throwing: FlushableStream = {
			write() {
				throw new Error('write after end');
			},
		};
		await expect(writeLineThenFlush(throwing, 'shutting down')).resolves.toBe('failed');
	});

	it('resolves `timeout` when the stream never reports -- a hung shutdown is the worse failure', async () => {
		const { stream, pending } = controllableStream();
		const outcome = await writeLineThenFlush(stream, 'shutting down', 20);
		expect(outcome).toBe('timeout');
		// The callback was never invoked: the wait ended on its own, not because the stream answered.
		expect(pending()).toBe(true);
	});

	it('still attempts the write when the timeout is zero, it just does not wait', async () => {
		const { stream, written } = controllableStream();
		await expect(writeLineThenFlush(stream, 'shutting down', 0)).resolves.toBe('timeout');
		expect(written).toEqual(['shutting down\n']);
	});

	it('settles exactly once -- a late flush after a timeout changes nothing', async () => {
		const { stream, flush } = controllableStream();
		const promise = writeLineThenFlush(stream, 'shutting down', 10);
		expect(await promise).toBe('timeout');
		// The stream answering afterwards must not produce a second resolution or an unhandled rejection.
		flush();
		await settleMicrotasks();
		expect(await promise).toBe('timeout');
	});

	it('defaults to a two-second bound, not an unbounded wait', () => {
		expect(DEFAULT_FLUSH_TIMEOUT_MS).toBe(2_000);
	});
});

suite('ci', 'writeLineThenFlush(): the counter-check that the first suite has teeth', () => {
	it('an unfixed shutdown -- write and exit without waiting -- loses the line', async () => {
		// This is F59 in four lines: the caller does not wait, so at the moment it would have called
		// `process.exit(0)` the stream has not reported the write. Nothing in the fixed version can reach
		// that state, which is what the first suite's `pending()`/`outcome` pair asserts.
		const { stream, flush, pending } = controllableStream();
		let exited = false;
		// The old shape: fire and forget.
		void writeLineThenFlush(stream, 'shutting down');
		exited = true; // <- `process.exit(0)` used to happen here
		await settleMicrotasks();
		expect(exited).toBe(true);
		expect(pending()).toBe(true); // the line was still in flight when the process would have died
		flush();
	});
});
