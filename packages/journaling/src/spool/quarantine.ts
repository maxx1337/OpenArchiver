import { ensureQuarantineShardDir, quarantineFilePath } from './layout';
import type { SpoolFileSystem } from './fs-port';

/**
 * Move a spool file into quarantine, and alert -- the one mechanism `crash-recovery.ts` (`JR-3-05`)
 * and `acceptance.ts`'s failed-write cleanup (`JR-3-09`, F40 half 1) both need, because both are
 * answering the same skill-section-3 requirement ("never delete a spool file that has no ledger entry
 * without recording that decision somewhere durable") from two different call sites, for two different
 * reasons.
 *
 * ---------------------------------------------------------------------------------------------
 * Two reasons, one mechanism
 * ---------------------------------------------------------------------------------------------
 * `'no-ledger-entry'` -- `crash-recovery.ts` found a file at startup with nothing in the ledger for its
 * `spool_txid`. That file *might* be a genuine crash victim (never acknowledged before the process
 * died) -- the scan cannot tell, and does not try to.
 *
 * `'write-failed'` -- `acceptance.ts` is quarantining debris from a durable write that failed *in this
 * same process, moments ago*, on an otherwise-healthy run. Nothing crashed. Before `JR-3-09`, this case
 * left the file in `incoming/` for a later crash-recovery scan to find and misdiagnose as a crash
 * (F40, `docs/dev/journaling/02-architektur.md` section 5's corrected sentence) -- an operator paging
 * on that alert went looking for a crash that never happened.
 *
 * Both reasons produce the identical `rename()`-into-quarantine outcome and the identical alert shape;
 * only `reason` differs, which is exactly what lets an operator (and, later, E10's monitoring) tell the
 * two apart without two unrelated alert shapes to reconcile.
 *
 * `'oversize-rejected'` -- `JR-4-06b`, a third reason for the exact same mechanism, not a second alarm
 * path. Skill `journal-ledger` section 2 requires the oversize rejection to "log loudly -- this is a
 * silent data-loss vector": a message over the configured `SIZE` limit is rejected with `552`, but by
 * the time that is known, `JournalAcceptance.accept()` has very likely already started (often
 * finished) a durable write for it (`smtp-server.ts`'s `finalizeAcceptance` doc comment, "Oversize"
 * section) -- `tryBeginAcceptance()` opens the spool file before a single content byte is known to be
 * oversize. So the SMTP layer aborts the in-flight `SpoolWriteBridge`, which already surfaces as a
 * `DurableWriteError` `acceptance.ts`'s `catch` block already quarantines unconditionally, alerting
 * through the **mandatory** `alertSink` (`JournalAcceptanceOptions.alertSink`, required precisely so
 * this kind of debris is never silently discarded). That alert already fires for every oversize
 * rejection during `DATA`/`BDAT` -- the investigation this task did found no missing loud alert, only a
 * mislabelled one: every such alert used to report `reason: 'write-failed'`, indistinguishable from a
 * genuine disk/fsync fault, which would send an on-call operator looking for a hardware problem that
 * is not there. `ProtocolRejectionAbort` (below) is the marker `smtp-server.ts`'s oversize abort now
 * passes to `bridge.abort()`; `acceptance.ts`'s `catch` block checks `cause.cause instanceof
 * ProtocolRejectionAbort` and reports `'oversize-rejected'` instead of `'write-failed'` in exactly that
 * one case -- same rename, same required `alertSink`, same `QuarantineAlert` shape, only the `reason`
 * field is more precise. Deliberately **not** a second alert mechanism (the Product Owner's own
 * instruction for this task warned against building one without need, since E10's completeness
 * monitoring would then have two shapes to reconcile instead of one).
 *
 * ---------------------------------------------------------------------------------------------
 * Never deletes, and tolerates "there was nothing to quarantine"
 * ---------------------------------------------------------------------------------------------
 * {@link SpoolFileSystem} has no delete/unlink method at all (`fs-port.ts`) -- the same structural
 * argument `crash-recovery.ts`'s own doc comment makes: this function cannot delete a file no matter
 * what path it takes through the code, because the capability does not exist to be misused.
 *
 * A `rename()` whose source does not exist (`ENOENT`) is treated as "nothing to quarantine", not an
 * error. Two concrete cases produce exactly that, and both are legitimate, not bugs:
 *
 *   - Two of `writeDurableSpoolFile()`'s five sub-operations (`mkdir`, `createFile`) fail *before* a
 *     file is ever created (`durable-write.ts`'s module doc comment) -- calling this function after
 *     either leaves `ENOENT` as the only possible outcome, and reporting that as a fault or raising an
 *     alert for a file that never existed would be a spurious error over nothing.
 *   - A second caller (another process, or another call racing the same txid) already moved the file --
 *     `crash-recovery.ts`'s own doc comment documents this race for its call site; the same tolerance
 *     applies here.
 *
 * Returns `null` for that "nothing to quarantine" case, and the {@link QuarantinedEntry} otherwise.
 */

/** Which of the (so far) three situations produced this quarantine. See the module doc comment. */
export type QuarantineReason = 'no-ledger-entry' | 'write-failed' | 'oversize-rejected';

/**
 * Marks an `Error` handed to `SpoolWriteBridge.abort()` as a deliberate protocol-layer rejection
 * (`JR-4-06b`: currently only the `SIZE`-limit oversize abort in `smtp-server.ts`'s
 * `finalizeAcceptance`) rather than a genuine I/O failure. `acceptance.ts`'s `DurableWriteError`
 * handler checks `cause.cause instanceof ProtocolRejectionAbort` to choose `'oversize-rejected'`
 * over the generic `'write-failed'` -- see this module's doc comment for why this exists and why it
 * is not a second alert mechanism.
 */
export class ProtocolRejectionAbort extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProtocolRejectionAbort';
	}
}

/** The operator-visible event a quarantine produces (skill `journal-ledger` section 3: "alarmieren"). */
export interface QuarantineAlert {
	readonly spoolTxId: string;
	readonly originalFilePath: string;
	readonly quarantineFilePath: string;
	readonly reason: QuarantineReason;
}

/**
 * Where a quarantine alert goes. Injected, not a `console.log` and not a backend logger import --
 * `packages/journaling` has neither (architecture doc section 2) -- so reaching wherever an operator
 * actually looks is a wiring decision for whoever calls {@link quarantineSpoolFile}.
 */
export interface QuarantineAlertSink {
	alert(event: QuarantineAlert): Promise<void> | void;
}

/** A file that was moved to quarantine: gone from its original path, present at `quarantineFilePath`. */
export interface QuarantinedEntry {
	readonly spoolTxId: string;
	readonly originalFilePath: string;
	readonly quarantineFilePath: string;
}

function isEnoent(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code?: unknown }).code === 'ENOENT'
	);
}

/**
 * Move one spool file to quarantine and alert. See the module doc comment for the two reasons this is
 * called for, and for why a missing source is tolerated rather than treated as a failure.
 */
export async function quarantineSpoolFile(
	fs: SpoolFileSystem,
	spoolRoot: string,
	txid: string,
	originalFilePath: string,
	reason: QuarantineReason,
	alertSink: QuarantineAlertSink
): Promise<QuarantinedEntry | null> {
	await ensureQuarantineShardDir(fs, spoolRoot, txid);
	const targetPath = quarantineFilePath(spoolRoot, txid);

	try {
		await fs.rename(originalFilePath, targetPath);
	} catch (error) {
		if (isEnoent(error)) {
			return null;
		}
		throw error;
	}

	await alertSink.alert({
		spoolTxId: txid,
		originalFilePath,
		quarantineFilePath: targetPath,
		reason,
	});

	return { spoolTxId: txid, originalFilePath, quarantineFilePath: targetPath };
}
