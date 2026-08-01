import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { FakeSpoolFileSystem } from '../../tests/support/fake-spool-fs';
import { generateTxId } from './txid';
import {
	INCOMING_DIR_NAME,
	QUARANTINE_DIR_NAME,
	checkSpoolHighWaterMark,
	computeDirectoryUsageBytes,
	ensureIncomingShardDir,
	ensureQuarantineShardDir,
	ensureSpoolLayout,
	evaluateHighWaterMark,
	incomingFilePath,
	incomingShardDir,
	quarantineFilePath,
	quarantineShardDir,
	shardOf,
} from './layout';

/**
 * Spool layout and management (`JR-3-01`). Classification: `ci`.
 *
 * Covers: the shard function's determinism and distribution, path construction under `incoming/`
 * and `quarantine/`, layout creation, and the high-water-mark check (both the pure comparison and
 * the directory walk that feeds it) -- all against `FakeSpoolFileSystem`, so no real disk is
 * touched and JR-3-03's fault-injection seam is what stands between this code and `node:fs`.
 */

suite('ci', 'shardOf()', () => {
	it('is deterministic', () => {
		const txid = generateTxId();
		expect(shardOf(txid)).toBe(shardOf(txid));
	});

	it('produces exactly two lowercase hex characters', () => {
		for (let i = 0; i < 100; i += 1) {
			expect(shardOf(generateTxId())).toMatch(/^[0-9a-f]{2}$/);
		}
	});

	it('distributes a batch of IDs across a meaningful number of shards', () => {
		// Not a statistical proof, just a sanity check that shards are not all landing on a handful of
		// values -- 500 IDs into a 256-shard space should hit well over half of them.
		const shards = new Set<string>();
		for (let i = 0; i < 500; i += 1) {
			shards.add(shardOf(generateTxId()));
		}
		expect(shards.size).toBeGreaterThan(128);
	});

	it('does not correlate with the ULID timestamp prefix -- two IDs from the same millisecond land in different shards at least sometimes', () => {
		const now = () => 1_700_000_000_000;
		const shards = new Set<string>();
		for (let i = 0; i < 50; i += 1) {
			shards.add(shardOf(generateTxId(now)));
		}
		// If shardOf() were derived from the ULID's leading (time) characters instead of a hash of the
		// whole ID, every one of these would land in the same shard. It must not.
		expect(shards.size).toBeGreaterThan(1);
	});
});

suite('ci', 'spool path construction', () => {
	it('nests the incoming file path under incoming/<shard>/<txid>.eml', () => {
		const txid = generateTxId();
		const expected = `${INCOMING_DIR_NAME}/${shardOf(txid)}/${txid}.eml`;
		expect(incomingFilePath('/spool', txid).replace(/\\/g, '/')).toBe(`/spool/${expected}`);
	});

	it('nests the quarantine file path under quarantine/<shard>/<txid>.eml', () => {
		const txid = generateTxId();
		const expected = `${QUARANTINE_DIR_NAME}/${shardOf(txid)}/${txid}.eml`;
		expect(quarantineFilePath('/spool', txid).replace(/\\/g, '/')).toBe(`/spool/${expected}`);
	});

	it('gives the same shard directory to a transaction in incoming and in quarantine', () => {
		// So JR-3-05's rename() from incoming to quarantine never needs to invent a new shard.
		const txid = generateTxId();
		const incomingParent = incomingShardDir('/spool', txid)
			.replace(/\\/g, '/')
			.split('/')
			.pop();
		const quarantineParent = quarantineShardDir('/spool', txid)
			.replace(/\\/g, '/')
			.split('/')
			.pop();
		expect(incomingParent).toBe(quarantineParent);
	});
});

suite('ci', 'ensureSpoolLayout() and shard directory helpers', () => {
	it('creates incoming/ and quarantine/ under the spool root', async () => {
		const fs = new FakeSpoolFileSystem();
		await ensureSpoolLayout(fs, '/spool');
		const entries = await fs.readdir('/spool');
		const names = entries.map((entry) => entry.name).sort();
		expect(names).toEqual([INCOMING_DIR_NAME, QUARANTINE_DIR_NAME].sort());
		expect(entries.every((entry) => entry.isDirectory)).toBe(true);
	});

	it('is idempotent -- calling it twice does not fail', async () => {
		const fs = new FakeSpoolFileSystem();
		await ensureSpoolLayout(fs, '/spool');
		await expect(ensureSpoolLayout(fs, '/spool')).resolves.toBeUndefined();
	});

	it('creates a shard directory lazily, on first use', async () => {
		const fs = new FakeSpoolFileSystem();
		await ensureSpoolLayout(fs, '/spool');
		const txid = generateTxId();
		const dir = await ensureIncomingShardDir(fs, '/spool', txid);
		expect(dir.replace(/\\/g, '/')).toBe(incomingShardDir('/spool', txid).replace(/\\/g, '/'));
		const entries = await fs.readdir(`/spool/${INCOMING_DIR_NAME}`);
		expect(entries.some((entry) => entry.name === shardOf(txid) && entry.isDirectory)).toBe(
			true
		);
	});

	it('creates the matching quarantine shard directory', async () => {
		const fs = new FakeSpoolFileSystem();
		await ensureSpoolLayout(fs, '/spool');
		const txid = generateTxId();
		await ensureQuarantineShardDir(fs, '/spool', txid);
		const entries = await fs.readdir(`/spool/${QUARANTINE_DIR_NAME}`);
		expect(entries.some((entry) => entry.name === shardOf(txid) && entry.isDirectory)).toBe(
			true
		);
	});
});

suite('ci', 'evaluateHighWaterMark()', () => {
	it('is not exceeded when usage is below the limit', () => {
		const status = evaluateHighWaterMark(99n, 100n);
		expect(status).toEqual({ exceeded: false, usageBytes: 99n, highWaterBytes: 100n });
	});

	it('is exceeded exactly at the limit -- the boundary counts as over, not under', () => {
		const status = evaluateHighWaterMark(100n, 100n);
		expect(status.exceeded).toBe(true);
	});

	it('is exceeded above the limit', () => {
		expect(evaluateHighWaterMark(101n, 100n).exceeded).toBe(true);
	});
});

suite('ci', 'computeDirectoryUsageBytes()', () => {
	it('is zero for a directory that does not exist yet', async () => {
		const fs = new FakeSpoolFileSystem();
		expect(await computeDirectoryUsageBytes(fs, '/spool/incoming')).toBe(0n);
	});

	it('sums file sizes recursively across shard directories', async () => {
		const fs = new FakeSpoolFileSystem();
		await fs.mkdir('/spool/incoming/aa', { recursive: true });
		await fs.mkdir('/spool/incoming/bb', { recursive: true });
		const first = await fs.createFile('/spool/incoming/aa/one.eml');
		await first.write(Buffer.alloc(10));
		await first.close();
		const second = await fs.createFile('/spool/incoming/bb/two.eml');
		await second.write(Buffer.alloc(25));
		await second.close();

		expect(await computeDirectoryUsageBytes(fs, '/spool/incoming')).toBe(35n);
	});
});

suite('ci', 'checkSpoolHighWaterMark()', () => {
	it('reports not-exceeded on an empty, freshly laid-out spool', async () => {
		const fs = new FakeSpoolFileSystem();
		await ensureSpoolLayout(fs, '/spool');
		const status = await checkSpoolHighWaterMark(fs, '/spool', 1000n);
		expect(status).toEqual({ exceeded: false, usageBytes: 0n, highWaterBytes: 1000n });
	});

	it('counts quarantine/ toward the budget, not just incoming/', async () => {
		// A quarantined file is never auto-deleted (skill journal-ledger section 3), so excluding it
		// from the budget would hide exactly the failure mode that slowly fills a disk.
		const fs = new FakeSpoolFileSystem();
		await ensureSpoolLayout(fs, '/spool');
		const txid = generateTxId();
		await ensureQuarantineShardDir(fs, '/spool', txid);
		const handle = await fs.createFile(quarantineFilePath('/spool', txid));
		await handle.write(Buffer.alloc(600));
		await handle.close();

		const status = await checkSpoolHighWaterMark(fs, '/spool', 500n);
		expect(status.exceeded).toBe(true);
		expect(status.usageBytes).toBe(600n);
	});

	it('flips from not-exceeded to exceeded as usage crosses the configured limit', async () => {
		const fs = new FakeSpoolFileSystem();
		await ensureSpoolLayout(fs, '/spool');
		const txid = generateTxId();
		await ensureIncomingShardDir(fs, '/spool', txid);
		const handle = await fs.createFile(incomingFilePath('/spool', txid));
		await handle.write(Buffer.alloc(50));
		await handle.close();

		expect((await checkSpoolHighWaterMark(fs, '/spool', 100n)).exceeded).toBe(false);
		expect((await checkSpoolHighWaterMark(fs, '/spool', 50n)).exceeded).toBe(true);
	});
});
