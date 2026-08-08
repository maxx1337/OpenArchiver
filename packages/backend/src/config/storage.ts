import { StorageConfig } from '@open-archiver/types';
import 'dotenv/config';

const storageType = process.env.STORAGE_TYPE;
const encryptionKey = process.env.STORAGE_ENCRYPTION_KEY;
const openArchiverFolderName = 'open-archiver';
let storageConfig: StorageConfig;

if (encryptionKey && !/^[a-fA-F0-9]{64}$/.test(encryptionKey)) {
	throw new Error('STORAGE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
}

if (storageType === 'local') {
	if (!process.env.STORAGE_LOCAL_ROOT_PATH) {
		throw new Error('STORAGE_LOCAL_ROOT_PATH is not defined in the environment variables');
	}
	storageConfig = {
		type: 'local',
		rootPath: process.env.STORAGE_LOCAL_ROOT_PATH,
		openArchiverFolderName: openArchiverFolderName,
		encryptionKey: encryptionKey,
		// Best-effort deterrence hardening (JR-7-03), not real WORM. See
		// docs/enterprise/journaling/guide.md before enabling in production.
		hardenImmutable: process.env.STORAGE_LOCAL_HARDEN_IMMUTABLE === 'true',
	};
} else if (storageType === 's3') {
	if (
		!process.env.STORAGE_S3_ENDPOINT ||
		!process.env.STORAGE_S3_BUCKET ||
		!process.env.STORAGE_S3_ACCESS_KEY_ID ||
		!process.env.STORAGE_S3_SECRET_ACCESS_KEY
	) {
		throw new Error('One or more S3 storage environment variables are not defined');
	}

	// Object Lock (WORM, JR-7-01): optional, and only 'COMPLIANCE' is supported -- the mode
	// that makes early deletion technically impossible, including for us. Requires a bucket
	// created with Object Lock enabled; see docs/enterprise/journaling/guide.md.
	const objectLockModeRaw = process.env.STORAGE_S3_OBJECT_LOCK_MODE;
	const objectLockRetainDaysRaw = process.env.STORAGE_S3_OBJECT_LOCK_RETAIN_DAYS;
	let objectLockMode: 'COMPLIANCE' | undefined;
	let objectLockRetainUntilDays: number | undefined;

	if (objectLockModeRaw) {
		if (objectLockModeRaw !== 'COMPLIANCE') {
			throw new Error(
				`Invalid STORAGE_S3_OBJECT_LOCK_MODE: '${objectLockModeRaw}'. Only 'COMPLIANCE' is supported.`
			);
		}
		const parsedDays = Number(objectLockRetainDaysRaw);
		if (!objectLockRetainDaysRaw || !Number.isInteger(parsedDays) || parsedDays <= 0) {
			throw new Error(
				'STORAGE_S3_OBJECT_LOCK_RETAIN_DAYS must be set to a positive integer (days) when STORAGE_S3_OBJECT_LOCK_MODE is set'
			);
		}
		objectLockMode = 'COMPLIANCE';
		objectLockRetainUntilDays = parsedDays;
	}

	storageConfig = {
		type: 's3',
		endpoint: process.env.STORAGE_S3_ENDPOINT,
		bucket: process.env.STORAGE_S3_BUCKET,
		accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID,
		secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY,
		region: process.env.STORAGE_S3_REGION,
		forcePathStyle: process.env.STORAGE_S3_FORCE_PATH_STYLE === 'true',
		openArchiverFolderName: openArchiverFolderName,
		encryptionKey: encryptionKey,
		objectLockMode: objectLockMode,
		objectLockRetainUntilDays: objectLockRetainUntilDays,
	};
} else {
	throw new Error(`Invalid STORAGE_TYPE: ${storageType}`);
}

export const storage = storageConfig;
