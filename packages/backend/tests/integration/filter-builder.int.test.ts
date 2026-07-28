import { expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import { coverageNotice } from '@oa-test/notice';
import type { CaslPolicy } from '@open-archiver/types';
import { acquireTestDatabase, loadBackendDatabaseSingleton } from '../support/pg-harness';
import { loadPolicyFixture } from '../support/policy-fixtures';
import { renderSql } from '../support/render-sql';
import {
	seedArchivedEmail,
	seedIngestionSource,
	seedPrincipal,
	seedUserWithoutRole,
} from '../support/iam-seed';
import { archivedEmails, ingestionSources } from '../../src/database/schema';

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
const mongoToDrizzle = harness
	? (await import('../../src/helpers/mongoToDrizzle')).mongoToDrizzle
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
	 * FINDING F7 (JR-104) -- `FilterBuilder` is fail-open when no `can` rule matches.
	 *
	 * `rulesToQuery()` (@casl/ability/extra) returns `null` when the rule list for
	 * (action, subject) contains no non-inverted rule -- both when there are no rules at all and
	 * when there are only `cannot` rules. `FilterBuilder.create()` maps `null` to
	 * `{ drizzleFilter: undefined, searchFilter: undefined }` and comments it "Full access".
	 *
	 * So "this principal has no permission on this subject" and "this principal may see
	 * everything" are represented by the same value, and the unsafe one is the default. This is
	 * F3's fail-open at the level where it has consequences: `undefined` reaching
	 * `ArchivedEmailService.findAll` (services/ArchivedEmailService.ts:62) or `SearchService`
	 * (services/SearchService.ts:311, :423) is an unscoped query over the whole archive.
	 *
	 * Reachability is not blocked by the middleware. `requirePermission` never passes a resource
	 * object (api/middleware/requirePermission.ts), and the search route gates on
	 * `('search', 'archive')` (api/routes/search.routes.ts:158) while `SearchService` builds its
	 * filter for `('read', 'archive')`. A role with `can search archive` and no `read archive`
	 * rule therefore passes the gate and receives an unfiltered search.
	 *
	 * Not fixed here -- reported for the senior developer.
	 */
	it('FINDING F7a: a user with no role at all gets an unrestricted filter', async () => {
		coverageNotice(
			'FINDING F7 (JR-104): FilterBuilder.create() returns { drizzleFilter: undefined, ' +
				'searchFilter: undefined } -- "full access" -- for a principal with no matching `can` ' +
				'rule. A user with no role at all and a user with only `cannot` rules both land there. ' +
				'Reported for the senior developer; not fixed in the test epic.'
		);
		const userId = await seedUserWithoutRole(db());
		const source = await seedIngestionSource(db(), { userId: null });

		const result = await build(userId, 'ingestion', 'read');
		expect(result.drizzleFilter).toBeUndefined();
		expect(result.searchFilter).toBeUndefined();

		// Observable consequence: the row is returned to a principal with zero permissions.
		const visible = await db()
			.select({ id: ingestionSources.id })
			.from(ingestionSources)
			.where(and(result.drizzleFilter, eq(ingestionSources.id, source.id)));
		expect(visible).toHaveLength(1);
	});

	it('FINDING F7b: a cannot-only policy yields access to the very rows it forbids', async () => {
		// auditor-specific-mailbox grants read/search on `ingestion` and *denies* read/search on
		// `archive` for userEmail = dev@openarchiver.com. There is no `can` rule for `archive`.
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
		expect(result.drizzleFilter).toBeUndefined();
		expect(result.searchFilter).toBeUndefined();

		const visible = await db()
			.select({ id: archivedEmails.id })
			.from(archivedEmails)
			.where(and(result.drizzleFilter, inArray(archivedEmails.id, [forbidden, other])));
		// The explicitly denied row comes back. This is the assertion that makes F7 a finding
		// rather than a style complaint.
		expect(visible.map((row) => row.id).sort()).toEqual([forbidden, other].sort());
	});

	/**
	 * FINDING F8 (JR-104) -- the `cannot` exclusion path mangles operator conditions.
	 *
	 * When an unconditional `can` is combined with `cannot` rules, `FilterBuilder.create()` builds
	 * the exclusion by wrapping each condition *value* in `$ne`:
	 *
	 *     newCondition[key] = { $ne: (condition as any)[key] }
	 *
	 * If the original condition value is itself an operator object -- `{ $in: [...] }`,
	 * `{ $gte: n }` -- the result is `{ $ne: { $in: [...] } }`. Neither translator understands
	 * that: `mongoToDrizzle` binds the operator object as a query *parameter*, and `mongoToMeli`
	 * interpolates it as `[object Object]`. The exclusion the policy author wrote does not happen.
	 */
	it('FINDING F8: cannot + $in produces an object parameter instead of an exclusion', async () => {
		coverageNotice(
			'FINDING F8 (JR-104): FilterBuilder wraps `cannot` condition values in { $ne: value } ' +
				'without regard for value being an operator object. `cannot ... { $in: [...] }` ' +
				'becomes { $ne: { $in: [...] } }, which binds an object as a SQL parameter and emits ' +
				'"[object Object]" into the Meilisearch filter. Reported; not fixed here.'
		);
		const blockedSource = await seedIngestionSource(db(), { userId: null });
		const allowedSource = await seedIngestionSource(db(), { userId: null });
		const policies: CaslPolicy[] = [
			{ action: 'read', subject: 'archive' },
			{
				inverted: true,
				action: 'read',
				subject: 'archive',
				conditions: { ingestionSourceId: { $in: [blockedSource.id] } },
			},
		];
		const principal = await seedPrincipal(db(), policies, 'cannot-in');

		const blocked = await seedArchivedEmail(db(), {
			ingestionSourceId: blockedSource.id,
			userEmail: 'blocked@journaling.test.invalid',
		});
		const allowed = await seedArchivedEmail(db(), {
			ingestionSourceId: allowedSource.id,
			userEmail: 'allowed@journaling.test.invalid',
		});

		const { drizzleFilter, searchFilter } = await build(principal.userId, 'archive', 'read');

		// The Meilisearch half is deterministic and needs no engine to observe.
		expect(searchFilter).toContain('[object Object]');

		// The Drizzle half binds the operator object as a parameter.
		const rendered = renderSql(drizzleFilter);
		expect(rendered?.sql).toBe('not "ingestion_source_id" = $1');
		expect(rendered?.params).toEqual([{ $in: [blockedSource.id] }]);

		// Observable outcome: either Postgres rejects the statement, or the blocked row is not
		// excluded. What must never happen is the exclusion quietly working -- if it did, this
		// assertion fails and the finding is obsolete.
		let outcome: 'error' | string[];
		try {
			const rows = await db()
				.select({ id: archivedEmails.id })
				.from(archivedEmails)
				.where(and(drizzleFilter, inArray(archivedEmails.id, [blocked, allowed])));
			outcome = rows.map((row) => row.id).sort();
		} catch {
			outcome = 'error';
		}
		const exclusionWorked = Array.isArray(outcome) && outcome.join() === [allowed].join();
		expect(
			exclusionWorked,
			`F8 appears fixed: the cannot/$in exclusion now returns exactly the allowed row ` +
				`(${JSON.stringify(outcome)}). Invert this expectation and close F8.`
		).toBe(false);
	});

	/**
	 * FINDING F3 at integration level (see 09-befunde-bestandscode.md).
	 *
	 * The question JR-104 was asked to answer: what does `FilterBuilder` *actually* return when a
	 * policy condition cannot be translated? Answer: it does not return anything -- it rejects,
	 * and not because the Drizzle path is safe.
	 *
	 * `mongoToDrizzle` drops the untranslatable branch and yields `undefined` (= no filter =
	 * unrestricted, F3). `mongoToMeli` throws on an unknown operator. Because
	 * `FilterBuilder.create()` builds both halves in one object literal and awaits the Meili half,
	 * the throw wins and the caller sees an exception. The fail-closed behaviour of the whole is
	 * therefore load-bearing on the strictness of the *search* translator: make `mongoToMeli`
	 * lenient, or give a caller a drizzle-only path that skips it, and the same policy silently
	 * becomes unrestricted.
	 */
	it('FINDING F3: an untranslatable condition makes create() throw, via the Meili half only', async () => {
		coverageNotice(
			'FINDING F3 (integration view, JR-104): for an untranslatable policy condition ' +
				'mongoToDrizzle() yields undefined (unrestricted) while mongoToMeli() throws. ' +
				'FilterBuilder.create() therefore rejects -- fail-closed by accident, resting entirely ' +
				'on the search translator staying strict.'
		);
		const conditions = { subject: { $regex: 'confidential' } };
		const policies: CaslPolicy[] = [{ action: 'read', subject: 'archive', conditions }];
		const principal = await seedPrincipal(db(), policies, 'regex');

		await expect(build(principal.userId, 'archive', 'read')).rejects.toThrow(
			/unsupported operator "\$regex"/
		);

		// And the half that would have been returned had the Meili translator been lenient:
		// `undefined`, i.e. no restriction at all.
		expect(mongoToDrizzle!({ $or: [conditions] })).toBeUndefined();
	});
});
