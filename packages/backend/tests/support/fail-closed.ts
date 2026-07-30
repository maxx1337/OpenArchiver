import { expect } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { renderSql, type RenderedSql } from './render-sql';

/**
 * Shared fail-closed contract assertions (JR-1301, epic E13).
 *
 * ---------------------------------------------------------------------------------------------
 * Why a helper and not an inline `expect`
 * ---------------------------------------------------------------------------------------------
 * E13 fixes four findings (F1, F3, F7, F8) whose common shape is the same: a value that means
 * "no restriction" is produced where "no permission" was meant. The regression tests for all four
 * therefore assert the *same* property, and it must be worded identically everywhere, or a later
 * reader cannot tell whether two tests demand the same thing.
 *
 * ---------------------------------------------------------------------------------------------
 * What "fail closed" is allowed to look like
 * ---------------------------------------------------------------------------------------------
 * The tests must not dictate the implementation the senior developer picks in
 * `JR-1302`/`JR-1304`/`JR-1305`/`JR-1306`. Two outcomes are therefore both accepted:
 *
 *   1. **Rejection** -- the call throws / the promise rejects. Loud, and the recommendation in
 *      `09-befunde-bestandscode.md` for F3 ("laut scheitern lassen").
 *   2. **A never-true predicate** -- `1=0` or `false`, i.e. what the already-existing "No access"
 *      branch in `FilterBuilder.create()` returns for an empty query, and what
 *      `mongoToDrizzle({ id: { $in: [] } })` already returns today.
 *
 * Exactly one outcome is *not* accepted, and it is today's: `undefined`. For every caller of
 * `FilterBuilder` (`ArchivedEmailService.ts:62`, `SearchService.ts:311`/`:423`,
 * `IngestionService.ts:137`) `undefined` means "do not restrict this query". Anything that renders
 * to a predicate which is not never-true is likewise rejected -- that is F3's silently widened `$or`.
 *
 * The recognised deny renderings are listed here rather than probed, because a predicate that is
 * "never true" cannot be decided from its text in general. If a fix produces a *different* deny
 * predicate, this list is the one place to extend -- and extending it is a visible diff, not a
 * silent relaxation.
 */

/** Renderings that are never true for any row, i.e. legitimate deny filters. */
const DENY_RENDERINGS = [/^1\s*=\s*0$/i, /^false$/i];

export function isDenyRendering(rendered: RenderedSql | undefined): boolean {
	if (!rendered) {
		return false;
	}
	return DENY_RENDERINGS.some((pattern) => pattern.test(rendered.sql.trim()));
}

export type FailClosedOutcome =
	| { kind: 'threw'; error: unknown }
	| { kind: 'deny'; rendered: RenderedSql }
	| { kind: 'unrestricted' }
	| { kind: 'permissive'; rendered: RenderedSql };

/** Classify what a synchronous filter producer did, without asserting anything yet. */
export function classifyFilter(produce: () => SQL | undefined): FailClosedOutcome {
	let fragment: SQL | undefined;
	try {
		fragment = produce();
	} catch (error) {
		return { kind: 'threw', error };
	}
	const rendered = renderSql(fragment);
	if (!rendered) {
		return { kind: 'unrestricted' };
	}
	return isDenyRendering(rendered)
		? { kind: 'deny', rendered }
		: { kind: 'permissive', rendered };
}

/**
 * Demand that a translator refuses an input instead of dropping the condition.
 *
 * `context` is quoted verbatim in the failure message, so a red run says *which* policy shape is
 * still fail-open without the reader having to open the test.
 */
export function expectFailClosed(context: string, produce: () => SQL | undefined): void {
	const outcome = classifyFilter(produce);
	if (outcome.kind === 'threw' || outcome.kind === 'deny') {
		return;
	}
	const observed =
		outcome.kind === 'unrestricted'
			? 'returned undefined (= no filter = every row visible)'
			: `returned the predicate ${JSON.stringify(outcome.rendered.sql)} with params ` +
				`${JSON.stringify(outcome.rendered.params)}, which is not a never-true predicate`;
	expect.fail(
		`Fail-closed contract violated for ${context}: ${observed}. ` +
			`An untranslatable or unsafe policy condition must either be rejected (throw) or ` +
			`produce a never-true predicate (1=0 / false). "undefined" is read as "no restriction" ` +
			`by every FilterBuilder caller. See docs/dev/journaling/09-befunde-bestandscode.md F1/F3 ` +
			`and backlog tasks JR-1304 / JR-1306.`
	);
}

/**
 * The search half of the same contract.
 *
 * `SearchService` reads the value as: `undefined` => full access, `''` => deny (it substitutes
 * `ingestionSourceId = "-1"`, see SearchService.ts:313 and :426). So `''` is acceptable and
 * `undefined` is not.
 */
export function expectSearchFilterDenies(context: string, searchFilter: string | undefined): void {
	if (searchFilter === undefined) {
		expect.fail(
			`Fail-closed contract violated for ${context}: searchFilter is undefined. ` +
				`SearchService.ts:313 / :426 treat undefined as full access and only '' or an explicit ` +
				`never-matching filter as deny.`
		);
	}
	if (searchFilter !== '' && !/ingestionSourceId\s*=\s*"-1"/.test(searchFilter)) {
		expect.fail(
			`Fail-closed contract violated for ${context}: searchFilter is ` +
				`${JSON.stringify(searchFilter)}, which is neither '' nor a never-matching filter. ` +
				`A deny must not be expressible as a filter that some document can satisfy.`
		);
	}
}

/**
 * Title prefix for a test that is expected to be red until a specific backlog task lands.
 *
 * There is deliberately **no** switch that turns these tests green, skips them or inverts them.
 * `JR-1301`'s acceptance criterion is "red before the fix, green after the fix, both logged"; any
 * opt-out would be a lever for making the epic look finished while the defect is open, and the
 * previous generation of these tests failed exactly by asserting the defect as if it were correct.
 * Vitest already gives the isolation that is actually needed: a failing test fails its own case,
 * the other files in the run still execute and still report.
 */
export function redUntil(task: string, title: string): string {
	return `RED UNTIL ${task}: ${title}`;
}
