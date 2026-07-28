import { subject as tagSubject } from '@casl/ability';
import { expect, it } from 'vitest';
import type { AppSubjects, CaslPolicy } from '@open-archiver/types';
import { suite } from '@oa-test/classification';
import { createAbilityFor } from './ability';
import { loadPolicyFixture } from '../../tests/support/policy-fixtures';

/**
 * JR-103 -- unit tests for `createAbilityFor()`.
 *
 * Classification: `ci`. Pure; `ability.ts` imports only schema *definitions*, no connection.
 *
 * The negative assertions are the point of this suite. A test that only checks "the auditor may
 * read" does not test the role -- it tests that CASL exists. What has to hold is that the auditor
 * may **not** write, and may not read outside its scope.
 *
 * Two CASL behaviours are load-bearing here and are asserted explicitly rather than assumed:
 *
 *  1. A *type-only* check (`can('read', 'ingestion')`, subject as a bare string) ignores
 *     conditions and answers "could be allowed for some object of this type". It is therefore
 *     **not** an authorization decision for a specific record. This is precisely the trap
 *     `requireAuth`/`requirePermission` fall into (CLAUDE.md section 5.4): the middleware never
 *     passes a resource object, so row-level scoping must go through `FilterBuilder`.
 *  2. A `${user.id}` placeholder in a stored policy is **not** interpolated by
 *     `createAbilityFor()`. Substitution happens one layer up, in
 *     `IamService.getAbilityForUser()` (packages/backend/src/services/IamService.ts:81).
 */

const INGESTION_A = 'f16b7ed2-4e54-4283-9556-c633726f9405';
const INGESTION_B = 'aeafbe44-d41c-4015-ac27-504f6e0c511a';
const INGESTION_C = 'f3d7c025-060f-4f1f-a0e6-cdd32e6e07af';
const UNRELATED = '00000000-0000-0000-0000-000000000000';

/**
 * `AppAbility` is declared as `MongoAbility<[AppActions, AppSubjects]>`, i.e. its subject type is
 * the bare string union. A CASL-tagged *object* is therefore not assignable to `can()` at the type
 * level, and every record-level check has to be cast. Production code does exactly that --
 * `AuthorizationService.can()` ends in `ability.can(action, subjectInstance as AppSubjects)`
 * (packages/backend/src/services/AuthorizationService.ts). These helpers mirror that cast so the
 * tests exercise the same call shape as production; see FINDING F2 in the JR-103 report.
 */
const asSubject = (value: unknown) => value as AppSubjects;
const tagged = (type: 'ingestion' | 'archive', fields: Record<string, unknown>) =>
	asSubject(tagSubject(type, fields));
const ingestion = (id: string, extra: Record<string, unknown> = {}) =>
	tagged('ingestion', { id, ...extra });
const archive = (extra: Record<string, unknown>) => tagged('archive', { ...extra });

suite('ci', 'createAbilityFor() -- admin.json grants everything', () => {
	const ability = createAbilityFor(loadPolicyFixture('admin'));

	it.each([
		['manage', 'all'],
		['read', 'archive'],
		['create', 'ingestion'],
		['update', 'settings'],
		['delete', 'users'],
		['search', 'archive'],
		['export', 'archive'],
		['sync', 'ingestion'],
	] as const)('allows %s on %s', (action, subj) => {
		expect(ability.can(action, subj)).toBe(true);
	});

	it('allows action on concrete objects regardless of their fields', () => {
		expect(ability.can('delete', ingestion(UNRELATED))).toBe(true);
		expect(ability.can('read', archive({ userEmail: 'anyone@example.invalid' }))).toBe(true);
	});

	it('manage is a true wildcard and covers export -- iam-policy.md claims otherwise', () => {
		// CLAUDE.md section 5.4: the docs wrongly enumerate `manage` as create/read/update/
		// delete/search/sync. It is a wildcard and covers `export` too.
		expect(ability.can('export', 'ingestion')).toBe(true);
		expect(ability.can('export', 'settings')).toBe(true);
	});
});

suite('ci', 'createAbilityFor() -- read-only-all.json is read-only', () => {
	const ability = createAbilityFor(loadPolicyFixture('read-only-all'));

	it.each(['ingestion', 'archive', 'dashboard', 'users', 'roles'] as const)(
		'allows read and search on %s',
		(subj) => {
			expect(ability.can('read', subj)).toBe(true);
			expect(ability.can('search', subj)).toBe(true);
		}
	);

	it.each(['ingestion', 'archive', 'dashboard', 'users', 'roles'] as const)(
		'denies create, update, delete, export, sync and manage on %s',
		(subj) => {
			expect(ability.can('create', subj)).toBe(false);
			expect(ability.can('update', subj)).toBe(false);
			expect(ability.can('delete', subj)).toBe(false);
			expect(ability.can('export', subj)).toBe(false);
			expect(ability.can('sync', subj)).toBe(false);
			expect(ability.can('manage', subj)).toBe(false);
		}
	);

	it('denies everything on subjects the fixture does not mention', () => {
		// `settings` and `all` are absent from the fixture's subject list.
		expect(ability.can('read', 'settings')).toBe(false);
		expect(ability.can('search', 'settings')).toBe(false);
		expect(ability.can('read', 'all')).toBe(false);
		expect(ability.can('manage', 'all')).toBe(false);
	});

	it('denies writes on concrete objects too, not just on subject types', () => {
		expect(ability.can('update', ingestion(INGESTION_A))).toBe(false);
		expect(ability.can('delete', archive({ userEmail: 'dev@openarchiver.com' }))).toBe(false);
	});
});

suite('ci', 'createAbilityFor() -- auditor-specific-mailbox.json stays in its scope', () => {
	const policies = loadPolicyFixture('auditor-specific-mailbox');
	const ability = createAbilityFor(policies);

	it('allows read and search on the one permitted ingestion source', () => {
		expect(ability.can('read', ingestion(INGESTION_A))).toBe(true);
		expect(ability.can('search', ingestion(INGESTION_A))).toBe(true);
	});

	it('denies read and search on any other ingestion source', () => {
		expect(ability.can('read', ingestion(UNRELATED))).toBe(false);
		expect(ability.can('search', ingestion(UNRELATED))).toBe(false);
		expect(ability.can('read', ingestion(INGESTION_B))).toBe(false);
		expect(ability.can('read', ingestion(INGESTION_C))).toBe(false);
	});

	it('denies every write action even on the permitted source', () => {
		for (const action of ['create', 'update', 'delete', 'export', 'sync', 'manage'] as const) {
			expect(ability.can(action, ingestion(INGESTION_A)), `action ${action}`).toBe(false);
		}
	});

	it('grants no archive access at all -- the only archive rule is an inverted one', () => {
		// The fixture denies archive access for one address but never grants it anywhere, so the
		// deny rule is redundant and archive is closed. Freezing this prevents someone from
		// "fixing" the fixture into an accidental grant.
		expect(policies.some((policy) => policy.subject === 'archive' && policy.inverted)).toBe(
			true
		);
		expect(policies.some((policy) => policy.subject === 'archive' && !policy.inverted)).toBe(
			false
		);
		expect(ability.can('read', 'archive')).toBe(false);
		expect(ability.can('read', archive({ userEmail: 'dev@openarchiver.com' }))).toBe(false);
		expect(ability.can('read', archive({ userEmail: 'someone.else@example.invalid' }))).toBe(
			false
		);
	});

	it('a type-only check is NOT an authorization decision for a record', () => {
		// True, although only one specific source is permitted. Middleware that checks the subject
		// type alone therefore authorizes access to every ingestion source.
		expect(ability.can('read', 'ingestion')).toBe(true);
		expect(ability.can('read', ingestion(UNRELATED))).toBe(false);
	});
});

suite('ci', 'createAbilityFor() -- auditor-specific-sources.json honours $in', () => {
	const ability = createAbilityFor(loadPolicyFixture('auditor-specific-sources'));

	it('allows both listed sources', () => {
		expect(ability.can('read', ingestion(INGESTION_A))).toBe(true);
		expect(ability.can('read', ingestion(INGESTION_B))).toBe(true);
		expect(ability.can('search', ingestion(INGESTION_A))).toBe(true);
		expect(ability.can('search', ingestion(INGESTION_B))).toBe(true);
	});

	it('denies a source that is not in the list', () => {
		expect(ability.can('read', ingestion(INGESTION_C))).toBe(false);
		expect(ability.can('search', ingestion(UNRELATED))).toBe(false);
	});

	it('denies every action other than read and search', () => {
		for (const action of ['create', 'update', 'delete', 'export', 'sync', 'manage'] as const) {
			expect(ability.can(action, ingestion(INGESTION_A)), `action ${action}`).toBe(false);
			expect(ability.can(action, 'ingestion'), `action ${action} type-only`).toBe(false);
		}
	});

	it('grants nothing on any other subject', () => {
		for (const subj of ['archive', 'settings', 'users', 'roles', 'dashboard', 'all'] as const) {
			expect(ability.can('read', subj), `subject ${subj}`).toBe(false);
		}
	});
});

suite('ci', 'createAbilityFor() -- remaining fixtures', () => {
	it('single-ingestion-access.json scopes manage to exactly one id', () => {
		const ability = createAbilityFor(loadPolicyFixture('single-ingestion-access'));
		expect(ability.can('manage', ingestion(INGESTION_C))).toBe(true);
		expect(ability.can('delete', ingestion(INGESTION_C))).toBe(true);
		expect(ability.can('delete', ingestion(INGESTION_A))).toBe(false);
		expect(ability.can('read', ingestion(UNRELATED))).toBe(false);
		expect(ability.can('read', 'archive')).toBe(false);
	});

	it('ingestion-admin.json grants ingestion only, not the archive', () => {
		const ability = createAbilityFor(loadPolicyFixture('ingestion-admin'));
		expect(ability.can('sync', 'ingestion')).toBe(true);
		expect(ability.can('delete', ingestion(UNRELATED))).toBe(true);
		expect(ability.can('read', 'archive')).toBe(false);
		expect(ability.can('search', 'archive')).toBe(false);
		expect(ability.can('read', 'users')).toBe(false);
		expect(ability.can('manage', 'all')).toBe(false);
	});

	it('user-manager.json may manage users but only read roles', () => {
		const ability = createAbilityFor(loadPolicyFixture('user-manager'));
		expect(ability.can('manage', 'users')).toBe(true);
		expect(ability.can('delete', 'users')).toBe(true);
		expect(ability.can('read', 'roles')).toBe(true);
		expect(ability.can('update', 'roles')).toBe(false);
		expect(ability.can('create', 'roles')).toBe(false);
		expect(ability.can('delete', 'roles')).toBe(false);
		expect(ability.can('read', 'archive')).toBe(false);
	});

	it('end-user.json: the ${user.id} placeholder is not interpolated here', () => {
		const policies = loadPolicyFixture('end-user');
		const ability = createAbilityFor(policies);
		// Verbatim placeholder matches; a real user id does not. Interpolation is IamService's job.
		expect(ability.can('update', tagged('ingestion', { userId: '${user.id}' }))).toBe(true);
		expect(ability.can('update', tagged('ingestion', { userId: UNRELATED }))).toBe(false);
		expect(ability.can('delete', tagged('ingestion', { userId: UNRELATED }))).toBe(false);

		// With the substitution IamService performs, ownership scoping works and only for the owner.
		const interpolated = JSON.parse(
			JSON.stringify(policies).replace(/\$\{user\.id\}/g, UNRELATED)
		) as CaslPolicy[];
		const owned = createAbilityFor(interpolated);
		expect(owned.can('update', tagged('ingestion', { userId: UNRELATED }))).toBe(true);
		expect(owned.can('update', tagged('ingestion', { userId: INGESTION_A }))).toBe(false);
		expect(owned.can('delete', tagged('ingestion', { userId: INGESTION_A }))).toBe(false);
	});

	it('end-user.json grants dashboard read and unconditional ingestion create, nothing more', () => {
		const ability = createAbilityFor(loadPolicyFixture('end-user'));
		expect(ability.can('read', 'dashboard')).toBe(true);
		expect(ability.can('create', 'ingestion')).toBe(true);
		expect(ability.can('read', 'users')).toBe(false);
		expect(ability.can('read', 'roles')).toBe(false);
		expect(ability.can('read', 'settings')).toBe(false);
		expect(ability.can('read', 'archive')).toBe(false);
		expect(ability.can('manage', 'all')).toBe(false);
	});

	it('an empty policy list grants nothing', () => {
		const ability = createAbilityFor([]);
		expect(ability.can('read', 'archive')).toBe(false);
		expect(ability.can('manage', 'all')).toBe(false);
		expect(ability.rules).toHaveLength(0);
	});

	it('does not expand ingestion permissions to the archive (expandPolicies is disabled)', () => {
		// ability.ts keeps `expandPolicies` around but no longer calls it. If someone re-enables
		// it, ingestion-scoped roles would silently gain archive access -- this is the guard.
		const ability = createAbilityFor(loadPolicyFixture('auditor-specific-sources'));
		expect(ability.rules).toHaveLength(1);
		expect(ability.rules.every((rule) => rule.subject === 'ingestion')).toBe(true);
	});
});
