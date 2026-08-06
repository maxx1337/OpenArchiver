# Archiv: Technische Notizen zu JR-6-01 und JR-6-02a (E6)

**Ausgegliedert am 2026-08-06** (Doku-Diät, Fortsetzung — Tokenbudget-Grund, nicht inhaltlicher
Mangel): unverändert aus `06-status.md`, wo es unter der E6-Aufgabenliste stand. Beide Tasks sind
erledigt und abgehakt; die Kurzfassung bleibt in `06-status.md`, hier die volle technische
Begründung — Referenz, nicht Pflichtlektüre für die nächste Task.

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

---

## Sessionprotokolle der abgeschlossenen E6-Scheiben (verschoben am 2026-08-06)

Aus `06-status.md` hierher verschoben, **inhaltlich unveraendert**, als Ausgleich fuer den
`JR-6-04`-Eintrag: die Pflichtlektuere war auf ~41 500 Tokens gewachsen (Ziel 40 000). Alle hier
protokollierten Scheiben sind fertig, ihre Entscheidungen stehen in `05-entscheidungen.md`
(ADR-010, ADR-033-038) und ihre Befunde in `09-befunde-bestandscode.md` (F59-F65). Fuer die
naechste Task ist nichts davon noetig.

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
- **CI-Lauf:** `31105611002` **success** (Kopf-Commit `3835e91`) — 107 Dateien,
  `unit ci 1104/1104 · integration ci 128/128 · adversarial ci 69/69`,
  `Suite inventory verified: unit 77/77, integration 23/23, adversarial 7/7, 0 unclassified test
files`
- **Entscheidungen:** keine neue ADR (Nummernkreis war laut Auftrag vor Vergabe zu erfragen; die
  Herleitung — `spool_txid: null`, `eventType: 'receipt'` wiederverwendet, `MIN(seq)` über
  `chain_scope_id`+`content_sha256` unterscheidet echte Wiederzustellung von Job-Retry — steht als
  Doc-Comment in `ledger-lookup-port.ts` und `pipeline.ts`, nicht in `05-entscheidungen.md`). Drei
  Ledger-Zeilen je zweimal zugestellter Nachricht (zwei Phase-A-Receipts, ein Marker) statt
  wörtlich zwei — Lesart begründet im Bericht an den Auftraggeber
- **Offen (Wortlaut am 2026-08-06 korrigiert):** `JR-6-04`–`JR-6-08` unverändert. Ob die
  Drei-Zeilen-Lesart der Auftraggeber-Absicht entspricht — **Rückfrage gestellt, keine Antwort
  abgewartet** (der Bericht mit der Rückfrage erreichte den Auftraggeber wegen eines eigenen Fehlers
  nicht — Text ausgegeben statt per Nachricht geschickt). Zwei Stunden später ohne Bericht selbst
  geprüft und entschieden: `2b62c26` korrigiert das Kriterium auf „drei Zeilen", `ADR-037` behebt den
  eigentlichen Fehler (kein eigener Event-Typ). Siehe den Eintrag direkt darunter
- **Nicht getan, absichtlich:** F64s Ursache, F62, F60, F43, F39, F42, F17(b) — wie ausdrücklich
  ausgeschlossen

### 2026-08-06 — `ADR-037`: eigener `journal_event_type`-Wert für den `duplicate_of`-Marker

- **Rolle:** DEV (Subagent `senior-dev`) · **Auftrag:** kein Backlog-Task, Auftraggeber-Entscheidung
  nach `JR-6-03`s Rückfrage, Nummer reserviert auf dem Integrationszweig (`e8256f7`, Pool 037–040)
- **Commit:** `37ba891`
- **Testzahl:** unverändert, **1301 passed | 8 skipped** bei 107 Dateien (drei Assertions korrigiert,
  keine hinzugefügt/entfernt; `suite-inventory.ts` deshalb unverändert)
- **CI-Lauf:** `31115643168` **success** (Kopf-Commit `37ba891`) — 107 Dateien,
  `unit ci 1104/1104 · integration ci 128/128 · adversarial ci 69/69`,
  `Suite inventory verified: unit 77/77, integration 23/23, adversarial 7/7, 0 unclassified test
files`
- **Entscheidungen:** **ADR-037** (voll in `05-entscheidungen.md`) — Migration
  `0043_whole_meltdown.sql`, neuer Enum-Wert `duplicate_marker`; `ledger-port.ts`s
  `LedgerAppendRequest['eventType']` importiert jetzt `JournalEventType` statt einer Kopie (F46 selbst
  geschlossen)
- **Verbraucher geprüft:** 32 Treffer auf `event_type`/`'receipt'`, **3 geändert** (`pipeline.ts`,
  Enum-Vollständigkeitstest, `JR-6-03`s Zustellungsprobe), 29 unverändert (Fixtures/Einzelzeilen)
- **Migration lokal geprüft:** `pnpm db:migrate` gegen frische Datenbank; neuer Wert sofort nutzbar
- **Kalibriert:** Marker versehentlich wieder `'receipt'` → beide geänderten Tests rot exakt an ihrer
  Zählungs-Assertion, zurückgenommen
- **Offen:** `JR-6-04`–`JR-6-08` unverändert. `05-entscheidungen.md` auf beiden Zweigen verändert —
  Konfliktauflösung beim Rückmerge steht im ADR-037-Abschnitt selbst
- **Nicht getan, absichtlich:** F64s Ursache, F62, F60, F43, F39, F42, F17(b), `JR-6-04` ff. — wie
  ausgeschlossen
