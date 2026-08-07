import { createDecipheriv, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { isClassSelected, suiteRequiring } from '@oa-test/classification';
import { probePostgres } from '@oa-test/infra';
import { coverageNotice } from '@oa-test/notice';
import {
	PostgresLedgerLookup,
	PostgresLedgerWriter,
	generateTxId,
	incomingFilePath,
	runPhaseBPipeline,
	type LedgerAppendRequest,
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
 * `content_sha256` is computed over the **plaintext wire bytes**, and `StorageService` encrypts
 * afterwards (`JR-6-05`, RFC section 7, `CLAUDE.md` section 5.5). Classification: `ci`.
 *
 * ---------------------------------------------------------------------------------------------
 * The backlog criterion, and why it needs encryption actually switched on
 * ---------------------------------------------------------------------------------------------
 * *"Test: Objekt exportieren, entschlüsseln, Hash neu berechnen ⇒ identisch zum Ledger-Wert."* The
 * ordering it protects is the one `CLAUDE.md` section 5.5 states as a rule and E9's `verify` will
 * depend on: a hash taken over ciphertext would still be perfectly self-consistent -- every write
 * would match every read -- and would still be **worthless as evidence**, because a re-export
 * decrypted with a rotated or re-derived key produces different ciphertext for identical content. Only
 * a hash over plaintext survives that.
 *
 * A run with `STORAGE_ENCRYPTION_KEY` unset would satisfy "re-hash equals the ledger value" **whatever
 * the ordering is**, because plaintext and stored bytes are then the same bytes. So the ordering claim
 * is only actually verified when a key is configured, and this file therefore does two things: it
 * asserts that the bytes at rest really are ciphertext (magic prefix, and their own hash *differs*
 * from the ledger value) before decrypting and comparing -- and when no key is configured it says so
 * in a `coverageNotice`, naming the claim it could not verify, instead of reporting the same green as
 * a run that proved it. `ci.yml` sets the key so CI is the configuration that proves it. No `skipIf`:
 * `expectedTests` is exact and must not vary by environment (F48, `JR-4-10`).
 *
 * The negative assertion is the calibration: switch the encryption off and the ciphertext branch
 * fails; invert the hashing order and the digest comparison fails.
 *
 * ---------------------------------------------------------------------------------------------
 * The configuration is read, not imposed -- and indexing is stubbed
 * ---------------------------------------------------------------------------------------------
 * See `storageConfig` below for what happens when a test tries to set `STORAGE_*` in its own module
 * scope: it does not work, and the interesting half of the failure is the one that would have been
 * silent. The database singleton still needs the dynamic-import dance for the reason ADR-035 gives.
 *
 * `indexBatch` is a recording stub rather than the real `IndexingService`: nothing about this claim
 * involves search, and stubbing it keeps this file's infrastructure requirement at Postgres instead of
 * Postgres plus Meilisearch. `journal-phase-b-e2e.int.test.ts` is where the real indexing path is
 * proven.
 */

const postgresProbe = await probePostgres();
const enabled = postgresProbe.available && isClassSelected('ci');

const ENCRYPTION_PREFIX = Buffer.from('oa_enc_idf_v1::');

const harness = enabled ? await acquireTestDatabase('hash-before-encryption') : undefined;
if (harness) {
	harness.bindAsProcessDatabaseUrl();
	await loadBackendDatabaseSingleton();
}

// Deferred until after the assignments above -- see the module doc comment.
const IngestionService = harness
	? (await import('../../src/services/IngestionService')).IngestionService
	: undefined;
const StorageService = harness
	? (await import('../../src/services/StorageService')).StorageService
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

/**
 * The **effective** storage configuration, read rather than imposed.
 *
 * An earlier version of this file assigned `STORAGE_TYPE`/`STORAGE_LOCAL_ROOT_PATH`/
 * `STORAGE_ENCRYPTION_KEY` in module scope and expected the dynamic `import()` below to pick them up.
 * Measured: it does not. Something in this file's *static* import graph already pulls in
 * `config/storage.ts`, which reads its environment once at import -- so the assignments arrived too
 * late, the object was written under the ambient root, and it was **not encrypted**. The failure was
 * an `ENOENT` on a path that never existed; the silent half would have been far worse, because an
 * unencrypted object still satisfies "re-hash equals the ledger value" and the ordering claim would
 * have passed vacuously.
 *
 * So: the configuration is an input to this test, not something it controls. `ci.yml` sets
 * `STORAGE_ENCRYPTION_KEY` for exactly this reason.
 */
const storageConfig = harness ? (await import('../../src/config/storage')).storage : undefined;
const effectiveKey = storageConfig?.encryptionKey;

const FIXTURE_PATH = path.resolve(
	__dirname,
	'../../../journaling/tests/fixtures/basic-journal-report.eml'
);

suiteRequiring(
	'ci',
	'content_sha256 is over plaintext, encryption happens after (JR-6-05)',
	postgresProbe,
	() => {
		it('re-exports the stored object, decrypts it, re-hashes it and lands on the ledger value', async () => {
			const spoolRoot = mkdtempSync(path.join(tmpdir(), 'oa-hash-before-enc-spool-'));
			const ledgerSql = openBareLedgerConnection();

			try {
				const source = await seedIngestionSource(harness!.db, {
					provider: 'smtp_journaling',
					preserveOriginalFile: true,
					name: `hash-before-enc-source-${generateTxId()}`,
				});
				const journalingSource = await seedJournalingSource(harness!.db, {
					ingestionSourceId: source.id,
					organizationDomains: [{ main: 'contoso.com', aliases: [] }],
					name: `hash-before-enc-journaling-${generateTxId()}`,
				});

				// The wire bytes, never transformed (README constraint 3), and the hash Phase A committed
				// for them -- over exactly these plaintext bytes.
				const raw = await readFile(FIXTURE_PATH);
				const wireDigest = createHash('sha256').update(raw).digest();
				const txid = generateTxId();
				const spoolPath = incomingFilePath(spoolRoot, txid);
				await mkdir(path.dirname(spoolPath), { recursive: true });
				await writeFile(spoolPath, raw);

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
					remoteIp: '203.0.113.11',
					ehloName: 'mail.contoso.com',
					tlsVersion: 'TLSv1.3',
					tlsCipher: 'TLS_AES_256_GCM_SHA384',
					envelopeFrom: 'alice@contoso.com',
					envelopeRcpt: [journalingSource.routingAddress],
					sizeBytes: BigInt(raw.length),
					contentSha256: wireDigest,
					duplicateOf: null,
					journalingSourceId: journalingSource.id,
					spoolTxId: txid,
					eventPayload: null,
				};
				await writer.append(appendRequest);

				const storageService = new StorageService!();
				const indexed: PendingEmail[] = [];
				const result = await runPhaseBPipeline(txid, {
					spoolRoot,
					ledgerLookup: new PostgresLedgerLookup(createLedgerQuery(ledgerSql)),
					spoolEntryReader: new NodeSpoolEntryReader!(),
					organizationDomains: new DrizzleOrganizationDomainsAdapter!(),
					archiveObject: createJournalArchiveObjectPort!(
						new IngestionService!(),
						storageService
					),
					indexBatch: async (pending: readonly PendingEmail[]) => {
						indexed.push(...pending);
					},
					releaseSpoolEntry: new NodeSpoolEntryReleaser!(),
					alertSink: (alert) => {
						throw new Error(`unexpected Phase-B alert: ${JSON.stringify(alert)}`);
					},
					ledgerAppend: (request) => writer.append(request),
				});

				const archivedIds = result.owners.flatMap((owner) =>
					owner.outcome.kind === 'archived' ? [owner.outcome.archivedEmailId] : []
				);
				expect(archivedIds.length).toBeGreaterThan(0);
				expect(indexed.length).toBe(archivedIds.length);

				const rows = await harness!.sql<
					{ storage_path: string; storage_hash_sha256: string; size_bytes: string }[]
				>`
					select storage_path, storage_hash_sha256, size_bytes
					  from archived_emails
					 where id = any(${archivedIds}::uuid[])
				`;
				expect(rows).toHaveLength(archivedIds.length);

				// Fan-out shares one physical object (ADR-010, gate 2), so one stored path is the whole
				// claim -- but assert the invariant holds for every row rather than assuming that.
				const storedPaths = new Set(rows.map((row) => row.storage_path));
				expect(storedPaths.size).toBe(1);

				const storedPath = rows[0]!.storage_path;
				expect(storageConfig!.type).toBe('local');
				const storageRoot = (storageConfig as { rootPath: string }).rootPath;
				const onDisk = await readFile(path.join(storageRoot, storedPath));

				let plaintext: Buffer;
				if (effectiveKey) {
					// --- The calibration: the bytes at rest really are ciphertext. ---
					expect(
						onDisk.subarray(0, ENCRYPTION_PREFIX.length).equals(ENCRYPTION_PREFIX)
					).toBe(true);
					expect(createHash('sha256').update(onDisk).digest('hex')).not.toBe(
						wireDigest.toString('hex')
					);
					expect(onDisk.length).toBeGreaterThan(raw.length);

					// --- Export, decrypt. ---
					const iv = onDisk.subarray(
						ENCRYPTION_PREFIX.length,
						ENCRYPTION_PREFIX.length + 16
					);
					const body = onDisk.subarray(ENCRYPTION_PREFIX.length + 16);
					const decipher = createDecipheriv(
						'aes-256-cbc',
						Buffer.from(effectiveKey, 'hex'),
						iv
					);
					plaintext = Buffer.concat([decipher.update(body), decipher.final()]);
					coverageNotice(
						`[JR-6-05] encryption ON: ${onDisk.length} ciphertext bytes at rest, prefix ` +
							`present, ciphertext hash differs from the ledger value -- the ordering claim ` +
							`is verified this run`
					);
				} else {
					// No key configured, so stored bytes ARE plaintext. Byte fidelity and the digest chain
					// below still hold and are still worth asserting -- but "hash over plaintext" and "hash
					// over stored bytes" are indistinguishable in this configuration, so the ordering claim
					// is NOT verified. Said out loud rather than printed as the same green.
					expect(
						onDisk.subarray(0, ENCRYPTION_PREFIX.length).equals(ENCRYPTION_PREFIX)
					).toBe(false);
					plaintext = onDisk;
					coverageNotice(
						'[JR-6-05] STORAGE_ENCRYPTION_KEY is not configured, so the bytes at rest ' +
							'are plaintext. Byte fidelity and the ledger-digest match are verified; ' +
							'the HASH-BEFORE-ENCRYPTION ORDERING IS NOT -- it is indistinguishable ' +
							'from hash-after-encryption when the two byte sequences are identical. ' +
							'Set the key (ci.yml does) to verify it.'
					);
				}

				// Byte fidelity first: a digest match on transformed bytes would prove the wrong thing.
				expect(plaintext.equals(raw)).toBe(true);
				const rehashed = createHash('sha256').update(plaintext).digest('hex');

				// The three values the criterion ties together.
				expect(rehashed).toBe(wireDigest.toString('hex'));
				for (const row of rows) {
					expect(row.storage_hash_sha256).toBe(rehashed);
					// The recorded size is the plaintext size, not the padded ciphertext size.
					expect(Number(row.size_bytes)).toBe(raw.length);
				}

				const [receipt] = await harness!.sql<{ content_sha256: Buffer | null }[]>`
					select content_sha256 from journal_ledger
					 where spool_txid = ${txid} and event_type = 'receipt'
				`;
				expect(receipt!.content_sha256).not.toBeNull();
				expect(Buffer.from(receipt!.content_sha256!).toString('hex')).toBe(rehashed);

				// And the transparent read path agrees. `get()` returns a stream (built from an internally
				// buffered decrypt -- the shape F60 describes), so collect it.
				const readStream = await storageService.get(storedPath);
				const chunks: Buffer[] = [];
				for await (const chunk of readStream) {
					chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
				}
				expect(Buffer.concat(chunks).equals(raw)).toBe(true);
			} finally {
				await ledgerSql.end().catch(() => undefined);
			}
		});
	}
);
