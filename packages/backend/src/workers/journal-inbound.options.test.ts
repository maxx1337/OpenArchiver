import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	DEFAULT_JOURNAL_INBOUND_CONCURRENCY,
	DEFAULT_JOURNAL_RECONCILE_INTERVAL_MS,
	JOURNAL_INBOUND_LOCK_DURATION_MS,
	JOURNAL_INBOUND_MAX_STALLED_COUNT,
	JOURNAL_RECONCILE_INTERVAL_VAR,
	JOURNAL_SPOOL_ROOT_VAR,
	resolveJournalInboundConcurrency,
	resolveJournalReconcileIntervalMs,
	resolveJournalSpoolRoot,
} from './journal-inbound.options';

/**
 * Worker options for `journal-inbound` (`JR-6-01`). Classification: `ci`.
 *
 * Two things are asserted here, and the second is the reason this file exists at all.
 *
 * **The override is validated, not coerced.** A worker that silently runs at its default while its
 * operator believes they raised it is a defect that produces no error and no log line. Every rejected
 * form below is one a real `docker-compose.yml` or shell export can produce.
 *
 * **`maxStalledCount` is pinned to 0.** It is the one parameter whose value the correctness of
 * `JR-6-03` depends on: a stall-induced second invocation of the same job races the `content_sha256`
 * object dedup against an append-only ledger. It is asserted here rather than trusted to a comment,
 * because the failure mode of "someone raised it to make a flaky job retry" is a silent duplicate,
 * not a red test. The same reasoning applies to `lockDuration`: the number is what makes long
 * synchronous MIME parsing survive lock renewal, so a drop back towards BullMQ's 30s default should
 * cost a deliberate edit here.
 *
 * `journal-inbound.worker.ts` itself is not imported by any unit test -- importing it constructs a
 * BullMQ `Worker` and opens a Redis connection. That the process actually starts, and refuses to
 * report a job as archived before `JR-6-02`, is measured in
 * `tests/integration/journal-inbound-worker.int.test.ts`.
 */

suite('ci', 'resolveJournalInboundConcurrency()', () => {
	it('defaults to 3 when the variable is unset', () => {
		expect(resolveJournalInboundConcurrency(undefined)).toBe(
			DEFAULT_JOURNAL_INBOUND_CONCURRENCY
		);
		expect(DEFAULT_JOURNAL_INBOUND_CONCURRENCY).toBe(3);
	});

	it.each([
		['empty string', ''],
		['whitespace only', '   '],
	])('treats %s as unset -- an exported-but-empty variable is not a typo', (_label, raw) => {
		expect(resolveJournalInboundConcurrency(raw)).toBe(DEFAULT_JOURNAL_INBOUND_CONCURRENCY);
	});

	it.each([
		['1', 1],
		['12', 12],
		['  8  ', 8],
	])('accepts a positive integer (%s)', (raw, expected) => {
		expect(resolveJournalInboundConcurrency(raw)).toBe(expected);
	});

	it.each([
		['a trailing typo that parseInt would accept', '12x'],
		['non-numeric', 'abc'],
		['zero -- a worker that processes nothing is never what was meant', '0'],
		['negative', '-4'],
		['fractional', '2.5'],
		['a shell expression that never expanded', '${CONCURRENCY}'],
	])('rejects %s rather than falling back to the default', (_label, raw) => {
		expect(() => resolveJournalInboundConcurrency(raw)).toThrow(/must be a positive integer/);
	});

	it('names the variable and the default in the error, so the message is actionable', () => {
		expect(() => resolveJournalInboundConcurrency('12x')).toThrow(
			/JOURNAL_INBOUND_WORKER_CONCURRENCY/
		);
		expect(() => resolveJournalInboundConcurrency('12x')).toThrow(/default of 3/);
	});
});

suite('ci', 'journal-inbound queue parameters', () => {
	it('pins maxStalledCount to 0 -- a stalled double-run races the JR-6-03 dedup', () => {
		expect(JOURNAL_INBOUND_MAX_STALLED_COUNT).toBe(0);
	});

	it('pins lockDuration to ten minutes, well above BullMQ 30s default', () => {
		expect(JOURNAL_INBOUND_LOCK_DURATION_MS).toBe(600_000);
	});
});

suite('ci', 'resolveJournalSpoolRoot() (JR-6-02b)', () => {
	it('returns the trimmed path when set', () => {
		expect(resolveJournalSpoolRoot('/var/lib/oa-journal-spool')).toBe(
			'/var/lib/oa-journal-spool'
		);
		expect(resolveJournalSpoolRoot('  /var/lib/oa-journal-spool  ')).toBe(
			'/var/lib/oa-journal-spool'
		);
	});

	it.each([
		['unset', undefined],
		['empty string', ''],
		['whitespace only', '   '],
	])(
		'throws rather than defaulting when %s -- a guessed spool path is worse than a startup failure',
		(_label, raw) => {
			expect(() => resolveJournalSpoolRoot(raw)).toThrow(new RegExp(JOURNAL_SPOOL_ROOT_VAR));
		}
	);

	it('names the same variable apps/smtp-ingress reads, not a second one', () => {
		// The two processes share one physical spool directory; a second, differently-named variable
		// would let them silently drift apart the way F46 already cost this project once.
		expect(JOURNAL_SPOOL_ROOT_VAR).toBe('SMTP_INGRESS_SPOOL_ROOT_PATH');
	});
});

suite('ci', 'resolveJournalReconcileIntervalMs() (JR-6-04)', () => {
	it('defaults to five minutes when the variable is unset', () => {
		expect(resolveJournalReconcileIntervalMs(undefined)).toBe(
			DEFAULT_JOURNAL_RECONCILE_INTERVAL_MS
		);
		expect(DEFAULT_JOURNAL_RECONCILE_INTERVAL_MS).toBe(300_000);
	});

	it.each([
		['empty string', ''],
		['whitespace only', '   '],
	])('treats %s as unset -- an exported-but-empty variable is not a typo', (_label, raw) => {
		expect(resolveJournalReconcileIntervalMs(raw)).toBe(DEFAULT_JOURNAL_RECONCILE_INTERVAL_MS);
	});

	it.each([
		['1', 1],
		['60000', 60000],
		['  120000  ', 120000],
	])('accepts a positive integer (%s)', (raw, expected) => {
		expect(resolveJournalReconcileIntervalMs(raw)).toBe(expected);
	});

	it.each([
		['non-numeric', 'abc'],
		['zero -- a sweep that never runs is never what was meant', '0'],
		['negative', '-1'],
		['fractional', '2.5'],
	])('rejects %s rather than falling back to the default', (_label, raw) => {
		expect(() => resolveJournalReconcileIntervalMs(raw)).toThrow(/must be a positive integer/);
	});

	it('names the variable and the default in the error, so the message is actionable', () => {
		expect(() => resolveJournalReconcileIntervalMs('abc')).toThrow(
			new RegExp(JOURNAL_RECONCILE_INTERVAL_VAR)
		);
		expect(() => resolveJournalReconcileIntervalMs('abc')).toThrow(/default of 300000/);
	});
});
