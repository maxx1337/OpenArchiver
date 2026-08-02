# SMTP Journaling Receiver — Projektgedächtnis

**Diese Verzeichnis ist die Quelle der Wahrheit für das Projekt.** Es existiert, damit keine Session
den Kontext neu aufbauen muss. Wer hier anfängt zu arbeiten, liest zuerst diese Datei, dann
`06-status.md`, dann `07-session-handover.md`.

> Diese Dokumente sind **absichtlich nicht** in `docs/.vitepress/config.mts` registriert und werden
> daher nicht auf die öffentliche Doku-Website publiziert. Sie sind interne Projektunterlagen.
> Planungsdokumente sind auf Deutsch, `CLAUDE.md`/Skills/Code/Commits auf Englisch.

---

## Worum es geht

Open Archiver ingestiert heute ausschließlich per **Pull** (IMAP, Microsoft Graph, PST/EML-Import).
Für Compliance-Archivierung ist das strukturell defekt: Was ein Nutzer zwischen Zustellung und
nächstem Sync hart löscht, wird nie archiviert — und die Lücke ist nicht nachweisbar.
Vollständigkeit lässt sich nur auf **Transportebene** garantieren, bevor ein Postfachnutzer die
Nachricht anfassen kann. Das Standardverfahren dafür ist **Journaling**.

Zweiter, konkreter Grund: **Exchange Online kann Journal-Reports nicht an ein Exchange-Online-Postfach
ausliefern.** Das Ziel muss ein externes, per SMTP erreichbares Archivsystem sein. Ohne
SMTP-Receiver ist Open Archiver damit für die Mehrheit der adressierbaren Nutzerbasis kein
gültiges Journaling-Ziel.

Ziel des Projekts: ein SMTP-Receiver mit **beweisbarer** Vollständigkeit und Manipulationserkennung
statt behaupteter Vollständigkeit — belastbar gegenüber GoBD / §147 AO / §257 HGB (und vergleichbar
SEC 17a-4, FINRA 4511, MiFID II).

## Lesereihenfolge

| #   | Datei                        | Inhalt                                                             | Wann lesen                              |
| --- | ---------------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| —   | `README.md`                  | dieses Dokument                                                    | immer zuerst                            |
| 00  | `00-rfc.md`                  | Der RFC im Original (EN), **byteidentisch** (in `.prettierignore`) | vor jeder Design-Entscheidung           |
| 01  | `01-gap-analyse.md`          | Ist-Zustand der Codebase vs. RFC-Forderungen                       | einmal, dann bei Bedarf                 |
| 02  | `02-architektur.md`          | Zielarchitektur, Prozess- und Credential-Topologie, Ledger-Design  | vor Implementierungsarbeit              |
| 03  | `03-backlog.md`              | Epics E1–E12 mit Tasks, Akzeptanzkriterien, Abhängigkeiten         | vor jeder Task                          |
| 04  | `04-testplan.md`             | RFC §12 → konkrete Testfälle, Einteilung CI/Nightly/manuell        | vor Testarbeit                          |
| 05  | `05-entscheidungen.md`       | ADR-Log: getroffene und bewusst offene Entscheidungen              | bei Design-Konflikten                   |
| 06  | `06-status.md`               | Fortschritt je Epic und Task                                       | **immer zuerst nach diesem README**     |
| 07  | `07-session-handover.md`     | Was ist der nächste konkrete Schritt                               | am Anfang und Ende jeder Session        |
| 08  | `08-risiken.md`              | Risiken mit Gegenmaßnahme                                          | bei Planungsänderungen                  |
| 09  | `09-befunde-bestandscode.md` | Defekte im **vorhandenen** Code, außerhalb des RFC-Scopes          | bevor man einen davon „nebenbei" behebt |
| 10  | `10-upstream-meldung.md`     | **Entwurf** der Upstream-Sicherheitsmeldung — **nicht versendet**  | nur wenn der Auftraggeber sie versendet |
| 11  | `11-archiv-e1.md`            | Protokoll des abgenommenen Epics E1, unverändert ausgegliedert     | nur bei Fragen zur E1-Historie          |

## Team und Rollen

| Rolle                | Umsetzung                                    | Zuständig für                                          |
| -------------------- | -------------------------------------------- | ------------------------------------------------------ |
| **Product Owner**    | Hauptthread (delegiert, implementiert nicht) | Backlog-Priorisierung, RFC-Abnahme, ADRs, Statuspflege |
| **Senior Developer** | Subagent `.claude/agents/senior-dev.md`      | Implementierung, Migrationen, Repo-Konventionen        |
| **Tester**           | Subagent `.claude/agents/tester.md`          | Test-Harness, adversariale Tests, unabhängige Abnahme  |

Der PO implementiert nicht selbst. Tasks werden mit Verweis auf die Task-ID aus `03-backlog.md`
delegiert; die Rolle steht dort in der Spalte „Rolle".

## Projekt-Skills

Diese Skills kapseln Wissen, das sonst in jeder Session neu erklärt werden müsste:

| Skill            | Wann er greift                                                                          |
| ---------------- | --------------------------------------------------------------------------------------- |
| `journal-ledger` | Empfangspfad, Spool, Ledger, Chain-Hashing, Anchoring, Crash-Recovery, SMTP-Statuscodes |
| `oa-migration`   | jede Schema-/Migrationsänderung (Drizzle)                                               |
| `oa-i18n`        | jeder neue nutzersichtbare String (2 Systeme × 11 Sprachen)                             |

Zusätzlich nutzbar aus dem Bestand: `doc-coauthoring` (Spec-Dokumente), `simplify`,
`security-review`, `review`, `run`, `skill-creator`, sowie `docx`/`pdf`/`xlsx` für
Auditor-Artefakte ab E9/E11.

## Zentrale Randbedingungen (nicht verhandelbar)

1. **`250 OK` erst nach fsync von Spool _und_ Ledger.** Der Acceptance-Contract (RFC §3) ist der
   Kern des Projekts. Details im Skill `journal-ledger`.
2. **Lokale Fehler ⇒ `4xx`, nie `5xx`.** Ein `5xx` erzeugt beim Sender einen NDR und verwirft die
   Nachricht endgültig.
3. **Empfangene Bytes werden nie transformiert.** Das Archivobjekt ist das Wire-Format.
4. **Parse-Fehler werden geloggt und archiviert, nicht abgelehnt.**
5. **Kein Catch-all-Empfänger, kein Relaying.**
6. **Keine Compliance-Behauptung.** Zulässig ist ausschließlich die Formulierung aus RFC §13.

## Aktueller Stand (Kurzfassung)

Epic 0 (Planung, Doku, Agent-Infrastruktur) ist abgeschlossen. **E1 ist abgenommen** (`JR-1-06a`,
2026-07-28) und in den Integrationsbranch gemergt: vitest mit drei Projects, CI gegen PostgreSQL 17,
`pnpm lint` repo-weit sauber. **Die letzte Nacharbeit `JR-1-05c` ist am 2026-07-30 erledigt** (`b5b2190`)
— der Inventar-Wächter zählt jetzt **ausgeführte Tests je Suite und Klasse** statt Dateien, und der
Hauptprozess besitzt den Datenbank-Rückstand des Laufs (F14, F15, F16, F24 behoben). Damit belegt ein
grüner Lauf, dass die `integration`-Suite gelaufen ist — die Voraussetzung dafür, dass die
Durabilitäts- und Kettenaussagen ab E2 überhaupt auf etwas ruhen. **E1 ist damit vollständig
abgeschlossen: 10 / 10.**

**E13 (IAM-Autorisierung härten) ist abgenommen und zurückgemergt** — der Weg dorthin, weil er vier
Runden gebraucht hat: gearbeitet wurde auf `claude/journaling-e13-iam-hardening`. `JR-13-01` hat die
Regressionstests für F1/F3/F7/F8 auf den gewünschten Zustand umgestellt (21 rot), die fünf Fix-Tasks
`JR-13-03`, `JR-13-02`, `JR-13-04`, `JR-13-05`, `JR-13-06` sind erledigt, und der letzte rote Test war ein
Widerspruch **innerhalb** von `JR-13-01` — entschieden in ADR-018 und aufgelöst. Die Suite ist grün:
`224 passed | 2 skipped`, Exit 0, F1/F3/F7/F8/F19/F20/F22 behoben. `JR-13-07` (ADR-016 plus
Betreiberdoku) und `JR-13-08` (Upstream-Entwurf in `10-upstream-meldung.md`, **nicht versendet**) sind
geschrieben.

**Die Abnahme `JR-13-09` ist durchgeführt — Ergebnis: E13 ist _nicht_ abgenommen** (2026-07-29). Die
**Codekorrekturen sind unabhängig belegt**: der Injektionsweg ist an beiden Gates zu (12 Nutzlasten
inklusive Umgehungsversuchen, 0 fremde Zeilen), `FilterBuilder` ist zeilenscharf fail-closed, alle
Regressionstests sind ohne den jeweiligen Fix rot, und die Suite läuft auch in der CI auf PostgreSQL
17.10 grün. Gebrochen ist die **betreibersichtbare Hälfte**: die Prüf-SQL aus `JR-13-07` findet eine
Policy-Form nicht, die von „sieht alles" auf „sieht nichts" umschlägt (**F27**), und die
veröffentlichte Doku behauptet eine Ablehnung beim Speichern, die nicht stattfindet (**F29**, zugleich
`JR-13-06`s letztes Kriterium). Fünf neue Befunde **F25–F29**.

**Die Nacharbeit ist erledigt** (`JR-13-13` F29 und F26s Schreibseite, `JR-13-14` F27/F28, `JR-13-15`
F25): Suite `250 passed | 2 skipped`, Exit 0.

**Die erneute Abnahme `JR-13-09a` ist durchgeführt — Ergebnis: E13 ist _wieder nicht_ abgenommen**
(2026-07-29). 23 Kriterien, **22 erfüllt**. Erfüllt und diesmal unabhängig gemessen sind unter anderem:
beide Gates urteilen deckungsgleich **und** richtig (26 Keys gegen eine eigene Erwartungstabelle), der
**HTTP-400-Pfad** über `IamController.createRole` (11 × 400, 5 × 201), und die Betreiber-SQL liefert auf
PostgreSQL **17.10** eine zeichenweise identische Ausgabe wie auf 16.13 — zwei Lücken, die `JR-13-09`
offenlassen musste, sind damit zu. Gebrochen ist erneut ein Kriterium der betreibersichtbaren Hälfte:
**F30** — die Formprüfung wirkt im Übersetzer **rekursiv**, in Query 2 nur an der **Wurzel**, also
schweigt die Anleitung zu acht verschachtelten Formen, von denen vier von „sieht alles" auf „jede
Anfrage scheitert" kippen; zwei positive Sätze der Seite sind damit widerlegt.

**F30 ist behoben (`JR-13-17`, 2026-07-29).** Die zwei Formbefunde von Query 2 speisen aus der rekursiven
CTE `cond` statt aus `pair` und melden jede der acht Formen mit Positionsangabe; wichtiger noch: **die
Seite behauptet keine Abdeckung mehr, sondern sagt, was sie meldet** (**ADR-020**) und stellt eine
verhaltensbasierte Gegenprobe daneben, die keine Aufzählung von JSON-Formen braucht. Keine
Falsch-positiven, beide Nachweise wörtlich aus der `.md` gegen echtes Postgres.

**Die dritte Abnahme `JR-13-09b` ist durchgeführt — Ergebnis: E13 ist zum _dritten_ Mal nicht abgenommen**
(2026-07-29). 18 Kriterien, **17 erfüllt**; die Abfrageseite von `JR-13-17` (a) ist unabhängig belegt (alle
acht Formen mit Position gemeldet, **keine** Falsch-positiven, 42 Werte gegen den Übersetzer gekreuzt,
**0** falsch-negative). Gebrochen ist erneut die Textseite: **F31** — der Abdeckungsanspruch war nicht
verschwunden, sondern von der Abfrage auf den **Verhaltenscheck** gewandert, der zwei Zahlen vorschreibt,
während die Anwendung **drei** Oberflächen filtert. **Die Ursache lag in ADR-020 selbst**, die den
Verhaltenscheck „vollständig" nannte; sie ist berichtigt (**kein Element der Seite bürgt für ein
anderes**). Drei niedrige Befunde dazu: F32, F33, F34.

**`JR-13-18` ist committet (`939df10`)** — die dritte Zahl ist aufgenommen, der Absolutsatz durch sein
Gegenteil ersetzt, die Bürgschaft in beiden Richtungen negiert. **Ein DEV-Bericht liegt nicht vor**
(Agent endete ohne Bericht), die Statusnotiz ist die Lesart des PO aus dem Diff.

**Die vierte Abnahme `JR-13-09c` hat E13 abgenommen** (2026-07-30). Der **Rückmerge** ist vollzogen
(`89d701f`, `--no-ff`, kein Squash), **`JR-13-12`** ist erledigt (`dca1f1a`), und der einzige Vorbehalt des
Prüfberichts ist nachgemessen und **widerlegt** (F36 — reines F35). Kein PR.

**E2 ist abgenommen** (`JR-2-01`…`JR-2-10a`, 2026-07-31 bis 2026-08-01). Die erste Abnahme `JR-2-10` fand
23 von 23 Kriterien erfüllt, **zählte aber nicht**: sie lief in derselben Sitzung wie
`JR-2-08`/`JR-2-09` und war damit nicht unabhängig im Sinne von ADR-014/ADR-021. Der Auftraggeber hat
deshalb eine **zweite Runde `JR-2-10a`** angeordnet — sie ist durchgeführt, hat in einer frischen
Sitzung **24 von 24** Kriterien erfüllt gefunden und dabei die sechs dünnen Stellen der ersten Runde
mit eigener Evidenz geschlossen (Mutationsproben am Encoder, sabotierte Backends gegen die
Vertragssuite, Nebenläufigkeit direkt über `pg_stat_activity`, eine eigene Befundart-Matrix,
Migrationen gegen Bestandsdaten). Der PO hat den Bericht in **zwei** Rückfragen gegengelesen und dabei
dreizehn Punkte gefunden, die zitiert statt gemessen waren — darunter ein ganz fehlendes Kriterium;
alle sind nachgemessen und bestätigt. **Der Rückmerge ist am 2026-08-01 vollzogen** (`eb340a9`,
`--no-ff`, kein Squash). Ein neuer Befund **F39** (niedrig, Testharness). Was E2 liefert: `packages/journaling` trägt
die kanonische Kodierung, die Merkle-Aggregation und `PostgresLedgerWriter`; die Tabellen sind migriert
und append-only; der Ledger hält 10 000 nebenläufige Appends lückenlos aus, und jede der acht
Manipulationsarten aus Testplan §12.5 wird mit Befundart und `seq` gemeldet. Dabei gefunden und behoben: **F38** — der Writer
speicherte `event_payload` doppelt JSON-kodiert, sobald der Datenbanktreiber nicht durch `drizzle()`
gelaufen war, was jede Ledger-Zeile mit Nutzlast unverifizierbar gemacht hätte. Einen SMTP-Empfangspfad
gibt es weiterhin nicht; der beginnt mit E3/E4.

**`ADR-007` ist am 2026-07-31 entschieden: eine Kette _je Mandant_**, nicht eine globale mit
Mandanten-Tag — RFC §15 nennt das für Export und Löschung sauberere Modell, und beides muss dieses Produkt
dauernd leisten. Die frühere Entwurfsrichtung („für v1 eine einzelne Kette") berief sich auf RFC §5.2 und
verwechselte dabei Skalierungs- mit Mandantenpartitionierung; das ist berichtigt. Was das an E2s Tasks
ändert, steht im Backlog unter „Was `ADR-007` an diesem Epic ändert".

Im selben Zug entschieden: **`chain_scope_id` = `ingestion_sources.id`** — eine Kette je **Archiv**;
`journaling_source_id` steht als Attribut in jeder Ledger-Zeile.

**„Mandant" heißt in ADR-007 Archiv, nicht Endkunde** — wer es als „Kunde" liest, zieht aus ADR-007
und ADR-022 falsche Schlüsse. Ein **Endkunde** ist eine Installation mit **einer** `deployment_id`,
ein **Mandant** ein Archiv und damit eine Kette darin, ein **Endpunkt** nur ein Attribut in der
Ledger-Zeile. „Täglich × 50 Mandanten" in ADR-022 meint 50 Archive **einer** Installation. Das
Betriebsmodell darüber — eine Instanz je Endkunde — steht in **`ADR-024`** und ist seit dem
**2026-08-02 entschieden**, einschließlich der Betriebsverantwortung: **Phase 1 betreibt der Endkunde
selbst, in Phase 2 bietet der Auftraggeber den Betrieb zusätzlich als Dienst an.**

> **Die Quelltextpflicht besteht in beiden Phasen — nur der Paragraf wechselt.** In Phase 1 wird die
> Software an den Kunden **weitergegeben**, also greifen AGPL §4–§6 und er bekommt den Corresponding
> Source als Empfänger. In Phase 2 betreibt der Auftraggeber, also greift zusätzlich §13 gegenüber
> den Nutzern seiner Instanz. **Kein Betriebsverbot in beiden Fällen** — die Annahme, die Lizenz
> untersage Deployments für Endkunden, hielt der Prüfung nicht stand (`ADR-025`). Erfüllt wird
> beides von **einem** Artefakt, dem Quelltext-Angebot in der UI, das ADR-025 als E12-Task vorsieht.
> `ADR-025` entscheidet im selben Zug die übergeordnete Frage: der Fork wird weitergeführt, es wird
> keine eigenständige Anwendung gebaut — und die Abhängigkeitsregel gilt dafür ab sofort
> **beidseitig** (`02-architektur.md` §2).
> Seit dem E2-Merge ist die ADR gegen den Code nachgeprüft, und ihr Zeitpunkt ist präziser: **sie steht
> vor E3/E4**, weil die erste in Produktion angelegte Kette die `deployment_id` in ihren Genesis
> schreibt. Ebenfalls dort neu: ein Golden Image **nach** dem Migrationslauf gibt allen Kundeninstanzen
> dieselbe `deployment_id` — ein Split Brain, den `verify` als Manipulationsbefund meldet (R-18).

**Und die Ankerfrage gleich mit, obwohl sie zu E7/E8 gehört** — sie musste vorgezogen werden, weil die
Baumkodierung Teil der kanonischen Kodierung ist und damit in `JR-2-03` fällt. **`ADR-022`:** ein
RFC-3161-Token über die **Merkle-Wurzel** aller Kettenköpfe, `anchor`-Event mit Inklusionspfad in jeder
Kette, sodass ein Mandantenexport ohne Fremddaten prüfbar ist. Die in `ADR-007` zunächst als gleichwertig
genannte sortierte Liste ist **verworfen** und dort als Fehler markiert. **`ADR-023`:** TSA-Auswahl —
`open-tsa.eu` ist gemessen (Token geholt, gegen gepinnte CA verifiziert) und eingeordnet: gut für
`nightly` und für Installationen ohne GoBD-Anspruch, **kein** qualifizierter Zeitstempel, **nicht** in `ci`.

**`ADR-006` ist am 2026-07-31 entschieden (`JR-2-03`) — damit ist keine Entscheidung mehr offen, die
Kettencode blockiert.** Festgelegt sind die 16 gehashten Felder samt Bytes, der Genesis-String, die
Herkunft der `deployment_id` und die Merkle-Kodierung des Ankers. Drei Punkte daraus sind auch für wen
relevant, der die ADR nicht liest:

- **Die Feldliste in RFC §5.2 war unvollständig.** Sie hasht acht Spalten und lässt `remote_ip`,
  `tls_version`, `tls_cipher`, `ehlo_name` und `duplicate_of` außen vor — die wären nachträglich
  änderbar, ohne die Kette zu brechen. Die Kodierung deckt jetzt **alle 16** wertetragenden Spalten ab.
- **`deployment_id` liegt in einer eigenen Tabelle `deployment_identity`, nicht in `system_settings`** —
  letztere ist über die Einstellungs-API schreibbar, und ein `PUT` darauf hätte jede Kette
  unverifizierbar gemacht.
- **Der ungerade Merkle-Knoten wird hochgezogen (RFC 6962), nicht dupliziert.** Bei der Duplizier-Regel
  liefern `[A,B,C]` und `[A,B,C,C]` dieselbe Wurzel — gemessen, und es hätte ADR-022 Festlegung 1
  aufgehoben.

Die ADR enthält reproduzierbare **Testvektoren**; `JR-2-02` muss sie treffen.

**Zur Umgebung:** seit dem 2026-07-31 laufen **Postgres, Valkey, Meilisearch und Tika über Docker
Desktop** aus `docker-compose.yml`, alle vier vom Host aus belegt, und der Volllauf dagegen ist grün. Der
Wegwerf-Cluster wird nicht mehr gebraucht. `JR-13-16`, `JR-13-11` und `JR-13-10` stehen weiter bei den
Folge-Tasks und blockieren E2 nicht.

**Am 2026-07-30 hat der Auftraggeber drei Prozessentscheidungen getroffen:**

1. **`ADR-021` — Abnahmeeinheit ist die Scheibe, nicht das Epic.** Ein Artefakt, eine Fehlerklasse,
   höchstens ~8 Kriterien, in **einer** Session abschließbar; Code und betreibersichtbare Doku sind
   getrennte Scheiben, und was einmal belegt ist, wird nicht neu geprüft. Die Zerlegung geschieht, wenn
   ein Epic **ansteht** — `03-backlog.md` bleibt bis dahin unverändert.
2. **Die Subagenten `senior-dev` und `tester` laufen auf Sonnet** (`model: sonnet` in beiden
   Rollendateien).
3. **Die Planungsdokumente sind entschlackt:** die doppelt geführte Sessionhistorie ist aus
   `07-session-handover.md` entfernt (1085 → 556 Zeilen, sie stand vollständig in `06-status.md`), und
   das Protokoll von E1 liegt jetzt in `11-archiv-e1.md` (`06-status.md` 2029 → 1359 Zeilen). **Inhalt
   ist nirgends gekürzt worden, nur verschoben.**

> **Die Umgebung ist nicht mehr der Linux-Container der Vorsessions**, sondern ein Windows-Host ohne
> PostgreSQL, ohne `pnpm` im PATH und mit gesperrtem SSH-Key. Der Handover beschreibt unter „Die Umgebung
> hat sich geändert", wie ein Wegwerf-Cluster in PostgreSQL 17.10 entsteht — **vor** „Immer zuerst" lesen.

Verbindlich ist immer `06-status.md`, nicht dieser Abschnitt.

## Branch

`claude/enterprise-product-implementation-cxmmqe` ist **Integrationsbranch**, kein Arbeitsbranch.
Jedes Epic bekommt einen eigenen Zweig davon (`claude/journaling-e<N>-<kurzname>`), Rückmerge erst
nach unabhängiger Abnahme. `main` wird bis zur Abnahme von E12 nicht angefasst. Kein Pull Request
ohne ausdrückliche Aufforderung. Vollständige Regeln: **ADR-014** in `05-entscheidungen.md`.
