import { SQL, sql } from 'drizzle-orm';
import { IamService } from './IamService';
import { rulesToQuery } from '@casl/ability/extra';
import { mongoToDrizzle } from '../helpers/mongoToDrizzle';
import { mongoToMeli } from '../helpers/mongoToMeli';
import { AppActions, AppSubjects } from '@open-archiver/types';

/**
 * Row-level access scoping.
 *
 * The two halves of the return value are read by their callers as follows:
 *
 *   - `drizzleFilter === undefined` → do not restrict the query (see `ArchivedEmailService`
 *     `getArchivedEmails`, `IngestionService.findAll`).
 *   - `searchFilter === undefined` → do not restrict the search; `''` → deny (`SearchService`
 *     substitutes a never-matching filter).
 *
 * `undefined` therefore means *full access*, and it must only ever be produced for a principal
 * that demonstrably holds an **unconditional `can`** for the (action, subject) pair. Every other
 * outcome — no matching rule at all, only `cannot` rules, a revoked permission, a condition set
 * that cannot be expressed — is a **deny**. Until E13 the `null` result of `rulesToQuery` was
 * mapped to full access, which turned every prohibition-only policy into a grant (finding F7).
 */
export class FilterBuilder {
	/**
	 * What a deny looks like on both halves. `SearchService` reads `''` as deny as well; a
	 * never-matching filter is used instead so that the value is also a deny for a caller that
	 * only checks for `undefined`. Built fresh per call rather than shared, so no caller can hand
	 * the same `SQL` instance to two concurrent queries.
	 */
	private static deny(): { drizzleFilter: SQL; searchFilter: string } {
		return { drizzleFilter: sql`1=0`, searchFilter: 'ingestionSourceId = "-1"' };
	}

	public static async create(
		userId: string,
		resourceType: AppSubjects,
		action: AppActions
	): Promise<{
		drizzleFilter: SQL | undefined;
		searchFilter: string | undefined;
	}> {
		const iamService = new IamService();
		const ability = await iamService.getAbilityForUser(userId);

		const rules = ability.rulesFor(action, resourceType);

		// An unconditional `can` is the only ground for returning no filter at all. Note that a
		// rule carrying `conditions: {}` is *not* unconditional here: `{}` expresses no grant that
		// can be checked against a row, and treating it as one meant full access (finding F19).
		const hasUnconditionalCan = rules.some(
			(rule) => rule.inverted === false && !rule.conditions
		);
		// A `cannot` without conditions revokes the action outright. It carries no condition to
		// build an exclusion from, so it cannot be expressed as a filter — it can only deny
		// (finding F20). Previously such a rule was dropped and the principal got full access.
		const hasUnconditionalCannot = rules.some(
			(rule) => rule.inverted === true && !rule.conditions
		);
		const cannotConditions = rules
			.filter((rule) => rule.inverted === true && rule.conditions)
			.map((rule) => rule.conditions as object);

		if (hasUnconditionalCannot) {
			return FilterBuilder.deny();
		}

		if (hasUnconditionalCan && cannotConditions.length === 0) {
			return { drizzleFilter: undefined, searchFilter: undefined }; // Full access
		}
		let query = rulesToQuery(ability, action, resourceType, (rule) => rule.conditions);

		if (hasUnconditionalCan && cannotConditions.length > 0) {
			// A broad `can` narrowed by `cannot` rules: the filter is the conjunction of the
			// negation of every prohibition.
			//
			// The negation is formed at *query* level (`$not` around the whole condition) and not
			// by wrapping each condition value in `$ne`. Wrapping the value breaks as soon as the
			// value is itself an operator object: `{ $in: [...] }` became `{ $ne: { $in: [...] } }`,
			// which no translator understands -- Drizzle bound the operator object as a query
			// parameter and Meilisearch received the string `[object Object]`, so the exclusion the
			// policy author wrote did not happen (finding F8). `$not` composes with every operator
			// and both translators already implement it.
			query = { $and: cannotConditions.map((condition) => ({ $not: condition })) };
		}

		// `rulesToQuery` returns `null` when the rule list holds no non-inverted rule — no rule at
		// all, or only prohibitions. That is the *absence* of a permission, not a grant.
		if (query === null) {
			return FilterBuilder.deny();
		}

		if (Object.keys(query).length === 0) {
			return FilterBuilder.deny();
		}

		// Both translators are contractually fail-closed: they throw rather than drop a condition,
		// so `mongoToDrizzle` is typed to always return a predicate. The possibility of `undefined`
		// is kept in the local type on purpose -- it would silently lift the restriction for every
		// caller, so it is turned into a deny here instead of being trusted not to occur.
		const drizzleFilter: SQL | undefined = mongoToDrizzle(query);
		const searchFilter = await mongoToMeli(query);
		if (drizzleFilter === undefined) {
			return FilterBuilder.deny();
		}
		return { drizzleFilter, searchFilter };
	}
}
