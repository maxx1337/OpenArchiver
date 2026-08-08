// packages/types/src/storage.types.ts

/**
 * Defines the contract that all storage providers must implement.
 * It uses streams to efficiently handle potentially large files without
 * loading them entirely into memory.
 */
export interface IStorageProvider {
	/**
	 * Stores a file at the specified path.
	 * @param path - The unique identifier for the file (e.g., "user-123/emails/message-abc.eml").
	 * @param content - The file content as a Buffer or a ReadableStream.
	 * @returns A promise that resolves when the file is successfully stored.
	 */
	put(path: string, content: Buffer | NodeJS.ReadableStream): Promise<void>;

	/**
	 * Retrieves a file from the specified path as a readable stream.
	 * @param path - The unique identifier for the file to retrieve.
	 * @returns A promise that resolves with a readable stream of the file's content.
	 * @throws {Error} If the file is not found.
	 */
	get(path: string): Promise<NodeJS.ReadableStream>;

	/**
	 * Deletes a file from the storage backend.
	 * @param path - The unique identifier for the file to delete.
	 * @returns A promise that resolves when the file is deleted.
	 */
	delete(path: string): Promise<void>;

	/**
	 * Checks for the existence of a file.
	 * @param path - The unique identifier for the file to check.
	 * @returns A promise that resolves with true if the file exists, false otherwise.
	 */
	exists(path: string): Promise<boolean>;
}

/**
 * Configuration for the Local Filesystem provider.
 */
export interface LocalStorageConfig {
	type: 'local';
	// The absolute root path on the server where the archive will be stored.
	rootPath: string;
	openArchiverFolderName: string;
	encryptionKey?: string;
	// Best-effort hardening (JR-7-03): after each successful `put()`, attempt to set the
	// Linux `chattr +i` (immutable) flag on the written file. This is deterrence, not real
	// WORM/Object Lock -- it only works on Linux with an ext-family filesystem, root can
	// clear it (`chattr -i`) at any time, and it also blocks this application's own later
	// deletions (e.g. retention-policy expiry) until an operator manually clears the flag.
	// No-op and non-fatal on any other platform or on failure. See
	// docs/enterprise/journaling/guide.md for the full tradeoff.
	hardenImmutable?: boolean;
}

/**
 * Configuration for any S3-compatible provider (AWS S3, MinIO, etc.).
 */
export interface S3StorageConfig {
	type: 's3';
	// The API endpoint. For AWS S3, this is region-specific (e.g., 'https://s3.us-east-1.amazonaws.com').
	// For MinIO, this is the address of your MinIO server (e.g., 'http://localhost:9000').
	endpoint: string;
	// The name of the bucket to use.
	bucket: string;
	// The access key ID for authentication.
	accessKeyId: string;
	// The secret access key for authentication.
	secretAccessKey: string;
	// The AWS region (optional but recommended for AWS S3).
	region?: string;
	// Force path-style addressing, required for MinIO.
	forcePathStyle?: boolean;
	openArchiverFolderName: string;
	encryptionKey?: string;
	// Object Lock mode applied to every object written via `put()`. The bucket must have
	// S3 Object Lock enabled at creation time (it cannot be enabled on an existing bucket).
	// Only 'COMPLIANCE' is supported: it is the mode that makes deletion or shortening of
	// the retention period impossible for every principal, including the bucket owner and
	// AWS account root — the property WORM storage exists for. Irreversible once objects are
	// written under it; see docs/dev/journaling/05-entscheidungen.md and
	// docs/dev/journaling/02-architektur.md §7. Omit to leave existing callers unaffected.
	objectLockMode?: 'COMPLIANCE';
	// Retention period, in days from the moment of write, used to compute the AWS SDK's
	// `ObjectLockRetainUntilDate` for each object. Only used when `objectLockMode` is set;
	// required together with it.
	objectLockRetainUntilDays?: number;
}

export type StorageConfig = LocalStorageConfig | S3StorageConfig;
