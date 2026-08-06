/**
 * Journal ledger types (epic E2, `JR-2-01`/`JR-2-02`).
 *
 * These describe the hash-chained receipt ledger of the SMTP journaling receiver. They live here
 * rather than in `packages/journaling` because that package is only allowed to depend on
 * `@open-archiver/types` (see `docs/dev/journaling/02-architektur.md` section 2), and both the
 * ingress and the `verify` CLI need to speak the same shapes.
 *
 * The authoritative specification of how these values are hashed is **ADR-006** in
 * `docs/dev/journaling/05-entscheidungen.md`. Read it before changing anything here: the encoding
 * covers every field below, so adding, removing or retyping one invalidates every existing chain
 * and requires a new format version byte.
 */

/**
 * What a ledger row records.
 *
 * The ledger holds **events**, not messages: an accepted SMTP transaction is a `receipt` even when
 * the message it carried is a duplicate of an earlier one. Object deduplication happens against the
 * object store, never by suppressing a receipt.
 *
 * `duplicate_marker` (ADR-037): the row `runPhaseBPipeline()` appends when a `'duplicate'` archive
 * outcome names a genuinely different SMTP transaction's object (not this job's own retry) --
 * `duplicate_of` points at the true original's `seq`, `spool_txid` is always `null`. Kept distinct
 * from `receipt` because a query that counts `receipt` rows against accepted messages (`verify`, E9)
 * must not count this row twice: `packages/backend/src/database/schema/journal-ledger.ts`'s doc
 * comment on `journalEventTypeEnum` has the full history.
 */
export type JournalEventType =
	| 'receipt'
	| 'anchor'
	| 'parse_failed'
	| 'retention_expiry'
	| 'object_erased'
	| 'legal_hold_set'
	| 'duplicate_marker';

/**
 * A JSON value that the canonical encoding is able to serialise deterministically.
 *
 * Deliberately narrower than `unknown`: ADR-006 section 3.3 forbids non-integer numbers, because the
 * number serialisation of RFC 8785 is the only hard part of that standard and dropping floats
 * removes it entirely. Integers outside the safe range belong in a string.
 */
export type CanonicalJsonValue =
	| string
	| number
	| boolean
	| null
	| readonly CanonicalJsonValue[]
	| { readonly [key: string]: CanonicalJsonValue };

/**
 * The value-bearing columns of `journal_ledger`, i.e. exactly what the chain hash covers.
 *
 * **All sixteen are hashed.** RFC section 5.2 lists only eight in its formula and leaves
 * `remoteIp`, `ehloName`, `tlsVersion`, `tlsCipher` and `duplicateOf` out; those would then be
 * editable after the fact without breaking the chain, which would let someone present a message
 * received in the clear as TLS-protected. ADR-006 section 1 closes that.
 *
 * Not present here, and not by omission: `chainHash` is the result itself, and `prevChainHash` is
 * appended to the encoded record rather than encoded as a field.
 */
export interface JournalLedgerRecord {
	/** The chain this row belongs to. `ingestion_sources.id` — one chain per archive (ADR-007). */
	readonly chainScopeId: string;
	/** Gapless and strictly monotonic **per chain**, not globally (`UNIQUE (chain_scope_id, seq)`). */
	readonly seq: bigint;
	/**
	 * Microseconds since the Unix epoch, UTC.
	 *
	 * **Always a multiple of 1000.** `timestamptz` resolves to microseconds while JavaScript's
	 * `Date` resolves to milliseconds, so a value that has passed through a `Date` hashes
	 * differently after a round trip — in roughly one of a thousand cases. ADR-006 section 3.1 keeps
	 * the wire format at microseconds and constrains the written values instead; the encoder rejects
	 * anything else and a `CHECK` constraint backs it up in the database.
	 */
	readonly receivedAtMicros: bigint;
	readonly eventType: JournalEventType;
	/**
	 * Canonical textual form of the peer address, normalised **before** hashing.
	 *
	 * Node reports `::ffff:192.0.2.25` for an IPv4 connection on a dual-stack socket and
	 * `192.0.2.25` for the same peer on an IPv4 listener. See `normalizeRemoteIp()`.
	 */
	readonly remoteIp: string | null;
	readonly ehloName: string | null;
	/** `null` means the session was not encrypted. That distinction is evidence, hence hashed. */
	readonly tlsVersion: string | null;
	readonly tlsCipher: string | null;
	readonly envelopeFrom: string | null;
	/**
	 * Recipients in the order the `RCPT TO` commands arrived — **not** sorted.
	 *
	 * The order is part of the receipt: sorting would destroy what makes a distribution-list
	 * expansion traceable.
	 */
	readonly envelopeRcpt: readonly string[] | null;
	/** `null` for events without an SMTP transaction. `0` would assert a message that never existed. */
	readonly sizeBytes: bigint | null;
	/** SHA-256 over the plaintext wire bytes, before any encryption at rest. */
	readonly contentSha256: Uint8Array | null;
	/** `seq` of the original receipt when this transaction carried a known object. */
	readonly duplicateOf: bigint | null;
	/** Which endpoint sent it — an attribute, not a second chain (ADR-007). */
	readonly journalingSourceId: string | null;
	/** Spool transaction id. Crash recovery matches spool files against the ledger through this. */
	readonly spoolTxId: string | null;
	readonly eventPayload: CanonicalJsonValue | null;
}

/**
 * The head of one chain, as a Merkle leaf takes it.
 *
 * The anchored head is the head **before** the `anchor` event, otherwise the event changes the head
 * it is meant to attest (ADR-022 finding 5).
 */
export interface JournalChainHead {
	readonly chainScopeId: string;
	readonly headSeq: bigint;
	readonly headChainHash: Uint8Array;
}
