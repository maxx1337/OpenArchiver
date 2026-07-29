import { expect, it } from 'vitest';
import { and, inArray } from 'drizzle-orm';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import type { CaslPolicy } from '@open-archiver/types';
import { acquireTestDatabase, loadBackendDatabaseSingleton } from '../support/pg-harness';
import { loadPolicyFixture } from '../support/policy-fixtures';
import { renderSql } from '../support/render-sql';
import { seedIngestionSource, seedPrincipal } from '../support/iam-seed';
import { ingestionSources } from '../../src/database/schema';

/**
 * JR-104 -- `FilterBuilder.create()` against real roles and real rows.
 *
 * JR-103 could not test this. `FilterBuilder` resolves its ability through
 * `IamService.getAbilityForUser()`, which reads `users` / `user_roles` / `roles.policies`, and
 * `IamService` is bound to the `db` singleton that throws at import time without `DATABASE_URL`.
 * Two behaviours are only observable here:
 *
 *   - the `${user.id}` interpolation in `end-user.json`, which needs a real user row;
 *   - what the returned `drizzleFilter` does when handed to Postgres, as opposed to what it
 *     renders to.
 *
 * The tests below assert *rows returned*, not just SQL text. For a row-level access-control
 * primitive, "which records come back" is the contract; the SQL is an implementation detail.
 *
 * **Scope after JR-1301:** this file holds only the behaviour that is correct today and must stay
 * correct through E13's fixes -- it is green before and after. The F1/F3/F7/F8 blocks moved to
 * `filter-builder-f1-f3.int.test.ts`, `filter-builder-f7.int.test.ts` and
 * `filter-builder-f8.int.test.ts`, where they now demand the fixed behaviour and are red until it
 * lands.
 *
 * Classification: `ci`.
 */

const postgresProbe = await probePostgres();

// Acquire before importing anything that pulls in `src/database`: that module builds its `db`
// singleton at import time from `process.env.DATABASE_URL`. Guarded on the class as well, so a
// run with OA_TEST_CLASSES=nightly does not create a database it would never release.
const enabled = postgresProbe.available && isClassSelected('ci');
const harness = enabled ? await acquireTestDatabase('filter-builder') : undefined;
if (harness) {
	harness.bindAsProcessDatabaseUrl();
	// Import through the harness so its connection pool is closed during teardown.
	await loadBackendDatabaseSingleton();
}
const FilterBuilder = harness
	? (await import('../../src/services/FilterBuilder')).FilterBuilder
	: undefined;

suiteRequiring('ci', 'FilterBuilder.create() over real roles (JR-104)', postgresProbe, () => {
	const db = () => harness!.db;
	const build = (userId: string, subject: 'archive' | 'ingestion', action: 'read' | 'search') =>
		FilterBuilder!.create(userId, subject, action);

	it('interpolates ${user.id} per user, not once per role', async () => {
		const endUser = loadPolicyFixture('end-user');
		const alice = await seedPrincipal(db(), endUser, 'alice');
		const bob = await seedPrincipal(db(), endUser, 'bob');

		const aliceFilter = await build(alice.userId, 'ingestion', 'read');
		const bobFilter = await build(bob.userId, 'ingestion', 'read');

		const aliceSql = renderSql(aliceFilter.drizzleFilter);
		const bobSql = renderSql(bobFilter.drizzleFilter);
		expect(aliceSql?.sql).toBe('"user_id" = $1');
		expect(aliceSql?.params).toEqual([alice.userId]);
		expect(bobSql?.params).toEqual([bob.userId]);
		// The fixture stores the literal placeholder; if interpolation were skipped or cached the
		// two users would share a bound value.
		expect(aliceFilter.searchFilter).toBe(`(userId = "${alice.userId}")`);
		expect(bobFilter.searchFilter).toBe(`(userId = "${bob.userId}")`);
	});

	it('scopes the rows Postgres actually returns to the owning user', async () => {
		const endUser = loadPolicyFixture('end-user');
		const owner = await seedPrincipal(db(), endUser, 'owner');
		const stranger = await seedPrincipal(db(), endUser, 'stranger');

		const mine = await seedIngestionSource(db(), { userId: owner.userId });
		const theirs = await seedIngestionSource(db(), { userId: stranger.userId });
		const orphan = await seedIngestionSource(db(), { userId: null });

		const { drizzleFilter } = await build(owner.userId, 'ingestion', 'read');
		const visible = await db()
			.select({ id: ingestionSources.id })
			.from(ingestionSources)
			.where(
				and(drizzleFilter, inArray(ingestionSources.id, [mine.id, theirs.id, orphan.id]))
			);

		expect(visible.map((row) => row.id)).toEqual([mine.id]);
	});

	it('restricts to the listed ids for an $in condition (auditor-specific-sources)', async () => {
		// The fixture names two concrete UUIDs; seed exactly those plus a third.
		const auditor = await seedPrincipal(
			db(),
			loadPolicyFixture('auditor-specific-sources'),
			'auditor-sources'
		);
		const allowedA = 'aeafbe44-d41c-4015-ac27-504f6e0c511a';
		const allowedB = 'f16b7ed2-4e54-4283-9556-c633726f9405';
		const denied = '00000000-0000-4000-8000-0000000000ff';
		for (const id of [allowedA, allowedB, denied]) {
			await db()
				.insert(ingestionSources)
				.values({ id, name: `src-${id.slice(0, 8)}`, provider: 'generic_imap' });
		}

		const { drizzleFilter, searchFilter } = await build(auditor.userId, 'ingestion', 'read');
		const visible = await db()
			.select({ id: ingestionSources.id })
			.from(ingestionSources)
			.where(and(drizzleFilter, inArray(ingestionSources.id, [allowedA, allowedB, denied])));

		expect(visible.map((row) => row.id).sort()).toEqual([allowedA, allowedB].sort());
		expect(searchFilter).toBe(`(id IN ["${allowedA}", "${allowedB}"])`);
	});

	it('returns no filter for an unconditional grant, and that means every row', async () => {
		const admin = await seedPrincipal(db(), loadPolicyFixture('admin'), 'admin');
		const source = await seedIngestionSource(db(), { userId: null });

		const result = await build(admin.userId, 'archive', 'read');
		// `undefined` here is correct: `manage all` is unconditional.
		expect(result.drizzleFilter).toBeUndefined();
		expect(result.searchFilter).toBeUndefined();

		const readOnly = await seedPrincipal(db(), loadPolicyFixture('read-only-all'), 'readonly');
		const readOnlyResult = await build(readOnly.userId, 'archive', 'read');
		expect(readOnlyResult.drizzleFilter).toBeUndefined();
		expect(readOnlyResult.searchFilter).toBeUndefined();
		expect(source.id).toMatch(/[0-9a-f-]{36}/);
	});

	/**
	 * The F1 / F3 / F7 / F8 blocks that used to live here have been rewritten into standalone
	 * regression suites in `JR-1301` (epic E13), because they asserted the defect as if it were the
	 * contract:
	 *
	 *   - F7 (fail-open `null` branch, plus ADR-017's action offset)
	 *       -> tests/integration/filter-builder-f7.int.test.ts
	 *   - F8 (`cannot` + operator condition)
	 *       -> tests/integration/filter-builder-f8.int.test.ts
	 *   - F1 (condition-key injection) and F3 (fail-open translation), both against real rows
	 *       -> tests/integration/filter-builder-f1-f3.int.test.ts
	 *
	 * What stays here is the behaviour that is *correct today* and must survive E13's fixes. That
	 * separation is deliberate: this file must be green before and after the fixes, the three files
	 * above are red before and green after.
	 */
	it('an untranslatable condition never yields an unrestricted filter', async () => {
		// Kept here as the boundary check for this suite: whatever `create()` does with a policy it
		// cannot translate, it must not resolve to `{ drizzleFilter: undefined }`. Today it rejects
		// (because `mongoToMeli` throws), which satisfies this. *Why* that is not good enough --
		// the Drizzle half on its own is fail-open -- is asserted in filter-builder-f1-f3.
		const conditions = { subject: { $regex: 'confidential' } };
		const policies: CaslPolicy[] = [{ action: 'read', subject: 'archive', conditions }];
		const principal = await seedPrincipal(db(), policies, 'regex');

		let resolved: Awaited<ReturnType<typeof build>> | undefined;
		try {
			resolved = await build(principal.userId, 'archive', 'read');
		} catch {
			return; // rejected: fail-closed, nothing further to check
		}
		expect(
			resolved.drizzleFilter,
			'create() resolved with no filter for a policy condition it cannot translate'
		).toBeDefined();
	});
});
