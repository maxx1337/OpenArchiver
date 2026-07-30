import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { coverageNotice } from '@oa-test/notice';
import { mongoToDrizzle } from './mongoToDrizzle';
import { renderSql } from '../../tests/support/render-sql';
import { expectFailClosed, redUntil } from '../../tests/support/fail-closed';

/**
 * JR-103 -- unit tests for `mongoToDrizzle()`.
 *
 * Classification: `ci`. Pure; the helper imports only `drizzle-orm`, no connection.
 *
 * This helper turns the MongoDB-syntax `conditions` of an IAM policy into a SQL predicate, so it
 * is on the row-level access-control path (`FilterBuilder` -> `drizzleFilter`). Its interesting
 * failure mode is therefore not "wrong SQL" but **no SQL**: when the translator drops a condition,
 * the resulting query is unrestricted. Every such case is asserted explicitly below rather than
 * left implicit.
 */

const goldenPath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../tests/fixtures/mongo-to-drizzle-golden.json'
);

interface GoldenCase {
	name: string;
	query: Record<string, unknown>;
	sql?: string | null;
	params?: unknown[];
	/**
	 * JR-1301: the translator must refuse this input rather than drop the condition. Accepted
	 * outcomes are defined in `tests/support/fail-closed.ts`. Mutually exclusive with `sql`.
	 */
	mustFailClosed?: boolean;
	/**
	 * JR-1306: the condition **key** is not a column reference the translator can resolve, so the
	 * whole condition must be refused. Kept apart from `mustFailClosed` so that the F3 case count
	 * asserted below still counts F3 cases. Mutually exclusive with `sql`.
	 */
	mustRefuseKey?: boolean;
	observedBeforeE13?: string;
	note?: string;
}

const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as { cases: GoldenCase[] };

suite('ci', 'mongoToDrizzle() -- golden file', () => {
	it('the golden file is loaded from disk and is not empty', () => {
		expect(golden.cases.length).toBeGreaterThanOrEqual(20);
	});

	const translationCases = golden.cases.filter(
		(entry) => !entry.mustFailClosed && !entry.mustRefuseKey
	);
	const failClosedCases = golden.cases.filter((entry) => entry.mustFailClosed);
	const refuseKeyCases = golden.cases.filter((entry) => entry.mustRefuseKey);

	it.each(translationCases.map((entry) => [entry.name, entry] as const))(
		'translates %s',
		(_name, entry) => {
			const rendered = renderSql(mongoToDrizzle(entry.query));
			if (entry.sql === null) {
				expect(
					rendered,
					`${entry.name}: expected no filter, got ${JSON.stringify(rendered)}`
				).toBeUndefined();
				return;
			}
			expect(rendered, entry.name).toBeDefined();
			expect(rendered!.sql, entry.name).toBe(entry.sql);
			expect(rendered!.params, `${entry.name}: bound parameters`).toEqual(entry.params);
		}
	);

	/**
	 * FINDING F3 regression (JR-1301, epic E13).
	 *
	 * Until 2026-07-28 the three cases below were tagged `failOpen: true` in the golden file and
	 * asserted to produce `undefined` -- the test recorded the defect as the contract. They now
	 * demand the fail-closed contract from `tests/support/fail-closed.ts` and are therefore RED
	 * until `JR-1304` lands. Do not weaken them to get a green run: the red state is the evidence
	 * that the fix changed something.
	 */
	it(redUntil('JR-1304', 'every input that used to yield no filter now fails closed'), () => {
		expect(
			failClosedCases.length,
			'the golden file must still carry the fail-closed cases'
		).toBe(3);
		coverageNotice(
			`F3 regression (JR-1301): ${failClosedCases.length} input shapes must fail closed ` +
				`in mongoToDrizzle(): ${failClosedCases.map((entry) => entry.name).join('; ')}. ` +
				`Expected RED until JR-1304; "undefined" means "no restriction" to every ` +
				`FilterBuilder caller.`
		);
		for (const entry of failClosedCases) {
			expectFailClosed(`golden case "${entry.name}"`, () => mongoToDrizzle(entry.query));
		}
	});

	/**
	 * JR-1306 (finding F21, strict allowlist). The case this covers used to be a *translating* case
	 * in the golden file: `{ 'foo.bar': 'x' }` rendered `"foo.bar" = $1`. It was inverted in the
	 * same commit as the fix, and `observedBeforeE13` records what it rendered before, so the change
	 * of expectation is legible from the fixture alone.
	 */
	it.each(refuseKeyCases.map((entry) => [entry.name, entry] as const))(
		'refuses %s',
		(_name, entry) => {
			expect(() => mongoToDrizzle(entry.query), entry.name).toThrow(
				/not resolvable|not a column reference/
			);
		}
	);
});

suite('ci', 'mongoToDrizzle() -- operator translation', () => {
	const render = (query: Record<string, unknown>) => renderSql(mongoToDrizzle(query));

	it.each([
		['$gt', '>'],
		['$gte', '>='],
		['$lt', '<'],
		['$lte', '<='],
	] as const)('maps %s to %s and binds the operand', (operator, sqlOperator) => {
		const rendered = render({ sizeBytes: { [operator]: 4096 } });
		expect(rendered).toEqual({ sql: `"size_bytes" ${sqlOperator} $1`, params: [4096] });
	});

	it('does not confuse the strict and inclusive variants', () => {
		expect(render({ n: { $gt: 1 } })!.sql).not.toBe(render({ n: { $gte: 1 } })!.sql);
		expect(render({ n: { $lt: 1 } })!.sql).not.toBe(render({ n: { $lte: 1 } })!.sql);
	});

	it('$in binds one parameter per element and preserves order', () => {
		const rendered = render({ id: { $in: ['a', 'b', 'c'] } })!;
		expect(rendered.sql).toBe('"id" in ($1, $2, $3)');
		expect(rendered.params).toEqual(['a', 'b', 'c']);
	});

	it('$in never interpolates a value into the statement text', () => {
		const hostile = "'; drop table archived_emails; --";
		const rendered = render({ id: { $in: [hostile] } })!;
		expect(rendered.sql).toBe('"id" in ($1)');
		expect(rendered.sql).not.toContain('drop table');
		expect(rendered.params).toEqual([hostile]);
	});

	it('$eq and implicit equality produce the same predicate', () => {
		expect(render({ id: 'a' })).toEqual(render({ id: { $eq: 'a' } }));
	});

	it('$ne and $nin are the negations of $eq and $in', () => {
		expect(render({ id: { $ne: 'a' } })!.sql).toBe(`not ${render({ id: { $eq: 'a' } })!.sql}`);
		expect(render({ id: { $nin: ['a'] } })!.sql).toBe(
			`not ${render({ id: { $in: ['a'] } })!.sql}`
		);
	});

	it('$exists maps to IS NULL / IS NOT NULL and binds nothing', () => {
		expect(render({ deletedAt: { $exists: false } })).toEqual({
			sql: '"deleted_at" is null',
			params: [],
		});
		expect(render({ deletedAt: { $exists: true } })).toEqual({
			sql: 'not "deleted_at" is null',
			params: [],
		});
	});

	it('a literal null becomes "= NULL" and therefore matches nothing', () => {
		// Observed behaviour, and a trap: in SQL `col = NULL` is never true. A policy condition
		// `{ deletedAt: null }` reads as "only non-deleted rows" but selects zero rows.
		// `$exists: false` is the form that works.
		const rendered = render({ deletedAt: null })!;
		expect(rendered.sql).toBe('"deleted_at" = $1');
		expect(rendered.params).toEqual([null]);
		expect(rendered.sql).not.toContain('is null');
	});
});

suite('ci', 'mongoToDrizzle() -- logical operators and nesting', () => {
	const render = (query: Record<string, unknown>) => renderSql(mongoToDrizzle(query));

	it('$and and $or wrap their branches in parentheses', () => {
		expect(render({ $or: [{ a: 1 }, { b: 2 }] })!.sql).toBe('("a" = $1 or "b" = $2)');
		expect(render({ $and: [{ a: 1 }, { b: 2 }] })!.sql).toBe('("a" = $1 and "b" = $2)');
	});

	it('$not negates a compound branch as a whole, not term by term', () => {
		const rendered = render({ $not: { a: 1, b: 2 } })!;
		expect(rendered.sql).toBe('not ("a" = $1 and "b" = $2)');
		expect(rendered.params).toEqual([1, 2]);
	});

	it('keeps parameter order across three levels of nesting', () => {
		const rendered = render({
			$or: [
				{ $and: [{ userId: 'u1' }, { $not: { status: 'deleted' } }] },
				{ 'ingestionSource.provider': 'imap', id: { $in: ['x', 'y'] } },
			],
		})!;
		expect(rendered.sql).toBe(
			'(("user_id" = $1 and not "status" = $2) or ' +
				'("ingestion_sources"."provider" = $3 and "id" in ($4, $5)))'
		);
		expect(rendered.params).toEqual(['u1', 'deleted', 'imap', 'x', 'y']);
	});

	/**
	 * FINDING F3 regression (JR-1301) -- the three shapes named in `JR-1304`'s acceptance
	 * criteria: "kein stilles Erweitern eines `$or`, kein Verlust einer `$not`-Negation".
	 *
	 * Each of these used to be pinned as observed behaviour. They now state the requirement and
	 * are RED until `JR-1304`.
	 */
	it(redUntil('JR-1304', 'an untranslatable $or branch is not silently dropped'), () => {
		// `{ $regex: ... }` is unsupported, that branch vanishes, and the `$or` collapses to
		// `"id" = $1`. F3's write-up and JR-1304's criterion both call this a *widening* of the
		// disjunction; measured, it is a **narrowing** -- `A or B` becomes `A`, so a principal sees
		// fewer rows than the policy grants (finding F22). It is still a defect: the stored policy
		// silently means something else than it says, and the same drop in the `$and` of negated
		// `cannot` conditions, or in a disjunction with only one branch, *is* fail-open. Which is
		// why the requirement is "do not drop it", not "do not widen it".
		const outcome = () => mongoToDrizzle({ $or: [{ id: 'a' }, { subject: { $regex: 'x' } }] });
		expectFailClosed('{ $or: [ {id}, {subject: {$regex}} ] }', outcome);
		// Stated separately so a fix that merely renames the predicate cannot satisfy the test:
		// the collapsed single-branch form must not be what comes out.
		const rendered = renderSql(
			(() => {
				try {
					return outcome();
				} catch {
					return undefined;
				}
			})()
		);
		expect(
			rendered?.sql,
			'the disjunction must not silently collapse to its translatable branch'
		).not.toBe('"id" = $1');
	});

	it(
		redUntil('JR-1304', 'a disjunction whose only branch is untranslatable must not vanish'),
		() => {
			// This is the fail-open boundary of the same defect, and the shape `rulesToQuery` produces
			// for a role with exactly one conditional `can`: `{ $or: [ <untranslatable> ] }`. `or()` over
			// an empty list is `undefined`, so the policy restricts nothing at all. Asserted against
			// real rows as well, in tests/integration/filter-builder-f1-f3.int.test.ts.
			expectFailClosed('{ $or: [ {subject: {$regex}} ] }', () =>
				mongoToDrizzle({ $or: [{ subject: { $regex: 'x' } }] })
			);
		}
	);

	it(redUntil('JR-1304', 'an $and whose branches all vanish must not yield "no filter"'), () => {
		expectFailClosed('{ $and: [ {subject: {$regex}} ] }', () =>
			mongoToDrizzle({ $and: [{ subject: { $regex: 'x' } }] })
		);
	});

	it(
		redUntil('JR-1304', 'a $not around an untranslatable condition must not lose the negation'),
		() => {
			// The guard `if (subQuery)` means an unsupported inner condition removes the NOT rather
			// than failing, so a deny-style condition evaporates.
			expectFailClosed('{ $not: { subject: { $regex: "x" } } }', () =>
				mongoToDrizzle({ $not: { subject: { $regex: 'x' } } })
			);
		}
	);

	it('the second operator inside one field object is silently dropped', () => {
		const rendered = render({ sizeBytes: { $gte: 1, $lte: 5 } })!;
		expect(rendered.sql).toBe('"size_bytes" >= $1');
		expect(rendered.params).toEqual([1]);
		// The $lte bound is gone. A range condition must be written as an explicit $and.
		expect(rendered.sql).not.toContain('<=');
	});

	it('an explicit $and expresses a range correctly', () => {
		const rendered = render({
			$and: [{ sizeBytes: { $gte: 1 } }, { sizeBytes: { $lte: 5 } }],
		})!;
		expect(rendered.sql).toBe('("size_bytes" >= $1 and "size_bytes" <= $2)');
		expect(rendered.params).toEqual([1, 5]);
	});
});

suite('ci', 'mongoToDrizzle() -- column name mapping', () => {
	const render = (query: Record<string, unknown>) => renderSql(mongoToDrizzle(query));

	it.each([
		['id', '"id"'],
		['userId', '"user_id"'],
		['ingestionSourceId', '"ingestion_source_id"'],
		['storageHashSha256', '"storage_hash_sha256"'],
	])('maps %s to %s', (key, column) => {
		expect(render({ [key]: 'v' })!.sql).toBe(`${column} = $1`);
	});

	it('resolves only the relations listed in relationToTableMap', () => {
		expect(render({ 'ingestionSource.status': 'active' })!.sql).toBe(
			'"ingestion_sources"."status" = $1'
		);
		// INVERTED in JR-1306 (finding F21, decided by the PO 2026-07-29: strict allowlist).
		// Until then this line pinned the observed behaviour -- a relation that is not in the map
		// was emitted verbatim as one quoted identifier containing a dot
		// (`"attachment.name" = $1`), which names no column and therefore fails at query time for
		// every caller instead of denying access. A key whose relation cannot be resolved is a
		// policy error and is now refused.
		expect(() => mongoToDrizzle({ 'attachment.name': 'x' })).toThrow(
			/not resolvable|not a column reference/
		);
	});
});

/**
 * FINDING F1 (JR-103, adversarial) -- condition **keys** are not escaped.
 *
 * `getDrizzleColumn()` builds the column reference from the policy condition key, either via
 * `sql.identifier()` or, for a mapped relation, via `sql.raw()`. In drizzle-orm's Postgres dialect
 * `escapeName(name)` is literally `` `"${name}"` `` (node_modules/drizzle-orm/pg-core/dialect.js:73)
 * -- an embedded double quote is **not** doubled. `sql.raw()` escapes nothing at all.
 *
 * The keys come from `roles.policies` (JSONB), and `PolicyValidator.isValid()` deliberately does
 * not inspect `conditions` at all (see policy-validator.test.ts). A principal who may create or
 * update a role can therefore place arbitrary SQL into the WHERE clause of every query that
 * `FilterBuilder` scopes.
 *
 * ---------------------------------------------------------------------------------------------
 * JR-1301 (epic E13): these tests used to pin the observed behaviour and carried an `it.fails`
 * marker. They now demand the behaviour `JR-1306` has to deliver -- "ein Key mit `\"` wird
 * abgewiesen, nicht escaped-durchgelassen; Relationszweig ebenso" -- and are therefore RED until
 * that task lands.
 *
 * The requirement is stated as *rejection*, not as *escaping*, on purpose: `JR-1306` chose an
 * allowlist of known columns over escaping, because an unknown condition key is a policy error and
 * belongs fail-closed. Escaping the quote (`"id"" or 1=1 --"`) would also close the injection, and
 * `expectFailClosed` does not accept it -- an escaped hostile identifier still names a column that
 * does not exist, so the query would fail at runtime for every caller instead of denying access.
 * If the senior developer picks escaping after all, that is a change of decision and needs an ADR,
 * not a quiet edit of this expectation.
 *
 * Finding F21 -- decided by the PO on 2026-07-29 in favour of the **strict** allowlist: an unknown
 * key is refused whether or not it carries SQL syntax. The two pins that recorded the permissive
 * behaviour for `attachment.name` (in the "column name mapping" suite above) and for `foo.bar` (in
 * the golden file) were inverted in the same commit as the fix, so no state exists in which test
 * and code disagree. What the allowlist checks is the *shape* of the key plus the relation table:
 * a bare identifier passes, a dotted key passes only for a relation listed in
 * `relationToTableMap`. It does not check that the column exists -- `mongoToDrizzle` has no table
 * context, which is why `a`, `b` and `n` are still translatable above.
 */
suite('ci', 'mongoToDrizzle() -- FINDING F1: unescaped condition keys', () => {
	/** Keys that inject SQL through `sql.identifier()` / `sql.raw()`. */
	const hostileKeys = [
		'id" or 1=1 --',
		'ingestionSource.x" or 1=1 --',
		// The form that actually type-checks in Postgres and therefore actually returns rows:
		// `"user_email" is not null or "id" is not null --" = $1` -- see the integration test
		// filter-builder-f1-injection.int.test.ts, which executes it.
		'userEmail" is not null or "id" is not null --',
		'id"; drop table archived_emails; --',
	];

	it(redUntil('JR-1306', 'a condition key that injects SQL is rejected'), () => {
		coverageNotice(
			'FINDING F1 regression (JR-1301): mongoToDrizzle() must reject condition KEYS that ' +
				'contain SQL syntax. Today it does not escape them, so a policy condition key with ' +
				'a double quote writes raw SQL into the WHERE clause of every FilterBuilder-scoped ' +
				'query. Expected RED until JR-1306.'
		);
		for (const key of hostileKeys) {
			expectFailClosed(`hostile condition key ${JSON.stringify(key)}`, () =>
				mongoToDrizzle({ [key]: 'v' })
			);
		}
	});

	it(redUntil('JR-1306', 'no rendered predicate ever contains an injected SQL fragment'), () => {
		// Independent of *how* the key is refused: if a predicate comes out at all, it must not
		// carry the attacker's syntax. This is the assertion that stays meaningful whichever
		// design JR-1306 picks.
		for (const key of hostileKeys) {
			let sqlText: string | undefined;
			try {
				sqlText = renderSql(mongoToDrizzle({ [key]: 'v' }))?.sql;
			} catch {
				continue; // rejected: nothing was rendered, nothing to inspect
			}
			if (sqlText === undefined) {
				continue; // covered by the test above; not this test's claim
			}
			expect(sqlText, `key ${JSON.stringify(key)}`).not.toMatch(/or\s+1\s*=\s*1/i);
			expect(sqlText, `key ${JSON.stringify(key)}`).not.toContain('--');
			expect(sqlText, `key ${JSON.stringify(key)}`).not.toMatch(/drop\s+table/i);
			expect(sqlText, `key ${JSON.stringify(key)}`).not.toMatch(/is\s+not\s+null\s+or/i);
		}
	});

	it('legitimate condition keys used by shipped policies keep working', () => {
		// The counter-check. A fix that rejects everything would satisfy the two tests above and
		// break every predefined role, so the keys that actually occur in
		// `iam.controller.ts createDefaultRoles` and in `src/iam-policy/test-policies/*.json` are
		// pinned here. This test is green before and after JR-1306.
		const render = (query: Record<string, unknown>) => renderSql(mongoToDrizzle(query));
		expect(render({ userId: 'u' })!.sql).toBe('"user_id" = $1');
		expect(render({ id: 'a' })!.sql).toBe('"id" = $1');
		expect(render({ userEmail: 'a@b.invalid' })!.sql).toBe('"user_email" = $1');
		expect(render({ ingestionSourceId: 's' })!.sql).toBe('"ingestion_source_id" = $1');
		expect(render({ 'ingestionSource.userId': 'u' })!.sql).toBe(
			'"ingestion_sources"."user_id" = $1'
		);
		expect(render({ 'ingestionSource.status': 'active' })!.sql).toBe(
			'"ingestion_sources"."status" = $1'
		);
	});
});
