import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { coverageNotice } from '@oa-test/notice';
import { mongoToDrizzle } from './mongoToDrizzle';
import { renderSql } from '../../tests/support/render-sql';

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
	sql: string | null;
	params: unknown[];
	failOpen?: boolean;
	note?: string;
}

const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as { cases: GoldenCase[] };

suite('ci', 'mongoToDrizzle() -- golden file', () => {
	it('the golden file is loaded from disk and is not empty', () => {
		expect(golden.cases.length).toBeGreaterThanOrEqual(20);
	});

	it.each(golden.cases.map((entry) => [entry.name, entry] as const))(
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

	it('lists every fail-open input in the output so the gap is not invisible', () => {
		const failOpen = golden.cases.filter((entry) => entry.failOpen);
		expect(failOpen.length).toBeGreaterThan(0);
		coverageNotice(
			`mongoToDrizzle() returns NO filter (=> unrestricted query) for ${failOpen.length} ` +
				`input shapes: ${failOpen.map((entry) => entry.name).join('; ')}. ` +
				`Callers must treat "undefined" as "deny", not as "no restriction".`
		);
		for (const entry of failOpen) {
			expect(mongoToDrizzle(entry.query), entry.name).toBeUndefined();
		}
	});
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

	it('a $or branch that translates to nothing is dropped, widening the disjunction', () => {
		// `{ $regex: ... }` is unsupported, so that branch vanishes and the $or collapses to the
		// remaining branch. Recorded because the *silent* widening is the dangerous part.
		const rendered = render({ $or: [{ id: 'a' }, { subject: { $regex: 'x' } }] })!;
		expect(rendered.sql).toBe('"id" = $1');
		expect(rendered.params).toEqual(['a']);
	});

	it('an $and whose branches all vanish yields no filter at all', () => {
		expect(mongoToDrizzle({ $and: [{ subject: { $regex: 'x' } }] })).toBeUndefined();
	});

	it('$not around an untranslatable condition drops the negation entirely', () => {
		// The guard `if (subQuery)` means an unsupported inner condition removes the NOT, rather
		// than failing. A deny-style condition can therefore evaporate.
		expect(mongoToDrizzle({ $not: { subject: { $regex: 'x' } } })).toBeUndefined();
	});

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
		// Not in the map: emitted verbatim as a single quoted identifier containing a dot.
		expect(render({ 'attachment.name': 'x' })!.sql).toBe('"attachment.name" = $1');
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
 * These tests are NOT a request to change `mongoToDrizzle.ts` from within a test epic. They pin the
 * observed behaviour and, via `it.fails`, leave an executable marker that flips to red the moment
 * the escaping is fixed -- at which point the expectations here should be inverted.
 */
suite('ci', 'mongoToDrizzle() -- FINDING F1: unescaped condition keys', () => {
	const render = (query: Record<string, unknown>) => renderSql(mongoToDrizzle(query));

	it('observed: sql.identifier() does not double an embedded double quote', () => {
		coverageNotice(
			'FINDING F1: mongoToDrizzle() does not escape condition KEYS. A policy condition key ' +
				'containing a double quote injects raw SQL into the WHERE clause of every ' +
				'FilterBuilder-scoped query. PolicyValidator does not validate condition keys. ' +
				'Reported for the senior developer; not fixed in the test epic.'
		);
		const rendered = render({ 'id" or 1=1 --': 'v' })!;
		expect(rendered.sql).toBe('"id" or 1=1 --" = $1');
		// The injected fragment escapes the identifier and comments out the rest of the predicate.
		expect(rendered.sql.startsWith('"id" or 1=1 --')).toBe(true);
	});

	it('observed: the sql.raw() relation path escapes nothing either', () => {
		const rendered = render({ 'ingestionSource.x" or 1=1 --': 'v' })!;
		expect(rendered.sql).toBe('"ingestion_sources"."x" or 1=1 --" = $1');
	});

	it.fails('KNOWN DEFECT F1 -- flip this test once identifiers are escaped', () => {
		// Correct behaviour for Postgres would be to double the inner quote.
		expect(render({ 'id" or 1=1 --': 'v' })!.sql).toBe('"id"" or 1=1 --" = $1');
	});
});
