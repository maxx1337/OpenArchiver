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
	 */
	findBySpoolTxIds(
		spoolTxIds: readonly string[]
	): Promise<ReadonlyMap<string, LedgerEntryByTxId>>;
}
