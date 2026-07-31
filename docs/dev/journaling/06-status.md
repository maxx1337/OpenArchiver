# Status

**Diese Datei ist die verbindliche Fortschrittsquelle.** Sie wird am Ende **jeder** Session
aktualisiert — auch wenn nichts fertig wurde. Ein nicht aktualisierter Status ist schlimmer als
keiner, weil er Fortschritt behauptet, der nicht existiert.

Legende: `[ ]` offen · `[~]` in Arbeit · `[x]` fertig und abgenommen · `[!]` blockiert

**Letzte Aktualisierung:** 2026-07-30 (**`JR-1309c` hat E13 in der vierten Runde ABGENOMMEN — alle
Kriterien erfüllt, kein offener Befund; Rückmerge in den Integrationsbranch vollzogen, danach
`JR-1312`**) · **Branch:** `claude/enterprise-product-implementation-cxmmqe` (E13 ist zurückgemergt)

> **E13 ist abgenommen (2026-07-30, `JR-1309c`).** Vier Abnahmerunden, drei Ablehnungen (F27/F28/F29 →
> F30 → F31), dann die Annahme. Der Prüfer hat ohne DEV-Bericht gearbeitet und **jede** Zahl selbst
> gemessen. Der einzige Vorbehalt seines Berichts — ein vermuteter neuer Befund an der Prettier-Prüfung
> — ist vom PO **nachgemessen und widerlegt** worden (siehe **F36** in `09-befunde-bestandscode.md`);
> er ist reines F35 (CRLF) und kein zusätzlicher Defekt. Damit steht die Annahme ohne Einschränkung.

> **`JR-1317` ist erledigt (Rolle `senior-dev`, 2026-07-29) — die letzte inhaltliche Task von E13.**
> (a) Query 2 der Betreiberseite stellt die zwei Formbefunde auf **Knotenebene** (aus der rekursiven CTE
> `cond` statt aus `pair`, mit einer Positionsangabe je Befund): alle **acht** F30-Formen werden
> gemeldet, die Gegenproben weiter, und die drei `predefined_*`-Rollen plus acht Kontrollen schweigen in
> **jeder** Ausgabe — maschinell verglichen, Blöcke wörtlich aus der `.md` gegen PostgreSQL 16.13.
> (b) **Der Abdeckungsanspruch ist entfernt** (ADR-020): „It examines" ⇒ „What it reports", kein
> „recursively" als Zusage, der widerlegte Satz zu „the values inside a condition" ersetzt, ausdrücklich
> ergänzt, dass eine Abfrage über schemaloses JSONB **nicht als vollständig gezeigt werden kann** und ein
> leeres Ergebnis ein **Hinweis, keine Freigabe** ist, plus eine **verifizierbare Gegenprobe ohne
> Formliste** (je Rolle zwei Zahlen vor/nach dem Update vergleichen). Vier weitere Abdeckungssätze
> derselben Klasse standen auf der Seite und sind mit ersetzt. **Kein Produktionscode, kein Test, keine
> Migration**; Suite unverändert `250 passed | 2 skipped`, Exit 0. Details unten unter „`JR-1317`
> erledigt" und in `09-befunde-bestandscode.md` unter **F30**.

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

| Reihenfolge | Epic | Titel                              | Status                                                             | Fertig / Gesamt          |
| ----------- | ---- | ---------------------------------- | ------------------------------------------------------------------ | ------------------------ |
| —           | E0   | Planung, Doku, Agent-Infrastruktur | **fertig**                                                         | 6 / 6                    |
| 1           | E1   | Test- und CI-Fundament             | **abgenommen + gemergt**, Nacharbeit `JR-105c` erledigt            | 10 / 10                  |
| 2           | E13  | IAM-Autorisierung härten           | **abgenommen + gemergt** (`JR-1309c`, 4. Runde), Folge-Tasks offen | 9 / 9 + 8 / 8 Nacharbeit |
| 3           | E2   | Ledger und Hash-Chain              | offen                                                              | 0 / 10                   |
| 4           | E3   | Spool und Acceptance-Contract      | offen                                                              | 0 / 8                    |
| 5           | E4   | `smtp-ingress`-Service             | offen                                                              | 0 / 13                   |
| 6           | E5   | Journal-Report-Parser              | offen                                                              | 0 / 9                    |
| 7           | E6   | Phase-B-Worker                     | offen                                                              | 0 / 8                    |
| 8           | E7   | WORM-Storage                       | offen                                                              | 0 / 6                    |
| 9           | E8   | Anchoring                          | offen                                                              | 0 / 6                    |
| 10          | E9   | `verify`-CLI                       | offen                                                              | 0 / 8                    |
| 11          | E10  | Completeness-Monitoring            | offen                                                              | 0 / 8                    |
| 12          | E11  | Compliance-Features                | offen                                                              | 0 / 10                   |
| 13          | E12  | Rollout und Dokumentation          | offen                                                              | 0 / 9                    |

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

**Das vollständige Protokoll dieses Epics steht in [`11-archiv-e1.md`](11-archiv-e1.md)** — 681 Zeilen,
unverändert ausgegliedert am 2026-07-30, weil ein abgenommenes und gemergtes Epic den aktuellen Stand
nicht verdecken soll. Dort: `JR-101`–`JR-105`, die Nacharbeit `JR-104a`/`JR-105b`, die abgelehnte Abnahme
`JR-106`, die bestandene `JR-106a`, F1–F16 in ihrem E1-Kontext und die CI-Einrichtung.

**Von E1 ist nichts mehr offen.** Die letzte Nacharbeit **`JR-105c`** (F14–F16, F24) ist am 2026-07-30
erledigt; Protokoll direkt darunter.

### `JR-105c` erledigt (2026-07-30, `b5b2190`) — der Wächter zählt jetzt Tests, nicht Dateien

**Umfang:** F14, F15, F16, F24. Grundlagenarbeit direkt auf dem Integrationsbranch, wie im Handover
vorgesehen. Kein Produktionscode: der Diff berührt `tests/support/*`, `packages/backend/tests/*`,
`vitest.config.ts` und `.github/workflows/ci.yml`.

**Was gebaut wurde, und warum in dieser Form**

1. **Ein zweiter Wächter zählt _ausgeführte_ Tests je Suite _und je Klasse_**
   (`tests/support/executed-tests.ts`), verglichen mit `SUITES[].expectedTests`. Ausgeführt heißt
   `passed` oder `failed`. **Je Klasse** ist der tragende Teil: die Umetikettierung aus F14 verringert
   die Gesamtzahl **nicht**, sie verschiebt die Tests in eine Klasse, die die Standardauswahl nicht
   fährt — also fällt `expectedTests.ci` der Suite auf 0 und nur eine klassenweise Zählung sieht das.
   Nebeneffekt, der Arbeit spart: dieselbe Tabelle trägt `pnpm test:nightly` mit, ohne eine zweite.
2. **Gleichheit statt Untergrenze**, auch für die Dateizahl (`minimumFiles` → `expectedFiles`). Das ist
   wörtlich der in F15 vorgeschlagene Minimalfix. Der Preis ist eine Zahl je Commit, der die Zählung
   ändert; beide Fehlermeldungen nennen die einzutragende Zahl, damit der ehrliche Weg ein Copy-paste
   ist und nicht eine Suche.
3. **Mechanik: Reporter misst, `globalSetup`-Teardown urteilt.** Zählen kann erst nach dem Lauf
   passieren, und vitest hat dort keinen Assertions-Haken. Die Reihenfolge ist **gemessen**, nicht
   angenommen (vitest 3.2.7): `globalSetup` → Tests → `onTestRunEnd` → Zusammenfassung → `onFinished` →
   Teardown, und ein werfender Teardown endet mit **Exit 1**. Die Messdatei wird vor dem Lauf
   **gelöscht** und danach **verlangt** — wer den Reporter aus `vitest.config.ts` entfernt, macht den
   Lauf rot statt den Wächter abzuschalten. Dieselbe Positiv-Konstruktion wie beim Inventar-Report.
4. **Ein verengter Lauf prüft nichts und sagt das.** `-t`, Dateifilter, `--project`, `--shard`: der
   Lauf bleibt grün und gibt „verified NOTHING" als Coverage-Hinweis aus. Begründung: ein Wächter, der
   `pnpm test -t` rot macht, ist ein Wächter, den man abzuschalten lernt. Damit das Zugeständnis nicht
   dort greift, wo die Zusicherung gebraucht wird, verlangt `assert-inventory-report.mjs`, dass die
   Prüfung **anwendbar** war — in der CI ist die Hintertür also zu.
5. **Die CI liest das Urteil, statt es nachzurechnen.** Der Teardown schreibt sein Verdikt in die
   Messdatei zurück. Zwei Implementierungen einer Regel laufen auseinander — das ist **F29**, und der
   Fehler wird hier nicht wiederholt.
6. **Der Hauptprozess besitzt den Rückstand dieses Laufs** (`tests/support/harness-ledger.ts` und
   `harness-residue.ts`). Der Worker trägt jede geholte Datenbank in ein Ledger-Verzeichnis dieses
   Laufs ein und löscht den Eintrag erst, wenn der Drop stattgefunden hat; der Teardown meldet, was
   übrig ist, mit Namen, Label und Worker-PID, **droppt** es und macht den Lauf rot, sofern er nicht
   verengt war. Bewusst **nicht** „alle `oa_test_*` abfragen und die Differenz bilden": das hätte die
   lebende Datenbank eines fremden, parallelen Laufs für Rückstand halten können, und genau das war
   **F12**. `acquireTestDatabase()` verweigert den Dienst ohne Ledger-Verzeichnis, **bevor** es etwas
   anlegt.
7. **Ein drittes Modul, das nichts importiert** (`tests/support/test-classes.ts`) trägt Klassenliste,
   Auswahlparser und das `[ci] `-Label. `classification.ts` importiert `vitest` und ist für den
   Hauptprozess unerreichbar; der Wächter muss dasselbe Label **lesen**, das jener **schreibt**. Die
   Alternative wäre eine zweite Kopie des Formats gewesen — dieselbe Falle wie F29, siehe Fallstrick 18.

**Zwei Annahmen wurden vorab gemessen, statt sie zu glauben** (beide in einer Wegwerf-Konfiguration,
danach entfernt): dass ein werfender `globalSetup`-Teardown den Exit-Code auf 1 setzt und **nach**
`onFinished` läuft, und dass eine in `globalSetup` gesetzte Env-Variable die geforkten Worker erreicht
(`ppid` des Workers = pid des Hauptprozesses, Variable angekommen). Das Ledger hängt vollständig an der
zweiten.

**Nachweis. Jeder Angriff wurde zuerst am Elternstand `e09b981` wiederholt**, damit der grüne
Ausgangszustand belegt ist und nicht aus dem Befundtext übernommen. Umgebung: Wegwerf-Cluster
PostgreSQL **17.10** (dieselbe Version wie die CI), `OA_TEST_REQUIRE_INFRA=1`.

| Zustand                                           | Elternstand `e09b981`                      | mit `JR-105c`                                                                |
| ------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| legitim                                           | Exit 0, `250 passed \| 2 skipped`          | **Exit 0**, `274 passed \| 2 skipped`, 19 Dateien                            |
| alle 8 Integrationsdateien `ci` → `nightly`       | **Exit 0**, beide Wächter „verified"       | **Exit 1**, `integration: ci 0/55`, Dateien weiter `8/8`                     |
| eine Datei nur `it.skip`                          | (F14 (b), im Befund belegt)                | **Exit 1**, `integration: ci 52/55`, Dateien weiter `8/8`                    |
| `pg-harness.int.test.ts` löschen + Datei addieren | (F15, im Befund belegt)                    | **Exit 1**, `integration: ci 43/55`, Dateien weiter `8/8`                    |
| `throw` im Modul-Scope nach dem `acquire`         | Rückstand lautlos, **keine** Meldung       | **Exit 1**, Datenbank **namentlich** gemeldet, gedroppt, danach 0 Rückstände |
| `pnpm test -t "idempotent"`                       | Exit 0, **6** Datenbanken liegen geblieben | **Exit 0**, 6 gemeldet und gedroppt, danach **0**                            |
| `pnpm test:unit` (`--project`)                    | Exit 0                                     | **Exit 0** plus „verified NOTHING"-Hinweis                                   |
| `pnpm test:nightly`                               | Exit 0                                     | **Exit 0**, `adversarial: … nightly 1/1`, 1 Skip (manual)                    |

Die Umetikettierung deckte zusätzlich **sechs Rückstände** auf, die vorher lokal lautlos geblieben
wären — die skippenden Suiten führen ihr `afterAll` nicht aus. Das ist F16 und F24 in einem Lauf.

**Die CI-Klebeschicht ist in beide Richtungen geprüft:** gegen die grünen Reports Exit 0 („Executed-test
inventory verified for unit, integration, adversarial"), gegen die Messung des `--project`-Laufs Exit 1
(„CI must run an unnarrowed `pnpm test`"), gegen eine fehlende Messdatei Exit 1.

**Eigene Tests für den Wächter:** `packages/backend/tests/unit/executed-tests.test.ts` (15 Fälle) baut
die vier Akzeptanzszenarien als **Daten** und prüft das Urteil, dazu Label-Round-trip, nicht gewählte
Klasse, fehlende Suite, unklassifizierte Tests, unbekanntes Project und die Tabelle selbst;
`harness-ledger.test.ts` (8 Fälle) prüft die Buchführung samt Verweigerung eines Namens, den der Harness
nie erzeugt, und samt truncierten Eintrags. Bewusst **keine** vitest-in-vitest-Kindprozesse: das Urteil
ist genau deshalb eine reine Funktion der Messung. Dass die **Messung** stimmt, ist die andere
Behauptung, und die trägt die Tabelle oben.

**Zwei Dinge über den Umfang hinaus, benannt statt versteckt:** die Dateizahl ist jetzt ebenfalls eine
Gleichheit (F15 hatte genau das vorgeschlagen), und die Ausnahme für verengte Läufe war nicht gefordert
— ohne sie wären `pnpm test:unit` und jeder `-t`-Lauf dauerhaft rot.

**Hygiene:** `pnpm --filter @open-archiver/backend test:types` grün; Prettier für alle 14 berührten
Dateien grün (über die Prettier-API gegen eine LF-Normalisierung in Node geprüft, wegen **F35** nicht
über `pnpm lint`); 0 `oa_test_*`-Rückstände am Ende; der Wegwerf-Cluster ist im Scratchpad und wird
abgebaut.

---

## E13 — IAM-Autorisierung härten (**fertig, abgenommen 2026-07-30 mit `JR-1309c`**)

**Branch:** `claude/journaling-e13-iam-hardening`, abgezweigt vom Integrationsbranch bei `efea6bc`,
**am 2026-07-30 nach der Annahme mit `--no-ff` zurückgemergt** (kein Squash — ein Squash hätte die drei
dokumentierten Ablehnungen getilgt und damit den Beleg, dass die Abnahme funktioniert hat).

**Der Weg dorthin, vier Runden:** `JR-1309` hat E13 am 2026-07-29 abgelehnt (F27, F28, F29), die DEV-Nacharbeit
`JR-1313`–`JR-1315` hat diese drei behoben, und die **erneute Abnahme `JR-1309a` hat E13 am
2026-07-29 wieder abgelehnt**: ein neuer Befund **F30** derselben Klasse eine Ebene tiefer. Alle
anderen 22 geprüften Kriterien sind erfüllt, die Codehälfte ist unabhängig belegt. `JR-1317` hat F30
behoben und den Abdeckungsanspruch der **Abfrage** entfernt (ADR-020) — und die **dritte Abnahme
`JR-1309b` hat E13 am 2026-07-29 zum dritten Mal abgelehnt** (**F31**): der Anspruch war nicht
verschwunden, sondern auf den **Verhaltenscheck** gewandert. 17 von 18 Kriterien erfüllt. `JR-1318` hat
F31 (mit F32–F34) behoben, und die **vierte Abnahme `JR-1309c` hat E13 am 2026-07-30 angenommen**.

> **Diesmal lag die Ursache beim PO, nicht in der Umsetzung.** ADR-020 nannte den Verhaltenscheck selbst
> „vollständig"; `JR-1317` hat den Satz folgerichtig auf die Betreiberseite übernommen. Die ADR ist
> berichtigt („Berichtigung (2026-07-29, nach der Abnahme `JR-1309b` — F31)"), `JR-1318` setzt es um,
> `JR-1309c` prüft es. **Die Abfrageseite von `JR-1317` (a) hält** und ist in `JR-1309b` unabhängig
> belegt — sie wird nicht erneut geprüft.

| Nacharbeit | Task                                                                                     | Rolle |
| ---------- | ---------------------------------------------------------------------------------------- | ----- |
| [x]        | JR-1313 F29 + F26s Schreibseite: ein Prädikat für beide Gates — `cfb1462`                | DEV   |
| [x]        | JR-1314 F27 + F28: Abfragen erweitert **und** Absolutsatz ersetzt — `c17144e`            | DEV   |
| [x]        | JR-1315 F25: Behauptung eingeschränkt **und** F5-Kommentar nachgezogen — `5c8a521`       | DEV   |
| [x]        | JR-1309a Erneute Abnahme E13 — **durchgeführt; Ergebnis: nicht abgenommen (F30)**        | TEST  |
| [x]        | JR-1317 F30: Formbefunde auf Knotenebene **und** Abdeckungsanspruch weg — `07ac661`      | DEV   |
| [x]        | JR-1309b **Schmale** dritte Abnahme — **durchgeführt; Ergebnis: nicht abgenommen (F31)** | TEST  |
| [x]        | JR-1318 F31 (mit F32–F34) — `939df10`, **ohne DEV-Bericht**, PO-Lesart aus dem Diff      | DEV   |
| [x]        | JR-1309c **Noch schmalere** vierte Abnahme — **durchgeführt; Ergebnis: ABGENOMMEN**      | TEST  |

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

### `JR-1312` erledigt (2026-07-30) — Grundlagenarbeit direkt auf dem Integrationsbranch

Die dritte, veraltete Stelle des Berechtigungsvokabulars ist berichtigt
(`docs/services/iam-service/iam-policy.md`): die Action **`export`** fehlte in der Liste, und **`manage`**
war als Aufzählung `create/read/update/delete/search/sync` beschrieben statt als das, was es ist.

**Das Kriterium ist gemessen, nicht behauptet.** Ein Vergleichsskript liest alle drei Stellen — die
Union-Typen aus `iam.types.ts`, die `validActions`/`validSubjects`-Sets aus `policy-validator.ts` und die
zwei Aufzählungen aus der Markdown-Datei — und stellt sie nebeneinander: **8 Actions und 7 Subjects,
Übereinstimmung an allen drei Stellen**, und kein Satz beschreibt `manage` mehr als feste Aufzählung.

**Die drei neu geschriebenen Faktenaussagen sind ebenfalls gemessen** — gegen den **gebauten** Code
(`dist/iam-policy/ability.js`), nicht gegen den Entwurf. Das ist die direkte Lehre aus E13, wo dreimal in
Folge der Defekt in Text saß, der in derselben Runde neu geschrieben wurde:

| Aussage der neuen Doku                             | Messung                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `manage` deckt `export` mit ab                     | `manage all` → `can('export', 'archive')` = **true**                |
| `manage` deckt auch künftige Actions ab            | `manage archive` → `can('teleport', 'archive')` = **true**          |
| `manage` ist keine Aufzählung                      | die explizite Sechserliste → `can('export', 'archive')` = **false** |
| `manage` wirkt nur auf seinem Subject (Gegenprobe) | `manage archive` → `can('export', 'ingestion')` = **false**         |

**Mitgezogen, weil sie sonst widersprüchlich zurückbleiben:** `CLAUDE.md` §5.4 (Überschrift und der
Absatz „(3) is stale") und der Eintrag in `09-befunde-bestandscode.md` unter „Bereits im Backlog erfasste
Bestandsprobleme", der die Sache `JR-1103` zuordnete. **Kein Produktionscode, kein Test, keine Migration.**

### Abnahme `JR-1309c` (2026-07-30) — Ergebnis: **E13 ABGENOMMEN**

**Rolle Tester, Umfang `JR-1307` Kriterium 12 und `JR-1318` (F31 tragend, F32–F34 mit).** Prüfgegenstand
`939df10`. **Ohne DEV-Bericht** — es gab keine Entwicklerbehauptung, die der Prüfer hätte übernehmen
können; jede Zahl stammt aus einem eigenen Lauf. Host war ein **Windows-11-Rechner**, nicht der
Linux-Container der Vorsessions; PostgreSQL **17.10** als Wegwerf-Cluster (dieselbe Version wie die CI).

**Umfang.** `git show --stat 939df10`: **eine** Datei,
`docs/user-guides/upgrade-and-migration/access-control-changes.md`, 79 eingefügt / 45 entfernt — vom PO
unabhängig nachgeprüft. `git log --oneline --name-only 939df10..31bed24` bestätigt, dass die sieben
Commits darüber ausschließlich Planungsdokumente und `.claude/agents/*.md` anfassen, nie die geprüfte
Seite und nie Produktionscode.

| #   | Kriterium                                              | Ergebnis                                                                                                                                                                          |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Anker der Textprüfung neu gesetzt                      | **erfüllt** — vergiftete Wegwerf-Kopie mit dem exakten F31-Satz, Scanner feuert dort (1/7); erst danach der reale Lauf gewertet: **0/7** bekannte Brüche                          |
| 2   | Ganze Seite, nicht nur der Diff                        | **erfüllt** — 675 Zeilen gegen ein breiteres, unkalibriertes Raster; zwei Treffer, beide **Negationen** („neither stands in for the other"), also ADR-020-konform. Kein Neufund   |
| 3   | Beide F31-Hälften getrennt                             | **erfüllt** — Absolutsatz weg **und** dritte Oberfläche benannt (Z. 649). Dritte Zahl **gemessen**: Archiv `read`/`search` bleiben `undefined`, `ingestion/read` kippt auf `"-1"` |
| 4   | Die fünf neuen Faktenaussagen von `JR-1318`            | **erfüllt** — alle fünf einzeln mit Fixture-Rollen gegen die **wörtlich aus der `.md` extrahierte** Query 2 gemessen (Belege unten)                                               |
| 5   | Umfang, Volllauf, `lint`, `docs:build`, Blob-Identität | **erfüllt** — `250 passed \| 2 skipped` bei **17** Dateien, Exit 0; Sonde entfernt; `docs:build` Exit 0, kein `dist/dev/`; `FilterBuilder.ts`/`mongoToMeli.ts` blob-identisch     |

**Die fünf Faktenaussagen im Einzelnen**, jede gegen echtes Postgres gefahren:

- **(a)** Der Befund „archive search granted without archive read" nennt **keine** Regelnummer — die
  Ausgabe enthält keine Ziffer.
- **(b)** F33s Aufteilung stimmt: eine verunstaltete Aktion mit Skalar-`conditions` erzeugt **keine**
  Zeile (verloren), dieselbe Aktion mit `$regex` **erscheint** (kommt an, weil aus der Regel statt aus
  dem Paar gelesen). Zusatzprobe: ein blanker Skalar an Stelle einer Regel **stoppt die Abfrage nicht**,
  die folgende Regel wird korrekt als „#2" gezählt.
- **(c)** F32 „finds all five": alle fünf Nicht-Array-Formen von `policies` (Objekt, String, Zahl,
  Boolean, `null`) kommen zurück. Die zitierten Fehlertexte sind real geprüft — Objekt →
  `cannot extract elements from an object`, Zahl → `cannot extract elements from a scalar`.
- **(d)** F34 „just as readily": alle vier Formen **innerhalb** eines wertseitigen `$in` werden gemeldet.
- **(e)** Eine reine `cannot`-Regel mit `action: 'manage'`, `subject: 'all'` erzeugt **je drei** Zeilen —
  eine pro (`read archive`, `search archive`, `read ingestion`).

**Aufräumen:** alle Wegwerf-Datenbanken gelöscht, 0 `oa_test_*`/`oa_probe_*` übrig, Arbeitsbaum leer,
kein Produktionscode und kein Planungsdokument vom Prüfer angefasst.

> **Der eine Vorbehalt des Prüfberichts ist widerlegt — vom PO nachgemessen.** Der Bericht meldete einen
> neuen niedrigen Befund („F36"): eine Prettier-Warnung an der geprüften Seite, die angeblich **auch nach**
> CRLF→LF-Normalisierung bestehen bleibt und von einem tab-eingerückten JSON-Block herrühre. Beides ist
> falsch. `.prettierrc` setzt **`useTabs: true`** — die Tabs sind vorgeschrieben, nicht fehlerhaft. Und
> die Normalisierung hält der Gegenprobe nicht stand: eine LF-Kopie derselben Datei ist `prettier --check`
> **grün (Exit 0)**, die CRLF-Kopie rot, und die Prettier-API liefert nach CRLF-Normalisierung **0**
> abweichende Zeilen bei 675. Die Warnung ist damit **reines F35** und kein zusätzlicher Defekt. Geführt
> als **F36 (widerlegt)** in `09-befunde-bestandscode.md`, damit die nächste Session denselben Kandidaten
> nicht erneut für echt hält. **Das Verdikt ändert sich dadurch nicht — es verliert nur seine Einschränkung.**

### E13 — `JR-1318` committet (2026-07-29, Rolle `senior-dev`) — **ohne DEV-Bericht**, Abnahme offen

**Commit `939df10`** („docs(upgrade): let each check report its own surfaces, and no more"), **eine**
Datei: `docs/user-guides/upgrade-and-migration/access-control-changes.md`, 79 Zeilen ergänzt / 45
entfernt. `git show --stat` bestätigt den Umfang; die temporäre Messsonde
`packages/backend/tests/integration/f31-third-number.int.test.ts` ist aus dem Arbeitsbaum entfernt.

> **Es liegt kein Bericht der Rolle `senior-dev` vor.** Der Agent hat sich zweimal als verfügbar
> gemeldet, ohne die Nacharbeit zu berichten; eine ausdrückliche Nachforderung blieb unbeantwortet.
> **Alles unten ist die Lesart des PO aus dem Diff, nicht gemessen** — insbesondere fehlen der Nachweis
> über `FilterBuilder.create` für die dritte Zahl, die Ergebnisse von `lint`/`docs:build`/`dist/dev` und
> die Angabe, wie der Autor seinen eigenen neuen Text gegen ADR-020 geprüft hat. `JR-1309c` muss deshalb
> **alles selbst messen** und darf nichts übernehmen. Das ist für diese Runde eher ein Vorteil: es gibt
> keine Behauptung, die ein Prüfer versehentlich durchwinken könnte.

**Was der Diff zeigt (PO-Lesart, zu verifizieren):**

| Befund  | Umsetzung im Diff                                                                                                                                                                                                                                                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F31** | Die **dritte Zahl** ist aufgenommen: „rows the archive list returns, the result count of one search, and how many entries the ingestion sources list shows. **All three, because they are filtered separately and can move separately**"                                                                                                             |
| **F31** | Der Absolutsatz ist durch sein **Gegenteil** ersetzt und nennt den F31-Fall als Warnung: „**Do not read one number for another**: a role with archive grants whose only statement about ingestion sources is a prohibition — the shape change 1 describes — keeps both archive numbers and loses the ingestion sources list entirely"                |
| **F31** | Neuer Abschnitt **„What this check does not show you"**: „Three unchanged numbers are three unchanged numbers. That is what was measured, and **it is not a verdict on the role**", dazu vier benannte unsichtbare Fälle und „a moved number does not name its own cause"                                                                            |
| **F31** | Die Bürgschaft ist in **beiden** Richtungen negiert: „neither stands in for the other: each reports what it can measure and says what it cannot" · „is worth running for that reason, **not because it stands in for this list**" · „**neither result excuses you from the other**"                                                                  |
| **F32** | Beide Fehlertexte genannt (`an object` für ein Objekt, `a scalar` für String/Zahl/Boolean/JSON-`null`), Heilmittel „**which finds all five**"                                                                                                                                                                                                        |
| **F33** | „reported **in part**" mit Angabe, welche Befunde verloren gehen (die drei bedingungsfreien und der für ein nicht-objektartiges `conditions`) und welche ankommen (die aus dem `conditions`, „because those are read from the rule rather than from the pair"); die bare Skalar-Regel bleibt „skipped without a row, and without stopping the query" |
| **F34** | „That is **a class of position rather than a single case**", mit der Erweiterung, dass ein Operatorname, ein Condition-Key oder ein leeres `$or` an derselben wertseitigen Stelle „just as readily" gemeldet wird                                                                                                                                    |

**Der Verhaltenscheck nennt seinen Umfang jetzt selbst:** „What it measures are **the three surfaces the
application builds a row filter for** — the same three the row-level findings of Query 2 are limited to —
and nothing besides them." Damit ist die Konstruktion aus ADR-020s Berichtigung umgesetzt: jedes
Verfahren benennt, was es messen kann, und keines bürgt für das andere.

**Fünf neue Faktenaussagen sind mit dem Fix entstanden und sind ungeprüft** — sie sind präziser als der
alte Text und deshalb leichter falsch. `JR-1309c` muss jede einzeln nachmessen: dass der Befund „archive
search granted without archive read" **keine** Regelnummer nennt; die F33-Aufteilung in verlorene und
ankommende Befunde inklusive „names the rule number with no action or subject beside it"; F32s „finds all
five"; F34s „just as readily"; und dass `manage` sowie `subject: "all"` gegen **jede** der drei
Berechtigungen gematcht werden.

### Abnahme `JR-1309b` (2026-07-29) — Ergebnis: **E13 zum dritten Mal nicht abgenommen**

Unabhängige Session, Rolle `tester`, HEAD `2a4ea80`, **schmaler Umfang**: `JR-1307`s Kriterium 12 und die
Kriterien von `JR-1317`, nicht die 23 Kriterien von `JR-1309a` erneut. 18 Kriterien einzeln,
**17 erfüllt**.

**Gebrochen ist Kriterium 12 — die Textprüfung gegen ADR-020. Neuer Befund F31**, dieselbe Klasse wie
F27 und F30. Der Absolutsatz ist nicht verschwunden, sondern von der Abfrage in den **Verhaltenscheck**
gewandert, den `JR-1317` neu geschrieben hat. Details in `09-befunde-bestandscode.md` unter **F31**, die
Ursachenanalyse in ADR-020s Berichtigung. Drei weitere niedrige Befunde: **F32**, **F33**, **F34**.

**Die Abfrageseite von `JR-1317` (a) ist unabhängig belegt und in Ordnung** — das ist der Teil, den
`JR-1309a` als gebrochen gemeldet hatte:

| Kriterium                                                         | Beleg                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Blöcke **wörtlich** aus der `.md` (Fallstrick 17)                 | `fenced blocks total: 5 (json, bash, sql, sql, sql)` · `sql blocks: 3` · `query1.sql` Zeilen 205–209 / 115 B / `sha256=d17c3469…` · `query2.sql` Zeilen 234–450 / 9843 B / `sha256=d9a3542f…` · `query3.sql` Zeilen 542–613 / 2997 B / `sha256=0afb4a14…`                                                          |
| psql-Meta-Befehle in den Blöcken                                  | `0` in allen fünf Fences (Muster `^\s*\\[a-zA-Z?!]`) — es ist nichts psql-Spezifisches im Spiel                                                                                                                                                                                                                    |
| **Alle acht** F30-Formen gemeldet, je mit Position                | 8 × `REPORTED`, u. a. `[empty condition object] rule #1: "conditions" -> "$not" is {}` · `[condition node is not an object] … the body of "conditions" -> "$not" is 5` · `"conditions" -> "$or" -> [] -> "$and" -> [] is {}` · `a branch of "conditions" -> "$or" is 5`                                            |
| Gegenproben und die Wurzelformen aus `JR-1314`                    | 15 Gegenproben, alle `REPORTED`: `condition branch list is empty` für `{"$or": []}`/`{"$and": []}`; die 9 Wurzelwerte je 2 Zeilen `conditions is not an object` **mit der richtigen der zwei Lesarten**; `{}` an der Wurzel; `attachment.name`; `$regex`; `{"$or": 5}` als `condition branch list is not an array` |
| **Keine Falsch-positiven** (der Hauptrisikopunkt)                 | 18 Kontrollen `silent OK` in **allen drei** Ausgaben — die drei `predefined_*` wörtlich aus dem Produktionscode (`UserService.ts:259–274`, `iam.controller.ts:108–146`) plus 15 normale Formen inkl. F4-Form, F5-Form, tief verschachtelt, `$exists:false`, „Regel ist kein Objekt"                                |
| Fallstrick 20 vermieden                                           | `jsonb_typeof(b.value) <> 'object'` steht nur unter `c.key IN ('$or','$and')` bzw. `c.key = '$not'` — geprüft wird nur ein Knoten in **struktureller** Position                                                                                                                                                    |
| `cannot` mit Operator-Bedingung ⇒ genau **eine** Zeile            | `-> 1 row(s)`: `[prohibition with an operator condition] rule #2 uses the operator $ne inside a "cannot" condition` — kein Formbefund daneben (Änderung 5, beabsichtigt)                                                                                                                                           |
| Kreuzvergleich gegen den **echten** Übersetzer                    | 42 Bedingungswerte durch `dist/helpers/mongoToDrizzle.js` gegen die Q2-Ausgabe: **`false negatives (refused but silent): 0`**, `over-reports (accepted but reported): 1` — und das ist die dokumentierte Übermeldung                                                                                               |
| Bewusste Abweichung 1 (`conditions: 5` ohne Zeilenfilter)         | `DEV-1 … (dashboard) -> 0 row(s) in Q2` — wie dokumentiert, kein Befund                                                                                                                                                                                                                                            |
| Bewusste Abweichung 2 (`{"id":{"$in":[{}]}}`)                     | `-> 1 row(s)`: `[empty condition object] rule #1: "conditions" -> "id" -> "$in" -> [] is {}` — Übermeldung mit Position, wie dokumentiert                                                                                                                                                                          |
| F28 unberührt                                                     | Q3 zwei Zeilen, `key=userEmial` → `archived_emails.user_emial` **und** `ingestion_sources.user_emial`                                                                                                                                                                                                              |
| Query 1 funktioniert weiter                                       | `{"email":"no-role@example.com"}` — der Nutzer **mit** Rolle erscheint nicht                                                                                                                                                                                                                                       |
| Volllauf, Exit 0, zitierte Testzahl                               | `Test Files 17 passed (17)` · `Tests 250 passed \| 2 skipped (252)` · `Duration 19.72s` · `TEST_EXIT=0`                                                                                                                                                                                                            |
| Die 2 Skips identifiziert                                         | `SKIPPED SUITE [nightly] mongoToDrizzle() adversarial -- 25000 seeded trees` · `SKIPPED SUITE [manual] … 30000 ms soak`, beide in `tests/adversarial/mongo-to-drizzle.adv.test.ts`                                                                                                                                 |
| `predefined-roles.int.test.ts` 7/7                                | `✓ integration … predefined-roles.int.test.ts (7 tests) 2255ms`, 0 Fehler                                                                                                                                                                                                                                          |
| `FilterBuilder.ts` / `mongoToMeli.ts` blob-identisch zu `13a7114` | `f7efead24dc7935b67d5cb68210a4496f71dfe0d` bzw. `9e1ba29fefb11c536678c69441d3420e4ff025af`, je in beiden Revisionen                                                                                                                                                                                                |
| Keine Rückstände                                                  | `git status --short` leer · `oa_test_* databases: 0` nach jeder Probe und nach der Suite                                                                                                                                                                                                                           |

**Kriterium 13 (`JR-1307`s Kriterium 12) ist auf der Abfrageseite erfüllt und im selben Dokument wieder
entwertet:** Query 2 meldet alle acht F30-Formen **und** die F31-Rolle korrekt
(`prohibition without a matching grant: read ingestion is forbidden by rule #2, but no rule grants it`) —
die Seite sagt dem Betreiber aber, er dürfe genau diese Meldung verwerfen. Deshalb bricht F31 dieses
Kriterium, obwohl die SQL stimmt.

**Umgebung dieser Abnahme — sie unterscheidet sich von allen vorherigen.** Windows-11-Host statt
Linux-Container. PostgreSQL **17.10** (`on x86_64-windows, compiled by msvc-19.44.35226`), Wegwerf-Cluster
aus `@embedded-postgres/windows-x64@17.10.0-beta.17` im Scratchpad — keine Systeminstallation, kein
Docker, kein Dienst. **41 Migrationen / 141 Statements** direkt aus `src/database/migrations` in
Journal-Reihenfolge, 22 Tabellen in `public`. `corepack pnpm` 10.13.1 (pnpm ist nicht im PATH),
Node 24.14.0. **`psql.exe` fehlt** in der Windows-Binärdistribution — die SQL-Blöcke liefen über einen
Node-`postgres`-Client.

**Was in dieser Umgebung nicht prüfbar war:**

- **Der Remote-Abgleich.** `git ls-remote origin refs/heads/claude/journaling-e13-iam-hardening` →
  `fatal: Could not read from remote repository. Please make sure you have the correct access rights`
  (dritter erfolgloser Versuch der Session). `HEAD` = `2a4ea80` = lokale `origin/…`-Ref und deckt sich mit
  dem Handover; dass der Remote denselben Stand trägt, ist **unbestätigt**. Entscheidung des
  Auftraggebers: auf dem lokalen Stand arbeiten, **kein Push vor dem Abgleich**.
- **`psql` selbst.** Die Blöcke enthalten keine Meta-Befehle, es ist also nichts psql-Spezifisches im
  Spiel — dass psql zeichengleich ausgibt, ist aber nicht gemessen (`JR-1309a` hatte das auf 16.13/17.10
  getan).
- **Die Vor-E13-Hälfte von F31.** Gemessen ist nur `HEAD`. Dass dieselbe Rolle vor dem Update alle
  Ingestion-Quellen sah, steht in Änderung 1 der Seite und ist durch die E13-Regressionssuite belegt,
  wurde hier aber nicht gegen den `FilterBuilder` von `efea6bc` nachgemessen. Der Befund hängt nicht
  daran — er betrifft die **Vollständigkeit der zwei vorgeschriebenen Zahlen**, und die ist aus der Seite
  selbst belegt.
- **Die 7 Fälle von `predefined-roles.int.test.ts`** sind auf Dateiebene grün, nicht einzeln über einen
  JSON-Report ausgewiesen.
- **Meilisearch, Redis, Tika, Docker** fehlen; für diesen Umfang nicht gebraucht.

**Kein Produktionscode, kein Test, keine öffentliche Doku geändert.** Proben nur im Scratchpad.
Zwei unversionierte Dateien mit kaputten Namen (Shell-Quoting-Reste aus der Umgebungsprüfung dieser
Session, 0 B bzw. `---`) lagen im Repository-Wurzelverzeichnis und sind entfernt. Neu auf der Platte,
`.gitignore`-gedeckt: `packages/backend/dist`, `packages/types/dist` (für den Übersetzer-Kreuzvergleich
gebaut). Der Cluster läuft weiter, auf Anweisung des PO.

> **Fallstrick für Folge-Sessions (kein Produktbefund).** `postgres.js` serialisiert einen an einen
> `jsonb`-Parameter gebundenen JS-Wert **selbst**. Ein vorher mit `JSON.stringify` erzeugter String wird
> damit doppelt kodiert und landet als jsonb-_String_ in `roles.policies`; Query 2 **und** Query 3 brechen
> dann bei **jeder** Rolle mit `cannot extract elements from a scalar` ab — was exakt wie ein
> Abfragedefekt aussieht und in dieser Abnahme eine Diagnoserunde gekostet hat. Richtig: Bindung als
> `$3::text::jsonb` **plus** Selbstprüfung `jsonb_typeof(policies) = 'array'` direkt nach dem Insert.
> Ohne die Selbstprüfung kommt derselbe Fehler still wieder.

> **Zweiter Fallstrick, gefährlicher als der erste: eine Textprüfung gegen diese Seite ist fail-open,
> wenn sie den Whitespace nicht normalisiert.** Die Prosa in `access-control-changes.md` ist **hart
> umbrochen**; der F31-Satz steht über zwei Zeilen (`… unchanged is\n not affected …`). Das erste Muster
> des Prüfers enthielt dort ein einfaches Leerzeichen und meldete deshalb
> `still carries the F31 absolute: false` — **das Werkzeug erklärte den bekannten Defekt für behoben.**
> Aufgefallen ist es nur, weil beide Werkzeuge gegen den **noch unbehobenen** Stand kalibriert wurden
> (`KNOWN BREAK 2`, Selbsttest `F31 sentence still present: true` / `scanner flags it: true`). Das ist
> dieselbe Fehlerklasse wie „ein Test, der nie rot war, belegt nichts", eine Ebene höher: nicht der
> Prüfgegenstand war fail-open, sondern die **Prüfung**. Jede künftige Textzusicherung gegen diese Datei
> normalisiert zuerst den Whitespace und weist einen Selbsttest gegen den Vor-Fix-Stand aus.
>
> **Verallgemeinert und in `.claude/agents/tester.md` aufgenommen** („Calibrate every negative finding"):
> die Fehlerklasse ist nicht „hart umbrochene Prosa", sondern **ein Negativbefund ohne Kalibrierung**.
> „Ich habe nichts gefunden" ist erst ein Ergebnis, wenn dasselbe Werkzeug den bekannten Fall findet.
> Daraus folgt eine zweite Regel, die in `JR-1309c` greift: **entfernt der Fix genau den Satz, an dem der
> Selbsttest hängt, verliert die Prüfung ihren Anker** und ein sauberer Lauf belegt wieder nichts. Dann
> ist der Anker neu zu setzen — Wegwerf-Kopie des behobenen Artefakts, den Fall absichtlich wieder
> einsetzen, zeigen dass das Werkzeug ihn noch meldet.

### E13 — `JR-1317` erledigt (2026-07-29, Rolle `senior-dev`) — F30 behoben, ADR-020 umgesetzt

**Eine Datei geändert:** `docs/user-guides/upgrade-and-migration/access-control-changes.md`
(`07ac661`). **Kein Produktionscode, kein Test, keine Migration, kein i18n-Key.**
`packages/backend/src/helpers/conditionKey.ts` war die **Referenz**, aus der die Abfragebedingungen
abgeleitet sind, und ist nicht angefasst.

#### (a) Die zwei Formbefunde stehen auf Knotenebene

`cond` trägt jetzt eine Spalte `path` (Wurzel `"conditions"`, Objektkind `-> "key"`, Arrayelement
`-> []`), damit jede Meldung die **Position** nennt. Die Prädikate sind aus `checkConditionsShape()` und
den Rekursionsstellen in `mongoToDrizzle` abgeleitet:

| Befundtyp                               | Woraus                                                                     | Prädikat                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `empty condition object`                | `cond` (ersetzt den Wurzel-Befundtyp `empty conditions object` aus `pair`) | `c.node = '{}'::jsonb` — **jede** Position                                            |
| `condition node is not an object`       | `cond`                                                                     | Element eines `$or`/`$and`-Arrays bzw. Rumpf eines `$not`, `jsonb_typeof <> 'object'` |
| `condition branch list is not an array` | `cond`                                                                     | `$or`/`$and`, dessen Wert kein Array ist                                              |
| `conditions is not an object`           | `pair` — **unverändert**                                                   | Wurzelvergleich, mit den zwei Lesarten je Wert                                        |

**Der Fallstrick, bewusst umgangen:** ein pauschales `jsonb_typeof(c.node) <> 'object'` hätte **jedes
Blatt** jeder normalen Bedingung gemeldet (Fallstrick 20). Geprüft wird nur ein Knoten, der als
Bedingungsobjekt gelesen wird — die Elemente einer Operandenliste (`$in`) sind Werte und bleiben außen
vor.

#### Nachweis 1 — die acht F30-Formen werden gemeldet

Blöcke mit einem Skript aus der `.md` **extrahiert und wörtlich** gefahren (Fallstrick 17), PostgreSQL
16.13 ohne Docker (Fallstrick 8), alle 41 Migrationen per `psql -f`, 26 gesäte Rollen:

```
python3 extract.py docs/user-guides/upgrade-and-migration/access-control-changes.md ./sql
psql -v ON_ERROR_STOP=1 -d oa_probe_final -f ./sql/query2.sql
```

```
 F30-1 not-empty-object        | empty condition object          | rule #1: "conditions" -> "$not" is {}, which states no condition …
 F30-2 not-scalar              | condition node is not an object | rule #1: the body of "conditions" -> "$not" is 5, not an object of condition keys
 F30-3 or-and-empty-branch     | empty condition object          | rule #1: "conditions" -> "$or" -> [] -> "$and" -> [] is {} …
 F30-4 cannot-key-empty-object | empty condition object          | rule #2: "conditions" -> "userEmail" is {} …
 F30-5 or-scalar-branch        | condition node is not an object | rule #1: a branch of "conditions" -> "$or" is 5, not an object of condition keys
 F30-6 or-empty-first          | empty condition object          | rule #1: "conditions" -> "$or" -> [] is {} …
 F30-7 or-empty-last           | empty condition object          | rule #1: "conditions" -> "$or" -> [] is {} …
 F30-8 and-empty-last          | empty condition object          | rule #1: "conditions" -> "$and" -> [] is {} …
```

**Gegenproben im selben Lauf, alle weiter gemeldet:** `{"$or": []}` und `{"$and": []}`
(`condition branch list is empty`), `conditions: 5` (`conditions is not an object`, mit der richtigen
Lesart, je Paar eine Zeile), `conditions: {}` an der Wurzel, `attachment.name` flach und in einem
`$or`-Zweig. Query 1 → 0 Zeilen, Query 2 → 16, Query 3 → 0, Exit 0.

**Zusätzliche Formen derselben Klasse, in einem zweiten Lauf gemessen** (nicht in F30 aufgeführt, vom
Übersetzer aber ebenfalls verweigert): `{"$or": 5}`, `{"$or": {…}}`, `{"$and": {}}` ⇒
`condition branch list is not an array`; `{"$not": []}`, `{"$or": [{…}, null]}`, `{"$or": [{…}, []]}`,
`{"$or": [{…}, ["x"]]}` ⇒ `condition node is not an object`. Query 3 findet den Tippfehler-Key unter
`manage all` weiter (F28 unberührt, zwei Zeilen).

#### Nachweis 2 — keine Falsch-positiven (der Hauptrisikopunkt)

Maschinell verglichen, nicht gelesen: die Namensspalte von Query 2 gegen die Sollmenge.

```
=== must stay silent: predefined_* + OK-* controls ===
silent OK  Super Admin | End user | Read only
silent OK  OK-1 {"userEmail":"a@x"}            OK-5 $or aus zwei Objekten
silent OK  OK-2 {"id":{"$in":[…]}}             OK-6 $and mit verschachteltem $or
silent OK  OK-3 {"ingestionSource.userId":…}   OK-7 cannot mit $not um eine Gleichheit
silent OK  OK-4 can mit {"$ne":…}              OK-8 unbedingter Grant + read ingestion
=== must be reported: F30-* + CTR-* ===   reported OK  14 / 14
```

Alle drei Abfragen: **0 Zeilen** für diese elf Rollen. Eine `cannot`-Regel mit Operator-Bedingung
liefert genau die **beabsichtigte** Zeile `prohibition with an operator condition` (Änderung 5) und
**keinen** Formbefund. Weitere Formen, die schweigen: `{"$and":[{"$or":[{"$not":{…}}]}]}`,
`{"id":{"$in":[…,"x",5]}}`, eine Regel, die selbst kein Objekt ist.

#### Gegen den Übersetzer gekreuzt (Fallstrick 15)

37 Bedingungswerte durch `dist/helpers/mongoToDrizzle.js` und daneben die Q2-Ausgabe gestellt:
**verweigert ⇒ gemeldet** und **übersetzbar ⇒ still**, mit genau zwei benannten, bewussten Abweichungen:

| Form                                   | Übersetzer   | Q2                 | warum das richtig ist                                                                                                                                       |
| -------------------------------------- | ------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conditions: 5` an `can read settings` | `REFUSED`    | **nicht gemeldet** | für `settings` wird **kein** Zeilenfilter gebaut, es ändert sich nichts. Der Wurzelbefund bleibt an `pair` gebunden — die Seite sagt das jetzt ausdrücklich |
| `{"id": {"$in": [{}]}}`                | `TRANSLATES` | **gemeldet**       | leeres Objekt in einer **Operandenliste**. Übermeldung, nicht Untermeldung; die Position steht in der Meldung                                               |

#### (b) Der Abdeckungsanspruch ist weg — der eigentliche Fix

| Vorher                                                                           | Jetzt                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| „**It examines:** … walked **recursively** … **the empty object**"               | „**What it reports:**" — Aufzählung der Befundtypen; kein „recursively" als Zusage                                                                                                                                                                                                      |
| „the values inside a condition … **not one this release changes**"               | ein Wert, der selbst eine **Struktur** ist, ändert die Wirkung und wird als Formbefund gemeldet; nur ein **skalarer** Wert nicht                                                                                                                                                        |
| „No rows means the query found none of the shapes it looks for"                  | „**cannot be shown to be complete** … Read an empty result as an indication, **not as a clearance**"                                                                                                                                                                                    |
| „lists **every** shape of policy this affects"                                   | „describes the shapes … plus a behaviour check that does not depend on the shapes at all"                                                                                                                                                                                               |
| „to **find out which** of your roles behave differently"                         | „to **look for** the roles that behave differently"                                                                                                                                                                                                                                     |
| „the third query below is what **covers** this case" / „Query 3 **covers** that" | je „**looks for**", mit dem Zusatz „for the subjects it can resolve"                                                                                                                                                                                                                    |
| „Log in as a user of each role you changed" (ein Satz)                           | **verifizierbare Gegenprobe in drei Schritten** ohne Formliste: zwei Zahlen je Rolle vorher notieren, nachher (oder auf einer Kopie) erneut messen, vergleichen — plus der Hinweis, dass eine unübersetzbare Bedingung jetzt einen **Fehler** erzeugt statt still ein falsches Ergebnis |

**Neu gesagt, weil es vorher offenblieb:** der Wurzel-Formbefund ist an (Action, Subject) gebunden, die
Befunde **innerhalb** von `conditions` nicht; die Formprüfung beim Speichern (`400`) gilt nur für das
`conditions` der Regel selbst — ein verschachtelter Formfehler fällt erst zur Abfragezeit auf (am Code
geprüft: `PolicyValidator` ruft `checkConditionsShape()` nur auf der Wurzel, `areConditionKeysValid()`
prüft darunter nur Keys); ein Array-`conditions` wird gemeldet, aber **nicht betreten** (gemessen:
`conditions: [{"$or": []}]` ⇒ zwei Zeilen `conditions is not an object`, kein Zweigbefund).

#### Grüne Läufe

```
pnpm lint                                            → All matched files use Prettier code style!
pnpm --filter @open-archiver/backend test:types      → Exit 0
pnpm --filter @open-archiver/backend build           → Exit 0
pnpm docs:build                                      → build complete, Exit 0; docs/.vitepress/dist/dev fehlt weiterhin
DATABASE_URL=… OA_TEST_REQUIRE_INFRA=1 pnpm test     → Test Files 17 passed (17) · Tests 250 passed | 2 skipped (252) · EXIT=0
```

Die zwei neuen Ankerverweise sind im **gebauten** HTML aufgelöst (`id="how-to-read-an-empty-result"`,
`id="after-the-upgrade"` vorhanden, drei bzw. zwei `href`-Vorkommen). Suchindex ohne `dev/`-Pfad.
Proben liefen ausschließlich in `/var/tmp` und im Scratchpad, **nicht** im Repository; nach dem
Volllauf **0** `oa_test_*`-Rückstände, Cluster und Prüfdatenbanken restlos entfernt.

**Nicht angefasst, bewusst:** `FilterBuilder.ts`, `mongoToMeli.ts`, `conditionKey.ts`, die Laufzeitseite
von F26 (bleibt `JR-1311`), `JR-1310`/`JR-1311`/`JR-1312`/`JR-1316`.

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

| ADR         | Thema                                                                                                                    | Epic            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ | --------------- |
| ADR-016     | fail-closed rechtfertigt den Verhaltensbruch aus F7                                                                      | E13 (`JR-1307`) |
| ADR-006     | Kanonische Kodierung, Genesis-String, `deployment_id` — **jetzt auch `chain_scope_id` im Genesis** (Vorgabe aus ADR-007) | E2 (`JR-203`)   |
| ~~ADR-007~~ | **Entschieden 2026-07-31: eine Kette je Mandant, `chain_scope_id` = `ingestion_sources.id`**                             | E2              |
| ADR-009     | Append-Only-Erzwingung: Rechteentzug oder Trigger                                                                        | E2 (`JR-205`)   |
| ADR-010     | `processEmail` erweitern oder eigener Journaling-Pfad                                                                    | E6 (`JR-602`)   |
| ADR-008     | TSA-Ausfallverhalten bestätigen                                                                                          | E8 (`JR-804`)   |
| ADR-012     | Migrationspfad für Bestandsinstallationen                                                                                | E12             |

---

## Sessionprotokoll

| Datum           | Ergebnis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Nächster Schritt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 2026-07-27      | E0 abgeschlossen: Gap-Analyse, Architektur, Backlog (102 Tasks), Testplan, ADR-Log, `CLAUDE.md`, 2 Subagents, 3 Skills. Kein Produktionscode (ADR-001).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | E1 starten mit `JR-101`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-07-27      | Nachtrag: ADR-004 als falsch korrigiert und Veröffentlichungs-Leck via `srcExclude` geschlossen; ADR-014 (Branch-Strategie) ergänzt; `CLAUDE.md` §7 und Handover um Sessionstart-Anleitung erweitert. Build-Nachweis offen (kein `pnpm install` möglich).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `claude/journaling-e1-test-foundation` abzweigen, dann `JR-101`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-07-27      | `JR-105a` erledigt auf `claude/journaling-e1-test-foundation`: 7 handgeschriebene Dateien formatiert, 6 generierte per ADR-015 in `.prettierignore`. `pnpm lint` repo-weit grün und bleibt es nach beiden Generatorläufen. Kein Push (sammelt bis Ende E1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `JR-101` (vitest einrichten), danach `JR-105` (CI-Workflow)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-07-27      | `JR-101`/`JR-102`/`JR-103` erledigt: vitest 3.2 mit drei Projects (`unit`/`integration`/`adversarial`), Harness in `tests/support/` (Klassifizierung, Seeds, Infra-Probe, Coverage-Hinweise), 146 Testfälle grün, Exit-Code beider Richtungen aktiv verifiziert, Fixture-Ladung durch Umbenennen belegt. Sechs IAM-Befunde (F1–F6) an DEV gemeldet, keiner behoben. Kein Push.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `JR-104` (isolierte Postgres-Basis), danach `JR-105` (CI-Workflow)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-07-28      | `JR-104` **geschrieben, Abnahme offen**: `pg-harness` mit eigener Datenbank je Aufruf (Schema-Isolation scheitert an `"public"`-qualifizierten Migrationen), Migrationen über `drizzle-orm/postgres-js/migrator`, garantiertes Teardown plus Sweeper. Lokaler PostgreSQL-16.13-Cluster aus den vorinstallierten Binaries gestartet: 32 Integrationstests grün, `pnpm test` 181 grün, zwei parallele Läufe gleichzeitig grün, 0 Rückstände. Vier neue Befunde F7–F10 (F7 hoch: `FilterBuilder` fail-open) plus F4-Nachtrag. Kein Push.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `JR-105` (CI-Workflow mit `postgres:17-alpine`), danach `JR-106` (Abnahme E1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-07-28      | `JR-105` **erledigt, CI-Lauf grün**: `.github/workflows/ci.yml` (Job `verify`, Trigger `pull_request` + `push`, Node 22 / pnpm 10.13.1 aus `engines`/`packageManager`, pnpm-Store gecacht), reiner Prüf-Workflow (kein `format`, kein Auto-Fix, kein Commit, Log nach `$RUNNER_TEMP`, `permissions: contents: read`), `postgres:17-alpine` als Service-Container, zwei Nachlaufprüfungen (übersprungene `integration`-Suite und `oa_test_*`-Rückstände machen den Job rot; beide in beide Richtungen gegengeprüft). Lauf 1 fand **F11**: die vorgegebene Schrittfolge ist auf einem frischen Checkout nicht lauffähig, weil `@open-archiver/types` über das gitignorierte `dist` auflöst — 54 × `TS2307`. Behoben durch einen vorgeschalteten `pnpm --filter @open-archiver/types build`; lokal beidseitig reproduziert. Lauf 3 (`1bad10c`) grün: PostgreSQL 17.10, 181 Tests, `integration` sichtbar gelaufen, 0 Rückstände. Bestehende vier Workflows unverändert.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `JR-106` (Abnahme E1): `JR-104` und `JR-105` vorlegen — deren CI-Bedingung ist erfüllt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-07-28      | `JR-106` (Abnahme E1) **durchgeführt, Ergebnis: E1 nicht abgenommen.** 15 Kriterien einzeln gegen `03-backlog.md` geprüft, 14 erfüllt: `JR-101`, `JR-102`, `JR-103`, `JR-105a` und `JR-105` abgenommen. `JR-104` **abgelehnt** — neuer Befund **F12**: der Test `sweeps a stale database…` legt seine Fixture-DB unter dem festen Namen `oa_test_1609459200000_999999_deadaa_sweeptest` an, zwei gleichzeitige Läufe gegen dasselbe Postgres kollidieren daher reproduzierbar (4/4) mit `duplicate key … pg_database_datname_index`; der bisherige Nachweis „zwei Läufe gleichzeitig grün" ist widerlegt. CI unberührt (eigener Service-Container je Job) und weiterhin grün. Zusätzlich belegt: die grün aussehende Fehlerform ohne `DATABASE_URL` (Exit 0 bei „149 passed \| 34 skipped") wird von Nachlaufprüfung 1 in allen drei Nichtverfügbarkeits-Modi rot gemacht, legitime `nightly`/`manual`-Skips lösen sie nicht aus; zwei Lücken derselben Prüfung gefunden (abwesende statt übersprungene Suite; falsch benannte `*.test.ts` unter `tests/integration/` wird von keinem Project eingesammelt). Kein Produktionscode geändert, kein Befund behoben. Dokumentenhygiene: **F11 nach `09-befunde-bestandscode.md` verschoben**, F-Nummerierung liegt jetzt in einer Datei.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Entscheidung des Auftraggebers zu **F12**; danach Nacharbeit `JR-104`, erneute Teilabnahme, dann `JR-1301`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-07-28      | `JR-104a` und `JR-105b` **erledigt** (Nacharbeit aus der Ablehnung von E1). **F12 behoben**, dreiteilig: prozessspezifische Fixture-Namen über `buildForeignFixtureName()`, `sweepStaleHarnessDatabases({ staleMs, restrictTo })` mit SQL-seitiger Einschränkung und konstruktiver Verweigerung eines gesenkten Schwellwerts ohne `restrictTo`, plus Fixture-Alter unter die Standardfrist gezogen (der 2021er Zeitstempel war ein drittes, in der Abnahme nicht genanntes Teilproblem). Reproduktion vorher 3/3 rot, dabei der bis dahin nur hergeleitete zweite Pfad **beobachtet** (ein Lauf verlor seine eigene Datenbank an den Sweeper des anderen). Nachher: **5 Doppelläufe grün**, plus 3 Tripel- und 3 versetzte Runden, 0 Rückstände, keine Runde unsauber. `JR-105b`: beide Lücken der CI-Nachlaufprüfung mit **positiven** Erwartungen geschlossen — `tests/support/suite-inventory.ts` als einzige Quelle der Include-Globs prüft in `globalSetup` Mindestdateizahlen je Suite und verbietet testartig benannte Dateien ohne Project; `OA_TEST_REQUIRE_INFRA=1` macht fehlende Infrastruktur in der CI zum Fehlschlag statt zum Skip; die Log-Suche ist ersetzt durch eine Report-Datei, deren Fehlen den Job rot macht. Beide Richtungen und alle vier Proben belegt und zurückgebaut. Neuer Befund **F13** (verbleibende Sweeper-Lücke bei Läufen > 2 h, für die E2/E3-Soaks relevant), kein Produktionscode berührt, F1–F11 unangetastet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **`JR-106a`** (erneute Abnahme E1) — muss unabhängig von dieser Session laufen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-07-28      | `JR-106a` (erneute Abnahme E1) **durchgeführt, Ergebnis: E1 abgenommen.** HEAD `0a94308` zuerst gegen `origin` abgeglichen (identisch — kein Container-Rollback). Alle 20 Kriterien einzeln geprüft und alle erfüllt, keines übernommen: `pnpm test` ⇒ `10 passed`, `197 passed \| 2 skipped`, Exit `0`; Sonden in `packages/types/` und `packages/frontend/` ohne Config-Änderung eingesammelt, dieselbe Sonde fehlschlagend ⇒ Exit `1`; **F12 bestätigt behoben** über 10 nebenläufige Runden (5 Doppel-, 3 versetzte, 2 Dreifachläufe), alle Teilläufe Exit `0`, 0 Rückstände; alle acht IAM-Fixtures einzeln umbenannt ⇒ jedes Mal Exit `1`; CI-Run **30368442950** auf HEAD grün, 14/14 Schritte `success`, `starting PostgreSQL 17.10`, alle vier `integration`-Dateien mit `✓` und Testzahlen, `Suite inventory verified: … integration 4/4`, „No `oa_test_*` databases left behind."; vier Bestandsworkflows blob-identisch in Merge-Base/HEAD/Worktree; genau **ein** `permissions: contents: read` ohne Job-Override; `pnpm lint` grün, erzwungener `pnpm db:generate` (⇒ `0041_whole_sally_floyd.sql`) lässt ihn grün; Produktionscode unberührt (echter Pre-E1-Build vs. HEAD-Build: **233** `dist`-Dateien, Listen identisch, 1 Datei nur im Zeilenumbruch verschieden, md5 nach Whitespace-Strip gleich); `JR-105b` beidseitig belegt, zusätzlich der von der alten Prüfung nicht erfasste **Lösch**-Fall; `00-rfc.md` seit `6d6564c` unverändert, `srcExclude: ['dev/**']` intakt. **Neun Angriffe auf die neue Inventurprüfung**, sechs hielten, drei nicht ⇒ neue Befunde **F14** (Datei- statt Testebene: `ci` → `nightly` schaltet die Suite ab und bleibt grün), **F15** (`minimumFiles`-Spiel verdeckt eine Löschung), **F16** (Rückstand nach Modul-Throw lokal nicht angekündigt) — keiner bricht ein Kriterium, alle drei nach `JR-1305`. Die lazy-Guard-Fehlerklasse ist geschlossen (`OA_TEST_REQUIRE_INFRA=yes` bricht auch bei laufender DB ab). **F13** nachgeprüft und als schwach bestätigt: die Zwischenregel steht in keiner Backlog-Zeile von `JR-208`/`JR-607`/`JR-410` und nicht in §12.6, und es gibt keine Laufzeitprüfung. Kein Produktionscode geändert, kein Befund behoben, kein Rückmerge, kein PR angefasst; PostgreSQL-16.13-Cluster restlos entfernt (Versionslücke zur CI-17.10 bleibt bestehen und ist benannt).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `JR-1301` (E13, Branch `claude/journaling-e13-iam-hardening`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-07-28      | **Rückmerge E1 in den Integrationsbranch** (`efb769c`, `--no-ff`, gepusht als `b4ae8f7`). ADR-014 gibt ihn nach unabhängiger Abnahme frei; `main` bleibt bis E12 unangetastet. **Kein Squash** — die aufgeräumte Sicht liefert bereits `git log --first-parent` (ein Merge-Commit je Epic), und ein Squash würde die dokumentierte Ablehnung von E1 (`cab0e38`) sowie die beweisbare Formatierungs-Reinheit von `JR-105a` (ADR-015) vernichten. Zusätzlich: **`JR-105c`** für F14–F16 angelegt (fällig vor E2; der Wächter zählt Dateien statt ausgeführter Tests), die **F13-Zwischenregel** in die Akzeptanzkriterien von `JR-208`/`JR-607` übernommen, und der falsche Verweis „F14–F16 → `JR-1305`" korrigiert (`JR-1305` ist E13s Task für F8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `JR-1301` (E13) auf `claude/journaling-e13-iam-hardening`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-07-29      | **ADR-017 entschieden (Auftraggeber): Variante B.** `SearchService.ts:311`/`:423` bauen den Filter künftig für `('archive','search')` — dieselbe (Action, Subject), unter der `requirePermission` den Request durchlässt; `search.routes.ts` bleibt unverändert. `JR-1303` ist damit von Entscheidung auf Umsetzung geschärft (Datei und Zeilen im Backlog benannt), `JR-1302` freigegeben. Variante A verworfen (entwertet die Action `search`, die `predefined_read_only_user` getrennt erteilt), Variante C verworfen für E13 und als **`JR-1310`** danach vorgemerkt — nicht Teil von `JR-1309`. Am Code nachgeprüft und in ADR-017 belegt: **keine der drei `predefined_*`-Rollen trifft den `null`-Zweig in `FilterBuilder.ts:49`**, eine Standardinstallation verhält sich vor und nach dem F7-Fix gleich; damit ist die frühere PO-Aussage „der Fix bricht Bestandsinstallationen" korrigiert und `JR-1307` entsprechend entschärft. Erreichbar bleibt der Zweig über Nutzer ohne Rolle, `cannot`-only-Policies auf `archive` und handgeschriebene Rollen mit `search` ohne `read` — **F7 bleibt Schwere hoch.** ADR-016 bleibt für `JR-1307` reserviert, die Nummernlücke ist Absicht. Nur Dokumentation, kein Produktionscode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `JR-1301` (E13) auf `claude/journaling-e13-iam-hardening`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-07-29      | **`JR-1301` erledigt (Rolle `tester`) — der Epic-Branch ist absichtlich rot.** Die F1/F3/F7/F8-Tests, die den Defekt als _bestanden_ festhielten (inkl. `it.fails`), sind zu Regressionstests umgebaut, die den gewünschten Zustand fordern: **21 rote Tests**, `pnpm test` ⇒ `6 failed \| 10 passed` Dateien, `21 failed \| 203 passed \| 2 skipped`, Exit `1` (Ausgangsstand `efea6bc`: `197 passed`, Exit `0`). Jeder rote Test trägt `RED UNTIL JR-13xx` im Namen und ist einer DEV-Task zugeordnet (1302: 5, 1303: 1, 1304: 7, 1305: 3, 1306: 5). **Kein Opt-out-Schalter** — ein `it.skip`/`it.fails` oder eine Env-Variable wäre ein Hebel, das Epic fertig aussehen zu lassen; vitest isoliert ohnehin je Fall. Vier neue Testdateien plus zwei Support-Dateien, `minimumFiles` bewusst auf den neuen Bestand (unit 5→7, integration 4→8, F14/F15 beachtet). **ADR-017s Wirkungsanalyse hält:** die drei `predefined_*`-Rollen werden über Produktionscode angelegt, keine trifft an einer der drei Aufrufstellen den `null`-Zweig, und `('archive','read')` und `('archive','search')` liefern je Rolle identische Ergebnisse — `JR-1303` ist für eine Standardinstallation belegbar wirkungsfrei. **Sieben neue Befunde F17–F23**, davon zwei mit Gewicht: **F17** (zwei der drei „ausgelieferten" Rollen werden nie angelegt, weil `createAdminRole()` den Bootstrap-Auslöser dauerhaft erfüllt ⇒ es gibt ausgeliefert keine Read-Only-Rolle, F7s praktische Schwere steigt) und **F18** (ADR-017s Aussage gilt je Aufrufstelle, nicht je Rolle: 39 bzw. 46 von 56 Paaren treffen den Zweig). F1s Ausnutzbarkeit ist erstmals **gegen echtes Postgres** belegt — von vier Payloads läuft genau einer, und er hebt über drizzles unklammerte `and()`-Verkettung auch die Einschränkung des Aufrufers auf. Kein Produktionscode geändert (`git diff` gegen `src` ohne Tests ist leer), `pnpm lint` grün, `test:types` grün, Backend-Build grün, 0 Datenbank-Rückstände, PostgreSQL-16.13-Cluster restlos entfernt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `JR-1303`, dann `JR-1302`/`JR-1304`/`JR-1305`/`JR-1306` (Rolle DEV) — die roten Tests sind die Abnahme                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-07-29      | **Befunde aus `JR-1301` durch den PO abgearbeitet, damit DEV nicht auf Entscheidungen wartet.** Zwei Aussagen von ADR-017 waren zu weit gefasst und sind per **Nachtrag** korrigiert: sie gelten **je Aufrufstelle, nicht je Rolle** (F18 — über das volle Vokabular treffen 39 bzw. 46 von 56 Paaren den `null`-Zweig), und „ausgeliefert" trifft auf zwei der drei Rollen gar nicht zu (F17). Die **Entscheidung Variante B bleibt** und ist durch `predefined-roles.int.test.ts` jetzt belegt statt hergeleitet. **F17 am Code nachgeprüft und bestätigt** (`createFirstAdmin` → `createAdminRole()` legt `predefined_super_admin` an, `getRoles` liegt hinter `requireAuth`): **F7s praktische Schwere steigt** — ausgeliefert existiert keine Read-Only-Rolle, jeder eingeschränkte Nutzer ist eine handgeschriebene Policy in der Form, die F7 unwirksam macht. **F21 entschieden: strenge Allowlist** — abgewiesen wird jeder unbekannte Key, nicht nur einer mit SQL-Syntax; die drei betroffenen grünen Pins werden im selben Commit wie der Fix invertiert (die einzige Stelle in E13, an der ein grüner Test bewusst umgedreht wird). **F22** eingearbeitet: `JR-1304`s Kriterium lautet jetzt „kein Zweig wird stillschweigend weggelassen", mit der richtigen Gefahrenrichtung (`$and` und leere Zweigliste, nicht `$or`). **F17(a)** in `JR-1307` aufgenommen. Offen beim Auftraggeber bleibt allein **F17(b)** — Rollen-Bootstrap reparieren? Produktentscheidung, nicht E13, blockiert nichts. Nur Dokumentation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `JR-1303`, dann `JR-1302`/`JR-1304`/`JR-1305`/`JR-1306` (Rolle DEV)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-07-29      | **`JR-1303`, `JR-1302`, `JR-1304`, `JR-1305`, `JR-1306` erledigt (Rolle `senior-dev`).** Produktionscode in vier Dateien, sonst nichts: `SearchService.ts` (ADR-017 B, Zeilen 311/423 auf `'search'`), `FilterBuilder.ts` (`null` ⇒ deny, unbedingtes `cannot` ⇒ deny (F20), `undefined` vom Übersetzer ⇒ deny (F19), `cannot`-Ausschluss über `$not` statt `$ne` (F8)), `mongoToDrizzle.ts` (unübersetzbare Bedingungen werfen, Key-Allowlist, `sql.raw` entfernt), `policy-validator.ts` (Condition-Keys werden beim Anlegen geprüft, rekursiv auch in `$or`/`$and`/`$not`). Keine Migration, kein i18n-Key, `mongoToMeli.ts` unberührt. **20 von 21 roten Tests grün, 0 Regressionen** — maschinell belegt über zwei `--reporter=json`-Läufe und einen Statusdiff je Testname, nicht durch Zählen. Der eine verbleibende rote Test war **kein fehlender Fix**, sondern ein Widerspruch zwischen zwei `JR-1301`-Erwartungen mit demselben `RED UNTIL`-Tag; DEV hat ihn korrekt **nicht** angefasst und vorgelegt. Zwei benannte Abweichungen: die Key-Allowlist prüft Form und Relation statt Spaltenexistenz (⇒ ADR-019, `JR-1311`), und ein gefilterter `-t`-Lauf hinterlässt Testdatenbanken (⇒ **F24**, nach `JR-105c`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Testwiderspruch entscheiden, dann `JR-1307`/`JR-1308`, dann Abnahme `JR-1309`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-07-29      | **Testwiderspruch entschieden (ADR-018) und aufgelöst — E13s Suite ist grün: `224 passed \| 2 skipped`, Exit 0.** Entscheidung des PO: die Unit-Erwartung gilt, ein unübersetzbarer Zweig wird **verweigert** statt durch ein never-true-Prädikat je Zweig ersetzt — dieses kippt unter `$not` zu `not(false)` = wahr und verliert ein Verbot. Der Tester hat alle drei Begründungen **nachgemessen statt übernommen** und eine davon verstärkt: die beiden Erwartungen sind unter **jeder** Implementierung unvereinbar, weil keine prinzipielle Regel `{id:'a'}` anders behandelt als `{userEmail:…}`. Korrektur in `704e8d1`, **in beide Richtungen mutationsgeprüft**. **Dabei eine eigene Aussage des PO korrigiert:** „im `$or` nur verengend" (F22) gilt nur oben in einer `can`-Komposition — unter dem `$not`, wohin `FilterBuilder.ts:84` jede `cannot`-Bedingung setzt, ist derselbe Wegfall **fail-open**. `JR-1304`s Kriterium und F22 sind entsprechend berichtigt. Neu: **ADR-018**, **ADR-019**, **`JR-1311`**, **F24**. **E13 ist damit implementiert, aber nicht abgenommen** — `JR-1307`, `JR-1308`, `JR-1309` stehen aus, `JR-1309` muss in einer eigenen Session laufen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `JR-1307` (Betreiberdoku + ADR-016) und `JR-1308` (Upstream-Entwurf), dann `JR-1309`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-07-29      | **`JR-1307` erledigt (Rolle `senior-dev`): ADR-016 plus Betreiberdoku.** ADR-016 ersetzt den Platzhalter und begründet den Bruch nicht mit „Sicherheit geht vor", sondern damit, dass „kein Recht auf dieses Subject" und „darf alles sehen" vom **selben Wert** dargestellt wurden und der unsichere der Default war — ein Zustand ohne belegbare Zugriffsaussage über das Archiv. Verworfen: Verhalten beibehalten und nur dokumentieren (auch als Schalter), weil **E11s Auditor-Rolle auf genau diesem Mechanismus aufsetzt**. Die Betreiberdoku ist neu in `docs/user-guides/upgrade-and-migration/access-control-changes.md` (englisch, ADR-003, in der Sidebar verlinkt): sieben benannte Verhaltensänderungen, F17 („ausgeliefert existiert nur die Super-Admin-Rolle — eine fehlende Read-Only-Rolle ist kein Fehler der Installation"), der ADR-019-Restspalt als eigener Abschnitt „What is still not checked", **keine** Pauschalwarnung. Herzstück sind drei SQL-Abfragen gegen `roles.policies`, `users` und `user_roles`, **gegen echtes Postgres 16.13 ausgeführt** — aus der Markdown-Datei extrahiert und wörtlich gelaufen: 10 von 10 absichtlich betroffenen Rollen gemeldet, die drei `predefined_*` und die Gegenprobe in **keiner** Ausgabe, sieben Randfälle ohne Fehler und ohne Falschtreffer. `iam-policy.md` hat zwei neue Abschnitte („Condition Keys", „When No Rule Applies"), weil dort die geänderte Semantik nachgeschlagen wird. **Kein Produktionscode, keine Teständerung, keine Migration, kein i18n-Key.** `pnpm lint` grün, `pnpm docs:build` grün, `docs/.vitepress/dist/dev/` existiert weiterhin nicht, `pnpm test` `224 passed \| 2 skipped`, Exit 0. Gemeldet, nicht behoben: `iam-policy.md` führt die Action `export` weiterhin nicht und beschreibt `manage` falsch (`CLAUDE.md` §5.4, stale Stelle (3)) — Vorschlag: eigene Doku-Task.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-07-29      | **`JR-1308` erledigt (Rolle PO): Upstream-Entwurf liegt in `10-upstream-meldung.md`, nicht versendet und nicht veröffentlicht.** Englischer Meldetext (vier Befunde: fail-open bei fehlender `can`-Regel samt F19/F20, Injection über Condition-Keys mit der einen funktionierenden Nutzlast, stilles Verwerfen unübersetzbarer Bedingungen samt Richtungskorrektur aus F22, wirkungsloser `cannot`-Ausschluss bei Operator-Bedingungen) plus F17 als getrennter Bug, dazu eine deutsche Entscheidungsvorlage: **Kanal** (keine `SECURITY.md` im Upstream ⇒ privates GitHub Security Advisory, **kein** öffentliches Issue), **Zeitpunkt**, **Absender/CVE**, und ob die Nutzlast bei einer öffentlichen Meldung entfernt wird. F2/F4/F5/F6/F9/F10 bewusst **nicht** enthalten — offen dokumentiert, in diesem Fork nicht behoben, eine Meldung ohne Fix und ohne eigene Prüfung wäre dünn. Die Datei liegt unter `docs/dev/journaling/` und ist damit über `srcExclude` unpubliziert; das ist Bedingung, weil sie eine funktionierende Injection gegen eine **nicht behobene** veröffentlichte Version enthält. **Kein Agent versendet sie.** Zusätzlich **`JR-1312`** angelegt für die veraltete IAM-Doku (`export` fehlt, `manage` falsch beschrieben — die dritte Stelle aus `CLAUDE.md` §5.4): reine Doku, gehört auf den Integrationsbranch **nach** dem Rückmerge, ausdrücklich nicht in `JR-1307` mitgenommen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `JR-1309` — unabhängige Abnahme E13 in **eigener** Session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-07-29      | **`JR-1309` (Abnahme E13) durchgeführt, Ergebnis: E13 nicht abgenommen.** HEAD `54536cd` zuerst gegen `origin` abgeglichen (identisch — kein Rollback). 21 Kriterien einzeln geprüft: **17 erfüllt**, 1 teilweise (Meili-Hälfte von `JR-1305` strukturell, keine Engine vorhanden), 1 bewusst nicht erfüllt und durch ADR-019 gedeckt, **2 nicht erfüllt**. **`JR-1301`s Kernkriterium unabhängig belegt statt übernommen:** Produktionscode in einer Wegwerf-Kopie auf `efea6bc` zurückgedreht ⇒ `23 failed \| 201 passed`, HEAD ⇒ `224 passed \| 2 skipped`; zusätzlich vier **Einzelreverts**, die jeden Fix einzeln als tragend zeigen (`mongoToDrizzle` 11 rot, `FilterBuilder` 8, `policy-validator` 2, `SearchService` 1); Statusdiff `8984ce9` ⇄ HEAD je `fullName`: rot⇒grün 21, grün⇒nicht-grün **0**. **Suite wirklich vollständig:** 16 Dateien, 226 Fälle, die 2 Skips sind aus dem JSON-Report als genau die `[nightly]`/`[manual]`-Suiten identifiziert, alle 8 `integration`-Dateien mit Fallzahlen gelaufen, `minimumFiles` ohne Spiel — plus CI-Run **30456242256** auf **PostgreSQL 17.10** mit demselben Ergebnis, womit die Versionslücke für die Suite geschlossen ist. **`predefined-roles.int.test.ts` ist kein Tautologie-Test** (zwei Produktionscode-Mutationen ⇒ 4/7 bzw. 6/7 rot, „green but empty test"-Falle greift). **Injektionsweg zu:** 12 Nutzlasten inkl. NUL-Byte, Newline, Fullwidth-Homoglyph und Relationszweig, drei Gates, Legacy-Rolle direkt in die DB geschrieben ⇒ jedes Mal Deny, **0** fremde Zeilen. **F7 fail-closed auf Zeilenebene** für `auditor-specific-mailbox.json` (Fixture von der Platte) und den Nutzer ohne Rolle, `read` **und** `search`. **F2/F4/F5/F6/F9/F10 unverändert:** F2/F9/F10-Dateien blob-identisch, F4/F5/F6 pre-gegen-post identisch gemessen. Öffentliche Doku ohne interne IDs, ohne Compliance-Behauptung, ohne Nutzlast; `10-upstream-meldung.md` nicht gebaut und **nicht im Suchindex** (49 indexierte Seiten, kein Pfad unter `dev/`). `main` = `a560b8c`, kein E13-Commit darin, kein Rückmerge, **kein** neuer PR. **Fünf neue Befunde: `F25`** (die Statusaussage „F4 **und F5** sind im Code kommentiert" ist für F5 falsch), **`F26`** (`can` mit falsy `conditions` ⇒ weiter Vollzugriff; kein Regress), **`F27`** (Query 2 falsch-negativ für skalares/Array-`conditions` — `conditions: 5` war vorher **unbeschränkt**), **`F28`** (Query 3 prüft `subject: "all"` nicht), **`F29`** (Validator und Übersetzer uneins über die Key-Form; die veröffentlichte Doku behauptet die strengere Variante). Kein Produktionscode, kein Test, keine öffentliche Doku geändert; Cluster, Wegwerf-Kopien und Prüfdatenbank restlos entfernt, 0 `oa_test_*`-Rückstände.                                                                                                                                                   | Nacharbeit F29 → F27 → F28 → F25 (F26: PO entscheidet), dann **`JR-1309a`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-07-29      | **PO-Entscheidungen zur `JR-1309`-Ablehnung — die Nacharbeit ist geschnitten, nichts wartet mehr auf mich.** Die Ablehnung ist berechtigt und beide Kernbefunde am Code nachgeprüft: **F29** — der Validator prüft nur die _Form_ der Key-Segmente, der Übersetzer zusätzlich die _Auflösbarkeit_ der Relation, also speichert `foo.bar` mit `200` und scheitert erst zur Abfragezeit, während die veröffentlichte Doku „Saving … fails with HTTP `400`" behauptet. **F27** — eine Policy-Form, die von „sieht alles" auf „sieht nichts" umschlägt, wird von **keiner** der drei Betreiber-Abfragen gefunden. Entscheidungen: (1) **F29 wird streng gelöst**, nicht durch Abschwächen der Doku — ein Key, der beim Speichern auffällt, ist für einen Betreiber strikt besser als einer, der zur Abfragezeit auffällt, und `JR-1306`s Kriterium fordert es. Das Prädikat kommt aus **einer** Quelle, die Validator und Übersetzer gemeinsam nutzen. (2) Zur Frage des Testers „Abfragen erweitern **oder** Absolutsatz entschärfen": **beides** — nur entschärfen lässt den Betreiber ohne brauchbare Prüfung, nur erweitern erzeugt denselben Fehler eine Runde später, weil eine Abfrage über beliebiges JSONB gegen künftige Formen nie beweisbar vollständig ist. (3) **F26 zur Hälfte vorgezogen**: die Formprüfung von `conditions` selbst wandert in `JR-1313` (Objekt oder nicht vorhanden; Skalar, Array, `null` werden abgewiesen), weil sie sich die Ursache mit F27 teilt; das Laufzeitverhalten für **bereits gespeicherte** solche Policies bleibt bei `JR-1311`, sonst wäre es ein Regress-Risiko ohne Not. (4) Neu **`JR-1316`**: die Betreiber-SQL bekommt einen Regressionstest gegen dieselben Fixtures wie der Code — sie war das **einzige** sicherheitsrelevante Artefakt in E13 ohne Test, und genau deshalb ist F27 durch alle Prüfungen gekommen. Ebenfalls bestätigt: **PR #1 und #2 sind geschlossen und nicht gemergt** (28.07.), `main` unverändert `a560b8c` — meine frühere Darstellung „zwei offene PRs, Entscheidung beim Auftraggeber" war einen Tag lang überholt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `JR-1313`/`JR-1314`/`JR-1315` (DEV), dann `JR-1316` (TEST), dann `JR-1309a`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-07-29      | **`JR-1316` aus E13 herausgenommen — Entscheidung des Auftraggebers, und sie ist berechtigt.** Das Epic war von 9 auf 14 Positionen gewachsen. Der größere Teil davon war die Abnahme, die ihren Zweck erfüllt hat — `JR-1309` hat E13 mit zwei echten Befunden abgelehnt —, und drei weitere Themen hatte der PO bereits **aus** E13 herausgehalten (`JR-1310`/`JR-1311`/`JR-1312`). `JR-1316` war jedoch eine PO-Entscheidung zweiter Ordnung: ein Regressionstest für SQL-Schnipsel in einer **Doku-Seite**. E13s Zusage lautet „die Autorisierungsschicht ist fail-closed", und die ist seit `dcec017` erfüllt und unabhängig belegt — Injektionsweg an beiden Gates zu, `FilterBuilder` zeilenscharf fail-closed, jeder Regressionstest ohne seinen Fix rot, Suite grün auch in der CI auf PostgreSQL 17.10. Die Lücke, die `JR-1316` bewachen soll (**F27**), ist **behoben** und in `JR-1314` über eine Falsch-negativ-Prüfung gegen echtes Postgres belegt; der Test schützt gegen ihre **Wiederkehr**, nicht gegen ihren Fortbestand. Ein Epic, dessen Kernaussage unabhängig belegt ist, wird nicht von einer Absicherung zweiter Ordnung offengehalten. Die Task steht wortgleich unter „Folge-Task nach E13", zählt **nicht** zu `JR-1309a`, und die Reihenfolge der vier Folge-Tasks ist festgelegt (`JR-1312` → `JR-1316` → `JR-1311` → `JR-1310`); keine blockiert E2. Nur Dokumentation, kein Produktionscode, kein Test angefasst.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `JR-1309a` — die letzte Task von E13, eigene Session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-07-29      | **`JR-1317` erledigt (Rolle `senior-dev`) — F30 behoben, und der Abdeckungsanspruch der Betreiberseite ist weg (ADR-020).** (a) Die zwei Formbefunde von Query 2 stehen auf **Knotenebene**: sie speisen aus der rekursiven CTE `cond` statt aus `pair`, `cond` trägt eine neue Spalte `path`, und jede Meldung nennt die Position (`"conditions" -> "$or" -> [] -> "$and" -> []`). Drei Befundtypen: `empty condition object` (`node = '{}'` in **jeder** Position, ersetzt den Wurzel-Typ), `condition node is not an object` (Element eines `$or`/`$and`-Arrays bzw. Rumpf eines `$not`) und `condition branch list is not an array`. Die Wurzelmeldung `conditions is not an object` bleibt unverändert. Die Prädikate sind aus `checkConditionsShape()` **abgeleitet**, nicht geraten; ein pauschales `jsonb_typeof(node) <> 'object'` wäre Fallstrick 20 gewesen. **Nachweis, Blöcke wörtlich aus der `.md` gegen PostgreSQL 16.13 mit 41 Migrationen, 26 gesäte Rollen:** alle **acht** F30-Formen gemeldet, `{"$or": []}`/`{"$and": []}` und alle Wurzelformen weiter gemeldet, sieben zusätzliche Formen derselben Klasse ebenfalls; **keine Falsch-positiven** — die drei `predefined_*` und acht Kontrollen (Gleichheit, `$in`, Relationskey, `can` mit Operator, `$or` aus Objekten, verschachteltes `$and`/`$or`, `$not` um eine Gleichheit, unbedingter Grant) in **keiner** der drei Ausgaben, maschinell verglichen. Gegen den Übersetzer gekreuzt (37 Werte, `dist/helpers/mongoToDrizzle.js`): verweigert ⇒ gemeldet und übersetzbar ⇒ still, mit **zwei** benannten, bewussten Abweichungen (`conditions: 5` an einem nicht gefilterten Subject wird nicht gemeldet — dort ändert sich nichts; `{"id":{"$in":[{}]}}` wird gemeldet, obwohl der Übersetzer es nimmt — Übermeldung). (b) **Der Anspruch ist weg:** „It examines" ⇒ „What it reports", kein „recursively" als Zusage, der widerlegte Satz zu „the values inside a condition" ersetzt (ein Wert, der selbst eine **Struktur** ist, ändert die Wirkung), ausdrücklich „**cannot be shown to be complete** … an indication, **not a clearance**", plus eine **verifizierbare Gegenprobe in drei Schritten ohne Formliste** und der Hinweis, dass eine unübersetzbare Bedingung jetzt einen **Fehler** erzeugt. **Vier weitere Abdeckungssätze** derselben Klasse gefunden und ersetzt („lists **every** shape", „find out which", zwei × „covers"), plus drei bisher offene Punkte ausdrücklich benannt (Scoping des Wurzelbefunds, `400` nur an der Wurzel, Array-`conditions` wird nicht betreten). **Kein Produktionscode, kein Test, keine Migration, kein i18n-Key**; `conditionKey.ts` war Referenz, nicht Ziel. `pnpm lint`, `test:types`, Backend-Build, `pnpm docs:build` grün, `dist/dev/` fehlt weiterhin, Suite unverändert `250 passed \| 2 skipped`, Exit 0, 0 `oa_test_*`-Rückstände, Cluster restlos entfernt. | **`JR-1309b`** — schmale dritte Abnahme (Kriterium 12 und `JR-1317`), eigene Session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-07-29 / 30 | **Lücke in dieser Tabelle, nachgetragen vom PO am 2026-07-30.** Die Sessions zwischen `JR-1317` und dem Rückmerge haben ihre Protokolle als eigene `###`-Abschnitte oben in dieser Datei abgelegt, aber keine Zeile hier ergänzt. Der Reihe nach, jeweils mit Abschnitt: **Abnahme `JR-1309b`** — E13 zum dritten Mal nicht abgenommen, 17 von 18 Kriterien, gebrochen war **F31** (der Abdeckungsanspruch war von der Abfrage auf den Verhaltenscheck gewandert, der zwei Zahlen vorschreibt, während die Anwendung **drei** Oberflächen filtert), Ursache in ADR-020 selbst, dazu F32–F34. **`JR-1318`** — die dritte Zahl aufgenommen, der Absolutsatz durch sein Gegenteil ersetzt, die Bürgschaft in beiden Richtungen negiert; **ohne DEV-Bericht** committet, die Statusnotiz ist die Lesart des PO aus dem Diff. **Abnahme `JR-1309c`** — **E13 abgenommen** in der vierten Runde, der Prüfer hat ohne DEV-Bericht gearbeitet und den durch `JR-1318` entfernten Anker mit einer vergifteten Wegwerf-Kopie neu gesetzt, bevor er dem sauberen Lauf glaubte; der eine gemeldete Neubefund (**F36**) ist vom PO nachgemessen und **widerlegt** — reines **F35**. **Rückmerge `89d701f`** (`--no-ff`, kein Squash, damit die drei dokumentierten Ablehnungen erhalten bleiben). **`JR-1312`** (`dca1f1a`) — die dritte Stelle des Berechtigungsvokabulars berichtigt, alle drei maschinell verglichen, 8 Actions und 7 Subjects.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `JR-105c` (F14–F16, F24), fällig vor E2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-07-30      | **`JR-105c` erledigt (`b5b2190`) — E1 hat keine offene Nacharbeit mehr.** Der Inventar-Wächter zählte Dateien; drei Wege, Abdeckung zu entfernen, lassen das Filesystem unverändert (F14, F15). Neu zählt ein Reporter die **ausgeführten** Tests **je Suite und je Klasse** gegen `SUITES[].expectedTests`, und der `globalSetup`-Teardown urteilt und wirft — vitest hat nach dem Lauf keinen Assertions-Haken, die Reihenfolge (`onTestRunEnd` → `onFinished` → Teardown, Wurf ⇒ Exit 1) ist vorab gemessen. Je Klasse ist der tragende Teil: die Umetikettierung verringert die Gesamtzahl nicht, sie verschiebt die Tests in eine nicht gefahrene Klasse. Dateizahl **und** Testzahlen sind jetzt **Gleichheiten** (F15s eigener Vorschlag); die Fehlermeldung nennt die einzutragende Zahl. Ein absichtlich verengter Lauf (`-t`, Dateifilter, `--project`, `--shard`) prüft nichts und **sagt das** — die CI verlangt dafür, dass die Prüfung anwendbar war, dort ist die Hintertür also zu; sie liest zudem das **Urteil** statt es nachzurechnen (F29 nicht wiederholen). **F16/F24**: der Worker trägt jede geholte Datenbank in ein **Ledger-Verzeichnis je Lauf** ein, der Hauptprozess meldet den Rest mit Namen und Worker-PID, droppt ihn und macht einen **unverengten** Lauf davon rot — bewusst nicht „alles abfragen und diffen", das hätte einen fremden Parallellauf treffen können (F12). **Jeder Angriff zuerst am Elternstand `e09b981` wiederholt:** Umetikettierung aller acht Integrationsdateien war dort **Exit 0** mit „verified" von beiden Wächtern, jetzt **Exit 1** bei unveränderten `8/8` Dateien; `it.skip`-Datei ⇒ `ci 52/55`; Löschen-plus-Hinzufügen ⇒ `ci 43/55`; Modul-Scope-Wurf ⇒ Datenbank namentlich gemeldet und gedroppt; `pnpm test -t "idempotent"` hinterließ **6** Datenbanken, jetzt **0**; legitim ⇒ `274 passed \| 2 skipped`, Exit 0. Alles gegen PostgreSQL **17.10**. Kein Produktionscode, `test:types` grün, Prettier grün, 0 Rückstände. **`CLAUDE.md` §5.1 war falsch** („zero test files, no test runner", CI ohne Test-Job) und ist berichtigt — sie hätte eine Folge-Session einen zweiten Harness bauen lassen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **E2** — davor die zwei ADRs **ADR-006** und **ADR-007** entscheiden und Redis/Meilisearch/Tika für diesen Host klären                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-07-31      | **ADR-007 vollständig entschieden (Auftraggeber): eine Kette _je Mandant_, und `chain_scope_id` = `ingestion_sources.id`.** Nicht eine globale Kette mit Mandanten-Tag — RFC §15 nennt per-tenant für **Export und Löschung** sauberer, und genau das muss dieses Produkt dauernd leisten; ein Kettenauszug für einen Auditor würde bei einer globalen Kette zwangsläufig Absender, Empfänger und Zeitpunkte anderer Mandanten offenlegen. **Die frühere Entwurfsrichtung war ein Denkfehler und ist berichtigt:** „für v1 eine einzelne Kette" berief sich auf RFC §5.2, dessen „do not start there" aber **Shard**-Ketten zur Horizontalskalierung meint, nicht eine fachliche Partition je Mandant. Als Kettenschlüssel gewählt ist das **Archiv**, nicht der Endpunkt: der Ledger muss stabiler sein als die Konfiguration, die ihn füllt — `journaling_sources` ist `paused`-bar, seine `routing_address` regenerierbar, es hängt per `onDelete: cascade` an der Ingestion-Source, und das Schema erlaubt mehrere Endpunkte je Archiv. `journaling_source_id` wird **Attribut** jeder Ledger-Zeile, damit „wer hat gesendet" im Beleg bleibt. Sieben Konsequenzen in ADR-007, davon drei nicht offensichtlich: die Kettenkennung **muss in den Genesis** (sonst sind zwei Ketten mit identischem erstem Ereignis hashgleich und ein Eintrag zwischen Mandanten verschiebbar), das **Ankern** wird teurer und braucht in E7/E8 die Wahl zwischen einem TSA-Zeitstempel je Mandant und einem Aggregat über alle Kettenköpfe, und **`verify` muss eine _fehlende_ Kette erkennen** — ein Zustand, den eine globale Kette nicht darstellen konnte. `02-architektur.md` §4, ADR-006 (Genesis) und E2s Tasks `JR-203`/`JR-204`/`JR-206`/`JR-208`/`JR-209` sind nachgezogen; **offen bleibt allein ADR-006**. **Umgebung — die Infrastrukturfrage für E2 ist geklärt.** Der Auftraggeber hat erst **Docker Sandboxes** (`Docker.sbx`), dann **Docker Desktop** installiert; beide Wege sind gemessen. Über Sandboxes lief die Infrastruktur (Docker 29.6.1 in der Sandbox, Workspace gemountet, Host-Zugriff über `sbx ports`), aber der **Portforwarder überlebte die parallele Integrationslast nicht**: 16 Fehlschläge, alle `read ECONNRESET` bzw. `write CONNECTION_CLOSED`, bei 4 ms für einen einzelnen Connect. Dazu zwei weitere Auflagen: die Sandbox stoppt im Leerlauf (Container **und** Portfreigaben kehren beim Start zurück), und `sbx` erzwingt im Sandbox-Netz eine **Default-Deny**-Netzpolicy (`403 Blocked by network policy` für `http://tika:9998`, weshalb Tika dort nicht erreichbar war). **Mit Docker Desktop** (Engine und Client **29.6.2**, Compose **v5.3.1**) ist derselbe Volllauf **grün**: `274 passed                                                                                                                                                                    | 2 skipped`, Exit 0, 0 `oa*test*\*`-Rückstände, Verdikt `applicable`und ohne Verstoß. Alle vier Dienste laufen und sind vom Host aus belegt: PostgreSQL **17.10** mit`CREATEDB`, Valkey `AUTH`+`PING`, Meilisearch `/health` `200`, Tika `/version` `Apache Tika 3.2.2`. Zwei Fallen dabei, beide im Handover: Docker Desktop ist eine **Benutzer**installation, deren PATH-Eintrag eine ältere Shell nicht sieht — und es genügt **nicht**, `docker.exe`mit vollem Pfad aufzurufen, weil dann`docker-credential-desktop`fehlt und jedes`pull`mit`error getting credentials`abbricht. Der Port-Override liegt bewusst **außerhalb** des Repositorys;`docker-compose.yml`bleibt ohne Port-Mappings. Die Probe-Sandbox ist entfernt, die Sandbox`claude-Maxim` des Auftraggebers unangetastet. **Kein Code geändert.** | **`JR-203`** (ADR-006 fixieren, Rolle PO), dann die übrigen E2-Tasks |
