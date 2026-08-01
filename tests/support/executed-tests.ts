import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Reporter, TestCase, TestModule, TestSuite, Vitest } from 'vitest/node';
import { REPO_ROOT, SUITES, type SuiteName } from './suite-inventory';
import {
	CLASSES_ENV_VAR,
	TEST_CLASSES,
	classOfSuiteName,
	selectedClassesFrom,
	type TestClass,
} from './test-classes';

/**
 * Executed-test inventory (JR-1-05c, findings F14 and F15).
 *
 * ---------------------------------------------------------------------------------------------
 * What was wrong with counting files
 * ---------------------------------------------------------------------------------------------
 * `suite-inventory.ts` (JR-1-05b) counts **files**. The damage it exists to prevent -- "the
 * `integration` coverage disappears while CI stays green" -- is reachable without changing a single
 * file. Three ways, all measured during the `JR-1-06a` acceptance and recorded as F14/F15:
 *
 *   (a) change `suiteRequiring('ci', …)` to `suiteRequiring('nightly', …)` in the four (today eight)
 *       integration files. One token per file. The whole suite stops running, `OA_TEST_REQUIRE_INFRA`
 *       does not fire because class selection is evaluated *before* the infrastructure probe, and
 *       both guards report "verified". Measured: `163 passed | 36 skipped`, exit 0;
 *
 *   (b) a correctly named file whose tests are all `it.skip` / `it.todo` counts fully towards the
 *       minimum. Measured: `197 passed | 3 skipped | 1 todo`, exit 0;
 *
 *   (c) `minimumFiles` is a lower bound, so once a suite grows past it, a deletion the size of the
 *       slack passes unnoticed -- delete `pg-harness.int.test.ts` (13 tests, the entire JR-1-04
 *       isolation contract) while adding any other file and the count is unchanged.
 *
 * All three are invisible to a guard that looks at the filesystem, because in all three the
 * filesystem is fine. What changed is **how many tests ran**, so that is what this module watches.
 *
 * ---------------------------------------------------------------------------------------------
 * The expectation
 * ---------------------------------------------------------------------------------------------
 * For every suite and every test class, the number of tests that actually **executed** must equal
 * the number declared in `SUITES[].expectedTests` -- exactly, not at least. Executed means the test
 * reported `passed` or `failed`; `skipped` and `todo` are not executed, which is what closes (b).
 *
 * Equality rather than a lower bound is deliberate and is the F15 fix: with a lower bound, adding a
 * test creates slack, and a deletion the size of that slack is silent. The cost is that adding a test
 * means updating a number in the same commit. The error message states the new number, so the cost is
 * one copy-paste; the benefit is that no change to the executed-test count can happen without a
 * human writing it down.
 *
 * Counting **per class** rather than per suite is what closes (a): relabelling `ci` to `nightly` does
 * not reduce the total number of tests in the file, it moves them into a class that the default
 * selection does not run. `expectedTests.ci` for that suite then measures 0 and the run goes red.
 *
 * ---------------------------------------------------------------------------------------------
 * How it fails the run
 * ---------------------------------------------------------------------------------------------
 * Counting can only happen after the tests have run, and vitest offers no assertion hook there. So
 * the work is split: the reporter below measures and writes the measurement to disk, and the
 * `globalSetup` teardown reads it back and throws. Measured order in vitest 3.2.7:
 * `globalSetup` → tests → `onTestRunEnd` → summary → `onFinished` → globalSetup teardown, and a
 * throwing teardown exits 1. That is the whole mechanism.
 *
 * The measurement file is **deleted** by `globalSetup` before the run and **required** by the
 * teardown afterwards. Removing the reporter from `vitest.config.ts` therefore produces a missing
 * file and a red run, rather than a guard that quietly stopped guarding -- the same positive-
 * expectation shape `suite-inventory.ts` uses for its CI report.
 *
 * ---------------------------------------------------------------------------------------------
 * When the check does not apply
 * ---------------------------------------------------------------------------------------------
 * A run that was deliberately narrowed cannot be held to the full counts: `pnpm test -t "…"`,
 * `pnpm test <file>`, `--project unit`, `--shard`. Those are normal development commands, and a guard
 * that turns them red would be a guard people learn to ignore. Such a run therefore states, loudly,
 * that it verified nothing (Testplan rule 6: no silent caps) -- and `assert-inventory-report.mjs`
 * requires the check to have been **applicable and passed**, so the escape hatch cannot be used in
 * CI, which is the environment the guarantee is about.
 */

/** A test counts as executed when it reported one of these. `skipped` and `todo` do not. */
const EXECUTED_STATES = new Set(['passed', 'failed']);

/** Tests that ran outside any `suite()` / `suiteRequiring()` declaration land here. */
export const UNCLASSIFIED = 'unclassified';

export type CountKey = TestClass | typeof UNCLASSIFIED;
export type ClassCounts = Record<CountKey, number>;

export interface ExecutedMeasurement {
	readonly generatedAt: string;
	/** Tests that ran, per suite and class. */
	readonly executed: Record<SuiteName, ClassCounts>;
	/** Every test the run reported, executed or not. Context for the human reading a failure. */
	readonly reported: Record<SuiteName, ClassCounts>;
	/** Suites vitest resolved for this run. `--project` narrows this. */
	readonly suitesRun: string[];
	/** `OA_TEST_CLASSES` selection in effect. */
	readonly selectedClasses: TestClass[];
	/**
	 * Non-empty when the run was narrowed on purpose, with the reason spelled out. Each entry
	 * suppresses the assertion, so each entry is printed.
	 */
	readonly narrowedBy: string[];
	/** Module ids whose project name is not one of the known suites. Should always be empty. */
	readonly unknownProjects: string[];
	/**
	 * Written back by `assertExecutedTests()` after judging, so that CI can require "the check ran
	 * and passed" without recomputing the judgement. Two places implementing one rule is how F29
	 * happened; here there is one implementation and CI reads its verdict.
	 */
	readonly verdict?: ExecutedVerdict;
}

export interface ExecutedVerdict {
	/** `false` means the run was narrowed and nothing was verified. */
	readonly applicable: boolean;
	readonly checkedSuites: SuiteName[];
	readonly violations: string[];
	/** Things the reader has to be told even on a green run. */
	readonly notices: string[];
	/** One line, printed on every run. */
	readonly summary: string;
}

function emptyCounts(): ClassCounts {
	const counts = {} as ClassCounts;
	for (const cls of TEST_CLASSES) {
		counts[cls] = 0;
	}
	counts[UNCLASSIFIED] = 0;
	return counts;
}

function emptyPerSuite(): Record<SuiteName, ClassCounts> {
	const perSuite = {} as Record<SuiteName, ClassCounts>;
	for (const spec of SUITES) {
		perSuite[spec.name] = emptyCounts();
	}
	return perSuite;
}

/* -------------------------------------------------------------------------------------------- */
/* The measurement file                                                                         */
/* -------------------------------------------------------------------------------------------- */

/**
 * Where the reporter hands the measurement to the teardown.
 *
 * Under `node_modules/` on purpose: it is generated, per-run state, and this repository's CI
 * workflow writes nothing into the checkout (ADR-015). `OA_TEST_EXECUTED_REPORT` overrides it, which
 * is what the guard's own tests use.
 */
export function executedMeasurementPath(): string {
	const override = process.env.OA_TEST_EXECUTED_REPORT?.trim();
	if (override) {
		return path.resolve(override);
	}
	return path.join(REPO_ROOT, 'node_modules', '.cache', 'oa-test', 'executed-tests.json');
}

export function writeExecutedMeasurement(measurement: ExecutedMeasurement): void {
	const target = executedMeasurementPath();
	mkdirSync(path.dirname(target), { recursive: true });
	writeFileSync(target, `${JSON.stringify(measurement, null, 2)}\n`, 'utf8');
}

/**
 * Delete a previous run's measurement. Called from `globalSetup`: without this, a run in which the
 * reporter never executed would be judged against the *last* run's numbers and pass.
 */
export function resetExecutedMeasurement(): void {
	rmSync(executedMeasurementPath(), { force: true });
}

export function readExecutedMeasurement(): ExecutedMeasurement | undefined {
	const target = executedMeasurementPath();
	if (!existsSync(target)) {
		return undefined;
	}
	return JSON.parse(readFileSync(target, 'utf8')) as ExecutedMeasurement;
}

/* -------------------------------------------------------------------------------------------- */
/* The judgement -- pure, so it can be tested without running vitest inside vitest               */
/* -------------------------------------------------------------------------------------------- */

export function judgeExecutedTests(measurement: ExecutedMeasurement): ExecutedVerdict {
	const notices: string[] = [];
	const violations: string[] = [];

	const summary =
		`[TEST-EXECUTED] ` +
		SUITES.map((spec) => {
			const counts = measurement.executed[spec.name] ?? emptyCounts();
			const perClass = TEST_CLASSES.map(
				(cls) => `${cls} ${counts[cls]}/${expectedFor(spec.name, cls, measurement)}`
			).join(' ');
			return `${spec.name}: ${perClass}`;
		}).join(' · ') +
		` · selection: ${measurement.selectedClasses.join(',') || 'none'}`;

	if (measurement.narrowedBy.length > 0) {
		notices.push(
			`The executed-test inventory verified NOTHING: this run was narrowed (` +
				`${measurement.narrowedBy.join('; ')}), so the per-suite test counts cannot be ` +
				`compared against SUITES[].expectedTests. A full \`pnpm test\` is what verifies them, ` +
				`and it is what CI runs.`
		);
		return { applicable: false, checkedSuites: [], violations, notices, summary };
	}

	for (const id of measurement.unknownProjects) {
		violations.push(
			`A test module was reported under a project this guard does not know: "${id}". Either a ` +
				`project was added to vitest.config.ts without a matching entry in ` +
				`tests/support/suite-inventory.ts, or a project was renamed.`
		);
	}

	const checkedSuites: SuiteName[] = [];
	for (const spec of SUITES) {
		if (!measurement.suitesRun.includes(spec.name)) {
			// Cannot happen without `--project`, which is recorded in `narrowedBy` and returned above.
			// Kept as a violation rather than a skip: a suite vanishing from vitest's project list in an
			// unnarrowed run is precisely the "the suite is gone and nothing said so" failure.
			violations.push(
				`Suite "${spec.name}" was not part of this run at all, and the run was not narrowed. ` +
					`Its ${spec.expectedFiles} file(s) exist -- the suite-inventory check passed -- so ` +
					`vitest resolved no project for them. Check the \`projects\` list in vitest.config.ts.`
			);
			continue;
		}
		checkedSuites.push(spec.name);
		const counts = measurement.executed[spec.name] ?? emptyCounts();

		for (const cls of TEST_CLASSES) {
			const expected = expectedFor(spec.name, cls, measurement);
			const actual = counts[cls];
			if (actual === expected) {
				continue;
			}
			violations.push(describeMismatch(spec.name, cls, actual, expected, measurement));
		}

		if (counts[UNCLASSIFIED] > 0) {
			violations.push(
				`Suite "${spec.name}" ran ${counts[UNCLASSIFIED]} test(s) that are not inside a ` +
					`suite() / suiteRequiring() declaration, so no class accounts for their coverage ` +
					`and the class selectors cannot reach them. Wrap them, or the output stops saying ` +
					`what a run covered (Testplan section 2).`
			);
		}
	}

	return { applicable: true, checkedSuites, violations, notices, summary };
}

/** What the class contributes to this run: nothing at all unless the class was selected. */
function expectedFor(
	suiteName: SuiteName,
	cls: TestClass,
	measurement: ExecutedMeasurement
): number {
	if (!measurement.selectedClasses.includes(cls)) {
		return 0;
	}
	const spec = SUITES.find((candidate) => candidate.name === suiteName);
	return spec ? spec.expectedTests[cls] : 0;
}

function describeMismatch(
	suiteName: SuiteName,
	cls: TestClass,
	actual: number,
	expected: number,
	measurement: ExecutedMeasurement
): string {
	const reported = measurement.reported[suiteName]?.[cls] ?? 0;
	const notExecuted = reported - actual;
	const declared = SUITES.find((candidate) => candidate.name === suiteName)?.expectedTests[cls];
	const selected = measurement.selectedClasses.includes(cls);

	const lines = [
		`Suite "${suiteName}", class "${cls}": ${actual} test(s) executed, ${expected} expected.`,
	];
	if (!selected) {
		lines.push(
			`    Class "${cls}" is not selected (${CLASSES_ENV_VAR}=` +
				`${measurement.selectedClasses.join(',') || 'ci (default)'}), so nothing of it may run, ` +
				`yet ${actual} test(s) did. A suite is reaching past the class selector.`
		);
	} else if (actual < expected) {
		lines.push(
			`    ${notExecuted} of the ${reported} test(s) the run reported for this class did not ` +
				`execute (skipped or todo).`,
			`    This is the F14/F15 failure mode: the files are all still there, so the ` +
				`suite-inventory check is green, and coverage went away anyway. Usual causes, in the ` +
				`order they have actually happened: a suite relabelled to another class, a file whose ` +
				`tests are all \`it.skip\`, and a deleted file whose count was absorbed by a new one.`,
			`    If the reduction is intended, set expectedTests.${cls} to ${actual} for suite ` +
				`"${suiteName}" in tests/support/suite-inventory.ts in the same commit (currently ` +
				`${declared}).`
		);
	} else {
		lines.push(
			`    More tests ran than are declared. That is not a defect -- it is the bookkeeping this ` +
				`guard asks for: set expectedTests.${cls} to ${actual} for suite "${suiteName}" in ` +
				`tests/support/suite-inventory.ts in the same commit (currently ${declared}).`,
			`    The number is checked for equality on purpose (F15): a lower bound leaves slack, and ` +
				`a deletion the size of the slack passes unnoticed.`
		);
	}
	return lines.join('\n');
}

/* -------------------------------------------------------------------------------------------- */
/* The assertion, called from the globalSetup teardown                                          */
/* -------------------------------------------------------------------------------------------- */

export function assertExecutedTests(): void {
	const measurement = readExecutedMeasurement();
	if (!measurement) {
		throw new Error(
			`Executed-test inventory check failed (JR-1-05c): no measurement at ` +
				`${executedMeasurementPath()}.\n` +
				`  The reporter that writes it is registered in vitest.config.ts as \`reporters\`. ` +
				`Without it, nothing knows how many tests actually ran, and F14 is open again: the ` +
				`whole integration suite can be switched off with one token per file while both file-` +
				`based guards stay green.`
		);
	}
	const verdict = judgeExecutedTests(measurement);
	// Persisted before the throw, so a failing run also leaves the verdict behind for CI to read.
	writeExecutedMeasurement({ ...measurement, verdict });
	// Printed on green runs too: the counts are the evidence that the suites ran, and evidence that
	// is only printed on failure is evidence nobody reads.
	console.log(verdict.summary);
	for (const notice of verdict.notices) {
		console.warn(`[TEST-COVERAGE NOTICE] ${notice}`);
	}
	if (verdict.violations.length === 0) {
		return;
	}
	throw new Error(
		`Executed-test inventory check failed (JR-1-05c).\n\n` +
			verdict.violations.map((violation) => `  - ${violation}`).join('\n\n') +
			`\n\n${verdict.summary}`
	);
}

/* -------------------------------------------------------------------------------------------- */
/* The reporter                                                                                 */
/* -------------------------------------------------------------------------------------------- */

/** The outermost `describe` a test sits in -- the one `suite()` labelled with the class. */
function outermostSuiteName(test: TestCase): string | undefined {
	let current: TestSuite | TestModule = test.parent;
	let outermost: TestSuite | undefined;
	while (current.type === 'suite') {
		outermost = current;
		current = current.parent;
	}
	return outermost?.name;
}

/**
 * Measures what ran and writes it down. Registered in `vitest.config.ts`; the assertion happens in
 * the `globalSetup` teardown, because a reporter cannot fail a run.
 */
export class ExecutedTestsReporter implements Reporter {
	private narrowedBy: string[] = [];
	private suitesRun: string[] = [];

	onInit(vitest: Vitest): void {
		const config = vitest.config as typeof vitest.config & {
			shard?: { index: number; count: number };
		};
		this.suitesRun = vitest.projects.map((project) => project.name);
		const narrowed: string[] = [];
		if (config.testNamePattern) {
			narrowed.push(`test name filter -t "${String(config.testNamePattern)}"`);
		}
		if (config.filters && config.filters.length > 0) {
			narrowed.push(`file filter(s) ${config.filters.join(', ')}`);
		}
		if (config.shard) {
			narrowed.push(`--shard ${config.shard.index}/${config.shard.count}`);
		}
		// `--project` is visible as a shortened project list rather than as a flag.
		const missing = SUITES.filter((spec) => !this.suitesRun.includes(spec.name));
		if (missing.length > 0 && this.suitesRun.length > 0) {
			narrowed.push(
				`--project selected ${this.suitesRun.join(', ')} (no ` +
					`${missing.map((spec) => spec.name).join(', ')})`
			);
		}
		this.narrowedBy = narrowed;
	}

	onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
		const executed = emptyPerSuite();
		const reported = emptyPerSuite();
		const unknownProjects: string[] = [];
		const knownSuites = new Set<string>(SUITES.map((spec) => spec.name));

		for (const module of testModules) {
			const suiteName = module.project.name;
			if (!knownSuites.has(suiteName)) {
				unknownProjects.push(module.moduleId);
				continue;
			}
			const key = suiteName as SuiteName;
			for (const test of module.children.allTests()) {
				const label = outermostSuiteName(test);
				const cls: CountKey = (label && classOfSuiteName(label)) || UNCLASSIFIED;
				reported[key][cls] += 1;
				if (EXECUTED_STATES.has(test.result().state)) {
					executed[key][cls] += 1;
				}
			}
		}

		writeExecutedMeasurement({
			generatedAt: new Date().toISOString(),
			executed,
			reported,
			suitesRun: this.suitesRun,
			selectedClasses: selectedClassesFrom(process.env[CLASSES_ENV_VAR]),
			narrowedBy: this.narrowedBy,
			unknownProjects,
		});
	}
}
