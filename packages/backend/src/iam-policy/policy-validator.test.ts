import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import type { AppActions, AppSubjects, CaslPolicy } from '@open-archiver/types';
import { suite } from '@oa-test/classification';
import { PolicyValidator } from './policy-validator';
import {
	POLICY_FIXTURES,
	loadAllPolicyFixtures,
	loadPolicyFixture,
} from '../../tests/support/policy-fixtures';

/**
 * JR-103 -- unit tests for `PolicyValidator.isValid()`.
 *
 * Classification: `ci`. Pure function, no I/O beyond reading fixture files, milliseconds.
 *
 * This suite freezes the *actual* behaviour of the validator, not the documented one. CLAUDE.md
 * section 5.4 records that `docs/services/iam-service/iam-policy.md` is stale: it omits `export`
 * from the action list. The code is correct and accepts `export`; the assertion below is what will
 * keep JR-1103 (documentation fix) honest.
 */

const vocabularyPath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../tests/fixtures/iam-vocabulary.json'
);
const vocabulary = JSON.parse(readFileSync(vocabularyPath, 'utf8')) as {
	actions: AppActions[];
	subjects: AppSubjects[];
	rejectedActions: string[];
	rejectedSubjects: string[];
};

suite('ci', 'PolicyValidator.isValid() -- repository policy fixtures', () => {
	it('loads all eight fixtures from disk', () => {
		const loaded = loadAllPolicyFixtures();
		expect(loaded.map((entry) => entry.name)).toEqual([...POLICY_FIXTURES]);
		expect(loaded).toHaveLength(8);
		// Every fixture must carry at least one policy statement, otherwise "all statements are
		// valid" below would be vacuously true.
		for (const { name, policies } of loaded) {
			expect(policies.length, `fixture ${name} has no policy statements`).toBeGreaterThan(0);
		}
	});

	it.each([...POLICY_FIXTURES])('accepts every policy statement in %s.json', (name) => {
		const policies = loadPolicyFixture(name);
		for (const [index, policy] of policies.entries()) {
			const result = PolicyValidator.isValid(policy);
			expect(
				result,
				`${name}.json statement #${index} rejected: ${result.reason} -- ${JSON.stringify(policy)}`
			).toEqual({ valid: true, reason: 'valid' });
		}
	});

	it('accepts the array-form action/subject in read-only-all.json', () => {
		const [policy] = loadPolicyFixture('read-only-all');
		expect(Array.isArray(policy.action)).toBe(true);
		expect(Array.isArray(policy.subject)).toBe(true);
		expect(policy.subject).toHaveLength(5);
		expect(PolicyValidator.isValid(policy).valid).toBe(true);
	});

	it('accepts the inverted (deny) statement in auditor-specific-mailbox.json', () => {
		const policies = loadPolicyFixture('auditor-specific-mailbox');
		const denyRule = policies.find((policy) => policy.inverted === true);
		expect(denyRule, 'fixture no longer contains an inverted rule').toBeDefined();
		// `inverted` is not part of validation, but it must not make a statement invalid either.
		expect(PolicyValidator.isValid(denyRule!)).toEqual({ valid: true, reason: 'valid' });
	});

	it('refuses a condition key that is not a column reference, accepts an unknown operator', () => {
		// Superseded pin. Until JR-1313 this case asserted that `isValid()` accepts *both* halves of
		// `{ id: { $totallyNotAnOperator: 1 }, 'a.b.c': null }`, because step 3 of `isValid()` was a
		// TODO comment. The two halves are now judged differently, and on purpose:
		//
		//   - `a.b.c` is refused. `mongoToDrizzle` has always refused a key with more than two parts,
		//     so accepting it here stored a policy that could only fail later (finding F29). The two
		//     gates now share one predicate; `tests/unit/condition-key-gates.test.ts` holds them
		//     against each other.
		//   - `$totallyNotAnOperator` is still accepted here and still refused at query time. The SQL
		//     translator and the search translator support different operator sets, so a save-time
		//     operator allowlist would refuse policies the other translator accepts. That carve-out
		//     is asserted in the cross-gate file rather than left to a comment.
		const [policy] = loadPolicyFixture('auditor-specific-sources');
		expect(policy.conditions).toBeDefined();
		const badKey: CaslPolicy = { ...policy, conditions: { 'a.b.c': null } };
		const result = PolicyValidator.isValid(badKey);
		expect(result.valid).toBe(false);
		expect(result.reason).toContain('a.b.c');

		const unknownOperator: CaslPolicy = {
			...policy,
			conditions: { id: { $totallyNotAnOperator: 1 } },
		};
		expect(PolicyValidator.isValid(unknownOperator)).toEqual({ valid: true, reason: 'valid' });
	});
});

suite('ci', 'PolicyValidator.isValid() -- vocabulary', () => {
	it.each(vocabulary.actions)('accepts action "%s" on subject "archive"', (action) => {
		expect(PolicyValidator.isValid({ action, subject: 'archive' })).toEqual({
			valid: true,
			reason: 'valid',
		});
	});

	it('accepts "export" -- the code is right and iam-policy.md is stale (JR-1103)', () => {
		expect(vocabulary.actions).toContain('export');
		expect(PolicyValidator.isValid({ action: 'export', subject: 'archive' }).valid).toBe(true);
		expect(PolicyValidator.isValid({ action: ['read', 'export'], subject: 'all' }).valid).toBe(
			true
		);
	});

	it.each(vocabulary.subjects)('accepts subject "%s" with action "read"', (subject) => {
		expect(PolicyValidator.isValid({ action: 'read', subject })).toEqual({
			valid: true,
			reason: 'valid',
		});
	});

	it.each(vocabulary.rejectedActions)('rejects action "%s"', (action) => {
		const result = PolicyValidator.isValid({
			action: action as AppActions,
			subject: 'archive',
		});
		expect(result.valid).toBe(false);
		// The reason has to name the offending token -- a generic "invalid policy" is useless in
		// an audit trail.
		if (action === '') {
			// Falsy action hits the missing-fields branch first.
			expect(result.reason).toBe('Policy is missing required fields "action" or "subject".');
		} else {
			expect(result.reason).toBe(`Action '${action}' is not a valid action.`);
		}
	});

	it.each(vocabulary.rejectedSubjects)('rejects subject "%s"', (subject) => {
		const result = PolicyValidator.isValid({
			action: 'read',
			subject: subject as AppSubjects,
		});
		expect(result.valid).toBe(false);
		if (subject === '') {
			expect(result.reason).toBe('Policy is missing required fields "action" or "subject".');
		} else {
			expect(result.reason).toBe(`Subject '${subject}' is not a valid subject.`);
		}
	});

	it('rejects an array in which only one member is invalid', () => {
		expect(
			PolicyValidator.isValid({
				action: ['read', 'destroy' as AppActions, 'search'],
				subject: 'archive',
			})
		).toEqual({ valid: false, reason: "Action 'destroy' is not a valid action." });
		expect(
			PolicyValidator.isValid({
				action: 'read',
				subject: ['archive', 'mailbox' as AppSubjects],
			})
		).toEqual({ valid: false, reason: "Subject 'mailbox' is not a valid subject." });
	});

	it('reports the first invalid action, and actions before subjects', () => {
		// Ordering matters for the error message a user sees; freeze it.
		const result = PolicyValidator.isValid({
			action: 'destroy' as AppActions,
			subject: 'mailbox' as AppSubjects,
		});
		expect(result.reason).toBe("Action 'destroy' is not a valid action.");
	});

	it.each([
		['missing action', { subject: 'archive' } as unknown as CaslPolicy],
		['missing subject', { action: 'read' } as unknown as CaslPolicy],
		['empty object', {} as unknown as CaslPolicy],
		['null', null as unknown as CaslPolicy],
		['undefined', undefined as unknown as CaslPolicy],
	])('rejects %s without throwing', (_label, policy) => {
		const result = PolicyValidator.isValid(policy);
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('Policy is missing required fields "action" or "subject".');
	});

	it('accepts empty action/subject arrays -- observed gap in the missing-fields guard', () => {
		// `[]` is truthy, so `!policy.action` does not fire; the loop then iterates zero times and
		// the statement is reported valid. Recorded as observed behaviour, not endorsed: an empty
		// array grants nothing in CASL, so it is not a privilege escalation, but a policy that
		// grants nothing is also not something the validator should wave through.
		expect(PolicyValidator.isValid({ action: [], subject: 'archive' })).toEqual({
			valid: true,
			reason: 'valid',
		});
		expect(PolicyValidator.isValid({ action: 'read', subject: [] })).toEqual({
			valid: true,
			reason: 'valid',
		});
	});
});
