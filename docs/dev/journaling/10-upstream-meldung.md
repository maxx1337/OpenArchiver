# Upstream-Meldung — Entwurf (`JR-1308`)

> **Status: ENTWURF. NICHT VERSENDET. NICHT VERÖFFENTLICHEN.**
>
> Diese Datei enthält Beschreibungen **nicht behobener** Sicherheitslücken in der öffentlich
> veröffentlichten Version 0.5.2 des Upstream-Projekts, einschließlich einer funktionierenden
> Injection-Nutzlast. Sie liegt unter `docs/dev/journaling/` und ist damit über
> `srcExclude: ['dev/**']` von der Doku-Website ausgeschlossen — **das muss so bleiben.**
>
> **Kanal, Zeitpunkt und Absender entscheidet der Auftraggeber, nicht ein Agent.** Kein Agent
> versendet diesen Text, öffnet damit ein Issue, kommentiert ihn in ein Repository oder legt einen
> Pull Request an. Das Akzeptanzkriterium von `JR-1308` lautet ausdrücklich: „Entwurf liegt vor und
> ist **nicht** versendet."

## Worum es geht

Open Archiver ist ein AGPL-3.0-Projekt (`LogicLabs-OU/OpenArchiver`). Die vier Befunde, die E13 in
diesem Fork behoben hat, betreffen **Bestandscode**, nicht unseren Journaling-Aufsatz — sie existieren
also in der veröffentlichten Version 0.5.2 weiter, solange sie dort nicht gemeldet und behoben werden.

Der schwerste davon, **F7**, kehrt die Wirkung einer restriktiven Autorisierungs-Policy ins Gegenteil:
eine Rolle, deren einziger Zweck ein Verbot ist, erteilt Vollzugriff auf das Archiv. Das ist aus einer
**eingeschränkten** Rolle heraus erreichbar und braucht keine Administratorrechte.

## Entscheidungsbedarf beim Auftraggeber

| Frage                   | Anmerkung                                                                                                                                                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kanal**               | Das Repository hat keine `SECURITY.md` mit Kontaktadresse — vor dem Versenden prüfen, ob inzwischen eine existiert. Ohne privaten Kanal ist ein **GitHub Security Advisory** (privat, `/security/advisories/new`) der richtige Weg, **nicht** ein öffentliches Issue. |
| **Zeitpunkt**           | Übliche Praxis: nichtöffentlich melden, Frist setzen (90 Tage sind verbreitet), erst danach veröffentlichen. Der Fix ist in diesem Fork bereits geschrieben und kann als Patch beigelegt werden — das verkürzt die Reaktionszeit erheblich.                           |
| **Absender**            | Namentlich oder über die Organisation? Betrifft auch, ob eine CVE beantragt wird.                                                                                                                                                                                     |
| **Umfang der Nutzlast** | Der Abschnitt „Proof of concept" zu Punkt 2 enthält eine funktionierende Injection. In einer privaten Meldung ist das angemessen und hilfreich. Falls die Meldung öffentlich erfolgt, **vorher entfernen**.                                                           |
| **F17 mitmelden?**      | F17 ist keine Lücke, sondern ein Produktfehler (zwei mitgelieferte Rollen werden nie angelegt). Er verstärkt F7 praktisch. Empfehlung: mitmelden, aber getrennt als Bug, nicht als Teil des Advisories.                                                               |

---

## Entwurf des Meldetexts (englisch, so wie er versendet würde)

### Subject

Fail-open authorization: a restrictive CASL policy grants unrestricted archive access (0.5.2)

### Summary

`FilterBuilder.create()` maps "no rule grants this action on this subject" and "unrestricted access"
onto the **same** return value, and the unsafe one is the default. As a result a role whose only
purpose is to _forbid_ archive access grants unrestricted access to the entire archive, and a user
with no role at all sees every row.

Three further defects in the same code path are described below. All four are reachable in released
version **0.5.2**; we have not tested earlier versions, but the relevant code is unchanged since the
`FilterBuilder` was introduced.

We have fixed all four in a fork and are happy to supply the patches. No public disclosure has been
made.

### 1. Fail-open when no `can` rule matches (most severe)

**File:** `packages/backend/src/services/FilterBuilder.ts`

`rulesToQuery()` from `@casl/ability/extra` returns `null` when the rule list for
(action, subject) contains no non-inverted rule — both when there is no rule at all and when there
are only `cannot` rules. That `null` is mapped to `{ drizzleFilter: undefined, searchFilter: undefined }`,
commented "Full access":

```ts
if (query === null) {
	return { drizzleFilter: undefined, searchFilter: undefined }; // Full access
}

if (Object.keys(query).length === 0) {
	return { drizzleFilter: sql`1=0`, searchFilter: 'ingestionSourceId = "-1"' }; // No access
}
```

The immediately following branch handles the _empty_ query correctly, so the "no access" case was
clearly understood — the `null` case is simply inverted.

**Two confirmed instances:**

- A user with **no role** receives `undefined`, and every caller reads `undefined` as "no
  restriction".
- A policy consisting **only** of `cannot` rules on `archive` — the natural shape for "this auditor
  may see everything except mailbox X" — yields unrestricted access. The explicitly forbidden rows
  come back.

**Why the middleware does not save you:** `requirePermission` never passes a resource object, so
conditional rules always pass the gate. Additionally, `GET /search` and `GET /search/facets` check
`('search', 'archive')` while `SearchService` built its filter for `('read', 'archive')`, so a role
with `search` but not `read` passed the gate and then received an unfiltered search across the whole
archive.

**Impact:** any deployment that relies on a scope-restricted role for archive access. Since the two
non-admin default roles are never actually created (see the separate note at the end), every
restricted role in a real deployment is hand-written — and the natural hand-written shape is exactly
the one that fails.

**Our fix:** treat `null` as **deny** (``sql`1=0` ``, reusing the existing "no access" branch), and
return unrestricted only for a demonstrably **unconditional** `can`. Align the action used for the
filter with the action the route authorized. Two further shapes need the same treatment: an
unconditional `cannot` (currently ignored entirely), and a `can` whose `conditions` is an empty
object — `rulesToQuery` produces `{ $or: [ {} ] }`, which has one key and therefore misses the
empty-query deny branch.

### 2. SQL injection through policy condition keys

**File:** `packages/backend/src/helpers/mongoToDrizzle.ts`

Condition keys are interpolated into the identifier position of the generated SQL. Escaping is
applied, but a key containing a quote can still terminate the identifier and append arbitrary
predicates.

**Proof of concept** — as a policy condition key on a role:

```
userEmail" is not null or "id" is not null or "userEmail
```

renders as

```sql
"user_email" is not null or "id" is not null or "user_email" = $1
```

which returns every row. We tested four payload shapes against real PostgreSQL; three failed on a
type error or on `--` swallowing the closing parenthesis, and **one ran**. A PostgreSQL error in a log
is therefore not evidence of containment.

Aggravating factor: drizzle's `and()` does not parenthesize its operands, so the injected `or` also
defeats the **caller's** own restriction, not just the policy's.

**Prerequisite:** permission to create or update roles, i.e. an administrator. That limits severity —
but an administrator is not supposed to be able to reach arbitrary SQL either, and the same key
travels through a `sql.raw` path in the relation branch.

**Our fix:** validate condition keys against an **allowlist of shapes** instead of escaping them (a
single identifier, or `<relation>.<identifier>` with a known relation) and remove `sql.raw` from the
relation branch. Reject such policies in the validator at creation time as well, so they are never
stored.

### 3. Untranslatable conditions are silently dropped

**File:** `packages/backend/src/helpers/mongoToDrizzle.ts`

An unsupported operator does not raise — the condition disappears from the generated SQL. The
direction of the resulting error depends on where the branch sat, and the translator cannot tell:

- Inside the `$or` of a `can` rule, the filter becomes **narrower** (a functional defect: the stored
  policy means something other than it says).
- Inside the `$and` of negated `cannot` conditions, or when the disjunction sits under a `$not`, a
  dropped branch is a **dropped prohibition** — fail-open.
- When _all_ branches disappear, `or()`/`and()` over an empty list returns `undefined`, which callers
  read as "no restriction".

**Our fix:** refuse an untranslatable condition loudly instead of dropping it, and have callers treat
`undefined` as deny. Note that replacing a dropped branch with a never-true predicate is **not** a
safe alternative: under a `$not` it becomes `not(false)` = true, and the prohibition is gone anyway.

### 4. `cannot` exclusions with operator conditions do not exclude

**File:** `packages/backend/src/services/FilterBuilder.ts`

The exclusion for a `cannot` rule is built by wrapping each condition **value** in `$ne`:

```ts
newCondition[key] = { $ne: (condition as any)[key] };
```

If the value is itself an operator object, this produces `{ $ne: { $in: [...] } }`, which neither
translator understands — the Drizzle side emits an object as a bound parameter, the Meilisearch side
emits `!= [object Object]`. The exclusion the policy author wrote does not happen. Affects every
`cannot` condition using `$in`/`$nin`/`$gte`/… — that is, the expressive ones.

**Our fix:** negate at **query** level (`{ $not: condition }`) instead of wrapping values in `$ne`.

### Separately, not a vulnerability: the two non-admin default roles are never created

`createDefaultRoles()` — the only place that creates `predefined_end_user` and
`predefined_read_only_user` — has a single, conditional caller:

```ts
// api/controllers/iam.controller.ts, getRoles()
if (!roles.some((r) => r.slug?.includes('predefined_'))) {
	await this.createDefaultRoles();
}
```

During first-run setup, `createFirstAdmin()` calls `createAdminRole()`, which inserts a role with slug
**`predefined_super_admin`**. From that moment the condition is permanently false, so the bootstrap
never runs; and it cannot run earlier, because `GET /roles` is behind authentication and no user
exists before setup.

Consequence: a real deployment ships **no read-only role**. Every restricted user must be written by
hand, in the shape that defect 1 above defeats. Suggested fix: test for the specific missing slugs
rather than the `predefined_` prefix, or create the default roles in `createFirstAdmin()`.

### Affected versions

Confirmed on **0.5.2** (current release at the time of writing), verified against real PostgreSQL.
Earlier releases are untested, but the relevant code paths are unchanged in the published history.

### Coordination

We have not published any of this and will not do so without agreeing a timeline with you. Patches
for all four defects, plus regression tests against real PostgreSQL, can be supplied as a pull request
or as plain diffs, whichever you prefer.

---

## Interne Notizen zum Entwurf (nicht Teil der Meldung)

- Die Befunde entsprechen **F7** (Punkt 1, plus F19/F20 als weitere Formen), **F1** (Punkt 2),
  **F3** (Punkt 3, samt der Richtungskorrektur aus F22), **F8** (Punkt 4) und **F17** (Nachtrag) in
  `09-befunde-bestandscode.md`.
- Die Fixes liegen als `bcac6bd`, `a309fd1`, `45ac0e9`, `2311996`, `dcec017` auf
  `claude/journaling-e13-iam-hardening`; die roten Regressionstests davor in `f6a55c0` und `704e8d1`.
  Ein Patch-Set für Upstream lässt sich daraus erzeugen, ist aber **noch nicht** erstellt — es müsste
  von unseren Test-Harness-Abhängigkeiten (E1) getrennt werden, die Upstream nicht hat.
- **F2, F4, F5, F6, F9, F10** sind bewusst **nicht** Teil dieser Meldung: sie sind offen dokumentiert,
  aber in diesem Fork nicht behoben, und eine Meldung ohne Fix und ohne eigene Prüfung wäre dünn.
  Sollte der Auftraggeber sie mitmelden wollen, gehören sie in einen zweiten, klar getrennten Abschnitt.
- Zur Formulierung: der Entwurf behauptet nichts über Ausnutzbarkeit, was nicht gegen echtes
  PostgreSQL geprüft wurde, und nennt bei Punkt 2 die Voraussetzung (Administratorrechte) ausdrücklich,
  statt die Schwere zu überzeichnen.
