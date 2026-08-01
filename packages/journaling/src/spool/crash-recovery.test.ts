import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { FakeSpoolFileSystem } from '../../tests/support/fake-spool-fs';
import { FakeLedgerLookup, ledgerEntry } from '../../tests/support/fake-ledger-lookup';
import { generateTxId } from './txid';
import {
	ensureIncomingShardDir,
	ensureQuarantineShardDir,
	incomingFilePath,
	quarantineFilePath,
} from './layout';
import type { SpoolFileSystem } from './fs-port';
import {
	runCrashRecoveryScan,
	type CrashRecoveryAlert,
	type CrashRecoveryAlertSink,
} from './crash-recovery';

/**
 * `runCrashRecoveryScan()` (`JR-3-05`). Classification: `ci`.
 *
 * Covers both cases the backlog acceptance criterion names -- ledger entry present (requeue, file
 * stays), ledger entry absent (quarantine, alert) -- plus the invariants the module doc comment argues
 * for: batched (not per-file) ledger lookups, `quarantine/` counted but never re-queried, no path
 * deletes a spool file, and tolerance of a second scan racing the same file.
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

async function seedQuarantine(
	fs: FakeSpoolFileSystem,
	txid: string,
	content: string
): Promise<string> {
	await ensureQuarantineShardDir(fs, SPOOL_ROOT, txid);
	const filePath = quarantineFilePath(SPOOL_ROOT, txid);
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
 * Wrap a `SpoolFileSystem` so the very first `rename()` whose source matches `racedPath` is preceded by
 * a decoy rename -- simulating a second process (the `journal-inbound` worker, per architecture section
 * 5) having already won the race and moved the file away. The scan's own subsequent `rename()` then
 * meets a genuinely missing source, exactly as it would against a real, concurrently-mutated disk.
 */
function withConcurrentRenameRace(
	inner: SpoolFileSystem,
	racedPath: string,
	decoyTarget: string
): SpoolFileSystem {
	let raced = false;
	return {
		mkdir: (path, options) => inner.mkdir(path, options),
		createFile: (path) => inner.createFile(path),
		fsyncDirectory: (path) => inner.fsyncDirectory(path),
		readdir: (path) => inner.readdir(path),
		stat: (path) => inner.stat(path),
		async rename(from: string, to: string): Promise<void> {
			if (!raced && from.replace(/\\/g, '/') === racedPath.replace(/\\/g, '/')) {
				raced = true;
				await inner.rename(from, decoyTarget);
			}
			return inner.rename(from, to);
		},
	};
}

suite('ci', 'runCrashRecoveryScan(): the two cases the acceptance criterion names', () => {
	it('reports a requeue candidate and leaves the file in incoming/ when a ledger entry exists', async () => {
		const fs = new FakeSpoolFileSystem();
		const ledgerLookup = new FakeLedgerLookup();
		const alertSink = fakeAlertSink();
		const txid = generateTxId();
		const filePath = await seedIncoming(fs, txid, 'Subject: acknowledged\r\n\r\nhi\r\n');
		ledgerLookup.set(
			txid,
			ledgerEntry({ seq: 5n, chainScopeId: 'chain-a', journalingSourceId: 'source-a' })
		);

		const result = await runCrashRecoveryScan({
			fs,
			ledgerLookup,
			spoolRoot: SPOOL_ROOT,
			alertSink: alertSink.sink,
		});

		expect(result.requeue).toHaveLength(1);
		expect(result.requeue[0]).toMatchObject({
			spoolTxId: txid,
			seq: 5n,
			chainScopeId: 'chain-a',
			journalingSourceId: 'source-a',
		});
		expect(result.quarantined).toHaveLength(0);
		expect(result.incomingFilesScanned).toBe(1);

		// The file was never touched: still at its original path, with its original content.
		expect(fs.hasFile(filePath)).toBe(true);
		expect(fs.fileContent(filePath)?.toString()).toBe('Subject: acknowledged\r\n\r\nhi\r\n');
		expect(fs.hasFile(quarantineFilePath(SPOOL_ROOT, txid))).toBe(false);
		expect(alertSink.alerts).toHaveLength(0);
	});

	it('quarantines the file and alerts when no ledger entry exists', async () => {
		const fs = new FakeSpoolFileSystem();
		const ledgerLookup = new FakeLedgerLookup(); // deliberately empty
		const alertSink = fakeAlertSink();
		const txid = generateTxId();
		const originalPath = await seedIncoming(fs, txid, 'Subject: never acked\r\n\r\nhi\r\n');

		const result = await runCrashRecoveryScan({
			fs,
			ledgerLookup,
			spoolRoot: SPOOL_ROOT,
			alertSink: alertSink.sink,
		});

		const quarantinePath = quarantineFilePath(SPOOL_ROOT, txid);
		expect(result.requeue).toHaveLength(0);
		expect(result.quarantined).toEqual([
			{ spoolTxId: txid, originalFilePath: originalPath, quarantineFilePath: quarantinePath },
		]);

		// Moved, not copied and not deleted: gone from incoming/, present at quarantine/ with the same
		// bytes.
		expect(fs.hasFile(originalPath)).toBe(false);
		expect(fs.fileContent(quarantinePath)?.toString()).toBe(
			'Subject: never acked\r\n\r\nhi\r\n'
		);

		// Alarmieren, per the skill: exactly one alert, naming the reason and both paths.
		expect(alertSink.alerts).toEqual([
			{
				spoolTxId: txid,
				originalFilePath: originalPath,
				quarantineFilePath: quarantinePath,
				reason: 'no-ledger-entry',
			},
		]);
	});
});

suite('ci', 'runCrashRecoveryScan(): batching and quarantine/ observability', () => {
	it('resolves a mixed batch across several shards with exactly one ledger call', async () => {
		const fs = new FakeSpoolFileSystem();
		const ledgerLookup = new FakeLedgerLookup();
		const alertSink = fakeAlertSink();

		const acked = [generateTxId(), generateTxId(), generateTxId()];
		const unacked = [generateTxId(), generateTxId()];
		for (const txid of acked) {
			await seedIncoming(fs, txid, `content-${txid}`);
			ledgerLookup.set(txid, ledgerEntry());
		}
		for (const txid of unacked) {
			await seedIncoming(fs, txid, `content-${txid}`);
		}

		const result = await runCrashRecoveryScan({
			fs,
			ledgerLookup,
			spoolRoot: SPOOL_ROOT,
			alertSink: alertSink.sink,
		});

		expect(result.incomingFilesScanned).toBe(5);
		expect(result.requeue.map((r) => r.spoolTxId).sort()).toEqual([...acked].sort());
		expect(result.quarantined.map((q) => q.spoolTxId).sort()).toEqual([...unacked].sort());

		// The whole point of batching (see ../ledger/ledger-lookup-port.ts): one call, covering every
		// incoming/ file, never one call per file.
		expect(ledgerLookup.queries).toHaveLength(1);
		expect([...ledgerLookup.queries[0]!].sort()).toEqual([...acked, ...unacked].sort());
	});

	it('counts pre-existing quarantine/ files but never queries the ledger about them or moves them', async () => {
		const fs = new FakeSpoolFileSystem();
		const ledgerLookup = new FakeLedgerLookup();
		const alertSink = fakeAlertSink();

		const alreadyQuarantined = generateTxId();
		const quarantinePath = await seedQuarantine(fs, alreadyQuarantined, 'already quarantined');
		const acked = generateTxId();
		await seedIncoming(fs, acked, 'still pending phase B');
		ledgerLookup.set(acked, ledgerEntry());

		const result = await runCrashRecoveryScan({
			fs,
			ledgerLookup,
			spoolRoot: SPOOL_ROOT,
			alertSink: alertSink.sink,
		});

		expect(result.preexistingQuarantineFiles).toBe(1);
		expect(result.incomingFilesScanned).toBe(1);
		// The pre-existing quarantine file's id must never appear in a batch sent to the ledger.
		for (const batch of ledgerLookup.queries) {
			expect(batch).not.toContain(alreadyQuarantined);
		}
		// And it must not have been renamed again or alerted on.
		expect(fs.hasFile(quarantinePath)).toBe(true);
		expect(alertSink.alerts).toHaveLength(0);
	});

	it('scans cleanly when the spool has never been written to (fresh install, no incoming/ or quarantine/)', async () => {
		const fs = new FakeSpoolFileSystem();
		const ledgerLookup = new FakeLedgerLookup();
		const alertSink = fakeAlertSink();

		const result = await runCrashRecoveryScan({
			fs,
			ledgerLookup,
			spoolRoot: SPOOL_ROOT,
			alertSink: alertSink.sink,
		});

		expect(result).toEqual({
			requeue: [],
			quarantined: [],
			incomingFilesScanned: 0,
			preexistingQuarantineFiles: 0,
		});
		expect(alertSink.alerts).toHaveLength(0);
	});
});

suite('ci', 'runCrashRecoveryScan(): never deletes', () => {
	it('preserves every byte of every file across a scan that both requeues and quarantines', async () => {
		// The structural argument (module doc comment on crash-recovery.ts): SpoolFileSystem has no
		// delete/unlink method at all, so nothing reachable through it can lose a file's content outright
		// -- a rename is the only mutation available, and a rename that "loses" content would have to
		// write nothing at the destination, which this test would catch directly.
		const fs = new FakeSpoolFileSystem();
		const ledgerLookup = new FakeLedgerLookup();
		const alertSink = fakeAlertSink();

		const requeued = generateTxId();
		const requeuedContent = 'kept in place, phase B still owed';
		const requeuedPath = await seedIncoming(fs, requeued, requeuedContent);
		ledgerLookup.set(requeued, ledgerEntry());

		const quarantinedFresh = generateTxId();
		const quarantinedFreshContent = 'never acknowledged, moved this run';
		const quarantinedFreshOriginal = await seedIncoming(
			fs,
			quarantinedFresh,
			quarantinedFreshContent
		);

		const alreadyQuarantined = generateTxId();
		const alreadyQuarantinedContent = 'quarantined by an earlier run';
		const alreadyQuarantinedPath = await seedQuarantine(
			fs,
			alreadyQuarantined,
			alreadyQuarantinedContent
		);

		await runCrashRecoveryScan({
			fs,
			ledgerLookup,
			spoolRoot: SPOOL_ROOT,
			alertSink: alertSink.sink,
		});

		// Requeued: unchanged, at its original path.
		expect(fs.fileContent(requeuedPath)?.toString()).toBe(requeuedContent);

		// Quarantined this run: gone from incoming/, present with identical bytes at quarantine/.
		expect(fs.hasFile(quarantinedFreshOriginal)).toBe(false);
		expect(fs.fileContent(quarantineFilePath(SPOOL_ROOT, quarantinedFresh))?.toString()).toBe(
			quarantinedFreshContent
		);

		// Already quarantined: untouched, still there.
		expect(fs.fileContent(alreadyQuarantinedPath)?.toString()).toBe(alreadyQuarantinedContent);
	});
});

suite('ci', 'runCrashRecoveryScan(): tolerates a concurrent scan racing the same file', () => {
	it('treats a rename() that meets an already-moved source as "someone else quarantined it", not an error', async () => {
		// Architecture doc section 5: apps/smtp-ingress and the journal-inbound worker both run this
		// scan at startup. If both discover the same never-acknowledged file, whichever renames first
		// wins; the second must not throw or double-alert.
		const fs = new FakeSpoolFileSystem();
		const ledgerLookup = new FakeLedgerLookup(); // no entry: this file would be quarantined
		const alertSink = fakeAlertSink();
		const txid = generateTxId();
		const originalPath = await seedIncoming(fs, txid, 'raced by another process');

		const racedFs = withConcurrentRenameRace(
			fs,
			originalPath,
			`/spool/elsewhere/${txid}.eml` // where "the other process" put it, irrelevant to this scan
		);
		await fs.mkdir('/spool/elsewhere', { recursive: true });

		const result = await runCrashRecoveryScan({
			fs: racedFs,
			ledgerLookup,
			spoolRoot: SPOOL_ROOT,
			alertSink: alertSink.sink,
		});

		// Nothing to report from this call's own attempt -- the other process already did it.
		expect(result.quarantined).toHaveLength(0);
		expect(alertSink.alerts).toHaveLength(0);
		// And no exception propagated out of runCrashRecoveryScan() for the race.
	});
});
