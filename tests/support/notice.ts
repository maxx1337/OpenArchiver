/**
 * Visible coverage notices (JR-102).
 *
 * Testplan rule 6: "Keine stillen Kürzungen." Whenever coverage is reduced — a suite skipped
 * because its class was not selected, infrastructure missing, a sampled iteration count instead
 * of the full one — the *test output* has to say so. A silently reduced run reads like a covered
 * one, and that is exactly the failure mode this project cannot afford.
 *
 * Notices are written to stderr via `console.warn` so they survive every vitest reporter,
 * including the non-verbose default one that does not print skipped test names.
 */

const emitted = new Set<string>();

/**
 * Emit a coverage notice exactly once per worker process.
 * Deduplicated so a helper called from 30 tests does not print 30 identical lines.
 */
export function coverageNotice(message: string): void {
	if (emitted.has(message)) {
		return;
	}
	emitted.add(message);
	console.warn(`[TEST-COVERAGE NOTICE] ${message}`);
}

/**
 * Announce that a test ran a reduced number of iterations compared to its full variant.
 * Use this in the `ci` smoke variant of anything that has a `nightly` full variant, so nobody
 * mistakes the smoke run for the real one.
 */
export function announceSampling(
	what: string,
	ran: number,
	full: number,
	fullVariant: string
): void {
	coverageNotice(
		`${what}: ran ${ran} of ${full} iterations (sampled). ` +
			`The full run is the separate variant "${fullVariant}".`
	);
}
