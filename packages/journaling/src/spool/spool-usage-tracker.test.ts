import { expect, it, vi } from 'vitest';
import { suite } from '@oa-test/classification';
import { FakeSpoolFileSystem } from '../../tests/support/fake-spool-fs';
import { ensureIncomingShardDir, incomingFilePath } from './layout';
import { generateTxId } from './txid';
import {
	DEFAULT_SPOOL_USAGE_RECONCILE_INTERVAL_MS,
	SpoolUsageReconciler,
	SpoolUsageTracker,
} from './spool-usage-tracker';

/**
 * `SpoolUsageTracker`/`SpoolUsageReconciler` (`F66`, `docs/dev/journaling/09-befunde-bestandscode.md`).
 * Classification: `ci`.
 *
 * `acceptance.test.ts`'s own "F66" suite proves the integrated behaviour (accept() stops walking the
 * spool, and the tracker-driven check still agrees with a real walk on the debris-erosion case). This
 * file is the unit layer underneath that: the counter's own arithmetic, and the reconciler's timer
 * lifecycle, independent of `JournalAcceptance`.
 */

suite('ci', 'SpoolUsageTracker', () => {
	it('starts at the seeded value and reports it back unchanged', () => {
		const tracker = new SpoolUsageTracker(1_000n);
		expect(tracker.current()).toBe(1_000n);
	});

	it('increment() adds; decrement() subtracts', () => {
		const tracker = new SpoolUsageTracker(0n);
		tracker.increment(500n);
		expect(tracker.current()).toBe(500n);
		tracker.increment(250n);
		expect(tracker.current()).toBe(750n);
		tracker.decrement(300n);
		expect(tracker.current()).toBe(450n);
	});

	it('increment(0n)/decrement(0n) are no-ops', () => {
		const tracker = new SpoolUsageTracker(42n);
		tracker.increment(0n);
		tracker.decrement(0n);
		expect(tracker.current()).toBe(42n);
	});

	it('decrement() floors at zero rather than going negative', () => {
		const tracker = new SpoolUsageTracker(100n);
		tracker.decrement(150n);
		expect(tracker.current()).toBe(0n);
		// A further decrement from an already-floored tracker stays at the floor, not further negative.
		tracker.decrement(50n);
		expect(tracker.current()).toBe(0n);
	});

	it('reset() replaces the tracked value outright, independent of prior increments/decrements', () => {
		const tracker = new SpoolUsageTracker(0n);
		tracker.increment(999n);
		tracker.reset(10n);
		expect(tracker.current()).toBe(10n);
	});
});

const SPOOL_ROOT = '/spool';

/** Write `bytes` bytes to a fresh `incoming/` spool file, through the real layout helpers -- the same
 * path `writeDurableSpoolFile()` uses -- so a walk over `spoolRoot` finds it exactly like a real
 * accepted message. */
async function writeIncomingFile(fake: FakeSpoolFileSystem, bytes: number): Promise<void> {
	const txid = generateTxId();
	await ensureIncomingShardDir(fake, SPOOL_ROOT, txid);
	const handle = await fake.createFile(incomingFilePath(SPOOL_ROOT, txid));
	await handle.write(Buffer.alloc(bytes, 7));
	await handle.close();
}

suite('ci', 'SpoolUsageReconciler', () => {
	it('reconcileNow() walks the spool and resets the tracker to the real total, overwriting a stale value', async () => {
		const fake = new FakeSpoolFileSystem();
		await writeIncomingFile(fake, 100);
		await writeIncomingFile(fake, 250);

		// Deliberately wrong to start -- simulating a tracker that has drifted because Phase B released
		// files in a process this tracker cannot see into (spool-usage-tracker.ts's module doc comment).
		const tracker = new SpoolUsageTracker(999_999n);
		const reconciler = new SpoolUsageReconciler({ fs: fake, spoolRoot: SPOOL_ROOT, tracker });

		const usage = await reconciler.reconcileNow();

		expect(usage).toBe(350n);
		expect(tracker.current()).toBe(350n);
	});

	it('start() arms an unref()-able interval at the configured (or default) frequency, and stop() clears it', () => {
		const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
		const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
		try {
			const fake = new FakeSpoolFileSystem();
			const tracker = new SpoolUsageTracker(0n);
			const reconciler = new SpoolUsageReconciler({
				fs: fake,
				spoolRoot: SPOOL_ROOT,
				tracker,
				intervalMs: 60_000,
			});

			reconciler.start();
			expect(setIntervalSpy).toHaveBeenCalledTimes(1);
			expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
			// Idempotent: a second start() while already running arms nothing further.
			reconciler.start();
			expect(setIntervalSpy).toHaveBeenCalledTimes(1);

			reconciler.stop();
			expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
			// Idempotent: the shutdown path may call it after this already happened.
			reconciler.stop();
			expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
		} finally {
			setIntervalSpy.mockRestore();
			clearIntervalSpy.mockRestore();
		}
	});

	it('defaults to DEFAULT_SPOOL_USAGE_RECONCILE_INTERVAL_MS when no interval is supplied', () => {
		const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
		try {
			const fake = new FakeSpoolFileSystem();
			const tracker = new SpoolUsageTracker(0n);
			const reconciler = new SpoolUsageReconciler({
				fs: fake,
				spoolRoot: SPOOL_ROOT,
				tracker,
			});

			reconciler.start();

			expect(setIntervalSpy).toHaveBeenCalledWith(
				expect.any(Function),
				DEFAULT_SPOOL_USAGE_RECONCILE_INTERVAL_MS
			);
			reconciler.stop();
		} finally {
			setIntervalSpy.mockRestore();
		}
	});

	it('firing the armed interval calls reconcileNow() and updates the tracker, without a test waiting on a real timer', async () => {
		vi.useFakeTimers();
		try {
			const fake = new FakeSpoolFileSystem();
			await writeIncomingFile(fake, 42);
			const tracker = new SpoolUsageTracker(0n);
			const reconciler = new SpoolUsageReconciler({
				fs: fake,
				spoolRoot: SPOOL_ROOT,
				tracker,
				intervalMs: 1_000,
			});

			reconciler.start();
			expect(tracker.current()).toBe(0n);

			await vi.advanceTimersByTimeAsync(1_000);

			expect(tracker.current()).toBe(42n);
			reconciler.stop();
		} finally {
			vi.useRealTimers();
		}
	});
});
