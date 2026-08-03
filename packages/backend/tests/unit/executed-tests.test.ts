import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	UNCLASSIFIED,
	judgeExecutedTests,
	type ClassCounts,
	type ExecutedMeasurement,
} from '@oa-test/executed-tests';
import { SUITES, type SuiteName } from '@oa-test/suite-inventory';
import { TEST_CLASSES, classOfSuiteName, suiteLabel } from '@oa-test/test-classes';

/**
 * Units for the executed-test guard (JR-1-05c, findings F14 and F15).
 *
 * The guard decides whether coverage that disappeared **without the filesystem changing** makes the
 * run red. Its predecessor, the file inventory, was green in all three of those states, and that is
 * the entire reason this module exists -- so the three states are constructed here as data and the
 * verdict is asserted, rather than described in a comment.
 *
 * Why data and not a real vitest run: the alternative is starting a child vitest inside vitest with a
 * doctored copy of the repository, which is slow, and which tests the child's configuration as much
 * as the rule. The judgement is a pure function of the measurement for exactly this reason. That the
 * *measurement* is produced correctly is a different claim, and it is verified by hand against real
 * runs -- the reproductions are recorded in `docs/dev/journaling/06-status.md`.
 *
 * The expectations are read from `SUITES`, never written out. A literal here would turn a deliberate
 * inventory change into an unrelated red test -- the mistake `suite-inventory.test.ts` already warns
 * about in its own F15 comment.
 *
 * Classification: `ci`. Pure computation.
 */

function expectedTests(name: SuiteName): Readonly<Record<string, number>> {
	return SUITES.find((spec) => spec.name === name)!.expectedTests;
}

function counts(): ClassCounts {
	const perClass = {} as ClassCounts;
	for (const cls of TEST_CLASSES) {
		perClass[cls] = 0;
	}
	perClass[UNCLASSIFIED] = 0;
	return perClass;
}

/**
 * A measurement of the repository as it stands: every class's declared tests executed, nothing else.
 * `selectedClasses` defaults to the default selection, `ci`, so `nightly` and `manual` contribute 0.
 */
function healthy(selected: readonly string[] = ['ci']): ExecutedMeasurement {
	const executed = {} as Record<SuiteName, ClassCounts>;
	const reported = {} as Record<SuiteName, ClassCounts>;
	for (const spec of SUITES) {
		const ran = counts();
		const all = counts();
		for (const cls of TEST_CLASSES) {
			// Every declared test is reported; only the selected classes actually execute.
			all[cls] = spec.expectedTests[cls];
			ran[cls] = selected.includes(cls) ? spec.expectedTests[cls] : 0;
		}
		executed[spec.name] = ran;
		reported[spec.name] = all;
	}
	return {
		generatedAt: '2026-07-30T00:00:00.000Z',
		executed,
		reported,
		suitesRun: SUITES.map((spec) => spec.name),
		selectedClasses: selected as ExecutedMeasurement['selectedClasses'],
		narrowedBy: [],
		unknownProjects: [],
	};
}

/** Same measurement with one suite/class count changed. */
function withExecuted(
	measurement: ExecutedMeasurement,
	name: SuiteName,
	cls: string,
	value: number
): ExecutedMeasurement {
	return {
		...measurement,
		executed: {
			...measurement.executed,
			[name]: { ...measurement.executed[name], [cls]: value },
		},
	};
}

suite('ci', 'executed-test guard: the label both sides share (JR-1-05c)', () => {
	it('round-trips every class through the suite label', () => {
		for (const cls of TEST_CLASSES) {
			expect(classOfSuiteName(suiteLabel(cls, 'FilterBuilder against Postgres'))).toBe(cls);
		}
	});

	it('still recognises the class on a suite that classification.ts marked as skipped', () => {
		// `suite()` renames a non-selected suite to `[nightly] X -- SKIPPED: reason`. If the guard
		// stopped recognising that form, a relabelled suite would count as unclassified instead of as
		// "class nightly ran nothing", and the F14 message would point at the wrong thing.
		expect(classOfSuiteName('[nightly] X -- SKIPPED: class not selected')).toBe('nightly');
	});

	it('reports an unlabelled or unknown-labelled suite as no class at all', () => {
		expect(classOfSuiteName('FilterBuilder')).toBeUndefined();
		expect(classOfSuiteName('[weekly] FilterBuilder')).toBeUndefined();
		// Anchored: a class name elsewhere in the title is not the label.
		expect(classOfSuiteName('FilterBuilder [ci] variant')).toBeUndefined();
	});
});

suite('ci', 'executed-test guard: the four acceptance scenarios (JR-1-05c)', () => {
	it('the legitimate state is green', () => {
		const verdict = judgeExecutedTests(healthy());
		expect(verdict.violations, verdict.summary).toEqual([]);
		expect(verdict.applicable).toBe(true);
		expect(verdict.checkedSuites).toEqual(SUITES.map((spec) => spec.name));
		// The summary carries the numbers on a green run too.
		expect(verdict.summary).toContain(`integration: ci ${expectedTests('integration').ci}/`);
	});

	it('F14 (a): relabelling every integration suite to `nightly` is red', () => {
		// One token per file, no file touched: the `ci` tests move into a class the default selection
		// does not run. Measured before JR-1-05c as `163 passed | 36 skipped`, exit 0.
		const relabelled = withExecuted(healthy(), 'integration', 'ci', 0);
		const verdict = judgeExecutedTests(relabelled);
		expect(verdict.applicable).toBe(true);
		expect(verdict.violations.join('\n')).toContain(
			`Suite "integration", class "ci": 0 test(s) executed, ` +
				`${expectedTests('integration').ci} expected`
		);
		// The message has to name the failure mode, or the next reader looks for a deleted file.
		expect(verdict.violations.join('\n')).toContain('relabelled to another class');
	});

	it('F14 (b): a file whose tests are all it.skip is red', () => {
		// The file exists and counts towards expectedFiles; its tests report as skipped, not executed.
		const skipped = withExecuted(healthy(), 'unit', 'ci', expectedTests('unit').ci - 4);
		const verdict = judgeExecutedTests(skipped);
		expect(verdict.violations.join('\n')).toContain('did not execute (skipped or todo)');
	});

	it('F15: deleting a file while adding another is red, even though the file count holds', () => {
		// The state the finding describes: `pg-harness.int.test.ts` (13 tests) deleted, some other file
		// added, `integration` still matching 8 files. Only the test count moves.
		const consolidated = withExecuted(
			healthy(),
			'integration',
			'ci',
			expectedTests('integration').ci - 13 + 1
		);
		const verdict = judgeExecutedTests(consolidated);
		expect(verdict.violations).toHaveLength(1);
		expect(verdict.violations[0]).toContain(
			'deleted file whose count was absorbed by a new one'
		);
		// And it says which number to write, so the honest path is one copy-paste.
		expect(verdict.violations[0]).toContain(
			`set expectedTests.ci to ${expectedTests('integration').ci - 12}`
		);
	});

	it('more tests than declared is also red, and says so without calling it a defect', () => {
		const grown = withExecuted(healthy(), 'unit', 'ci', expectedTests('unit').ci + 1);
		const verdict = judgeExecutedTests(grown);
		expect(verdict.violations).toHaveLength(1);
		expect(verdict.violations[0]).toContain('That is not a defect');
		expect(verdict.violations[0]).toContain(
			`set expectedTests.ci to ${expectedTests('unit').ci + 1}`
		);
	});
});

suite('ci', 'executed-test guard: classes, selection and applicability (JR-1-05c)', () => {
	it('expects a non-selected class to run nothing, and flags it when it does', () => {
		// The inverse of F14: a suite that runs although its class was not selected means the class
		// selector is not reaching it, which makes `pnpm test` and `pnpm test:nightly` mean nothing.
		const leaking = withExecuted(healthy(), 'adversarial', 'nightly', 1);
		const verdict = judgeExecutedTests(leaking);
		expect(verdict.violations.join('\n')).toContain(
			'A suite is reaching past the class selector'
		);
	});

	it('expects the nightly test to run once nightly is selected', () => {
		// `pnpm test:nightly` sets OA_TEST_CLASSES=ci,nightly. The same table then expects the one
		// nightly suite to have executed -- the numbers are per class precisely so that this works
		// without a second table.
		const nightly = healthy(['ci', 'nightly']);
		expect(judgeExecutedTests(nightly).violations).toEqual([]);
		expect(
			judgeExecutedTests(withExecuted(nightly, 'adversarial', 'nightly', 0)).violations.join(
				'\n'
			)
		).toContain(
			`Suite "adversarial", class "nightly": 0 test(s) executed, ` +
				`${expectedTests('adversarial').nightly} expected`
		);
	});

	it('a narrowed run verifies nothing, and says so instead of passing quietly', () => {
		const narrowed: ExecutedMeasurement = {
			...withExecuted(healthy(), 'integration', 'ci', 0),
			narrowedBy: ['test name filter -t "RED UNTIL"'],
		};
		const verdict = judgeExecutedTests(narrowed);
		expect(verdict.applicable).toBe(false);
		expect(verdict.violations).toEqual([]);
		expect(verdict.checkedSuites).toEqual([]);
		// Testplan rule 6: a reduced run has to announce itself.
		expect(verdict.notices.join('\n')).toContain('verified NOTHING');
		expect(verdict.notices.join('\n')).toContain('-t "RED UNTIL"');
	});

	it('a suite missing from an unnarrowed run is red rather than skipped', () => {
		const gone: ExecutedMeasurement = {
			...healthy(),
			suitesRun: ['unit', 'adversarial'],
		};
		const verdict = judgeExecutedTests(gone);
		expect(verdict.violations.join('\n')).toContain(
			'Suite "integration" was not part of this run at all'
		);
		expect(verdict.checkedSuites).not.toContain('integration');
	});

	it('flags tests that ran outside any classified suite', () => {
		const stray = withExecuted(healthy(), 'unit', UNCLASSIFIED, 2);
		expect(judgeExecutedTests(stray).violations.join('\n')).toContain(
			'ran 2 test(s) that are not inside a suite() / suiteRequiring() declaration'
		);
	});

	it('flags a module reported under an unknown project', () => {
		const unknown: ExecutedMeasurement = {
			...healthy(),
			unknownProjects: ['/repo/packages/backend/tests/other/x.test.ts'],
		};
		expect(judgeExecutedTests(unknown).violations.join('\n')).toContain(
			'reported under a project this guard does not know'
		);
	});
});

suite('ci', 'executed-test guard: the declaration itself (JR-1-05c)', () => {
	it('declares a count for every suite and every class', () => {
		for (const spec of SUITES) {
			for (const cls of TEST_CLASSES) {
				expect(spec.expectedTests[cls], `${spec.name}.${cls}`).toBeTypeOf('number');
				expect(spec.expectedTests[cls], `${spec.name}.${cls}`).toBeGreaterThanOrEqual(0);
			}
			// A suite with files but no tests would be a suite whose coverage nobody can state.
			expect(spec.expectedFiles, `${spec.name} files`).toBeGreaterThan(0);
			expect(spec.expectedTests.ci, `${spec.name} ci tests`).toBeGreaterThan(0);
		}
	});
});
