# Status

**Diese Datei ist die verbindliche Fortschrittsquelle.** Sie wird am Ende **jeder** Session
aktualisiert — auch wenn nichts fertig wurde. Ein nicht aktualisierter Status ist schlimmer als
keiner, weil er Fortschritt behauptet, der nicht existiert.

Legende: `[ ]` offen · `[~]` in Arbeit · `[x]` fertig und abgenommen · `[!]` blockiert

**Letzte Aktualisierung:** 2026-08-06 — **Details im Sessionprotokoll unten, jüngste Einträge
zuletzt.** Kurz: E6 läuft (`JR-6-01`, `JR-6-02a`, `JR-6-02b`, `JR-6-03` erledigt; `JR-6-02` insgesamt
code-fertig, TEST-Abnahme offen), plus das Pre-Push-Gate und F65 (beide Werkzeug-Infrastruktur/
Nacharbeit, keine Backlog-Tasks). **Branch:** `claude/journaling-e6-phase-b-worker` (Epic-Zweig; E1,
E13, E2, E3, E4 und E5 sind zurückgemergt). Nummernkreise nach **ADR-032** reserviert: ADR-033–036
(alle vergeben), F59–F70 (F59, F61, F65 vergeben).

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
| 7           | E6   | Phase-B-Worker                     | **in Arbeit** (`JR-6-01`, `JR-6-03` erledigt; `JR-6-02` code-fertig mit `a`+`b`, TEST-Abnahme offen)     | 2 / 8 + `JR-6-02` code-fertig. Gezählt werden die **Backlog-IDs** (ADR-021): `JR-6-02` gilt erst mit Abnahme als fertig         |
| 8           | E7   | WORM-Storage                       | offen                                                                                                    | 0 / 6                                                                                                                           |
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

## E6 — Phase-B-Worker (**in Arbeit**, Zweig `claude/journaling-e6-phase-b-worker`)

Kriterien in `03-backlog.md`. Vor der ersten Scheibe sind nach **ADR-032** die Nummernkreise auf dem
Integrationszweig reserviert worden (`fc15edc`): **ADR-033–036** und **F59–F70**. `ADR-010` ist
ausdrücklich **nicht** Teil der Reservierung — die Entscheidung „`processEmail` erweitern oder eigener
Journaling-Pfad" trägt diese Nummer seit dem 2026-07-27 und wird in `JR-6-02` gefüllt.

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
- [x] `JR-6-03` — Idempotenz: ein Objekt, zwei Receipts, `duplicate_of` (2026-08-06, `5e9551f`)
- [ ] `JR-6-04` — Spool-Reconciler (Redis ist Optimierung, nicht Autorität)
- [ ] `JR-6-05` — Hash-vor-Verschlüsselung festschreiben und testen
- [ ] `JR-6-06` — TEST: Object-Store-Ausfall
- [ ] `JR-6-07` — TEST: Soak, 100.000 Nachrichten (`nightly` plus `ci`-Smoke, F13-Frist heben)
- [ ] `JR-6-08` — Abnahme E6

> **`JR-6-01` ist erledigt (Rolle DEV, 2026-08-05), und drei Entscheidungen daraus gelten weiter.**
>
> **(1) Der Queue-Vertrag liegt in `packages/journaling`, nicht neben der Queue.** `apps/smtp-ingress`
> reiht den Phase-B-Hinweis nach dem `250` ein (Architektur §3 Schritt 7) und darf nicht aus
> `packages/backend` importieren — eine Konstante neben dem `Queue`-Objekt hätte beide Seiten über ein
> kopiertes Stringliteral übereinstimmen lassen. Das ist die Form von **F46**: zwei Dinge, die passen
> mussten, passten nur per Konvention, und nichts schlug fehl, als sie aufhörten zu passen.
> `packages/journaling/src/phase-b/queue-contract.ts` hat **keinen** BullMQ-Import — der Reconciler
> muss entscheiden können, was einzureihen ist, ohne einen Redis-Client zu brauchen.
>
> **(2) Die Payload trägt genau ein Feld, und das ist eine Zusicherung, keine Sparsamkeit.** Nur
> `spoolTxId`. Alles Weitere — `seq`, `chainScopeId`, `journalingSourceId` — kommt über
> `LedgerLookup.findBySpoolTxIds` aus derselben txid. Eine Kopie von `seq` in der Payload wäre eine
> **zweite Quelle** für einen Wert, den der Ledger schon hält, und eine Payload, die ihrer Ledger-Zeile
> widerspricht, wäre **nicht entdeckbar**: der Worker archivierte gegen den kopierten Wert und niemand
> verglich die beiden. Der Reconciler, der Jobs allein aus Platte und Ledger baut, könnte diese Felder
> ohnehin nicht anders herleiten — eine breitere Payload würde also bedeuten, dass die beiden
> Einreihungswege **verschiedene Jobs** für denselben Spool-Eintrag erzeugen.
>
> **(3) Der Processor wirft, statt zu quittieren.** Phase B existiert noch nicht (`JR-6-02`, ADR-010
> offen). Ein **fertiger** Phase-B-Job behauptet, die Nachricht sei archiviert und durchsuchbar — und
> genau das liest `JR-6-04`s Reconciler, um einen Spool-Eintrag liegen zu lassen. Ein Platzhalter, der
> loggt und zurückkehrt, wäre kein harmloses Gerüst, sondern würde diese Behauptung **falsch und grün**
> aufstellen. Das ist die Form von `JR-4-10` (zwei nutzlose Testfassungen, beide grün) und von **F48**
> (zwölf rote CI-Läufe hinter einem Schritt, der nie lief): die Abwesenheit von Arbeit und ihr Erfolg
> drucken gleich.

**Zwei Dinge, die `JR-6-01` an Nebenwirkungen hat und die eine Folgesitzung kennen muss:**

- **Der Worker ist absichtlich nicht in `pnpm start:workers`.** Begründung wie bei
  `apps/smtp-ingress`, das nicht in `start:oss` steckt: der Journaling-Empfänger ist ein
  Opt-in-Subsystem, die drei Worker in `start:workers` braucht jede Installation. **Der Preis ist
  benannt, nicht verschwiegen:** wer den Ingress ausrollt und diesen Prozess vergisst, bekommt Post,
  die **angenommen und nie archiviert** wird — nichts bricht laut, das `250` ist ehrlich, der Spool
  wächst. Die Gegenmittel liegen bewusst anderswo: Spool-Tiefe und Phase-B-Backlog sind
  Monitoring-Signale (**E10**), die Verdrahtung, die beide zusammen startet, ist **E11**.
- **Die CI hat jetzt einen `valkey`-Service** — die erste Suite des Repositorys, die Redis statt
  Postgres braucht, mitsamt `probeRedis()` im Harness. Er hat **kein Passwort**, und das ist eine
  Einschränkung: ein Actions-Service-Container nimmt kein `command`, also ist `--requirepass` dort
  nicht setzbar. Der AUTH-Pfad wird lokal ausgeübt (`docker-compose.yml` setzt das Passwort), und
  `probeRedis()` ist absichtlich ein reiner TCP-Connect, damit ein **falsches** Passwort als
  Verbindungsfehler ankommt und nicht als Skip. Wer AUTH in der CI abdecken will, nimmt einen
  `docker run`-Schritt — nicht eine Änderung am geprüften Code.

> **`JR-6-02a` ist erledigt (Rolle DEV, 2026-08-05) und besteht aus einer Entscheidung und einem Tor.**
>
> **ADR-010 ist entschieden, und zwar gegen beide im ADR genannten Optionen.** Weder `processEmail()`
> erweitern noch einen eigenen Pfad daneben stellen, sondern: **unverändert wiederverwenden, hinter einem
> injizierten Port**. Volle Begründung (die Bestandsstellen, die genau für diesen Aufrufer gebaut sind,
> warum „erweitern" ADR-025 verletzt hätte, und **F60** als das ernsteste, gemessen nicht tragende
> Gegenargument) steht **in gleicher oder größerer Tiefe** in `05-entscheidungen.md` unter **ADR-010** —
> am 2026-08-06 dorthin verschoben, nicht gekürzt (Doku-Diät).
>
> **Das Tor** (`classifySpoolEntry()`) ist eine reine Funktion und entscheidet vor jedem Archivieren:
> archiviert wird nur, wenn eine `receipt`-Zeile existiert **und** die Datei genau auf deren
> `content_sha256` hasht. Fünf Urteile, jedes mit eigener Behandlung — `no_receipt` ist der **erwartete**
> Ausgang eines Absturzes zwischen Spool-fsync und Ledger-Append (dem Sender wurde nie `250` gesagt,
> Archivieren würde eine Annahme **erfinden**), und `receipt_without_hash` wird ausdrücklich **nicht** als
> Mismatch gemeldet, weil das einen Betreiber nach Manipulation suchen ließe, wo ein Writer ein Pflichtfeld
> weggelassen hat. **Größe ist bewusst kein zweites Tor:** der Hash hat schon entschieden, und eine
> Receipt, deren eigene zwei Felder sich widersprechen, ist eine Frage für `verify` (E9) — sie darf keine
> angenommene Nachricht unarchivierbar machen.
>
> **Der Lese-Port hat zwei Methoden, und die Trennung ist der Zweck.** `measure()` hasht streamend und
> läuft **vor** dem Urteil, also kommt ein verwaister oder manipulierter 50-MB-Eintrag nie in den Heap.
> `read()` puffert — weil `parseJournalReport` und `StorageService.put()` beide einen ganzen Buffer
> verlangen (F60) —, aber nur für Einträge, die das Tor passiert haben.
>
> **Dabei einen Fehler eingebaut und vom eigenen Bestandstest gefangen:** `row.size_bytes === null` trifft
> `undefined` nicht, und das Tor verzweigt auf `contentSha256 === null` — ein durchgereichtes `undefined`
> hätte eine Receipt **ohne** Hash als **Manipulation** gemeldet. Jetzt `?? null`, mit zwei
> Regressionsfällen für beide Nullish-Formen. Dass `ledger-lookup.test.ts` seine Zeilen selbst baut, ist
> genau der Grund, warum es das gefunden hat.

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

### 2026-08-05 — E6 eröffnet, `JR-6-01`

- **Rolle:** DEV (Hauptthread, kein Subagent — der Auftraggeber hat keinen angefordert)
- **Commits:** `fc15edc` (Nummernreservierung, auf dem **Integrationszweig**), `d0f4840` (`JR-6-01`,
  auf dem Epic-Zweig)
- **Zweig:** `claude/journaling-e6-phase-b-worker`, mit `git push -u` sofort auf eigenen Upstream
  gesetzt — die Falle aus E3 (`git checkout -b <epic> origin/<integration>` setzt den Upstream auf den
  **Integrationszweig**, und ein `git push` landet dort)
- **Tests:** 33 neu (28 `unit`, 5 `integration`). Volllauf **1214 passed | 8 skipped** bei 98 Dateien,
  Exit 0, `unit ci 1019/1019 · integration ci 126/126 · adversarial ci 69/69`
- **CI:** `30999645177` **success** — 98 Dateien, `unit 1019/1019 · integration 126/126 ·
adversarial 69/69`, der neue `valkey`-Service trägt. **Der erste Versuch desselben Laufs war rot**,
  an einem Test, den diese Scheibe nicht angefasst hat: daraus ist **F59** geworden, der
  Wiederholungslauf war grün. Auf dem Linux-Runner meldet der Plattform-Zähler
  `SIGTERM graceful-shutdown branch exercised on linux: exit code 0, no terminating signal` — die
  Zusage, die auf Windows nachweislich unprüfbar ist, ist dort also **erbracht**
- **Entscheidungen:** keine neue ADR. Drei Festlegungen im Code begründet (Queue-Vertrag in
  `packages/journaling`, Ein-Feld-Payload, werfender Processor) — siehe den E6-Abschnitt oben
- **Offen:** `JR-6-02`, und mit ihr **ADR-010**
- **Nicht getan, absichtlich:** die vereinbarte Doku-Diät (Pflichtlektüre unter 40 000 Tokens). Sie
  war „nach der E4-Abnahme" verabredet und ist weiterhin offen; diese Sitzung hat sie nicht angefasst,
  um die erste E6-Scheibe nicht mit einem Umbau der Projektakten zu vermischen

### 2026-08-05 — `JR-6-02a` und der F59-Fix (Fortsetzung derselben Sitzung)

- **Rolle:** DEV (Hauptthread)
- **Commits:** `41068aa` (ADR-010 entschieden, F60 aufgenommen), `fba499c` (`JR-6-02a`: das Tor),
  `72509b5` (F59 behoben)
- **Tests:** 44 neu gegenüber dem Vormittag (35 in `JR-6-02a`, 9 im F59-Fix). Volllauf **1260 passed |
  8 skipped** bei 102 Dateien, Exit 0, `unit 1065/1065 · integration 126/126 · adversarial 69/69`
- **CI:** `31003830220`, **4 von 4 Versuchen success**. Die vier Versuche sind der Beleg für den
  F59-Fix, nicht Bequemlichkeit — vorher waren 2 von 3 Läufen rot
- **Entscheidungen:** **ADR-010** (siehe oben — die Antwort ist keine der beiden ADR-Optionen);
  `JR-6-02` nach **ADR-021** in `a`/`b` geteilt; F59 auf Entscheidung des Auftraggebers im
  Produktionscode behoben statt im Test entschärft
- **Befunde:** **F59 behoben**, **F60 neu und offen** (`StorageService.put()` puffert Streams,
  vorgeschlagene Zuordnung E7)
- **Offen:** `JR-6-02b` — Parser und Owner-Auflösung anschließen, Backend-Adapter auf `processEmail()`,
  Indexierung, Spool-Freigabe, Ende-zu-Ende bis zum durchsuchbaren Treffer
- **Nicht getan, absichtlich:** die Doku-Diät, weiterhin. Und der `duplicate_of`-Pfad — er gehört zu
  `JR-6-03` und wurde bewusst nicht vorgezogen, obwohl das Tor die Stelle schon kennt

### 2026-08-05 — `JR-6-02b` fertiggestellt (neue Sitzung)

- **Rolle:** DEV (Subagent `senior-dev`)
- **Commits:** `cb1a524` (Code + Tests), `440c492` (Doku, ADR-034, F62), plus **sechs
  Nacharbeits-Commits** aus roten CI-Läufen, keiner aus einem lokalen Fund: `0264405`, `9af1492`,
  `49a0bc1`, `41c407e`, `3d0fadb`, `c2987e9` — die drei zugrunde liegenden Ursachen (fehlende
  `STORAGE_TYPE`/`ENCRYPTION_KEY` in der CI, unmigrierte Datenbank, offene `postgres-js`-Verbindung)
  stehen in **F63**/**F64** (`09-befunde-bestandscode.md`)
- **Tests:** 21 neu gegenüber dem Vortag (11 `pipeline.test.ts`, 3 `spool-entry-releaser.test.ts`,
  2 `ledger-lookup.test.ts`, 5 `journal-inbound.options.test.ts`). Volllauf **1297 passed | 8
  skipped** bei 106 Dateien, Exit 0, `unit ci 1102/1102 · integration ci 126/126 ·
adversarial ci 69/69` — unverändert über alle Nacharbeits-Commits hinweg
- **CI:** `31054880932`, **success** nach fünf vorangegangenen roten Läufen (`31050995086`/`31051952349`/
  `31052494990`/`31052830240`/`31053663551`/`31054317990`, jeweils eine der sechs
  Nacharbeits-Commits-Ursachen). 106 Dateien, `unit 1102/1102 · integration 126/126 ·
adversarial 69/69`, `Suite inventory verified: unit 77/77, integration 22/22, adversarial 7/7,
0 unclassified test files`
- **Entscheidungen:** **ADR-034** (Fan-out über jeden aufgelösten Owner via `normalizedEmail`;
  Spool-Freigabe ist Löschen, kein drittes Spool-Verzeichnis; der Prozessor wirft für jeden
  Nicht-Erfolg; `envelope_from`/`envelope_rcpt` erneut in den Ledger-Lookup gezogen; kein
  automatisierter E2E-Test gegen echtes Meilisearch, mit Begründung). Details in
  `05-entscheidungen.md`
- **Manuell verifiziert, nicht automatisiert:** echtes Postgres + echtes Meilisearch +
  echtes Dateisystem — `basic-journal-report.eml` fanned out auf drei Owner
  (`bob`/`carol`/`dave@contoso.com`), alle drei archiviert und indexiert, Volltextsuche nach
  `"Quarterly numbers"` findet alle drei, Spool-Datei danach gelöscht. Siehe ADR-034 Punkt 6 für
  die Begründung, warum das kein committeter Test wurde
- **Befunde:** **F62** neu (`IJournalInboundJob` ist totes Gerüst, Architektur-Doku korrigiert),
  **F63** neu (drei CI-spezifische Ursachen — fehlende `STORAGE_TYPE`/`ENCRYPTION_KEY`, unmigrierte
  Wartungsdatenbank, hängender Shutdown durch eine offene `postgres-js`-Verbindung — kosteten fünf
  CI-Iterationen für diese Scheibe)
- **Offen:** `JR-6-03` (Idempotenz/`duplicate_of`), `JR-6-04` (Reconciler), `JR-6-05`–`JR-6-07`
  (Test-Slices), `JR-6-08` (Abnahme). Die Entscheidung, ob ein automatisierter Meilisearch-E2E-Test
  gebaut wird (und mit welcher CI-/DI-Änderung), liegt beim Auftraggeber
- **Nicht getan, absichtlich:** die Doku-Diät, weiterhin. `IJournalInboundJob` selbst wurde nicht aus
  `packages/types` entfernt (F62) — nur die Doku-Aussage über seine Rolle korrigiert

### 2026-08-05 — Auftrag (a): der Ende-zu-Ende-Test wird automatisiert (Fortsetzung derselben Rolle)

- **Rolle:** DEV (Subagent `senior-dev`)
- **Auftrag:** der Auftraggeber hat entschieden, dass der manuelle Nachweis aus der vorigen Scheibe
  automatisiert wird (Backlog-Akzeptanzkriterium von `JR-6-02`/`JR-6-08`), über Route (i) (DI) statt
  Route (ii) (Harness-Ausnahme) — **ADR-035**
- **Commits:** `32fa49f` (Code + Test), `faa26d5` (Doku, ADR-035, F64)
- **Tests:** 1 neu (`journal-phase-b-e2e.int.test.ts`). Volllauf **1298 passed | 8 skipped** bei 107
  Dateien, Exit 0, `unit ci 1102/1102 · integration ci 127/127 · adversarial ci 69/69`
- **CI:** `31083864864`, **success** (Kopf-Commit `faa26d5`) — 107 Dateien,
  `unit 1102/1102 · integration 127/127 · adversarial 69/69`,
  `Suite inventory verified: unit 77/77, integration 23/23, adversarial 7/7, 0 unclassified
test files`. Erster Lauf, der den neuen `meilisearch`-Service-Container tatsächlich benutzt
- **Entscheidung, gemessen statt angenommen:** die vermeintlich nötige DI-Naht an
  `IngestionService`/`StorageService` existierte bereits (`pg-harness.ts`s
  `bindAsProcessDatabaseUrl()` + verzögerter dynamischer Import, seit `JR-1-04` von
  `filter-builder*`/`mongo-to-meli`/`predefined-roles` benutzt) — kein Umbau von Produktionscode
  nötig. Details samt der verworfenen Alternative in ADR-035
- **Meilisearch in der CI:** ein `meilisearch`-Service-Container plus
  `MEILI_HOST`/`MEILI_MASTER_KEY` im Job-`env:`. Gemessen (nicht angenommen wie bei `valkey`):
  `MEILI_MASTER_KEY` ist eine Umgebungsvariable, keine Kommandozeilenoption — Authentifizierung ist
  in der CI vollständig prüfbar, keine `valkey`-artige Einschränkung. `probeMeilisearch()`
  (`tests/support/infra.ts`) neu, nach demselben Muster wie `probeRedis()`
- **Kalibriert, zweimal, nach `JR-13-09c`s Muster:** Spool-Freigabe deaktiviert → Test schlägt an der
  Spool-Zusicherung fehl; Fan-out auf den Gewinner verkürzt → Test schlägt an der Owner-Liste fehl.
  Beide zurückgenommen, danach wieder grün, `git diff` bestätigt keine Restspur
- **Befunde:** **F64** neu (der hängende Shutdown aus F63 Punkt 3 ist kein CI-Umgebungsproblem,
  sondern ein reales Produktionsverhalten, das der CI-Lauf nur zuerst gemessen hat — als eigener
  Befund geführt, F63 entsprechend gekürzt und verweist darauf; Nebenbefund im selben Text: dasselbe
  `logger.warn`-vor-`process.exit()`-Muster wie F59, niedrige Schwere, nicht behoben)
- **Offen:** `JR-6-03`, `JR-6-04`, `JR-6-05`–`JR-6-07`, `JR-6-08` unverändert
- **Nicht getan, absichtlich:** die Ursache von F64 nicht weiter untersucht (ausdrückliche Anweisung:
  „Untersuchen sollst du es jetzt nicht — nur richtig verbuchen"). Die Doku-Diät weiterhin offen

### 2026-08-06 — Pre-Push-Gate (Werkzeug-Infrastruktur, keine Backlog-ID)

- **Rolle:** DEV (Subagent `senior-dev`)
- **Auftrag:** kein Backlog-Task — nach `JR-6-02b`s Kostenanalyse (sechs CI-Round-Trips, 53 Minuten
  Wartezeit) ein lokales Gate für die **fangbaren** Fehlschläge, ohne zweiten Volllauf und ohne
  zweiten Test-Harness (CLAUDE.md §5.1)
- **Commit:** `88b6719` (`scripts/pre-push-gate.mjs`, `packages/backend/scripts/gate-check-schema.mjs`,
  `package.json`-Skript `gate`)
- **Was es prüft, `corepack pnpm gate`, unter zwei Minuten:** vier Schritte, ausführlich im Doc-Comment
  von `scripts/pre-push-gate.mjs` selbst begründet (test:types beider Pakete, Prettier nur auf
  geänderten Dateien, `svelte-check`, Worker-Boot unter `ci.yml`s eigenem `env:`-Block gegen eine
  garantiert unmigrierte Sonden-Datenbank) — hier nur die Messungen, die das belegen:
- **Kalibriert, dreimal, nach `JR-13-09c`s Muster — Messung, kein Argument** (je zurückgesetzt auf den
  Vorfix-Stand, Gate lief, danach zurückgenommen, `git diff`/`status` bestätigt keine Restspur):

    | Klasse    | Zurückgesetzt                                                       | Gate meldet                                                                                        |
    | --------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
    | `0264405` | `alerts.test.ts`/`smtp-acceptance-wiring.test.ts` auf `0264405~1`   | `[FAIL] test:types @open-archiver/journaling`, exakt TS2322/TS2345                                 |
    | `9af1492` | `ci.yml`s `STORAGE_TYPE`/…/`MEILI_MASTER_KEY`-Block entfernt        | `Error: Invalid STORAGE_TYPE: undefined`, `[FAIL] worker boot check`                               |
    | `41c407e` | `journal-inbound-worker.int.test.ts` auf `41c407e~1` (DB-Isolation) | `AssertionError: expected 'relation "journal_ledger" does not ex…' to contain 'could not be read'` |

- **Ausdrücklich NICHT gefangen** (49a0bc1 nur heuristisch, 3d0fadb/c2987e9s hängender Shutdown gar
  nicht — beides mit Begründung im Doc-Comment des Skripts, hier nicht wiederholt)
- **Ablage und der selbst gefangene Entwurfsfehler (Env-Leakage über `CONFIG_SENSITIVE_VARS`):** beide
  ausführlich im Doc-Comment von `scripts/pre-push-gate.mjs` begründet, hier nicht wiederholt. Kein
  bestehendes Skript umgebaut, nur `gate` in `package.json` neu ergänzt
- **CI:** `31087687090` **success** für den Kopf-Commit `d5f77cf` (die Doku selbst) — 107 Dateien
  unverändert gegenüber dem Vortag, `unit ci 1102/1102 · integration ci 127/127 · adversarial ci
69/69`, `Suite inventory verified: unit 77/77, integration 23/23, adversarial 7/7, 0 unclassified
test files`. Erwartungsgemäß unverändert — das Gate selbst ist reine Werkzeug-Infrastruktur, die
  CI läuft nicht darüber
- **Nicht Teil dieses Auftrags, wie vom Auftraggeber ausdrücklich ausgeschlossen:** F64s Ursache, F62,
  F60, F43, F39, F42, F17(b), die Doku-Diät, `JR-6-03`/`JR-6-04`
- **Numerierung:** keine neue ADR, keine neue F-Nummer vergeben — dieser Auftrag hat keinen Bedarf an
  einer Entscheidung oder einem neuen Befund erzeugt; ADR-036 bleibt reserviert und unvergeben

### 2026-08-06 — F65: Gate-Vorbedingungen asymmetrisch behandelt, behoben

- **Rolle:** DEV (Subagent `senior-dev`) · **Gefunden von:** TEST, unabhängig, drei tatsächliche Läufe
  auf dem sauberen Kopf-Commit `d96bd26` — keine Argumentation, eine Messung
- **Befund und Fix:** volle Fassung jetzt in `09-befunde-bestandscode.md` unter **F65** (am 2026-08-06
  dorthin verschoben, nicht gekürzt — die Register-Regel aus ADR-032 §3 galt für diese Nummer noch
  nicht, ist jetzt nachgezogen)
- **Kalibriert, alle drei vom Prüfer gemessenen Fälle nachgefahren, plus eine Gegenprobe, dass der
  Umbau `41c407e`s ursprüngliche Kalibrierung nicht entschärft hat** — Details ebenfalls in F65
- **Commit:** `1611434`. **CI:** `31090714283` **success** — 107 Dateien unverändert,
  `unit ci 1102/1102 · integration ci 127/127 · adversarial ci 69/69`,
  `Suite inventory verified: unit 77/77, integration 23/23, adversarial 7/7, 0 unclassified test
files`
- **Entscheidung, wie vom Prüfer offengelassen:** kein automatisches Herleiten von
  `DATABASE_URL`/`REDIS_PASSWORD` aus einer laufenden Docker-Instanz — ein geratener Zugangsdatensatz
  ist seine eigene Fehlerklasse. Benennen statt Raten
- **Nicht Teil dieser Nacharbeit:** alles, was schon für die Hauptaufgabe ausgeschlossen war,
  unverändert

### 2026-08-06 — Doku-Diät (E6), `ADR-036`

Methode: Read-Deckel bei 25 000 Tokens meldet beim Überschreiten den exakten Wert (Anthropics
Tokenizer); darunter per Kombination+Subtraktion bzw. `README.md`×5/5. Verschoben, nicht gekürzt,
nach `12-/11-archiv-*.md`, neuem `19-`/`20-` und (wo dort bereits gleich oder tiefer vorhanden)
`05-entscheidungen.md`/`09-befunde-bestandscode.md`. Nebenbei fünf veraltete Stellen korrigiert
(E3-E12-Titel, E6-Zeile, acht Schein-„offene" ADRs, Sessionprotokoll-Kopf, README-Epictabelle).
Gegenprobe bestanden: nächster Schritt bleibt aus README→Status→Handover allein beantwortbar.

| Datei                               | Vorher       | Nachher    |
| ----------------------------------- | ------------ | ---------- |
| `README.md`                         | 4 893        | ≈ 5 668    |
| `06-status.md`                      | 38 519       | ≈ 19 547   |
| `07-session-handover.md`            | 29 213       | 14 184     |
| **Summe vor diesem Eintrag selbst** | **≈ 72 625** | **39 399** |

### 2026-08-06 — `JR-6-03`: `duplicate_of`-Marker für echte Wiederzustellung

- **Rolle:** DEV (Subagent `senior-dev`)
- **Task:** `JR-6-03` — ein Objekt, zwei Receipts, der zweite mit `duplicate_of`
- **Commit:** `5e9551f`
- **Testzahl:** +3 gegenüber `JR-6-02b`s Stand (+2 `pipeline.test.ts`, +1
  `journal-phase-b-e2e.int.test.ts`). Volllauf **1301 passed | 8 skipped** bei 107 Dateien, Exit 0,
  `unit ci 1104/1104 · integration ci 128/128 · adversarial ci 69/69`
- **CI-Lauf:** noch nicht geprüft — folgt nach `git push`
- **Entscheidungen:** keine neue ADR (Nummernkreis war laut Auftrag vor Vergabe zu erfragen; die
  Herleitung — `spool_txid: null`, `eventType: 'receipt'` wiederverwendet, `MIN(seq)` über
  `chain_scope_id`+`content_sha256` unterscheidet echte Wiederzustellung von Job-Retry — steht als
  Doc-Comment in `ledger-lookup-port.ts` und `pipeline.ts`, nicht in `05-entscheidungen.md`). Drei
  Ledger-Zeilen je zweimal zugestellter Nachricht (zwei Phase-A-Receipts, ein Marker) statt
  wörtlich zwei — Lesart begründet im Bericht an den Auftraggeber
- **Offen:** `JR-6-04`–`JR-6-08` unverändert. Ob die Drei-Zeilen-Lesart der Auftraggeber-Absicht
  entspricht, ist an ihn zurückgegeben
- **Nicht getan, absichtlich:** F64s Ursache, F62, F60, F43, F39, F42, F17(b) — wie ausdrücklich
  ausgeschlossen
