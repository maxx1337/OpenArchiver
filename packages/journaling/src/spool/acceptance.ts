import { checkSpoolHighWaterMark, incomingFilePath, type HighWaterMarkStatus } from './layout';
import { DurableWriteError, writeDurableSpoolFile, type DurableWriteStage } from './durable-write';
import { generateTxId } from './txid';
import {
	quarantineSpoolFile,
	ProtocolRejectionAbort,
	type QuarantineAlertSink,
	type QuarantineReason,
} from './quarantine';
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
 * is a visible, reviewable diff against this file, not a silent regression. `acceptance.test.ts`
 * asserts the empirical half of this: after `backend.append()` resolves, a single shared timeline
 * records every one of `SpoolFileSystem`'s six operations (`mkdir`, `createFile`, `fsyncDirectory`,
 * `readdir`, `stat`, `rename`) plus the three operations reachable through the handle `createFile()`
 * returns (`write`, `fsync`, `close`) — nine in total — and no entry follows the append; and
 * `backend.append()` was called exactly once. I.e. nothing the success path could reach actually
 * touched the spool again. (F41: `readdir`, `stat` and `rename` used to pass through the test's
 * instrumentation untracked, so a *succeeding* call to any of them after the append would not have
 * been noticed — closed by extending `timelineFileSystem()` in `acceptance.test.ts` to cover all
 * nine operations, not only the six the durable write itself exercises.)
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
 *
 * ---------------------------------------------------------------------------------------------
 * A failed durable write quarantines its own debris (`JR-3-09`, F40 half 1)
 * ---------------------------------------------------------------------------------------------
 * Three of `writeDurableSpoolFile()`'s five sub-operations (`write()`, file-fsync, directory-fsync)
 * can leave a fully- or partially-written file in `incoming/` behind a {@link DurableWriteError} --
 * `durable-write.ts`'s module doc comment; the other two (`mkdir`, `createFile`) fail before any file
 * exists. Left in `incoming/`, that debris is indistinguishable from a genuine crash victim to
 * `JR-3-05`'s crash-recovery scan (architecture doc section 5's corrected sentence, F40) -- an ordinary
 * `451`/`452` here would page an operator to investigate a crash that never happened, on a process that
 * never stopped running.
 *
 * So {@link JournalAcceptance.accept}'s `DurableWriteError` handler quarantines whatever the failed
 * write left behind, immediately, with reason `'write-failed'` -- structurally the same operation
 * `crash-recovery.ts` performs for `'no-ledger-entry'`, shared through {@link quarantineSpoolFile}
 * (`./quarantine.ts`). Never a deletion (skill section 3; `SpoolFileSystem` has no delete method to
 * misuse), and never a *guess* at whether a file exists: {@link quarantineSpoolFile} attempts the
 * `rename()` unconditionally and tolerates the `ENOENT` that `mkdir`/`createFile` failures produce
 * (nothing was ever there to move) the same way it tolerates a second scan racing the same file.
 *
 * This cleanup is attempted, never awaited-and-trusted: it runs from inside a catch block that already
 * holds the real failure the caller needs (`DurableWriteError.stage`/`.cause`, which decide `451` vs
 * `452`). A second, independent failure *of the cleanup itself* (the quarantine side has its own
 * `mkdir`/`rename` that can fail) must never replace or mask that original cause, so it is caught and
 * discarded rather than left to propagate or to change the returned result -- see
 * {@link JournalAcceptance.quarantineFailedWrite}'s own doc comment for what happens to the debris in
 * that (rare, double-fault) case.
 *
 * Not in scope here, and not solved by this: moving debris into `quarantine/` frees no capacity --
 * `checkSpoolHighWaterMark()` counts `quarantine/` deliberately (`JR-3-01`), and quarantine is never
 * auto-emptied. F40's second half (a retention/release procedure for quarantine) is unresolved and
 * belongs to E10/E12, not this module.
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
export function isAccepted(result: JournalAcceptanceResult): result is AcceptedJournalTransaction {
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
	/**
	 * Where a `'write-failed'` quarantine alert goes (`JR-3-09`, see the module doc comment's "A failed
	 * durable write quarantines its own debris" section). **Required, deliberately** -- PO decision
	 * 2026-08-02: an optional field defaulting to a discarding sink is exactly R-09
	 * (`docs/dev/journaling/08-risiken.md`, "stiller Ausfall bleibt unbemerkt") built into this
	 * constructor. Every other guarantee in this file is structural rather than disciplinary --
	 * {@link LedgerAppendRequest} gives a caller nowhere to put a pre-computed chain hash,
	 * {@link buildAcceptedTransaction} holds no capability to do I/O, {@link SpoolFileSystem} has no
	 * delete method -- and a required constructor parameter is the same kind of argument: a caller that
	 * has not decided where alerts go does not compile, rather than compiling into a silently discarded
	 * alert. A caller that genuinely does not care passes an explicit no-op or collecting sink of its
	 * own, visibly, at the call site -- see any test in `acceptance.test.ts` for the shape. A missing or
	 * discarding sink never changes what {@link accept} returns, and never turns a cleanup failure into
	 * a masked original cause -- see {@link JournalAcceptance.quarantineFailedWrite}.
	 */
	readonly alertSink: QuarantineAlertSink;
}

export class JournalAcceptance {
	private readonly fs: SpoolFileSystem;
	private readonly backend: LedgerBackend;
	private readonly spoolConfig: SpoolConfig;
	private readonly now: () => number;
	private readonly alertSink: QuarantineAlertSink;

	constructor(options: JournalAcceptanceOptions) {
		this.fs = options.fs;
		this.backend = options.backend;
		this.spoolConfig = options.spoolConfig;
		this.now = options.now ?? Date.now;
		this.alertSink = options.alertSink;
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
			// JR-3-09 (F40 half 1): whatever the failed write left behind in incoming/ -- fully, partially,
			// or not at all, depending which of the five sub-operations failed -- is quarantined right now,
			// under its own reason. See the module doc comment and quarantineFailedWrite()'s own doc comment
			// for why this never masks `cause.stage`/`cause.cause` below, which the caller still needs for
			// `451` vs `452`.
			//
			// JR-4-06b: `cause.cause` is the bridge-abort `Error` `SmtpConnection.finalizeAcceptance`
			// passed to `SpoolWriteBridge.abort()` -- a deliberate `ProtocolRejectionAbort` for an
			// oversize rejection, or an ordinary `Error` for a genuine write failure. Choosing the
			// quarantine reason from that, rather than always `'write-failed'`, is the fix for the
			// mislabelled-alert half of this task -- see `quarantine.ts`'s module doc comment.
			await this.quarantineFailedWrite(
				txid,
				cause.cause instanceof ProtocolRejectionAbort ? 'oversize-rejected' : 'write-failed'
			);
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
			// The spool file stays on disk -- see the module doc comment. Nothing here deletes it. Unlike
			// the DurableWriteError branch above, this is deliberately *not* quarantined: a ledger-append
			// failure is genuinely ambiguous (the try/catch also catches a network blip after a successful
			// commit -- crash-recovery.ts's own doc comment), so only the ledger, asked by spool_txid, may
			// decide this file's fate. Quarantining it here on a guess could hide a message the ledger
			// actually did record.
			return {
				kind: 'ledger-append-failed',
				spoolTxId: txid,
				filePath: durable.filePath,
				cause,
			};
		}
	}

	/**
	 * Quarantine whatever a failed durable write left behind in `incoming/`, under reason
	 * `'write-failed'` (`JR-3-09`, F40 half 1). See the module doc comment's "A failed durable write
	 * quarantines its own debris" section for why this exists and why the reason differs from
	 * crash-recovery's `'no-ledger-entry'`.
	 *
	 * Never throws. {@link quarantineSpoolFile} is itself fallible -- its own `mkdir`/`rename` on the
	 * quarantine side can fail independently of whatever failed on the incoming side -- and this method
	 * is always called from inside a catch block that already holds the real {@link DurableWriteError}
	 * the caller needs `stage`/`cause` from to choose `451` vs `452`. A second failure here must never
	 * replace or hide that one, so it is caught and discarded. Worst case: the debris stays in
	 * `incoming/` exactly as it would have before this slice, and `JR-3-05`'s crash-recovery scan is
	 * still there to quarantine it -- under `'no-ledger-entry'` instead of whatever `reason` this call
	 * would have used -- on the next startup. That is a degraded diagnosis (F40's original bug, not
	 * fixed for this one file), never a lost message and never a masked cause.
	 *
	 * `reason` (`JR-4-06b`) is `'oversize-rejected'` when the failed write's `DurableWriteError` wraps
	 * a `ProtocolRejectionAbort` (the SMTP layer's own oversize abort, see the call site), `'write-failed'`
	 * otherwise -- see `quarantine.ts`'s module doc comment for why this distinction exists.
	 */
	private async quarantineFailedWrite(txid: string, reason: QuarantineReason): Promise<void> {
		const filePath = incomingFilePath(this.spoolConfig.rootPath, txid);
		try {
			await quarantineSpoolFile(
				this.fs,
				this.spoolConfig.rootPath,
				txid,
				filePath,
				reason,
				this.alertSink
			);
		} catch {
			// Swallowed deliberately -- see this method's doc comment.
		}
	}
}
