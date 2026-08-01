import path from 'node:path';
import {
	INCOMING_DIR_NAME,
	QUARANTINE_DIR_NAME,
	ensureQuarantineShardDir,
	incomingFilePath,
	quarantineFilePath,
} from './layout';
import type { SpoolFileSystem } from './fs-port';
import type { LedgerEntryByTxId, LedgerLookup } from '../ledger/ledger-lookup-port';

/**
 * The crash-recovery scan (`JR-3-05`, RFC section 3 + architecture doc section 5, skill
 * `journal-ledger` section 3).
 *
 * ---------------------------------------------------------------------------------------------
 * What it does, in one line
 * ---------------------------------------------------------------------------------------------
 * List `incoming/`, ask the ledger which of those transaction ids it knows about in **one** batched
 * call, and for each file: a ledger entry means the message was acknowledged and Phase B is still
 * owed, so report it for requeue and leave the file exactly where it is; no ledger entry means the
 * message was **never acknowledged** (a crash between durable-write and ledger-append -- skill section
 * 3), so move the file to `quarantine/` and alert. Nothing here decides an SMTP code, enqueues a
 * BullMQ job, or writes a log line -- that is the caller's job (`apps/smtp-ingress` and the
 * `journal-inbound` worker both run this scan at startup, per architecture section 5).
 *
 * ---------------------------------------------------------------------------------------------
 * The ledger is the only authority
 * ---------------------------------------------------------------------------------------------
 * `JR-3-04`'s doc comment on `acceptance.ts` records that a failure surfacing to the *caller* as
 * `'ledger-append-failed'` does not prove the ledger append itself failed -- the try/catch around it
 * also catches a network blip after a successful commit. That means a spool file's fate can never be
 * inferred from anything local (file age, an in-memory record of what `accept()` returned, whether the
 * process remembers writing it) -- only from asking the ledger, by `spool_txid`, right now. This module
 * does exactly that and nothing else: no case below is decided by file mtime, file presence alone, or
 * any state this process might have cached from before it crashed.
 *
 * ---------------------------------------------------------------------------------------------
 * Never deletes -- structurally, not by discipline
 * ---------------------------------------------------------------------------------------------
 * {@link SpoolFileSystem} (`./fs-port.ts`) exposes exactly six operations: `mkdir`, `createFile`,
 * `fsyncDirectory`, `readdir`, `stat`, `rename`. **There is no delete/unlink method on the port.** A
 * caller that only has a `SpoolFileSystem` cannot delete a spool file no matter what it does with it --
 * the capability does not exist to be misused. This function only ever calls `readdir` (to discover
 * files) and, for the no-ledger-entry case, `mkdir` (to ensure the quarantine shard exists) and
 * `rename` (to move the file there). A `rename()` is not a delete: the bytes still exist, just at a
 * different path, which is exactly what the skill requires ("never delete a spool file that has no
 * ledger entry without recording that decision somewhere durable" -- here, the alert plus the file's
 * new, quarantined location *is* that record).
 *
 * `crash-recovery.test.ts` checks the empirical side of this: across a scan that both requeues and
 * quarantines files, the total number of files known to the fake filesystem is unchanged, and every
 * byte of every file's content is still reachable at its final path (original or quarantined). A
 * regression that lost content would have to either add a delete-capable method to `SpoolFileSystem`
 * (a visible, reviewable diff to `fs-port.ts`) or implement `rename()` as delete-then-maybe-recreate in
 * a way that drops bytes -- either would fail that test.
 *
 * ---------------------------------------------------------------------------------------------
 * Why `quarantine/` is walked too, but never queried or touched
 * ---------------------------------------------------------------------------------------------
 * A file already in `quarantine/` has, by construction, no ledger entry -- that is the only reason it
 * is there -- and re-asking the ledger about it on every subsequent startup would never change the
 * answer, only add load. So `quarantine/` is listed purely for the *count* in
 * {@link CrashRecoveryScanResult.preexistingQuarantineFiles} (operator visibility: "how much unresolved
 * evidence is sitting here"), and no `spool_txid` found there is ever added to the batch sent to the
 * ledger, moved, or alerted on again. `crash-recovery.test.ts` asserts this directly: a pre-existing
 * quarantine file's id never appears in {@link LedgerLookup.findBySpoolTxIds}'s recorded call.
 *
 * ---------------------------------------------------------------------------------------------
 * Cost
 * ---------------------------------------------------------------------------------------------
 * For each of the two categories (`incoming/`, `quarantine/`) the top-level `readdir` returns at most
 * 256 shard dirents (`./layout.ts`'s sharding), and each populated shard directory is `readdir`'d once
 * more -- so directory-listing cost is bounded by roughly 512 `readdir` calls regardless of how many
 * files the spool holds, plus one further `readdir` per populated shard proportional to its file count.
 * The ledger side is a **single** batched query (`LedgerLookup.findBySpoolTxIds`) covering every
 * `incoming/` file found, independent of count -- the concern this exists to avoid is discussed on
 * `../ledger/ledger-lookup-port.ts`.
 *
 * What does **not** scale away: the loop below issues its `mkdir`/`rename` pair for each file that
 * needs quarantining one at a time, and everything is sequential -- there is no concurrency limiter and
 * no batching of the renames themselves. At the spool sizes E10 will care about (a large `incoming/`
 * backlog after an extended outage, potentially thousands of never-acknowledged files if the outage
 * coincided with a wave of retries), this scan's wall-clock time is roughly proportional to the number
 * of files needing quarantine, run serially, on the process's startup path. That is correct and was the
 * cheapest thing to get right first; if it becomes a startup-latency problem, a bounded-concurrency
 * `Promise.all` batch over the quarantine renames would be the next step -- flagged here, not solved.
 *
 * ---------------------------------------------------------------------------------------------
 * Both processes run this at startup, and that is a real race, not a hypothetical one
 * ---------------------------------------------------------------------------------------------
 * Architecture doc section 5 has `apps/smtp-ingress` **and** the `journal-inbound` worker both run this
 * scan on startup. If both start at once against the same spool, both can discover the same
 * never-acknowledged file before either has moved it. Whichever renames first wins; the second's
 * `rename()` then rejects with `ENOENT` (the source is already gone). That is treated as "someone else
 * already quarantined this file" -- not an error, not a second alert, not added to this call's
 * `quarantined` list -- rather than letting it propagate and abort the whole scan over a benign,
 * documented race.
 */

const EML_SUFFIX = '.eml';

/** A ledger entry was found for this spool file: it was acknowledged, Phase B is still owed. */
export interface RequeueCandidate {
	readonly spoolTxId: string;
	/** Still `incoming/<shard>/<txid>.eml` -- this scan never moves a file that has a ledger entry. */
	readonly filePath: string;
	readonly seq: bigint;
	readonly chainScopeId: string;
	readonly journalingSourceId: string | null;
	readonly remoteIp: string | null;
	readonly receivedAt: Date;
}

/** No ledger entry was found: the transaction was never acknowledged, and the file has been quarantined. */
export interface QuarantinedEntry {
	readonly spoolTxId: string;
	readonly originalFilePath: string;
	readonly quarantineFilePath: string;
}

/**
 * The operator-visible event a quarantine produces (skill section 3: "alarmieren").
 *
 * `reason` is a literal union of one value today, deliberately -- so a future second cause (e.g. a
 * corrupt spool entry the scan cannot even parse a txid from) extends this without a breaking change,
 * the same convention `journalEventTypeEnum` uses for the ledger's own event types. `E10`'s monitoring
 * and `JR-10-02`'s gap detection are the intended future consumers; nothing about this shape is private
 * to this module.
 */
export interface CrashRecoveryAlert {
	readonly spoolTxId: string;
	readonly originalFilePath: string;
	readonly quarantineFilePath: string;
	readonly reason: 'no-ledger-entry';
}

/**
 * Where a quarantine alert goes. Injected, not a `console.log` and not a backend logger import --
 * `packages/journaling` has neither (architecture doc section 2), and a startup scan's alert needs to
 * reach wherever an operator actually looks, which is a wiring decision for whoever calls this.
 */
export interface CrashRecoveryAlertSink {
	alert(event: CrashRecoveryAlert): Promise<void> | void;
}

export interface CrashRecoveryScanResult {
	readonly requeue: readonly RequeueCandidate[];
	readonly quarantined: readonly QuarantinedEntry[];
	readonly incomingFilesScanned: number;
	/** Files already in `quarantine/` before this scan ran. Counted, never re-queried or moved. */
	readonly preexistingQuarantineFiles: number;
}

export interface CrashRecoveryScanOptions {
	readonly fs: SpoolFileSystem;
	readonly ledgerLookup: LedgerLookup;
	readonly spoolRoot: string;
	readonly alertSink: CrashRecoveryAlertSink;
}

function isEnoent(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code?: unknown }).code === 'ENOENT'
	);
}

interface DiscoveredFile {
	readonly txid: string;
	readonly filePath: string;
}

/**
 * List every `<txid>.eml` file directly under each shard directory of `topDir`. A missing `topDir`
 * (fresh spool, nothing ever written to this category) is empty, not an error -- the same convention
 * `computeDirectoryUsageBytes()` in `./layout.ts` uses.
 */
async function listSpoolFiles(fs: SpoolFileSystem, topDir: string): Promise<DiscoveredFile[]> {
	let shardEntries;
	try {
		shardEntries = await fs.readdir(topDir);
	} catch (error) {
		if (isEnoent(error)) {
			return [];
		}
		throw error;
	}

	const files: DiscoveredFile[] = [];
	for (const shardEntry of shardEntries) {
		if (!shardEntry.isDirectory) {
			// A stray file directly under incoming/ or quarantine/ is not a shard -- ignore it rather
			// than guess at its meaning; the layout never puts anything there.
			continue;
		}
		const shardPath = path.join(topDir, shardEntry.name);
		const fileEntries = await fs.readdir(shardPath);
		for (const fileEntry of fileEntries) {
			if (fileEntry.isDirectory || !fileEntry.name.endsWith(EML_SUFFIX)) {
				continue;
			}
			const txid = fileEntry.name.slice(0, -EML_SUFFIX.length);
			files.push({ txid, filePath: path.join(shardPath, fileEntry.name) });
		}
	}
	return files;
}

/**
 * Move one never-acknowledged file to quarantine and alert. Tolerates a concurrent scan (see the
 * module doc comment's race section) by treating `rename()`'s `ENOENT` -- the source already gone -- as
 * "already quarantined by the other caller", not a failure.
 *
 * Returns `null` when the race case above applies (nothing to report for this file from this call).
 */
async function quarantineOne(
	fs: SpoolFileSystem,
	spoolRoot: string,
	file: DiscoveredFile,
	alertSink: CrashRecoveryAlertSink
): Promise<QuarantinedEntry | null> {
	await ensureQuarantineShardDir(fs, spoolRoot, file.txid);
	const targetPath = quarantineFilePath(spoolRoot, file.txid);

	try {
		await fs.rename(file.filePath, targetPath);
	} catch (error) {
		if (isEnoent(error)) {
			return null;
		}
		throw error;
	}

	await alertSink.alert({
		spoolTxId: file.txid,
		originalFilePath: file.filePath,
		quarantineFilePath: targetPath,
		reason: 'no-ledger-entry',
	});

	return {
		spoolTxId: file.txid,
		originalFilePath: file.filePath,
		quarantineFilePath: targetPath,
	};
}

/** Run the scan once. See the module doc comment for the full contract. */
export async function runCrashRecoveryScan(
	options: CrashRecoveryScanOptions
): Promise<CrashRecoveryScanResult> {
	const { fs, ledgerLookup, spoolRoot, alertSink } = options;

	const incomingFiles = await listSpoolFiles(fs, path.join(spoolRoot, INCOMING_DIR_NAME));
	// Counted only -- see the module doc comment for why these are never looked up or touched.
	const quarantineFiles = await listSpoolFiles(fs, path.join(spoolRoot, QUARANTINE_DIR_NAME));

	const ledgerEntries = await ledgerLookup.findBySpoolTxIds(
		incomingFiles.map((file) => file.txid)
	);

	const requeue: RequeueCandidate[] = [];
	const quarantined: QuarantinedEntry[] = [];

	for (const file of incomingFiles) {
		const entry: LedgerEntryByTxId | undefined = ledgerEntries.get(file.txid);
		if (entry) {
			// Acknowledged: the file stays in incoming/ exactly as it is. Nothing here renames it,
			// nothing here deletes it -- only the report changes.
			requeue.push({
				spoolTxId: file.txid,
				filePath: incomingFilePath(spoolRoot, file.txid),
				seq: entry.seq,
				chainScopeId: entry.chainScopeId,
				journalingSourceId: entry.journalingSourceId,
				remoteIp: entry.remoteIp,
				receivedAt: entry.receivedAt,
			});
			continue;
		}

		const quarantinedEntry = await quarantineOne(fs, spoolRoot, file, alertSink);
		if (quarantinedEntry) {
			quarantined.push(quarantinedEntry);
		}
	}

	return {
		requeue,
		quarantined,
		incomingFilesScanned: incomingFiles.length,
		preexistingQuarantineFiles: quarantineFiles.length,
	};
}
