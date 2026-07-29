import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { suite } from '@oa-test/classification';
import { coverageNotice } from '@oa-test/notice';
import { redUntil } from '../support/fail-closed';

/**
 * ADR-017 / `JR-1303` regression -- which (action, subject) each `FilterBuilder.create()` call site
 * uses (JR-1301, epic E13).
 *
 * Classification: `ci`. Reads source text; imports nothing from `src/`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this is a source-level test and not a behavioural one
 * ---------------------------------------------------------------------------------------------
 * ADR-017 decided variant B: `SearchService.ts:311` and `:423` must build their row-level filter
 * for the action the route actually authorised, `('archive', 'search')`, while
 * `api/routes/search.routes.ts` stays unchanged. The behavioural consequence -- "a role with a
 * *conditional* `search archive` gets a filter derived from its `search` rules" -- is asserted
 * against real Postgres in `tests/integration/filter-builder-f7.int.test.ts`. What that test
 * cannot observe is whether `SearchService` *asks* for `'search'`, because reaching
 * `SearchService.searchEmails()` or `.searchFacetValues()` needs a Meilisearch index.
 *
 * **Two limits are stated rather than worked around**, because working around them would cost more
 * than the coverage is worth in this task:
 *
 *   1. There is no Meilisearch in this environment (`docs/dev/journaling/07-session-handover.md`,
 *      pitfall list). A live-search assertion is not available.
 *   2. Importing `SearchService` is not free either: it pulls in `IngestionService` ->
 *      `jobs/queues.ts`, which constructs three BullMQ `Queue` objects at module load, and each
 *      opens an ioredis connection. There is no Redis here, so the import would leave retrying
 *      handles in the worker. That is why this file reads the source instead of importing it, and
 *      why a stubbed-client test was not written.
 *
 * A regex over source text is a weak instrument, so this file also asserts that the *inventory* of
 * call sites is exactly the four ADR-017 enumerates. A fifth call site appearing anywhere under
 * `src/` fails this test rather than sliding past it -- which is also `JR-1303`'s own acceptance
 * criterion ("kein weiterer `FilterBuilder`-Aufruf und kein Route-Gate angefasst").
 */

const BACKEND_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

/** Every `.ts` file under `packages/backend/src`, repository-package relative. */
function listSourceFiles(dir: string, relative = ''): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const rel = relative ? `${relative}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name === 'migrations') {
				continue;
			}
			found.push(...listSourceFiles(path.join(dir, entry.name), rel));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
			found.push(rel);
		}
	}
	return found;
}

interface CallSite {
	file: string;
	line: number;
	subject: string;
	action: string;
	text: string;
}

const CALL_SITE = /FilterBuilder\.create\(\s*([^,]+?)\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/;

function collectCallSites(): CallSite[] {
	const sites: CallSite[] = [];
	for (const file of listSourceFiles(BACKEND_SRC)) {
		const contents = readFileSync(path.join(BACKEND_SRC, file), 'utf8');
		if (!contents.includes('FilterBuilder.create')) {
			continue;
		}
		contents.split('\n').forEach((text, index) => {
			const match = CALL_SITE.exec(text);
			if (match) {
				sites.push({
					file,
					line: index + 1,
					subject: match[2]!,
					action: match[3]!,
					text: text.trim(),
				});
				return;
			}
			if (text.includes('FilterBuilder.create')) {
				// A call whose arguments this regex cannot read is not silently ignored: it would
				// otherwise be a call site outside the inventory below.
				sites.push({
					file,
					line: index + 1,
					subject: '<unparsed>',
					action: '<unparsed>',
					text: text.trim(),
				});
			}
		});
	}
	return sites;
}

/**
 * The four call sites ADR-017 enumerates, with the action each must use *after* `JR-1303`.
 * `SearchService` is the only one that changes.
 */
const EXPECTED_CALL_SITES: ReadonlyArray<{
	file: string;
	subject: string;
	action: string;
	why: string;
}> = [
	{
		file: 'services/SearchService.ts',
		subject: 'archive',
		action: 'search',
		why: "ADR-017 variant B: GET /search gates on requirePermission('search','archive')",
	},
	{
		file: 'services/SearchService.ts',
		subject: 'archive',
		action: 'search',
		why: "ADR-017 variant B: GET /search/facets gates on requirePermission('search','archive')",
	},
	{
		file: 'services/ArchivedEmailService.ts',
		subject: 'archive',
		action: 'read',
		why: "its routes gate on requirePermission('read','archive') -- unchanged by ADR-017",
	},
	{
		file: 'services/IngestionService.ts',
		subject: 'ingestion',
		action: 'read',
		why: "subject 'ingestion', no offset -- unchanged by ADR-017",
	},
];

suite('ci', 'FilterBuilder.create() call-site inventory (ADR-017, JR-1303)', () => {
	const sites = collectCallSites();

	it('finds exactly the four call sites ADR-017 enumerates', () => {
		coverageNotice(
			'ADR-017 wiring (JR-1301) is asserted on the SOURCE TEXT of SearchService.ts, not on a ' +
				'live search: there is no Meilisearch in this environment, and importing ' +
				'SearchService constructs three BullMQ queues against a Redis that is not there. ' +
				'The behavioural half -- a conditional `search archive` rule producing a scoped ' +
				'filter -- is covered in tests/integration/filter-builder-f7.int.test.ts.'
		);
		const listed = sites.map((site) => `${site.file}:${site.line} ${site.text}`);
		expect(
			sites.length,
			`expected 4 FilterBuilder.create() call sites, found ${sites.length}:\n${listed.join('\n')}\n` +
				`ADR-017 enumerates exactly four. A new call site has to be added to EXPECTED_CALL_SITES ` +
				`here and to ADR-017, deliberately.`
		).toBe(EXPECTED_CALL_SITES.length);
		expect(
			sites.filter((site) => site.action === '<unparsed>'),
			'a FilterBuilder.create() call whose action could not be read from the source'
		).toEqual([]);
	});

	it('leaves ArchivedEmailService and IngestionService on their current actions', () => {
		// Green before and after JR-1303. This is the "nothing else moved" half of its criteria.
		const unchanged = EXPECTED_CALL_SITES.filter(
			(expected) => expected.file !== 'services/SearchService.ts'
		);
		for (const expected of unchanged) {
			const found = sites.find((site) => site.file === expected.file);
			expect(found, `no FilterBuilder.create() call site in ${expected.file}`).toBeDefined();
			expect(
				{ subject: found!.subject, action: found!.action },
				`${expected.file} (${expected.why})`
			).toEqual({ subject: expected.subject, action: expected.action });
		}
	});

	it(
		redUntil(
			'JR-1303',
			"both SearchService call sites build their filter for ('archive','search')"
		),
		() => {
			const searchSites = sites.filter((site) => site.file === 'services/SearchService.ts');
			expect(
				searchSites.length,
				'SearchService.ts must contain exactly the two call sites named in ADR-017'
			).toBe(2);
			for (const site of searchSites) {
				expect(
					{ subject: site.subject, action: site.action },
					`services/SearchService.ts:${site.line} -- ADR-017 variant B requires the filter ` +
						`to be built for the action the route authorised. The route gate is ` +
						`requirePermission('search','archive') (api/routes/search.routes.ts:158 and ` +
						`:211); building the filter for 'read' is the offset that makes F7 reachable ` +
						`through the search endpoint. Line reads: ${site.text}`
				).toEqual({ subject: 'archive', action: 'search' });
			}
		}
	);

	it('the two search route gates are untouched', () => {
		// ADR-017 explicitly rejected variant A (gating the search routes on `read` as well), so
		// this test protects the *absence* of a change. Green before and after JR-1303.
		const routes = readFileSync(path.join(BACKEND_SRC, 'api/routes/search.routes.ts'), 'utf8');
		const gates = routes
			.split('\n')
			.map((line, index) => ({ line: index + 1, text: line.trim() }))
			.filter((entry) => entry.text.includes('requirePermission('));
		expect(gates.map((entry) => entry.text)).toEqual([
			"router.get('/', requirePermission('search', 'archive'), searchController.search);",
			"router.get('/facets', requirePermission('search', 'archive'), searchController.facets);",
		]);
	});
});
