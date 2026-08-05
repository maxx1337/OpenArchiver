import { Queue } from 'bullmq';
import { JOURNAL_INBOUND_QUEUE_NAME } from '@open-archiver/journaling';
import { connection } from '../config/redis';

// Default job options
const defaultJobOptions = {
	attempts: 5,
	backoff: {
		type: 'exponential',
		delay: 1000,
	},
	removeOnComplete: {
		count: 1000,
	},
	removeOnFail: {
		count: 5000,
	},
};

export const ingestionQueue = new Queue('ingestion', {
	connection,
	defaultJobOptions,
});

export const indexingQueue = new Queue('indexing', {
	connection,
	defaultJobOptions,
});

// Queue for the Data Lifecycle Manager (retention policy enforcement)
export const complianceLifecycleQueue = new Queue('compliance-lifecycle', {
	connection,
	defaultJobOptions,
});

/**
 * Phase B of the journaling receiver (`JR-6-01`, architecture doc section 6).
 *
 * The queue name and the deterministic job id come from `@open-archiver/journaling` -- see
 * `phase-b/queue-contract.ts` for why they are not defined here (`apps/smtp-ingress` also enqueues,
 * and it must not import from this package).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this queue does not take `defaultJobOptions` above
 * ---------------------------------------------------------------------------------------------
 * The shared options are `attempts: 5` with exponential backoff from 1s: five tries inside roughly
 * 31 seconds, then the job is failed and left in the failed set. For ingestion that is right -- the
 * scheduler comes back around. For Phase B it is wrong in a specific way. `JR-6-06` requires that an
 * unreachable object store still lets messages be **accepted** (the receipt is already in the ledger
 * -- the SMTP `250` was answered before this queue was ever touched) and that the backlog drains once
 * storage returns. A 31-second window means an ordinary S3 blip exhausts the retries and hands every
 * pending message to the reconciler (`JR-6-04`).
 *
 * That would not lose data -- the spool is authoritative until Phase B confirms, and the reconciler
 * re-enqueues from disk. But a safety net that catches every routine restart of a dependency is not a
 * safety net any more; it is the normal path, and the one thing it must not become is normal, because
 * then a genuine reconciler defect hides behind a backlog that always drains eventually.
 *
 * So: ten attempts from a 5s base (last gap ≈ 42 min, roughly 85 min of retrying in total), which
 * covers a dependency restart or a short outage inside the queue, and leaves the reconciler for what
 * it is for -- a crash between enqueue and completion, a flushed Redis, an outage longer than the
 * retry budget.
 *
 * `removeOnFail` is deliberately large: a failed Phase-B job is an operator-visible artefact of a
 * message that has already been acknowledged to the sender, and the ledger receipt for it exists.
 * Discarding that record early would remove the cheapest evidence of what the backlog consisted of.
 */
export const journalInboundQueue = new Queue(JOURNAL_INBOUND_QUEUE_NAME, {
	connection,
	defaultJobOptions: {
		attempts: 10,
		backoff: {
			type: 'exponential',
			delay: 5000,
		},
		removeOnComplete: {
			count: 1000,
		},
		removeOnFail: {
			count: 20000,
		},
	},
});
