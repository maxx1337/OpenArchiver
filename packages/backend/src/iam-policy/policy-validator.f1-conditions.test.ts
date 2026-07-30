import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { coverageNotice } from '@oa-test/notice';
import type { CaslPolicy } from '@open-archiver/types';
import { PolicyValidator } from './policy-validator';
import { redUntil } from '../../tests/support/fail-closed';

/**
 * FINDING F1 regression at the validation boundary (JR-1301, epic E13).
 *
 * Classification: `ci`. Pure -- `PolicyValidator` imports only types.
 *
 * ---------------------------------------------------------------------------------------------
 * The claim under test
 * ---------------------------------------------------------------------------------------------
 * `JR-1306`'s acceptance criteria end with: "`PolicyValidator` weist solche Policies beim Anlegen
 * ab." That is the second half of F1 and it is the half that matters operationally: the injection
 * in `mongoToDrizzle` is only reachable because a hostile `conditions` object can be *stored*.
 * `iam.controller.ts` runs `PolicyValidator.isValid()` on every statement before
 * `createRole`/`updateRole` (lines 52-58 and 88-95) and rejects with 400 -- so the validator is
 * the one place where the policy can be refused before it ever reaches the database.
 *
 * Today `isValid()` does not look at `conditions` at all; the source carries the comment
 * "3. (Optional) Validate Conditions, Fields, etc. in the future if needed."
 *
 * ---------------------------------------------------------------------------------------------
 * Scope of these tests
 * ---------------------------------------------------------------------------------------------
 * They demand rejection for condition keys that contain SQL syntax, and they demand that the
 * policies actually shipped by `createDefaultRoles` and by the eight fixtures under
 * `src/iam-policy/test-policies/` keep validating. They deliberately say nothing about *unknown
 * but harmless* keys -- see finding F17 and the note in `mongoToDrizzle.test.ts`.
 *
 * `policy-validator.test.ts` (JR-103, 53 cases) stays as it is: it covers actions and subjects and
 * none of its assertions contradict this file. The one existing test that documents the gap --
 * "does not inspect conditions at all" -- is the reason this file exists rather than an edit there;
 * it is a statement about today's surface, and F6 (also open, not in E13) lives next to it.
 */

const hostileConditionKeys = [
	'id" or 1=1 --',
	'ingestionSource.x" or 1=1 --',
	'userEmail" is not null or "id" is not null --',
	'id"; drop table archived_emails; --',
];

suite('ci', 'PolicyValidator.isValid() -- FINDING F1: hostile condition keys', () => {
	it(redUntil('JR-1306', 'a condition key containing SQL syntax is refused'), () => {
		coverageNotice(
			'FINDING F1 regression (JR-1301): PolicyValidator.isValid() does not inspect ' +
				'`conditions`, so a role carrying an injecting condition key can be created through ' +
				'POST /roles. Expected RED until JR-1306.'
		);
		for (const key of hostileConditionKeys) {
			const policy = {
				action: 'read',
				subject: 'archive',
				conditions: { [key]: 'v' },
			} as unknown as CaslPolicy;
			const { valid, reason } = PolicyValidator.isValid(policy);
			expect(
				valid,
				`PolicyValidator.isValid() accepted a policy whose condition key is ` +
					`${JSON.stringify(key)} (reason field: ${JSON.stringify(reason)}). ` +
					`iam.controller.ts only refuses a policy when isValid() says so, so this policy ` +
					`reaches roles.policies and from there the WHERE clause of every ` +
					`FilterBuilder-scoped query. See 09-befunde-bestandscode.md F1 and JR-1306.`
			).toBe(false);
			expect(reason, 'a refusal must name why, the message is shown to the operator').toEqual(
				expect.stringMatching(/.+/)
			);
		}
	});

	it(redUntil('JR-1306', 'a hostile key nested inside $or / $and / $not is refused too'), () => {
		// Rejecting only top-level keys would be a fix that the exploit walks around: CASL
		// conditions nest, and `mongoToDrizzle` recurses into $or/$and/$not before it builds the
		// column reference.
		const nested: Array<Record<string, unknown>> = [
			{ $or: [{ id: 'a' }, { 'id" or 1=1 --': 'v' }] },
			{ $and: [{ 'id" or 1=1 --': 'v' }] },
			{ $not: { 'id" or 1=1 --': 'v' } },
			{ $or: [{ $and: [{ $not: { 'id" or 1=1 --': 'v' } }] }] },
		];
		for (const conditions of nested) {
			const policy = {
				action: 'read',
				subject: 'archive',
				conditions,
			} as unknown as CaslPolicy;
			expect(
				PolicyValidator.isValid(policy).valid,
				`accepted a nested hostile key: ${JSON.stringify(conditions)}`
			).toBe(false);
		}
	});

	it('the policies shipped by createDefaultRoles still validate', () => {
		// Counter-check, green before and after JR-1306. Copied from
		// api/controllers/iam.controller.ts createDefaultRoles and services/UserService.ts:270.
		// The integration test `predefined-roles.int.test.ts` drives the *real* code path; here the
		// point is only that a condition validator must not reject the shapes we ship.
		const shipped: CaslPolicy[] = [
			{ action: 'manage', subject: 'all' },
			{ action: 'read', subject: 'dashboard' },
			{ action: 'create', subject: 'ingestion' },
			{ action: 'manage', subject: 'ingestion', conditions: { userId: '${user.id}' } },
			{
				action: 'manage',
				subject: 'archive',
				conditions: { 'ingestionSource.userId': '${user.id}' },
			},
			{
				action: ['read', 'search'],
				subject: ['ingestion', 'archive', 'dashboard', 'users', 'roles'],
			},
		];
		for (const policy of shipped) {
			const { valid, reason } = PolicyValidator.isValid(policy);
			expect(valid, `${JSON.stringify(policy)} was refused: ${reason}`).toBe(true);
		}
	});

	it('a policy with no conditions at all is unaffected', () => {
		expect(PolicyValidator.isValid({ action: 'read', subject: 'archive' }).valid).toBe(true);
	});
});
