import type { OwnerResolutionMethod } from '@open-archiver/types';
import type { OwnerEnvelopeFidelity } from './owner-envelope';

/**
 * The port ADR-010 decided on for `JR-6-02b`: archiving still happens through
 * `IngestionService.processEmail()`, **unmodified**, but `packages/journaling` may not import
 * `packages/backend` (architecture doc section 2) and must not know about Drizzle, `StorageService`
 * or the `ingestion_sources` table. This is the seam. `packages/backend` provides the only
 * implementation, wrapping `processEmail()` one to one; `runPhaseBPipeline()` (`./pipeline.ts`) calls
 * it once per resolved owner and never touches the archiving mechanics itself.
 *
 * ---------------------------------------------------------------------------------------------
 * Why the input carries metadata rather than an `EmailObject`
 * ---------------------------------------------------------------------------------------------
 * `EmailObject` (`@open-archiver/types`) is a generic ingestion-connector shape with fields this
 * pipeline has no use for (`threadId`, `path`, `html`, a `body` no journaling metadata needs) and no
 * safe value for (`tempFilePath` -- see the warning on {@link ArchiveObjectInput.spoolFilePath}
 * below). Depending on it here would let the port's shape drift with a type this package has no
 * decision-making stake in. The adapter builds whatever `processEmail()` needs from this narrower
 * input; a caller here never has to know how.
 */

/** One resolved recipient address, with the display name if one was available. */
export interface ArchiveObjectRecipient {
	readonly name: string;
	readonly address: string;
}

/** Everything one archiving call needs, for one resolved owner of one message. */
export interface ArchiveObjectInput {
	/**
	 * `ingestion_sources.id` -- `chain_scope_id` on the ledger receipt, which ADR-007 already makes
	 * equal to it. The adapter fetches this row and archives under it; it never invents or creates one.
	 */
	readonly ingestionSourceId: string;
	/**
	 * Absolute path to the spool file. **These are the raw outer bytes, exactly as fsynced by Phase A
	 * -- never transformed, never the input to a fresh hash** (RFC section 6.1, README constraint 3).
	 * The adapter must pass this straight through as `EmailObject.tempFilePath` with
	 * `skipTempFileCleanup: true`. It is not a scratch file: it is the durable record the acceptance
	 * contract already promised the sender, and it is released (deleted) by `runPhaseBPipeline()`'s
	 * own step, never by `processEmail()`'s `finally` block.
	 */
	readonly spoolFilePath: string;
	/**
	 * The gate's verified, lower-case hex SHA-256 of the spool file (`SpoolEntryArchive.contentSha256Hex`).
	 * The adapter derives the identity it hands to `processEmail()`'s dedup gates from this value, never
	 * from a `Message-Id` header in the message itself (ADR-010 point 1) -- a forged or missing
	 * `Message-Id` must not defeat object-level dedup.
	 */
	readonly contentSha256Hex: string;
	/** The mailbox this call archives into -- `resolveOwner()`'s `ownerEmail` (or a normalized
	 *  `additionalMatches` entry) for the winner being archived on this call. */
	readonly ownerEmail: string;
	readonly subject: string;
	readonly from: readonly ArchiveObjectRecipient[];
	readonly to: readonly ArchiveObjectRecipient[];
	readonly cc: readonly ArchiveObjectRecipient[];
	readonly bcc: readonly ArchiveObjectRecipient[];
	readonly receivedAt: Date;
	/**
	 * Which of the four `parseJournalReport()` results produced this call -- purely informational
	 * (logging/metrics), never branched on by the adapter; the archiving mechanics are identical for
	 * all four (README constraint 4: none of them may be rejected).
	 */
	readonly parseKind: 'journal_report' | 'parse_failed' | 'plain_bcc' | 'ndr';
	/** See {@link OwnerEnvelopeFidelity} (`./owner-envelope.ts`) -- how much to trust `ownerEmail`. */
	readonly ownerFidelity: OwnerEnvelopeFidelity;
	readonly ownerMethod: OwnerResolutionMethod;
}

/** What one archiving call produced. */
export type ArchiveObjectOutcome =
	| {
			readonly kind: 'archived';
			readonly archivedEmailId: string;
	  }
	| {
			/**
			 * `processEmail()` returned `null`: the object already exists for this owner
			 * (ADR-010 point 3). **Not** "nothing to do" -- every receipt still needs its own ledger
			 * accounting. `JR-6-03` is where the `duplicate_of` entry gets written; this outcome is the
			 * hook that slice reads. `runPhaseBPipeline()` must not throw for this outcome and must not
			 * silently equate it with `'archived'`.
			 *
			 * `archivedEmailId` is the **pre-existing** row's id, resolved by the adapter with the same
			 * key `processEmail()`'s own dedup gate used. It exists so `runPhaseBPipeline()` can index
			 * this owner unconditionally, on every run -- including a retry of a job whose *previous*
			 * attempt archived the object but died before indexing it. Without it, a retry would see
			 * nothing but duplicates, index nothing, and release the spool entry over a message that was
			 * archived but never made searchable.
			 */
			readonly kind: 'duplicate';
			readonly archivedEmailId: string;
	  }
	| {
			/** `processEmail()` returned a `ProcessEmailError` -- a genuine storage/DB failure. */
			readonly kind: 'error';
			readonly message: string;
	  };

/**
 * Archives one message for one resolved owner. Implemented exactly once, in `packages/backend`, as a
 * thin wrapper around `IngestionService.processEmail()` -- see this file's module comment.
 */
export type ArchiveObjectPort = (input: ArchiveObjectInput) => Promise<ArchiveObjectOutcome>;
