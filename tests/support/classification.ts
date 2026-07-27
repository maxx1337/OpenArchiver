import { describe } from 'vitest';
import { coverageNotice } from './notice';

/**
 * Test classification (JR-102, Testplan section 2).
 *
 * Every suite declares whether it belongs to `ci`, `nightly` or `manual`. The classification is
 * visible **in the test itself** and in the reported suite name — not only in the testplan — so
 * that reading a test output tells you what was actually covered.
 *
 * Selection happens through `OA_TEST_CLASSES` (comma separated, or `all`). Default: `ci` only.
 * A suite whose class was not selected is reported as skipped *and* emits a coverage notice.
 */

export const TEST_CLASSES = ['ci', 'nightly', 'manual'] as const;
export type TestClass = (typeof TEST_CLASSES)[number];

const ENV_VAR = 'OA_TEST_CLASSES';

function parseSelection(): Set<TestClass> {
	const raw = process.env[ENV_VAR]?.trim();
	if (!raw) {
		return new Set<TestClass>(['ci']);
	}
	if (raw === 'all') {
		return new Set<TestClass>(TEST_CLASSES);
	}
	const parts = raw
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	const unknown = parts.filter((part) => !(TEST_CLASSES as readonly string[]).includes(part));
	if (unknown.length > 0) {
		// Fail loudly. A typo in the class selector must not silently run nothing.
		throw new Error(
			`${ENV_VAR} contains unknown test class(es): ${unknown.join(', ')}. ` +
				`Valid values: ${TEST_CLASSES.join(', ')}, or "all".`
		);
	}
	return new Set(parts as TestClass[]);
}

const selection = parseSelection();

export function selectedClasses(): TestClass[] {
	return TEST_CLASSES.filter((cls) => selection.has(cls));
}

export function isClassSelected(cls: TestClass): boolean {
	return selection.has(cls);
}

function selectionLabel(): string {
	return process.env[ENV_VAR]?.trim() || 'ci (default)';
}

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
	const label = `[${cls}] ${name}`;
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
 */
export function suiteRequiring(
	cls: TestClass,
	name: string,
	requirement: { available: boolean; reason: string },
	fn: () => void
): void {
	const label = `[${cls}] ${name}`;
	if (!selection.has(cls)) {
		suite(cls, name, fn);
		return;
	}
	if (requirement.available) {
		describe(label, fn);
		return;
	}
	coverageNotice(`SKIPPED SUITE ${label}: ${requirement.reason}`);
	describe.skip(`${label} -- SKIPPED: ${requirement.reason}`, fn);
}
