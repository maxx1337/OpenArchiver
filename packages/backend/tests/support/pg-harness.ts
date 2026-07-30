import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { afterAll } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { coverageNotice } from '@oa-test/notice';
import {
	forgetAcquisition,
	recordAcquisition,
	requireLedgerDirectory,
} from '@oa-test/harness-ledger';
import * as schema from '../../src/database/schema';

/**
 * Integration-test database harness (JR-104).
 *
 * Contract, in the words of the acceptance criteria:
 *   1. Isolation per test run -- two runs must be able to proceed in parallel without touching
 *      each other's data.
 *   2. Migrations are applied automatically, using the repository's real migration files.
 *   3. Teardown is guaranteed, including when a test throws. No residue in the database.
 *
 * ---------------------------------------------------------------------------------------------
 * Why a whole database and not a schema
 * ---------------------------------------------------------------------------------------------
 * `search_path`-based schema isolation is the cheaper mechanism and needs no CREATEDB right, and
 * it is what was tried first. It does not work against *these* migrations, and the reason is in
 * the migration files rather than in the harness:
 *
 *   packages/backend/src/database/migrations/0000_amusing_namora.sql:1
 *     CREATE TYPE "public"."retention_action" AS ENUM(...)
 *   packages/backend/src/database/migrations/0000_amusing_namora.sql:120
 *     ... REFERENCES "public"."custodians"("id") ...
 *
 * drizzle-kit emits enum creation and every foreign-key target schema-qualified as `"public"`,
 * while `CREATE TABLE` is unqualified. Under a `search_path` of `oa_test_x` the tables would be
 * created in `oa_test_x` and the foreign keys would point at `public.custodians`, which does not
 * exist there -- and a second parallel run would collide on `CREATE TYPE "public"."..."`, which
 * ignores `search_path` entirely. Schema isolation is therefore not available without editing
 * generated migrations, which is out of the question (CLAUDE.md 5.2).
 *
 * One database per acquisition sidesteps all of it: `"public"` inside a fresh database is that
 * database's own `public`. The cost is the CREATEDB privilege for the bootstrap role -- see the
 * privilege note in docs/dev/journaling/04-testplan.md.
 *
 * ---------------------------------------------------------------------------------------------
 * Why `process.env.DATABASE_URL` has to be set by the caller, before importing anything
 * ---------------------------------------------------------------------------------------------
 * `packages/backend/src/database/index.ts` builds its `db` singleton at *import* time from
 * `process.env.DATABASE_URL`, and throws when it is unset. Any test that exercises
 * `FilterBuilder` or `mongoToMeli` therefore has to (a) acquire the harness, (b) assign
 * `process.env.DATABASE_URL = harness.url`, and only then (c) `await import(...)` the module under
 * test. `bindAsProcessDatabaseUrl()` below does (b) and refuses to do it after the singleton has
 * already been created, so the mistake fails loudly instead of silently testing the wrong
 * database. The `integration` project pins `pool: 'forks'` + `isolate: true` so that this
 * per-file mutation of `process.env` cannot leak into another test file.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The repository's real migration folder -- not a copy, not a rebuild. */
export const MIGRATIONS_FOLDER = path.resolve(HERE, '../../src/database/migrations');

/** Number of migrations drizzle-kit has recorded. Used to prove migrations actually ran. */
export function expectedMigrationCount(): number {
	const journalPath = path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json');
	const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
		entries?: unknown[];
	};
	if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
		throw new Error(
			`${journalPath} has no migration entries; the harness cannot verify itself.`
		);
	}
	return journal.entries.length;
}

/**
 * Tables the harness insists on finding after migrating. Not an exhaustive list -- a spot check
 * that says "the schema is really here", so a silently skipped migration run cannot pass as a
 * successful one.
 */
const REQUIRED_TABLES = [
	'users',
	'roles',
	'user_roles',
	'ingestion_sources',
	'archived_emails',
] as const;

const DB_NAME_PREFIX = 'oa_test_';
/** `oa_test_<13-digit epoch ms>_<pid>_<rand>_<label>` -- both fields are read by the sweeper. */
const DB_NAME_PATTERN = /^oa_test_(\d{13})_(\d+)_/;
const MAX_IDENTIFIER_BYTES = 63;

/**
 * The pid field the sweeper's own fixtures carry (F12/JR-104a).
 *
 * It must not be this process's pid: guard 1 of the sweeper skips databases created by the running
 * process, so a fixture named with our own pid could never be observed being swept, and the test
 * would assert nothing. It is not otherwise special -- uniqueness of the fixture name comes from
 * `buildForeignFixtureName()`, not from this number.
 */
export const FOREIGN_FIXTURE_PID = 999999;

function maintenanceDatabase(): string {
	return process.env.OA_TEST_PG_MAINTENANCE_DB?.trim() || 'postgres';
}

function staleThresholdMs(): number {
	const raw = process.env.OA_TEST_PG_STALE_MS?.trim();
	if (!raw) {
		return 2 * 60 * 60 * 1000;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(
			`OA_TEST_PG_STALE_MS must be a positive number of milliseconds, got "${raw}".`
		);
	}
	return parsed;
}

function requireDatabaseUrl(): string {
	const raw = process.env.DATABASE_URL;
	if (!raw) {
		throw new Error(
			'DATABASE_URL is not set. The integration harness needs a reachable Postgres; gate the ' +
				'suite with suiteRequiring(..., await probePostgres(), ...) so a missing database is ' +
				'reported as a visible skip instead of an error.'
		);
	}
	return raw;
}

/** Same base server, different database name. */
function urlForDatabase(baseUrl: string, database: string): string {
	const url = new URL(baseUrl);
	url.pathname = `/${database}`;
	return url.toString();
}

function sanitiseLabel(label: string): string {
	const cleaned = label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return cleaned.slice(0, 20) || 'anon';
}

function buildDatabaseName(label: string): string {
	const epoch = String(Date.now()).padStart(13, '0').slice(0, 13);
	// Not derived from the clock: two acquisitions inside the same millisecond in the same process
	// would otherwise produce the same name and the second `CREATE DATABASE` would fail. The
	// four-harness concurrency test in pg-harness.int.test.ts exists to keep this honest.
	const random = randomBytes(3).toString('hex');
	const name = `${DB_NAME_PREFIX}${epoch}_${process.pid}_${random}_${sanitiseLabel(label)}`;
	if (Buffer.byteLength(name, 'utf8') > MAX_IDENTIFIER_BYTES) {
		return name.slice(0, MAX_IDENTIFIER_BYTES);
	}
	return name;
}

/**
 * Build a database name that looks like residue left behind by a **different**, already-dead run.
 * Used only by the sweeper's own tests, which need a database the sweeper is willing to consider.
 *
 * Two properties pull in opposite directions and both have to hold (F12, JR-104a):
 *
 *   - the pid field must **not** be this process's pid, or guard 1 skips the fixture and the test
 *     could never observe a sweep at all;
 *   - the name as a whole must still be unique **per process**, or two integration runs against the
 *     same server collide on `pg_database_datname_index` -- which is exactly what F12 was.
 *
 * So the pid field carries the fixed foreign marker and the uniqueness lives in the tag: this
 * process's real pid plus random bytes, placed in the part of the name the sweeper does not
 * interpret.
 *
 * `createdAtMs` is the age the fixture should pretend to have. Callers must keep it **well inside**
 * the default `OA_TEST_PG_STALE_MS` window (2 h): a fixture that looks older than the default
 * threshold is indistinguishable from real residue, and a concurrently running foreign process's
 * `acquireTestDatabase()` sweep would legitimately drop it out from under the test.
 */
export function buildForeignFixtureName(label: string, createdAtMs: number): string {
	if (FOREIGN_FIXTURE_PID === process.pid) {
		// Astronomically unlikely, but a silent skip here would turn the sweeper test into a
		// tautology, so it fails loudly instead.
		throw new Error(
			`This process's pid is ${process.pid}, which equals FOREIGN_FIXTURE_PID. The sweeper ` +
				`fixture would be protected by the own-pid guard and the test would assert nothing.`
		);
	}
	const epoch = String(createdAtMs).padStart(13, '0').slice(0, 13);
	if (epoch.length !== 13) {
		throw new Error(`createdAtMs=${createdAtMs} does not render as a 13-digit epoch.`);
	}
	const tag = `${process.pid}${randomBytes(4).toString('hex')}`;
	const name = `${DB_NAME_PREFIX}${epoch}_${FOREIGN_FIXTURE_PID}_${tag}_${sanitiseLabel(label)}`;
	if (Buffer.byteLength(name, 'utf8') > MAX_IDENTIFIER_BYTES) {
		// Never truncate: truncation is what would reintroduce collisions between processes.
		throw new Error(
			`Fixture name "${name}" is ${Buffer.byteLength(name, 'utf8')} bytes, over the ` +
				`${MAX_IDENTIFIER_BYTES}-byte identifier limit. Use a shorter label.`
		);
	}
	if (!DB_NAME_PATTERN.test(name)) {
		throw new Error(`Fixture name "${name}" is not one the sweeper would parse.`);
	}
	return name;
}

/** Quote an identifier for a context where parameters are not allowed (CREATE/DROP DATABASE). */
function quoteIdentifier(name: string): string {
	if (!/^[a-z0-9_]+$/.test(name)) {
		// The harness only ever generates `[a-z0-9_]`. Anything else means a caller passed a name
		// in from outside, and building DDL out of it would be an injection.
		throw new Error(
			`Refusing to build DDL for the identifier "${name}": harness-generated names match ` +
				`/^[a-z0-9_]+$/ only.`
		);
	}
	return `"${name}"`;
}

/**
 * Run `fn` against the maintenance database (`postgres` by default). Short-lived connection: a
 * long-lived admin pool would itself become a reason `DROP DATABASE` fails.
 */
export async function withAdminConnection<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
	const adminUrl = urlForDatabase(requireDatabaseUrl(), maintenanceDatabase());
	const sql = postgres(adminUrl, { max: 1, idle_timeout: 2, connect_timeout: 10 });
	try {
		return await fn(sql);
	} finally {
		await sql.end({ timeout: 5 });
	}
}

/** Does a database of this name exist? Used by the teardown assertions. */
export async function databaseExists(name: string): Promise<boolean> {
	return withAdminConnection(async (sql) => {
		const rows = await sql<{ count: string }[]>`
			select count(*)::text as count from pg_database where datname = ${name}
		`;
		return rows[0]!.count !== '0';
	});
}

/** Every harness database currently on the server, whoever created it. */
export async function listHarnessDatabases(): Promise<string[]> {
	return withAdminConnection(async (sql) => {
		const rows = await sql<{ datname: string }[]>`
			select datname from pg_database
			where datname like ${DB_NAME_PREFIX + '%'}
			order by datname
		`;
		return rows.map((row) => row.datname);
	});
}

async function dropDatabase(sql: Sql, name: string): Promise<void> {
	const quoted = quoteIdentifier(name);
	try {
		// FORCE (Postgres 13+) terminates remaining backends itself, which is what makes teardown
		// survive a client that leaked a connection.
		await sql.unsafe(`drop database if exists ${quoted} with (force)`);
		return;
	} catch (error) {
		coverageNotice(
			`pg-harness: "drop database ... with (force)" failed for ${name} ` +
				`(${(error as Error).message}); falling back to terminate + plain drop.`
		);
	}
	await sql`
		select pg_terminate_backend(pid) from pg_stat_activity where datname = ${name}
	`;
	await sql.unsafe(`drop database if exists ${quoted}`);
}

/**
 * Drop harness databases left behind by a previous, hard-killed run.
 *
 * A crashed or SIGKILLed worker cannot run its own teardown, so without this the acceptance
 * criterion "no residue in the database" would decay over time. Three guards keep it from eating a
 * database that is still in use, in increasing order of reliability:
 *
 *   1. the embedded pid: never sweep a database this process created;
 *   2. open backends: never sweep a database something is still connected to;
 *   3. the embedded creation timestamp against `OA_TEST_PG_STALE_MS` (default 2 h).
 *
 * Guard 3 is the only protection against a *different* process's live run, because postgres-js
 * closes idle connections after a few seconds and guard 2 then sees zero backends. Setting
 * `OA_TEST_PG_STALE_MS` below the longest possible suite runtime therefore *can* drop a concurrent
 * run's database -- observed while verifying this module with the threshold at 1000 ms, and observed
 * again as the second half of F12. Leave the default alone unless you know no other run is active;
 * tests that need a lower threshold must pass `staleMs` **together with** `restrictTo`, which bounds
 * the damage to names the caller itself created.
 *
 * Anything dropped is announced: residue disappearing silently would hide the fact that an earlier
 * run died.
 */
export interface SweepOptions {
	/**
	 * Threshold for this call only, in milliseconds. Explicit argument rather than a temporary
	 * `process.env.OA_TEST_PG_STALE_MS` mutation: the env var is process-global, so a test lowering
	 * it also lowered it for every other sweep running concurrently in the same process (JR-104a).
	 */
	readonly staleMs?: number;
	/**
	 * Consider **only** these exact database names. Anything else on the server is not "skipped by a
	 * guard" -- it is filtered out in the SQL and never looked at.
	 *
	 * This is what makes a low `staleMs` safe: with `restrictTo` the call cannot reach a foreign,
	 * concurrently running process's databases even in principle, which is the second half of F12.
	 */
	readonly restrictTo?: readonly string[];
}

export async function sweepStaleHarnessDatabases(options: SweepOptions = {}): Promise<string[]> {
	const threshold = options.staleMs ?? staleThresholdMs();
	if (!Number.isFinite(threshold) || threshold <= 0) {
		throw new Error(`sweepStaleHarnessDatabases: staleMs must be positive, got ${threshold}.`);
	}
	if (options.staleMs !== undefined && options.restrictTo === undefined) {
		// Refuse the one combination that can eat a foreign live run. Structural, not advisory.
		throw new Error(
			'sweepStaleHarnessDatabases: staleMs must be combined with restrictTo. An unrestricted ' +
				'sweep at a lowered threshold can drop the live databases of a concurrently running ' +
				'process (F12).'
		);
	}
	const restrictTo = options.restrictTo ? [...options.restrictTo] : undefined;
	const now = Date.now();
	return withAdminConnection(async (sql) => {
		const rows = restrictTo
			? await sql<{ datname: string; backends: number }[]>`
					select d.datname, coalesce(s.numbackends, 0) as backends
					from pg_database d
					left join pg_stat_database s on s.datname = d.datname
					where d.datname like ${DB_NAME_PREFIX + '%'}
					  and d.datname = any(${restrictTo})
				`
			: await sql<{ datname: string; backends: number }[]>`
					select d.datname, coalesce(s.numbackends, 0) as backends
					from pg_database d
					left join pg_stat_database s on s.datname = d.datname
					where d.datname like ${DB_NAME_PREFIX + '%'}
				`;
		const dropped: string[] = [];
		const skippedBusy: string[] = [];
		for (const { datname, backends } of rows) {
			const match = DB_NAME_PATTERN.exec(datname);
			if (!match) {
				continue;
			}
			if (Number(match[2]) === process.pid) {
				continue;
			}
			if (Number(backends) > 0) {
				skippedBusy.push(datname);
				continue;
			}
			const age = now - Number(match[1]);
			if (age < threshold) {
				continue;
			}
			try {
				await dropDatabase(sql, datname);
				dropped.push(datname);
			} catch (error) {
				coverageNotice(
					`pg-harness: could not sweep stale database ${datname}: ${(error as Error).message}`
				);
			}
		}
		if (skippedBusy.length > 0) {
			coverageNotice(
				`pg-harness: left ${skippedBusy.length} stale-looking database(s) alone because ` +
					`something is still connected to them: ${skippedBusy.join(', ')}.`
			);
		}
		if (dropped.length > 0) {
			coverageNotice(
				`pg-harness: swept ${dropped.length} stale harness database(s) left by an earlier ` +
					`run that did not tear down: ${dropped.join(', ')}. Threshold ${threshold} ms.`
			);
		}
		return dropped;
	});
}

export interface PgHarness {
	/** The isolated database's name, e.g. `oa_test_1753660000000_1234_ab12_filterbuilder`. */
	readonly databaseName: string;
	/** A `DATABASE_URL` pointing at the isolated database. */
	readonly url: string;
	/** Raw postgres-js client on the isolated database. */
	readonly sql: Sql;
	/** Drizzle handle on the isolated database, typed with the repository schema. */
	readonly db: PostgresJsDatabase<typeof schema>;
	/** Idempotent. Closes connections and drops the database. */
	release(): Promise<void>;
	/**
	 * Point `process.env.DATABASE_URL` at this harness. Must be called before the first import of
	 * `src/database`, because that module builds its singleton at import time.
	 */
	bindAsProcessDatabaseUrl(): void;
}

export interface AcquireOptions {
	/**
	 * Register the teardown as an `afterAll` hook (default `true`). `afterAll` runs even when a
	 * test in the file failed or threw, which is what makes teardown guaranteed. Only pass `false`
	 * when acquiring inside a `beforeAll` and releasing in a matching `afterAll` yourself.
	 */
	autoRelease?: boolean;
}

const liveHarnesses = new Set<PgHarness>();
/** The harness whose URL `process.env.DATABASE_URL` currently points at, if any. */
let boundHarness: PgHarness | undefined;
let exitWarningInstalled = false;

/**
 * Announce a leak from inside the worker.
 *
 * This handler is **not** the guarantee, and JR-105c is the reason it says so here. Its message never
 * arrived in the case it was written for: a module-scope throw after the acquire happens in a forked
 * worker (`pool: 'forks'`), and the worker's `exit` output does not reach the main process's summary
 * (F16). What does arrive is the ledger the main process reads after the run --
 * `@oa-test/harness-ledger` plus the `globalSetup` teardown.
 *
 * It is kept because it still speaks in the one case the ledger cannot: a worker that dies without
 * the run reaching the teardown at all.
 */
function installExitWarning(): void {
	if (exitWarningInstalled) {
		return;
	}
	exitWarningInstalled = true;
	// Cannot do async work on 'exit'. This does not tear anything down -- it makes a leak
	// *visible*, and names what will clean it up. Silence here would read as "no residue".
	process.on('exit', () => {
		if (liveHarnesses.size === 0) {
			return;
		}
		const names = [...liveHarnesses].map((harness) => harness.databaseName).join(', ');
		console.warn(
			`[TEST-COVERAGE NOTICE] pg-harness: process exited with ${liveHarnesses.size} harness ` +
				`database(s) still present: ${names}. Teardown did not complete. The run's ledger ` +
				`carries them, so the globalSetup teardown will announce and drop them; failing that, ` +
				`the next run's sweeper will once they exceed OA_TEST_PG_STALE_MS.`
		);
	});
}

/**
 * Create, migrate and hand out an isolated database.
 *
 * Call it at the top level of an integration test file, before any import of `src/database`:
 *
 * ```ts
 * const probe = await probePostgres();
 * const harness = probe.available ? await acquireTestDatabase('filter-builder') : null;
 * harness?.bindAsProcessDatabaseUrl();
 * const { FilterBuilder } = harness ? await import('../../src/services/FilterBuilder') : ({} as any);
 * ```
 */
export async function acquireTestDatabase(
	label: string,
	options: AcquireOptions = {}
): Promise<PgHarness> {
	const baseUrl = requireDatabaseUrl();
	const databaseName = buildDatabaseName(label);
	// Checked before anything is created: a run that cannot record what it owns would leave residue
	// nobody announces, which is the finding this ledger closes (F16). Failing first leaves nothing
	// behind to announce.
	requireLedgerDirectory();

	await sweepStaleHarnessDatabases();

	await withAdminConnection(async (sql) => {
		await sql.unsafe(`create database ${quoteIdentifier(databaseName)}`);
	});

	// The database exists from here on, so from here on this run owns residue if it dies. Written
	// before the next `await` for exactly that reason.
	recordAcquisition({
		databaseName,
		adminUrl: urlForDatabase(baseUrl, maintenanceDatabase()),
		label,
		pid: process.pid,
		acquiredAt: new Date().toISOString(),
	});

	const url = urlForDatabase(baseUrl, databaseName);
	// max: 4 rather than the driver default of 10 -- an integration suite running several files in
	// parallel should not be the reason Postgres hits max_connections.
	const client = postgres(url, {
		max: 4,
		idle_timeout: 5,
		connect_timeout: 10,
		onnotice: () => {},
	});
	const db = drizzle(client, { schema });

	let released = false;
	const harness: PgHarness = {
		databaseName,
		url,
		sql: client,
		db,
		bindAsProcessDatabaseUrl(): void {
			assertDatabaseSingletonNotYetLoaded(databaseName);
			process.env.DATABASE_URL = url;
			boundHarness = harness;
		},
		async release(): Promise<void> {
			if (released) {
				return;
			}
			released = true;
			liveHarnesses.delete(harness);
			// Anything the test opened against this database has to go first, including the
			// `src/database` singleton -- otherwise the drop has open backends to fight. Only this
			// harness's own singleton: releasing harness A must not close a pool bound to B.
			if (boundHarness === harness) {
				boundHarness = undefined;
				await closeBackendDatabaseSingleton();
			}
			await client.end({ timeout: 10 }).catch(() => undefined);
			await withAdminConnection((admin) => dropDatabase(admin, databaseName));
			// Only after the drop has actually happened. A throw above leaves the ledger entry in
			// place, and the main process then announces the database as residue -- which it is.
			forgetAcquisition(databaseName);
		},
	};

	liveHarnesses.add(harness);
	installExitWarning();

	try {
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
		await assertHarnessIsIsolatedAndMigrated(harness);
	} catch (error) {
		// A half-migrated database is still residue. Drop it before surfacing the failure.
		await harness.release().catch(() => undefined);
		throw error;
	}

	if (options.autoRelease !== false) {
		afterAll(async () => {
			await harness.release();
		});
	}

	return harness;
}

/**
 * Prove the isolation actually took effect, rather than trusting that it did.
 *
 * The dangerous failure mode of any isolation mechanism is the silent one: the tests run happily
 * against the shared database and report green. So: the session's own view of which database it is
 * in has to match, the schema has to be present, and the migration journal has to show that all
 * migrations were applied here rather than skipped.
 */
async function assertHarnessIsIsolatedAndMigrated(harness: PgHarness): Promise<void> {
	const [{ current }] = await harness.sql<{ current: string }[]>`
		select current_database() as current
	`;
	if (current !== harness.databaseName) {
		throw new Error(
			`pg-harness isolation check failed: connected session reports database "${current}" ` +
				`but the harness created "${harness.databaseName}". Tests would have run against the ` +
				`wrong database.`
		);
	}

	// Deliberately no array parameter: read every public table and filter in JS. One less driver
	// feature the isolation check itself can fail on.
	const tables = await harness.sql<{ table_name: string }[]>`
		select table_name from information_schema.tables where table_schema = 'public'
	`;
	const found = new Set(tables.map((row) => row.table_name));
	const missing = REQUIRED_TABLES.filter((name) => !found.has(name));
	if (missing.length > 0) {
		throw new Error(
			`pg-harness migration check failed in ${harness.databaseName}: expected tables are ` +
				`missing after migrate(): ${missing.join(', ')}. Migrations did not apply.`
		);
	}

	const expected = expectedMigrationCount();
	const [{ count }] = await harness.sql<{ count: string }[]>`
		select count(*)::text as count from drizzle."__drizzle_migrations"
	`;
	if (Number(count) !== expected) {
		throw new Error(
			`pg-harness migration check failed in ${harness.databaseName}: ` +
				`drizzle.__drizzle_migrations holds ${count} row(s), but ` +
				`src/database/migrations/meta/_journal.json lists ${expected}. Migrations were ` +
				`partially applied or partially skipped.`
		);
	}
}

/* -------------------------------------------------------------------------------------------- */
/* The `src/database` singleton                                                                 */
/* -------------------------------------------------------------------------------------------- */

const DATABASE_MODULE = '../../src/database';

let databaseModule: typeof import('../../src/database') | undefined;

function assertDatabaseSingletonNotYetLoaded(target: string): void {
	if (databaseModule) {
		throw new Error(
			`src/database was already imported through this harness; its connection pool is bound ` +
				`to the DATABASE_URL that was in effect then, so pointing DATABASE_URL at ` +
				`"${target}" now would have no effect on it. Acquire the harness and call ` +
				`bindAsProcessDatabaseUrl() before the first import.`
		);
	}
}

/**
 * Import `src/database` *after* `DATABASE_URL` has been bound, and remember the module so its
 * pool can be closed at teardown.
 *
 * `src/database/index.ts` exports only `db`, not the underlying client, so the pool is reached
 * through drizzle's `$client`.
 */
export async function loadBackendDatabaseSingleton(): Promise<typeof import('../../src/database')> {
	if (!process.env.DATABASE_URL) {
		throw new Error(
			'loadBackendDatabaseSingleton() called without DATABASE_URL; src/database throws at ' +
				'import time in that state. Call harness.bindAsProcessDatabaseUrl() first.'
		);
	}
	const loaded = (await import(DATABASE_MODULE)) as typeof import('../../src/database');
	databaseModule = loaded;
	return loaded;
}

/** Close the singleton's pool if it was ever created. Idempotent, never throws. */
export async function closeBackendDatabaseSingleton(): Promise<void> {
	if (!databaseModule) {
		return;
	}
	const client = (databaseModule.db as unknown as { $client?: Sql }).$client;
	databaseModule = undefined;
	if (!client || typeof client.end !== 'function') {
		coverageNotice(
			'pg-harness: could not reach the src/database connection pool via drizzle $client; ' +
				'teardown falls back to "drop database ... with (force)".'
		);
		return;
	}
	await client.end({ timeout: 10 }).catch(() => undefined);
}
