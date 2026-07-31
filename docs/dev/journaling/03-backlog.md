# Backlog

Task-IDs sind stabil und werden **nie** neu vergeben. Schema: `JR-<Epic><NN>`, z. B. `JR-203` =
Epic 2, Task 3. Abgeschlossene Tasks werden nicht gelöscht, sondern in `06-status.md` abgehakt.

**Rollen:** `DEV` = Subagent `senior-dev` · `TEST` = Subagent `tester` · `PO` = Hauptthread
(Priorisierung, ADRs, Abnahme). Der PO implementiert nicht.

Jedes Epic endet in einem demonstrierbaren, testbaren Zustand. Ein Epic gilt erst als fertig, wenn
`TEST` unabhängig abgenommen hat.

**Die Epic-Nummer sagt nichts über die Reihenfolge.** Task-IDs sind stabil, deshalb wird beim
Einschieben eines Epics nicht umnummeriert — E13 steht als zweites in der Abarbeitung. Verbindlich
sind die Spalten „Reihenfolge" und „Abhängig von", nicht die Nummer.

| Reihenfolge | Epic | Titel                         | Abhängig von | Risiko                  |
| ----------- | ---- | ----------------------------- | ------------ | ----------------------- |
| 1           | E1   | Test- und CI-Fundament        | —            | niedrig                 |
| 2           | E13  | IAM-Autorisierung härten      | E1           | mittel                  |
| 3           | E2   | Ledger und Hash-Chain         | E13          | hoch                    |
| 4           | E3   | Spool und Acceptance-Contract | E2           | **sehr hoch**           |
| 5           | E4   | `smtp-ingress`-Service        | E3           | **sehr hoch**           |
| 6           | E5   | Journal-Report-Parser         | E4           | mittel                  |
| 7           | E6   | Phase-B-Worker                | E5           | mittel                  |
| 8           | E7   | WORM-Storage                  | E6           | **hoch** (irreversibel) |
| 9           | E8   | Anchoring                     | E2, E7       | mittel                  |
| 10          | E9   | `verify`-CLI                  | E8           | mittel                  |
| 11          | E10  | Completeness-Monitoring       | E6, E9       | niedrig                 |
| 12          | E11  | Compliance-Features           | E9, **E13**  | mittel                  |
| 13          | E12  | Rollout und Dokumentation     | E10, E11     | niedrig                 |

Parallelisierbar: E1 ist unabhängig · E8 kann parallel zu E5/E6 laufen (hängt nur an E2 und E7) ·
E11 weitgehend parallel zu E10.

**E13 wurde nachträglich eingeschoben** (2026-07-28), weil `JR-103`/`JR-104` vier Befunde mit
Autorisierungswirkung im Bestandscode aufgedeckt haben — darunter **F7**, ein fail-open in
`FilterBuilder`, das die released Version 0.5.2 betrifft und von einer eingeschränkten Rolle aus
erreichbar ist. **E11 kann nicht abgenommen werden, solange F7 offen ist:** die dort geplante
Auditor-Rolle baut genau auf diesem Mechanismus auf, und ein „read-only"-Auditor, der unbeschränkt
liest, ist keine Auditor-Rolle. Details in `09-befunde-bestandscode.md`.

---

## E1 — Test- und CI-Fundament

**Ziel:** Das Repository hat einen Test-Runner, ausführbare Tests und eine CI, die Lint, Typecheck
und Tests ausführt. Ohne das ist RFC §12 nicht umsetzbar und jede Durability-Aussage unbelegt.

**Warum zuerst:** Es gibt heute **null Tests und keinen Test-Runner** im gesamten Repository.

| ID     | Task                                                                                                                                                                                                                                                                                                                                                                                 | Rolle | RFC | Akzeptanzkriterien                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JR-101 | vitest im Monorepo einrichten: Root-Konfiguration + Workspace-Configs für `packages/backend`, `packages/types`, `packages/journaling` (sobald vorhanden). `test`-Script auf Root- und Paketebene                                                                                                                                                                                     | TEST  | §12 | `pnpm test` läuft von der Repo-Wurzel, findet Tests in allen Paketen, Exit-Code 0 bei Erfolg und ≠ 0 bei Fehlschlag. Keine Änderung an bestehendem Produktionscode                   |
| JR-102 | Testkonventionen festlegen und dokumentieren: `*.test.ts` neben dem Code für Units, `tests/` für Integration/adversarial, Klassifizierung `ci`/`nightly`/`manual`, Seed-Pflicht bei Randomisierung                                                                                                                                                                                   | TEST  | §12 | Konventionen stehen in `04-testplan.md`; ein Beispiel je Kategorie existiert                                                                                                         |
| JR-103 | Erste Unit-Tests auf die reinen Funktionen: `PolicyValidator.isValid()`, `createAbilityFor()`, `FilterBuilder`. Die bestehenden, bisher unbenutzten Fixtures `packages/backend/src/iam-policy/test-policies/*.json` als Eingabe verwenden                                                                                                                                            | TEST  | —   | ≥ 20 Assertions über die Fixtures; alle grün; die Fixtures werden erstmals tatsächlich geladen                                                                                       |
| JR-104 | Integrationstest-Basis: isolierte Postgres-Instanz je Testlauf (eigenes Schema oder eigene Datenbank), Migrationen automatisch anwenden, Teardown garantiert                                                                                                                                                                                                                         | TEST  | §12 | Zwei Integrationstests können parallel laufen, ohne sich zu beeinflussen; kein Rückstand in der DB nach dem Lauf                                                                     |
| JR-105 | GitHub-Workflow `.github/workflows/ci.yml`: `pnpm lint`, `pnpm --filter @open-archiver/backend build`, `pnpm --filter @open-archiver/frontend check`, `pnpm test` — auf Pull Request und Push. Postgres als Service-Container für die `integration`-Suite. **Nur prüfen (`prettier --check` via `pnpm lint`), niemals `pnpm format` ausführen und niemals auto-committen** (ADR-015) | DEV   | §12 | Workflow läuft auf dem Branch grün. Bestehende Workflows (`cla`, `deploy-docs`, `docker-deployment`, `release-tag`) unverändert. Kein Schritt schreibt Dateien ins Repository zurück |
| JR-106 | Abnahme E1                                                                                                                                                                                                                                                                                                                                                                           | PO    | —   | `pnpm test` und CI grün; JR-101…104, JR-105a und JR-105 erfüllt; `06-status.md` aktualisiert                                                                                         |

### Nacharbeit aus der Abnahme `JR-106` (2026-07-28)

Die Abnahme hat E1 **abgelehnt** und drei Defekte im **eigenen** Testfundament gefunden. Der PO hat
entschieden, sie nachzuarbeiten statt sie zu akzeptieren: eine bekannte Schwäche im Messinstrument
widerspricht Grundregel 6 des Testplans („keine stillen Kürzungen"), und auf diesem Harness ruht jede
Durability-Aussage in E2/E3.

| ID      | Task                                                                                                                                                                                                                                                                                                                   | Rolle | Befund | Akzeptanzkriterien                                                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JR-104a | **F12 beheben.** Beide Fixture-Namen in `pg-harness.int.test.ts` prozessspezifisch bilden (`process.pid` + Zufallssuffix), **und** den `sweepStaleHarnessDatabases()`-Aufruf im Test auf ein eigenes Label einschränken — die Fremd-PID `999999` lässt ihn heute fremde Fixtures löschen                               | TEST  | F12    | Prozessübergreifender Doppellauf **mehrfach** grün (≥ 5 Wiederholungen, alle protokolliert) — bei einem Zeitfensterdefekt ist ein einzelner grüner Lauf kein Nachweis. Keine DB-Rückstände |
| JR-105b | **Die zwei Lücken der CI-Nachlaufprüfung schließen**, mit einer **positiven** Erwartung statt einer Negativsuche im Log: (a) eine _abwesende_ `integration`-Suite muss rot machen, nicht nur eine übersprungene; (b) eine Datei in `tests/integration/`, die auf kein Project-Glob passt, darf nicht unbemerkt bleiben | TEST  | —      | Verzeichnis umbenennen ⇒ rot. Datei `foo.test.ts` in `tests/integration/` mit fehlschlagender Assertion ⇒ rot. Beide Fälle auch in der Gegenrichtung geprüft (legitimer Zustand ⇒ grün)    |
| JR-106a | Erneute Abnahme E1 nach der Nacharbeit                                                                                                                                                                                                                                                                                 | TEST  | —      | Alle Kriterien aus `JR-106` erneut, plus die Kriterien von `JR-104a` und `JR-105b`                                                                                                         |

### Nach der Abnahme aufgetreten: der Wächter selbst ist umgehbar (F14–F16) — **erledigt 2026-07-30**

`JR-106a` hat E1 **abgenommen** — alle 20 Kriterien erfüllt. Beim Angriff auf die neue
Inventarprüfung (neun Wege, sechs hielten) sind aber drei Wege gefunden worden, die durchgehen. Keiner
bricht ein Akzeptanzkriterium, die Abnahme steht. **F14 ist trotzdem ernst**, weil es genau die
Fehlerklasse ist, gegen die der Wächter gebaut wurde: die Prüfung zählt **Dateien, nicht ausgeführte
Tests.** Wer `suiteRequiring('ci', …)` in den vier Integrationsdateien auf `'nightly'` ändert,
schaltet die ganze Suite ab — und **beide** Wächter melden grün.

| ID      | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Rolle | Befund       | Akzeptanzkriterien                                                                                                                                                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JR-105c | Den Wächter auf **ausgeführte Tests** statt auf Dateien stellen: eine Mindestzahl tatsächlich gelaufener Tests je Suite. Damit fallen Umklassifizierung nach `nightly` (F14), reine `it.skip`-Dateien (F14, gleiche Klasse) und das Löschen einer Datei unter gleichzeitiger Ergänzung einer anderen (F15) auf. Zusätzlich F16: ein Modul-Scope-Throw nach `acquireTestDatabase()` darf keine Datenbank verlieren, ohne dass der versprochene Hinweis erscheint. Zusätzlich **F24**: ein gefilterter `pnpm test -t "…"` hinterlässt Datenbanken, weil der Modul-Scope-Erwerb vor der Filterauswertung liegt — dieselbe Wurzel wie F16 | TEST  | F14–F16, F24 | Umklassifizierung aller vier Integrationsdateien auf `nightly` ⇒ **rot**. Eine Datei mit ausschließlich `it.skip` ⇒ **rot**. Löschen von `pg-harness.int.test.ts` bei gleichzeitigem Hinzufügen einer anderen Datei ⇒ **rot**. Legitimer Zustand ⇒ grün. Modul-Scope-Throw ⇒ Datenbank wird abgeräumt **oder** der Hinweis erscheint |

**Fälligkeit:** vor E2. Der Wächter ist die Zusicherung, dass die Tests, auf denen jede
Durability-Aussage in E2/E3 ruht, überhaupt laufen. Solange F14 offen ist, ist ein grüner CI-Lauf
kein Beleg dafür, dass die Integration-Suite ausgeführt wurde.

> **`JR-105c` ist erledigt** (`b5b2190`, 2026-07-30, Grundlagenarbeit direkt auf dem
> Integrationsbranch). Alle fünf Akzeptanzkriterien sind gegen PostgreSQL 17.10 gemessen, und die drei
> Angriffe wurden **zuerst am Elternstand** `e09b981` wiederholt, damit der grüne Ausgangszustand
> belegt ist und nicht bloß behauptet: Umetikettierung aller acht Integrationsdateien war dort
> **Exit 0** mit „verified" von beiden Wächtern, danach **Exit 1** bei unveränderten `8/8` Dateien;
> `it.skip`-Datei ⇒ Exit 1 (`ci 52/55`); Löschen-plus-Hinzufügen ⇒ Exit 1 (`ci 43/55`); legitimer
> Zustand ⇒ Exit 0 (`274 passed | 2 skipped`); Modul-Scope-Wurf ⇒ Datenbank namentlich gemeldet **und**
> abgeräumt. **F24** dazu: `pnpm test -t "idempotent"` hinterließ am Elternstand **6** Datenbanken und
> hinterlässt jetzt **0**. Protokoll in `06-status.md`, Behebung je Befund in
> `09-befunde-bestandscode.md`, Verfahren im Testplan §2.2/§2.6.
>
> Zwei Dinge, die dabei über den Umfang hinausgingen und benannt gehören: die Dateizahl ist jetzt
> ebenfalls eine **Gleichheit** (F15 hatte genau das vorgeschlagen), und ein absichtlich verengter Lauf
> (`-t`, Dateifilter, `--project`, `--shard`) prüft die Testzahlen **nicht** und sagt das laut — die CI
> verlangt dafür, dass die Prüfung anwendbar war, sodass das Zugeständnis dort keins ist.

> `JR-105b` überschreitet bewusst die DEV/TEST-Grenze: die Prüfung liegt in
> `.github/workflows/ci.yml` (DEV-Territorium laut `JR-105`), ist aber inhaltlich
> Test-Verifikationslogik. Sie zusammen mit `JR-104a` an eine Rolle zu geben vermeidet zwei Agenten
> auf demselben Branch.

**Achtung — bereits geprüft, `pnpm lint` schlägt heute fehl.** `pnpm lint` ist Prettier `--check`
über das gesamte Repository. Der Bestand ist **nicht** sauber: **13** Dateien werden beanstandet,
davon **6 generierte** (vollständige Prüfung mit allen Plugins, `npx prettier --list-different .`,
2026-07-27):

```
packages/backend/src/api/controllers/index-admin.controller.ts
packages/backend/src/api/routes/ingestion.routes.ts
packages/backend/src/config/search.ts
packages/frontend/src/routes/dashboard/admin/index/+page.svelte
packages/frontend/src/routes/dashboard/ingestions/+page.svelte
packages/frontend/src/routes/dashboard/ingestions/[id]/+page.svelte
docs/user-guides/installation.md
docs/api/openapi.json                                  ← generiert
packages/backend/src/database/migrations/meta/_journal.json          ← generiert
packages/backend/src/database/migrations/meta/0037_snapshot.json     ← generiert
packages/backend/src/database/migrations/meta/0038_snapshot.json     ← generiert
packages/backend/src/database/migrations/meta/0039_snapshot.json     ← generiert
packages/backend/src/database/migrations/meta/0040_snapshot.json     ← generiert
```

Deshalb wird **`JR-105a`** vorgeschaltet: ein separater, reiner Formatierungs-Commit
(`pnpm format`), sonst ist der CI-Job aus `JR-105` von der ersten Minute an rot und blockiert jeden
künftigen Pull Request.

**Entschieden — die generierten Dateien gehen in `.prettierignore` (ADR-015, 2026-07-27).** Sechs der
13 Treffer werden von Generatoren geschrieben: `docs/api/openapi.json` durch `pnpm docs:gen-spec`
(läuft bei jedem `docs:build` und `docs:dev`) und die fünf `migrations/meta/*.json` durch
`pnpm db:generate`. Beide schreiben empirisch belegt mit `JSON.stringify(…, null, 2)` — also zwei
Leerzeichen, während das Repo `useTabs: true` verwendet. Sie stehen dauerhaft im Konflikt mit dem
Formatierer und überschreiben jede Formatierung sofort wieder.

Formatiert wurden daher nur die **7 handgeschriebenen** Dateien. Ausgeschlossen wurde das gesamte
Verzeichnis `migrations/meta/`, nicht einzelne Snapshots — jede künftige Migration legt einen neuen an.
`migrations/*.sql` braucht keinen Eintrag, Prettier hat keinen SQL-Parser. Vollständige Begründung,
Belege und die nicht verifizierbare Restlücke in **ADR-015**.

> Historische Notiz: eine erste Prüfung nannte nur neun Dateien. Sie lief ohne
> `prettier-plugin-svelte` und `prettier-plugin-tailwindcss`, weil im Container keine `node_modules`
> lagen — die drei `.svelte`-Dateien und `openapi.json` waren dadurch unsichtbar. Lehre: eine
> Lint-Aussage ohne installierte Plugins ist unvollständig, und das muss dazugesagt werden.

| ID      | Task                                                                                                                             | Rolle | Akzeptanzkriterien                                                                                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JR-105a | Reiner Formatierungs-Commit `pnpm format`, vorher Entscheidung zu den generierten drizzle-Snapshots (formatieren vs. ignorieren) | DEV   | `pnpm lint` ist repo-weit grün, inklusive `.svelte`; der Commit enthält **ausschließlich** Formatierung, keine Logikänderung; `pnpm db:generate` erzeugt danach keine erneute Lint-Verletzung |

---

## E2 — Ledger und Hash-Chain

**Ziel:** Eine append-only, lückenlose, hash-verkettete Ereignisliste mit serialisierten Writes und
belegter Durability. Ohne Ledger darf nie ein `250` gesendet werden.

**Skill:** `journal-ledger` ist für alle Tasks dieses Epics verbindlich.

> ### Was `ADR-007` an diesem Epic ändert (entschieden 2026-07-31: **eine Kette je Mandant**)
>
> Die Tasks unten sind für **eine** Kette formuliert. Sie bleiben gültig, aber vier von ihnen bekommen
> eine Dimension dazu. Wer sie aufgreift, liest zuerst ADR-007 — dort stehen Begründung und alle
> Konsequenzen; hier nur, was in welcher Zeile anders wird:
>
> - **`JR-203`** (ADR-006 fixieren) nimmt `chain_scope_id` in den Genesis-String auf. **Vorgabe, nicht
>   Option** — ohne sie sind zwei Ketten mit identischem erstem Ereignis hashgleich. Zusätzlich in
>   ADR-006 noch offen: woher `deployment_id` kommt und was beim Klonen einer Installation aus einem
>   Backup passiert.
> - **`JR-204`** (Schema) braucht `chain_scope_id` → **`ingestion_sources.id`** und
>   `UNIQUE (chain_scope_id, seq)` statt eines globalen `seq`, plus `journaling_source_id` als
>   **Attribut** je Zeile, damit „wer hat gesendet" im Beleg steht, ohne eine zweite Kette zu sein.
> - **`JR-206`** (`append()`) leitet den Advisory-Lock-Key aus der Kettenkennung ab, statt ihn zu
>   konstanten. Der Hash wird weiterhin **innerhalb** der Sperre berechnet.
> - **`JR-208`** (adversarial) bekommt einen Fall, den es vorher nicht geben konnte: Appends in
>   **verschiedene** Ketten dürfen sich **nicht** serialisieren, Appends in **dieselbe** Kette müssen
>   es. Die zweite Hälfte ist der Vertrag, die erste der Grund für den abgeleiteten Lock-Key.
> - **`JR-209`** (Tamper) bekommt „die Kette eines Mandanten fehlt vollständig" als Befund. Bei einer
>   globalen Kette war dieser Zustand nicht darstellbar.
>
> **`chain_scope_id` = `ingestion_sources.id`** — ebenfalls am 2026-07-31 entschieden, Begründung in
> ADR-007. Eine Kette je **Archiv**: zwei Endpunkte auf demselben Archiv teilen eine Kette, ein neu
> angelegter Endpunkt setzt keine neue auf.
>
> **Was vor der ersten Zeile Kettencode noch fehlt, ist damit allein `ADR-006`** (Task `JR-203`):
> Kodierung, Genesis-String inklusive `chain_scope_id`, Herkunft der `deployment_id` und das Verhalten,
> wenn eine Installation aus einem Backup geklont wird.
>
> **`JR-203` hat seit `ADR-022` (2026-07-31) einen Teil mehr:** die **Merkle-Kodierung** des Ankers —
> Blatt `H(0x00 ‖ canonical(chain_scope_id, head_seq, head_chain_hash))`, innerer Knoten
> `H(0x01 ‖ links ‖ rechts)`, Blätter nach `chain_scope_id` sortiert, und die Regel für den ungeraden
> Knoten. Sie gehört hierher und nicht nach E8, weil `verify` den Baum byteidentisch nachbauen muss: eine
> kanonische Kodierung, die die Baumform nicht abdeckt, ist in E8 nicht mehr nachrüstbar, ohne bestehende
> Anker zu invalidieren.

| ID     | Task                                                                                                                                                                                                                                                                                                                         | Rolle | RFC         | Akzeptanzkriterien                                                                                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JR-201 | `packages/journaling` anlegen: `package.json`, `tsconfig`, Abhängigkeit **nur** auf `@open-archiver/types`. Konfiguration und DB-Verbindung werden injiziert, nie importiert                                                                                                                                                 | DEV   | §2          | Paket baut eigenständig; `grep` bestätigt keinen Import aus `@open-archiver/backend`                                                                                                     |
| JR-202 | Kanonische Kodierung implementieren: Versionsbyte, längenpräfixierte Felder, int64-Zeitstempel in µs UTC, Arrays in Empfangsreihenfolge, kanonische `event_payload`-Serialisierung. Bytes im Code dokumentieren                                                                                                              | DEV   | §5.2        | Property-Tests: gleiche Eingabe ⇒ identische Bytes; Feldpermutation ⇒ andere Bytes; `event_payload` mit umgestellten Schlüsseln ⇒ **gleiche** Bytes; Golden-File-Test fixiert das Format |
| JR-203 | ADR-006 fixieren: exakte Kodierung, Genesis-String, Herkunft der `deployment_id`                                                                                                                                                                                                                                             | PO    | §5.2        | ADR in `05-entscheidungen.md` mit Status „entschieden"; JR-202 stimmt damit überein                                                                                                      |
| JR-204 | Drizzle-Schema `journal_ledger` + Migration. Felder nach RFC §5.2 plus `spool_txid`. `pgEnum` für `event_type`. Im Barrel `schema.ts` registrieren                                                                                                                                                                           | DEV   | §5.2        | `pnpm db:generate` erzeugt Migration; SQL und `meta/*_snapshot.json` committed; `pnpm db:migrate` läuft durch. Skill `oa-migration` befolgt                                              |
| JR-205 | Append-Only in der Datenbank erzwingen (Rechteentzug oder Trigger — ADR-009)                                                                                                                                                                                                                                                 | DEV   | §5.2        | Ein `UPDATE` und ein `DELETE` auf `journal_ledger` schlagen mit den Anwendungsrechten fehl; Test belegt es                                                                               |
| JR-206 | `LedgerWriter.append()`: `BEGIN` → `SET LOCAL synchronous_commit = on` → `pg_advisory_xact_lock` → Kopf lesen → `seq` ableiten → Hash **innerhalb** der Sperre berechnen → `INSERT` → `COMMIT`                                                                                                                               | DEV   | §5.2, §5.4  | Lückenlos unter Last (JR-208); `seq` wird bei Rollback nicht verbraucht; Hash-Berechnung außerhalb der Sperre ist im Code unmöglich (Struktur, nicht Kommentar)                          |
| JR-207 | Ledger-Backend steckbar bauen: Variante (a) Postgres zuerst, Schnittstelle so, dass (b) lokales WAL nachrüstbar ist                                                                                                                                                                                                          | DEV   | §5.4        | Interface dokumentiert; (a) implementiert; (b) nicht implementiert, aber ohne Signaturänderung nachrüstbar                                                                               |
| JR-208 | Adversariale Ledger-Tests: 20 parallele Writer × 500 Appends ⇒ lückenlos und korrekt verkettet; erzwungener Rollback zwischen Vergabe und Commit ⇒ keine Lücke; Kettenverifikation über den gesamten Bereich. **Läuft der Test länger als die Sweeper-Frist, `OA_TEST_PG_STALE_MS` über die erwartete Laufzeit heben** (F13) | TEST  | §5.2, §12.6 | Alle Bedingungen erfüllt, reproduzierbar mit geloggtem Seed. **Die F13-Frist ist gesetzt und im Test sichtbar begründet** — sonst räumt ein fremder Lauf die eigene Datenbank ab         |
| JR-209 | Tamper-Tests: (a) Objekt-Hash-Feld ändern ⇒ Erkennung bei korrektem `seq`; (b) Zeile löschen ⇒ Kettenbruch bei korrektem `seq`; (c) Kette ab `seq` N neu schreiben ⇒ Divergenz erkennbar                                                                                                                                     | TEST  | §12.5       | Prüflogik meldet in allen drei Fällen die **erste** Divergenz mit `seq` und Feld                                                                                                         |
| JR-210 | Abnahme E2                                                                                                                                                                                                                                                                                                                   | PO    | —           | JR-201…209 erfüllt; ADR-006/007/009 entschieden; `06-status.md` aktualisiert                                                                                                             |

---

## E3 — Spool und Acceptance-Contract

**Ziel:** Die Zusage hinter `250 OK` ist technisch eingelöst. **Riskantestes Epic** — nachträglich
nicht reparierbar, weil bereits quittierte Nachrichten nicht rückwirkend durabel werden.

| ID     | Task                                                                                                                                                                                                                           | Rolle | RFC     | Akzeptanzkriterien                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| JR-301 | Spool-Layout und -Verwaltung: `incoming/`, `quarantine/`, Transaktions-ID (ULID/UUID), Sharding gegen große Verzeichnisse, High-Water-Mark                                                                                     | DEV   | §3, §11 | Layout dokumentiert; High-Water-Mark-Überschreitung ist erkennbar und liefert das Signal für `452`                                                 |
| JR-302 | Durable Write: Bytes streamend schreiben, `fsync()` auf Datei **und** Verzeichnis, SHA-256 streamend mitberechnen. Keine Vollpufferung im Heap                                                                                 | DEV   | §3      | 150-MB-Nachricht ohne proportionalen Heap-Anstieg; beide `fsync`-Aufrufe im Code nachweisbar; Hash identisch zum Referenzwert über dieselben Bytes |
| JR-303 | Fault-injizierbare Dateisystem-Schnittstelle: schmal, explizit injiziert. Kein Monkey-Patching globaler `fs`-Funktionen                                                                                                        | DEV   | §12.2   | Tests können Datei-fsync, Verzeichnis-fsync und Write unabhängig fehlschlagen lassen; Produktionspfad nutzt die echte Implementierung              |
| JR-304 | Zweiphasige Annahme verdrahten: Spool-fsync → Hash → Ledger-Append → _dann_ Erfolgssignal. Nach dem Ledger keine Operation mehr, die das Ergebnis beeinflussen kann                                                            | DEV   | §3      | Codepfad hat keine Möglichkeit, nach erfolgreichem Ledger-Append noch zu scheitern; Test belegt die Reihenfolge                                    |
| JR-305 | Crash-Recovery-Scan beim Start: Spool auflisten, gegen `spool_txid` im Ledger abgleichen, Ledger vorhanden ⇒ Phase B nachreihen, Ledger fehlt ⇒ nach `quarantine/` verschieben **und alarmieren**. Nie stillschweigend löschen | DEV   | §3      | Beide Fälle getestet; Quarantäne erzeugt einen Alert; kein Pfad löscht eine Spool-Datei ohne Ledger-Eintrag                                        |
| JR-306 | fsync-Fault-Injection-Tests: Datei-fsync scheitert, Verzeichnis-fsync scheitert, Write scheitert ⇒ jeweils Fehlersignal für `451`, **nichts** quittiert, kein halber Spool-Eintrag                                             | TEST  | §12.2   | Alle drei Fälle grün; nach jedem Fall ist der Zustand sauber                                                                                       |
| JR-307 | Disk-Full-Test: Spool auf einem größenbegrenzten Volume, Nachricht überschreitet die Kapazität ⇒ Signal für `452`, keine Teil-Einträge, Erholung nach Freigabe                                                                 | TEST  | §12.3   | Testtechnik dokumentiert (z. B. größenbegrenztes tmpfs oder Loop-Device); reproduzierbar                                                           |
| JR-308 | Abnahme E3                                                                                                                                                                                                                     | PO    | —       | JR-301…307 erfüllt; die zentrale Invariante gilt in allen Fehlerfällen                                                                             |

---

## E4 — `smtp-ingress`-Service

**Ziel:** Ein gültiges Journaling-Ziel für Exchange Online. Ohne `BDAT` funktioniert es mit Exchange
Online nicht — das ist nicht optional.

| ID     | Task                                                                                                                                                                                                                                                                 | Rolle | RFC        | Akzeptanzkriterien                                                                                                                                                                                             |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JR-401 | `apps/smtp-ingress` anlegen: eigener Prozess, eigene Konfiguration mit zod validiert, `start:smtp-ingress`-Skript. Dünn — Logik liegt in `packages/journaling`                                                                                                       | DEV   | §2         | Prozess startet eigenständig; importiert **kein** `packages/backend/src/config/*` und **kein** `src/database/index.ts`; fehlende Konfiguration führt zu einer klaren Startmeldung, nicht zu einem Import-Crash |
| JR-402 | SMTP-Server: ESMTP, konfigurierbarer Port, `PIPELINING`, `8BITMIME`, `SMTPUTF8`, `SIZE` mit Default **150 MB**, Connection-/Command-/Data-Timeouts                                                                                                                   | DEV   | §4.1, §4.2 | `EHLO` kündigt alle genannten Erweiterungen an; `SIZE`-Wert entspricht der Konfiguration                                                                                                                       |
| JR-403 | **`CHUNKING`/`BDAT`** vollständig: Einzel-Chunk, Multi-Chunk, `BDAT 0 LAST`, Chunk-Grenzen mitten in einer Zeile                                                                                                                                                     | DEV   | §4.2       | Alle vier Fälle liefern byteidentische Ergebnisse zum `DATA`-Pfad                                                                                                                                              |
| JR-404 | TLS: STARTTLS, `require_tls` (Plaintext ⇒ `530 5.7.0`), TLS ≥ 1.2, ausgehandelte Version und Cipher an den Ledger-Eintrag durchreichen                                                                                                                               | DEV   | §4.1       | Plaintext-Session wird bei `require_tls` abgewiesen; TLS 1.1 wird abgelehnt; Version und Cipher stehen im Ledger-Eintrag                                                                                       |
| JR-405 | Access Control: `allowed_sources` als CIDR-Liste (Abweisung mit `554 5.7.1` bei Connect), `journal_recipients` explizit (alles andere `550 5.1.1`), **kein Catch-all**. Optional `AUTH` PLAIN/LOGIN nur über TLS, bcrypt gegen `journaling_sources.smtpPasswordHash` | DEV   | §4.3       | Nicht gelistete IP wird beim Connect abgewiesen; unbekannter Empfänger ⇒ `550`; es existiert kein Konfigurationspfad, der einen Catch-all erlaubt; `AUTH` über Plaintext ist unmöglich                         |
| JR-406 | Response-Code-Mapping vollständig gemäß Skill `journal-ledger` §2, inklusive: Object-Store-/Redis-Ausfall ⇒ trotzdem `250`; Oversize ⇒ `552 5.3.4` **mit lautem Alert**; Shutdown ⇒ `421 4.3.2` mit Graceful Drain                                                   | DEV   | §3, §4     | Tabellarischer Test über **jede** Zeile der Tabelle; kein lokaler Fehler erzeugt jemals ein `5xx`                                                                                                              |
| JR-407 | Kein Relaying, keine Byte-Transformation: strukturell ausschließen, nicht nur unterlassen                                                                                                                                                                            | DEV   | §4.4       | Kein ausgehender Mailpfad im Paket vorhanden; Roundtrip-Test belegt byteidentische Speicherung inklusive ungewöhnlicher Zeilenenden und 8-Bit-Inhalten                                                         |
| JR-408 | Per-Source Connection- und Rate-Limits                                                                                                                                                                                                                               | DEV   | §4.3       | Überschreitung führt zu `4xx`, nicht zum Verbindungsabbruch ohne Antwort                                                                                                                                       |
| JR-409 | M365-IP-Range-Refresh-Helper: holt die offizielle Endpunktliste, erzeugt einen **Diff zur Operator-Freigabe**, wendet nichts automatisch an                                                                                                                          | DEV   | §4.3       | Helper verändert keine Konfiguration selbstständig; Diff-Ausgabe ist dokumentiert. Eine still erweiterte ACL wäre eine Sicherheitsregression                                                                   |
| JR-410 | Kill-during-DATA-Tests: `SIGKILL` an randomisierten Punkten während einer 50-MB-Übertragung, 500 Iterationen. Aus **Client**-Sicht auswerten                                                                                                                         | TEST  | §12.1      | Für jede Transaktion gilt: entweder der Client hat kein `250` gesehen, oder die Nachricht ist vollständig im Spool und korrekt verkettet. Seed wird geloggt                                                    |
| JR-411 | BDAT-Pfad-Tests explizit, inklusive Multi-Chunk und `BDAT 0 LAST`                                                                                                                                                                                                    | TEST  | §12.7      | Ergebnis byteidentisch zum `DATA`-Pfad; Chunk-Grenze mitten in einer Zeile abgedeckt                                                                                                                           |
| JR-412 | Oversize-Test an der `SIZE`-Grenze: exakt am Limit, ein Byte darüber, weit darüber                                                                                                                                                                                   | TEST  | §12.9      | Limit-Fall wird angenommen; darüber `552` **mit** Alert. Stille Verwerfung ist ein Fehlschlag des Tests                                                                                                        |
| JR-413 | Abnahme E4                                                                                                                                                                                                                                                           | PO    | —          | JR-401…412 erfüllt; Response-Code-Tabelle vollständig belegt                                                                                                                                                   |

---

## E5 — Journal-Report-Parser

**Ziel:** Der Envelope wird erhalten. Das ist die Existenzberechtigung des Features: eine
BCC-Transportregel kann Blindkopie-Empfänger und Verteilerlisten-Expansion **nicht** liefern.

| ID     | Task                                                                                                                                                                                                                                   | Rolle | RFC       | Akzeptanzkriterien                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------- | --------------------------------------------------------------------------------------------------------- |
| JR-501 | Exchange-Journal-Report parsen: `multipart/mixed` mit `text/plain`-Report und `message/rfc822`-Original. Beide Teile erhalten — Außenobjekt roh archivieren, Envelope in die Metadaten                                                 | DEV   | §6.1      | Innen- und Außenteil verfügbar; das archivierte Objekt ist die rohe Außenmail                             |
| JR-502 | Envelope-Felder: `Sender`, `Subject`, `Message-Id`, `To`, `Cc`, **`Bcc`**, mehrfache `Recipient:`-Zeilen, `On-Behalf-Of`, Verteilerlisten-Expansionseinträge, „undisclosed recipients"                                                 | DEV   | §6.1      | Testkorpus deckt jeden Fall ab; Bcc-Empfänger und DL-Mitglieder erscheinen in den gespeicherten Metadaten |
| JR-503 | Robustheit: kein Innenteil (fehlerhaft), S/MIME-verschlüsselter Innenteil ⇒ unverändert speichern, `content_encrypted` setzen, nur Header indexieren                                                                                   | DEV   | §6.1      | Beide Fälle werden angenommen und korrekt geflaggt; kein Fall führt zu einer Ablehnung                    |
| JR-504 | `parse_failed` als Ledger-Event: Nachricht wird trotzdem angenommen, gespeichert, gehasht, verkettet; extrahierbares wird indexiert; Operator wird alarmiert                                                                           | DEV   | §5.3      | Eine absichtlich unparsbare Nachricht ist danach vollständig im Ledger und im Storage, mit Flag und Alert |
| JR-505 | Plain-BCC-Fallback: fehlenden Journal-Wrapper erkennen, die empfangene Nachricht selbst als Beleg behandeln, Envelope aus der SMTP-Transaktion (`MAIL FROM`/`RCPT TO`) nehmen, reduzierte Envelope-Fidelity in den Metadaten vermerken | DEV   | §6.2      | Postfix-`always_bcc`- und Google-Routing-Muster werden korrekt erkannt und markiert                       |
| JR-506 | NDRs und Bounces an die Journal-Adresse speichern und flaggen                                                                                                                                                                          | DEV   | §6.2      | NDR wird archiviert und ist als solcher erkennbar                                                         |
| JR-507 | Owner-Resolution über `journaling_sources.organizationDomains` mit Alias-Normalisierung, gemäß der bereits dokumentierten Prioritätsreihenfolge in `docs/enterprise/journaling/guide.md`                                               | DEV   | §6        | Verhalten entspricht der dokumentierten Tabelle; Fallback-Fall protokolliert eine Warnung                 |
| JR-508 | Parser-Testkorpus aufbauen: echte Exchange-Journal-Report-Strukturen, DL-Expansion, Bcc-only, `On-Behalf-Of`, S/MIME, kein Innenteil, Plain-BCC, NDR                                                                                   | TEST  | §6, §12.8 | Jede Variante als Fixture; alle Assertions grün; Korpus enthält keine echten personenbezogenen Daten      |
| JR-509 | Abnahme E5                                                                                                                                                                                                                             | PO    | —         | JR-501…508 erfüllt; Bcc und DL-Expansion nachweislich in den Metadaten                                    |

---

## E6 — Phase-B-Worker

**Ziel:** Vom Spool ins Archiv, ohne den Acceptance-Contract zu berühren. Ein Ausfall hier darf
niemals eine Annahme verhindern.

| ID     | Task                                                                                                                                                                                                                                                                                                                                | Rolle | RFC    | Akzeptanzkriterien                                                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| JR-601 | `journal-inbound`-Worker als eigener Prozess nach dem Muster von `src/workers/ingestion.worker.ts`, mit `start:journal-worker`-Skript. `maxStalledCount`/`lockDuration` bewusst setzen                                                                                                                                              | DEV   | §2     | Worker startet eigenständig; Begründung der Queue-Parameter im Code dokumentiert                                                                    |
| JR-602 | Verarbeitung: Spool lesen → parsen → Außenobjekt in den Storage → Metadaten nach `archived_emails` → indexieren → Spool freigeben. `StorageService`, `IngestionService.processEmail`, `IndexingService.indexEmailBatch` wiederverwenden                                                                                             | DEV   | §2, §7 | Ende-zu-Ende von der Spool-Datei bis zum durchsuchbaren Treffer; ADR-010 entschieden (`processEmail` erweitern vs. eigener Pfad)                    |
| JR-603 | Idempotenz: Objekt-Dedupe auf `content_sha256`, aber **jede** Receipt bleibt im Ledger, Duplikate mit `duplicate_of` auf den Original-`seq`                                                                                                                                                                                         | DEV   | §4.5   | Dieselbe Nachricht zweimal zugestellt ⇒ ein Objekt, **zwei** Ledger-Einträge, zweiter mit gesetztem `duplicate_of`                                  |
| JR-604 | Spool-Reconciler: periodischer Sweep über Spool-Einträge mit Ledger-Eintrag, aber unvollständiger Phase B ⇒ nachreihen. Redis ist Optimierung, nicht Autorität                                                                                                                                                                      | DEV   | §3     | Bei geleerter Redis-Queue werden alle offenen Spool-Einträge wieder aufgenommen; kein Datenverlust                                                  |
| JR-605 | Hash-vor-Verschlüsselung festschreiben und testen: `content_sha256` über Plaintext-Wire-Bytes, `StorageService` verschlüsselt danach                                                                                                                                                                                                | DEV   | §7     | Test: Objekt exportieren, entschlüsseln, Hash neu berechnen ⇒ identisch zum Ledger-Wert                                                             |
| JR-606 | Object-Store-Ausfall-Test: Storage nicht erreichbar ⇒ Nachrichten werden weiterhin quittiert, Backlog läuft nach Erholung ab, Kette unberührt                                                                                                                                                                                       | TEST  | §12.4  | Alle drei Bedingungen erfüllt                                                                                                                       |
| JR-607 | Soak-Test: 100.000 Nachrichten, gemischte Größen, parallele Verbindungen ⇒ lückenlos, Verifikation grün, Durchsatz protokolliert. Als `nightly` klassifizieren, plus schnelle `ci`-Smoke-Variante. **`OA_TEST_PG_STALE_MS` über die erwartete Laufzeit heben** (F13) — ein 100k-Lauf überschreitet die Standardfrist von 2 h leicht | TEST  | §12.6  | Beide Varianten existieren und sind benannt; keine stille Reduktion der Nightly-Menge. **Die F13-Frist ist gesetzt und im Test sichtbar begründet** |
| JR-608 | Abnahme E6                                                                                                                                                                                                                                                                                                                          | PO    | —      | JR-601…607 erfüllt; Ende-zu-Ende-Fluss demonstrierbar                                                                                               |

---

## E7 — WORM-Storage

**Ziel:** Objekte sind nicht löschbar, auch nicht durch uns. **Fehler hier sind irreversibel** —
Object Lock im COMPLIANCE-Modus lässt sich nicht zurücknehmen.

| ID     | Task                                                                                                                                                                                      | Rolle | RFC     | Akzeptanzkriterien                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| JR-701 | `S3StorageProvider` um optionale Object-Lock-Parameter erweitern (`ObjectLockMode: COMPLIANCE`, `ObjectLockRetainUntilDate`), ohne bestehende Aufrufer zu verändern                       | DEV   | §7      | Bestehende Pfade unverändert; mit aktivierter Konfiguration wird ein Objekt mit Retention geschrieben                   |
| JR-702 | Least-Privilege-Credentials dokumentieren und durchsetzen: ohne `s3:DeleteObject`, `s3:DeleteObjectVersion`, `s3:BypassGovernanceRetention` und ohne verkürzendes `s3:PutObjectRetention` | DEV   | §7      | Beispiel-Policy im Deployment-Guide; Test gegen MinIO belegt, dass ein Löschversuch scheitert                           |
| JR-703 | Local-FS-Backend als substanziell schwächer dokumentieren und härten: dediziertes Mount, restriktive Rechte, `chattr +i` wo verfügbar                                                     | DEV   | §7      | Dokumentation vorhanden und benennt die Schwäche unmissverständlich; Härtung greift, wo das Dateisystem sie unterstützt |
| JR-704 | Retention-Konflikt dokumentieren: unter COMPLIANCE ist vorzeitige Löschung technisch unmöglich — steht **vor** der Wahl der Aufbewahrungsfrist im Guide, nicht danach                     | DEV   | §7, §10 | Abschnitt im Deployment-Guide vorhanden                                                                                 |
| JR-705 | WORM-Tests gegen MinIO mit Object Lock: Überschreiben scheitert, Löschen scheitert, Retention wird gesetzt, Verkürzungsversuch scheitert                                                  | TEST  | §7      | Alle vier Fälle grün                                                                                                    |
| JR-706 | Abnahme E7                                                                                                                                                                                | PO    | —       | JR-701…705 erfüllt                                                                                                      |

---

## E8 — Anchoring

**Ziel:** Die Kette ist auch gegen jemanden mit vollem Datenbankzugriff belastbar.

> ### Was `ADR-022` und `ADR-023` an diesem Epic ändern (entschieden 2026-07-31)
>
> Die Tasks unten sind für **eine** Kette und **eine** TSA formuliert. Sie bleiben gültig, aber vier
> bekommen eine Dimension dazu. Wer sie aufgreift, liest ADR-022 (Ankerform) und ADR-023 (TSA) zuerst;
> hier nur, was in welcher Zeile anders wird:
>
> - **`JR-801`** stempelt die **Merkle-Wurzel** statt eines einzelnen Kopf-Hashes und nimmt eine **Liste**
>   von TSA-URLs statt eines Einzelwerts, damit ein zweiter unabhängiger Zeitstempel möglich ist. „Kein
>   Standard-TSA-URL" bleibt. Neu dazu: die **Zertifikatskette wird mit dem Token archiviert** — bei
>   `open-tsa.eu` lebt das Signing-Cert 2 Jahre, die Aufbewahrungsfrist 10, und der Root liegt in keinem
>   Trust Store, muss also gepinnt werden.
> - **`JR-802`** baut den Baum über **alle** Ketten — auch die seit dem letzten Anker unveränderten — und
>   schreibt in **jede** Kette ein `anchor`-Event mit Wurzel, Inklusionspfad und Token. Der geankerte Kopf
>   ist der Kopf **vor** dem Event.
> - **`JR-805`** bekommt zwei Fälle, die es vorher nicht geben konnte: (a) der Inklusionsnachweis eines
>   Mandanten ist **ohne Daten anderer Mandanten** prüfbar; (b) eine **zwischen zwei Ankern verschwundene
>   Kette** wird als Befund gemeldet.
> - **`JR-804`** (Ausfallverhalten) bleibt inhaltlich unverändert — ADR-008 gilt weiter —, trifft jetzt
>   aber alle Mandanten gleichzeitig: ein fehlender Anker statt N.
>
> **Vorgezogen nach E2:** die **Merkle-Kodierung** (Blatt/Knoten domain-separiert, Sortierung, Regel für
> den ungeraden Knoten) gehört in `JR-203`/ADR-006, weil `verify` den Baum byteidentisch nachbauen muss und
> die kanonische Kodierung ihn sonst nicht abdeckt.

| ID     | Task                                                                                                                               | Rolle | RFC       | Akzeptanzkriterien                                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| JR-801 | RFC-3161-Client: Zeitstempel-Token für den Ketten-Kopf anfordern und verifizieren. **Kein Standard-TSA-URL ausliefern**            | DEV   | §5.5      | Token wird geholt und gegen die Kopf-Hash geprüft; leere Konfiguration liefert eine klare Fehlermeldung statt einer Voreinstellung |
| JR-802 | Anchor-Job: Kopf lesen, Token holen, `anchor`-Event ins Ledger schreiben, konfigurierbarer Zeitplan                                | DEV   | §5.5      | Event enthält Kopf-`seq`, Kopf-Hash und das Token; Zeitplan konfigurierbar                                                         |
| JR-803 | Externe append-only Ziele: S3-Bucket mit **eigenen** Credentials (write-only), Syslog über TLS, E-Mail. Mindestens eines erzwingen | DEV   | §5.5      | Konfiguration ohne Ziel wird abgelehnt; jeder Zieltyp einzeln funktionsfähig                                                       |
| JR-804 | TSA-Ausfallverhalten: laut eskalieren, Ingestion **niemals** stoppen                                                               | DEV   | §5.5, §15 | Bei mehrtägiger TSA-Nichterreichbarkeit läuft die Annahme weiter, Alarmierung steigt in der Schwere. ADR-008 entschieden           |
| JR-805 | Anchor-Tests: Token-Verifikation, Kette ab `seq` N neu geschrieben ⇒ Divergenz gegen den **ersten Anker nach N** erkennbar         | TEST  | §12.5c    | Divergenz wird mit korrektem `seq` gemeldet                                                                                        |
| JR-806 | Abnahme E8                                                                                                                         | PO    | —         | JR-801…805 erfüllt                                                                                                                 |

---

## E9 — `verify`-CLI

**Ziel:** Ein Prüfer kann die Vollständigkeit selbst nachrechnen, ohne Schreibrechte zu erhalten.

| ID     | Task                                                                                                                                                                                           | Rolle | RFC   | Akzeptanzkriterien                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- | --------------------------------------------------------------------------------------------------------- |
| JR-901 | `apps/oa-verify` anlegen, Argumentparsing mit `node:util` `parseArgs` (keine neue Dependency): `verify --from <seq> --to <seq>`                                                                | DEV   | §5.6  | CLI startet, `--help` erklärt sich selbst                                                                 |
| JR-902 | Read-only-Betrieb: eigene DB-Verbindung aus einer read-only Variable, **nicht** über den `src/database/index.ts`-Singleton                                                                     | DEV   | §5.6  | Mit read-only Credentials vollständig ausführbar; ein Schreibversuch existiert im Code nicht              |
| JR-903 | Prüflogik: Kette über den Bereich neu berechnen, `content_sha256` jedes Objekts gegen die gespeicherten Bytes, alle Anker gegen ihre Token. `IntegrityService.checkEmailIntegrity()` als Basis | DEV   | §5.6  | Alle drei Prüfungen implementiert; auf einem intakten Archiv grün                                         |
| JR-904 | **Erste Divergenz** mit `seq` und Feld melden, nicht nur pass/fail                                                                                                                             | DEV   | §5.6  | Bei mehreren Manipulationen wird die früheste gemeldet, mit Feldangabe                                    |
| JR-905 | `object_erased` korrekt behandeln: als absichtliche Löschung ausweisen, **nicht** als Kettenbruch                                                                                              | DEV   | §10   | Gelöschtes Objekt erscheint als „absichtlich gelöscht" mit erhaltener Hash; Kette bleibt grün             |
| JR-906 | Ausgabe: JSON **und** menschenlesbarer Bericht. Die Formulierung des Berichts ist Teil der Lieferung — er wird einem Prüfer übergeben                                                          | DEV   | §5.6  | Beide Formate vorhanden; der Textbericht ist ohne Systemkenntnis verständlich und wurde vom PO abgenommen |
| JR-907 | Verify-Tests gegen manipulierte Archive: alle Fälle aus JR-209 und JR-805 über die CLI                                                                                                         | TEST  | §12.5 | Jeder Fall wird mit korrektem `seq` gemeldet; Exit-Codes maschinell auswertbar                            |
| JR-908 | Abnahme E9                                                                                                                                                                                     | PO    | —     | JR-901…907 erfüllt; Textbericht abgenommen                                                                |

---

## E10 — Completeness-Monitoring

**Ziel:** Ein stiller Ausfall bleibt nicht eine Woche unbemerkt. Vollständigkeitsgarantien ohne
Überwachung sind wertlos.

| ID      | Task                                                                                                                                                                                            | Rolle | RFC       | Akzeptanzkriterien                                                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| JR-1001 | Heartbeat-Alert: kein Journal-Report innerhalb von N Minuten (Default 15) während konfigurierter Geschäftszeiten                                                                                | DEV   | §8        | Alert löst aus; Geschäftszeiten und Zeitzone konfigurierbar                                                                                 |
| JR-1002 | Gap-Detection im Ledger: bei jedem `verify`-Lauf und nachts, Alarmierung mit Schweregrad **kritisch**                                                                                           | DEV   | §8        | Künstlich erzeugte Lücke wird erkannt und kritisch alarmiert                                                                                |
| JR-1003 | Betriebsmetriken: Spool-Tiefe und -Alter, Phase-B-Backlog, TSA-Erreichbarkeit, Storage-Schreiblatenz                                                                                            | DEV   | §8        | Werte abfragbar und mit Schwellwerten alarmierbar                                                                                           |
| JR-1004 | Alternate-Mailbox-Reconciliation: Exchange-Ausweichpostfach als Pull-Quelle registrieren, Inhalte automatisch ingestieren, gegen das Ledger deduplizieren. `MicrosoftConnector` wiederverwenden | DEV   | §8        | Bei simuliertem Receiver-Ausfall werden die im Ausweichpostfach gelandeten Reports danach automatisch nachgeholt, ohne Duplikate im Storage |
| JR-1005 | Message-Trace-Reconciliation: Exchange-Message-Trace-CSV für einen Zeitraum importieren, Tagesvergleich matched/missing/extra, **signierter** Bericht                                           | DEV   | §8        | Bericht wird erzeugt und ist signiert; Abweichungen sind tagesgenau aufgeschlüsselt                                                         |
| JR-1006 | Alerting-Kanäle: mindestens E-Mail (`nodemailer` ist vorhanden) plus ein maschinenlesbares Ziel                                                                                                 | DEV   | §8, §11   | Konfiguration ohne funktionierendes Ziel wird beim Start beanstandet                                                                        |
| JR-1007 | Monitoring-Tests: Heartbeat, Gap, Backlog, Reconciliation nach simuliertem Ausfall                                                                                                              | TEST  | §8, §12.8 | Alle Signale lösen unter den erwarteten Bedingungen aus, und **nur** dann                                                                   |
| JR-1008 | Abnahme E10                                                                                                                                                                                     | PO    | —         | JR-1001…1007 erfüllt                                                                                                                        |

---

## E11 — Compliance-Features

**Ziel:** Die Artefakte, die im Prüfungsfall tatsächlich übergeben werden, existieren als Funktion —
nicht als Skriptübung.

| ID      | Task                                                                                                                                                                                                                                                                                                                         | Rolle | RFC     | Akzeptanzkriterien                                                                                                                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| JR-1101 | Auditor-Rolle seeden: read-only, getrennt von Admin. Suche, Ansicht, Export, `verify` — kein Löschen, keine Konfiguration, keine Benutzerverwaltung. Die vorhandenen Fixtures `iam-policy/test-policies/{read-only-all,auditor-*}.json` als Vorlage; `slug` beim Seeding **explizit** setzen (Slug-Bug in `IamService`)      | DEV   | §9      | Auditor kann suchen, ansehen, exportieren, `verify` ausführen; jeder Schreibversuch wird abgewiesen; Rolle ist nicht selbst-eskalierbar |
| JR-1102 | Frontend-Nav-Filterung nachrüsten: `routes/dashboard/+layout.svelte` rendert heute statische `baseNavItems`/`enterpriseNavItems`, eingeschränkte Nutzer sehen Punkte, die 403 liefern                                                                                                                                        | DEV   | §9      | Auditor sieht keine Menüpunkte, die er nicht benutzen darf. Skill `oa-i18n` für neue Strings befolgt                                    |
| JR-1103 | IAM-Doku-Drift beheben: `docs/services/iam-service/iam-policy.md` listet die Action `export` nicht und beschreibt `manage` fälschlich als Expansion zu `create/read/update/delete/search/sync`. Code ist korrekt (`iam.types.ts` und `policy-validator.ts` enthalten beide `export`; CASLs `manage` ist ein echter Wildcard) | DEV   | §9      | Doku stimmt mit dem Code überein; die Dreifachpflege ist in `CLAUDE.md` §5.4 vermerkt                                                   |
| JR-1104 | Export für die Datenübergabe: EML-Dateien + Manifest-CSV (`seq`, `received_at`, Envelope-Felder, `content_sha256`, `chain_hash`) + Prüfanleitung in Klartext. `archiver` ist vorhanden                                                                                                                                       | DEV   | §9      | Export erzeugt alle drei Bestandteile; die Prüfanleitung ist ohne Systemkenntnis befolgbar; PO hat sie abgenommen                       |
| JR-1105 | Löschung nur über Retention-Expiry, als typisiertes Ledger-Event `retention_expiry`. Optional Vier-Augen-Freigabe, bevor eine Retention-Policy wirksam wird. Anknüpfung: `schema/compliance.ts`, `hooks/RetentionHook.ts`, `complianceLifecycleQueue`                                                                        | DEV   | §9      | Kein Löschpfad ohne Ledger-Event; die Kette dokumentiert, **warum** ein Objekt fehlt                                                    |
| JR-1106 | DSGVO-Löschung: `object_erased`-Event mit `seq`, Zeitpunkt, Akteur, benannter Rechtsgrundlage und erhaltenem `content_sha256`. Ledger-Einträge werden **nie** gelöscht. Verweigerte Löschung wird ebenfalls protokolliert                                                                                                    | DEV   | §10     | Vorherige Existenz und Hash bleiben beweisbar, Inhalt ist weg; `verify` meldet keinen Kettenbruch; Verweigerung ist protokolliert       |
| JR-1107 | Legal Hold als Ledger-Event `legal_hold_set` mit wer/wann/warum; unterdrückt Retention-Expiry für passende Nachrichten. Anknüpfung: bestehendes Legal-Hold-Schema und UI                                                                                                                                                     | DEV   | §9      | Hold verhindert Ablauf; Setzen und Aufheben sind je ein Ledger-Event                                                                    |
| JR-1108 | Build-Identität: exakter Container-Image-Digest und Git-Commit in der UI, in der `verify`-Ausgabe und im Export-Manifest                                                                                                                                                                                                     | DEV   | §9      | Alle drei Stellen zeigen denselben Wert; „latest" erscheint nirgends                                                                    |
| JR-1109 | Compliance-Tests: Auditor-Rechte (positiv **und** negativ), Manifest-Vollständigkeit, Erasure-Semantik, Legal-Hold-Vorrang                                                                                                                                                                                                   | TEST  | §9, §10 | Jeder Schreibversuch des Auditors wird abgewiesen; Manifest deckt jede exportierte Nachricht ab                                         |
| JR-1110 | Abnahme E11                                                                                                                                                                                                                                                                                                                  | PO    | —       | JR-1101…1109 erfüllt; Prüfanleitung und Manifest abgenommen                                                                             |

---

## E12 — Rollout und Dokumentation

**Ziel:** Betreibbar, sicher voreingestellt, und ohne unzulässige Compliance-Behauptung.

| ID      | Task                                                                                                                                                                                                                                                                     | Rolle | RFC     | Akzeptanzkriterien                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| JR-1201 | Feature-Flag, **standardmäßig aus**. Ohne Flag startet kein SMTP-Listener                                                                                                                                                                                                | DEV   | §14     | Frische Installation öffnet keinen SMTP-Port                                                                         |
| JR-1202 | Parallelbetrieb mit Pull-Ingestion: Dedupe auf `Message-ID` + Content-Hash, dabei die journalisierte Kopie bevorzugen (reicherer Envelope). Bausteine: `doesEmailExist()`, `msgid_header_source_idx`, `storage_hash_source_idx`                                          | DEV   | §14     | Dieselbe Nachricht über beide Wege ⇒ ein Archiveintrag, und zwar der journalisierte                                  |
| JR-1203 | Docker: Dockerfile und `docker-compose.yml` um `smtp-ingress` erweitern, mit getrennten Credentials und Spool-Volume. `docker/docker-entrypoint.sh` berücksichtigen                                                                                                      | DEV   | §2, §14 | `docker compose up` bringt Ingress und Worker mit getrennten Rechten hoch; Spool liegt auf einem persistenten Volume |
| JR-1204 | Deployment-Guide: Exchange-Online-Journal-Rule, **Ausweichpostfach als verpflichtend**, DNS/MX, Firewall, Zertifikatsausstellung, Object-Lock-Bucket mit Least-Privilege, TSA-Auswahl, Monitoring-Ziele                                                                  | DEV   | §14     | Guide ist von einem Betreiber ohne Codekenntnis befolgbar                                                            |
| JR-1205 | `docs/enterprise/journaling/guide.md` korrigieren: die Datei beschreibt heute den abwesenden Closed-Source-Listener. Auf die tatsächliche Implementierung umschreiben, Widersprüche zum Port-Mapping und zur Backpressure-Logik beseitigen                               | DEV   | —       | Keine Aussage im Guide ohne Code dahinter                                                                            |
| JR-1206 | Nicht-Behauptung nach RFC §13 in das README aufnehmen — wortgetreu, nicht abgeschwächt                                                                                                                                                                                   | DEV   | §13     | Absatz vorhanden; nirgends im Repository wird „GoBD-konform" oder „revisionssicher" behauptet                        |
| JR-1207 | Pull-Ingestion umdokumentieren: geeignet für Backfill und Reconciliation, nicht als primärer Pfad für Compliance-Installationen                                                                                                                                          | DEV   | §14     | Betroffene Doku-Seiten angepasst                                                                                     |
| JR-1208 | Ende-zu-Ende gegen einen echten Exchange-Online-Tenant: Journal-Rule für intern und extern; DL-Expansions-Mitglieder und Bcc-Empfänger erscheinen in den Metadaten; Receiver offline ⇒ Ausweichpostfach fängt auf; Reconciliation holt nach. Klassifizierung **manuell** | TEST  | §12.8   | Vollständig durchgeführt und protokolliert; ohne echten Tenant nicht abnehmbar — kein Ersatz durch Mocks             |
| JR-1209 | Abnahme E12 und Projektabnahme                                                                                                                                                                                                                                           | PO    | §13     | Alle Epics abgenommen; `06-status.md` vollständig; keine unzulässige Compliance-Behauptung im Repository             |

---

## E13 — IAM-Autorisierung härten

> **Position in der Reihenfolge: direkt nach E1, vor E2.** Die Nummer 13 ist nur eine ID, keine
> Reihenfolgeangabe — siehe die Epic-Tabelle oben. Nachträglich eingeschoben am 2026-07-28.

**Ziel:** Die Autorisierungsschicht ist fail-closed. Solange sie es nicht ist, ist die Auditor-Rolle
aus E11 nicht baubar und jede Zugriffsaussage über das Archiv unbelegt.

**Branch:** `claude/journaling-e13-iam-hardening`, abgezweigt vom Integrationsbranch.

**Umfang: vier Befunde mit Autorisierungswirkung.** F7, F3, F8, F1 aus
`09-befunde-bestandscode.md`, plus die Auflösung des Action-Versatzes. **Nicht** in E13: F2, F4, F5,
F6, F9, F10 — sie bleiben dort mit Status offen dokumentiert.

| ID      | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Rolle     | Befund   | Akzeptanzkriterien                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JR-1301 | **Fehlschlagende Tests zuerst.** Die vorhandenen `it.fails`-Marker zu F1/F3/F7/F8 in echte Regressionstests umbauen, die den **gewünschten** Zustand fordern und deshalb jetzt rot sind                                                                                                                                                                                                                                                                                                                                                                                                                                           | TEST      | F1,3,7,8 | Jeder Test ist **vor** dem Fix rot und **nach** dem Fix grün, beides protokolliert. Ein Test, der nie rot war, belegt nichts                                                                                                                                                                                                                                                                             |
| JR-1303 | Action-Versatz auflösen — **entschieden in ADR-017 (Variante B)**: in `services/SearchService.ts:311` und `:423` das dritte Argument von `FilterBuilder.create(userId, 'archive', 'read')` auf `'search'` ändern. `api/routes/search.routes.ts` bleibt unverändert; `ArchivedEmailService.ts:62` und `IngestionService.ts:137` bleiben auf `'read'` (ihre Routen gaten auf `read` bzw. sie betreffen das Subject `ingestion`)                                                                                                                                                                                                     | DEV       | F7       | Nur diese zwei Zeilen geändert; kein weiterer `FilterBuilder`-Aufruf und kein Route-Gate angefasst. Code stimmt mit ADR-017 überein                                                                                                                                                                                                                                                                      |
| JR-1302 | `FilterBuilder`: `null` von `rulesToQuery` als **deny** behandeln (``sql`1=0` ``, wie der bereits vorhandene „No access"-Zweig). Unbeschränkte Rückgabe nur noch bei nachweislich **unbedingtem `can`**                                                                                                                                                                                                                                                                                                                                                                                                                           | DEV       | F7       | `auditor-specific-mailbox.json` liefert **keine** Zeile für `dev@openarchiver.com`; Nutzer ohne Rolle bekommt `1=0`, nicht `undefined`. Gegen echtes Postgres                                                                                                                                                                                                                                            |
| JR-1304 | `mongoToDrizzle`: unübersetzbare Bedingungen laut scheitern lassen statt verwerfen. Kein stilles Erweitern eines `$or`, kein Verlust einer `$not`-Negation. Aufrufer behandeln `undefined` als deny                                                                                                                                                                                                                                                                                                                                                                                                                               | DEV       | F3       | Ein unbekannter Operator führt zu Verweigerung, nicht zu unbeschränktem Zugriff; **kein Zweig wird stillschweigend weggelassen** — in keiner Position. Die Richtung des Schadens hängt von der Komposition ab und ist im Übersetzer nicht erkennbar: im `$or` einer `can`-Regel verengend, unter dem `$not` einer `cannot`-Regel und bei leerer Zweigliste fail-open (F22 samt Korrektur vom 2026-07-29) |
| JR-1305 | `cannot`-Ausschluss korrekt bauen, wenn der Wert ein Operator-Objekt ist — heute wird `{ $in: […] }` zu `{ $ne: { $in: […] } }`, der Ausschluss findet nicht statt                                                                                                                                                                                                                                                                                                                                                                                                                                                                | DEV       | F8       | `cannot … { $in: [...] }` schließt tatsächlich aus, in Drizzle **und** im Meili-Filter                                                                                                                                                                                                                                                                                                                   |
| JR-1306 | Condition-Keys gegen eine **Allowlist** bekannter Spalten prüfen statt zu escapen — ein unbekannter Key ist ohnehin ein Fehler und gehört fail-closed behandelt. Gilt auch für den `sql.raw`-Relationszweig. **F21 entschieden (PO, 2026-07-29): die strenge Variante** — abgewiesen wird **jeder** unbekannte Key, nicht nur einer mit SQL-Syntax. Die drei grünen Pins, die das heutige Durchlassen festhalten (`attachment.name`, `foo.bar` in der Golden-Datei, „resolves only the relations listed in `relationToTableMap`"), werden im **selben** Commit invertiert                                                         | DEV       | F1       | Ein Key mit `"` wird **abgewiesen**, nicht escaped-durchgelassen; ein unbekannter, syntaktisch harmloser Key ebenso; Relationszweig ebenso; `PolicyValidator` weist solche Policies beim Anlegen ab                                                                                                                                                                                                      |
| JR-1307 | Verhaltensänderung dokumentieren: wer den `null`-Zweig trifft, sieht künftig **nichts** statt alles. Release-Hinweis **plus** Prüfanleitung für Bestandsinstallationen. Als **ADR-016** festhalten, dass fail-closed den Bruch rechtfertigt. **Keine der drei `predefined_*`-Rollen ist betroffen** (belegt in ADR-017) — die Anleitung gilt für handgeschriebene Policies. **F17 mit aufnehmen:** ausgeliefert existiert nur `predefined_super_admin`, es gibt **keine** Read-Only-Rolle; ein Betreiber, der nach `predefined_read_only_user` sucht, findet nichts und muss wissen, dass das kein Fehler seiner Installation ist | DEV       | —        | Ein Betreiber kann **vor** dem Update feststellen, welche seiner Rollen betroffen sind, und der Hinweis nennt die drei betroffenen Formen konkret statt pauschal zu warnen                                                                                                                                                                                                                               |
| JR-1308 | **Erledigt (PO, 2026-07-29):** Entwurf liegt in `10-upstream-meldung.md`, englischer Meldetext plus deutsche Entscheidungsvorlage (Kanal, Zeitpunkt, Absender, Nutzlast, CVE). Umfasst F7/F19/F20, F1, F3/F22, F8 und F17 als getrennten Bug. **Nicht versendet, nicht veröffentlicht** — Upstream-Meldung vorbereiten: Beschreibung, Reproduktion, Fix-Vorschlag, betroffene Versionen. **Nicht selbst versenden** — Kanal und Zeitpunkt entscheidet der Auftraggeber                                                                                                                                                            | PO        | F7       | Entwurf liegt vor und ist **nicht** versendet                                                                                                                                                                                                                                                                                                                                                            |
| JR-1309 | Abnahme E13                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | TEST → PO | —        | Negative Assertions je Rolle; Nachweis, dass F2/F4/F5/F6/F9/F10 unverändert offen dokumentiert sind und nicht stillschweigend mitverändert wurden                                                                                                                                                                                                                                                        |

**Reihenfolge innerhalb E13:** `JR-1301` zuerst, dann `JR-1303` (durch **ADR-017 entschieden**, damit
reine Umsetzung), dann die Fixes `JR-1302`/`JR-1304`/`JR-1305`/`JR-1306`, dann `JR-1307`/`JR-1308`,
dann `JR-1309`.

### Nacharbeit aus der Abnahme `JR-1309` (2026-07-29)

Die Abnahme hat E13 **abgelehnt**. Die fünf Codekorrekturen sind unabhängig belegt und bleiben stehen;
gebrochen sind zwei Kriterien in der **betreibersichtbaren** Hälfte. Begründung, warum das nicht
akzeptiert wird statt nachgearbeitet: `JR-1307`s einziger Zweck ist, dass ein Betreiber **vor** dem
Update weiß, welche Rollen umschlagen — eine Abfrage mit einem gemessenen falsch-negativen für genau
die Richtung „sah alles, sieht nichts" erfüllt das nicht, und eine öffentliche Doku, die eine
Ablehnung beim Speichern behauptet, die nicht stattfindet, ist schlechter als keine. Beide Korrekturen
sind klein.

**Zweite Runde: `JR-1309a` hat erneut abgelehnt (F30) — und die Lehre ist eine andere als bei F27.**
Zweimal ist E13 an derselben Klasse gescheitert: die veröffentlichte Betreiberseite behauptet eine
**Abdeckung**, die sie nicht hat. Solange sie das tut, findet ein adversarialer Prüfer fast immer eine
Ebene tiefer eine weitere Form — bei F27 war es ein Skalar als `conditions`, bei F30 ein leerer
Objektknoten in einem `$or`-Zweig. **Die Antwort ist deshalb nicht, die Abdeckung ein drittes Mal
einzuholen, sondern den falsifizierbaren Anspruch aufzugeben** (`JR-1317` (b), ADR-020). Die billige
echte Verbesserung wird mitgenommen (`JR-1317` (a)), weil die rekursive CTE schon daneben liegt und
nur nicht benutzt wird. Danach prüft `JR-1309b` **schmal** — Kriterium 12 und `JR-1317`, nicht 23
Kriterien erneut.

**Dritte Runde: `JR-1309b` hat abgelehnt (F31) — und diesmal lag der Fehler beim PO.** `JR-1317` hat
getan, was ADR-020 verlangte, und ist trotzdem gescheitert: die ADR nannte den Verhaltenscheck selbst
„vollständig", also ist der Abdeckungsanspruch von der Abfrage **auf ihn gewandert** statt zu
verschwinden. Der Prüfer hat ihn dort widerlegt — der vorgeschriebene Vergleich nennt zwei Zahlen, die
Anwendung filtert drei Oberflächen. **Die Lehre ist nicht „noch einen Satz streichen", sondern: solange
irgendein Element der Seite als das benannt wird, was „den Rest abdeckt", wandert der falsifizierbare
Anspruch nur weiter.** ADR-020 ist berichtigt, `JR-1318` setzt es um, `JR-1309c` prüft es — und liest
dabei die **ganze** Seite, nicht den Diff: dreimal in Folge saß der Defekt in Text, der in derselben
Runde neu geschrieben wurde.

**Warum das nicht als „nicht abnahmerelevant" durchgewinkt wird**, obwohl es reine Doku ist und der
Code unbestritten hält: `JR-1307`s Kriterium 12 ist der einzige Zweck dieser Seite — ein Betreiber muss
**vor** dem Update wissen, welche Rollen umschlagen. Eine Anleitung, die ihn anweist, eine zutreffende
Warnung zu verwerfen, erfüllt das nicht, sondern kehrt es um. Dieselbe Begründung wie bei F27 und F30.
Für die drei niedrigen Befunde F32–F34 gilt das nicht; sie werden nur mitgenommen, weil sie in derselben
Datei liegen und je zwei Sätze kosten.

| ID       | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Rolle | Befund   | Akzeptanzkriterien                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JR-1313  | **F29 beheben** — `PolicyValidator.areConditionKeysValid()` auf **höchstens zwei** Segmente und auf eine Relation aus `relationToTableMap` prüfen, damit Validator und `mongoToDrizzle` deckungsgleich sind. `relationToTableMap` ist eine Konstante; der Validator braucht dafür keinen Tabellenkontext (anders als bei der Spaltenexistenz, ADR-019). **Dazu die Formprüfung von `conditions` selbst** (PO-Entscheidung zu F26/F27): `conditions` muss ein **Objekt** sein oder fehlen — Skalar, Array und `null` werden beim Anlegen abgewiesen. Prädikat aus **einer** Quelle, von Validator und Übersetzer gemeinsam genutzt, damit die beiden nicht wieder auseinanderlaufen                                                                                                                                                              | DEV   | F29, F26 | `attachment.name`, `foo.bar` und `a.b.c` werden **beim Anlegen** abgewiesen (`400`), nicht erst zur Abfragezeit; `conditions: 5`, `conditions: null` und `conditions: []` ebenso. Ein neuer Test hält beide Gates gegeneinander: für **jeden** geprüften Key stimmen Validator und Übersetzer im Urteil überein. `foo` bleibt bewusst zugelassen (ADR-019). Das Laufzeitverhalten für **bereits gespeicherte** solche Policies bleibt unverändert (bei `JR-1311`)                                   |
| JR-1314  | **F27 und F28 beheben — PO-Entscheidung: _beides_, nicht eines von beiden.** (a) Query 2 um einen Befundtyp für ein `conditions` erweitern, das existiert und **nicht** `object` ist; Query 3 `subject = 'all'` auf **beide** Tabellen abbilden. (b) **Und** den Absolutsatz ersetzen: nicht „no rows means no role is affected", sondern genau benennen, welche Formen die Abfragen prüfen und welche nicht. Begründung unten                                                                                                                                                                                                                                                                                                                                                                                                                  | DEV   | F27, F28 | Die Blöcke werden **aus der Markdown-Datei extrahiert und wörtlich** gegen echtes Postgres gefahren. Eine Rolle mit `conditions: 5` und eine mit einem Tippfehler-Key unter `manage all` werden **gemeldet**; die drei `predefined_*` und die Gegenprobe weiter in **keiner** Ausgabe. Kein Absolutsatz mehr im Dokument                                                                                                                                                                            |
| JR-1315  | **F25 beheben** — entweder den F5-Kommentar in `mongoToDrizzle.ts` nachziehen oder die Aussage in `06-status.md`/`07-session-handover.md` auf F4 einschränken. Reine Doku bzw. ein Kommentar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | DEV   | F25      | Die Behauptung und der Code stimmen überein — nachprüfbar mit einem `grep` nach der Befundnummer im Produktionscode                                                                                                                                                                                                                                                                                                                                                                                 |
| JR-1309a | Erneute Abnahme E13 nach der Nacharbeit — **durchgeführt 2026-07-29, Ergebnis: erneut nicht abgenommen** (F30). 22 von 23 Kriterien erfüllt; zwei Lücken aus `JR-1309` geschlossen (HTTP `400` end-to-end, Betreiber-SQL auf PostgreSQL 17.10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | TEST  | —        | Die zwei in `JR-1309` gebrochenen Kriterien (`JR-1306` Validator beim Anlegen, `JR-1307` Betreiber kann vorher feststellen) plus die Kriterien von `JR-1313`, `JR-1314` und `JR-1315`, plus ein Volllauf. **Nicht** alles neu — die 17 erfüllten Kriterien werden nur dort erneut geprüft, wo die Nacharbeit sie berührt. **`JR-1316` zählt nicht dazu** (nach E13, siehe unten)                                                                                                                    |
| JR-1317  | **F30 beheben — und zwar an der Wurzel.** (a) Die zwei Formbefunde von Query 2 auf **Knotenebene** stellen: aus der rekursiven CTE `cond` statt aus `pair`. Leerer Objektknoten (`node = '{}'`) in **jeder** Position; nicht-Objekt nur in **struktureller** Position (Wert von `$not`/`$and`/`$or`, Element eines `$and`/`$or`-Arrays) — **nicht** pauschal „Knoten ist kein Objekt", das würde jedes Blatt melden. Die Wurzelmeldung „`conditions` ist kein Objekt" bleibt. (b) **Den Abdeckungsanspruch entfernen:** „It examines" ⇒ „What it reports", der widerlegte Satz zu „the values inside a condition" fällt, ausdrücklich ergänzt, dass eine Abfrage über schemaloses JSONB nicht als vollständig bewiesen werden kann, plus eine **verifizierbare** Gegenprobe, die keine Aufzählung von JSON-Formen braucht. (c) **ADR-020** dazu | DEV   | F30      | Die **acht** in F30 gemessenen Formen werden von Query 2 gemeldet, Gegenprobe `{"$or": []}`/`{"$and": []}` weiter. **Keine Falsch-positiven:** die drei `predefined_*`-Rollen, die Kontrollen und normale Bedingungen (`{"userEmail":"a@x"}`, `{"id":{"$in":[…]}}`, `{"ingestionSource.userId":"…"}`) schweigen in **jeder** Ausgabe. Blöcke **aus der Markdown-Datei** extrahiert und wörtlich gegen echtes Postgres gefahren. Kein Satz behauptet mehr Abdeckung. Kein Produktionscode, kein Test |
| JR-1309b | **Schmale** dritte Abnahme — nur `JR-1307`s Kriterium 12 und `JR-1317`, nicht die 23 Kriterien erneut. **Durchgeführt 2026-07-29, Ergebnis: zum dritten Mal nicht abgenommen** (F31). 17 von 18 Kriterien erfüllt; gebrochen ist Kriterium 12, die Textprüfung gegen ADR-020. `JR-1317` (a) — Knotenebene, keine Falsch-positiven — ist unabhängig belegt und hält                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | TEST  | F30      | Die acht F30-Formen gemeldet; **keine Falsch-positiven** (der Hauptrisikopunkt des Fixes); Blöcke wörtlich aus der `.md`; Volllauf Exit 0 mit **zitierter Testzahl**; `FilterBuilder.ts`/`mongoToMeli.ts` unberührt; `predefined-roles.int.test.ts` 7/7; kein Vollständigkeitsanspruch im Dokument (Textprüfung gegen ADR-020)                                                                                                                                                                      |
| JR-1318  | **F31 beheben — die Bürgschaft aufgeben, nicht den Satz.** (a) Der Verhaltenscheck nennt **alle drei** Oberflächen, für die die Anwendung einen Zeilenfilter baut; die Liste der Ingestion-Quellen ist die fehlende dritte Zahl. (b) „whatever the queries did or did not report about it" ersatzlos streichen — er lädt dazu ein, eine **zutreffende** Meldung zu verwerfen. (c) „the behaviour check is what covers the rest" fällt: **kein Element der Seite bürgt für ein anderes**, in keiner Richtung. (d) Der Verhaltenscheck sagt, was er **nicht** sieht. **Dazu F32–F34** (Wortlaut des Fehlertexts, „skipped without a row", „The known case") — dieselbe Datei, billig. Grundlage: **ADR-020 samt Berichtigung**                                                                                                                    | DEV   | F31–F34  | Kein Satz der Seite behauptet Abdeckung, für **kein** Element und in **keiner** Richtung; der neue Text ist selbst gegen ADR-020 geprüft. Die dritte Zahl ist belegt: an einer Rolle mit Archiv-Grants und einem Verbot auf der `ingestion`-Seite bleiben beide alten Zahlen stehen, während `FilterBuilder.create(user, ingestion, read)` auf `ingestionSourceId = "-1"` umschlägt. `lint` und `docs:build` grün, `dist/dev/` existiert nicht. Kein Produktionscode, kein Test, keine Migration    |
| JR-1309c | **Noch schmalere** vierte Abnahme — nur `JR-1307`s Kriterium 12 und `JR-1318`. **Nicht** die Abfrageseite erneut: `JR-1309b` hat sie unabhängig belegt (acht Formen gemeldet, keine Falsch-positiven, 42 Werte gegen den Übersetzer gekreuzt), und `JR-1318` fasst keine SQL an. **Durchgeführt 2026-07-30, Ergebnis: E13 ABGENOMMEN** — alle Kriterien erfüllt und ohne DEV-Bericht selbst gemessen; der einzige Vorbehalt des Berichts ist vom PO widerlegt worden (**F36**, reines F35). Rückmerge `--no-ff` vollzogen                                                                                                                                                                                                                                                                                                                       | TEST  | F31–F34  | Die vier Befunde sind an den benannten Stellen behoben; **kein neuer Abdeckungssatz** ist dabei entstanden (der Prüfer liest die Seite vollständig, nicht nur den Diff — dreimal in Folge lag der Defekt in neu geschriebenem Text); die dritte Zahl ist gegen `FilterBuilder` gemessen, nicht nur behauptet; Volllauf Exit 0 mit zitierter Testzahl; `lint`/`docs:build` grün; `dist/dev/` existiert nicht                                                                                         |

**F26 — PO-Entscheidung (2026-07-29): vorgezogen, aber nur zur Hälfte.** Der Tester hat recht, dass
F26 kein Regress ist und kein Kriterium bricht. Die **Ursache** teilt er sich aber mit F27: ein
`conditions`, das kein Objekt ist, wird heute überhaupt nicht geprüft — bei falsy Wert wird die Regel
unbedingt (F26), bei truthy Skalar kippt sie durch E13 von „alles" auf „nichts" (F27). Deshalb wandert
**die Formprüfung von `conditions` selbst** in `JR-1313`: `conditions` muss ein **Objekt** sein oder
fehlen; Skalar, Array und `null` werden beim Anlegen abgewiesen. Das kostet dort wenige Zeilen, weil die
Rekursion ohnehin dort steht.

Was **nicht** vorgezogen wird: das Verhalten für **bereits gespeicherte** solche Policies zu ändern.
Das bliebe ein Regress-Risiko ohne Not, und die Betreiber-SQL aus `JR-1314` findet sie — genau dafür ist
sie da. Die Laufzeitseite bleibt bei `JR-1311`.

**Zur Entscheidung „Abfragen erweitern _oder_ Absolutsatz entschärfen":** beides. Nur zu entschärfen
lässt den Betreiber ohne brauchbare Prüfung zurück — der Zweck des Dokuments ist, die Frage „bin ich
betroffen?" zu beantworten, und ein „diese Abfrage findet das meiste" beantwortet sie nicht. Nur zu
erweitern erzeugt denselben Fehler eine Runde später, weil eine Abfrage über beliebiges JSONB gegen
künftige Formen nie beweisbar vollständig ist. Tragfähig ist die Kombination: die Abfragen deckenalle
**heute bekannten** Formen ab, und das Dokument sagt genau, welche das sind und welche es nicht sind.
`JR-1316` hält das maschinell fest, damit die Lücke nicht wiederkommt — **nach E13**, siehe unten.

**`JR-1316` ist am 2026-07-29 aus E13 herausgenommen worden (Entscheidung des Auftraggebers).** Die
Task ist richtig beschrieben und bleibt wortgleich stehen, sie war nur falsch einsortiert. Begründung:
E13s Zweck ist „die Autorisierungsschicht ist fail-closed", und `JR-1316` sichert kein
Autorisierungsverhalten, sondern ein **Doku-Artefakt** ab. Die Lücke, die sie bewachen soll (**F27**),
**ist behoben** und in `JR-1314` durch eine Falsch-negativ-Prüfung gegen echtes Postgres belegt —
`JR-1316` schützt gegen ihre **Wiederkehr**, nicht gegen ihren Fortbestand. Ein Epic, dessen
Kernaussage unabhängig belegt ist, wird nicht von einer Absicherung zweiter Ordnung offengehalten.
**`JR-1316` zählt ausdrücklich nicht zu den Kriterien von `JR-1309a`.**

### Folge-Task nach E13 — nicht Teil von E13

| ID      | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Rolle | Befund | Akzeptanzkriterien                                                                                                                                                                                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JR-1310 | Variante C aus **ADR-017**: die in `requirePermission` geprüfte (Action, Subject) am Request mitführen und `FilterBuilder` daraus speisen, statt sie im Service erneut zu wählen. Damit kann der Versatz aus `JR-1303` konstruktiv nicht wiederkehren                                                                                                                                                                                                                                                                                                     | DEV   | F7     | Keine Aufrufstelle wählt die Action noch selbst; ein absichtlich eingebauter Versatz lässt sich nicht mehr formulieren. Verhalten je Rolle unverändert                                                                                                |
| JR-1312 | **Erledigt 2026-07-30** (Integrationsbranch, nach dem Rückmerge). `docs/services/iam-service/iam-policy.md` berichtigen — die dritte, veraltete Stelle des Berechtigungsvokabulars (`CLAUDE.md` §5.4): die Action `export` fehlt in der Liste, und `manage` wird als Aufzählung `create/read/update/delete/search/sync` beschrieben statt als echter CASL-Wildcard, der `export` mit abdeckt. `iam.types.ts` und `policy-validator.ts` sind korrekt und stimmen überein — **nur die Doku ist falsch**. Hat schon Zeit gekostet (Fallstrick 3 im Handover) | DEV   | —      | Alle drei Stellen des Vokabulars stimmen überein; wer der Doku glaubt, „fixt" keinen Bug mehr, der nicht existiert                                                                                                                                    |
| JR-1311 | **Spaltengenaue** Prüfung der Condition-Keys dort, wo das Subject bekannt ist — in `FilterBuilder.create()`, das `resourceType` bereits hat, **nicht** in `mongoToDrizzle` (subjektagnostischer Übersetzer) und **nicht** im `PolicyValidator` (kennt die Tabelle nicht, dieselbe Policy kann für mehrere Subjects gelten). Schließt den in ADR-019 benannten Restspalt: ein syntaktisch harmloser, aber nicht existierender Key                                                                                                                          | DEV   | F1     | Ein Key, der für das geprüfte Subject keine Spalte benennt, wird **abgewiesen**, nicht als `"foo" = $1` an Postgres gegeben. Die Formtests von `mongoToDrizzle` bleiben mit synthetischen Feldnamen lauffähig                                         |
| JR-1316 | **Die Betreiber-SQL bekommt einen Regressionstest.** Die Abfragen sind ein sicherheitsrelevantes Artefakt, aber das einzige in E13 ohne Test — genau deshalb ist F27 durch alle Prüfungen gekommen. Ein Test extrahiert die Blöcke **aus der veröffentlichten Markdown-Datei** und fährt sie gegen dieselben Fixtures, gegen die der Code geprüft wird (`src/iam-policy/test-policies/*.json` plus die Formen aus F19/F20/F26/F27/F28)                                                                                                                    | TEST  | F27    | Für **jede** Fixture, deren Verhalten sich durch E13 ändert, meldet die Abfrage sie; für jede unveränderte schweigt sie. Ein neuer Fixture-Typ, den die Abfrage nicht kennt, macht den Test **rot** — nicht die Abfrage stillschweigend unvollständig |

**Warum nicht in E13:** `JR-1310` ist eine Refaktorierung, keine Sicherheitskorrektur — sie berührt die
Middleware, alle vier `FilterBuilder`-Aufrufstellen und die Service-Signaturen. In einem Epic, dessen
Zweck das Schließen einer Autorisierungslücke ist, würde sie den Diff verwässern und die Abnahme aus
`JR-1309` erschweren. `JR-1311` schließt einen Restspalt, der **kein** Injektionsweg ist, und braucht
eine Subject→Spalten-Abbildung, die es noch nicht gibt. `JR-1316` sichert ein **Doku-Artefakt** ab,
kein Autorisierungsverhalten, und die Lücke dahinter ist behoben (Begründung oben). **Keine dieser
Tasks zählt zu den Kriterien von `JR-1309`/`JR-1309a`.** `JR-1311` ist unabhängig von `JR-1310` — es
braucht Variante C nicht, weil `FilterBuilder.create()` das Subject schon als Parameter bekommt.

**Reihenfolge unter den Folge-Tasks:** ~~`JR-1312` zuerst~~ **(erledigt 2026-07-30)**, dann `JR-1316`
(Absicherung der Betreiber-SQL), dann `JR-1311`, dann `JR-1310`. Keine davon blockiert **E2** — der
Receiver kann parallel beginnen, ~~sobald `JR-105c` erledigt ist~~ **(`JR-105c` ist seit 2026-07-30
erledigt, `b5b2190`)**.

**`JR-1312` ist reine Dokumentation** und gehört deshalb **nicht** auf einen Epic-Branch, sondern als
Grundlagenarbeit direkt auf den Integrationsbranch — allerdings **erst nach dem Rückmerge von E13**,
damit `JR-1309` einen unveränderten Stand prüft. Es wäre naheliegend gewesen, sie in `JR-1307`
mitzunehmen, weil DEV dieselbe Datei angefasst hat; bewusst nicht getan, weil das den Diff eines
Sicherheits-Epics um eine sachfremde Korrektur erweitert hätte.

**Wiederverwendung:** der Harness aus E1 —
`packages/backend/tests/support/{pg-harness,iam-seed,policy-fixtures,render-sql}.ts` und die Helfer
unter `tests/support/` (`@oa-test/*`). Die acht Fixtures in `src/iam-policy/test-policies/`,
besonders `auditor-specific-mailbox.json` (belegt F7b) und `read-only-all.json` als Gegenprobe. Der
vorhandene „No access"-Zweig in `FilterBuilder.create()` ist die Vorlage für den Deny-Fall.

---

## Nicht im Scope

Aus RFC §1 („Non-goals") und §15, hier explizit festgehalten, damit es nicht durch die Hintertür
zurückkehrt:

- Allzweck-MTA werden: kein Relaying, keine Ausgangs-Queue, keine Benutzerpostfächer.
- Viren- und Spam-Prüfung.
- Pull-Ingestion ersetzen — sie bleibt für Backfill, Altdaten-Import und Reconciliation nötig.
- Irgendeine Installation automatisch compliant machen (RFC §13).
- Merkle-Baum statt linearer Kette (RFC §15 — später, nicht v1).
- Mehrmandanten-Ketten über die in E2 getroffene Minimalentscheidung hinaus.
