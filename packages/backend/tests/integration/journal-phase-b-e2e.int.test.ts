import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probeMeilisearch, probePostgres } from '@oa-test/infra';
import { coverageNotice } from '@oa-test/notice';
import {
	PostgresLedgerLookup,
	PostgresLedgerWriter,
	generateTxId,
	incomingFilePath,
	runPhaseBPipeline,
	type LedgerAppendRequest,
	type PhaseBPipelineResult,
} from '@open-archiver/journaling';
import type { PendingEmail } from '@open-archiver/types';
import { acquireTestDatabase, loadBackendDatabaseSingleton } from '../support/pg-harness';
import { seedIngestionSource, seedJournalingSource } from '../support/iam-seed';
import { postgresTransactor } from '../support/postgres-transactor';
import {
	createLedgerQuery,
	openBareLedgerConnection,
} from '../../src/jobs/processors/journal-ledger-query-adapter';

/**
 * The Phase-B pipeline end-to-end, against real Postgres and real Meilisearch (`JR-6-02b`, ADR-035,
 * backlog acceptance criterion of `JR-6-02`/`JR-6-08`). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this exists on top of `pipeline.test.ts` and `journal-inbound-worker.int.test.ts`
 * ---------------------------------------------------------------------------------------------
 * `pipeline.test.ts` proves the orchestration logic against hand-written fakes -- correct call
 * order, correct error handling, correct fan-out. `journal-inbound-worker.int.test.ts` proves the
 * *process* starts, binds the queue, and fails a job it cannot honestly complete. Neither proves
 * that the real adapters, wired to real `IngestionService`/`StorageService`/`SearchService` and a
 * real Postgres database, actually turn a spool file into a message a person could find. A manual
 * run proved that once (`docs/dev/journaling/05-entscheidungen.md` ADR-034 point 6); this is that
 * same run, made repeatable and made to fail when a link in the chain breaks.
 *
 * ---------------------------------------------------------------------------------------------
 * Why the real backend services need the harness's dynamic-import dance (ADR-035)
 * ---------------------------------------------------------------------------------------------
 * `IngestionService`/`DatabaseService`/the two new Phase-B backend adapters all import
 * `packages/backend/src/database`'s singleton `db`, built once at import time from
 * `process.env.DATABASE_URL`. `acquireTestDatabase()`'s isolated, migrated database is a
 * *different* database from that variable's original value (the CI job's unmigrated maintenance
 * database, F63) -- so proving this end-to-end against real services means pointing that singleton
 * at the isolated database *before* anything imports it. `bindAsProcessDatabaseUrl()` plus a
 * dynamic `import()` deferred until after it runs is the existing, already-used mechanism for
 * exactly this (`filter-builder.int.test.ts`, `mongo-to-meli.int.test.ts`,
 * `predefined-roles.int.test.ts`) -- ADR-035 chose reusing it over either widening
 * `IngestionService`/`StorageService` with an injected database parameter (a broad refactor of an
 * already-accepted epic's code for one test file) or a documented exception to the harness's own
 * isolation principle (a permanent weakening of every future integration test's guarantee, not just
 * this one).
 *
 * `journal-ledger-query-adapter.ts` is different: it imports `postgres` directly, not
 * `src/database`, so it is safe to import statically and simply call after binding -- by then
 * `process.env.DATABASE_URL` already names the isolated database.
 *
 * ---------------------------------------------------------------------------------------------
 * Why the assertions filter by `ingestionSourceId` rather than counting raw search hits
 * ---------------------------------------------------------------------------------------------
 * The Meilisearch `emails` index is not isolated per test file the way the database is -- there is
 * exactly one index, shared with every other real run against this Meilisearch instance (locally;
 * fresh in CI, whose service container carries no prior state). Asserting "the search for X returns
 * 3 hits" would be true today and false the moment anything else indexes a document containing the
 * same fixture text. Every assertion here scopes by this run's own `ingestionSourceId`, and
 * `afterAll` deletes the documents it created -- the same discipline `seedIngestionSource()` already
 * uses for Postgres rows (randomised names, cheap cleanup).
 */

const postgresProbe = await probePostgres();
const meiliProbe = await probeMeilisearch();
const requirement = !postgresProbe.available ? postgresProbe : meiliProbe;
const enabled = requirement.available && isClassSelected('ci');

const harness = enabled ? await acquireTestDatabase('phase-b-e2e') : undefined;
if (harness) {
	harness.bindAsProcessDatabaseUrl();
	await loadBackendDatabaseSingleton();
}

// Deferred until after the bind above -- see the module doc comment.
const IngestionService = harness
	? (await import('../../src/services/IngestionService')).IngestionService
	: undefined;
const StorageService = harness
	? (await import('../../src/services/StorageService')).StorageService
	: undefined;
const SearchService = harness
	? (await import('../../src/services/SearchService')).SearchService
	: undefined;
const DatabaseService = harness
	? (await import('../../src/services/DatabaseService')).DatabaseService
	: undefined;
const IndexingService = harness
	? (await import('../../src/services/IndexingService')).IndexingService
	: undefined;
const createJournalArchiveObjectPort = harness
	? (await import('../../src/jobs/processors/journal-archive-object-adapter'))
			.createJournalArchiveObjectPort
	: undefined;
const DrizzleOrganizationDomainsAdapter = harness
	? (await import('../../src/jobs/processors/journal-organization-domains-adapter'))
			.DrizzleOrganizationDomainsAdapter
	: undefined;
const NodeSpoolEntryReader = harness
	? (await import('@open-archiver/journaling')).NodeSpoolEntryReader
	: undefined;
const NodeSpoolEntryReleaser = harness
	? (await import('@open-archiver/journaling')).NodeSpoolEntryReleaser
	: undefined;

const FIXTURE_PATH = path.resolve(
	__dirname,
	'../../../journaling/tests/fixtures/basic-journal-report.eml'
);

/** The three owners `basic-journal-report.eml` fans out to against the `contoso.com` domain group --
 *  `to = [bob, carol]@contoso.com`, `cc = [dave]@contoso.com` (documented in `JR-5-01`'s fixture and
 *  exercised the same way in `pipeline.test.ts`'s fan-out suite). */
const EXPECTED_OWNERS = ['bob@contoso.com', 'carol@contoso.com', 'dave@contoso.com'];

const createdEmailIds: string[] = [];

afterAll(async () => {
	if (SearchService && createdEmailIds.length > 0) {
		const searchService = new SearchService();
		await searchService.deleteDocuments('emails', createdEmailIds).catch(() => undefined);
	}
});

suiteRequiring(
	'ci',
	'Phase B end-to-end: spool file to searchable hit (JR-6-02b, ADR-035)',
	requirement,
	() => {
		it('archives a fan-out journal report under all three owners, indexes them, makes them searchable, and releases the spool file', async () => {
			const spoolRoot = mkdtempSync(path.join(tmpdir(), 'oa-phase-b-e2e-spool-'));
			const ledgerSql = openBareLedgerConnection();

			try {
				// 1. Seed the backing ingestion_sources row (smtp_journaling, preserveOriginalFile,
				// ADR-010) and a journaling_sources row with the domain group that produces the
				// three-owner fan-out.
				const source = await seedIngestionSource(harness!.db, {
					provider: 'smtp_journaling',
					preserveOriginalFile: true,
					name: `phase-b-e2e-source-${generateTxId()}`,
				});
				const journalingSource = await seedJournalingSource(harness!.db, {
					ingestionSourceId: source.id,
					organizationDomains: [{ main: 'contoso.com', aliases: [] }],
					name: `phase-b-e2e-journaling-source-${generateTxId()}`,
				});

				// 2. Write the real spool bytes -- the exact wire bytes, never transformed (README
				// constraint 3).
				const raw = await readFile(FIXTURE_PATH);
				const txid = generateTxId();
				const spoolPath = incomingFilePath(spoolRoot, txid);
				await mkdir(path.dirname(spoolPath), { recursive: true });
				await writeFile(spoolPath, raw);

				// 3. Append the ledger receipt this transaction was accepted under -- what Phase A
				// (`JR-3-01`..`JR-4-xx`) already guarantees exists before any Phase-B job runs.
				const [deployment] = await harness!.sql<{ deployment_id: string }[]>`
					select deployment_id from deployment_identity
				`;
				const writer = new PostgresLedgerWriter({
					deploymentId: deployment!.deployment_id,
					transactor: postgresTransactor(harness!.sql),
				});
				const appendRequest: LedgerAppendRequest = {
					chainScopeId: source.id,
					receivedAtMicros: BigInt(Date.now()) * 1000n,
					eventType: 'receipt',
					remoteIp: '203.0.113.9',
					ehloName: 'mail.contoso.com',
					tlsVersion: 'TLSv1.3',
					tlsCipher: 'TLS_AES_256_GCM_SHA384',
					envelopeFrom: 'alice@contoso.com',
					envelopeRcpt: [journalingSource.routingAddress],
					sizeBytes: BigInt(raw.length),
					contentSha256: createHash('sha256').update(raw).digest(),
					duplicateOf: null,
					journalingSourceId: journalingSource.id,
					spoolTxId: txid,
					eventPayload: null,
				};
				await writer.append(appendRequest);

				// 4. Build the real adapters -- the same ones `journal-inbound.processor.ts` wires in
				// production, against the isolated, migrated database this file bound.
				const searchService = new SearchService!();
				await searchService.configureEmailIndex();
				const storageService = new StorageService!();
				const ingestionService = new IngestionService!();
				const indexingService = new IndexingService!(
					new DatabaseService!(),
					searchService,
					storageService
				);

				// 5. Run the real pipeline.
				const result: PhaseBPipelineResult = await runPhaseBPipeline(txid, {
					spoolRoot,
					ledgerLookup: new PostgresLedgerLookup(createLedgerQuery(ledgerSql)),
					spoolEntryReader: new NodeSpoolEntryReader!(),
					organizationDomains: new DrizzleOrganizationDomainsAdapter!(),
					archiveObject: createJournalArchiveObjectPort!(
						ingestionService,
						storageService
					),
					indexBatch: (pending: readonly PendingEmail[]) =>
						indexingService.indexEmailBatch([...pending]),
					releaseSpoolEntry: new NodeSpoolEntryReleaser!(),
					alertSink: (alert) => {
						// A test that reaches an alert took a wrong branch -- the fixture is a
						// well-formed journal report and the receipt matches the spool bytes.
						throw new Error(`unexpected Phase-B alert: ${JSON.stringify(alert)}`);
					},
					// JR-6-03: no duplicate delivery in this test -- the fan-out fixture is archived
					// once, so this is never called, but the pipeline requires it structurally.
					ledgerAppend: (request) => writer.append(request),
				});

				// 6. Every resolved owner archived, none skipped.
				expect(result.parseKind).toBe('journal_report');
				expect(result.owners.map((o) => o.ownerEmail).sort()).toEqual(
					[...EXPECTED_OWNERS].sort()
				);
				for (const owner of result.owners) {
					expect(owner.outcome.kind).toBe('archived');
					if (owner.outcome.kind === 'archived') {
						createdEmailIds.push(owner.outcome.archivedEmailId);
					}
				}
				expect(createdEmailIds).toHaveLength(3);

				// 7. Searchable -- filtered to this run's own ingestion source, never a raw hit count
				// (see the module doc comment on why the index is not test-isolated).
				const searchResult = await searchService.search<{
					id: string;
					subject: string;
					to: string[];
				}>('emails', 'Quarterly numbers', {
					filter: `ingestionSourceId = "${source.id}"`,
				});
				const foundIds = searchResult.hits.map((hit) => hit.id).sort();
				expect(foundIds).toEqual([...createdEmailIds].sort());
				for (const hit of searchResult.hits) {
					expect(hit.subject).toBe('Quarterly numbers');
				}

				// 8. The spool file is gone -- Phase B's own claim of "archived and searchable" is
				// what licenses releasing it (ADR-034), and by this point it is true.
				await expect(readFile(spoolPath)).rejects.toMatchObject({ code: 'ENOENT' });

				coverageNotice(
					`[JR-6-02b] Phase-B e2e: fan-out to ${result.owners.length} owner(s), ` +
						`${createdEmailIds.length} indexed and found by search, spool file released`
				);
			} finally {
				await ledgerSql.end().catch(() => undefined);
			}
		});

		it("delivered twice: one archived object, the second delivery's ledger receipt gets a duplicate_of marker pointing at the first (JR-6-03)", async () => {
			const spoolRoot = mkdtempSync(path.join(tmpdir(), 'oa-phase-b-e2e-dup-spool-'));
			const ledgerSql = openBareLedgerConnection();

			try {
				// A source with no domain groups configured -- resolveOwner()'s to[0] heuristic picks
				// the single recipient directly (same simplification pipeline.test.ts's own
				// duplicate-marker suite uses), so this test's assertions stay about the marker, not
				// about the fan-out the test above already covers.
				const source = await seedIngestionSource(harness!.db, {
					provider: 'smtp_journaling',
					preserveOriginalFile: true,
					name: `phase-b-e2e-dup-source-${generateTxId()}`,
				});
				const journalingSource = await seedJournalingSource(harness!.db, {
					ingestionSourceId: source.id,
					name: `phase-b-e2e-dup-journaling-source-${generateTxId()}`,
				});

				const raw = Buffer.from(
					'From: alice@example.com\r\nTo: bob@example.com\r\n' +
						'Subject: Redelivered notice\r\n\r\nBody.\r\n',
					'utf8'
				);
				const contentSha256 = createHash('sha256').update(raw).digest();

				const [deployment] = await harness!.sql<{ deployment_id: string }[]>`
					select deployment_id from deployment_identity
				`;
				const writer = new PostgresLedgerWriter({
					deploymentId: deployment!.deployment_id,
					transactor: postgresTransactor(harness!.sql),
				});

				const searchService = new SearchService!();
				await searchService.configureEmailIndex();
				const storageService = new StorageService!();
				const ingestionService = new IngestionService!();
				const indexingService = new IndexingService!(
					new DatabaseService!(),
					searchService,
					storageService
				);

				/**
				 * Simulates one accepted SMTP transaction delivering `raw`: writes the spool file,
				 * appends the Phase-A receipt this transaction would already have (unconditionally,
				 * `duplicateOf: null` -- Phase A never dedups), then runs the real Phase-B pipeline
				 * for it, through the real `writer` so a genuine `duplicate_of` marker is durably
				 * appended.
				 */
				async function deliver(): Promise<{
					result: PhaseBPipelineResult;
					receiptSeq: bigint;
				}> {
					const txid = generateTxId();
					const spoolPath = incomingFilePath(spoolRoot, txid);
					await mkdir(path.dirname(spoolPath), { recursive: true });
					await writeFile(spoolPath, raw);

					const appended = await writer.append({
						chainScopeId: source.id,
						receivedAtMicros: BigInt(Date.now()) * 1000n,
						eventType: 'receipt',
						remoteIp: '203.0.113.9',
						ehloName: 'mail.example.com',
						tlsVersion: 'TLSv1.3',
						tlsCipher: 'TLS_AES_256_GCM_SHA384',
						envelopeFrom: 'alice@example.com',
						envelopeRcpt: [journalingSource.routingAddress],
						sizeBytes: BigInt(raw.length),
						contentSha256,
						duplicateOf: null,
						journalingSourceId: journalingSource.id,
						spoolTxId: txid,
						eventPayload: null,
					});

					const result = await runPhaseBPipeline(txid, {
						spoolRoot,
						ledgerLookup: new PostgresLedgerLookup(createLedgerQuery(ledgerSql)),
						spoolEntryReader: new NodeSpoolEntryReader!(),
						organizationDomains: new DrizzleOrganizationDomainsAdapter!(),
						archiveObject: createJournalArchiveObjectPort!(
							ingestionService,
							storageService
						),
						indexBatch: (pending: readonly PendingEmail[]) =>
							indexingService.indexEmailBatch([...pending]),
						releaseSpoolEntry: new NodeSpoolEntryReleaser!(),
						alertSink: (alert) => {
							throw new Error(`unexpected Phase-B alert: ${JSON.stringify(alert)}`);
						},
						ledgerAppend: (request) => writer.append(request),
					});
					return { result, receiptSeq: appended.seq };
				}

				// First delivery: a genuine, unseen object -- archives normally.
				const first = await deliver();
				expect(first.result.owners).toHaveLength(1);
				expect(first.result.owners[0]!.outcome.kind).toBe('archived');
				const firstOutcome = first.result.owners[0]!.outcome;
				if (firstOutcome.kind !== 'archived') {
					throw new Error('unreachable: asserted archived above');
				}
				const archivedEmailId = firstOutcome.archivedEmailId;
				createdEmailIds.push(archivedEmailId);

				// Second delivery: byte-identical content under a different spool transaction --
				// `archiveObject()` must report 'duplicate' against the *same* archived object, never
				// a second one.
				const second = await deliver();
				expect(second.result.owners).toHaveLength(1);
				expect(second.result.owners[0]!.outcome.kind).toBe('duplicate');
				if (second.result.owners[0]!.outcome.kind === 'duplicate') {
					expect(second.result.owners[0]!.outcome.archivedEmailId).toBe(archivedEmailId);
				}

				// The load-bearing check: dedup collapses the *object*, never the receipt (RFC section
				// 4.5, skill journal-ledger section 5) -- and, since ADR-037, a `receipt` count now
				// means exactly that: two receipts for two accepted transactions, never three. Before
				// ADR-037 the marker was itself `event_type = 'receipt'`, so this same filter would have
				// returned 3 rows for 2 deliveries -- the overcount `verify` (E9) would otherwise have
				// inherited. Two separate queries, not one filtered differently, because "how many
				// receipts" and "is there a marker" are two different claims this test makes.
				const receiptRows = await harness!.sql<
					{ seq: string; spool_txid: string | null; duplicate_of: string | null }[]
				>`
					select seq, spool_txid, duplicate_of
					  from journal_ledger
					 where chain_scope_id = ${source.id}
					   and event_type = 'receipt'
					 order by seq
				`;
				expect(receiptRows).toHaveLength(2);
				const [receiptOne, receiptTwo] = receiptRows;
				expect(BigInt(receiptOne!.seq)).toBe(first.receiptSeq);
				expect(receiptOne!.spool_txid).not.toBeNull();
				expect(receiptOne!.duplicate_of).toBeNull();
				expect(BigInt(receiptTwo!.seq)).toBe(second.receiptSeq);
				expect(receiptTwo!.spool_txid).not.toBeNull();
				expect(receiptTwo!.duplicate_of).toBeNull();

				// The marker: `duplicate_of` the first receipt's seq, `spool_txid` null (never either
				// transaction's own -- see ledger-lookup-port.ts's doc comment on why reusing either
				// would silently collapse `findBySpoolTxIds()`'s Map), and its own event type -- never
				// 'receipt' (ADR-037).
				const markerRows = await harness!.sql<
					{ seq: string; spool_txid: string | null; duplicate_of: string | null }[]
				>`
					select seq, spool_txid, duplicate_of
					  from journal_ledger
					 where chain_scope_id = ${source.id}
					   and event_type = 'duplicate_marker'
					 order by seq
				`;
				expect(markerRows).toHaveLength(1);
				const marker = markerRows[0]!;
				expect(marker.spool_txid).toBeNull();
				expect(BigInt(marker.duplicate_of!)).toBe(first.receiptSeq);

				coverageNotice(
					`[JR-6-03/ADR-037] Phase-B e2e duplicate delivery: 1 archived object, 2 receipts ` +
						`(seq ${receiptOne!.seq}, ${receiptTwo!.seq}) + 1 duplicate_marker ` +
						`(seq ${marker.seq} -> ${first.receiptSeq})`
				);
			} finally {
				await ledgerSql.end().catch(() => undefined);
			}
		});
	}
);
