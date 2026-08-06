import type { LedgerTransactor } from '../ledger/ledger-port';
import type { LedgerLookup } from '../ledger/ledger-lookup-port';
import type { SpoolFileSystem } from '../spool/fs-port';
import type { CrashRecoveryAlertSink } from '../spool/crash-recovery';
import { runExclusiveCrashRecoveryScan } from '../spool/crash-recovery-lock';

/**
 * The spool reconciler (`JR-6-04`, architecture doc section 3: "Ein Reconciler-Job sweept periodisch
 * den Spool nach Einträgen, die einen Ledger-Eintrag haben, aber noch nicht Phase-B-fertig sind, und
 * reiht sie nach"). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this is `runExclusiveCrashRecoveryScan()` plus one loop, not a new spool walk
 * ---------------------------------------------------------------------------------------------
 * "A spool entry that has a ledger receipt but is still sitting in `incoming/`" is **exactly** what
 * `runCrashRecoveryScan()` (`JR-3-05`) already computes as its `requeue` list -- a file only leaves
 * `incoming/` once `SpoolEntryReleaser.release()` runs at the end of a successful Phase-B pipeline
 * (`pipeline.ts`'s own module doc comment: "the one irreversible action"), so a file still there
 * with a ledger row is, by construction, either never attempted or attempted and not finished. Both
 * are exactly this reconciler's job. Writing a second spool walk would duplicate `JR-3-05`'s own
 * sharding/`readdir` cost analysis and its quarantine-race tolerance (`crash-recovery.ts`'s module
 * doc comment) for no reason -- this function is deliberately thin: one scan, one loop, one injected
 * side effect.
 *
 * `runExclusiveCrashRecoveryScan()`, never the bare `runCrashRecoveryScan()` -- per
 * `crash-recovery-lock.ts`'s own binding rule for "whenever `journal-inbound` is built": this
 * reconciler and `apps/smtp-ingress`'s boot-time scan now genuinely run from two independent
 * processes against the same spool, and the lock is what keeps two overlapping scans from racing
 * each other's `rename()` calls (a lost race is tolerated on its own; both scans finishing at once
 * unlocked is not something this codebase has measured).
 *
 * A side effect worth naming, not a defect: this sweep also quarantines any `incoming/` file with no
 * ledger entry at all (a crash between spool-fsync and ledger-append, `JR-3-05`'s own case). That is
 * correct regardless of who discovers it or how often -- running it more frequently than
 * `apps/smtp-ingress`'s single boot-time scan only shortens how long an orphaned file sits unflagged.
 *
 * ---------------------------------------------------------------------------------------------
 * `enqueue` is injected, and it decides retry vs. fresh add -- not this function
 * ---------------------------------------------------------------------------------------------
 * `packages/journaling` has no BullMQ dependency (architecture doc section 2; `queue-contract.ts`'s
 * own doc comment makes the same point for the same reason). What "enqueue" means -- add a fresh job,
 * or `retry()` one already sitting in the failed set under the deterministic job id -- is a BullMQ
 * question this package cannot answer and must not need to. The caller (`packages/backend`) owns
 * that decision; see `journal-inbound.processor.ts`'s `enqueueForReconcile()`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why re-enqueuing an already-archived-but-unreleased entry is safe (`JR-6-03`'s own guard, exercised
 * here, not re-implemented)
 * ---------------------------------------------------------------------------------------------
 * The sharp trap this reconciler could fall into: a Phase-B job that archived every owner
 * successfully but crashed *before* `releaseSpoolEntry()` leaves its file in `incoming/` with a
 * ledger receipt, indistinguishable from this sweep's point of view from a job that never ran at
 * all. Re-running the pipeline for it makes `archiveObject()` report `'duplicate'` for every owner
 * (the objects already exist) -- and if that unconditionally wrote a `duplicate_of` marker, this
 * reconciler would manufacture a false one on every entry it ever helps recover, exactly the
 * fabricated evidence `JR-6-03` exists to prevent. It does not, because `findOriginalReceiptSeq()`
 * resolves to *this transaction's own* receipt when no other transaction shares the content yet
 * (`ledger-lookup-port.ts`'s doc comment, "why the earliest, and why that is never the caller's own
 * receipt when it matters") -- `pipeline.ts` compares that against `archived.seq` and writes nothing
 * when they are equal. This reconciler does not re-implement that guard; it relies on the same
 * `runPhaseBPipeline()` call path handling it, and `journal-spool-reconciler.int.test.ts` proves the
 * combination against a real ledger rather than trusting the doc comment alone.
 */

export interface SpoolReconcileOptions {
	readonly fs: SpoolFileSystem;
	readonly ledgerLookup: LedgerLookup;
	readonly spoolRoot: string;
	readonly alertSink: CrashRecoveryAlertSink;
	readonly transactor: LedgerTransactor;
	/** Ensure a Phase-B job exists for this spool transaction id -- fresh or retried, caller's choice. */
	readonly enqueue: (spoolTxId: string) => Promise<void>;
}

export interface SpoolReconcileResult {
	readonly incomingFilesScanned: number;
	readonly requeuedCount: number;
	readonly quarantinedCount: number;
}

/** Run one reconciler sweep. See the module doc comment for the full contract. */
export async function runSpoolReconcile(
	options: SpoolReconcileOptions
): Promise<SpoolReconcileResult> {
	const { fs, ledgerLookup, spoolRoot, alertSink, transactor, enqueue } = options;

	const scanResult = await runExclusiveCrashRecoveryScan({
		fs,
		ledgerLookup,
		spoolRoot,
		alertSink,
		transactor,
	});

	for (const candidate of scanResult.requeue) {
		await enqueue(candidate.spoolTxId);
	}

	return {
		incomingFilesScanned: scanResult.incomingFilesScanned,
		requeuedCount: scanResult.requeue.length,
		quarantinedCount: scanResult.quarantined.length,
	};
}
