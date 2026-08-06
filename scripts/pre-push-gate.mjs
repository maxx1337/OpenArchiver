#!/usr/bin/env node
/**
 * Pre-push gate (tool infrastructure, not an E6 backlog task -- decided by the Auftraggeber after
 * `JR-6-02b`'s automation slice spent roughly 53 minutes and six serialised CI round trips on three
 * classes of failure that a cheap local check could have caught before the first push).
 *
 * ---------------------------------------------------------------------------------------------
 * What this catches, and -- as important -- what it does not
 * ---------------------------------------------------------------------------------------------
 * Measured against the six pushes of that slice, not assumed:
 *
 *   1. `test:types` (journaling AND backend, not only backend -- `0264405`'s exact gap: a type
 *      error in `packages/journaling`'s own test files went unnoticed because only backend's
 *      `test:types` had ever been run locally that session).
 *   2. `config/*.ts` throwing **at import**, not at first use (`CLAUDE.md` section 5.6), because a
 *      required environment variable is missing from `.github/workflows/ci.yml`'s job `env:` but
 *      present in the developer's own shell/`.env` (`9af1492`'s `STORAGE_TYPE`/`ENCRYPTION_KEY`).
 *      Caught by importing the same entry point CI's worker-boot test spawns, under an environment
 *      built from ci.yml's *actual* `env:` block (parsed fresh each run, never hand-copied) rather
 *      than the developer's own.
 *   3. A spawned child process silently using the **unmigrated maintenance database** instead of an
 *      isolated, migrated one (`41c407e`) -- invisible on a host whose own `DATABASE_URL` happens to
 *      already carry the schema (true on at least one host this project measured), which is exactly
 *      why this gate does not reuse the developer's own `DATABASE_URL` for this check. See
 *      `packages/backend/scripts/gate-check-schema.mjs`'s doc comment.
 *
 * What it does **not** catch, stated rather than silently omitted:
 *
 *   - `49a0bc1` (a `${{ runner.temp }}` expression in a job-level `env:` broke GitHub's own workflow
 *     parser, with zero jobs scheduled and no diagnostic beyond "workflow file issue"). No cheap,
 *     reliably-installable GitHub Actions schema validator was found for this host in the time
 *     budgeted (`npx action-validator` did not resolve on Windows). This gate only *flags* -- as a
 *     warning, not a failure -- any `${{ ... }}` expression found in a job-level `env:` block, because
 *     that is the exact shape that broke; it is a narrow heuristic against one known incident, not a
 *     workflow-schema check, and says so when it fires.
 *   - `3d0fadb`/`c2987e9` (F64: a hanging graceful shutdown from an unidentified open handle). Nothing
 *     short of actually waiting out a `SIGTERM` and measuring the exit would catch this, and doing
 *     that on every push is the opposite of "cheap". Not attempted here.
 *
 * ---------------------------------------------------------------------------------------------
 * What this deliberately does not do
 * ---------------------------------------------------------------------------------------------
 * No second full `pnpm test` (that is the ~3-minute suite this gate exists to avoid running before
 * every push) and no second test harness (`CLAUDE.md` section 5.1: the existing one is the harness).
 * Every check below either runs an existing package script unmodified or a single, already-existing
 * integration test file through the existing `vitest` config -- nothing here reimplements what those
 * already do.
 *
 * Usage: `pnpm gate` (wired in the root `package.json`, alongside `test`/`lint`, not replacing
 * either).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {{name: string, status: 'pass'|'fail'|'skip'|'warn', detail?: string}[]} */
const results = [];

function record(name, status, detail) {
	results.push({ name, status, detail });
	const marker = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP', warn: 'WARN' }[status];
	console.log(`[${marker}] ${name}${detail ? ` -- ${detail}` : ''}`);
}

function section(title) {
	console.log(`\n=== ${title} ===`);
}

/** `shell: true` on every platform: Windows needs it to resolve `corepack`/`pnpm`'s `.cmd` shims. */
function run(cmd, args, opts = {}) {
	const res = spawnSync(cmd, args, { stdio: 'inherit', shell: true, cwd: ROOT, ...opts });
	return res.status === 0;
}

/** `shell: false` by default -- every current caller runs `git` or `node` directly, neither of which
 *  needs shell resolution on any platform. Pass `{ shell: true }` explicitly for anything that does. */
function runCaptured(cmd, args, opts = {}) {
	const res = spawnSync(cmd, args, { encoding: 'utf8', shell: false, cwd: ROOT, ...opts });
	return { ok: res.status === 0, stdout: (res.stdout ?? '').trim(), stderr: res.stderr ?? '' };
}

function probeTcp(host, port, timeoutMs = 1500) {
	return new Promise((resolve) => {
		const socket = new net.Socket();
		const done = (ok) => {
			socket.removeAllListeners();
			socket.destroy();
			resolve(ok);
		};
		socket.setTimeout(timeoutMs);
		socket.once('connect', () => done(true));
		socket.once('timeout', () => done(false));
		socket.once('error', () => done(false));
		socket.connect(port, host);
	});
}

// -------------------------------------------------------------------------------------------
// 1/4 -- test:types, both packages (0264405's gap)
// -------------------------------------------------------------------------------------------
section("1/4 test:types (journaling AND backend -- catches 0264405's class)");
{
	const journaling = run('corepack', [
		'pnpm',
		'--filter',
		'@open-archiver/journaling',
		'test:types',
	]);
	record('test:types @open-archiver/journaling', journaling ? 'pass' : 'fail');
	const backend = run('corepack', ['pnpm', '--filter', '@open-archiver/backend', 'test:types']);
	record('test:types @open-archiver/backend', backend ? 'pass' : 'fail');
}

// -------------------------------------------------------------------------------------------
// 2/4 -- Prettier, changed files only (never repo-wide -- F35)
// -------------------------------------------------------------------------------------------
section('2/4 Prettier on changed files (never repo-wide, F35)');
{
	const upstream = runCaptured('git', [
		'rev-parse',
		'--abbrev-ref',
		'--symbolic-full-name',
		'@{u}',
	]);
	const changed = new Set();
	let mode;
	if (upstream.ok && upstream.stdout) {
		mode = `against upstream ${upstream.stdout} (committed, unpushed changes)`;
		const diff = runCaptured('git', ['diff', '--name-only', `${upstream.stdout}...HEAD`]);
		for (const file of diff.stdout.split('\n').filter(Boolean)) {
			changed.add(file);
		}
	} else {
		mode =
			'no upstream found -- comparing against HEAD only (committed changes since last commit)';
	}
	// Uncommitted/staged changes and new untracked files, regardless of upstream -- a gate run before
	// the commit that will be pushed must still see them.
	const working = runCaptured('git', ['diff', '--name-only', 'HEAD']);
	for (const file of working.stdout.split('\n').filter(Boolean)) {
		changed.add(file);
	}
	const untracked = runCaptured('git', ['ls-files', '--others', '--exclude-standard']);
	for (const file of untracked.stdout.split('\n').filter(Boolean)) {
		changed.add(file);
	}

	const FORMATTABLE = /\.(ts|tsx|svelte|json|md|ya?ml|mjs|cjs|js)$/;
	const files = [...changed]
		.filter((f) => FORMATTABLE.test(f))
		.filter((f) => existsSync(path.join(ROOT, f)));

	console.log(`(${mode}; ${changed.size} changed file(s) total, ${files.length} formattable)`);
	if (files.length === 0) {
		record('prettier --check (changed files)', 'skip', 'no formattable files changed');
	} else {
		const ok = run('corepack', ['pnpm', 'exec', 'prettier', '--check', ...files]);
		record('prettier --check (changed files)', ok ? 'pass' : 'fail', `${files.length} file(s)`);
	}
}

// -------------------------------------------------------------------------------------------
// 3/4 -- svelte-check, because CI runs it
// -------------------------------------------------------------------------------------------
section('3/4 svelte-check (CI runs this unconditionally)');
{
	const ok = run('corepack', ['pnpm', '--filter', '@open-archiver/frontend', 'check']);
	record('svelte-check', ok ? 'pass' : 'fail');
}

// -------------------------------------------------------------------------------------------
// 4/4 -- CI-env-faithful worker boot (9af1492's and 41c407e's class)
// -------------------------------------------------------------------------------------------
section("4/4 journal-inbound worker boot, under ci.yml's own env (9af1492 + 41c407e)");
{
	const ciYamlPath = path.join(ROOT, '.github/workflows/ci.yml');
	const ciYaml = readFileSync(ciYamlPath, 'utf8');
	const lines = ciYaml.split('\n');
	const envStart = lines.findIndex((l) => /^ {8}env:\s*$/.test(l));
	if (envStart === -1) {
		record(
			'parse ci.yml job env:',
			'fail',
			'no job-level "env:" block found at the expected 8-space indent -- ci.yml\'s shape changed, update the parser in scripts/pre-push-gate.mjs'
		);
	} else {
		const ciEnv = {};
		let expressionWarned = false;
		for (let i = envStart + 1; i < lines.length; i++) {
			const line = lines[i];
			if (/^ {0,8}\S/.test(line)) {
				break; // dedented back to job level or less -- env: block is over.
			}
			const match = /^ {12}([A-Z_][A-Z0-9_]*):\s*(.+)$/.exec(line);
			if (!match) {
				continue; // comment line, blank line, or a shape this narrow parser does not model.
			}
			const [, key, rawValue] = match;
			const value = rawValue.trim().replace(/^['"](.*)['"]$/, '$1');
			ciEnv[key] = value;
			if (value.includes('${{') && !expressionWarned) {
				expressionWarned = true;
				record(
					'ci.yml job-level env: expression heuristic',
					'warn',
					`"${key}" contains "\${{ ... }}" in job-level env: -- this exact shape broke GitHub's ` +
						'workflow parser once (49a0bc1, zero jobs scheduled, no diagnostic beyond "workflow ' +
						'file issue"). This is a narrow heuristic against one known incident, not a workflow-' +
						'schema validator -- no cheap one was found for this host. Push and check ' +
						'`gh run list` if unsure.'
				);
			}
		}
		console.log(`parsed ${Object.keys(ciEnv).length} variable(s) from ci.yml's job env: block`);

		const dbUrl = process.env.DATABASE_URL;
		const redisHost = process.env.REDIS_HOST || '127.0.0.1';
		const redisPort = Number(process.env.REDIS_PORT || '6379');

		if (!dbUrl) {
			record('worker boot check', 'skip', 'DATABASE_URL is not set locally');
		} else {
			const [dbReachable, redisReachable] = await Promise.all([
				probeTcp(
					new URL(dbUrl).hostname || '127.0.0.1',
					Number(new URL(dbUrl).port || '5432')
				),
				probeTcp(redisHost, redisPort),
			]);
			if (!dbReachable) {
				record('worker boot check', 'skip', 'Postgres unreachable at DATABASE_URL');
			} else if (!redisReachable) {
				record(
					'worker boot check',
					'skip',
					`Redis/Valkey unreachable at ${redisHost}:${redisPort}`
				);
			} else {
				const probeUrl = new URL(dbUrl);
				probeUrl.pathname = '/postgres';
				const schemaCheck = runCaptured('node', [
					'packages/backend/scripts/gate-check-schema.mjs',
					probeUrl.toString(),
				]);
				const verdict = schemaCheck.stdout;
				if (verdict === 'MIGRATED') {
					record(
						'worker boot check',
						'skip',
						`this host's default "postgres" database already carries the schema -- cannot ` +
							`locally reproduce 41c407e's bug class (a spawned child silently using an ` +
							`unmigrated database). Neither passed nor failed; genuinely not verifiable here.`
					);
				} else if (verdict.startsWith('UNREACHABLE')) {
					record(
						'worker boot check',
						'skip',
						`could not probe the maintenance database: ${verdict}`
					);
				} else {
					// UNMIGRATED, the expected case: safe to use as DATABASE_URL for the spawned worker.
					console.log(
						'building journaling and backend (the compiled worker is what gets spawned)'
					);
					const builtJournaling = run('corepack', [
						'pnpm',
						'--filter',
						'@open-archiver/journaling',
						'build',
					]);
					// `tsc` directly, not the package's own `build` script (`tsc && pnpm copy-assets`):
					// `copy-assets` needs `pnpm` on PATH from inside the spawned shell, which this host
					// does not have (a pre-existing, documented limitation, not something to fix by
					// restructuring the package script) -- and nothing this check spawns reads
					// `dist/locales`, only the compiled worker entry point.
					const builtBackend = run('corepack', [
						'pnpm',
						'--filter',
						'@open-archiver/backend',
						'exec',
						'tsc',
					]);
					if (!builtJournaling || !builtBackend) {
						record(
							'worker boot check',
							'fail',
							'build failed, could not run the boot check'
						);
					} else {
						// Strip these from the inherited environment *before* overlaying `ciEnv` -- the
						// entire point of this check is that ci.yml's own declaration (or lack of one)
						// decides whether a variable is set, never the developer's own shell/`.env`
						// filling the gap. Building `{ ...process.env, ...ciEnv }` without this step
						// would silently hide the exact bug class 9af1492 fixed: a variable missing
						// from ci.yml but present locally makes CI-only failures unreproducible.
						const CONFIG_SENSITIVE_VARS = [
							'STORAGE_TYPE',
							'STORAGE_LOCAL_ROOT_PATH',
							'STORAGE_ENCRYPTION_KEY',
							'ENCRYPTION_KEY',
							'MEILI_HOST',
							'MEILI_MASTER_KEY',
							'JWT_SECRET',
							'OA_TEST_REQUIRE_INFRA',
						];
						const baseEnv = { ...process.env };
						for (const key of CONFIG_SENSITIVE_VARS) {
							delete baseEnv[key];
						}
						const childEnv = {
							...baseEnv,
							...ciEnv,
							// ci.yml's own DATABASE_URL/REDIS_* values name services this host does not
							// run under those credentials -- keep the developer's own, except for the
							// database name, which becomes the confirmed-unmigrated probe above.
							DATABASE_URL: probeUrl.toString(),
							REDIS_HOST: redisHost,
							REDIS_PORT: String(redisPort),
							REDIS_PASSWORD: process.env.REDIS_PASSWORD ?? '',
						};
						const ok = run(
							'corepack',
							[
								'pnpm',
								'exec',
								'vitest',
								'run',
								'--project',
								'integration',
								'packages/backend/tests/integration/journal-inbound-worker.int.test.ts',
							],
							{ env: childEnv }
						);
						record(
							'worker boot check (journal-inbound-worker.int.test.ts, ci.yml env, unmigrated probe DB)',
							ok ? 'pass' : 'fail'
						);
					}
				}
			}
		}
	}
}

// -------------------------------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------------------------------
section('Summary');
for (const r of results) {
	console.log(`  [${r.status.toUpperCase()}] ${r.name}${r.detail ? ` -- ${r.detail}` : ''}`);
}
const failed = results.filter((r) => r.status === 'fail');
if (failed.length > 0) {
	console.error(
		`\n${failed.length} check(s) failed. Not a substitute for CI -- see the module doc comment for what this gate does not cover.`
	);
	process.exit(1);
}
console.log('\nAll checks passed or were skipped with a stated reason. Not a substitute for CI.');
