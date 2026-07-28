import { assertSuiteInventory } from './suite-inventory';

/**
 * Vitest `globalSetup` (JR-105b).
 *
 * Runs once per `vitest` invocation, before any project collects a file. Everything asserted here
 * fails the run with a non-zero exit code regardless of which project was selected, which is what
 * makes the suite inventory a property of the repository rather than of the CI workflow.
 *
 * There is deliberately **no** environment variable to switch this off.
 */
export default function setup(): void {
	assertSuiteInventory();
}
