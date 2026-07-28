import { readFileSync } from 'node:fs';
import process from 'node:process';

/**
 * CI glue for JR-105b: assert that the test run reported the suites we expect.
 *
 * Usage: `node tests/support/assert-inventory-report.mjs <path to inventory report json>`
 *
 * The report is written by `assertSuiteInventory()` in `tests/support/suite-inventory.ts` when
 * `OA_TEST_INVENTORY_REPORT` is set, i.e. from vitest's `globalSetup`. Three things are therefore
 * asserted here, all of them positively:
 *
 *   1. the file exists -- so the guard ran at all. Removing the `globalSetup` entry from
 *      `vitest.config.ts` makes this step fail instead of quietly disabling the guard;
 *   2. every suite matched at least its declared minimum number of files -- so an *absent* suite
 *      fails the job, not only a skipped one;
 *   3. no test-looking file was collected by nobody.
 *
 * The minimums are read out of the report, not restated here: one place to change them.
 *
 * This deliberately replaces the earlier step that grepped the log for the *absence* of a skip
 * notice. That check passed with the whole integration suite renamed away, because a suite that does
 * not exist prints no notice.
 */

const reportPath = process.argv[2];
if (!reportPath) {
	console.error('::error::usage: assert-inventory-report.mjs <report.json>');
	process.exit(2);
}

let report;
try {
	report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
	console.error(
		`::error::No usable test-suite inventory report at ${reportPath} (${error.message}). ` +
			`The test run did not execute tests/support/global-setup.ts, so nothing verified which ` +
			`suites exist.`
	);
	process.exit(1);
}

const problems = [];

if (!Array.isArray(report.suites) || report.suites.length === 0) {
	problems.push('The report lists no suites at all.');
}

for (const suite of report.suites ?? []) {
	if (typeof suite.files !== 'number' || typeof suite.minimumFiles !== 'number') {
		problems.push(`Suite "${suite.name}" has no usable file counts in the report.`);
		continue;
	}
	if (suite.files < suite.minimumFiles) {
		problems.push(
			`Suite "${suite.name}" matched ${suite.files} file(s), expected at least ` +
				`${suite.minimumFiles} (include: ${(suite.include ?? []).join(', ')}).`
		);
	}
}

for (const file of report.unclassified ?? []) {
	problems.push(`No project collects "${file}", so it never ran.`);
}

for (const violation of report.violations ?? []) {
	problems.push(violation.split('\n')[0]);
}

if (problems.length > 0) {
	console.error('::error::Test-suite inventory is not what this repository expects:');
	for (const problem of problems) {
		console.error(`  - ${problem}`);
	}
	process.exit(1);
}

console.log(report.summary ?? '(no summary in report)');
console.log(
	`Suite inventory verified: ` +
		report.suites
			.map((suite) => `${suite.name} ${suite.files}/${suite.minimumFiles}`)
			.join(', ') +
		`, 0 unclassified test files.`
);
