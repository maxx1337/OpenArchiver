import { describe, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import type { OrganizationDomainGroup, OwnerResolutionEnvelope } from '@open-archiver/types';
import { resolveOwner } from './owner-resolution';

/**
 * `resolveOwner()` (`JR-5-07`, `docs/enterprise/journaling/guide.md` "How Owner Resolution Works" /
 * "Domain Normalization (Alias Handling)"). Classification: `ci`.
 *
 * The guide's example table under "Domain Normalization (Alias Handling)" has exactly four rows;
 * this suite's first four tests reproduce each of them, in order, against the exact two-group
 * configuration the guide's own "Structure" section shows (`company.com`/`{company.co.uk,
 * old-brand.com}` and `subsidiary.io`/`{}`). The remaining tests cover the priority order between
 * the four cases, the address-comparison edge cases JR-5-07 calls out by name, and the two
 * `additionalMatches`/`warning` transparency requirements.
 */

function envelope(partial: Partial<OwnerResolutionEnvelope>): OwnerResolutionEnvelope {
	return {
		to: [],
		cc: [],
		bcc: [],
		sender: null,
		...partial,
	};
}

/** The guide's own example configuration (`docs/enterprise/journaling/guide.md`, "Structure"). */
const GUIDE_GROUPS: OrganizationDomainGroup[] = [
	{ main: 'company.com', aliases: ['company.co.uk', 'old-brand.com'] },
	{ main: 'subsidiary.io', aliases: [] },
];

suite('ci', "resolveOwner() -- the guide's four documented example rows", () => {
	it('row 1: an alias-domain recipient normalizes to the primary domain', () => {
		const result = resolveOwner(envelope({ to: ['alice@old-brand.com'] }), GUIDE_GROUPS);
		expect(result.ownerEmail).toBe('alice@company.com');
		expect(result.method).toBe('alias-domain-match');
		expect(result.winner).toEqual({
			field: 'to',
			address: 'alice@old-brand.com',
			normalizedEmail: 'alice@company.com',
		});
		expect(result.matchedDomain).toBe('old-brand.com');
		expect(result.warning).toBeNull();
	});

	it('row 2: a primary-domain recipient is stored unchanged', () => {
		const result = resolveOwner(envelope({ to: ['alice@company.com'] }), GUIDE_GROUPS);
		expect(result.ownerEmail).toBe('alice@company.com');
		expect(result.method).toBe('primary-domain-match');
		expect(result.winner).toEqual({
			field: 'to',
			address: 'alice@company.com',
			normalizedEmail: 'alice@company.com',
		});
	});

	it('row 3: a recipient at a group with no aliases at all still matches on its own primary domain', () => {
		const result = resolveOwner(envelope({ to: ['bob@subsidiary.io'] }), GUIDE_GROUPS);
		expect(result.ownerEmail).toBe('bob@subsidiary.io');
		expect(result.method).toBe('primary-domain-match');
	});

	it('row 4: no participant matches any configured domain falls back to the first group, with a warning', () => {
		const result = resolveOwner(envelope({ to: ['external@gmail.com'] }), GUIDE_GROUPS);
		expect(result.ownerEmail).toBe('default_fallback@company.com');
		expect(result.method).toBe('fallback');
		expect(result.winner).toBeNull();
		expect(result.warning).not.toBeNull();
		expect(result.warning).toContain('default_fallback@company.com');
	});
});

suite('ci', 'resolveOwner() -- priority order between To, Cc, Bcc and From', () => {
	it('prefers To over Cc and Bcc when more than one matches', () => {
		const result = resolveOwner(
			envelope({
				to: ['alice@company.com'],
				cc: ['bob@company.com'],
				bcc: ['carol@company.com'],
			}),
			GUIDE_GROUPS
		);
		expect(result.winner).toEqual({
			field: 'to',
			address: 'alice@company.com',
			normalizedEmail: 'alice@company.com',
		});
	});

	it('falls through to Cc when To has no matching recipient', () => {
		const result = resolveOwner(
			envelope({ to: ['external@gmail.com'], cc: ['bob@company.com'] }),
			GUIDE_GROUPS
		);
		expect(result.winner).toEqual({
			field: 'cc',
			address: 'bob@company.com',
			normalizedEmail: 'bob@company.com',
		});
	});

	it('falls through to Bcc when neither To nor Cc has a matching recipient', () => {
		const result = resolveOwner(
			envelope({
				to: ['external@gmail.com'],
				cc: ['also-external@gmail.com'],
				bcc: ['carol@company.com'],
			}),
			GUIDE_GROUPS
		);
		expect(result.winner).toEqual({
			field: 'bcc',
			address: 'carol@company.com',
			normalizedEmail: 'carol@company.com',
		});
	});

	it('falls through to the sender (outbound check) only once To/Cc/Bcc all miss', () => {
		const result = resolveOwner(
			envelope({ to: ['external@gmail.com'], sender: 'alice@company.com' }),
			GUIDE_GROUPS
		);
		expect(result.winner).toEqual({
			field: 'sender',
			address: 'alice@company.com',
			normalizedEmail: 'alice@company.com',
		});
		expect(result.method).toBe('primary-domain-match');
	});

	it('an inbound match wins even when the sender also matches a configured domain', () => {
		const result = resolveOwner(
			envelope({ to: ['bob@subsidiary.io'], sender: 'alice@company.com' }),
			GUIDE_GROUPS
		);
		expect(result.winner).toEqual({
			field: 'to',
			address: 'bob@subsidiary.io',
			normalizedEmail: 'bob@subsidiary.io',
		});
	});

	it('a sender at an alias domain is normalized just like an inbound alias match', () => {
		const result = resolveOwner(
			envelope({ to: ['external@gmail.com'], sender: 'alice@old-brand.com' }),
			GUIDE_GROUPS
		);
		expect(result.ownerEmail).toBe('alice@company.com');
		expect(result.method).toBe('alias-domain-match');
		expect(result.winner).toEqual({
			field: 'sender',
			address: 'alice@old-brand.com',
			normalizedEmail: 'alice@company.com',
		});
	});
});

suite('ci', 'resolveOwner() -- no domain groups configured (case 3)', () => {
	it('picks To[0] when it is non-empty', () => {
		const result = resolveOwner(
			envelope({ to: ['first@example.com', 'second@example.com'] }),
			[]
		);
		expect(result.ownerEmail).toBe('first@example.com');
		expect(result.method).toBe('heuristic-no-groups');
		expect(result.winner).toEqual({
			field: 'to',
			address: 'first@example.com',
			normalizedEmail: 'first@example.com',
		});
		expect(result.warning).toBeNull();
	});

	it('falls through to Cc[0], then Bcc[0], then the sender, in that order', () => {
		expect(resolveOwner(envelope({ cc: ['c@example.com'] }), []).winner).toEqual({
			field: 'cc',
			address: 'c@example.com',
			normalizedEmail: 'c@example.com',
		});
		expect(resolveOwner(envelope({ bcc: ['b@example.com'] }), []).winner).toEqual({
			field: 'bcc',
			address: 'b@example.com',
			normalizedEmail: 'b@example.com',
		});
		expect(resolveOwner(envelope({ sender: 's@example.com' }), []).winner).toEqual({
			field: 'sender',
			address: 's@example.com',
			normalizedEmail: 's@example.com',
		});
	});

	it('resolves to the literal "journal-unknown" when every field is empty', () => {
		const result = resolveOwner(envelope({}), []);
		expect(result.ownerEmail).toBe('journal-unknown');
		expect(result.method).toBe('heuristic-no-groups');
		expect(result.winner).toBeNull();
	});

	it('does not normalize the heuristic winner even though it happens to look like a company domain', () => {
		// No groups configured at all -- there is no primary domain to normalize *to*, so the address
		// is returned exactly as found, unmodified.
		const result = resolveOwner(envelope({ to: ['alice@old-brand.com'] }), []);
		expect(result.ownerEmail).toBe('alice@old-brand.com');
	});
});

suite('ci', 'resolveOwner() -- address comparison edge cases (JR-5-07 hard constraint 5)', () => {
	it('compares the domain case-insensitively', () => {
		const result = resolveOwner(envelope({ to: ['Alice@COMPANY.COM'] }), GUIDE_GROUPS);
		expect(result.method).toBe('primary-domain-match');
		expect(result.matchedDomain).toBe('company.com');
	});

	it("never alters the local part's casing, even while normalizing the domain", () => {
		const result = resolveOwner(envelope({ to: ['Alice@old-brand.com'] }), GUIDE_GROUPS);
		expect(result.ownerEmail).toBe('Alice@company.com');
	});

	it('treats an address with no "@" at all as unable to match any domain group', () => {
		const result = resolveOwner(
			envelope({ to: ['not-an-email'], cc: ['bob@company.com'] }),
			GUIDE_GROUPS
		);
		expect(result.winner).toEqual({
			field: 'cc',
			address: 'bob@company.com',
			normalizedEmail: 'bob@company.com',
		});
	});

	it('splits on the last "@" when an address has more than one', () => {
		const result = resolveOwner(envelope({ to: ['a@b@company.com'] }), GUIDE_GROUPS);
		expect(result.method).toBe('primary-domain-match');
		expect(result.ownerEmail).toBe('a@b@company.com');
	});

	it('matches on the domain half even when the local part is empty, without inventing one', () => {
		const result = resolveOwner(envelope({ to: ['@company.com'] }), GUIDE_GROUPS);
		expect(result.method).toBe('primary-domain-match');
		expect(result.ownerEmail).toBe('@company.com');
	});

	it('resolves a domain configured as an alias of two different groups to the first group in array order', () => {
		const conflicting: OrganizationDomainGroup[] = [
			{ main: 'first.example', aliases: ['shared-alias.example'] },
			{ main: 'second.example', aliases: ['shared-alias.example'] },
		];
		const result = resolveOwner(envelope({ to: ['user@shared-alias.example'] }), conflicting);
		expect(result.ownerEmail).toBe('user@first.example');
	});
});

suite(
	'ci',
	'resolveOwner() -- multiple matches are not silently discarded (JR-5-07 hard constraint 4)',
	() => {
		it('reports the other matching recipients alongside the winner', () => {
			const result = resolveOwner(
				envelope({
					to: ['alice@company.com', 'external@gmail.com'],
					cc: ['bob@subsidiary.io'],
					bcc: ['carol@old-brand.com'],
				}),
				GUIDE_GROUPS
			);
			expect(result.winner).toEqual({
				field: 'to',
				address: 'alice@company.com',
				normalizedEmail: 'alice@company.com',
			});
			// JR-6-02b: normalizedEmail is each match's own alias-to-primary-domain mapping, not a
			// copy of the winner's -- a fan-out caller archives each of these under its own mailbox.
			expect(result.additionalMatches).toEqual([
				{ field: 'cc', address: 'bob@subsidiary.io', normalizedEmail: 'bob@subsidiary.io' },
				{
					field: 'bcc',
					address: 'carol@old-brand.com',
					normalizedEmail: 'carol@company.com',
				},
			]);
		});

		it('reports no additional matches when only one recipient matches', () => {
			const result = resolveOwner(
				envelope({ to: ['alice@company.com'], cc: ['external@gmail.com'] }),
				GUIDE_GROUPS
			);
			expect(result.additionalMatches).toEqual([]);
		});

		it('reports no additional matches when the winner came from the outbound (sender) check', () => {
			const result = resolveOwner(
				envelope({ to: ['external@gmail.com'], sender: 'alice@company.com' }),
				GUIDE_GROUPS
			);
			expect(result.additionalMatches).toEqual([]);
		});

		/**
		 * F43, found by `JR-5-09`'s independent acceptance. Matching trimmed the configured domain
		 * while the emitted address did not, so a stray space in `organizationDomains` matched and
		 * then leaked into `ownerEmail` -- `' company.com'` even put whitespace in the *middle* of
		 * the address. Every case below produced a broken address before the fix; each asserts the
		 * whole address rather than just "no whitespace", so a future regression cannot pass by
		 * trimming somewhere else and mangling the rest.
		 */
		describe('F43: whitespace in a configured domain never reaches the owner address', () => {
			it.each([
				['trailing space in main', 'company.com '],
				['leading space in main', ' company.com'],
				['trailing tab in main', 'company.com\t'],
				['space on both sides of main', '  company.com  '],
			])('%s still yields a clean owner address', (_label, main) => {
				const result = resolveOwner(envelope({ to: ['alice@company.com'] }), [
					{ main, aliases: [] },
				]);
				expect(result.ownerEmail).toBe('alice@company.com');
				expect(result.method).toBe('primary-domain-match');
			});

			it('trims the alias-matched group main too, not only the exact-match path', () => {
				const result = resolveOwner(envelope({ to: ['alice@old-brand.com'] }), [
					{ main: ' company.com ', aliases: ['old-brand.com'] },
				]);
				expect(result.ownerEmail).toBe('alice@company.com');
				expect(result.method).toBe('alias-domain-match');
			});

			it('trims the fallback address as well, where the domain is used without any match', () => {
				const result = resolveOwner(envelope({ to: ['external@gmail.com'] }), [
					{ main: 'company.com ', aliases: [] },
				]);
				expect(result.ownerEmail).toBe('default_fallback@company.com');
				expect(result.method).toBe('fallback');
				expect(result.warning).not.toBeNull();
			});

			it("preserves the operator's casing while trimming -- the two are separate concerns", () => {
				const result = resolveOwner(envelope({ to: ['alice@company.com'] }), [
					{ main: ' Company.COM ', aliases: [] },
				]);
				expect(result.ownerEmail).toBe('alice@Company.COM');
			});

			/**
			 * Deliberately *not* repaired: a `main` that is not a bare domain. Guessing which half
			 * the operator meant would invent a value out of a broken input, which is the one thing
			 * this parser must never do. Asserted so the limit is measured and visible rather than
			 * discovered later; the check belongs where the config is written.
			 */
			it('does not invent a domain when main is a full address (documented limit)', () => {
				const result = resolveOwner(envelope({ to: ['external@gmail.com'] }), [
					{ main: 'admin@company.com', aliases: [] },
				]);
				expect(result.ownerEmail).toBe('default_fallback@admin@company.com');
			});
		});
	}
);
