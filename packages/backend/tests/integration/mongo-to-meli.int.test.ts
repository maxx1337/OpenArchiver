import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import { coverageNotice } from '@oa-test/notice';
import { acquireTestDatabase, loadBackendDatabaseSingleton } from '../support/pg-harness';
import { seedIngestionSource, seedUserWithoutRole } from '../support/iam-seed';

/**
 * JR-104 -- `helpers/mongoToMeli.ts` against a real database.
 *
 * `mongoToMeli` is not a pure translator. One branch queries `ingestion_sources`:
 *
 *     if (column === 'ingestionSource.userId') { ... select id from ingestion_sources where ... }
 *
 * That branch is the reason this helper could not be covered in JR-103 -- it imports
 * `../database` at module load, so it cannot even be collected without `DATABASE_URL`. Everything
 * below is about the boundary between the translator and that query.
 *
 * Classification: `ci`.
 */

const postgresProbe = await probePostgres();

const enabled = postgresProbe.available && isClassSelected('ci');
const harness = enabled ? await acquireTestDatabase('mongo-to-meli') : undefined;
if (harness) {
	harness.bindAsProcessDatabaseUrl();
	await loadBackendDatabaseSingleton();
}
const mongoToMeli = harness
	? (await import('../../src/helpers/mongoToMeli')).mongoToMeli
	: undefined;

/** `ingestionSourceId IN ["a", "b"]` -> ['a', 'b'] */
function parseInList(filter: string): string[] {
	const match = /IN \[(.*)\]/.exec(filter);
	if (!match) {
		throw new Error(`no IN list in filter: ${filter}`);
	}
	return match[1]!
		.split(',')
		.map((part) => part.trim().replace(/^"|"$/g, ''))
		.filter((part) => part.length > 0);
}

suiteRequiring('ci', 'mongoToMeli() against a real database (JR-104)', postgresProbe, () => {
	const translate = (query: Record<string, unknown>) => mongoToMeli!(query);
	const db = () => harness!.db;

	it('expands the ingestionSource.userId placeholder to the ids that exist', async () => {
		const ownerId = await seedUserWithoutRole(db(), 'meli-owner');
		const otherId = await seedUserWithoutRole(db(), 'meli-other');
		const first = await seedIngestionSource(db(), { userId: ownerId });
		const second = await seedIngestionSource(db(), { userId: ownerId });
		await seedIngestionSource(db(), { userId: otherId });

		const filter = await translate({ 'ingestionSource.userId': ownerId });

		// The translated attribute is `ingestionSourceId`, which *is* filterable on the email index
		// (services/SearchService.ts:476) -- unlike the untranslated key, see the finding below.
		expect(filter.startsWith('ingestionSourceId IN [')).toBe(true);
		expect(parseInList(filter).sort()).toEqual([first.id, second.id].sort());
	});

	it('emits an empty IN list when the user owns no source (fail-closed)', async () => {
		const lonelyId = await seedUserWithoutRole(db(), 'meli-lonely');
		const filter = await translate({ 'ingestionSource.userId': lonelyId });
		// `IN []` matches nothing in Meilisearch, which is the safe direction. Pinned because the
		// alternative -- emitting nothing at all -- would be an unfiltered search.
		expect(filter).toBe('ingestionSourceId IN []');
	});

	/**
	 * FINDING F9 (JR-104) -- the placeholder expansion depends on the *syntactic form* of the
	 * policy condition.
	 *
	 * The `ingestionSource.userId` special case sits in the `else` branch, i.e. it is only reached
	 * when the condition value is a scalar. Written in the equivalent explicit form,
	 * `{ 'ingestionSource.userId': { $eq: id } }`, the expansion is skipped and the filter names
	 * the attribute `ingestionSource.userId` -- which is not in `filterableAttributes`
	 * (services/SearchService.ts:476, which lists `from,to,cc,bcc,timestamp,ingestionSourceId,
	 * userEmail,hasAttachments`). Two ways of writing the same policy produce one working filter
	 * and one that the search engine cannot satisfy.
	 *
	 * Reported, not fixed. Whether Meilisearch rejects the filter or returns nothing is not
	 * verifiable here -- there is no Meilisearch in this environment; the assertion is on the
	 * emitted attribute name.
	 */
	it('FINDING F9: the $eq form skips the expansion and names a non-filterable attribute', async () => {
		coverageNotice(
			'FINDING F9 (JR-104): mongoToMeli() only expands the ingestionSource.userId placeholder ' +
				'for a scalar condition value. { $eq: id } skips it and emits the attribute ' +
				'"ingestionSource.userId", which is not among the Meilisearch filterableAttributes ' +
				'(SearchService.ts:476). Whether the engine errors or silently matches nothing is NOT ' +
				'verified here -- no Meilisearch in this environment.'
		);
		const ownerId = await seedUserWithoutRole(db(), 'meli-eq');
		await seedIngestionSource(db(), { userId: ownerId });

		const scalarForm = await translate({ 'ingestionSource.userId': ownerId });
		const eqForm = await translate({ 'ingestionSource.userId': { $eq: ownerId } });

		expect(scalarForm.startsWith('ingestionSourceId IN [')).toBe(true);
		expect(eqForm).toBe(`ingestionSource.userId = "${ownerId}"`);
	});

	/**
	 * FINDING F10 (JR-104) -- the expanded IN list has no deterministic order.
	 *
	 * The lookup is `select id from ingestion_sources where user_id = ...` with no `order by`, so
	 * Postgres may return the ids in any order. The produced filter string is therefore not stable
	 * for the same inputs. Low severity today (Meilisearch does not care about the order inside
	 * `IN [...]`), but it makes the function unusable as a cache key and breaks any golden-file
	 * comparison of a filter string -- which is exactly what this project's canonical-encoding
	 * tests (JR-202) rely on elsewhere.
	 */
	it('FINDING F10: the expanded IN list is not ordered', async () => {
		coverageNotice(
			'FINDING F10 (JR-104): mongoToMeli() builds the ingestionSourceId IN [...] list from a ' +
				'query without ORDER BY, so the emitted filter string is not deterministic. Asserted ' +
				'as a set, not a sequence.'
		);
		const ownerId = await seedUserWithoutRole(db(), 'meli-ord');
		const ids: string[] = [];
		for (let index = 0; index < 5; index += 1) {
			ids.push((await seedIngestionSource(db(), { userId: ownerId })).id);
		}
		const filter = await translate({ 'ingestionSource.userId': ownerId });
		expect(parseInList(filter).sort()).toEqual([...ids].sort());
		// The helper contains no ordering at all -- pinned so the finding cannot be closed by
		// accident while the set assertion above keeps passing.
		const source = readFileSync(
			new URL('../../src/helpers/mongoToMeli.ts', import.meta.url),
			'utf8'
		);
		expect(/order\s*by|orderBy/i.test(source)).toBe(false);
	});

	it('throws on an unsupported operator instead of dropping the clause', async () => {
		// The deliberate contrast with mongoToDrizzle (FINDING F3): here an untranslatable operator
		// is loud. FilterBuilder's overall fail-closed behaviour rests on this.
		await expect(translate({ subject: { $regex: 'x' } })).rejects.toThrow(
			/unsupported operator "\$regex"/
		);
		await expect(
			translate({ $or: [{ id: 'a' }, { subject: { $regex: 'x' } }] })
		).rejects.toThrow(/unsupported operator "\$regex"/);
	});

	it('escapes quotes and backslashes in values so a value cannot inject an operator', async () => {
		expect(await translate({ userEmail: 'a"b' })).toBe('userEmail = "a\\"b"');
		expect(await translate({ userEmail: 'a\\b' })).toBe('userEmail = "a\\\\b"');
		expect(await translate({ userEmail: 'x" OR userEmail = "y' })).toBe(
			'userEmail = "x\\" OR userEmail = \\"y"'
		);
	});

	it('composes $and, $or and $not with parentheses', async () => {
		expect(await translate({ $or: [{ userEmail: 'a' }, { userEmail: 'b' }] })).toBe(
			'(userEmail = "a" OR userEmail = "b")'
		);
		expect(await translate({ $and: [{ userEmail: 'a' }, { hasAttachments: true }] })).toBe(
			'(userEmail = "a" AND hasAttachments = true)'
		);
		expect(await translate({ $not: { userEmail: 'a' } })).toBe('NOT (userEmail = "a")');
	});

	it('maps the comparison operators to Meilisearch syntax', async () => {
		expect(await translate({ timestamp: { $gte: 100 } })).toBe('timestamp >= 100');
		expect(await translate({ timestamp: { $lt: 100 } })).toBe('timestamp < 100');
		expect(await translate({ userEmail: { $ne: 'a' } })).toBe('userEmail != "a"');
		expect(await translate({ userEmail: { $in: ['a', 'b'] } })).toBe('userEmail IN ["a", "b"]');
		expect(await translate({ userEmail: { $nin: ['a'] } })).toBe('userEmail NOT IN ["a"]');
		expect(await translate({ userEmail: { $exists: true } })).toBe('userEmail EXISTS');
		expect(await translate({ userEmail: { $exists: false } })).toBe('userEmail NOT EXISTS');
	});

	it('drops all but the first operator of a multi-operator condition (F4, search side)', async () => {
		coverageNotice(
			'FINDING F4 also applies to mongoToMeli(), not only to mongoToDrizzle(): only ' +
				'Object.keys(value)[0] is read, so the second bound of a range condition is lost on ' +
				'the search path as well.'
		);
		// F4 in 09-befunde-bestandscode.md was reported against mongoToDrizzle. The search
		// translator has the identical shape, so a range-limiting policy loses its upper bound here
		// too. Pinned; not fixed.
		expect(await translate({ timestamp: { $gte: 1, $lte: 5 } })).toBe('timestamp >= 1');
	});

	it('returns an empty string for an empty query (fail-open on the search path)', async () => {
		// An empty filter string means "no filter" to SearchService. Same fail-open shape as F3.
		expect(await translate({})).toBe('');
	});
});
