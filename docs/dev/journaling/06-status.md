# Status

**Diese Datei ist die verbindliche Fortschrittsquelle.** Sie wird am Ende **jeder** Session
aktualisiert — auch wenn nichts fertig wurde. Ein nicht aktualisierter Status ist schlimmer als
keiner, weil er Fortschritt behauptet, der nicht existiert.

Legende: `[ ]` offen · `[~]` in Arbeit · `[x]` fertig und abgenommen · `[!]` blockiert

**Letzte Aktualisierung:** 2026-07-29 (**Abnahme `JR-1309` durchgeführt — E13 nicht abgenommen**) ·
**Branch:** `claude/journaling-e13-iam-hardening` (Epic-Branch, abgezweigt bei `efea6bc`)

> **`JR-1309` ist durchgeführt. Ergebnis: E13 ist NICHT abgenommen.** Die fünf Codekorrekturen sind
> unabhängig belegt — Injektionsweg an beiden Gates zu (12 Nutzlasten inkl. Umgehungsversuchen, 0
> fremde Zeilen), `FilterBuilder` fail-closed auf Zeilenebene, **23** Regressionstests ohne den Fix rot
> und mit ihm grün, `224 passed | 2 skipped` auch auf PostgreSQL 17.10 in der CI. Gebrochen ist die
> **betreibersichtbare Hälfte**: **`JR-1307`** (die Prüf-SQL findet eine Form nicht, die von „sieht
> alles" auf „sieht nichts" umschlägt — **F27**; Tippfehler unter `manage all` ebenfalls nicht —
> **F28**) und **`JR-1306`s** letztes Kriterium (der `PolicyValidator` weist den Relationszweig beim
> Anlegen **nicht** ab, entgegen der veröffentlichten Doku — **F29**). Fünf neue Befunde: **F25**–**F29**.
> Vollständige Tabelle je Kriterium unten unter „Abnahme `JR-1309`". **Kein Rückmerge.**
>
> `JR-1301` (rote Tests), `JR-1303`, `JR-1302`, `JR-1304`, `JR-1305`, `JR-1308` sind abgenommen;
> `JR-1306` bis auf ein Kriterium; `JR-1307` abgelehnt.
>
> **Der eine zuletzt verbliebene rote Test war ein Widerspruch in `JR-1301` selbst**, kein fehlender
> Fix: zwei Erwartungen mit demselben `RED UNTIL JR-1304`-Tag forderten für strukturell gleiche
> Eingaben Unvereinbares. Entschieden in **ADR-018** (die Unit-Erwartung gilt; ein unübersetzbarer
> Zweig wird verweigert, nicht durch ein Sentinel ersetzt), korrigiert in `704e8d1` und in beide
> Richtungen mutationsgeprüft.
>
> **Dabei ist eine Aussage von mir korrigiert worden**, die ich am selben Tag selbst geschrieben
> hatte: „im `$or` nur verengend" (F22) gilt **nur** oben in einer `can`-Komposition. Unter dem `$not`,
> wohin `FilterBuilder.ts:84` **jede** `cannot`-Bedingung setzt, ist derselbe Wegfall **fail-open** —
> `not A` ist wahr für jede Zeile, die der verlorene Zweig verbieten sollte. Richtig ist der unbedingte
> Satz: ein weggelassener Zweig ist nie harmlos.
>
> **ADR-019** hält eine Einschränkung meiner F21-Entscheidung fest: die Key-Allowlist prüft Form und
> Relation, **nicht** Spaltenexistenz. Der Injektionsweg ist zu (zweifach: `PolicyValidator` beim
> Anlegen, `mongoToDrizzle` zur Abfragezeit, `sql.raw` entfernt); der Restspalt ist ein
> Policy-Schreibfehler und wird als **`JR-1311`** geführt.
>
> > **Nachtrag aus `JR-1309`:** die Aussage „zweifach" ist zu grob. Für Keys mit SQL-Syntax stimmt sie
> > und ist gemessen. Für Keys, die **nur** die Relation oder die Segmentzahl verletzen
> > (`attachment.name`, `a.b.c`, `foo.bar`), greift **nur** `mongoToDrizzle` — der `PolicyValidator`
> > lässt sie durch (**F29**). Fail-closed, also kein Angriffsweg, aber die veröffentlichte Doku
> > behauptet das Gegenteil, und `JR-1306`s letztes Kriterium ist damit nicht erfüllt.
>
> **ADR-017s Wirkungsanalyse hält** — belegt statt hergeleitet, mit zwei benannten Einschränkungen
> (**F17**, **F18**). Acht neue Befunde: **F17–F24**; behoben sind **F19**, **F20** (und **F1**,
> **F3**, **F7**, **F8**, **F22**), offen bleiben **F17**, **F18**, **F23**, **F24**. Aus der Abnahme
> `JR-1309` kommen **F25–F29** hinzu, alle offen.
>
> `predefined-roles.int.test.ts` ist **grün geblieben** (alle 7 Fälle, TAP-Nachweis je Fall) — der
> Nachweis, dass eine Standardinstallation sich durch die Fixes nicht ändert. **In `JR-1309`
> mutationsgeprüft** und damit als echter Nachweis bestätigt, nicht als Tautologie: eine Mutation an
> `predefined_read_only_user` macht 4 von 7 Fällen rot, ein stiller Ausfall des Rollen-Bootstraps 6 von 7.

> **ADR-017 ist entschieden (2026-07-29, Auftraggeber): Variante B.** `SearchService.ts:311` und
> `:423` rufen künftig `FilterBuilder.create(userId, 'archive', 'search')`; `search.routes.ts` bleibt
> unverändert. Damit ist `JR-1303` von einer Entscheidung zu reiner Umsetzung geworden und `JR-1302`
> ist freigegeben. **Es gibt jetzt keine blockierende offene Entscheidung mehr für E13.** Variante C
> (Divergenz konstruktiv ausschließen) ist als **`JR-1310`** nach E13 vorgemerkt, ausdrücklich nicht
> Teil von E13s Abnahme.
>
> Dabei präzisiert: **keine der drei `predefined_*`-Rollen trifft den `null`-Zweig in
> `FilterBuilder`** — eine Standardinstallation verhält sich vor und nach dem F7-Fix gleich. Damit ist
> eine frühere, zu scharfe Aussage des PO korrigiert („der Fix bricht Bestandsinstallationen").
> Erreichbar bleibt der Zweig über einen Nutzer ohne Rolle, eine `cannot`-only-Policy auf `archive`
> und eine handgeschriebene Rolle mit `search` ohne `read`. **Die Schwere von F7 bleibt hoch.**
>
> **E1 ist abgenommen (`JR-106a`, 2026-07-28) und in den Integrationsbranch gemergt** (`efb769c`,
> `--no-ff`). Alle 15 Kriterien aus `JR-106` sowie die Kriterien von `JR-104a` und `JR-105b` sind
> erneut und unabhängig geprüft: **alle erfüllt**, keines nur übernommen. F12 ist als behoben
> bestätigt (10 nebenläufige Runden, 0 Rückstände). **F13 bleibt offen** (Entscheidung des
> Auftraggebers).
>
> Drei **neue** Befunde am Messinstrument sind eröffnet: **F14** (Klassen-Umetikettierung umgeht die
> Inventurprüfung), **F15** (`minimumFiles`-Spiel verdeckt eine gelöschte Testdatei) und **F16**
> (Rückstand nach Modul-Throw wird lokal nicht angekündigt). Keiner bricht ein Akzeptanzkriterium.
> Sie gehören nach **`JR-105c`** — nicht nach `JR-1305`, das ist E13s Task für F8; der Verweis in der
> ersten Fassung dieses Abschnitts war falsch.
>
> **`JR-105c` ist vor E2 fällig.** Der Wächter zählt **Dateien statt ausgeführter Tests**: wer die
> vier Integrationsdateien auf `nightly` umklassifiziert, schaltet die Suite ab, und beide Wächter
> melden grün. Solange das offen ist, belegt ein grüner CI-Lauf **nicht**, dass die Integration-Suite
> gelaufen ist — und auf genau diesen Tests ruht jede Durability-Aussage in E2/E3.
>
> Nächster Schritt: **`JR-1307`** (Rolle DEV), danach `JR-1308` und die Abnahme `JR-1309`. Vorher
> braucht der PO eine Entscheidung zum verbleibenden roten Test (siehe unten).

---

## Gesamtübersicht

Sortiert nach **Abarbeitungsreihenfolge**, nicht nach Epic-Nummer — E13 wurde nachträglich vor E2
eingeschoben (siehe `03-backlog.md`).

| Reihenfolge | Epic | Titel                              | Status                                                              | Fertig / Gesamt          |
| ----------- | ---- | ---------------------------------- | ------------------------------------------------------------------- | ------------------------ |
| —           | E0   | Planung, Doku, Agent-Infrastruktur | **fertig**                                                          | 6 / 6                    |
| 1           | E1   | Test- und CI-Fundament             | **abgenommen + gemergt**, 1 Nacharbeit offen (`JR-105c`, vor E2)    | 9 / 10                   |
| 2           | E13  | IAM-Autorisierung härten           | **in Arbeit** — `JR-1309a` durchgeführt, **erneut abgelehnt** (F30) | 8 / 9 + 4 / 4 Nacharbeit |
| 3           | E2   | Ledger und Hash-Chain              | offen                                                               | 0 / 10                   |
| 4           | E3   | Spool und Acceptance-Contract      | offen                                                               | 0 / 8                    |
| 5           | E4   | `smtp-ingress`-Service             | offen                                                               | 0 / 13                   |
| 6           | E5   | Journal-Report-Parser              | offen                                                               | 0 / 9                    |
| 7           | E6   | Phase-B-Worker                     | offen                                                               | 0 / 8                    |
| 8           | E7   | WORM-Storage                       | offen                                                               | 0 / 6                    |
| 9           | E8   | Anchoring                          | offen                                                               | 0 / 6                    |
| 10          | E9   | `verify`-CLI                       | offen                                                               | 0 / 8                    |
| 11          | E10  | Completeness-Monitoring            | offen                                                               | 0 / 8                    |
| 12          | E11  | Compliance-Features                | offen                                                               | 0 / 10                   |
| 13          | E12  | Rollout und Dokumentation          | offen                                                               | 0 / 9                    |

111 Tasks in den Epics (E0 lieferte 102; E13 kam mit 9 hinzu). Dazu **`JR-1310`** als Folge-Task nach
E13 (Variante C aus ADR-017) — er gehört zu keinem Epic und zählt nicht in die Abnahme von `JR-1309`.

**Produktionscode für den Receiver: keiner.** E1 hat Testinfrastruktur geliefert, E13 wird
Bestandscode korrigieren — der Receiver selbst beginnt erst mit E2.

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

## E1 — Test- und CI-Fundament (**fertig**, abgenommen 2026-07-28 mit `JR-106a`)

|     | Task                                                                                                | Rolle |
| --- | --------------------------------------------------------------------------------------------------- | ----- |
| [x] | JR-101 vitest im Monorepo einrichten — **abgenommen 2026-07-28**, in `JR-106a` erneut bestätigt     | TEST  |
| [x] | JR-102 Testkonventionen festlegen und dokumentieren — **abgenommen 2026-07-28**, erneut bestätigt   | TEST  |
| [x] | JR-103 Unit-Tests auf `PolicyValidator` / `createAbilityFor` — **abgenommen**, erneut bestätigt     | TEST  |
| [x] | JR-104 Integrationstest-Basis — **abgenommen 2026-07-28 in `JR-106a`**, F12 behoben bestätigt       | TEST  |
| [x] | JR-105a Formatierungs-Commit (`pnpm format`) — **abgenommen 2026-07-28**, erneut bestätigt          | DEV   |
| [x] | JR-105 CI-Workflow: Lint, Build, `svelte-check`, Tests — **abgenommen**, CI-Lauf auf HEAD grün      | DEV   |
| [x] | JR-106 Abnahme E1 — **durchgeführt 2026-07-28; Ergebnis: E1 nicht abgenommen**, F12 nachzuarbeiten  | PO    |
| [x] | JR-104a F12 beheben — **abgenommen 2026-07-28 in `JR-106a`** (10 nebenläufige Runden, 0 Rückstände) | TEST  |
| [x] | JR-105b Lücken der CI-Nachlaufprüfung schließen — **abgenommen 2026-07-28 in `JR-106a`**            | TEST  |
| [x] | JR-106a Erneute Abnahme E1 — **durchgeführt 2026-07-28; Ergebnis: E1 abgenommen**                   | TEST  |
| [ ] | JR-105c Wächter auf **ausgeführte Tests** statt Dateien umstellen (F14–F16) — **fällig vor E2**     | TEST  |

**Nach der Abnahme in den Integrationsbranch gemergt** (`efb769c`, `--no-ff`, gepusht). ADR-014 gibt
den Rückmerge nach unabhängiger Abnahme frei; `main` bleibt bis E12 unangetastet. Die aufgeräumte
Sicht liefert `git log --first-parent origin/main..HEAD` — ein Merge-Commit je Epic, die granulare
Historie darunter erhalten. **Kein Squash:** er würde `cab0e38` („five tasks accepted, JR-104
rejected") tilgen und `JR-105a` seine mechanisch beweisbare Formatierungs-Reinheit nehmen.

**`JR-105c` bleibt offen und ist vor E2 fällig** — Begründung im Kasten oben. Er gehört formal zu E1,
wurde aber erst durch die Abnahme sichtbar; E1 ist trotzdem abgenommen, weil F14–F16 kein
Akzeptanzkriterium brechen.

**F13-Zwischenregel jetzt am Ort der Benutzung.** Sie stand nur in Testplan §2.6, im Befund und in
einem Quelldatei-Header — an keiner Stelle, die jemand liest, der einen 100k-Soak schreibt. Sie steht
jetzt in den **Akzeptanzkriterien von `JR-208` und `JR-607`**: `OA_TEST_PG_STALE_MS` über die erwartete
Laufzeit heben, sichtbar begründet.

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

> **Nachtrag aus `JR-106` (2026-07-28): diese Einschränkung ist aufgehoben.** Mit gesetztem
> `DATABASE_URL` und laufendem Cluster läuft `pnpm db:generate` durch. Die Abnahme hat einen echten
> Generatorlauf gefahren (erzwungene Schemaänderung ⇒ `0041_easy_invisible_woman.sql`,
> `meta/0041_snapshot.json`, geändertes `_journal.json`) und `pnpm lint` danach grün gemessen. Die
> Restlücke aus ADR-015 ist damit geschlossen; die Probe wurde vollständig zurückgebaut.

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

### JR-104 geschrieben (2026-07-28) — Integrationstest-Basis · F12 in `JR-104a` behoben, Abnahme offen

**Nicht abgehakt.** Der Harness ist geschrieben und lokal gegen ein **echtes** Postgres grün. Die
ursprünglich offene Bedingung (CI-Lauf gegen `postgres:17-alpine`) **ist erfüllt**. Die Abnahme
`JR-106` hat den Task trotzdem **abgelehnt**: das Kriterium „zwei Integrationstests parallel, ohne
sich zu beeinflussen" brach prozessübergreifend reproduzierbar (**F12**), und der unten in diesem
Abschnitt geführte Nachweis „zwei vollständige Läufe gleichzeitig ⇒ beide `exit=0`, 30/30 bzw. 30/30"
ist für den damaligen Code **widerlegt**. Er bleibt hier als historischer Eintrag stehen, ist aber
**nicht** gültig.

> **Stand 2026-07-28 nach `JR-104a`:** F12 ist behoben, der prozessübergreifende Doppellauf ist
> fünffach belegt (plus Tripel- und versetzte Läufe) — siehe „Nacharbeit `JR-104a` / `JR-105b`" weiter
> unten. Der Task bleibt `[~]`, weil die Abnahme (`JR-106a`) aussteht.

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

### JR-105 erledigt (2026-07-28) — CI-Workflow

Das Akzeptanzkriterium „Workflow läuft auf dem Branch grün" ist **eingelöst**: Lauf 3 auf
`1bad10c` ist grün, alle 14 Schritte `success`, Belege unten. Zwei Läufe waren nötig — Lauf 1 hat
einen echten Defekt der vorgegebenen Schrittfolge aufgedeckt (F11, siehe unten). Die formale Abnahme
gehört wie bei `JR-105a` zu `JR-106` (Rolle PO).

Eine neue Datei: `.github/workflows/ci.yml`, Job `verify` auf `ubuntu-latest`, Trigger
`pull_request` **und** `push`. Die vier bestehenden Workflows (`cla`, `deploy-docs`,
`docker-deployment`, `release-tag`) sind unverändert — `git status` zeigt ausschließlich die neue
Datei.

Schritte in dieser Reihenfolge: `pnpm install --frozen-lockfile` → `pnpm lint` →
**`pnpm --filter @open-archiver/types build`** → `pnpm --filter @open-archiver/backend build` →
`pnpm --filter @open-archiver/frontend check` → `pnpm --filter @open-archiver/backend test:types` →
`pnpm test` → zwei Nachlaufprüfungen.
Node `22`, pnpm `10.13.1` — beide aus `engines`/`packageManager` der Wurzel-`package.json`
übernommen, nicht neu gewählt; `actions/setup-node@v4` mit `cache: 'pnpm'` cacht den pnpm-Store.
Setup-Muster ist das von `deploy-docs.yml`.

**Nur prüfen, nie schreiben** (ADR-015). Kein `pnpm format`, kein Auto-Fix, kein `git commit`, kein
`git push`, kein Schritt, der eine Datei in den Checkout zurückschreibt: das Testlog geht nach
`$RUNNER_TEMP`, nicht in den Workspace, und `permissions: contents: read` erzwingt das über den
Token-Scope statt nur über die Abwesenheit eines schreibenden Schritts.

Postgres als Service-Container nach der Vorgabe des Testers: `postgres:17-alpine`,
`--health-cmd "pg_isready -U postgres"`, Port 5432, `DATABASE_URL` auf **Job**-Ebene (gilt damit für
Lint-, Build- und Testschritt in einem). Keine `STORAGE_*`-Variablen. `OA_TEST_PG_STALE_MS` bleibt
bewusst ungesetzt — ein niedrigerer Wert lässt den Sweeper die Datenbank eines **fremden** laufenden
Jobs löschen.

**Zwei Nachlaufprüfungen, beide `if: always()`,** damit sie auch nach einem roten Testschritt laufen:

1. _Wurde die `integration`-Suite überhaupt ausgeführt?_ Ohne erreichbare Datenbank überspringt der
   Harness sie **sichtbar** — und ein übersprungener Lauf ist grün. Genau das ist der Fehlerfall, den
   ein CI-Job verdecken würde. Der Schritt greppt das Testlog auf
   `SKIPPED SUITE .*integration suite` und macht den Job rot.
2. _Rückstände?_ `select datname from pg_database where datname like 'oa\_test\_%'` muss leer sein.
   Ein Rest ist ein Harness-Defekt und soll auffallen, nicht sich ansammeln.

> **Prüfung 1 ist seit `JR-105b` (2026-07-28) ersetzt.** Die Abnahme `JR-106` hat zwei Löcher darin
> gefunden: sie erkannte eine **übersprungene**, nicht eine **abwesende** Suite, und eine Datei in
> `tests/integration/` mit falschem Suffix fiel ihr gar nicht auf. Beides ist die Folge davon, auf das
> **Fehlen** einer Logzeile zu prüfen. An ihre Stelle treten `OA_TEST_REQUIRE_INFRA=1` (fehlende
> Infrastruktur ⇒ fehlschlagender Test) und der Schritt „Assert the expected suites actually existed
> and ran" über die Inventur-Report-Datei. Prüfung 2 ist unverändert. Die Belege unten beziehen sich
> auf den damaligen Stand und bleiben als Historie stehen.

**Nachweise — alle fünf Schritte lokal ausgeführt, nicht nur konfiguriert.** Wie in `JR-104` wurde
aus den vorinstallierten PostgreSQL-16-Binaries ein eigener Cluster gestartet
(`initdb` + `pg_ctl`, `127.0.0.1:5432`, Rolle `postgres` mit `CREATEDB`, `max_connections` 100) und
die Schrittfolge des Workflows verbatim durchgespielt; danach wurde der Cluster restlos entfernt
(`pg_ctl stop`, `rm -rf`, `pg_isready` ⇒ „no response"). Nichts davon ist committet.

| Schritt                                           | Ergebnis                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                  | Exit 0 — der Lockfile ist mit den `vitest`-Änderungen konsistent          |
| `pnpm lint`                                       | „All matched files use Prettier code style!" (inkl. der neuen `ci.yml`)   |
| `pnpm --filter @open-archiver/types build`        | Exit 0, `packages/types/dist/index.d.ts` vorhanden                        |
| `pnpm --filter @open-archiver/backend build`      | Exit 0                                                                    |
| `pnpm --filter @open-archiver/frontend check`     | „svelte-check found 0 errors and 0 warnings"                              |
| `pnpm --filter @open-archiver/backend test:types` | Exit 0                                                                    |
| `pnpm test`                                       | **181 grün, 2 skipped**, Exit 0; 4 `\|integration\|`-Dateien mit 32 Tests |
| Nachlaufprüfung 1                                 | „No integration-suite skip notice found."                                 |
| Nachlaufprüfung 2                                 | „No `oa_test_*` databases left behind."                                   |

Die beiden Nachlaufprüfungen wurden **in beide Richtungen** geprüft, damit sie nicht bloß dekorativ
sind:

- Ohne `DATABASE_URL` liefert `pnpm test` **Exit 0** bei „149 passed | 34 skipped" — der grün
  aussehende Fehlerfall. Prüfung 1 schlägt dort korrekt an (4 Treffer, Grund
  „DATABASE_URL is not set …"). Mit gesetzter, aber toter URL (`:5599`) ebenso, mit dem Grund
  „no Postgres listening at 127.0.0.1:5599".
- Die legitimen Klassen-Skips (`[nightly]`, `[manual]`) lösen sie **nicht** aus — deren Grund lautet
  „class 'nightly' not selected", enthält also nicht „integration suite". Beide Varianten im selben
  Lauf gegengeprüft.
- Prüfung 2 schlägt bei einer künstlich angelegten `oa_test_leftover_probe` an; eine Lookalike-DB
  `oaXtestXnotours` wird dagegen **nicht** erfasst — die `\_`-Escapes im `LIKE` sind also wirksam.

**F11 — der erste echte CI-Lauf fand einen Defekt, den kein lokaler Lauf finden konnte.** Lauf 1
(`d0bb792`, Push) wurde bei „Build backend" rot: **54 × `TS2307: Cannot find module
'@open-archiver/types'`**, weil `@open-archiver/types` über das gitignorierte `dist` auflöst und
`pnpm --filter @open-archiver/backend build` die Workspace-Dependency nicht mitzieht. Behoben durch
einen vorgeschalteten `pnpm --filter @open-archiver/types build`.

> **Der vollständige Befund steht in `09-befunde-bestandscode.md` unter F11** (verschoben dorthin am
> 2026-07-28, damit die `F`-Nummerierung in einer Datei liegt). Kategorie dort: **Defekt in der
> vorgegebenen Schrittfolge, nicht im Produktionscode.**

**Der echte CI-Lauf ist grün — das Akzeptanzkriterium ist damit erfüllt, nicht mehr nur plausibel.**
Lauf 3 (`1bad10c`, Push, Job `Lint, build, typecheck, test`, 88 s):
[Run 30341370697](https://github.com/maxx1337/OpenArchiver/actions/runs/30341370697). Alle 14
Schritte `success`. Aus dem Job-Log:

| Nachweis                             | Beleg aus Lauf 3                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL-Version                   | `starting PostgreSQL 17.10 on x86_64-pc-linux-musl`, `max_connections … 100`                                                    |
| Suite tatsächlich gelaufen           | `Test Files 8 passed (8)` · `Tests 181 passed \| 2 skipped (183)`                                                               |
| `integration` **nicht** übersprungen | vier `\|integration\|`-Dateien grün: `pg-harness` (11), `filter-builder` (8), `mongo-to-meli` (10), `postgres-availability` (3) |
| Nachlaufprüfung 1                    | „No integration-suite skip notice found."                                                                                       |
| Nachlaufprüfung 2                    | „No oa*test*\* databases left behind." — 0 Rückstände auch gegen PG 17                                                          |
| `psql` im Runner-Image               | vorhanden, der Schritt lief ohne Installation durch                                                                             |
| pnpm-Store-Cache                     | `Cache saved with the key: node-cache-Linux-x64-pnpm-d4b263d4…`                                                                 |
| Klassen-Skips wie erwartet           | `[nightly]` und `[manual]` übersprungen mit Grund; die 2 skipped sind genau diese                                               |
| Seed protokolliert                   | `SEED mongoToDrizzle adversarial: 2423792270 -- replay with OA_TEST_SEED=…`                                                     |

Die `2 skipped` sind die beiden bewusst nicht selektierten Klassen, **nicht** die
`integration`-Suite — genau die Unterscheidung, die Nachlaufprüfung 1 maschinell trifft.

**Nebenbefund aus dem Service-Container-Log, kein CI-Problem:** `ERROR: invalid input syntax for
type uuid: "[object Object]"` bei `select "id" from "archived_emails" where (not
"ingestion_source_id" = $1 …)`. Das ist **F8** in Aktion, von einem Test absichtlich provoziert und
dort erwartet. Es steht hier nur, damit niemand es beim Lesen des Logs für einen Infrastrukturfehler
hält.

**Weiterhin offen bzw. nicht geprüft:**

- **`pnpm test` unter PostgreSQL 16** ist nur lokal belegt (16.13), CI läuft 17.10. Beide grün, aber
  nie dieselbe Version in beiden Umgebungen.
- ~~**Der Cache-Nutzen**~~ — aufgelöst durch Lauf 5 (`6d6fd2c`, ebenfalls grün): Lauf 3 meldete noch
  `pnpm cache is not found` und legte den Store an, Lauf 5 dann
  `Cache hit for: node-cache-Linux-x64-pnpm-d4b263d4…` · `Cache restored successfully` ·
  `Cache Size: ~143 MB`. `pnpm install` fiel von 8 s auf 5 s. Auch Lauf 5: 181 grün, beide
  Nachlaufprüfungen positiv — der grüne Lauf ist also reproduzierbar und nicht einmalig.
- **Teardown nach `SIGKILL`** des vitest-Workers — unverändert offen aus `JR-104`, deckt nur der
  Sweeper ab.
- **`pull_request`-Trigger**: er feuert (Lauf 2 auf demselben SHA, wegen des offenen PR #2 nach
  `main`), wurde aber nicht bis zum Ende beobachtet. Der Job ist identisch zum Push-Lauf.

### Nacharbeit `JR-104a` / `JR-105b` erledigt (2026-07-28) — Abnahme `JR-106a` offen

Beide Tasks aus der Ablehnung von E1. Rolle `tester`, kein Produktionscode berührt, keiner der
Befunde F1–F11 behoben (das ist E13).

#### `JR-104a` — F12 behoben

**Reproduktion zuerst, gegen den unveränderten Stand `d2441fb`.** Drei Doppelläufe
(`vitest run --project integration` zweifach gleichzeitig, PostgreSQL 16.13 lokal): **3 von 3 Runden
rot**. Runde 2 war beidseitig rot und hat den in F12 nur hergeleiteten **zweiten** Pfad tatsächlich
gezeigt — Lauf A verlor seine eigene, gerade angelegte Datenbank
(`database "oa_test_…_own_not_swept" does not exist … It seems to have just been dropped or renamed`,
sichtbar als Fehlschlag von `CREATE SCHEMA IF NOT EXISTS "drizzle"`), weil Lauf B mit
`OA_TEST_PG_STALE_MS='1'` unbeschränkt gesweept hat. Ein Fix nur am Namen hätte genau das offen
gelassen und den Lauf später wie einen Flake aussehen lassen.

**Behoben, drei Teile** (Details und Begründung in `09-befunde-bestandscode.md`, F12):

1. `buildForeignFixtureName(label, createdAtMs)` — PID-Feld bleibt fremd (`FOREIGN_FIXTURE_PID`,
   sonst greift der Eigen-PID-Wächter und der Test prüft nichts), Eindeutigkeit über `process.pid`
   plus vier Zufallsbytes im nicht interpretierten Tag. Über 63 Byte wird geworfen, nicht
   abgeschnitten.
2. `sweepStaleHarnessDatabases({ staleMs?, restrictTo? })` — `restrictTo` filtert **im SQL**
   (`and d.datname = any($1)`), fremde Datenbanken werden nie gelesen. Ein gesenkter `staleMs`
   **ohne** `restrictTo` wirft; die gefährliche Kombination ist damit nicht mehr formulierbar.
   `process.env.OA_TEST_PG_STALE_MS` wird im Test nicht mehr gesetzt — es war prozessglobal.
3. Der 2021er Zeitstempel der `stale`-Fixture ist weg. Er lag jenseits der Standardfrist, also hätte
   der **legitime** unbeschränkte Sweep eines fremden Laufs sie auch bei eindeutigem Namen löschen
   dürfen. Jetzt: Fixture 60 s alt, Testfrist 10 s, beides weit unter der Standardfrist von 2 h.

Zwei neue Testfälle: `cannot touch a database outside restrictTo, however sweepable it looks` (eine
Bystander-Fixture erfüllt **alle drei** Wächter und muss trotzdem überleben) und
`refuses a lowered threshold without a restriction`.

**Nachweis, prozessübergreifender Doppellauf fünffach wiederholt** (Code-Stand des Commits,
PostgreSQL 16.13):

| Runde                       | Lauf A            | Lauf B            | `oa_test_*` danach |
| --------------------------- | ----------------- | ----------------- | ------------------ |
| 1                           | `exit=0`, 34 grün | `exit=0`, 34 grün | 0 Zeilen           |
| 2                           | `exit=0`, 34 grün | `exit=0`, 34 grün | 0 Zeilen           |
| 3                           | `exit=0`, 34 grün | `exit=0`, 34 grün | 0 Zeilen           |
| 4                           | `exit=0`, 34 grün | `exit=0`, 34 grün | 0 Zeilen           |
| 5                           | `exit=0`, 34 grün | `exit=0`, 34 grün | 0 Zeilen           |
| 6 — `pnpm test` vollständig | `exit=0`, 197/2   | `exit=0`, 197/2   | 0 Zeilen           |
| 7 — `pnpm test` vollständig | `exit=0`, 197/2   | `exit=0`, 197/2   | 0 Zeilen           |

**Keine Runde war unsauber.** Zusätzlich gegen einen Zwischenstand desselben Fixes: drei gleichzeitige
Läufe × 3 Runden und zwei um 1,5 s versetzte Läufe × 3 Runden — alle 15 Prozesse `exit=0`, keine
Rückstände. Am Ende enthielt der Cluster nur `postgres`, `template0`, `template1`; der Cluster wurde
danach restlos entfernt.

**Neuer Befund `F13`** dabei eingeordnet: der unbeschränkte Sweep mit der Standardfrist kann weiterhin
die Datenbanken eines fremden Laufs treffen, der **länger als 2 h** läuft. Für die heutige Suite (5 s)
unerreichbar, für die Soaks in E2/E3 nicht. Bewusst **nicht** in `JR-104a` mitbehoben: das ist eine
Verhaltensänderung des Sweepers mit drei plausiblen Varianten und gehört dem PO. Zwischenregel steht
in `04-testplan.md` §2.6.

#### `JR-105b` — die zwei Lücken geschlossen, positiv statt per Negativsuche

Neu `tests/support/suite-inventory.ts` plus `tests/support/global-setup.ts`, eingehängt als
`test.globalSetup` in `vitest.config.ts`. Die Include-Globs der drei Projects stehen **nur noch dort**;
`vitest.config.ts` importiert sie, damit Prüfung und Konfiguration nicht auseinanderlaufen können. Vor
dem ersten Test, in jedem Lauf und jeder Umgebung, werden zwei **positive** Erwartungen geprüft:

1. jede Suite trifft mindestens `minimumFiles` Dateien (heute 5 / 4 / 1) — schließt Lücke **(a)**, und
   zwar für eine _gelöschte_ Suite genauso wie für eine umbenannte;
2. keine testartig benannte Datei ohne Project — schließt Lücke **(b)** an der Wurzel, mit Pfadangabe.

Die Zahlen stehen auf **jedem** Lauf in der Ausgabe:
`[TEST-INVENTORY] unit: 5 file(s) (min 5) · integration: 4 file(s) (min 4) · adversarial: 1 file(s) (min 1) · unclassified: 0`.

Die alte Log-Suche im CI-Workflow ist **ersetzt**, nicht ergänzt. An ihre Stelle treten zwei Dinge:

- `OA_TEST_REQUIRE_INFRA: '1'` im Job-`env`. Damit erzeugt `suiteRequiring()` bei fehlender
  Infrastruktur einen **fehlschlagenden** Test statt eines sichtbaren Skips. Der Wert wird beim Import
  validiert, nicht erst dann, wenn zufällig eine Probe negativ ausfällt — sonst wäre ein Tippfehler
  genau so lange unsichtbar, wie Postgres läuft.
- Schritt „Assert the expected suites actually existed and ran": `globalSetup` schreibt die Inventur
  nach `$RUNNER_TEMP/suite-inventory.json` (`OA_TEST_INVENTORY_REPORT`),
  `tests/support/assert-inventory-report.mjs` verlangt sie und prüft die Mindestzahlen **aus dem
  Report**. Eine fehlende Datei ist ein Fehlschlag — wer den `globalSetup`-Eintrag entfernt, macht die
  Prüfung damit nicht still aus.

**Nachweise, beide Richtungen, alle Proben zurückgebaut** (`git status --porcelain` danach sauber):

| Zustand                                                                | `pnpm test`     | CI-Nachlaufprüfung             |
| ---------------------------------------------------------------------- | --------------- | ------------------------------ |
| `tests/integration` umbenannt (`integration-probe`)                    | `exit=1`        | `exit=1`, nennt alle 4 Dateien |
| `tests/integration` **gelöscht**                                       | `exit=1`        | —                              |
| `tests/integration/foo.test.ts` mit `expect(1).toBe(2)`                | `exit=1`        | `exit=1`, nennt die Datei      |
| dasselbe, aber nur `--project integration`                             | `exit=1`        | —                              |
| Report-Datei fehlt (`globalSetup` nicht gelaufen)                      | —               | `exit=1`                       |
| kein `DATABASE_URL`, **ohne** `OA_TEST_REQUIRE_INFRA` (legitimer Skip) | `exit=0`        | —                              |
| kein `DATABASE_URL`, **mit** `OA_TEST_REQUIRE_INFRA=1`                 | `exit=1`        | —                              |
| tote `DATABASE_URL` (`:5599`), **mit** `OA_TEST_REQUIRE_INFRA=1`       | `exit=1`        | —                              |
| `OA_TEST_REQUIRE_INFRA=yes-please`, Postgres **läuft**                 | `exit=1`        | —                              |
| legitimer Zustand, Postgres läuft                                      | `exit=0`, 197/2 | `exit=0`                       |

Vor dem Eager-Check war der Tippfehler-Fall `exit=0` — das war ein echter Defekt der ersten Fassung
dieser Nacharbeit, gefunden beim Gegenprüfen und vor dem Commit behoben.

**Neue Testdateien:**

| Datei                                                 | Klasse | Warum                                                              |
| ----------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| `packages/backend/tests/unit/suite-inventory.test.ts` | `ci`   | Glob-Matcher und beide Erwartungen gegen Wegwerf-Verzeichnisbäume  |
| `packages/backend/tests/unit/classification.test.ts`  | `ci`   | `OA_TEST_REQUIRE_INFRA`-Parser, inklusive Ablehnung von `yes`/`on` |

Beide sind die **ersten** Bewohner des Globs `packages/*/tests/unit/**`, der bis jetzt nichts traf —
sie belegen also zugleich, dass diese Hälfte der `unit`-Include-Liste funktioniert. Der Glob-Matcher
ist von Hand geschrieben (20 Zeilen), weil weder `picomatch` noch `tinyglobby` an dieser Workspace-Wurzel
auflösen und eine neue Dependency dafür ein schlechter Tausch wäre; deshalb hat er eigene Unit-Tests.

**Nicht geprüft:** der GitHub-Actions-Lauf selbst. Die Workflow-Änderung ist lokal Schritt für Schritt
nachgefahren (`pnpm lint`, `types`- und `backend`-Build, `test:types`, `pnpm test` mit den beiden neuen
Variablen, danach das Prüfskript), aber ein echter Lauf auf GitHub gehört zu `JR-106a`.

### Abnahme `JR-106` (2026-07-28) — Ergebnis: **E1 nicht abgenommen**

Rolle `tester`, unabhängig gegen die Akzeptanzkriterien aus `03-backlog.md` geprüft, nicht gegen den
geschriebenen Code. Abnahmeregel: `04-testplan.md` §6. Umgebung: kein Docker, aber ein aus den
vorinstallierten Binaries gestarteter **PostgreSQL-16.13**-Cluster (`initdb` + `pg_ctl`,
`127.0.0.1:5432`, Rolle `postgres` mit `CREATEDB`, `max_connections` 100), nach der Abnahme restlos
entfernt (`pg_ctl stop`, `rm -rf`, `pg_isready` ⇒ „no response"). Nichts davon ist committet;
`git status` ist nach jeder Sonde geprüft und war jedes Mal leer.

| Task    | Kriterium                                                       | Urteil                                                                        | Nachweis                                                                                                                                                                                                                             |
| ------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JR-101  | `pnpm test` läuft von der Wurzel                                | **erfüllt**                                                                   | `pnpm test` ⇒ `Test Files 8 passed (8)`, `Tests 181 passed \| 2 skipped (183)`, Exit `0`                                                                                                                                             |
| JR-101  | findet Tests in **allen** Paketen                               | **erfüllt**                                                                   | je eine Sonde in `packages/types/src/` und `packages/frontend/tests/unit/` ohne Config-Änderung gefunden und grün, danach entfernt                                                                                                   |
| JR-101  | Exit `0` bei Erfolg, `≠ 0` bei Fehlschlag                       | **erfüllt**                                                                   | Fixture umbenannt ⇒ `3 failed \| 105 passed`, Exit `1`; F12-Doppellauf ⇒ Exit `1`                                                                                                                                                    |
| JR-101  | keine Änderung an bestehendem Produktionscode                   | **erfüllt**                                                                   | Pre-E1-Worktree (`cea852f`) gebaut und `dist` verglichen: von **111** emittierten `.js` unterscheidet sich **eine** Datei (`config/search.js`) und nur im Zeilenumbruch — md5 gleich nach `tr -d`                                    |
| JR-102  | Konventionen in `04-testplan.md`, ein Beispiel je Kategorie     | **erfüllt**                                                                   | alle 6 in §2.1 genannten Pfade existieren; `[ci]`/`[nightly]`/`[manual]` im Suite-Namen; alle drei Klassen ausgeführt; `OA_TEST_CLASSES=nightlyy` bricht mit Exit `1` ab                                                             |
| JR-103  | ≥ 20 Assertions über die Fixtures, alle grün                    | **erfüllt**                                                                   | 108 `expect()`-Stellen in den beiden Fixture-Suites (30 + 78), zur Laufzeit mehr; grün                                                                                                                                               |
| JR-103  | die Fixtures werden erstmals **tatsächlich** geladen            | **erfüllt**                                                                   | **alle acht** einzeln umbenannt ⇒ jedes Mal Exit `1` mit `IAM policy fixture "<name>" could not be read from …`                                                                                                                      |
| JR-104  | zwei Integrationstests parallel, ohne sich zu beeinflussen      | **nicht erfüllt (F12)** — in `JR-104a` behoben, erneut zu prüfen in `JR-106a` | prozessübergreifend 4/4 rot: `duplicate key value violates unique constraint "pg_database_datname_index"`. Innerhalb **eines** Laufs erfüllt (4 Dateien parallel, 32 Tests grün). Nach `JR-104a`: 5/5 Doppelläufe grün, 0 Rückstände |
| JR-104  | kein Rückstand in der DB nach dem Lauf                          | **erfüllt**                                                                   | nach jedem Lauf, auch nach dem kollidierten: `select … like 'oa\_test\_%'` ⇒ 0 Zeilen; am Ende nur `postgres`, `template0`, `template1`                                                                                              |
| JR-105a | `pnpm lint` repo-weit grün, inklusive `.svelte`                 | **erfüllt**                                                                   | „All matched files use Prettier code style!", Exit `0`                                                                                                                                                                               |
| JR-105a | Commit enthält **ausschließlich** Formatierung                  | **erfüllt**                                                                   | für alle 7 handgeschriebenen Dateien gilt mechanisch `prettier(Stand vor 1c46f7e) == Stand nach 1c46f7e`; Token-Streams der 3 `.ts`-Dateien md5-identisch                                                                            |
| JR-105a | `pnpm db:generate` erzeugt danach keine erneute Lint-Verletzung | **erfüllt**                                                                   | erzwungenes `pnpm db:generate` schrieb `0041_*.sql` + `meta/0041_snapshot.json` + `_journal.json` ⇒ `pnpm lint` weiter grün; Probe vollständig zurückgebaut                                                                          |
| JR-105  | Workflow läuft auf dem Branch grün                              | **erfüllt**                                                                   | Lauf 7 auf `36cf6bd` (= HEAD), alle 14 Schritte `success`, PostgreSQL **17.10**, `Tests 181 passed \| 2 skipped`                                                                                                                     |
| JR-105  | bestehende vier Workflows unverändert                           | **erfüllt**                                                                   | Blob-Hashes `cla`/`deploy-docs`/`docker-deployment`/`release-tag` in Merge-Base, HEAD und Worktree identisch; `git log main..HEAD --` auf die vier ⇒ leer                                                                            |
| JR-105  | kein Schritt schreibt Dateien ins Repository zurück             | **erfüllt**                                                                   | kein `format`/`commit`/`push` außer dem Trigger `push:`; `permissions: contents: read` ohne Job-Override; nach der lokalen Schrittfolge `git status --porcelain` leer; Log liegt in `$RUNNER_TEMP`                                   |

**Zusätzlich ausdrücklich geprüft: die grün aussehende Fehlerform.** Ohne `DATABASE_URL` endet
`pnpm test` mit Exit **0** bei „149 passed | 34 skipped" — bestätigt. Die Nachlaufprüfung 1 aus
`ci.yml` macht das rot, und zwar in **allen drei** Nichtverfügbarkeits-Modi (`DATABASE_URL` fehlt ·
gesetzt aber nichts lauscht · Logdatei fehlt), weil alle Gründe aus `probePostgres()` die Wendung
„integration suite" enthalten. Die legitimen Klassen-Skips lösen sie **nicht** aus: deren Grund
lautet „class 'nightly' not selected", im selben Lauf gegengeprüft (0 Treffer). Nachlaufprüfung 2
ebenfalls beidseitig: `oa_test_leftover_probe` wird erfasst, die Lookalike `oaxtestxnotours` nicht —
die `\_`-Escapes greifen.

**Zwei Lücken der Nachlaufprüfung 1, gefunden beim Versuch sie zu umgehen** (kein Kriteriumsbruch,
aber genau die Klasse Fehler, gegen die sie existiert — Ausweg in `JR-1305` einplanen):

1. Sie erkennt eine **übersprungene**, nicht eine **abwesende** Suite. Mit umbenanntem Verzeichnis
   `tests/integration` läuft `pnpm test` grün („149 passed | 2 skipped", Exit `0`) und die Prüfung
   meldet „No integration-suite skip notice found."
2. Eine Datei in `tests/integration/`, die `*.test.ts` statt `*.int.test.ts` heißt, passt auf **kein**
   Project-Glob und wird von niemandem eingesammelt. Belegt mit einer absichtlich fehlschlagenden
   Sonde: `pnpm test` blieb grün, der Dateiname erschien nirgends im Log.

Beides ist mit einer positiven Erwartung zu schließen (Mindestzahl gelaufener `integration`-Dateien
bzw. eine Zusicherung, dass jede `*.test.ts` unter `tests/` von einem Project erfasst ist) statt mit
einer Negativsuche im Log.

**Kleinere Beobachtungen, kein Kriteriumsbruch:**

- `POLICY_FIXTURES` in `tests/support/policy-fixtures.ts` ist eine feste Liste; kein Test vergleicht
  sie mit dem Verzeichnisinhalt. Eine **neu hinzugefügte** Fixture wäre stillschweigend ungetestet.
- Der `JR-105a`-Commit enthält neben der Formatierung auch Projektgedächtnis-Prosa (ADR-015 in
  `05-entscheidungen.md`, Statuspflege in `06-status.md`). Keine Logikänderung, aber „ausschließlich
  Formatierung" gilt streng nur für die 7 Quell- und Doku-Dateien.
- `pnpm --filter @open-archiver/backend test` meldet heute 183 Tests, nicht die oben unter `JR-101`
  protokollierten 154 — alle Tests liegen derzeit in `packages/backend`.

**Nicht prüfbar in dieser Umgebung:**

- **PostgreSQL 17 lokal.** Lokal lief 16.13, die CI 17.10. Beide grün, aber **nie dieselbe Version in
  beiden Umgebungen** — eine Versionsdifferenz im Migrations- oder Sweeper-Verhalten würde hier nicht
  auffallen. Kein Docker im Container, keine PG-17-Binaries.
- **Valkey und Meilisearch** — nicht vorhanden, von der `integration`-Suite auch nicht berührt.
- **Teardown nach `SIGKILL`** des vitest-Workers — braucht einen Kindprozess-Treiber, frühestens mit
  `JR-410`.
- **F12 nach einer Behebung** — die Abnahme darf nicht reparieren, was sie prüft. Der erneute
  Nachweis gehört zur Nacharbeit und muss **mehrfach** laufen, nicht einmal.

### Abnahme `JR-106a` (2026-07-28) — Ergebnis: **E1 abgenommen**

Rolle `tester`, unabhängige Session, HEAD `0a94308` (mit `origin` abgeglichen: `git ls-remote` und
`git log --oneline -1` stimmen überein — der in `07-session-handover.md` beschriebene
Container-Rollback lag diesmal **nicht** vor). Geprüft wurden **alle** Kriterien aus `JR-106` erneut,
nicht nur die Nacharbeit, weil `JR-104a`/`JR-105b` `vitest.config.ts`, `tests/support/classification.ts`,
`pg-harness.ts` und `ci.yml` angefasst haben. Umgebung: kein Docker, eigener **PostgreSQL-16.13**-Cluster
aus `/usr/lib/postgresql/16/bin` (`initdb` + `pg_ctl` als Rolle `postgres`, `127.0.0.1:5432`), nach der
Abnahme restlos entfernt (`pg_ctl -m fast stop`, `rm -rf`, `pg_isready` ⇒ „no response", Exit 2).
`git status --porcelain` war nach **jeder** Sonde leer.

| Task    | Kriterium                                                     | Urteil      | Nachweis                                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JR-101  | `pnpm test` läuft von der Wurzel                              | **erfüllt** | `Test Files 10 passed (10)`, `Tests 197 passed \| 2 skipped (199)`, Exit `0`                                                                                                                               |
| JR-101  | findet Tests in **allen** Paketen                             | **erfüllt** | Sonden `packages/types/src/jr106a-probe.test.ts` und `packages/frontend/tests/unit/jr106a-probe.test.ts` ohne Config-Änderung eingesammelt und grün (`unit: 7 file(s)`), danach entfernt                   |
| JR-101  | Exit `0` bei Erfolg, `≠ 0` bei Fehlschlag                     | **erfüllt** | dieselbe Sonde auf `expect(1).toBe(2)` umgestellt ⇒ `1 failed \| 198 passed`, Exit `1`                                                                                                                     |
| JR-101  | keine Änderung an bestehendem Produktionscode                 | **erfüllt** | echter Pre-E1-Build gegen HEAD-Build verglichen: **233** `dist`-Dateien, Dateilisten identisch, **eine** Datei byteverschieden (`config/search.js`, nur Zeilenumbruch) — md5 nach `tr -d ' \t\n\r'` gleich |
| JR-102  | Konventionen in `04-testplan.md`, ein Beispiel je Kategorie   | **erfüllt** | alle in §2.1 genannten konkreten Pfade existieren; `[ci]` 22 ×, `[nightly]` 2 ×, `[manual]` 1 × im Suite-Namen; `ci`/`nightly`/`manual`/`all` alle lauffähig, `all` ⇒ 199 grün                             |
| JR-102  | Klassenwahl schlägt bei Tippfehler fehl                       | **erfüllt** | `OA_TEST_CLASSES=nightlyy` ⇒ `unknown test class(es): nightlyy`, Exit `1`                                                                                                                                  |
| JR-103  | ≥ 20 Assertions über die Fixtures, alle grün                  | **erfüllt** | 133 `expect()`-Stellen in den drei Fixture-Suites (30 + 78 + 25); alle grün                                                                                                                                |
| JR-103  | die Fixtures werden erstmals **tatsächlich** geladen          | **erfüllt** | **alle acht** einzeln umbenannt ⇒ jedes Mal Exit `1` mit `IAM policy fixture "<name>" could not be read from …`                                                                                            |
| JR-104  | zwei Integrationstests parallel, ohne sich zu beeinflussen    | **erfüllt** | prozessübergreifend **10 Runden grün**: 5 Doppel-, 3 versetzte (0,4 s), 2 Dreifachläufe — alle Teilläufe Exit `0`, `34 passed` je Lauf. Innerhalb eines Laufs 4 Dateien parallel                           |
| JR-104  | kein Rückstand in der DB nach dem Lauf                        | **erfüllt** | nach jeder der 10 Runden `select … like 'oa\_test\_%'` ⇒ `0`; am Ende nur `postgres`, `template0`, `template1`                                                                                             |
| JR-104a | Doppellauf **mehrfach** grün (≥ 5), protokolliert             | **erfüllt** | 5/5 Doppelläufe grün, zusätzlich 3 versetzte und 2 Dreifachrunden grün, alle mit Exit-Codes und Rückstandszählung protokolliert                                                                            |
| JR-105a | `pnpm lint` repo-weit grün                                    | **erfüllt** | „All matched files use Prettier code style!", Exit `0` — vor und nach allen Sonden                                                                                                                         |
| JR-105a | `pnpm db:generate` erzeugt keine erneute Lint-Verletzung      | **erfüllt** | erzwungene Schemaänderung ⇒ `0041_whole_sally_floyd.sql` + `meta/0041_snapshot.json` + geändertes `_journal.json`; `pnpm lint` weiter grün; Probe vollständig zurückgebaut                                 |
| JR-105  | Workflow läuft auf dem **aktuellen HEAD** grün                | **erfüllt** | Run **30368442950** (`0a94308`, Push), alle 14 Schritte `success`, Service-Container `postgres:17-alpine` ⇒ Log `starting PostgreSQL 17.10`, `Tests 197 passed \| 2 skipped`                               |
| JR-105  | `integration`-Suite nachweislich gelaufen, nicht übersprungen | **erfüllt** | im CI-Log alle vier `integration`-Dateien mit `✓` und Testzahlen (8/10/3/13); die 2 Skips sind Klassen-Skips (`nightly`/`manual`); Schritt 13 ⇒ `Suite inventory verified: … integration 4/4`              |
| JR-105  | bestehende vier Workflows byteidentisch                       | **erfüllt** | Blob-Hashes `cla`/`deploy-docs`/`docker-deployment`/`release-tag` in Merge-Base, HEAD und Worktree identisch; `git log main..HEAD --` auf die vier ⇒ leer                                                  |
| JR-105  | kein schreibender Schritt, `permissions: contents: read`      | **erfüllt** | genau **ein** `permissions:`-Block (Workflow-Ebene), kein Job-Override; kein `format`/`commit`/`push`; Log und Inventurreport unter `$RUNNER_TEMP`; „No `oa_test_*` databases left behind."                |
| JR-105b | Verzeichnis weg ⇒ rot                                         | **erfüllt** | umbenannt: `integration: 0 file(s) (min 4)` + `unclassified: 4`, Exit `1`. **Zusätzlich gelöscht** (der Fall, den die alte Prüfung nicht sah): `integration: 0 (min 4)`, Exit `1`                          |
| JR-105b | `foo.test.ts` in `tests/integration/` ⇒ rot                   | **erfüllt** | `unclassified: 1`, Dateiname und Namensregeln in der Fehlermeldung, Exit `1`                                                                                                                               |
| JR-105b | beide Fälle in der **Gegenrichtung** ⇒ grün                   | **erfüllt** | legitimer Zustand ⇒ Exit `0`; korrekt benannte `foo.int.test.ts` ⇒ `integration: 5 (min 4)`, eingesammelt, Exit `0`                                                                                        |

**Zusätzlich geprüft (nicht als Kriterium gefordert):** der Wächter `OA_TEST_REQUIRE_INFRA` in allen
vier Richtungen. Ohne `DATABASE_URL` und ohne die Variable endet `pnpm test` grün mit
`163 passed | 36 skipped` (Exit `0`) — die bekannte, grün aussehende Fehlerform. Mit `=1` wird
derselbe Zustand rot (`4 failed`), ebenso „gesetzt, aber nichts lauscht" (Port 5999). Und der zuvor
kritisierte **lazy** Guard ist konstruktiv geschlossen: `OA_TEST_REQUIRE_INFRA=yes` bricht **auch bei
laufender Datenbank** ab (`10 failed`, `no tests`, Exit `1`), weil `isInfraRequired()` beim Laden von
`classification.ts` eifrig aufgerufen wird. Alle vier `integration`-Dateien gehen über
`suiteRequiring`, keine umgeht die Klassifizierung.

**Angriffe auf die neue Prüfmechanik — was hält und was nicht.** Die Inventurprüfung ist jetzt selbst
Messinstrument, also wurde sie angegriffen:

| Angriff                                                               | Ergebnis                                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Verzeichnis umbenannt / **gelöscht**                                  | **hält** — rot in beiden Fällen                                            |
| `foo.test.ts` unter `tests/integration/`                              | **hält** — rot, Datei namentlich genannt                                   |
| `probe.spec.ts`, `probe.test.mts`, `probe.test.tsx`                   | **hält** — je `unclassified: 1`, Exit `1`                                  |
| Testdatei **außerhalb** `packages/` (`tests/`, `apps/open-archiver/`) | **hält** — beide als `unclassified` gemeldet, Exit `1`                     |
| **leere** `*.int.test.ts`                                             | **hält** — vitest: `No test suite found in file`, Exit `1`                 |
| Suite von `ci` auf `nightly` umetikettiert                            | **hält nicht** ⇒ **F14**                                                   |
| alle Tests einer Datei auf `it.skip`/`it.todo`                        | **hält nicht** — Teil von **F14** (Datei- statt Testebene)                 |
| Datei gelöscht, während die Suite über `minimumFiles` liegt           | **hält nicht** ⇒ **F15**                                                   |
| Namen außerhalb der Konvention (`probe-test.ts`, `probe.tests.ts`)    | unsichtbar für Wächter **und** vitest — Restlücke, in **F14** mit vermerkt |

Kein einziger dieser Angriffe bricht ein formuliertes Akzeptanzkriterium — `JR-105b` verlangt genau
die zwei Fälle, die es schließt, und die schließt es beidseitig. Sie sind als **F14** und **F15** in
`09-befunde-bestandscode.md` eröffnet und gehören inhaltlich in `JR-1305`, wo die Abnahme `JR-106`
den „Ausweg" schon eingeplant hat.

**Ein dritter neuer Befund, `F16`, beim Aufräumen gefunden.** Nach den Sonden lagen sechs
`oa_test_*`-Datenbanken auf dem Cluster. Reproduziert: wirft eine `integration`-Datei **im
Modul-Scope nach** ihrem `acquireTestDatabase()` (der übliche Fall eines Tipp- oder Typfehlers in
E2/E3), läuft ihr `afterAll` nicht, die Datenbank bleibt liegen — und die dafür vorgesehene Meldung
`process exited with N harness database(s) still present` erscheint **nicht**, weil der Wurf im
geforkten Worker passiert. Der Lauf ist rot (Exit `1`) und die CI fängt es über
„Assert no leftover test databases" (`if: always()`) auf; **lokal** verschwindet der Rückstand
lautlos in die 2-h-Frist des Sweepers. Das widerspricht der eigenen Zusage des Moduls
(„Silence here would read as 'no residue'"), nicht einem Akzeptanzkriterium.

**F13 — die Zwischenregel greift nicht am Ort der Benutzung.** Ausdrücklich nachgeprüft und
**bestätigt schwach**: die Regel „jeder Lauf, der länger als `OA_TEST_PG_STALE_MS` dauern kann, hebt
die Variable" steht in `04-testplan.md` §2.6, in F13 und im Kopfkommentar von `pg-harness.ts`. Sie
steht **nicht** in den Backlog-Zeilen `JR-208`, `JR-607` und `JR-410` und **nicht** in §12.6 des
Testplans — also nirgends dort, wo jemand nachschlägt, der einen Soak schreibt. Der Docstring warnt
ausschließlich davor, die Frist zu **senken**; vor dem Versäumnis, sie zu **heben**, warnt nichts,
und es gibt keine Laufzeitprüfung („Prozess läuft länger als die Frist"). Empfehlung an den PO:
unabhängig davon, welcher der drei F13-Entwürfe gewählt wird, die Regel in die Akzeptanzkriterien von
`JR-208` und `JR-607` aufnehmen — eine Regel, die nur in einem Dokumentabschnitt steht, ist keine.

**Nicht prüfbar in dieser Umgebung:**

- **PostgreSQL 17 lokal.** Lokal lief **16.13**, die CI **17.10**. Beide grün, aber weiterhin **nie
  dieselbe Hauptversion in beiden Umgebungen** — eine Versionsdifferenz im Migrations- oder
  Sweeper-Verhalten würde hier nicht auffallen. Kein Docker, keine PG-17-Binaries im Container.
- **Valkey und Meilisearch** — nicht vorhanden, von der `integration`-Suite nicht berührt.
- **Teardown nach `SIGKILL`** des vitest-Workers — braucht einen Kindprozess-Treiber, frühestens
  `JR-410`. F16 ist der benachbarte, hier reproduzierbare Fall.

### Befunde aus E1 (an DEV, nicht im Test-Epic behoben)

> **Verbindliches Register ist `09-befunde-bestandscode.md`.** Die Tabelle unten ist eine Kurzfassung
> von F1–F10 (Bestandscode). **F11** (vorgegebene CI-Schrittfolge), **F12** (Testharness, aus der
> Abnahme `JR-106`, in `JR-104a` **behoben**), **F13** (Testharness, aus `JR-104a`, **offen**) und
> **F14**–**F16** (Testharness, aus der Abnahme `JR-106a`, **offen**) stehen nur dort. Keiner von
> F1–F11 ist behoben — das ist E13; F13–F16 gehören nach `JR-1305`.

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
- ~~**Der CI-Workflow** (`JR-105`)~~ — aufgelöst. Der Lauf gegen `postgres:17-alpine` ist grün
  (Run 30341370697, und derselbe Job erneut grün auf HEAD `36cf6bd`: Run 30341858370). Damit ist die
  **ehemals letzte Bedingung von `JR-104` erfüllt**: die `integration`-Suite läuft in CI gegen
  PostgreSQL 17.10 durch, sichtbar nicht übersprungen und ohne Rückstände. In der Abnahme `JR-106`
  nachgeprüft und bestätigt. `JR-104` bleibt trotzdem offen — **aus einem anderen Grund**, F12.
- ~~**Der `pull_request`-Trigger**~~ — aufgelöst. Die Läufe 4, 6 und 8 (`event=pull_request`) sind
  alle `conclusion=success`, zuletzt auf HEAD. Der Job ist identisch zum Push-Lauf.
- ~~**`pnpm db:generate` im Container**~~ — aufgelöst. Mit gesetztem `DATABASE_URL` und laufendem
  Cluster läuft es durch; die Abnahme hat damit einen echten Generatorlauf gegen `pnpm lint` gefahren,
  statt wie ADR-015 nur einen direkten `drizzle-kit`-Aufruf mit Dummy-URL.
- **Teardown nach `SIGKILL`** des vitest-Workers. Nur der Sweeper deckt das ab; ein echter Nachweis
  braucht einen Kindprozess-Treiber (frühestens mit `JR-410`, das ohnehin Prozess-Kills fährt).
- **PostgreSQL 17 lokal** bleibt offen: geprüft wurde lokal 16.13, in CI 17.10. Es gab noch keinen
  Lauf, in dem beide Umgebungen dieselbe Hauptversion gefahren haben.

### Was `JR-105` in der CI einrichten muss

> Umgesetzt in `.github/workflows/ci.yml` (2026-07-28), **im CI-Lauf 30341370697 vollständig
> bestätigt** — jede Zeile dieser Tabelle ist inzwischen ein Log-Beleg, keine Annahme mehr. Zwei
> Abweichungen: `DATABASE_URL` steht nicht je Schritt, sondern auf **Job**-Ebene (gilt damit für
> Lint-, Build- und Testschritt zugleich), und es gibt eine zweite Nachlaufprüfung, die einen
> **übersprungenen** `integration`-Lauf rot macht — die Tabelle nannte nur die Rückstandsprüfung.
> Ergänzung, die die Tabelle nicht vorhersehen konnte: vor den drei TypeScript-Schritten muss
> `pnpm --filter @open-archiver/types build` laufen (F11).

| Punkt                | Anforderung                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Service-Container    | `postgres:17-alpine`, Healthcheck `pg_isready`, Port 5432                                                                                                                                        |
| Env                  | `DATABASE_URL=postgresql://<user>:<pw>@localhost:5432/postgres` für Lint-, Build- **und** Testschritt                                                                                            |
| Rechte               | die Rolle braucht **`CREATEDB`** plus DDL in der neuen Datenbank (`postgres`-Superuser des Service-Containers genügt)                                                                            |
| Datenbanken          | **eine** vorhandene reicht (`postgres` als Maintenance-DB); der Harness legt seine eigenen an und löscht sie wieder                                                                              |
| `max_connections`    | Default 100 genügt: 4 parallele Dateien × `max: 4` plus kurzlebige Admin-Verbindungen                                                                                                            |
| Optional             | `OA_TEST_PG_MAINTENANCE_DB`, `OA_TEST_PG_STALE_MS` — nur setzen, wenn ein anderer Name bzw. eine andere Frist nötig ist                                                                          |
| Pflicht ab `JR-105b` | `OA_TEST_REQUIRE_INFRA=1` (Skip wegen fehlender Infrastruktur ⇒ Fehlschlag) und `OA_TEST_INVENTORY_REPORT` (Inventur-Report, den die Nachlaufprüfung verlangt)                                   |
| Nachlaufprüfung      | nach `pnpm test`: `select datname from pg_database where datname like 'oa\_test\_%'` muss **leer** sein, und der Inventur-Report muss existieren und die Mindestdateizahlen erfüllen (`JR-105b`) |
| Nicht setzen         | keine der `STORAGE_*`-Variablen nötig — die `integration`-Suite berührt `config/storage.ts` nicht                                                                                                |

---

## E13 — IAM-Autorisierung härten (in Arbeit, **Abnahme erneut abgelehnt**)

**Branch:** `claude/journaling-e13-iam-hardening`, abgezweigt vom Integrationsbranch bei `efea6bc`.
**Kein Rückmerge** — `JR-1309` hat E13 am 2026-07-29 abgelehnt (F27, F28, F29), die DEV-Nacharbeit
`JR-1313`–`JR-1315` hat diese drei behoben, und die **erneute Abnahme `JR-1309a` hat E13 am
2026-07-29 wieder abgelehnt**: ein neuer Befund **F30** derselben Klasse eine Ebene tiefer. Alle
anderen 22 geprüften Kriterien sind erfüllt, die Codehälfte ist unabhängig belegt.

| Nacharbeit | Task                                                                               | Rolle |
| ---------- | ---------------------------------------------------------------------------------- | ----- |
| [x]        | JR-1313 F29 + F26s Schreibseite: ein Prädikat für beide Gates — `cfb1462`          | DEV   |
| [x]        | JR-1314 F27 + F28: Abfragen erweitert **und** Absolutsatz ersetzt — `c17144e`      | DEV   |
| [x]        | JR-1315 F25: Behauptung eingeschränkt **und** F5-Kommentar nachgezogen — `5c8a521` | DEV   |
| [x]        | JR-1309a Erneute Abnahme E13 — **durchgeführt; Ergebnis: nicht abgenommen (F30)**  | TEST  |

> **`JR-1316` ist aus dieser Liste herausgenommen** (Auftraggeber, 2026-07-29) und steht wortgleich
> unter „Folge-Task nach E13" in `03-backlog.md`. Sie sichert ein **Doku-Artefakt** ab, kein
> Autorisierungsverhalten; die Lücke dahinter (F27) ist behoben und in `JR-1314` belegt. **Kein
> Kriterium von `JR-1309a`.**

|     | Task                                                                                                                                               | Rolle     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| [x] | JR-1301 Fehlschlagende Regressionstests für F1/F3/F7/F8 — **erledigt 2026-07-29**                                                                  | TEST      |
| [x] | JR-1303 Action-Versatz auflösen (ADR-017, Variante B) — `bcac6bd`                                                                                  | DEV       |
| [x] | JR-1302 `FilterBuilder`: `null` als deny (mit F19, F20) — `a309fd1`                                                                                | DEV       |
| [x] | JR-1304 `mongoToDrizzle`: unübersetzbare Bedingungen laut scheitern lassen — `45ac0e9`; der Testwiderspruch ist in `704e8d1` per ADR-018 aufgelöst | DEV       |
| [x] | JR-1305 `cannot`-Ausschluss mit Operator-Bedingungen korrekt bauen — `2311996`                                                                     | DEV       |
| [x] | JR-1306 Condition-Keys gegen eine Allowlist prüfen — `dcec017`                                                                                     | DEV       |
| [~] | JR-1307 Verhaltensänderung dokumentieren (ADR-016) — geschrieben 2026-07-29, in `JR-1309` **abgelehnt** (F27, F28, F29)                            | DEV       |
| [x] | JR-1308 Upstream-Meldung vorbereiten (nicht versenden) — **erledigt 2026-07-29**, in `JR-1309` bestätigt                                           | PO        |
| [x] | JR-1309 Abnahme E13 — **durchgeführt 2026-07-29; Ergebnis: E13 nicht abgenommen**                                                                  | TEST → PO |

### Abnahme `JR-1309a` (2026-07-29) — Ergebnis: **E13 erneut nicht abgenommen**

Unabhängige Session, Rolle `tester`, HEAD `2a8df48`, **zuerst gegen das Remote abgeglichen**
(`git ls-remote` = lokal, kein Container-Rollback). Umfang wie in `JR-1309a` festgelegt: die zwei in
`JR-1309` gebrochenen Kriterien einzeln, die Kriterien von `JR-1313`/`JR-1314`/`JR-1315`, ein
Volllauf, der Nachweis über F2/F4/F5/F6/F9/F10 **im Code**, und die Doku-Hygiene. **`JR-1316`,
`JR-1310`, `JR-1311`, `JR-1312` waren nicht Teil der Prüfung.**

**23 Kriterien geprüft: 22 erfüllt, 1 nicht erfüllt.**

| #   | Task      | Kriterium                                                                     | Ergebnis                | Beleg                                                                                                                                                                                                       |
| --- | --------- | ----------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `JR-1306` | `PolicyValidator` weist einen Key mit unauflösbarer Relation beim Anlegen ab  | **erfüllt**             | `foo.bar`, `attachment.name`, `a.b.c`, `ingestionSource.userId.x`, `INGESTIONSOURCE.userId` je REJECT; über `IamController.createRole` **HTTP 400** mit dem Key im Text                                     |
| 2   | `JR-1306` | Ein Key mit `"` wird abgewiesen, nicht escaped                                | **erfüllt**             | 26 Keys durch beide Gates, eigene Erwartung je Fall; alle Injektionsvarianten REJECT/REFUSE                                                                                                                 |
| 3   | `JR-1306` | Ein unbekannter, syntaktisch harmloser Key bleibt zugelassen (ADR-019)        | **erfüllt (bewusst)**   | `foo` und `_private` an beiden Gates ACCEPT, Query 3 findet `foo`                                                                                                                                           |
| 4   | `JR-1313` | Validator und Übersetzer sind **deckungsgleich**, gegen ein erwartetes Urteil | **erfüllt**             | eigene Tabelle, 26 Keys × 2 Gates × erwartetes Urteil: **0 Divergenzen, 0 falsche Urteile**; die drei Restspalte reproduziert                                                                               |
| 5   | `JR-1313` | Nicht-Objekt-`conditions` wird beim Anlegen abgewiesen (`400`)                | **erfüllt**             | `5`, `0`, `-1`, `null`, `[]`, `[{…}]`, `""`, `"userEmail"`, `false`, `true` → REJECT (vor E13: alle ACCEPT); über den Controller je **400**; `{}`, `{userEmail:…}`, absent → 201                            |
| 6   | `JR-1313` | Laufzeitverhalten gespeicherter Policies unverändert                          | **erfüllt**             | `FilterBuilder.ts` blob-identisch zu `13a7114`; `conditions: null`/`""`/`false` → `UNRESTRICTED` vor **und** nach E13                                                                                       |
| 7   | `JR-1314` | Die Blöcke **aus der Markdown-Datei** wörtlich gegen echtes Postgres          | **erfüllt**             | Extraktionsskript → 3 Blöcke → `psql -f -`, 41 Migrationen per `psql -f`, 54 gesäte Rollen; Q1 3, Q2 33, Q3 5 Zeilen, Exit 0                                                                                |
| 8   | `JR-1314` | `conditions: 5` wird gemeldet (F27)                                           | **erfüllt**             | Q2 `conditions is not an object`, mit der richtigen der beiden Lesarten je Wert                                                                                                                             |
| 9   | `JR-1314` | Tippfehler-Key unter `manage all` wird gemeldet (F28)                         | **erfüllt**             | Q3 zwei Zeilen: `archived_emails.user_emial` **und** `ingestion_sources.user_emial`                                                                                                                         |
| 10  | `JR-1314` | Die drei `predefined_*` und die Gegenproben in **keiner** Ausgabe             | **erfüllt**             | P1–P3 plus drei handgeschriebene Kontrollen und die Sonde „Regel ist kein Objekt": 0 Zeilen in Q1/Q2/Q3                                                                                                     |
| 11  | `JR-1314` | Kein Absolutsatz mehr im Dokument                                             | **erfüllt**             | „No rows means no role … is affected" ist ersatzlos weg; an seiner Stelle „How to read an empty result"                                                                                                     |
| 12  | `JR-1307` | Ein Betreiber kann **vorher** feststellen, welche Rollen betroffen sind       | **nicht erfüllt (F30)** | 8 Formen mit `pre ≠ post` werden von **keiner** Abfrage gemeldet; 4 davon kippen von „sieht alles / alle Zeilen" auf „jede Anfrage scheitert". Zwei Sätze der Seite sind damit widerlegt                    |
| 13  | `JR-1315` | Behauptung und Code stimmen überein, per `grep` nach der Befundnummer         | **erfüllt**             | `grep -rn "F4\|F5\|finding F" --include=*.ts packages/backend/src/ \| grep -v test` findet **F4** (`mongoToDrizzle.ts:93`) und **F5** (`:133`)                                                              |
| 14  | —         | Volllauf ⇒ Exit 0, mit Testzahl                                               | **erfüllt**             | `250 passed \| 2 skipped` (252 Fälle, 49 Suites, 17 Dateien), `success: true`, Exit 0                                                                                                                       |
| 15  | —         | Die 2 Skips sind die bekannten `nightly`/`manual`-Suiten und nichts anderes   | **erfüllt**             | aus dem JSON-Report: beide in `tests/adversarial/mongo-to-drizzle.adv.test.ts`, `[nightly]` 25000 Bäume und `[manual]` 30000-ms-Soak                                                                        |
| 16  | —         | `predefined-roles.int.test.ts` alle **sieben** Fälle grün                     | **erfüllt**             | 7 / 7 `passed`, je mit `fullName` aus dem JSON-Report                                                                                                                                                       |
| 17  | —         | `FilterBuilder.ts` und `mongoToMeli.ts` seit `13a7114` unberührt              | **erfüllt**             | Blob-Hashes identisch (`f7efead…`, `9e1ba29…`), `git diff 13a7114..HEAD` für beide leer                                                                                                                     |
| 18  | —         | Die **Laufzeitseite von F26** ist offen geblieben                             | **erfüllt**             | `FilterBuilder.ts:51–53` liest weiter `!rule.conditions`; gemessen `UNRESTRICTED` für `null`/`""`/`false`                                                                                                   |
| 19  | `JR-1313` | Das eine umgedrehte Pin ist begründet und nicht mehr als nötig                | **erfüllt**             | alter `policy-validator.test.ts` gegen neuen Validator ⇒ `1 failed \| 52 passed`, genau `a.b.c`; Diff berührt **einen** Testfall, die Operator-Hälfte bleibt grün; sonst nur `minimumFiles` 7 ⇒ 8           |
| 20  | —         | F2, F4, F5, F6, F9, F10 unverändert **im Code**                               | **erfüllt**             | `ability.ts`, `AuthorizationService.ts`, `mongoToMeli.ts` blob-identisch zu `efea6bc`; F4/F5 pre gegen post auf 11 Eingaben gleich, F6 (`{action: [], …}`) pre=post=ACCEPT; Produktionscode-Diff: 5 Dateien |
| 21  | —         | Öffentliche Doku ohne interne IDs, Nutzlast, Compliance-Behauptung            | **erfüllt**             | `grep` über `docs/user-guides`, `docs/services`, `docs/enterprise`: kein `JR-1xxx`, keine F-Nummer, kein `1=1`/`drop table`, keine GoBD/WORM/„tamper-proof"-Behauptung                                      |
| 22  | —         | `10-upstream-meldung.md` nicht im Build und nicht im Suchindex                | **erfüllt**             | `pnpm docs:build` Exit 0, `dist/dev/` existiert nicht, 0 HTML-Seiten unter `dev/`; Suchindex: 0 Vorkommen von `dev/`, kein „upstream"; Gegenkontrolle „Access Control Changes" **ist** drin                 |
| 23  | —         | `main` unangetastet, kein PR aus dieser Arbeit                                | **erfüllt**             | `main` = `a560b8c`, HEAD ist **kein** Vorfahre von `main`; PR-Liste: nur `#1` und `#2`, beide `closed`, `merged: false`                                                                                     |

#### Der Bruch, einzeln: **F30**

Die Formprüfung, die `JR-1313` eingeführt hat, wirkt in `mongoToDrizzle` **rekursiv** — jeder
`$or`/`$and`/`$not`-Zweig geht erneut durch `checkConditionsShape()`, und ein leerer Bedingungsknoten
wird auf jeder Ebene abgewiesen. Query 2 der Betreiberanleitung prüft beides nur an der **Wurzel**.
Gemessen (`FilterBuilder` `efea6bc` gegen `HEAD` im selben Prozess, echtes PostgreSQL 16.13,
`('archive','read')`):

```
pre               post     Q2/Q3     conditions
UNRESTRICTED      THROWS   SILENT    {"$not": {}}
UNRESTRICTED      THROWS   SILENT    {"$not": 5}
UNRESTRICTED      THROWS   SILENT    {"$or": [{"$and": [{}]}]}
FILTER(2/2 rows)  THROWS   SILENT    can archive + cannot archive {"userEmail": {}}
FILTER(0/2 rows)  THROWS   SILENT    {"$or": [{"userEmail": "…"}, 5]}
FILTER(0/2 rows)  THROWS   SILENT    {"$or": [{}, {"userEmail": "…"}]}
FILTER(0/2 rows)  THROWS   SILENT    {"$or": [{"userEmail": "…"}, {}]}
FILTER(0/2 rows)  THROWS   SILENT    {"$and": [{"userEmail": "…"}, {}]}
```

Entscheidend ist nicht die Unvollständigkeit an sich — die Seite darf und soll sagen, dass eine
Abfrage über schemaloses JSONB nicht beweisbar vollständig ist. Entscheidend ist, dass zwei **positive**
Sätze der Seite widerlegt sind: „walked recursively through nested objects and arrays: **the empty
object**, …" (der leere Objektknoten wird nur an der Wurzel geprüft) und „the values inside a
condition … **not one this release changes**" (für `{"userEmail": {}}` ändert sich die Wirkung von
„alle Zeilen sichtbar" auf „jede Anfrage scheitert"). Volle Fassung in `09-befunde-bestandscode.md`
unter **F30**, inklusive Behebungsvorschlag.

**Warum das die Abnahme kippt und nicht als Restrisiko durchgeht:** `JR-1307`s einziger Zweck ist die
Frage „bin ich betroffen?". Die PO-Vorgabe zu `JR-1314` lautete „die Abfragen decken alle **heute
bekannten** Formen ab, und das Dokument sagt genau, welche das sind" — die Knotenform ist seit
`JR-1313` bekannt und steht in dem Prädikat, das beide Gates benutzen. Es ist derselbe Fehlermodus wie
F27, eine Ebene tiefer, mit derselben Gefahrenrichtung.

#### Was gehalten hat — gemessen, nicht übernommen

- **Die zwei Gates sind wirklich deckungsgleich**, und zwar gegen eine **eigene** Erwartungstabelle
  (Fallstrick 16): 26 Keys, darunter fünf, die die ausgelieferte Testdatei nicht führt
  (`ingestionSource` als einzelnes Segment, `INGESTIONSOURCE.userId` und `ingestionsource.userId` für
  die Groß-/Kleinschreibung der Relationstabelle, `ingestionSource..userId`, `$`). 0 Divergenzen,
  0 falsche Urteile. Die drei Restspalte (`foo`, `$regex`, `{}`) sind reproduziert.
- **Der HTTP-Pfad ist jetzt gemessen** — das war in `JR-1309` „nicht prüfbar". `IamController.createRole`
  wurde mit einem synthetischen `req`/`res` direkt aufgerufen (die Importkette braucht nur `db` und
  `logger`, nicht den Server): 11 abzuweisende Formen ⇒ je **400** mit dem Key bzw. dem Wert im Text,
  5 zulässige Formen ⇒ je **201**.
- **Die Versionslücke 16.13 / 17.10 ist für die Betreiber-SQL geschlossen** — auch das war in
  `JR-1309` offen. PostgreSQL **17.10** (dieselbe Version wie die CI) aus dem pgdg-Repository
  installiert, eigener Cluster auf Port 5433, alle 41 Migrationen per `psql -f`, dieselben 54 Rollen
  gesät, dieselben drei extrahierten Blöcke: **Ausgabe zeichenweise identisch zu 16.13** in allen drei
  Blöcken (3 / 33 / 5 Zeilen). Auch der dokumentierte Abbruch bei einem `policies`, das kein Array ist,
  ist auf 17.10 wortgleich (`ERROR: cannot extract elements from an object`).
- **Kein Falsch-positives bei den harmlosen Rollen.** P1–P3 (`predefined_*`), C1 (handgeschrieben,
  Bedingung auf existierenden Spalten), C2 (unbedingte Grants), C3 (`cannot` mit einfacher Gleichheit)
  und die Sonde „Regel ist kein Objekt" erscheinen in keiner der drei Ausgaben. F4/F5-Formen
  (`{sizeBytes: {$gte, $lte}}`, `{userEmail: null}`) ebenfalls nicht — richtig, denn ihre Wirkung
  ändert sich nicht.
- **Die Vorher/Nachher-Tabelle aus `JR-1314` hält vollständig.** Alle 17 Wurzelwerte nachgemessen,
  einschließlich der Unterscheidung „falsy ⇒ unverändert `UNRESTRICTED`" gegen „truthy ⇒ `THROWS`",
  und jeder wird gemeldet.

#### Was **nicht** prüfbar war

- **Die Meilisearch-Hälfte in Ausführung.** Keine Engine im Container; geprüft ist die erzeugte
  Filterzeichenkette bzw. dass `mongoToMeli` wirft. Unverändert gegenüber `JR-1309`.
- **Ob eine reale Installation eine der acht F30-Formen besitzt.** Wie bei F27 ist die Eintrittsrate
  nicht messbar; belegt ist, dass die Formen speicherbar waren, dass ihre Wirkung kippt und dass die
  Anleitung sie nicht meldet.
- **Der Volllauf gegen PostgreSQL 17.10.** Für die **Suite** bleibt der Nachweis der CI-Lauf aus
  `JR-1309`; nur die Betreiber-SQL ist hier auf 17.10 gemessen worden.
- **Vollständigkeit der Formliste.** Meine acht F30-Formen sind konstruiert, nicht erschöpfend. Eine
  Abfrage über schemaloses JSONB ist gegen unbekannte Formen nicht beweisbar vollständig — genau
  deshalb ist `JR-1316` (Regressionstest für die Betreiber-SQL) die richtige Absicherung.

**Kein Produktionscode, kein Test, keine öffentliche Doku geändert.** Alle Proben liefen in einem
Wegwerf-Verzeichnis (`packages/backend/.probe/`, danach gelöscht) und in Wegwerf-Datenbanken. Nach dem
**Volllauf** 0 `oa_test_*`-Rückstände; beide Cluster (16.13 und 17.10), die Prüfdatenbanken und die
pgdg-Paketquelle sind restlos entfernt. `pnpm lint` grün,
`pnpm --filter @open-archiver/backend test:types` grün, `pnpm docs:build` grün.

### E13 — Nacharbeit `JR-1313`–`JR-1315` erledigt (2026-07-29, Rolle `senior-dev`)

Drei Commits auf `claude/journaling-e13-iam-hardening`, je einer pro Task, gepusht. **Kein Rückmerge,
kein PR** — `JR-1309a` kommt zuerst. Stand vor Beginn `13a7114`, gegen
`git ls-remote origin refs/heads/claude/journaling-e13-iam-hardening` abgeglichen: identisch, kein
Container-Rollback.

**Suite: `224 passed | 2 skipped` (Exit 0) vorher ⇒ `250 passed | 2 skipped` (Exit 0) nachher**, 16 ⇒
17 Dateien, `unit` von 7 auf 8 (`minimumFiles` in `tests/support/suite-inventory.ts` mit angehoben).
Die 2 Skips sind unverändert die `[nightly]`- und `[manual]`-Suite. Gemessen gegen einen lokalen
PostgreSQL-16.13-Cluster ohne Docker, `OA_TEST_REQUIRE_INFRA=1`, 0 `oa_test_*`-Rückstände.

#### `JR-1313` (`cfb1462`) — ein Prädikat statt zwei Kopien

`packages/backend/src/helpers/conditionKey.ts` ist **neu** und importiert **nichts**. Es besitzt
`relationToTableMap`, `resolveConditionKey()` (Form + Relation, liefert `table`/`column` mit),
`isConditionOperatorKey()` und `checkConditionsShape()`. Beide Gates fragen dieses Modul:
`PolicyValidator.areConditionKeysValid()` und `mongoToDrizzle.getDrizzleColumn()`; beide haben ihre
eigenen Regexe und ihre eigene Segmentlogik verloren.

**Begründung der Ablage** (die Frage aus dem Task): der Validator darf `mongoToDrizzle` nicht
importieren, sonst zieht er `drizzle-orm` in eine Klasse, die heute nur Typen importiert — und damit in
jeden Unit-Test, der eine Policy validiert. Umgekehrt hat ein SQL-Übersetzer nichts im IAM-Modul zu
suchen, und `relationToTableMap` gehört neben den Code, der einen Tabellennamen rendert. Bleibt: ein
drittes, abhängigkeitsfreies Modul in `helpers/`, neben dem Übersetzer.

`conditions` selbst muss jetzt ein **Objekt** sein oder fehlen; Skalar, Array und `null` werden beim
Anlegen abgewiesen. `undefined` gilt als **abwesend**, nicht als fehlerhaft — `JSON.stringify` verwirft
es ohnehin, die beiden sind nach einem Datenbank-Roundtrip nicht unterscheidbar. **Das Laufzeitverhalten
für bereits gespeicherte Policies ist unverändert:** `FilterBuilder.ts` ist in diesem Commit nicht
angefasst.

Neuer Test `packages/backend/tests/unit/condition-key-gates.test.ts` (26 Fälle): 20 Keys und 9
`conditions`-Formen durch **beide** Gates, Urteile nebeneinander, plus je Fall das **erwartete** Urteil
— „beide sind sich einig" allein wäre auch von zwei gleichsinnig kaputten Gates erfüllt. Die drei
Restspalte (Spaltenexistenz, Operatornamen, `conditions: {}`) sind **grüne Assertions**, kein Kommentar;
sie zu schließen macht die Datei rot und zwingt zum Lesen der Begründung.

**Eine Ausnahme zur Regel „kein vorher grüner Test wird rot", benannt und begründet:**
`policy-validator.test.ts` „accepts conditions it does not understand" pinnte, dass `a.b.c` akzeptiert
wird. Einzeln nachgemessen — alter Test gegen neuen Validator: `1 failed | 52 passed`, genau dieser
Fall. Der Pin dokumentierte die Lücke, die F29 ist; er ist ersetzt, nicht gelöscht: die Hälfte zum
unbekannten Operator bleibt grün, die Hälfte zum Key ist umgedreht, mit der Begründung im Test.

**Kein neuer i18n-Key.** Der Ablehnungsgrund wird wie bisher hinter `req.t('iam.invalidPolicy')`
angehängt (`iam.controller.ts:55`, `:91`); dass diese Gründe englisch sind, ist Bestandszustand und
wird hier nicht verändert. Keine Migration, kein Schemaeingriff.

#### `JR-1314` (`c17144e`) — beides, wie entschieden

Query 2 bekommt den Befundtyp `conditions is not an object`, gespeist aus `pair`, mit einer Detailzeile,
die den Wert wörtlich ausgibt und die beiden Lesarten unterscheidet. Query 3 bildet `subject = 'all'`
über eine neue CTE `subject_table` auf **beide** Tabellen ab. Der Absolutsatz ist **ersatzlos** weg; an
seiner Stelle steht „How to read an empty result" mit zwei Listen (was geprüft wird, was nicht) und der
Begründung, dass eine Abfrage über schemaloses JSONB gegen unbekannte Formen nicht beweisbar vollständig
sein kann. Dazu **Änderung 8** im Fließtext für die neue Ablehnung beim Speichern.

**Beleg, aus der Markdown-Datei extrahiert und wörtlich gefahren** (Fallstrick 17), gegen echtes
PostgreSQL 16.13 mit den realen Migrationen und 29 gesäten Rollen:

```
extracted 3 sql block(s)
BLOCK 1 (Query 1)  → 1 row  (no-role@example.com)
BLOCK 2 (Query 2)  → 25 rows
BLOCK 3 (Query 3)  → 9 rows
```

Nie gemeldet, in **keiner** Ausgabe: `predefined_super_admin`, `predefined_end_user`,
`predefined_read_only_user`, die Kontrolle `C1 hand-written but unaffected`, und die Sonde
`P2 rule is not an object`.

**Falsch-negativ-Prüfung** nach der Methode aus Fallstrick 15 — Übersetzer `efea6bc` gegen HEAD, im
selben Prozess, rein (kein `db`-Import nötig), 17 `conditions`-Werte:

```
value                | pre-E13                  | post-E13   | gemeldet von
{}                   | NO FILTER (unrestricted) | REFUSED    | Q2 empty conditions object
null / "" / 0 / false| NO FILTER (unrestricted) | REFUSED *  | Q2 conditions is not an object
5 / true             | NO FILTER (unrestricted) | REFUSED    | Q2 conditions is not an object
"userEmail"          | FILTER                   | REFUSED    | Q2 conditions is not an object
[] / [{userEmail}]   | NO FILTER (unrestricted) | REFUSED    | Q2 conditions is not an object
{foo.bar}            | FILTER                   | REFUSED    | Q2 unresolvable relation
{a.b.c}              | FILTER                   | REFUSED    | Q2 key is not a column reference
{attachment.name}    | FILTER                   | REFUSED    | Q2 unresolvable relation
{$regex}             | NO FILTER (unrestricted) | REFUSED    | Q2 unsupported operator
{$or: []}            | NO FILTER (unrestricted) | REFUSED    | Q2 branch list is empty
{userEmail}          | FILTER                   | FILTER     | — (Kontrolle, schweigt)
{userEmial} (Tippf.) | FILTER                   | FILTER     | Q3 (unverändert defekt, beide Releases)
```

`*` Für die **falsy** Familie entscheidet `FilterBuilder` über `!rule.conditions`, **bevor** der
Übersetzer läuft; das Ergebnis der Anwendung ist vor und nach E13 `UNRESTRICTED` (deckt sich mit F26).
Der Übersetzer ist strenger geworden, die Entscheidung nicht. Die Seite sagt genau das.

**Null Falsch-negative:** jeder Wert mit `pre ≠ post` wird von einer der Abfragen gemeldet.

**Ein Falsch-positives, das ich selbst eingebaut und vor dem Commit korrigiert habe:** ein
`ELSE st.table_name` ohne Segmentzahl-Wächter machte in Query 3 aus `foo.bar` fälschlich
`archived_emails.bar`. Aufgefallen ist es genau durch den wörtlichen Lauf, nicht durch das Lesen des
Entwurfs.

**Eine Randlage, die kein Falsch-positives ist:** `manage all` mit `{"userEmail": …}` wird von Query 3
für `ingestion_sources` gemeldet, weil dort keine Spalte `user_email` existiert. Die Regel funktioniert
fürs Archiv und lässt die Ingestion-Liste scheitern — das ist ein echter Befund, und die Seite erklärt,
wie er zu lesen ist.

**Zusätzlich zur Ehrlichkeit gemessen:** ein `roles.policies`, das **kein Array** ist, lässt beide
Abfragen mit `ERROR: cannot extract elements from an object` **abbrechen** statt still zu überspringen.
Der erste Entwurf des Doku-Absatzes behauptete „silently skipped" — das war falsch und ist korrigiert,
samt der Abfrage, mit der ein Betreiber die Zeile findet.

#### `JR-1315` (`5c8a521`) — was ich gewählt habe: beides

Der PO hatte keine Präferenz. Gewählt ist **beides**, weil jede der beiden Varianten allein etwas
Unwahres stehen lässt:

- **Die Behauptung ist eingeschränkt.** `06-status.md` und `07-session-handover.md` sagen jetzt, dass in
  `JR-1306` nur **F4** einen Kommentar bekam und der F5-Kommentar erst mit `JR-1315` kam. Den Code so zu
  ändern, dass ein alter Satz nachträglich stimmt, würde verfälschen, welcher Commit was getan hat.
- **Der F5-Kommentar ist nachgezogen**, `mongoToDrizzle.ts:130–134`, attribuiert an `JR-1315`. Ein Leser
  von `eq(column, value)` kann sonst nicht erkennen, dass `= NULL` bekannt und gewollt offen ist.

Prüfung wie im Kriterium:
`grep -rn "F4\|F5\|finding F" --include=*.ts packages/backend/src/ | grep -v test` findet jetzt beide
Nummern.

#### Bewusst nicht angefasst

F2, F4, F5, F6, F9, F10, F17, F18, F23, F24 bleiben offen; F4 und F5 sind im **Verhalten** unverändert
(Golden-Pins grün), nur kommentiert. `FilterBuilder.ts` und `mongoToMeli.ts` sind in allen drei Commits
**nicht** angefasst — die Laufzeitseite von F26 gehört zu `JR-1311`. `JR-1310`, `JR-1311`, `JR-1312`
und `JR-1316` sind nicht angerührt.

`pnpm lint` grün · `pnpm --filter @open-archiver/backend test:types` grün ·
`pnpm --filter @open-archiver/backend build` grün · `pnpm docs:build` grün, `docs/.vitepress/dist/dev/`
existiert **nicht** · lokaler Cluster und Prüfdatenbank restlos entfernt · keine internen `JR-*`-IDs
und keine Befundnummern in der öffentlichen Doku (gegen `grep` geprüft).

### Abnahme `JR-1309` (2026-07-29) — Ergebnis: **E13 nicht abgenommen**

Unabhängige Abnahme in eigener Session, Rolle `tester`, HEAD `54536cd`. **Zuerst gegen das Remote
abgeglichen:** `git log --oneline -1` = `54536cd`, `git ls-remote origin refs/heads/…` =
`54536cd31b1a…` — identisch, kein Container-Rollback.

> **Urteil: E13 ist nicht abnehmbar.** Die **fünf Codekorrekturen sind sauber und unabhängig belegt** —
> der Injektionsweg ist an beiden Gates zu, `FilterBuilder` ist fail-closed, alle 23 Regressionstests
> sind ohne den Fix rot und mit ihm grün. Gebrochen ist die **betreibersichtbare Hälfte**: `JR-1307`s
> Prüf-SQL hat ein gemessenes falsch-negatives für genau die Form, die von „sieht alles" auf „sieht
> nichts" umschlägt (**F27**), und die veröffentlichte Doku behauptet eine Ablehnung beim Speichern,
> die nicht stattfindet (**F29**, zugleich eine Lücke in `JR-1306`s Kriterium). Beides ist klein zu
> beheben; keines davon darf mit einem Rückmerge unter den Tisch fallen, weil `JR-1307`s ganzer Zweck
> die Vorbereitung des Betreibers ist.

**Umfang:** alle neun Tasks gegen ihre Kriterien aus `03-backlog.md`, nicht nur die letzte Runde.
Fünf neue Befunde: **F25**, **F26**, **F27**, **F28**, **F29**. Kein Produktionscode, kein Test, keine
öffentliche Doku geändert; alle Proben liefen in Wegwerf-Kopien unter `/var/tmp` und sind entfernt.

#### Urteil je Akzeptanzkriterium

| Task        | Kriterium (gekürzt)                                                                    | Ergebnis                    | Beleg                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **JR-1301** | Jeder Test ist **vor** dem Fix rot und **nach** dem Fix grün, beides protokolliert     | **erfüllt**                 | Produktionscode auf `efea6bc` zurückgedreht (Wegwerf-Kopie) ⇒ `23 failed \| 201 passed \| 2 skipped`; HEAD ⇒ `224 passed \| 2 skipped`                       |
| **JR-1301** | — je Fix einzeln nachweisbar (eigene Verschärfung)                                     | **erfüllt**                 | Vier Einzelreverts: `mongoToDrizzle` 11 rot, `FilterBuilder` 8, `policy-validator` 2, `SearchService` 1; Vereinigung 22, Volllauf 23                         |
| **JR-1301** | — kein vorher grüner Test ist rot geworden                                             | **erfüllt**                 | Statusdiff `8984ce9` ⇄ HEAD je `fullName`: rot⇒grün **21**, grün⇒nicht-grün **0**, 1 Fall umbenannt (F21-Invertierung), 226 = 226                            |
| **JR-1303** | Nur diese zwei Zeilen geändert; kein weiterer `FilterBuilder`-Aufruf, kein Route-Gate  | **erfüllt**                 | `git diff efea6bc..HEAD -- SearchService.ts` = 2 Zeilen + Kommentare; `search.routes.ts` blob-identisch; `git diff --name-only … api/**` leer                |
| **JR-1302** | `auditor-specific-mailbox.json` liefert **keine** Zeile für `dev@openarchiver.com`     | **erfüllt**                 | Eigene Sonde, Fixture **von der Platte**, echtes PG 16.13, `read` **und** `search`: 0 Zeilen, die verbotene Zeile nie dabei                                  |
| **JR-1302** | Nutzer ohne Rolle bekommt `1=0`, nicht `undefined`. Gegen echtes Postgres              | **erfüllt**                 | `drizzleFilter` und `searchFilter` beide **definiert**; `searchFilter = ingestionSourceId = "-1"`; 0 Zeilen                                                  |
| **JR-1304** | Unbekannter Operator ⇒ Verweigerung, **kein Zweig wird stillschweigend weggelassen**   | **erfüllt**                 | 7 `RED UNTIL JR-1304`-Fälle grün und ohne den Fix rot; ADR-018-Fall in beide Richtungen mutationsgeprüft (Vorrunde), hier per Revert bestätigt               |
| **JR-1305** | `cannot … { $in: […] }` schließt tatsächlich aus, in Drizzle …                         | **erfüllt**                 | `$in`/`$nin`/`$gte`: `not "ingestion_source_id" in ($1)` statt `not … = $1` mit dem Operatorobjekt als Parameter                                             |
| **JR-1305** | … **und** im Meili-Filter                                                              | **teilweise / strukturell** | `(NOT (ingestionSourceId IN ["…"]))` statt `(ingestionSourceId != [object Object])`. **Kein Meilisearch in dieser Umgebung** — nicht ausgeführt              |
| **JR-1306** | Ein Key mit `"` wird **abgewiesen**, nicht escaped-durchgelassen                       | **erfüllt**                 | 12 Nutzlasten, beide Gates: `validator=REJECT`, `mongoToDrizzle=REFUSED`, Legacy-Rolle ⇒ Deny, 0 fremde Zeilen                                               |
| **JR-1306** | Relationszweig ebenso                                                                  | **erfüllt** (Übersetzer)    | `ingestionSource.userId" is not null …` und `ingestionSource."x" or 1=1 --` REFUSED; `sql.raw` ist aus dem Zweig entfernt                                    |
| **JR-1306** | Ein unbekannter, syntaktisch harmloser Key ebenso                                      | **bewusst nicht erfüllt**   | `foo` wird weiter übersetzt — **durch ADR-019 entschieden** und als `JR-1311` geführt. Kein Kriteriumsbruch, sondern eine dokumentierte Änderung             |
| **JR-1306** | `PolicyValidator` weist solche Policies **beim Anlegen** ab                            | **nicht erfüllt**           | **F29**: Validator ACCEPT für `a.b.c`, `attachment.name`, `foo.bar`, die `mongoToDrizzle` REFUSED. Nicht von ADR-019 gedeckt                                 |
| **JR-1307** | Der Hinweis nennt die betroffenen Formen **konkret** statt pauschal zu warnen          | **erfüllt**                 | 7 Änderungen benannt; Query 2 meldet 13 von 13 gesäten betroffenen Rollen, Query 3 den Tippfehler, Query 1 den Nutzer ohne Rolle                             |
| **JR-1307** | — die drei `predefined_*`-Rollen erscheinen in keiner Ausgabe                          | **erfüllt**                 | 25 Rollen gesät; die 3 `predefined_*` und die unbetroffene Gegenprobe in **keiner** der drei Ausgaben                                                        |
| **JR-1307** | Ein Betreiber kann **vor** dem Update feststellen, welche seiner Rollen betroffen sind | **nicht erfüllt**           | **F27**: `conditions: 5` ⇒ vor E13 **unbeschränktes Archiv**, nach E13 Deny — **beide** Abfragen schweigen. **F28**: Tippfehler unter `manage all` ebenfalls |
| **JR-1308** | Entwurf liegt vor und ist **nicht** versendet                                          | **erfüllt**                 | `10-upstream-meldung.md` vorhanden; keine offenen PRs, keine neuen Issues; die Datei ist über `srcExclude` unpubliziert (unten belegt)                       |
| **JR-1309** | Negative Assertions je Rolle                                                           | **erfüllt**                 | Alle 8 Fixtures mit `expect(...).toBe(false)`-Ketten in `ability.test.ts`; 5 davon plus die 3 `predefined_*` zeilenscharf gegen echtes PG                    |
| **JR-1309** | Nachweis, dass F2/F4/F5/F6/F9/F10 unverändert offen dokumentiert sind …                | **erfüllt**                 | Alle sechs in `09-befunde-bestandscode.md` weiter `Status: offen`; Verhalten gemessen unverändert (unten)                                                    |
| **JR-1309** | … und **nicht stillschweigend mitverändert** wurden                                    | **erfüllt**                 | F2/F9/F10-Dateien blob-identisch zu `efea6bc`; F4/F5/F6 pre-gegen-post auf denselben Eingaben identisch. **Aber F25**: der F5-Kommentar fehlt                |

#### Die Suite ist wirklich vollständig gelaufen — nicht nur grün

Der Fallstrick aus dem Handover (Punkt 6, F14/F15: der Wächter zählt **Dateien**, nicht ausgeführte
Tests) ist gezielt gegengeprüft. Testzahl mitzitiert, nicht nur „grün":

```
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres OA_TEST_REQUIRE_INFRA=1 pnpm test
  [TEST-INVENTORY] unit: 7 file(s) (min 7) · integration: 8 (min 8) · adversarial: 1 (min 1) · unclassified: 0
  Test Files  16 passed (16)
       Tests  224 passed | 2 skipped (226)        EXIT=0
```

- **Die 2 Skips sind genau die bekannten**, aus dem JSON-Report je `fullName` gelesen:
  `[nightly] mongoToDrizzle() adversarial -- 25000 seeded trees` und
  `[manual] … 30000 ms soak`, beide mit Grund `class '…' not selected`. **Keine dritte Übersprung.**
- **Alle 8 `integration`-Dateien sind gelaufen**, mit Fallzahlen: `filter-builder-f1-f3` 7,
  `filter-builder-f7` 6, `filter-builder-f8` 4, `filter-builder` 5, `mongo-to-meli` 10, `pg-harness`
  13, `postgres-availability` 3, `predefined-roles` 7. Alle acht rufen `suiteRequiring('ci', …)` auf.
- **`minimumFiles` hat aktuell kein Spiel** (7/7, 8/8, 1/1) — F15s Klasse ist heute nicht auslösbar.
- **Unabhängige Bestätigung auf PostgreSQL 17.10:** CI-Run
  [30456242256](https://github.com/maxx1337/OpenArchiver/actions/runs/30456242256) auf `54536cd`,
  14/14 Schritte `success`, `starting PostgreSQL 17.10`, `Tests 224 passed | 2 skipped (226)`,
  `Suite inventory verified: unit 7/7, integration 8/8, adversarial 1/1`,
  „No oa*test*\* databases left behind." **Die Versionslücke 16.13/17.10 ist damit für die Suite
  geschlossen** — für die Prüf-SQL aus `JR-1307` **nicht**, siehe „Was nicht prüfbar war".
- Die roten CI-Läufe der Rot-Phase sind ebenfalls belegt und nicht bloß behauptet: `f6a55c0`,
  `8984ce9`, `bbcd3e5` ⇒ `failure`; ab `704e8d1` ⇒ `success`.

#### `predefined-roles.int.test.ts` ist kein Tautologie-Test

Zwei Mutationen am **Produktionscode** der Rollendefinition, beide in einer Wegwerf-Kopie:

| Mutation                                                                      | Ergebnis                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `predefined_read_only_user`: `action: ['read','search']` ⇒ `['read']`         | **4 von 7 rot**, darunter beide ADR-017-Kernfälle („no predefined role reaches the null branch", „read and search give byte-identical results")                                           |
| `createDefaultRoles()` wirft (der Aufrufer schluckt den Fehler und loggt nur) | **6 von 7 rot**, mit der vorgesehenen Meldung „the production role bootstrap did not create every predefined role … a silent failure here would otherwise produce a green but empty test" |

Die Rollen kommen tatsächlich aus dem Produktionscode (`IamController.getRoles()` für die zwei
Default-Rollen, `UserService.createAdminRole()` für den Super Admin) und die „green but empty test"-Falle
ist konstruktiv geschlossen. Die im Test dupliziert nachgebaute Zweig-Klassifikation ist bewusst eine
**zweite** Messung und keine Wiederholung der Implementierung.

#### Der Injektionsweg ist zu — ADR-019s Behauptung hält

12 Nutzlasten, drei Gates, gegen echtes PostgreSQL 16.13. Nutzlast 1 ist die vierte, lauffähige aus
F1; Nutzlasten 5–12 sind Umgehungsversuche gegen `^[A-Za-z_][A-Za-z0-9_]*$` (NUL-Byte, Newline,
Relationszweig, verdoppeltes Anführungszeichen, Fullwidth-Homoglyph, mehrteilige Keys).

```
validator | translator | Legacy-Rolle (Validator umgangen) | key
REJECT    | REFUSED    | FilterBuilder threw (deny)        | userEmail" is not null or "id" is not null or "userEmail
REJECT    | REFUSED    | FilterBuilder threw (deny)        | id" or 1=1 --
REJECT    | REFUSED    | FilterBuilder threw (deny)        | id" is not null or "id
REJECT    | REFUSED    | FilterBuilder threw (deny)        | userEmail" is not null or "id" is not null --
REJECT    | REFUSED    | NOT STORABLE (jsonb)             | userEmail"<NUL> is not null or …
REJECT    | REFUSED    | FilterBuilder threw (deny)        | userEmail"\n is not null or …
REJECT    | REFUSED    | FilterBuilder threw (deny)        | ingestionSource.userId" is not null or …
REJECT    | REFUSED    | FilterBuilder threw (deny)        | ingestionSource."x" or 1=1 --
REJECT    | REFUSED    | FilterBuilder threw (deny)        | userEmail""
REJECT    | REFUSED    | FilterBuilder threw (deny)        | user＂Email        (Fullwidth U+FF02)
REJECT    | REFUSED    | FilterBuilder threw (deny)        | userEmail or 1=1
REJECT    | REFUSED    | FilterBuilder threw (deny)        | a.b."c" or 1=1 --
ACCEPT    | TRANSLATED | sql-error (Spalte fehlt)         | __proto__      ← ADR-019-Restspalt, JR-1311
ACCEPT    | TRANSLATED | sql-error (Spalte fehlt)         | constructor    ← dito
```

**Keine Nutzlast erreicht eine fremde Zeile, keine erzeugt einen unbeschränkten Filter** — auch dann
nicht, wenn die Rolle direkt in die Datenbank geschrieben wird und den Validator damit umgeht. Das
NUL-Byte scheitert schon an `jsonb` („unsupported Unicode escape sequence", `22P05`), also an Postgres
und nicht an der Anwendung. `__proto__`/`constructor` sind gültige Identifier und laufen in einen
Spaltenfehler — genau der in ADR-019 benannte Restspalt, fail-closed.

#### F2/F4/F5/F6/F9/F10: unverändert — mit einer Ausnahme in der Doku darüber

| Befund      | Datei                                   | Nachweis                                                                                                                        |
| ----------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **F2**      | `ability.ts`, `AuthorizationService.ts` | Blob-identisch zu `efea6bc` (`8720b523…`, `3e0c3043…`)                                                                          |
| **F9, F10** | `mongoToMeli.ts`                        | Blob-identisch zu `efea6bc` (`9e1ba29f…`) — die Datei wurde auf dem ganzen Branch nicht angefasst                               |
| **F4**      | `mongoToDrizzle.ts`                     | Verhalten identisch (pre gegen post, 4 Eingaben); Kommentar vorhanden und **korrekt** (`:107–108`); grüner Golden-Pin           |
| **F5**      | `mongoToDrizzle.ts`                     | Verhalten identisch (3 Eingaben, inkl. Relationszweig); grüner Golden-Pin — **aber der behauptete Kommentar fehlt ⇒ F25**       |
| **F6**      | `policy-validator.ts`                   | `{action: [], subject: 'x'}` ⇒ `valid: true` vor **und** nach E13, ebenso zwei Varianten; die Änderung ist ein reiner Schritt 3 |

Der Produktionscode-Diff des Branches umfasst **genau vier Dateien**
(`git diff --name-only efea6bc..HEAD -- 'packages/**/src/**' | grep -v test`), keine davon eine
Datei der Befunde F2/F9/F10.

#### Die öffentliche Doku sagt nichts Unzulässiges

- **Keine internen IDs:** `grep -nE "JR-[0-9]{3,4}|ADR-[0-9]{3}|\bF[0-9]{1,2}\b|befunde"` über beide
  angefassten öffentlichen Dateien ⇒ **kein Treffer**.
- **Keine Compliance-Behauptung:** `grep -niE "GoBD|§ *147|§ *257|HGB|17a-4|FINRA|MiFID|revisionssicher|tamper-proof|compliant with|certif"` ⇒ **kein Treffer**.
- **Keine ausnutzbare Nutzlast:** kein `is not null or`, kein `or 1=1`, kein Key mit eingebettetem
  Anführungszeichen in der öffentlichen Doku.
- **`10-upstream-meldung.md` ist nicht gebaut und nicht indexiert:** `pnpm docs:build` grün (20,1 s),
  `docs/.vitepress/dist/dev` **existiert nicht**, kein `dist`-Treffer für `upstream-meldung`,
  `Upstream-Sicherheitsmeldung`, `befunde-bestandscode` oder `is not null or`. Der lokale Suchindex
  (`dist/assets/chunks/@localSearchIndexroot.*.js`, 401 KB, 49 Seitenpfade) enthält **keinen** Pfad
  unter `dev/`; Gegenkontrolle: der neue öffentliche Satz „prohibition without a matching grant" ist
  darin enthalten. `srcExclude: ['dev/**']` ist unangetastet. `git status` nach dem Build sauber, also
  hat `docs:build` auch `docs/api/openapi.json` nicht verändert.

#### `main` unangetastet, kein neuer PR

`origin/main` = `a560b8c` („V0.5.2 release: update docs (#420)") — reiner Upstream-Stand. Keiner der
14 E13-Commits ist Vorfahre von `origin/main` (`git merge-base --is-ancestor` für `f6a55c0`,
`bcac6bd`, `dcec017`, `704e8d1`, `efb5582`, `54536cd`: alle negativ). Der Integrationsbranch enthält
E13 **nicht** — kein Rückmerge stattgefunden. Pull Requests im Repository: **nur #1 und #2**, beide
`state: closed`, `merged: false`; **kein** PR aus E13. (Nebenbefund für den Handover: die dort noch
als „zwei **offene** Pull Requests" geführten #1/#2 sind inzwischen geschlossen.)

#### Sonstige Messungen

`pnpm lint` grün · `pnpm --filter @open-archiver/types build` grün ·
`pnpm --filter @open-archiver/backend build` grün · `pnpm --filter @open-archiver/backend test:types`
grün · `pnpm --filter @open-archiver/frontend check` „0 errors and 0 warnings" ·
`find packages/backend/dist -name '*.test.*'` leer.

**Rückstände nach dem Vollauf: 0** (`select count(*) from pg_database where datname like
'oa\_test\_%'` ⇒ `0`). **F24 gegengeprüft:** auch die dateigefilterten Einzelläufe dieser Abnahme
haben nichts liegen gelassen — F24 betrifft den `-t`-Fallfilter, nicht ein positionales Dateiargument.
Der lokale PostgreSQL-16.13-Cluster ist restlos entfernt (`pg_isready` ⇒ „no response",
Datenverzeichnis gelöscht), ebenso beide Wegwerf-Kopien und die Prüfdatenbank `oa_sqlcheck`.

#### Was nicht prüfbar war

| Punkt                                                                       | Grund                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Die Prüf-SQL gegen PostgreSQL 17.10**                                     | Lokal liegen nur die 16er-Binaries (`/usr/lib/postgresql/16`). Die Abfragen benutzen ausschließlich Sprachmittel ab PG 9.4 (`WITH RECURSIVE`, `WITH ORDINALITY`, `jsonb_each`, `string_to_array`), das Risiko ist also gering — **gemessen ist es nicht.** Die **Suite** dagegen läuft nachweislich auf 17.10 (CI-Run oben) |
| **Die Meilisearch-Hälfte von `JR-1305` in Ausführung**                      | Kein Meilisearch in dieser Umgebung. Geprüft ist die **erzeugte Filterzeichenkette** (`NOT (… IN […])` statt `[object Object]`), nicht dass die Engine sie so auswertet                                                                                                                                                     |
| **Ob Meilisearch `NOT (sizeBytes >= 1000)` überhaupt annimmt**              | `sizeBytes` steht nicht in `filterableAttributes` (`SearchService.ts:476`) — vorbestehend, F9-Nachbarschaft, nicht von E13 verursacht und hier nicht entscheidbar                                                                                                                                                           |
| **Der HTTP-Pfad (`400` beim Speichern) end-to-end**                         | Nur die Ebene `PolicyValidator.isValid()` gemessen. Dass `iam.controller.ts` daraus ein `400` macht, ist gelesen, nicht ausgeführt — ein Servertest scheitert an der Importkette (Redis, `STORAGE_TYPE`, Fallstricke 10)                                                                                                    |
| **Ob eine reale Installation eine Rolle mit skalarem `conditions` besitzt** | F27s Auslöser ist eine fehlerhafte Policy. Die Eintrittswahrscheinlichkeit ist unbekannt und in diesem Repository nicht feststellbar; belegt ist nur, dass der Absolutsatz der Anleitung falsch ist                                                                                                                         |

#### Was zu tun ist, damit E13 abnehmbar wird

Klein und klar abgegrenzt, in dieser Reihenfolge:

1. **F29** — `PolicyValidator.areConditionKeysValid()` auf ≤ 2 Segmente und auf `relationToTableMap`
   prüfen. Danach stimmen beide Gates überein und `access-control-changes.md` §6 ist wieder wahr.
   Damit ist `JR-1306`s letztes Kriterium erfüllt.
2. **F27** — Query 2 um einen Befundtyp für `conditions` erweitern, das existiert und **nicht**
   `object` ist; oder den Satz „No rows means no role … is affected" auf das entschärfen, was die
   Abfrage trägt.
3. **F28** — `subject = 'all'` in Query 3 auf beide Tabellen abbilden, oder die Grenze ausdrücklich
   mit `all` benennen.
4. **F25** — den F5-Kommentar nachziehen oder die Statusaussage auf F4 einschränken (Doku, minimal).
5. **F26** — PO entscheidet, ob der falsy-`conditions`-Fall noch in E13 gehört oder zu `JR-1311`.
   Er ist **kein** Regress und bricht kein Kriterium.

Danach **erneute Abnahme** (`JR-1309a`) — nur der geänderte Umfang plus ein Volllauf, nicht alles neu.

### E13 — `JR-1307` erledigt (2026-07-29, Rolle `senior-dev`)

Zwei Lieferungen, **kein Produktionscode, keine Teständerung, keine Migration**.

**1. ADR-016 geschrieben**, der Platzhalter in `05-entscheidungen.md` ist ersetzt. Die Nummernlücke
zwischen ADR-015 und ADR-017 bleibt inhaltlich erklärt (der Hinweis „nicht umnummerieren" steht jetzt
im ADR selbst statt im Platzhalter). Kern des Arguments, wie vom PO vorgegeben: nicht „Sicherheit geht
vor", sondern **„kein Recht auf dieses Subject" und „darf alles sehen" wurden vom selben Wert
dargestellt, und der unsichere war der Default** — in diesem Zustand ist keine Zugriffsaussage über
das Archiv belegbar. Verworfene Alternative („Verhalten beibehalten und nur dokumentieren", auch als
Schalter) mit dem konkreten Grund: **E11s Auditor-Rolle ist auf genau diesen Mechanismus gebaut**,
E11 wäre mit dem alten Verhalten nicht abnehmbar.

**2. Betreiberdoku in der öffentlichen Doku, englisch (ADR-003):**

| Datei                                                              | Rolle                                                                                                       |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `docs/user-guides/upgrade-and-migration/access-control-changes.md` | **neu** — Release-Hinweis plus Prüfanleitung mit drei SQL-Abfragen                                          |
| `docs/.vitepress/config.mts`                                       | Sidebar-Eintrag unter „Upgrading and Migration" (eine unverlinkte Seite wäre erreichbar, aber unauffindbar) |
| `docs/services/iam-service/iam-policy.md`                          | zwei neue Abschnitte: „Condition Keys" und „When No Rule Applies", mit Verweis auf die Upgrade-Seite        |

**Warum diese Ablage:** die Prüfung findet **vor** einem Update statt, also gehört sie in die
Sidebar-Sektion, die ein Betreiber genau dann öffnet („Upgrading and Migration") — nicht in die
Service-Referenz, die man beim Schreiben einer Policy liest. Umgekehrt musste `iam-policy.md`
angefasst werden, weil dort die Semantik steht, die sich geändert hat: die Seite beschrieb bisher
nicht, was passiert, wenn **keine** Regel greift. Wer nur die Upgrade-Seite gelesen hätte, hätte die
Regel beim nächsten Policy-Schreiben nicht wiedergefunden.

**Was die Anleitung nennt** — alle sieben Verhaltensänderungen, jede mit der betroffenen Policy-Form
und einer Handlungsanweisung: (1) kein `can` ⇒ deny, mit den drei Formen (Nutzer ohne Rolle als
Query 1, `cannot`-only, `search` ohne `read`); (2) unbedingtes `cannot` ⇒ deny; (3) `conditions: {}`
⇒ deny; (4) Suche filtert über `search` statt `read`; (5) `cannot` mit Operator schließt jetzt
**wirklich** aus, Nutzer sehen also **weniger** Zeilen (aus `JR-1305`/F8 — nicht in der
Handover-Liste, aber betreibersichtbar); (6) Condition-Keys gegen die Form geprüft, `400` beim
Speichern, Fehler zur Abfragezeit bei Bestandsrollen; (7) unübersetzbare Bedingung ⇒ Fehler statt
stillschweigend falschem Ergebnis (ADR-018).

**Ausdrücklich als Restspalt benannt** (ADR-019): ein Key, der nur die Spaltenexistenz verletzt, wird
von der Anwendung **nicht** geprüft. Eigener Abschnitt „What is still not checked" plus Query 3, die
diese Prüfung selbst vornimmt — mit dem Satz „The application does **not** perform this check. The
query does, and only for those two subjects." Nichts ist als „vollständig geprüft" dargestellt.

**F17 aufgenommen:** ein eigener Abschnitt sagt, dass in einer frischen Installation **nur** die
Super-Admin-Rolle existiert, dass die anderen beiden `predefined_*`-Policies Vorlagen in der Doku und
keine Datenbankzeilen sind, und dass eine fehlende Read-Only-Rolle **kein Fehler der Installation**
ist. Derselbe Abschnitt hält fest, dass keine der `predefined_*`-Rollen betroffen ist — mit dem
Beleg, dass ein automatisierter Test das gegen eine echte Datenbank prüft, ohne Dateinamen zu nennen.
**Keine Pauschalwarnung.**

**Die Prüf-SQL ist gegen echtes Postgres ausgeführt**, nicht nur geschrieben — PostgreSQL 16.13,
lokaler Cluster ohne Docker. Vorgehen: `roles`/`users`/`user_roles` nach dem Drizzle-Schema angelegt,
14 Rollen eingespielt (die drei `predefined_*`, zehn absichtlich betroffene, eine unbetroffene
Gegenprobe), dazu sieben Randfälle. Die veröffentlichten Blöcke wurden **aus der Markdown-Datei
extrahiert und wörtlich ausgeführt**, nicht aus dem Entwurf.

```
Query 2 — 10 von 10 betroffenen Rollen gemeldet, je mit Regelnummer:
 Auditor prohibition only | prohibition without a matching grant         | read archive is forbidden by rule #1, but no rule grants it
 Auditor prohibition only | prohibition without a matching grant         | search archive is forbidden by rule #1, but no rule grants it
 Blanket revoke           | prohibition without conditions               | rule #2 forbids read archive and carries no condition
 Empty branch list        | condition branch list is empty               | rule #1: $or has no branches
 Empty conditions         | empty conditions object                      | rule #1 (can read archive) has "conditions": {}
 Injection shaped key     | condition key is not a column reference      | rule #1: key "userEmail\" is not null or \"id"
 Operator prohibition     | prohibition with an operator condition       | rule #2 uses the operator $in inside a "cannot" condition
 Regex condition          | unsupported condition operator               | rule #1: operator "$regex"
 Search without read      | archive search granted without archive read  | search archive is granted, read archive is not
 Unknown relation key     | condition key names an unresolvable relation | rule #1: key "attachment.name" (…)

Query 3 — der Restspalt, den die Anwendung nicht prüft:
 Typo in column name | 1 | archive | userEmial | archived_emails | user_emial

Query 1 — Nutzer ohne Rolle:  orphan@example.com
```

**Die drei `predefined_*`-Rollen und die unbetroffene Gegenprobe erscheinen in keiner Ausgabe** — das
ist der Grund, warum die Anleitung ohne Pauschalwarnung auskommen kann. Die Randfälle sind ebenfalls
geprüft: ein Skalar als Policy-Element, ein leeres `policies`-Array, `manage`/`all` als
**einelementiges Array** (kein Falschtreffer), `a.b.c`, `$nor`, `$not` um eine Operator-Bedingung,
`conditions: null` an einem `cannot`. Kein Fehler, kein Falschtreffer.

**Belege:**

```
pnpm lint                                  → All matched files use Prettier code style!
pnpm docs:build                            → build complete in 19.46s
ls -d docs/.vitepress/dist/dev             → No such file or directory   (srcExclude greift)
docs/.vitepress/dist/user-guides/upgrade-and-migration/access-control-changes.html vorhanden
DATABASE_URL=… OA_TEST_REQUIRE_INFRA=1 pnpm test
  Test Files  16 passed (16)
       Tests  224 passed | 2 skipped (226)     EXIT=0
```

**Kein neuer i18n-Key** — die Doku enthält keine UI-Zeichenkette, und es wurde keine Meldung im
Produktionscode geändert. Keine `JR-*`-ID, keine F-Nummer und kein Ausnutzungsbeispiel in der
öffentlichen Doku; keine Compliance-Behauptung. `docs/api/openapi.json` ist durch `docs:build`
**nicht** verändert worden (`git status` sauber für diese Datei).

**Ein Befund beim Schreiben, nicht behoben (Auftrag: melden):** `docs/services/iam-service/iam-policy.md`
listet in „Actions" die Action `export` weiterhin nicht und beschreibt `manage` als Expansion auf
`create/read/update/delete/search/sync` statt als echten Wildcard — das ist die in `CLAUDE.md` §5.4
benannte stale Stelle (3) des Permission-Vokabulars. Sie liegt in derselben Datei, die `JR-1307`
angefasst hat, gehört aber nicht zu dieser Task. **Vorschlag an den PO:** eigene, nur
dokumentarische Task; die Quellen (1) und (2) sind bereits einig, es ist reine Doku-Nacharbeit.

### E13 — Grün-Lauf der Fixes `JR-1302`–`JR-1306` (2026-07-29, Rolle `senior-dev`)

**Ausgangsstand (derselbe Lauf wie unter „Rot-Läufe `JR-1301`", auf `8984ce9` reproduziert):**

```
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres OA_TEST_REQUIRE_INFRA=1 pnpm test
 Test Files  6 failed | 10 passed (16)
      Tests  21 failed | 203 passed | 2 skipped (226)      EXIT=1
```

**Endstand (`dcec017`, gleiches Kommando, gleicher Cluster):**

```
 Test Files  1 failed | 15 passed (16)
      Tests  1 failed | 223 passed | 2 skipped (226)       EXIT=1
```

**Der Nachweis „kein vorher grüner Test ist rot geworden" ist maschinell geführt**, nicht durch
Zählen: beide Läufe wurden mit `--reporter=json` protokolliert und die Statuslisten je Testnamen
verglichen (`8984ce9` gegen `dcec017`).

| Übergang                | Anzahl | Anmerkung                                                                            |
| ----------------------- | ------ | ------------------------------------------------------------------------------------ |
| rot ⇒ grün              | **20** | alle `RED UNTIL JR-13xx` außer einem                                                 |
| grün ⇒ nicht grün       | **0**  | keine Regression                                                                     |
| Fall verschwunden / neu | 1 / 1  | derselbe Golden-Fall, umbenannt: `translates …` ⇒ `refuses …` (die F21-Invertierung) |
| noch rot                | **1**  | Testwiderspruch, aufgelöst in `704e8d1` per ADR-018 ⇒ Endstand `224 passed`, Exit 0  |

`predefined-roles.int.test.ts` ist mit **allen sieben** Fällen grün geblieben — eine
Standardinstallation verhält sich vor und nach den Fixes identisch, wie ADR-017 behauptet.

**Geänderter Produktionscode — vier Dateien, nichts sonst** (`git diff --stat 8984ce9..HEAD`):

| Datei                                | Task                | Änderung                                                                                                                                   |
| ------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/services/SearchService.ts`      | `JR-1303`           | Zeilen 311/423: drittes Argument `'read'` ⇒ `'search'`, plus je ein erklärender Kommentar. Kein Route-Gate angefasst                       |
| `src/services/FilterBuilder.ts`      | `JR-1302`,`JR-1305` | `null` ⇒ deny; unbedingtes `cannot` ⇒ deny (F20); `undefined` aus dem Übersetzer ⇒ deny (F19); `cannot`-Ausschluss über `$not` statt `$ne` |
| `src/helpers/mongoToDrizzle.ts`      | `JR-1304`,`JR-1306` | unübersetzbare Bedingungen werfen statt zu verschwinden; Condition-Keys gegen eine Allowlist; `sql.raw` entfernt; Rückgabetyp `SQL`        |
| `src/iam-policy/policy-validator.ts` | `JR-1306`           | Schritt 3 von `isValid()` implementiert: Condition-Keys rekursiv geprüft, auch in `$or`/`$and`/`$not`                                      |

**Zwei Testdateien geändert — ausschließlich die vom PO freigegebene F21-Invertierung:**

| Datei                                         | Änderung                                                                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/helpers/mongoToDrizzle.test.ts`          | `attachment.name` erwartet jetzt eine Abweisung; der F21-Vorbehalt im Suite-Kommentar durch die Entscheidung ersetzt; neuer `it.each` für `mustRefuseKey`-Golden-Fälle |
| `tests/fixtures/mongo-to-drizzle-golden.json` | Fall `foo.bar`: von einem Übersetzungsfall auf **`mustRefuseKey`** umgestellt, alte Ausgabe in `observedBeforeE13` festgehalten                                        |

> **Warum ein eigener Marker `mustRefuseKey` und nicht `mustFailClosed`:** der F3-Test assertiert
> ausdrücklich, dass die Golden-Datei **drei** `mustFailClosed`-Fälle trägt. Der `foo.bar`-Fall gehört
> zu F1/`JR-1306`, nicht zu F3. Ein eigener Marker lässt die F3-Zahl unverändert und hält die
> Gesamtzahl der Testfälle bei 226 — sonst wären es 225 und jede Zahl in diesem Dokument müsste neu
> gelesen werden.

**Die Allowlist prüft die Form des Keys plus die Relation, nicht die Existenz der Spalte.** Ein Key
wird angenommen als einzelner Identifier (`^[A-Za-z_][A-Za-z0-9_]*$`) oder als
`<relation>.<identifier>`, sofern die Relation in `relationToTableMap` steht. Abgewiesen wird damit
jeder Key mit SQL-Syntax **und** jeder mit unbekannter Relation (`attachment.name`, `foo.bar`,
`a.b.c`). Ein einzelner, unbekannter, syntaktisch harmloser Key (`foo`) wird **weiterhin
übersetzt** — eine echte Spalten-Allowlist ist in `mongoToDrizzle` nicht formulierbar, weil die
Funktion keinen Tabellenkontext hat, und sie würde drei weitere heute grüne Pins brechen
(`{a:1}`, `{b:2}`, `{n:{$gt:1}}`, dazu die `FIELDS`-Liste der adversarialen Suite). Das ist die
einzige Abweichung von der Formulierung „jeder unbekannte Key" in der F21-Entscheidung und wird hier
festgehalten, damit sie nicht als Versehen gelesen wird. **Vorschlag:** eine spaltengenaue Prüfung
gehört dorthin, wo das Subject bekannt ist — also in die Nähe von `JR-1310`.

**Bewusst nicht angefasst** (kein Scope-Creep, `JR-1309` prüft das): F2, F4, F5, F6, F9, F10, F17,
F18, F23. F4 (nur der erste Operator wird gelesen) und F5 (`{field:null}` ⇒ `= NULL`) sind in
`mongoToDrizzle` im Verhalten erhalten, ihre Pins sind grün. **Berichtigt (F25, `JR-1315`):** einen
Kommentar hat in diesem Commit nur **F4** bekommen; der F5-Kommentar ist in `JR-1315` nachgezogen
worden, nicht hier. `mongoToMeli.ts` ist unverändert. **Keine Migration, kein Schemaeingriff, kein neuer i18n-Key**
— der Ablehnungsgrund des Validators wird wie die bestehenden Gründe hinter
`req.t('iam.invalidPolicy')` auf Englisch angehängt (`iam.controller.ts`); dass diese drei Gründe
nicht lokalisiert sind, ist ein Bestandszustand, den E13 nicht verändert.

`pnpm lint` grün · `pnpm --filter @open-archiver/backend test:types` grün ·
`pnpm --filter @open-archiver/backend build` grün · keine `oa_test_*`-Rückstände · lokaler
PostgreSQL-16.13-Cluster restlos entfernt. Kein Frontend-Code berührt, `svelte-check` daher nicht
einschlägig.

### E13 — Der Testwiderspruch, **aufgelöst** (ADR-018, `704e8d1`)

> **Erledigt.** Die Vorlage unten bleibt als Herleitung stehen; entschieden ist sie in **ADR-018**:
> die Unit-Erwartung gilt, die Integrationszeile war falsch und ist korrigiert. Ein unübersetzbarer
> Zweig wird **verweigert**, nicht durch ein never-true-Prädikat je Zweig ersetzt — letzteres kippt
> unter `$not` zu `not(false)` = wahr und verliert damit ein Verbot.
>
> Die korrigierte `it` prüft jetzt über einen lokalen Helfer `refusesAndExposesNothing()` sowohl die
> Verweigerung **als auch**, falls ein Deny-Prädikat zurückkommt, dass dieses Prädikat gegen echtes
> Postgres **keine** Zeile liefert. Damit bleibt der Grund erhalten, warum der Fall in der
> Integrationssuite liegt: die Behauptung ist nicht „der Übersetzer verweigert", sondern „durch das,
> was er zurückgibt, ist keine Zeile erreichbar".
>
> **Mutationsgeprüft in beide Richtungen**, damit die Umschreibung kein Test ist, der bloß aufgehört
> hat zu scheitern: mit dem Übersetzer vor `JR-1304` scheitert der Fall an der Einzelzweig-Form, mit
> einem Mutanten, der nur den Leerheits-Fall behebt und weiter Zweige verwirft, an der partiellen
> Disjunktion.
>
> **Lehre für kommende `RED UNTIL`-Sätze:** zwei Erwartungen mit **demselben** Tag müssen gegeneinander
> geprüft werden, bevor der Fix beginnt. Hier war keiner der beiden Tests für sich falsch — der Tell
> war, dass beide dieselbe Task nannten.

#### Ursprüngliche Entscheidungsvorlage (zur Herleitung)

```
RED UNTIL JR-1304: the Drizzle half alone is fail-closed for an untranslatable condition (F3)
  tests/integration/filter-builder-f1-f3.int.test.ts
```

**Er ist mit seinem Geschwistertest aus derselben Task unvereinbar.** Beide beschreiben die
_strukturell identische_ Eingabe — eine Disjunktion aus einem übersetzbaren und einem
unübersetzbaren Zweig — und fordern Gegenteiliges:

| Ort                                                      | Eingabe                                              | Forderung                                                                     |
| -------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/helpers/mongoToDrizzle.test.ts:203`                 | `{ $or: [ {id:'a'}, {subject:{$regex:'x'}} ] }`      | `expectFailClosed` ⇒ **throw oder `1=0`/`false`**                             |
| `tests/integration/filter-builder-f1-f3.int.test.ts:236` | `{ $or: [ {userEmail:E}, {subject:{$regex:'…'}} ] }` | ein Prädikat, das **genau `[rows.mine]`** liefert — also weder noch           |
| `tests/integration/filter-builder-f1-f3.int.test.ts:223` | `{ $or: [ {subject:{$regex:'…'}} ] }`                | ein Prädikat, das **keine** Zeile liefert — der Aufruf ist **nicht** in `try` |

Eine Implementierung kann höchstens zwei der drei erfüllen. Gewählt ist **werfen**, aus drei Gründen:

1. Das Akzeptanzkriterium von `JR-1304` lautet „kein Zweig wird stillschweigend weggelassen" — auch
   im `$or` (dort verengend, F22). Die Forderung des Unit-Tests deckt sich damit, die zweite
   Assertion des Integrationstests hält gerade das F22-Verhalten fest, das das Kriterium verbietet.
2. `mongoToMeli` **wirft** für genau diese Form schon heute, und ein **grüner** Test hält das fest
   (`tests/integration/mongo-to-meli.int.test.ts:147`). `FilterBuilder.create()` lehnt eine solche
   Policy also bereits vor E13 ab. Ein never-true-Prädikat im Drizzle-Zweig hätte die beiden
   Übersetzer auseinanderlaufen lassen.
3. Ein never-true-Prädikat pro Zweig ist am `$not` nicht durchhaltbar: `not(false)` ist **wahr** —
   aus einem verlorenen Verbot würde eine Erlaubnis.

**Der Fix ist nicht das Problem, die Testfassung ist es.** Empfehlung an den PO: die beiden Aufrufe
in `filter-builder-f1-f3.int.test.ts` (Zeilen 223 und 236) durch `expectFailClosed` bzw. ein
`try`/`catch` ersetzen und die Erwartung `[rows.mine]` streichen — sie pinnt die F22-Verengung, die
`JR-1304` beseitigen soll. **Das ist eine Teständerung und gehört zur Rolle `tester`, nicht zum
DEV**; sie wurde deshalb nicht vorgenommen und der Test bleibt rot. Danach ist der Endstand
`224 passed | 2 skipped`, Exit 0.

### E13 — Rot-Läufe `JR-1301` (2026-07-29)

**Der Branch ist rot, und das ist das Ergebnis.** Die Vorgängertests hielten F1/F3/F7/F8 als
_bestanden_ fest — ein grüner Test, der eine Sicherheitslücke beschreibt, lässt sie vermessen
aussehen. Sie fordern jetzt den gewünschten Zustand.

**Kommando und Ausgabe (lokaler PostgreSQL-16.13-Cluster, danach restlos entfernt):**

```
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres OA_TEST_REQUIRE_INFRA=1 pnpm test
```

```
[TEST-INVENTORY] unit: 7 file(s) (min 7) · integration: 8 file(s) (min 8) · adversarial: 1 file(s) (min 1) · unclassified: 0
 Test Files  6 failed | 10 passed (16)
      Tests  21 failed | 203 passed | 2 skipped (226)
EXIT=1
```

Zum Vergleich der Ausgangsstand auf `efea6bc`, gleiches Kommando: `10 passed`,
`197 passed | 2 skipped`, Exit `0`. Der Zuwachs an grünen Tests (197 → 203) kommt aus den
Gegenproben, der Zuwachs an roten aus den Anforderungen.

**21 rote Tests, jeder einer DEV-Task zugeordnet.** Das Titelpräfix `RED UNTIL JR-13xx` steht im
Testnamen, ist also im Lauf sichtbar und filterbar (`pnpm test -t "RED UNTIL JR-1302"`).

| Task        | Rot | Datei(en)                                                                                                                                                       |
| ----------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **JR-1302** | 5   | `tests/integration/filter-builder-f7.int.test.ts` (4), `tests/integration/filter-builder-f1-f3.int.test.ts` (1, F20)                                            |
| **JR-1303** | 1   | `tests/unit/filter-builder-call-sites.test.ts`                                                                                                                  |
| **JR-1304** | 7   | `src/helpers/mongoToDrizzle.test.ts` (5, davon 3 aus der Golden-Datei), `tests/integration/filter-builder-f1-f3.int.test.ts` (2, davon 1 = F19)                 |
| **JR-1305** | 3   | `tests/integration/filter-builder-f8.int.test.ts` (`$in`, `$nin`, `$gte`)                                                                                       |
| **JR-1306** | 5   | `src/helpers/mongoToDrizzle.test.ts` (2), `src/iam-policy/policy-validator.f1-conditions.test.ts` (2), `tests/integration/filter-builder-f1-f3.int.test.ts` (1) |

**Kein Opt-out-Mechanismus, bewusst.** Es gibt kein `it.skip`, kein `it.fails`, keine
Umgebungsvariable, die die roten Tests grün oder still macht. Jeder solche Schalter ist ein Hebel, um
das Epic fertig aussehen zu lassen, während der Defekt offen ist — und genau diese Fehlerform hat
`JR-1301` gerade beseitigt. Die Isolation, die man tatsächlich braucht, liefert vitest schon: ein
fehlschlagender Fall macht seinen eigenen Fall rot, die übrigen 15 Dateien laufen und berichten
weiter. `it.fails` ist zusätzlich untauglich: es meldet **grün**, solange der Defekt besteht.

**Neue und geänderte Dateien:**

| Datei                                                                    | Klasse | Rolle                                                                               |
| ------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------- |
| `packages/backend/tests/support/fail-closed.ts`                          | —      | gemeinsamer Fail-closed-Vertrag (`expectFailClosed`, `redUntil`, …)                 |
| `packages/backend/tests/support/express-i18n-augmentation.d.ts`          | —      | Typ-Import, damit `test:types` einen Express-Controller verträgt (F23)              |
| `packages/backend/src/iam-policy/policy-validator.f1-conditions.test.ts` | `ci`   | F1 an der Validierungsgrenze                                                        |
| `packages/backend/tests/unit/filter-builder-call-sites.test.ts`          | `ci`   | ADR-017/`JR-1303`: Aufrufstellen-Inventar                                           |
| `packages/backend/tests/integration/filter-builder-f7.int.test.ts`       | `ci`   | F7a, F7b, ADR-017-Semantik                                                          |
| `packages/backend/tests/integration/filter-builder-f8.int.test.ts`       | `ci`   | F8, drei Operator-Formen                                                            |
| `packages/backend/tests/integration/filter-builder-f1-f3.int.test.ts`    | `ci`   | F1 ausgeführt gegen Postgres, F3/F19/F20                                            |
| `packages/backend/tests/integration/predefined-roles.int.test.ts`        | `ci`   | ADR-017-Wirkungsanalyse, **grün** vor und nach dem Fix                              |
| `packages/backend/src/helpers/mongoToDrizzle.test.ts`                    | `ci`   | geändert: F1-Block und drei F3-Pins umgebaut, `it.fails` entfernt                   |
| `packages/backend/tests/fixtures/mongo-to-drizzle-golden.json`           | —      | geändert: drei `failOpen`-Fälle ⇒ `mustFailClosed`                                  |
| `packages/backend/tests/integration/filter-builder.int.test.ts`          | `ci`   | geändert: F1/F3/F7/F8-Blöcke entfernt, bleibt grün vor und nach dem Fix             |
| `tests/support/suite-inventory.ts`                                       | —      | `minimumFiles` bewusst auf den neuen Bestand: unit 5 → **7**, integration 4 → **8** |
| `packages/backend/tests/unit/suite-inventory.test.ts`                    | `ci`   | geändert: hartkodierte `4` durch `suiteMinimum('integration')` ersetzt              |

Klasse durchweg `ci`: alles läuft in unter 10 s, die `integration`-Dateien brauchen nur die Postgres,
die der CI-Job schon bereitstellt. Kein `nightly`, kein `manual` — es gibt hier keinen Soak und keine
externe Infrastruktur. **F14 beachtet:** die Mindestzahlen sind auf den exakten Bestand gehoben, nicht
mit Spiel gelassen (das ist F15s Fehlerform).

### ADR-017s Wirkungsanalyse: **hält** — Nachweis erbracht

`tests/integration/predefined-roles.int.test.ts` legt die drei Rollen über **Produktionscode** an
(`UserService.createAdminRole()`, und `createDefaultRoles()` über seinen echten Auslöser
`IamController.getRoles()`), nicht über eine Kopie der Policies. Zwei unabhängige Hälften:

**1. Zweig-Sonde.** Von außen liefern `FilterBuilder.ts:31` (gewollter Vollzugriff) und `:49` (der
F7-Defekt) heute **denselben** Wert, sind also nicht unterscheidbar. Die Sonde leitet den Zweig aus
der echten Ability neu ab (`rulesFor` + `rulesToQuery`, wie `FilterBuilder`) und berichtet ihn:

```
predefined_super_admin    / read archive   -> unconditional-can
predefined_super_admin    / search archive -> unconditional-can
predefined_super_admin    / read ingestion -> unconditional-can
predefined_end_user       / read archive   -> translated-query
predefined_end_user       / search archive -> translated-query
predefined_end_user       / read ingestion -> translated-query
predefined_read_only_user / read archive   -> unconditional-can
predefined_read_only_user / search archive -> unconditional-can
predefined_read_only_user / read ingestion -> unconditional-can
```

Kein `null-branch`. **ADR-017s Tabelle ist bestätigt**, für alle drei (Action, Subject)-Paare, die die
vier `FilterBuilder.create()`-Aufrufstellen verwenden.

**2. Verhaltens-Momentaufnahme, und die eigentliche Aussage.** Für jede der drei Rollen sind das
Ergebnis für `('archive','read')` und für `('archive','search')` **identisch** (Filter-Text, gebundene
Parameter, Meili-Filter). Damit ist `JR-1303`s Änderung des dritten Arguments für eine
Standardinstallation belegbar wirkungsfrei — unabhängig davon, was `JR-1302` mit dem `null`-Zweig
macht. Dazu die Zeilen: `predefined_end_user` sieht genau seine eigenen Quellen
(`"ingestion_sources"."user_id" = $1`, Meili `(ingestionSourceId IN [...])`), die beiden anderen alles.

**Zwei Einschränkungen, beide neu und beide benannt:**

- **F18** — die Aussage gilt **je Aufrufstelle, nicht je Rolle.** Über das volle Vokabular (8 Actions
  × 7 Subjects) erreichen `predefined_end_user` **39** und `predefined_read_only_user` **46** Paare den
  `null`-Zweig; nur `manage: all` erreicht ihn nie. Heute harmlos, weil keine Aufrufstelle einen
  Filter für diese Paare baut — und deshalb wacht `tests/unit/filter-builder-call-sites.test.ts`
  jetzt darüber, dass es bei vier Aufrufstellen bleibt.
- **F17** — **zwei der drei Rollen werden in einer echten Installation nie angelegt.**
  `createAdminRole()` legt bei der Ersteinrichtung `predefined_super_admin` an und erfüllt damit
  dauerhaft den Auslöser `!roles.some(r => r.slug?.includes('predefined_'))`, sodass
  `createDefaultRoles()` nie läuft. Nachgewiesen. `JR-1307`s Prüfanleitung muss das sagen: ausgeliefert
  gibt es **keine Read-Only-Rolle**, jede eingeschränkte Rolle ist handgeschrieben und hat die Form von
  `auditor-specific-mailbox.json` — genau die Form, die F7 unwirksam macht. **F7s praktische Schwere
  steigt dadurch.**

Fazit: `JR-1307` bleibt in der entschärften Fassung richtig, muss aber F17 aufnehmen. Die scharfe
Formulierung („der Fix bricht Bestandsinstallationen") ist **nicht** nötig.

### Was `JR-1301` bewusst nicht getan hat

- **Kein Produktionscode geändert.** `FilterBuilder.ts`, `SearchService.ts`, `mongoToDrizzle.ts`,
  `mongoToMeli.ts`, `policy-validator.ts` und alle Routen sind unberührt
  (`git diff --stat -- packages/backend/src ':!*.test.ts'` ist leer).
- **F17, F18, F21, F22 nicht behoben und nicht rot gemacht.** Sie liegen außerhalb der vier Befunde,
  die E13 beauftragt hat; ein roter Test ohne zuständige Task blockiert nur `JR-1309`. Sie sind
  gemeldet und, wo sinnvoll, als Ist-Zustand mit lauter `coverageNotice` festgehalten (F17).
- **Kein Test durch `SearchService` hindurch.** Zwei Gründe, beide im Testkopf benannt: es läuft kein
  Meilisearch in dieser Umgebung, und ein Import von `SearchService` zieht über `IngestionService` →
  `jobs/queues.ts` drei BullMQ-Queues gegen ein nicht vorhandenes Redis. Der Action-Versatz ist
  deshalb über das **Aufrufstellen-Inventar** am Quelltext geprüft, die Semantik dahinter
  verhaltensmäßig über `FilterBuilder`. Die Lücke ist eine Aussage über die Verdrahtung, nicht über das
  Verhalten — wer sie schließen will, braucht ADR-017s Variante C (`JR-1310`) oder Meilisearch im
  Testaufbau.
- **F4, F5, F9, F10 unverändert** als offen dokumentiert und weiterhin als Ist-Zustand gepinnt.
- **PostgreSQL 17 nicht geprüft.** Lokal 16.13, CI 17.10 — die Versionslücke aus `JR-104`/`JR-106a`
  besteht unverändert. Für diese Befunde ist sie unkritisch (kein versionsabhängiges Verhalten
  berührt), sie ist aber nicht ausgeschlossen: der F1-Nachweis hängt an der Operator-Präzedenz und der
  Typprüfung von Postgres, und beides ist zwischen 16 und 17 unverändert, aber nicht gemessen.

---

## E2 – E12 (offen)

Tasklisten stehen in `03-backlog.md`. Sie werden hier erst beim Beginn des jeweiligen Epics
ausgerollt, um diese Datei lesbar zu halten.

Offene ADRs, die vor bzw. während der Epics zu entscheiden sind:

| ADR     | Thema                                                 | Epic            |
| ------- | ----------------------------------------------------- | --------------- |
| ADR-016 | fail-closed rechtfertigt den Verhaltensbruch aus F7   | E13 (`JR-1307`) |
| ADR-006 | Kanonische Kodierung, Genesis-String, `deployment_id` | E2 (`JR-203`)   |
| ADR-007 | Lock-Key-Strategie, Mehrmandantenfähigkeit            | E2              |
| ADR-009 | Append-Only-Erzwingung: Rechteentzug oder Trigger     | E2 (`JR-205`)   |
| ADR-010 | `processEmail` erweitern oder eigener Journaling-Pfad | E6 (`JR-602`)   |
| ADR-008 | TSA-Ausfallverhalten bestätigen                       | E8 (`JR-804`)   |
| ADR-012 | Migrationspfad für Bestandsinstallationen             | E12             |

---

## Sessionprotokoll

| Datum      | Ergebnis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Nächster Schritt                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 2026-07-27 | E0 abgeschlossen: Gap-Analyse, Architektur, Backlog (102 Tasks), Testplan, ADR-Log, `CLAUDE.md`, 2 Subagents, 3 Skills. Kein Produktionscode (ADR-001).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | E1 starten mit `JR-101`                                                                                    |
| 2026-07-27 | Nachtrag: ADR-004 als falsch korrigiert und Veröffentlichungs-Leck via `srcExclude` geschlossen; ADR-014 (Branch-Strategie) ergänzt; `CLAUDE.md` §7 und Handover um Sessionstart-Anleitung erweitert. Build-Nachweis offen (kein `pnpm install` möglich).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `claude/journaling-e1-test-foundation` abzweigen, dann `JR-101`                                            |
| 2026-07-27 | `JR-105a` erledigt auf `claude/journaling-e1-test-foundation`: 7 handgeschriebene Dateien formatiert, 6 generierte per ADR-015 in `.prettierignore`. `pnpm lint` repo-weit grün und bleibt es nach beiden Generatorläufen. Kein Push (sammelt bis Ende E1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `JR-101` (vitest einrichten), danach `JR-105` (CI-Workflow)                                                |
| 2026-07-27 | `JR-101`/`JR-102`/`JR-103` erledigt: vitest 3.2 mit drei Projects (`unit`/`integration`/`adversarial`), Harness in `tests/support/` (Klassifizierung, Seeds, Infra-Probe, Coverage-Hinweise), 146 Testfälle grün, Exit-Code beider Richtungen aktiv verifiziert, Fixture-Ladung durch Umbenennen belegt. Sechs IAM-Befunde (F1–F6) an DEV gemeldet, keiner behoben. Kein Push.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `JR-104` (isolierte Postgres-Basis), danach `JR-105` (CI-Workflow)                                         |
| 2026-07-28 | `JR-104` **geschrieben, Abnahme offen**: `pg-harness` mit eigener Datenbank je Aufruf (Schema-Isolation scheitert an `"public"`-qualifizierten Migrationen), Migrationen über `drizzle-orm/postgres-js/migrator`, garantiertes Teardown plus Sweeper. Lokaler PostgreSQL-16.13-Cluster aus den vorinstallierten Binaries gestartet: 32 Integrationstests grün, `pnpm test` 181 grün, zwei parallele Läufe gleichzeitig grün, 0 Rückstände. Vier neue Befunde F7–F10 (F7 hoch: `FilterBuilder` fail-open) plus F4-Nachtrag. Kein Push.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `JR-105` (CI-Workflow mit `postgres:17-alpine`), danach `JR-106` (Abnahme E1)                              |
| 2026-07-28 | `JR-105` **erledigt, CI-Lauf grün**: `.github/workflows/ci.yml` (Job `verify`, Trigger `pull_request` + `push`, Node 22 / pnpm 10.13.1 aus `engines`/`packageManager`, pnpm-Store gecacht), reiner Prüf-Workflow (kein `format`, kein Auto-Fix, kein Commit, Log nach `$RUNNER_TEMP`, `permissions: contents: read`), `postgres:17-alpine` als Service-Container, zwei Nachlaufprüfungen (übersprungene `integration`-Suite und `oa_test_*`-Rückstände machen den Job rot; beide in beide Richtungen gegengeprüft). Lauf 1 fand **F11**: die vorgegebene Schrittfolge ist auf einem frischen Checkout nicht lauffähig, weil `@open-archiver/types` über das gitignorierte `dist` auflöst — 54 × `TS2307`. Behoben durch einen vorgeschalteten `pnpm --filter @open-archiver/types build`; lokal beidseitig reproduziert. Lauf 3 (`1bad10c`) grün: PostgreSQL 17.10, 181 Tests, `integration` sichtbar gelaufen, 0 Rückstände. Bestehende vier Workflows unverändert.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `JR-106` (Abnahme E1): `JR-104` und `JR-105` vorlegen — deren CI-Bedingung ist erfüllt                     |
| 2026-07-28 | `JR-106` (Abnahme E1) **durchgeführt, Ergebnis: E1 nicht abgenommen.** 15 Kriterien einzeln gegen `03-backlog.md` geprüft, 14 erfüllt: `JR-101`, `JR-102`, `JR-103`, `JR-105a` und `JR-105` abgenommen. `JR-104` **abgelehnt** — neuer Befund **F12**: der Test `sweeps a stale database…` legt seine Fixture-DB unter dem festen Namen `oa_test_1609459200000_999999_deadaa_sweeptest` an, zwei gleichzeitige Läufe gegen dasselbe Postgres kollidieren daher reproduzierbar (4/4) mit `duplicate key … pg_database_datname_index`; der bisherige Nachweis „zwei Läufe gleichzeitig grün" ist widerlegt. CI unberührt (eigener Service-Container je Job) und weiterhin grün. Zusätzlich belegt: die grün aussehende Fehlerform ohne `DATABASE_URL` (Exit 0 bei „149 passed \| 34 skipped") wird von Nachlaufprüfung 1 in allen drei Nichtverfügbarkeits-Modi rot gemacht, legitime `nightly`/`manual`-Skips lösen sie nicht aus; zwei Lücken derselben Prüfung gefunden (abwesende statt übersprungene Suite; falsch benannte `*.test.ts` unter `tests/integration/` wird von keinem Project eingesammelt). Kein Produktionscode geändert, kein Befund behoben. Dokumentenhygiene: **F11 nach `09-befunde-bestandscode.md` verschoben**, F-Nummerierung liegt jetzt in einer Datei.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Entscheidung des Auftraggebers zu **F12**; danach Nacharbeit `JR-104`, erneute Teilabnahme, dann `JR-1301` |
| 2026-07-28 | `JR-104a` und `JR-105b` **erledigt** (Nacharbeit aus der Ablehnung von E1). **F12 behoben**, dreiteilig: prozessspezifische Fixture-Namen über `buildForeignFixtureName()`, `sweepStaleHarnessDatabases({ staleMs, restrictTo })` mit SQL-seitiger Einschränkung und konstruktiver Verweigerung eines gesenkten Schwellwerts ohne `restrictTo`, plus Fixture-Alter unter die Standardfrist gezogen (der 2021er Zeitstempel war ein drittes, in der Abnahme nicht genanntes Teilproblem). Reproduktion vorher 3/3 rot, dabei der bis dahin nur hergeleitete zweite Pfad **beobachtet** (ein Lauf verlor seine eigene Datenbank an den Sweeper des anderen). Nachher: **5 Doppelläufe grün**, plus 3 Tripel- und 3 versetzte Runden, 0 Rückstände, keine Runde unsauber. `JR-105b`: beide Lücken der CI-Nachlaufprüfung mit **positiven** Erwartungen geschlossen — `tests/support/suite-inventory.ts` als einzige Quelle der Include-Globs prüft in `globalSetup` Mindestdateizahlen je Suite und verbietet testartig benannte Dateien ohne Project; `OA_TEST_REQUIRE_INFRA=1` macht fehlende Infrastruktur in der CI zum Fehlschlag statt zum Skip; die Log-Suche ist ersetzt durch eine Report-Datei, deren Fehlen den Job rot macht. Beide Richtungen und alle vier Proben belegt und zurückgebaut. Neuer Befund **F13** (verbleibende Sweeper-Lücke bei Läufen > 2 h, für die E2/E3-Soaks relevant), kein Produktionscode berührt, F1–F11 unangetastet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **`JR-106a`** (erneute Abnahme E1) — muss unabhängig von dieser Session laufen                             |
| 2026-07-28 | `JR-106a` (erneute Abnahme E1) **durchgeführt, Ergebnis: E1 abgenommen.** HEAD `0a94308` zuerst gegen `origin` abgeglichen (identisch — kein Container-Rollback). Alle 20 Kriterien einzeln geprüft und alle erfüllt, keines übernommen: `pnpm test` ⇒ `10 passed`, `197 passed \| 2 skipped`, Exit `0`; Sonden in `packages/types/` und `packages/frontend/` ohne Config-Änderung eingesammelt, dieselbe Sonde fehlschlagend ⇒ Exit `1`; **F12 bestätigt behoben** über 10 nebenläufige Runden (5 Doppel-, 3 versetzte, 2 Dreifachläufe), alle Teilläufe Exit `0`, 0 Rückstände; alle acht IAM-Fixtures einzeln umbenannt ⇒ jedes Mal Exit `1`; CI-Run **30368442950** auf HEAD grün, 14/14 Schritte `success`, `starting PostgreSQL 17.10`, alle vier `integration`-Dateien mit `✓` und Testzahlen, `Suite inventory verified: … integration 4/4`, „No `oa_test_*` databases left behind."; vier Bestandsworkflows blob-identisch in Merge-Base/HEAD/Worktree; genau **ein** `permissions: contents: read` ohne Job-Override; `pnpm lint` grün, erzwungener `pnpm db:generate` (⇒ `0041_whole_sally_floyd.sql`) lässt ihn grün; Produktionscode unberührt (echter Pre-E1-Build vs. HEAD-Build: **233** `dist`-Dateien, Listen identisch, 1 Datei nur im Zeilenumbruch verschieden, md5 nach Whitespace-Strip gleich); `JR-105b` beidseitig belegt, zusätzlich der von der alten Prüfung nicht erfasste **Lösch**-Fall; `00-rfc.md` seit `6d6564c` unverändert, `srcExclude: ['dev/**']` intakt. **Neun Angriffe auf die neue Inventurprüfung**, sechs hielten, drei nicht ⇒ neue Befunde **F14** (Datei- statt Testebene: `ci` → `nightly` schaltet die Suite ab und bleibt grün), **F15** (`minimumFiles`-Spiel verdeckt eine Löschung), **F16** (Rückstand nach Modul-Throw lokal nicht angekündigt) — keiner bricht ein Kriterium, alle drei nach `JR-1305`. Die lazy-Guard-Fehlerklasse ist geschlossen (`OA_TEST_REQUIRE_INFRA=yes` bricht auch bei laufender DB ab). **F13** nachgeprüft und als schwach bestätigt: die Zwischenregel steht in keiner Backlog-Zeile von `JR-208`/`JR-607`/`JR-410` und nicht in §12.6, und es gibt keine Laufzeitprüfung. Kein Produktionscode geändert, kein Befund behoben, kein Rückmerge, kein PR angefasst; PostgreSQL-16.13-Cluster restlos entfernt (Versionslücke zur CI-17.10 bleibt bestehen und ist benannt).                                                                                                                                                                                                                                                                                                                                                                                          | `JR-1301` (E13, Branch `claude/journaling-e13-iam-hardening`)                                              |
| 2026-07-28 | **Rückmerge E1 in den Integrationsbranch** (`efb769c`, `--no-ff`, gepusht als `b4ae8f7`). ADR-014 gibt ihn nach unabhängiger Abnahme frei; `main` bleibt bis E12 unangetastet. **Kein Squash** — die aufgeräumte Sicht liefert bereits `git log --first-parent` (ein Merge-Commit je Epic), und ein Squash würde die dokumentierte Ablehnung von E1 (`cab0e38`) sowie die beweisbare Formatierungs-Reinheit von `JR-105a` (ADR-015) vernichten. Zusätzlich: **`JR-105c`** für F14–F16 angelegt (fällig vor E2; der Wächter zählt Dateien statt ausgeführter Tests), die **F13-Zwischenregel** in die Akzeptanzkriterien von `JR-208`/`JR-607` übernommen, und der falsche Verweis „F14–F16 → `JR-1305`" korrigiert (`JR-1305` ist E13s Task für F8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `JR-1301` (E13) auf `claude/journaling-e13-iam-hardening`                                                  |
| 2026-07-29 | **ADR-017 entschieden (Auftraggeber): Variante B.** `SearchService.ts:311`/`:423` bauen den Filter künftig für `('archive','search')` — dieselbe (Action, Subject), unter der `requirePermission` den Request durchlässt; `search.routes.ts` bleibt unverändert. `JR-1303` ist damit von Entscheidung auf Umsetzung geschärft (Datei und Zeilen im Backlog benannt), `JR-1302` freigegeben. Variante A verworfen (entwertet die Action `search`, die `predefined_read_only_user` getrennt erteilt), Variante C verworfen für E13 und als **`JR-1310`** danach vorgemerkt — nicht Teil von `JR-1309`. Am Code nachgeprüft und in ADR-017 belegt: **keine der drei `predefined_*`-Rollen trifft den `null`-Zweig in `FilterBuilder.ts:49`**, eine Standardinstallation verhält sich vor und nach dem F7-Fix gleich; damit ist die frühere PO-Aussage „der Fix bricht Bestandsinstallationen" korrigiert und `JR-1307` entsprechend entschärft. Erreichbar bleibt der Zweig über Nutzer ohne Rolle, `cannot`-only-Policies auf `archive` und handgeschriebene Rollen mit `search` ohne `read` — **F7 bleibt Schwere hoch.** ADR-016 bleibt für `JR-1307` reserviert, die Nummernlücke ist Absicht. Nur Dokumentation, kein Produktionscode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `JR-1301` (E13) auf `claude/journaling-e13-iam-hardening`                                                  |
| 2026-07-29 | **`JR-1301` erledigt (Rolle `tester`) — der Epic-Branch ist absichtlich rot.** Die F1/F3/F7/F8-Tests, die den Defekt als _bestanden_ festhielten (inkl. `it.fails`), sind zu Regressionstests umgebaut, die den gewünschten Zustand fordern: **21 rote Tests**, `pnpm test` ⇒ `6 failed \| 10 passed` Dateien, `21 failed \| 203 passed \| 2 skipped`, Exit `1` (Ausgangsstand `efea6bc`: `197 passed`, Exit `0`). Jeder rote Test trägt `RED UNTIL JR-13xx` im Namen und ist einer DEV-Task zugeordnet (1302: 5, 1303: 1, 1304: 7, 1305: 3, 1306: 5). **Kein Opt-out-Schalter** — ein `it.skip`/`it.fails` oder eine Env-Variable wäre ein Hebel, das Epic fertig aussehen zu lassen; vitest isoliert ohnehin je Fall. Vier neue Testdateien plus zwei Support-Dateien, `minimumFiles` bewusst auf den neuen Bestand (unit 5→7, integration 4→8, F14/F15 beachtet). **ADR-017s Wirkungsanalyse hält:** die drei `predefined_*`-Rollen werden über Produktionscode angelegt, keine trifft an einer der drei Aufrufstellen den `null`-Zweig, und `('archive','read')` und `('archive','search')` liefern je Rolle identische Ergebnisse — `JR-1303` ist für eine Standardinstallation belegbar wirkungsfrei. **Sieben neue Befunde F17–F23**, davon zwei mit Gewicht: **F17** (zwei der drei „ausgelieferten" Rollen werden nie angelegt, weil `createAdminRole()` den Bootstrap-Auslöser dauerhaft erfüllt ⇒ es gibt ausgeliefert keine Read-Only-Rolle, F7s praktische Schwere steigt) und **F18** (ADR-017s Aussage gilt je Aufrufstelle, nicht je Rolle: 39 bzw. 46 von 56 Paaren treffen den Zweig). F1s Ausnutzbarkeit ist erstmals **gegen echtes Postgres** belegt — von vier Payloads läuft genau einer, und er hebt über drizzles unklammerte `and()`-Verkettung auch die Einschränkung des Aufrufers auf. Kein Produktionscode geändert (`git diff` gegen `src` ohne Tests ist leer), `pnpm lint` grün, `test:types` grün, Backend-Build grün, 0 Datenbank-Rückstände, PostgreSQL-16.13-Cluster restlos entfernt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `JR-1303`, dann `JR-1302`/`JR-1304`/`JR-1305`/`JR-1306` (Rolle DEV) — die roten Tests sind die Abnahme     |
| 2026-07-29 | **Befunde aus `JR-1301` durch den PO abgearbeitet, damit DEV nicht auf Entscheidungen wartet.** Zwei Aussagen von ADR-017 waren zu weit gefasst und sind per **Nachtrag** korrigiert: sie gelten **je Aufrufstelle, nicht je Rolle** (F18 — über das volle Vokabular treffen 39 bzw. 46 von 56 Paaren den `null`-Zweig), und „ausgeliefert" trifft auf zwei der drei Rollen gar nicht zu (F17). Die **Entscheidung Variante B bleibt** und ist durch `predefined-roles.int.test.ts` jetzt belegt statt hergeleitet. **F17 am Code nachgeprüft und bestätigt** (`createFirstAdmin` → `createAdminRole()` legt `predefined_super_admin` an, `getRoles` liegt hinter `requireAuth`): **F7s praktische Schwere steigt** — ausgeliefert existiert keine Read-Only-Rolle, jeder eingeschränkte Nutzer ist eine handgeschriebene Policy in der Form, die F7 unwirksam macht. **F21 entschieden: strenge Allowlist** — abgewiesen wird jeder unbekannte Key, nicht nur einer mit SQL-Syntax; die drei betroffenen grünen Pins werden im selben Commit wie der Fix invertiert (die einzige Stelle in E13, an der ein grüner Test bewusst umgedreht wird). **F22** eingearbeitet: `JR-1304`s Kriterium lautet jetzt „kein Zweig wird stillschweigend weggelassen", mit der richtigen Gefahrenrichtung (`$and` und leere Zweigliste, nicht `$or`). **F17(a)** in `JR-1307` aufgenommen. Offen beim Auftraggeber bleibt allein **F17(b)** — Rollen-Bootstrap reparieren? Produktentscheidung, nicht E13, blockiert nichts. Nur Dokumentation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `JR-1303`, dann `JR-1302`/`JR-1304`/`JR-1305`/`JR-1306` (Rolle DEV)                                        |
| 2026-07-29 | **`JR-1303`, `JR-1302`, `JR-1304`, `JR-1305`, `JR-1306` erledigt (Rolle `senior-dev`).** Produktionscode in vier Dateien, sonst nichts: `SearchService.ts` (ADR-017 B, Zeilen 311/423 auf `'search'`), `FilterBuilder.ts` (`null` ⇒ deny, unbedingtes `cannot` ⇒ deny (F20), `undefined` vom Übersetzer ⇒ deny (F19), `cannot`-Ausschluss über `$not` statt `$ne` (F8)), `mongoToDrizzle.ts` (unübersetzbare Bedingungen werfen, Key-Allowlist, `sql.raw` entfernt), `policy-validator.ts` (Condition-Keys werden beim Anlegen geprüft, rekursiv auch in `$or`/`$and`/`$not`). Keine Migration, kein i18n-Key, `mongoToMeli.ts` unberührt. **20 von 21 roten Tests grün, 0 Regressionen** — maschinell belegt über zwei `--reporter=json`-Läufe und einen Statusdiff je Testname, nicht durch Zählen. Der eine verbleibende rote Test war **kein fehlender Fix**, sondern ein Widerspruch zwischen zwei `JR-1301`-Erwartungen mit demselben `RED UNTIL`-Tag; DEV hat ihn korrekt **nicht** angefasst und vorgelegt. Zwei benannte Abweichungen: die Key-Allowlist prüft Form und Relation statt Spaltenexistenz (⇒ ADR-019, `JR-1311`), und ein gefilterter `-t`-Lauf hinterlässt Testdatenbanken (⇒ **F24**, nach `JR-105c`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Testwiderspruch entscheiden, dann `JR-1307`/`JR-1308`, dann Abnahme `JR-1309`                              |
| 2026-07-29 | **Testwiderspruch entschieden (ADR-018) und aufgelöst — E13s Suite ist grün: `224 passed \| 2 skipped`, Exit 0.** Entscheidung des PO: die Unit-Erwartung gilt, ein unübersetzbarer Zweig wird **verweigert** statt durch ein never-true-Prädikat je Zweig ersetzt — dieses kippt unter `$not` zu `not(false)` = wahr und verliert ein Verbot. Der Tester hat alle drei Begründungen **nachgemessen statt übernommen** und eine davon verstärkt: die beiden Erwartungen sind unter **jeder** Implementierung unvereinbar, weil keine prinzipielle Regel `{id:'a'}` anders behandelt als `{userEmail:…}`. Korrektur in `704e8d1`, **in beide Richtungen mutationsgeprüft**. **Dabei eine eigene Aussage des PO korrigiert:** „im `$or` nur verengend" (F22) gilt nur oben in einer `can`-Komposition — unter dem `$not`, wohin `FilterBuilder.ts:84` jede `cannot`-Bedingung setzt, ist derselbe Wegfall **fail-open**. `JR-1304`s Kriterium und F22 sind entsprechend berichtigt. Neu: **ADR-018**, **ADR-019**, **`JR-1311`**, **F24**. **E13 ist damit implementiert, aber nicht abgenommen** — `JR-1307`, `JR-1308`, `JR-1309` stehen aus, `JR-1309` muss in einer eigenen Session laufen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `JR-1307` (Betreiberdoku + ADR-016) und `JR-1308` (Upstream-Entwurf), dann `JR-1309`                       |
| 2026-07-29 | **`JR-1307` erledigt (Rolle `senior-dev`): ADR-016 plus Betreiberdoku.** ADR-016 ersetzt den Platzhalter und begründet den Bruch nicht mit „Sicherheit geht vor", sondern damit, dass „kein Recht auf dieses Subject" und „darf alles sehen" vom **selben Wert** dargestellt wurden und der unsichere der Default war — ein Zustand ohne belegbare Zugriffsaussage über das Archiv. Verworfen: Verhalten beibehalten und nur dokumentieren (auch als Schalter), weil **E11s Auditor-Rolle auf genau diesem Mechanismus aufsetzt**. Die Betreiberdoku ist neu in `docs/user-guides/upgrade-and-migration/access-control-changes.md` (englisch, ADR-003, in der Sidebar verlinkt): sieben benannte Verhaltensänderungen, F17 („ausgeliefert existiert nur die Super-Admin-Rolle — eine fehlende Read-Only-Rolle ist kein Fehler der Installation"), der ADR-019-Restspalt als eigener Abschnitt „What is still not checked", **keine** Pauschalwarnung. Herzstück sind drei SQL-Abfragen gegen `roles.policies`, `users` und `user_roles`, **gegen echtes Postgres 16.13 ausgeführt** — aus der Markdown-Datei extrahiert und wörtlich gelaufen: 10 von 10 absichtlich betroffenen Rollen gemeldet, die drei `predefined_*` und die Gegenprobe in **keiner** Ausgabe, sieben Randfälle ohne Fehler und ohne Falschtreffer. `iam-policy.md` hat zwei neue Abschnitte („Condition Keys", „When No Rule Applies"), weil dort die geänderte Semantik nachgeschlagen wird. **Kein Produktionscode, keine Teständerung, keine Migration, kein i18n-Key.** `pnpm lint` grün, `pnpm docs:build` grün, `docs/.vitepress/dist/dev/` existiert weiterhin nicht, `pnpm test` `224 passed \| 2 skipped`, Exit 0. Gemeldet, nicht behoben: `iam-policy.md` führt die Action `export` weiterhin nicht und beschreibt `manage` falsch (`CLAUDE.md` §5.4, stale Stelle (3)) — Vorschlag: eigene Doku-Task.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-07-29 | **`JR-1308` erledigt (Rolle PO): Upstream-Entwurf liegt in `10-upstream-meldung.md`, nicht versendet und nicht veröffentlicht.** Englischer Meldetext (vier Befunde: fail-open bei fehlender `can`-Regel samt F19/F20, Injection über Condition-Keys mit der einen funktionierenden Nutzlast, stilles Verwerfen unübersetzbarer Bedingungen samt Richtungskorrektur aus F22, wirkungsloser `cannot`-Ausschluss bei Operator-Bedingungen) plus F17 als getrennter Bug, dazu eine deutsche Entscheidungsvorlage: **Kanal** (keine `SECURITY.md` im Upstream ⇒ privates GitHub Security Advisory, **kein** öffentliches Issue), **Zeitpunkt**, **Absender/CVE**, und ob die Nutzlast bei einer öffentlichen Meldung entfernt wird. F2/F4/F5/F6/F9/F10 bewusst **nicht** enthalten — offen dokumentiert, in diesem Fork nicht behoben, eine Meldung ohne Fix und ohne eigene Prüfung wäre dünn. Die Datei liegt unter `docs/dev/journaling/` und ist damit über `srcExclude` unpubliziert; das ist Bedingung, weil sie eine funktionierende Injection gegen eine **nicht behobene** veröffentlichte Version enthält. **Kein Agent versendet sie.** Zusätzlich **`JR-1312`** angelegt für die veraltete IAM-Doku (`export` fehlt, `manage` falsch beschrieben — die dritte Stelle aus `CLAUDE.md` §5.4): reine Doku, gehört auf den Integrationsbranch **nach** dem Rückmerge, ausdrücklich nicht in `JR-1307` mitgenommen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `JR-1309` — unabhängige Abnahme E13 in **eigener** Session                                                 |
| 2026-07-29 | **`JR-1309` (Abnahme E13) durchgeführt, Ergebnis: E13 nicht abgenommen.** HEAD `54536cd` zuerst gegen `origin` abgeglichen (identisch — kein Rollback). 21 Kriterien einzeln geprüft: **17 erfüllt**, 1 teilweise (Meili-Hälfte von `JR-1305` strukturell, keine Engine vorhanden), 1 bewusst nicht erfüllt und durch ADR-019 gedeckt, **2 nicht erfüllt**. **`JR-1301`s Kernkriterium unabhängig belegt statt übernommen:** Produktionscode in einer Wegwerf-Kopie auf `efea6bc` zurückgedreht ⇒ `23 failed \| 201 passed`, HEAD ⇒ `224 passed \| 2 skipped`; zusätzlich vier **Einzelreverts**, die jeden Fix einzeln als tragend zeigen (`mongoToDrizzle` 11 rot, `FilterBuilder` 8, `policy-validator` 2, `SearchService` 1); Statusdiff `8984ce9` ⇄ HEAD je `fullName`: rot⇒grün 21, grün⇒nicht-grün **0**. **Suite wirklich vollständig:** 16 Dateien, 226 Fälle, die 2 Skips sind aus dem JSON-Report als genau die `[nightly]`/`[manual]`-Suiten identifiziert, alle 8 `integration`-Dateien mit Fallzahlen gelaufen, `minimumFiles` ohne Spiel — plus CI-Run **30456242256** auf **PostgreSQL 17.10** mit demselben Ergebnis, womit die Versionslücke für die Suite geschlossen ist. **`predefined-roles.int.test.ts` ist kein Tautologie-Test** (zwei Produktionscode-Mutationen ⇒ 4/7 bzw. 6/7 rot, „green but empty test"-Falle greift). **Injektionsweg zu:** 12 Nutzlasten inkl. NUL-Byte, Newline, Fullwidth-Homoglyph und Relationszweig, drei Gates, Legacy-Rolle direkt in die DB geschrieben ⇒ jedes Mal Deny, **0** fremde Zeilen. **F7 fail-closed auf Zeilenebene** für `auditor-specific-mailbox.json` (Fixture von der Platte) und den Nutzer ohne Rolle, `read` **und** `search`. **F2/F4/F5/F6/F9/F10 unverändert:** F2/F9/F10-Dateien blob-identisch, F4/F5/F6 pre-gegen-post identisch gemessen. Öffentliche Doku ohne interne IDs, ohne Compliance-Behauptung, ohne Nutzlast; `10-upstream-meldung.md` nicht gebaut und **nicht im Suchindex** (49 indexierte Seiten, kein Pfad unter `dev/`). `main` = `a560b8c`, kein E13-Commit darin, kein Rückmerge, **kein** neuer PR. **Fünf neue Befunde: `F25`** (die Statusaussage „F4 **und F5** sind im Code kommentiert" ist für F5 falsch), **`F26`** (`can` mit falsy `conditions` ⇒ weiter Vollzugriff; kein Regress), **`F27`** (Query 2 falsch-negativ für skalares/Array-`conditions` — `conditions: 5` war vorher **unbeschränkt**), **`F28`** (Query 3 prüft `subject: "all"` nicht), **`F29`** (Validator und Übersetzer uneins über die Key-Form; die veröffentlichte Doku behauptet die strengere Variante). Kein Produktionscode, kein Test, keine öffentliche Doku geändert; Cluster, Wegwerf-Kopien und Prüfdatenbank restlos entfernt, 0 `oa_test_*`-Rückstände. | Nacharbeit F29 → F27 → F28 → F25 (F26: PO entscheidet), dann **`JR-1309a`**                                |
| 2026-07-29 | **PO-Entscheidungen zur `JR-1309`-Ablehnung — die Nacharbeit ist geschnitten, nichts wartet mehr auf mich.** Die Ablehnung ist berechtigt und beide Kernbefunde am Code nachgeprüft: **F29** — der Validator prüft nur die _Form_ der Key-Segmente, der Übersetzer zusätzlich die _Auflösbarkeit_ der Relation, also speichert `foo.bar` mit `200` und scheitert erst zur Abfragezeit, während die veröffentlichte Doku „Saving … fails with HTTP `400`" behauptet. **F27** — eine Policy-Form, die von „sieht alles" auf „sieht nichts" umschlägt, wird von **keiner** der drei Betreiber-Abfragen gefunden. Entscheidungen: (1) **F29 wird streng gelöst**, nicht durch Abschwächen der Doku — ein Key, der beim Speichern auffällt, ist für einen Betreiber strikt besser als einer, der zur Abfragezeit auffällt, und `JR-1306`s Kriterium fordert es. Das Prädikat kommt aus **einer** Quelle, die Validator und Übersetzer gemeinsam nutzen. (2) Zur Frage des Testers „Abfragen erweitern **oder** Absolutsatz entschärfen": **beides** — nur entschärfen lässt den Betreiber ohne brauchbare Prüfung, nur erweitern erzeugt denselben Fehler eine Runde später, weil eine Abfrage über beliebiges JSONB gegen künftige Formen nie beweisbar vollständig ist. (3) **F26 zur Hälfte vorgezogen**: die Formprüfung von `conditions` selbst wandert in `JR-1313` (Objekt oder nicht vorhanden; Skalar, Array, `null` werden abgewiesen), weil sie sich die Ursache mit F27 teilt; das Laufzeitverhalten für **bereits gespeicherte** solche Policies bleibt bei `JR-1311`, sonst wäre es ein Regress-Risiko ohne Not. (4) Neu **`JR-1316`**: die Betreiber-SQL bekommt einen Regressionstest gegen dieselben Fixtures wie der Code — sie war das **einzige** sicherheitsrelevante Artefakt in E13 ohne Test, und genau deshalb ist F27 durch alle Prüfungen gekommen. Ebenfalls bestätigt: **PR #1 und #2 sind geschlossen und nicht gemergt** (28.07.), `main` unverändert `a560b8c` — meine frühere Darstellung „zwei offene PRs, Entscheidung beim Auftraggeber" war einen Tag lang überholt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `JR-1313`/`JR-1314`/`JR-1315` (DEV), dann `JR-1316` (TEST), dann `JR-1309a`                                |
| 2026-07-29 | **`JR-1316` aus E13 herausgenommen — Entscheidung des Auftraggebers, und sie ist berechtigt.** Das Epic war von 9 auf 14 Positionen gewachsen. Der größere Teil davon war die Abnahme, die ihren Zweck erfüllt hat — `JR-1309` hat E13 mit zwei echten Befunden abgelehnt —, und drei weitere Themen hatte der PO bereits **aus** E13 herausgehalten (`JR-1310`/`JR-1311`/`JR-1312`). `JR-1316` war jedoch eine PO-Entscheidung zweiter Ordnung: ein Regressionstest für SQL-Schnipsel in einer **Doku-Seite**. E13s Zusage lautet „die Autorisierungsschicht ist fail-closed", und die ist seit `dcec017` erfüllt und unabhängig belegt — Injektionsweg an beiden Gates zu, `FilterBuilder` zeilenscharf fail-closed, jeder Regressionstest ohne seinen Fix rot, Suite grün auch in der CI auf PostgreSQL 17.10. Die Lücke, die `JR-1316` bewachen soll (**F27**), ist **behoben** und in `JR-1314` über eine Falsch-negativ-Prüfung gegen echtes Postgres belegt; der Test schützt gegen ihre **Wiederkehr**, nicht gegen ihren Fortbestand. Ein Epic, dessen Kernaussage unabhängig belegt ist, wird nicht von einer Absicherung zweiter Ordnung offengehalten. Die Task steht wortgleich unter „Folge-Task nach E13", zählt **nicht** zu `JR-1309a`, und die Reihenfolge der vier Folge-Tasks ist festgelegt (`JR-1312` → `JR-1316` → `JR-1311` → `JR-1310`); keine blockiert E2. Nur Dokumentation, kein Produktionscode, kein Test angefasst.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `JR-1309a` — die letzte Task von E13, eigene Session                                                       |
