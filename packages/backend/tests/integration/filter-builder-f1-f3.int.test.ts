import { expect, it } from 'vitest';
import { and, inArray } from 'drizzle-orm';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import { coverageNotice } from '@oa-test/notice';
import type { CaslPolicy } from '@open-archiver/types';
import { acquireTestDatabase, loadBackendDatabaseSingleton } from '../support/pg-harness';
import { classifyFilter, expectFailClosed, redUntil } from '../support/fail-closed';
import { seedArchivedEmail, seedIngestionSource, seedPrincipal } from '../support/iam-seed';
import { archivedEmails } from '../../src/database/schema';

/**
 * FINDINGS F1 and F3 regression -- against real rows in real Postgres (JR-13-01, epic E13).
 * Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why these two belong in the integration suite as well as in the unit suite
 * ---------------------------------------------------------------------------------------------
 * The unit tests in `src/helpers/mongoToDrizzle.test.ts` assert what the translator *emits*. That
 * is necessary but it is not the contract. Two claims can only be settled by executing the
 * statement:
 *
 *   - **F1 is exploitable, not just ugly.** The rendered predicate for a hostile condition key has
 *     to *parse and evaluate* in Postgres before "SQL injection" is more than a rendering
 *     curiosity. The key used below produces
 *     `"user_email" is not null or "id" is not null --" = $1`, where the injected `or` binds at
 *     boolean level and `--` comments the rest away. It type-checks, it runs, and it turns a policy
 *     scoped to one mailbox into a policy that returns every row. The commonly quoted
 *     `id" or 1=1 --` does **not** run (`text or boolean` is a type error in Postgres) -- worth
 *     recording, because "it errors out" would otherwise be mistaken for a mitigation.
 *
 *   - **F3's fail-open is load-bearing on `mongoToMeli`.** `FilterBuilder.create()` builds both
 *     halves in one object literal and awaits the Meili half, so `mongoToMeli`'s throw is what
 *     makes the whole call reject. Before `JR-13-04` the Drizzle half on its own was fail-open --
 *     measured, with rows -- so any future caller that skips the search translator, or any lenient
 *     rewrite of it, silently made the same policy unrestricted. The test below therefore demands
 *     the refusal from `mongoToDrizzle` **alone**, with no Meili call anywhere in it, and executes
 *     whatever it does return against the seeded rows.
 *
 * Both tests are RED until `JR-13-06` (F1) resp. `JR-13-04` (F3).
 */

const postgresProbe = await probePostgres();

const enabled = postgresProbe.available && isClassSelected('ci');
const harness = enabled ? await acquireTestDatabase('fb-f1-f3') : undefined;
if (harness) {
	harness.bindAsProcessDatabaseUrl();
	await loadBackendDatabaseSingleton();
}
const FilterBuilder = harness
	? (await import('../../src/services/FilterBuilder')).FilterBuilder
	: undefined;
const mongoToDrizzle = harness
	? (await import('../../src/helpers/mongoToDrizzle')).mongoToDrizzle
	: undefined;

/**
 * A condition key that actually exposes rows.
 *
 * `getDrizzleColumn()` emits `"<key>"` and the caller appends ` = $1`, so the payload has to leave a
 * *complete, boolean-valued* expression, must not comment anything out, and must end on a column
 * whose type matches the bound value. This one renders
 *
 *     "user_email" is not null or "id" is not null or "user_email" = $1
 *
 * -- always true for any archived e-mail, syntactically balanced, and the trailing comparison is
 * `text = text`.
 *
 * Three payloads that do **not** work are recorded in their own tests below, because mistaking any
 * of them for a mitigation would understate F1:
 *
 *   - `id" or 1=1 --`         -> `"id" or 1=1 --" = $1`: `text or boolean` is a type error.
 *   - anything ending in `"id`-> the trailing `"id" = $1` binds an e-mail to a uuid column: type
 *                                error, even though the injected `or` itself is valid.
 *   - anything with `--`      -> the comment swallows the rest of the single-line statement,
 *                                including the closing parenthesis: syntax error. That is a denial
 *                                of service on every scoped query, not containment.
 */
const EXECUTABLE_INJECTION_KEY = 'userEmail" is not null or "id" is not null or "userEmail';

suiteRequiring(
	'ci',
	'FilterBuilder against Postgres -- FINDINGS F1 and F3 (JR-13-01)',
	postgresProbe,
	() => {
		const db = () => harness!.db;

		/** Rows visible through `filter`, or `'postgres-error'` if the statement was refused. */
		async function visible(
			filter: Parameters<typeof and>[0],
			ids: string[]
		): Promise<string[] | 'postgres-error'> {
			try {
				const rows = await db()
					.select({ id: archivedEmails.id })
					.from(archivedEmails)
					.where(and(filter, inArray(archivedEmails.id, ids)));
				return rows.map((row) => row.id).sort();
			} catch {
				return 'postgres-error';
			}
		}

		async function seedTwoMailboxes(label: string) {
			const source = await seedIngestionSource(db(), { userId: null });
			const mine = await seedArchivedEmail(db(), {
				ingestionSourceId: source.id,
				userEmail: `${label}-mine@journaling.test.invalid`,
			});
			const theirs = await seedArchivedEmail(db(), {
				ingestionSourceId: source.id,
				userEmail: `${label}-theirs@journaling.test.invalid`,
			});
			return { mine, theirs, mineEmail: `${label}-mine@journaling.test.invalid` };
		}

		it(
			redUntil('JR-13-06', 'a hostile condition key cannot widen a scoped policy (F1)'),
			async () => {
				coverageNotice(
					'FINDING F1 regression (JR-13-01): a policy condition key containing SQL syntax is ' +
						'rendered into the WHERE clause unescaped, and the injected predicate executes. ' +
						'Expected RED until JR-13-06. Precondition for exploitation is a principal who ' +
						'may write roles.policies, i.e. Super Admin -- the finding is an escalation from ' +
						'application administrator to arbitrary SQL, not an unauthenticated hole.'
				);
				const rows = await seedTwoMailboxes('f1');
				// A policy that looks like "only my own mailbox" and carries the injection in the key.
				const policies = [
					{
						action: 'read',
						subject: 'archive',
						conditions: { [EXECUTABLE_INJECTION_KEY]: rows.mineEmail },
					},
				] as unknown as CaslPolicy[];
				const principal = await seedPrincipal(db(), policies, 'f1-injection');

				let outcome: string[] | 'postgres-error' | 'rejected';
				try {
					const { drizzleFilter } = await FilterBuilder!.create(
						principal.userId,
						'archive',
						'read'
					);
					outcome = await visible(drizzleFilter, [rows.mine, rows.theirs]);
				} catch {
					outcome = 'rejected';
				}

				// The assertion is on the row the policy does **not** name. Asserting "not equal to
				// both rows" would have been satisfied for the wrong reason: `and()` in drizzle joins
				// its operands without parenthesising them, so `A or B = $1 and id in (...)` parses as
				// `A or (B = $1 and id in (...))` -- the injected `or` escapes the id restriction as
				// well and the query returns every row in the table, which is *not* equal to the two
				// seeded ids. That is the injection succeeding harder, not a pass.
				expect(
					outcome === 'rejected' ||
						outcome === 'postgres-error' ||
						!outcome.includes(rows.theirs),
					`a policy whose condition key injects SQL must not expose a row it does not name. ` +
						`Observed: ${JSON.stringify(outcome)}. Accepted outcomes are 'rejected' ` +
						`(JR-13-06's allowlist refuses the key), 'postgres-error', or a row set without ` +
						`${rows.theirs}.`
				).toBe(true);
			}
		);

		it.each([
			['userEmail" or 1=1 --', 'text or boolean is a Postgres type error'],
			['userEmail" is not null or "id" is not null --', '-- comments away the closing paren'],
			['id" is not null or "id', 'the trailing "id" = $1 binds an e-mail to a uuid column'],
		])(
			'records that the payload %s does not return rows -- and why that is not a mitigation',
			async (key, why) => {
				// Green before and after. Kept so that nobody reads a Postgres error in a log and
				// concludes F1 is contained: it is contained for *these* payloads only, by accident of
				// typing and of statement layout. `EXECUTABLE_INJECTION_KEY` is the same class of key
				// with neither problem, and the test above shows it returning rows it must not.
				const rows = await seedTwoMailboxes('f1-typed');
				const policies = [
					{ action: 'read', subject: 'archive', conditions: { [key]: rows.mineEmail } },
				] as unknown as CaslPolicy[];
				const principal = await seedPrincipal(db(), policies, 'f1-nonexec');
				let outcome: string[] | 'postgres-error' | 'rejected';
				try {
					const { drizzleFilter } = await FilterBuilder!.create(
						principal.userId,
						'archive',
						'read'
					);
					outcome = await visible(drizzleFilter, [rows.mine, rows.theirs]);
				} catch {
					outcome = 'rejected';
				}
				expect(
					['postgres-error', 'rejected'],
					`${key}: expected no rows (${why}), or a refusal once JR-13-06 lands. Observed: ` +
						`${JSON.stringify(outcome)}`
				).toContain(outcome);
			}
		);

		it(
			redUntil(
				'JR-13-04',
				'the Drizzle half alone is fail-closed for an untranslatable condition (F3)'
			),
			async () => {
				coverageNotice(
					'FINDING F3 regression (JR-13-01): mongoToDrizzle() drops an untranslatable ' +
						'condition and returns undefined, which every FilterBuilder caller reads as ' +
						'"no restriction". Today FilterBuilder.create() nevertheless rejects, but only ' +
						'because mongoToMeli() throws -- the fail-closed behaviour of the whole rests on ' +
						'the search translator staying strict. Expected RED until JR-13-04.'
				);
				const rows = await seedTwoMailboxes('f3');
				const untranslatable = { subject: { $regex: 'confidential' } };

				/**
				 * Demand the fail-closed contract from `mongoToDrizzle`, and when it answers with a
				 * deny predicate instead of throwing, execute that predicate against the two seeded
				 * rows.
				 *
				 * Both outcomes `expectFailClosed` accepts are covered that way, and the row check is
				 * what keeps this case in the integration suite: the claim is not merely "the
				 * translator refuses" but "no row is reachable through whatever it returned".
				 */
				async function refusesAndExposesNothing(
					context: string,
					query: Record<string, unknown>
				) {
					const produce = () => mongoToDrizzle!(query);
					expectFailClosed(context, produce);
					const outcome = classifyFilter(produce);
					if (outcome.kind === 'deny') {
						expect(
							await visible(produce(), [rows.mine, rows.theirs]),
							`${context}: the deny predicate ${JSON.stringify(outcome.rendered.sql)} ` +
								`must select no row`
						).toEqual([]);
					}
				}

				// The shape `rulesToQuery` produces for a role with exactly one conditional `can`
				// whose condition cannot be translated: `{ $or: [ <untranslatable> ] }`. Before
				// `JR-13-04`, `or()` over the empty list of surviving branches was `undefined`, so the
				// policy placed no restriction at all -- measured here, against rows. This is the half
				// that reaches `ArchivedEmailService.findAll` (ArchivedEmailService.ts:62) directly:
				// no Meilisearch involved, no throw to save it.
				await refusesAndExposesNothing(
					'a policy consisting solely of an untranslatable condition',
					{ $or: [untranslatable] }
				);

				// The partially translatable disjunction, asserted as a refusal for the same reason
				// rather than as a row set. `JR-13-04`'s criterion is "kein Zweig wird stillschweigend
				// weggelassen"; the expectation `[rows.mine]` that stood here until 2026-07-29 pinned
				// exactly that omission as the wanted result and therefore contradicted the task it
				// was red for. The unit suite states the same requirement on the emitted predicate
				// (mongoToDrizzle.test.ts, "an untranslatable $or branch is not silently dropped").
				//
				// Finding F22 stays worth recording, and it is a measurement rather than a reading of
				// F3's write-up ("erweitert die Disjunktion"): pre-`JR-13-04` this shape rendered
				// `"user_email" = $1`, so dropping a branch from the `$or` of `can` conditions made
				// the filter *narrower*, not wider. The fail-open direction sat in the `$and` of
				// negated `cannot` conditions and in the empty branch list above -- and in this very
				// shape as soon as it is negated: `FilterBuilder` wraps every `cannot` condition in
				// `$not`, and `not (A or U)` losing its second branch renders `not A`, which is true
				// for every row `U` was there to prohibit (measured on the pre-`JR-13-04` translator).
				// "Narrowing" is thus a property of the top-level `can` composition, never of the drop
				// itself, which is why the requirement reads "do not drop it", not "do not widen it".
				await refusesAndExposesNothing('a partially translatable disjunction', {
					$or: [{ userEmail: rows.mineEmail }, untranslatable],
				});
			}
		);

		/**
		 * FINDING F19 -- a `can` rule with an **empty** `conditions` object is unrestricted, and it
		 * does not go through the deny branch that `FilterBuilder` already has.
		 *
		 * Written as a counter-check for the existing "No access" branch (`FilterBuilder.ts:53`,
		 * `Object.keys(query).length === 0` -> ``sql`1=0` ``), and it failed. The reason is a third
		 * empty-ness shape that F3 does not name: `rulesToQuery` pushes the rule's conditions into
		 * `$or` because `{}` is truthy, producing `{ $or: [ {} ] }`. That has one key, so the deny
		 * branch is not taken; `mongoToDrizzle` then translates the single empty branch to nothing
		 * and `or()` over an empty list is `undefined`. Result: full access.
		 *
		 * It belongs to F3's family (untranslatable/empty -> no filter) and to `JR-13-04`'s
		 * criterion, so it is stated as a requirement and is RED until then. Filed separately as
		 * F19 because neither F3 nor F7 names this shape, and a fix for `{}` or `{ $or: [] }` alone
		 * would leave it open.
		 */
		it(
			redUntil(
				'JR-13-04',
				'a can rule with empty conditions must not mean full access (F19)'
			),
			async () => {
				const rows = await seedTwoMailboxes('f3-empty');
				const policies = [
					{ action: 'read', subject: 'archive', conditions: {} },
				] as unknown as CaslPolicy[];
				const principal = await seedPrincipal(db(), policies, 'f3-empty');
				let outcome: string[] | 'postgres-error' | 'rejected';
				try {
					const { drizzleFilter } = await FilterBuilder!.create(
						principal.userId,
						'archive',
						'read'
					);
					outcome = await visible(drizzleFilter, [rows.mine, rows.theirs]);
				} catch {
					outcome = 'rejected';
				}
				coverageNotice(
					'FINDING F19 (JR-13-01): a `can` rule whose `conditions` is `{}` yields ' +
						"{ $or: [ {} ] } from rulesToQuery, which passes FilterBuilder's empty-query deny " +
						'branch (one key) and then translates to no filter at all. Expected RED until ' +
						'JR-13-04. Not named by F3 or F7 -- filed as F19.'
				);
				expect(
					outcome,
					'a rule with an empty condition object placed no restriction on the query'
				).not.toEqual([rows.mine, rows.theirs].sort());
			}
		);

		/**
		 * FINDING F20 -- an unconditional `cannot` is ignored entirely.
		 *
		 * This test was written as the counter-check for the "No access" branch
		 * (`FilterBuilder.ts:53`) that `JR-13-02` is told to reuse, expecting an unconditional `can`
		 * plus an unconditional `cannot` to reduce to an empty query. It does not. The guard is
		 *
		 *     cannotConditions = rules.filter((rule) => rule.inverted === true && rule.conditions)
		 *
		 * so a `cannot` **without** conditions is filtered out, `cannotConditions.length === 0`
		 * holds, and line 31 returns full access -- for a principal whose permission was revoked
		 * outright. `ability.can('read', 'archive')` is `false` for this principal, so the route gate
		 * `requirePermission('read','archive')` does return 403 and there is defence in depth. But
		 * `FilterBuilder`'s own answer is wrong, and `JR-13-02`'s criterion ("unbeschränkte Rückgabe
		 * nur noch bei nachweislich unbedingtem `can`") is not met while it stands: a revoked `can`
		 * is not an unconditional one.
		 *
		 * Filed as F20. RED until `JR-13-02`.
		 */
		it(redUntil('JR-13-02', 'an unconditional `cannot` is not ignored (F20)'), async () => {
			const rows = await seedTwoMailboxes('f20-blanket-cannot');
			const policies: CaslPolicy[] = [
				{ action: 'read', subject: 'archive' },
				{ inverted: true, action: 'read', subject: 'archive' },
			];
			const principal = await seedPrincipal(db(), policies, 'f20-blanket');
			const { drizzleFilter } = await FilterBuilder!.create(
				principal.userId,
				'archive',
				'read'
			);
			coverageNotice(
				'FINDING F20 (JR-13-01): FilterBuilder ignores a `cannot` rule that carries no ' +
					'conditions -- the cannotConditions filter requires `rule.conditions` to be ' +
					'truthy -- so `can read archive` + `cannot read archive` returns full access. ' +
					'Mitigated in the HTTP path by requirePermission (ability.can() is false), but ' +
					'FilterBuilder is also called from services. Expected RED until JR-13-02.'
			);
			expect(
				await visible(drizzleFilter, [rows.mine, rows.theirs]),
				'a blanket `cannot read archive` must not leave rows visible'
			).toEqual([]);
		});
	}
);
