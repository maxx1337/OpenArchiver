# Zielarchitektur

Dieses Dokument beschreibt die **Zielarchitektur**. Es ist Entwurfsgrundlage, nicht Protokoll: Wo ein
Punkt als _offen_ markiert ist, entscheidet ihn das jeweilige Epic und trägt das Ergebnis als ADR in
`05-entscheidungen.md` nach. Verbindlich und nicht verhandelbar sind nur die Invarianten aus dem Skill
`.claude/skills/journal-ledger/SKILL.md`.

---

## 1. Prozess- und Credential-Topologie

```
                     ┌────────────────────────────────────┐
 Exchange Online     │ apps/smtp-ingress   (neuer Prozess)│
 Postfix / Zimbra    │  ├─ TLS-Terminierung               │
 Google (Routing)    │  ├─ Source-ACL (CIDR)              │
        │            │  ├─ Recipient-ACL (kein Catch-all) │
        └───SMTP────▶│  └─ zweiphasige durable Annahme    │
                     └───────────┬────────────────────────┘
                        (1) fsync Bytes + Verzeichnis
                                 ▼
                        ┌──────────────────┐
                        │  spool (Disk)    │ autoritativ bis Phase B bestätigt
                        └────────┬─────────┘
                        (2) Ledger-Append + fsync
                                 ▼
                        ┌──────────────────┐
                        │ journal_ledger   │ lückenlose seq, Hash-Chain
                        └────────┬─────────┘
                        (3) → SMTP 250 OK
                                 │
                        ─── async Grenze ───
                                 ▼
        ┌────────────────────────────────────────────────┐
        │ journal-inbound Worker (in packages/backend)   │
        │  ├─ Journal-Report parsen                      │
        │  ├─ Innenmail + Envelope extrahieren           │
        │  ├─ indexieren (Meilisearch)                    │
        │  └─ Objekt hochladen (WORM)                     │
        └────────────────────┬───────────────────────────┘
                             ▼
              Object Store (S3 + Object Lock) + Metadaten-DB
```

### Rechtetrennung (RFC §2)

| Prozess                  | Datenbank                                                                                                                                                                    | Storage                                                                                                                                      | Redis                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `apps/smtp-ingress`      | eigener Rollen-Account: `INSERT` auf `journal_ledger`, `SELECT` auf `journaling_sources` und den Ledger-Head. **Kein** `UPDATE`/`DELETE`, kein Zugriff auf `archived_emails` | nur Spool-Verzeichnis (lokal). **Kein** Object-Store-Zugriff                                                                                 | nur `enqueue` (Phase-B-Hinweis, optional) |
| `journal-inbound` Worker | Vollzugriff auf Archiv-Metadaten, `INSERT` auf `journal_ledger` (Events), Spool-Cleanup                                                                                      | Object Store **ohne** `s3:DeleteObject`, `s3:DeleteObjectVersion`, `s3:BypassGovernanceRetention`, ohne verkürzendes `s3:PutObjectRetention` | vollständig                               |
| Anchor-Job               | `SELECT` Ledger-Head, `INSERT` `anchor`-Event                                                                                                                                | separates Anchor-Ziel mit **eigenen** Credentials (write-only)                                                                               | —                                         |
| `verify`                 | **read-only** Credentials, damit Prüfer es selbst ausführen können                                                                                                           | read-only                                                                                                                                    | —                                         |

Die Trennung wird über getrennte Umgebungsvariablen und getrennte Postgres-Rollen realisiert, nicht
über Code-Konventionen.

**Append-Only ist seit dem 2026-07-31 in der Datenbank erzwungen — durch einen Trigger (`JR-205`,
ADR-009), Migration `0042_journal_ledger_append_only.sql`.** Eine `plpgsql`-Funktion wirft mit
`ERRCODE = restrict_violation`, und **vier** Trigger hängen daran: je Tabelle einer für
`UPDATE OR DELETE` (row level) und einer für `TRUNCATE` (statement level). Umfang ist `journal_ledger`
**und** `deployment_identity`, weil die `deployment_id` im Genesis-Hash jeder Kette steckt.

Der `TRUNCATE`-Trigger ist Pflicht, nicht Beiwerk: `TRUNCATE` löst Row-Level-Trigger **nicht** aus, ein
reiner Row-Trigger hätte eine Anweisung offen gelassen, die den ganzen Ledger entfernt.

> **Die zweite Hälfte fehlt noch, und sie ist eine Deployment-Aufgabe (E11).** Der Trigger ist von einer
> Rolle, die die Tabellen **besitzt**, in zwei Anweisungen abschaltbar — gemessen, siehe **F37**: in einer
> Standardinstallation ist `POSTGRES_USER` Superuser und Eigentümer, und `DATABASE_URL` benutzt genau
> diese Rolle. Der Rechteentzug (eigene Rolle ohne Eigentum, nur `INSERT`/`SELECT`, plus Startup-Check)
> ist in ADR-009 festgeschrieben und E11 zugeordnet. Was der Trigger heute leistet: er schließt **F1**
> als Manipulationsweg, weil eine `WHERE`-Klausel-Injection kein `SET` und kein `ALTER TABLE` absetzen
> kann.

## 2. Paketstruktur

| Paket                 | Neu?         | Inhalt                                                                                                                                                                    |
| --------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/journaling` | **neu**      | Spool, Ledger, kanonische Kodierung, Chain-Berechnung, Journal-Report-Parser, Konfigurationsvalidierung (zod), Crash-Recovery. Reine Logik, keine HTTP-Schicht            |
| `apps/smtp-ingress`   | **neu**      | SMTP-Server, TLS, ACLs, Statuscode-Mapping, Graceful Drain. Dünn — die Logik liegt in `packages/journaling`                                                               |
| `packages/types`      | erweitert    | Ledger-Typen, Event-Typen, Parser-Ergebnistypen, `verify`-Report-Typen                                                                                                    |
| `packages/backend`    | erweitert    | `journal-inbound`-Worker, Ledger-Events für Retention/Erasure/Legal-Hold, Monitoring-Jobs, Auditor-Rolle, Export mit Manifest, Object-Lock-Support in `S3StorageProvider` |
| `apps/oa-verify`      | **neu** (E9) | `verify`-CLI, read-only                                                                                                                                                   |

### Abhängigkeitsregel

`packages/journaling` darf **nicht** von `packages/backend` abhängen.

Grund: mehrere `packages/backend/src/config/*`-Module `throw` beim Import (z. B. `config/storage.ts`
validiert `STORAGE_ENCRYPTION_KEY`), und `src/database/index.ts` ist ein Modul-Singleton auf
`DATABASE_URL`. Ein Ingress-Prozess, der diese Module importiert, erbt sie — und damit sowohl die
Credentials als auch die Abstürze für Subsysteme, die er nicht braucht. `packages/journaling` erhält
seine DB-Verbindung und Konfiguration daher **injiziert** (Konstruktor-Parameter), nicht per Import.

Erlaubte Abhängigkeit: `packages/journaling` → `packages/types`. `packages/backend` →
`packages/journaling` ist erlaubt und gewollt (der Worker nutzt Parser und Ledger-Events).

## 3. Der Empfangspfad (Phase A)

Ablauf innerhalb der SMTP-Session, vor der Antwort auf End-of-DATA / letztes BDAT:

1. **Transaktions-ID** vergeben (ULID/UUID). Die `seq` steht hier noch nicht fest, weil sie erst im
   Ledger-Append vergeben wird — der Spool-Dateiname kann sie also nicht enthalten.
2. **Raw-Wire-Bytes** streamend in `spool/incoming/<txid>.eml` schreiben. Dot-Unstuffing ist die
   einzige erlaubte Veränderung. Kein Parsing, keine Normalisierung.
3. `fsync()` auf den Dateideskriptor **und** `fsync()` auf das Verzeichnis. Beides. Ein Datei-fsync
   allein macht den Verzeichniseintrag nicht durabel.
4. **SHA-256** über genau diese Bytes (streamend mitberechnet).
5. **Ledger-Append** (siehe §4) inklusive `txid`, TLS-Version/Cipher, Remote-IP, EHLO-Name,
   Envelope-From/Rcpt, `size_bytes`, `content_sha256` — mit `synchronous_commit = on`.
6. **`250 2.0.0 Ok: queued as <seq>`.**
7. _Danach_ (außerhalb des Contracts): BullMQ-Job für Phase B einreihen.

Schritt 7 ist **Optimierung, nicht Autorität.** Der Spool ist autoritativ. Ein Reconciler-Job sweept
periodisch den Spool nach Einträgen, die einen Ledger-Eintrag haben, aber noch nicht Phase-B-fertig
sind, und reiht sie nach. Damit ist ein Redis-Ausfall kein Datenverlust und rechtfertigt kein `4xx`.

`IJournalInboundJob` (`packages/types/src/journaling.types.ts`) bleibt als Payload nutzbar; sein
Feld `tempFilePath` verweist künftig auf den Spool-Pfad, nicht auf `tmpdir()`.

### Statuscodes

Vollständige Tabelle im Skill `journal-ledger` §2. Kern: **lokale Fehler ⇒ `4xx`, nie `5xx`.**
Object-Store- oder Redis-Ausfall ⇒ trotzdem `250`, weil Phase B asynchron ist.

## 4. Ledger

### Tabelle

`packages/backend/src/database/schema/journal-ledger.ts`, im Barrel `schema.ts` registrieren.
Feldsatz nach RFC §5.2: `seq`, `received_at`, `remote_ip`, `ehlo_name`, `tls_version`, `tls_cipher`,
`envelope_from`, `envelope_rcpt`, `size_bytes`, `content_sha256`, `duplicate_of`, `event_type`,
`event_payload`, `prev_chain_hash`, `chain_hash` — plus `spool_txid` für die Crash-Recovery.

Stilvorgaben: `timestamp(..., { withTimezone: true })`, typisiertes JSONB, `pgEnum` für
`event_type`, Doc-Kommentare auf nicht offensichtlichen Spalten. Vorbild:
`schema/journaling-sources.ts`.

`event_type` mindestens: `receipt` · `anchor` · `retention_expiry` · `object_erased` ·
`legal_hold_set`. Enum-Werte lassen sich in Postgres nicht entfernen — Erweiterungen sind später
möglich, Umbenennungen nicht.

**Umgesetzt am 2026-07-31 (`JR-204`, Migration `0041_even_scream.sql`).** Vier Festlegungen darin
weichen von der naheliegenden Lösung ab und sind es wert, hier zu stehen — die vollständige Begründung
steht als Doc-Kommentar an der jeweiligen Spalte:

- **Hashes sind `bytea`, nicht hex-`text`** wie im Bestand (`archived_emails.storage_hash_sha256`).
  Diese Bytes gehen **in** einen Hash, und eine Textform fügt eine Groß-/Kleinschreibungsfrage an einem
  Wert hinzu, von dem die Kettenverifikation abhängt. Preis: **eine** explizite Konversion dort, wo ein
  Ledger-Hash gegen die Bestandsspalte verglichen wird (Phase B, `verify`).
- **`remote_ip` ist `text`, nicht `inet`.** Der gehashte Wert **ist** diese kanonische Textform; `inet`
  würde beim Lesen eine zweite Normalisierung anwenden, die davon abweichen kann.
- **Kein Fremdschlüssel auf `journaling_sources`.** Jede Referenzaktion wäre `SET NULL` — ändert ein
  gehashtes Feld und bricht die Kette — oder `CASCADE`, was Beweise löscht. Die Aussage „dieser Endpunkt
  hat gesendet" bleibt wahr, nachdem der Endpunkt entfernt wurde.
- **`chain_scope_id` hat `ON DELETE restrict`.** Das Löschen eines Archivs mit Ledger-Zeilen ist
  **blockiert**; ein Beleg, der mit der Konfiguration verschwindet, die ihn erzeugt hat, beweist nichts.
  **Konsequenz für E12:** „Archiv nach Fristablauf entfernen" braucht ein eigenes Verfahren, ein
  `DELETE` ist es nicht.

Dazu sechs `CHECK`-Constraints: ms-Vielfache in `received_at` (ADR-006 §3.1), 32 Byte für alle drei
Hash-Spalten, `seq >= 0` und **`duplicate_of < seq`**. Der letzte ist beim Testschreiben entstanden: der
zusammengesetzte Fremdschlüssel `(chain_scope_id, duplicate_of) → (chain_scope_id, seq)` verhindert den
**Selbstverweis nicht**, weil Postgres Referenzintegrität am Ende des Statements prüft und das
referenzierte Paar dann die gerade eingefügte Zeile ist — eine Quittung wäre ihr eigenes Original
geworden.

### Lückenlose `seq`

Eine Postgres-Sequenz ist **ungeeignet**: `nextval()` wird bei Rollback nicht zurückgedreht und
hinterlässt permanente Löcher. Da eine Lücke laut RFC §8 ein Manipulationssignal ist, würde ein
harmloses Loch die Vollständigkeitsargumentation zerstören.

Stattdessen wird `seq` **innerhalb derselben Transaktion** aus dem aktuellen Kopf abgeleitet, die
auch den Eintrag committet. Rollback rollt die Vergabe mit zurück. Das setzt Serialisierung voraus:

```
BEGIN;
  SET LOCAL synchronous_commit = on;
  SELECT pg_advisory_xact_lock(<ledger-lock-key>);   -- transaktionsgebunden, löst bei COMMIT/ROLLBACK
  -- Kopf lesen: seq + chain_hash des letzten Eintrags
  -- chain_hash(n) berechnen
  INSERT INTO journal_ledger (...);
COMMIT;
```

`pg_advisory_xact_lock` (nicht `pg_advisory_lock`) ist Pflicht: die Sperre wird beim Transaktionsende
automatisch freigegeben, auch bei Abbruch. Der Hash **muss innerhalb** der Sperre berechnet werden —
außerhalb entstehen konkurrierende Ketten.

**Eine Kette je Mandant — entschieden am 2026-07-31, ADR-007.** Der frühere Satz an dieser Stelle
(„für v1 wird eine einzelne Kette umgesetzt") berief sich auf RFC §5.2 und verwechselte dabei zwei
Dinge: §5.2s „do not start there" gilt für **Shard**-Ketten zur Horizontalskalierung, nicht für eine
fachliche Partition je Mandant. Begründung und alle Konsequenzen stehen in ADR-007; die drei, die
dieses Kapitel betreffen:

- Der Lock-Key wird **aus der Kettenkennung abgeleitet**, nicht konstant. Die Serialisierungsforderung
  aus RFC §5.2 gilt damit **je Kette** — nebenläufige Appends in verschiedene Ketten dürfen sich nicht
  blockieren, nebenläufige Appends in dieselbe Kette müssen es.
- `seq` läuft **je Kette** (`UNIQUE (chain_scope_id, seq)`), nicht global.
- Die Kettenkennung geht **in den Genesis-Hash** — sonst wären zwei Ketten mit identischem erstem
  Ereignis hashgleich und ein Eintrag zwischen Mandanten verschiebbar, ohne die Kette zu brechen.

**`chain_scope_id` ist `ingestion_sources.id`** — eine Kette je **Archiv**, ebenfalls am 2026-07-31
entschieden. `journaling_source_id` steht als **Attribut** in jeder Ledger-Zeile, damit „wer hat
gesendet" im Beleg bleibt, ohne eine zweite Kette zu sein. Zwei Endpunkte auf demselben Archiv teilen
also **eine** Kette, und ein neu angelegter Endpunkt setzt keine neue Kette auf. Begründung in ADR-007.

> **„Mandant" heißt hier Archiv, nicht Endkunde.** Der Begriff wird regelmäßig als „Kunde" gelesen,
> und dann sind die Folgerungen falsch. Drei Ebenen, die auseinanderzuhalten sind: ein **Endkunde**
> ist eine Installation mit **einer** `deployment_id`; ein **Mandant** ist ein Archiv
> (`ingestion_sources.id`) und damit **eine Kette** innerhalb dieser Installation; ein **Endpunkt**
> (`journaling_sources.id`) ist ein Attribut in der Ledger-Zeile. Die Kostenrechnung „täglich × 50
> Mandanten" in ADR-022 und R-15 meint deshalb 50 **Archive einer** Installation, nicht 50 Kunden.
> Ein Kunde mit Tochtergesellschaften ist ein Kunde mit mehreren Archiven. Welches Betriebsmodell
> darüber liegt — eine Instanz je Endkunde oder ein geteilter Stack — ist Gegenstand von **ADR-024**
> und noch nicht entschieden; für dieses Kapitel ändert die Entscheidung nichts, weil der Lock-Key,
> das `seq` und der Genesis in jedem Fall je Kette gelten.

### Kanonische Kodierung

Anforderung: deterministisch, längenpräfixiert, plattform- und versionsunabhängig — **nie**
JSON-Schlüsselreihenfolge, nie lokalisierte Zeitformatierung.

**Festgelegt am 2026-07-31 in ADR-006 (`JR-203`), mit Testvektoren.** Dieses Kapitel gibt den Rahmen;
die verbindliche Fassung mit Feldreihenfolge, Typ-Tags und Vektoren steht in `05-entscheidungen.md`.

- Führendes Versionsbyte (`0x01`), dann `uint32be(field_count)` — die Feldzahl ist mitgehasht, damit
  ein entfallenes Feld am Ende nicht unbemerkt bleibt.
- Je Feld: Typ-Tag (1 Byte) + Länge (4 Byte, big-endian) + Rohbytes. `NULL` = **eigenes Tag** mit
  Länge 0, damit „kein EHLO gesendet" und „EHLO mit leerem Namen" verschieden hashen.
- Zeitstempel als int64 big-endian, Mikrosekunden seit Unix-Epoche, UTC. **Geschrieben werden nur
  ms-Vielfache** — `timestamptz` hat µs, JavaScripts `Date` hat ms, und ein Wert, der über ein `Date`
  gelaufen ist, hasht nach dem Roundtrip anders.
- Arrays (`envelope_rcpt`) als Elementanzahl + je Element längenpräfixiert, in **Empfangsreihenfolge**
  (nicht sortiert — die Reihenfolge ist Teil des Belegs).
- `event_payload` kanonisch nach RFC 8785 (JCS), eingeschränkt auf Ganzzahlen — keine
  Fließkommazahlen, keine `JSON.stringify`-Ausgabe ohne sortierte Schlüssel.

**Gehasht wird jede wertetragende Spalte — alle 16, nicht die acht aus RFC §5.2.** Das ist die
folgenreichste Festlegung der ADR: die Formel im RFC lässt `remote_ip`, `ehlo_name`, `tls_version`,
`tls_cipher` und `duplicate_of` aus, die damit nachträglich änderbar wären, ohne die Kette zu brechen.
Eine Spalte im Beleg zu führen und nicht zu hashen, behauptet Beweiskraft, die nicht existiert.

```
chain_hash(n) = SHA256( canonical_encode(...) || prev_chain_hash(n-1) )
chain_hash(0) = SHA256( "open-archiver:journal-ledger:v1:" || <deployment_id> || ":" || <chain_scope_id> )
```

> `chain_scope_id` ist seit ADR-007 Teil des Genesis: es gibt eine Kette je Mandant, und ohne die
> Kennung im Genesis wären zwei Ketten mit identischem erstem Ereignis hashgleich. Beide Kennungen
> stehen dort als **UUID-Textform**, abweichend von den 16 Rohbytes der Feldkodierung — damit ein
> Prüfer den Genesis-Hash mit `printf … | sha256sum` ohne unseren Code nachrechnen kann. Die Ausnahme
> ist beabsichtigt und in ADR-006 §4.1 als solche vermerkt.

`deployment_id` liegt in einer eigenen Tabelle `deployment_identity` (eine Zeile, in der Migration per
`gen_random_uuid()` erzeugt, append-only geschützt) — **nicht** in `system_settings`, die über die
Einstellungs-API schreibbar ist. Eine Änderung der Kodierung invalidiert jede bestehende Kette — sie
ist ein Migrationsvorgang, keine Refaktorierung, und sie erhöht das Versionsbyte.

### Abgrenzung zu `audit_logs`

`packages/backend/src/database/schema/audit-logs.ts` hat bereits eine
`previousHash`/`currentHash`-Kette (ohne Verifier im OSS-Code). Sie wird **nicht erweitert**
(ADR-005): das Audit-Log protokolliert Benutzeraktionen, das Ledger protokolliert Empfangsereignisse
und Objektlebenszyklen. Unterschiedliche Schreiber, unterschiedliche Rechte, unterschiedliche
Aufbewahrungslogik. Sie ist Vorbild für Stil und Migration, nicht Ziel.

## 5. Crash-Recovery

Beim Start von `apps/smtp-ingress` **und** des `journal-inbound`-Workers:

1. Spool-Verzeichnis auflisten.
2. Für jede Datei den Ledger nach `spool_txid` befragen:
    - **Ledger-Eintrag vorhanden** → die Nachricht war quittiert. Phase B ist offen: nachreihen.
    - **Kein Ledger-Eintrag** → Absturz zwischen Schritt 3 und 5. Die Nachricht wurde **nie
      quittiert**; der Sender wiederholt. Datei nach `spool/quarantine/` verschieben und **Alert
      auslösen**. Nicht löschen — sie ist Beleg dafür, dass ein Absturz stattgefunden hat.
3. Der wiederholte Zustellversuch erzeugt einen neuen Receipt-Eintrag; die Objekt-Deduplizierung auf
   `content_sha256` verhindert ein zweites Archivobjekt, `duplicate_of` verweist auf das Original.

Nie eine Spool-Datei ohne Ledger-Eintrag stillschweigend löschen.

## 6. Phase B — `journal-inbound` Worker

Neuer Worker-Prozess in `packages/backend`, nach dem Muster von `src/workers/ingestion.worker.ts`
(Name-Switch-Dispatch, eigenes `start:journal-worker`-Skript, `maxStalledCount`/`lockDuration`
bewusst setzen — die Kommentare im Ingestion-Worker erklären, warum).

Ablauf: Spool-Datei lesen → Journal-Report parsen (RFC §6) → Außenobjekt roh in den Object Store →
Envelope + Metadaten in `archived_emails` → indexieren → Spool-Datei freigeben.

- **Objekt-Deduplizierung** auf `content_sha256`; **jede** Receipt bleibt im Ledger, Duplikate mit
  `duplicate_of`. Empfangsereignis ≠ Nachricht.
- **Parse-Fehler** setzen `parse_failed`, indexieren was extrahierbar ist, alarmieren — und lehnen
  nichts ab.
- **Hashing vor Verschlüsselung.** `StorageService` verschlüsselt transparent; `content_sha256` muss
  über die Plaintext-Wire-Bytes gebildet sein, damit es gegen einen Re-Export prüfbar bleibt. Das ist
  im Bestand bereits so und muss so bleiben.
- Wiederverwendung: `IngestionService.processEmail()` für Hashing/Dedupe/Storage-Pfade,
  `IndexingService.indexEmailBatch()` für die Indexierung, `StorageService` für Storage.
  **Offen (E6):** ob `processEmail` erweitert oder ein journaling-spezifischer Pfad daneben gestellt
  wird — die Methode hat bereits erhebliche Komplexität.

## 7. Storage / WORM

- Empfohlenes Backend: S3-kompatibel mit **Object Lock im COMPLIANCE-Modus** (MinIO genügt).
  `S3StorageProvider` erhält optionale Object-Lock-Parameter (`ObjectLockMode`,
  `ObjectLockRetainUntilDate`). Bestehende Aufrufer bleiben unverändert.
- Local-FS bleibt unterstützt, wird aber als **substanziell schwächer** dokumentiert: dediziertes
  Mount, restriktive Rechte, `chattr +i` wo das Dateisystem es hergibt.
- Object Lock COMPLIANCE macht vorzeitige Löschung **technisch unmöglich** — auch für uns. Das ist
  der Zweck des Modus und muss im Deployment-Guide vor der Wahl der Aufbewahrungsfrist stehen,
  nicht danach.

## 8. Anchoring

Täglicher Job (konfigurierbar): **alle** Kettenköpfe lesen → **Merkle-Baum** darüber bauen → **ein**
RFC-3161-Zeitstempel-Token über die **Wurzel** holen → in **jede** Kette ein `anchor`-Event schreiben →
Anker an mindestens ein **externes, append-only** Ziel mit **eigenen** Credentials ausliefern (separater
Object-Lock-Bucket, Syslog-Collector, E-Mail an den Steuerberater). Mehrere Zieltypen unterstützen,
mindestens eines erzwingen.

**Ein Token je Lauf, nicht je Mandant — ADR-022 (entschieden 2026-07-31).** Seit ADR-007 gibt es eine
Kette je Mandant, also N Köpfe. Der Baum darüber hält die TSA-Kosten unabhängig von der Mandantenzahl
(täglich × 50 Mandanten: 365 statt 18.250 Token im Jahr) — der tragende Grund ist aber ein anderer: der
**Inklusionsnachweis darf keine Fremddaten brauchen**. Vier Punkte, die dieses Kapitel betreffen:

- Das `anchor`-Event jeder Kette trägt **Wurzel, den Inklusionspfad dieser Kette und das Token**. Ein
  Mandantenexport ist damit **selbsttragend** und ohne Daten anderer Mandanten prüfbar. Eine sortierte
  Liste der Köpfe als gestempelte Eingabe wäre das nicht — sie zwingt zur Herausgabe aller Köpfe samt
  `seq`, und `seq` verrät das Nachrichtenvolumen. Deshalb Merkle, siehe ADR-022.
- **Der geankerte Kopf ist der Kopf _vor_ dem `anchor`-Event** — sonst verändert das Event den Kopf, den
  es bezeugen soll.
- **Blätter decken jede existierende Kette ab, nicht nur die veränderten.** Nur so bezeugt der Anker auch
  die **Menge** der Ketten, und „die Kette von Mandant X ist verschwunden" wird durch Vergleich zweier
  Anker erkennbar (ADR-007 Konsequenz 5).
- Blatt- und Knotenkodierung sind **domain-separiert** (`0x00` / `0x01`) und seit dem 2026-07-31 in
  ADR-006 festgelegt, weil `verify` den Baum byteidentisch nachbauen muss: Blätter nach den Rohbytes der
  `chain_scope_id` sortiert, Baumform nach **RFC 6962** — der ungerade Knoten wird **hochgezogen**, nicht
  dupliziert. Bei der Duplizier-Regel liefern `[A,B,C]` und `[A,B,C,C]` dieselbe Wurzel, womit sich eine
  zusätzliche Kette in einen bestehenden Anker hineinbehaupten ließe.

**Kein Standard-TSA-URL ausliefern.** Für deutsche Installationen soll es eine qualifizierte TSA
unter eIDAS sein — das ist eine Entscheidung des Betreibers, keine Voreinstellung. **ADR-023** hält fest,
welche TSA je Umgebung gilt: qualifiziert in der Produktion mit GoBD-Anspruch, `open-tsa.eu` (kostenlos,
RFC 3161, aber **nicht** qualifiziert) als dokumentierte Option ohne diesen Anspruch und als echte TSA in
der `nightly`-Testklasse, `ci` bleibt hermetisch. Der Client nimmt eine **Liste** von TSA-URLs, damit ein
zweiter, unabhängiger Zeitstempel möglich ist.

TSA nicht erreichbar ⇒ **laut eskalieren, Ingestion niemals stoppen** (RFC §15, ADR-008). Post
abzulehnen, um einen Zeitstempel zu schützen, invertiert die Prioritäten.

## 9. `verify`

Eigenes CLI, weil es mit **read-only** Credentials laufen muss, damit ein Prüfer es selbst ausführen
kann, ohne Schreibrechte zu erhalten.

- Kein CLI-Framework als neue Dependency nötig: `node:util` `parseArgs` genügt für
  `verify --from <seq> --to <seq>`.
- Eigene DB-Verbindung aus einer read-only Umgebungsvariable — **nicht** über
  `packages/backend/src/database/index.ts`, weil dieser Singleton `DATABASE_URL` liest.
- Prüft: Kette über den Bereich neu berechnen, `content_sha256` jedes Objekts gegen die gespeicherten
  Bytes, alle Anker gegen ihre Zeitstempel-Token.
- Meldet die **erste Divergenz** mit `seq` und Feld — nicht nur pass/fail.
- Ausgabe: JSON **und** ein menschenlesbarer Bericht. Der Bericht wird einem Prüfer übergeben; seine
  Formulierung ist Teil der Lieferung, nicht Beiwerk.
- `object_erased`-Einträge sind **kein** Kettenbruch, sondern werden als absichtliche Löschung
  ausgewiesen (RFC §10).
- Basis für die Objektprüfung: `IntegrityService.checkEmailIntegrity()`.

## 10. Monitoring

| Signal                                                | Datenquelle                                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Heartbeat (kein Report in N Minuten, Geschäftszeiten) | `journaling_sources.lastReceivedAt`, Ledger-Kopf                                        |
| Gap-Detection (kritisch)                              | `journal_ledger.seq` — lückenlos per Konstruktion, jede Lücke ist Manipulation oder Bug |
| Spool-Tiefe und -Alter, Phase-B-Backlog               | Spool-Verzeichnis, BullMQ                                                               |
| TSA-Erreichbarkeit, Storage-Latenz                    | Anchor-Job, Storage-Metriken                                                            |
| Ausweichpostfach-Reconciliation                       | `MicrosoftConnector` als Pull-Quelle, Dedupe gegen das Ledger                           |
| Message-Trace-Abgleich                                | CSV-Import, Tagesvergleich matched/missing/extra, signierter Bericht                    |

Das Exchange-Ausweichpostfach als Pull-Quelle zu registrieren schließt Ausfalllücken automatisch,
statt darauf zu hoffen, dass jemand es merkt. Im Deployment-Guide als **verpflichtend** dokumentieren.

## 11. Rollout

Feature-Flag, standardmäßig aus. Parallelbetrieb mit der bestehenden Pull-Ingestion während der
Übergangsphase; Deduplizierung auf `Message-ID` + Content-Hash, dabei die **journalisierte Kopie
bevorzugen** (reicherer Envelope). Bausteine dafür existieren: `doesEmailExist()`,
`msgid_header_source_idx`, `storage_hash_source_idx`.

Nach Stabilisierung wird Pull-Ingestion als Verfahren für **Backfill und Reconciliation**
umdokumentiert, nicht mehr als primärer Pfad für Compliance-Installationen.

## 12. Offene Architekturpunkte

Diese Punkte werden bewusst **nicht** in Epic 0 entschieden; sie sind in `05-entscheidungen.md` als
offene ADRs geführt:

| Punkt                                                                                                                                                                                                                  | Epic   | Referenz                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------- |
| ~~Lock-Key-Strategie und ob eine Kette pro Mandant~~ — **entschieden 2026-07-31: eine Kette je Mandant, `chain_scope_id` = `ingestion_sources.id`**                                                                    | E2     | ADR-007, RFC §15                      |
| ~~Genaue Bytes der kanonischen Kodierung, Genesis-String, `deployment_id`~~ — **entschieden 2026-07-31: 16 gehashte Felder, Genesis mit `chain_scope_id`, eigene `deployment_identity`-Tabelle, Merkle nach RFC 6962** | E2     | ADR-006                               |
| ~~Append-Only-Erzwingung: Rechteentzug oder Trigger~~ — **entschieden 2026-07-31: beides. Trigger in E2 (`JR-205`), Rechteentzug als Deployment-Anforderung in E11 (F37)**                                             | E2     | ADR-009                               |
| Ledger-Backend: Postgres `synchronous_commit` (a) vs. lokales WAL (b)                                                                                                                                                  | E2     | RFC §5.4 — (a) zuerst, steckbar bauen |
| `processEmail` erweitern oder journaling-spezifischen Pfad daneben                                                                                                                                                     | E6     | ADR-010                               |
| Migrationspfad für Bestandsinstallationen (neue Kette ab Genesis vs. Altdaten außerhalb der Kette)                                                                                                                     | E12    | RFC §15                               |
| Merkle-Baum statt linearer Kette                                                                                                                                                                                       | später | RFC §15 — für v1 nein                 |
