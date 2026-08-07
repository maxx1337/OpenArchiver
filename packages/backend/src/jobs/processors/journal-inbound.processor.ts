import type { Job } from 'bullmq';
import {
	NodeSpoolEntryReader,
	NodeSpoolEntryReleaser,
	NodeSpoolFileSystem,
	PostgresLedgerLookup,
	PostgresLedgerWriter,
	runPhaseBPipeline,
	runSpoolReconcile,
	type JournalInboundJobData,
	type LedgerBackend,
	type PhaseBAlert,
	type SpoolReconcileResult,
} from '@open-archiver/journaling';
import { enqueueForReconcile } from './journal-reconcile-enqueue';
import { IngestionService } from '../../services/IngestionService';
import { StorageService } from '../../services/StorageService';
import { SearchService } from '../../services/SearchService';
import { DatabaseService } from '../../services/DatabaseService';
import { IndexingService } from '../../services/IndexingService';
import { logger } from '../../config/logger';
import {
	JOURNAL_SPOOL_ROOT_VAR,
	resolveJournalSpoolRoot,
} from '../../workers/journal-inbound.options';
import {
	createLedgerQuery,
	openBareLedgerConnection,
	postgresTransactor,
} from './journal-ledger-query-adapter';
import { DrizzleOrganizationDomainsAdapter } from './journal-organization-domains-adapter';
import { createJournalArchiveObjectPort } from './journal-archive-object-adapter';

/**
 * Phase B of the journaling receiver -- the job body (`JR-6-02b`, architecture doc section 6).
 *
 * `JR-6-01` built the process this runs inside; `JR-6-02a` built the gate that decides whether a
 * spool entry may be archived at all; ADR-010 decided that archiving reuses
 * `IngestionService.processEmail()` unmodified, behind an injected port. This file is the seam
 * between all of that and BullMQ: it constructs the concrete adapters `packages/journaling` cannot
 * construct itself (no DB, no config import -- architecture doc section 2) and hands them to
 * `runPhaseBPipeline()`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this throws on any non-success outcome, rather than catching and completing
 * ---------------------------------------------------------------------------------------------
 * `runPhaseBPipeline()`'s own contract (see its module doc comment) is to throw for everything short
 * of a fully archived-and-indexed message. This processor does not soften that: a completed Phase-B
 * job is the claim `JR-6-04`'s reconciler reads to leave a spool entry alone, and turning a thrown
 * error into a logged-and-completed job here would be exactly the `JR-4-10`/F48 shape this project has
 * already paid for twice -- the absence of work and its success printing identically.
 *
 * ---------------------------------------------------------------------------------------------
 * Alerting: gate refusals go through `PhaseBAlertSink`; two more Phase-B events are logged directly
 * ---------------------------------------------------------------------------------------------
 * `alertSink` below wires `classifySpoolEntry()`'s refusal verdicts (`no_receipt`, `content_mismatch`,
 * …) to structured logs, at the severity `alertSeverityFor()` already decided. Two events this slice
 * introduces -- an owner resolution that fell all the way through to `'fallback'`, and a `parse_failed`
 * result -- are logged the same way, directly from this processor's own success path below, rather
 * than being forced through `PhaseBAlertSink`'s payload type (`SpoolEntryVerdict`-shaped, from
 * `JR-6-02a`, and not a natural fit for either). Whether every Phase-B alert should eventually share
 * one typed channel is left open for the Product Owner; see `06-status.md`.
 *
 * ---------------------------------------------------------------------------------------------
 * `journalReconcileProcessor` (`JR-6-04`) below is a second job body on the same queue
 * ---------------------------------------------------------------------------------------------
 * The reconciler sweep reuses `ledgerLookup`/`spoolRoot`/`ledgerSql` this file already constructs for
 * `journalInboundProcessor` -- see `reconciler.ts`'s own module doc comment for why the sweep itself
 * is thin (`runExclusiveCrashRecoveryScan()` plus one loop) and ADR-038 for why it lives here, as a
 * repeatable job on this same worker, rather than a new process or the shared `sync-scheduler.ts`.
 */

const ingestionService = new IngestionService();
const storageService = new StorageService();
const searchService = new SearchService();
const databaseService = new DatabaseService();
const indexingService = new IndexingService(databaseService, searchService, storageService);

/**
 * The bare `postgres-js` connection the ledger lookup uses (see `journal-ledger-query-adapter.ts`).
 * Exported so `journal-inbound.worker.ts` can close it on `SIGINT`/`SIGTERM` -- an idle `postgres-js`
 * connection holds an open socket that keeps the event loop alive, and `worker.close()` (BullMQ)
 * has no idea this connection exists to close it. Without this, the process never exits after a
 * graceful `worker.close()` completes, and a supervisor ends up `SIGKILL`ing it after its own
 * timeout -- exactly the "hanging shutdown" outcome `journal-inbound.worker.ts`'s own doc comment
 * says is the worse trade against a bounded wait.
 */
export const ledgerSql = openBareLedgerConnection();
const ledgerLookup = new PostgresLedgerLookup(createLedgerQuery(ledgerSql));

/**
 * Lazily builds the `LedgerBackend` `JR-6-03`'s `duplicate_of` marker is appended through.
 *
 * Memoized rather than constructed at module load: unlike `ledgerLookup` above (a bare `SELECT`,
 * safe against any connection state), building this needs an async `deployment_id` read
 * (`PostgresLedgerWriter`'s own doc comment: read once, never per append) that module-level code
 * cannot await without top-level `await`. On rejection the cached promise is reset to `null` so a
 * later job -- not necessarily this one -- gets to retry, the same "do not make a transient failure
 * permanent for the life of the process" reasoning `apps/smtp-ingress/src/index.ts`'s
 * `JournalAcceptanceBootstrap` already applies to the equivalent read on that process.
 */
let ledgerBackendPromise: Promise<LedgerBackend> | null = null;
function getLedgerBackend(): Promise<LedgerBackend> {
	if (ledgerBackendPromise === null) {
		ledgerBackendPromise = (async () => {
			const rows = await ledgerSql<{ deployment_id: string }[]>`
				select deployment_id from deployment_identity
			`;
			const deploymentId = rows[0]?.deployment_id;
			if (deploymentId === undefined) {
				throw new Error(
					'deployment_identity has no row -- has this database been migrated?'
				);
			}
			return new PostgresLedgerWriter({
				deploymentId,
				transactor: postgresTransactor(ledgerSql),
			});
		})();
		ledgerBackendPromise.catch(() => {
			ledgerBackendPromise = null;
		});
	}
	return ledgerBackendPromise;
}

const spoolRoot = resolveJournalSpoolRoot(process.env[JOURNAL_SPOOL_ROOT_VAR]);
const spoolEntryReader = new NodeSpoolEntryReader();
const organizationDomains = new DrizzleOrganizationDomainsAdapter();
const archiveObject = createJournalArchiveObjectPort(ingestionService, storageService);
const releaseSpoolEntry = new NodeSpoolEntryReleaser();

/** `classifySpoolEntry()` refusals -- ADR: routed to the logger at the severity the gate assigned. */
function logPhaseBAlert(alert: PhaseBAlert): void {
	const fields = {
		spoolTxId: alert.spoolTxId,
		spoolPath: alert.spoolPath,
		verdict: alert.verdict,
	};
	if (alert.severity === 'critical') {
		logger.error(fields, `Phase B refused to archive spool entry: ${alert.verdict.kind}`);
	} else {
		logger.warn(fields, `Phase B refused to archive spool entry: ${alert.verdict.kind}`);
	}
}

/**
 * Process one Phase-B job for one spool transaction id. See the module doc comment for why this
 * throws rather than catching -- BullMQ's own retry/fail bookkeeping is the reconciler's evidence
 * trail (`JR-6-04`).
 */
export const journalInboundProcessor = async (job: Job<JournalInboundJobData>) => {
	const { spoolTxId } = job.data;
	const result = await runPhaseBPipeline(spoolTxId, {
		spoolRoot,
		ledgerLookup,
		spoolEntryReader,
		organizationDomains,
		archiveObject,
		indexBatch: (pending) => indexingService.indexEmailBatch([...pending]),
		releaseSpoolEntry,
		alertSink: logPhaseBAlert,
		ledgerAppend: async (request) => (await getLedgerBackend()).append(request),
	});

	if (result.parseKind === 'parse_failed') {
		logger.warn(
			{ spoolTxId, owners: result.owners.map((o) => o.ownerEmail) },
			'Phase B archived a message that could not be parsed as a journal report (parse_failed) -- ' +
				'indexed whatever was extractable, never rejected'
		);
	}
	for (const owner of result.owners) {
		if (owner.method === 'fallback') {
			logger.warn(
				{ spoolTxId, ownerEmail: owner.ownerEmail },
				'Phase B could not resolve an owner for this message; archived under the configured ' +
					'fallback mailbox instead'
			);
		}
	}

	logger.info(
		{
			spoolTxId,
			parseKind: result.parseKind,
			ownerFidelity: result.ownerFidelity,
			owners: result.owners.map((o) => ({
				ownerEmail: o.ownerEmail,
				outcome: o.outcome.kind,
			})),
		},
		'Phase B archived and indexed spool entry'
	);

	return result;
};

/**
 * The enqueue decision lives in `journal-reconcile-enqueue.ts`, not here -- see that module's own doc
 * comment. Short version: this file's module scope constructs `StorageService`, and
 * `config/storage.ts` throws **at import** without `STORAGE_TYPE` (F63 case 1), so a function whose
 * only real dependency is Redis must not be reachable only through this import graph.
 */

/**
 * The reconciler sweep (`JR-6-04`). Reuses every dependency `journalInboundProcessor` above already
 * constructs at module scope -- no second Postgres connection, no second spool-root resolution --
 * because this worker process is the one place those already exist, tested (F63/F64), and closed on
 * shutdown (`journal-inbound.worker.ts`).
 */
export const journalReconcileProcessor = async (): Promise<SpoolReconcileResult> => {
	const result = await runSpoolReconcile({
		fs: new NodeSpoolFileSystem(),
		ledgerLookup,
		spoolRoot,
		alertSink: {
			alert: (event) => {
				logger.warn({ event }, 'journal-inbound reconciler: spool file quarantined');
			},
		},
		transactor: postgresTransactor(ledgerSql),
		enqueue: enqueueForReconcile,
	});

	logger.info(result, 'journal-inbound reconciler sweep complete');
	return result;
};

export default journalInboundProcessor;
