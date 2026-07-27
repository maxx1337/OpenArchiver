---
name: oa-migration
description: Drizzle ORM schema and migration workflow for Open Archiver. Use whenever adding or changing a database table, column, index, enum, or relation in packages/backend/src/database/schema/ — or when a migration fails, container startup breaks on db:migrate, or drizzle-kit does not detect a new schema file.
---

# Drizzle Schema & Migration Workflow

Open Archiver uses **Drizzle ORM** (`drizzle-orm` 0.44, `drizzle-kit` 0.31) over `postgres-js`.
Migrations are **generated, reviewed, and committed** — never hand-written, never edited after they
have been applied anywhere.

## Layout

| Path                                                               | Role                                                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `packages/backend/drizzle.config.ts`                               | schema entry `./src/database/schema.ts`, out `./src/database/migrations`, `strict: true` |
| `packages/backend/src/database/schema/*.ts`                        | one file per domain area                                                                 |
| `packages/backend/src/database/schema.ts`                          | **barrel** — re-exports every schema file                                                |
| `packages/backend/src/database/migrations/NNNN_*.sql`              | generated migrations, committed                                                          |
| `packages/backend/src/database/migrations/meta/NNNN_snapshot.json` | drizzle's state snapshots, committed                                                     |
| `packages/backend/src/database/index.ts`                           | exports `db` and `type Database`; reads `DATABASE_URL`                                   |
| `packages/backend/src/database/migrate.ts`                         | the migration runner (`pnpm db:migrate`)                                                 |

## The workflow

```bash
# 1. Edit or add a schema file under src/database/schema/
# 2. Add it to the barrel if it is new  ← the step people forget
# 3. Generate
pnpm db:generate
# 4. Review BOTH generated artifacts (see checklist below)
# 5. Apply locally
pnpm db:migrate        # or db:migrate:dev
# 6. Commit the schema change, the .sql, and the meta snapshot together
```

### Step 2 is not optional

`drizzle.config.ts` points at the barrel `src/database/schema.ts`, not at the directory. A new file
under `schema/` that is not re-exported from the barrel is **invisible to drizzle-kit** — generation
succeeds and emits nothing, which looks like "no changes detected".

### Step 4 review checklist

Read the emitted SQL. Do not trust it blindly.

- [ ] Does it do only what you intended? Drizzle infers destructive operations from renames — a
      column rename can generate `DROP COLUMN` + `ADD COLUMN`, silently discarding data.
- [ ] Is there a `DROP` or `ALTER … TYPE` you did not ask for?
- [ ] Are `NOT NULL` columns on existing tables given a `DEFAULT` or backfilled? Adding a bare
      `NOT NULL` column to a populated table fails at apply time.
- [ ] Are new enum values _added_ rather than the enum recreated? Postgres cannot drop enum values.
- [ ] Are indexes named consistently with existing ones (`<subject>_<cols>_idx`, e.g.
      `storage_hash_source_idx`, `msgid_header_source_idx`)?
- [ ] Is the `meta/NNNN_snapshot.json` present in the diff? Committing the `.sql` without the
      snapshot corrupts the next generation.

## Conventions in this schema

Follow `src/database/schema/journaling-sources.ts` as the reference for style:

- `uuid('id').primaryKey().defaultRandom()` for entity IDs.
- `timestamp('created_at', { withTimezone: true }).notNull().defaultNow()` — **always** timezone-aware.
- Snake-case column names in the DB, camelCase in TypeScript: `allowedIps: jsonb('allowed_ips')`.
- Typed JSONB: `jsonb('organization_domains').$type<{ main: string; aliases: string[] }[]>()`.
- Enums via `pgEnum('journaling_source_status', ['active', 'paused'])`, declared in the schema file
  that owns them (or `schema/enums.ts` when shared).
- Relations declared separately with `relations(...)`, exported as `<table>Relations`.
- Explicit `onDelete` on every foreign key — decide `cascade` vs `restrict` deliberately.
  `email_attachments` uses `restrict` on the attachment side because attachments are deduplicated
  and shared.
- Doc-comment non-obvious columns. The existing schema does this well; match it.

## There is no down migration

`drizzle-orm/postgres-js/migrator` applies forward only. To undo, write a **new** forward migration.
Never edit or delete an applied migration file — `docker/docker-entrypoint.sh` runs
`pnpm install --prod && pnpm db:migrate` before the app starts, so a rewritten migration history
means containers fail to boot for anyone who already migrated.

## Append-only tables

For ledger-style tables that must never be mutated (`journal_ledger`), application discipline is not
enough. Enforce it in the database as part of the migration — revoke `UPDATE`/`DELETE` from the
application role, or add a trigger that raises on them. Document which mechanism you chose in
`docs/dev/journaling/02-architektur.md`. Note that the migration role itself needs enough privilege
to create the constraint.

## Troubleshooting

| Symptom                                                         | Cause                                                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `db:generate` reports no changes                                | new schema file not re-exported from `schema.ts`                                         |
| Container fails on startup                                      | migration errors — check `docker/docker-entrypoint.sh` output, not the app log           |
| `DATABASE_URL` rejected with special characters in the password | that is why `helpers/db.ts` `encodeDatabaseUrl` exists; use it                           |
| Migration applies locally but not in CI/prod                    | snapshot missing from the commit, or migrations applied out of order                     |
| Drizzle asks an interactive rename question                     | it cannot infer intent; answer deliberately, then verify the emitted SQL is not drop+add |

## Definition of done

- [ ] Schema file edited and, if new, added to the barrel.
- [ ] `pnpm db:generate` run; emitted SQL read line by line.
- [ ] `pnpm db:migrate` applied successfully against a local database.
- [ ] `.sql` **and** `meta/*_snapshot.json` staged in the same commit as the schema change.
- [ ] Corresponding types added or updated in `packages/types` if the table is part of an API contract.
