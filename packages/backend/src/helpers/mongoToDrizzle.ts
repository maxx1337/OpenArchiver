import { SQL, and, or, not, eq, gt, gte, lt, lte, inArray, isNull, sql } from 'drizzle-orm';
import { checkConditionsShape, resolveConditionKey } from './conditionKey';

const camelToSnakeCase = (str: string) =>
	str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/**
 * Refuse to translate.
 *
 * This helper turns the MongoDB-syntax `conditions` of an IAM policy into a SQL predicate, so its
 * output is a row-level access control decision. Dropping a condition it cannot express does not
 * produce a wrong filter, it produces **no** filter — and `FilterBuilder`'s callers read the
 * absence of a filter as "do not restrict this query". Every untranslatable input is therefore
 * refused loudly, the way `mongoToMeli` already refuses an unknown operator.
 */
function refuse(reason: string): never {
	throw new Error(`mongoToDrizzle: ${reason}`);
}

/**
 * Turns a condition key into a column reference, or refuses it.
 *
 * The decision itself is **not** made here: `resolveConditionKey()` in `./conditionKey` owns it, and
 * `PolicyValidator` asks the same function before the policy is ever stored. Keeping the rule in one
 * place is the point -- when each gate carried its own copy, the validator accepted `foo.bar` and
 * this translator refused it, so a broken policy was saved with HTTP 200 and only failed later.
 */
function getDrizzleColumn(key: string): SQL {
	const resolution = resolveConditionKey(key);
	if (!resolution.valid) {
		refuse(resolution.reason);
	}

	// `sql.identifier` on both halves rather than `sql.raw` on the whole thing: the table name comes
	// from the relation map, the column name has passed the allowlist, and neither is interpolated
	// as raw SQL any more.
	const column = sql`${sql.identifier(camelToSnakeCase(resolution.column))}`;
	if (resolution.table === null) {
		return column;
	}
	return sql`${sql.identifier(resolution.table)}.${column}`;
}

export function mongoToDrizzle(query: Record<string, any>): SQL {
	const shape = checkConditionsShape(query);
	if (!shape.valid) {
		refuse(shape.reason);
	}
	if (query === undefined) {
		// `checkConditionsShape` reads `undefined` as "no condition at all", which is a legitimate
		// policy but not something this function can translate: an absent filter means "do not
		// restrict".
		refuse('expected a condition object, got undefined');
	}

	const conditions: SQL[] = [];

	for (const key in query) {
		const value = query[key];

		if (key === '$or' || key === '$and') {
			if (!Array.isArray(value)) {
				refuse(`"${key}" expects an array of branches, got ${JSON.stringify(value)}`);
			}
			if (value.length === 0) {
				// An empty disjunction is satisfied by nothing and an empty conjunction restricts
				// nothing; either way "no branches" must not become "no filter".
				refuse(`"${key}" has no branches`);
			}
			// No `.filter(Boolean)`: a branch that cannot be translated makes the whole condition
			// untranslatable. Dropping one branch of an `$or` narrows the permission the policy
			// author wrote (finding F22), and dropping one branch of the `$and` that
			// `FilterBuilder` builds from `cannot` rules drops a prohibition outright.
			const branches = value.map((branch) => mongoToDrizzle(branch));
			const combined = key === '$or' ? or(...branches) : and(...branches);
			if (combined === undefined) {
				refuse(`"${key}" produced no predicate`);
			}
			conditions.push(combined);
			continue;
		}

		if (key === '$not') {
			// The negation is never optional: losing it turns a deny into an allow.
			conditions.push(not(mongoToDrizzle(value)));
			continue;
		}

		const column = getDrizzleColumn(key);

		if (typeof value === 'object' && value !== null) {
			// Only the first operator is read. That loses the second bound of a range condition
			// (finding F4) and is deliberately left as it is: it is outside E13's scope.
			const operator = Object.keys(value)[0];
			const operand = value[operator];

			switch (operator) {
				case '$eq':
					conditions.push(eq(column, operand));
					break;
				case '$ne':
					conditions.push(not(eq(column, operand)));
					break;
				case '$gt':
					conditions.push(gt(column, operand));
					break;
				case '$gte':
					conditions.push(gte(column, operand));
					break;
				case '$lt':
					conditions.push(lt(column, operand));
					break;
				case '$lte':
					conditions.push(lte(column, operand));
					break;
				case '$in':
					conditions.push(inArray(column, operand));
					break;
				case '$nin':
					conditions.push(not(inArray(column, operand)));
					break;
				case '$exists':
					conditions.push(operand ? not(isNull(column)) : isNull(column));
					break;
				default:
					refuse(
						`unsupported operator ${JSON.stringify(operator)} on condition key ` +
							`${JSON.stringify(key)}`
					);
			}
		} else {
			// A literal `null` value renders as `= NULL`, not `IS NULL`, so the comparison is never
			// true and the condition matches nothing (finding F5). Deliberately left as it is: it is
			// outside E13's scope, and it is held in place by the golden pin "literal null becomes
			// = NULL, not IS NULL" so that a change to it cannot pass unnoticed.
			conditions.push(eq(column, value));
		}
	}

	if (conditions.length === 0) {
		refuse('the condition object is empty and therefore places no restriction on the query');
	}

	const combined = and(...conditions);
	if (combined === undefined) {
		refuse('the condition object produced no predicate');
	}
	return combined;
}
