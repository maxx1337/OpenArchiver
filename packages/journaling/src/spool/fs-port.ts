import type { FileHandle } from 'node:fs/promises';
import { mkdir, open, readdir, rename, stat } from 'node:fs/promises';

/**
 * The fault-injectable filesystem seam of the spool (`JR-3-03`, RFC section 12.2).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------------------------
 * The acceptance contract (skill `journal-ledger` section 1) requires three durability steps in
 * order: write the bytes, `fsync()` the file, `fsync()` the containing directory. `JR-3-06` has to
 * prove that a failure at **any one** of those three points is caught, surfaces as `451`, and leaves
 * nothing acknowledged and no half-written spool entry — and it has to prove the three cases
 * independently, because a fault-injection technique that can only fail "the write path" as a whole
 * would not tell you which of the three the caller actually handles.
 *
 * That is only testable if the three operations are three distinct calls a test can intercept one at
 * a time. Monkey-patching `node:fs` globally does not give you that: it is process-wide (so it leaks
 * across tests unless carefully undone), it cannot distinguish "this file's fsync" from "that
 * directory's fsync" without re-deriving the distinction from a path, and the acceptance criterion of
 * this task explicitly rules it out. So the seam is an interface, injected once through a
 * constructor parameter (never resolved from a module singleton — see `docs/dev/journaling/02-architektur.md`
 * section 2 on why `packages/journaling` never reaches for ambient configuration), with a real
 * implementation for production and a fake for tests.
 *
 * ---------------------------------------------------------------------------------------------
 * Narrow on purpose
 * ---------------------------------------------------------------------------------------------
 * This is not a wrapper around `node:fs`. It exposes exactly the six operations the spool needs —
 * create-and-stream-write a file, fsync a file, fsync a directory, create a directory, list a
 * directory, stat an entry, and rename — and nothing else. `JR-3-02` (durable write, streaming,
 * no heap buffering) and `JR-3-01` (layout, sharding, high-water-mark) are both built against this
 * interface; neither needs more of `node:fs` than this.
 */

/** One open spool file, mid-write. */
export interface SpoolFileHandle {
	/**
	 * Write one chunk at the current position and advance it.
	 *
	 * Streaming is the point: a caller writes as bytes arrive off the wire and never has to hold the
	 * whole message in memory, which is the acceptance criterion of `JR-3-02` (150 MB message, no
	 * proportional heap growth). This method does not return a byte count — the write either fully
	 * succeeds or the promise rejects, so a caller never has to handle a short write.
	 */
	write(chunk: Uint8Array): Promise<void>;

	/**
	 * `fsync()` this file descriptor — durability step 2 of 3 (write, file-fsync, directory-fsync).
	 *
	 * Independent from {@link SpoolFileSystem.fsyncDirectory}: a fake implementation can make this
	 * fail while directory-fsync still succeeds, and vice versa. That independence is the entire
	 * point of `JR-3-03` — see `JR-3-06`'s directory-fsync case, "the one that is easy to forget".
	 */
	fsync(): Promise<void>;

	/** Close the descriptor. Idempotent-adjacent: callers close exactly once, in a `finally`. */
	close(): Promise<void>;
}

/** One directory entry, as the spool needs it — nothing else from `fs.Dirent`. */
export interface SpoolDirEntry {
	readonly name: string;
	readonly isDirectory: boolean;
}

/** The parts of `fs.Stats` the spool reads. */
export interface SpoolStat {
	readonly size: number;
	readonly isDirectory: boolean;
}

/**
 * The narrow, explicitly-injected filesystem port.
 *
 * `NodeSpoolFileSystem` below is the production implementation. Tests use a fake that implements
 * the same interface and can be told to fail `write`, `fsync` (per file handle) and `fsyncDirectory`
 * independently — see `tests/support/fake-spool-fs.ts`. Nothing here reaches for a module-level `fs`
 * import at the call site; every caller receives an instance through its constructor.
 */
export interface SpoolFileSystem {
	/**
	 * Create a directory, and — with `recursive: true` — every missing parent. Idempotent when the
	 * directory already exists and `recursive` is set, the same as `fs.mkdir(..., { recursive: true })`.
	 */
	mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;

	/**
	 * Create a new spool file and open it for streaming writes.
	 *
	 * Exclusive by construction (`O_CREAT | O_EXCL`, i.e. POSIX `wx`): a transaction ID is assigned
	 * once per transaction (`generateTxId()` in `./txid.ts`) and a spool file is only ever created,
	 * never overwritten. A second `createFile()` call for the same path is a bug or an attack, not a
	 * legitimate retry, so it rejects rather than silently truncating an existing entry.
	 */
	createFile(path: string): Promise<SpoolFileHandle>;

	/**
	 * `fsync()` the directory itself — durability step 3 of 3, and the one a directory entry's file
	 * `fsync()` does **not** cover (skill `journal-ledger` section 1). Opens the directory read-only,
	 * syncs, closes; never writes to it.
	 */
	fsyncDirectory(path: string): Promise<void>;

	/** List one directory's entries. Used for spool-usage accounting and (later) crash recovery. */
	readdir(path: string): Promise<SpoolDirEntry[]>;

	/** Stat one path. Used for spool-usage accounting (`./layout.ts`'s high-water-mark check). */
	stat(path: string): Promise<SpoolStat>;

	/** Rename (move) a path. Used to move a quarantine candidate out of `incoming/` (`JR-3-05`). */
	rename(from: string, to: string): Promise<void>;
}

class NodeSpoolFileHandle implements SpoolFileHandle {
	constructor(private readonly handle: FileHandle) {}

	async write(chunk: Uint8Array): Promise<void> {
		await this.handle.write(chunk);
	}

	async fsync(): Promise<void> {
		await this.handle.sync();
	}

	async close(): Promise<void> {
		await this.handle.close();
	}
}

/**
 * The real implementation, over `node:fs/promises`. This is the only file in the package that is
 * allowed to import `node:fs` — everything else takes a {@link SpoolFileSystem} through its
 * constructor. No global `fs` function is ever patched; this class simply calls the real ones.
 *
 * ---------------------------------------------------------------------------------------------
 * Directory `fsync()` is a POSIX operation. It is not one on Windows
 * ---------------------------------------------------------------------------------------------
 * `fsyncDirectory()` opens the directory read-only and calls the platform's `fsync()` on that
 * descriptor, which is exactly what durability step 3 requires on Linux (the deployment target —
 * see `docs/dev/journaling/02-architektur.md` section 7). On Windows there is no equivalent
 * operation: opening a directory for `fsync` fails with `EPERM`, measured against this Node build
 * during `JR-3-03` (`fs.openSync(dir, 'r')` + `fs.fsyncSync(fd)`). This method does **not** paper
 * over that by swallowing the error — a caller that needs directory durability and does not get it
 * must find out immediately, not silently ship an unenforced acceptance contract. Practically: this
 * package's production target is Linux; a Windows host that reaches this code path is expected to
 * fail loudly, the same way a missing `STORAGE_ENCRYPTION_KEY` fails loudly elsewhere in this
 * repository rather than degrading. Flagged for the PO because it also affects development and
 * testing done from a Windows host (F35 is the precedent for this class of platform gap).
 */
export class NodeSpoolFileSystem implements SpoolFileSystem {
	async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
		await mkdir(path, { recursive: options?.recursive ?? false });
	}

	async createFile(path: string): Promise<SpoolFileHandle> {
		const handle = await open(path, 'wx');
		return new NodeSpoolFileHandle(handle);
	}

	async fsyncDirectory(path: string): Promise<void> {
		const handle = await open(path, 'r');
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	}

	async readdir(path: string): Promise<SpoolDirEntry[]> {
		const entries = await readdir(path, { withFileTypes: true });
		return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
	}

	async stat(path: string): Promise<SpoolStat> {
		const info = await stat(path);
		return { size: info.size, isDirectory: info.isDirectory() };
	}

	async rename(from: string, to: string): Promise<void> {
		await rename(from, to);
	}
}
