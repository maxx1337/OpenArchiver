import { SQL, and, or, not, eq, gt, gte, lt, lte, inArray, isNull, sql } from 'drizzle-orm';

const camelToSnakeCase = (str: string) =>
	str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const relationToTableMap: Record<string, string> = {
	ingestionSource: 'ingestion_sources',
	// TBD: Add other relations here as needed
};

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

function getDrizzleColumn(key: string): SQL {
	const keyParts = key.split('.');
	if (keyParts.length > 1) {
		const relationName = keyParts[0];
		const columnName = camelToSnakeCase(keyParts[1]);
		const tableName = relationToTableMap[relationName];
		if (tableName) {
			return sql.raw(`"${tableName}"."${columnName}"`);
		}
	}
	return sql`${sql.identifier(camelToSnakeCase(key))}`;
}

export function mongoToDrizzle(query: Record<string, any>): SQL {
	if (typeof query !== 'object' || query === null || Array.isArray(query)) {
		refuse(`expected a condition object, got ${JSON.stringify(query)}`);
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
