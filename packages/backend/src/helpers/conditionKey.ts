/**
 * The single decision about what a policy `conditions` object, and a key inside it, may look like.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this is its own module
 * ---------------------------------------------------------------------------------------------
 * Two gates have to reach the *same* verdict about a condition key: `PolicyValidator`, which
 * refuses a policy before it is stored (`iam.controller.ts` turns a refusal into HTTP 400), and
 * `mongoToDrizzle`, which refuses it again at query time. When each gate carried its own copy of
 * the rule they drifted apart: the validator accepted any number of dot-separated segments and any
 * relation prefix, while the translator accepted at most two segments and only a relation it can
 * resolve. A key such as `foo.bar` was therefore saved with HTTP 200 and made every scoped query of
 * that role fail afterwards -- fail-closed, but the operator was told the opposite by the upgrade
 * guide, which documents a refusal at save time.
 *
 * Neither existing home works for the shared rule:
 *
 *   - `PolicyValidator` cannot import `mongoToDrizzle`: that would pull `drizzle-orm` into a class
 *     which today imports nothing but types, and with it into every unit test that validates a
 *     policy.
 *   - `mongoToDrizzle` cannot import `PolicyValidator`: a SQL translator has no business depending
 *     on the IAM policy module, and `relationToTableMap` -- the data the rule needs -- belongs next
 *     to the code that renders a table name.
 *
 * So the rule lives here: a module that imports **nothing**, next to the translator whose column
 * vocabulary it describes. Both gates import it, so there is one predicate and one source.
 *
 * ---------------------------------------------------------------------------------------------
 * What is checked, and what deliberately is not
 * ---------------------------------------------------------------------------------------------
 * Checked: the *form* of a key (one identifier, or `<relation>.<identifier>` with a relation that
 * resolves), and the *shape* of `conditions` itself (an object, or absent).
 *
 * Not checked: whether the column a key names exists. That check needs the subject the filter is
 * applied to -- the same policy statement can be written for several subjects, and the column set
 * depends on the subject -- so it belongs where the subject is known, not here. A single unknown
 * but identifier-shaped key such as `foo` therefore still passes both gates and fails at the
 * database. That gap is a deliberate decision, not an oversight.
 *
 * Also not checked: operator names. `$regex` passes this module and is refused by the translators,
 * which is on purpose -- the SQL and the search translator support different operator sets, so
 * there is no single operator allowlist a save-time gate could agree with.
 */

/**
 * Relations a two-part condition key may name, mapped to the table they resolve to.
 *
 * A prefix that is not in this map is refused rather than rendered: rendering it produced a column
 * reference that names nothing, so every query scoped by the policy failed instead of denying
 * access.
 */
export const relationToTableMap: Record<string, string> = {
	ingestionSource: 'ingestion_sources',
	// TBD: Add other relations here as needed
};

/**
 * The shape a key segment has to have before it may become part of a column reference.
 *
 * Escaping was not an option: drizzle's Postgres dialect renders an identifier as `` `"${name}"` ``
 * without doubling an embedded double quote (`pg-core/dialect.js`), and the relation branch used
 * `sql.raw`, which escapes nothing at all. A condition key containing a `"` therefore wrote raw SQL
 * into the `WHERE` clause of every scoped query. Escaping the quote would close the injection but
 * would name a column that does not exist, so every scoped query would fail at runtime instead of
 * denying access. An allowlist is the stronger answer: an unknown key is a policy error, and a
 * policy error belongs fail-closed.
 */
const CONDITION_KEY_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A MongoDB-style operator key (`$or`, `$in`, ...). Never rendered as an identifier. */
const CONDITION_OPERATOR_KEY = /^\$[A-Za-z][A-Za-z0-9]*$/;

/** A key that addresses an operator rather than a column, and is recursed into instead of rendered. */
export function isConditionOperatorKey(key: string): boolean {
	return key.startsWith('$') && CONDITION_OPERATOR_KEY.test(key);
}

/**
 * The verdict on a condition key, with the parts a caller needs to render it.
 *
 * `table` is `null` for a single-segment key: the table is then the one the filter is applied to,
 * which this module does not know. `column` is the last segment verbatim -- naming conventions
 * differ between the SQL translator (snake_case) and the search translator (camelCase), so the
 * conversion stays with the caller.
 */
export type ConditionKeyResolution =
	| { valid: true; table: string | null; column: string }
	| { valid: false; reason: string };

/**
 * Decides whether a condition key may become a column reference, and resolves its parts.
 *
 * This is the predicate both gates use. A caller that only wants the yes/no answer reads `.valid`;
 * a caller that renders SQL reads `table` and `column` and never re-parses the key itself.
 */
export function resolveConditionKey(key: string): ConditionKeyResolution {
	const segments = key.split('.');

	if (segments.length > 2) {
		return {
			valid: false,
			reason:
				`condition key ${JSON.stringify(key)} is not a column reference: a key has at ` +
				`most two dot-separated parts, a column name optionally prefixed by a relation`,
		};
	}

	if (!segments.every((segment) => CONDITION_KEY_SEGMENT.test(segment))) {
		return {
			valid: false,
			reason: `condition key ${JSON.stringify(key)} is not a column reference`,
		};
	}

	if (segments.length === 2) {
		const [relationName, columnKey] = segments;
		const tableName = relationToTableMap[relationName];
		if (!tableName) {
			return {
				valid: false,
				reason:
					`condition key ${JSON.stringify(key)} names the relation ` +
					`${JSON.stringify(relationName)}, which is not resolvable. Resolvable ` +
					`relations: ${Object.keys(relationToTableMap).join(', ')}`,
			};
		}
		return { valid: true, table: tableName, column: columnKey };
	}

	return { valid: true, table: null, column: key };
}

/** The verdict on a whole `conditions` node. */
export type ConditionsShapeResult = { valid: true } | { valid: false; reason: string };

/**
 * Decides whether a `conditions` node is a node of condition keys at all.
 *
 * A scalar, an array or `null` states no condition that can be checked against a row, and the two
 * readings it invited were both wrong: a falsy value read as "no condition, grant everything", a
 * truthy scalar read as a condition and then refused at query time. Neither is what an operator who
 * wrote such a policy meant. It is refused before it is stored.
 *
 * `undefined` is *absent*, not malformed: a policy may legitimately carry no condition, and
 * `JSON.stringify` drops an explicit `undefined` anyway, so the two cannot be told apart once the
 * policy has been round-tripped through the database.
 */
export function checkConditionsShape(conditions: unknown): ConditionsShapeResult {
	if (conditions === undefined) {
		return { valid: true };
	}
	if (typeof conditions !== 'object' || conditions === null || Array.isArray(conditions)) {
		return {
			valid: false,
			reason:
				`"conditions" must be an object of condition keys, or absent. Got ` +
				`${JSON.stringify(conditions) ?? 'undefined'} ` +
				`(${conditions === null ? 'null' : Array.isArray(conditions) ? 'array' : typeof conditions}), ` +
				`which states no condition that can be checked against a row.`,
		};
	}
	return { valid: true };
}
