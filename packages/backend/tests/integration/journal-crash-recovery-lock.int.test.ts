import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import postgres from 'postgres';
import {
	crashRecoveryScanLockKey,
	ensureIncomingShardDir,
	generateTxId,
	incomingFilePath,
	NodeSpoolFileSystem,
	PostgresLedgerLookup,
	PostgresLedgerWriter,
	quarantineFilePath,
	runExclusiveCrashRecoveryScan,
	type LedgerAppendRequest,
} from '@open-archiver/journaling';
import { acquireTestDatabase } from '../support/pg-harness';
import { bareLedgerQuery, postgresTransactor } from '../support/postgres-transactor';
import { seedIngestionSource } from '../support/iam-seed';

/**
 * `runExclusiveCrashRecoveryScan()` against real Postgres and real disk (`JR-4-18`). Classification:
 * `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * What this proves that `crash-recovery-lock.test.ts` (the unit suite, against fakes) cannot
 * ---------------------------------------------------------------------------------------------
 * The unit suite proves the *composition* is correct against a model of `pg_advisory_xact_lock`
 * semantics that this file's own author wrote. That model could be wrong. This file measures the real
 * thing: a second, independent `postgres-js` connection genuinely cannot proceed past
 * `pg_advisory_xact_lock` while this scan holds it, and genuinely does proceed the moment the holder's
 * transaction ends -- the exact property architecture doc section 5's "exklusiv" requirement and the
 * backlog's "zwei gleichzeitig startende Prozesse räumen sich nicht gegenseitig ab" criterion ask for.
 * It also re-proves the requeue/quarantine outcome (already covered against fakes by
 * `crash-recovery.test.ts`) against a real ledger row and real files on disk, which is what
 * `apps/smtp-ingress`'s own boot sequence actually exercises.
 */

const postgresProbe = await probePostgres();
const enabled = isClassSelected('ci') && postgresProbe.available;
const harness = enabled ? await acquireTestDatabase('crash-recovery-lock') : undefined;

const bareClient = harness
	? postgres(harness.url, { max: 3, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} })
	: undefined;

afterAll(async () => {
	await bareClient?.end({ timeout: 10 }).catch(() => undefined);
});

async function deploymentId(): Promise<string> {
	const rows = await harness!.sql<{ deployment_id: string }[]>`
		select deployment_id from deployment_identity
	`;
	return rows[0]!.deployment_id;
}

const BASE_MICROS = 1_785_500_000_000_000n;

const request = (chainScopeId: string, spoolTxId: string): LedgerAppendRequest => ({
	chainScopeId,
	receivedAtMicros: BASE_MICROS,
	eventType: 'receipt',
	remoteIp: '192.0.2.30',
	ehloName: 'mail.example.com',
	tlsVersion: 'TLSv1.3',
	tlsCipher: 'TLS_AES_256_GCM_SHA384',
	envelopeFrom: 'sender@example.com',
	envelopeRcpt: ['rcpt@example.com'],
	sizeBytes: 128n,
	contentSha256: null,
	duplicateOf: null,
	journalingSourceId: null,
	spoolTxId,
	eventPayload: null,
});

/** Wait until `predicate()` is true or `timeoutMs` elapses, polling every 10ms. */
async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`condition not met within ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

let spoolDir: string | undefined;

afterEach(async () => {
	if (spoolDir) {
		await rm(spoolDir, { recursive: true, force: true }).catch(() => undefined);
		spoolDir = undefined;
	}
});

suiteRequiring(
	'ci',
	'runExclusiveCrashRecoveryScan() against Postgres and real disk (JR-4-18)',
	postgresProbe,
	() => {
		it('requeues a file with a real ledger entry, quarantines and alerts for one without', async () => {
			const deployment = await deploymentId();
			const source = await seedIngestionSource(harness!.db);
			const writer = new PostgresLedgerWriter({
				deploymentId: deployment,
				transactor: postgresTransactor(bareClient!),
			});

			spoolDir = await mkdtemp(path.join(tmpdir(), 'oa-crash-recovery-lock-'));
			const fs = new NodeSpoolFileSystem();

			const ledgeredTxId = generateTxId();
			const orphanTxId = generateTxId();
			await ensureIncomingShardDir(fs, spoolDir, ledgeredTxId);
			const ledgeredHandle = await fs.createFile(incomingFilePath(spoolDir, ledgeredTxId));
			await ledgeredHandle.write(Buffer.from('ledgered content'));
			await ledgeredHandle.close();
			await ensureIncomingShardDir(fs, spoolDir, orphanTxId);
			const orphanHandle = await fs.createFile(incomingFilePath(spoolDir, orphanTxId));
			await orphanHandle.write(Buffer.from('orphan content'));
			await orphanHandle.close();

			await writer.append(request(source.id, ledgeredTxId));

			const alerts: { spoolTxId: string; reason: string }[] = [];
			const result = await runExclusiveCrashRecoveryScan({
				fs,
				ledgerLookup: new PostgresLedgerLookup(bareLedgerQuery(bareClient!)),
				spoolRoot: spoolDir,
				alertSink: {
					alert: (event) => {
						alerts.push({ spoolTxId: event.spoolTxId, reason: event.reason });
					},
				},
				transactor: postgresTransactor(bareClient!),
			});

			expect(result.incomingFilesScanned).toBe(2);
			expect(result.requeue.map((r) => r.spoolTxId)).toEqual([ledgeredTxId]);
			expect(result.quarantined.map((q) => q.spoolTxId)).toEqual([orphanTxId]);
			expect(alerts).toEqual([{ spoolTxId: orphanTxId, reason: 'no-ledger-entry' }]);

			// Real disk, not a fake: the ledgered file is still readable at its original path, the
			// orphan is gone from incoming/ and present, unharmed, in quarantine/.
			const { readFile } = await import('node:fs/promises');
			await expect(readFile(incomingFilePath(spoolDir, ledgeredTxId), 'utf8')).resolves.toBe(
				'ledgered content'
			);
			await expect(readFile(quarantineFilePath(spoolDir, orphanTxId), 'utf8')).resolves.toBe(
				'orphan content'
			);
		});

		it('a second connection genuinely blocks on the same spoolRoot while this scan holds the lock, and proceeds once released', async () => {
			spoolDir = await mkdtemp(path.join(tmpdir(), 'oa-crash-recovery-lock-'));
			const lockKey = crashRecoveryScanLockKey(spoolDir);

			let releaseExternal: () => void = () => {};
			const externalHeld = new Promise<void>((resolve) => {
				releaseExternal = resolve;
			});
			let externalAcquired = false;
			const externalDone = bareClient!.begin(async (tx) => {
				await tx.unsafe('SELECT pg_advisory_xact_lock($1)', [lockKey as unknown as never]);
				externalAcquired = true;
				await externalHeld;
			});

			await waitUntil(() => externalAcquired, 5_000);

			let scanSettled = false;
			const scanPromise = runExclusiveCrashRecoveryScan({
				fs: new NodeSpoolFileSystem(),
				ledgerLookup: new PostgresLedgerLookup(bareLedgerQuery(bareClient!)),
				spoolRoot: spoolDir,
				alertSink: { alert: () => {} },
				transactor: postgresTransactor(bareClient!),
			}).then((result) => {
				scanSettled = true;
				return result;
			});

			// Give the scan every opportunity to (wrongly) proceed while the external transaction
			// still holds the lock.
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(scanSettled).toBe(false);

			releaseExternal();
			await externalDone;

			const result = await scanPromise;
			expect(scanSettled).toBe(true);
			expect(result.incomingFilesScanned).toBe(0);
		});

		it('two different spoolRoots do not serialise against each other', async () => {
			const rootA = await mkdtemp(path.join(tmpdir(), 'oa-crash-recovery-lock-a-'));
			const rootB = await mkdtemp(path.join(tmpdir(), 'oa-crash-recovery-lock-b-'));
			try {
				const started: string[] = [];
				const finished: string[] = [];
				async function scan(spoolRoot: string, label: string) {
					started.push(label);
					const result = await runExclusiveCrashRecoveryScan({
						fs: new NodeSpoolFileSystem(),
						ledgerLookup: new PostgresLedgerLookup(bareLedgerQuery(bareClient!)),
						spoolRoot,
						alertSink: { alert: () => {} },
						transactor: postgresTransactor(bareClient!),
					});
					finished.push(label);
					return result;
				}

				const [resultA, resultB] = await Promise.all([scan(rootA, 'a'), scan(rootB, 'b')]);
				expect(resultA.incomingFilesScanned).toBe(0);
				expect(resultB.incomingFilesScanned).toBe(0);
				expect(started.sort()).toEqual(['a', 'b']);
				expect(finished.sort()).toEqual(['a', 'b']);
			} finally {
				await rm(rootA, { recursive: true, force: true }).catch(() => undefined);
				await rm(rootB, { recursive: true, force: true }).catch(() => undefined);
			}
		});
	}
);
