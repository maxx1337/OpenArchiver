import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { FakeSpoolFileSystem } from '../../tests/support/fake-spool-fs';
import type { SpoolFileSystem } from './fs-port';
import { NodeSpoolFileSystem } from './fs-port';
import { generateTxId } from './txid';
import { incomingFilePath, incomingShardDir } from './layout';
import { DurableWriteError, writeDurableSpoolFile } from './durable-write';

/**
 * Durable write (`JR-3-02`).
 *
 * ---------------------------------------------------------------------------------------------
 * Two different techniques prove the "no full heap buffering" half of the acceptance criterion,
 * and neither is sufficient on its own -- see the comments on each for what it does and does not
 * rule out.
 * ---------------------------------------------------------------------------------------------
 *
 *  1. **The buffer-reuse test** (`ci`, "processes each chunk before asking for the next one"): a
 *     single fixed-size buffer is mutated between yields of an async generator. If the code under
 *     test held a reference to a chunk past the point where it asks the generator for the next one
 *     (e.g. collecting chunks into an array before hashing them, or hashing lazily after the whole
 *     iterable is exhausted), the mutation would corrupt the reference it kept, and the resulting
 *     hash would not match a reference computed from the same generator. This is deterministic --
 *     no flakiness, no timing dependence -- but it is a **necessary, not sufficient** proof: an
 *     implementation that copies every chunk into a growing array (still O(message size) in the
 *     heap) rather than keeping the mutable original would pass this test while still failing the
 *     actual acceptance criterion.
 *
 *  2. **The 150 MB heap-growth test** (`nightly`, real `NodeSpoolFileSystem`, real temp directory):
 *     samples `process.memoryUsage().heapUsed` while streaming 150 MB through the real
 *     implementation and asserts the observed growth stays far below the message size. This is the
 *     literal acceptance criterion, and it is also the noisier of the two -- `process.memoryUsage()`
 *     reflects whatever V8's generational GC has not yet reclaimed, there is no `--expose-gc` flag
 *     wired into this repository's vitest invocation, and a busy host can widen the margin further.
 *     The threshold below is chosen to sit far enough under the message size that a regression to
 *     full buffering (which would show growth on the order of the *entire* 150 MB) is caught, while
 *     staying wide enough to absorb ordinary GC noise. It is a coarse, directionally-correct signal,
 *     not a precise one -- stated here rather than left implicit, per the review note asking for the
 *     technique's sensitivity to be spelled out rather than assumed.
 *
 * Classified `nightly` because writing and fsync-ing 150 MB is too slow for every `ci` run; the
 * buffer-reuse test keeps the streaming property proven in `ci` on every run regardless.
 */

function bufferOf(byte: number, length: number): Buffer {
	return Buffer.alloc(length, byte);
}

/**
 * Wrap a {@link SpoolFileSystem} to record the *cross-category* order of write / file-fsync /
 * close / directory-fsync calls. `FakeSpoolFileSystem` already logs each category separately
 * (`writeLog`, `fileFsyncLog`, `directoryFsyncLog`), which is enough to prove independence
 * (`JR-3-03`) but not enough to prove *ordering between* categories, which is what this test needs.
 * Written locally rather than added to the shared fake to avoid touching a file another slice of
 * this epic owns.
 */
function recordingFileSystem(inner: SpoolFileSystem): { fs: SpoolFileSystem; order: string[] } {
	const order: string[] = [];
	const fs: SpoolFileSystem = {
		mkdir: (p, options) => inner.mkdir(p, options),
		async createFile(p) {
			const handle = await inner.createFile(p);
			return {
				async write(chunk) {
					order.push('write');
					await handle.write(chunk);
				},
				async fsync() {
					order.push('file-fsync');
					await handle.fsync();
				},
				async close() {
					order.push('close');
					await handle.close();
				},
			};
		},
		async fsyncDirectory(p) {
			order.push('directory-fsync');
			await inner.fsyncDirectory(p);
		},
		readdir: (p) => inner.readdir(p),
		stat: (p) => inner.stat(p),
		rename: (from, to) => inner.rename(from, to),
	};
	return { fs, order };
}

suite('ci', 'writeDurableSpoolFile() against FakeSpoolFileSystem', () => {
	it('writes the file at incoming/<shard>/<txid>.eml', async () => {
		const fake = new FakeSpoolFileSystem();
		const txid = generateTxId();

		async function* chunks() {
			yield Buffer.from('hello');
		}

		const result = await writeDurableSpoolFile(fake, {
			spoolRoot: '/spool',
			txid,
			chunks: chunks(),
		});

		expect(result.filePath.replace(/\\/g, '/')).toBe(
			incomingFilePath('/spool', txid).replace(/\\/g, '/')
		);
		expect(fake.fileContent(result.filePath)?.toString()).toBe('hello');
	});

	it('reports the exact byte count across several chunks', async () => {
		const fake = new FakeSpoolFileSystem();
		const txid = generateTxId();
		const parts = [bufferOf(1, 10), bufferOf(2, 20), bufferOf(3, 5)];

		async function* chunks() {
			for (const part of parts) {
				yield part;
			}
		}

		const result = await writeDurableSpoolFile(fake, {
			spoolRoot: '/spool',
			txid,
			chunks: chunks(),
		});

		expect(result.sizeBytes).toBe(35n);
	});

	it('computes SHA-256 over exactly the bytes written, matching an independently computed reference', async () => {
		const fake = new FakeSpoolFileSystem();
		const txid = generateTxId();
		const parts = [Buffer.from('Hello, '), Buffer.from('journal'), Buffer.from('ing.')];
		const reference = createHash('sha256').update(Buffer.concat(parts)).digest();

		async function* chunks() {
			for (const part of parts) {
				yield part;
			}
		}

		const result = await writeDurableSpoolFile(fake, {
			spoolRoot: '/spool',
			txid,
			chunks: chunks(),
		});

		expect(Buffer.from(result.sha256).equals(reference)).toBe(true);
	});

	it('writes nothing but still durably records an empty message', async () => {
		const fake = new FakeSpoolFileSystem();
		const txid = generateTxId();

		async function* chunks(): AsyncGenerator<Uint8Array> {
			// Deliberately empty.
		}

		const result = await writeDurableSpoolFile(fake, {
			spoolRoot: '/spool',
			txid,
			chunks: chunks(),
		});

		expect(result.sizeBytes).toBe(0n);
		expect(Buffer.from(result.sha256).equals(createHash('sha256').digest())).toBe(true);
		expect(fake.fileContent(result.filePath)?.length).toBe(0);
	});

	it('never transforms the bytes -- verbatim in, verbatim out, including a byte sequence that looks like dot-stuffing', async () => {
		// This function receives already-unstuffed wire bytes (E4's job) and must not touch them
		// further. A literal ".." here is not itself CRLF-dot-stuffed SMTP data, but the point stands
		// generally: nothing this function does may depend on byte content.
		const fake = new FakeSpoolFileSystem();
		const txid = generateTxId();
		const payload = Buffer.from('Subject: test\r\n\r\n..this line starts with two dots..\r\n');

		async function* chunks() {
			yield payload;
		}

		const result = await writeDurableSpoolFile(fake, {
			spoolRoot: '/spool',
			txid,
			chunks: chunks(),
		});

		expect(fake.fileContent(result.filePath)?.equals(payload)).toBe(true);
	});

	it('calls file-fsync exactly once after every write, then closes, then fsyncs the directory exactly once', async () => {
		const { fs, order } = recordingFileSystem(new FakeSpoolFileSystem());
		const txid = generateTxId();

		async function* chunks() {
			yield Buffer.from('a');
			yield Buffer.from('b');
			yield Buffer.from('c');
		}

		await writeDurableSpoolFile(fs, { spoolRoot: '/spool', txid, chunks: chunks() });

		expect(order).toEqual([
			'write',
			'write',
			'write',
			'file-fsync',
			'close',
			'directory-fsync',
		]);
	});

	it('fsyncs the shard directory the file actually landed in', async () => {
		const fake = new FakeSpoolFileSystem();
		const txid = generateTxId();

		async function* chunks() {
			yield Buffer.from('x');
		}

		await writeDurableSpoolFile(fake, { spoolRoot: '/spool', txid, chunks: chunks() });

		expect(fake.directoryFsyncLog.map((p) => p.replace(/\\/g, '/'))).toEqual([
			incomingShardDir('/spool', txid).replace(/\\/g, '/'),
		]);
	});

	it('a write failure rejects with a stage-"write" DurableWriteError, and neither fsync is attempted', async () => {
		const fake = new FakeSpoolFileSystem();
		const txid = generateTxId();
		const filePath = incomingFilePath('/spool', txid);
		fake.failNextWrite(filePath);
		const { fs, order } = recordingFileSystem(fake);

		async function* chunks() {
			yield Buffer.from('boom');
		}

		const failure = writeDurableSpoolFile(fs, { spoolRoot: '/spool', txid, chunks: chunks() });
		await expect(failure).rejects.toBeInstanceOf(DurableWriteError);
		await failure.catch((error: DurableWriteError) => {
			expect(error.stage).toBe('write');
			expect((error.cause as { code?: string }).code).toBe('ENOSPC');
		});
		expect(order).toEqual(['write', 'close']);
	});

	it('a file-fsync failure rejects with stage "file-fsync", and directory-fsync is never attempted', async () => {
		const fake = new FakeSpoolFileSystem();
		const txid = generateTxId();
		const filePath = incomingFilePath('/spool', txid);
		fake.failNextFileFsync(filePath);
		const { fs, order } = recordingFileSystem(fake);

		async function* chunks() {
			yield Buffer.from('payload');
		}

		const failure = writeDurableSpoolFile(fs, { spoolRoot: '/spool', txid, chunks: chunks() });
		await expect(failure).rejects.toBeInstanceOf(DurableWriteError);
		await failure.catch((error: DurableWriteError) => {
			expect(error.stage).toBe('file-fsync');
		});
		expect(order).toEqual(['write', 'file-fsync', 'close']);
		// The bytes themselves are unaffected by the fsync failure -- only their durability is in
		// question, which is exactly why this is a separate stage from 'write'.
		expect(fake.fileContent(filePath)?.toString()).toBe('payload');
	});

	it('a directory-fsync failure rejects with stage "directory-fsync" -- the file is fully written and file-synced regardless', async () => {
		const fake = new FakeSpoolFileSystem();
		const txid = generateTxId();
		const filePath = incomingFilePath('/spool', txid);
		const shardDir = incomingShardDir('/spool', txid);
		fake.failNextDirectoryFsync(shardDir);
		const { fs, order } = recordingFileSystem(fake);

		async function* chunks() {
			yield Buffer.from('payload');
		}

		const failure = writeDurableSpoolFile(fs, { spoolRoot: '/spool', txid, chunks: chunks() });
		await expect(failure).rejects.toBeInstanceOf(DurableWriteError);
		await failure.catch((error: DurableWriteError) => {
			expect(error.stage).toBe('directory-fsync');
		});
		expect(order).toEqual(['write', 'file-fsync', 'close', 'directory-fsync']);
		expect(fake.fileContent(filePath)?.toString()).toBe('payload');
	});

	it('processes each chunk before asking for the next one -- reusing the source buffer between chunks does not corrupt the result', async () => {
		// See the module doc comment for exactly what this test does and does not prove.
		const fake = new FakeSpoolFileSystem();
		const txid = generateTxId();
		const CHUNK_SIZE = 4096;
		const CHUNK_COUNT = 200;
		const sharedBuffer = Buffer.alloc(CHUNK_SIZE);
		const reference = createHash('sha256');
		let referenceBytes = 0n;

		async function* chunks() {
			for (let i = 0; i < CHUNK_COUNT; i += 1) {
				sharedBuffer.fill(i % 256);
				// Captured now, synchronously, at the moment this chunk's content is what the consumer
				// is expected to see. Mutating `sharedBuffer` again only happens on the *next* call to
				// this generator, i.e. only after the consumer's loop body for this chunk has finished.
				reference.update(sharedBuffer);
				referenceBytes += BigInt(sharedBuffer.length);
				yield sharedBuffer;
			}
		}

		const result = await writeDurableSpoolFile(fake, {
			spoolRoot: '/spool',
			txid,
			chunks: chunks(),
		});

		expect(result.sizeBytes).toBe(referenceBytes);
		expect(Buffer.from(result.sha256).equals(reference.digest())).toBe(true);
	});

	/**
	 * F45 (`JR-4-06a`, see the module doc comment "`chunks` failing was unreachable until `JR-4-06a`
	 * gave it a real, live source"): a rejection from *iterating* `chunks` -- as opposed to one from
	 * `handle.write()`, already covered above -- used to escape this function as a bare `Error`,
	 * breaking its own documented contract ("rejects with a `DurableWriteError`... and never with a
	 * bare `Error`"). `apps/smtp-ingress` relies on exactly this path to abort an in-flight write when
	 * the SMTP layer discovers an oversize message mid-transfer (`smtp-server.ts`'s
	 * `SmtpConnection.finalizeAcceptance`) -- if this stayed a bare `Error`, `JournalAcceptance.accept()`
	 * would rethrow it as "a programming error in the filesystem seam itself" instead of returning a
	 * typed, `451`-mappable result.
	 */
	it("wraps a chunk source's own rejection as DurableWriteError('write', ...) rather than leaking a bare Error (F45)", async () => {
		const fake = new FakeSpoolFileSystem();
		const { fs, order } = recordingFileSystem(fake);
		const txid = generateTxId();
		const sourceError = new Error('source aborted mid-transfer');

		async function* chunks() {
			yield Buffer.from('partial content');
			throw sourceError;
		}

		let error: unknown;
		try {
			await writeDurableSpoolFile(fs, { spoolRoot: '/spool', txid, chunks: chunks() });
		} catch (err) {
			error = err;
		}

		expect(error).toBeInstanceOf(DurableWriteError);
		expect((error as DurableWriteError).stage).toBe('write');
		expect((error as DurableWriteError).cause).toBe(sourceError);

		// The partial content already written stays on disk -- this function never deletes;
		// `acceptance.ts`'s `JournalAcceptance.accept()` (`JR-3-09`) is what quarantines it, later.
		expect(fake.fileContent(incomingFilePath('/spool', txid))?.toString()).toBe(
			'partial content'
		);
		// handle.close() still ran, from the same `finally` a handle.write() failure already goes
		// through -- the point of F45's fix is that this rejection takes the *same* path, not a
		// different one that might skip cleanup.
		expect(order).toContain('close');
		expect(order).not.toContain('file-fsync');
		expect(order).not.toContain('directory-fsync');
	});
});

suite('ci', 'writeDurableSpoolFile() against NodeSpoolFileSystem (real disk)', () => {
	let dir: string;
	let fs: NodeSpoolFileSystem;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'oa-durable-write-'));
		fs = new NodeSpoolFileSystem();
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('writes real bytes to real disk, hashes them correctly, and fsyncs the file -- directory-fsync per platform', async () => {
		const txid = generateTxId();
		const parts = [Buffer.from('Hello, '), Buffer.from('journal.')];
		const reference = createHash('sha256').update(Buffer.concat(parts)).digest();

		async function* chunks() {
			for (const part of parts) {
				yield part;
			}
		}

		// Directory fsync is a POSIX operation; it fails with EPERM on Windows (measured in JR-3-03,
		// documented on NodeSpoolFileSystem.fsyncDirectory()). This function propagates that failure
		// rather than swallowing it, so on Windows this whole call is expected to reject at the
		// 'directory-fsync' stage -- asserted explicitly rather than skipped, matching the pattern in
		// fs-port.test.ts.
		if (process.platform === 'win32') {
			const failure = writeDurableSpoolFile(fs, { spoolRoot: dir, txid, chunks: chunks() });
			await expect(failure).rejects.toBeInstanceOf(DurableWriteError);
			await failure.catch((error: DurableWriteError) => {
				expect(error.stage).toBe('directory-fsync');
				expect((error.cause as { code?: string }).code).toBe('EPERM');
			});
			// Even though the directory-fsync step failed, everything before it -- the write and the
			// file-fsync -- has already happened and landed on real disk.
			const filePath = incomingFilePath(dir, txid);
			const onDisk = await readFile(filePath);
			expect(onDisk.equals(Buffer.concat(parts))).toBe(true);
			return;
		}

		const result = await writeDurableSpoolFile(fs, { spoolRoot: dir, txid, chunks: chunks() });
		expect(Buffer.from(result.sha256).equals(reference)).toBe(true);
		expect(result.sizeBytes).toBe(BigInt(Buffer.concat(parts).length));
	});
});

suite('nightly', 'writeDurableSpoolFile() -- 150 MB message (JR-3-02 acceptance)', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'oa-durable-write-150mb-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('streams a 150 MB message through the real filesystem without proportional heap growth, and hashes it correctly', async () => {
		const fsImpl = new NodeSpoolFileSystem();
		const txid = generateTxId();
		const CHUNK_SIZE = 256 * 1024; // 256 KiB
		const TOTAL_BYTES = 150 * 1024 * 1024; // 150 MB
		const CHUNK_COUNT = Math.ceil(TOTAL_BYTES / CHUNK_SIZE);

		const sharedBuffer = Buffer.alloc(CHUNK_SIZE);
		const reference = createHash('sha256');
		let referenceBytes = 0n;

		const baselineHeap = process.memoryUsage().heapUsed;
		let maxHeapDelta = 0;

		async function* chunks() {
			for (let i = 0; i < CHUNK_COUNT; i += 1) {
				sharedBuffer.fill(i % 256);
				reference.update(sharedBuffer);
				referenceBytes += BigInt(sharedBuffer.length);
				yield sharedBuffer;
				// Sampled after control returns from the consumer, i.e. after it has already
				// written and hashed the chunk just yielded -- this is the point at which a
				// non-streaming implementation would be holding an ever-growing amount of data.
				const currentHeap = process.memoryUsage().heapUsed;
				maxHeapDelta = Math.max(maxHeapDelta, currentHeap - baselineHeap);
			}
		}

		let result;
		let directoryFsyncError: DurableWriteError | undefined;
		try {
			result = await writeDurableSpoolFile(fsImpl, {
				spoolRoot: dir,
				txid,
				chunks: chunks(),
			});
		} catch (error) {
			// See the 'ci' real-disk test above: directory-fsync is expected to fail with EPERM on
			// Windows. The heap sampling above already ran to completion by this point, since every
			// chunk was fully consumed (written and hashed) before this rejection could occur.
			if (
				process.platform === 'win32' &&
				error instanceof DurableWriteError &&
				error.stage === 'directory-fsync'
			) {
				directoryFsyncError = error;
			} else {
				throw error;
			}
		}

		// The coarse, noisy-but-directionally-correct signal (see the module doc comment): a
		// regression to full buffering would push this delta up toward the full 150 MB message
		// size. A budget of 48 MB is comfortably under a third of that, while still wide enough to
		// absorb GC noise from a build with no --expose-gc wired in.
		const HEAP_BUDGET_BYTES = 48 * 1024 * 1024;
		expect(maxHeapDelta).toBeLessThan(HEAP_BUDGET_BYTES);

		if (process.platform === 'win32') {
			expect(directoryFsyncError).toBeDefined();
		} else {
			expect(result?.sizeBytes).toBe(referenceBytes);
			expect(Buffer.from(result!.sha256).equals(reference.digest())).toBe(true);
		}
	}, 120_000);
});
