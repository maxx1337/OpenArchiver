import { describe, it } from 'vitest';
import { coverageNotice } from './notice';
import {
	CLASSES_ENV_VAR,
	TEST_CLASSES,
	parseClassSelection,
	suiteLabel,
	type TestClass,
} from './test-classes';

/**
 * Test classification (JR-1-02, Testplan section 2).
 *
 * Every suite declares whether it belongs to `ci`, `nightly` or `manual`. The classification is
 * visible **in the test itself** and in the reported suite name — not only in the testplan — so
 * that reading a test output tells you what was actually covered.
 *
 * Selection happens through `OA_TEST_CLASSES` (comma separated, or `all`). Default: `ci` only.
 * A suite whose class was not selected is reported as skipped *and* emits a coverage notice.
 *
 * The class list, the selection parser and the `[ci] `-style label live in `./test-classes`, which
 * imports nothing: the executed-test guard (JR-1-05c) runs in vitest's main process and reads the
 * class back out of the reported suite name, so it needs the same definition without being able to
 * import `vitest`. See the header of that module.
 */

export { TEST_CLASSES, type TestClass };

const ENV_VAR = CLASSES_ENV_VAR;

const selection = parseClassSelection(process.env[ENV_VAR]);

export function selectedClasses(): TestClass[] {
	return TEST_CLASSES.filter((cls) => selection.has(cls));
}

export function isClassSelected(cls: TestClass): boolean {
	return selection.has(cls);
}

function selectionLabel(): string {
	return process.env[ENV_VAR]?.trim() || 'ci (default)';
}

/* -------------------------------------------------------------------------------------------- */
/* Environments where a skip is not acceptable (JR-1-05b)                                        */
/* -------------------------------------------------------------------------------------------- */

const REQUIRE_INFRA_VAR = 'OA_TEST_REQUIRE_INFRA';

/**
 * In an environment that *provisions* the infrastructure -- CI, with its Postgres service container
 * -- a suite skipping because the infrastructure is unreachable is not a legitimate skip, it is a
 * broken job reporting green. Setting `OA_TEST_REQUIRE_INFRA=1` turns that skip into a failing test.
 *
 * This replaces the CI step that grepped the log for the *absence* of a skip notice. That check was
 * blind to a suite that was absent rather than skipped -- a missing suite prints no notice -- and a
 * check keyed on a missing log line is the very construction that let the hole through. The
 * expectation now lives in the suite: with the variable set, the only way to be green is for the
 * requirement to have been satisfied.
 *
 * It deliberately does **not** affect class selection: `nightly` and `manual` suites skipping in a
 * `ci` run is by design and stays a skip.
 */
export function isInfraRequired(): boolean {
	const raw = process.env[REQUIRE_INFRA_VAR]?.trim().toLowerCase();
	if (!raw) {
		return false;
	}
	if (raw === '1' || raw === 'true') {
		return true;
	}
	if (raw === '0' || raw === 'false') {
		return false;
	}
	// A typo must not silently mean "skipping is fine again".
	throw new Error(
		`${REQUIRE_INFRA_VAR} must be one of 1, true, 0, false (or unset), got "${raw}".`
	);
}

// Validated eagerly, the same way OA_TEST_CLASSES is. Otherwise a typo in the variable is only
// noticed on the runs where a requirement happens to be unavailable -- i.e. it would look like a
// working guard for as long as the infrastructure is up, and stop guarding the moment it matters.
isInfraRequired();

/**
 * Declare a classified suite.
 *
 * ```ts
 * suite('ci', 'PolicyValidator.isValid()', () => { ... });
 * ```
 *
 * The reported name is prefixed with `[ci]` / `[nightly]` / `[manual]`.
 */
export function suite(cls: TestClass, name: string, fn: () => void): void {
	const label = suiteLabel(cls, name);
	if (selection.has(cls)) {
		describe(label, fn);
		return;
	}
	const reason = `class '${cls}' not selected (${ENV_VAR}=${selectionLabel()})`;
	coverageNotice(`SKIPPED SUITE ${label}: ${reason}`);
	describe.skip(`${label} -- SKIPPED: ${reason}`, fn);
}

/**
 * Declare a classified suite that additionally depends on external infrastructure.
 *
 * `requirement.available === false` skips the suite with the probe's own reason in the suite
 * name, so the output states *why* it was skipped rather than just that it was.
 *
 * With `OA_TEST_REQUIRE_INFRA=1` the unavailable case **fails** instead of skipping. See
 * `isInfraRequired()`.
 */
export function suiteRequiring(
	cls: TestClass,
	name: string,
	requirement: { available: boolean; reason: string },
	fn: () => void
): void {
	const label = suiteLabel(cls, name);
	if (!selection.has(cls)) {
		suite(cls, name, fn);
		return;
	}
	if (requirement.available) {
		describe(label, fn);
		return;
	}
	if (isInfraRequired()) {
		// One loud failing test rather than a skipped suite. `fn` is not registered: its tests cannot
		// run, and pretending otherwise by declaring them would only produce a second error each.
		describe(label, () => {
			it(`requires infrastructure that is not available (${REQUIRE_INFRA_VAR} is set)`, () => {
				throw new Error(
					`${label} needs infrastructure that is not reachable: ${requirement.reason}. ` +
						`${REQUIRE_INFRA_VAR} is set, so this counts as a failure rather than a skip -- ` +
						`the environment promised to provide it.`
				);
			});
		});
		return;
	}
	coverageNotice(`SKIPPED SUITE ${label}: ${requirement.reason}`);
	describe.skip(`${label} -- SKIPPED: ${requirement.reason}`, fn);
}
