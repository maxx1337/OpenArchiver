import { IStorageProvider, StorageConfig } from '@open-archiver/types';
import { LocalFileSystemProvider } from './storage/LocalFileSystemProvider';
import { S3StorageProvider } from './storage/S3StorageProvider';
import { config } from '../config/index';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { streamToBuffer } from '../helpers/streamToBuffer';
import { PassThrough, Readable } from 'stream';
import { pipeline } from 'stream/promises';

/**
 *  A unique identifier for Open Archiver encrypted files. This value SHOULD NOT BE ALTERED in future development to ensure compatibility.
 */
const ENCRYPTION_PREFIX = Buffer.from('oa_enc_idf_v1::');

export class StorageService implements IStorageProvider {
	private provider: IStorageProvider;
	private encryptionKey: Buffer | null = null;
	private readonly algorithm = 'aes-256-cbc';

	constructor(storageConfig: StorageConfig = config.storage) {
		if (storageConfig.encryptionKey) {
			this.encryptionKey = Buffer.from(storageConfig.encryptionKey, 'hex');
		}

		switch (storageConfig.type) {
			case 'local':
				this.provider = new LocalFileSystemProvider(storageConfig);
				break;
			case 's3':
				this.provider = new S3StorageProvider(storageConfig);
				break;
			default:
				throw new Error('Invalid storage provider type');
		}
	}

	private async encrypt(content: Buffer): Promise<Buffer> {
		if (!this.encryptionKey) {
			return content;
		}
		const iv = randomBytes(16);
		const cipher = createCipheriv(this.algorithm, this.encryptionKey, iv);
		const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
		return Buffer.concat([ENCRYPTION_PREFIX, iv, encrypted]);
	}

	private async decrypt(content: Buffer): Promise<Buffer> {
		if (!this.encryptionKey) {
			return content;
		}
		const prefix = content.subarray(0, ENCRYPTION_PREFIX.length);
		if (!prefix.equals(ENCRYPTION_PREFIX)) {
			// File is not encrypted, return as is
			return content;
		}

		try {
			const iv = content.subarray(ENCRYPTION_PREFIX.length, ENCRYPTION_PREFIX.length + 16);
			const encrypted = content.subarray(ENCRYPTION_PREFIX.length + 16);
			const decipher = createDecipheriv(this.algorithm, this.encryptionKey, iv);
			return Buffer.concat([decipher.update(encrypted), decipher.final()]);
		} catch (error) {
			// Decryption failed for a file that has the prefix.
			// This indicates a corrupted file or a wrong key.
			throw new Error('Failed to decrypt file. It may be corrupted or the key is incorrect.');
		}
	}

	/**
	 * F60 (`docs/dev/journaling/09-befunde-bestandscode.md`): a `Buffer` still takes the short,
	 * already-buffered path below (nothing to gain from streaming what is already fully in memory),
	 * but a stream is no longer resolved through `streamToBuffer()` first -- see {@link putStream}.
	 */
	async put(path: string, content: Buffer | NodeJS.ReadableStream): Promise<void> {
		if (content instanceof Buffer) {
			const encryptedContent = await this.encrypt(content);
			return this.provider.put(path, encryptedContent);
		}
		// `instanceof Buffer` above narrows for control flow but TypeScript does not carry that
		// narrowing through to the `Buffer | NodeJS.ReadableStream` union member here (the same reason
		// the pre-F60 code cast explicitly rather than relying on narrowing) -- the runtime check above
		// already guarantees this is the stream branch.
		const stream = content as NodeJS.ReadableStream;
		if (!this.encryptionKey) {
			return this.provider.put(path, stream);
		}
		return this.putStream(path, stream);
	}

	/**
	 * The streaming half of F60's fix: encrypts `content` chunk-by-chunk through a `Cipher` transform
	 * stream, without ever holding the whole message in memory, and hands the *stream itself* to the
	 * underlying provider (never a fully-materialized `Buffer`) -- mirroring {@link getStream}'s
	 * already-streaming decrypt direction. The on-disk byte format is unchanged: `ENCRYPTION_PREFIX`
	 * (15 bytes) + a fresh 16-byte IV + ciphertext, byte-identical to what {@link encrypt} produces --
	 * see this file's class doc comment ("SHOULD NOT BE ALTERED") and {@link decrypt}/{@link getStream},
	 * which read exactly that layout back.
	 *
	 * `output` (a `PassThrough`) is the one stream handed to `this.provider.put()`. The prefix+IV are
	 * written into it directly -- raw bytes, never run through the cipher -- *before* `pipeline()`
	 * below ever touches it: that single `.write()` call is synchronous and therefore queued ahead of
	 * anything the pipeline writes later, so the provider always sees prefix, then IV, then ciphertext,
	 * in that order. `this.provider.put(path, output)` and `pipeline(content, cipher, output)` are then
	 * started together (not one awaited before the other): the provider actively drains `output` while
	 * the pipeline feeds it, which is what makes this genuinely streaming rather than a buffer that
	 * merely got renamed -- awaiting the pipeline to completion first would force `output` to hold the
	 * entire ciphertext in its internal buffer with nothing draining it yet, reintroducing exactly the
	 * full-buffering behaviour this fix removes.
	 *
	 * `pipeline()` (not a manual `.pipe()`) is what makes error handling correct without extra wiring:
	 * a failure anywhere in `content -> cipher -> output` -- the source stream erroring mid-read, the
	 * cipher itself failing, or `output` being destroyed because the provider's own write failed --
	 * propagates to every other stream in the chain and rejects both promises below, which `Promise.all`
	 * then surfaces as this method's rejection. A caller whose `content` stream errors gets a rejected
	 * `put()`, never a silently truncated encrypted file and never a hang.
	 */
	private async putStream(path: string, content: NodeJS.ReadableStream): Promise<void> {
		const iv = randomBytes(16);
		const cipher = createCipheriv(this.algorithm, this.encryptionKey!, iv);
		const output = new PassThrough();
		output.write(Buffer.concat([ENCRYPTION_PREFIX, iv]));

		const providerDone = this.provider.put(path, output);
		const pipelineDone = pipeline(content, cipher, output);

		await Promise.all([providerDone, pipelineDone]);
	}

	async get(path: string): Promise<NodeJS.ReadableStream> {
		const stream = await this.provider.get(path);
		const buffer = await streamToBuffer(stream);
		const decryptedContent = await this.decrypt(buffer);
		return Readable.from(decryptedContent);
	}

	public async getStream(path: string): Promise<NodeJS.ReadableStream> {
		const stream = await this.provider.get(path);
		if (!this.encryptionKey) {
			return stream;
		}

		// For encrypted files, we need to read the prefix and IV first.
		// This part still buffers a small, fixed amount of data, which is acceptable.
		const prefixAndIvBuffer = await new Promise<Buffer>((resolve, reject) => {
			const chunks: Buffer[] = [];
			let totalLength = 0;
			const targetLength = ENCRYPTION_PREFIX.length + 16;

			const onData = (chunk: Buffer) => {
				chunks.push(chunk);
				totalLength += chunk.length;
				if (totalLength >= targetLength) {
					stream.removeListener('data', onData);
					resolve(Buffer.concat(chunks));
				}
			};

			stream.on('data', onData);
			stream.on('error', reject);
			stream.on('end', () => {
				// Handle cases where the file is smaller than the prefix + IV
				if (totalLength < targetLength) {
					resolve(Buffer.concat(chunks));
				}
			});
		});

		const prefix = prefixAndIvBuffer.subarray(0, ENCRYPTION_PREFIX.length);
		if (!prefix.equals(ENCRYPTION_PREFIX)) {
			// File is not encrypted, return a new stream containing the buffered prefix and the rest of the original stream
			const combinedStream = new Readable({
				read() {},
			});
			combinedStream.push(prefixAndIvBuffer);
			stream.on('data', (chunk) => {
				combinedStream.push(chunk);
			});
			stream.on('end', () => {
				combinedStream.push(null); // No more data
			});
			stream.on('error', (err) => {
				combinedStream.emit('error', err);
			});
			return combinedStream;
		}

		try {
			const iv = prefixAndIvBuffer.subarray(
				ENCRYPTION_PREFIX.length,
				ENCRYPTION_PREFIX.length + 16
			);
			const decipher = createDecipheriv(this.algorithm, this.encryptionKey, iv);

			// Push the remaining part of the initial buffer to the decipher
			const remainingBuffer = prefixAndIvBuffer.subarray(ENCRYPTION_PREFIX.length + 16);
			if (remainingBuffer.length > 0) {
				decipher.write(remainingBuffer);
			}

			// Pipe the rest of the stream
			stream.pipe(decipher);

			return decipher;
		} catch (error) {
			throw new Error('Failed to decrypt file. It may be corrupted or the key is incorrect.');
		}
	}

	delete(path: string): Promise<void> {
		return this.provider.delete(path);
	}

	exists(path: string): Promise<boolean> {
		return this.provider.exists(path);
	}
}
