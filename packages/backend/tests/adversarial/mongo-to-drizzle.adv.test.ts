import { expect, it } from 'vitest';
import { suite, isClassSelected } from '@oa-test/classification';
import { announceSampling, coverageNotice } from '@oa-test/notice';
import { resolveSeed, seededRng, type Seeded } from '@oa-test/seed';
import { mongoToDrizzle } from '../../src/helpers/mongoToDrizzle';
import { renderSql } from '../support/render-sql';

/**
 * JR-1-01 / JR-1-02 -- the reference example for the `adversarial` category.
 *
 * It is model-based rather than golden-file based: the generator builds a random condition tree
 * *together with* the exact list of parameters that tree must bind, and the test compares the
 * translator's output against that model. That is what turns randomness into an assertion instead
 * of a smoke test.
 *
 * Invariants checked on every generated tree:
 *   1. Every generated value is bound as a parameter, in depth-first order -- nothing is lost.
 *   2. No generated value appears in the statement *text* -- nothing is interpolated.
 *   3. Placeholders are `$1..$n`, contiguous and in order, with n === params.length.
 *   4. Parentheses are balanced.
 *   5. The same seed produces byte-identical SQL -- the translator is deterministic.
 *
 * Testplan rule 3: every random choice comes from one seed, and the seed is printed. A failure is
 * replayed with `OA_TEST_SEED=<n> pnpm test:adversarial`.
 *
 * Three named variants, per Testplan rule 6 -- the `ci` variant does not pretend to be the full run:
 *   - `ci`      : CI_ITERATIONS trees, announced as a sample.
 *   - `nightly` : NIGHTLY_ITERATIONS trees.
 *   - `manual`  : time-boxed soak, MANUAL_BUDGET_MS.
 */

const CI_ITERATIONS = 300;
const NIGHTLY_ITERATIONS = 25_000;
const MANUAL_BUDGET_MS = 30_000;

const FIELDS = [
	'id',
	'userId',
	'ingestionSourceId',
	'status',
	'provider',
	'sizeBytes',
	'ingestionSource.userId',
	'ingestionSource.status',
] as const;

interface Generated {
	query: Record<string, unknown>;
	/** Parameters the translation must bind, in order. */
	params: unknown[];
}

function generate(rng: Seeded, counter: { n: number }, depth: number): Generated {
	const nextString = () => `oa_value_${counter.n++}`;
	const nextNumber = () => 1000 + counter.n++;

	if (depth > 0 && rng.next() < 0.4) {
		const operator = rng.pick(['$or', '$and', '$not'] as const);
		if (operator === '$not') {
			const child = generate(rng, counter, depth - 1);
			return { query: { $not: child.query }, params: child.params };
		}
		const branchCount = 2 + rng.int(2);
		const branches: Generated[] = [];
		for (let index = 0; index < branchCount; index += 1) {
			branches.push(generate(rng, counter, depth - 1));
		}
		return {
			query: { [operator]: branches.map((branch) => branch.query) },
			params: branches.flatMap((branch) => branch.params),
		};
	}

	const field = rng.pick(FIELDS);
	const kind = rng.pick([
		'implicit',
		'$eq',
		'$ne',
		'$gt',
		'$gte',
		'$lt',
		'$lte',
		'$in',
		'$nin',
		'$exists',
	] as const);

	switch (kind) {
		case 'implicit': {
			const value = nextString();
			return { query: { [field]: value }, params: [value] };
		}
		case '$gt':
		case '$gte':
		case '$lt':
		case '$lte': {
			const value = nextNumber();
			return { query: { [field]: { [kind]: value } }, params: [value] };
		}
		case '$in':
		case '$nin': {
			const size = 1 + rng.int(3);
			const values = Array.from({ length: size }, () => nextString());
			return { query: { [field]: { [kind]: values } }, params: values };
		}
		case '$exists': {
			// Binds no parameter at all -- included precisely because it makes the model non-trivial.
			return { query: { [field]: { $exists: rng.next() < 0.5 } }, params: [] };
		}
		default: {
			const value = nextString();
			return { query: { [field]: { [kind]: value } }, params: [value] };
		}
	}
}

function checkOnce(generated: Generated, context: string): void {
	const rendered = renderSql(mongoToDrizzle(generated.query));
	expect(
		rendered,
		`${context} -- translation produced NO filter, which means an unrestricted query. ` +
			`query=${JSON.stringify(generated.query)}`
	).toBeDefined();
	const { sql, params } = rendered!;

	// 1. nothing lost, order preserved
	expect(
		params,
		`${context} -- bound parameters. query=${JSON.stringify(generated.query)}`
	).toEqual(generated.params);

	// 2. nothing interpolated
	for (const value of generated.params) {
		if (typeof value === 'string') {
			expect(
				sql,
				`${context} -- value "${value}" leaked into the statement text: ${sql}`
			).not.toContain(value);
		}
	}

	// 3. contiguous placeholders
	const placeholders = sql.match(/\$\d+/g) ?? [];
	const expected = generated.params.map((_value, index) => `$${index + 1}`);
	expect(placeholders, `${context} -- placeholder sequence in: ${sql}`).toEqual(expected);

	// 4. balanced parentheses
	let depth = 0;
	for (const character of sql) {
		if (character === '(') depth += 1;
		if (character === ')') depth -= 1;
		expect(depth, `${context} -- unbalanced parentheses in: ${sql}`).toBeGreaterThanOrEqual(0);
	}
	expect(depth, `${context} -- unbalanced parentheses in: ${sql}`).toBe(0);
}

function runIterations(seed: number, suiteName: string, iterations: number): void {
	const rng = seededRng(seed, suiteName);
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		const counter = { n: 0 };
		const generated = generate(rng, counter, 3);
		checkOnce(generated, rng.context({ iteration }));
	}
}

const seed = resolveSeed('mongoToDrizzle adversarial');

suite('ci', `mongoToDrizzle() adversarial -- ${CI_ITERATIONS} seeded trees (sample)`, () => {
	it(`holds for ${CI_ITERATIONS} generated condition trees`, () => {
		announceSampling(
			'mongoToDrizzle adversarial',
			CI_ITERATIONS,
			NIGHTLY_ITERATIONS,
			`[nightly] mongoToDrizzle() adversarial -- ${NIGHTLY_ITERATIONS} seeded trees`
		);
		runIterations(seed, 'mongoToDrizzle adversarial (ci)', CI_ITERATIONS);
	});

	it('is deterministic: the same seed yields byte-identical SQL', () => {
		const build = () => {
			const rng = seededRng(seed, 'determinism');
			const statements: string[] = [];
			for (let iteration = 0; iteration < 50; iteration += 1) {
				const generated = generate(rng, { n: 0 }, 3);
				statements.push(renderSql(mongoToDrizzle(generated.query))?.sql ?? '<none>');
			}
			return statements;
		};
		expect(build()).toEqual(build());
	});

	it('reports the seed for replay', () => {
		// Not decoration: without this line a CI log of a passing run does not let you reproduce
		// the exact corpus that passed.
		coverageNotice(`mongoToDrizzle adversarial corpus seed: ${seed}`);
		expect(Number.isInteger(seed)).toBe(true);
	});
});

suite('nightly', `mongoToDrizzle() adversarial -- ${NIGHTLY_ITERATIONS} seeded trees`, () => {
	it(`holds for ${NIGHTLY_ITERATIONS} generated condition trees`, () => {
		runIterations(seed, 'mongoToDrizzle adversarial (nightly)', NIGHTLY_ITERATIONS);
	});
});

suite('manual', `mongoToDrizzle() adversarial -- ${MANUAL_BUDGET_MS} ms soak`, () => {
	it('holds for as many trees as fit into the time budget', () => {
		const deadline = Date.now() + MANUAL_BUDGET_MS;
		const rng = seededRng(seed, 'mongoToDrizzle adversarial (manual)');
		let iterations = 0;
		while (Date.now() < deadline) {
			const generated = generate(rng, { n: 0 }, 4);
			checkOnce(generated, rng.context({ iteration: iterations }));
			iterations += 1;
		}
		coverageNotice(
			`mongoToDrizzle manual soak: ${iterations} trees in ${MANUAL_BUDGET_MS} ms (seed ${seed})`
		);
		expect(iterations).toBeGreaterThan(0);
	});
});

// The adversarial project must not be silently empty when only `manual` was selected.
if (!isClassSelected('ci') && !isClassSelected('nightly') && !isClassSelected('manual')) {
	coverageNotice('adversarial suite: no test class selected, nothing ran.');
}
