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

| Path                 | Package name              | Role                                                                          |
| -------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `packages/types`     | `@open-archiver/types`    | Shared contract package. Types-only, MIT. **Changes here ripple everywhere.** |
| `packages/backend`   | `@open-archiver/backend`  | Express 5 API, services, Drizzle schema, BullMQ workers                       |
| `packages/frontend`  | `@open-archiver/frontend` | SvelteKit 2 / Svelte 5 (runes), Tailwind 4, bits-ui                           |
| `apps/open-archiver` | `open-archiver-app`       | Thin entrypoint: `createServer([])` + `listen`                                |
| `docs/`              | —                         | VitePress site. Sidebar is **explicit** in `docs/.vitepress/config.mts`       |

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
pnpm lint                 # prettier --check .   (CI does NOT run this — run it yourself)
pnpm format               # prettier --write .
pnpm db:generate          # drizzle-kit generate — creates a new migration
pnpm db:migrate           # apply migrations (compiled); db:migrate:dev for ts-node-dev
pnpm docs:dev             # VitePress on :3009 (regenerates the OpenAPI spec first)
pnpm --filter @open-archiver/frontend check   # svelte-check
```

All root scripts are wrapped in `dotenv -- …`, so they read the root `.env`. `.env.example` is the
authoritative env-var list.

## 5. Non-obvious conventions

### 5.1 There are no tests

**Zero test files, no test runner, no test script anywhere in this repo.** No vitest, jest, or
playwright. CI (`.github/workflows/`) has only `cla`, `deploy-docs`, `docker-deployment`,
`release-tag` — no lint, typecheck, or test job. `CONTRIBUTING.md` asks for tests aspirationally.

If your task needs tests, you are also building the harness. `packages/backend/src/iam-policy/test-policies/*.json`
are unreferenced fixtures — the intended input for a policy test suite that was never written.
`PolicyValidator`, `createAbilityFor`, and `FilterBuilder` are pure/near-pure and are the obvious
first targets.

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

### 5.4 Permission vocabulary is duplicated and the docs are stale

Authorization is CASL (`@casl/ability`). Roles are **database rows** with a JSONB `policies` column,
not an enum. The vocabulary lives in three places:

1. `packages/types/src/iam.types.ts` — `AppActions`, `AppSubjects`, `CaslPolicy` (source of truth)
2. `packages/backend/src/iam-policy/policy-validator.ts` — hardcoded `validActions`/`validSubjects`
   Sets that must mirror (1)
3. `docs/services/iam-service/iam-policy.md` — the human-facing reference

(1) and (2) currently agree (both include `export`). **(3) is stale**: it omits `export` from the
action list and wrongly enumerates `manage` as expanding to
`create/read/update/delete/search/sync` — CASL's `manage` is a true wildcard and covers `export`
too. If you touch the vocabulary, update all three.

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
