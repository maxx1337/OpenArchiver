/**
 * Worker options for the `journal-inbound` process (`JR-6-01`).
 *
 * Its own module for one reason: importing `./journal-inbound.worker.ts` **constructs** a BullMQ
 * `Worker` and opens a Redis connection as an import side effect, which is right for an entry point
 * and makes the entry point untestable by the `unit` suite. Everything decided from the environment
 * therefore lives here, where a unit test can reach it without a broker -- the same split the repo
 * already applies to `src/database` (a suite that must not touch it, because the import throws).
 */

/** Environment variable that overrides the worker's concurrency. */
export const JOURNAL_INBOUND_CONCURRENCY_VAR = 'JOURNAL_INBOUND_WORKER_CONCURRENCY';

/**
 * Default concurrency: three, not the ingestion worker's five.
 *
 * Each in-flight Phase-B job holds a spooled message plus the parts split out of it.
 * `SMTP_SIZE_LIMIT_BYTES` allows messages considerably larger than a mailbox connector's typical
 * item, so the same concurrency would multiply a larger per-job footprint. Its own variable rather
 * than a shared one because the two workers are sized against different message populations.
 */
export const DEFAULT_JOURNAL_INBOUND_CONCURRENCY = 3;

/**
 * Resolve the concurrency override.
 *
 * Rejects a malformed value instead of falling back to the default. A typo must not silently mean
 * "back to 3": the operator who wrote `JOURNAL_INBOUND_WORKER_CONCURRENCY=12x` believes the worker is
 * running twelve jobs wide, and nothing in the logs would contradict them. `parseInt` would read that
 * as 12 and `"abc"` as `NaN`, which BullMQ then treats as its own default. The harness makes the same
 * argument for `OA_TEST_REQUIRE_INFRA` in `tests/support/classification.ts`, in the same words.
 *
 * An empty or whitespace-only value is treated as unset -- that is what an exported-but-empty shell
 * variable looks like, and it is not a typo.
 */
export function resolveJournalInboundConcurrency(raw: string | undefined): number {
	if (raw === undefined || raw.trim() === '') {
		return DEFAULT_JOURNAL_INBOUND_CONCURRENCY;
	}
	const value = Number(raw.trim());
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(
			`${JOURNAL_INBOUND_CONCURRENCY_VAR} must be a positive integer, got ${JSON.stringify(raw)}. ` +
				`Unset it to use the default of ${DEFAULT_JOURNAL_INBOUND_CONCURRENCY}.`
		);
	}
	return value;
}

/**
 * `lockDuration`, and the reason it is ten minutes rather than BullMQ's 30 seconds.
 *
 * A journal report is a MIME envelope around a whole message; parsing it and hashing a large
 * attachment are largely synchronous, and one 50 MB message can hold the event loop long enough that
 * the automatic lock renewal (every `lockDuration / 2`) misses its window. BullMQ then declares the
 * still-running job stalled and hands out a second invocation. This is the same reasoning the
 * ingestion worker documents, and the same number.
 */
export const JOURNAL_INBOUND_LOCK_DURATION_MS = 10 * 60 * 1000;

/**
 * `maxStalledCount: 0` -- the load-bearing parameter, and it carries more weight here than in
 * ingestion.
 *
 * A concurrent double-run of the same Phase-B job races the object dedup on `content_sha256`
 * (`JR-6-03`): both invocations can find no existing object and both store one. Worse, both would go
 * on to record Phase-B completion for a single receipt, and the ledger is append-only -- a wrong entry
 * cannot be corrected, only annotated.
 *
 * Turning any residual stall into a **failed** job is strictly safer, because failure has a recovery
 * path that a double-run does not: the spool entry stays authoritative, and the reconciler (`JR-6-04`)
 * re-enqueues it under a deterministic job id into a queue where nothing else holds it.
 */
export const JOURNAL_INBOUND_MAX_STALLED_COUNT = 0;
