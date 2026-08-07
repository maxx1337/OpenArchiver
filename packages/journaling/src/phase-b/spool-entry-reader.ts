import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { MeasuredSpoolEntry } from './spool-entry-gate';

/**
 * Reading a spool entry back, for Phase B (`JR-6-02a`).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this is not a method on `SpoolFileSystem`
 * ---------------------------------------------------------------------------------------------
 * `../spool/fs-port.ts`'s `SpoolFileSystem` is write-shaped and says so: create a directory, create a
 * file and open it for streaming **writes**, `fsync` a directory, plus `readdir`/`stat`/`rename` for
 * usage accounting and crash recovery. It has no read-the-contents operation, and seven implementations
 * exist across `packages/journaling` and `packages/backend` (the production one, a memory fake, and five
 * test-local ones). Adding a required method would break all seven to serve one caller in one epic.
 *
 * The deciding argument is not the churn, though -- it is that Phase B needs a **different** shape than
 * a general read, and the difference is the point of this file.
 *
 * ---------------------------------------------------------------------------------------------
 * Two methods, because measuring must not cost what reading costs
 * ---------------------------------------------------------------------------------------------
 * {@link SpoolEntryReader.measure} hashes the file **streaming**, holding one chunk at a time. It runs
 * *before* `classifySpoolEntry()` decides anything, so an entry that turns out to be orphaned,
 * mismatched or not-a-receipt is never brought into the heap at all -- and those are exactly the entries
 * that a crash or an attack produces in bulk. A single `readFile()` for both jobs would mean a spool
 * backlog of a thousand unacknowledged 50 MB files gets fully buffered on the way to being rejected.
 *
 * {@link SpoolEntryReader.read} does buffer, and that is not an oversight. Both downstream consumers
 * require a whole `Buffer` and neither can be talked out of it: `parseJournalReport(rawMessage: Buffer)`
 * splits MIME across the entire message, and `StorageService.put()` buffers whatever it is handed
 * because AES-256-CBC runs over a complete buffer (**F60** -- its signature promises streams and does
 * not deliver them). Streaming here would therefore save nothing downstream. What the split does buy is
 * that the buffering happens **only for entries that passed the gate**, i.e. only for messages that are
 * genuinely going into the archive.
 *
 * `ADR-010` records the same measurement from the other side: full buffering is a property of the
 * storage layer, not of `IngestionService.processEmail()`, and so it was not a reason to build a
 * separate archiving path.
 */
export interface SpoolEntryReader {
	/**
	 * Hash and size a spool file without holding it in memory.
	 *
	 * @throws if the path does not exist or cannot be read. An unreadable spool file is not a verdict --
	 * `classifySpoolEntry()` compares measurements and cannot represent "there was nothing to measure",
	 * so the caller must handle the failure rather than receive a verdict derived from a guess.
	 */
	measure(path: string): Promise<MeasuredSpoolEntry>;

	/** The whole file. Only for an entry that already passed the gate -- see the module comment. */
	read(path: string): Promise<Buffer>;
}

/** How many bytes the hash reads at a time. 64 KiB is Node's own default for `createReadStream`. */
const READ_CHUNK_BYTES = 64 * 1024;

/** The production {@link SpoolEntryReader}: `node:fs`, nothing else. */
export class NodeSpoolEntryReader implements SpoolEntryReader {
	async measure(path: string): Promise<MeasuredSpoolEntry> {
		const hash = createHash('sha256');
		let sizeBytes = 0;
		// No `stat()` beforehand. ENOENT and EISDIR arrive as a rejection from this loop just the same,
		// and the size is **counted** rather than read from `stat`: the count describes the bytes the
		// hash was actually taken over, which is the pair the caller compares against the ledger. A
		// `stat().size` could disagree with it if the file changed mid-read, and then the two halves of
		// one measurement would describe two different files.
		const stream = createReadStream(path, { highWaterMark: READ_CHUNK_BYTES });
		for await (const chunk of stream) {
			const bytes = chunk as Buffer;
			hash.update(bytes);
			sizeBytes += bytes.length;
		}
		return { sha256Hex: hash.digest('hex'), sizeBytes };
	}

	async read(path: string): Promise<Buffer> {
		return readFile(path);
	}
}
