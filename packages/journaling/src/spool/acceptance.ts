import { checkSpoolHighWaterMark, type HighWaterMarkStatus } from './layout';
import { DurableWriteError, writeDurableSpoolFile, type DurableWriteStage } from './durable-write';
import { generateTxId } from './txid';
import type { SpoolConfig } from './config';
import type { SpoolFileSystem } from './fs-port';
import { normalizeRemoteIp } from '../ledger/canonical-encoding';
import type { LedgerAppendRequest, LedgerAppendResult, LedgerBackend } from '../ledger/ledger-port';

/**
 * The two-phase acceptance (`JR-3-04`, RFC section 3, skill `journal-ledger` section 1).
 *
 * This is the wiring the acceptance contract is about: high-water-mark check → durable spool write
 * (fsync on the file **and** the directory, SHA-256 streamed alongside — both already `JR-3-02`'s job,
 * not repeated here) → ledger append (`synchronous_commit = on`, `JR-2-06`) → **only then** a success
 * value. `apps/smtp-ingress` (E4) is the only thing allowed to turn the result of {@link
 * JournalAcceptance.accept} into an SMTP status code and is the only thing allowed to write `250` to
 * the wire — this module never touches SMTP.
 *
 * ---------------------------------------------------------------------------------------------
 * The order, and why it is not configurable
 * ---------------------------------------------------------------------------------------------
 * ```
 * checkSpoolHighWaterMark()          -- reject before a single byte is written
 *         │
 *         ▼
 * writeDurableSpoolFile()            -- write, fsync(file), fsync(directory), SHA-256 -- streamed
 *         │
 *         ▼
 * backend.append()                   -- synchronous_commit = on, inside the per-chain advisory lock
 *         │
 *         ▼
 * { kind: 'accepted', seq, chainHash }  -- the only thing that may follow, and it is pure
 * ```
 *
 * There is no configuration flag anywhere in this file that can skip a step or reorder two of them.
 * The single method below performs them as a straight sequence of `await`s; nothing branches around
 * the durable write or around the append on any input.
 *
 * ---------------------------------------------------------------------------------------------
 * Why "nothing after the ledger append can still fail" is true by construction, not by discipline
 * ---------------------------------------------------------------------------------------------
 * Look at what happens on the success path, in full:
 *
 * ```ts
 * return buildAcceptedTransaction(txid, await this.backend.append(request));
 * ```
 *
 * One statement. `buildAcceptedTransaction()` is a plain, synchronous, total function — its
 * parameter list is `(spoolTxId: string, appended: LedgerAppendResult)`. It has no
 * {@link SpoolFileSystem} parameter and no {@link LedgerBackend} parameter, so it has no reference
 * through which it — or anything reachable from it — could open a file, fsync anything, or issue a
 * query. It cannot "accidentally" perform a fallible operation on the success path because it holds
 * no capability to perform any operation at all beyond reading the plain data it was given. This is
 * the same technique `LedgerAppendRequest` uses in `ledger-port.ts` (a caller cannot pre-compute a
 * chain hash because the type gives it nowhere to put one) applied the other way round: a builder
 * cannot perform I/O after the fact because its signature gives it nothing to perform I/O *with*.
 *
 * The second half of the argument is syntactic rather than type-level, and just as load-bearing:
 * `buildAcceptedTransaction(txid, await this.backend.append(request))` is *one* expression. There is
 * no line between "the append settled" and "the function returns" for a maintainer to insert a new
 * `await` into — inserting one requires first taking the expression apart into two statements, which
 * is a visible, reviewable diff against this file, not a silent regression. `accept.test.ts` asserts
 * the empirical half of this: after `backend.append()` resolves, the fake filesystem's call log is
 * unchanged and `backend.append()` was called exactly once — i.e. nothing the success path could
 * reach actually touched the spool again.
 *
 * ---------------------------------------------------------------------------------------------
 * A failed ledger append never deletes the spool file
 * ---------------------------------------------------------------------------------------------
 * Skill section 3 forbids deleting a spool file that has no ledger entry without a durable record of
 * that decision, and this module makes no such record — so it makes no such deletion. On a ledger
 * append failure the spool file from the successful durable write stays exactly where
 * `writeDurableSpoolFile()` put it; `JR-3-05`'s crash-recovery scan is what later decides its fate
 * (quarantine, with an alert). This file's job stops at reporting the failure with enough
 * information (`filePath`, `cause`) for that scan and for `apps/smtp-ingress`'s `451` response.
 *
 * ---------------------------------------------------------------------------------------------
 * Stage *and* cause decide `451` vs `452`, not stage alone
 * ---------------------------------------------------------------------------------------------
 * `docs/dev/journaling/02-architektur.md` section 3 ("Was der Spool nach oben meldet", PO decision
 * 2026-08-01): {@link DurableWriteError.stage} alone cannot tell a disk-full write failure from any
 * other write failure, because `'write'` covers directory creation, file creation and every `write()`
 * call alike. The distinguishing bit lives in {@link DurableWriteError.cause} (`cause.code ===
 * 'ENOSPC'`), so this module inspects both together and reports `'spool-capacity-exceeded'`
 * (→ `452`, retry once space exists) separately from `'spool-write-failed'` (→ `451`, ordinary retry).
 */

/** Everything one journal transaction needs beyond process-wide configuration. */
export interface JournalTransactionInput {
	/** `ingestion_sources.id` — the chain this receipt belongs to (ADR-007). */
	readonly chainScopeId: string;
	/** Microseconds since the epoch, UTC, a whole millisecond (ADR-006 section 3.1). */
	readonly receivedAtMicros: bigint;
	/**
	 * The peer address as the SMTP layer read it off the socket, in whatever form Node reports it
	 * (e.g. `::ffff:192.0.2.25` on a dual-stack listener). Normalised here, once, before it reaches
	 * the ledger — see the module doc comment.
	 */
	readonly remoteIp: string | null;
	readonly ehloName: string | null;
	readonly tlsVersion: string | null;
	readonly tlsCipher: string | null;
	readonly envelopeFrom: string | null;
	/** Arrival order, never sorted (part of the receipt). */
	readonly envelopeRcpt: readonly string[] | null;
	readonly journalingSourceId: string | null;
	/** Raw wire bytes, already dot-unstuffed. Any async source works, including a socket stream. */
	readonly chunks: AsyncIterable<Uint8Array>;
	/**
	 * Transaction ID, if the caller already assigned one (e.g. for correlation in logs emitted before
	 * this call). Generated internally via `generateTxId()` when omitted — most callers can omit it.
	 */
	readonly txid?: string;
}

/** Accepted: the message is durably in the spool and durably in the ledger. Nothing follows this. */
export interface AcceptedJournalTransaction {
	readonly kind: 'accepted';
	readonly spoolTxId: string;
	/** Goes into `250 2.0.0 Ok: queued as <seq>` — `apps/smtp-ingress`'s job, not this module's. */
	readonly seq: bigint;
	readonly chainHash: Uint8Array;
}

/** Rejected before a single byte was written. Maps to `452` (skill section 2). */
export interface HighWaterMarkExceeded {
	readonly kind: 'high-water-mark-exceeded';
	readonly spoolTxId: string;
	readonly status: HighWaterMarkStatus;
}

/** The durable write failed for a disk-full-shaped reason. Maps to `452`, not `451`. */
export interface SpoolCapacityExceeded {
	readonly kind: 'spool-capacity-exceeded';
	readonly spoolTxId: string;
	readonly stage: DurableWriteStage;
	readonly cause: unknown;
}

/** The durable write failed for any other reason. Maps to `451` (retry). */
export interface SpoolWriteFailed {
	readonly kind: 'spool-write-failed';
	readonly spoolTxId: string;
	readonly stage: DurableWriteStage;
	readonly cause: unknown;
}

/**
 * The spool write succeeded and is durable; the ledger append failed. Maps to `451` (retry) — never
 * `250`. The spool file at `filePath` is deliberately left in place; see the module doc comment.
 */
export interface LedgerAppendFailed {
	readonly kind: 'ledger-append-failed';
	readonly spoolTxId: string;
	readonly filePath: string;
	readonly cause: unknown;
}

export type JournalAcceptanceResult =
	| AcceptedJournalTransaction
	| HighWaterMarkExceeded
	| SpoolCapacityExceeded
	| SpoolWriteFailed
	| LedgerAppendFailed;

/** `true` only for the one kind that may ever precede a `250`. */
export function isAccepted(
	result: JournalAcceptanceResult
): result is AcceptedJournalTransaction {
	return result.kind === 'accepted';
}

/** errno the skill and architecture doc name as the disk-full signal. Deliberately narrow — a wider
 * set (e.g. `EDQUOT`) is a decision for whoever owns `JR-3-06`'s fault-injection matrix, not this
 * module, and adding one silently here would change `452` behaviour without a documented reason. */
const CAPACITY_ERRNO = 'ENOSPC';

function isCapacityCause(cause: unknown): boolean {
	return (
		typeof cause === 'object' &&
		cause !== null &&
		'code' in cause &&
		(cause as { code?: unknown }).code === CAPACITY_ERRNO
	);
}

/**
 * Build the success value. Deliberately the only place `kind: 'accepted'` is constructed, and
 * deliberately synchronous and total — see the module doc comment for why that is the structural
 * half of this task's acceptance criterion.
 */
function buildAcceptedTransaction(
	spoolTxId: string,
	appended: LedgerAppendResult
): AcceptedJournalTransaction {
	return { kind: 'accepted', spoolTxId, seq: appended.seq, chainHash: appended.chainHash };
}

export interface JournalAcceptanceOptions {
	readonly fs: SpoolFileSystem;
	readonly backend: LedgerBackend;
	readonly spoolConfig: SpoolConfig;
	/** Injectable clock for `generateTxId()`. Defaults to `Date.now`; tests can pin it. */
	readonly now?: () => number;
}

export class JournalAcceptance {
	private readonly fs: SpoolFileSystem;
	private readonly backend: LedgerBackend;
	private readonly spoolConfig: SpoolConfig;
	private readonly now: () => number;

	constructor(options: JournalAcceptanceOptions) {
		this.fs = options.fs;
		this.backend = options.backend;
		this.spoolConfig = options.spoolConfig;
		this.now = options.now ?? Date.now;
	}

	/**
	 * Run one transaction through the two-phase acceptance. See the module doc comment for the fixed
	 * order and for why nothing can fail after a successful ledger append.
	 */
	async accept(input: JournalTransactionInput): Promise<JournalAcceptanceResult> {
		const txid = input.txid ?? generateTxId(this.now);

		// Step 0: reject before a single byte is written. Included in the budget: `quarantine/`, which
		// is never auto-emptied (layout.ts) -- a spool that is full of quarantined evidence is still a
		// full spool.
		const highWaterMark = await checkSpoolHighWaterMark(
			this.fs,
			this.spoolConfig.rootPath,
			this.spoolConfig.highWaterBytes
		);
		if (highWaterMark.exceeded) {
			return { kind: 'high-water-mark-exceeded', spoolTxId: txid, status: highWaterMark };
		}

		// Steps 1-4 of the acceptance contract: write, fsync(file), fsync(directory), SHA-256 --
		// streamed, all inside writeDurableSpoolFile() (JR-3-02). Never recomputed here.
		let durable;
		try {
			durable = await writeDurableSpoolFile(this.fs, {
				spoolRoot: this.spoolConfig.rootPath,
				txid,
				chunks: input.chunks,
			});
		} catch (cause) {
			if (!(cause instanceof DurableWriteError)) {
				// Not a modelled durability failure -- a programming error in the filesystem seam itself.
				// Swallowing it into a typed `451` would hide a bug behind a retry that can never succeed.
				throw cause;
			}
			if (isCapacityCause(cause.cause)) {
				return {
					kind: 'spool-capacity-exceeded',
					spoolTxId: txid,
					stage: cause.stage,
					cause: cause.cause,
				};
			}
			return {
				kind: 'spool-write-failed',
				spoolTxId: txid,
				stage: cause.stage,
				cause: cause.cause,
			};
		}

		// Step 5: ledger append, synchronous_commit = on, inside the per-chain advisory lock
		// (PostgresLedgerWriter, JR-2-06). Step 6 (the success value) is fused to this same await --
		// see the module doc comment for why that fusion is the point.
		const request: LedgerAppendRequest = {
			chainScopeId: input.chainScopeId,
			receivedAtMicros: input.receivedAtMicros,
			eventType: 'receipt',
			remoteIp: input.remoteIp === null ? null : normalizeRemoteIp(input.remoteIp),
			ehloName: input.ehloName,
			tlsVersion: input.tlsVersion,
			tlsCipher: input.tlsCipher,
			envelopeFrom: input.envelopeFrom,
			envelopeRcpt: input.envelopeRcpt,
			sizeBytes: durable.sizeBytes,
			contentSha256: durable.sha256,
			// Object-level dedup against content_sha256 is Phase B's job (architecture section 6) --
			// the ingress process has no object-store access to check against (architecture section 1)
			// and every accepted transaction gets a receipt regardless (skill section 5).
			duplicateOf: null,
			journalingSourceId: input.journalingSourceId,
			spoolTxId: txid,
			eventPayload: null,
		};

		try {
			return buildAcceptedTransaction(txid, await this.backend.append(request));
		} catch (cause) {
			// The spool file stays on disk -- see the module doc comment. Nothing here deletes it.
			return { kind: 'ledger-append-failed', spoolTxId: txid, filePath: durable.filePath, cause };
		}
	}
}
