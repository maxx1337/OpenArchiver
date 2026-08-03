import { Readable } from 'node:stream';

/**
 * Bridge a push-based byte source (an SMTP socket's `data` events) into the pull-based
 * `AsyncIterable<Uint8Array>` `JournalAcceptance.accept()`/`writeDurableSpoolFile()` expect
 * (`JR-4-06a`).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------------------------
 * `writeDurableSpoolFile()` (`JR-3-02`) is written against `for await (const chunk of chunks)` --
 * streamed, no full-message buffering, real backpressure between the consumer (the spool writer)
 * asking for the next chunk and the producer supplying it. That is the correct shape for a caller
 * that already holds an `AsyncIterable`, e.g. a test's async generator over fixed fixtures.
 *
 * `SmtpConnection` (`./smtp-server.ts`) does not hold one: bytes arrive as `Buffer`s pushed
 * synchronously off `net.Socket`'s `data` event, inside {@link DataScanner}/{@link
 * BdatContentTracker}'s `onContent` callback, with no `await` anywhere in that call stack. **The
 * naive bridge -- collect every chunk into an array, then hand `writeDurableSpoolFile()` an async
 * generator over that array once the message ends -- defeats the entire point of `JR-3-02`: a
 * 150 MB message would sit fully buffered in this process's heap for the whole transfer, exactly
 * the property `durable-write.test.ts`'s 150 MB case exists to rule out.** This class is the
 * actual bridge: content is pushed in as it is read off the wire, pulled out by
 * `writeDurableSpoolFile()`'s `for await` as fast as (and no faster than) the spool writer can
 * keep up, and never held anywhere else in between.
 *
 * ---------------------------------------------------------------------------------------------
 * Backpressure, not just streaming
 * ---------------------------------------------------------------------------------------------
 * A `node:stream.Readable` in object mode is the bridge: {@link push} calls the stream's own
 * `push()`, which returns `false` once its internal buffer reaches `highWaterMark` -- at that
 * point the *caller* (this class's `onPause` callback, wired by `SmtpConnection` to
 * `socket.pause()`) must stop producing until the stream's `read()` implementation below signals
 * demand again (`onResume`, wired to `socket.resume()`). `Readable`'s own async-iterator protocol
 * (what `for await` uses) is what drives `read()`: it only asks for the next chunk once the
 * previous one has been consumed by `writeDurableSpoolFile()`'s loop body (`handle.write()` +
 * `hash.update()`), so a slow spool disk genuinely throttles the TCP socket via `socket.pause()`
 * rather than an ever-growing in-process buffer standing in for the disk's own backlog.
 *
 * `highWaterMarkChunks` defaults to a small number of chunks, not bytes -- object-mode streams
 * count queued *objects*, not bytes. Each pushed object here is one socket read's worth of
 * content (bounded by the kernel's own receive-buffer-driven read size, typically tens of
 * kilobytes), so a handful of them in flight keeps the bridge's own contribution to memory use a
 * small, constant multiple of one socket read -- nowhere near proportional to message size.
 *
 * ---------------------------------------------------------------------------------------------
 * Ending a transaction: graceful end vs. abort
 * ---------------------------------------------------------------------------------------------
 * {@link end} is the ordinary case: the terminator (`DATA`) or `BDAT ... LAST` (`BDAT`) was found,
 * every content byte has already been pushed, and the durable write should complete normally.
 *
 * {@link abort} is `JR-4-16`/`JR-4-06a`'s oversize case: the SMTP layer decided mid-transfer that
 * this message must be rejected (`552 5.3.4`), but `writeDurableSpoolFile()` may already be
 * mid-write with no cancellation token of its own -- the only way to stop it is to make its
 * `chunks` iterable fail. `durable-write.ts`'s `F45` fix (`JR-4-06a`) is what makes that failure
 * surface as a typed `DurableWriteError('write', ...)` rather than a bare, uncaught `Error` --
 * see that module's doc comment. `SmtpConnection.finalizeAcceptance` is the one place in the
 * whole system allowed to then override whatever `accept()` settles to for an aborted transaction
 * with `552`, regardless of the typed result underneath -- see that method's own doc comment.
 */

export interface SpoolWriteBridgeCallbacks {
	/** The bridge's internal buffer is full; the byte producer (the socket) must pause. */
	readonly onPause: () => void;
	/** The bridge is ready for more; the byte producer may resume. */
	readonly onResume: () => void;
}

/** Small and chunk-counted, not byte-counted -- see the module doc comment. */
const DEFAULT_HIGH_WATER_MARK_CHUNKS = 4;

export class SpoolWriteBridge {
	private readonly readable: Readable;
	private paused = false;
	private ended = false;

	constructor(
		private readonly callbacks: SpoolWriteBridgeCallbacks,
		highWaterMarkChunks: number = DEFAULT_HIGH_WATER_MARK_CHUNKS
	) {
		this.readable = new Readable({
			objectMode: true,
			highWaterMark: highWaterMarkChunks,
			// Node calls this whenever the stream wants more data than its internal buffer currently
			// holds -- i.e. exactly the "resume the source" signal. The first call (before anything
			// was ever pushed) finds `paused` still `false` and is a harmless no-op.
			read: () => {
				if (this.paused) {
					this.paused = false;
					this.callbacks.onResume();
				}
			},
		});
		// `destroy(reason)` (see `abort()` below) makes the *consumer's* `for await` reject with
		// `reason` -- that is the channel `writeDurableSpoolFile()`/`accept()` are meant to see it
		// through, and the only one this class documents. Node's `Readable` *also* emits a separate
		// `'error'` event on the stream object itself when destroyed with a reason, independently of
		// the async-iterator rejection; `EventEmitter`'s own default behaviour for an `'error'` event
		// with no listener is to throw it as an uncaught exception, which would crash the whole
		// process over a condition (an oversize message, or an abandoned mid-BDAT transaction) that is
		// not process-fatal at all. This listener exists purely to be present -- the error is already
		// handled via the rejected iteration, so nothing further needs to happen here.
		this.readable.on('error', () => {});
	}

	/** What `JournalTransactionInput.chunks` / `DurableWriteRequest.chunks` consume. */
	get chunks(): AsyncIterable<Uint8Array> {
		return this.readable;
	}

	/**
	 * Push one chunk of already-dot-unstuffed (DATA) or raw (BDAT) content, in wire order. Pauses
	 * the byte producer via {@link SpoolWriteBridgeCallbacks.onPause} the moment the internal buffer
	 * is full -- the caller must not keep pushing past that point until {@link
	 * SpoolWriteBridgeCallbacks.onResume} fires.
	 *
	 * A no-op once {@link end}/{@link abort} has been called -- defensive only: `SmtpConnection`
	 * never pushes after either (both are called exactly once, at the point the transaction's
	 * content is known to be complete or rejected).
	 */
	push(chunk: Uint8Array): void {
		if (this.ended) {
			return;
		}
		const wantsMore = this.readable.push(chunk);
		// Guarded by `!this.paused`: once the buffer is at or over `highWaterMark`, every further
		// push() also returns `false` (Node keeps accepting pushes past the mark, it just keeps
		// saying so) -- without the guard, a single socket `data` event that hands
		// `DataScanner`/`BdatContentTracker` several already-buffered content lines at once (each
		// calling this method synchronously) would call `onPause` -- i.e. `socket.pause()` -- once per
		// line instead of once per pause cycle. Harmless either way (`pause()` is idempotent) but
		// noisy, and this keeps `onPause`/`onResume` call counts meaningfully paired for a caller that
		// wants to log or count them.
		if (!wantsMore && !this.paused) {
			this.paused = true;
			this.callbacks.onPause();
		}
	}

	/** Signal a normal end of content -- the consumer's `for await` loop ends and `writeDurableSpoolFile()` proceeds to `fsync()`. */
	end(): void {
		this.ended = true;
		this.readable.push(null);
	}

	/**
	 * Abort the in-flight write: the consumer's `for await` loop rejects with `reason` on its next
	 * iteration (Node's documented behaviour for a destroyed `Readable`'s async iterator). See the
	 * module doc comment's "Ending a transaction" section for why this -- rather than a graceful
	 * `end()` -- is required for the oversize case, and `durable-write.ts`'s F45 fix for why the
	 * rejection reaches the caller as a typed `DurableWriteError` rather than a bare `Error`.
	 */
	abort(reason: Error): void {
		this.ended = true;
		this.readable.destroy(reason);
	}
}
