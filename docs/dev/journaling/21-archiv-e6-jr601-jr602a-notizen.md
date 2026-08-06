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
