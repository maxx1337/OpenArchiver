---
name: oa-i18n
description: How to add or change user-facing strings in Open Archiver across its two independent i18n systems and 11 languages. Use whenever adding UI text in packages/frontend, an API error message in packages/backend, or when a translation key renders as a raw key, appears in English only, or goes missing in production but works in dev.
---

# Adding User-Facing Strings

Open Archiver has **two independent i18n systems**, each with **11 languages**. A string added to
English only is incomplete work — it renders as the raw key or falls back visibly for every other
locale.

Languages: `en, de, es, fr, it, pt, nl, ja, et, el, bg`

## Which system?

| Where the string is shown    | System                           | Files                                                  |
| ---------------------------- | -------------------------------- | ------------------------------------------------------ |
| Any Svelte component or page | `sveltekit-i18n`                 | `packages/frontend/src/lib/translations/<lang>.json`   |
| API error / response message | `i18next` + `i18next-fs-backend` | `packages/backend/src/locales/<lang>/translation.json` |

They share no keys and no tooling. If a feature has both a UI and API errors, you are editing
**22 files**.

## Frontend: `sveltekit-i18n`

Structure: each locale file has exactly one top-level key, `app`. The loader in
`packages/frontend/src/lib/translations/index.ts` returns `<lang>.app` under the namespace `app`, so
a key nested at `app.journaling.title` is used as:

```svelte
{$t('app.journaling.title')}
```

Existing sections under `app` (use one of these; only create a new section for a genuinely new
feature area):

`auth` · `common` · `archive` · `ingestions` · `search` · `roles` · `account` · `system_settings` ·
`users` · `components` · `setup` · `layout` · `api_keys_page` · `archived_emails_page` ·
`dashboard_page` · `retention_policies` · `retention_labels` · `archive_labels` · `legal_holds` ·
`archive_legal_holds` · `audit_log` · `jobs` · `index_admin` · `journaling` · `security`

Conventions:

- `snake_case` for keys, matching the existing files.
- Reuse `app.common.*` for generic labels (Save, Cancel, Delete) instead of duplicating them.
- Interpolation uses sveltekit-i18n's `{placeholder}` syntax — check a neighbouring key with a
  parameter before inventing a format.
- Adding a **new language** means touching `index.ts` too (import + loader entry). Adding a key to an
  existing language does not.

## Backend: `i18next`

One directory per language, one `translation.json` each. Top-level namespaces:
`auth` · `errors` · `user` · `iam` · `settings` · `dashboard` · `ingestion` · `archivedEmail` ·
`search` · `storage` · `apiKeys` · `api` · `upload`

Used in controllers via the request-scoped `t`:

```ts
res.status(400).json({ message: req.t('errors.invalidPayload') });
```

Conventions:

- `camelCase` for keys here — **different from the frontend's snake_case.** Match the file you are in.
- The active default language comes from system settings, not from the request alone.

### The production-only trap

`packages/backend/package.json` has a `copy-assets` step:

```json
"build": "tsc && pnpm copy-assets",
"copy-assets": "cp -r src/locales dist/locales"
```

Locales are **copied**, not compiled. So:

- In dev (`ts-node-dev`), a new string works immediately from `src/`.
- In production (`node dist/…`), it only works after a rebuild.

If a backend string is missing in a container but fine locally, the build step is the first suspect.

## Workflow

1. Decide the system (frontend vs backend) and the existing section to nest under.
2. Add the key to `en` first — that is the reference wording.
3. Add it to the remaining 10 locale files. Provide a real translation where you can; where you
   cannot, use the English text as a deliberate placeholder rather than omitting the key — a present
   English string degrades better than a raw key on screen.
4. Keep key ordering and nesting identical across all 11 files. Divergent structure makes future
   diffs unreadable.
5. `pnpm lint` — Prettier formats JSON and will fail CI-style checks on indentation drift.
6. Verify: switch the UI language, or call the endpoint with an `Accept-Language` header.

## Checklist

- [ ] Correct system chosen; correct casing convention for that system.
- [ ] Key present in **all 11** locale files, with identical nesting and ordering.
- [ ] Reused `app.common.*` / an existing namespace rather than duplicating a generic label.
- [ ] `index.ts` touched only if a new _language_ was added.
- [ ] Backend strings verified against a built `dist` if the change is going to a container.
- [ ] `pnpm lint` passes.
