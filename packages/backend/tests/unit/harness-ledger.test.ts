import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import {
	LEDGER_ENV_VAR,
	clearLedgerDirectory,
	forgetAcquisition,
	ledgerDirectory,
	listLedgerEntries,
	recordAcquisition,
	requireLedgerDirectory,
	type LedgerEntry,
} from '@oa-test/harness-ledger';

/**
 * Units for the harness ledger (JR-1-05c, findings F16 and F24).
 *
 * The ledger is how the **main** process learns which test databases a worker acquired and never
 * released. Before it, that knowledge lived only in the worker, and the worker's `process.on('exit')`
 * warning does not reach the main process's output -- so a database left behind by a module-scope
 * throw disappeared silently into the sweeper's two-hour window (F16), as did every database a
 * filtered `pnpm test -t` acquired and skipped past (F24).
 *
 * What is tested here is the bookkeeping: an entry appears, disappears on release, survives a
 * truncated write, and cannot be written for a name that is not one the harness generates. What is
 * **not** tested here is the dropping of the databases, which needs Postgres and is exercised by the
 * integration suite plus the by-hand reproductions recorded in `06-status.md`.
 *
 * Classification: `ci`. Temp directory only, no infrastructure.
 */

const previous = process.env[LEDGER_ENV_VAR];

function useTempLedger(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'oa-ledger-'));
	process.env[LEDGER_ENV_VAR] = directory;
	return directory;
}

afterEach(() => {
	const directory = ledgerDirectory();
	if (directory && directory.includes('oa-ledger-')) {
		rmSync(directory, { recursive: true, force: true });
	}
	if (previous === undefined) {
		delete process.env[LEDGER_ENV_VAR];
	} else {
		process.env[LEDGER_ENV_VAR] = previous;
	}
});

function entry(databaseName: string, label = 'filter-builder'): LedgerEntry {
	return {
		databaseName,
		adminUrl: 'postgresql://postgres@127.0.0.1:5432/postgres',
		label,
		pid: 4242,
		acquiredAt: '2026-07-30T00:00:00.000Z',
	};
}

suite('ci', 'harness ledger: bookkeeping (JR-1-05c)', () => {
	it('records an acquisition and forgets it on release', () => {
		useTempLedger();
		recordAcquisition(entry('oa_test_1785250142201_13433_bdeb2d_filter_builder'));
		expect(listLedgerEntries().map((found) => found.databaseName)).toEqual([
			'oa_test_1785250142201_13433_bdeb2d_filter_builder',
		]);
		forgetAcquisition('oa_test_1785250142201_13433_bdeb2d_filter_builder');
		expect(listLedgerEntries()).toEqual([]);
	});

	it('keeps the fields the announcement needs', () => {
		useTempLedger();
		recordAcquisition(entry('oa_test_1785250142201_13433_bdeb2d_pg_harness', 'pg-harness'));
		const [found] = listLedgerEntries();
		expect(found.label).toBe('pg-harness');
		expect(found.pid).toBe(4242);
		// The maintenance URL is what lets the main process drop the database without having to
		// reconstruct it from DATABASE_URL, which the main process may not even have.
		expect(found.adminUrl).toContain('127.0.0.1:5432');
	});

	it('is stable in order and survives an unreadable entry', () => {
		const directory = useTempLedger();
		recordAcquisition(entry('oa_test_1785250142201_13433_bbbbbb_b'));
		recordAcquisition(entry('oa_test_1785250142201_13433_aaaaaa_a'));
		// A worker killed mid-write leaves a truncated file. It still means "a database exists", so it
		// has to be reported rather than dropped on the floor.
		writeFileSync(path.join(directory, 'oa_test_1785250142201_13433_cccccc_c.json'), '{"data');
		const names = listLedgerEntries().map((found) => found.databaseName);
		expect(names).toEqual([
			'oa_test_1785250142201_13433_aaaaaa_a',
			'oa_test_1785250142201_13433_bbbbbb_b',
			'oa_test_1785250142201_13433_cccccc_c',
		]);
		expect(listLedgerEntries()[2].label).toBe('(unreadable ledger entry)');
	});

	it('ignores files that are not ledger entries', () => {
		const directory = useTempLedger();
		writeFileSync(path.join(directory, 'notes.txt'), 'not an entry');
		expect(listLedgerEntries()).toEqual([]);
	});

	it('refuses to record a name the harness would never generate', () => {
		useTempLedger();
		// The entry's file name becomes a `DROP DATABASE` target in the main process. A name from
		// outside the harness must not get that far -- the same reasoning as `quoteIdentifier()` in
		// pg-harness.ts, applied one step earlier.
		for (const bad of ['postgres', 'oa_test_x"; drop schema public', 'OA_TEST_UPPER', '']) {
			expect(() => recordAcquisition(entry(bad)), bad).toThrow(/Refusing to write/);
		}
		expect(readdirSync(ledgerDirectory()!)).toEqual([]);
	});

	it('clears the whole directory', () => {
		const directory = useTempLedger();
		recordAcquisition(entry('oa_test_1785250142201_13433_bdeb2d_a'));
		clearLedgerDirectory();
		expect(existsSync(directory)).toBe(false);
		// And reading a cleared ledger is empty rather than an error.
		expect(listLedgerEntries()).toEqual([]);
	});
});

suite('ci', 'harness ledger: the loud failure (JR-1-05c)', () => {
	it('refuses to acquire without a ledger directory instead of recording nothing', () => {
		// This is the guard against the ledger quietly not being there: `acquireTestDatabase()` calls
		// `requireLedgerDirectory()` before it creates anything, so a run whose globalSetup did not
		// publish the directory fails loudly rather than producing residue nobody announces.
		delete process.env[LEDGER_ENV_VAR];
		expect(ledgerDirectory()).toBeUndefined();
		expect(() => requireLedgerDirectory()).toThrow(new RegExp(LEDGER_ENV_VAR));
		expect(() => requireLedgerDirectory()).toThrow(/globalSetup/);
	});

	it('treats an empty or whitespace value as absent', () => {
		process.env[LEDGER_ENV_VAR] = '   ';
		expect(ledgerDirectory()).toBeUndefined();
		// And forgetting is a no-op rather than a crash, so a failed release surfaces its own error.
		expect(() => forgetAcquisition('oa_test_1785250142201_13433_bdeb2d_a')).not.toThrow();
	});
});
