/**
 * The database port of the ledger (`JR-2-06`, prepares `JR-2-07`).
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
 * half of `JR-2-06`'s acceptance criterion ("computing the hash outside the lock must be impossible by
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
 * The pluggable ledger backend (RFC section 5.4, ADR-011, `JR-2-07`).
 *
 * Variant (a), Postgres with `synchronous_commit = on`, is `PostgresLedgerWriter`. Variant (b), a local
 * WAL, is **not** implemented and is not needed for v1 — but it has to be retrofittable without a
 * signature change, which is what this interface is for. Anything a WAL implementation would need is
 * already here: the request, the returned head, and nothing that names Postgres.
 *
 * ---------------------------------------------------------------------------------------------
 * That retrofittability is measured, not asserted (`JR-2-07`)
 * ---------------------------------------------------------------------------------------------
 * `packages/backend/tests/support/ledger-backend-contract.ts` states the contract below as an
 * executable suite, and it runs twice: against `PostgresLedgerWriter`
 * (`ledger-backend-contract.int.test.ts`) and against a backend with no database at all
 * (`ledger-backend-contract.test.ts`). Both pass, so nothing Postgres-specific has leaked into this
 * port. Had it leaked — a transaction handle, a lock, a `bytea` — the second implementation could not
 * exist, and that is the signal the criterion asks for.
 *
 * The contract asserts only what `append()` **returns**, because `seq`, `prevChainHash` and
 * `chainHash` *are* the chain; where the bytes are put is the implementation's business.
 *
 * ---------------------------------------------------------------------------------------------
 * What a variant (b) implementation owes beyond this signature
 * ---------------------------------------------------------------------------------------------
 * **Satisfying the contract is not sufficient**, and the in-memory backend is the proof: it passes and
 * is durable only for as long as the process lives. Fitting the signature is a statement about
 * signatures. A WAL implementation additionally owes:
 *
 *  1. **`fsync` the record and its containing directory before `append()` resolves.** Both — a file
 *     `fsync` alone does not make the directory entry durable. The resolve of this promise is the
 *     moment `250 OK` becomes permissible, so it must not precede durability.
 *  2. **Serialisation per chain across processes**, not just within one. The Postgres variant gets this
 *     from `pg_advisory_xact_lock`; a WAL needs its own cross-process equivalent, and an in-process
 *     mutex is not one.
 *  3. **No `seq` consumed on failure.** A rejected append must leave the chain exactly as it was; a
 *     gap is a tamper signal (skill `journal-ledger` section 4), so a benign gap destroys the
 *     completeness argument.
 *  4. **A crash-recovery scan** that reconciles a partially written record on startup, and
 *     asynchronous replication into Postgres — the reason variant (b) exists at all is surviving a
 *     database outage, which means the two stores diverge by design and have to converge again.
 *  5. **`verify` (E9) must be able to read it.** A chain that only its writer can walk is not evidence.
 *
 * Whoever implements (b) starts here, and the list is deliberately written as obligations rather than
 * as reassurance: a WAL that satisfies the contract and skips this list would be worse than useless,
 * because it would look correct.
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
