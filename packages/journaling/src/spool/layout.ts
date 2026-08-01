import { createHash } from 'node:crypto';
import path from 'node:path';
import type { SpoolFileSystem } from './fs-port';

/**
 * Spool layout and management (`JR-3-01`, RFC sections 3 and 11).
 *
 * ---------------------------------------------------------------------------------------------
 * Layout
 * ---------------------------------------------------------------------------------------------
 * ```
 * <spoolRoot>/
 *   incoming/
 *     <shard>/<txid>.eml      -- durably written, not yet ledger-appended, or ledger-appended and
 *                                 awaiting Phase B (`JR-3-02`, `JR-6-04`)
 *   quarantine/
 *     <shard>/<txid>.eml      -- moved here by the crash-recovery scan (`JR-3-05`) when a spool file
 *                                 has no matching ledger entry: the transaction was never
 *                                 acknowledged, so nothing regresses by keeping the file, and the
 *                                 skill's rule against silent deletion (`journal-ledger` section 3)
 *                                 makes keeping it mandatory, not a choice.
 * ```
 *
 * `<shard>` is the first two hex characters of `SHA-256(txid)` -- 256 subdirectories, populated
 * lazily as transactions land in them. This is the same technique Git uses for loose objects, for
 * the same reason: a single flat directory with millions of entries makes `readdir()` and most
 * filesystems' path lookups slow, and a filename-derived shard needs no separate counter or
 * directory index to stay balanced. Deliberately **not** a time-based prefix (e.g. the ULID's own
 * leading characters): a ULID's first ten characters encode a millisecond timestamp, so many
 * transactions arriving close together would land in the same handful of shards precisely when the
 * spool is busiest -- the opposite of what sharding is for. Hashing the ID decorrelates the shard
 * from arrival time.
 *
 * Both `incoming/` and `quarantine/` are sharded identically, using the same {@link shardOf}. A
 * quarantined file keeps the shard it already had rather than being reassigned one, so `rename()`
 * from `incoming/<shard>/<txid>.eml` to `quarantine/<shard>/<txid>.eml` never needs to create a new
 * shard directory it does not already know about (`ensureQuarantineShardDir` still creates it if
 * this is that shard's first quarantined file).
 *
 * ---------------------------------------------------------------------------------------------
 * High-water mark
 * ---------------------------------------------------------------------------------------------
 * `docs/dev/journaling/00-rfc.md` section 11's configuration sketch gives an absolute byte budget
 * (`spool.high_water_bytes`), not a percentage of free disk space -- deliberately, since free space
 * depends on what else shares the volume and an operator reasoning about "how much mail can this
 * box hold before I need to act" wants a fixed number. {@link checkSpoolHighWaterMark} walks the
 * spool tree (`incoming/` **and** `quarantine/` -- a quarantined file still occupies the budget, and
 * quarantine is never auto-emptied, so excluding it would hide exactly the failure mode that fills a
 * disk silently) and reports whether the total is at or over the configured limit.
 *
 * This is a **typed result**, not an SMTP status code -- mapping "exceeded" to `452 4.3.1` is
 * `JR-4-06`'s job (response-code mapping) and deciding *when* to call this check is `JR-3-04`'s job
 * (wiring the two-phase acceptance). Neither is done here.
 *
 * **Left open for whoever wires this in (`JR-3-04`):** as written, this recomputes usage by walking
 * every shard directory and `stat()`-ing every file, on every call. That is correct and is cheap
 * enough to demonstrate and to unit-test, but doing it once per SMTP transaction at meaningful spool
 * depth is `O(entries)` work on the hot path the acceptance contract is supposed to keep fast. A
 * maintained running counter (incremented on write, decremented as Phase B or the reconciler frees
 * entries, reconciled against a full walk on the crash-recovery scan `JR-3-05` already does at
 * startup) is the likely production shape; this module deliberately does not decide that, since it
 * is a wiring/performance concern rather than a layout one.
 */

/** Number of hex characters used as the shard directory name -- 256 shards. */
const SHARD_PREFIX_LENGTH = 2;

export const INCOMING_DIR_NAME = 'incoming';
export const QUARANTINE_DIR_NAME = 'quarantine';

/** Deterministic shard for a transaction ID: first two hex chars of `SHA-256(txid)`. */
export function shardOf(txid: string): string {
	return createHash('sha256').update(txid, 'utf8').digest('hex').slice(0, SHARD_PREFIX_LENGTH);
}

function shardDir(spoolRoot: string, category: string, txid: string): string {
	return path.join(spoolRoot, category, shardOf(txid));
}

function filePath(spoolRoot: string, category: string, txid: string): string {
	return path.join(shardDir(spoolRoot, category, txid), `${txid}.eml`);
}

export function incomingShardDir(spoolRoot: string, txid: string): string {
	return shardDir(spoolRoot, INCOMING_DIR_NAME, txid);
}

export function incomingFilePath(spoolRoot: string, txid: string): string {
	return filePath(spoolRoot, INCOMING_DIR_NAME, txid);
}

export function quarantineShardDir(spoolRoot: string, txid: string): string {
	return shardDir(spoolRoot, QUARANTINE_DIR_NAME, txid);
}

export function quarantineFilePath(spoolRoot: string, txid: string): string {
	return filePath(spoolRoot, QUARANTINE_DIR_NAME, txid);
}

/** Create `incoming/` and `quarantine/` under `spoolRoot`. Idempotent; call once at process start. */
export async function ensureSpoolLayout(fs: SpoolFileSystem, spoolRoot: string): Promise<void> {
	await fs.mkdir(path.join(spoolRoot, INCOMING_DIR_NAME), { recursive: true });
	await fs.mkdir(path.join(spoolRoot, QUARANTINE_DIR_NAME), { recursive: true });
}

/**
 * Ensure the shard directory a given transaction's incoming file belongs to exists, and return its
 * path. Shard directories are created lazily -- on the first transaction that lands in them -- rather
 * than all 256 being pre-created, so `ensureSpoolLayout()` stays O(1).
 */
export async function ensureIncomingShardDir(
	fs: SpoolFileSystem,
	spoolRoot: string,
	txid: string
): Promise<string> {
	const dir = incomingShardDir(spoolRoot, txid);
	await fs.mkdir(dir, { recursive: true });
	return dir;
}

/** Same as {@link ensureIncomingShardDir}, for `quarantine/`. Used by the crash-recovery scan. */
export async function ensureQuarantineShardDir(
	fs: SpoolFileSystem,
	spoolRoot: string,
	txid: string
): Promise<string> {
	const dir = quarantineShardDir(spoolRoot, txid);
	await fs.mkdir(dir, { recursive: true });
	return dir;
}

/** The result of a high-water-mark check. Not an SMTP code -- see the module doc comment. */
export interface HighWaterMarkStatus {
	readonly exceeded: boolean;
	readonly usageBytes: bigint;
	readonly highWaterBytes: bigint;
}

function isEnoent(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code?: unknown }).code === 'ENOENT'
	);
}

/**
 * Sum the size, in bytes, of every regular file at or under `dir`. A missing directory counts as
 * zero usage rather than an error -- an unwritten-to spool (or a shard nobody has used yet) is not a
 * fault.
 */
export async function computeDirectoryUsageBytes(
	fs: SpoolFileSystem,
	dir: string
): Promise<bigint> {
	let entries;
	try {
		entries = await fs.readdir(dir);
	} catch (error) {
		if (isEnoent(error)) {
			return 0n;
		}
		throw error;
	}
	let total = 0n;
	for (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory) {
			total += await computeDirectoryUsageBytes(fs, entryPath);
			continue;
		}
		const info = await fs.stat(entryPath);
		total += BigInt(info.size);
	}
	return total;
}

/** Compare a usage figure against the configured budget. Pure -- no I/O. */
export function evaluateHighWaterMark(
	usageBytes: bigint,
	highWaterBytes: bigint
): HighWaterMarkStatus {
	return { exceeded: usageBytes >= highWaterBytes, usageBytes, highWaterBytes };
}

/**
 * Walk the whole spool (`incoming/` and `quarantine/`) and report whether it is at or over
 * `highWaterBytes`. See the module doc comment for why quarantine is included and for the
 * performance note left to `JR-3-04`.
 */
export async function checkSpoolHighWaterMark(
	fs: SpoolFileSystem,
	spoolRoot: string,
	highWaterBytes: bigint
): Promise<HighWaterMarkStatus> {
	const usageBytes = await computeDirectoryUsageBytes(fs, spoolRoot);
	return evaluateHighWaterMark(usageBytes, highWaterBytes);
}
