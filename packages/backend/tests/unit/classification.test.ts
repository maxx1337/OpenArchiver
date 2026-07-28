import { expect, it } from 'vitest';
import { isInfraRequired, suite } from '@oa-test/classification';

/**
 * Units for the `OA_TEST_REQUIRE_INFRA` switch (JR-105b).
 *
 * The switch is what stops a CI job that provisions Postgres from reporting green when the
 * provisioning failed and every integration suite skipped. Its parser is therefore the difference
 * between "the integration suite ran" and "nobody noticed that it did not", and it gets tested like
 * anything else load-bearing.
 *
 * What is *not* tested here: that `suiteRequiring()` actually emits a failing test. That needs a
 * whole child vitest run with an unreachable database, and it is verified by hand in the JR-105b
 * evidence (`06-status.md`) rather than pretended here.
 *
 * Classification: `ci`. Pure env parsing.
 */

function withEnv<T>(value: string | undefined, fn: () => T): T {
	const previous = process.env.OA_TEST_REQUIRE_INFRA;
	if (value === undefined) {
		delete process.env.OA_TEST_REQUIRE_INFRA;
	} else {
		process.env.OA_TEST_REQUIRE_INFRA = value;
	}
	try {
		return fn();
	} finally {
		if (previous === undefined) {
			delete process.env.OA_TEST_REQUIRE_INFRA;
		} else {
			process.env.OA_TEST_REQUIRE_INFRA = previous;
		}
	}
}

suite('ci', 'OA_TEST_REQUIRE_INFRA parsing (JR-105b)', () => {
	it('defaults to "skipping is allowed" when unset or empty', () => {
		expect(withEnv(undefined, isInfraRequired)).toBe(false);
		expect(withEnv('', isInfraRequired)).toBe(false);
		expect(withEnv('   ', isInfraRequired)).toBe(false);
	});

	it('accepts the four documented values, case-insensitively', () => {
		expect(withEnv('1', isInfraRequired)).toBe(true);
		expect(withEnv('true', isInfraRequired)).toBe(true);
		expect(withEnv('TRUE', isInfraRequired)).toBe(true);
		expect(withEnv('0', isInfraRequired)).toBe(false);
		expect(withEnv('false', isInfraRequired)).toBe(false);
	});

	it('rejects anything else instead of falling back to permissive', () => {
		// The failure mode being closed: `OA_TEST_REQUIRE_INFRA=yes` reading as "not required" would
		// leave CI accepting a fully skipped integration suite while looking configured.
		for (const value of ['yes', 'on', 'y', 'required', '2', 'ci']) {
			expect(() => withEnv(value, isInfraRequired), value).toThrow(
				/OA_TEST_REQUIRE_INFRA must be one of/
			);
		}
	});
});
