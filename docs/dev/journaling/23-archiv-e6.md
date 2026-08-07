# Archiv — E6 (Phase-B-Worker), Sessionprotokoll `JR-6-04` bis `JR-6-08`

**E6 ist abgenommen (`JR-6-08`, 2026-08-07) und zurückgemergt** (`b5b7c8a`, `--no-ff`, kein Squash).
Dieses Protokoll ist am 2026-08-08 unverändert aus `06-status.md` ausgegliedert (Doku-Diät, die
Regel aus `README.md`: das Protokoll eines Epics wandert ins Archiv, sobald es zurückgemergt ist).

Die Protokolle von `JR-6-01`, `JR-6-02a`, `JR-6-02b`, der E2E-Automatisierung, dem Pre-Push-Gate,
`F65`, der Doku-Diät vom 2026-08-06, `JR-6-03` und `ADR-037` liegen bereits seit dem 2026-08-06 in
[`21-archiv-e6-jr601-jr602a-notizen.md`](21-archiv-e6-jr601-jr602a-notizen.md) — dieses Dokument hier
setzt direkt danach fort, bei `JR-6-04`. Das Abnahmeprotokoll selbst (Kriterium → Beleg → Urteil)
steht separat in [`22-abnahme-e6.md`](22-abnahme-e6.md). Entscheidungen: `05-entscheidungen.md`.
Befunde: `09-befunde-bestandscode.md`.

---

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
  grün ist nicht der ganze Beleg). **Nachtrag `JR-6-08`: diese CI-Lücke war ab `JR-6-06`s Commit
  bereits wieder geschlossen, aber erst bei der Abnahme bemerkt — siehe `06-status.md` unter
  „CI-Lücke".**
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
- **CI-Lauf:** nicht ausgelöst/geprüft — bekanntes offenes Problem seit `37b471d`, keine neue
  Erkenntnis dieser Scheibe (später als überholt erkannt, siehe `JR-6-08`)
- **Bewusst nicht getan:** kein echtes MinIO/S3 in `docker-compose.yml`/`ci.yml` ohne explizite
  Entscheidung, keine SIZE-Grenzfall-Tests (anderer Testplan-Abschnitt), `F63`/`F64` nicht angefasst
- **Offen:** `JR-6-07`, `JR-6-08`

### 2026-08-07 — `JR-6-07`: Soak-Test über echtes SMTP

- **Rolle:** TEST, unabhängige Sitzung (unterbrochen durch Wochenlimit, vom PO gesichert auf
  `wip/journaling-jr-6-07` und danach fortgesetzt, siehe Session-Handover)
- **Commits:** `8565585` (Kernstück), `c27e291` (Nacharbeit: stale Kommentar in
  `suite-inventory.ts` korrigiert, vom PO gefunden)
- **Entscheidung Phase A vs. A+B (TEST-Entscheidung, keine ADR):** nur Phase A (SMTP-Accept +
  Ledger) — das Backlog-Kriterium (`seq` lückenlos, `verify` grün, Durchsatz) ist reine
  Phase-A-Aussage, Phase-B-Korrektheit deckt `journal-phase-b-e2e.int.test.ts` bereits ab
- **`CI_MESSAGES` bewusst 100 statt der ursprünglich geplanten 1.000** (im Datei-Kopfkommentar
  ausführlich begründet): drei von drei Versuchen bei 1.000 scheiterten reproduzierbar an einem
  600s-Pro-Nachricht-Stall. Das Backlog fixiert nur die `nightly`-Menge (100.000, unverändert), nicht
  die `ci`-Menge — keine stille Reduktion im Sinn des Akzeptanzkriteriums
- **`OA_TEST_PG_STALE_MS`** = `NIGHTLY_SOAK_BUDGET_MS × 3` = 9h, exakt das `JR-2-08`/F13-Muster
  übernommen
- **Windows-Fsync-Plattformlücke wie bei `JR-6-06`**, unabhängig gegengeprüft (kein Handle-Leak in
  `durable-write.ts`/`fs-port.ts`, beide schließen im `finally`): auf diesem Host endet jede Nachricht
  im `451`-Zweig, beide Varianten assertieren das explizit statt zu skippen
- **Wichtiger, unabhängig bestätigter Befund:** ein reproduzierbarer 600s-Einzelnachricht-Stall,
  unabhängig von der Nebenläufigkeit (10 und 3 Verbindungen gleichermaßen betroffen — schließt einen
  Lock-Bug im Code aus). `Get-MpComputerStatus` bestätigt aktiven Windows-Defender-Echtzeitschutz;
  Arbeitshypothese: dessen Scan reagiert auf die für den Soak typische Kleindateierstellung. **Vom PO
  zweimal unabhängig reproduziert** (zwei separate Läufe, beide am exakt selben 600.000ms-Timeout
  gescheitert) — die TEST-Sitzung selbst hatte in ihrem finalen Bericht auch einen sauberen
  3.002ms-Lauf, die Störung ist also echt intermittierend, nicht deterministisch
- **Testzahl:** +1 `adversarial`-Datei (`journal-soak.adv.test.ts`), `expectedTests` ci 69→70,
  nightly 2→3. Volllauf beim PO auf Windows: **1321 passed | 1 failed | 9 skipped** bei 112 Dateien
  (der eine Fehlschlag ist der dokumentierte Windows-Stall, keine Regression) — bei einem sauberen
  Durchlauf laut TEST-Bericht **1322 passed | 9 skipped**
- **Offen:** `JR-6-08`

**Nachtrag (PO, selber Tag): echte Linux-Verifikation über WSL2/Ubuntu 24.04**, natives ext4 (nicht
`/mnt/*`), Docker-Container über `localhost` erreicht (WSL2 teilt sich das Netz mit Windows). **Der
akzeptierte Pfad ist damit zum ersten Mal in diesem Projekt bewiesen:** `ci`-Smoke (100 Nachrichten,
10 Verbindungen) lief sauber durch — 1758ms, 56,9/s, `seq` lückenlos 1..100, `verifyChain()` 0
Findings. Der `nightly`-Lauf (100.000 Nachrichten) scheiterte dagegen **auch auf echtem Linux** am
eigenen 3h-Budget (`Error: Test timed out in 10800000ms`), nicht an einer Assertion. Ursache
gefunden, gemessen und dokumentiert: **F66** — `checkSpoolHighWaterMark()` durchläuft bei jeder
SMTP-Annahme den kompletten Spool-Baum, was bei wachsendem, unabgeräumtem Rückstand zu O(n²)
Gesamtkosten führt (Diagnoselauf: Momentanrate fällt von ~33/s auf ~2,3/s innerhalb der ersten 4.500
von 10.000 Nachrichten). Volle Analyse in `09-befunde-bestandscode.md` unter F66. **Damit ist
`JR-6-07`s Timeout kein WSL-/Antivirus-Artefakt, sondern ein reproduzierter, echter
Performance-Befund** — betrifft potenziell auch reale, länger andauernde Phase-B-Ausfälle
(`JR-6-06`-Szenario bei größerem Rückstand). **Entschieden vom Auftraggeber (2026-08-07): F66 wird
nach E7 verschoben** (analog F60), blockiert `JR-6-08` nicht — die Acceptance-Contract-Korrektheit
ist unberührt, nur die Latenzgarantie unter Rückstand.

### 2026-08-07 — `JR-6-08`: Abnahme E6

- **Rolle:** TEST, unabhängige Sitzung — hat keine E6-Scheibe selbst umgesetzt, weder vor noch
  während der aufgehobenen Rollentrennung
- **Urteil: angenommen.** Kein Kriterium von `JR-6-01`–`JR-6-07` verletzt. Protokoll:
  `docs/dev/journaling/22-abnahme-e6.md`, Commit `eba887a`, gepusht
- **Drei unabhängige, übereinstimmende Volllaufnachweise** desselben Commits `7fe5e8d`: Windows
  (dieser Host) und Linux (WSL2/Ubuntu 24.04, natives ext4) je **1322 passed | 9 skipped** bei 112
  Dateien, Exit 0, `unit ci 1119/1119 · integration ci 133/133 · adversarial ci 70/70`; dazu der
  echte GitHub-CI-Lauf `31195544522` (`success`, 3:14 min) mit `Suite inventory verified: unit 78/78,
integration 26/26, adversarial 8/8`. `pnpm lint` und `pnpm gate` grün
- **Eigene Reproduktion über die Vorberichte hinaus:** `JR-6-06`s Bedingung 1 (auf Windows strukturell
  nicht messbar) und `JR-6-07`s Kernbehauptung (`seq` lückenlos, `verifyChain()` 0 Findings) selbst
  auf Linux mit eigenem Zufalls-Seed neu beobachtet, nicht nur den früheren WSL2-Bericht der
  PO-Sitzung übernommen. Den vollen `nightly`-Soak (100.000, Stundenlaufzeit) nicht selbst gefahren —
  F66 ist bereits entschieden, eine erneute Bestätigung desselben Timeouts hätte nichts Neues bewiesen
- **F64 (hängender Shutdown) eigenständig bewertet, wie angefordert:** vertretbar, nicht blockierend
  — der Workaround ändert die Korrektheit nicht, betrifft nur Prozessende, Schwere korrekt als
  „mittel" geführt
- **Wichtiger Fund, korrigiert den dokumentierten Stand:** die „CI-Lücke seit `37b471d`" trifft seit
  `JR-6-06`s Commit (`31136887457`) nicht mehr zu — sieben aufeinanderfolgende grüne Läufe
- **Nicht getan:** Statusdateien nicht selbst geändert (Auftrag), F60/F62/F66 nicht neu bewertet (nur
  zur Kenntnis genommen, wie angewiesen)

**Rückmerge (PO, 2026-08-08):** `b5b7c8a`, `--no-ff`, kein Squash, auf
`claude/enterprise-product-implementation-cxmmqe`. Ein Konflikt in `05-entscheidungen.md` (die
ADR-037–040-Reservierung des Integrationszweigs vs. die ausgefüllten ADR-037/038-Abschnitte des
Epic-Zweigs) — aufgelöst zugunsten des Epic-Zweigs, exakt wie in ADR-037s eigenem Abschnitt „Für die
Konfliktauflösung beim Rückmerge" vorgezeichnet. Vor dem Push: `pnpm db:migrate` gegen eine frische
Datenbank (Migration `0043` sauber, `journal_event_type` trägt `duplicate_marker`), `pnpm lint` grün,
voller `pnpm test` grün bis auf den bekannten intermittierenden `journal-soak`-Windows-Stall
(Retry sauber, keine Regression).
