import type { LedgerEntryByTxId } from '../ledger/ledger-lookup-port';

/**
 * The gate every Phase-B job passes before anything is archived (`JR-6-02a`, RFC section 5.3,
 * architecture doc section 6, skill `journal-ledger` section 3).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this is its own pure function
 * ---------------------------------------------------------------------------------------------
 * Phase B is allowed to do exactly one irreversible thing -- release the spool entry -- and one thing
 * that is worse than irreversible, namely archive bytes and record them as the receipted message when
 * they are not. Both decisions come down to comparing three values: what the ledger says about this
 * transaction, what the bytes on disk hash to, and how long they are. Nothing about that comparison
 * needs a database, a filesystem or a clock, so none of them appear here. What is left is a function
 * whose every branch can be exercised directly, including the branches that must **never** archive.
 *
 * That split is deliberate rather than tidy. `JR-4-14` and F46 both came from the same shape: logic
 * that could only be reached through its production wiring, so every test used a fake instead and the
 * one thing that mattered was never measured.
 *
 * ---------------------------------------------------------------------------------------------
 * The rule, in one sentence
 * ---------------------------------------------------------------------------------------------
 * **Archive only when a `receipt` row exists for this transaction and the bytes on disk hash to exactly
 * the `content_sha256` that row committed to.** Everything else quarantines or defers -- and nothing
 * here ever deletes, because the spool is authoritative until Phase B has confirmed (architecture
 * section 3).
 *
 * ---------------------------------------------------------------------------------------------
 * Why a missing ledger row is not an error
 * ---------------------------------------------------------------------------------------------
 * A spool file with no receipt is the normal, expected result of a crash between the spool `fsync` and
 * the ledger append -- the window the two-phase acceptance contract is built around. The sender was
 * never told `250`, so the message was never accepted, and archiving it would **invent** an
 * acknowledgement that was not given. `runCrashRecoveryScan()` (`../spool/crash-recovery.ts`) already
 * treats this case as quarantine-never-delete; this gate agrees with it deliberately, so the two paths
 * cannot drift into contradicting each other about the same file.
 */

/** How the ledger and the bytes on disk compared. One outcome, always exactly one. */
export type SpoolEntryVerdict =
	| SpoolEntryArchive
	| SpoolEntryNoReceipt
	| SpoolEntryNotAReceipt
	| SpoolEntryReceiptWithoutHash
	| SpoolEntryContentMismatch;

/**
 * The only verdict that permits archiving. Carries the receipt's own fields so the caller does not
 * re-read them from a nullable type it has already proven non-null.
 */
export interface SpoolEntryArchive {
	readonly kind: 'archive';
	readonly seq: bigint;
	readonly chainScopeId: string;
	readonly journalingSourceId: string | null;
	readonly receivedAt: Date;
	/** Lower-case hex of the verified `content_sha256`. Verified, so hex is now safe to hand on. */
	readonly contentSha256Hex: string;
	readonly sizeBytes: number;
	/**
	 * The receipt's `envelope_from`/`envelope_rcpt`, forwarded verbatim (`JR-6-02b`) -- the pipeline
	 * needs them to build the {@link SmtpTransactionEnvelope} `parseJournalReport()` takes as its
	 * strongest NDR/plain-BCC signal. Forwarded here rather than re-fetched, for the same reason
	 * `chainScopeId`/`journalingSourceId` already are: one ledger lookup, one verdict, no second
	 * source for values the caller already has proven correct.
	 */
	readonly envelopeFrom: string | null;
	readonly envelopeRcpt: readonly string[] | null;
}

/**
 * No ledger row at all for this transaction: the message was never acknowledged. **Requeueing will not
 * help** -- Phase A is over and no later append is coming for this txid.
 */
export interface SpoolEntryNoReceipt {
	readonly kind: 'no_receipt';
	readonly reason: string;
}

/** A row exists, but it is not a `receipt`. See `LedgerEntryByTxId.eventType` for why this is checked. */
export interface SpoolEntryNotAReceipt {
	readonly kind: 'not_a_receipt';
	readonly eventType: string;
	readonly reason: string;
}

/**
 * A `receipt` row with no `content_sha256`. Structurally impossible for a receipt written by
 * `JournalAcceptance.accept()` -- which is exactly why it is a distinct verdict rather than folded into
 * `content_mismatch`: the two need different operator responses, and reporting "hash mismatch" for a
 * row that has no hash would send someone looking for tampering where the actual fault is a writer that
 * omitted a required field.
 */
export interface SpoolEntryReceiptWithoutHash {
	readonly kind: 'receipt_without_hash';
	readonly seq: bigint;
	readonly reason: string;
}

/**
 * The bytes on disk are not the bytes that were receipted. **The loudest case in this file.**
 *
 * It means one of: the spool file was modified after the `250`, storage corrupted it, or two
 * transactions collided on one txid. All three are integrity events, none is a retry candidate, and the
 * file must be quarantined with its measurements preserved -- the point of quarantine is that an auditor
 * can still look at the bytes afterwards.
 */
export interface SpoolEntryContentMismatch {
	readonly kind: 'content_mismatch';
	readonly seq: bigint;
	readonly expectedSha256Hex: string;
	readonly actualSha256Hex: string;
	/** `null` when the receipt recorded no size -- the hash already decided, size is supporting detail. */
	readonly expectedSizeBytes: bigint | null;
	readonly actualSizeBytes: number;
	readonly reason: string;
}

/** What the caller measured off the spool file. */
export interface MeasuredSpoolEntry {
	/** Lower-case hex SHA-256 over the file's bytes, streamed -- never a buffered read (F60, `JR-3-02`). */
	readonly sha256Hex: string;
	readonly sizeBytes: number;
}

const RECEIPT_EVENT_TYPE = 'receipt';

/** Lower-case hex, so a comparison can never fail on casing alone. */
function toHex(bytes: Uint8Array): string {
	let out = '';
	for (const byte of bytes) {
		out += byte.toString(16).padStart(2, '0');
	}
	return out;
}

/**
 * Decide whether a spool entry may be archived.
 *
 * @param entry The ledger row for this `spool_txid`, or `undefined` when the lookup returned none.
 *   `undefined` rather than `null` on purpose: it is what `Map.get()` yields, so the caller passes the
 *   lookup result straight through instead of normalising it and possibly normalising it wrongly.
 * @param measured What the caller measured off the file on disk.
 */
export function classifySpoolEntry(
	entry: LedgerEntryByTxId | undefined,
	measured: MeasuredSpoolEntry
): SpoolEntryVerdict {
	if (entry === undefined) {
		return {
			kind: 'no_receipt',
			reason:
				'no ledger row for this spool transaction id: the message was never acknowledged, so ' +
				'archiving it would invent an acceptance that never happened. Quarantine, never delete ' +
				'-- this is the expected result of a crash between the spool fsync and the ledger append.',
		};
	}

	if (entry.eventType !== RECEIPT_EVENT_TYPE) {
		return {
			kind: 'not_a_receipt',
			eventType: entry.eventType,
			reason:
				`the ledger row for this spool transaction id is a '${entry.eventType}' event, not a ` +
				`'${RECEIPT_EVENT_TYPE}'. Only a receipt records the object this file is supposed to be.`,
		};
	}

	if (entry.contentSha256 === null) {
		return {
			kind: 'receipt_without_hash',
			seq: entry.seq,
			reason:
				'the receipt records no content_sha256, so there is nothing to verify the spool bytes ' +
				'against. A receipt written by JournalAcceptance.accept() always carries one; this is a ' +
				'writer defect, not a tampering signal, and it is reported separately for that reason.',
		};
	}

	const expectedHex = toHex(entry.contentSha256);
	if (expectedHex !== measured.sha256Hex) {
		return {
			kind: 'content_mismatch',
			seq: entry.seq,
			expectedSha256Hex: expectedHex,
			actualSha256Hex: measured.sha256Hex,
			expectedSizeBytes: entry.sizeBytes,
			actualSizeBytes: measured.sizeBytes,
			reason:
				'the spool file does not hash to the content_sha256 its receipt committed to. The bytes ' +
				'on disk are not the bytes that were acknowledged: either the file was modified after ' +
				'the 250, storage corrupted it, or two transactions collided on one txid. Not a retry ' +
				'candidate.',
		};
	}

	// Size is deliberately **not** a second gate. The hash has already decided -- two byte sequences of
	// different length cannot share a SHA-256 -- so a size that disagreed here would mean the receipt's
	// own two fields contradict each other, which is a ledger-integrity question for `verify` (E9) and
	// not a reason to refuse an object whose bytes are provably the receipted ones. Checking it anyway
	// would turn a self-inconsistent *row* into an unarchivable *message*, which is the wrong trade:
	// the message was accepted and must reach the archive.
	return {
		kind: 'archive',
		seq: entry.seq,
		chainScopeId: entry.chainScopeId,
		journalingSourceId: entry.journalingSourceId,
		receivedAt: entry.receivedAt,
		contentSha256Hex: expectedHex,
		sizeBytes: measured.sizeBytes,
		envelopeFrom: entry.envelopeFrom,
		envelopeRcpt: entry.envelopeRcpt,
	};
}

/**
 * `true` for the one verdict that permits archiving.
 *
 * Exists so callers branch on a named predicate instead of on `kind === 'archive'` spelled out at each
 * site -- the same reason `isAccepted()` exists next to `JournalAcceptanceResult`
 * (`../spool/acceptance.ts`). A misspelled string literal is a silent `false`; a misspelled import is a
 * compile error.
 */
export function mayArchive(verdict: SpoolEntryVerdict): verdict is SpoolEntryArchive {
	return verdict.kind === 'archive';
}
