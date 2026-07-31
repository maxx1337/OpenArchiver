/**
 * The database port of the ledger (`JR-206`, prepares `JR-207`).
 *
 * `packages/journaling` must not depend on `packages/backend` (see
 * `docs/dev/journaling/02-architektur.md` section 2): several `config/*` modules there throw at import
 * time, and `src/database/index.ts` is a module singleton over `DATABASE_URL`. So the connection is
 * **injected** through the narrow interface below rather than imported, and the ingress process
 * inherits neither the credentials nor the crashes of subsystems it does not use.
 *
 * The interface is deliberately thin — parameterised SQL and a transaction boundary, nothing else.
 * That is what makes variant (b) of RFC section 5.4 (an append-only local WAL, fsync'd, replicated
 * into Postgres asynchronously) implementable later without changing a single caller: `LedgerBackend`
 * is the seam, `PostgresLedgerWriter` is one implementation of it.
 */

/** One statement inside a transaction. Parameterised — never string interpolation. */
export interface LedgerQuery {
	/**
	 * `text` uses `$1`-style placeholders; `values` are bound by the driver.
	 *
	 * `Uint8Array` values are `bytea`, `bigint` values are `bigint`. The adapter in
	 * `packages/backend` maps them; this package never sees a driver type.
	 */
	query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<Row[]>;
}

/**
 * A transaction boundary.
 *
 * The callback runs inside `BEGIN`/`COMMIT`; throwing rolls back. This shape is the reason a caller
 * cannot hold a lock across two transactions or compute anything after the commit — there is no
 * handle to the transaction outside the callback.
 */
export interface LedgerTransactor {
	transaction<T>(run: (tx: LedgerQuery) => Promise<T>): Promise<T>;
}

/**
 * What the caller of `append()` knows about the event.
 *
 * **Look at what is absent: `seq`, `prevChainHash` and `chainHash`.** That absence is the structural
 * half of `JR-206`'s acceptance criterion ("computing the hash outside the lock must be impossible by
 * construction, not by comment"). Those three values are *outputs*: `seq` and `prevChainHash` are only
 * knowable while the chain's lock is held, and `chainHash` is derived from them. A caller cannot
 * pre-compute the chain hash because it cannot obtain two of its inputs, and it cannot pass a
 * pre-computed one because the type has nowhere to put it.
 */
export interface LedgerAppendRequest {
	/** `ingestion_sources.id` — one chain per archive (ADR-007). */
	readonly chainScopeId: string;
	/** Microseconds since the epoch, UTC, always a whole millisecond (ADR-006 section 3.1). */
	readonly receivedAtMicros: bigint;
	readonly eventType:
		| 'receipt'
		| 'anchor'
		| 'parse_failed'
		| 'retention_expiry'
		| 'object_erased'
		| 'legal_hold_set';
	/** Canonical textual form; run it through `normalizeRemoteIp()` first. */
	readonly remoteIp: string | null;
	readonly ehloName: string | null;
	readonly tlsVersion: string | null;
	readonly tlsCipher: string | null;
	readonly envelopeFrom: string | null;
	/** Arrival order, never sorted. */
	readonly envelopeRcpt: readonly string[] | null;
	readonly sizeBytes: bigint | null;
	readonly contentSha256: Uint8Array | null;
	/** `seq` of the original receipt, if this transaction carried a known object. */
	readonly duplicateOf: bigint | null;
	readonly journalingSourceId: string | null;
	readonly spoolTxId: string | null;
	readonly eventPayload: Record<string, unknown> | null;
}

/** What the caller gets back. `seq` goes into the `250 2.0.0 Ok: queued as <seq>` reply. */
export interface LedgerAppendResult {
	readonly seq: bigint;
	readonly chainHash: Uint8Array;
	readonly prevChainHash: Uint8Array;
}

/**
 * The pluggable ledger backend (RFC section 5.4, ADR-011).
 *
 * Variant (a), Postgres with `synchronous_commit = on`, is `PostgresLedgerWriter`. Variant (b), a local
 * WAL, is **not** implemented and is not needed for v1 — but it has to be retrofittable without a
 * signature change, which is what this interface is for. Anything a WAL implementation would need is
 * already here: the request, the returned head, and nothing that names Postgres.
 */
export interface LedgerBackend {
	/**
	 * Append one event and return its position in the chain.
	 *
	 * Contract: when this resolves, the entry is **durable**. Nothing after it may influence whether
	 * the message is acknowledged (skill `journal-ledger` section 2). When it rejects, no entry was
	 * written and no `seq` was consumed.
	 */
	append(request: LedgerAppendRequest): Promise<LedgerAppendResult>;
}
