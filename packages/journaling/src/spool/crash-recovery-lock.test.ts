import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { FakeSpoolFileSystem } from '../../tests/support/fake-spool-fs';
import { FakeLedgerLookup, ledgerEntry } from '../../tests/support/fake-ledger-lookup';
import { generateTxId } from './txid';
import { ensureIncomingShardDir, incomingFilePath } from './layout';
import type { LedgerLookup } from '../ledger/ledger-lookup-port';
import type { LedgerQuery, LedgerTransactor } from '../ledger/ledger-port';
import { advisoryLockKey } from '../ledger/ledger-writer';
import type { CrashRecoveryAlert, CrashRecoveryAlertSink } from './crash-recovery';
import { crashRecoveryScanLockKey, runExclusiveCrashRecoveryScan } from './crash-recovery-lock';

/**
 * `runExclusiveCrashRecoveryScan()` (`JR-4-18`). Classification: `ci`.
 *
 * Against fakes rather than real Postgres -- the complementary integration test
 * (`packages/backend/tests/integration/journal-crash-recovery-lock.int.test.ts`) proves the same
 * composition holds against a real `pg_advisory_xact_lock`, including that a second connection genuinely
 * blocks rather than merely being asked nicely to wait. What a fake proves that a real database cannot
 * (the same argument `ledger-writer.test.ts` makes for the append lock): the *order* of statements is
 * asserted directly rather than inferred from the absence of a race.
 */

const SPOOL_ROOT = '/spool';

async function seedIncoming(
	fs: FakeSpoolFileSystem,
	txid: string,
	content: string
): Promise<string> {
	await ensureIncomingShardDir(fs, SPOOL_ROOT, txid);
	const filePath = incomingFilePath(SPOOL_ROOT, txid);
	const handle = await fs.createFile(filePath);
	await handle.write(Buffer.from(content));
	await handle.close();
	return filePath;
}

function fakeAlertSink(): { sink: CrashRecoveryAlertSink; alerts: CrashRecoveryAlert[] } {
	const alerts: CrashRecoveryAlert[] = [];
	return {
		sink: {
			alert(event: CrashRecoveryAlert): void {
				alerts.push(event);
			},
		},
		alerts,
	};
}

/**
 * A transactor recording every statement, plus a shared `log` this test also has the ledger lookup
 * push onto -- the order across the lock query and the scan's own ledger call is what proves the lock
 * is held *before* the scan does anything, not merely that both happen to run.
 */
function fakeTransactor(log: string[]): {
	transactor: LedgerTransactor;
	statements: { text: string; values: readonly unknown[] }[];
	transactions: number;
} {
	const statements: { text: string; values: readonly unknown[] }[] = [];
	const state = { transactions: 0 };
	const tx: LedgerQuery = {
		async query<Row>(text: string, values: readonly unknown[] = []): Promise<Row[]> {
			statements.push({ text, values });
			log.push(`lock-query:${String(values[0])}`);
			return [] as Row[];
		},
	};
	const transactor: LedgerTransactor = {
		async transaction<T>(run: (handle: LedgerQuery) => Promise<T>): Promise<T> {
			state.transactions += 1;
			return run(tx);
		},
	};
	return {
		transactor,
		statements,
		get transactions() {
			return state.transactions;
		},
	};
}

/** Wraps a `LedgerLookup` so every call is also pushed onto `log`, in call order. */
function loggingLedgerLookup(inner: LedgerLookup, log: string[]): LedgerLookup {
	return {
		async findBySpoolTxIds(ids) {
			log.push('ledger-lookup');
			return inner.findBySpoolTxIds(ids);
		},
		// JR-6-03: this suite's scans never call this method -- delegated only so the wrapper still
		// satisfies `LedgerLookup`, not because any test here exercises it.
		findOriginalReceiptSeq(chainScopeId, contentSha256) {
			return inner.findOriginalReceiptSeq(chainScopeId, contentSha256);
		},
	};
}

suite('ci', 'runExclusiveCrashRecoveryScan() (JR-4-18)', () => {
	it('crashRecoveryScanLockKey is deterministic per spoolRoot and differs across spool roots', () => {
		expect(crashRecoveryScanLockKey('/spool')).toBe(crashRecoveryScanLockKey('/spool'));
		expect(crashRecoveryScanLockKey('/spool')).not.toBe(
			crashRecoveryScanLockKey('/other-spool')
		);
		// Reuses advisoryLockKey unchanged (see the module doc comment, "The lock key") -- the
		// namespace prefix is what a caller relies on, so pin the derivation rather than just its
		// determinism.
		expect(crashRecoveryScanLockKey('/spool')).toBe(
			advisoryLockKey('crash-recovery-scan:/spool')
		);
	});

	it('acquires the lock, keyed by spoolRoot, before the scan queries the ledger at all', async () => {
		const log: string[] = [];
		const fake = fakeTransactor(log);
		const fs = new FakeSpoolFileSystem();
		const ledgerLookup = loggingLedgerLookup(new FakeLedgerLookup(), log);
		const { sink } = fakeAlertSink();

		const result = await runExclusiveCrashRecoveryScan({
			fs,
			ledgerLookup,
			spoolRoot: SPOOL_ROOT,
			alertSink: sink,
			transactor: fake.transactor,
		});

		const { statements } = fake;
		expect(result.incomingFilesScanned).toBe(0);
		expect(fake.transactions).toBe(1);
		expect(statements).toHaveLength(1);
		expect(statements[0]!.text).toContain('pg_advisory_xact_lock');
		expect(statements[0]!.values[0]).toBe(crashRecoveryScanLockKey(SPOOL_ROOT));
		// The lock statement is the very first thing logged -- the ledger lookup (which still runs,
		// even for an empty batch, against this fake) happens strictly after it.
		expect(log[0]).toBe(`lock-query:${crashRecoveryScanLockKey(SPOOL_ROOT)}`);
		expect(log).toContain('ledger-lookup');
		expect(log.indexOf('lock-query:' + crashRecoveryScanLockKey(SPOOL_ROOT))).toBeLessThan(
			log.indexOf('ledger-lookup')
		);
	});

	it('passes the scan result through unchanged: requeue for a ledgered file, quarantine and alert otherwise', async () => {
		const log: string[] = [];
		const { transactor } = fakeTransactor(log);
		const fs = new FakeSpoolFileSystem();
		const ledgerLookup = new FakeLedgerLookup();
		const { sink, alerts } = fakeAlertSink();

		const ledgeredTxId = generateTxId();
		const orphanTxId = generateTxId();
		await seedIncoming(fs, ledgeredTxId, 'ledgered');
		await seedIncoming(fs, orphanTxId, 'orphan');
		ledgerLookup.set(ledgeredTxId, ledgerEntry());

		const result = await runExclusiveCrashRecoveryScan({
			fs,
			ledgerLookup,
			spoolRoot: SPOOL_ROOT,
			alertSink: sink,
			transactor,
		});

		expect(result.incomingFilesScanned).toBe(2);
		expect(result.requeue.map((r) => r.spoolTxId)).toEqual([ledgeredTxId]);
		expect(result.quarantined.map((q) => q.spoolTxId)).toEqual([orphanTxId]);
		expect(alerts).toHaveLength(1);
		expect(alerts[0]!.reason).toBe('no-ledger-entry');

		// The requeued file is untouched; the orphan is gone from incoming/.
		expect(fs.hasFile(incomingFilePath(SPOOL_ROOT, ledgeredTxId))).toBe(true);
		expect(fs.hasFile(incomingFilePath(SPOOL_ROOT, orphanTxId))).toBe(false);
	});

	it('propagates a scan failure after the lock was already acquired, rather than swallowing it', async () => {
		const log: string[] = [];
		const { transactor, statements } = fakeTransactor(log);
		const fs = new FakeSpoolFileSystem();
		const failingLookup: LedgerLookup = {
			async findBySpoolTxIds() {
				throw new Error('boom: ledger unreachable mid-scan');
			},
			// JR-6-03: not exercised by this scan; present only to satisfy `LedgerLookup`.
			async findOriginalReceiptSeq() {
				throw new Error('not used in this test');
			},
		};
		const { sink } = fakeAlertSink();

		await expect(
			runExclusiveCrashRecoveryScan({
				fs,
				ledgerLookup: failingLookup,
				spoolRoot: SPOOL_ROOT,
				alertSink: sink,
				transactor,
			})
		).rejects.toThrow('boom: ledger unreachable mid-scan');

		// The lock was taken before the failure -- this is what "a failed scan is not silent" rests
		// on at the caller (apps/smtp-ingress/src/index.ts): the failure surfaces as a rejected
		// promise, not as a scan that silently never ran.
		expect(statements).toHaveLength(1);
		expect(statements[0]!.text).toContain('pg_advisory_xact_lock');
	});

	it('two overlapping scans on the same spoolRoot serialise; two on different spoolRoots do not', async () => {
		// Models real pg_advisory_xact_lock semantics: a lock query for a key that is already held
		// waits until the holder's transaction ends before resolving. `runningCount` per key asserts
		// at most one scan body is inside the "critical section" (between acquiring the lock and the
		// scan finishing) for a given key at any moment; two different keys must be able to overlap.
		const holders = new Map<string, Promise<void>>();
		const runningCount = new Map<string, number>();
		function serializingTransactor(): LedgerTransactor {
			return {
				async transaction<T>(run: (handle: LedgerQuery) => Promise<T>): Promise<T> {
					let releaseThis: () => void = () => {};
					const thisHeld = new Promise<void>((resolve) => {
						releaseThis = resolve;
					});
					let key = '';
					const tx: LedgerQuery = {
						async query<Row>(
							_text: string,
							values: readonly unknown[] = []
						): Promise<Row[]> {
							key = String(values[0]);
							const previous = holders.get(key);
							holders.set(key, thisHeld);
							if (previous) {
								await previous;
							}
							runningCount.set(key, (runningCount.get(key) ?? 0) + 1);
							return [] as Row[];
						},
					};
					try {
						return await run(tx);
					} finally {
						runningCount.set(key, (runningCount.get(key) ?? 1) - 1);
						releaseThis();
					}
				},
			};
		}

		const maxConcurrent = new Map<string, number>();
		function trackingLedgerLookup(spoolRoot: string): LedgerLookup {
			return {
				async findBySpoolTxIds() {
					const key = String(crashRecoveryScanLockKey(spoolRoot));
					const current = runningCount.get(key) ?? 0;
					maxConcurrent.set(key, Math.max(maxConcurrent.get(key) ?? 0, current));
					// Yield, so a competing scan on the same key would have a chance to interleave if
					// it were (wrongly) allowed to run concurrently.
					await new Promise((resolve) => setTimeout(resolve, 5));
					return new Map();
				},
				// JR-6-03: not exercised by this concurrency test; present only to satisfy `LedgerLookup`.
				async findOriginalReceiptSeq() {
					throw new Error('not used in this test');
				},
			};
		}

		const transactor = serializingTransactor();
		const sameRootA = runExclusiveCrashRecoveryScan({
			fs: new FakeSpoolFileSystem(),
			ledgerLookup: trackingLedgerLookup('/spool-shared'),
			spoolRoot: '/spool-shared',
			alertSink: { alert: () => {} },
			transactor,
		});
		const sameRootB = runExclusiveCrashRecoveryScan({
			fs: new FakeSpoolFileSystem(),
			ledgerLookup: trackingLedgerLookup('/spool-shared'),
			spoolRoot: '/spool-shared',
			alertSink: { alert: () => {} },
			transactor,
		});
		const otherRoot = runExclusiveCrashRecoveryScan({
			fs: new FakeSpoolFileSystem(),
			ledgerLookup: trackingLedgerLookup('/spool-other'),
			spoolRoot: '/spool-other',
			alertSink: { alert: () => {} },
			transactor,
		});

		await Promise.all([sameRootA, sameRootB, otherRoot]);

		const sharedKey = String(crashRecoveryScanLockKey('/spool-shared'));
		const otherKey = String(crashRecoveryScanLockKey('/spool-other'));
		expect(maxConcurrent.get(sharedKey)).toBe(1);
		// The other root's own scan is unaffected by the shared-root pair holding their lock --
		// proving the key, not a single global lock, is what serialises.
		expect(maxConcurrent.get(otherKey)).toBe(1);
	});
});
