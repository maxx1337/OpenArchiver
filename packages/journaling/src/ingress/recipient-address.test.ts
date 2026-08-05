import { describe, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { normalizeJournalRecipient } from './recipient-address';

/**
 * `JR-4-05b` -- `normalizeJournalRecipient`'s comparison rules in isolation. See the module's own
 * doc comment for the reasoning behind each decision; this file is the evidence that the reasoning
 * actually holds for the concrete inputs it discusses (`postmaster`, a comment inside the angle
 * brackets, mixed case in both the local part and the domain, an empty address).
 */
suite('ci', 'normalizeJournalRecipient (JR-4-05b)', () => {
	describe('normalizeJournalRecipient', () => {
		it('lower-cases the domain part', () => {
			expect(normalizeJournalRecipient('journal-abc@Journaling.Example.Com')).toBe(
				'journal-abc@journaling.example.com'
			);
		});

		it('lower-cases the local part too -- a deliberate deviation from RFC 5321 section 2.4, see the module doc comment', () => {
			expect(normalizeJournalRecipient('Journal-ABC@journaling.example.com')).toBe(
				'journal-abc@journaling.example.com'
			);
		});

		it('trims surrounding whitespace', () => {
			expect(normalizeJournalRecipient('  journal-abc@journaling.example.com  ')).toBe(
				'journal-abc@journaling.example.com'
			);
		});

		it('normalizes an empty address to the empty string, never a wildcard', () => {
			expect(normalizeJournalRecipient('')).toBe('');
			expect(normalizeJournalRecipient('   ')).toBe('');
		});

		it('does not special-case postmaster -- it folds like any other address and must still match a configured entry', () => {
			expect(normalizeJournalRecipient('Postmaster')).toBe('postmaster');
			expect(normalizeJournalRecipient('POSTMASTER')).toBe('postmaster');
		});

		it('does not strip a parenthesised comment inside the angle brackets -- it is compared verbatim (case-folded) and so fails to match anything configured', () => {
			expect(normalizeJournalRecipient('journal-abc@journaling.example.com (comment)')).toBe(
				'journal-abc@journaling.example.com (comment)'
			);
		});

		it('is idempotent', () => {
			const once = normalizeJournalRecipient('Journal-ABC@Journaling.Example.Com');
			expect(normalizeJournalRecipient(once)).toBe(once);
		});
	});
});
