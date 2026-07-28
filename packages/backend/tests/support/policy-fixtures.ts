import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CaslPolicy } from '@open-archiver/types';

/**
 * Loader for the IAM policy fixtures that shipped with the repository but were, until JR-103,
 * referenced by no code at all: `packages/backend/src/iam-policy/test-policies/*.json`.
 *
 * They stay where they are instead of moving to `tests/fixtures/` -- they are pre-existing repo
 * content and moving them would be a production-tree change for cosmetic reasons. New fixtures go
 * to `tests/fixtures/`. See docs/dev/journaling/04-testplan.md section 2.
 *
 * The loader reads from disk on every call and refuses to paper over a missing file: a renamed or
 * deleted fixture produces a hard error naming the path. That is what makes "the fixtures are
 * actually loaded" a checkable claim rather than an assertion about an inlined copy.
 */

export const POLICY_FIXTURE_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../src/iam-policy/test-policies'
);

/** Every fixture file present in the repository, by bare name. */
export const POLICY_FIXTURES = [
	'admin',
	'auditor-specific-mailbox',
	'auditor-specific-sources',
	'end-user',
	'ingestion-admin',
	'read-only-all',
	'single-ingestion-access',
	'user-manager',
] as const;

export type PolicyFixtureName = (typeof POLICY_FIXTURES)[number];

export function policyFixturePath(name: PolicyFixtureName): string {
	return path.join(POLICY_FIXTURE_DIR, `${name}.json`);
}

export function loadPolicyFixture(name: PolicyFixtureName): CaslPolicy[] {
	const file = policyFixturePath(name);
	let raw: string;
	try {
		raw = readFileSync(file, 'utf8');
	} catch (error) {
		throw new Error(
			`IAM policy fixture "${name}" could not be read from ${file}. ` +
				`The fixtures under src/iam-policy/test-policies/ are the input of this test suite; ` +
				`if one was renamed or removed, fix the fixture or update POLICY_FIXTURES. ` +
				`Underlying error: ${(error as Error).message}`
		);
	}
	const parsed = JSON.parse(raw);
	if (!Array.isArray(parsed) || parsed.length === 0) {
		throw new Error(`IAM policy fixture "${name}" (${file}) is not a non-empty JSON array.`);
	}
	return parsed as CaslPolicy[];
}

/** All fixtures, loaded. Used to assert coverage over the whole fixture set. */
export function loadAllPolicyFixtures(): Array<{
	name: PolicyFixtureName;
	policies: CaslPolicy[];
}> {
	return POLICY_FIXTURES.map((name) => ({ name, policies: loadPolicyFixture(name) }));
}
