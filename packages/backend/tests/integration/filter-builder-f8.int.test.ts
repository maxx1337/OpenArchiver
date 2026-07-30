import { expect, it } from 'vitest';
import { and, inArray } from 'drizzle-orm';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import { coverageNotice } from '@oa-test/notice';
import type { CaslPolicy } from '@open-archiver/types';
import { acquireTestDatabase, loadBackendDatabaseSingleton } from '../support/pg-harness';
import { redUntil } from '../support/fail-closed';
import { seedArchivedEmail, seedIngestionSource, seedPrincipal } from '../support/iam-seed';
import { archivedEmails } from '../../src/database/schema';

/**
 * FINDING F8 regression -- a `cannot` rule whose condition value is an operator object must
 * actually exclude (JR-1301, epic E13). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * The defect
 * ---------------------------------------------------------------------------------------------
 * When an unconditional `can` meets `cannot` rules, `FilterBuilder.ts:39-46` builds the exclusion
 * by wrapping each condition **value** in `$ne`:
 *
 *     newCondition[key] = { $ne: (condition as any)[key] };
 *
 * If the value is itself an operator object -- `{ $in: [...] }`, `{ $gte: n }` -- the result is
 * `{ $ne: { $in: [...] } }`. Neither translator understands it: `mongoToDrizzle` binds the operator
 * object as a *query parameter* (`not "ingestion_source_id" = $1` with `$1 = { "$in": [...] }`,
 * which Postgres rejects with `invalid input syntax for type uuid: "[object Object]"`), and
 * `mongoToMeli` interpolates it as the string `[object Object]`. The exclusion the policy author
 * wrote does not happen. Every expressive `cannot` condition is affected -- `$in`, `$nin`, `$gte`, ...
 *
 * Required behaviour (`JR-1305`): "`cannot ... { $in: [...] }` schließt tatsächlich aus, in Drizzle
 * **und** im Meili-Filter."
 *
 * ---------------------------------------------------------------------------------------------
 * How this file differs from its predecessor
 * ---------------------------------------------------------------------------------------------
 * The old `FINDING F8` test in `filter-builder.int.test.ts` asserted
 * `expect(searchFilter).toContain('[object Object]')` and
 * `expect(exclusionWorked).toBe(false)` -- it demanded that the defect still be present. Here the
 * assertions are inverted: the blocked row must be gone and the allowed row must remain. RED until
 * `JR-1305`.
 *
 * The assertion is on rows, plus one on the emitted Meilisearch filter string. The Meili half has
 * no engine in this environment, so it is checked structurally: the filter must not contain
 * `[object Object]`, and it must still name the blocked id. That is weaker than running
 * Meilisearch and is stated as such rather than left implicit.
 */

const postgresProbe = await probePostgres();

const enabled = postgresProbe.available && isClassSelected('ci');
const harness = enabled ? await acquireTestDatabase('fb-f8') : undefined;
if (harness) {
	harness.bindAsProcessDatabaseUrl();
	await loadBackendDatabaseSingleton();
}
const FilterBuilder = harness
	? (await import('../../src/services/FilterBuilder')).FilterBuilder
	: undefined;

suiteRequiring(
	'ci',
	'FilterBuilder `cannot` exclusion -- FINDING F8 (JR-1301)',
	postgresProbe,
	() => {
		const db = () => harness!.db;

		interface Scenario {
			blocked: string;
			allowed: string;
			blockedSourceId: string;
			allowedSourceId: string;
			userId: string;
		}

		/** `can read archive` (unconditional) plus one `cannot` rule carrying `conditions`. */
		async function seedScenario(
			label: string,
			cannotConditions: (blockedSourceId: string) => Record<string, unknown>
		): Promise<Scenario> {
			const blockedSource = await seedIngestionSource(db(), { userId: null });
			const allowedSource = await seedIngestionSource(db(), { userId: null });
			const policies: CaslPolicy[] = [
				{ action: 'read', subject: 'archive' },
				{
					inverted: true,
					action: 'read',
					subject: 'archive',
					conditions: cannotConditions(blockedSource.id) as CaslPolicy['conditions'],
				},
			];
			const principal = await seedPrincipal(db(), policies, label);
			return {
				blockedSourceId: blockedSource.id,
				allowedSourceId: allowedSource.id,
				userId: principal.userId,
				blocked: await seedArchivedEmail(db(), {
					ingestionSourceId: blockedSource.id,
					userEmail: 'blocked@journaling.test.invalid',
				}),
				allowed: await seedArchivedEmail(db(), {
					ingestionSourceId: allowedSource.id,
					userEmail: 'allowed@journaling.test.invalid',
				}),
			};
		}

		/**
		 * Which of the two seeded rows survive the filter. A statement Postgres refuses is reported as
		 * `'postgres-error'`, because "the query 500s" is a third outcome and must not be confused with
		 * either a working or a broken exclusion.
		 */
		async function survivors(
			filter: Parameters<typeof and>[0],
			scenario: Scenario
		): Promise<string[] | 'postgres-error'> {
			try {
				const rows = await db()
					.select({ id: archivedEmails.id })
					.from(archivedEmails)
					.where(
						and(
							filter,
							inArray(archivedEmails.id, [scenario.blocked, scenario.allowed])
						)
					);
				return rows.map((row) => row.id).sort();
			} catch {
				return 'postgres-error';
			}
		}

		it('a scalar `cannot` condition already excludes correctly -- the counter-check', async () => {
			// Green before and after JR-1305. The `$ne`-wrapping is only wrong for operator objects; a
			// plain value works, and the fix must keep it working.
			const scenario = await seedScenario('cannot-scalar', (blockedSourceId) => ({
				ingestionSourceId: blockedSourceId,
			}));
			const { drizzleFilter, searchFilter } = await FilterBuilder!.create(
				scenario.userId,
				'archive',
				'read'
			);
			expect(await survivors(drizzleFilter, scenario)).toEqual([scenario.allowed]);
			expect(searchFilter).not.toContain('[object Object]');
		});

		it(redUntil('JR-1305', 'cannot + $in actually excludes the blocked rows'), async () => {
			coverageNotice(
				'FINDING F8 regression (JR-1301): FilterBuilder wraps `cannot` condition values in ' +
					'{ $ne: value } regardless of the value being an operator object, so ' +
					'`cannot ... { $in: [...] }` becomes { $ne: { $in: [...] } }. Expected RED until ' +
					'JR-1305. The Meilisearch half is checked structurally -- no Meilisearch in this ' +
					'environment.'
			);
			const scenario = await seedScenario('cannot-in', (blockedSourceId) => ({
				ingestionSourceId: { $in: [blockedSourceId] },
			}));
			const { drizzleFilter, searchFilter } = await FilterBuilder!.create(
				scenario.userId,
				'archive',
				'read'
			);

			expect(
				await survivors(drizzleFilter, scenario),
				`the cannot/$in exclusion must return exactly the allowed row. 'postgres-error' means ` +
					`the operator object was bound as a query parameter (F8); [blocked, allowed] means ` +
					`the exclusion did not happen at all.`
			).toEqual([scenario.allowed]);

			expect(
				searchFilter,
				'the Meilisearch filter stringified the operator object (F8, search half)'
			).not.toContain('[object Object]');
			expect(
				searchFilter,
				'the Meilisearch filter must still mention the excluded source id, otherwise the ' +
					'exclusion is missing on the search path'
			).toContain(scenario.blockedSourceId);
		});

		it(
			redUntil('JR-1305', 'cannot + $nin excludes everything outside the listed ids'),
			async () => {
				// `cannot read archive where ingestionSourceId $nin [allowed]` = "deny everything except the
				// allowed source". The complement form, so a fix that special-cases `$in` alone is caught.
				const blockedSource = await seedIngestionSource(db(), { userId: null });
				const allowedSource = await seedIngestionSource(db(), { userId: null });
				const policies: CaslPolicy[] = [
					{ action: 'read', subject: 'archive' },
					{
						inverted: true,
						action: 'read',
						subject: 'archive',
						conditions: {
							ingestionSourceId: { $nin: [allowedSource.id] },
						} as CaslPolicy['conditions'],
					},
				];
				const principal = await seedPrincipal(db(), policies, 'cannot-nin');
				const scenario: Scenario = {
					blockedSourceId: blockedSource.id,
					allowedSourceId: allowedSource.id,
					userId: principal.userId,
					blocked: await seedArchivedEmail(db(), {
						ingestionSourceId: blockedSource.id,
						userEmail: 'blocked-nin@journaling.test.invalid',
					}),
					allowed: await seedArchivedEmail(db(), {
						ingestionSourceId: allowedSource.id,
						userEmail: 'allowed-nin@journaling.test.invalid',
					}),
				};

				const { drizzleFilter } = await FilterBuilder!.create(
					scenario.userId,
					'archive',
					'read'
				);
				expect(await survivors(drizzleFilter, scenario)).toEqual([scenario.allowed]);
			}
		);

		it(
			redUntil('JR-1305', 'cannot + $gte on a numeric column excludes the matching rows'),
			async () => {
				// A non-uuid column, so the finding is not read as a uuid-casting quirk: `size_bytes` is an
				// integer and `{ $ne: { $gte: n } }` is just as wrong there.
				const source = await seedIngestionSource(db(), { userId: null });
				const policies: CaslPolicy[] = [
					{ action: 'read', subject: 'archive' },
					{
						inverted: true,
						action: 'read',
						subject: 'archive',
						conditions: { sizeBytes: { $gte: 10_000 } } as CaslPolicy['conditions'],
					},
				];
				const principal = await seedPrincipal(db(), policies, 'cannot-gte');
				const big = await seedArchivedEmail(db(), {
					ingestionSourceId: source.id,
					userEmail: 'big@journaling.test.invalid',
					sizeBytes: 50_000,
				});
				const small = await seedArchivedEmail(db(), {
					ingestionSourceId: source.id,
					userEmail: 'small@journaling.test.invalid',
					sizeBytes: 100,
				});

				const { drizzleFilter } = await FilterBuilder!.create(
					principal.userId,
					'archive',
					'read'
				);
				let visible: string[] | 'postgres-error';
				try {
					const rows = await db()
						.select({ id: archivedEmails.id })
						.from(archivedEmails)
						.where(and(drizzleFilter, inArray(archivedEmails.id, [big, small])));
					visible = rows.map((row) => row.id).sort();
				} catch {
					visible = 'postgres-error';
				}
				expect(visible, 'the >= 10000 bytes rows must be excluded').toEqual([small]);
			}
		);
	}
);
