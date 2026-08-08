# Status

**Diese Datei ist die verbindliche Fortschrittsquelle.** Sie wird am Ende **jeder** Session
aktualisiert — auch wenn nichts fertig wurde. Ein nicht aktualisierter Status ist schlimmer als
keiner, weil er Fortschritt behauptet, der nicht existiert.

Legende: `[ ]` offen · `[~]` in Arbeit · `[x]` fertig und abgenommen · `[!]` blockiert

**Letzte Aktualisierung:** 2026-08-08 — **Details im Archiv, siehe unten.** Kurz: **E6 ist fertig,
abgenommen mit `JR-6-08` und zurückgemergt** (`b5b7c8a`, `--no-ff`, kein Squash, auf
`claude/enterprise-product-implementation-cxmmqe`). Damit sind **E1, E13, E2, E3, E4, E5 und E6**
zurückgemergt; nur E7–E12 sind noch offen. Diese Datei ist am 2026-08-08 erneut auf Diät gesetzt
worden (das vollständige E6-Sessionprotokoll liegt jetzt in `23-archiv-e6.md`, fortsetzend zu
`21-archiv-e6-jr601-jr602a-notizen.md`). Nummernkreise nach **ADR-032**: ADR-033–038 sind vergeben,
**039–040 sind mit dem Rückmerge an den allgemeinen Vorrat zurückgefallen** (nie gebraucht), F59–F70
(F59, F61, F65, F66 vergeben, F60/F62/F64/F66 offen und E6 nicht mehr blockierend).

> **CI-Lücke — korrigiert 2026-08-07 (Fund der `JR-6-08`-Abnahmesitzung):** Der Satz „GitHub Actions
> erzeugt seit `37b471d` keine zuverlässigen Läufe mehr" **stimmt seit `JR-6-06`s Commit
> (`31136887457`, 2026-08-07) nicht mehr** — `gh run list` zeigt seither eine ununterbrochene Serie
> grüner Läufe, bestätigt für den Abnahme-Commit `7fe5e8d` (`31195544522`, `success`, 3 min 14 s).
> **Ursache unbekannt** (weder hier noch von der Abnahmesitzung untersucht) — möglich, dass das
> zugrundeliegende GitHub-Actions-Problem sich von selbst gelöst hat, oder dass `37b471d` nie die
> eigentliche Ursache war. **Die Policy bleibt trotzdem sinnvoll** (`pnpm gate` lokal vor jedem Push,
> echtes CI gebündelt vor dem Rückmerge) — sie kostet nichts, wenn CI ohnehin grün durchläuft, und
> schützt weiterhin, falls die Lücke wiederkehrt. `act` weiterhin bewusst nicht eingerichtet.

> **Am 2026-08-01 zusätzlich entschieden: `ADR-025` — der Fork wird weitergeführt.** Die Frage des
> Auftraggebers, ob angesichts einer kostenpflichtigen Upstream-Lizenz eine eigenständige Anwendung
> sinnvoller wäre, ist geprüft und verneint. Die Lizenzannahme („§12/§13 verbieten Deployments für
> Endkunden") hielt nicht stand — AGPL §13 ist eine **Angebotspflicht**, kein Verbot. Zwei Dinge
> ändern sich daraus für die tägliche Arbeit: die Abhängigkeitsregel in `02-architektur.md` §2 gilt
> jetzt **beidseitig** (Journaling-Logik darf nicht in `packages/backend` entstehen, damit die
> Herauslösung eine Verpackungsentscheidung bleibt), und die **Fork-Divergenz wird ab sofort
> gemessen** (`08-risiken.md` R-19, Ausgangswerte unter „Upstream-Merges" weiter unten).

### Upstream-Merges

Gegenmaßnahme zu **R-19**. Je Merge von `main` in den Integrationsbranch wird hier eine Zeile
ergänzt — nach ADR-014 ist das der einzige erlaubte Ort für einen Upstream-Merge, der Aufwand fällt
also gebündelt an derselben Stelle an.

| Datum      | Upstream-Version | Konfliktdateien  | Aufwand | Tests danach                       | Bemerkung                                                                                                                                            |
| ---------- | ---------------- | ---------------- | ------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-01 | `a560b8c` v0.5.2 | — (Ausgangswert) | —       | 398 passed / 2 skipped, 30 Dateien | Noch kein Merge nötig: `origin/main` ist identisch mit Upstream-`main`, und der Integrationsbranch ist 88 Commits voraus bei **0** Commits Rückstand |

**Ausgangsmessung der Konfliktfläche** (`e808898` gegen `origin/main`): 115 berührte Dateien, davon
**94 neu angelegt** und nur **21 geänderte Bestandsdateien**. Die 21 sind die Zahl, die zählt; sie
ist klein, weil ADR-002 fast alles in neue Dateien zwingt. Zwei davon sind die wahrscheinlichsten
Konfliktpunkte, weil Upstream sie bei jeder eigenen Migration ebenfalls anfasst:
`packages/backend/src/database/migrations/meta/_journal.json` und
`packages/backend/src/database/schema.ts`. Kollidiert einer von beiden, ist vor dem Auflösen gegen
`pnpm db:migrate` auf einer frischen Datenbank zu prüfen — ein grüner `pnpm build` genügt dort
nicht.

> **Die ausführlichen Task-Protokolle von E2** (`JR-2-01`–`JR-2-09`), die Notizen zwischen den
> E13-Abnahmerunden und die E1-Nachtragsnotiz (F14–F16) sind am 2026-08-06 aus diesem Kopf-Abschnitt
> nach `12-archiv-e13-e2.md` bzw. `11-archiv-e1.md` gewandert (Doku-Diät, inhaltlich unverändert —
> die Diät vom 2026-08-03 hatte nur die formellen Abnahmerunden erfasst, nicht diese Notiz hier).
> Alle drei Epics sind abgenommen und zurückgemergt; für die nächste Task ist nichts davon nötig.

---

## Gesamtübersicht

Sortiert nach **Abarbeitungsreihenfolge**, nicht nach Epic-Nummer — E13 wurde nachträglich vor E2
eingeschoben (siehe `03-backlog.md`).

| Reihenfolge | Epic | Titel                              | Status                                                                                                   | Fertig / Gesamt                                                                                                                 |
| ----------- | ---- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| —           | E0   | Planung, Doku, Agent-Infrastruktur | **fertig**                                                                                               | 6 / 6                                                                                                                           |
| 1           | E1   | Test- und CI-Fundament             | **abgenommen + gemergt**, Nacharbeit `JR-1-05c` erledigt                                                 | 10 / 10                                                                                                                         |
| 2           | E13  | IAM-Autorisierung härten           | **abgenommen + gemergt** (`JR-13-09c`, 4. Runde), Folge-Tasks offen                                      | 9 / 9 + 8 / 8 Nacharbeit                                                                                                        |
| 3           | E2   | Ledger und Hash-Chain              | **abgenommen + gemergt** (`JR-2-10a`, 2. Runde, unabhängig)                                              | 11 / 11                                                                                                                         |
| 4           | E3   | Spool und Acceptance-Contract      | **abgenommen + gemergt** (`JR-3-08`, 21/21, unabhängig)                                                  | 9 / 9                                                                                                                           |
| 5           | E4   | `smtp-ingress`-Service             | **abgenommen + gemergt** (`JR-4-13`, 2026-08-04, unabhängige TEST-Sitzung, Protokoll `16-abnahme-e4.md`) | 21 / 21 + Abnahme. Gezählt werden die **Backlog-IDs** (ADR-021): `JR-4-05` gilt mit `a`–`c` als erledigt, `JR-4-06` mit `a`/`b` |
| 6           | E5   | Journal-Report-Parser              | **abgenommen + gemergt** (`JR-5-09`, Parallelsession B, Merge `107346d`)                                 | 9 / 9                                                                                                                           |
| 7           | E6   | Phase-B-Worker                     | **abgenommen + gemergt** (`JR-6-08`, 2026-08-07, unabhängige TEST-Sitzung, Merge `b5b7c8a`)              | 8 / 8. Gezählt werden die **Backlog-IDs** (ADR-021): `JR-6-02` zählt mit `a`+`b` und Abnahme                                    |
| 8           | E7   | WORM-Storage                       | **in Arbeit** — `JR-7-01`–`JR-7-05` erledigt, `JR-7-06` (Abnahme) offen                                  | 5 / 6                                                                                                                           |
| 9           | E8   | Anchoring                          | offen                                                                                                    | 0 / 6                                                                                                                           |
| 10          | E9   | `verify`-CLI                       | offen                                                                                                    | 0 / 8                                                                                                                           |
| 11          | E10  | Completeness-Monitoring            | offen                                                                                                    | 0 / 8                                                                                                                           |
| 12          | E11  | Compliance-Features                | offen                                                                                                    | 0 / 10                                                                                                                          |
| 13          | E12  | Rollout und Dokumentation          | offen                                                                                                    | 0 / 9                                                                                                                           |

117 Tasks in den Epics (E0 lieferte 102; E13 kam mit 9 hinzu, E4 mit 6: `JR-4-14` und `JR-4-15` als
Auflagen aus **ADR-029**, `JR-4-16` für **F44**, `JR-4-17` für **ADR-030**, `JR-4-18` für den nie verdrahteten Crash-Recovery-Scan, `JR-4-19` für die Ledger-Verbindung, die sich
nach einem gescheiterten Start nicht erholt). Dazu **`JR-13-10`** als Folge-Task nach
E13 (Variante C aus ADR-017) — er gehört zu keinem Epic und zählt nicht in die Abnahme von `JR-13-09`.

**Produktionscode für den Receiver:** seit E2 gibt es welchen — `packages/journaling` (kanonische
Kodierung, Merkle, `PostgresLedgerWriter`) und die Migrationen `0041`/`0042`. **Seit E4 existiert der
SMTP-Empfangspfad** (`apps/smtp-ingress` plus `packages/journaling/src/ingress/`) und nimmt an; der
Satz „ein SMTP-Empfangspfad existiert weiterhin nicht" stand hier bis zur E4-Abnahme am 2026-08-04.

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

**Die sechs zentralen Befunde aus E0 sind am 2026-08-06 nach `11-archiv-e1.md` gewandert** (Doku-Diät,
inhaltlich unverändert) — Closed-Source-Enterprise-Listener, RFC-§3-Lücke im dokumentierten Ablauf,
Null-Tests-Ausgangslage, IAM-Doku-Drift (Code korrekt, Doku falsch, `JR-11-03`), fehlendes CLI, und
ADR-004s ursprünglicher Fehler bei `srcExclude` (seither behoben, mit Nachweis).

---

## E1 — Test- und CI-Fundament (**fertig**, abgenommen 2026-07-28 mit `JR-1-06a`)

**Das vollständige Protokoll dieses Epics steht in [`11-archiv-e1.md`](11-archiv-e1.md)** — 681 Zeilen,
unverändert ausgegliedert am 2026-07-30, weil ein abgenommenes und gemergtes Epic den aktuellen Stand
nicht verdecken soll. Dort: `JR-1-01`–`JR-1-05`, die Nacharbeit `JR-1-04a`/`JR-1-05b`, die abgelehnte Abnahme
`JR-1-06`, die bestandene `JR-1-06a`, F1–F16 in ihrem E1-Kontext und die CI-Einrichtung.

**Von E1 ist nichts mehr offen.** Die letzte Nacharbeit **`JR-1-05c`** (F14–F16, F24) ist am 2026-07-30
erledigt; Protokoll direkt darunter.

> **Das Protokoll von `JR-1-05c` liegt seit dem 2026-08-03 in `11-archiv-e1.md`** (Doku-Diät,
> inhaltlich unverändert). Was davon für jede weitere Task gilt, steht kurz in `07-session-handover.md`:
> eine neue Testdatei ändert `expectedFiles` **und** `expectedTests` im selben Commit, und ein
> verengter Lauf belegt nichts.

## E2 — Ledger und Hash-Chain (**fertig, abgenommen 2026-08-01 mit `JR-2-10a`, zurückgemergt**)

> **E2 ist abgenommen und zurückgemergt.** Die Abnahme ist die zweite, **unabhängige** Runde
> `JR-2-10a` (2026-08-01, Rolle TEST, frische Sitzung, 24/24). Die erste Runde `JR-2-10` bleibt als
> Protokoll stehen und zählt **nicht** als Abnahme; sie lief in derselben Sitzung wie
> `JR-2-08`/`JR-2-09`.
>
> **Der Rückmerge ist am 2026-08-01 vollzogen** (`eb340a9`, `--no-ff`, **kein Squash** — wie bei E13):
> 12 Commits, darunter zwei Abnahmerunden, eine abgelehnte Berichtsfassung und `F38`. Genau diese
> Zwischenschritte sind der Beleg, dass das Verfahren gewirkt hat, und ein Squash hätte ihn getilgt.
> Der Baum des Merge-Commits ist **byteidentisch** mit der Branchspitze `b4eda03`, und seit dem
> zitierten Volllauf war außerhalb von `docs/` nichts geändert — der Lauf gilt also unverändert für
> den gemergten Stand (nachgeprüft, nicht angenommen). Kein Pull Request, `main` unangetastet.

> **Die zwei Abnahmerunden von E2 liegen seit dem 2026-08-03 in `12-archiv-e13-e2.md`**
> (Doku-Diät, inhaltlich unverändert): `JR-2-10` (23/23, nicht unabhängig, zählte nicht) und
> `JR-2-10a` (24/24, unabhängig, abgenommen). E2 ist zurückgemergt (`eb340a9`).

## E13 — IAM-Autorisierung härten (**fertig, abgenommen 2026-07-30 mit `JR-13-09c`**)

**Branch:** `claude/journaling-e13-iam-hardening`, abgezweigt vom Integrationsbranch bei `efea6bc`,
**am 2026-07-30 nach der Annahme mit `--no-ff` zurückgemergt** (kein Squash — ein Squash hätte die drei
dokumentierten Ablehnungen getilgt und damit den Beleg, dass die Abnahme funktioniert hat).

**Der Weg dorthin, vier Runden — Kurzfassung am 2026-08-06 nach `12-archiv-e13-e2.md` verschoben**
(inhaltlich unverändert, dort unter „Vier-Runden-Zusammenfassung"): `JR-13-09` ablehnend, drei
Nacharbeits-Runden, `JR-13-09c` abschließend angenommen.

> **Die beiden Task-Tabellen (Nacharbeit `JR-13-13`–`JR-13-15` und Haupttabelle `JR-13-01`–`JR-13-09`)
> sind am 2026-08-06 nach `12-archiv-e13-e2.md` gewandert** (Doku-Diät, inhaltlich unverändert) — alle
> Commit-Hashes stehen dort unverändert, `JR-13-16`s Ausnahme ebenfalls.

> **Die vier Abnahmerunden von E13 liegen seit dem 2026-08-03 in `12-archiv-e13-e2.md`**
> (Doku-Diät, inhaltlich unverändert): `JR-13-09` bis `JR-13-09c`, die Nacharbeiten `JR-13-13`–`JR-13-15`,
> `JR-13-17`, `JR-13-18` und `JR-13-12`. E13 ist abgenommen und zurückgemergt (`89d701f`).

## E5 — Journal-Report-Parser (**fertig, abgenommen 2026-08-02 mit `JR-5-09`, zurückgemergt**)

9 / 9 Tasks. Entstanden als **Parallelsession B** neben E4, Merge `107346d`. Der Parser zerlegt einen
Journal-Report in Envelope und eingeschlossene Nachricht (`packages/journaling/src/parser/*`), liest
MIME mit `mailparser` (**ADR-027**) und löst den Eigentümer auf. Abnahme: angenommen mit einer Auflage,
die geschlossen wurde (**F58** — Whitespace einer konfigurierten Domain landete in der
Eigentümeradresse).

> **Das vollständige Protokoll liegt seit dem 2026-08-04 in `18-archiv-e4-e5.md`** (Doku-Diät,
> inhaltlich unverändert): alle neun Scheiben, die vier PO-Reviews, der Testkorpus aus `JR-5-08` und
> die Abnahme `JR-5-09`.

## E4 — `smtp-ingress`-Service (**fertig, abgenommen 2026-08-04 mit `JR-4-13`, zurückgemergt**)

21 / 21 Tasks plus Abnahme, Merge `9503bc8`. Der SMTP-Empfangspfad steht: ESMTP mit `PIPELINING`,
`8BITMIME`, `SMTPUTF8`, `SIZE`, `CHUNKING`/`BDAT`, `STARTTLS` und `AUTH`; Quell- und Empfänger-ACL gegen
`journaling_sources`; Crash-Recovery-Scan vor dem `listen()`; und `250 … queued as <seq>` **erst** nach
fsync von Spool **und** Ledger-Append. Der Server ist selbst gebaut (**ADR-029**), eine Transaktion
bleibt genau einer Kette zugeordnet (**ADR-030**), und die Ledger-Anbindung erholt sich ohne Neustart
(**ADR-031**).

**Aus E4 ist kein Befund offen.** F42–F51 behoben oder aufgelöst, F52/F53/F54 (`JR-4-21`), F55/F56 und
F50 (`JR-4-21a`), F47 bei der Abnahme als längst behoben erkannt.

> **Das Abnahmeprotokoll steht in `16-abnahme-e4.md`** — 24 Kriterienzeilen mit je einem Beleg. **Das
> vollständige Sessionprotokoll liegt seit dem 2026-08-04 in `18-archiv-e4-e5.md`**, inhaltlich
> unverändert: alle 21 Scheiben, die Befunde F42–F58 in ihrer Entstehung, und die Zahlen je Lauf.

## E6 — Phase-B-Worker (**fertig, abgenommen 2026-08-07 mit `JR-6-08`, zurückgemergt 2026-08-08 mit `b5b7c8a`**)

8 / 8 Tasks (Backlog-IDs nach ADR-021: `JR-6-02` zählt mit `a`+`b`). Der Worker (`journal-inbound`,
eigener Prozess seit `JR-6-01`) fährt die vollständige Phase-B-Pipeline
(`runPhaseBPipeline()`, ADR-010/033/034/035): parsen → Owner auflösen → archivieren → indexieren →
Spool freigeben. Idempotenz über einen eigenen Ledger-Event-Typ (`JR-6-03`, ADR-037), ein
Spool-Reconciler holt Rückstand aus einer geleerten Redis-Queue zurück (`JR-6-04`, ADR-038),
`content_sha256` läuft nachweislich über Plaintext vor der Verschlüsselung (`JR-6-05`), ein
Object-Store-Ausfall berührt den Acceptance-Contract nicht (`JR-6-06`), und ein Soak-Test über echtes
SMTP beweist `seq`-Lückenlosigkeit und Durchsatz (`JR-6-07`, `nightly` 100.000 / `ci` 100 Nachrichten).

Abnahme `JR-6-08`: unabhängige TEST-Sitzung, kein Kriterium verletzt, drei übereinstimmende
Volllaufnachweise (Windows, Linux/WSL2, echte GitHub-CI). Dabei korrigierter Fund: die zuvor
dokumentierte „CI-Lücke seit `37b471d`" war seit `JR-6-06`s Commit bereits wieder geschlossen.
Offene, nicht blockierende Befunde **F60** und **F66** (beide E7 zugeordnet), **F62**/**F64**
(niedrig/mittel, unzugeordnet).

> **Das vollständige Sessionprotokoll liegt in [`23-archiv-e6.md`](23-archiv-e6.md)** (`JR-6-04`–`JR-6-08`,
> Doku-Diät 2026-08-08) und, fortsetzend davor, in
> [`21-archiv-e6-jr601-jr602a-notizen.md`](21-archiv-e6-jr601-jr602a-notizen.md) (`JR-6-01`–`ADR-037`).
> Das Abnahmeprotokoll (Kriterium → Beleg → Urteil) steht separat in
> [`22-abnahme-e6.md`](22-abnahme-e6.md). ADR-010, ADR-033–038 in `05-entscheidungen.md`. Befunde
> F59–F66 in `09-befunde-bestandscode.md`.

---

## E7 – E12 (offen)

**Überschrift am 2026-08-06 korrigiert** (Doku-Diät, gefundener Nebenfund): sie hieß noch „E3 – E12",
ein Überbleibsel aus der Zeit, bevor E3 begonnen hatte. E3–E6 haben inzwischen eigene Abschnitte oben;
diese Überschrift betrifft nur, was noch offen ist. Tasklisten stehen in `03-backlog.md`. Sie werden
hier erst beim Beginn des jeweiligen Epics ausgerollt, um diese Datei lesbar zu halten.

**Wirklich noch offene ADRs** (die bereits entschiedenen — ADR-006/007/022/023/024/029/030 und
**ADR-010** — sind am 2026-08-06 aus dieser Tabelle entfernt, Doku-Diät: sie stehen vollständig in
`05-entscheidungen.md`, das table hier hieß „offene ADRs" und listete sie fälschlich weiter):

| ADR     | Thema                                               | Epic             |
| ------- | --------------------------------------------------- | ---------------- |
| ADR-016 | fail-closed rechtfertigt den Verhaltensbruch aus F7 | E13 (`JR-13-07`) |
| ADR-009 | Append-Only-Erzwingung: Rechteentzug oder Trigger   | E2 (`JR-2-05`)   |
| ADR-008 | TSA-Ausfallverhalten bestätigen                     | E8 (`JR-8-04`)   |
| ADR-012 | Migrationspfad für Bestandsinstallationen           | E12              |

---

## Sessionprotokoll

> Alle bisherigen (zurückgemergten) Epic-Protokolle liegen im Archiv:
>
> | Zeitraum                               | liegt in                               |
> | -------------------------------------- | -------------------------------------- |
> | Planung bis Abschluss von E3           | `13-archiv-sessionprotokoll-bis-e3.md` |
> | E4 und E5 (2026-08-02 … 08-04)         | `18-archiv-e4-e5.md`                   |
> | E6, `JR-6-01`–`ADR-037`                | `21-archiv-e6-jr601-jr602a-notizen.md` |
> | E6, `JR-6-04`–`JR-6-08` plus Rückmerge | `23-archiv-e6.md`                      |
>
> Alle inhaltlich unverändert ausgegliedert, nach derselben Regel (`README.md`): das Protokoll eines
> Epics wandert ins Archiv, **sobald** es zurückgemergt ist — sonst wird diese Datei bei jeder Sitzung
> erneut zur vollen Pflichtlektüre. **Neue Einträge kurz und in Feldform** (Task, Commit, Testzahl,
> CI-Lauf, Entscheidungen, offen), kein Tabellenformat (Prettier-Padding-Kosten, siehe Archiv).

**E7, `JR-7-01`–`JR-7-04` (DEV), 2026-08-08.** Branch `claude/journaling-e7-worm-storage`.

- **`JR-7-01`** — `S3StorageConfig` (`packages/types/src/storage.types.ts`) um `objectLockMode?:
'COMPLIANCE'` und `objectLockRetainUntilDays?: number` erweitert. `S3StorageProvider.put()` hängt
  `ObjectLockMode`/`ObjectLockRetainUntilDate` (berechnet als Schreibzeitpunkt + Tage) nur an, wenn
  beide Werte gesetzt sind — unkonfiguriert identischer `Upload`-Aufruf wie vorher, bestehende
  Aufrufer unverändert. Config-Wiring in `config/storage.ts` (`STORAGE_S3_OBJECT_LOCK_MODE`,
  `STORAGE_S3_OBJECT_LOCK_RETAIN_DAYS`, wirft beim Import bei unvollständiger/ungültiger Kombination,
  passend zum bestehenden Stil dieser Datei) und `.env.example`.
- **`JR-7-02`** — Least-Privilege-IAM-Policy (JSON) im Deployment-Guide
  (`docs/enterprise/journaling/guide.md`, Abschnitt „Least-privilege credentials for the S3
  backend"): kein `s3:DeleteObject`/`s3:DeleteObjectVersion`/`s3:BypassGovernanceRetention`, `Deny` auf
  `s3:PutObjectRetention` unterhalb eines konfigurierbaren `s3:object-lock-remaining-retention-days`-
  Floors (AWS-Standardmuster „nur verlängern"). Der MinIO-Verifikationstest ist `JR-7-05` (TEST, nicht
  hier) — hier nur Dokumentation plus Policy-Artefakt.
- **`JR-7-03`** — Guide-Abschnitt „Local filesystem storage is not WORM" benennt die Schwäche
  unmissverständlich und dokumentiert Härtung (dediziertes Mount, restriktive Unix-Rechte,
  `chattr +i`). Zusätzlich Code-Hook in `LocalFileSystemProvider.put()`: best-effort `chattr +i` nach
  jedem Schreiben, nur wenn `STORAGE_LOCAL_HARDEN_IMMUTABLE=true` gesetzt ist, no-op außerhalb Linux,
  Fehler geloggt und nicht fatal. Dokumentiert und bewusst in Kauf genommen: das blockiert auch die
  eigene spätere Löschung derselben Datei (z.B. Retention-Ablauf), bis ein Operator `chattr -i` manuell
  ausführt — das ist das Abschreckungsmodell, kein Fehler.
- **`JR-7-04`** — Reihenfolge im Guide wie gefordert: „Retention under COMPLIANCE mode is
  irreversible — read this before choosing a period" steht **vor** „Choosing a retention period and
  enabling Object Lock" (beide im neuen Abschnitt „WORM Storage (Object Lock)", zwischen den
  bestehenden Abschnitten „Security Considerations" und „Health Check").

Nicht hier gemacht (bewusst, siehe Auftrag): `JR-7-05` (Tests gegen MinIO) und `JR-7-06` (Abnahme) —
andere Rolle, danach.

**Nachweise:** `corepack pnpm --filter @open-archiver/types build` grün; `corepack pnpm exec tsc
--noEmit` in `packages/backend` grün (keine Ausgabe); `corepack pnpm exec prettier --check` auf allen
geänderten `.ts`-Dateien und (nach `--write` nur dieser einen Datei) auf `guide.md` grün. **Kein**
voller Testlauf durchgeführt — es wurde keine neue Testdatei angelegt (die Tests dafür sind
`JR-7-05`), `suite-inventory.ts` also unverändert und nicht fällig. Migration nicht nötig (reine
Konfiguration, keine Schemaänderung). i18n nicht nötig (technischer Guide, kein UI-Text).

**Offene Annahmen für die Abnahme/TEST-Rolle:** (1) Namensgebung `objectLockMode`/
`objectLockRetainUntilDays` und die ENV-Var-Namen sind neu gewählt, nicht durch ADR vorgegeben — falls
`JR-7-05` andere Namen erwartet, ist das ein Diskussionspunkt, keine Bugmeldung. (2) Der numerische
Floor `365` im Beispiel-Policy-JSON ist ein Platzhalter, kein empfohlener Wert — er muss auf
`STORAGE_S3_OBJECT_LOCK_RETAIN_DAYS` abgestimmt sein. (3) `chattr +i` wurde nicht gegen ein echtes
Linux-Zielsystem verifiziert (dieser Host ist Windows) — nur `process.platform !== 'linux'`-Zweig und
Kompilierung geprüft.

**E7, `JR-7-05` (TEST), 2026-08-08.** Branch `claude/journaling-e7-worm-storage`, unabhängige
TEST-Sitzung nach `JR-7-01`–`JR-7-04`.

- **Testdatei:** `packages/backend/tests/adversarial/journal-worm-object-lock.adv.test.ts`.
  Klassifikation **`nightly`**, nicht `ci`: `docker-compose.yml` und `.github/workflows/ci.yml` haben
  kein MinIO (vor dem Schreiben geprüft, wie schon bei `JR-6-06`), also gate über
  `probeMinio()`/`OA_TEST_MINIO_ENDPOINT` **ohne Default** (anders als bei Postgres/Redis/Meilisearch
  — Begründung im Funktionskommentar: eine Suite, die irreversible Object-Lock-Objekte schreibt, darf
  nicht versehentlich gegen einen echten/produktionsnahen Endpoint laufen, nur weil `localhost`
  zufällig auflöst). `tests/support/infra.ts` bekommt dafür `probeMinio()` (gleiches Muster wie
  `probeRedis`/`probeMeilisearch`). MinIO für diese Sitzung selbst bereitgestellt: Docker-Container
  `oa-test-minio` (`minio/minio:latest`, kein persistentes Volume, Ports 9010/9011), Object-Lock-Bucket
  pro Testlauf frisch angelegt (`CreateBucketCommand` mit `ObjectLockEnabledForBucket: true`).
- **Alle vier Fälle grün gegen echtes MinIO** — gemessener Lauf (narrowed, `-t "JR-7-05"`, siehe
  Zählervorbehalt unten): `4 passed (554ms)`. Zwei davon halten aber **nicht wörtlich**, wie der
  Backlog-Satz sie formuliert, und das ist im Testfile selbst als Befund dokumentiert, nicht
  verschwiegen:
    - Fall 1 ("Überschreiben scheitert"): ein zweiter `S3StorageProvider.put()` auf denselben Key
      **schlägt nicht fehl** — er erzeugt eine neue, ebenfalls gesperrte Version (korrektes
      S3-Verhalten, Object Lock gilt pro Version). Die alte Version ist beweisbar unverändert
      (per `VersionId` abrufbar), aber `get()`/`IStorageProvider.get()` kennen keine `VersionId` — ein
      gewöhnlicher Lesezugriff nach einem solchen Überschreiben liefert stillschweigend die **neuen**
      Bytes, nicht das Original, ohne jeden Fehler.
    - Fall 2 ("Löschen scheitert, auch mit gewöhnlichen Credentials"): ein versionsspezifisches
      `DeleteObject` auf die gesperrte Version schlägt genuin fehl (die reale Garantie, kalibriert
      gegen ein ungesperrtes Kontrollobjekt mit denselben Credentials). Aber
      `S3StorageProvider.delete()` — was die Anwendung tatsächlich aufruft — übergibt keine
      `VersionId`; `DeleteObject` ohne Version erzeugt auf einem versionierten Bucket einen
      Delete-Marker, unabhängig von Object Lock. Der Aufruf **gelingt**, `exists()`/`get()` melden das
      Objekt danach als weg, die gesperrten Bytes bleiben aber physisch erhalten — verwaist, nur noch
      über die konkrete `VersionId` erreichbar, nicht über die normale Anwendungs-API.
    - Beide Funde betreffen die **Anwendungsseite** (`S3StorageProvider`s versionsunabhängige
      `get()`/`delete()`-Signatur), nicht MinIO/S3s Durchsetzung selbst — die versionsscharfe
      Object-Lock-Garantie hält nachweislich (Fälle 3+4 unten, plus die kalibrierten Teilschritte in
      Fall 1+2). **Relevant für `JR-7-06`/E8**, nicht hier behoben (TEST-Rolle).
    - Fall 3 (Retention wird gesetzt) und Fall 4 (Verkürzung scheitert, Verlängerung als Kalibrierung
      gelingt) halten **wörtlich wie im Backlog formuliert** — echtes `GetObjectRetentionCommand`/
      `PutObjectRetentionCommand` gegen echtes MinIO.
- **`tests/support/suite-inventory.ts`** aktualisiert: `adversarial` `expectedFiles` 8→9,
  `expectedTests.nightly` 3→7 (`ci`/`manual` unverändert — die neue Suite trägt 0 zu `ci` bei, weil sie
  unter der Standardklassenauswahl nicht läuft).
- **Volllauf-Nachweis (`ci`-Klasse, echt, unnarrowed):** `corepack pnpm exec dotenv -- vitest run`
  (kein `OA_TEST_CLASSES`-Override, also Standardauswahl `ci`) — **1320 passed | 2 failed | 13
  skipped**, 113 Dateien, 677,65s. `[TEST-EXECUTED] unit: ci 1119/1119 · integration: ci 133/133 ·
adversarial: ci 70/70` — exakt wie in `suite-inventory.ts` erwartet, kein Zähler durch diese Sitzung
  verändert (die neue Suite ist `nightly`-only). Die 2 Fehlschläge, beide **nicht** durch `JR-7-05`
  verursacht: 1. `m365-range-refresh-cli.int.test.ts` — Artefakt der eigenen Testumgebung dieser Sitzung: eine
  für diesen Lauf neu angelegte Root-`.env` (gitignored, nicht committet) enthält
  `SMTP_INGRESS_DATABASE_URL`; das CLI-Skript lädt `dotenv/config` selbst neu und überschreibt
  damit den vom Test bewusst auf `PATH`/`SystemRoot` geleerten Kind-Prozess-Environment. Kein
  Produktionscode-Defekt, verifiziert durch Lesen von `runCli()`s `baseEnv`. 2. `journal-soak.adv.test.ts`s `ci`-Smoke-Fall hängt 600s unter voller Suite-Parallellast — **neuer
  Befund F67** (siehe `09-befunde-bestandscode.md`), per `git stash` kalibriert als **nicht**
  durch `JR-7-05` verursacht: derselbe Test isoliert (ohne die drei geänderten/neuen Dateien)
  lief in 1133ms grün.
- **Ein echter Volllauf mit `OA_TEST_CLASSES=ci,nightly`** (für die zählerverifizierte
  `nightly`-Bestätigung der neuen Suite, `7` erwartet: `4` neu + `3` bestehend) wurde **zweimal**
  versucht und beide Male durch denselben Mechanismus wie F67 blockiert (dort im 100.000er-`nightly`-
  Fall von `journal-soak.adv.test.ts`, `no SMTP reply within 600000ms`) — nach >20 bzw. >30 Minuten
  ohne neue Log-Zeile per `taskkill /F /T` abgebrochen. **Die exakte `nightly`-`TEST-EXECUTED`-Zählung
  ist daher in dieser Sitzung nicht über den vollen, zählerverifizierten Pfad bestätigt** — nur über
  den oben genannten narrowed run (`-t "JR-7-05"`), der laut Harness-Konvention "verified NOTHING"
  bezüglich der Zähler ist, die vier Testkörper selbst aber echt und beobachtet beweist. Wer
  `JR-7-06` abnimmt und einen zählerverifizierten `nightly`-Lauf braucht, sollte ihn auf einem weniger
  ausgelasteten Host oder echtem Linux-CI wiederholen (F67 nennt den vermuteten Zusammenhang).
- **Commits:** `85f7bae` (Testdatei, `probeMinio()`, `suite-inventory.ts`), plus diese
  Doku-Aktualisierung.

**Nachweise:** siehe Zahlen oben, wörtlich aus den jeweiligen Läufen zitiert, nicht geschätzt. Kein
`--silent` verwendet. `.oa-test-storage/` (bereits vor dieser Sitzung im Arbeitsbaum, unverändert) und
die neu angelegte Root-`.env` sind beide gitignored und nicht Teil der Commits.

**Offene Punkte für `JR-7-06`:** (1) die beiden Lese-/Löschpfad-Funde aus Fall 1+2 oben (Entscheidung:
akzeptieren mit Dokumentation, oder `S3StorageProvider`/`IStorageProvider` um `VersionId`-Unterstützung
erweitern — letzteres wäre auch für E8s Anchoring-Bucket relevant). (2) F67 (Soak-Hang) ist unabhängig
von `JR-7-05`s Korrektheit, aber ein CI-Zuverlässigkeitsrisiko, das vor einer Aussage über die
`nightly`-Klasse insgesamt geklärt werden sollte. (3) Namens-/Floor-Annahmen aus der `JR-7-01`–`JR-7-04`-
Sitzung (oben) bleiben offen, unverändert durch diese Sitzung.

**E7, Auftraggeber-Entscheidung zu Punkt (1), 2026-08-08.** Branch `claude/journaling-e7-worm-storage`,
reine Dokumentationssitzung, kein Code, keine Tests, keine Migration.

- **Entscheidung:** akzeptieren, nur dokumentieren — kein Code-Fix in E7. Die beiden oben
  beschriebenen Abweichungen vom wörtlichen Akzeptanzkriterium ("Überschreiben scheitert" /
  "Löschen scheitert") bleiben bestehen: tatsächliches Verhalten ist S3-Versionierung (eine neue
  gesperrte Version bzw. ein Delete-Marker; die physischen Bytes/alten Versionen bleiben nachweislich
  erhalten und durch Object Lock geschützt), aber die normale Anwendungsansicht (`get()`/`exists()`
  ohne `VersionId`) zeigt das nicht an — sie meldet schlicht "weg" bzw. "neuer Inhalt".
- **Dokumentiert in `docs/enterprise/journaling/guide.md`**, neuer Abschnitt „What Object Lock
  protects — and what the application does not show you" zwischen „Least-privilege credentials for
  the S3 backend" und „Local filesystem storage is not WORM". Kernaussage für den Betreiber ohne
  Codekenntnis: die Daten sind physisch sicher, aber die App zeigt das nicht direkt an; eine echte
  Prüfung der Garantie muss über S3-Versionierung (`ListObjectVersions`/`VersionId`-scharfes
  `GetObject`/`GetObjectRetention`) laufen, nicht über die normale Anwendungsansicht.
- Damit ist Punkt (1) der offenen Punkte oben geklärt. (2) F67 und (3) Namens-/Floor-Annahmen bleiben
  offen für `JR-7-06`.
- **Nicht Teil dieser Sitzung:** `JR-7-06` (Abnahme E7) selbst — das bleibt Aufgabe einer
  unabhängigen Rolle.
