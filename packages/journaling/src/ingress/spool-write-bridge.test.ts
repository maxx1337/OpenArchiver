import { expect, it, vi } from 'vitest';
import { suite } from '@oa-test/classification';
import { SpoolWriteBridge } from './spool-write-bridge';

/**
 * `SpoolWriteBridge` (`JR-4-06a`, batching added in `JR-4-21a` for finding F50) -- the push-to-pull
 * bridge with backpressure between a socket's `data` events and `writeDurableSpoolFile()`'s
 * `for await`. See that file's module doc comment for the full design; this file proves the
 * load-bearing properties directly: chunks arrive in order and byte-identical, small pushes are
 * batched by byte threshold rather than forwarded one-for-one, a full internal buffer pauses the
 * source, the source resumes once the consumer drains it, and both ways of ending a transaction
 * (`end()`/`abort()`) behave as documented.
 *
 * Several cases below pass an explicit `flushThresholdBytes` of `1` -- effectively disabling
 * batching (every push is at least 1 byte, so every push flushes immediately) -- specifically to
 * isolate the chunk-*count* high-water-mark property (`highWaterMarkChunks`) from the byte-threshold
 * batching this file also tests; the two are independent knobs and deserve independent proof.
 */

async function collect(iterable: AsyncIterable<Uint8Array>): Promise<Buffer[]> {
	const out: Buffer[] = [];
	for await (const chunk of iterable) {
		out.push(Buffer.from(chunk));
	}
	return out;
}

suite('ci', 'SpoolWriteBridge', () => {
	it('delivers pushed chunks to the consumer in order, verbatim (batching disabled via flushThresholdBytes: 1)', async () => {
		const bridge = new SpoolWriteBridge(
			{ onPause: () => {}, onResume: () => {} },
			undefined,
			1
		);
		const consumed = collect(bridge.chunks);

		bridge.push(Buffer.from('one'));
		bridge.push(Buffer.from('two'));
		bridge.push(Buffer.from('three'));
		bridge.end();

		const chunks = await consumed;
		expect(chunks.map((c) => c.toString())).toEqual(['one', 'two', 'three']);
	});

	it('batches pushes smaller than the flush threshold into fewer, larger chunks, without losing or reordering a single byte (JR-4-21a, F50)', async () => {
		const bridge = new SpoolWriteBridge(
			{ onPause: () => {}, onResume: () => {} },
			undefined,
			10
		);
		const consumed = collect(bridge.chunks);

		// 'ab' + 'cd' + 'ef' = 6 bytes, under the threshold of 10 -- nothing flushed yet. 'ghij' (4
		// bytes) brings the running total to exactly 10, crossing the threshold: all four pushes so
		// far are flushed together as one batch. 'k' alone (1 byte) stays buffered until end().
		bridge.push(Buffer.from('ab'));
		bridge.push(Buffer.from('cd'));
		bridge.push(Buffer.from('ef'));
		bridge.push(Buffer.from('ghij'));
		bridge.push(Buffer.from('k'));
		bridge.end();

		const chunks = await consumed;
		expect(chunks.map((c) => c.toString())).toEqual(['abcdefghij', 'k']);
	});

	it('flushes whatever is buffered on end(), even below the threshold -- a message does not lose its last, sub-threshold batch', async () => {
		const bridge = new SpoolWriteBridge(
			{ onPause: () => {}, onResume: () => {} },
			undefined,
			1_000
		);
		const consumed = collect(bridge.chunks);
		bridge.push(Buffer.from('partial, under the threshold'));
		bridge.end();
		const chunks = await consumed;
		expect(chunks.map((c) => c.toString())).toEqual(['partial, under the threshold']);
	});

	it('abort() discards whatever was still buffered below the threshold -- it never reaches the consumer', async () => {
		const bridge = new SpoolWriteBridge(
			{ onPause: () => {}, onResume: () => {} },
			undefined,
			1_000
		);
		const reason = new Error('oversize: aborting in-flight spool write');
		const consuming = (async () => {
			const seen: string[] = [];
			for await (const chunk of bridge.chunks) {
				seen.push(Buffer.from(chunk).toString());
			}
			return seen;
		})();
		bridge.push(Buffer.from('buffered but never flushed'));
		bridge.abort(reason);
		await expect(consuming).rejects.toBe(reason);
	});

	it('end() with nothing ever pushed yields an empty, cleanly-finished iteration (an empty message body)', async () => {
		const bridge = new SpoolWriteBridge({ onPause: () => {}, onResume: () => {} });
		const consumed = collect(bridge.chunks);
		bridge.end();
		expect(await consumed).toEqual([]);
	});

	it('pauses the source once the internal buffer fills, and resumes once the consumer drains it', async () => {
		const onPause = vi.fn();
		const onResume = vi.fn();
		// flushThresholdBytes: 1 -- batching disabled (see the module doc comment), so this test's
		// five tiny pushes each flush individually and the chunk-count high-water-mark below is what
		// this test isolates, not byte batching.
		const bridge = new SpoolWriteBridge({ onPause, onResume }, 2, 1);

		// Five pushes against a highWaterMark of 2, with nothing consumed yet: the buffer fills past
		// the mark and stays there. `onPause` fires exactly once (see `push()`'s doc comment for why
		// repeat over-the-mark pushes do not each re-trigger it), and `onResume` has no reason to fire
		// yet -- nothing has been consumed.
		const produced = ['chunk-0', 'chunk-1', 'chunk-2', 'chunk-3', 'chunk-4'];
		for (const chunk of produced) {
			bridge.push(Buffer.from(chunk));
		}
		expect(onPause).toHaveBeenCalledTimes(1);
		expect(onResume).not.toHaveBeenCalled();

		// Drive the async iterator by hand (rather than `collect()`, so `end()` can be called only
		// after every already-buffered chunk has actually been drained).
		const iterator = bridge.chunks[Symbol.asyncIterator]();
		const drained: string[] = [];
		for (let i = 0; i < produced.length; i += 1) {
			const { value, done } = await iterator.next();
			expect(done).toBe(false);
			drained.push(Buffer.from(value as Uint8Array).toString());
		}
		expect(drained).toEqual(produced);

		// Node's Readable calls `_read()` (this bridge's `onResume` trigger) once the internal buffer
		// has room again, somewhere during that drain -- exactly once, matching `onPause`.
		expect(onResume).toHaveBeenCalledTimes(1);

		bridge.end();
		expect((await iterator.next()).done).toBe(true);
	});

	it("abort() makes the consumer's for-await reject with the given reason, mid-iteration", async () => {
		const bridge = new SpoolWriteBridge({ onPause: () => {}, onResume: () => {} });
		const reason = new Error('oversize: aborting in-flight spool write');

		const consuming = (async () => {
			const seen: string[] = [];
			for await (const chunk of bridge.chunks) {
				seen.push(Buffer.from(chunk).toString());
			}
			return seen;
		})();

		bridge.push(Buffer.from('partial'));
		bridge.abort(reason);

		await expect(consuming).rejects.toBe(reason);
	});

	it('push() after end()/abort() is a no-op rather than throwing (defensive only)', async () => {
		const bridge = new SpoolWriteBridge({ onPause: () => {}, onResume: () => {} });
		const consumed = collect(bridge.chunks);
		bridge.push(Buffer.from('one'));
		bridge.end();
		// Any further push is defensive-only in production (SmtpConnection never does this) and must
		// not resurrect a stream that has already been told it is done.
		expect(() => bridge.push(Buffer.from('late'))).not.toThrow();
		expect((await consumed).map((c) => c.toString())).toEqual(['one']);
	});
});
