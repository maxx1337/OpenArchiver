import { expect, it } from 'vitest';
import { and, inArray } from 'drizzle-orm';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import { coverageNotice } from '@oa-test/notice';
import type { CaslPolicy } from '@open-archiver/types';
import { acquireTestDatabase, loadBackendDatabaseSingleton } from '../support/pg-harness';
import { loadPolicyFixture } from '../support/policy-fixtures';
import { renderSql } from '../support/render-sql';
import { expectSearchFilterDenies, isDenyRendering, redUntil } from '../support/fail-closed';
import {
	seedArchivedEmail,
	seedIngestionSource,
	seedPrincipal,
	seedUserWithoutRole,
} from '../support/iam-seed';
import { archivedEmails, ingestionSources } from '../../src/database/schema';

/**
 * FINDING F7 regression -- `FilterBuilder` must be fail-closed when no `can` rule matches
 * (JR-1301, epic E13). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * The defect
 * ---------------------------------------------------------------------------------------------
 * `rulesToQuery()` (@casl/ability/extra) returns `null` when the rule list for (action, subject)
 * contains no non-inverted rule -- both when there is no rule at all and when there are only
 * `cannot` rules. `FilterBuilder.ts:49` maps that `null` to
 * `{ drizzleFilter: undefined, searchFilter: undefined }`, commented "Full access", while the very
 * next branch correctly maps the *empty* query to ``sql`1=0` ``. "No permission on this subject"
 * and "may see everything" are the same value, and the unsafe one is the default.
 *
 * Required behaviour (`JR-1302`): `null` is a **deny**. The unrestricted return is only legitimate
 * for a demonstrably unconditional `can` (the branch at `FilterBuilder.ts:31`).
 *
 * ---------------------------------------------------------------------------------------------
 * How this file differs from its predecessor
 * ---------------------------------------------------------------------------------------------
 * `filter-builder.int.test.ts` used to contain `FINDING F7a` / `FINDING F7b`, which asserted
 * `expect(result.drizzleFilter).toBeUndefined()` and that the forbidden row *comes back*. Those
 * tests passed, and a passing test that describes a security hole is worse than no test: it makes
 * the hole look surveyed. Here the same two situations demand the opposite outcome. Both are
 * therefore RED until `JR-1302` lands. That is the point -- see `JR-1301`'s acceptance criterion.
 *
 * Every assertion is on **rows Postgres actually returned**, not only on the returned value: the
 * contract of a row-level access primitive is which records come back.
 */

const postgresProbe = await probePostgres();

const enabled = postgresProbe.available && isClassSelected('ci');
const harness = enabled ? await acquireTestDatabase('fb-f7') : undefined;
if (harness) {
	harness.bindAsProcessDatabaseUrl();
	await loadBackendDatabaseSingleton();
}
const FilterBuilder = harness
	? (await import('../../src/services/FilterBuilder')).FilterBuilder
	: undefined;

suiteRequiring('ci', 'FilterBuilder fail-closed -- FINDING F7 (JR-1301)', postgresProbe, () => {
	const db = () => harness!.db;
	const build = (userId: string, subject: 'archive' | 'ingestion', action: 'read' | 'search') =>
		FilterBuilder!.create(userId, subject, action);

	/** Rows of `archived_emails` visible through `filter`, restricted to the ids we seeded. */
	const visibleEmails = async (filter: Parameters<typeof and>[0], ids: string[]) => {
		const rows = await db()
			.select({ id: archivedEmails.id })
			.from(archivedEmails)
			.where(and(filter, inArray(archivedEmails.id, ids)));
		return rows.map((row) => row.id).sort();
	};

	it(redUntil('JR-1302', 'a user with no role at all sees no ingestion source'), async () => {
		coverageNotice(
			'FINDING F7 regression (JR-1301): FilterBuilder.create() must not return ' +
				'{ drizzleFilter: undefined } for a principal with no matching `can` rule. ' +
				'Expected RED until JR-1302. A user with no role is reachable by deleting a role ' +
				'from an existing user -- no hand-written policy needed.'
		);
		const userId = await seedUserWithoutRole(db());
		const source = await seedIngestionSource(db(), { userId: null });

		const result = await build(userId, 'ingestion', 'read');

		const rendered = renderSql(result.drizzleFilter);
		expect(
			rendered !== undefined && isDenyRendering(rendered),
			`a principal with zero permissions must get a never-true filter, got ` +
				`${JSON.stringify(rendered)} (undefined = no restriction at ` +
				`ArchivedEmailService.ts:62 / IngestionService.ts:137)`
		).toBe(true);
		expectSearchFilterDenies('a user with no role', result.searchFilter);

		const visible = await db()
			.select({ id: ingestionSources.id })
			.from(ingestionSources)
			.where(and(result.drizzleFilter, inArray(ingestionSources.id, [source.id])));
		expect(visible, 'a principal with zero permissions saw a row').toEqual([]);
	});

	it(redUntil('JR-1302', 'a cannot-only policy denies the rows it forbids (F7b)'), async () => {
		// `auditor-specific-mailbox.json` grants read/search on `ingestion` and *denies*
		// read/search on `archive` for userEmail = dev@openarchiver.com. It contains no `can`
		// rule for `archive` at all -- which is exactly the shape every scope-restricting
		// auditor policy in E11 would have.
		const auditor = await seedPrincipal(
			db(),
			loadPolicyFixture('auditor-specific-mailbox'),
			'auditor-mailbox'
		);
		const source = await seedIngestionSource(db(), { userId: null });
		const forbidden = await seedArchivedEmail(db(), {
			ingestionSourceId: source.id,
			userEmail: 'dev@openarchiver.com',
		});
		const other = await seedArchivedEmail(db(), {
			ingestionSourceId: source.id,
			userEmail: 'someone-else@journaling.test.invalid',
		});

		const result = await build(auditor.userId, 'archive', 'read');
		const visible = await visibleEmails(result.drizzleFilter, [forbidden, other]);

		// JR-1302's acceptance criterion, verbatim: no row for dev@openarchiver.com.
		expect(
			visible,
			`the row explicitly denied by auditor-specific-mailbox.json came back. This is F7b: ` +
				`a policy whose only purpose is a prohibition currently grants full access.`
		).not.toContain(forbidden);
		// And the fail-closed consequence: no `can` on `archive` means no archive row at all.
		expect(
			visible,
			'a policy with no `can` rule for `archive` must return no archive row'
		).toEqual([]);
	});

	it(
		redUntil('JR-1302', 'the same denial holds for the search action (F7b, ADR-017 path)'),
		async () => {
			// The fixture denies `['read','search']`. ADR-017 makes `SearchService` build its filter
			// for `search`, so the `search` action is now on the reachable path and needs its own
			// assertion -- checking only `read` would leave the decided case uncovered.
			const auditor = await seedPrincipal(
				db(),
				loadPolicyFixture('auditor-specific-mailbox'),
				'auditor-mailbox-search'
			);
			const source = await seedIngestionSource(db(), { userId: null });
			const forbidden = await seedArchivedEmail(db(), {
				ingestionSourceId: source.id,
				userEmail: 'dev@openarchiver.com',
			});

			const result = await build(auditor.userId, 'archive', 'search');
			expect(await visibleEmails(result.drizzleFilter, [forbidden])).toEqual([]);
			expectSearchFilterDenies(
				'auditor-specific-mailbox, action=search',
				result.searchFilter
			);
		}
	);

	/**
	 * ADR-017 (variant B, decided 2026-07-29) -- the semantics `JR-1301` is required to demand:
	 * "der Filter für eine Rolle mit **bedingtem** `search archive` entsteht aus deren
	 * `search`-Regeln".
	 *
	 * The role below is the third reachable form of the `null` branch named in ADR-017: a
	 * hand-written role with `can search archive` and **no** `read archive`. Two things must hold,
	 * and only one of them holds today:
	 *
	 *   - action `search` -> the filter comes from the conditional `search` rule. Green today; this
	 *     is the regression net that ADR-017's change must not break.
	 *   - action `read`   -> deny, because the role has no `read` rule. Red today: `rulesToQuery`
	 *     returns `null` and `FilterBuilder` calls that full access. Combined with the pre-JR-1303
	 *     `SearchService`, which asks for `read`, this role currently receives an **unfiltered**
	 *     search over the whole archive while passing the `requirePermission('search','archive')`
	 *     gate.
	 *
	 * That `SearchService` asks for `'search'` after `JR-1303` is asserted in
	 * `tests/unit/filter-builder-call-sites.test.ts` -- it cannot be observed here, because
	 * reaching `SearchService` needs Meilisearch. The limitation is stated there.
	 */
	const conditionalSearchOnly = (mailbox: string): CaslPolicy[] => [
		{ action: 'search', subject: 'archive', conditions: { userEmail: mailbox } },
	];

	it('a conditional `search archive` rule scopes the search action to its condition', async () => {
		// Green before and after the fixes. If ADR-017's change ever regressed this, an auditor
		// scoped to one mailbox would silently see all of them.
		const mailbox = 'scoped@journaling.test.invalid';
		const principal = await seedPrincipal(
			db(),
			conditionalSearchOnly(mailbox),
			'search-only-scoped'
		);
		const source = await seedIngestionSource(db(), { userId: null });
		const mine = await seedArchivedEmail(db(), {
			ingestionSourceId: source.id,
			userEmail: mailbox,
		});
		const theirs = await seedArchivedEmail(db(), {
			ingestionSourceId: source.id,
			userEmail: 'other@journaling.test.invalid',
		});

		const result = await build(principal.userId, 'archive', 'search');

		expect(renderSql(result.drizzleFilter)?.sql).toBe('"user_email" = $1');
		expect(renderSql(result.drizzleFilter)?.params).toEqual([mailbox]);
		expect(result.searchFilter).toBe(`(userEmail = "${mailbox}")`);
		expect(await visibleEmails(result.drizzleFilter, [mine, theirs])).toEqual([mine]);
	});

	it(
		redUntil(
			'JR-1302',
			'the same role is denied for the read action it was never granted (ADR-017)'
		),
		async () => {
			const mailbox = 'scoped-read@journaling.test.invalid';
			const principal = await seedPrincipal(
				db(),
				conditionalSearchOnly(mailbox),
				'search-only-read'
			);
			const source = await seedIngestionSource(db(), { userId: null });
			const mine = await seedArchivedEmail(db(), {
				ingestionSourceId: source.id,
				userEmail: mailbox,
			});
			const theirs = await seedArchivedEmail(db(), {
				ingestionSourceId: source.id,
				userEmail: 'other@journaling.test.invalid',
			});

			const result = await build(principal.userId, 'archive', 'read');

			// The severe part first: the mailbox this role was never given access to.
			expect(
				await visibleEmails(result.drizzleFilter, [mine, theirs]),
				`a role with 'search archive' and no 'read archive' currently receives an ` +
					`unrestricted filter for the read action (F7 via the ADR-017 action offset). ` +
					`Expected: no row.`
			).toEqual([]);
			expectSearchFilterDenies('search-only role, action=read', result.searchFilter);
		}
	);

	it('an unconditional grant still means every row -- the counter-check', async () => {
		// Green before and after. `JR-1302` must not turn `FilterBuilder.ts:31` into a deny; if it
		// did, every shipped installation would break and the F7 fix would be reverted for the
		// wrong reason.
		const admin = await seedPrincipal(db(), loadPolicyFixture('admin'), 'f7-admin');
		const readOnly = await seedPrincipal(
			db(),
			loadPolicyFixture('read-only-all'),
			'f7-readonly'
		);
		const source = await seedIngestionSource(db(), { userId: null });
		const row = await seedArchivedEmail(db(), {
			ingestionSourceId: source.id,
			userEmail: 'anyone@journaling.test.invalid',
		});

		for (const [label, principal] of [
			['admin.json (manage all)', admin],
			['read-only-all.json (read+search, unconditional)', readOnly],
		] as const) {
			for (const action of ['read', 'search'] as const) {
				const result = await build(principal.userId, 'archive', action);
				expect(result.drizzleFilter, `${label} / ${action}`).toBeUndefined();
				expect(result.searchFilter, `${label} / ${action}`).toBeUndefined();
				expect(
					await visibleEmails(result.drizzleFilter, [row]),
					`${label} / ${action}`
				).toEqual([row]);
			}
		}
	});
});
