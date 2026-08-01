import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './suite-inventory';

/**
 * Which test databases does this run currently own? (JR-1-05c, findings F16 and F24)
 *
 * ---------------------------------------------------------------------------------------------
 * The problem
 * ---------------------------------------------------------------------------------------------
 * `acquireTestDatabase()` is called in the **module scope** of an integration file -- it has to be,
 * because `src/database` builds its singleton at import time (Testplan section 2.6). The teardown
 * hangs off `afterAll`. Two consequences, both measured:
 *
 *   - **F16**: if the module scope throws *after* the acquire -- an everyday typo -- `afterAll` never
 *     runs and the database stays. `pg-harness.ts` promises visibility for exactly this
 *     ("Anything dropped is announced") through a `process.on('exit')` warning, and that warning
 *     never arrives: it fires inside the forked worker, whose stdout does not reach the main
 *     process's summary. CI catches the residue in a separate step; locally it disappeared silently
 *     into the sweeper's 2 h window.
 *
 *   - **F24**: `pnpm test -t "…"` acquires before vitest evaluates the `-t` filter, then skips every
 *     case in the file, so the `afterAll` never runs either. Databases pile up and the next person
 *     to check for residue finds some and looks for the bug in the wrong place.
 *
 * Both have the same root: the acquire happens before anything that could secure it, and the only
 * process that survives to the end of the run is the **main** one, which knows nothing about what the
 * workers acquired.
 *
 * ---------------------------------------------------------------------------------------------
 * The fix
 * ---------------------------------------------------------------------------------------------
 * A directory of small JSON files, one per live database, written by the worker on acquisition and
 * removed on release. The main process reads what is left after the run: that set is exactly this
 * run's residue -- no timestamps, no heuristics, and no way to mistake a *concurrent* run's live
 * database for residue, which is the mistake F12 was.
 *
 * The directory is created per run by `globalSetup` and its path travels to the workers in
 * `OA_TEST_HARNESS_LEDGER`. That the variable arrives is measured, not assumed: with `pool: 'forks'`
 * the workers are forked after `globalSetup` has run and inherit its `process.env`. If it ever stops
 * arriving, `requireLedgerDirectory()` throws in the worker -- the failure is loud rather than a
 * ledger that silently records nothing.
 */

export const LEDGER_ENV_VAR = 'OA_TEST_HARNESS_LEDGER';

export interface LedgerEntry {
	/** The isolated database's name. */
	readonly databaseName: string;
	/** A URL on the **maintenance** database, so the main process can drop it without guessing. */
	readonly adminUrl: string;
	/** The label the acquiring file passed, for the announcement. */
	readonly label: string;
	/** The worker process that acquired it. */
	readonly pid: number;
	readonly acquiredAt: string;
}

/** Only harness-generated names. Anything else must never reach a `DROP DATABASE`. */
export const LEDGER_DB_NAME = /^oa_test_[a-z0-9_]+$/;

function entryFileName(databaseName: string): string {
	if (!LEDGER_DB_NAME.test(databaseName)) {
		throw new Error(
			`Refusing to write a harness ledger entry for "${databaseName}": harness-generated ` +
				`names match ${LEDGER_DB_NAME.source} only.`
		);
	}
	return `${databaseName}.json`;
}

/**
 * Create this run's ledger directory and publish it to the workers. Main process only.
 *
 * A fresh directory per run rather than one shared directory: two `pnpm test` runs against the same
 * server must not be able to see each other's entries, or the older mistake returns in a new shape.
 */
export function prepareLedgerDirectory(): string {
	const directory = path.join(
		REPO_ROOT,
		'node_modules',
		'.cache',
		'oa-test',
		`harness-${process.pid}-${Date.now()}`
	);
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(directory, { recursive: true });
	process.env[LEDGER_ENV_VAR] = directory;
	return directory;
}

/** The ledger directory, or `undefined` outside a run that prepared one. */
export function ledgerDirectory(): string | undefined {
	const raw = process.env[LEDGER_ENV_VAR]?.trim();
	return raw ? raw : undefined;
}

/**
 * The ledger directory, or a loud failure. Used by the acquire path: a harness that cannot record
 * what it created is a harness whose residue is invisible again, and that is the finding.
 */
export function requireLedgerDirectory(): string {
	const directory = ledgerDirectory();
	if (!directory) {
		throw new Error(
			`${LEDGER_ENV_VAR} is not set, so an acquired test database could not be recorded and ` +
				`residue from this run would be invisible (F16/F24). It is set by vitest's globalSetup ` +
				`(tests/support/global-setup.ts). Outside a vitest run, point it at a writable ` +
				`directory yourself.`
		);
	}
	return directory;
}

export function recordAcquisition(entry: LedgerEntry): void {
	const directory = requireLedgerDirectory();
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		path.join(directory, entryFileName(entry.databaseName)),
		`${JSON.stringify(entry, null, 2)}\n`,
		'utf8'
	);
}

/** Idempotent, and never throws: a failed release must not be masked by a bookkeeping error. */
export function forgetAcquisition(databaseName: string): void {
	const directory = ledgerDirectory();
	if (!directory) {
		return;
	}
	try {
		rmSync(path.join(directory, entryFileName(databaseName)), { force: true });
	} catch {
		// Nothing to do about it here; the main process reports whatever is left.
	}
}

/** What this run still owns. Sorted, so the announcement is stable. */
export function listLedgerEntries(directory = ledgerDirectory()): LedgerEntry[] {
	if (!directory || !existsSync(directory)) {
		return [];
	}
	const entries: LedgerEntry[] = [];
	for (const name of readdirSync(directory).sort()) {
		if (!name.endsWith('.json')) {
			continue;
		}
		try {
			entries.push(
				JSON.parse(readFileSync(path.join(directory, name), 'utf8')) as LedgerEntry
			);
		} catch {
			// A truncated entry -- a worker killed mid-write -- still says a database exists. Report
			// what the file name carries rather than dropping the fact on the floor.
			entries.push({
				databaseName: name.replace(/\.json$/, ''),
				adminUrl: '',
				label: '(unreadable ledger entry)',
				pid: 0,
				acquiredAt: '',
			});
		}
	}
	return entries;
}

export function clearLedgerDirectory(directory = ledgerDirectory()): void {
	if (!directory) {
		return;
	}
	rmSync(directory, { recursive: true, force: true });
}
