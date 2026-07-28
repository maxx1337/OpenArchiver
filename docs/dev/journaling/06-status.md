# Status

**Diese Datei ist die verbindliche Fortschrittsquelle.** Sie wird am Ende **jeder** Session
aktualisiert — auch wenn nichts fertig wurde. Ein nicht aktualisierter Status ist schlimmer als
keiner, weil er Fortschritt behauptet, der nicht existiert.

Legende: `[ ]` offen · `[~]` in Arbeit · `[x]` fertig und abgenommen · `[!]` blockiert

**Letzte Aktualisierung:** 2026-07-28 · **Branch:** `claude/journaling-e1-test-foundation`

---

## Gesamtübersicht

| Epic | Titel                              | Status     | Fertig / Gesamt |
| ---- | ---------------------------------- | ---------- | --------------- |
| E0   | Planung, Doku, Agent-Infrastruktur | **fertig** | 6 / 6           |
| E1   | Test- und CI-Fundament             | in Arbeit  | 4 / 7           |
| E2   | Ledger und Hash-Chain              | offen      | 0 / 10          |
| E3   | Spool und Acceptance-Contract      | offen      | 0 / 8           |
| E4   | `smtp-ingress`-Service             | offen      | 0 / 13          |
| E5   | Journal-Report-Parser              | offen      | 0 / 9           |
| E6   | Phase-B-Worker                     | offen      | 0 / 8           |
| E7   | WORM-Storage                       | offen      | 0 / 6           |
| E8   | Anchoring                          | offen      | 0 / 6           |
| E9   | `verify`-CLI                       | offen      | 0 / 8           |
| E10  | Completeness-Monitoring            | offen      | 0 / 8           |
| E11  | Compliance-Features                | offen      | 0 / 10          |
| E12  | Rollout und Dokumentation          | offen      | 0 / 9           |

**Produktionscode für den Receiver: keiner.** E0 hat ausschließlich Dokumentation und
Agent-Infrastruktur geliefert (ADR-001).

---

## E0 — Planung, Doku, Agent-Infrastruktur (fertig)

|     | Ergebnis                                                              | Datei                     |
| --- | --------------------------------------------------------------------- | ------------------------- |
| [x] | Codebase-Analyse und Gap-Analyse gegen den RFC                        | `01-gap-analyse.md`       |
| [x] | Zielarchitektur inkl. Prozess- und Credential-Topologie               | `02-architektur.md`       |
| [x] | Backlog E1–E12 mit 102 Tasks, Rollen, Akzeptanzkriterien              | `03-backlog.md`           |
| [x] | Testplan mit RFC-§12-Mapping und CI/Nightly/Manual-Einteilung         | `04-testplan.md`          |
| [x] | ADR-Log: 7 entschieden, 6 offen, 1 verworfen                          | `05-entscheidungen.md`    |
| [x] | Agent-Infrastruktur: `CLAUDE.md`, 2 Subagent-Rollen, 3 Projekt-Skills | `CLAUDE.md`, `.claude/**` |

### Zentrale Befunde aus E0

1. **Der Enterprise-SMTP-Listener ist Closed Source und in diesem Repository nicht vorhanden.** Nur
   Schema, Typen, Frontend-Formular, i18n-Strings, Env-Variablen und eine Doku-Seite, die abwesenden
   Code beschreibt. `apps/open-archiver-enterprise` und `packages/enterprise` fehlen.
2. **Der dokumentierte Enterprise-Ablauf erfüllt RFC §3 nicht** (Tempfile + BullMQ-Enqueue statt
   fsync'd Spool + Ledger vor `250`). Der Receiver wird daher direkt RFC-konform neu gebaut.
3. **Null Tests und kein Test-Runner im gesamten Repository.** Deshalb ist E1 das erste Epic.
4. **Doku-Drift im IAM:** `docs/services/iam-service/iam-policy.md` listet die Action `export` nicht
   und beschreibt `manage` falsch. Der **Code ist korrekt** — `iam.types.ts` und
   `iam-policy/policy-validator.ts` enthalten beide `export`. Behebung in `JR-1103`.
5. Kein CLI im Repository — `verify` (E9) baut die Basis mit `node:util` `parseArgs`, ohne neue
   Dependency.
6. **ADR-004 war falsch und hätte die internen Dokumente veröffentlicht.** VitePress baut ohne
   `srcExclude` jede `.md` unter `docs/` zu einer Seite, und `search.provider: 'local'` indexiert
   sie — die Sidebar hat damit nichts zu tun. Behoben durch `srcExclude: ['dev/**']` in
   `docs/.vitepress/config.mts`. Nie wirksam geworden, weil nichts auf `main` liegt.
   **Nachweis erbracht:** `pnpm docs:build` läuft durch, `dist/dev/` existiert nicht, kein Satz aus
   `08-risiken.md` im Suchindex; Gegenkontrolle über `dist/SUMMARY.html` (nicht in der Sidebar, aber
   30 KB gebaut und indexiert) belegt den Mechanismus.

---

## E1 — Test- und CI-Fundament (in Arbeit)

|     | Task                                                                                           | Rolle |
| --- | ---------------------------------------------------------------------------------------------- | ----- |
| [x] | JR-101 vitest im Monorepo einrichten                                                           | TEST  |
| [x] | JR-102 Testkonventionen festlegen und dokumentieren                                            | TEST  |
| [x] | JR-103 Unit-Tests auf `PolicyValidator` / `createAbilityFor` (ohne `FilterBuilder`, s. u.)     | TEST  |
| [~] | JR-104 Integrationstest-Basis mit isolierter Postgres-Instanz — **geschrieben, Abnahme offen** | TEST  |
| [x] | JR-105a Formatierungs-Commit (`pnpm format`) — **Vorbedingung für JR-105**                     | DEV   |
| [ ] | JR-105 CI-Workflow: Lint, Build, `svelte-check`, Tests                                         | DEV   |
| [ ] | JR-106 Abnahme E1                                                                              | PO    |

**`JR-105a` erledigt (2026-07-27).** `pnpm lint` ist repo-weit grün, inklusive `.svelte`. Von den 13
beanstandeten Dateien wurden die **7 handgeschriebenen** formatiert (1 `.md`, 3 `.ts`, 3 `.svelte`);
die **6 generierten** gingen laut **ADR-015** in `.prettierignore` statt in den Commit, weil beide
Generatoren empirisch belegt mit `JSON.stringify(…, null, 2)` zurückschreiben und jede Formatierung
sofort überschreiben. Gegenprobe: nach `docs:gen-spec` **und** einem erzwungenen
`drizzle-kit generate` bleibt `pnpm lint` grün — das Akzeptanzkriterium ist damit erfüllt.

Nachweise: `pnpm lint` grün · `pnpm --filter @open-archiver/frontend check` 0 Fehler / 0 Warnungen ·
`pnpm --filter @open-archiver/backend build` erfolgreich · Token-Stream-Vergleich der drei `.ts`-Dateien
vor/nach Formatierung identisch (nur Whitespace, Quotes, `es5`-Trailing-Commas), Diffs der drei
`.svelte`-Dateien und der `.md`-Tabelle manuell geprüft — keine Logikänderung.

Einschränkung: `pnpm db:generate` ist im Container nicht lauffähig (kein `DATABASE_URL`, keine `.env`,
kein Postgres). Der drizzle-Nachweis lief über einen direkten `drizzle-kit generate`-Aufruf mit
Dummy-`DATABASE_URL`; Details und Bewertung in ADR-015.

Formal offen: die Abnahme von `JR-105a` gehört zu `JR-106` (Rolle PO).

### JR-101 erledigt (2026-07-27) — vitest im Monorepo

`vitest@3.2.7` als Root-devDependency, dazu `vite@^5.4.19` **explizit** deklariert. Grund: das
zunächst installierte `vitest@4` verlangt `vite >= 6` und band sich still an die aus `vitepress`
gehoistete `vite@5.4.19` (unmet peer). `vitest@3.2` unterstützt `vite ^5 || ^6` und braucht keinen
zweiten Vite-Major im Repo. Der Peer ist jetzt deklariert statt geerbt.

Eine Konfigurationsdatei: `vitest.config.ts` in der Wurzel mit `test.projects` = drei Suites
`unit` / `integration` / `adversarial`. **Abweichung von der Task-Formulierung** („Workspace-Configs
für `packages/backend`, `packages/types`"): kein Config-File pro Paket. Die Suite-Trennung ist
global; pro Paket eigene Projects zu definieren würde eindeutige Projektnamen je Paket erzwingen
(`backend:unit`, …) und die DB-Gate-Logik vervielfachen. Die Include-Globs zeigen auf `packages/*`,
`packages/types` und ein späteres `packages/journaling` werden also ohne Config-Änderung gefunden.
`test`-Scripts: Wurzel (`test`, `test:unit`, `test:integration`, `test:adversarial`, `test:nightly`,
`test:manual`, `test:watch`) und `packages/backend` (`test`, `test:watch`, `test:types`).

Nachweise:

- `pnpm test` von der Wurzel: **4 Dateien grün, 1 übersprungen; 149 Tests grün, 5 übersprungen**,
  Exit-Code `0`.
- Exit-Code bei Fehlschlag **aktiv geprüft**, nicht behauptet: eine Assertion invertiert
  (`export` sei ungültig) ⇒ `1 failed | 148 passed`, `EXIT=1`; danach zurückgebaut, wieder `0`.
- `pnpm --filter @open-archiver/backend test` findet nur die Backend-Tests (154).
- `integration` ohne Postgres: `↓ … (3 tests | 3 skipped)` plus
  `[TEST-COVERAGE NOTICE] SKIPPED SUITE [ci] Postgres reachability …: DATABASE_URL is not set (no .env
in this environment)`. Übersprungen mit sichtbarem Grund, nicht als grün getarnt.
- Kein bestehender Produktionscode geändert. Angefasst wurden nur `package.json` (Scripts),
  `packages/backend/package.json` (Scripts + `vitest` als devDependency) und
  `packages/backend/tsconfig.json` — dort ein `exclude` für `src/**/*.test.ts` und `tests`, damit
  Testdateien nicht nach `dist` gelangen. Gegenprobe: `pnpm --filter @open-archiver/backend build`
  grün, `find packages/backend/dist -name '*.test.*'` leer.
- Typprüfung der Tests über das neue `packages/backend/tsconfig.test.json`
  (`pnpm --filter @open-archiver/backend test:types`, grün).

### JR-102 erledigt (2026-07-27) — Konventionen

`04-testplan.md` §2 ist von einer Tabelle auf fünf Unterabschnitte erweitert (§2.1 Orte,
§2.2 Suites, §2.3 Klassifizierung, §2.4 Seeds, §2.5 Coverage-Hinweise), jede Zeile mit einem
lauffähigen Beispiel im Repo. Die Klassifizierung ist **im Test sichtbar**: `suite('ci', …)` aus
`@oa-test/classification` präfigiert den berichteten Suite-Namen mit `[ci]`/`[nightly]`/`[manual]`.

Zwei Konventionen aus dem Entwurf wurden geändert, weil sie beim Bauen nicht trugen:

1. **`tests/support/` ergänzt** (Wurzel für paketübergreifende Helfer, Alias `@oa-test/*`; Paket für
   paketspezifische). Ohne gemeinsamen Ort wird Klassifizierung, Seed-Pflicht und Infrastruktur-Probe
   pro Datei neu erfunden. Die Zweiteilung ist erzwungen: pnpm ist strikt, ein Wurzel-Helfer kann
   `drizzle-orm` nicht auflösen.
2. **Bestandsfixtures bleiben, wo sie sind.** `src/iam-policy/test-policies/*.json` wandern nicht
   nach `tests/fixtures/`; die Regel gilt für neue Fixtures.

Nachweise je Kategorie — alle drei Klassen **ausgeführt**, nicht nur konfiguriert:

- `ci` (Default): `pnpm test` ⇒ 149 grün.
- `nightly`: `pnpm test:nightly --project adversarial` ⇒ `[nightly] … 25000 seeded trees` grün in
  19,3 s; `[manual]` mit Begründung übersprungen.
- `manual`: `pnpm test:manual --project adversarial` ⇒ 33 750 Bäume in 30 s, `[ci]` und `[nightly]`
  mit Begründung übersprungen.
- Seed: `OA_TEST_SEED=12345 vitest run --project adversarial` ⇒
  `[TEST-COVERAGE NOTICE] SEED …: 12345 (pinned via OA_TEST_SEED)`. Ohne Pin wird der gezogene Seed
  samt Replay-Kommando ausgegeben.
- Stichprobe wird benannt: `ran 300 of 25000 iterations (sampled). The full run is the separate
variant "[nightly] …"` — Grundregel 6 maschinell umgesetzt.

### JR-103 erledigt (2026-07-27) — erste Unit-Tests

Drei Dateien, alle Klasse `ci`: `packages/backend/src/iam-policy/policy-validator.test.ts` (53
Fälle), `…/ability.test.ts` (38 Fälle), `packages/backend/src/helpers/mongoToDrizzle.test.ts` (55
Fälle). Zusammen **146 Testfälle**, davon 91 fixture-getrieben; 108 `expect()`-Aufrufstellen in den
beiden Fixture-Suites, zur Laufzeit durch `it.each` mehr.

**Die Fixtures werden tatsächlich von der Platte gelesen** — belegt, nicht behauptet:
`auditor-specific-sources.json` temporär umbenannt ⇒ `2 failed | 1 passed`, Exit `1`, Meldung
`IAM policy fixture "auditor-specific-sources" could not be read from …/test-policies/auditor-specific-sources.json`;
danach zurückbenannt, wieder grün. Der Loader wirft absichtlich hart statt zu überspringen.

Inhaltlich abgedeckt: `export` wird als Action **akzeptiert** (Ist-Zustand eingefroren, stützt
`JR-1103`); `manage` ist ein echtes Wildcard und deckt `export` mit; `admin.json` erlaubt alles;
`read-only-all.json` verweigert `create`/`update`/`delete`/`export`/`sync`/`manage` auf allen fünf
Subjects **und** auf konkreten Objekten; beide `auditor-*.json` greifen nur im Scope, jede
Schreibaktion abgewiesen; `mongoToDrizzle` mit Golden File über 26 Fälle plus Operator-, Logik- und
Spaltennamen-Suites.

**Nicht Teil von JR-103:** `FilterBuilder` und `mongoToMeli`. Beide hängen über `IamService` am
`db`-Singleton, das beim Import wirft — sie gehören zu `JR-104`. Der Task-Text von JR-103 nennt
`FilterBuilder`; das ist hier bewusst nicht erfüllt und in `JR-104` zu erledigen.

### JR-104 geschrieben (2026-07-28) — Integrationstest-Basis · **Abnahme offen**

**Nicht abgehakt.** Der Harness ist geschrieben und lokal gegen ein **echtes** Postgres grün; die
Abnahme setzt den CI-Lauf aus `JR-105` voraus und gehört zu `JR-106`.

Neue Dateien:

| Datei                                                           | Rolle                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------- |
| `packages/backend/tests/support/pg-harness.ts`                  | Datenbank je Aufruf, Migrationen, garantiertes Teardown |
| `packages/backend/tests/support/iam-seed.ts`                    | Nutzer/Rollen/Quellen/E-Mails säen, ohne `IamService`   |
| `packages/backend/tests/integration/pg-harness.int.test.ts`     | Der Harness beweist seinen eigenen Vertrag (11 Fälle)   |
| `packages/backend/tests/integration/filter-builder.int.test.ts` | `FilterBuilder` über echte Rollen (8 Fälle)             |
| `packages/backend/tests/integration/mongo-to-meli.int.test.ts`  | `mongoToMeli` inkl. DB-Zweig (10 Fälle)                 |

**Eigene Datenbank statt eigenem Schema — erzwungen, nicht gewählt.** `search_path`-Isolation
scheitert an den generierten Migrationen: drizzle-kit schreibt `CREATE TYPE "public"."…"` und
`REFERENCES "public"."…"`, `CREATE TABLE` dagegen unqualifiziert. Begründung mit Zeilenangaben in
`04-testplan.md` §2.6 und im Kopfkommentar des Harness.

**Verifikation in dieser Session — vollständiger als geplant.** Der Container hat kein Docker und
keinen laufenden Postgres, aber die Server-Binaries von PostgreSQL 16 liegen unter
`/usr/lib/postgresql/16/bin`. Damit wurde ein eigener Cluster gestartet (`initdb` + `pg_ctl`,
`127.0.0.1:5432`) und die Suite tatsächlich ausgeführt:

- `pnpm test:integration` ⇒ **32 Tests grün** in 4 Dateien.
- `pnpm test` von der Wurzel mit `DATABASE_URL` ⇒ **181 grün, 2 skipped**, Exit `0`.
- `pnpm test` ohne `DATABASE_URL` ⇒ Unit grün, `integration` **sichtbar übersprungen** mit Grund
  („DATABASE_URL is not set …"); mit gesetzter, aber toter URL lautet der Grund
  „no Postgres listening at 127.0.0.1:5599".
- **Zwei vollständige Läufe gleichzeitig** (`pnpm test:integration` doppelt, gleiche Startsekunde)
  ⇒ beide `exit=0`, 30/30 bzw. 30/30.
- Rückstandskontrolle nach jedem Lauf: `select … from pg_database where datname like 'oa\_test\_%'`
  ⇒ **0 Zeilen**.

**Weiterhin nicht verifiziert:** PostgreSQL **17** (CI-Ziel ist `postgres:17-alpine`, geprüft wurde
16.13), der GitHub-Actions-Lauf selbst, und Teardown nach `SIGKILL` des Workers. Letzteres deckt nur
der Sweeper ab; der Kill-Pfad braucht einen Kindprozess-Treiber und ist nicht Teil von JR-104.

**Ein eigener Defekt im Harness gefunden und behoben:** der Sweeper löschte mit niedrigem
`OA_TEST_PG_STALE_MS` die **eigenen, lebenden** Datenbanken. Er prüft jetzt zusätzlich die im Namen
kodierte PID und offene Verbindungen; zwei Tests halten das fest.

**Vier neue Befunde im Bestandscode** (F7–F10) und ein Nachtrag zu F4 — Details in
`09-befunde-bestandscode.md`. F7 ist der schwerwiegendste: `FilterBuilder.create()` liefert
„unbeschränkt", wenn keine `can`-Regel greift, und die Suchroute prüft `search` während
`SearchService` den Filter für `read` baut.

### Befunde aus E1 (an DEV, nicht im Test-Epic behoben)

| Nr. | Ort                                              | Befund                                                                                                                                                                                                                                                                   | Schwere  |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| F1  | `helpers/mongoToDrizzle.ts` `getDrizzleColumn()` | Condition-**Keys** werden nicht escaped. `escapeName` in drizzle ist `` `"${name}"` `` ohne Verdopplung, der Relations-Pfad nutzt `sql.raw`. Key `id" or 1=1 --` ⇒ `"id" or 1=1 --" = $1`. Keys kommen aus `roles.policies`; `PolicyValidator` prüft `conditions` nicht. | **hoch** |
| F2  | `iam-policy/ability.ts`                          | `AppAbility` deklariert nur Strings als Subject, ein CASL-getaggtes Objekt ist nicht zuweisbar. `AuthorizationService.can()` castet deshalb (`as AppSubjects`) — der Typ schützt die Row-Level-Prüfung nicht.                                                            | mittel   |
| F3  | `helpers/mongoToDrizzle.ts`                      | Unbekannter Operator, leeres `$or`/`$and`, leeres Query ⇒ **kein** Filter. Für `FilterBuilder` heißt „kein Filter" „unbeschränkt". Caller müssen `undefined` als deny behandeln.                                                                                         | mittel   |
| F4  | `helpers/mongoToDrizzle.ts`                      | Nur `Object.keys(value)[0]` wird gelesen: `{ $gte: 1, $lte: 5 }` verliert `$lte` still.                                                                                                                                                                                  | mittel   |
| F5  | `helpers/mongoToDrizzle.ts`                      | `{ feld: null }` wird zu `"feld" = NULL` und trifft nie eine Zeile. `$exists: false` ist die funktionierende Form.                                                                                                                                                       | niedrig  |
| F6  | `iam-policy/policy-validator.ts`                 | `{ action: [], subject: 'x' }` gilt als valide (`[]` ist truthy, Schleife läuft nullmal). Keine Rechteausweitung, aber auch keine Prüfung.                                                                                                                               | niedrig  |
| F7  | `services/FilterBuilder.ts`                      | Greift keine `can`-Regel, liefert `create()` `{ undefined, undefined }` = **unbeschränkt**. Nutzer ohne Rolle und Nutzer mit nur `cannot`-Regeln landen dort; die verbotene Zeile kommt zurück. Suchroute prüft `search`, `SearchService` filtert für `read`.            | **hoch** |
| F8  | `services/FilterBuilder.ts`                      | `cannot`-Ausschluss wickelt Werte in `{ $ne: wert }`, auch wenn der Wert ein Operator-Objekt ist. `{ $ne: { $in: […] } }` bindet ein Objekt als SQL-Parameter und erzeugt `[object Object]` im Meili-Filter — der Ausschluss findet nicht statt.                         | mittel   |
| F9  | `helpers/mongoToMeli.ts`                         | Die `ingestionSource.userId`-Expansion greift nur bei skalarem Wert. `{ $eq: id }` erzeugt `ingestionSource.userId = "…"` — kein `filterableAttribute` (`SearchService.ts:476`).                                                                                         | niedrig  |
| F10 | `helpers/mongoToMeli.ts`                         | Die expandierte `IN`-Liste stammt aus einer Abfrage ohne `order by`, der Filter-String ist damit nicht deterministisch.                                                                                                                                                  | niedrig  |

F1 ist im Test durch `it.fails` markiert: der Test wird **rot**, sobald das Escaping korrigiert wird
— dann sind die Erwartungen dort zu invertieren. F8 hat dieselbe Wirkung über eine Meldung im
`expect`: schlägt der Ausschluss plötzlich richtig an, fällt der Test mit der Aufforderung, die
Erwartung zu invertieren. Nachtrag zu F4: der Defekt steckt genauso in `mongoToMeli`. Alle Befunde
stehen in existierendem IAM-Code, nicht im Journaling-Pfad; ein Fix ist DEV-Arbeit und gehört nicht
in ein Test-Epic.

### Was in E1 bisher nicht prüfbar war

- ~~**Alles, was Postgres braucht.**~~ Teilweise aufgelöst: `JR-104` hat mit den vorinstallierten
  PostgreSQL-16-Binaries einen eigenen Cluster gestartet und die `integration`-Suite echt ausgeführt.
  **Offen bleibt PostgreSQL 17** (CI-Ziel) sowie **Valkey und Meilisearch** — beide fehlen weiterhin.
- ~~**`FilterBuilder` und `mongoToMeli`**~~ — in `JR-104` abgedeckt.
- **Der CI-Workflow** (`JR-105`) — ob GitHub Actions den Lauf reproduziert, ist hier nicht prüfbar.
- **Teardown nach `SIGKILL`** des vitest-Workers. Nur der Sweeper deckt das ab; ein echter Nachweis
  braucht einen Kindprozess-Treiber (frühestens mit `JR-410`, das ohnehin Prozess-Kills fährt).

### Was `JR-105` in der CI einrichten muss

| Punkt             | Anforderung                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Service-Container | `postgres:17-alpine`, Healthcheck `pg_isready`, Port 5432                                                               |
| Env               | `DATABASE_URL=postgresql://<user>:<pw>@localhost:5432/postgres` für Lint-, Build- **und** Testschritt                   |
| Rechte            | die Rolle braucht **`CREATEDB`** plus DDL in der neuen Datenbank (`postgres`-Superuser des Service-Containers genügt)   |
| Datenbanken       | **eine** vorhandene reicht (`postgres` als Maintenance-DB); der Harness legt seine eigenen an und löscht sie wieder     |
| `max_connections` | Default 100 genügt: 4 parallele Dateien × `max: 4` plus kurzlebige Admin-Verbindungen                                   |
| Optional          | `OA_TEST_PG_MAINTENANCE_DB`, `OA_TEST_PG_STALE_MS` — nur setzen, wenn ein anderer Name bzw. eine andere Frist nötig ist |
| Nachlaufprüfung   | nach `pnpm test`: `select datname from pg_database where datname like 'oa\_test\_%'` muss **leer** sein                 |
| Nicht setzen      | keine der `STORAGE_*`-Variablen nötig — die `integration`-Suite berührt `config/storage.ts` nicht                       |

---

## E2 – E12 (offen)

Tasklisten stehen in `03-backlog.md`. Sie werden hier erst beim Beginn des jeweiligen Epics
ausgerollt, um diese Datei lesbar zu halten.

Offene ADRs, die vor bzw. während der Epics zu entscheiden sind:

| ADR     | Thema                                                 | Epic          |
| ------- | ----------------------------------------------------- | ------------- |
| ADR-006 | Kanonische Kodierung, Genesis-String, `deployment_id` | E2 (`JR-203`) |
| ADR-007 | Lock-Key-Strategie, Mehrmandantenfähigkeit            | E2            |
| ADR-009 | Append-Only-Erzwingung: Rechteentzug oder Trigger     | E2 (`JR-205`) |
| ADR-010 | `processEmail` erweitern oder eigener Journaling-Pfad | E6 (`JR-602`) |
| ADR-008 | TSA-Ausfallverhalten bestätigen                       | E8 (`JR-804`) |
| ADR-012 | Migrationspfad für Bestandsinstallationen             | E12           |

---

## Sessionprotokoll

| Datum      | Ergebnis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Nächster Schritt                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 2026-07-27 | E0 abgeschlossen: Gap-Analyse, Architektur, Backlog (102 Tasks), Testplan, ADR-Log, `CLAUDE.md`, 2 Subagents, 3 Skills. Kein Produktionscode (ADR-001).                                                                                                                                                                                                                                                                                                                                                                               | E1 starten mit `JR-101`                                                       |
| 2026-07-27 | Nachtrag: ADR-004 als falsch korrigiert und Veröffentlichungs-Leck via `srcExclude` geschlossen; ADR-014 (Branch-Strategie) ergänzt; `CLAUDE.md` §7 und Handover um Sessionstart-Anleitung erweitert. Build-Nachweis offen (kein `pnpm install` möglich).                                                                                                                                                                                                                                                                             | `claude/journaling-e1-test-foundation` abzweigen, dann `JR-101`               |
| 2026-07-27 | `JR-105a` erledigt auf `claude/journaling-e1-test-foundation`: 7 handgeschriebene Dateien formatiert, 6 generierte per ADR-015 in `.prettierignore`. `pnpm lint` repo-weit grün und bleibt es nach beiden Generatorläufen. Kein Push (sammelt bis Ende E1).                                                                                                                                                                                                                                                                           | `JR-101` (vitest einrichten), danach `JR-105` (CI-Workflow)                   |
| 2026-07-27 | `JR-101`/`JR-102`/`JR-103` erledigt: vitest 3.2 mit drei Projects (`unit`/`integration`/`adversarial`), Harness in `tests/support/` (Klassifizierung, Seeds, Infra-Probe, Coverage-Hinweise), 146 Testfälle grün, Exit-Code beider Richtungen aktiv verifiziert, Fixture-Ladung durch Umbenennen belegt. Sechs IAM-Befunde (F1–F6) an DEV gemeldet, keiner behoben. Kein Push.                                                                                                                                                        | `JR-104` (isolierte Postgres-Basis), danach `JR-105` (CI-Workflow)            |
| 2026-07-28 | `JR-104` **geschrieben, Abnahme offen**: `pg-harness` mit eigener Datenbank je Aufruf (Schema-Isolation scheitert an `"public"`-qualifizierten Migrationen), Migrationen über `drizzle-orm/postgres-js/migrator`, garantiertes Teardown plus Sweeper. Lokaler PostgreSQL-16.13-Cluster aus den vorinstallierten Binaries gestartet: 32 Integrationstests grün, `pnpm test` 181 grün, zwei parallele Läufe gleichzeitig grün, 0 Rückstände. Vier neue Befunde F7–F10 (F7 hoch: `FilterBuilder` fail-open) plus F4-Nachtrag. Kein Push. | `JR-105` (CI-Workflow mit `postgres:17-alpine`), danach `JR-106` (Abnahme E1) |
