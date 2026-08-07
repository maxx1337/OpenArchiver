import type { SpoolEntryVerdict } from './spool-entry-gate';

/**
 * Phase-B alerting (`JR-6-02a`).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this type exists here and not in E5
 * ---------------------------------------------------------------------------------------------
 * `packages/types/src/journal-parser.types.ts` carries an explicit note about this: an earlier version
 * of E5 defined `ParseFailedAlert`/`ParseFailedAlertSink`, and the PO review removed them again, because
 * nothing in `packages/journaling` ever constructed one or called one. The reasoning is worth repeating,
 * because it is the reason this file is shaped the way it is:
 *
 * > a seam with no producer and no caller is a guess, not a contract, and the risk is that E6 adopts it
 * > *because it exists* rather than because it fits what the `journal-inbound` worker actually needs (a
 * > ledger `seq`, a spool path, neither of which the parser has). […] Defining the alert sink is E6's
 * > job, once it knows what it needs.
 *
 * E6 now knows. What needs alerting is not "a parse failed" -- it is **a spool entry that Phase B
 * refused to archive**, and the reasons for refusing come from `classifySpoolEntry()`, which does have
 * the `seq` and does know the spool path. So the payload is the verdict itself, plus the two identifiers
 * that let an operator find the bytes.
 *
 * ---------------------------------------------------------------------------------------------
 * What an alert is, and what it is not
 * ---------------------------------------------------------------------------------------------
 * An alert is **not** an error return. Phase B alerts on things it has already handled: the file is
 * quarantined or left in place, the ledger is untouched, and the job's own success or failure is decided
 * separately. Coupling the two would mean an unreachable alert channel could stop a message from being
 * archived -- the inversion RFC section 15 and ADR-008 forbid for the TSA and which holds here for the
 * same reason. **A sink that throws must therefore never be allowed to fail the job**; the caller logs
 * and continues.
 *
 * Modelled on `QuarantineAlert`/`QuarantineAlertSink` (`../spool/quarantine.ts`), which `JR-3-05`
 * already established for the crash-recovery scan -- same posture, and deliberately not merged with it:
 * that one reports what a *startup scan* found across many files, this one reports one job's verdict on
 * one entry.
 */

/** Severity, so a sink can route without parsing prose. */
export type PhaseBAlertSeverity = 'warning' | 'critical';

/** One spool entry that Phase B refused to archive. */
export interface PhaseBAlert {
	/** The transaction the entry belongs to -- the key an operator searches the ledger and the spool by. */
	readonly spoolTxId: string;
	/** Absolute path of the file as it was when the verdict was reached. */
	readonly spoolPath: string;
	/**
	 * The verdict, verbatim. Passing the whole discriminated union rather than a flattened message keeps
	 * the machine-readable `kind` and the measured hashes available to a sink that wants to act on them,
	 * instead of forcing every consumer to re-parse `reason`.
	 */
	readonly verdict: SpoolEntryVerdict;
	readonly severity: PhaseBAlertSeverity;
}

/**
 * Where alerts go. Injected, like every other outbound dependency in this package.
 *
 * Returning `void` rather than `Promise<void>` is intentional: a sink that awaits a network round trip
 * inside the Phase-B path would add a failure mode to archiving that archiving does not need. A sink that
 * wants to send something over the wire enqueues it and returns.
 */
export type PhaseBAlertSink = (alert: PhaseBAlert) => void;

/** A sink that does nothing, for callers that have not wired one yet. Never the default in production. */
export const noopPhaseBAlertSink: PhaseBAlertSink = () => {};

/**
 * How loudly each verdict should be reported.
 *
 * `content_mismatch` is the only `critical` one, and the split is the whole reason this function exists
 * rather than a constant severity:
 *
 * - **`content_mismatch` -- critical.** The bytes on disk are not the bytes that were acknowledged. That
 *   is an integrity event: tampering, corruption, or two transactions on one txid. It needs a human.
 * - **`no_receipt` -- warning.** The expected outcome of a crash between the spool `fsync` and the ledger
 *   append. The sender never got `250`, nothing was promised, and the file is quarantined. Paging someone
 *   for the normal consequence of an abrupt shutdown trains them to ignore the channel.
 * - **`not_a_receipt` and `receipt_without_hash` -- warning.** Both are writer defects that should be
 *   impossible; both are recoverable once fixed, and neither means data was lost or altered.
 *
 * `archive` has no severity: it produces no alert, and `alertSeverityFor()` is never called for it. It
 * throws instead of returning a value, because a caller that alerts on a successful archive has a bug
 * that a quietly-returned `'warning'` would hide.
 */
export function alertSeverityFor(verdict: SpoolEntryVerdict): PhaseBAlertSeverity {
	switch (verdict.kind) {
		case 'content_mismatch':
			return 'critical';
		case 'no_receipt':
		case 'not_a_receipt':
		case 'receipt_without_hash':
			return 'warning';
		case 'archive':
			throw new Error(
				'alertSeverityFor() was called for an `archive` verdict. Archiving successfully is not ' +
					'an alertable event; a caller reaching here is alerting on the success path.'
			);
	}
}
