import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { rulesToQuery } from '@casl/ability/extra';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import { coverageNotice } from '@oa-test/notice';
import type { AppActions, AppSubjects } from '@open-archiver/types';
import type { AppAbility } from '../../src/iam-policy/ability';
import { acquireTestDatabase, loadBackendDatabaseSingleton } from '../support/pg-harness';
import { renderSql } from '../support/render-sql';
import { seedArchivedEmail, seedIngestionSource } from '../support/iam-seed';
import {
	archivedEmails,
	ingestionSources,
	roles,
	userRoles,
	users,
} from '../../src/database/schema';

/**
 * The three shipped `predefined_*` roles against real Postgres (JR-13-01, epic E13).
 * Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * What this file is for
 * ---------------------------------------------------------------------------------------------
 * ADR-017 (2026-07-29) and the F7 entry in `09-befunde-bestandscode.md` both assert:
 *
 *   > Keine dieser drei Rollen erreicht den `null`-Zweig in `FilterBuilder.ts:49` -- weder vor noch
 *   > nach der Änderung. Der Nachweis dafür ist der Integrationstest aus `JR-13-01`, nicht diese
 *   > Tabelle.
 *
 * This is that test. The assertion was derived by reading `createDefaultRoles` and
 * `UserService.createAdminRole()`; a derivation is not a proof, and the whole release note in
 * `JR-13-07` ("no shipped role is affected") rests on it.
 *
 * ---------------------------------------------------------------------------------------------
 * Two independent halves
 * ---------------------------------------------------------------------------------------------
 *  1. **The branch probe.** From outside, `FilterBuilder.ts:31` ("unconditional can", intended full
 *     access) and `FilterBuilder.ts:49` (the F7 defect) return the *same* value --
 *     `{ undefined, undefined }` -- so no black-box assertion can tell them apart *today*. The
 *     probe below therefore re-derives the branch from the real ability, using the same
 *     `rulesFor` / `rulesToQuery` calls `FilterBuilder` uses, and reports which branch each role
 *     lands in. The duplication of the branch logic is deliberate and is what makes it an
 *     independent measurement rather than a tautology; it describes `rulesToQuery`'s output, which
 *     `JR-13-02` does not change, so it stays valid after the fix.
 *
 *  2. **The behavioural snapshot.** The exact filter and the exact rows for each role, for both
 *     `read` and `search`. Green today; it must stay green after `JR-13-02` and `JR-13-03`. This is
 *     the regression net for "a standard installation behaves identically before and after".
 *     The strongest form of ADR-017's impact claim is asserted directly: for every predefined role,
 *     the result for `('archive','read')` and for `('archive','search')` is **the same**. If that
 *     holds, changing `SearchService`'s third argument from `'read'` to `'search'` cannot change
 *     what a standard installation sees.
 *
 * ---------------------------------------------------------------------------------------------
 * The roles come from production code, not from a copy
 * ---------------------------------------------------------------------------------------------
 * `UserService.createAdminRole()` is public and is called directly. `createDefaultRoles` is a
 * private field of `IamController` and is reached the way the application reaches it: through
 * `IamController.getRoles()`, whose trigger is "no role whose slug contains `predefined_`". It
 * swallows its own errors (`catch { logger.error(...) }`), so the roles are verified against the
 * `roles` table afterwards and a missing one fails loudly instead of producing an empty test.
 */

const postgresProbe = await probePostgres();

const enabled = postgresProbe.available && isClassSelected('ci');
const harness = enabled ? await acquireTestDatabase('predef-roles') : undefined;
if (harness) {
	harness.bindAsProcessDatabaseUrl();
	await loadBackendDatabaseSingleton();
}
const FilterBuilder = harness
	? (await import('../../src/services/FilterBuilder')).FilterBuilder
	: undefined;
const IamService = harness ? (await import('../../src/services/IamService')).IamService : undefined;
const IamController = harness
	? (await import('../../src/api/controllers/iam.controller')).IamController
	: undefined;
const UserService = harness
	? (await import('../../src/services/UserService')).UserService
	: undefined;

/** The slugs the application ships. Anything else here is a change of product behaviour. */
const PREDEFINED_SLUGS = [
	'predefined_super_admin',
	'predefined_end_user',
	'predefined_read_only_user',
] as const;
type PredefinedSlug = (typeof PREDEFINED_SLUGS)[number];

/**
 * The (subject, action) pairs any `FilterBuilder.create()` call site in the repository asks for.
 * Enumerated in ADR-017; the inventory itself is asserted in
 * `tests/unit/filter-builder-call-sites.test.ts`.
 */
const CALL_SITE_PAIRS: ReadonlyArray<{ subject: AppSubjects; action: AppActions; where: string }> =
	[
		{ subject: 'archive', action: 'read', where: 'ArchivedEmailService.ts:62' },
		{ subject: 'archive', action: 'search', where: 'SearchService.ts:311/:423 after JR-13-03' },
		{ subject: 'ingestion', action: 'read', where: 'IngestionService.ts:137' },
	];

const ALL_SUBJECTS: readonly AppSubjects[] = [
	'archive',
	'ingestion',
	'settings',
	'users',
	'roles',
	'dashboard',
	'all',
];
const ALL_ACTIONS: readonly AppActions[] = [
	'manage',
	'create',
	'read',
	'update',
	'delete',
	'search',
	'export',
	'sync',
];

type Branch = 'unconditional-can' | 'null-branch' | 'empty-query-deny' | 'translated-query';

/**
 * Minimal Express doubles for `IamController.getRoles()`. It reads nothing off the request except
 * `t` (used only on the error path) and calls `res.status(...).json(...)` once.
 */
const stubRequest = () => ({ t: (key: string) => key }) as never;
const stubResponse = () =>
	({
		status: () => ({ json: () => undefined, send: () => undefined }),
	}) as never;

suiteRequiring(
	'ci',
	'The three shipped predefined_* roles (ADR-017 impact, JR-13-01)',
	postgresProbe,
	() => {
		const db = () => harness!.db;

		/**
		 * Re-derive which branch of `FilterBuilder.create()` a given ability lands in.
		 * Mirrors `packages/backend/src/services/FilterBuilder.ts` lines 22-55 as of `efea6bc`.
		 */
		function classifyBranch(
			ability: AppAbility,
			action: AppActions,
			subject: AppSubjects
		): Branch {
			const rules = ability.rulesFor(action, subject as never);
			const hasUnconditionalCan = rules.some(
				(rule) => rule.inverted === false && !rule.conditions
			);
			const cannotConditions = rules.filter(
				(rule) => rule.inverted === true && rule.conditions
			);
			if (hasUnconditionalCan && cannotConditions.length === 0) {
				return 'unconditional-can';
			}
			let query = rulesToQuery(
				ability,
				action,
				subject as never,
				(rule) => rule.conditions
			) as Record<string, unknown> | null;
			if (hasUnconditionalCan && cannotConditions.length > 0) {
				query = { $and: [] };
			}
			if (query === null) {
				return 'null-branch';
			}
			return Object.keys(query).length === 0 ? 'empty-query-deny' : 'translated-query';
		}

		/**
		 * Create the shipped roles through production code and attach one user to each.
		 *
		 * **The order matters and is not the order a real installation uses.**
		 * `IamController.getRoles()` bootstraps the two default roles only while *no* role whose
		 * slug contains `predefined_` exists (`iam.controller.ts:17`). `createAdminRole()` creates
		 * `predefined_super_admin`, so calling it first permanently disables that bootstrap. Here
		 * `getRoles()` therefore runs first, purely so that this file has all three roles to test.
		 * The production consequence of the real order is finding **F17** and has its own test
		 * below.
		 */
		async function seedShippedRoles(): Promise<Record<PredefinedSlug, string>> {
			const iamService = new IamService!();

			// Every test in this file shares one database, and the bootstrap is a one-shot guarded by
			// "does any predefined_ role already exist". Resetting makes each test independent of the
			// order vitest happens to run them in -- including of the F17 test below, which leaves
			// only `predefined_super_admin` behind and would otherwise starve every later test.
			await db().delete(userRoles);
			await db().delete(roles);

			// predefined_end_user + predefined_read_only_user, through the real trigger.
			await new IamController!(iamService).getRoles(stubRequest(), stubResponse());
			// predefined_super_admin
			await new UserService!().createAdminRole();

			const created = await db().select().from(roles);
			const bySlug = new Map(created.map((role) => [role.slug, role]));
			const missing = PREDEFINED_SLUGS.filter((slug) => !bySlug.has(slug));
			expect(
				missing,
				`the production role bootstrap did not create every predefined role. ` +
					`createDefaultRoles() catches its own errors and only logs, so a silent failure ` +
					`here would otherwise produce a green but empty test. Roles found: ` +
					`${created.map((role) => role.slug).join(', ') || '<none>'}`
			).toEqual([]);

			const userIdBySlug = {} as Record<PredefinedSlug, string>;
			const suffix = randomUUID().slice(0, 8);
			for (const slug of PREDEFINED_SLUGS) {
				const [user] = await db()
					.insert(users)
					.values({
						// Randomised: every test in this file seeds its own users into the same
						// database, and `users.email` is unique.
						email: `${slug}-${suffix}@journaling.test.invalid`,
						first_name: 'Predefined',
						last_name: slug,
					})
					.returning();
				await db()
					.insert(userRoles)
					.values({ userId: user!.id, roleId: bySlug.get(slug)!.id });
				userIdBySlug[slug] = user!.id;
			}
			return userIdBySlug;
		}

		/**
		 * FINDING F17 -- in the order a real installation uses, two of the three "shipped" roles are
		 * never created.
		 *
		 * `createFirstAdmin()` (`UserService.ts:231`) calls `createAdminRole()` during initial setup,
		 * which inserts the role with slug `predefined_super_admin`. From then on the guard in
		 * `IamController.getRoles()` --
		 *
		 *     if (!roles.some((r) => r.slug?.includes('predefined_'))) { await this.createDefaultRoles(); }
		 *
		 * -- is false forever, because `'predefined_super_admin'.includes('predefined_')` is true. And
		 * `getRoles` is the only caller of `createDefaultRoles`, behind `requireAuth`, so it cannot
		 * run before setup either. `predefined_end_user` and `predefined_read_only_user` are
		 * therefore unreachable in any installation that went through the normal setup flow.
		 *
		 * **This test asserts the observed behaviour, not the desired one, and that is a deliberate
		 * exception to `JR-13-01`'s rule.** F17 is not one of E13's four findings; there is no task to
		 * fix it, so a red test here would leave the epic branch red for something nobody is
		 * assigned, and it would block the `JR-13-09` acceptance for the wrong reason. The finding is
		 * filed in `09-befunde-bestandscode.md` for the PO to schedule. What the assertion does buy:
		 * the moment someone fixes the guard, this test goes red and points at the finding.
		 */
		it('OBSERVED (F17): the real setup order leaves the two default roles uncreated', async () => {
			// Fresh database for this file, and this test runs before any other seeding in it? No --
			// order is not guaranteed, so the guard is reproduced explicitly instead of relying on an
			// empty table.
			await db().delete(userRoles);
			await db().delete(roles);

			// 1. Initial setup, as `createFirstAdmin()` does it.
			await new UserService!().createAdminRole();
			// 2. Any later authenticated GET /roles.
			await new IamController!(new IamService!()).getRoles(stubRequest(), stubResponse());

			const slugs = (await db().select().from(roles)).map((role) => role.slug).sort();
			coverageNotice(
				`FINDING F17 (JR-13-01): after the production setup order (createAdminRole() then ` +
					`GET /roles) the roles table contains only [${slugs.join(', ')}]. ` +
					`predefined_end_user and predefined_read_only_user are never created, because ` +
					`createAdminRole() already satisfies the "any predefined_ slug exists" guard at ` +
					`iam.controller.ts:17. ADR-017's impact analysis reasons about three shipped roles; ` +
					`in practice a standard installation has one. Not an E13 finding -- pinned, filed, ` +
					`not fixed here.`
			);
			expect(slugs).toEqual(['predefined_super_admin']);
			expect(slugs).not.toContain('predefined_end_user');
			expect(slugs).not.toContain('predefined_read_only_user');
		});

		it('creates all three roles through the production bootstrap', async () => {
			const userIdBySlug = await seedShippedRoles();
			expect(Object.keys(userIdBySlug).sort()).toEqual([...PREDEFINED_SLUGS].sort());

			// Pin the shipped policy content. If a future change adds or removes a statement, the
			// impact analysis in ADR-017 has to be redone -- this is the tripwire for that.
			const stored = await db()
				.select()
				.from(roles)
				.where(eq(roles.slug, 'predefined_end_user'));
			expect(stored[0]!.policies).toEqual([
				{ action: 'read', subject: 'dashboard' },
				{ action: 'create', subject: 'ingestion' },
				{ action: 'manage', subject: 'ingestion', conditions: { userId: '${user.id}' } },
				{
					action: 'manage',
					subject: 'archive',
					conditions: { 'ingestionSource.userId': '${user.id}' },
				},
			]);
			const readOnly = await db()
				.select()
				.from(roles)
				.where(eq(roles.slug, 'predefined_read_only_user'));
			expect(readOnly[0]!.policies).toEqual([
				{
					action: ['read', 'search'],
					subject: ['ingestion', 'archive', 'dashboard', 'users', 'roles'],
				},
			]);
			const superAdmin = await db()
				.select()
				.from(roles)
				.where(eq(roles.slug, 'predefined_super_admin'));
			expect(superAdmin[0]!.policies).toEqual([{ action: 'manage', subject: 'all' }]);
		});

		it("ADR-017's claim: no predefined role reaches the null branch at any call site", async () => {
			const userIdBySlug = await seedShippedRoles();
			const iamService = new IamService!();

			const table: string[] = [];
			for (const slug of PREDEFINED_SLUGS) {
				const ability = await iamService.getAbilityForUser(userIdBySlug[slug]);
				for (const pair of CALL_SITE_PAIRS) {
					const branch = classifyBranch(ability, pair.action, pair.subject);
					table.push(
						`${slug} / ${pair.action} ${pair.subject} -> ${branch} (${pair.where})`
					);
					expect(
						branch,
						`${slug} reaches the F7 null branch for (${pair.action}, ${pair.subject}), used ` +
							`at ${pair.where}. ADR-017 and 09-befunde-bestandscode.md both state that no ` +
							`shipped role does, and JR-13-07's release note is written on that basis. If ` +
							`this assertion fails, ADR-017's impact analysis is wrong and JR-13-07 must go ` +
							`back to the unqualified warning.`
					).not.toBe('null-branch');
				}
			}
			coverageNotice(
				`ADR-017 branch probe (JR-13-01), FilterBuilder call sites only:\n  ` +
					table.join('\n  ')
			);
		});

		it("states the exact scope of ADR-017's claim over the whole action/subject matrix", async () => {
			// The claim in ADR-017 and in the F7 entry is worded per *role* ("Keine dieser drei Rollen
			// erreicht den null-Zweig"), but it only holds for the (action, subject) pairs the four
			// call sites actually use. Over the full 8x7 vocabulary every one of the three roles has
			// combinations with no matching rule, and those do reach the branch. That is harmless
			// today because nothing builds a filter for them -- and it is exactly the kind of
			// unstated precondition that becomes wrong when someone adds a fifth call site.
			// Recorded as finding F18. This test asserts the measurement, not a judgement.
			const userIdBySlug = await seedShippedRoles();
			const iamService = new IamService!();
			const reaching: Record<string, string[]> = {};
			for (const slug of PREDEFINED_SLUGS) {
				const ability = await iamService.getAbilityForUser(userIdBySlug[slug]);
				reaching[slug] = [];
				for (const subject of ALL_SUBJECTS) {
					for (const action of ALL_ACTIONS) {
						if (classifyBranch(ability, action, subject) === 'null-branch') {
							reaching[slug]!.push(`${action} ${subject}`);
						}
					}
				}
			}
			coverageNotice(
				`ADR-017 scope (JR-13-01, finding F18): over the full ${ALL_ACTIONS.length}x` +
					`${ALL_SUBJECTS.length} action/subject vocabulary the predefined roles DO reach the ` +
					`FilterBuilder null branch for: ` +
					PREDEFINED_SLUGS.map(
						(slug) => `${slug}: ${reaching[slug]!.length} pair(s)`
					).join(' | ') +
					`. ADR-017's claim is only true for the three pairs the current call sites use. ` +
					`predefined_super_admin: ${reaching.predefined_super_admin!.join(', ') || 'none'}`
			);
			// Super Admin (`manage all`) is the one role for which the claim holds unconditionally.
			expect(
				reaching.predefined_super_admin,
				'manage all must be an unconditional can for every action/subject pair'
			).toEqual([]);
			// The other two do have such pairs; asserted so that the finding cannot silently vanish.
			expect(reaching.predefined_end_user!.length).toBeGreaterThan(0);
			expect(reaching.predefined_read_only_user!.length).toBeGreaterThan(0);
		});

		it('super admin and read-only see everything, unconditionally, for read and search', async () => {
			const userIdBySlug = await seedShippedRoles();
			const source = await seedIngestionSource(db(), { userId: null });
			const email = await seedArchivedEmail(db(), {
				ingestionSourceId: source.id,
				userEmail: 'anyone@journaling.test.invalid',
			});

			for (const slug of ['predefined_super_admin', 'predefined_read_only_user'] as const) {
				for (const action of ['read', 'search'] as const) {
					const result = await FilterBuilder!.create(
						userIdBySlug[slug],
						'archive',
						action
					);
					expect(result.drizzleFilter, `${slug} / archive / ${action}`).toBeUndefined();
					expect(result.searchFilter, `${slug} / archive / ${action}`).toBeUndefined();
					const rows = await db()
						.select({ id: archivedEmails.id })
						.from(archivedEmails)
						.where(and(result.drizzleFilter, inArray(archivedEmails.id, [email])));
					expect(
						rows.map((row) => row.id),
						`${slug} / archive / ${action}`
					).toEqual([email]);
				}
				const ingestion = await FilterBuilder!.create(
					userIdBySlug[slug],
					'ingestion',
					'read'
				);
				expect(ingestion.drizzleFilter, `${slug} / ingestion / read`).toBeUndefined();
			}
		});

		it('the end user is scoped to their own sources, for read and search alike', async () => {
			const userIdBySlug = await seedShippedRoles();
			const endUser = userIdBySlug.predefined_end_user;

			const mine = await seedIngestionSource(db(), { userId: endUser });
			const theirs = await seedIngestionSource(db(), {
				userId: userIdBySlug.predefined_read_only_user,
			});
			const myEmail = await seedArchivedEmail(db(), {
				ingestionSourceId: mine.id,
				userEmail: 'mine@journaling.test.invalid',
			});
			const theirEmail = await seedArchivedEmail(db(), {
				ingestionSourceId: theirs.id,
				userEmail: 'theirs@journaling.test.invalid',
			});

			// `manage archive` with `ingestionSource.userId` -- the relation branch of mongoToDrizzle,
			// so the query needs the join partner in scope.
			for (const action of ['read', 'search'] as const) {
				const { drizzleFilter, searchFilter } = await FilterBuilder!.create(
					endUser,
					'archive',
					action
				);
				expect(renderSql(drizzleFilter)?.sql, `archive / ${action}`).toBe(
					'"ingestion_sources"."user_id" = $1'
				);
				expect(renderSql(drizzleFilter)?.params, `archive / ${action}`).toEqual([endUser]);
				expect(searchFilter, `archive / ${action}`).toBe(
					`(ingestionSourceId IN ["${mine.id}"])`
				);

				const rows = await db()
					.select({ id: archivedEmails.id })
					.from(archivedEmails)
					.innerJoin(
						ingestionSources,
						eq(archivedEmails.ingestionSourceId, ingestionSources.id)
					)
					.where(and(drizzleFilter, inArray(archivedEmails.id, [myEmail, theirEmail])));
				expect(
					rows.map((row) => row.id),
					`archive / ${action}`
				).toEqual([myEmail]);
			}

			const ingestion = await FilterBuilder!.create(endUser, 'ingestion', 'read');
			expect(renderSql(ingestion.drizzleFilter)?.sql).toBe('"user_id" = $1');
			const sources = await db()
				.select({ id: ingestionSources.id })
				.from(ingestionSources)
				.where(
					and(ingestion.drizzleFilter, inArray(ingestionSources.id, [mine.id, theirs.id]))
				);
			expect(sources.map((row) => row.id)).toEqual([mine.id]);
		});

		it("ADR-017's impact claim: read and search give byte-identical results for all three roles", async () => {
			// This is the assertion that settles "eine Standardinstallation verhält sich vor und nach
			// dem F7-Fix identisch" for the ADR-017 change specifically. `JR-13-03` swaps `'read'` for
			// `'search'` at two call sites; if the two produce the same filter for every shipped
			// role, that swap is a no-op for a standard installation, whatever JR-13-02 does to the
			// null branch.
			const userIdBySlug = await seedShippedRoles();
			const differences: string[] = [];
			for (const slug of PREDEFINED_SLUGS) {
				const asRead = await FilterBuilder!.create(userIdBySlug[slug], 'archive', 'read');
				const asSearch = await FilterBuilder!.create(
					userIdBySlug[slug],
					'archive',
					'search'
				);
				const left = JSON.stringify({
					drizzle: renderSql(asRead.drizzleFilter) ?? null,
					search: asRead.searchFilter ?? null,
				});
				const right = JSON.stringify({
					drizzle: renderSql(asSearch.drizzleFilter) ?? null,
					search: asSearch.searchFilter ?? null,
				});
				if (left !== right) {
					differences.push(`${slug}: read=${left} search=${right}`);
				}
			}
			expect(
				differences,
				`ADR-017 claims switching SearchService from ('archive','read') to ` +
					`('archive','search') changes nothing for the shipped roles. These roles differ, so ` +
					`the claim is wrong and the release note in JR-13-07 has to say so.`
			).toEqual([]);
		});
	}
);
