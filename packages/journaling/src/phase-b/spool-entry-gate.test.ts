import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import type { LedgerEntryByTxId } from '../ledger/ledger-lookup-port';
import {
	classifySpoolEntry,
	mayArchive,
	type MeasuredSpoolEntry,
	type SpoolEntryVerdict,
} from './spool-entry-gate';

/**
 * The Phase-B gate (`JR-6-02a`). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * What is actually being tested
 * ---------------------------------------------------------------------------------------------
 * Not "does the function return the right string". The gate decides whether bytes on disk may be
 * recorded as the receipted message, and the assertion that matters is the **negative** one: for every
 * input that is not a verified receipt, `mayArchive()` must be `false`. A test suite that only checked
 * the happy path would pass against a function that returned `archive` unconditionally -- so every case
 * below asserts `mayArchive()` explicitly, including the ones where the interesting part is which
 * verdict came back.
 *
 * The last suite is the counter-check that gives the rest teeth: a deliberately broken gate that
 * archives whenever a row exists passes every positive assertion here and fails the negative ones. If
 * these tests could be satisfied by that function, they would be measuring nothing.
 */

const CONTENT = Buffer.from('Return-Path: <a@example.com>\r\n\r\nbody\r\n', 'utf8');
const CONTENT_HEX = createHash('sha256').update(CONTENT).digest('hex');
const CONTENT_BYTES = new Uint8Array(Buffer.from(CONTENT_HEX, 'hex'));

const MEASURED: MeasuredSpoolEntry = { sha256Hex: CONTENT_HEX, sizeBytes: CONTENT.length };

function receipt(overrides: Partial<LedgerEntryByTxId> = {}): LedgerEntryByTxId {
	return {
		seq: 42n,
		chainScopeId: '11111111-1111-4111-8111-111111111111',
		journalingSourceId: '22222222-2222-4222-8222-222222222222',
		remoteIp: '203.0.113.7',
		receivedAt: new Date('2026-08-05T09:00:00.000Z'),
		eventType: 'receipt',
		contentSha256: CONTENT_BYTES,
		sizeBytes: BigInt(CONTENT.length),
		envelopeFrom: 'sender@example.com',
		envelopeRcpt: ['journal@example.com'],
		...overrides,
	};
}

suite('ci', 'classifySpoolEntry(): the one case that may archive', () => {
	it('archives when a receipt exists and the bytes hash to its content_sha256', () => {
		const verdict = classifySpoolEntry(receipt(), MEASURED);
		expect(verdict.kind).toBe('archive');
		expect(mayArchive(verdict)).toBe(true);
	});

	it('hands back the receipt fields the caller would otherwise re-derive', () => {
		const verdict = classifySpoolEntry(receipt(), MEASURED);
		if (!mayArchive(verdict)) {
			throw new Error(`expected an archive verdict, got ${verdict.kind}`);
		}
		expect(verdict.seq).toBe(42n);
		expect(verdict.chainScopeId).toBe('11111111-1111-4111-8111-111111111111');
		expect(verdict.journalingSourceId).toBe('22222222-2222-4222-8222-222222222222');
		expect(verdict.receivedAt.toISOString()).toBe('2026-08-05T09:00:00.000Z');
		expect(verdict.contentSha256Hex).toBe(CONTENT_HEX);
		expect(verdict.sizeBytes).toBe(CONTENT.length);
		// JR-6-02b: forwarded verbatim so the Phase-B pipeline can build an SmtpTransactionEnvelope
		// without a second ledger lookup.
		expect(verdict.envelopeFrom).toBe('sender@example.com');
		expect(verdict.envelopeRcpt).toEqual(['journal@example.com']);
	});

	it('emits lower-case hex, so a comparison cannot fail on casing alone', () => {
		const verdict = classifySpoolEntry(receipt(), MEASURED);
		if (!mayArchive(verdict)) {
			throw new Error('expected an archive verdict');
		}
		expect(verdict.contentSha256Hex).toBe(verdict.contentSha256Hex.toLowerCase());
		expect(verdict.contentSha256Hex).toMatch(/^[0-9a-f]{64}$/);
	});

	it('archives even when the receipt records no size -- the hash has already decided', () => {
		// A receipt whose own two fields disagree is a ledger-integrity question for `verify` (E9). It
		// must not make an accepted message unarchivable: the bytes are provably the receipted ones.
		const verdict = classifySpoolEntry(receipt({ sizeBytes: null }), MEASURED);
		expect(mayArchive(verdict)).toBe(true);
	});

	it('archives when the receipt size disagrees with the measured size but the hash matches', () => {
		const verdict = classifySpoolEntry(receipt({ sizeBytes: 999_999n }), MEASURED);
		expect(mayArchive(verdict)).toBe(true);
	});
});

suite('ci', 'classifySpoolEntry(): every case that must not archive', () => {
	it('no_receipt -- an absent ledger row means the message was never acknowledged', () => {
		const verdict = classifySpoolEntry(undefined, MEASURED);
		expect(verdict.kind).toBe('no_receipt');
		expect(mayArchive(verdict)).toBe(false);
	});

	it('no_receipt takes `undefined`, which is what Map.get() yields', () => {
		const lookup = new Map<string, LedgerEntryByTxId>();
		// Passed straight through, unnormalised -- the port hands back a Map and the caller must not have
		// to convert `undefined` to `null` (and risk converting it wrongly).
		const verdict = classifySpoolEntry(lookup.get('01JQZX0000000000000000000A'), MEASURED);
		expect(verdict.kind).toBe('no_receipt');
	});

	it.each([
		['anchor'],
		['parse_failed'],
		['retention_expiry'],
		['object_erased'],
		['legal_hold_set'],
	])('not_a_receipt -- a %s row is not the receipt this file belongs to', (eventType) => {
		const verdict = classifySpoolEntry(receipt({ eventType }), MEASURED);
		expect(verdict.kind).toBe('not_a_receipt');
		expect(mayArchive(verdict)).toBe(false);
		if (verdict.kind === 'not_a_receipt') {
			expect(verdict.eventType).toBe(eventType);
		}
	});

	it('receipt_without_hash is its own verdict, not a mismatch', () => {
		// Reported separately on purpose: calling this a hash mismatch would send an operator looking
		// for tampering when the actual fault is a writer that omitted a required field.
		const verdict = classifySpoolEntry(receipt({ contentSha256: null }), MEASURED);
		expect(verdict.kind).toBe('receipt_without_hash');
		expect(mayArchive(verdict)).toBe(false);
		if (verdict.kind === 'receipt_without_hash') {
			expect(verdict.seq).toBe(42n);
		}
	});

	it('content_mismatch -- one flipped byte in the file is enough', () => {
		const tampered = Buffer.from(CONTENT);
		tampered[tampered.length - 2] = tampered[tampered.length - 2]! ^ 0x01;
		const verdict = classifySpoolEntry(receipt(), {
			sha256Hex: createHash('sha256').update(tampered).digest('hex'),
			sizeBytes: tampered.length,
		});
		expect(verdict.kind).toBe('content_mismatch');
		expect(mayArchive(verdict)).toBe(false);
	});

	it('content_mismatch reports both hashes and both sizes, so the report is actionable', () => {
		const verdict = classifySpoolEntry(receipt(), { sha256Hex: 'a'.repeat(64), sizeBytes: 7 });
		if (verdict.kind !== 'content_mismatch') {
			throw new Error(`expected content_mismatch, got ${verdict.kind}`);
		}
		expect(verdict.expectedSha256Hex).toBe(CONTENT_HEX);
		expect(verdict.actualSha256Hex).toBe('a'.repeat(64));
		expect(verdict.expectedSizeBytes).toBe(BigInt(CONTENT.length));
		expect(verdict.actualSizeBytes).toBe(7);
		expect(verdict.seq).toBe(42n);
	});

	it('content_mismatch for a truncated file -- the empty-file case', () => {
		const verdict = classifySpoolEntry(receipt(), {
			sha256Hex: createHash('sha256').update(Buffer.alloc(0)).digest('hex'),
			sizeBytes: 0,
		});
		expect(verdict.kind).toBe('content_mismatch');
		expect(mayArchive(verdict)).toBe(false);
	});

	it('every non-archive verdict carries a reason that names what to do about it', () => {
		const verdicts: SpoolEntryVerdict[] = [
			classifySpoolEntry(undefined, MEASURED),
			classifySpoolEntry(receipt({ eventType: 'anchor' }), MEASURED),
			classifySpoolEntry(receipt({ contentSha256: null }), MEASURED),
			classifySpoolEntry(receipt(), { sha256Hex: 'b'.repeat(64), sizeBytes: 1 }),
		];
		for (const verdict of verdicts) {
			expect(mayArchive(verdict)).toBe(false);
			// A `reason` exists on every non-archive member of the union; the type says so, and this
			// checks it is not an empty string that satisfies the type while telling nobody anything.
			const reason = (verdict as { reason?: string }).reason ?? '';
			expect(reason.length).toBeGreaterThan(40);
		}
	});
});

suite('ci', 'classifySpoolEntry(): the counter-check that these tests have teeth', () => {
	/**
	 * A plausible wrong gate: "a ledger row exists for this txid, so the message was accepted, so
	 * archive it." It is the shortcut `runCrashRecoveryScan()`'s own doc comment warns against, and it
	 * would pass every positive assertion in this file.
	 */
	function brokenGate(entry: LedgerEntryByTxId | undefined): boolean {
		return entry !== undefined;
	}

	it('the broken gate agrees on the happy path -- which is why the happy path proves little', () => {
		expect(brokenGate(receipt())).toBe(true);
		expect(mayArchive(classifySpoolEntry(receipt(), MEASURED))).toBe(true);
	});

	it('and disagrees on exactly the three cases that matter', () => {
		const tamperedMeasurement: MeasuredSpoolEntry = { sha256Hex: 'c'.repeat(64), sizeBytes: 3 };
		const cases: Array<[string, LedgerEntryByTxId, MeasuredSpoolEntry]> = [
			['tampered bytes', receipt(), tamperedMeasurement],
			['not a receipt', receipt({ eventType: 'object_erased' }), MEASURED],
			['receipt without a hash', receipt({ contentSha256: null }), MEASURED],
		];
		for (const [label, entry, measured] of cases) {
			expect(brokenGate(entry), `broken gate on "${label}"`).toBe(true);
			expect(mayArchive(classifySpoolEntry(entry, measured)), `real gate on "${label}"`).toBe(
				false
			);
		}
	});
});
