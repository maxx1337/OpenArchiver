import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { generateTxId, isValidTxId } from './txid';

/**
 * Transaction ID generation (`JR-3-01`). Classification: `ci`.
 *
 * Three properties matter for the spool: the shape is stable (26 Crockford-Base32 characters, so
 * `isValidTxId()` and the shard/path helpers in `layout.ts` can rely on it), IDs do not collide
 * across a realistic batch, and IDs sort lexically in time order (the reason ULID was chosen over a
 * plain UUID -- see the module doc comment in `txid.ts`).
 */

suite('ci', 'generateTxId()', () => {
	it('produces a 26-character string over the Crockford Base32 alphabet', () => {
		const id = generateTxId();
		expect(id).toHaveLength(26);
		expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	});

	it('never contains I, L, O or U -- excluded from Crockford Base32', () => {
		for (let i = 0; i < 200; i += 1) {
			const id = generateTxId();
			expect(id).not.toMatch(/[ILOU]/);
		}
	});

	it('does not collide across a large batch', () => {
		const ids = new Set<string>();
		for (let i = 0; i < 5000; i += 1) {
			ids.add(generateTxId());
		}
		expect(ids.size).toBe(5000);
	});

	it('is injectable via `now`, and encodes the timestamp in the leading ten characters', () => {
		const early = generateTxId(() => 0);
		const late = generateTxId(() => 2 ** 48 - 1);
		expect(early.slice(0, 10)).toBe('0000000000');
		expect(late.slice(0, 10)).toBe('7ZZZZZZZZZ');
	});

	it('sorts lexically in the same order as the timestamps that produced it', () => {
		const timestamps = [1_000, 1_000_000, 1_700_000_000_000, 1_700_000_000_001];
		const ids = timestamps.map((ms) => generateTxId(() => ms));
		const sorted = [...ids].sort();
		expect(sorted).toEqual(ids);
	});

	it('rejects a timestamp outside the 48-bit range', () => {
		expect(() => generateTxId(() => -1)).toThrow(RangeError);
		expect(() => generateTxId(() => 2 ** 48)).toThrow(RangeError);
		expect(() => generateTxId(() => 1.5)).toThrow(RangeError);
	});
});

suite('ci', 'isValidTxId()', () => {
	it('accepts what generateTxId() produces', () => {
		for (let i = 0; i < 50; i += 1) {
			expect(isValidTxId(generateTxId())).toBe(true);
		}
	});

	it('rejects the wrong length', () => {
		expect(isValidTxId('0'.repeat(25))).toBe(false);
		expect(isValidTxId('0'.repeat(27))).toBe(false);
		expect(isValidTxId('')).toBe(false);
	});

	it('rejects excluded characters and lowercase', () => {
		expect(isValidTxId('I'.repeat(26))).toBe(false);
		expect(isValidTxId('0'.repeat(25) + 'l')).toBe(false);
	});
});
