import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import { acquireTestDatabase } from '../support/pg-harness';
import { seedIngestionSource, seedJournalingSource } from '../support/iam-seed';

/**
 * The Microsoft 365 range refresh helper, as the **actual compiled program** an operator runs
 * (`JR-4-09`, RFC section 4.3). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * What this measures that the unit suite cannot
 * ---------------------------------------------------------------------------------------------
 * `packages/journaling/src/ingress/m365-ip-ranges.test.ts` proves the diff logic. It cannot prove the
 * property the RFC actually asks for -- "a diff for operator approval rather than auto-applying … a
 * silently widened ACL is a security regression" -- because that is a property of the *program*: of
 * what it does to the database. So this file runs `apps/smtp-ingress/dist/refresh-m365-ranges.js`
 * against a real, migrated database with real `journaling_sources` rows and, after every run, reads
 * every `allowed_ips` value back and compares it with what was seeded. A helper that "helpfully"
 * applied its own suggestion would fail here and nowhere else. **Calibrated:** with an `update`
 * deliberately added to the helper, the first test below fails on exactly that comparison.
 *
 * **No network access anywhere in this file**, and none in the helper either -- the endpoint list is
 * an operator-supplied file or stdin (the Product Owner's decision of 2026-08-03; see the helper's
 * own doc comment for why that is what keeps `JR-4-07`'s no-outbound-connection guard intact). Both
 * input forms are exercised, because the documented invocation is a `curl … | …` pipe.
 *
 * The exit codes are part of the contract, not decoration: an operator must be able to tell "nothing
 * to do" (`0`) from "act on this" (`2`) from "the helper could not do its job" (`1`) without parsing
 * the text.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const ENTRY_JS = path.resolve(REPO_ROOT, 'apps/smtp-ingress/dist/refresh-m365-ranges.js');

function buildPackage(filterName: string): void {
	if (process.platform === 'win32') {
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

/** Shaped like the real feed: one Exchange/SMTP entry, plus two entries that must be ignored. */
const FEED_BODY = JSON.stringify([
	{
		id: 1,
		serviceArea: 'Exchange',
		ips: ['13.107.6.152/31'],
		tcpPorts: '80,443',
		note: 'web front end -- must not reach the ACL',
	},
	{ id: 10, serviceArea: 'Exchange', ips: ['40.92.0.0/15', '40.107.0.0/16'], tcpPorts: '25' },
	{ id: 31, serviceArea: 'SharePoint', ips: ['13.107.136.0/22'], tcpPorts: '443' },
]);

const postgresProbe = await probePostgres();
const enabled = isClassSelected('ci') && postgresProbe.available;
const harness = enabled ? await acquireTestDatabase('m365-range-refresh') : undefined;

let scratchDir: string;
let feedFile: string;

beforeAll(() => {
	buildPackage('@open-archiver/types');
	buildPackage('@open-archiver/journaling');
	buildPackage('smtp-ingress-app');
	scratchDir = mkdtempSync(path.join(tmpdir(), 'oa-m365-refresh-'));
	feedFile = path.join(scratchDir, 'endpoints.json');
	writeFileSync(feedFile, FEED_BODY, 'utf8');
}, 180_000);

afterAll(() => {
	if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
});

interface CliResult {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

/** Run the compiled helper. `stdin` non-`undefined` exercises the documented `curl … | …` form. */
function runCli(env: NodeJS.ProcessEnv, args: string[] = [], stdin?: string): Promise<CliResult> {
	const baseEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '' };
	if (process.env.SystemRoot) baseEnv.SystemRoot = process.env.SystemRoot;
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [ENTRY_JS, ...args], {
			env: { ...baseEnv, ...env },
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
		child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
		child.once('error', reject);
		child.once('close', (code) => resolve({ code, stdout, stderr }));
		if (stdin !== undefined) child.stdin.end(stdin);
		else child.stdin.end();
	});
}

/** Read `allowed_ips` back for every source, so a run can be shown to have changed nothing. */
async function allowedIpsByRoutingAddress(): Promise<Record<string, string[]>> {
	const rows = await harness!.sql<{ routing_address: string; allowed_ips: string[] }[]>`
		select routing_address, allowed_ips from journaling_sources order by routing_address
	`;
	return Object.fromEntries(rows.map((r) => [r.routing_address, r.allowed_ips]));
}

suiteRequiring('ci', 'refresh-m365-ranges against a real database (JR-4-09)', postgresProbe, () => {
	it('reports the missing official range, keeps quiet about deletion, and leaves allowed_ips byte-identical', async () => {
		await harness!.sql`delete from journaling_sources`;
		const source = await seedIngestionSource(harness!.db);
		// One official range present, one missing, and one entry the official list knows nothing
		// about (an on-premises connector, as far as the helper can tell).
		const journalingSource = await seedJournalingSource(harness!.db, {
			ingestionSourceId: source.id,
			allowedIps: ['40.92.0.0/15', '192.0.2.0/24'],
		});

		const before = await allowedIpsByRoutingAddress();
		const result = await runCli({ SMTP_INGRESS_DATABASE_URL: harness!.url }, [feedFile]);

		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('+ 40.107.0.0/16');
		expect(result.stdout).toContain('? 192.0.2.0/24');
		expect(result.stdout).toContain('NOT a removal');
		expect(result.stdout).toContain('Nothing was changed');
		expect(result.stdout).toContain(journalingSource.routingAddress);
		// The web front end's range is Exchange but not port 25 -- it must never be suggested.
		expect(result.stdout).not.toContain('13.107.6.152/31');
		// Actionable, not an error.
		expect(result.code).toBe(2);

		// The claim of this whole file: the helper read, and only read.
		expect(await allowedIpsByRoutingAddress()).toEqual(before);
	}, 60_000);

	it('reads the list from stdin too, because the documented invocation is a curl pipe', async () => {
		await harness!.sql`delete from journaling_sources`;
		const source = await seedIngestionSource(harness!.db);
		await seedJournalingSource(harness!.db, {
			ingestionSourceId: source.id,
			allowedIps: ['40.92.0.0/15'],
		});

		const before = await allowedIpsByRoutingAddress();
		const result = await runCli({ SMTP_INGRESS_DATABASE_URL: harness!.url }, [], FEED_BODY);

		expect(result.stdout).toContain('+ 40.107.0.0/16');
		expect(result.code).toBe(2);
		expect(await allowedIpsByRoutingAddress()).toEqual(before);
	}, 60_000);

	it('exits 0 when every official range is already covered, and still changes nothing', async () => {
		// This test owns the whole table: a source left over from another test would be missing a
		// range and would make this run exit 2 for a reason that is not this test's subject. The
		// helper never writes -- this test does, deliberately.
		await harness!.sql`delete from journaling_sources`;
		const source = await seedIngestionSource(harness!.db);
		await seedJournalingSource(harness!.db, {
			ingestionSourceId: source.id,
			// A single wider range covering both official ones -- proves the comparison is over
			// networks, through the real program, not just in the unit test.
			allowedIps: ['40.64.0.0/10'],
		});

		const before = await allowedIpsByRoutingAddress();
		const result = await runCli({ SMTP_INGRESS_DATABASE_URL: harness!.url }, [feedFile]);

		expect(result.stdout).toContain('missing from allowed_ips: none');
		expect(result.code).toBe(0);
		expect(await allowedIpsByRoutingAddress()).toEqual(before);
	}, 60_000);

	it('exits 1 -- never 0 -- when the list cannot be read, and says so instead of claiming the ACL is fine', async () => {
		const before = await allowedIpsByRoutingAddress();
		const missingFile = await runCli({ SMTP_INGRESS_DATABASE_URL: harness!.url }, [
			path.join(scratchDir, 'does-not-exist.json'),
		]);
		expect(missingFile.stderr).toContain('could not read the official endpoint list');
		expect(missingFile.code).toBe(1);

		// Malformed JSON is the same class of failure and must not read as "empty official list",
		// which would make every configured range look obsolete.
		const brokenFile = path.join(scratchDir, 'broken.json');
		writeFileSync(brokenFile, '[{"serviceArea": "Exchange",', 'utf8');
		const broken = await runCli({ SMTP_INGRESS_DATABASE_URL: harness!.url }, [brokenFile]);
		expect(broken.stderr).toContain('not valid JSON');
		expect(broken.code).toBe(1);

		// And a valid document that is not the feed at all.
		const wrongShape = path.join(scratchDir, 'wrong-shape.json');
		writeFileSync(wrongShape, '{"value": []}', 'utf8');
		const wrong = await runCli({ SMTP_INGRESS_DATABASE_URL: harness!.url }, [wrongShape]);
		expect(wrong.code).toBe(1);

		for (const result of [missingFile, broken, wrong]) {
			expect(result.stdout).not.toContain('missing from allowed_ips: none');
		}
		expect(await allowedIpsByRoutingAddress()).toEqual(before);
	}, 60_000);

	it('exits 1 when no database URL is configured, and names the variable', async () => {
		const result = await runCli({}, [feedFile]);
		expect(result.stderr).toContain('SMTP_INGRESS_DATABASE_URL is not set');
		expect(result.code).toBe(1);
	}, 60_000);
});
