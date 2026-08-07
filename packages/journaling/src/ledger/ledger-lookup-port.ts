/**
 * The read-side ledger port the crash-recovery scan needs (`JR-3-05`, RFC section 5.3, skill
 * `journal-ledger` section 3, architecture doc section 5).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this is a separate port from `LedgerBackend`
 * ---------------------------------------------------------------------------------------------
 * `LedgerBackend` (`./ledger-port.ts`) is the write side: one method, `append()`, serialised under an
 * advisory lock, one row per call. A crash-recovery scan needs the opposite shape -- an unordered,
 * lock-free, batched read keyed by `spool_txid` -- and folding that into `LedgerBackend` would give a
 * writer-shaped interface a reader that has nothing to do with serialisation or the chain. Keeping
 * them apart also means a caller that only scans on startup (`apps/smtp-ingress`, the `journal-inbound`
 * worker -- architecture section 5) never has to construct anything append-capable to do it.
 *
 * ---------------------------------------------------------------------------------------------
 * Batched, not one call per file
 * ---------------------------------------------------------------------------------------------
 * The obvious shape is `findBySpoolTxId(id): Promise<... | null>`, called once per spool file. That is
 * wrong at the spool sizes E10 will care about: a scan after an extended outage can find the spool's
 * `incoming/` holding thousands of entries, and a sequential lookup per file turns a bounded number of
 * directory reads into thousands of serial round trips before the process can start accepting mail
 * again. `journal_ledger_spool_txid_idx` (migration `0041_even_scream.sql`) already indexes this
 * column, so a single `WHERE spool_txid = ANY($1)` resolves the whole batch in one round trip and one
 * index scan. {@link LedgerLookup.findBySpoolTxIds} takes the whole batch collected by one scan and
 * answers it in one call; `./ledger-lookup.ts`'s `PostgresLedgerLookup` is the implementation.
 *
 * ---------------------------------------------------------------------------------------------
 * What a scan is allowed to conclude from an absent entry
 * ---------------------------------------------------------------------------------------------
 * Per the skill's crash semantics: a `spool_txid` absent from the returned map means no ledger entry
 * exists for it *right now*, under whatever read consistency the backend gives this call -- it does
 * not by itself justify a delete. The caller (`../spool/crash-recovery.ts`) quarantines instead, and
 * still never deletes.
 */

/** What the scan needs to know about a receipt it found by `spool_txid`. */
export interface LedgerEntryByTxId {
	/** Position in its chain -- not needed to decide requeue-vs-quarantine, but cheap to hand back. */
	readonly seq: bigint;
	/** `ingestion_sources.id` -- the chain this receipt belongs to (ADR-007). */
	readonly chainScopeId: string;
	/** Which endpoint received it, if recorded. Lets the caller build a Phase-B job without a second query. */
	readonly journalingSourceId: string | null;
	/** Canonical textual form (`normalizeRemoteIp()`'s output), as stored. */
	readonly remoteIp: string | null;
	readonly receivedAt: Date;
	/**
	 * Which kind of ledger row this is (`JR-6-02a`).
	 *
	 * Handed back rather than assumed, because "a row exists for this `spool_txid`" and "the **receipt**
	 * for this `spool_txid` exists" are different statements, and Phase B may only archive on the
	 * second. Today only `receipt` rows carry a `spool_txid`, so the two coincide -- but a caller that
	 * reads `has(txid)` as "receipted" encodes that coincidence instead of checking it, and the next
	 * event type to reference a spool entry would silently make it wrong.
	 */
	readonly eventType: string;
	/**
	 * `content_sha256` as stored: 32 raw bytes over the **plaintext wire bytes** (ADR-006,
	 * architecture section 3 step 4), or `null` for a row that records no object.
	 *
	 * This is the value Phase B verifies the spool file against before archiving anything, and the one
	 * `verify` (E9) re-checks against the stored object. Handed back as raw bytes rather than hex so no
	 * encoding decision is made on the read path -- the column is `bytea` with a
	 * `length(content_sha256) = 32` check constraint, and hex-encoding here would invite a comparison
	 * against a differently-cased hex string elsewhere.
	 */
	readonly contentSha256: Uint8Array | null;
	/** `size_bytes` as stored, or `null` for a row that records no object. */
	readonly sizeBytes: bigint | null;
	/**
	 * `envelope_from` as stored (`JR-6-02b`) -- the `MAIL FROM` of the transaction that delivered this
	 * receipt, or `null` for a row that records none. Phase B needs this to pass an
	 * {@link SmtpTransactionEnvelope} to `parseJournalReport()`: without it, the parser's NDR/plain-BCC
	 * classification loses its strongest signal (the null reverse-path) and falls back to a weaker,
	 * content-only heuristic for every message this lookup resolves.
	 */
	readonly envelopeFrom: string | null;
	/**
	 * `envelope_rcpt` as stored, in arrival order, or `null` for a row that records none. Kept as an
	 * array (matching the `text[]` column and {@link SmtpTransactionEnvelope.envelopeRcpt}) rather than
	 * joined into a string -- see that type's doc comment for why arrival order is part of the record.
	 */
	readonly envelopeRcpt: readonly string[] | null;
}

/**
 * The pluggable read side of the ledger, scoped to exactly the query the crash-recovery scan needs.
 *
 * `PostgresLedgerLookup` (`./ledger-lookup.ts`) is the only implementation today. Like
 * `LedgerBackend`, this is deliberately narrow rather than a general query façade -- a second backend
 * (e.g. the WAL variant `LedgerBackend`'s doc comment describes) would implement this the same way it
 * implements `append()`.
 */
export interface LedgerLookup {
	/**
	 * Resolve a batch of spool transaction ids against the ledger in one call.
	 *
	 * The returned map contains an entry only for a `spoolTxId` that has a ledger row -- an id with no
	 * row is simply absent, never mapped to `null` or `undefined`, so `map.has(id)` and `map.get(id)`
	 * agree. An empty `spoolTxIds` input must not perform any I/O (an idle spool must not touch the
	 * database at all).
	 *
	 * **A map keyed by `spoolTxId` assumes at most one row per id, and that assumption is load-bearing**
	 * (ADR-030 already leans on it: "`findBySpoolTxIds()` liefert genau einen Eintrag je `spool_txid`",
	 * which is why a second `RCPT TO` for another chain gets `452 4.5.3` instead of a second receipt).
	 * A second row carrying the same `spool_txid` would not fail here -- it would silently **collapse**,
	 * and the caller would act on whichever row the database happened to return last. `JR-6-03`'s
	 * duplicate marker (see {@link findOriginalReceiptSeq} below) gives its row a `null` `spool_txid`
	 * for exactly this reason -- neither the original's nor the redelivery's own would be safe to reuse.
	 */
	findBySpoolTxIds(
		spoolTxIds: readonly string[]
	): Promise<ReadonlyMap<string, LedgerEntryByTxId>>;

	/**
	 * `JR-6-03`: the `seq` of the **earliest** `receipt` row in `chainScopeId` whose `content_sha256`
	 * equals `contentSha256`, or `null` if none exists.
	 *
	 * ---------------------------------------------------------------------------------------------
	 * Why this is keyed by content, not by `spool_txid`
	 * ---------------------------------------------------------------------------------------------
	 * `archiveObject()` returning `{ kind: 'duplicate' }` tells the pipeline that this owner's object
	 * already exists, but not *which* earlier receipt it came from -- `archivedEmailId` names a
	 * `packages/backend` row this package must not query. What both receipts *do* share, by
	 * construction (RFC section 6.1: the ledger hashes the raw wire bytes, never a transformation of
	 * them), is `content_sha256` -- so resolving "the original" is a lookup by that column, scoped to
	 * the chain so two different customers' byte-identical journal reports never collide.
	 *
	 * ---------------------------------------------------------------------------------------------
	 * Why the earliest, and why that is never the caller's own receipt when it matters
	 * ---------------------------------------------------------------------------------------------
	 * `MIN(seq)` rather than "the other one": a redelivered message's own receipt (written
	 * unconditionally by Phase A, `duplicateOf: null`, before Phase B ever runs -- see
	 * `packages/journaling/src/spool/acceptance.ts`) also carries this `content_sha256`, so a query
	 * that did not take the minimum could return the caller's own row. Taking the minimum resolves the
	 * genuine question ("who received this content first") and, as a side effect, gives the caller its
	 * own disambiguation for free: if the minimum equals the receipt this transaction's own `spool_txid`
	 * already resolved to (`SpoolEntryArchive.seq`), this is not a redelivery at all -- it is the *same*
	 * job being retried after an earlier attempt archived the object but the run never got as far as
	 * writing this marker, and the pipeline must not point `duplicate_of` at itself.
	 *
	 * ---------------------------------------------------------------------------------------------
	 * `event_type = 'receipt'` here means exactly that, by construction (ADR-037)
	 * ---------------------------------------------------------------------------------------------
	 * A third, later delivery of the same content sees at most two candidate rows for "who was first":
	 * the two genuine receipts. Before ADR-037 the marker this method's own caller appends also carried
	 * `event_type = 'receipt'`, so a *second* redelivery's `MIN(seq)` query would have had the first
	 * redelivery's marker in its candidate set too -- harmlessly, since a marker's `seq` is always larger
	 * than the original it points at, so `MIN(seq)` still landed on the true original. ADR-037 gives the
	 * marker its own `event_type` (`duplicate_marker`), so this filter now excludes markers by
	 * construction rather than by that ordering argument -- one fewer thing a reader has to work through
	 * to trust this query.
	 */
	findOriginalReceiptSeq(chainScopeId: string, contentSha256: Uint8Array): Promise<bigint | null>;
}
