import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { FakeSpoolFileSystem } from '../../tests/support/fake-spool-fs';
import { FakeLedgerLookup, ledgerEntry } from '../../tests/support/fake-ledger-lookup';
import { generateTxId } from '../spool/txid';
import { ensureIncomingShardDir, incomingFilePath } from '../spool/layout';
import type { LedgerQuery, LedgerTransactor } from '../ledger/ledger-port';
import type { CrashRecoveryAlert, CrashRecoveryAlertSink } from '../spool/crash-recovery';
import { runSpoolReconcile } from './reconciler';

/**
 * `runSpoolReconcile()` (`JR-6-04`). Classification: `ci`.
 *
 * Against fakes, mirroring `crash-recovery-lock.test.ts`'s own precedent -- what this file adds on
 * top of that suite is the one thing specific to the reconciler: that every requeue candidate the
 * underlying scan reports actually reaches the injected `enqueue()`, no more and no fewer. The scan's
 * own requeue/quarantine correctness, and that the lock genuinely serialises two overlapping calls,
 * are `crash-recovery.test.ts`'s and `crash-recovery-lock.test.ts`'s job, not re-proven here.
 * `journal-spool-reconciler.int.test.ts` (`packages/backend`) is what proves the criterion this slice
 * exists for -- a wiped real queue recovers via a real ledger and a real spool -- and the trap the
 * task called out: reconciling an entry whose Phase B already fully archived writes no false
 * `duplicate_marker`.
 */

const SPOOL_ROOT = '/spool';

async function seedIncoming(fs: FakeSpoolFileSystem, txid: string, content: string): Promise<void> {
	await ensureIncomingShardDir(fs, SPOOL_ROOT, txid);
	const handle = await fs.createFile(incomingFilePath(SPOOL_ROOT, txid));
	await handle.write(Buffer.from(content));
	await handle.close();
}

function fakeAlertSink(): { sink: CrashRecoveryAlertSink; alerts: CrashRecoveryAlert[] } {
	const alerts: CrashRecoveryAlert[] = [];
	return { sink: { alert: (event) => void alerts.push(event) }, alerts };
}

/** A transactor that just runs the callback -- no statement recorded unless a test asks for one. */
function noopTransactor(): LedgerTransactor {
	return {
		async transaction<T>(run: (tx: LedgerQuery) => Promise<T>): Promise<T> {
			const tx: LedgerQuery = {
				async query() {
					return [];
				},
			};
			return run(tx);
		},
	};
}

suite('ci', 'runSpoolReconcile() (JR-6-04)', () => {
	it('enqueues exactly the requeue candidates the scan reports, and nothing else', async () => {
		const fs = new FakeSpoolFileSystem();
		const ledger = new FakeLedgerLookup();
		const txidA = generateTxId();
		const txidB = generateTxId();
		await seedIncoming(fs, txidA, 'a');
		await seedIncoming(fs, txidB, 'b');
		ledger.set(txidA, ledgerEntry({ seq: 1n }));
		ledger.set(txidB, ledgerEntry({ seq: 2n }));

		const enqueued: string[] = [];
		const result = await runSpoolReconcile({
			fs,
			ledgerLookup: ledger,
			spoolRoot: SPOOL_ROOT,
			alertSink: fakeAlertSink().sink,
			transactor: noopTransactor(),
			enqueue: async (spoolTxId) => void enqueued.push(spoolTxId),
		});

		expect([...enqueued].sort()).toEqual([txidA, txidB].sort());
		expect(result.requeuedCount).toBe(2);
		expect(result.incomingFilesScanned).toBe(2);
		expect(result.quarantinedCount).toBe(0);
	});

	it('never enqueues a spool entry with no ledger receipt -- it gets quarantined instead', async () => {
		const fs = new FakeSpoolFileSystem();
		const ledger = new FakeLedgerLookup();
		const orphanTxid = generateTxId();
		await seedIncoming(fs, orphanTxid, 'orphan');
		// No ledger.set() -- this transaction was never acknowledged.

		const { sink, alerts } = fakeAlertSink();
		const enqueued: string[] = [];
		const result = await runSpoolReconcile({
			fs,
			ledgerLookup: ledger,
			spoolRoot: SPOOL_ROOT,
			alertSink: sink,
			transactor: noopTransactor(),
			enqueue: async (spoolTxId) => void enqueued.push(spoolTxId),
		});

		expect(enqueued).toHaveLength(0);
		expect(result.requeuedCount).toBe(0);
		expect(result.quarantinedCount).toBe(1);
		expect(alerts).toHaveLength(1);
		expect(alerts[0]!.reason).toBe('no-ledger-entry');
	});

	it('an idle spool enqueues nothing', async () => {
		const fs = new FakeSpoolFileSystem();
		const ledger = new FakeLedgerLookup();
		const enqueued: string[] = [];
		const result = await runSpoolReconcile({
			fs,
			ledgerLookup: ledger,
			spoolRoot: SPOOL_ROOT,
			alertSink: fakeAlertSink().sink,
			transactor: noopTransactor(),
			enqueue: async (spoolTxId) => void enqueued.push(spoolTxId),
		});

		expect(enqueued).toHaveLength(0);
		expect(result.incomingFilesScanned).toBe(0);
		expect(result.requeuedCount).toBe(0);
		expect(result.quarantinedCount).toBe(0);
	});

	it('goes through the locked scan (pg_advisory_xact_lock), never the bare one', async () => {
		// crash-recovery-lock.ts's own binding rule for "whenever journal-inbound is built": this is
		// the regression test for silently swapping runExclusiveCrashRecoveryScan() for the bare
		// runCrashRecoveryScan(), which would drop the cross-process lock entirely.
		const statements: { text: string; values: readonly unknown[] }[] = [];
		const transactor: LedgerTransactor = {
			async transaction<T>(run: (tx: LedgerQuery) => Promise<T>): Promise<T> {
				const tx: LedgerQuery = {
					async query<Row>(
						text: string,
						values: readonly unknown[] = []
					): Promise<Row[]> {
						statements.push({ text, values });
						return [] as Row[];
					},
				};
				return run(tx);
			},
		};

		await runSpoolReconcile({
			fs: new FakeSpoolFileSystem(),
			ledgerLookup: new FakeLedgerLookup(),
			spoolRoot: SPOOL_ROOT,
			alertSink: fakeAlertSink().sink,
			transactor,
			enqueue: async () => {},
		});

		expect(statements).toHaveLength(1);
		expect(statements[0]!.text).toContain('pg_advisory_xact_lock');
	});
});
