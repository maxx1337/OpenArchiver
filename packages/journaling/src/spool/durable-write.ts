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
 *  - `'write'` -- covers directory creation, file creation and every `write()` call. All three are
 *    "the bytes are not yet safely on disk" failures with the same required action (retry with a new
 *    transaction ID), so they share one stage rather than three.
 *  - `'file-fsync'` -- every byte was written, but the file descriptor was never confirmed durable.
 *  - `'directory-fsync'` -- the file itself is fully written *and* file-synced; only the directory
 *    entry's durability is unconfirmed. Worth its own stage because it is the failure mode the skill
 *    calls out as "the one that is easy to forget" -- a file fsync alone does not make a directory
 *    entry durable, and code that cannot tell this case apart from full success cannot honour that
 *    rule.
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
