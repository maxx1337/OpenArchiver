# Abnahme E6 (Phase-B-Worker) — `JR-6-08`

**Datum:** 2026-08-07 · **Geprüfter Commit:** `7fe5e8d` (Branch `claude/journaling-e6-phase-b-worker`,
lokal und remote deckungsgleich, Arbeitsbaum sauber bis auf das eigene, nicht committete
`.oa-test-storage/` dieser Sitzung) · **CI-Lauf für diesen Commit:** `31195544522` (`success`,
3 min 14 s) · **Rolle:** Tester, unabhängige Sitzung — hat keine E6-Scheibe selbst umgesetzt (weder
`JR-6-01`…`JR-6-07` noch die während `JR-6-04`/`JR-6-05` aufgehobene Rollentrennung betraf diese
Sitzung).

**Urteil: angenommen.** Kein Backlog-Kriterium von `JR-6-01`…`JR-6-07` ist beim eigenen Nachprüfen
verletzt. Der Ende-zu-Ende-Fluss ist demonstriert, nicht nur behauptet — automatisiert
(`journal-phase-b-e2e.int.test.ts`) und von mir selbst auf **zwei** Plattformen (Windows und echtem
Linux über WSL2) sowie in echter GitHub-Actions-CI reproduziert, mit identischen Zahlen auf allen
drei. Ein Fund korrigiert den dokumentierten Stand (CI-Lücke, s. u.); die vier bereits vom
Auftraggeber entschiedenen Befunde (F60, F62, F64, F66) werden nicht neu aufgerollt, aber F64 ist
unten mit eigener Einschätzung bestätigt.

## Eigene Volllaufnachweise

Drei unabhängige Läufe desselben Commits, keiner mit `-t`, Dateifilter oder `--project` — kein
„verified NOTHING":

| Plattform                                                                     | Ergebnis                                          | `TEST-EXECUTED`                                                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Windows (dieser Host)                                                         | **1322 passed \| 9 skipped**, 112 Dateien, Exit 0 | `unit ci 1119/1119 · integration ci 133/133 · adversarial ci 70/70`                                        |
| Linux (WSL2/Ubuntu 24.04, natives ext4, `~/dev/OpenArchiver`, nicht `/mnt/*`) | **1322 passed \| 9 skipped**, 112 Dateien, Exit 0 | identisch                                                                                                  |
| GitHub Actions, Commit `7fe5e8d`, Lauf `31195544522`                          | `success`, 3 min 14 s                             | identisch, plus `Suite inventory verified: unit 78/78, integration 26/26, adversarial 8/8, 0 unclassified` |

`tests/support/suite-inventory.ts` stimmt exakt: `expectedFiles` 78/26/8 (112 gesamt),
`expectedTests` ci 1119/133/70 (1322) — auf allen drei Läufen bestätigt, nicht nur behauptet.

**Befund, der den dokumentierten Stand korrigiert:** `06-status.md`/`07-session-handover.md`
behaupten seit `37b471d` eine „CI-Lücke" („GitHub Actions erzeugt keine zuverlässigen Läufe mehr für
diesen Zweig"). Das trifft auf den geprüften Commit **nicht mehr zu** — `gh run list` zeigt für
`claude/journaling-e6-phase-b-worker` sieben aufeinanderfolgende grüne Läufe seit `31136887457`
(`JR-6-06`), und der Lauf für `7fe5e8d` selbst ist grün und vollständig (s. o.). Ich ändere die
Statusdateien nicht selbst (Auftrag), aber der PO sollte diese Zeile beim nächsten Statusupdate
prüfen und ggf. korrigieren — sie ist möglicherweise seit `JR-6-06` bereits falsch und wurde nur
nicht erneut geprüft.

**Vorbereitung für den eigenen Lauf, zur Reproduzierbarkeit dokumentiert:** Build von
`@open-archiver/journaling` und `@open-archiver/backend` (`tsc`; `copy-assets` scheitert auf Windows
mangels `pnpm` im `PATH`, unschädlich für Tests, wie im Handover vermerkt). Env:
`DATABASE_URL`, `OA_TEST_REQUIRE_INFRA=1`, `REDIS_HOST=127.0.0.1`, `REDIS_PORT=6379`,
`REDIS_PASSWORD=devpassword` (**kein** `REDIS_USER` — die Valkey-Instanz läuft mit reinem
`--requirepass`, kein ACL-Benutzer `notdefaultuser` eingerichtet; ein erster Versuch mit gesetztem
`REDIS_USER` erzeugte `WRONGPASS` in mehreren Suiten und wurde verworfen, kein Produktdefekt),
`STORAGE_TYPE=local`, `STORAGE_LOCAL_ROOT_PATH`, `ENCRYPTION_KEY`, `STORAGE_ENCRYPTION_KEY` (64 Hex,
**bewusst gesetzt** — ohne diesen Schlüssel würde `JR-6-05`s Ordnungsbehauptung nur vakuos gelten,
s. u.), `JWT_SECRET`, `MEILI_MASTER_KEY`, `MEILI_HOST`.

## Kriterium → Beleg → Urteil

| ID              | Kriterium (gekürzt)                                                                                                       | Beleg                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Urteil      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `JR-6-01`       | `journal-inbound`-Worker als eigener Prozess, Queue-Parameter begründet                                                   | `packages/backend/src/workers/journal-inbound.worker.ts` — eigener Modul-Doc-Kommentar begründet `lockDuration` (10 min gegen lange synchrone MIME-Arbeit), `maxStalledCount: 0` (Stall-Doppel-Run würde `content_sha256`-Dedupe gegen einen append-only-Ledger racen) und `concurrency: 3`. `start:journal-worker` in beiden `package.json` verifiziert. `journal-inbound-worker.int.test.ts` (5 Tests: spawnt den echten Prozess, SIGTERM-Graceful-Shutdown, Job-Fehlschlag ohne falsches „archiviert") — auf Windows 5/5 grün, per `pnpm gate` erneut isoliert bestätigt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **erfüllt** |
| `JR-6-02` (a+b) | Spool → Parser → Storage → `archived_emails` → Index → Spool frei; ADR-010 entschieden                                    | ADR-010 gelesen: Entscheidung ist **Wiederverwendung von `processEmail()` unverändert hinter einem injizierten Port** (`ArchiveObjectPort`), mit drei gemessenen Gründen (Bestand ist für genau diesen Aufrufer gebaut, „erweitern" verletzte ADR-025, das Speicher-Gegenargument trägt nicht — `StorageService.put()` puffert ohnehin, F60, E7 zugeordnet). `journal-phase-b-e2e.int.test.ts`, erster Test: echtes Postgres, echtes Meilisearch, Fan-out-Fixture zu drei Ownern, jeder archiviert, alle drei durchsuchbar (`ingestionSourceId`-gescopte Suche, keine rohe Trefferzahl), Spool-Datei danach `ENOENT`. Von mir zusätzlich auf Linux mit `IngestionService`/`StorageService`/`SearchService`/`IndexingService` gegen echte Container reproduziert                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **erfüllt** |
| `JR-6-03`       | Objekt-Dedupe auf `content_sha256`, jede Receipt bleibt, Duplikat markiert                                                | `journal-phase-b-e2e.int.test.ts`, zweiter Test: byteidentische Zustellung zweimal über zwei Spool-Transaktionen; zweite liefert `outcome.kind === 'duplicate'` gegen dieselbe `archivedEmailId`; Ledger-Abfrage zeigt **exakt 2** `event_type = 'receipt'`-Zeilen (nie 3 — ADR-037 hat den Marker-Event-Typ aus der Receipt-Zählung herausgenommen) plus **1** `event_type = 'duplicate_marker'`-Zeile mit `duplicate_of` auf den ersten `seq` und `spool_txid = null` (nie eine der beiden echten Transaktions-IDs — sonst würde `findBySpoolTxIds()`s Map still kollabieren, im Dateikommentar von `ledger-lookup-port.ts` begründet). Ein Objekt, drei Ledger-Zeilen: bestätigt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **erfüllt** |
| `JR-6-04`       | Spool-Reconciler: geleerte Redis-Queue wird aus Spool wieder aufgenommen, kein Datenverlust                               | `journal-spool-reconciler.int.test.ts` gegen echtes Postgres, echte Platte, echtes BullMQ, mit eigenem, garantiert leerem Queue-Namen (nicht die geteilte Produktions-Queue). Test 1: drei offene Spool-Einträge, leere Queue, Sweep reiht alle drei unter ihrer deterministischen Job-Id wieder ein, 0 quarantiniert. Test 2 ist **selbstkalibrierend**: misst zuerst, dass ein blankes `queue.add()` unter derselben Job-Id einen im `failed`-Set gestrandeten Job **nicht** befreit (bleibt `failed`), dann zeigt der Reconciler, dass er ihn tatsächlich zu `retry()` bewegt. Ohne diese Kalibrierung wäre ein grüner Test über einen No-Op nicht von einem echten Fix zu unterscheiden gewesen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **erfüllt** |
| `JR-6-05`       | `content_sha256` über Plaintext, Verschlüsselung danach; Re-Export/Entschlüsseln/Re-Hash = Ledger-Wert                    | `journal-hash-before-encryption.int.test.ts`, mit `STORAGE_ENCRYPTION_KEY` **bewusst gesetzt** in meinem Lauf (ohne Schlüssel wäre die Ordnungsbehauptung nur vakuos erfüllt, der Test sagt das selbst über `coverageNotice`). Beide meiner Läufe (Windows und Linux) druckten `[JR-6-05] encryption ON: 1007 ciphertext bytes at rest, prefix present, ciphertext hash differs from the ledger value -- the ordering claim is verified this run` — die scharfe Fassung, nicht die vakuose. Byte für Byte: Präfix `oa_enc_idf_v1::` vorhanden, Chiffrat-Hash ≠ Ledger-Wert, Chiffrat länger als Klartext, entschlüsselt = Wire-Fixture byteidentisch, Re-Hash = `archived_emails.storage_hash_sha256` = `journal_ledger.content_sha256`, `size_bytes` ist die Klartextlänge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **erfüllt** |
| `JR-6-06`       | Object-Store-Ausfall: weiterhin quittiert, Backlog läuft nach Erholung ab, Kette unberührt (alle drei Bedingungen)        | `journal-object-store-outage.int.test.ts`, Fake-`ArchiveObjectPort` in exakt der Fehlerform, in die `IngestionService.processEmail()` jeden Storage-Fehler umwandelt. **Windows:** Bedingung 1 strukturell nicht messbar (Verzeichnis-Fsync ist POSIX-only, `accept()` antwortet `451` statt `250` — ehrlich als `coverageNotice` benannt, nicht stillschweigend übersprungen), Bedingungen 2+3 verifiziert (zwei Backlog-Einträge scheitern unter echtem BullMQ-Retry, `runSpoolReconcile()` holt beide nach Ersatz des Ports durch einen funktionierenden zurück, Kette vor **und** nach 0 Findings). **Auf meinem eigenen Linux-Lauf (WSL2) verifiziert sich zusätzlich Bedingung 1:** `[JR-6-06] condition 1 verified: a real SMTP client received 250 immediately after a real runPhaseBPipeline() call had just thrown ... due to a simulated object-store outage.` Damit habe ich **alle drei Bedingungen** selbst beobachtet, nicht nur aus dem Bericht der `JR-6-06`-Sitzung übernommen                                                                                                                                                                                                                                                                                                                                                                     | **erfüllt** |
| `JR-6-07`       | Soak: `nightly` (100 000) + `ci`-Smoke benannt, keine stille Reduktion der Nightly-Menge, F13-Frist gesetzt und begründet | `journal-soak.adv.test.ts` gelesen: `NIGHTLY_MESSAGES = 100_000` (unverändert, Backlog-konform), `CI_MESSAGES = 100` (dokumentiert reduziert von ursprünglich 1000, Grund im Dateikopf: drei von drei Versuchen bei 1000 scheiterten reproduzierbar an einem Windows-spezifischen 600-s-Stall — das ist die `ci`-Menge, die das Kriterium ausdrücklich nicht fixiert). `OA_TEST_PG_STALE_MS` wird zur Laufzeit auf das Dreifache des Nightly-Budgets angehoben, im Lauf selbst als `coverageNotice` sichtbar begründet (`raised ... for this process ... Raised only, never lowered`). **Windows:** `ci`-Smoke fällt sicher in den `451`-Zweig (Fsync-Lücke, ehrlich benannt, keine Regression — auf diesem Lauf kein Windows-Defender-Stall). **Auf meinem eigenen Linux-Lauf selbst verifiziert, mit eigenem Seed, unabhängig vom vorherigen Bericht:** `[JR-6-07 ci-smoke] verified: 100 messages over 10 real SMTP connections in 8320 ms (12.0/s), 977864 bytes sent, seq gapless 1..100, verifyChain() 0 findings (seed 2927300705)`. Den vollen `nightly`-Lauf (100 000 Nachrichten) habe ich **nicht** selbst gefahren — Laufzeit im Stundenbereich, und F66 (s. u.) lässt ihn laut vorheriger, gemessener Linux-Verifikation ohnehin am eigenen 3-h-Budget scheitern; das ist der bereits entschiedene, nicht blockierende Befund, keine neue Prüfung nötig | **erfüllt** |

**`JR-6-08` selbst — „`JR-6-01`…`JR-6-07` erfüllt, Ende-zu-Ende-Fluss demonstrierbar":** alle sieben
Zeilen oben erfüllt; der Ende-zu-Ende-Fluss ist nicht nur durch `journal-phase-b-e2e.int.test.ts`
automatisiert demonstriert, sondern von mir selbst zusätzlich auf zwei Betriebssystemen und in echter
CI reproduziert — drei übereinstimmende, unabhängige Belege für dieselbe Behauptung.

## Eigene Einschätzung zu den bereits entschiedenen, nicht blockierenden Befunden

Der Auftrag verlangt ausdrücklich keine Neubewertung von F60, F62, F66 — diese werden zur Kenntnis
genommen, nicht erneut geprüft. **F64** (hängender Shutdown nach `worker.close()`) trägt aber die
Bitte, meine eigene Einschätzung zu nennen, ob das für eine E6-Abnahme vertretbar ist:

**Vertretbar.** Drei Gründe: (1) der bestehende Workaround (`process.exit(0)` nach bestätigtem
BullMQ-Drain) verändert die Korrektheit nicht — ein Supervisor hätte den Prozess bei einem echten
Hänger ohnehin per `SIGKILL` beendet, das Ergebnis ist identisch; (2) F64 betrifft **Prozessende**,
nicht den Acceptance-Contract oder die Ledger-Kette — kein Pfad, auf dem eine Nachricht verloren
gehen oder falsch verkettet werden könnte, ist berührt; (3) die Schwere ist im Bestand selbst korrekt
als „mittel" geführt, nicht als „hoch" oder „kritisch". Ich hätte anders geurteilt, wenn der
Workaround eine unbeobachtete Fehlerbehandlung verdeckt hätte (etwa ein verschlucktes
`ledgerSql.end()`-Fehlschlag ohne Log) — das ist hier nicht der Fall, der Nebenbefund zur
`logger.warn`/`process.exit(0)`-Reihenfolge (F59-Muster, niedrige Schwere) ist korrekt benannt und
selbst unkritisch, weil keine Zusicherung an dieser Log-Zeile hängt.

## Was ich selbst nachvollzogen habe vs. was ich übernommen habe

**Selbst nachvollzogen, nicht nur geglaubt:**

- Zwei vollständige, ungefilterte Testläufe (Windows, Linux/WSL2) desselben Commits, identische
  Zahlen
- Den GitHub-Actions-CI-Lauf für exakt diesen Commit abgerufen und ausgewertet (nicht nur den
  Status-Badge geglaubt)
- `pnpm lint` (Prettier) grün
- `pnpm gate` grün (`test:types` beider betroffener Pakete, `svelte-check`, der Worker-Boot-Check
  gegen `ci.yml`s tatsächlichen `env`-Block)
- Die sieben Integrationstestdateien für `JR-6-02`…`JR-6-06` **gelesen**, nicht nur ihre Namen
  vertraut — insbesondere geprüft, dass die Kalibrierungen (JR-6-04s „`add()` befreit nicht",
  JR-6-05s „ohne Schlüssel wäre es vakuos", JR-6-06s Windows/Linux-Zweigunterscheidung) tatsächlich
  im Code stehen und nicht nur im Dateikommentar behauptet werden
- `JR-6-06`s Bedingung 1 und `JR-6-07`s Kernbehauptung (`seq` lückenlos, `verifyChain()` 0 Findings)
  selbst auf echtem Linux beobachtet, mit eigenem Zufalls-Seed — nicht nur den früheren
  WSL2-Bericht der PO-Sitzung übernommen
- ADR-010, ADR-037, ADR-038 gelesen und gegen den tatsächlichen Testcode geprüft, nicht nur den
  Entscheidungstext für bare Münze genommen

**Übernommen, mit Begründung, warum das vertretbar ist:**

- Den vollen `nightly`-Soak (100 000 Nachrichten) habe ich nicht selbst gefahren. Begründung: die
  Laufzeit liegt im Stundenbereich, F66 lässt ihn nach dokumentierter, bereits auf echtem Linux
  gemessener Erkenntnis ohnehin am 3-h-Budget scheitern, und das ist ein vom Auftraggeber bereits
  entschiedener, nicht blockierender Befund — eine erneute dreistündige Bestätigung desselben
  Timeouts hätte nichts Neues bewiesen
- F60/F62/F66s technische Details habe ich nicht neu verifiziert (nur zur Kenntnis genommen, wie im
  Auftrag verlangt) — sie sind bereits vom Auftraggeber entschieden und E7 zugeordnet

## Methodik

Keine Änderung an Produktionscode. Kein Testcode geändert oder hinzugefügt — die vorhandenen Suiten
für `JR-6-01`…`JR-6-07` waren bei eigener Prüfung bereits vollständig und korrekt kalibriert, es gab
nichts nachzuziehen. Die einzige eigene Artefaktänderung ist dieses Abnahmeprotokoll. Der
Testspeicherordner `.oa-test-storage/` (Eigenprodukt der lokalen Läufe dieser Sitzung) bleibt
unversioniert und wird nicht committet.
