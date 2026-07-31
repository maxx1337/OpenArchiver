import { createHash } from 'node:crypto';
import type { CanonicalJsonValue, JournalLedgerRecord } from '@open-archiver/types';
import { chainHash, genesisChainHash } from './canonical-encoding';
import type {
	LedgerAppendRequest,
	LedgerAppendResult,
	LedgerBackend,
	LedgerQuery,
	LedgerTransactor,
} from './ledger-port';

/**
 * `LedgerWriter.append()` — the serialised, durable append (`JR-206`, RFC sections 5.2 and 5.4).
 *
 * ---------------------------------------------------------------------------------------------
 * The sequence, and why it is exactly this one
 * ---------------------------------------------------------------------------------------------
 * ```
 * BEGIN
 *   SET LOCAL synchronous_commit = on      -- durability for this transaction (ADR-011)
 *   pg_advisory_xact_lock(<key from chain>) -- serialise appends to THIS chain (ADR-007 c.2)
 *   read head (seq, chain_hash)
 *   derive seq = head.seq + 1, prev = head.chain_hash (or the genesis hash)
 *   compute chain_hash  <-- INSIDE the lock
 *   INSERT
 * COMMIT
 * ```
 *
 * Every line of that order is load-bearing:
 *
 *  - **`pg_advisory_xact_lock`, not `pg_advisory_lock`.** The transactional variant is released when
 *    the transaction ends, including on abort. The session variant would leak a held lock on any error
 *    path and wedge the chain until the connection is recycled.
 *  - **The hash is computed after the head is read and before the insert, inside the lock.** Computed
 *    outside, two concurrent appends would read the same head and produce two rows claiming the same
 *    predecessor — a fork, and one of them silently wrong.
 *  - **`seq` comes from `max(seq) + 1`, never from a Postgres sequence.** `nextval()` is not rolled
 *    back, so a rolled-back transaction would leave a permanent hole, and a hole is a tamper signal
 *    (skill `journal-ledger` section 4). This is also why a rollback here consumes no `seq`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why the hash cannot be computed outside the lock
 * ---------------------------------------------------------------------------------------------
 * Not by convention — by construction. {@link LedgerAppendRequest} has no `seq`, no `prevChainHash`
 * and no `chainHash` field. Two of the three inputs to the hash are only knowable while the lock is
 * held, and the type gives a caller nowhere to put a pre-computed result. `buildRecord()` below is
 * private and is only ever called from inside the transaction callback.
 *
 * The remaining risk is somebody editing *this* file, so the ordering is also asserted:
 * `ledger-writer.test.ts` records the statements a fake transactor receives and checks that the lock
 * precedes the head read, and that the insert carries a hash consistent with the head that was read.
 */

/** Postgres advisory locks take a signed 64-bit key, so the top half wraps into the negatives. */
const UINT64_MODULUS = 2n ** 64n;

/**
 * Derive the advisory lock key from the chain identifier (ADR-007 consequence 2).
 *
 * SHA-256 of the identifier, first eight bytes, reinterpreted as a signed 64-bit integer. Computed
 * here rather than with Postgres' `hashtext()` on purpose: `hashtext` is explicitly **not** stable
 * across major versions, and a lock key that changes under an upgrade would let two processes on
 * different versions append to one chain concurrently.
 *
 * **A collision is harmless for correctness.** Two chains mapping to the same key serialise against
 * each other — slower, never wrong. The reverse would be the dangerous direction, and it cannot
 * happen: the same chain always yields the same key.
 */
export function advisoryLockKey(chainScopeId: string): bigint {
	const digest = createHash('sha256').update(chainScopeId, 'utf8').digest();
	const unsigned = digest.readBigUInt64BE(0);
	return unsigned >= 2n ** 63n ? unsigned - UINT64_MODULUS : unsigned;
}

/** The head of a chain as the writer needs it. `null` means the chain has no entry yet. */
interface ChainHead {
	readonly seq: bigint;
	readonly chainHash: Uint8Array;
}

export interface PostgresLedgerWriterOptions {
	/**
	 * The installation's identity, from `deployment_identity` (ADR-006 section 4.2).
	 *
	 * Injected rather than read per append: it is immutable (append-only is enforced on that table
	 * too), reading it every time would be waste, and a missing identity must fail at **startup**
	 * rather than in the middle of an SMTP transaction — at accept time there is nothing useful left
	 * to do about it.
	 */
	readonly deploymentId: string;
	readonly transactor: LedgerTransactor;
}

export class PostgresLedgerWriter implements LedgerBackend {
	private readonly deploymentId: string;
	private readonly transactor: LedgerTransactor;

	constructor(options: PostgresLedgerWriterOptions) {
		this.deploymentId = options.deploymentId;
		this.transactor = options.transactor;
	}

	async append(request: LedgerAppendRequest): Promise<LedgerAppendResult> {
		return this.transactor.transaction(async (tx) => {
			// Durability first: the ledger has to be at least as durable as the spool before the
			// message is acknowledged (RFC section 5.4). `SET LOCAL` scopes it to this transaction, so
			// the setting cannot leak to unrelated work on a pooled connection.
			await tx.query('SET LOCAL synchronous_commit = on');

			// From here until COMMIT this chain is ours. Released automatically at transaction end,
			// including on abort.
			await tx.query('SELECT pg_advisory_xact_lock($1)', [
				advisoryLockKey(request.chainScopeId),
			]);

			const head = await this.readHead(tx, request.chainScopeId);
			const seq = head === null ? 1n : head.seq + 1n;
			const prevChainHash =
				head === null
					? genesisChainHash(this.deploymentId, request.chainScopeId)
					: head.chainHash;

			// Inside the lock, and it cannot be otherwise: `seq` and `prevChainHash` were unknown a
			// moment ago and exist only here.
			const record = buildRecord(request, seq);
			const computed = chainHash(record, prevChainHash);

			await this.insert(tx, record, prevChainHash, computed);

			return { seq, chainHash: computed, prevChainHash };
		});
	}

	private async readHead(tx: LedgerQuery, chainScopeId: string): Promise<ChainHead | null> {
		// `ORDER BY seq DESC LIMIT 1` rather than `max(seq)`: it returns the hash in the same row, so
		// the head cannot be assembled from two different rows. The primary key
		// `(chain_scope_id, seq)` serves this directly.
		const rows = await tx.query<{ seq: string | bigint; chain_hash: Uint8Array }>(
			`SELECT seq, chain_hash
			   FROM journal_ledger
			  WHERE chain_scope_id = $1
			  ORDER BY seq DESC
			  LIMIT 1`,
			[chainScopeId]
		);
		const row = rows[0];
		if (!row) {
			return null;
		}
		return { seq: BigInt(row.seq), chainHash: row.chain_hash };
	}

	private async insert(
		tx: LedgerQuery,
		record: JournalLedgerRecord,
		prevChainHash: Uint8Array,
		computedChainHash: Uint8Array
	): Promise<void> {
		await tx.query(
			`INSERT INTO journal_ledger (
				chain_scope_id, seq, received_at, event_type,
				remote_ip, ehlo_name, tls_version, tls_cipher,
				envelope_from, envelope_rcpt, size_bytes, content_sha256,
				duplicate_of, journaling_source_id, spool_txid, event_payload,
				prev_chain_hash, chain_hash
			) VALUES (
				-- Integer arithmetic, deliberately: to_timestamp($3 / 1000000.0) would route a hashed
				-- value through a double, while bigint * interval is exact.
				$1, $2, timestamptz 'epoch' + $3::bigint * interval '1 microsecond', $4,
				$5, $6, $7, $8,
				$9, $10, $11, $12,
				$13, $14, $15, $16,
				$17, $18
			)`,
			[
				record.chainScopeId,
				record.seq,
				record.receivedAtMicros,
				record.eventType,
				record.remoteIp,
				record.ehloName,
				record.tlsVersion,
				record.tlsCipher,
				record.envelopeFrom,
				record.envelopeRcpt === null ? null : [...record.envelopeRcpt],
				record.sizeBytes,
				record.contentSha256,
				record.duplicateOf,
				record.journalingSourceId,
				record.spoolTxId,
				record.eventPayload === null ? null : JSON.stringify(record.eventPayload),
				prevChainHash,
				computedChainHash,
			]
		);
	}
}

/**
 * Turn a request plus the `seq` derived under the lock into the record the encoding hashes.
 *
 * Private on purpose: it is the only place a `JournalLedgerRecord` is assembled, and it is reachable
 * only from inside the transaction callback.
 */
function buildRecord(request: LedgerAppendRequest, seq: bigint): JournalLedgerRecord {
	return {
		chainScopeId: request.chainScopeId,
		seq,
		receivedAtMicros: request.receivedAtMicros,
		eventType: request.eventType,
		remoteIp: request.remoteIp,
		ehloName: request.ehloName,
		tlsVersion: request.tlsVersion,
		tlsCipher: request.tlsCipher,
		envelopeFrom: request.envelopeFrom,
		envelopeRcpt: request.envelopeRcpt,
		sizeBytes: request.sizeBytes,
		contentSha256: request.contentSha256,
		duplicateOf: request.duplicateOf,
		journalingSourceId: request.journalingSourceId,
		spoolTxId: request.spoolTxId,
		eventPayload: (request.eventPayload as CanonicalJsonValue | null) ?? null,
	};
}
