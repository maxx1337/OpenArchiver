# Gap-Analyse: Ist-Zustand vs. RFC

Stand: 2026-07-27, Commit-Basis `a560b8c` (V0.5.2). Alle Pfade relativ zum Repository-Root.

---

## 0. Der zentrale Befund

**Ein SMTP-Journaling-Listener existiert bereits als Closed-Source-Enterprise-Feature und ist in
diesem Repository nicht vorhanden.**

Das Root-`package.json` referenziert `apps/open-archiver-enterprise` und `packages/enterprise`.
Beide fehlen. Vorhanden ist nur ein OSS-Rand um ein abwesendes Zentrum:

| Artefakt                                               | Pfad                                                                      | Status                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------- |
| Tabelle `journaling_sources`                           | `packages/backend/src/database/schema/journaling-sources.ts`              | ✅ vorhanden                        |
| Journaling-Typen inkl. `IJournalInboundJob`            | `packages/types/src/journaling.types.ts`                                  | ✅ vorhanden                        |
| Frontend-Formular                                      | `packages/frontend/src/lib/components/custom/JournalingSourceForm.svelte` | ✅ vorhanden                        |
| Frontend-Seite                                         | `packages/frontend/src/routes/dashboard/ingestions/journaling/`           | ✅ vorhanden                        |
| i18n-Sektion `app.journaling`                          | alle 11 Frontend-Locales                                                  | ✅ vorhanden                        |
| Env-Variablen                                          | `.env.example` Z. 119–132                                                 | ✅ vorhanden                        |
| Benutzerdokumentation                                  | `docs/enterprise/journaling/guide.md`                                     | ⚠️ dokumentiert **abwesenden** Code |
| **SMTP-Listener**                                      | —                                                                         | ❌ fehlt                            |
| **Journal-Report-Parser**                              | —                                                                         | ❌ fehlt                            |
| **`journal-inbound`-Worker**                           | —                                                                         | ❌ fehlt                            |
| **Health-Endpoint** `/v1/enterprise/journaling/health` | —                                                                         | ❌ fehlt                            |
| **License-Gating / `LicenseService`**                  | —                                                                         | ❌ fehlt                            |

Ein `grep` nach `smtp-server`, `SMTPServer` oder `journal-inbound` über `packages/` und `apps/`
liefert genau **zwei** Treffer — beide sind Kommentare, kein Code:

- `packages/types/src/journaling.types.ts:79` — Doc-Kommentar über `IJournalInboundJob`
- `packages/backend/src/jobs/processors/schedule-continuous-sync.processor.ts:29` — erklärender
  Kommentar, dass Journaling-Quellen über die `journal-inbound`-Queue laufen und **nicht** über die
  Poll-basierte Connector-Pipeline

Der zweite Treffer ist bemerkenswert: der OSS-Scheduler _weiß_ von der Journaling-Queue und schließt
Journaling-Quellen bewusst vom Polling aus — die Queue selbst und ihr Prozessor existieren hier aber
nicht. Beim Verdrahten von E6 ist diese Stelle zu prüfen.

Konsequenz für alle Folge-Sessions: **`grep` vor jeder Annahme** — und Treffer daraufhin ansehen, ob
sie Code oder nur Kommentar sind. `docs/enterprise/journaling/guide.md` ist keine Beschreibung des
Codes in diesem Repository.

### Warum wir den Enterprise-Ablauf nicht nachbauen

`guide.md` und `IJournalInboundJob` beschreiben zusammen diesen Ablauf: SMTP annehmen → Rohmail in
eine Tempdatei schreiben → BullMQ-Job einreihen → bei Queue-Backpressure `4xx` zurückgeben.

Das erfüllt RFC §3 **nicht**:

- Eine Tempdatei ohne `fsync` von Datei _und_ Verzeichnis ist nicht durabel.
- Es gibt kein Ledger, also auch keinen Ledger-Append vor dem `250`.
- Redis/BullMQ ist nicht die Autorität für „durabel gespeichert"; der Spool muss es sein.
- Backpressure als einziges 4xx-Kriterium adressiert Überlast, nicht Durability.

Der Receiver wird daher **direkt RFC-konform neu gebaut**, nicht als Reimplementierung des
Enterprise-Verhaltens. `IJournalInboundJob` bleibt als Phase-B-Payload nutzbar.

---

## 1. Kapitelweise Gap-Analyse

Legende: ✅ vorhanden und ausreichend · 🟡 teilweise vorhanden · ❌ fehlt vollständig

### RFC §2 — Architektur, separater Prozess

| Forderung                                                                   | Ist | Gap                                                                                                                                                                 |
| --------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smtp-ingress` als separater Prozess/Container                              | ❌  | Repo hat 3 Worker-Prozesse (`workers/ingestion.worker.ts`, `workers/indexing.worker.ts`, `jobs/schedulers/sync-scheduler.ts`) als Muster, aber keinen Ingress       |
| Eigene Credentials, kein Lesezugriff auf Archivinhalte, keine Delete-Rechte | ❌  | `db` (`src/database/index.ts`) und `config/*` sind Modul-Singletons, die aus einer gemeinsamen `.env` lesen. Rechtetrennung ist ohne eigenes Paket nicht erreichbar |
| Nur Spool-Write + Ledger-Append                                             | ❌  | —                                                                                                                                                                   |

**Entschieden (ADR-002):** neues `apps/smtp-ingress` + geteiltes `packages/journaling`.

### RFC §3 — Acceptance-Contract

| Forderung                           | Ist | Gap                                                                                                                                |
| ----------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Raw-Wire-Bytes in Spool schreiben   | ❌  | `writeEmailToTempFile()` existiert (`services/ingestion-connectors/helpers/tempFile.ts`), schreibt aber nach `tmpdir()` ohne fsync |
| `fsync()` Datei **und** Verzeichnis | ❌  | kein `fsync`-Aufruf im gesamten Repository                                                                                         |
| SHA-256 über genau diese Bytes      | 🟡  | `IngestionService.processEmail` hasht, aber die _gespeicherten_ Bytes (bei Default-Modus attachment-bereinigt)                     |
| Ledger-Append + fsync vor `250`     | ❌  | kein Ledger                                                                                                                        |
| Vollständige Response-Code-Tabelle  | ❌  | —                                                                                                                                  |
| Crash-Semantik + Startup-Spool-Scan | ❌  | —                                                                                                                                  |

**Riskantester Teil des Projekts.** Nachträglich kaum reparierbar, weil bereits quittierte
Nachrichten nicht rückwirkend durabel werden.

### RFC §4 — SMTP-Listener

| Forderung                                                                                  | Ist | Gap                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | --- | --------------------------------------------------------------------------------------------------------------------------------------- |
| ESMTP auf Port 25 (optional 587/2525)                                                      | ❌  | `.env.example`: `SMTP_JOURNALING_PORT=2525`; `docker-compose.yml` mappt `25:${SMTP_JOURNALING_PORT}`                                    |
| STARTTLS mit öffentlich vertrauenswürdigem Zertifikat, `require_tls`                       | 🟡  | `journaling_sources.requireTls` (Spalte) existiert, kein Code                                                                           |
| TLS ≥ 1.2, Version + Cipher im Ledger protokollieren                                       | ❌  | —                                                                                                                                       |
| `SIZE` 150 MB (konfigurierbar)                                                             | ❌  | —                                                                                                                                       |
| `8BITMIME`, `SMTPUTF8`                                                                     | ❌  | —                                                                                                                                       |
| **`CHUNKING`/`BDAT`** (Exchange Online nutzt BDAT)                                         | ❌  | nicht optional                                                                                                                          |
| `PIPELINING`                                                                               | ❌  | —                                                                                                                                       |
| `AUTH` PLAIN/LOGIN über TLS                                                                | 🟡  | Spalten `smtpUsername`/`smtpPasswordHash` (bcrypt) vorhanden, kein Code                                                                 |
| `allowed_sources` CIDR-Liste + M365-IP-Refresh-Helper mit Operator-Freigabe                | 🟡  | Spalte `allowedIps` (jsonb) vorhanden, kein Code, kein Refresh-Helper                                                                   |
| `journal_recipients` explizit, **kein Catch-all**                                          | 🟡  | Spalte `routingAddress` vorhanden, kein Code                                                                                            |
| Rate-/Connection-Limits, Timeouts                                                          | ❌  | `express-rate-limit` existiert für HTTP, nicht für SMTP                                                                                 |
| Idempotenz: Dedupe auf `content_sha256`, aber Ledger-Eintrag je Receipt mit `duplicate_of` | 🟡  | Dedupe-Logik existiert in `IngestionService.processEmail` (Drei-Gate + Byte-Hash-Gate auf `storage_hash_sha256`), Ledger-Semantik fehlt |

### RFC §5 — Ledger und Hash-Chain

| Forderung                                          | Ist | Gap                                                                       |
| -------------------------------------------------- | --- | ------------------------------------------------------------------------- |
| Tabelle `journal_ledger`                           | ❌  | —                                                                         |
| Lückenlose, streng monotone `seq`                  | ❌  | Postgres-Sequenzen reißen bei Rollback Löcher → eigener Mechanismus nötig |
| Kanonische, längenpräfixierte Kodierung            | ❌  | —                                                                         |
| Serialisierte Writes (Advisory Lock)               | ❌  | —                                                                         |
| `synchronous_commit = on`                          | ❌  | nicht gesetzt                                                             |
| Parse-Fehler als Ledger-Event statt Ablehnung      | ❌  | —                                                                         |
| Anchoring via RFC 3161 TSA                         | ❌  | —                                                                         |
| Externe append-only Anchor-Ziele                   | ❌  | —                                                                         |
| `verify`-Tool mit Erst-Divergenz-Report, read-only | ❌  | siehe §5.6 unten                                                          |

**Teilweise verwandt:** `packages/backend/src/database/schema/audit-logs.ts` hat bereits eine
`previousHash`/`currentHash`-Kette — **aber keinen Verifier im OSS-Code**. Sie ist ein brauchbares
Vorbild für Stil und Migration, wird aber **nicht erweitert**: das Audit-Log protokolliert
Benutzeraktionen, das Ledger protokolliert Empfangsereignisse. Vermischung würde beide Zwecke
beschädigen (ADR-005).

RFC §5.1 beschreibt genau den Ist-Zustand korrekt: `archived_emails.storage_hash_sha256` erkennt
Korruption, aber keine absichtliche Änderung (wer das Objekt ändern kann, kann die Hash-Zeile
ändern) und **keine Löschung** — eine entfernte Zeile hinterlässt keine Spur.

### RFC §6 — Journal-Report-Parsing

| Forderung                                                                                                    | Ist | Gap                                                                                                        |
| ------------------------------------------------------------------------------------------------------------ | --- | ---------------------------------------------------------------------------------------------------------- |
| `multipart/mixed` mit `text/plain`-Report + `message/rfc822`-Original                                        | ❌  | `mailparser`/`simpleParser` ist Dependency und wird von allen Connectoren genutzt — brauchbare Basis       |
| Envelope-Felder inkl. **`Bcc`**, mehrfache `Recipient:`, DL-Expansion, `On-Behalf-Of`                        | ❌  | genau die Information, die eine BCC-Transportregel _nicht_ liefert — die Existenzberechtigung des Features |
| Beide Teile erhalten (Außenobjekt roh + Envelope in Metadaten)                                               | ❌  | —                                                                                                          |
| S/MIME-verschlüsselter Innenteil → `content_encrypted`, nur Header indexieren                                | ❌  | —                                                                                                          |
| Plain-BCC-Fallback (Postfix `always_bcc`, Zimbra, mailcow, Google Routing) mit reduzierter Envelope-Fidelity | 🟡  | `guide.md` dokumentiert Google-Routing und Postfix-Transport-Maps, Code fehlt                              |
| NDRs/Bounces speichern und flaggen                                                                           | ❌  | —                                                                                                          |
| Owner-Resolution über `organizationDomains`                                                                  | 🟡  | Spalte + ausführliche Doku in `guide.md` vorhanden, Code fehlt                                             |

### RFC §7 — Storage

| Forderung                                                             | Ist | Gap                                                                                                                                                                                     |
| --------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Archivobjekt = Raw-Wire-Bytes, immutable, nach `seq` verschlüsselt    | 🟡  | `StorageService` (`services/StorageService.ts`) + `S3StorageProvider`/`LocalFileSystemProvider` vorhanden; Pfade sind nach Source-ID und Dateiname geschlüsselt, nicht nach `seq`       |
| S3 Object Lock **COMPLIANCE**-Modus                                   | ❌  | `S3StorageProvider` nutzt `@aws-sdk/client-s3` + `lib-storage` `Upload`, kennt Object Lock nicht                                                                                        |
| Least-Privilege-Creds ohne `DeleteObject`/`BypassGovernanceRetention` | ❌  | `IStorageProvider` hat `delete()`; keine Rechtetrennung                                                                                                                                 |
| Local-FS als „substanziell schwächer" dokumentiert, `chattr +i`       | ❌  | Local-FS ist gleichberechtigt dokumentiert                                                                                                                                              |
| Verschlüsselung **nach** dem Hashing; `content_sha256` über Plaintext | ✅  | Bereits so: `StorageService` verschlüsselt transparent (AES-256-CBC, Präfix `oa_enc_idf_v1::`), die bestehenden Hashes sind über Plaintext. **Diese Reihenfolge muss erhalten bleiben** |

### RFC §8 — Completeness-Monitoring

| Forderung                                                                    | Ist | Gap                                                                                                                              |
| ---------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------- |
| Heartbeat-Alert (N Min, Geschäftszeiten)                                     | ❌  | `journaling_sources.lastReceivedAt` existiert als Datenbasis                                                                     |
| Gap-Detection im Ledger                                                      | ❌  | —                                                                                                                                |
| Spool-Tiefe/-Alter, Phase-B-Backlog, TSA-Erreichbarkeit, Storage-Latenz      | 🟡  | Job-Admin-Oberfläche existiert (`routes/dashboard/admin/jobs`, `api/controllers/index-admin.controller.ts`) als Anknüpfungspunkt |
| Alternate-Mailbox-Reconciliation (Exchange-Ausweichpostfach als Pull-Quelle) | ❌  | technisch gut machbar: `IEmailConnector`/`MicrosoftConnector` existieren bereits                                                 |
| Exchange-Message-Trace-CSV-Abgleich mit signiertem Bericht                   | ❌  | —                                                                                                                                |
| Alerting-Kanäle                                                              | 🟡  | `nodemailer` ist Dependency; kein Alert-Subsystem                                                                                |

### RFC §9 — Compliance-Features

| Forderung                                                             | Ist | Gap                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auditor-Rolle, read-only, getrennt von Admin                          | 🟡  | Sehr gute Basis: CASL, DB-Rollen mit JSONB-Policies, `FilterBuilder.create()` für Row-Level-Scoping, und **fertige unbenutzte Fixtures** in `packages/backend/src/iam-policy/test-policies/{read-only-all,auditor-specific-mailbox,auditor-specific-sources}.json`. Es fehlt: Seeding einer Auditor-Rolle und Frontend-Nav-Filterung |
| Export: EML + Manifest-CSV + Prüfanleitung                            | 🟡  | `archiver` ist Dependency, Export-Action existiert im Vokabular; kein Manifest, keine Anleitung                                                                                                                                                                                                                                      |
| Löschen nur via Retention-Expiry, als typisiertes Ledger-Event        | 🟡  | `schema/compliance.ts` + `hooks/RetentionHook.ts` + `complianceLifecycleQueue` vorhanden; keine Ledger-Events                                                                                                                                                                                                                        |
| Legal Hold als Ledger-Event mit wer/wann/warum                        | 🟡  | Legal-Hold-Schema und UI vorhanden (`routes/dashboard/compliance/legal-holds/`); keine Ledger-Events                                                                                                                                                                                                                                 |
| Build-Identität (Image-Digest + Git-Commit) in UI, `verify`, Manifest | ❌  | —                                                                                                                                                                                                                                                                                                                                    |

### RFC §10 — DSGVO / Retention-Konflikt

| Forderung                                                                           | Ist | Gap |
| ----------------------------------------------------------------------------------- | --- | --- |
| Ledger-Einträge nie löschen                                                         | ❌  | —   |
| Löschung entfernt nur das Objekt, `object_erased`-Event mit Rechtsgrundlage + Hash  | ❌  | —   |
| `verify` meldet „absichtlich gelöscht" statt Chain-Bruch                            | ❌  | —   |
| Verweigerte Löschung wird ebenfalls protokolliert                                   | ❌  | —   |
| Dokumentation: Object Lock COMPLIANCE macht vorzeitige Löschung technisch unmöglich | ❌  | —   |

### RFC §11 — Konfiguration

| Forderung                                               | Ist | Gap                                                                                                                                                                                                      |
| ------------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strukturierte Ingress-/Ledger-/Monitoring-Konfiguration | 🟡  | Kein YAML/TOML-App-Config im Repo. Env ad hoc gelesen, `config/*`-Module werfen beim Import. `zod` ist bereits Backend-Dependency. Zusätzlich DB-Konfiguration via `system_settings` + `SettingsService` |

### RFC §12 — Testplan

| Forderung                                                                                                   | Ist | Gap                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adversariale Tests (Kill während DATA, fsync-Fehler, Disk-Full, Tamper, Soak, BDAT, Exchange-E2E, Oversize) | ❌  | **Es gibt null Tests und keinen Test-Runner im gesamten Repository.** Kein vitest/jest/playwright, kein Test-Script. CI (`.github/workflows/`) hat nur `cla`, `deploy-docs`, `docker-deployment`, `release-tag` — kein Lint-, Typecheck- oder Test-Job. `CONTRIBUTING.md` verlangt Tests rein aspirativ |

Deshalb ist **E1 (Test- und CI-Fundament) das erste Epic** und nicht das letzte.

### RFC §13 — Nicht-Behauptung

| Forderung                                                                                 | Ist | Gap                                           |
| ----------------------------------------------------------------------------------------- | --- | --------------------------------------------- |
| Absatz im README: Architektur _ermöglicht_ Compliance, macht keine Installation compliant | ❌  | `README.md` enthält keine solche Klarstellung |

### RFC §14 — Rollout

| Forderung                                                                                                            | Ist | Gap                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feature-Flag, default aus                                                                                            | ❌  | —                                                                                                                                                       |
| Parallelbetrieb mit Pull-Ingestion, Dedupe auf `Message-ID` + Content-Hash, journalisierte Kopie bevorzugen          | 🟡  | Dedupe-Bausteine vorhanden (`doesEmailExist`, `msgid_header_source_idx`, `storage_hash_source_idx`); Präferenzlogik fehlt                               |
| Deployment-Guide (Journal-Rule, Ausweichpostfach, DNS/MX, Firewall, Zertifikat, Object-Lock-Bucket, TSA, Monitoring) | 🟡  | `guide.md` deckt MTA-Konfiguration, DNS, Firewall gut ab — beschreibt aber abwesenden Code und kennt kein Object Lock, keine TSA, kein Ausweichpostfach |
| Pull-Ingestion als Backfill/Reconciliation umdokumentieren                                                           | ❌  | —                                                                                                                                                       |

---

## 2. Was wiederverwendet wird

Kein Neubau, wo Bestand trägt:

| Zweck                                     | Bestehendes Artefakt                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Hashing, Dedupe, Storage-Pfade            | `IngestionService.processEmail()` (Drei-Gate-Dedupe, Byte-Hash-Gate)           |
| Duplikatprüfung                           | `IngestionService.doesEmailExist(messageId, sourceId, userEmail)`              |
| Storage-Abstraktion inkl. Verschlüsselung | `StorageService`, `IStorageProvider` (`packages/types/src/storage.types.ts`)   |
| Große EMLs off-heap puffern               | `writeEmailToTempFile()`                                                       |
| Indexierung, Suche                        | `IndexingService.indexEmailBatch()`, `SearchService`                           |
| Row-Level-Scoping für Auditor             | `FilterBuilder.create(userId, resourceType, action)`                           |
| Auth/Autorisierung                        | `requireAuth`, `requirePermission`, `AuthorizationService.can()`, `IamService` |
| Auditor-Policies                          | `iam-policy/test-policies/*.json` (bisher unbenutzt)                           |
| Objekt-Hash-Prüfung als `verify`-Basis    | `IntegrityService.checkEmailIntegrity()`                                       |
| Mount-Punkt für neue Subsysteme           | `ArchiverModule`-Seam in `api/server.ts`                                       |
| Phase-B-Job-Payload                       | `IJournalInboundJob` (bereits definiert)                                       |
| Ausweichpostfach als Pull-Quelle          | `IEmailConnector`, `MicrosoftConnector`, `EmailProviderFactory`                |
| Chain-Vorbild (Stil, Migration)           | `schema/audit-logs.ts` — Vorbild, **nicht** erweitern                          |
| Config-Validierung                        | `zod` (bereits Dependency)                                                     |
| Textextraktion                            | `helpers/textExtractor.ts`, `OcrService`, Tika                                 |
| ZIP-Export                                | `archiver` (bereits Dependency)                                                |
| Alert-Versand                             | `nodemailer` (bereits Dependency)                                              |

## 3. Nebenbefunde (nicht RFC-Scope, aber relevant)

1. **Doku-Drift im IAM:** `docs/services/iam-service/iam-policy.md` listet die Action `export` nicht
   und beschreibt `manage` fälschlich als Expansion zu `create/read/update/delete/search/sync`.
   Code ist konsistent (`iam.types.ts` und `iam-policy/policy-validator.ts` enthalten beide
   `export`); CASLs `manage` ist ein echter Wildcard und deckt `export` mit ab. Die Doku ist stale.
   → in E11 mitkorrigieren, da die Auditor-Rolle `export` braucht.
2. **`requirePermission` ist grobkörnig:** übergibt nie ein Resource-Objekt (TODO im Code), daher
   müssen Row-Level-Prüfungen zwingend über `FilterBuilder` laufen.
3. **Kein Frontend-Permission-Helper:** `routes/dashboard/+layout.svelte` rendert statische
   `baseNavItems`/`enterpriseNavItems`. Eingeschränkte Nutzer sehen Menüpunkte, die dann 403
   liefern. Betrifft die Auditor-Rolle direkt.
4. **`IamService`-Slug-Bug:** `name.toLocaleLowerCase().replaceAll('', '_')` fügt `_` zwischen jedes
   Zeichen ein. Nur erreichbar, wenn das `slug`-Argument weggelassen wird — beim Seeding der
   Auditor-Rolle daher `slug` explizit setzen.
5. **`createDefaultRoles()` liefert veralteten Stand:** in `api/controllers/iam.controller.ts` wird
   nach dem Seeding das _vor_-Seeding-Array zurückgegeben; neu erzeugte Rollen fehlen in der ersten
   Antwort.
6. **`AuthTokenPayload.roles: string[]`** (Rollennamen) vs. `User.role: Role | null` (Einzelrolle)
   widerspricht der m:n-Tabelle `userRoles`.
