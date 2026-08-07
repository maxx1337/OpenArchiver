# Status

**Diese Datei ist die verbindliche Fortschrittsquelle.** Sie wird am Ende **jeder** Session
aktualisiert — auch wenn nichts fertig wurde. Ein nicht aktualisierter Status ist schlimmer als
keiner, weil er Fortschritt behauptet, der nicht existiert.

Legende: `[ ]` offen · `[~]` in Arbeit · `[x]` fertig und abgenommen · `[!]` blockiert

**Letzte Aktualisierung:** 2026-08-07 — **Details im Sessionprotokoll unten, jüngste Einträge
zuletzt.** Kurz: E6 läuft (`JR-6-01`…`JR-6-06` erledigt; `JR-6-02` insgesamt code-fertig,
TEST-Abnahme separat unter `JR-6-08`), `JR-6-07` läuft (unabhängige TEST-Sitzung). **Rollentrennung
PO/DEV/TEST ist wieder aktiv** (aufgehoben während `JR-6-04`/`JR-6-05`, siehe dortige Einträge) —
`JR-6-06` und `JR-6-07` sind wieder von der Rolle TEST unabhängig umgesetzt, nicht vom PO selbst.
Der WIP-Zweig `wip/journaling-jr-6-04` ist gelöscht (lokal + remote), sein Inhalt war vollständig in
`JR-6-04` aufgegangen. **Branch:** `claude/journaling-e6-phase-b-worker` (Epic-Zweig; E1, E13, E2, E3,
E4 und E5 sind zurückgemergt). Nummernkreise nach **ADR-032** reserviert: ADR-033–036 (alle vergeben)
plus Nachschub **ADR-037–040** (`e8256f7`, Integrationszweig; **037** vergeben, 038 mit `JR-6-04`
gefüllt, 039–040 offen), F59–F70 (F59, F61, F65 vergeben).

> **CI-Lücke, Entscheidung 2026-08-07 (kein ADR, Werkzeug-Policy):** GitHub Actions erzeugt seit
> `37b471d` keine zuverlässigen Läufe mehr für diesen Zweig (Ursache außerhalb des Codes, siehe
> `JR-6-05`-Eintrag unten). Statt auf jeden Push einen entfernten CI-Lauf abzuwarten: **`pnpm gate`
> lokal vor jedem Push**, echtes GitHub-CI wird gebündelt **einmal vor dem Rückmerge** in den
> Integrationszweig angefordert. `act` (lokaler GitHub-Actions-Runner) wurde geprüft — nicht
> installiert, bewusst nicht eingerichtet, weil `pnpm gate` dieselben drei Fehlerklassen bereits
> fängt, die die CI-Wartezeit tatsächlich gekostet haben (siehe `07-session-handover.md` unter
> „Billig verifizieren").

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

| Reihenfolge | Epic | Titel                              | Status                                                                                                                                    | Fertig / Gesamt                                                                                                                 |
| ----------- | ---- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| —           | E0   | Planung, Doku, Agent-Infrastruktur | **fertig**                                                                                                                                | 6 / 6                                                                                                                           |
| 1           | E1   | Test- und CI-Fundament             | **abgenommen + gemergt**, Nacharbeit `JR-1-05c` erledigt                                                                                  | 10 / 10                                                                                                                         |
| 2           | E13  | IAM-Autorisierung härten           | **abgenommen + gemergt** (`JR-13-09c`, 4. Runde), Folge-Tasks offen                                                                       | 9 / 9 + 8 / 8 Nacharbeit                                                                                                        |
| 3           | E2   | Ledger und Hash-Chain              | **abgenommen + gemergt** (`JR-2-10a`, 2. Runde, unabhängig)                                                                               | 11 / 11                                                                                                                         |
| 4           | E3   | Spool und Acceptance-Contract      | **abgenommen + gemergt** (`JR-3-08`, 21/21, unabhängig)                                                                                   | 9 / 9                                                                                                                           |
| 5           | E4   | `smtp-ingress`-Service             | **abgenommen + gemergt** (`JR-4-13`, 2026-08-04, unabhängige TEST-Sitzung, Protokoll `16-abnahme-e4.md`)                                  | 21 / 21 + Abnahme. Gezählt werden die **Backlog-IDs** (ADR-021): `JR-4-05` gilt mit `a`–`c` als erledigt, `JR-4-06` mit `a`/`b` |
| 6           | E5   | Journal-Report-Parser              | **abgenommen + gemergt** (`JR-5-09`, Parallelsession B, Merge `107346d`)                                                                  | 9 / 9                                                                                                                           |
| 7           | E6   | Phase-B-Worker                     | **in Arbeit** (`JR-6-01`, `JR-6-03`–`JR-6-06` erledigt; `JR-6-02` code-fertig mit `a`+`b`, TEST-Abnahme unter `JR-6-08`; `JR-6-07` läuft) | 5 / 8 + `JR-6-02` code-fertig. Gezählt werden die **Backlog-IDs** (ADR-021): `JR-6-02` gilt erst mit Abnahme als fertig         |
| 8           | E7   | WORM-Storage                       | offen                                                                                                                                     | 0 / 6                                                                                                                           |
| 9           | E8   | Anchoring                          | offen                                                                                                                                     | 0 / 6                                                                                                                           |
| 10          | E9   | `verify`-CLI                       | offen                                                                                                                                     | 0 / 8                                                                                                                           |
| 11          | E10  | Completeness-Monitoring            | offen                                                                                                                                     | 0 / 8                                                                                                                           |
| 12          | E11  | Compliance-Features                | offen                                                                                                                                     | 0 / 10                                                                                                                          |
| 13          | E12  | Rollout und Dokumentation          | offen                                                                                                                                     | 0 / 9                                                                                                                           |

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

## E6 — Phase-B-Worker (**in Arbeit**, Zweig `claude/journaling-e6-phase-b-worker`)

Kriterien in `03-backlog.md`. Vor der ersten Scheibe sind nach **ADR-032** die Nummernkreise auf dem
Integrationszweig reserviert worden (`fc15edc`): **ADR-033–036** und **F59–F70**. `ADR-010` ist
ausdrücklich **nicht** Teil der Reservierung — die Entscheidung „`processEmail` erweitern oder eigener
Journaling-Pfad" trägt diese Nummer seit dem 2026-07-27 und wird in `JR-6-02` gefüllt. Nachschub
**ADR-037–040** ist am 2026-08-06 auf dem Integrationszweig nachreserviert worden (`e8256f7`), weil
033–036 erschöpft waren; **037** ist mit dem `duplicate_marker`-Event-Typ gefüllt (siehe `JR-6-03`
unten und `05-entscheidungen.md`).

- [x] `JR-6-01` — `journal-inbound`-Worker als eigener Prozess, `start:journal-worker`, Queue-Parameter
      begründet (2026-08-05, `d0f4840`)
- [~] `JR-6-02` — Verarbeitung Spool → Parser → Storage → `archived_emails` → Index → Spool frei.
  **Aufgeteilt nach ADR-021:**
    - [x] `JR-6-02a` — **ADR-010 entschieden** (`41068aa`) plus das Tor, das entscheidet, ob eine
          Spool-Datei überhaupt archiviert werden darf (`fba499c`)
    - [x] `JR-6-02b` — **Code fertig, Abnahme durch TEST offen.** Erledigt: **ADR-033** (Owner-Auflösung
          für `plain_bcc`/`ndr`/`parse_failed`), **ADR-034** (Fan-out über jeden aufgelösten Owner,
          Backend-Adapter auf `processEmail()`, Indexierung, Spool-Freigabe als Löschen) und **ADR-035**
          (der Ende-zu-Ende-Test ist automatisiert, `journal-phase-b-e2e.int.test.ts`, gegen echtes
          Postgres über die bestehende Harness-Bindung und echtes Meilisearch über einen neuen
          CI-Service-Container, zweimal kalibriert). `runPhaseBPipeline()` verbindet alles; **Ende-zu-Ende
          ist jetzt ein Test, kein manueller Nachweis mehr.**
- [x] `JR-6-03` — Idempotenz: ein Objekt, **drei** Ledger-Zeilen — zwei Phase-A-Receipts plus
      angehängter Marker (2026-08-06, `5e9551f`; Kriterium im Backlog korrigiert, der Ledger ist
      append-only). Marker trägt seit **ADR-037** einen eigenen `event_type`
      (`duplicate_marker`), nicht mehr `'receipt'`
- [x] `JR-6-04` — Spool-Reconciler (Redis ist Optimierung, nicht Autorität) (2026-08-06, ADR-038)
- [x] `JR-6-05` — Hash-vor-Verschlüsselung festschreiben und testen
- [x] `JR-6-06` — TEST: Object-Store-Ausfall (2026-08-07, `e72b48a`, unabhängige TEST-Sitzung)
- [~] `JR-6-07` — TEST: Soak, 100.000 Nachrichten (`nightly` plus `ci`-Smoke, F13-Frist heben) —
  läuft, unabhängige TEST-Sitzung
- [ ] `JR-6-08` — Abnahme E6

> \*\*Die technischen Notizen zu `JR-6-01` (drei Entscheidungen, zwei Nebenwirkungen) und
> `JR-6-02a` (ADR-010-Verweis, das Tor mit seinen fünf Urteilen, der gefundene Nullish-Fehler)
> liegen seit dem 2026-08-06 unverändert in
> [`21-archiv-e6-jr601-jr602a-notizen.md`](21-archiv-e6-jr601-jr602a-notizen.md) (Doku-Diät,
> Tokenbudget) — beide Tasks sind oben bereits als `[x]` erledigt markiert.

> **ADR-033 ist entschieden (2026-08-05, erster Teil von `JR-6-02b`): Owner-Auflösung für die drei
> Ergebnisarten ohne Journal-Report-Envelope.** Volle Begründung (Tabelle „was die drei schwächeren
> Ergebnisarten tragen", die Verneinung „`envelopeRcpt` wird nie als Owner benutzt", warum der
> kopfzeilen-abgeleitete Envelope schwächer aber echt ist) steht **in gleicher oder größerer Tiefe** in
> `05-entscheidungen.md` unter **ADR-033** — am 2026-08-06 dorthin verschoben, nicht gekürzt (Doku-Diät).

> **F61** (der zurückgesetzte Socket, der den ganzen Empfänger abriss, weil die Ablehnungspfade keinen
> `error`-Handler anhängten) ist die tatsächliche Ursache der roten Läufe, die zweimal F59 zugeschrieben
> wurden — inklusive des Lehrsatzes über den Diagnosewert einer Zusicherung. Volle Fassung (Schwere,
> Fundort, Regressionstest, die vier Diagnoseschritte, die plattformunabhängige Reproduktion) steht **in
> gleicher oder größerer Tiefe** in `09-befunde-bestandscode.md` unter **F61** — am 2026-08-06 dorthin
> verschoben, nicht gekürzt (Doku-Diät).

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

> **Hier stehen nur die Zeilen des laufenden Epics — das ist E6, unten.** E4 und E5 sind bereits
> abgenommen und zurückgemergt; ihre Protokolle liegen im Archiv.
>
> | Zeitraum                       | liegt in                               |
> | ------------------------------ | -------------------------------------- |
> | Planung bis Abschluss von E3   | `13-archiv-sessionprotokoll-bis-e3.md` |
> | E4 und E5 (2026-08-02 … 08-04) | `18-archiv-e4-e5.md`                   |
>
> Beide inhaltlich unverändert ausgegliedert.

> **Diese Datei ist am 2026-08-04 von 230 000 auf unter 50 000 Zeichen geschrumpft** — die beiden
> Protokolle machten 195 000 davon aus. Die Regel dahinter steht im `README.md`: das Protokoll eines
> Epics wandert ins Archiv, **sobald** es zurückgemergt ist. Sie wurde bei E4/E5 eingehalten, weil die
> Datei sonst bei jeder Sitzung wieder 64 000 Tokens Pflichtlektüre erzeugt hätte.

> **Kein Tabellenformat für Einträge, seit dem 2026-08-03.** Prettier richtet Tabellen auf die längste
> Zelle aus, und bei Einträgen dieser Länge kostet das Padding ein Vielfaches des Inhalts — damals
> gemessen: 147 908 Zeichen Inhalt, 346 564 nach dem Ausrichten. Ein Eintrag ist deshalb ein Abschnitt.
> **Neue Einträge kurz und in Feldform** (Task, Commit, Testzahl, CI-Lauf, Entscheidungen, offen).

### Sessionprotokolle `JR-6-01` bis `ADR-037` — verschoben

> Die Protokolle der abgeschlossenen E6-Scheiben (`JR-6-01`, `JR-6-02a`, `JR-6-02b`, die E2E-Automatisierung,
> das Pre-Push-Gate, `F65`, die Doku-Diät, `JR-6-03`, `ADR-037`) stehen seit dem 2026-08-06 in
> `21-archiv-e6-jr601-jr602a-notizen.md` — inhaltlich unverändert, verschoben als Budgetausgleich für den
> `JR-6-04`-Eintrag. Entscheidungen: `05-entscheidungen.md`. Befunde: `09-befunde-bestandscode.md`.

### 2026-08-06 — `JR-6-04`: Spool-Reconciler

- **Rolle:** PO im Eigenbau. Der DEV-Subagent lief mitten in der Scheibe in sein Wochenlimit; der
  Auftraggeber hat daraufhin ausdrücklich angewiesen, das Epic selbst fertigzustellen. Die
  Rollentrennung ist damit für den Rest von E6 aufgehoben — **was bedeutet, dass `JR-6-08` nicht von
  mir abgenommen werden kann** (siehe „Offen")
- **Aufgesetzt auf:** dem gesicherten WIP des DEV-Agenten (`wip/journaling-jr-6-04`) — Reconciler,
  Backend-Adapter, Worker-Registrierung und Optionen samt Tests waren fertig, es fehlten der
  Integrationstest, ADR-038, das Inventar und die Doku
- **Entscheidungen:** **ADR-038** (wiederkehrender Job auf der bestehenden Queue, kein eigener
  Prozess, nicht im `sync-scheduler`). Dazu **eine eigene, kleine Naht:** `enqueueForReconcile()` ist
  aus `journal-inbound.processor.ts` in `journal-reconcile-enqueue.ts` gezogen worden
- **Der Grund dafür ist gemessen, nicht vermutet:** der Prozessor baut `StorageService` im
  Modulscope, und `config/storage.ts` wirft **beim Import** ohne `STORAGE_TYPE` (**F63 Fall 1**). Der
  Integrationstest von dort zu importieren riss **23 von 109 Testdateien** mit
  `Invalid STORAGE_TYPE: undefined` ab. Eine Funktion, deren einzige Abhängigkeit Redis ist, hängt
  jetzt auch im Importgraphen nicht mehr am Storage
- **Testzahl:** +17 gegenüber `ADR-037`s Stand (+15 `unit`: 11 in `journal-inbound.options.test.ts`
  durch drei `it.each`-Blöcke, 4 in `reconciler.test.ts`; +2 `integration` im neuen
  `journal-spool-reconciler.int.test.ts`). Volllauf **1318 passed | 8 skipped** bei 109 Dateien,
  Exit 0, `unit ci 1119/1119 · integration ci 130/130 · adversarial ci 69/69`
- **Der Integrationstest belegt zwei Aussagen, die nur echtes BullMQ hergibt:** eine leere Queue wird
  aus Spool und Ledger wieder gefüllt (drei Einträge, je unter eigener deterministischer Job-Id, mit
  Ein-Feld-Payload), und ein im `failed`-Set gestrandeter Job wird **retried** — wobei der Test
  zuvor **selbst messt**, dass ein blankes `add()` ihn `failed` lässt. Quarantäne und Advisory-Lock
  sind bewusst **nicht** wiederholt: `JR-4-18` deckt sie gegen echtes Postgres und echte Platte ab
- **Queue-Isolation:** testeigener Queue-Name je Lauf. `journal-inbound-worker.int.test.ts` verbietet
  ausdrücklich, die geteilte Queue zu leeren („a queue that a later epic will feed"); ein eindeutig
  benannter Queue-Name **ist** eine geleerte Queue und kollidiert unter Vitests parallelen Dateien mit
  nichts. Dafür nimmt `enqueueForReconcile()` die Queue als Parameter mit Produktions-Default
- **Offen:** `JR-6-05`–`JR-6-07`. **`JR-6-08` (Abnahme E6) ist durch diese Scheibe blockiert:** wer
  implementiert hat, kann nicht unabhängig abnehmen — genau dieser Mechanismus hat in E13 vier Runden
  lang echte Defekte gefunden. Braucht eine eigene TEST-Sitzung
- **Nicht getan, absichtlich:** F64s Ursache, F62, F60, F43, F39, F42, F17(b)

### 2026-08-06 — `JR-6-05`: Hash über Plaintext, Verschlüsselung danach

- **Rolle:** PO im Eigenbau (Rollentrennung aufgehoben, siehe `JR-6-04`)
- **Test:** `packages/backend/tests/integration/journal-hash-before-encryption.int.test.ts` — echte
  Pipeline, echtes Postgres, Verschlüsselung **eingeschaltet**; `indexBatch` ist ein Stub, weil die
  Aussage nichts mit Suche zu tun hat und die Anforderung so bei Postgres bleibt
- **Was er belegt:** die Bytes im Storage sind wirklich Chiffrat (Präfix `oa_enc_idf_v1::`, eigener
  Hash **verschieden** vom Ledger-Wert, länger als der Klartext) → entschlüsselt → **byteidentisch**
  zur Wire-Fixture → neu gehasht = Ledger-`content_sha256` = `archived_emails.storage_hash_sha256`,
  und `size_bytes` ist die **Klartext**länge, nicht die gepolsterte Chiffratlänge
- **`ci.yml` setzt jetzt `STORAGE_ENCRYPTION_KEY`** (64 Hex, testonly). Ohne Schlüssel sind Klartext
  und gespeicherte Bytes dieselben Bytes, „Rehash = Ledger-Wert" gilt dann **unabhängig von der
  Reihenfolge** — der Test meldet das per `coverageNotice` namentlich („HASH-BEFORE-ENCRYPTION
  ORDERING IS NOT verified") statt dasselbe Grün zu drucken wie ein Lauf, der es bewiesen hat. Kein
  `skipIf`
- **Kalibriert:** mit Schlüssel „the ordering claim is verified this run" (1007 Chiffratbytes); ohne
  Schlüssel die Nicht-geprüft-Meldung. Der **invertierte** Fall (Hash über Chiffrat) ist strukturell
  unmöglich zu bestehen — der Test behauptet gleichzeitig `storage_hash = rehash = wireDigest` und
  `hash(Chiffrat) ≠ wireDigest` —, aber **nicht gemessen**, weil dafür Produktionscode in
  `processEmail()` verdreht werden müsste. Offen benannt statt als gemessen ausgegeben
- **Ein Fehler auf dem Weg, gemessen statt geraten:** die erste Fassung setzte `STORAGE_*` im
  Modulscope und erwartete, dass der dynamische Import sie sieht. Tut er nicht — eine **statische**
  Importkante zieht `config/storage.ts` vorher herein, die Datei landete im Ambient-Root und war
  **unverschlüsselt**. Sichtbar wurde es als `ENOENT`; die stille Hälfte wäre schlimmer gewesen, denn
  ein unverschlüsseltes Objekt erfüllt „Rehash = Ledger-Wert" ebenfalls. Konfiguration wird jetzt
  **gelesen**, nicht gesetzt
- **Testzahl:** +1 `integration` (1 Datei). Volllauf **1319 passed | 8 skipped** bei 110 Dateien,
  Exit 0, `unit ci 1119/1119 · integration ci 131/131 · adversarial ci 69/69`
- **CI-Lauf: offen.** GitHub Actions erzeugt seit `37b471d` keine Läufe mehr für diesen Zweig (dieser
  Lauf wurde nach 15 Minuten abgebrochen, für `0f2db70` und `afa8200` entstand gar keiner). Das
  Repository ist öffentlich, es gibt keine `concurrency`-Regel und kein `timeout-minutes` — Ursache
  liegt außerhalb dieses Codes. **Der CI-Beleg für `JR-6-04` und `JR-6-05` fehlt damit** (F48: lokal
  grün ist nicht der ganze Beleg)
- **Offen:** `JR-6-06`, `JR-6-07`, `JR-6-08`

### 2026-08-07 — `JR-6-06`: Object-Store-Ausfall-Test

- **Rolle:** TEST, unabhängige Sitzung — **Rollentrennung ab dieser Scheibe wieder aktiv** (war
  während `JR-6-04`/`JR-6-05` aufgehoben)
- **Commit:** `e72b48a`, gepusht auf `claude/journaling-e6-phase-b-worker`
- **Simulation:** kein echtes MinIO/S3 (Repo hat keins) — stattdessen ein Fake-`ArchiveObjectPort`,
  der `{kind:'error'}` liefert, in exakt der Form, in die `IngestionService.processEmail()` jeden
  echten Storage-Fehler (inklusive `ECONNREFUSED`) über `ProcessEmailError` bereits umwandelt.
  Aus Sicht von `runPhaseBPipeline()` nicht unterscheidbar von einem echten Ausfall (ADR-010s Port
  trägt genau das). Offen benannte Lücke: ein echter S3/MinIO-`ECONNREFUSED` durch
  `S3StorageProvider` selbst ist nicht geprüft
- **Zwei Tests, drei Bedingungen:** (1+3) ein beobachtet fehlgeschlagener `runPhaseBPipeline()`-Aufruf
  hindert eine neue SMTP-Transaktion nicht an `250 … queued as N`, der hängengebliebene Eintrag bleibt
  unangetastet, Kette sauber. (2+3) zwei Backlog-Einträge scheitern unter echtem BullMQ-Retry, danach
  übernimmt `runSpoolReconcile()` (`JR-6-04`/ADR-038) — kein manuelles Retry — beide laufen zu
  `completed`, Kette vor/nach Erholung neu verifiziert, 0 Findings
- **Windows-Plattformlücke wie bei `journal-smtp-accept-e2e.int.test.ts`:** Verzeichnis-fsync ist
  POSIX-only, `accept()` antwortet auf diesem Host mit `451` statt `250` — per `coverageNotice`
  branch-geprüft benannt, nicht stillschweigend geskippt. Linux-CI durchläuft den `250`-Zweig
- **Testzahl:** +2 `integration` (1 Datei, `journal-object-store-outage.int.test.ts`), `suite-inventory.ts`
  aktualisiert (`expectedFiles` 25→26, `integration ci` 131→133). **Unabhängig nachgerechnet (PO,
  dieser Eintrag):** Volllauf **1321 passed | 8 skipped** bei 111 Dateien, Exit 0 — `unit ci 1119/1119
· integration ci 133/133 · adversarial ci 69/69`, deckungsgleich mit dem TEST-Bericht
- **CI-Lauf:** nicht ausgelöst/geprüft — bekanntes offenes Problem seit `37b471d` (siehe „CI-Lücke"
  oben), keine neue Erkenntnis dieser Scheibe
- **Bewusst nicht getan:** kein echtes MinIO/S3 in `docker-compose.yml`/`ci.yml` ohne explizite
  Entscheidung, keine SIZE-Grenzfall-Tests (anderer Testplan-Abschnitt), `F63`/`F64` nicht angefasst
- **Offen:** `JR-6-07`, `JR-6-08`
