import type { CaslPolicy, AppActions, AppSubjects } from '@open-archiver/types';
import {
	checkConditionsShape,
	isConditionOperatorKey,
	resolveConditionKey,
} from '../helpers/conditionKey';

// Create sets of valid actions and subjects for efficient validation
const validActions: Set<AppActions> = new Set([
	'manage',
	'create',
	'read',
	'update',
	'delete',
	'search',
	'export',
	'sync',
]);

const validSubjects: Set<AppSubjects> = new Set([
	'archive',
	'ingestion',
	'settings',
	'users',
	'roles',
	'dashboard',
	'all',
]);

/**
 * @class PolicyValidator
 *
 * This class provides a static method to validate a CASL policy.
 * It is designed to be used before a policy is saved to the database, ensuring that
 * only valid and well-formed policies are stored.
 *
 * The verification logic is based on the centralized definitions in `packages/types/src/iam.types.ts`.
 */
export class PolicyValidator {
	/**
	 * Validates a single policy statement to ensure its actions and subjects are valid.
	 *
	 * @param {CaslPolicy} policy - The policy to validate.
	 * @returns {{valid: boolean; reason?: string}} - An object containing a boolean `valid` property
	 * and an optional `reason` string if validation fails.
	 */
	public static isValid(policy: CaslPolicy): { valid: boolean; reason: string } {
		if (!policy || !policy.action || !policy.subject) {
			return {
				valid: false,
				reason: 'Policy is missing required fields "action" or "subject".',
			};
		}

		// 1. Validate Actions
		const actions = Array.isArray(policy.action) ? policy.action : [policy.action];
		for (const action of actions) {
			const { valid, reason } = this.isActionValid(action);
			if (!valid) {
				return { valid: false, reason };
			}
		}

		// 2. Validate Subjects
		const subjects = Array.isArray(policy.subject) ? policy.subject : [policy.subject];
		for (const subject of subjects) {
			const { valid, reason } = this.isSubjectValid(subject);
			if (!valid) {
				return { valid: false, reason };
			}
		}

		// 3. Validate the shape of `conditions` itself, then its keys.
		//
		// The shape check is not `if (policy.conditions)`. That truthiness test skipped every falsy
		// value, so `conditions: null`, `""`, `0` and `false` were stored and then read at request
		// time as "this rule carries no condition", which is unrestricted access -- a silently widened
		// permission out of an obviously broken policy. A truthy scalar such as `conditions: 5` was
		// stored just as happily and denies every request instead. Neither is a condition; both are
		// refused before they are stored. What is already in the database keeps behaving as it does
		// today -- changing that is a separate decision, not part of this gate.
		const shape = checkConditionsShape(policy.conditions);
		if (!shape.valid) {
			return { valid: false, reason: shape.reason };
		}

		if (policy.conditions !== undefined) {
			const { valid, reason } = this.areConditionKeysValid(policy.conditions);
			if (!valid) {
				return { valid: false, reason };
			}
		}

		return { valid: true, reason: 'valid' };
	}

	/**
	 * Refuses a `conditions` object whose keys cannot be a column reference.
	 *
	 * This is the half of finding F1 that matters operationally. `mongoToDrizzle` builds the column
	 * reference of a scoped query from the condition key, so a key carrying SQL syntax ends up in
	 * the `WHERE` clause of every query `FilterBuilder` scopes. `mongoToDrizzle` refuses such a key
	 * as well, but only at query time; this is the one place where the policy can be refused before
	 * it is ever stored, and `iam.controller.ts` rejects `createRole`/`updateRole` with 400 when it
	 * is.
	 *
	 * The verdict itself comes from `resolveConditionKey()` in `helpers/conditionKey`, which is the
	 * same function `mongoToDrizzle` asks at query time. That is deliberate: while each gate carried
	 * its own copy of the rule, this one accepted any number of segments and any relation prefix, so
	 * a key such as `foo.bar` or `attachment.name` was stored with HTTP 200 and then made every
	 * scoped query of that role fail. One predicate, one source.
	 *
	 * What is deliberately **not** checked here: whether the key names a column that exists. The
	 * validator has no table context -- the same policy statement can be written for several
	 * subjects -- and a name check belongs where the table is known.
	 *
	 * Operator keys are recursed through rather than validated as identifiers: they are never
	 * rendered as an identifier, and an unknown operator is refused by both translators. The
	 * operator *names* are not checked here on purpose -- the SQL and the search translator support
	 * different sets, so there is no one allowlist this gate could agree with.
	 */
	private static areConditionKeysValid(value: unknown): { valid: boolean; reason: string } {
		if (Array.isArray(value)) {
			for (const entry of value) {
				const result = this.areConditionKeysValid(entry);
				if (!result.valid) {
					return result;
				}
			}
			return { valid: true, reason: 'valid' };
		}

		if (typeof value !== 'object' || value === null) {
			return { valid: true, reason: 'valid' };
		}

		for (const key of Object.keys(value)) {
			if (!isConditionOperatorKey(key)) {
				const resolution = resolveConditionKey(key);
				if (!resolution.valid) {
					return {
						valid: false,
						reason:
							`${resolution.reason.charAt(0).toUpperCase()}${resolution.reason.slice(1)}. ` +
							`A condition key must be a column name, optionally prefixed by a ` +
							`resolvable relation, or a MongoDB operator.`,
					};
				}
			}
			const result = this.areConditionKeysValid((value as Record<string, unknown>)[key]);
			if (!result.valid) {
				return result;
			}
		}

		return { valid: true, reason: 'valid' };
	}

	/**
	 * Checks if a single action string is a valid AppAction.
	 *
	 * @param {string} action - The action string to validate.
	 * @returns {{valid: boolean; reason?: string}} - An object indicating validity and a reason for failure.
	 */
	private static isActionValid(action: AppActions): { valid: boolean; reason: string } {
		if (validActions.has(action)) {
			return { valid: true, reason: 'valid' };
		}
		return { valid: false, reason: `Action '${action}' is not a valid action.` };
	}

	/**
	 * Checks if a single subject string is a valid AppSubject.
	 *
	 * @param {string} subject - The subject string to validate.
	 * @returns {{valid: boolean; reason?: string}} - An object indicating validity and a reason for failure.
	 */
	private static isSubjectValid(subject: AppSubjects): { valid: boolean; reason: string } {
		if (validSubjects.has(subject)) {
			return { valid: true, reason: 'valid' };
		}

		return { valid: false, reason: `Subject '${subject}' is not a valid subject.` };
	}
}
