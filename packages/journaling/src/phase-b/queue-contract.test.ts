import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { generateTxId } from '../spool/txid';
import {
	JOURNAL_INBOUND_JOB_NAME,
	JOURNAL_INBOUND_QUEUE_NAME,
	journalInboundJobId,
	type JournalInboundJobData,
} from './queue-contract';

/**
 * The Phase-B queue contract (`JR-6-01`). Classification: `ci`.
 *
 * What is worth asserting about a module of constants is not the constants -- it is the two
 * properties other code is allowed to rely on:
 *
 *   1. **The job id is a pure function of the txid**, because that is what makes the two enqueue
 *      paths (ingress after `250`, reconciler in `JR-6-04`) idempotent against each other.
 *   2. **A malformed txid is rejected rather than encoded**, because a job id is a Redis uniqueness
 *      key: a colliding id makes BullMQ *drop* the enqueue silently instead of failing it, and a
 *      dropped Phase-B hint looks exactly like a healthy queue.
 *
 * The names themselves are pinned as literals on purpose. They are a wire contract between two
 * processes that ship separately; asserting `queueName === queueName` would be circular, so the
 * expected value is written out. If a rename is intended, this test is the place that says so.
 */

suite('ci', 'Phase-B queue contract names', () => {
	it('pins the queue name the worker and the ingress both bind to', () => {
		expect(JOURNAL_INBOUND_QUEUE_NAME).toBe('journal-inbound');
	});

	it('pins the job name the worker dispatches on', () => {
		expect(JOURNAL_INBOUND_JOB_NAME).toBe('process-spool-entry');
	});

	it('describes a payload of exactly one field', () => {
		// The payload width is a design commitment (Redis is an optimisation, not an authority), so it
		// is asserted structurally rather than left to the doc comment. A second field added here
		// without a decision breaks this line.
		const data: JournalInboundJobData = { spoolTxId: generateTxId() };
		expect(Object.keys(data)).toEqual(['spoolTxId']);
	});
});

suite('ci', 'journalInboundJobId()', () => {
	it('is deterministic -- the same txid always yields the same id', () => {
		const txid = generateTxId();
		expect(journalInboundJobId(txid)).toBe(journalInboundJobId(txid));
	});

	it('maps distinct txids to distinct ids across a large batch', () => {
		const ids = new Set<string>();
		for (let i = 0; i < 2000; i += 1) {
			ids.add(journalInboundJobId(generateTxId()));
		}
		expect(ids.size).toBe(2000);
	});

	it('prefixes the queue name and embeds the txid verbatim', () => {
		const txid = generateTxId();
		expect(journalInboundJobId(txid)).toBe(`journal-inbound:${txid}`);
	});

	it.each([
		['empty', ''],
		['lowercase (outside the Crockford alphabet as generated)', generateTxId().toLowerCase()],
		['too short', generateTxId().slice(0, 25)],
		['too long', `${generateTxId()}0`],
		['contains the separator', `${generateTxId().slice(0, 20)}:12345`],
		['contains an excluded Crockford letter', `${generateTxId().slice(0, 25)}I`],
		['a whole path rather than an id', `incoming/ab/${generateTxId()}.eml`],
	])('rejects a malformed txid (%s) instead of encoding it', (_label, candidate) => {
		expect(() => journalInboundJobId(candidate)).toThrow(RangeError);
	});
});
