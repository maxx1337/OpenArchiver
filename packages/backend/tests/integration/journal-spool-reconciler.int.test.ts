import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres, probeRedis } from '@oa-test/infra';
import { coverageNotice } from '@oa-test/notice';
import postgres from 'postgres';
import { Queue, Worker } from 'bullmq';
import {
	ensureIncomingShardDir,
	generateTxId,
	incomingFilePath,
	journalInboundJobId,
	JOURNAL_INBOUND_JOB_NAME,
	NodeSpoolFileSystem,
	PostgresLedgerLookup,
	PostgresLedgerWriter,
	runSpoolReconcile,
	type LedgerAppendRequest,
} from '@open-archiver/journaling';
import { connection } from '../../src/config/redis';
import { enqueueForReconcile } from '../../src/jobs/processors/journal-reconcile-enqueue';
import { acquireTestDatabase } from '../support/pg-harness';
import { bareLedgerQuery, postgresTransactor } from '../support/postgres-transactor';
import { seedIngestionSource } from '../support/iam-seed';

/**
 * The spool reconciler against real Postgres, real disk and real Redis (`JR-6-04`). Classification:
 * `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * What this proves that the suites below it cannot, and what it deliberately does not re-prove
 * ---------------------------------------------------------------------------------------------
 * `reconciler.test.ts` proves the sweep enqueues exactly the scan's `requeue` list against a fake
 * enqueue port. `journal-crash-recovery-lock.int.test.ts` (`JR-4-18`) already proves the
 * requeue/quarantine outcome itself against a real ledger row and real files, and holds the advisory
 * lock under a genuinely concurrent second connection. **Neither of those is re-proved here** -- a
 * third copy of "an orphan gets quarantined" would cost a database and buy nothing.
 *
 * What is left, and what only real BullMQ can answer, is the backlog's own acceptance criterion for
 * `JR-6-04`: *"Bei geleerter Redis-Queue werden alle offenen Spool-Einträge wieder aufgenommen; kein
 * Datenverlust."* That is a claim about a queue, not about a scan, and the second test below is the
 * half of it that is easy to get wrong and impossible to see from a fake.
 *
 * ---------------------------------------------------------------------------------------------
 * Why a test-scoped queue name, and why that still satisfies "emptied queue"
 * ---------------------------------------------------------------------------------------------
 * `journal-inbound-worker.int.test.ts` states the rule: *"Nothing is obliterated -- a test must not be
 * able to empty a queue that a later epic will feed."* Emptying the shared `journal-inbound` queue to
 * simulate a wiped Redis would break exactly that rule, and under Vitest's parallel file execution it
 * would race any other suite feeding the same queue. A queue with a name unique to this run **is** an
 * emptied queue -- it starts with nothing in it, which is the state the criterion describes -- and the
 * reconciler's `enqueue` port is injected precisely so the decision of *which* queue is the caller's
 * (`reconciler.ts`'s own module doc comment). Obliterating a queue this file created is safe because
 * nothing else knows its name.
 *
 * ---------------------------------------------------------------------------------------------
 * Why `enqueueForReconcile` is imported from its own module and not from the processor
 * ---------------------------------------------------------------------------------------------
 * Measured while writing this file, not anticipated: importing it from `journal-inbound.processor.ts`
 * took **23 of 109 test files** down with `Invalid STORAGE_TYPE: undefined`, because that module's
 * scope constructs `StorageService` and `config/storage.ts` throws at import time without it -- `F63`
 * case 1, the finding that already cost `JR-6-02b` a CI cycle. A function whose only dependency is
 * Redis now lives in `journal-reconcile-enqueue.ts`, where the import graph says so too.
 */

const postgresProbe = await probePostgres();
const redisProbe = await probeRedis();
const requirement = !postgresProbe.available ? postgresProbe : redisProbe;
const enabled = requirement.available && isClassSelected('ci');

const harness = enabled ? await acquireTestDatabase('spool-reconciler') : undefined;

const bareClient = harness
	? postgres(harness.url, { max: 3, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} })
	: undefined;

/** Unique per run -- see the module doc comment on why this is not the shared queue. */
const QUEUE_NAME = `journal-inbound-reconciler-test-${generateTxId()}`;

const queues: Queue[] = [];
const workers: Worker[] = [];
let spoolDir: string | undefined;

function testQueue(): Queue {
	const queue = new Queue(QUEUE_NAME, { connection });
	queues.push(queue);
	return queue;
}

afterEach(async () => {
	if (spoolDir) {
		await rm(spoolDir, { recursive: true, force: true }).catch(() => undefined);
		spoolDir = undefined;
	}
});

afterAll(async () => {
	for (const worker of workers) {
		await worker.close().catch(() => undefined);
	}
	for (const queue of queues) {
		// Safe: this queue's name is unique to this run. See the module doc comment.
		await queue.obliterate({ force: true }).catch(() => undefined);
		await queue.close().catch(() => undefined);
	}
	await bareClient?.end({ timeout: 10 }).catch(() => undefined);
});

const BASE_MICROS = 1_785_600_000_000_000n;

const receipt = (chainScopeId: string, spoolTxId: string): LedgerAppendRequest => ({
	chainScopeId,
	receivedAtMicros: BASE_MICROS,
	eventType: 'receipt',
	remoteIp: '192.0.2.77',
	ehloName: 'mail.example.com',
	tlsVersion: 'TLSv1.3',
	tlsCipher: 'TLS_AES_256_GCM_SHA384',
	envelopeFrom: 'sender@example.com',
	envelopeRcpt: ['rcpt@example.com'],
	sizeBytes: 64n,
	contentSha256: null,
	duplicateOf: null,
	journalingSourceId: null,
	spoolTxId,
	eventPayload: null,
});

async function deploymentId(): Promise<string> {
	const rows = await harness!.sql<{ deployment_id: string }[]>`
		select deployment_id from deployment_identity
	`;
	return rows[0]!.deployment_id;
}

/** Write a spool file into `incoming/` and give it the ledger receipt Phase A would have written. */
async function seedOpenSpoolEntry(
	fs: NodeSpoolFileSystem,
	writer: PostgresLedgerWriter,
	root: string,
	chainScopeId: string
): Promise<string> {
	const txId = generateTxId();
	await ensureIncomingShardDir(fs, root, txId);
	const handle = await fs.createFile(incomingFilePath(root, txId));
	await handle.write(Buffer.from(`spool bytes for ${txId}`));
	await handle.close();
	await writer.append(receipt(chainScopeId, txId));
	return txId;
}

async function waitForState(
	queue: Queue,
	jobId: string,
	wanted: string,
	timeoutMs = 10_000
): Promise<void> {
	const start = Date.now();
	for (;;) {
		const job = await queue.getJob(jobId);
		const state = job === undefined ? 'missing' : await job.getState();
		if (state === wanted) {
			return;
		}
		if (Date.now() - start > timeoutMs) {
			throw new Error(`job ${jobId} was "${state}", not "${wanted}", within ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

suiteRequiring(
	'ci',
	'Spool reconciler against Postgres, disk and Redis (JR-6-04)',
	requirement,
	() => {
		it('refills an empty queue from the spool: every open entry comes back, none lost', async () => {
			const source = await seedIngestionSource(harness!.db);
			const writer = new PostgresLedgerWriter({
				deploymentId: await deploymentId(),
				transactor: postgresTransactor(bareClient!),
			});
			spoolDir = await mkdtemp(path.join(tmpdir(), 'oa-spool-reconciler-'));
			const fs = new NodeSpoolFileSystem();
			const queue = testQueue();

			// Three accepted-but-unprocessed transactions: bytes fsynced into `incoming/`, receipt
			// committed, Phase B never run. This is the state a Redis flush leaves behind -- the spool
			// and the ledger still hold everything, the queue holds nothing.
			const txIds = [
				await seedOpenSpoolEntry(fs, writer, spoolDir, source.id),
				await seedOpenSpoolEntry(fs, writer, spoolDir, source.id),
				await seedOpenSpoolEntry(fs, writer, spoolDir, source.id),
			];

			// The queue really is empty before the sweep -- otherwise this proves nothing.
			expect(await queue.getJobCountByTypes('waiting', 'active', 'delayed', 'failed')).toBe(
				0
			);

			const result = await runSpoolReconcile({
				fs,
				ledgerLookup: new PostgresLedgerLookup(bareLedgerQuery(bareClient!)),
				spoolRoot: spoolDir,
				alertSink: {
					alert: (event) => {
						// Every file here has a receipt, so a quarantine alert means the scan took a
						// wrong branch and the assertion below would be measuring the wrong thing.
						throw new Error(`unexpected quarantine alert for ${event.spoolTxId}`);
					},
				},
				transactor: postgresTransactor(bareClient!),
				enqueue: (spoolTxId) => enqueueForReconcile(spoolTxId, queue),
			});

			expect(result.incomingFilesScanned).toBe(3);
			expect(result.requeuedCount).toBe(3);
			expect(result.quarantinedCount).toBe(0);

			// "Kein Datenverlust" measured as identity, not as a count: each transaction is back under
			// its own deterministic job id, carrying its own `spoolTxId` and nothing else (the
			// one-field payload `queue-contract.ts` fixes structurally).
			for (const txId of txIds) {
				const job = await queue.getJob(journalInboundJobId(txId));
				expect(job, `no job for ${txId}`).toBeDefined();
				expect(job!.name).toBe(JOURNAL_INBOUND_JOB_NAME);
				expect(job!.data).toEqual({ spoolTxId: txId });
			}
			expect(await queue.getJobCountByTypes('waiting', 'delayed')).toBe(3);

			coverageNotice(
				`[JR-6-04] emptied queue refilled from spool: ${result.requeuedCount} of ` +
					`${result.incomingFilesScanned} entries re-enqueued under their own job ids, ` +
					`0 quarantined`
			);
		});

		it('retries a job stranded in the failed set -- which a plain add() provably does not', async () => {
			const source = await seedIngestionSource(harness!.db);
			const writer = new PostgresLedgerWriter({
				deploymentId: await deploymentId(),
				transactor: postgresTransactor(bareClient!),
			});
			spoolDir = await mkdtemp(path.join(tmpdir(), 'oa-spool-reconciler-failed-'));
			const fs = new NodeSpoolFileSystem();
			const queue = testQueue();

			const txId = await seedOpenSpoolEntry(fs, writer, spoolDir, source.id);
			const jobId = journalInboundJobId(txId);

			// Strand the job the way production does: it exhausts its attempts and lands in the failed
			// set while its spool entry is still sitting in `incoming/` with a receipt. Driven by a real
			// worker rather than `moveToFailed()` so the job reaches that state through BullMQ's own
			// transitions, not a test's approximation of them.
			await queue.add(JOURNAL_INBOUND_JOB_NAME, { spoolTxId: txId }, { jobId, attempts: 1 });
			// The return type is annotated rather than inferred: a processor whose body only throws
			// infers `Promise<never>`, and `Worker<any, never, string>` is not assignable to the
			// `Worker` the cleanup array holds (`any` is assignable to everything except `never`).
			const worker = new Worker(
				QUEUE_NAME,
				async (): Promise<void> => {
					throw new Error('stranding this job on purpose');
				},
				{ connection, concurrency: 1 }
			);
			workers.push(worker);
			await waitForState(queue, jobId, 'failed');
			await worker.close();

			// The calibration this test exists for: `add()` under the same deterministic id is a no-op
			// while BullMQ still knows the id, so a reconciler built on `add()` alone would report the
			// entry as recovered and leave it failed forever. Measured, not asserted from the docs.
			await queue.add(JOURNAL_INBOUND_JOB_NAME, { spoolTxId: txId }, { jobId });
			expect(await (await queue.getJob(jobId))!.getState()).toBe('failed');

			// What the reconciler actually does.
			const result = await runSpoolReconcile({
				fs,
				ledgerLookup: new PostgresLedgerLookup(bareLedgerQuery(bareClient!)),
				spoolRoot: spoolDir,
				alertSink: {
					alert: (event) => {
						throw new Error(`unexpected quarantine alert for ${event.spoolTxId}`);
					},
				},
				transactor: postgresTransactor(bareClient!),
				enqueue: (spoolTxId) => enqueueForReconcile(spoolTxId, queue),
			});

			expect(result.requeuedCount).toBe(1);
			const state = await (await queue.getJob(jobId))!.getState();
			expect(state).not.toBe('failed');
			expect(['waiting', 'active', 'delayed', 'completed']).toContain(state);

			coverageNotice(
				`[JR-6-04] stranded failed job: add() left it "failed", reconciler moved it to ` +
					`"${state}" -- the failed -> retry() branch is exercised, not assumed`
			);
		});
	}
);
