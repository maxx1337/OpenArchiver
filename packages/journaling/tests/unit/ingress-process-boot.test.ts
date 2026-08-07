import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer as createProbeServer } from 'node:net';
import { connect as connectTcp } from 'node:net';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { suite } from '@oa-test/classification';

/**
 * `JR-4-01` -- "Prozess startet eigenständig" and "fehlende Konfiguration führt zu einer klaren
 * Startmeldung, nicht zu einem Import-Crash", measured against the **actual compiled process**,
 * not a same-process function call.
 *
 * ---------------------------------------------------------------------------------------------
 * Why a real subprocess, and why not `import()` the entry module in this test process instead
 * ---------------------------------------------------------------------------------------------
 * `apps/smtp-ingress/src/index.ts` calls `process.exit(1)` on a configuration failure. Dynamically
 * importing that module into this test's own process would make a red-path test call
 * `process.exit()` on the vitest worker itself -- the test process would not report a failure, it
 * would simply stop. A real child process is the only way to observe "clean message, exit code 1,
 * no stack trace" without risking the test runner. It is also the only way to observe the
 * green-path claim ("the process starts and stays up") as a fact about a process rather than about
 * a function call: the entry module's only exported behaviour *is* what happens when it runs as a
 * program.
 *
 * `packages/journaling/tests/unit/ingress-import-graph.test.ts` is the complementary, cheaper proof
 * for the import-chain half of the acceptance criterion (a static walk, no process needed). This
 * file is the proof that the process this repository actually ships behaves the way that walk says
 * it should.
 *
 * ---------------------------------------------------------------------------------------------
 * The build step in `beforeAll`
 * ---------------------------------------------------------------------------------------------
 * `apps/smtp-ingress` is not built by anything that necessarily ran before `pnpm test` (CI builds
 * `@open-archiver/types` and `@open-archiver/journaling` ahead of the test step, but not this app --
 * see `.github/workflows/ci.yml`). Building all three defensively here, rather than assuming a prior
 * step did it, is what makes this test self-sufficient on a fresh checkout; `tsc`'s own incremental
 * build makes a no-op rebuild fast when the prior steps already ran.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const ENTRY_JS = path.resolve(REPO_ROOT, 'apps/smtp-ingress/dist/index.js');

/**
 * `filterName` is always one of this file's own hardcoded constants below, never external input,
 * so the string-built command on Windows carries no injection risk.
 */
function buildPackage(filterName: string): void {
	if (process.platform === 'win32') {
		// `corepack` resolves to `corepack.cmd`/`corepack.ps1` on Windows, and `CreateProcess` cannot
		// launch those directly -- only through a shell (`EINVAL`, measured here). Node's `shell: true`
		// plus an argument array triggers DEP0190 (args are not escaped); passing the whole command as
		// one string with an empty argument list avoids that, and is safe precisely because
		// `filterName` is never anything but one of the constants below.
		execFileSync(`corepack pnpm --filter ${filterName} build`, [], {
			cwd: REPO_ROOT,
			stdio: 'pipe',
			shell: true,
		});
		return;
	}
	execFileSync('corepack', ['pnpm', '--filter', filterName, 'build'], {
		cwd: REPO_ROOT,
		stdio: 'pipe',
	});
}

/** A TCP port nothing else is listening on right now. Not immune to a race, but good enough for a test. */
async function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createProbeServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			if (address === null || typeof address === 'string') {
				reject(new Error('failed to obtain a free port'));
				return;
			}
			const { port } = address;
			probe.close(() => resolve(port));
		});
	});
}

/** Minimal, controlled environment: no inherited `SMTP_INGRESS_*`, no reliance on a real `.env`. */
function baseEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '' };
	// Node on Windows needs these to resolve its own DLLs / temp paths; harmless elsewhere.
	if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
	if (process.env.TEMP) env.TEMP = process.env.TEMP;
	if (process.env.TMP) env.TMP = process.env.TMP;
	return env;
}

function collectOutput(child: ChildProcess): { stdout: () => string; stderr: () => string } {
	let stdout = '';
	let stderr = '';
	child.stdout?.on('data', (chunk: Buffer) => {
		stdout += chunk.toString('utf8');
	});
	child.stderr?.on('data', (chunk: Buffer) => {
		stderr += chunk.toString('utf8');
	});
	return { stdout: () => stdout, stderr: () => stderr };
}

/** Wait until `predicate()` is true or `timeoutMs` elapses, polling every 25ms. */
async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`condition not met within ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

let scratchDir: string;

beforeAll(() => {
	buildPackage('@open-archiver/types');
	buildPackage('@open-archiver/journaling');
	buildPackage('smtp-ingress-app');
	scratchDir = mkdtempSync(path.join(tmpdir(), 'oa-smtp-ingress-boot-'));
}, 120_000);

afterAll(() => {
	if (scratchDir) {
		rmSync(scratchDir, { recursive: true, force: true });
	}
});

suite('ci', 'apps/smtp-ingress process boot (JR-4-01)', () => {
	it('without any SMTP_INGRESS_* configuration: exits 1 with a readable message, never binds a port', async () => {
		const cwd = mkdtempSync(path.join(scratchDir, 'missing-config-'));
		const child = spawn(process.execPath, [ENTRY_JS], { cwd, env: baseEnv() });
		const output = collectOutput(child);

		const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
			(resolve) => {
				child.once('close', (code, signal) => resolve({ code, signal }));
			}
		);

		expect(exit.code).toBe(1);
		expect(exit.signal).toBeNull();

		const stderr = output.stderr();
		expect(stderr).toContain('smtp-ingress: configuration invalid, refusing to start:');
		expect(stderr).toContain('smtpPort');
		expect(stderr).toContain('spool.rootPath');
		expect(stderr).toContain('spool.highWaterBytes');

		// The claim under test: the crash message comes from this process's own configuration
		// validation, not from an imported module that throws at import time (CLAUDE.md section
		// 5.6's failure mode -- `config/storage.ts` throwing on a missing `STORAGE_ENCRYPTION_KEY`
		// is the canonical example this must not reproduce).
		expect(stderr).not.toContain('packages/backend');
		expect(stderr).not.toContain('src/database');
		expect(stderr).not.toContain('STORAGE_ENCRYPTION_KEY');
		expect(stderr).not.toContain('DATABASE_URL');
		expect(stderr).not.toMatch(/\bat .+\(.+:\d+:\d+\)/); // no JS stack frame

		expect(output.stdout()).not.toContain('listening on port');
	}, 20_000);

	it('with valid configuration: starts, creates the spool layout, and accepts a connection on the configured port', async () => {
		const port = await getFreePort();
		// JR-4-05a: SMTP_INGRESS_DATABASE_URL is now required (parseIngressConfig rejects a
		// configuration missing it -- see source-acl-config.ts's doc comment for why there is no
		// default that lets the process start without one). Pointing it at a currently-closed local
		// port is deliberate: the process must still start and bind the SMTP port even though its
		// very first source ACL refresh fails immediately with ECONNREFUSED -- SourceAclCache.start()
		// resolves regardless (a database outage at boot must not crash startup), and this is the
		// unit-test proof of exactly that, without needing a real Postgres in this suite.
		const dbPort = await getFreePort();
		const cwd = mkdtempSync(path.join(scratchDir, 'valid-config-'));
		const spoolRoot = path.join(cwd, 'spool');

		const child = spawn(process.execPath, [ENTRY_JS], {
			cwd,
			env: {
				...baseEnv(),
				SMTP_INGRESS_PORT: String(port),
				SMTP_INGRESS_SPOOL_ROOT_PATH: spoolRoot,
				SMTP_INGRESS_SPOOL_HIGH_WATER_BYTES: '1000000000',
				SMTP_INGRESS_DATABASE_URL: `postgresql://test:test@127.0.0.1:${dbPort}/testdb`,
			},
		});
		const output = collectOutput(child);
		let exited = false;
		// F59, second round: the shutdown assertion below failed on CI while reporting **only** stdout,
		// so it was impossible to tell from the log whether the handler had run and lost its line or
		// whether the process had died some other way. The exit code, the terminating signal and stderr
		// are the three things that distinguish those, and none of them were being recorded. Captured
		// here and folded into the assertion message -- a diagnostic, not a behaviour change.
		let exitCode: number | null = null;
		let exitSignal: NodeJS.Signals | null = null;
		child.once('close', (code, signal) => {
			exited = true;
			exitCode = code;
			exitSignal = signal;
		});

		try {
			await waitUntil(() => output.stdout().includes('listening on port'), 10_000);

			expect(exited).toBe(false);
			expect(output.stdout()).toContain(`listening on port ${port}`);

			// The spool layout exists -- ensureSpoolLayout() ran, not just the config parse.
			const spoolEntries = readdirSync(spoolRoot).sort();
			expect(spoolEntries).toEqual(['incoming', 'quarantine']);

			// The port genuinely accepts connections; this is not just a log line.
			await new Promise<void>((resolve, reject) => {
				const socket = connectTcp(port, '127.0.0.1');
				socket.once('connect', () => {
					socket.destroy();
					resolve();
				});
				socket.once('error', reject);
			});
		} finally {
			if (!exited) {
				child.kill();
			}
		}

		await waitUntil(() => exited, 10_000);

		// Graceful shutdown on SIGTERM is only reliably observable on POSIX: Node on Windows
		// cannot deliver a catchable SIGTERM to a child process at all (`ChildProcess.kill()`
		// terminates it directly at the OS level there -- measured here, not assumed: the
		// process's own SIGTERM handler never gets to run and `close` reports no exit code, only
		// a termination signal). The stricter assertion below is the real behaviour this code is
		// written for and is what runs in CI (Linux); on Windows only "it did stop" is checked.
		if (process.platform !== 'win32') {
			expect(
				output.stdout(),
				`exit code ${exitCode}, terminating signal ${exitSignal}\n` +
					`--- stderr ---\n${output.stderr() || '(empty)'}\n` +
					`--- stdout ---\n${output.stdout() || '(empty)'}`
			).toContain('shutting down');
		}
	}, 20_000);
});
