import { createHash } from 'node:crypto';
import { ensureIncomingShardDir, incomingFilePath } from './layout';
import type { SpoolFileHandle, SpoolFileSystem } from './fs-port';

/**
 * The durable write (`JR-3-02`, RFC section 3 steps 2-4; skill `journal-ledger` section 1 steps 1-3).
 *
 * ---------------------------------------------------------------------------------------------
 * What this is, and what it deliberately is not
 * ---------------------------------------------------------------------------------------------
 * `writeDurableSpoolFile()` performs exactly the in-session part of the acceptance contract that
 * concerns the spool: write the raw wire bytes to `incoming/<shard>/<txid>.eml`, `fsync()` the file,
 * `fsync()` the containing directory, and compute `SHA-256` over exactly the bytes written -- all of
 * it streamed, none of it buffered in the heap as one block.
 *
 * It does **not** append to the ledger, does not decide an SMTP status code, and does not run the
 * high-water-mark check (`checkSpoolHighWaterMark()` in `./layout.ts`) -- wiring those together, in
 * the order the acceptance contract requires, is `JR-3-04`. This function is the primitive that
 * wiring calls once per transaction; it has no knowledge of SMTP, the ledger, or BullMQ.
 *
 * ---------------------------------------------------------------------------------------------
 * Streaming, not buffering
 * ---------------------------------------------------------------------------------------------
 * `request.chunks` is an `AsyncIterable<Uint8Array>` -- a Node `Readable` in object mode already
 * satisfies this, so a caller can hand over a socket stream directly. Each chunk is written to the
 * spool file handle and folded into the running `SHA-256` state as it arrives; nothing keeps a
 * reference to a chunk once its `write()` and `hash.update()` have both been awaited/called, and
 * nothing ever concatenates the whole message into one buffer. That is what makes the 150 MB
 * acceptance case (`durable-write.test.ts`, `nightly` class) a heap-flat operation rather than a
 * 150 MB allocation -- see that file for the two techniques used to demonstrate it, and their
 * respective limits.
 *
 * ---------------------------------------------------------------------------------------------
 * Never transform the bytes
 * ---------------------------------------------------------------------------------------------
 * Dot-unstuffing happens in the SMTP layer (E4), strictly before a chunk reaches this function --
 * this module writes whatever it is handed, verbatim, in order. No re-encoding, no normalising, no
 * trimming.
 *
 * ---------------------------------------------------------------------------------------------
 * Typed failure, by stage
 * ---------------------------------------------------------------------------------------------
 * A failure has to tell the caller *which* of the three durability steps did not complete, because
 * `JR-3-04` maps a spool failure to `451` (skill `journal-ledger` section 2) and may want to escalate
 * a specific cause (e.g. `ENOSPC`) to `452` instead -- {@link DurableWriteError.cause} carries the
 * original error untouched for exactly that. Three stages, matching the three independent failure
 * points `FakeSpoolFileSystem` exposes (`JR-3-03`):
 *
 *  - `'write'` -- covers directory creation, file creation, every `write()` call, **and (`JR-4-06a`)
 *    a failure of `chunks` itself**, i.e. the async source rejecting instead of a `write()` call
 *    rejecting. All four are "the bytes are not yet safely on disk" failures with the same required
 *    action (retry with a new transaction ID), so they share one stage rather than four.
 *  - `'file-fsync'` -- every byte was written, but the file descriptor was never confirmed durable.
 *  - `'directory-fsync'` -- the file itself is fully written *and* file-synced; only the directory
 *    entry's durability is unconfirmed. Worth its own stage because it is the failure mode the skill
 *    calls out as "the one that is easy to forget" -- a file fsync alone does not make a directory
 *    entry durable, and code that cannot tell this case apart from full success cannot honour that
 *    rule.
 *
 * ---------------------------------------------------------------------------------------------
 * `chunks` failing was unreachable until `JR-4-06a` gave it a real, live source (F45)
 * ---------------------------------------------------------------------------------------------
 * The module doc comment above promises "rejects with a `DurableWriteError`... and never with a
 * bare `Error`". That was quietly false for one path no test before `JR-4-06a` ever exercised: the
 * `for await (const chunk of chunks)` loop's own iteration -- getting the *next* chunk, as opposed to
 * `handle.write(chunk)` once one has arrived -- was not wrapped in any `try`/`catch` at all. Every
 * caller up to `JR-4-06a` passed an async generator over already-buffered test fixtures or a
 * harness-owned socket read that never itself rejected, so the gap stayed latent. `JR-4-06a` is the
 * first real caller: `apps/smtp-ingress` needs to abort an in-flight durable write when the SMTP
 * layer discovers mid-transfer that a message exceeds the configured `SIZE` limit (skill
 * `journal-ledger` section 2, `552 5.3.4`), and the only way to end an already-started `accept()` call
 * is through its `chunks` iterable (see `acceptance.ts`'s `JournalAcceptance.accept()` doc comment) --
 * there is no cancellation token. Ending it with a rejection (rather than a graceful `done: true`,
 * which would let a truncated write complete "successfully" and get a ledger receipt for content that
 * is not the real message) surfaced this gap immediately: the rejection propagated as a bare `Error`,
 * which `JournalAcceptance.accept()`'s `catch` block treats as "a programming error in the filesystem
 * seam itself" and rethrows uncaught -- exactly the crash `accept()`'s own doc comment says must never
 * happen for a local failure.
 *
 * The fix wraps the whole `for await` (not just `handle.write()`) in one `try`/`catch` that rewraps
 * anything that is not already a `DurableWriteError` as `DurableWriteError('write', cause)` -- the
 * existing `'write'` stage already covers "the bytes are not yet safely on disk", and a chunk source
 * that stops producing bytes mid-transfer is exactly that. This is deliberately *not* a new stage:
 * `apps/smtp-ingress`'s oversize-abort case must map to the ordinary `'spool-write-failed'` result
 * (`451`, retried by the sender) from `accept()`'s point of view -- the SMTP layer is the only thing
 * that knows this particular `'write'` failure was actually an oversize rejection, and it is also the
 * only thing that overrides `accept()`'s result for that one case (`552`, never `451`) -- see
 * `smtp-server.ts`'s `SmtpConnection.finalizeAcceptance` doc comment.
 */

/** Which of the three durability steps did not complete. See the module doc comment. */
export type DurableWriteStage = 'write' | 'file-fsync' | 'directory-fsync';

/**
 * Thrown by {@link writeDurableSpoolFile} when any durability step fails.
 *
 * `cause` is always the underlying error, untouched (a Node `ErrnoException` in production, or
 * whatever `SpoolFileSystem` was made to reject with in a test) -- `JR-3-04` can inspect it (e.g.
 * `cause.code === 'ENOSPC'`) for a finer status-code decision than `stage` alone gives it.
 */
export class DurableWriteError extends Error {
	readonly stage: DurableWriteStage;

	constructor(stage: DurableWriteStage, cause: unknown) {
		super(`durable spool write failed at stage "${stage}": ${describeCause(cause)}`, { cause });
		this.name = 'DurableWriteError';
		this.stage = stage;
	}
}

function describeCause(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export interface DurableWriteRequest {
	/** Spool root -- the same one `ensureSpoolLayout()` was called with at process start. */
	readonly spoolRoot: string;
	/** Transaction ID, assigned before this call (`generateTxId()` in `./txid.ts`). */
	readonly txid: string;
	/** Wire bytes, already dot-unstuffed. Any async source works, including a socket stream. */
	readonly chunks: AsyncIterable<Uint8Array>;
}

export interface DurableWriteResult {
	/** `incoming/<shard>/<txid>.eml` under `spoolRoot` -- see `incomingFilePath()` in `./layout.ts`. */
	readonly filePath: string;
	/** Sum of every chunk's length. `bigint` for the same reason `./layout.ts` sums usage as one. */
	readonly sizeBytes: bigint;
	/** SHA-256 over exactly the bytes written, computed while streaming -- never by re-reading the file. */
	readonly sha256: Uint8Array;
}

/**
 * Write one message durably to the spool. See the module doc comment for the full contract.
 *
 * Resolves only once both `fsync()` calls have completed -- that is the moment `250 OK` becomes
 * permissible one layer up (`JR-3-04`). Rejects with a {@link DurableWriteError} otherwise, and never
 * with a bare `Error`, so a caller cannot lose the stage distinction.
 */
export async function writeDurableSpoolFile(
	fs: SpoolFileSystem,
	request: DurableWriteRequest
): Promise<DurableWriteResult> {
	const { spoolRoot, txid, chunks } = request;
	const filePath = incomingFilePath(spoolRoot, txid);
	const hash = createHash('sha256');
	let sizeBytes = 0n;

	let shardDir: string;
	let handle: SpoolFileHandle;
	try {
		shardDir = await ensureIncomingShardDir(fs, spoolRoot, txid);
		handle = await fs.createFile(filePath);
	} catch (cause) {
		throw new DurableWriteError('write', cause);
	}

	try {
		try {
			for await (const chunk of chunks) {
				try {
					await handle.write(chunk);
				} catch (cause) {
					throw new DurableWriteError('write', cause);
				}
				// Folded in immediately, right after the write it corresponds to -- never batched, never
				// held onto past this point. This is the streaming half of the acceptance criterion.
				hash.update(chunk);
				sizeBytes += BigInt(chunk.byteLength);
			}
		} catch (cause) {
			// F45 (see the module doc comment): a rejection from *iterating* `chunks` -- as opposed to
			// one from `handle.write()`, already wrapped above -- used to escape as a bare `Error`.
			// Rethrow an already-typed failure as-is; wrap anything else the same way `handle.write()`'s
			// own catch above does, so this function keeps its "always a DurableWriteError" contract
			// regardless of which half of the loop failed.
			if (cause instanceof DurableWriteError) {
				throw cause;
			}
			throw new DurableWriteError('write', cause);
		}

		try {
			await handle.fsync();
		} catch (cause) {
			throw new DurableWriteError('file-fsync', cause);
		}
	} finally {
		// Swallowed deliberately. By the time close() runs, either the file-fsync above already
		// succeeded (durability is already achieved; a close failure cannot undo it and must not
		// replace that success with a spurious error) or a write/file-fsync error is already
		// in flight and unwinding through this `finally` (that is the error the caller needs to see,
		// not a secondary failure from tidying up a handle already known to be broken). A descriptor
		// leak here is a resource-leak concern for monitoring, not a durability one: the bytes already
		// reached the kernel via write()/fsync() before close() was ever attempted.
		await handle.close().catch(() => {});
	}

	try {
		await fs.fsyncDirectory(shardDir);
	} catch (cause) {
		throw new DurableWriteError('directory-fsync', cause);
	}

	return { filePath, sizeBytes, sha256: hash.digest() };
}
