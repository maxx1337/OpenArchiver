/**
 * The three test classes and the suite label they produce (JR-105c).
 *
 * ---------------------------------------------------------------------------------------------
 * Why this is its own module
 * ---------------------------------------------------------------------------------------------
 * Two parties need the same definition of "which class does this suite belong to":
 *
 *   - `classification.ts` *writes* the class into the suite name (`[ci] PolicyValidator...`);
 *   - `executed-tests.ts` *reads* it back out of the reported suite name, to count how many tests
 *     of each class actually executed.
 *
 * Two modules that ought to agree on a rule do not agree automatically -- that is finding F29 in
 * `09-befunde-bestandscode.md`, where a validator and a translator were supposed to accept the same
 * key form and quietly did not. So the label is built and parsed by one pair of functions here, and
 * neither side owns a copy of the format.
 *
 * This module imports **nothing**. `classification.ts` imports `vitest`, and the executed-test guard
 * runs in vitest's own main process (`globalSetup` and a reporter), where importing `vitest`'s test
 * API is not available. A third module that depends on neither is the only place both can reach --
 * the same shape as `src/helpers/conditionKey.ts` (pitfall 18 in `07-session-handover.md`).
 */

export const TEST_CLASSES = ['ci', 'nightly', 'manual'] as const;
export type TestClass = (typeof TEST_CLASSES)[number];

export const CLASSES_ENV_VAR = 'OA_TEST_CLASSES';

/**
 * The reported name of a classified suite. The class is visible in the test output, which is what
 * makes "what did this run cover?" answerable from the log (Testplan section 2).
 */
export function suiteLabel(cls: TestClass, name: string): string {
	return `[${cls}] ${name}`;
}

/**
 * The inverse of {@link suiteLabel}: which class does this reported suite name belong to?
 *
 * Anchored at the start, so a class name occurring anywhere else in a test title cannot be mistaken
 * for the label. `undefined` means the suite was not declared through `suite()` / `suiteRequiring()`
 * at all -- which the executed-test guard reports rather than ignores, because an unclassified suite
 * is a suite whose coverage no class accounts for.
 */
export function classOfSuiteName(name: string): TestClass | undefined {
	const match = /^\[([a-z]+)\]/.exec(name);
	if (!match) {
		return undefined;
	}
	const candidate = match[1] as TestClass;
	return (TEST_CLASSES as readonly string[]).includes(candidate) ? candidate : undefined;
}

/**
 * Parse an `OA_TEST_CLASSES` value. Empty or unset means `ci` only; `all` means every class.
 *
 * A typo throws rather than silently selecting nothing: `OA_TEST_CLASSES=cci` running zero tests and
 * exiting 0 is the failure mode this whole area of the harness exists to prevent.
 */
export function parseClassSelection(raw: string | undefined): Set<TestClass> {
	const value = raw?.trim();
	if (!value) {
		return new Set<TestClass>(['ci']);
	}
	if (value === 'all') {
		return new Set<TestClass>(TEST_CLASSES);
	}
	const parts = value
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	const unknown = parts.filter((part) => !(TEST_CLASSES as readonly string[]).includes(part));
	if (unknown.length > 0) {
		throw new Error(
			`${CLASSES_ENV_VAR} contains unknown test class(es): ${unknown.join(', ')}. ` +
				`Valid values: ${TEST_CLASSES.join(', ')}, or "all".`
		);
	}
	return new Set(parts as TestClass[]);
}

/** The selection in effect for this process, in declaration order. */
export function selectedClassesFrom(raw: string | undefined): TestClass[] {
	const selection = parseClassSelection(raw);
	return TEST_CLASSES.filter((cls) => selection.has(cls));
}
