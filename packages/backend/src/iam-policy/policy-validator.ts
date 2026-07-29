import type { CaslPolicy, AppActions, AppSubjects } from '@open-archiver/types';

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
 * A condition key is a column reference: one or more dot-separated identifier segments
 * (`userEmail`, `ingestionSource.userId`).
 */
const CONDITION_KEY_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A MongoDB-style operator key (`$or`, `$in`, ...). Never rendered as an identifier. */
const CONDITION_OPERATOR_KEY = /^\$[A-Za-z][A-Za-z0-9]*$/;

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

		// 3. Validate condition keys.
		if (policy.conditions) {
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
	 * What is deliberately **not** checked here: whether the key names a column that exists. The
	 * validator has no table context -- the same policy statement can be written for several
	 * subjects -- and a name check belongs where the table is known. `mongoToDrizzle` is where the
	 * relation allowlist lives.
	 *
	 * Operator keys are recursed through rather than validated as identifiers: they are never
	 * rendered as an identifier, and an unknown operator is refused by both translators.
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
			const isOperator = key.startsWith('$')
				? CONDITION_OPERATOR_KEY.test(key)
				: key.split('.').every((segment) => CONDITION_KEY_SEGMENT.test(segment));
			if (!isOperator) {
				return {
					valid: false,
					reason:
						`Condition key '${key}' is not a valid column reference. A condition key ` +
						`must be one or more dot-separated identifiers, or a MongoDB operator.`,
				};
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
