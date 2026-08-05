import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { coverageNotice } from '@oa-test/notice';
import { SpoolWriteBridge } from '../../src/ingress/spool-write-bridge';
import { DurableWriteError, writeDurableSpoolFile } from '../../src/spool/durable-write';
import { NodeSpoolFileSystem } from '../../src/spool/fs-port';
import { generateTxId } from '../../src/spool/txid';

/**
 * `JR-4-21a`, finding F50 -- `SpoolWriteBridge.push()` used to forward every pushed chunk straight
 * to the stream, so `DataScanner`'s one-`onContent`-call-per-line `DATA` path made one real
 * `fs.promises.FileHandle.write()` syscall per SMTP line, regardless of how short the line was.
 * Measured against the real, compiled server: 50 MB as 60-byte lines took ~54 s to write, the same
 * 50 MB as 998-byte lines (RFC 5321's own maximum) took ~4 s -- throughput tracked line count, not
 * byte count. Fixed by batching pushed chunks to a byte threshold before handing them to the stream
 * (see `spool-write-bridge.ts`'s module doc comment).
 *
 * This is a **measurement, not an assertion test** -- the Product Owner's explicit instruction for
 * this finding. It exists so the current numbers keep appearing in every `ci` run's log
 * (`coverageNotice()`, the same mechanism `JR-2-08`'s concurrency throughput and `JR-4-10`'s
 * kill-during-DATA smoke already use), not just once in a report a later regression would never
 * re-read. The only assertions below are functional (the written byte count matches what was
 * pushed) -- no timing value is gated on.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this measures `SpoolWriteBridge` + `writeDurableSpoolFile()` directly, not a real socket
 * ---------------------------------------------------------------------------------------------
 * The finding's own "Warum, mechanisch" section locates the cost precisely at this boundary:
 * `DataScanner.scan()` calls `onContent` once per line, each call reaches `SpoolWriteBridge.push()`,
 * and `writeDurableSpoolFile()`'s `for await` makes one `write()` call per object it pulls off the
 * resulting stream. Driving that exact boundary directly -- pushing one chunk per simulated line, in
 * the same shape `DataScanner` produces (content plus its own trailing CRLF) -- measures the
 * mechanism the finding names, without the added setup cost and F48 platform variance
 * (`NodeSpoolFileSystem.fsyncDirectory()` `EPERM` on Windows) of a full socket-level round trip.
 */

const CRLF = Buffer.from('\r\n');

function pushLines(bridge: SpoolWriteBridge, totalBytes: number, lineContentBytes: number): number {
	const lineCount = Math.ceil(totalBytes / lineContentBytes);
	const lineContent = Buffer.alloc(lineContentBytes, 'a'.charCodeAt(0));
	for (let i = 0; i < lineCount; i += 1) {
		bridge.push(Buffer.concat([lineContent, CRLF]));
	}
	return lineCount;
}

const tempDirs: string[] = [];

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
});

interface MeasureResult {
	readonly elapsedMs: number;
	readonly lineCount: number;
	readonly sizeBytes: bigint;
}

async function measure(totalBytes: number, lineContentBytes: number): Promise<MeasureResult> {
	const fs = new NodeSpoolFileSystem();
	const spoolRoot = await mkdtemp(path.join(tmpdir(), 'oa-f50-throughput-'));
	tempDirs.push(spoolRoot);
	const bridge = new SpoolWriteBridge({ onPause: () => {}, onResume: () => {} });
	const txid = generateTxId();

	const started = Date.now();
	const lineCount = pushLines(bridge, totalBytes, lineContentBytes);
	bridge.end();

	// Computed from what was actually pushed, not from the result below: on Windows (F48),
	// fsyncDirectory() fails with EPERM *after* every write() and the file-fsync already completed,
	// so the result promise rejects and never reaches its own sizeBytes -- but everything this
	// measurement times has already happened by then.
	let sizeBytes = BigInt(lineCount) * BigInt(lineContentBytes + CRLF.length);
	try {
		const result = await writeDurableSpoolFile(fs, { spoolRoot, txid, chunks: bridge.chunks });
		sizeBytes = result.sizeBytes;
	} catch (err) {
		if (!(err instanceof DurableWriteError) || err.stage !== 'directory-fsync') {
			throw err;
		}
	}
	const elapsedMs = Date.now() - started;
	return { elapsedMs, lineCount, sizeBytes };
}

suite('ci', 'SpoolWriteBridge throughput (JR-4-21a, F50 coverage note)', () => {
	it('writes 50 MB of 60-byte-line content and 50 MB of 998-byte-line content, and logs both throughputs', async () => {
		const sizeMb = 50;
		const totalBytes = sizeMb * 1024 * 1024;

		const shortLines = await measure(totalBytes, 60);
		expect(shortLines.sizeBytes).toBe(BigInt(shortLines.lineCount) * BigInt(60 + 2));

		const longLines = await measure(totalBytes, 998);
		expect(longLines.sizeBytes).toBe(BigInt(longLines.lineCount) * BigInt(998 + 2));

		const shortMbPerSec =
			Number(shortLines.sizeBytes) / 1024 / 1024 / (shortLines.elapsedMs / 1000);
		const longMbPerSec =
			Number(longLines.sizeBytes) / 1024 / 1024 / (longLines.elapsedMs / 1000);
		coverageNotice(
			`JR-4-21a/F50: ${sizeMb} MB as ${shortLines.lineCount} 60-byte lines in ` +
				`${shortLines.elapsedMs} ms (${shortMbPerSec.toFixed(2)} MB/s); the same ${sizeMb} MB as ` +
				`${longLines.lineCount} 998-byte lines in ${longLines.elapsedMs} ms ` +
				`(${longMbPerSec.toFixed(2)} MB/s). Before this fix, measured: ~54 s and ~4 s ` +
				`respectively (a ~12.5x line-count-driven gap) -- see 09-befunde-bestandscode.md.`
		);
	});
});
