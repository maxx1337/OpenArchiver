import { createDecipheriv } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import type { IStorageProvider, LocalStorageConfig } from '@open-archiver/types';
import { StorageService } from './StorageService';

/**
 * `StorageService` -- F60 (`docs/dev/journaling/09-befunde-bestandscode.md`). Classification: `ci`.
 *
 * No test file existed for this class before this slice. F60's finding was that `put()`'s signature
 * promises streaming (`Buffer | NodeJS.ReadableStream`) but resolved every stream through
 * `streamToBuffer()` before encrypting, so every caller that carefully streamed to save heap lost
 * that property at the storage boundary. The fix moved encryption for the stream case onto a
 * `Cipher` transform stream (`putStream()`); these tests cover both halves of the acceptance
 * criterion: the on-disk byte format is unchanged (backward compatibility with already-stored
 * files), and the stream case is now genuinely incremental, not merely renamed buffering.
 *
 * `ENCRYPTION_PREFIX` (`oa_enc_idf_v1::`, 15 bytes) + 16-byte IV + ciphertext -- read directly off
 * disk below, bypassing `StorageService` entirely, so a regression that changed the format would
 * show up here even if `StorageService`'s own `get()`/`getStream()` compensated for it.
 */

const VALID_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes, hex-encoded -- config/storage.ts's own format.
const ENCRYPTION_PREFIX = Buffer.from('oa_enc_idf_v1::');

function localConfig(root: string, encryptionKey?: string): LocalStorageConfig {
	return {
		type: 'local',
		rootPath: root,
		openArchiverFolderName: 'open-archiver',
		encryptionKey,
	};
}

/** Wait past one scheduling round -- long enough for a chunk to flow through a Node Transform stream
 * and reach a downstream 'data' listener, short enough not to slow the suite down noticeably. */
function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

let tmpRoot: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(path.join(tmpdir(), 'oa-storage-service-test-'));
});

afterEach(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
});

suite(
	'ci',
	'StorageService.put(): byte-format compatibility (Buffer and stream paths agree)',
	() => {
		it("a Buffer written through put() decrypts back to the original content via the class's own get()", async () => {
			const service = new StorageService(localConfig(tmpRoot, VALID_ENCRYPTION_KEY));
			const plaintext = Buffer.from('hello from a buffer, encrypted at rest');

			await service.put('buffer.eml', plaintext);
			const roundTripped = await streamToBuffer(await service.get('buffer.eml'));

			expect(roundTripped.equals(plaintext)).toBe(true);
		});

		it("a stream written through put() decrypts back to the original content via the class's own get()", async () => {
			const service = new StorageService(localConfig(tmpRoot, VALID_ENCRYPTION_KEY));
			const plaintext = Buffer.from('hello from a stream, encrypted at rest, chunk by chunk');

			await service.put(
				'stream.eml',
				Readable.from([plaintext.subarray(0, 10), plaintext.subarray(10)])
			);
			const roundTripped = await streamToBuffer(await service.get('stream.eml'));

			expect(roundTripped.equals(plaintext)).toBe(true);
		});

		it('the Buffer path and the stream path produce byte-identical on-disk framing for the same plaintext', async () => {
			const plaintext = Buffer.from('identical plaintext, two different put() call shapes');

			const bufferService = new StorageService(localConfig(tmpRoot, VALID_ENCRYPTION_KEY));
			await bufferService.put('via-buffer.eml', plaintext);

			const streamService = new StorageService(localConfig(tmpRoot, VALID_ENCRYPTION_KEY));
			await streamService.put('via-stream.eml', Readable.from([plaintext]));

			const onDiskViaBuffer = readFileSync(path.join(tmpRoot, 'via-buffer.eml'));
			const onDiskViaStream = readFileSync(path.join(tmpRoot, 'via-stream.eml'));

			// Ciphertext differs (a fresh random IV each call) -- the *framing* must not: same prefix
			// length, same IV length, same total length (AES-256-CBC pads to the same block count for
			// equal-length plaintext), and each decrypts back to the same plaintext independently.
			expect(onDiskViaBuffer.length).toBe(onDiskViaStream.length);
			expect(onDiskViaBuffer.subarray(0, ENCRYPTION_PREFIX.length)).toEqual(
				onDiskViaStream.subarray(0, ENCRYPTION_PREFIX.length)
			);
			expect(onDiskViaBuffer.subarray(0, ENCRYPTION_PREFIX.length)).toEqual(
				ENCRYPTION_PREFIX
			);

			for (const onDisk of [onDiskViaBuffer, onDiskViaStream]) {
				const iv = onDisk.subarray(ENCRYPTION_PREFIX.length, ENCRYPTION_PREFIX.length + 16);
				const ciphertext = onDisk.subarray(ENCRYPTION_PREFIX.length + 16);
				const key = Buffer.from(VALID_ENCRYPTION_KEY, 'hex');
				const decipher = createDecipheriv('aes-256-cbc', key, iv);
				const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
				expect(decrypted.equals(plaintext)).toBe(true);
			}
		});

		it('without an encryption key configured, a stream is written through completely unmodified (no prefix, no IV)', async () => {
			const service = new StorageService(localConfig(tmpRoot, undefined));
			const plaintext = Buffer.from('no encryption configured for this deployment');

			await service.put('plain.eml', Readable.from([plaintext]));
			const onDisk = readFileSync(path.join(tmpRoot, 'plain.eml'));

			expect(onDisk.equals(plaintext)).toBe(true);
		});
	}
);

/**
 * F60's calibration proof: a fake `IStorageProvider` observes whether ciphertext chunks reach it
 * *before* the source stream has finished producing them. Under the pre-fix code (`streamToBuffer()`
 * ahead of `this.provider.put()`), `provider.put()` is not even called until the source stream has
 * already emitted its `'end'` event, so nothing could ever reach the fake provider early -- this is
 * the exact shape of `F43`'s calibration rule (CLAUDE.md): the assertion below is one that a
 * deliberately reintroduced full-buffering regression is guaranteed to fail, not merely one that
 * happens to differ. Verified directly (not just argued) by stashing this slice's `StorageService.ts`
 * change and re-running this file -- see `06-status.md`'s E7 section for the quoted failure.
 */
suite(
	'ci',
	'StorageService.put(): F60 -- the stream path is genuinely incremental, not buffered-then-renamed',
	() => {
		it('ciphertext chunks reach the provider before the source stream ends', async () => {
			const chunksSeenBeforeSourceEnded: Buffer[] = [];
			let sourceEnded = false;

			const fakeProvider: IStorageProvider = {
				put: (_targetPath, content) =>
					new Promise((resolve, reject) => {
						const stream = content as NodeJS.ReadableStream;
						stream.on('data', (chunk: Buffer) => {
							if (!sourceEnded) {
								chunksSeenBeforeSourceEnded.push(chunk);
							}
						});
						stream.on('end', resolve);
						stream.on('error', reject);
					}),
				get: async () => {
					throw new Error('not exercised by this test');
				},
				delete: async () => {},
				exists: async () => false,
			};

			const service = new StorageService(localConfig(tmpRoot, VALID_ENCRYPTION_KEY));
			// The private `provider` field is the only thing this test needs to swap -- StorageService
			// has no seam for injecting a fake IStorageProvider, and adding one just for this test would
			// be a bigger surface change than the fix itself warrants.
			(service as unknown as { provider: IStorageProvider }).provider = fakeProvider;

			const source = new Readable({ read() {} });
			const putPromise = service.put('incremental.eml', source);

			source.push(Buffer.from('first plaintext chunk, well before the source ends'));
			await wait(20);
			source.push(Buffer.from('second plaintext chunk, still before the source ends'));
			await wait(20);

			// At least the raw prefix+IV chunk (written directly, ahead of the cipher) and at least one
			// real ciphertext chunk must already have reached the provider -- proving data is flowing
			// while the source is still mid-stream, not merely that *something* arrived eventually.
			expect(chunksSeenBeforeSourceEnded.length).toBeGreaterThanOrEqual(2);

			sourceEnded = true;
			source.push(null);
			await putPromise;
		});

		it('a source stream error rejects put() rather than hanging or silently truncating', async () => {
			const service = new StorageService(localConfig(tmpRoot, VALID_ENCRYPTION_KEY));
			const source = new Readable({ read() {} });

			const putPromise = service.put('will-fail.eml', source);
			source.push(Buffer.from('partial content before the source breaks'));
			await wait(10);
			source.destroy(new Error('simulated source failure'));

			await expect(putPromise).rejects.toThrow(/simulated source failure/);
		});
	}
);

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		stream.on('data', (chunk) => chunks.push(chunk));
		stream.on('error', reject);
		stream.on('end', () => resolve(Buffer.concat(chunks)));
	});
}
