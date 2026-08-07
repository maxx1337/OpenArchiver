import { isValidTxId } from '../spool/txid';

/**
 * The Phase-B queue contract (`JR-6-01`, `docs/dev/journaling/02-architektur.md` sections 3 step 7
 * and 6).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this lives in `packages/journaling` and not next to the `Queue` in `packages/backend`
 * ---------------------------------------------------------------------------------------------
 * Two processes have to agree on these names: `apps/smtp-ingress` enqueues the hint after it has
 * answered `250` (architecture section 3 step 7 -- explicitly *outside* the acceptance contract), and
 * the `journal-inbound` worker in `packages/backend` consumes it. The ingress must not import from
 * `packages/backend` (architecture section 2, "Abhängigkeitsregel"), so a constant defined beside the
 * `Queue` would leave the two sides agreeing by copied string literal. That is the shape of F46: two
 * things that had to match, matching only by convention, and nothing failing when they stopped.
 *
 * ADR-025 points the same way from the other side: journaling-specific logic must not come into
 * existence in `packages/backend` in a form that only runs together with it.
 *
 * There is deliberately **no** BullMQ import here. This module is names, a payload shape and one
 * derivation -- it must stay usable by a process that has no Redis client at all (the reconciler in
 * `JR-6-04` decides what to enqueue without needing one to make that decision).
 *
 * ---------------------------------------------------------------------------------------------
 * Why the payload carries one field
 * ---------------------------------------------------------------------------------------------
 * The queue is an **optimisation, not an authority** (architecture section 3; `JR-6-04` makes that
 * testable by wiping Redis and expecting the spool to be picked up regardless). A payload is
 * therefore only allowed to contain what can be re-derived without it, and `spoolTxId` is exactly
 * that boundary:
 *
 *   - the spool file is `incoming/<shard>/<txid>.eml`, so the txid locates the bytes
 *     (`../spool/layout.ts` `incomingFilePath`);
 *   - everything else the worker needs about the receipt -- `seq`, `chainScopeId`,
 *     `journalingSourceId` -- comes from the ledger row, resolved by that same txid through
 *     `LedgerLookup.findBySpoolTxIds` (`../ledger/ledger-lookup-port.ts`).
 *
 * Copying `seq` or `chainScopeId` into the payload would create a second source for a value the
 * ledger already holds, and a payload that disagreed with its ledger row would be **undetectable**:
 * the worker would archive against the copied value and nothing would ever compare the two. The
 * reconciler, which builds jobs from disk and ledger alone, cannot produce those fields any other
 * way either -- so a wider payload would mean the two enqueue paths produce different jobs for the
 * same spool entry.
 */

/** BullMQ queue name. Mirrored by `journalInboundQueue` in `packages/backend/src/jobs/queues.ts`. */
export const JOURNAL_INBOUND_QUEUE_NAME = 'journal-inbound';

/**
 * BullMQ job name, dispatched by the worker's name switch.
 *
 * The existing workers switch on `job.name` and `throw` on an unknown one
 * (`packages/backend/src/workers/ingestion.worker.ts`); this queue starts with a single name and
 * keeps that shape so a second Phase-B job type later is an added `case`, not a new queue.
 */
export const JOURNAL_INBOUND_JOB_NAME = 'process-spool-entry';

/**
 * BullMQ job name for the reconciler sweep (`JR-6-04`, architecture doc section 3: "Ein
 * Reconciler-Job sweept periodisch den Spool..."). Lives on the **same** queue as
 * {@link JOURNAL_INBOUND_JOB_NAME} rather than a second one -- the reconciler needs no isolation from
 * the jobs it re-enqueues, and a second queue would need its own worker or its own case in this one
 * anyway, for no gain.
 */
export const JOURNAL_RECONCILE_JOB_NAME = 'reconcile-spool';

/**
 * Fixed BullMQ job id for the reconciler's own repeatable registration -- not a spool transaction id,
 * so it does not go through {@link journalInboundJobId}. One repeatable job per queue is enough; a
 * second `add()` with the same id and the same `repeat` option is a no-op, which is what makes
 * registering it on every worker startup safe rather than something that needs to happen exactly
 * once.
 */
export const JOURNAL_RECONCILE_JOB_ID = 'reconcile-spool';

/** Everything a Phase-B job carries. See the module comment for why it is one field. */
export interface JournalInboundJobData {
	/** The `spool_txid` of the receipt to process -- a ULID as produced by `generateTxId()`. */
	readonly spoolTxId: string;
}

/** Separator between the queue prefix and the txid. Not a member of the ULID alphabet. */
const JOB_ID_SEPARATOR = ':';

/**
 * The deterministic BullMQ job id for a spool entry.
 *
 * BullMQ treats `jobId` as a uniqueness key: adding a job whose id is already present in the queue is
 * a no-op. Deriving the id from the txid therefore makes the *enqueue* idempotent, which matters
 * because two paths enqueue the same entry by design -- the ingress right after `250`, and the
 * reconciler (`JR-6-04`) when it finds a spool entry whose Phase B never finished. Without it, a
 * reconciler sweep during a backlog would queue every pending entry a second time.
 *
 * **This is a cheap first line, not the idempotency guarantee.** BullMQ only knows an id for as long
 * as the job is retained (`removeOnComplete`), so once a completed job has aged out, the same entry
 * can legitimately be enqueued again -- and after a Redis flush, *nothing* is known. The guarantee
 * that redelivery produces one object and two receipts is `JR-6-03`: object dedup on
 * `content_sha256`, with every receipt kept in the ledger and duplicates carrying `duplicate_of`.
 * Anyone tempted to lean on this function for correctness is reading it as more than it is.
 *
 * @throws RangeError if `spoolTxId` is not a well-formed txid. A job id is a Redis key; accepting an
 * arbitrary string here would let a value containing the separator collide with the id of a different
 * entry, and a colliding id silently *drops* an enqueue rather than failing it.
 */
export function journalInboundJobId(spoolTxId: string): string {
	if (!isValidTxId(spoolTxId)) {
		throw new RangeError(
			`journalInboundJobId() needs a valid spool transaction id (26 Crockford-Base32 characters), got ${JSON.stringify(spoolTxId)}.`
		);
	}
	return `${JOURNAL_INBOUND_QUEUE_NAME}${JOB_ID_SEPARATOR}${spoolTxId}`;
}
