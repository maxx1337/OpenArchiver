import { Worker, type Job } from 'bullmq';
import {
	JOURNAL_INBOUND_JOB_NAME,
	JOURNAL_INBOUND_QUEUE_NAME,
	JOURNAL_RECONCILE_JOB_ID,
	JOURNAL_RECONCILE_JOB_NAME,
} from '@open-archiver/journaling';
import { connection } from '../config/redis';
import { journalInboundQueue } from '../jobs/queues';
import {
	journalInboundProcessor,
	journalReconcileProcessor,
	ledgerSql,
} from '../jobs/processors/journal-inbound.processor';
import { logger } from '../config/logger';
import {
	JOURNAL_INBOUND_CONCURRENCY_VAR,
	JOURNAL_INBOUND_LOCK_DURATION_MS,
	JOURNAL_INBOUND_MAX_STALLED_COUNT,
	JOURNAL_RECONCILE_INTERVAL_VAR,
	resolveJournalInboundConcurrency,
	resolveJournalReconcileIntervalMs,
} from './journal-inbound.options';

/**
 * The `journal-inbound` worker (`JR-6-01`, architecture doc section 6).
 *
 * Phase B of the journaling receiver: everything that happens **after** the SMTP `250`. The
 * acceptance contract is already discharged when a job arrives here -- the wire bytes are fsynced into
 * the spool and the ledger receipt is committed -- so nothing this process does can affect whether a
 * message was accepted. What it does affect is whether an accepted message becomes searchable, and
 * whether the spool entry is ever released.
 *
 * Its own entry point rather than a fourth job type on the `ingestion` queue, for the reason the
 * architecture doc gives in section 1: the two processes hold **different credentials**. This one has
 * full archive-metadata access, object-store write without any delete permission, and spool cleanup;
 * `apps/smtp-ingress` has neither the object store nor `archived_emails`. Sharing a worker process
 * would collapse that separation into a code convention, and the architecture doc is explicit that it
 * is realised through separate roles and environments instead.
 *
 * `pnpm --filter @open-archiver/backend start:journal-worker` runs it. It is deliberately **not** part
 * of `pnpm start:workers`, for the same reason `apps/smtp-ingress` is not part of `pnpm start:oss`:
 * the journaling receiver is an opt-in subsystem, and the three workers in `start:workers` are
 * required by every deployment. A worker for a queue nobody feeds would run in every OSS install.
 *
 * That choice has a cost, and it should be named rather than discovered: an operator who deploys the
 * ingress and forgets this process gets mail that is **accepted and never archived**. Nothing breaks
 * loudly -- the `250` is honest, the receipts accumulate in the ledger, the spool grows. The two
 * mitigations are elsewhere by design: spool depth and Phase-B backlog are monitored signals
 * (architecture section 10, E10), and the deployment wiring that starts the two together is E11.
 *
 * ---------------------------------------------------------------------------------------------
 * The queue parameters, and why each is what it is
 * ---------------------------------------------------------------------------------------------
 * `JR-6-01` asks for these to be set deliberately and for the reasoning to live in the code. It lives
 * in `./journal-inbound.options.ts`, one constant per decision, because importing *this* file
 * constructs a `Worker` and opens a Redis connection -- so the reasoning would otherwise sit somewhere
 * no test can read it. Short version: `lockDuration` 10 min against long synchronous MIME work,
 * `maxStalledCount: 0` because a stall-induced double-run races the `content_sha256` dedup of
 * `JR-6-03` against an append-only ledger, concurrency 3 because a spooled journal report is bigger
 * than a mailbox item.
 *
 * The retry budget and the failed-job retention are properties of the **queue**, not of the worker,
 * and are documented at `journalInboundQueue` in `../jobs/queues.ts`.
 *
 * ---------------------------------------------------------------------------------------------
 * The reconciler (`JR-6-04`) is a second job name on this same queue, registered by this same process
 * ---------------------------------------------------------------------------------------------
 * `journalInboundQueue.add(JOURNAL_RECONCILE_JOB_NAME, ..., { repeat: {...} })` below, right after
 * this file constructs the `Worker`, is the entire "where does the process live" decision (ADR-038):
 * no new process, and deliberately **not** a job registered from the shared `sync-scheduler.ts` --
 * that process runs unconditionally in every OSS install (`CLAUDE.md`'s runtime topology table), and
 * the journaling receiver is opt-in (see this file's own module doc comment above, "not part of
 * `pnpm start:workers`"). Registering the repeat job from a process nobody who has not deployed
 * journaling ever runs keeps that boundary intact. The registration itself mirrors the pattern
 * `sync-scheduler.ts` uses for `ingestionQueue`/`indexingQueue`: `queue.add(name, {}, { jobId,
 * repeat })` is idempotent, so calling it on every worker startup (a restart, a redeploy) is safe --
 * BullMQ treats a second registration with the same `jobId` and `repeat` shape as a no-op, not a
 * second schedule.
 */

const processor = async (job: Job) => {
	switch (job.name) {
		case JOURNAL_INBOUND_JOB_NAME:
			return journalInboundProcessor(job);
		case JOURNAL_RECONCILE_JOB_NAME:
			return journalReconcileProcessor();
		default:
			// Same posture as the ingestion worker: an unknown name is a wiring defect, and failing the
			// job surfaces it. Completing it would report a message as archived that nothing looked at.
			throw new Error(
				`Unknown job name on the ${JOURNAL_INBOUND_QUEUE_NAME} queue: ${job.name}`
			);
	}
};

const worker = new Worker(JOURNAL_INBOUND_QUEUE_NAME, processor, {
	connection,
	concurrency: resolveJournalInboundConcurrency(process.env[JOURNAL_INBOUND_CONCURRENCY_VAR]),
	lockDuration: JOURNAL_INBOUND_LOCK_DURATION_MS,
	maxStalledCount: JOURNAL_INBOUND_MAX_STALLED_COUNT,
	removeOnComplete: {
		count: 100,
	},
	removeOnFail: {
		count: 500,
	},
});

// Emitted after the Worker is constructed and therefore after the concurrency override has had its
// say: a rejected override must abort startup rather than appear in a line claiming the worker is up.
logger.info(
	{
		queue: JOURNAL_INBOUND_QUEUE_NAME,
		concurrency: worker.opts.concurrency,
		lockDurationMs: worker.opts.lockDuration,
		maxStalledCount: worker.opts.maxStalledCount,
	},
	'Journal inbound worker started'
);

// Resolved synchronously, before the async registration below -- a malformed override must abort
// startup the same way the concurrency override does, not surface as a repeat job silently never
// registered.
const reconcileIntervalMs = resolveJournalReconcileIntervalMs(
	process.env[JOURNAL_RECONCILE_INTERVAL_VAR]
);

// Registers the reconciler's repeatable job on this same queue (see the module doc comment,
// "The reconciler (JR-6-04) is a second job name..."). No top-level `await`: this package compiles
// to CommonJS (`tsconfig.base.json`'s `module: nodenext` without `"type": "module"` in
// `package.json`), which does not support it. `journalInboundQueue.add()` with a fixed `jobId` is
// itself idempotent, so a registration that has not yet resolved when the first job arrives costs
// nothing -- the `Worker` above is already listening on the queue independently of this promise.
journalInboundQueue
	.add(
		JOURNAL_RECONCILE_JOB_NAME,
		{},
		{
			jobId: JOURNAL_RECONCILE_JOB_ID,
			repeat: { every: reconcileIntervalMs },
		}
	)
	.then(() => {
		logger.info(
			{ intervalMs: reconcileIntervalMs },
			'Journal inbound reconciler sweep scheduled'
		);
	})
	.catch((err: unknown) => {
		// Not fatal: the worker itself is already up and processing ordinary jobs. A sweep that never
		// got scheduled means the reconciler's own safety net is missing, which is exactly the kind of
		// silent gap architecture doc section 3 exists to prevent -- log loudly rather than retry
		// silently, since retrying a malformed `repeat` option would just fail the same way again.
		logger.error({ err }, 'Failed to schedule the journal inbound reconciler sweep');
	});

// Same last-resort net as the ingestion worker, and for the same reason: an escaped rejection would
// otherwise take the process down, `concurrently` does not restart it, and the Phase-B backlog then
// grows silently behind a spool that keeps accepting. Ordinary errors thrown inside a job are rejected
// and retried by BullMQ as usual, so this only catches genuinely-escaped async failures. It does not
// re-run the offending job -- an escaped rejection is disconnected from BullMQ -- but the spool entry
// it belonged to is still authoritative and the reconciler (`JR-6-04`) will find it.
process.on('unhandledRejection', (reason) => {
	logger.error({ reason }, 'Unhandled promise rejection in journal inbound worker - continuing');
});
process.on('uncaughtException', (err) => {
	logger.error({ err }, 'Uncaught exception in journal inbound worker - continuing');
});

// `worker.close()` lets in-flight jobs finish before the process exits. That matters more here than
// for a mailbox sync: a job killed mid-flight leaves a spool entry whose Phase B is half done, which
// is recoverable but costs the reconciler a pass.
//
// `JR-6-02b` gave this process its first real, persistent Postgres connections -- the bare ledger
// connection (`ledgerSql`) and, transitively through `IngestionService`/`StorageService`, the
// `packages/backend/src/database` singleton. Measured against CI: closing `ledgerSql` alone still
// left the process alive past the test's 20 s bound after `worker.close()` resolved, so a held handle
// somewhere in that graph -- not identified further, since a hanging shutdown is the worse trade
// either way (a supervisor `SIGKILL`s a process that never exits on its own) -- keeps the event loop
// alive regardless. `process.exit(0)` forces the exit explicitly, only *after* `worker.close()` has
// resolved (no job is still running by the time it is called) and a best-effort attempt to close
// `ledgerSql` cleanly first.
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

async function shutdown(): Promise<void> {
	await worker.close();
	await ledgerSql.end().catch((err) => {
		logger.warn(
			{ err },
			'Failed to close the ledger connection during shutdown - exiting anyway'
		);
	});
	process.exit(0);
}
