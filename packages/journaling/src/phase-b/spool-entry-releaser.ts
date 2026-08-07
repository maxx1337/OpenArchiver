import { unlink } from 'node:fs/promises';

/**
 * Releasing a spool entry once Phase B has fully finished with it (`JR-6-02b`, architecture doc
 * section 6, step 6).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this is its own port, not a new method on `SpoolFileSystem`
 * ---------------------------------------------------------------------------------------------
 * `../spool/fs-port.ts`'s `SpoolFileSystem` already has six implementations across
 * `packages/journaling` and `packages/backend` (the production one, an in-memory fake, and several
 * test-local ones), serving Phase A and crash recovery. `./spool-entry-reader.ts` made the same
 * argument for reads and it applies again here, for the same reason: a required method added there
 * to serve exactly one caller in one epic would force every one of those six to grow it, for a
 * concern -- Phase B's own lifecycle -- none of the others have anything to do with.
 *
 * ---------------------------------------------------------------------------------------------
 * Why release is delete, not a third spool directory (a decision, not an obvious default -- ADR-034)
 * ---------------------------------------------------------------------------------------------
 * The spool layout documented in architecture section 3 has exactly two directories,
 * `incoming/` and `quarantine/` -- there is no `processed/` or equivalent. "Spool freigeben" could in
 * principle mean *move it somewhere and keep it*, but nothing in the accepted architecture documents
 * such a place, and the RFC's own model is that the spool is a **durability bridge**, authoritative
 * only until Phase B confirms (skill `journal-ledger` section 3): once the outer object is archived
 * and its metadata is indexed, the durable record of the message is the archived object plus the
 * ledger receipt, not the spool copy. Keeping every spool file forever after that point would turn a
 * bridge into a second permanent store with no retention policy of its own, growing without bound.
 * `release()` therefore deletes the file. See `runPhaseBPipeline()`'s doc comment for the ordering
 * guarantee that makes this safe: it is called only after every resolved owner has been archived (or
 * correctly recognised as a duplicate) *and* indexed.
 */
export interface SpoolEntryReleaser {
	/**
	 * Delete a spool file whose Phase B has fully completed.
	 *
	 * @throws if the path cannot be deleted (e.g. already gone, or a permissions problem). The caller
	 * must not swallow this: a spool entry that Phase B believes it archived but could not release is
	 * exactly the state `JR-6-04`'s reconciler needs to be able to find again, and silently succeeding
	 * here would erase the only sign that something is wrong.
	 */
	release(path: string): Promise<void>;
}

/** The production {@link SpoolEntryReleaser}: `node:fs`, nothing else. */
export class NodeSpoolEntryReleaser implements SpoolEntryReleaser {
	async release(path: string): Promise<void> {
		await unlink(path);
	}
}
