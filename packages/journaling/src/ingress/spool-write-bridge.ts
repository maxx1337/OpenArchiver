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
 * count queued *objects*, not bytes. Each object this bridge actually pushes to the stream is a
 * *batch* built up to {@link DEFAULT_FLUSH_THRESHOLD_BYTES} (see the next section), so a handful of
 * them in flight keeps the bridge's own contribution to memory use a small, constant multiple of one
 * flush batch -- nowhere near proportional to message size.
 *
 * ---------------------------------------------------------------------------------------------
 * Batching by bytes, not by push() call (`JR-4-21a`, finding F50)
 * ---------------------------------------------------------------------------------------------
 * {@link push} used to forward every call straight to the stream's own `push()` -- one object per
 * call. That is fine when a caller's calls are already large (a `BDAT` chunk, tens of kilobytes),
 * but `DataScanner` (`smtp-server.ts`) calls `onContent` -- and therefore this class's `push()` --
 * once per CRLF-terminated *line* of `DATA` content, and `writeDurableSpoolFile()`'s `for await` (in
 * `../spool/durable-write.ts`) makes one real `fs.promises.FileHandle.write()` syscall per object it
 * pulls off this stream. A message made of short lines (Exchange-Online-journaled Base64 attachments
 * wrap at 76 bytes, RFC 2045 section 6.8) therefore made one write syscall roughly every 76-or-so
 * bytes -- measured: 50 MB as 60-byte lines took ~54 s to write, the same 50 MB as 998-byte lines
 * (RFC 5321's own maximum line length) took ~4 s, a ~12.5x difference driven entirely by line count,
 * not byte count. `JR-3-02`'s own streaming design (avoid buffering the whole message) is the
 * correct call and stays exactly as it is; streaming *per line* was never the same decision as
 * streaming *per socket chunk*, and this fix is what closes that gap: {@link push} now accumulates
 * pushed chunks into an internal buffer and only calls the stream's own `push()` once the buffer
 * reaches {@link DEFAULT_FLUSH_THRESHOLD_BYTES} -- fewer, larger objects reach
 * `writeDurableSpoolFile()`'s `for await`, so it makes fewer, larger `write()` calls, regardless of
 * how short the lines that produced them were.
 *
 * This changes nothing about `writeDurableSpoolFile()` itself, `JR-3-02`'s dual fsync, the error
 * paths (`ENOSPC` etc.), or byte fidelity: the batched buffer is still exactly the same bytes, in the
 * same order, just concatenated before the stream sees them -- `Buffer.concat()` does not transform
 * a single byte. Backpressure is still bounded: the stream's own `highWaterMark` (object count) times
 * the byte threshold below is the worst case this bridge holds in memory at once, a small constant
 * regardless of message size, not "the whole message" -- see {@link DEFAULT_FLUSH_THRESHOLD_BYTES}'s
 * own doc comment for the chosen size. `end()`/`abort()` are updated to match: `end()` flushes
 * whatever is still buffered (a message does not lose its last, sub-threshold batch just because it
 * ended before filling one), `abort()` discards it (an aborted write does not care about bytes that
 * were never going to reach the stream anyway).
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

/**
 * How many bytes {@link SpoolWriteBridge.push} accumulates before handing a batch to the stream
 * (`JR-4-21a`, finding F50). Chosen in the 64-256 KiB range the finding itself names: large enough
 * that even a message made entirely of 60-byte lines needs a few thousand flushes instead of a few
 * hundred thousand `write()` calls, small enough that this bridge's own memory contribution stays a
 * small constant multiple of one batch, never proportional to message size -- the same O(1)-vs.-
 * message-size property `JR-3-02`'s streaming design exists to guarantee, now measured against a
 * short-line message specifically rather than only a long-line one.
 */
const DEFAULT_FLUSH_THRESHOLD_BYTES = 128 * 1024;

export class SpoolWriteBridge {
	private readonly readable: Readable;
	private paused = false;
	private ended = false;
	/** Chunks accumulated since the last flush -- see {@link flush}. Always empty immediately after
	 * a flush; never holds more than {@link flushThresholdBytes} worth of bytes for long, since a
	 * push that crosses the threshold flushes immediately, not on some later call. */
	private pending: Buffer[] = [];
	private pendingBytes = 0;

	constructor(
		private readonly callbacks: SpoolWriteBridgeCallbacks,
		highWaterMarkChunks: number = DEFAULT_HIGH_WATER_MARK_CHUNKS,
		private readonly flushThresholdBytes: number = DEFAULT_FLUSH_THRESHOLD_BYTES
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
	 * Push one chunk of already-dot-unstuffed (DATA) or raw (BDAT) content, in wire order.
	 * Accumulates into an internal buffer and only forwards a batch to the stream once
	 * {@link flushThresholdBytes} is reached (`JR-4-21a`, finding F50 -- see the module doc comment's
	 * "Batching by bytes" section); byte order and content are unchanged either way. Pauses the byte
	 * producer via {@link SpoolWriteBridgeCallbacks.onPause} the moment a flush finds the stream's
	 * own buffer full -- the caller must not keep pushing past that point until {@link
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
		this.pending.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		this.pendingBytes += chunk.byteLength;
		if (this.pendingBytes >= this.flushThresholdBytes) {
			this.flush();
		}
	}

	/**
	 * Concatenate everything accumulated since the last flush into one batch and hand it to the
	 * stream -- a no-op if nothing is pending. `Buffer.concat()` copies bytes into one new buffer but
	 * transforms none of them; byte fidelity (Randbedingung 3) is unaffected by batching, only the
	 * *shape* of the objects `writeDurableSpoolFile()`'s `for await` sees.
	 */
	private flush(): void {
		if (this.pendingBytes === 0) {
			return;
		}
		const batch =
			this.pending.length === 1
				? this.pending[0]!
				: Buffer.concat(this.pending, this.pendingBytes);
		this.pending = [];
		this.pendingBytes = 0;
		const wantsMore = this.readable.push(batch);
		// Guarded by `!this.paused`, for the same reason `push()` used to guard its own direct
		// `readable.push()` call before this batching existed: once the stream's buffer is at or over
		// `highWaterMark`, every further flush's `push()` also returns `false` (Node keeps accepting
		// pushes past the mark, it just keeps saying so), and this keeps `onPause`/`onResume` call
		// counts meaningfully paired for a caller that wants to log or count them.
		if (!wantsMore && !this.paused) {
			this.paused = true;
			this.callbacks.onPause();
		}
	}

	/** Signal a normal end of content -- flushes whatever is still buffered below
	 * {@link flushThresholdBytes} (a message must not lose its last, sub-threshold batch just because
	 * it ended before filling one), then the consumer's `for await` loop ends and
	 * `writeDurableSpoolFile()` proceeds to `fsync()`. */
	end(): void {
		this.ended = true;
		this.flush();
		this.readable.push(null);
	}

	/**
	 * Abort the in-flight write: the consumer's `for await` loop rejects with `reason` on its next
	 * iteration (Node's documented behaviour for a destroyed `Readable`'s async iterator). See the
	 * module doc comment's "Ending a transaction" section for why this -- rather than a graceful
	 * `end()` -- is required for the oversize case, and `durable-write.ts`'s F45 fix for why the
	 * rejection reaches the caller as a typed `DurableWriteError` rather than a bare `Error`.
	 *
	 * Discards whatever is still buffered rather than flushing it -- unlike {@link end}, there is no
	 * later reader that will ever see it: the whole write is being rejected, not completed.
	 */
	abort(reason: Error): void {
		this.ended = true;
		this.pending = [];
		this.pendingBytes = 0;
		this.readable.destroy(reason);
	}
}
