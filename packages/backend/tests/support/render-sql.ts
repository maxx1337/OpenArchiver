import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

/**
 * Render a drizzle `SQL` fragment to its parameterised text plus bound parameters.
 *
 * `PgDialect.sqlToQuery` is pure -- it needs no connection, which is what makes
 * `helpers/mongoToDrizzle.ts` unit-testable in an environment without Postgres.
 *
 * Asserting on the rendered text *and* the parameter list is deliberate: it catches an operator
 * silently mapping to the wrong comparison, and it catches a value being interpolated into the
 * statement text instead of being bound as a parameter.
 */

const dialect = new PgDialect();

export interface RenderedSql {
	sql: string;
	params: unknown[];
}

export function renderSql(fragment: SQL | undefined): RenderedSql | undefined {
	if (fragment === undefined) {
		return undefined;
	}
	const { sql, params } = dialect.sqlToQuery(fragment);
	return { sql, params };
}

/** Same as `renderSql`, but fails loudly instead of returning `undefined`. */
export function renderSqlOrThrow(fragment: SQL | undefined): RenderedSql {
	const rendered = renderSql(fragment);
	if (!rendered) {
		throw new Error('Expected a SQL fragment, got undefined.');
	}
	return rendered;
}
