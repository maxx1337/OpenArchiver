import {
	assertExecutedTests,
	readExecutedMeasurement,
	resetExecutedMeasurement,
} from './executed-tests';
import { clearLedgerDirectory, prepareLedgerDirectory } from './harness-ledger';
import { residueNotice, settleHarnessResidue } from './harness-residue';
import { assertSuiteInventory } from './suite-inventory';

/**
 * Vitest `globalSetup` (JR-1-05b, extended by JR-1-05c).
 *
 * Runs once per `vitest` invocation, in the main process. Everything asserted here fails the run with
 * a non-zero exit code regardless of which project was selected, which is what makes these checks
 * properties of the repository rather than of the CI workflow.
 *
 * There is deliberately **no** environment variable to switch any of it off.
 *
 * Before the run:
 *   - the **file** inventory (JR-1-05b): which test files exist and which project collects them;
 *   - the previous run's executed-test measurement is deleted, so a run in which the reporter never
 *     executed cannot be judged against stale numbers;
 *   - a ledger directory for this run's test databases is created and published to the workers.
 *
 * After the run (the returned teardown -- measured to be the last thing vitest does, and a throw here
 * exits 1):
 *   - test databases this run failed to release are announced and dropped (F16, F24);
 *   - the **executed-test** inventory is asserted (F14, F15). It cannot happen earlier: counting what
 *     ran requires the run to be over, and vitest has no assertion hook there.
 *
 * Both post-run checks treat a deliberately narrowed run (`-t`, a file filter, `--project`,
 * `--shard`) the same way: report, do not fail. CI runs neither narrowed, and
 * `assert-inventory-report.mjs` requires the executed-test check to have been applicable there.
 */
export default async function setup(): Promise<() => Promise<void>> {
	assertSuiteInventory();
	resetExecutedMeasurement();
	prepareLedgerDirectory();

	return async (): Promise<void> => {
		const problems: string[] = [];

		// Read before settling: the measurement says whether this run was narrowed, which decides
		// whether residue is a failure or a note.
		const measurement = readExecutedMeasurement();
		const narrowed = (measurement?.narrowedBy ?? []).length > 0;

		try {
			const residue = await settleHarnessResidue();
			if (residue.entries.length > 0) {
				// Always announced, never silent -- that is the whole of F16.
				console.warn(`[TEST-COVERAGE NOTICE] ${residueNotice(residue)}`);
				if (!narrowed) {
					problems.push(
						`The run ended with ${residue.entries.length} test database(s) still ` +
							`acquired. They have been dropped, but a full run must not produce ` +
							`residue: an afterAll teardown did not run. See the notice above for the ` +
							`names and the two usual causes (F16, F24).`
					);
				}
			}
		} catch (error) {
			// Never let bookkeeping hide the executed-test verdict.
			clearLedgerDirectory();
			problems.push(`Harness residue check itself failed: ${(error as Error).message}`);
		}

		try {
			assertExecutedTests();
		} catch (error) {
			problems.push((error as Error).message);
		}

		if (problems.length > 0) {
			throw new Error(problems.join('\n\n'));
		}
	};
}
