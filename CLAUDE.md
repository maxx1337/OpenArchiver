# CLAUDE.md — Open Archiver

Repository orientation for AI agents. Read this before touching code.

> **Active project:** a compliance-grade SMTP journaling receiver (RFC-driven).
> **Before doing any work on it, read [`docs/dev/journaling/README.md`](docs/dev/journaling/README.md).**
> That directory is the project's memory: backlog, architecture, test plan, decisions, status.

---

## 1. What this is

Open Archiver is a self-hosted email archiving platform. It ingests mail, stores the raw EML plus
extracted attachments, indexes everything for search, and applies retention/compliance policy.

License: **AGPL-3.0**. Contributions must stay compatible with it.

## 2. Repository layout

pnpm workspaces (`pnpm-workspace.yaml`: `packages/*`, `apps/*`). **No turbo/nx** — orchestration is
plain `pnpm --filter` + `concurrently` + `dotenv-cli`. Node >= 22, pnpm 10.13.1 (pinned).

| Path                  | Package name                | Role                                                                                                                                                                      |
| --------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/types`      | `@open-archiver/types`      | Shared contract package. Types-only, MIT. **Changes here ripple everywhere.**                                                                                             |
| `packages/backend`    | `@open-archiver/backend`    | Express 5 API, services, Drizzle schema, BullMQ workers                                                                                                                   |
| `packages/frontend`   | `@open-archiver/frontend`   | SvelteKit 2 / Svelte 5 (runes), Tailwind 4, bits-ui                                                                                                                       |
| `packages/journaling` | `@open-archiver/journaling` | **Since `JR-201` (E2).** Ledger, canonical encoding, chain and Merkle hashing. AGPL, pure logic. Depends on `types` **only** — config and DB are injected, never imported |
| `apps/open-archiver`  | `open-archiver-app`         | Thin entrypoint: `createServer([])` + `listen`                                                                                                                            |
| `docs/`               | —                           | VitePress site. Sidebar is **explicit** in `docs/.vitepress/config.mts`                                                                                                   |

### The dual OSS / Enterprise build — read this carefully

Root `package.json` references `apps/open-archiver-enterprise` and `packages/enterprise`. **Neither
exists in this repository.** They are a closed-source overlay. Consequences:

- `pnpm build:enterprise`, `start:enterprise`, `dev:enterprise` **cannot work here**. Use the `:oss`
  variants.
- `packages/frontend` contains enterprise UI gated by `VITE_ENTERPRISE_MODE` (e.g.
  `routes/dashboard/ingestions/journaling/`, `routes/dashboard/compliance/*`). The UI exists; the
  backend that serves it often does not.
- Several features are **documented but absent**: most importantly the SMTP journaling listener
  described in `docs/enterprise/journaling/guide.md`. Do not assume documented behavior is
  implemented — grep first.
- `packages/backend/src/api/server.ts` exposes the plugin seam the overlay used:

    ```ts
    export interface ArchiverModule {
    	initialize: (app: Express, authService: AuthService) => Promise<void>;
    	name: OpenArchiverFeature;
    }
    export async function createServer(modules: ArchiverModule[] = []): Promise<Express>;
    ```

    New optional subsystems should mount through this seam rather than editing `createServer` inline.

## 3. Runtime topology

One API process plus **three separate worker processes** — they are not threads, each is its own
`node` invocation:

| Process          | Entrypoint                                               | Started by               |
| ---------------- | -------------------------------------------------------- | ------------------------ |
| API + frontend   | `apps/open-archiver/index.ts`                            | `pnpm start:oss`         |
| Ingestion worker | `packages/backend/src/workers/ingestion.worker.ts`       | `start:ingestion-worker` |
| Indexing worker  | `packages/backend/src/workers/indexing.worker.ts`        | `start:indexing-worker`  |
| Sync scheduler   | `packages/backend/src/jobs/schedulers/sync-scheduler.ts` | `start:sync-scheduler`   |

`pnpm start:workers` runs all three under `concurrently`. Dev variants use `ts-node-dev`.

Infrastructure (`docker-compose.yml`): `postgres:17-alpine`, `valkey:8-alpine` (Redis-compatible,
BullMQ backend), `getmeili/meilisearch:v1.38`, `apache/tika:3.2.2.0-full`.

Queues live in `packages/backend/src/jobs/queues.ts` (`ingestion`, `indexing`,
`compliance-lifecycle`); Redis connection in `packages/backend/src/config/redis.ts`.

> `ingestion.worker.ts` sets `maxStalledCount: 0` and `lockDuration: 10min` deliberately —
> stall-induced double-runs raced the dedup check. Read the comment there before changing it.

## 4. Commands

```bash
pnpm dev:oss              # frontend + backend + all workers, watch mode
pnpm build:oss            # build packages/* and apps/open-archiver
pnpm lint                 # prettier --check .   (ci.yml runs this too, since E1)
pnpm format               # prettier --write .
pnpm test                 # vitest run, all three projects. Needs DATABASE_URL for `integration`
pnpm test:unit            # one project only — prints "verified NOTHING", checks no counts (§5.1)
pnpm test:nightly         # OA_TEST_CLASSES=ci,nightly
pnpm db:generate          # drizzle-kit generate — creates a new migration
pnpm db:migrate           # apply migrations (compiled); db:migrate:dev for ts-node-dev
pnpm docs:dev             # VitePress on :3009 (regenerates the OpenAPI spec first)
pnpm --filter @open-archiver/frontend check       # svelte-check
pnpm --filter @open-archiver/backend test:types   # tsc over the test files
```

All root scripts are wrapped in `dotenv -- …`, so they read the root `.env`. `.env.example` is the
authoritative env-var list.

## 5. Non-obvious conventions

### 5.1 There is a test harness, and it is opinionated

> This section said "there are no tests" until 2026-07-30. That was true when this file was written and
> stopped being true with epic E1. **Do not build a second harness** — the one below is the harness.

`vitest` 3.2 from **one** root config (`vitest.config.ts`) defining three **projects**:
`unit`, `integration`, `adversarial`. `pnpm test` runs all of them; `test:unit`, `test:integration`,
`test:adversarial`, `test:nightly`, `test:manual` narrow. CI (`.github/workflows/ci.yml`) runs lint,
build, `svelte-check`, `test:types` and the suite against a `postgres:17-alpine` service container.

| Where                                           | What                                                          |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `packages/*/src/**/*.test.ts`                   | `unit` — must not import `src/database` (it throws at import) |
| `packages/*/tests/unit/**/*.test.ts`            | `unit` — units of the harness itself                          |
| `packages/*/tests/integration/**/*.int.test.ts` | `integration` — needs `DATABASE_URL`, own database per file   |
| `packages/*/tests/adversarial/**/*.adv.test.ts` | `adversarial`                                                 |
| `tests/support/` (repo root)                    | cross-package harness, imported as `@oa-test/*`               |

Four things about it are easy to trip over:

- **Every suite is declared through `suite(cls, …)` / `suiteRequiring(cls, …, probe, …)`** from
  `@oa-test/classification`, with `cls` one of `ci` / `nightly` / `manual`. A bare `describe` is a
  violation the guard reports — the class is what makes a log say what a run covered.
- **The counts in `tests/support/suite-inventory.ts` are exact, not minima.** Adding or removing a test
  file _or a test_ means updating `expectedFiles` / `expectedTests` in the same commit. The failure
  message states the number to write. `globalSetup` checks the files before the run; a reporter plus the
  `globalSetup` teardown check the **executed** test counts after it (JR-105c, findings F14/F15).
- **A green run can be a disabled run** — the reason all of the above exists. Quote test counts, not
  just "green": a full local run is `383 passed | 2 skipped` at 28 files (274 before E2 started; the
  ledger encoding, schema, trigger and writer added the rest). A run narrowed with `-t`, a file filter,
  `--project` or `--shard` prints `verified NOTHING` and checks no counts.
- **Integration tests acquire a real database** via `acquireTestDatabase()` in the **module scope**, and
  the harness records it in a per-run ledger so the main process can announce and drop anything a
  failed teardown left behind. Details and the required env vars: `docs/dev/journaling/04-testplan.md`
  §2.2 and §2.6.

`packages/backend/src/iam-policy/test-policies/*.json` are still unreferenced fixtures.
`CONTRIBUTING.md` asks for tests, and now there is somewhere to put them.

### 5.2 Database migrations are generated, never hand-written

Drizzle ORM + `postgres-js`. Schema files in `packages/backend/src/database/schema/*.ts`, re-exported
by the barrel `packages/backend/src/database/schema.ts` — **a new schema file must be added to the
barrel or drizzle-kit will not see it.**

Workflow: edit schema → `pnpm db:generate` → review the emitted `src/database/migrations/NNNN_*.sql`
**and** the `migrations/meta/NNNN_snapshot.json` → commit both. Never edit an applied migration; add
a new one. There is no down-migration mechanism.

`docker/docker-entrypoint.sh` runs `pnpm install --prod && pnpm db:migrate` before starting the app,
so a broken migration breaks container startup.

### 5.3 Every user-facing string costs 11 files — twice

Two independent i18n systems, 11 languages each (`en, de, es, fr, it, pt, nl, ja, et, el, bg`):

- **Frontend**: `sveltekit-i18n`, `packages/frontend/src/lib/translations/<lang>.json`, single
  top-level `app` key, used as `$t('app.section.key')`. Config in `translations/index.ts`.
- **Backend**: `i18next` + `i18next-fs-backend`, `packages/backend/src/locales/<lang>/translation.json`,
  top-level keys `iam`, `errors`, `auth`, `user`, …, used as `req.t('errors.key')`. Copied to `dist`
  by the `copy-assets` build step — forgetting it means missing strings in production only.

Adding a key to `en` alone is incomplete work. See `.claude/skills/oa-i18n/SKILL.md`.

### 5.4 Permission vocabulary is duplicated across three places

Authorization is CASL (`@casl/ability`). Roles are **database rows** with a JSONB `policies` column,
not an enum. The vocabulary lives in three places:

1. `packages/types/src/iam.types.ts` — `AppActions`, `AppSubjects`, `CaslPolicy` (source of truth)
2. `packages/backend/src/iam-policy/policy-validator.ts` — hardcoded `validActions`/`validSubjects`
   Sets that must mirror (1)
3. `docs/services/iam-service/iam-policy.md` — the human-facing reference

**All three now agree** — 8 actions (including `export`) and 7 subjects, verified by comparing the
three lists mechanically. `JR-1312` fixed (3) on 2026-07-30; until then it omitted `export` and
wrongly described `manage` as expanding to `create/read/update/delete/search/sync`. CASL's `manage`
is a **true wildcard**: it matches any action on the subject, including `export` and any action added
later (measured against the built code, not inferred). If you touch the vocabulary, update all three.

Key helpers: `AuthorizationService.can()`, `IamService.getAbilityForUser()`, and
`FilterBuilder.create(userId, resourceType, action)` → `{ drizzleFilter, searchFilter }` for
**row-level** scoping. Middleware `requireAuth` / `requirePermission` is coarse-grained only — it
never passes a resource object, so per-row checks must go through `FilterBuilder`.

Frontend has **no** permission helper and **no** nav filtering: `routes/dashboard/+layout.svelte`
renders a static `baseNavItems`/`enterpriseNavItems` array, so restricted users see menu entries
that 403. Any new role needs frontend work too.

### 5.5 Storage paths and hashing

`StorageService` (`packages/backend/src/services/StorageService.ts`) implements `IStorageProvider`
(`put`/`get`/`delete`/`exists`, plus `getStream`) over `S3StorageProvider` or
`LocalFileSystemProvider`, and **transparently encrypts at rest** (AES-256-CBC, magic prefix
`oa_enc_idf_v1::` + 16-byte IV) when `STORAGE_ENCRYPTION_KEY` is set.

> Hashing order matters: existing hashes (`archived_emails.storage_hash_sha256`,
> `attachments.content_hash_sha256`) are computed over the **plaintext** bytes, before encryption,
> so they can be verified against a re-export. Preserve that ordering.

Paths are keyed by source **ID**, never name:
`${folder}/${rootSourceId}/emails/<path><name>.eml` and `.../attachments/<7charUUID>-<name>`.
Use the clamping helpers (`buildEmailFileName`, `clampPathSegment`, `buildAttachmentFileName`,
`truncateToBytes`) — filesystem 255-byte limits have already caused bugs (#405, #409).

### 5.6 Config is read ad hoc and throws at import time

No central validated config. `packages/backend/src/config/index.ts` aggregates
`{ storage, app, search, meili, indexing, redis, api }`; several of those modules `throw` on missing
env vars **at import**, so a missing var surfaces as an import-time crash, not a startup message.
`zod` is already a backend dependency (used in `integrity.controller.ts`) — prefer it for new config
validation. There is also DB-backed runtime config: table `system_settings` via `SettingsService`.

### 5.7 API and service shape

Express 5. `createServer` does manual DI, then mounts 14 routers under `/${config.api.version}`.
Each `api/routes/*.routes.ts` exports a `createXRouter(controller?, authService)` factory, applies
`requireAuth`, then per-route `requirePermission(...)`. Controllers are classes with
arrow-function properties; user-facing errors go through `req.t('…')`. OpenAPI is generated from
inline `@openapi` JSDoc via `pnpm docs:gen-spec`.

Frontend reaches the backend through the proxy `routes/api/[...slug]/+server.ts` with the
auth-injecting wrapper `src/lib/server/api.ts` (base `/api/v1`).

## 6. Reuse before you write

| Need                            | Use                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store + hash + dedupe an email  | `IngestionService.processEmail()` — three-gate dedup, storage paths, hashing                                                                                                                |
| Duplicate check                 | `IngestionService.doesEmailExist(messageId, sourceId, userEmail)`                                                                                                                           |
| Read/write archived bytes       | `StorageService` (never a provider directly)                                                                                                                                                |
| Buffer a large EML off-heap     | `writeEmailToTempFile()` in `services/ingestion-connectors/helpers/tempFile.ts`                                                                                                             |
| Index documents                 | `IndexingService.indexEmailBatch(emails: PendingEmail[])`                                                                                                                                   |
| Search / filters                | `SearchService`, `FilterBuilder`, `helpers/{meiliFilter,mongoToMeli,mongoToDrizzle}.ts`                                                                                                     |
| Row-level access scoping        | `FilterBuilder.create()`                                                                                                                                                                    |
| Verify a stored email's hash    | `IntegrityService.checkEmailIntegrity(emailId)`                                                                                                                                             |
| Extract text from an attachment | `helpers/textExtractor.ts` `extractText(buffer, mimeType)` (Tika when `TIKA_URL` set)                                                                                                       |
| A new mail source               | implement `IEmailConnector`; register in **three** places — the `IngestionCredentials` union in types, `ingestionProviderEnum` in the Drizzle schema, and the `EmailProviderFactory` switch |

## 7. Git

`claude/enterprise-product-implementation-cxmmqe` is the **integration branch** for the journaling
project — not a working branch. Each epic gets its own branch off it. Full rules in
`docs/dev/journaling/05-entscheidungen.md` (ADR-014).

|                                               |                                                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Epic work                                     | branch off the integration branch as `claude/journaling-e<N>-<shortname>` (e.g. `claude/journaling-e1-test-foundation`) |
| Groundwork (docs, ADRs, agent infrastructure) | commit directly on the integration branch                                                                               |
| Merge back                                    | into the integration branch, only after the `tester` role has independently accepted the epic                           |
| Upstream drift                                | merge `main` into the **integration branch** only, never into an epic branch                                            |
| `main`                                        | **do not touch until E12 is accepted.** Never push to it                                                                |
| Pull requests                                 | none unless explicitly asked                                                                                            |

> **Check your local state against the remote before you start.** This container has been rolled back
> to an older commit at least once while looking entirely normal — clean worktree, `node_modules`
> present, recent files on disk — and the **reflog did not show the missing commits**, because they
> never existed locally. Run `git log --oneline -1` and compare with
> `git ls-remote origin refs/heads/<branch>`. If they differ, `git merge --ff-only origin/<branch>`
> before doing anything else. Use `--ff-only`, not `reset --hard`: it fails loudly if the history has
> genuinely diverged instead of silently discarding work.

- `git push -u origin <branch>`; retry network failures with backoff.
- Run `pnpm lint` before committing — Prettier covers `.ts`, `.svelte`, `.json`, and `.md`. `JR-105a`
  made the repository lint-clean on 2026-07-28.
    > **On Windows it is red anyway, and that is not your doing.** With no `.gitattributes` in the
    > repository and Git-for-Windows' default `core.autocrlf=true`, every text file is checked out with
    > CRLF while Prettier defaults to `endOfLine: "lf"` — so `pnpm lint` reports ~388 files. The index and
    > `origin` hold LF; nothing is actually misformatted. **Never "fix" this with `prettier --write`** —
    > that rewrites the whole repository. Check your own files instead:
    > `corepack pnpm exec prettier --check <paths>`. Tracked as **F35** in
    > `docs/dev/journaling/09-befunde-bestandscode.md` with a proposed fix.
- `pnpm` may not be on `PATH` on a Windows host. `corepack pnpm …` runs the pinned 10.13.1.

> **Do not remove `srcExclude: ['dev/**']`from`docs/.vitepress/config.mts`.** VitePress turns every
`.md`file under`docs/`into a published page and the local search provider indexes it — leaving a
page out of the`sidebar` only makes it unlinked, not unpublished. That entry is what keeps the
> internal planning documents, gap analysis, and risk list off the public docs site.

## 8. Agent infrastructure in this repo

| Path                                     | Purpose                                                         |
| ---------------------------------------- | --------------------------------------------------------------- |
| `.claude/agents/senior-dev.md`           | Implementation role: conventions, reuse duties, non-negotiables |
| `.claude/agents/tester.md`               | Test role: adversarial posture, harness rules, reporting        |
| `.claude/skills/journal-ledger/SKILL.md` | The journaling acceptance contract and ledger invariants        |
| `.claude/skills/oa-migration/SKILL.md`   | Drizzle migration workflow                                      |
| `.claude/skills/oa-i18n/SKILL.md`        | Adding strings across both i18n systems                         |
| `docs/dev/journaling/`                   | Project memory for the journaling receiver (German)             |
