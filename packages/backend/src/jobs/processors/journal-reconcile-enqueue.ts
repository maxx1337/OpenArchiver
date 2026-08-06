import type { Queue } from 'bullmq';
import { JOURNAL_INBOUND_JOB_NAME, journalInboundJobId } from '@open-archiver/journaling';
import { journalInboundQueue } from '../queues';

/**
 * Ensure a Phase-B job exists for `spoolTxId`, fresh or retried (`JR-6-04`).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this is its own module and not a function in `journal-inbound.processor.ts`
 * ---------------------------------------------------------------------------------------------
 * It started there. `journal-inbound.processor.ts` constructs `IngestionService`/`StorageService` at
 * module scope, and `config/storage.ts` **throws at import** when `STORAGE_TYPE` is unset -- `F63`
 * case 1, the finding that cost `JR-6-02b` its first CI cycle. Any test that wanted to exercise the
 * enqueue decision therefore had to satisfy the whole storage configuration first, to run a function
 * that touches nothing but Redis. Measured, not predicted: importing it from the processor took 23 of
 * 109 test files down with `Invalid STORAGE_TYPE: undefined` on a host that had not set it.
 *
 * The dependency this function actually has is the queue. Keeping it in a module whose entire import
 * graph is `bullmq` types, `../queues` and the journaling contract is what makes that true in the
 * import graph too, rather than only in the doc comment.
 *
 * ---------------------------------------------------------------------------------------------
 * Why `add()` alone is not enough
 * ---------------------------------------------------------------------------------------------
 * `Queue.add()` with a deterministic `jobId` is a no-op when a job with that id is still known to
 * BullMQ -- **including one sitting in the failed set**. That is exactly the case the reconciler
 * exists to unstick: a job that exhausted `journalInboundQueue`'s retry budget (`../queues.ts`,
 * roughly 85 minutes) and is now failed, while its spool entry still sits in `incoming/` with a ledger
 * receipt. Silently trusting `add()` would report the entry as reconciled while BullMQ left the stale
 * failed job untouched and never ran it again. `retry()` (valid only from `'failed'` or
 * `'completed'`) is what actually grants a fresh attempt; a genuinely absent job -- the ordinary
 * "Redis was wiped" case the backlog criterion names -- still goes through `add()`.
 *
 * `journal-spool-reconciler.int.test.ts` proves both halves against real BullMQ, and proves the
 * `add()`-is-a-no-op premise itself rather than citing it.
 *
 * `queue` is a parameter with a production default so that test can use a queue whose name is unique
 * to its run: `journal-inbound-worker.int.test.ts` sets the rule that no test may obliterate the
 * shared `journal-inbound` queue, "a queue that a later epic will feed".
 */
export async function enqueueForReconcile(
	spoolTxId: string,
	queue: Queue = journalInboundQueue
): Promise<void> {
	const jobId = journalInboundJobId(spoolTxId);
	const existing = await queue.getJob(jobId);
	if (existing === undefined) {
		await queue.add(JOURNAL_INBOUND_JOB_NAME, { spoolTxId }, { jobId });
		return;
	}
	const state = await existing.getState();
	if (state === 'failed' || state === 'completed') {
		await existing.retry(state);
	}
	// Anything else (active, waiting, delayed) is already going to run on its own; re-adding under the
	// same id would be a no-op anyway, so there is nothing to do.
}
