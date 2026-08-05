import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A fresh, self-signed, test-only TLS certificate/key pair, generated at test-setup time via the
 * system `openssl` CLI (`JR-4-04`).
 *
 * ---------------------------------------------------------------------------------------------
 * Why a runtime-generated certificate rather than a checked-in test key
 * ---------------------------------------------------------------------------------------------
 * The Product Owner's instruction was explicit: no private key in the repository if it can be
 * avoided, and if it cannot, present the alternatives with their trade-offs and decide with reasons.
 * Three were considered:
 *
 *   (a) A checked-in, clearly-labelled test-only cert/key pair under `tests/fixtures/`. Zero runtime
 *       dependency, perfectly deterministic, but a private key in version control regardless of how
 *       clearly it is labelled -- exactly what the Product Owner asked to avoid if avoidable.
 *   (b) A pure-JS certificate-generation dependency (e.g. `selfsigned`, built on `node-forge`).
 *       Genuinely dependency-free of any *system* binary and fully portable, but adds a new
 *       dev-dependency to `packages/journaling` and (per this environment's package manager) needs a
 *       registry-reachable `pnpm install` to land, which this sandbox cannot be assumed to have.
 *   (c) Shell out to the system `openssl` CLI at test-setup time, as this file does. No new
 *       dependency of any kind, and measured to work correctly in this repository's actual test
 *       environment (Node's own `child_process.execFileSync` spawning `openssl` directly -- *not*
 *       through a shell -- avoids Git-for-Windows' MSYS argument-mangling of a leading `/` in
 *       `-subj`, which a literal `bash -c "openssl ..."` invocation would hit; verified directly
 *       against this repository's actual `openssl 3.5.6` before writing this file). The one real
 *       cost: a machine with no `openssl` binary on `PATH` cannot run the suite that needs this --
 *       `probeOpensslAvailable()` below is how that suite states the requirement and skips (or, with
 *       `OA_TEST_REQUIRE_INFRA=1`, fails loudly) rather than silently passing nothing.
 *
 * Decision: (c). It is the only option that adds nothing -- no checked-in secret, no new
 * dependency -- while still generating a genuinely fresh key every test run, which is a stronger
 * property than (a) even ignoring the "no key in the repo" instruction: nothing here outlives this
 * process.
 */
export interface TestTlsCertificate {
	readonly cert: string;
	readonly key: string;
}

let cached: TestTlsCertificate | null = null;
let cachedError: Error | null = null;

/**
 * Generate (once per process -- see the module doc comment) a self-signed RSA-2048 certificate
 * valid for one day, `CN=smtp-ingress-test`. Every caller in one test run shares the same pair;
 * there is no reason for each test case to pay for its own `openssl` invocation, and doing so would
 * make the whole suite noticeably slower for no additional coverage.
 */
export function generateTestTlsCertificate(): TestTlsCertificate {
	if (cached) {
		return cached;
	}
	if (cachedError) {
		throw cachedError;
	}
	const dir = mkdtempSync(join(tmpdir(), 'oa-journaling-test-tls-'));
	try {
		const keyPath = join(dir, 'key.pem');
		const certPath = join(dir, 'cert.pem');
		// Spawned directly (never via a shell) -- see the module doc comment's decision (c) for why
		// that matters on Windows specifically.
		execFileSync(
			'openssl',
			[
				'req',
				'-x509',
				'-newkey',
				'rsa:2048',
				'-nodes',
				'-keyout',
				keyPath,
				'-out',
				certPath,
				'-days',
				'1',
				'-subj',
				'/CN=smtp-ingress-test',
			],
			{ stdio: 'pipe' }
		);
		cached = { cert: readFileSync(certPath, 'utf8'), key: readFileSync(keyPath, 'utf8') };
		return cached;
	} catch (err) {
		cachedError = err instanceof Error ? err : new Error(String(err));
		throw cachedError;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

export interface InfraRequirement {
	readonly available: boolean;
	readonly reason: string;
}

/** For `suiteRequiring()` (`tests/support/classification.ts`): whether a real certificate/key pair
 * can be generated in this environment at all. Attempts the real generation (and caches its result,
 * good or bad) rather than merely checking `openssl --version`, so a probe that reports "available"
 * has actually proven the thing the suite needs, not just that a binary with that name exists. */
export function probeOpensslAvailable(): InfraRequirement {
	try {
		generateTestTlsCertificate();
		return { available: true, reason: '' };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			available: false,
			reason: `openssl CLI unavailable or failed to generate a test certificate: ${message}`,
		};
	}
}
