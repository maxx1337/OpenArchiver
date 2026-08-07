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
 * -----------------------------------------------------------------------------------------------
 * F65 -- infrastructure preconditions vs. config-under-test, and why they are handled differently
 * -----------------------------------------------------------------------------------------------
 * Step 4/4 needs two things to exist before it can check anything: a reachable Postgres and a
 * reachable, correctly-authenticated Redis/Valkey. Those are **host infrastructure**, not the
 * config-under-test -- unlike `STORAGE_TYPE`/`ENCRYPTION_KEY`/etc. (deliberately stripped from the
 * child environment above so their *absence from ci.yml* is what gets tested), a missing
 * `DATABASE_URL` or a wrong `REDIS_PASSWORD` says nothing about whether ci.yml's env block is
 * correct -- it only says this developer's shell has not been set up for this check yet. Both were,
 * before this fix, silently swallowed in a way that hid exactly the coverage this gate exists to
 * provide (an independently-run TEST measurement found this and filed it as F65):
 *
 *   - No `DATABASE_URL` at all skipped step 4 with a stated reason, but that reason never named which
 *     failure classes were consequently unverified -- and since this repository ships no `.env`, "no
 *     `DATABASE_URL`" is the *normal* state on a fresh checkout, not an edge case. A developer could
 *     run `pnpm gate`, see "All checks passed or were skipped with a stated reason", and have run
 *     zero percent of the check that catches `9af1492` and `41c407e`.
 *   - A set but wrong/missing `REDIS_PASSWORD` was not checked at all before this fix -- the plain TCP
 *     reachability probe below succeeds against Valkey with `--requirepass` regardless of whether a
 *     password was supplied (auth happens at the protocol level, not the TCP level), so the run
 *     proceeded straight into building and spawning `vitest`, which then failed noisily with four
 *     `ReplyError: NOAUTH Authentication required` stack traces and no indication of which variable to
 *     set. That is a red gate on a clean tree for a reason that has nothing to do with the code being
 *     pushed -- the exact failure mode F35 was named for.
 *
 * The fix: `probeRedisRequiresAuth()` below speaks just enough of the Redis wire protocol (`PING`,
 * then `AUTH <password>` if challenged with `-NOAUTH`) to answer "would step 4 actually be able to
 * connect" *before* anything is built or spawned, and both this and the `DATABASE_URL` precondition
 * are checked with an explicit, named message: which of `9af1492`/`41c407e` remain unverified, and
 * the exact local recipe (`07-session-handover.md`, "Billig verifizieren") to fix it. The Summary
 * section repeats this whenever step 4 did not reach a pass/fail verdict, for the same reason
 * `JR-6-01`'s `coverageNotice` names an unexercised branch instead of letting a skip print like a
 * pass. Exit code is unchanged (0 for skip) -- a developer without local Docker infra should still be
 * able to push after the checks that *can* run locally have run; visibility of the gap, not the exit
 * code, is what this fixes.
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

/** Sends one Redis inline command (`PING`, `AUTH <pw>`) and resolves with the first reply line,
 *  without its trailing CRLF. Every reply this function is used for (`+PONG`, `+OK`, `-NOAUTH ...`,
 *  `-WRONGPASS ...`) is a single RESP simple-string/error line, so reading up to the first `\r\n` is
 *  sufficient -- no need for a full RESP parser here. */
function sendRedisInlineCommand(socket, command) {
	return new Promise((resolve) => {
		let buf = '';
		const onData = (chunk) => {
			buf += chunk.toString('utf8');
			const idx = buf.indexOf('\r\n');
			if (idx !== -1) {
				socket.off('data', onData);
				resolve(buf.slice(0, idx));
			}
		};
		socket.on('data', onData);
		socket.write(`${command}\r\n`);
	});
}

/**
 * F65: whether `step 4/4` can actually reach Redis is a real question, not a formality -- a plain TCP
 * connect (what this gate used before F65) succeeds against Valkey with `--requirepass` regardless of
 * whether a correct password is supplied, because auth happens above the TCP layer. This speaks just
 * enough of the wire protocol to answer for real: `PING`, and only `AUTH <password>` + a second `PING`
 * if the first one comes back `-NOAUTH`. Resolves `{ ok: true }` if a working PING was achieved, or
 * `{ ok: false, reason }` with a reason naming exactly what's missing (no host reachable, no password
 * supplied, or a supplied password that was rejected) -- never lets the caller find out the hard way
 * via a mid-test `NOAUTH` stack trace.
 */
function probeRedisRequiresAuth(host, port, password, timeoutMs = 1500) {
	return new Promise((resolve) => {
		const socket = new net.Socket();
		let settled = false;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			socket.removeAllListeners();
			socket.destroy();
			resolve(result);
		};
		socket.setTimeout(timeoutMs);
		socket.once('timeout', () =>
			finish({ ok: false, reason: `no response from ${host}:${port} within ${timeoutMs}ms` })
		);
		socket.once('error', (err) =>
			finish({
				ok: false,
				reason: `unreachable at ${host}:${port} (${err.code ?? err.message})`,
			})
		);
		socket.once('connect', () => {
			(async () => {
				const ping = await sendRedisInlineCommand(socket, 'PING');
				if (ping.startsWith('+PONG')) {
					finish({ ok: true });
					return;
				}
				if (!ping.startsWith('-NOAUTH')) {
					finish({ ok: false, reason: `unexpected reply to PING -- "${ping}"` });
					return;
				}
				if (!password) {
					finish({
						ok: false,
						reason: `requires a password and REDIS_PASSWORD is not set -- server said "${ping}"`,
					});
					return;
				}
				const authReply = await sendRedisInlineCommand(socket, `AUTH ${password}`);
				if (!authReply.startsWith('+OK')) {
					finish({
						ok: false,
						reason: `REDIS_PASSWORD was rejected -- server said "${authReply}"`,
					});
					return;
				}
				const pingAfterAuth = await sendRedisInlineCommand(socket, 'PING');
				finish(
					pingAfterAuth.startsWith('+PONG')
						? { ok: true }
						: {
								ok: false,
								reason: `authenticated but PING still failed -- "${pingAfterAuth}"`,
							}
				);
			})().catch((err) =>
				finish({
					ok: false,
					reason: `probe error -- ${err instanceof Error ? err.message : String(err)}`,
				})
			);
		});
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

		// F65: DATABASE_URL and REDIS_PASSWORD are host infrastructure, not config-under-test -- unlike
		// STORAGE_TYPE/etc. above, their absence says nothing about ci.yml and everything about whether
		// this shell has been set up for this check. Both get an explicit, named skip reason (which
		// classes go unverified, and the exact local recipe) instead of a bare "skipped" or -- worse,
		// for REDIS_PASSWORD before this fix -- a mid-test NOAUTH crash with no named cause.
		const UNVERIFIED =
			'step 4/4 cannot run, so 9af1492 (STORAGE_TYPE-at-import) and 41c407e ' +
			'(unmigrated DB in a spawned child) are NOT locally verified this run';
		const RECIPE =
			'local recipe (07-session-handover.md, "Billig verifizieren"): ' +
			'DATABASE_URL=postgresql://admin:password@127.0.0.1:5432/open_archive ' +
			"REDIS_HOST=127.0.0.1 REDIS_PORT=6379 REDIS_PASSWORD=<this host's Valkey password>";

		const dbUrl = process.env.DATABASE_URL;
		const redisHost = process.env.REDIS_HOST || '127.0.0.1';
		const redisPort = Number(process.env.REDIS_PORT || '6379');
		const redisPassword = process.env.REDIS_PASSWORD;

		if (!dbUrl) {
			record(
				'worker boot check',
				'skip',
				`DATABASE_URL is not set (the normal state on a fresh checkout -- no .env is committed). ${UNVERIFIED}. ${RECIPE}`
			);
		} else {
			const dbReachable = await probeTcp(
				new URL(dbUrl).hostname || '127.0.0.1',
				Number(new URL(dbUrl).port || '5432')
			);
			const redisCheck = dbReachable
				? await probeRedisRequiresAuth(redisHost, redisPort, redisPassword)
				: { ok: false, reason: 'not probed -- Postgres check failed first' };
			if (!dbReachable) {
				record(
					'worker boot check',
					'skip',
					`Postgres unreachable at DATABASE_URL. ${UNVERIFIED}. ${RECIPE}`
				);
			} else if (!redisCheck.ok) {
				record(
					'worker boot check',
					'skip',
					`Redis/Valkey at ${redisHost}:${redisPort} ${redisCheck.reason}. ${UNVERIFIED}. ${RECIPE}`
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
							`unmigrated database). Neither passed nor failed; genuinely not verifiable here. ` +
							`${UNVERIFIED}.`
					);
				} else if (verdict.startsWith('UNREACHABLE')) {
					record(
						'worker boot check',
						'skip',
						`could not probe the maintenance database: ${verdict}. ${UNVERIFIED}.`
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
							// `redisPassword` reaching this line means `probeRedisRequiresAuth()` already
							// confirmed it authenticates (or that no auth is required) -- unlike the old
							// `process.env.REDIS_PASSWORD ?? ''`, this can no longer be a silently wrong
							// value that only surfaces as a NOAUTH crash inside vitest (F65).
							DATABASE_URL: probeUrl.toString(),
							REDIS_HOST: redisHost,
							REDIS_PORT: String(redisPort),
							REDIS_PASSWORD: redisPassword ?? '',
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
// F65: a skipped step 4/4 means 9af1492 and 41c407e went unverified this run, for ANY skip reason --
// missing DATABASE_URL, unreachable Postgres, a Redis auth problem, an already-migrated probe DB, or
// an unreachable probe DB. Repeating this here (it is already in the skip message itself, printed
// above) is deliberate: the closing line below is the one line most likely to be read on its own, and
// it must never read as unqualified success when it is not.
const workerBootSkipped = results.find(
	(r) => r.name.startsWith('worker boot check') && r.status === 'skip'
);
if (failed.length > 0) {
	console.error(
		`\n${failed.length} check(s) failed. Not a substitute for CI -- see the module doc comment for what this gate does not cover.`
	);
	process.exit(1);
}
if (workerBootSkipped) {
	console.log(
		'\nAll runnable checks passed. Step 4/4 (worker boot) was SKIPPED -- 9af1492 and 41c407e are ' +
			'NOT locally verified this run. See the [SKIP] line above for why and the fix. Not a substitute for CI.'
	);
} else {
	console.log('\nAll checks passed. Not a substitute for CI.');
}
