import { readFileSync } from 'node:fs';
import process from 'node:process';

/**
 * CI glue for JR-105b and JR-105c: assert that the test run reported the suites we expect, and that
 * the tests in them actually ran.
 *
 * Usage: `node tests/support/assert-inventory-report.mjs <inventory.json> <executed-tests.json>`
 *
 * The first report is written by `assertSuiteInventory()` in `tests/support/suite-inventory.ts` when
 * `OA_TEST_INVENTORY_REPORT` is set; the second by the reporter and teardown in
 * `tests/support/executed-tests.ts` when `OA_TEST_EXECUTED_REPORT` is set. Both come out of vitest's
 * `globalSetup` path, and everything below is asserted **positively**:
 *
 *   1. both files exist -- so both guards ran at all. Removing the `globalSetup` entry or the
 *      reporter from `vitest.config.ts` makes this step fail instead of quietly disabling a guard;
 *   2. every suite matched exactly its declared number of files -- so an *absent* suite fails the
 *      job, not only a skipped one;
 *   3. no test-looking file was collected by nobody;
 *   4. the executed-test check was **applicable** -- the run was not narrowed by `-t`, a file filter,
 *      `--project` or `--shard` -- and it **passed**. Applicability is asserted separately because a
 *      narrowed run verifies nothing, and CI is the environment the guarantee is about.
 *
 * The expected counts are read out of the reports, and the executed-test **verdict** is read rather
 * than recomputed: one implementation of the rule, in `executed-tests.ts`. Two places implementing
 * one rule and diverging is finding F29.
 *
 * This deliberately replaces the earlier step that grepped the log for the *absence* of a skip
 * notice. That check passed with the whole integration suite renamed away, because a suite that does
 * not exist prints no notice.
 */

const reportPath = process.argv[2];
const executedPath = process.argv[3];
if (!reportPath || !executedPath) {
	console.error(
		'::error::usage: assert-inventory-report.mjs <inventory.json> <executed-tests.json>'
	);
	process.exit(2);
}

const problems = [];

function load(label, file, hint) {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch (error) {
		problems.push(`No usable ${label} at ${file} (${error.message}). ${hint}`);
		return undefined;
	}
}

const report = load(
	'test-suite inventory report',
	reportPath,
	'The test run did not execute tests/support/global-setup.ts, so nothing verified which suites exist.'
);
const executed = load(
	'executed-test measurement',
	executedPath,
	'The run produced no executed-test measurement, so nothing verified that the tests in those ' +
		'suites actually ran (F14). The reporter is registered in vitest.config.ts.'
);

if (report && (!Array.isArray(report.suites) || report.suites.length === 0)) {
	problems.push('The inventory report lists no suites at all.');
}

for (const suite of report?.suites ?? []) {
	if (typeof suite.files !== 'number' || typeof suite.expectedFiles !== 'number') {
		problems.push(`Suite "${suite.name}" has no usable file counts in the report.`);
		continue;
	}
	if (suite.files !== suite.expectedFiles) {
		problems.push(
			`Suite "${suite.name}" matched ${suite.files} file(s), expected exactly ` +
				`${suite.expectedFiles} (include: ${(suite.include ?? []).join(', ')}).`
		);
	}
}

for (const file of report?.unclassified ?? []) {
	problems.push(`No project collects "${file}", so it never ran.`);
}

for (const violation of report?.violations ?? []) {
	problems.push(violation.split('\n')[0]);
}

if (executed) {
	if (!executed.verdict) {
		problems.push(
			'The executed-test measurement carries no verdict, so the globalSetup teardown that ' +
				'judges it did not run to completion.'
		);
	} else if (!executed.verdict.applicable) {
		problems.push(
			`The executed-test check verified nothing because the run was narrowed ` +
				`(${(executed.narrowedBy ?? []).join('; ') || 'reason not recorded'}). CI must run an ` +
				`unnarrowed \`pnpm test\`: a narrowed run cannot show that the suites ran.`
		);
	}
	for (const violation of executed.verdict?.violations ?? []) {
		problems.push(violation.split('\n')[0]);
	}
}

if (problems.length > 0) {
	console.error('::error::Test-suite inventory is not what this repository expects:');
	for (const problem of problems) {
		console.error(`  - ${problem}`);
	}
	process.exit(1);
}

console.log(report.summary ?? '(no summary in report)');
console.log(executed.verdict.summary ?? '(no summary in measurement)');
console.log(
	`Suite inventory verified: ` +
		report.suites
			.map((suite) => `${suite.name} ${suite.files}/${suite.expectedFiles}`)
			.join(', ') +
		`, 0 unclassified test files.`
);
console.log(
	`Executed-test inventory verified for ` +
		`${(executed.verdict.checkedSuites ?? []).join(', ') || '(no suite)'}.`
);
