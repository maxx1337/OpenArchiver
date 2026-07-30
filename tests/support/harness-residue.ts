import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './suite-inventory';
import {
	LEDGER_DB_NAME,
	clearLedgerDirectory,
	listLedgerEntries,
	type LedgerEntry,
} from './harness-ledger';

/**
 * Announce and clean up the test databases this run failed to release (JR-105c, F16 and F24).
 *
 * Runs in the **main** vitest process, from the `globalSetup` teardown -- the one process that
 * outlives every worker and whose output reaches the summary. The worker-side
 * `process.on('exit')` warning in `pg-harness.ts` cannot do this job: it fires inside a forked
 * worker whose stdout does not arrive (F16). It is kept anyway, because it is the only thing that
 * speaks when a worker dies in a way that skips this path entirely.
 *
 * Two deliberate asymmetries:
 *
 *   - The residue is **dropped**, not only reported. F24 is about a filtered run leaving databases
 *     behind, and reporting them without removing them would leave the misleading state in place.
 *   - Whether residue makes the run **red** is decided by the caller, not here, and it is decided by
 *     the same question the executed-test guard asks: was the run narrowed on purpose? An unnarrowed
 *     run -- what CI runs -- must go red, or dropping the residue here would take away the guarantee
 *     CI's "Assert no leftover test databases" step provides today. A `-t` run must not.
 */

export interface ResidueOutcome {
	/** What the ledger still held after the run. */
	readonly entries: LedgerEntry[];
	readonly dropped: string[];
	readonly failed: { readonly databaseName: string; readonly reason: string }[];
}

type SqlClient = {
	unsafe(query: string): Promise<unknown>;
	end(options?: { timeout?: number }): Promise<void>;
};
type PostgresFactory = (url: string, options: Record<string, unknown>) => SqlClient;

/**
 * `postgres` is a dependency of `@open-archiver/backend`, not of the workspace root, so a bare
 * specifier does not resolve from this directory under pnpm's layout. Resolved explicitly rather
 * than hoisted-by-luck, and a failure to resolve is reported instead of swallowed.
 */
async function loadPostgres(): Promise<{ factory?: PostgresFactory; reason?: string }> {
	try {
		const require = createRequire(path.join(REPO_ROOT, 'packages', 'backend', 'package.json'));
		const resolved = require.resolve('postgres');
		const module = (await import(pathToFileURL(resolved).href)) as {
			default?: PostgresFactory;
		};
		const factory = module.default ?? (module as unknown as PostgresFactory);
		if (typeof factory !== 'function') {
			return { reason: `resolved ${resolved} but it does not export a callable client` };
		}
		return { factory };
	} catch (error) {
		return { reason: (error as Error).message };
	}
}

/**
 * Drop whatever the ledger still lists, then clear the ledger. Never throws: the caller decides what
 * a non-empty outcome means, and a failure to clean up must not hide the report of what was found.
 */
export async function settleHarnessResidue(): Promise<ResidueOutcome> {
	const entries = listLedgerEntries();
	if (entries.length === 0) {
		clearLedgerDirectory();
		return { entries, dropped: [], failed: [] };
	}

	const dropped: string[] = [];
	const failed: { databaseName: string; reason: string }[] = [];
	const { factory, reason } = await loadPostgres();

	// One connection per distinct maintenance URL; in practice there is exactly one.
	const byAdminUrl = new Map<string, LedgerEntry[]>();
	for (const entry of entries) {
		if (!LEDGER_DB_NAME.test(entry.databaseName)) {
			failed.push({
				databaseName: entry.databaseName,
				reason: 'name is not one the harness generates, refusing to build DDL for it',
			});
			continue;
		}
		if (!entry.adminUrl) {
			failed.push({
				databaseName: entry.databaseName,
				reason: 'the ledger entry carries no maintenance URL (written by a killed worker?)',
			});
			continue;
		}
		if (!factory) {
			failed.push({
				databaseName: entry.databaseName,
				reason: `the postgres client could not be loaded in the main process (${reason})`,
			});
			continue;
		}
		const group = byAdminUrl.get(entry.adminUrl);
		if (group) {
			group.push(entry);
		} else {
			byAdminUrl.set(entry.adminUrl, [entry]);
		}
	}

	for (const [adminUrl, group] of byAdminUrl) {
		let sql: SqlClient | undefined;
		try {
			sql = factory!(adminUrl, { max: 1, idle_timeout: 2, connect_timeout: 10 });
			for (const entry of group) {
				try {
					// FORCE terminates backends the dead worker left behind.
					await sql.unsafe(
						`drop database if exists "${entry.databaseName}" with (force)`
					);
					dropped.push(entry.databaseName);
				} catch (error) {
					failed.push({
						databaseName: entry.databaseName,
						reason: (error as Error).message,
					});
				}
			}
		} catch (error) {
			for (const entry of group) {
				failed.push({ databaseName: entry.databaseName, reason: (error as Error).message });
			}
		} finally {
			await sql?.end({ timeout: 5 }).catch(() => undefined);
		}
	}

	clearLedgerDirectory();
	return { entries, dropped: dropped.sort(), failed };
}

/**
 * The announcement. Always printed when residue was found, whether or not the caller then fails the
 * run -- residue disappearing silently is what F16 is about, and this is the message the module
 * always promised and never delivered locally.
 */
export function residueNotice(outcome: ResidueOutcome): string {
	const lines = [
		`pg-harness: the run ended with ${outcome.entries.length} test database(s) still ` +
			`acquired, i.e. an afterAll teardown did not run.`,
	];
	for (const entry of outcome.entries) {
		lines.push(
			`  ${entry.databaseName} (label "${entry.label}", worker pid ${entry.pid}` +
				`${entry.acquiredAt ? `, acquired ${entry.acquiredAt}` : ''})`
		);
	}
	if (outcome.dropped.length > 0) {
		lines.push(`  dropped now: ${outcome.dropped.join(', ')}`);
	}
	for (const failure of outcome.failed) {
		lines.push(`  NOT dropped: ${failure.databaseName} -- ${failure.reason}`);
	}
	lines.push(
		`  Usual causes: the module scope of an integration file threw after acquireTestDatabase() ` +
			`(F16), or a filtered run skipped every case in a file so its afterAll never ran (F24).`
	);
	return lines.join('\n');
}
