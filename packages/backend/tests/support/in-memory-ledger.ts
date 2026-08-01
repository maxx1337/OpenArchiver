import {
	chainHash,
	genesisChainHash,
	type LedgerAppendRequest,
	type LedgerAppendResult,
	type LedgerBackend,
} from '@open-archiver/journaling';
import type { CanonicalJsonValue, JournalLedgerRecord } from '@open-archiver/types';

/**
 * A second `LedgerBackend` that is not Postgres (`JR-2-07`).
 *
 * ---------------------------------------------------------------------------------------------
 * What this is for, and what it is not
 * ---------------------------------------------------------------------------------------------
 * `JR-2-07`'s acceptance criterion is that variant (b) of RFC section 5.4 — an append-only local WAL —
 * is retrofittable **without a signature change**. That is a claim about the `LedgerBackend` port, and
 * a claim of that shape is worth exactly as much as the evidence behind it. A comment asserting
 * "the interface is general enough" is not evidence; a second implementation that satisfies the same
 * contract is.
 *
 * So this exists to be run against `ledger-backend-contract.ts`, the same suite that runs against
 * `PostgresLedgerWriter`. If the port had leaked anything Postgres-specific — a transaction handle, an
 * advisory lock, a `bytea` — this file could not implement it, and that failure is the signal the task
 * is asking for.
 *
 * **It deliberately lives under `tests/support/` and must never move to `src/`.** An in-memory ledger
 * is durable for exactly as long as the process lives, and a compliance receiver whose ledger can be
 * configured to forget is worse than one with no ledger at all — the acceptance contract behind
 * `250 OK` would be a lie. Keeping it in the test tree means no configuration can select it.
 *
 * **It does not demonstrate durability**, and that limit is the honest half of the finding: the port
 * being sufficient is a statement about *signatures*. What a real variant (b) additionally owes —
 * `fsync` on the record and its directory before returning, a crash-recovery scan, replication into
 * Postgres — is written down in `ledger-port.ts`, because a future implementer needs the list, not
 * the reassurance.
 */

interface StoredEntry {
	readonly record: JournalLedgerRecord;
	readonly prevChainHash: Buffer;
	readonly chainHash: Buffer;
}

export interface InMemoryLedgerOptions {
	readonly deploymentId: string;
	/**
	 * Milliseconds of artificial latency between reading the head and appending.
	 *
	 * Not decoration: without an `await` between those two steps, a single-threaded runtime serialises
	 * the appends by accident and the contract's concurrency case would pass against a backend that
	 * has no mutex at all — a test that cannot fail. The delay opens the window the lock has to close.
	 * `ledger-backend-contract.test.ts` proves the window is real by running the same case against a
	 * deliberately unsynchronised variant and showing it break.
	 */
	readonly latencyMs?: number;
}

export class InMemoryLedgerBackend implements LedgerBackend {
	private readonly deploymentId: string;
	private readonly latencyMs: number;
	private readonly chains = new Map<string, StoredEntry[]>();
	/** One promise chain per ledger chain: the in-memory equivalent of `pg_advisory_xact_lock`. */
	private readonly locks = new Map<string, Promise<unknown>>();

	constructor(options: InMemoryLedgerOptions) {
		this.deploymentId = options.deploymentId;
		this.latencyMs = options.latencyMs ?? 1;
	}

	async append(request: LedgerAppendRequest): Promise<LedgerAppendResult> {
		return this.withChainLock(request.chainScopeId, async () => {
			const entries = this.chains.get(request.chainScopeId) ?? [];
			const head = entries[entries.length - 1];

			// The window a real backend closes with a transactional lock.
			await delay(this.latencyMs);

			const seq = head === undefined ? 1n : head.record.seq + 1n;
			const prevChainHash =
				head === undefined
					? genesisChainHash(this.deploymentId, request.chainScopeId)
					: head.chainHash;

			const record = buildRecord(request, seq);
			const computed = chainHash(record, prevChainHash);

			entries.push({ record, prevChainHash, chainHash: computed });
			this.chains.set(request.chainScopeId, entries);

			return { seq, chainHash: computed, prevChainHash };
		});
	}

	/** Everything stored for one chain, in append order. Test-only inspection. */
	entries(chainScopeId: string): readonly StoredEntry[] {
		return this.chains.get(chainScopeId) ?? [];
	}

	private async withChainLock<T>(chainScopeId: string, run: () => Promise<T>): Promise<T> {
		const previous = this.locks.get(chainScopeId) ?? Promise.resolve();
		// Chained on the settled outcome, so one rejected append does not wedge the chain — the same
		// property `pg_advisory_xact_lock` gives by releasing on abort.
		const mine = previous.then(run, run);
		this.locks.set(
			chainScopeId,
			mine.catch(() => undefined)
		);
		return mine;
	}
}

/**
 * The same backend without the lock, to show that the contract's concurrency case has teeth.
 *
 * If this passed the contract, the concurrency assertion would be proving nothing about
 * `PostgresLedgerWriter` either.
 */
export class UnsynchronisedInMemoryLedgerBackend implements LedgerBackend {
	private readonly deploymentId: string;
	private readonly latencyMs: number;
	private readonly chains = new Map<string, StoredEntry[]>();

	constructor(options: InMemoryLedgerOptions) {
		this.deploymentId = options.deploymentId;
		this.latencyMs = options.latencyMs ?? 1;
	}

	async append(request: LedgerAppendRequest): Promise<LedgerAppendResult> {
		const entries = this.chains.get(request.chainScopeId) ?? [];
		const head = entries[entries.length - 1];
		await delay(this.latencyMs);
		const seq = head === undefined ? 1n : head.record.seq + 1n;
		const prevChainHash =
			head === undefined
				? genesisChainHash(this.deploymentId, request.chainScopeId)
				: head.chainHash;
		const record = buildRecord(request, seq);
		const computed = chainHash(record, prevChainHash);
		entries.push({ record, prevChainHash, chainHash: computed });
		this.chains.set(request.chainScopeId, entries);
		return { seq, chainHash: computed, prevChainHash };
	}
}

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

/**
 * Assemble the record the encoding hashes.
 *
 * Written out again rather than shared with `PostgresLedgerWriter`, whose version is private: an
 * independent implementation is the point of the exercise. If the two ever disagree, the contract
 * suite's "the returned hash is reproducible from the request" case fails for one of them.
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
