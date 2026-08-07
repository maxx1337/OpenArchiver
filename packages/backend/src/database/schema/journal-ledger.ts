import { sql, relations } from 'drizzle-orm';
import {
	bigint,
	check,
	customType,
	foreignKey,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
} from 'drizzle-orm/pg-core';
import type { CanonicalJsonValue } from '@open-archiver/types';
import { ingestionSources } from './ingestion-sources';

/**
 * The journal ledger (`JR-2-04`, epic E2). RFC section 5.2, with the corrections from **ADR-006**.
 *
 * Read `docs/dev/journaling/05-entscheidungen.md` ADR-006 and ADR-007 before changing anything here.
 * Every column below except `chain_hash` and `prev_chain_hash` is an **input to the chain hash**, so
 * a type change, a rename or an added column is a chain-invalidating format change, not a
 * refactoring — it needs a new `FORMAT_VERSION` in `packages/journaling` and a migration.
 *
 * Append-only enforcement (`REVOKE`/trigger) is **not** here: it is `JR-2-05` and ADR-009, and its
 * scope is this table **and** `deployment_identity` below.
 */

/**
 * `bytea`, because the values are hashes.
 *
 * The existing schema stores hashes as lowercase hex `text` (`archived_emails.storage_hash_sha256`,
 * `attachments.content_hash_sha256`), and this deliberately differs. Two reasons, in order of
 * weight:
 *
 *  1. These bytes go **into** a hash. A textual representation adds a normalisation question
 *     (upper or lower case?) to a value on which chain verification depends, which is precisely the
 *     class of bug ADR-006 section 3 exists to eliminate. `packages/journaling` encodes
 *     `content_sha256` as 32 raw bytes.
 *  2. RFC section 5.2 specifies `BYTEA` for all three hash columns.
 *
 * The consequence is one explicit conversion where a ledger hash is compared against
 * `archived_emails.storage_hash_sha256` (phase B, `JR-6-05`, and `verify` in E9). One conversion at a
 * known boundary beats carrying 32 bytes as hex through the whole system and re-parsing them at
 * every hash boundary.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType() {
		return 'bytea';
	},
});

/**
 * Typed ledger events. The ledger records more than receipts, so the chain can explain *why*
 * something is gone (RFC section 5.3, skill `journal-ledger` section 7).
 *
 * Postgres cannot drop enum values — a new event type is an `ALTER TYPE … ADD VALUE`, and removing
 * one is not possible. Keep this list in sync with `JournalEventType` in
 * `packages/types/src/journal-ledger.types.ts` and `LedgerAppendRequest['eventType']` in
 * `packages/journaling/src/ledger/ledger-port.ts`; the first is what the canonical encoding hashes,
 * the second is the write port's own copy of the same union (ADR-037's F46 point: two places agreeing
 * by convention, not by a shared type, is exactly what let the missing `duplicate_marker` value go
 * unnoticed).
 *
 * `duplicate_marker` (ADR-037, `JR-6-03` follow-up): the `duplicate_of` marker `runPhaseBPipeline()`
 * appends for a genuinely redelivered message was, until this migration, written as `'receipt'` —
 * there was no other value for it. That overcounted every query that holds `receipt` rows against
 * accepted messages (`verify`, E9, will do exactly this): three ledger rows for two deliveries read as
 * three receipts, not two. The discriminator existed (`spool_txid is null`) but only in a doc comment,
 * never enforced. This value makes it a first-class, queryable fact instead.
 *
 * **Existing rows are untouched, and that is correct, not a gap.** `event_type` is hashed into
 * `chain_hash` (see `packages/types/src/journal-ledger.types.ts`'s `JournalLedgerRecord` doc comment),
 * and the ledger is append-only (ADR-009) — a marker row written before this migration already has
 * its `chain_hash` computed over `event_type = 'receipt'`, and that hash is exactly as correct as the
 * byte that produced it. Widening the enum does not retroactively relabel anything; it only changes
 * what `runPhaseBPipeline()` writes for the *next* marker. No `FORMAT_VERSION` bump: the canonical
 * encoder (`stringField(record.eventType, 'eventType')`) hashes whatever string is present, generically
 * — it has no fixed mapping from event type to byte code that this value would need to join.
 */
export const journalEventTypeEnum = pgEnum('journal_event_type', [
	'receipt',
	'anchor',
	'parse_failed',
	'retention_expiry',
	'object_erased',
	'legal_hold_set',
	'duplicate_marker',
]);

export const journalLedger = pgTable(
	'journal_ledger',
	{
		/**
		 * The chain this row belongs to: `ingestion_sources.id`, i.e. one chain per archive
		 * (ADR-007).
		 *
		 * `onDelete: 'restrict'` and that is the point: deleting an archive that has ledger rows is
		 * **blocked**. A receipt ledger that disappears with the configuration that produced it
		 * proves nothing, and `ON DELETE SET NULL` is not an option either — this column is hashed,
		 * so changing it would break the chain rather than merely lose a reference. Removing an
		 * archive whose retention has fully expired therefore needs a deliberate procedure (E12);
		 * it is not a `DELETE`.
		 */
		chainScopeId: uuid('chain_scope_id')
			.notNull()
			.references(() => ingestionSources.id, { onDelete: 'restrict' }),
		/**
		 * Gapless and strictly monotonic **per chain** — never globally (ADR-007 consequence 1).
		 *
		 * A bare Postgres sequence is not sufficient: sequences advance on rolled-back transactions
		 * and leave permanent holes, and a hole is a tamper signal. `JR-2-06` derives it inside the
		 * advisory lock instead.
		 */
		seq: bigint('seq', { mode: 'bigint' }).notNull(),
		/**
		 * Always a whole millisecond — enforced by `journal_ledger_received_at_whole_ms` below.
		 *
		 * ADR-006 section 3.1: `timestamptz` resolves to microseconds, JavaScript's `Date` to
		 * milliseconds, so a sub-millisecond value cannot survive a round trip and would make the
		 * row's chain hash unreproducible.
		 */
		receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
		eventType: journalEventTypeEnum('event_type').notNull(),
		/**
		 * Peer address in the canonical textual form produced by `normalizeRemoteIp()`.
		 *
		 * `text`, not `inet`, and that is deliberate: the hashed value **is** this text. `inet`
		 * applies its own normalisation on the way out, which could differ from the string that was
		 * hashed and would make the chain unverifiable for a reason no one would look for.
		 */
		remoteIp: text('remote_ip'),
		ehloName: text('ehlo_name'),
		/** `null` means the session was not encrypted. Hashed, because that distinction is evidence. */
		tlsVersion: text('tls_version'),
		tlsCipher: text('tls_cipher'),
		envelopeFrom: text('envelope_from'),
		/** In arrival order, never sorted — the order is part of the receipt. */
		envelopeRcpt: text('envelope_rcpt').array(),
		/**
		 * Nullable, unlike the `CREATE TABLE` in RFC section 5.2.
		 *
		 * An `anchor` or `object_erased` event has no message and therefore no size. Writing `0`
		 * would assert something about a message that never existed (ADR-006 section 2).
		 */
		sizeBytes: bigint('size_bytes', { mode: 'bigint' }),
		/** SHA-256 over the plaintext wire bytes, before encryption at rest. Nullable, see above. */
		contentSha256: bytea('content_sha256'),
		/**
		 * `seq` of the original receipt when this transaction carried an object already archived.
		 *
		 * Every accepted transaction keeps its own row: a receipt is an event, not a message
		 * (skill `journal-ledger` section 5). The composite foreign key below pins the reference to
		 * the **same** chain.
		 */
		duplicateOf: bigint('duplicate_of', { mode: 'bigint' }),
		/**
		 * Which endpoint sent it (`journaling_sources.id`) — an attribute, not a second chain
		 * (ADR-007).
		 *
		 * Deliberately **not** a foreign key. `journaling_sources` hangs off `ingestion_sources`
		 * with `onDelete: cascade`, so any referential action would have to be `SET NULL` or
		 * `CASCADE`; the first changes a hashed field and breaks the chain, the second deletes
		 * evidence. The recorded statement "this endpoint sent it" stays true after the endpoint is
		 * removed, and the row must keep saying so.
		 */
		journalingSourceId: uuid('journaling_source_id'),
		/** Spool transaction id. Crash recovery matches spool files against the ledger through this. */
		spoolTxId: text('spool_txid'),
		eventPayload: jsonb('event_payload').$type<CanonicalJsonValue>(),
		prevChainHash: bytea('prev_chain_hash').notNull(),
		chainHash: bytea('chain_hash').notNull(),
	},
	(table) => [
		// `UNIQUE (chain_scope_id, seq)` as the primary key: seq runs per chain, so a global
		// primary key on seq would be a second, hidden serialisation point (ADR-007 consequence 1).
		primaryKey({ columns: [table.chainScopeId, table.seq] }),
		// A duplicate always points at an original in the *same* chain. With a per-chain seq, a
		// single-column reference could not express that.
		foreignKey({
			columns: [table.chainScopeId, table.duplicateOf],
			foreignColumns: [table.chainScopeId, table.seq],
			name: 'journal_ledger_duplicate_of_fk',
		}),
		// ADR-006 section 3.1, verified against PostgreSQL 17.10: a sub-millisecond timestamp is
		// rejected. `AT TIME ZONE 'UTC'` makes the expression explicitly timezone-independent.
		check(
			'journal_ledger_received_at_whole_ms',
			sql`extract(microseconds from (${table.receivedAt} at time zone 'UTC'))::bigint % 1000 = 0`
		),
		// Hashes are fixed width. A wrong-length value here means the writer is broken, and it must
		// not reach the chain.
		check('journal_ledger_chain_hash_len', sql`length(${table.chainHash}) = 32`),
		check('journal_ledger_prev_chain_hash_len', sql`length(${table.prevChainHash}) = 32`),
		check(
			'journal_ledger_content_sha256_len',
			sql`${table.contentSha256} is null or length(${table.contentSha256}) = 32`
		),
		// seq is derived, never negative.
		check('journal_ledger_seq_nonnegative', sql`${table.seq} >= 0`),
		// The original precedes the duplicate. Found by the test for the composite foreign key
		// above: that key alone does **not** stop a row from naming itself, because Postgres checks
		// referential integrity at the end of the statement, by which time the referenced pair is
		// the row being inserted. `duplicate_of = seq` would be a receipt that is its own original.
		check(
			'journal_ledger_duplicate_of_precedes',
			sql`${table.duplicateOf} is null or ${table.duplicateOf} < ${table.seq}`
		),
		// Crash recovery looks a spool file up by its transaction id (E3, `JR-3-05`).
		index('journal_ledger_spool_txid_idx').on(table.spoolTxId),
		// Monitoring counts per endpoint (E10); the chain itself is never queried this way.
		index('journal_ledger_source_received_idx').on(table.journalingSourceId, table.receivedAt),
	]
);

export const journalLedgerRelations = relations(journalLedger, ({ one }) => ({
	chainScope: one(ingestionSources, {
		fields: [journalLedger.chainScopeId],
		references: [ingestionSources.id],
	}),
}));

/**
 * The identity of this installation, and the second half of every chain's genesis hash.
 *
 * ```
 * chain_hash(0) = SHA256( "open-archiver:journal-ledger:v1:" || deployment_id || ":" || chain_scope_id )
 * ```
 *
 * **Why this is a table of its own and not a key in `system_settings`** (ADR-006 section 4.2):
 * `system_settings` is a single row of `jsonb` written by the settings API — `language`, `theme`,
 * `supportEmail`. A value that sits inside the genesis hash of every chain must not be reachable by
 * the endpoint that changes the colour theme; one `PUT` would make every chain in the installation
 * unverifiable.
 *
 * The row is created **by the migration** via `gen_random_uuid()`: no application code, no race
 * between two starting processes, and it works in `docker/docker-entrypoint.sh`, which runs
 * `pnpm db:migrate` before the app starts.
 *
 * A restore from backup keeps this value — a restore is the same installation. Two installations
 * running in parallel with the same `deployment_id` is a split brain, which is **not preventable**
 * (a restore and a clone are byte-identical) and is therefore detected rather than blocked: see
 * ADR-006 section 4.3, `JR-8-02`, `JR-8-03` and `JR-2-09`.
 */
export const deploymentIdentity = pgTable(
	'deployment_identity',
	{
		/** Pinned to 1 by the check below: this table holds exactly one row, forever. */
		id: integer('id').primaryKey().default(1),
		deploymentId: uuid('deployment_id').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [check('deployment_identity_single_row', sql`${table.id} = 1`)]
);
