# Backlog

Task-IDs sind stabil und werden **nie** neu vergeben. Schema: `JR-<Epic><NN>`, z. B. `JR-203` =
Epic 2, Task 3. Abgeschlossene Tasks werden nicht gelöscht, sondern in `06-status.md` abgehakt.

**Rollen:** `DEV` = Subagent `senior-dev` · `TEST` = Subagent `tester` · `PO` = Hauptthread
(Priorisierung, ADRs, Abnahme). Der PO implementiert nicht.

**Reihenfolge = Abhängigkeitsreihenfolge.** Jedes Epic endet in einem demonstrierbaren, testbaren
Zustand. Ein Epic gilt erst als fertig, wenn `TEST` unabhängig abgenommen hat.

| Epic | Titel                         | Abhängig von | Risiko                  |
| ---- | ----------------------------- | ------------ | ----------------------- |
| E1   | Test- und CI-Fundament        | —            | niedrig                 |
| E2   | Ledger und Hash-Chain         | E1           | hoch                    |
| E3   | Spool und Acceptance-Contract | E2           | **sehr hoch**           |
| E4   | `smtp-ingress`-Service        | E3           | **sehr hoch**           |
| E5   | Journal-Report-Parser         | E4           | mittel                  |
| E6   | Phase-B-Worker                | E5           | mittel                  |
| E7   | WORM-Storage                  | E6           | **hoch** (irreversibel) |
| E8   | Anchoring                     | E2, E7       | mittel                  |
| E9   | `verify`-CLI                  | E8           | mittel                  |
| E10  | Completeness-Monitoring       | E6, E9       | niedrig                 |
| E11  | Compliance-Features           | E9           | mittel                  |
| E12  | Rollout und Dokumentation     | E10, E11     | niedrig                 |

Parallelisierbar: E1 ist unabhängig · E8 kann parallel zu E5/E6 laufen (hängt nur an E2 und E7) ·
E11 weitgehend parallel zu E10.

---

## E1 — Test- und CI-Fundament

**Ziel:** Das Repository hat einen Test-Runner, ausführbare Tests und eine CI, die Lint, Typecheck
und Tests ausführt. Ohne das ist RFC §12 nicht umsetzbar und jede Durability-Aussage unbelegt.

**Warum zuerst:** Es gibt heute **null Tests und keinen Test-Runner** im gesamten Repository.

| ID     | Task                                                                                                                                                                                                                                      | Rolle | RFC | Akzeptanzkriterien                                                                                                                                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JR-101 | vitest im Monorepo einrichten: Root-Konfiguration + Workspace-Configs für `packages/backend`, `packages/types`, `packages/journaling` (sobald vorhanden). `test`-Script auf Root- und Paketebene                                          | TEST  | §12 | `pnpm test` läuft von der Repo-Wurzel, findet Tests in allen Paketen, Exit-Code 0 bei Erfolg und ≠ 0 bei Fehlschlag. Keine Änderung an bestehendem Produktionscode |
| JR-102 | Testkonventionen festlegen und dokumentieren: `*.test.ts` neben dem Code für Units, `tests/` für Integration/adversarial, Klassifizierung `ci`/`nightly`/`manual`, Seed-Pflicht bei Randomisierung                                        | TEST  | §12 | Konventionen stehen in `04-testplan.md`; ein Beispiel je Kategorie existiert                                                                                       |
| JR-103 | Erste Unit-Tests auf die reinen Funktionen: `PolicyValidator.isValid()`, `createAbilityFor()`, `FilterBuilder`. Die bestehenden, bisher unbenutzten Fixtures `packages/backend/src/iam-policy/test-policies/*.json` als Eingabe verwenden | TEST  | —   | ≥ 20 Assertions über die Fixtures; alle grün; die Fixtures werden erstmals tatsächlich geladen                                                                     |
| JR-104 | Integrationstest-Basis: isolierte Postgres-Instanz je Testlauf (eigenes Schema oder eigene Datenbank), Migrationen automatisch anwenden, Teardown garantiert                                                                              | TEST  | §12 | Zwei Integrationstests können parallel laufen, ohne sich zu beeinflussen; kein Rückstand in der DB nach dem Lauf                                                   |
| JR-105 | GitHub-Workflow `.github/workflows/ci.yml`: `pnpm lint`, `pnpm --filter @open-archiver/backend build`, `pnpm --filter @open-archiver/frontend check`, `pnpm test` — auf Pull Request und Push                                             | DEV   | §12 | Workflow läuft auf dem Branch grün. Bestehende Workflows (`cla`, `deploy-docs`, `docker-deployment`, `release-tag`) unverändert                                    |
| JR-106 | Abnahme E1                                                                                                                                                                                                                                | PO    | —   | `pnpm test` und CI grün; JR-101…104, JR-105a und JR-105 erfüllt; `06-status.md` aktualisiert                                                                       |

**Achtung — bereits geprüft, `pnpm lint` schlägt heute fehl.** `pnpm lint` ist Prettier `--check`
über das gesamte Repository. Der Bestand ist **nicht** sauber: neun Dateien werden beanstandet.

```
packages/backend/src/api/controllers/index-admin.controller.ts
packages/backend/src/api/routes/ingestion.routes.ts
packages/backend/src/config/search.ts
packages/backend/src/database/migrations/meta/_journal.json
packages/backend/src/database/migrations/meta/0037_snapshot.json
packages/backend/src/database/migrations/meta/0038_snapshot.json
packages/backend/src/database/migrations/meta/0039_snapshot.json
packages/backend/src/database/migrations/meta/0040_snapshot.json
docs/user-guides/installation.md
```

Deshalb wird **`JR-105a`** vorgeschaltet: ein separater, reiner Formatierungs-Commit
(`pnpm format`), sonst ist der CI-Job aus `JR-105` von der ersten Minute an rot und blockiert jeden
künftigen Pull Request.

Zwei Einschränkungen der Vorprüfung, die vor `JR-105a` zu klären sind:

1. Sie lief **ohne** `prettier-plugin-svelte` und `prettier-plugin-tailwindcss` (keine
   `node_modules` im Container). `.svelte`-Dateien sind daher **ungeprüft** — nach `pnpm install`
   erneut vollständig prüfen.
2. Die fünf `migrations/meta/*.json` sind **von drizzle-kit generiert**. Prüfen, ob `pnpm db:generate`
   sie beim nächsten Lauf wieder unformatiert schreibt. Falls ja, gehören sie in `.prettierignore`
   statt in den Formatierungs-Commit — sonst entsteht eine Endlosschleife zwischen Generator und
   Formatierer.

| ID      | Task                                                                                                                             | Rolle | Akzeptanzkriterien                                                                                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JR-105a | Reiner Formatierungs-Commit `pnpm format`, vorher Entscheidung zu den generierten drizzle-Snapshots (formatieren vs. ignorieren) | DEV   | `pnpm lint` ist repo-weit grün, inklusive `.svelte`; der Commit enthält **ausschließlich** Formatierung, keine Logikänderung; `pnpm db:generate` erzeugt danach keine erneute Lint-Verletzung |

---

## E2 — Ledger und Hash-Chain

**Ziel:** Eine append-only, lückenlose, hash-verkettete Ereignisliste mit serialisierten Writes und
belegter Durability. Ohne Ledger darf nie ein `250` gesendet werden.

**Skill:** `journal-ledger` ist für alle Tasks dieses Epics verbindlich.

| ID     | Task                                                                                                                                                                                                            | Rolle | RFC         | Akzeptanzkriterien                                                                                                                                                                       |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JR-201 | `packages/journaling` anlegen: `package.json`, `tsconfig`, Abhängigkeit **nur** auf `@open-archiver/types`. Konfiguration und DB-Verbindung werden injiziert, nie importiert                                    | DEV   | §2          | Paket baut eigenständig; `grep` bestätigt keinen Import aus `@open-archiver/backend`                                                                                                     |
| JR-202 | Kanonische Kodierung implementieren: Versionsbyte, längenpräfixierte Felder, int64-Zeitstempel in µs UTC, Arrays in Empfangsreihenfolge, kanonische `event_payload`-Serialisierung. Bytes im Code dokumentieren | DEV   | §5.2        | Property-Tests: gleiche Eingabe ⇒ identische Bytes; Feldpermutation ⇒ andere Bytes; `event_payload` mit umgestellten Schlüsseln ⇒ **gleiche** Bytes; Golden-File-Test fixiert das Format |
| JR-203 | ADR-006 fixieren: exakte Kodierung, Genesis-String, Herkunft der `deployment_id`                                                                                                                                | PO    | §5.2        | ADR in `05-entscheidungen.md` mit Status „entschieden"; JR-202 stimmt damit überein                                                                                                      |
| JR-204 | Drizzle-Schema `journal_ledger` + Migration. Felder nach RFC §5.2 plus `spool_txid`. `pgEnum` für `event_type`. Im Barrel `schema.ts` registrieren                                                              | DEV   | §5.2        | `pnpm db:generate` erzeugt Migration; SQL und `meta/*_snapshot.json` committed; `pnpm db:migrate` läuft durch. Skill `oa-migration` befolgt                                              |
| JR-205 | Append-Only in der Datenbank erzwingen (Rechteentzug oder Trigger — ADR-009)                                                                                                                                    | DEV   | §5.2        | Ein `UPDATE` und ein `DELETE` auf `journal_ledger` schlagen mit den Anwendungsrechten fehl; Test belegt es                                                                               |
| JR-206 | `LedgerWriter.append()`: `BEGIN` → `SET LOCAL synchronous_commit = on` → `pg_advisory_xact_lock` → Kopf lesen → `seq` ableiten → Hash **innerhalb** der Sperre berechnen → `INSERT` → `COMMIT`                  | DEV   | §5.2, §5.4  | Lückenlos unter Last (JR-208); `seq` wird bei Rollback nicht verbraucht; Hash-Berechnung außerhalb der Sperre ist im Code unmöglich (Struktur, nicht Kommentar)                          |
| JR-207 | Ledger-Backend steckbar bauen: Variante (a) Postgres zuerst, Schnittstelle so, dass (b) lokales WAL nachrüstbar ist                                                                                             | DEV   | §5.4        | Interface dokumentiert; (a) implementiert; (b) nicht implementiert, aber ohne Signaturänderung nachrüstbar                                                                               |
| JR-208 | Adversariale Ledger-Tests: 20 parallele Writer × 500 Appends ⇒ lückenlos und korrekt verkettet; erzwungener Rollback zwischen Vergabe und Commit ⇒ keine Lücke; Kettenverifikation über den gesamten Bereich    | TEST  | §5.2, §12.6 | Alle Bedingungen erfüllt, reproduzierbar mit geloggtem Seed                                                                                                                              |
| JR-209 | Tamper-Tests: (a) Objekt-Hash-Feld ändern ⇒ Erkennung bei korrektem `seq`; (b) Zeile löschen ⇒ Kettenbruch bei korrektem `seq`; (c) Kette ab `seq` N neu schreiben ⇒ Divergenz erkennbar                        | TEST  | §12.5       | Prüflogik meldet in allen drei Fällen die **erste** Divergenz mit `seq` und Feld                                                                                                         |
| JR-210 | Abnahme E2                                                                                                                                                                                                      | PO    | —           | JR-201…209 erfüllt; ADR-006/007/009 entschieden; `06-status.md` aktualisiert                                                                                                             |

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

| ID     | Task                                                                                                                                                                                                                                    | Rolle | RFC    | Akzeptanzkriterien                                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| JR-601 | `journal-inbound`-Worker als eigener Prozess nach dem Muster von `src/workers/ingestion.worker.ts`, mit `start:journal-worker`-Skript. `maxStalledCount`/`lockDuration` bewusst setzen                                                  | DEV   | §2     | Worker startet eigenständig; Begründung der Queue-Parameter im Code dokumentiert                                                 |
| JR-602 | Verarbeitung: Spool lesen → parsen → Außenobjekt in den Storage → Metadaten nach `archived_emails` → indexieren → Spool freigeben. `StorageService`, `IngestionService.processEmail`, `IndexingService.indexEmailBatch` wiederverwenden | DEV   | §2, §7 | Ende-zu-Ende von der Spool-Datei bis zum durchsuchbaren Treffer; ADR-010 entschieden (`processEmail` erweitern vs. eigener Pfad) |
| JR-603 | Idempotenz: Objekt-Dedupe auf `content_sha256`, aber **jede** Receipt bleibt im Ledger, Duplikate mit `duplicate_of` auf den Original-`seq`                                                                                             | DEV   | §4.5   | Dieselbe Nachricht zweimal zugestellt ⇒ ein Objekt, **zwei** Ledger-Einträge, zweiter mit gesetztem `duplicate_of`               |
| JR-604 | Spool-Reconciler: periodischer Sweep über Spool-Einträge mit Ledger-Eintrag, aber unvollständiger Phase B ⇒ nachreihen. Redis ist Optimierung, nicht Autorität                                                                          | DEV   | §3     | Bei geleerter Redis-Queue werden alle offenen Spool-Einträge wieder aufgenommen; kein Datenverlust                               |
| JR-605 | Hash-vor-Verschlüsselung festschreiben und testen: `content_sha256` über Plaintext-Wire-Bytes, `StorageService` verschlüsselt danach                                                                                                    | DEV   | §7     | Test: Objekt exportieren, entschlüsseln, Hash neu berechnen ⇒ identisch zum Ledger-Wert                                          |
| JR-606 | Object-Store-Ausfall-Test: Storage nicht erreichbar ⇒ Nachrichten werden weiterhin quittiert, Backlog läuft nach Erholung ab, Kette unberührt                                                                                           | TEST  | §12.4  | Alle drei Bedingungen erfüllt                                                                                                    |
| JR-607 | Soak-Test: 100.000 Nachrichten, gemischte Größen, parallele Verbindungen ⇒ lückenlos, Verifikation grün, Durchsatz protokolliert. Als `nightly` klassifizieren, plus schnelle `ci`-Smoke-Variante                                       | TEST  | §12.6  | Beide Varianten existieren und sind benannt; keine stille Reduktion der Nightly-Menge                                            |
| JR-608 | Abnahme E6                                                                                                                                                                                                                              | PO    | —      | JR-601…607 erfüllt; Ende-zu-Ende-Fluss demonstrierbar                                                                            |

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

## Nicht im Scope

Aus RFC §1 („Non-goals") und §15, hier explizit festgehalten, damit es nicht durch die Hintertür
zurückkehrt:

- Allzweck-MTA werden: kein Relaying, keine Ausgangs-Queue, keine Benutzerpostfächer.
- Viren- und Spam-Prüfung.
- Pull-Ingestion ersetzen — sie bleibt für Backfill, Altdaten-Import und Reconciliation nötig.
- Irgendeine Installation automatisch compliant machen (RFC §13).
- Merkle-Baum statt linearer Kette (RFC §15 — später, nicht v1).
- Mehrmandanten-Ketten über die in E2 getroffene Minimalentscheidung hinaus.
