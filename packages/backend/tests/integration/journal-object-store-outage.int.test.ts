import { createHash } from 'node:crypto';
import { connect as connectTcp, type Socket } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres, probeRedis } from '@oa-test/infra';
import { coverageNotice } from '@oa-test/notice';
import postgres from 'postgres';
import { Queue, Worker } from 'bullmq';
import {
	EsmtpServer,
	JournalAcceptance,
	JOURNAL_INBOUND_JOB_NAME,
	NodeSpoolEntryReader,
	NodeSpoolEntryReleaser,
	NodeSpoolFileSystem,
	PhaseBArchiveFailedError,
	PostgresLedgerLookup,
	PostgresLedgerWriter,
	ensureIncomingShardDir,
	generateTxId,
	incomingFilePath,
	journalInboundJobId,
	runPhaseBPipeline,
	runSpoolReconcile,
	smtpServerConfigSchema,
	type ArchiveObjectOutcome,
	type ArchiveObjectPort,
	type EsmtpServerOptions,
	type LedgerAppendRequest,
	type RecipientAclEvaluator,
} from '@open-archiver/journaling';
import { connection } from '../../src/config/redis';
import { enqueueForReconcile } from '../../src/jobs/processors/journal-reconcile-enqueue';
import { acquireTestDatabase, loadBackendDatabaseSingleton } from '../support/pg-harness';
import { seedIngestionSource, seedJournalingSource } from '../support/iam-seed';
import { bareLedgerQuery, postgresTransactor } from '../support/postgres-transactor';
import { readLedgerChain, verifyChain } from '../support/ledger-verifier';

/**
 * `JR-6-06`: the object-store-outage test (Testplan section 12.4, backlog acceptance criterion "alle
 * drei Bedingungen erfüllt"). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why a fake `ArchiveObjectPort`, not a stopped MinIO
 * ---------------------------------------------------------------------------------------------
 * The testplan's own wording names "MinIO gestoppt" as the simulation, but this repository has no
 * MinIO/S3 service anywhere (`docker-compose.yml` has none, confirmed before writing this file) --
 * introducing one for a single test would be new CI infrastructure for a claim the existing DI seam
 * already carries at the same fidelity. `IngestionService.processEmail()` (`packages/backend/src/
 * services/IngestionService.ts`) catches *every* error from `storage.put()` -- a real S3
 * `ECONNREFUSED` included -- inside one `try/catch` and converts it to `{ error: true, message }`
 * (`ProcessEmailError`); `createJournalArchiveObjectPort()` maps that one-to-one to
 * `ArchiveObjectOutcome.kind === 'error'` (`journal-archive-object-adapter.ts`, `if ('error' in
 * result)`). A fake `ArchiveObjectPort` that returns exactly that outcome shape is therefore
 * indistinguishable, from `runPhaseBPipeline()`'s point of view, from a real storage failure -- which
 * is the whole point of ADR-010's port: Phase-B orchestration must not know *why* archiving failed,
 * only that it did. What this does **not** prove, and is named as a gap in the report rather than
 * silently assumed: a live S3/MinIO connection-refused round trip through the real
 * `S3StorageProvider`. That would need new CI infrastructure this task's own guidance says to avoid
 * without an explicit decision.
 *
 * ---------------------------------------------------------------------------------------------
 * Two tests, two conditions each -- because one of them needs no SMTP layer and the other needs no
 * BullMQ retry machinery, and forcing both into one `it` would make a failure ambiguous about which
 * condition broke
 * ---------------------------------------------------------------------------------------------
 * The first test proves condition 1 ("Nachrichten werden weiterhin quittiert"): with a `Phase-B`
 * pipeline call already thrown and observed for one backlog entry (the object store is *provably*
 * down at that instant, not hypothetically), a brand-new SMTP transaction on a real socket against a
 * real `EsmtpServer`/`JournalAcceptance` still gets `250 … queued as N`. It also checks that the
 * failed entry is left exactly alone (condition 3's first half): spool file untouched, no
 * `archived_emails` row, chain still clean.
 *
 * The second test proves condition 2 ("Backlog läuft nach Erholung ab, kein manuelles Eingreifen
 * nötig") end to end against real BullMQ: two backlog entries fail under real (short) retry/backoff
 * against the failing port, exactly as `journal-inbound.processor.ts`'s own doc comment describes for
 * `journalInboundQueue`'s ten-attempt budget (this test uses a much shorter budget so it does not take
 * 85 minutes -- the *mechanism* under test, "BullMQ fails a job it cannot honestly complete, and
 * something re-enqueues it later", is identical regardless of the concrete numbers). Recovery is
 * driven by `runSpoolReconcile()` (`JR-6-04`, ADR-038) -- the periodic sweep that would run on its own
 * schedule in production, not a human retrying failed jobs by hand, which is what "kein manuelles
 * Eingreifen nötig" actually asks for. The chain is recomputed before and after and must stay clean
 * throughout (condition 3, in full).
 *
 * ---------------------------------------------------------------------------------------------
 * Why `indexBatch` is a no-op stub
 * ---------------------------------------------------------------------------------------------
 * Same reasoning as `journal-hash-before-encryption.int.test.ts` (`JR-6-05`): this task's claim has
 * nothing to do with search, and stubbing it keeps the suite's infrastructure requirement at Postgres
 * + Redis + local storage, without a Meilisearch service container.
 */

const postgresProbe = await probePostgres();
const redisProbe = await probeRedis();
const requirement = !postgresProbe.available ? postgresProbe : redisProbe;
const enabled = requirement.available && isClassSelected('ci');

const harness = enabled ? await acquireTestDatabase('object-store-outage') : undefined;
if (harness) {
	harness.bindAsProcessDatabaseUrl();
	await loadBackendDatabaseSingleton();
}

// Deferred until after the bind above -- see journal-phase-b-e2e.int.test.ts's module doc comment for
// why: IngestionService/StorageService import packages/backend/src/database's module singleton, built
// once from process.env.DATABASE_URL at import time.
const IngestionService = harness
	? (await import('../../src/services/IngestionService')).IngestionService
	: undefined;
const StorageService = harness
	? (await import('../../src/services/StorageService')).StorageService
	: undefined;
const createJournalArchiveObjectPort = harness
	? (await import('../../src/jobs/processors/journal-archive-object-adapter'))
			.createJournalArchiveObjectPort
	: undefined;
const DrizzleOrganizationDomainsAdapter = harness
	? (await import('../../src/jobs/processors/journal-organization-domains-adapter'))
			.DrizzleOrganizationDomainsAdapter
	: undefined;

const bareClient = harness
	? postgres(harness.url, { max: 3, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} })
	: undefined;

/** Always returns `{ kind: 'error' }`, in the exact shape a real storage/S3 outage produces. */
const objectStoreDown: ArchiveObjectPort = async (): Promise<ArchiveObjectOutcome> => ({
	kind: 'error',
	message: 'connect ECONNREFUSED 127.0.0.1:9000 -- object store unreachable',
});

const noopIndexBatch = async (): Promise<void> => {};

async function deploymentId(): Promise<string> {
	const rows = await harness!.sql<{ deployment_id: string }[]>`
		select deployment_id from deployment_identity
	`;
	return rows[0]!.deployment_id;
}

/** A backlog entry: spool bytes fsynced into `incoming/` plus the Phase-A receipt Phase A would
 *  already have written for it -- the state an object-store outage leaves behind. */
async function seedBacklogEntry(
	fs: NodeSpoolFileSystem,
	writer: PostgresLedgerWriter,
	spoolRoot: string,
	chainScopeId: string,
	journalingSourceId: string,
	routingAddress: string,
	raw: Buffer
): Promise<{ txId: string; receiptSeq: bigint }> {
	const txId = generateTxId();
	await ensureIncomingShardDir(fs, spoolRoot, txId);
	const handle = await fs.createFile(incomingFilePath(spoolRoot, txId));
	await handle.write(raw);
	await handle.close();
	const appended = await writer.append({
		chainScopeId,
		receivedAtMicros: BigInt(Date.now()) * 1000n,
		eventType: 'receipt',
		remoteIp: '198.51.100.7',
		ehloName: 'mail.example.com',
		tlsVersion: 'TLSv1.3',
		tlsCipher: 'TLS_AES_256_GCM_SHA384',
		envelopeFrom: 'alice@example.com',
		envelopeRcpt: [routingAddress],
		sizeBytes: BigInt(raw.length),
		contentSha256: createHash('sha256').update(raw).digest(),
		duplicateOf: null,
		journalingSourceId,
		spoolTxId: txId,
		eventPayload: null,
	} satisfies LedgerAppendRequest);
	return { txId, receiptSeq: appended.seq };
}

function rawMessage(label: string): Buffer {
	return Buffer.from(
		`From: alice@example.com\r\nTo: bob@example.com\r\nSubject: Outage backlog ${label}\r\n\r\n` +
			`Body ${label}.\r\n`,
		'utf8'
	);
}

/** Minimal SMTP client -- send a line, read one (possibly multiline) reply, write raw bytes. Copied
 *  from journal-smtp-accept-e2e.int.test.ts's own copy rather than shared: every *.int.test.ts file in
 *  this directory that needs a real socket keeps its own, deliberately (see that file). */
class TestSmtpClient {
	private raw = '';
	private currentReplyLines: string[] = [];
	private readonly readyReplies: string[][] = [];
	private readonly waiters: Array<{ resolve: (lines: string[]) => void; timer: NodeJS.Timeout }> =
		[];

	constructor(private readonly socket: Socket) {
		socket.on('data', (chunk: Buffer) => this.onData(chunk));
	}

	private onData(chunk: Buffer): void {
		this.raw += chunk.toString('utf8');
		for (;;) {
			const idx = this.raw.indexOf('\r\n');
			if (idx === -1) return;
			const line = this.raw.slice(0, idx);
			this.raw = this.raw.slice(idx + 2);
			this.currentReplyLines.push(line);
			if (/^\d{3} /.test(line)) {
				const reply = this.currentReplyLines;
				this.currentReplyLines = [];
				const waiter = this.waiters.shift();
				if (waiter) {
					clearTimeout(waiter.timer);
					waiter.resolve(reply);
				} else {
					this.readyReplies.push(reply);
				}
			}
		}
	}

	send(line: string): void {
		this.socket.write(`${line}\r\n`);
	}

	writeRaw(text: string): void {
		this.socket.write(text);
	}

	nextReply(timeoutMs = 5_000): Promise<string[]> {
		const ready = this.readyReplies.shift();
		if (ready) return Promise.resolve(ready);
		return new Promise<string[]>((resolve, reject) => {
			const timer = setTimeout(() => {
				const idx = this.waiters.findIndex((w) => w.resolve === resolve);
				if (idx !== -1) this.waiters.splice(idx, 1);
				reject(new Error(`no SMTP reply within ${timeoutMs}ms`));
			}, timeoutMs);
			this.waiters.push({ resolve, timer });
		});
	}
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

const openServers: EsmtpServer[] = [];
const openSockets: Socket[] = [];
const queues: Queue[] = [];
const workers: Worker[] = [];
let spoolDir: string | undefined;

afterEach(async () => {
	for (const socket of openSockets.splice(0)) {
		if (!socket.destroyed) socket.destroy();
	}
	for (const server of openServers.splice(0)) {
		await server.close().catch(() => {});
	}
	for (const worker of workers.splice(0)) {
		await worker.close().catch(() => undefined);
	}
	for (const queue of queues.splice(0)) {
		// Safe: every queue name in this file is unique to its own test run (generateTxId()-suffixed),
		// never the shared production `journal-inbound` queue -- see journal-spool-reconciler.int.test.ts's
		// own module doc comment for why that rule exists.
		await queue.obliterate({ force: true }).catch(() => undefined);
		await queue.close().catch(() => undefined);
	}
	if (spoolDir) {
		await rm(spoolDir, { recursive: true, force: true }).catch(() => undefined);
		spoolDir = undefined;
	}
});

afterAll(async () => {
	await bareClient?.end({ timeout: 10 }).catch(() => undefined);
});

suiteRequiring(
	'ci',
	'Object-store outage: acceptance unaffected, backlog drains on recovery, chain untouched (JR-6-06)',
	requirement,
	() => {
		it('condition 1 + 3: SMTP acceptance keeps answering 250 while Phase B is provably failing, and the stuck entry is left exactly alone', async () => {
			const deployment = await deploymentId();
			const source = await seedIngestionSource(harness!.db, {
				provider: 'smtp_journaling',
				preserveOriginalFile: true,
				name: `outage-accept-source-${generateTxId()}`,
			});
			const journalingSource = await seedJournalingSource(harness!.db, {
				ingestionSourceId: source.id,
				name: `outage-accept-journaling-source-${generateTxId()}`,
			});

			spoolDir = await mkdtemp(path.join(tmpdir(), 'oa-outage-accept-'));
			const fs = new NodeSpoolFileSystem();
			const writer = new PostgresLedgerWriter({
				deploymentId: deployment,
				transactor: postgresTransactor(bareClient!),
			});
			const ledgerLookup = new PostgresLedgerLookup(bareLedgerQuery(bareClient!));
			const organizationDomains = new DrizzleOrganizationDomainsAdapter!();

			// --- Step 1: prove the object store really is down, right now, in this process. ---
			const stuck = await seedBacklogEntry(
				fs,
				writer,
				spoolDir,
				source.id,
				journalingSource.id,
				journalingSource.routingAddress,
				rawMessage('already-in-flight')
			);
			await expect(
				runPhaseBPipeline(stuck.txId, {
					spoolRoot: spoolDir,
					ledgerLookup,
					spoolEntryReader: new NodeSpoolEntryReader(),
					organizationDomains,
					archiveObject: objectStoreDown,
					indexBatch: noopIndexBatch,
					releaseSpoolEntry: new NodeSpoolEntryReleaser(),
					alertSink: (alert) => {
						throw new Error(`unexpected Phase-B alert: ${JSON.stringify(alert)}`);
					},
					ledgerAppend: (request) => writer.append(request),
				})
			).rejects.toThrow(PhaseBArchiveFailedError);

			// --- Step 2: with that failure freshly observed, a brand-new SMTP transaction still gets 250. ---
			const acceptance = new JournalAcceptance({
				fs,
				backend: writer,
				spoolConfig: { rootPath: spoolDir, highWaterBytes: 100_000_000n },
				alertSink: { alert: () => {} },
			});
			const recipientAclEvaluator: RecipientAclEvaluator = {
				evaluateRecipient: (address) =>
					address.toLowerCase() === journalingSource.routingAddress.toLowerCase()
						? {
								kind: 'allowed',
								sourceId: journalingSource.id,
								chainScopeId: source.id,
							}
						: { kind: 'denied' },
			};
			const options: EsmtpServerOptions = {
				smtp: smtpServerConfigSchema.parse({
					hostname: 'smtp-ingress-test',
					sizeLimitBytes: 10 * 1024 * 1024,
				}),
				recipientAclEvaluator,
				journalAcceptance: acceptance,
			};
			const server = new EsmtpServer(options);
			openServers.push(server);
			await server.listen(0, '127.0.0.1');
			const address = server.address;
			if (address === null) {
				throw new Error('server did not bind');
			}

			const socket = connectTcp(address.port, '127.0.0.1');
			openSockets.push(socket);
			await new Promise<void>((resolve, reject) => {
				socket.once('connect', () => resolve());
				socket.once('error', reject);
			});
			const client = new TestSmtpClient(socket);
			await client.nextReply(); // 220
			client.send('EHLO client.example.com');
			await client.nextReply();
			client.send('MAIL FROM:<alice@example.com>');
			await client.nextReply();
			client.send(`RCPT TO:<${journalingSource.routingAddress}>`);
			await client.nextReply();
			client.send('DATA');
			await client.nextReply(); // 354

			const liveMessage = rawMessage('accepted-during-outage');
			client.writeRaw(`${liveMessage.toString('utf8')}.\r\n`);
			const reply = await client.nextReply(10_000);

			if (process.platform === 'win32') {
				// Directory-fsync is POSIX-only (fs-port.ts's documented limitation) -- accept() maps
				// that to 'spool-write-failed' (451) on this host regardless of the object store, so
				// condition 1 cannot be measured here. Same gap, same handling as
				// journal-smtp-accept-e2e.int.test.ts: named explicitly, not silently skipped. The
				// deployment target is Linux (architecture doc section 7), where the branch below runs.
				expect(reply[0]).toMatch(/^451 4\.3\.0/);
				coverageNotice(
					'[JR-6-06] condition 1 (SMTP acceptance unaffected by an object-store outage) NOT ' +
						'verified on this platform -- directory fsync is POSIX-only (fs-port.ts), so ' +
						'accept() never reaches the point condition 1 is about. Verified on Linux CI.'
				);
			} else {
				expect(reply[0]).toMatch(/^250 2\.0\.0/);
				coverageNotice(
					'[JR-6-06] condition 1 verified: a real SMTP client received 250 immediately after ' +
						'a real runPhaseBPipeline() call had just thrown for a different transaction due ' +
						'to a simulated object-store outage.'
				);
			}
			client.send('QUIT');
			await client.nextReply();

			// --- Step 3 (condition 3, first half): the stuck entry was left exactly alone. ---
			const stuckPath = incomingFilePath(spoolDir, stuck.txId);
			await expect(readFile(stuckPath)).resolves.toBeInstanceOf(Buffer);
			const archivedRows = await bareClient!`
				select 1 from archived_emails where ingestion_source_id = ${source.id}
			`;
			expect(archivedRows).toHaveLength(0);

			const entries = await readLedgerChain(bareClient!, source.id);
			expect(entries).toHaveLength(process.platform === 'win32' ? 1 : 2);
			const findings = verifyChain({
				deploymentId: deployment,
				chainScopeId: source.id,
				entries,
			});
			expect(findings).toEqual([]);
		});

		it('condition 2 + 3: the backlog left behind by an outage drains completely once the object store recovers, via the reconciler -- no job is retried by hand', async () => {
			const deployment = await deploymentId();
			const source = await seedIngestionSource(harness!.db, {
				provider: 'smtp_journaling',
				preserveOriginalFile: true,
				name: `outage-drain-source-${generateTxId()}`,
			});
			const journalingSource = await seedJournalingSource(harness!.db, {
				ingestionSourceId: source.id,
				name: `outage-drain-journaling-source-${generateTxId()}`,
			});

			spoolDir = await mkdtemp(path.join(tmpdir(), 'oa-outage-drain-'));
			const fs = new NodeSpoolFileSystem();
			const writer = new PostgresLedgerWriter({
				deploymentId: deployment,
				transactor: postgresTransactor(bareClient!),
			});
			const ledgerLookup = new PostgresLedgerLookup(bareLedgerQuery(bareClient!));
			const organizationDomains = new DrizzleOrganizationDomainsAdapter!();
			const queueName = `journal-inbound-outage-test-${generateTxId()}`;
			const queue = new Queue(queueName, { connection });
			queues.push(queue);

			// Two distinct messages -- distinct content_sha256, so the recovery phase archives two
			// genuinely new objects rather than exercising JR-6-03's duplicate path (out of scope here).
			const entryA = await seedBacklogEntry(
				fs,
				writer,
				spoolDir,
				source.id,
				journalingSource.id,
				journalingSource.routingAddress,
				rawMessage('one')
			);
			const entryB = await seedBacklogEntry(
				fs,
				writer,
				spoolDir,
				source.id,
				journalingSource.id,
				journalingSource.routingAddress,
				rawMessage('two')
			);
			const jobIdA = journalInboundJobId(entryA.txId);
			const jobIdB = journalInboundJobId(entryB.txId);

			function makeProcessor(archiveObject: ArchiveObjectPort) {
				return async (job: { data: { spoolTxId: string } }): Promise<void> => {
					await runPhaseBPipeline(job.data.spoolTxId, {
						spoolRoot: spoolDir!,
						ledgerLookup,
						spoolEntryReader: new NodeSpoolEntryReader(),
						organizationDomains,
						archiveObject,
						indexBatch: noopIndexBatch,
						releaseSpoolEntry: new NodeSpoolEntryReleaser(),
						alertSink: (alert) => {
							throw new Error(`unexpected Phase-B alert: ${JSON.stringify(alert)}`);
						},
						ledgerAppend: (request) => writer.append(request),
					});
				};
			}

			// --- Phase 1: the outage. Short attempts/backoff so this does not take the production
			// 85-minute budget (journal-inbound.processor.ts's own doc comment) -- the mechanism under
			// test (BullMQ fails a job it cannot honestly complete) does not depend on the numbers.
			await queue.add(
				JOURNAL_INBOUND_JOB_NAME,
				{ spoolTxId: entryA.txId },
				{ jobId: jobIdA, attempts: 2, backoff: { type: 'fixed', delay: 50 } }
			);
			await queue.add(
				JOURNAL_INBOUND_JOB_NAME,
				{ spoolTxId: entryB.txId },
				{ jobId: jobIdB, attempts: 2, backoff: { type: 'fixed', delay: 50 } }
			);
			const outageWorker = new Worker(queueName, makeProcessor(objectStoreDown), {
				connection,
				concurrency: 2,
			});
			workers.push(outageWorker);
			await waitForState(queue, jobIdA, 'failed');
			await waitForState(queue, jobIdB, 'failed');
			await outageWorker.close();
			workers.splice(workers.indexOf(outageWorker), 1);

			// Nothing was archived, nothing was released, and the chain is exactly the two receipts --
			// clean, no partial rows, no marker fabricated from a failed attempt.
			for (const entry of [entryA, entryB]) {
				await expect(
					readFile(incomingFilePath(spoolDir, entry.txId))
				).resolves.toBeInstanceOf(Buffer);
			}
			expect(
				await bareClient!`select 1 from archived_emails where ingestion_source_id = ${source.id}`
			).toHaveLength(0);
			const midEntries = await readLedgerChain(bareClient!, source.id);
			expect(midEntries).toHaveLength(2);
			expect(
				verifyChain({
					deploymentId: deployment,
					chainScopeId: source.id,
					entries: midEntries,
				})
			).toEqual([]);

			// --- Phase 2: recovery. A worker with a *working* archiveObject port comes up (the object
			// store is reachable again), and the reconciler sweep -- not a human retrying either job --
			// is what moves the two failed jobs back to runnable.
			const realArchiveObject = createJournalArchiveObjectPort!(
				new IngestionService!(),
				new StorageService!()
			);
			const recoveryWorker = new Worker(queueName, makeProcessor(realArchiveObject), {
				connection,
				concurrency: 2,
			});
			workers.push(recoveryWorker);

			const reconcileResult = await runSpoolReconcile({
				fs,
				ledgerLookup,
				spoolRoot: spoolDir,
				alertSink: {
					alert: (event) => {
						throw new Error(`unexpected quarantine alert for ${event.spoolTxId}`);
					},
				},
				transactor: postgresTransactor(bareClient!),
				enqueue: (spoolTxId) => enqueueForReconcile(spoolTxId, queue),
			});
			expect(reconcileResult.incomingFilesScanned).toBe(2);
			expect(reconcileResult.requeuedCount).toBe(2);
			expect(reconcileResult.quarantinedCount).toBe(0);

			await waitForState(queue, jobIdA, 'completed');
			await waitForState(queue, jobIdB, 'completed');

			// Full drain: both spool files gone, both objects archived, nothing left pending.
			for (const entry of [entryA, entryB]) {
				await expect(
					readFile(incomingFilePath(spoolDir, entry.txId))
				).rejects.toMatchObject({
					code: 'ENOENT',
				});
			}
			const archivedRows = await bareClient!`
				select storage_hash_sha256 from archived_emails where ingestion_source_id = ${source.id}
			`;
			expect(archivedRows).toHaveLength(2);
			const expectedHashes = [
				createHash('sha256').update(rawMessage('one')).digest('hex'),
				createHash('sha256').update(rawMessage('two')).digest('hex'),
			].sort();
			expect(archivedRows.map((r) => r.storage_hash_sha256).sort()).toEqual(expectedHashes);

			// Condition 3, in full: the chain across the whole outage-and-recovery window is exactly
			// the two original receipts, unbroken, no fabricated or partial entries.
			const finalEntries = await readLedgerChain(bareClient!, source.id);
			expect(finalEntries).toHaveLength(2);
			expect(
				verifyChain({
					deploymentId: deployment,
					chainScopeId: source.id,
					entries: finalEntries,
				})
			).toEqual([]);

			coverageNotice(
				`[JR-6-06] conditions 2+3 verified: 2 backlog entries failed under a simulated object` +
					`-store outage (BullMQ retry/backoff exhausted), then fully drained after one ` +
					`reconciler sweep (JR-6-04/ADR-038) once a working archiveObject port replaced the ` +
					`failing one -- no job was retried by hand, and the chain shows 0 findings both ` +
					`before and after.`
			);
		});
	}
);
