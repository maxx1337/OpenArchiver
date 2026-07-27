# Entscheidungslog (ADR)

Jede Architektur- oder Prozessentscheidung wird hier festgehalten, damit sie in Folge-Sessions nicht
neu verhandelt wird. Status: **entschieden** · **offen** · **verworfen**.

Eine als _entschieden_ markierte Entscheidung wird nur mit einer neuen ADR geändert, die die alte
explizit ersetzt — nie durch stille Abweichung im Code.

---

## ADR-001 — Umfang von Epic 0: nur Planung und Dokumentation

**Status:** entschieden (2026-07-27) · **Entscheider:** Auftraggeber

Epic 0 liefert ausschließlich Planung, Dokumentation und Agent-Infrastruktur. Kein Produktionscode.

**Begründung:** Der Auftrag lautete, alle nötigen Schritte und Tasks für das Team zu erstellen und so
zu dokumentieren, dass Folge-Sessions nichts neu erklärt bekommen müssen. Ein selbsttragendes
Projektgedächtnis ist die Voraussetzung für jede weitere Arbeit; verschränkt man es mit
Implementierung, entsteht beides halb.

**Konsequenz:** Nächster Schritt ist E1 (`JR-101`). Es existiert kein Receiver-Code.

## ADR-002 — Code-Ablage: `apps/smtp-ingress` + `packages/journaling`

**Status:** entschieden (2026-07-27) · **Entscheider:** Auftraggeber

Der Ingress wird ein eigener Prozess in `apps/smtp-ingress`; die Logik (Spool, Ledger, Parser,
kanonische Kodierung) liegt in einem neuen `packages/journaling`.

**Begründung:** RFC §2 fordert Rechtetrennung — der Ingress braucht Spool-Write und Ledger-Append,
aber **keinen** Lesezugriff auf Archivinhalte und **keine** Löschrechte. Ein Worker innerhalb von
`packages/backend` kann das nicht leisten: `src/database/index.ts` ist ein Modul-Singleton auf
`DATABASE_URL`, und mehrere `src/config/*`-Module werfen beim Import. Ein solcher Prozess erbt
zwangsläufig Credentials und Abstürze für Subsysteme, die er nicht braucht.

**Verworfene Alternativen:** (a) Worker in `packages/backend` — Rechtetrennung unerreichbar.
(b) `packages/enterprise` mit License-Gating nachbauen — nur sinnvoll, wenn Upstream-Enterprise-Code
gemergt werden soll; erzeugt sonst nur Overhead.

**Konsequenz:** `packages/journaling` darf **nicht** von `packages/backend` abhängen; Konfiguration
und DB-Verbindung werden injiziert. Getrennte Postgres-Rollen und getrennte S3-Credentials sind Teil
der Lieferung (E7, E12), nicht optional.

## ADR-003 — Dokumentationssprachen

**Status:** entschieden (2026-07-27) · **Entscheider:** Auftraggeber

Planungs- und Prozessdokumente (`docs/dev/journaling/**`) auf **Deutsch**. `CLAUDE.md`, Skills,
Code, Codekommentare, Commit-Messages und die öffentliche VitePress-Doku auf **Englisch**.

**Begründung:** Die Planungsunterlagen sind Arbeitsmaterial des Auftraggebers; das Repository ist
englischsprachig und soll upstream-kompatibel bleiben.

**Konsequenz:** `00-rfc.md` bleibt englisch und **byteidentisch** zum Original. Die Datei steht
deshalb in `.prettierignore`: Prettier würde Betonungszeichen (`*kursiv*` → `_kursiv_`) und im
YAML-Beispiel aus RFC §11 doppelte in einfache Anführungszeichen umschreiben. Bei einem normativen
Referenzdokument ist das nicht akzeptabel — es bleibt unangetastet.

## ADR-004 — Ablage: `docs/dev/journaling/`, nicht publiziert

**Status:** entschieden (2026-07-27) · **Entscheider:** Auftraggeber

Die Planungsdokumente liegen versioniert unter `docs/dev/journaling/`, werden aber **nicht** in
`docs/.vitepress/config.mts` registriert.

**Begründung:** Versionierung im Repository ist die Bedingung dafür, dass jede Session sie vorfindet.
Die VitePress-Sidebar ist explizit — was nicht registriert ist, wird nicht publiziert. Interne
Planung, Risikoliste und Gap-Analyse gehören nicht auf die öffentliche Produktseite.

**Konsequenz:** `docs/.vitepress/config.mts` wird nicht angefasst. Wer künftig Sidebar-Einträge
ergänzt, darf `dev/**` nicht mit aufnehmen.

## ADR-005 — Eigenes Ledger, `audit_logs` wird nicht erweitert

**Status:** entschieden (2026-07-27) · **Entscheider:** PO

`journal_ledger` ist eine neue, eigene Tabelle. Die bestehende `previousHash`/`currentHash`-Kette in
`packages/backend/src/database/schema/audit-logs.ts` wird nicht erweitert.

**Begründung:** Unterschiedliche Zwecke (Benutzeraktionen vs. Empfangsereignisse und
Objektlebenszyklus), unterschiedliche Schreiber, unterschiedliche Rechte, unterschiedliche
Aufbewahrungslogik. Eine Vermischung würde die Rechtetrennung aus ADR-002 aufheben — der Ingress
bräuchte Schreibzugriff auf das Audit-Log — und beide Nachweisketten unschärfer machen.

**Konsequenz:** `audit-logs.ts` dient als Stilvorbild für Schema und Migration, nicht als Ziel. Ein
Verifier für die Audit-Log-Kette existiert im OSS-Code ebenfalls nicht; ob er nachgezogen wird, ist
nicht Teil dieses Projekts.

## ADR-006 — Kanonische Kodierung, Genesis-String, `deployment_id`

**Status:** **offen** — zu entscheiden in E2 (`JR-203`)

Zu fixieren: die exakte Bytefolge der kanonischen Kodierung, der Genesis-String und die Herkunft der
`deployment_id`.

**Entwurfsrichtung** (siehe `02-architektur.md` §4):

- Führendes Versionsbyte.
- Je Feld: Typ-Tag (1 Byte), dann Länge (4 Byte big-endian), dann Rohbytes.
- `NULL` als eigenes Tag mit Länge 0.
- Zeitstempel als int64 big-endian, Mikrosekunden seit Epoche, UTC.
- Arrays in **Empfangsreihenfolge**, nicht sortiert.
- `event_payload` vor dem Hashing kanonisch serialisiert (sortierte Schlüssel).

```
chain_hash(0) = SHA256( "open-archiver:journal-ledger:v1:" || <deployment_id> )
```

**Warum es eine ADR braucht:** Eine Änderung der Kodierung invalidiert jede bestehende Kette. Das ist
ein Migrationsvorgang, keine Refaktorierung. Das Versionsbyte existiert genau deshalb.

## ADR-007 — Lock-Key-Strategie und Mehrmandantenfähigkeit

**Status:** **offen** — zu entscheiden in E2 · **Quelle:** RFC §15

Eine Kette pro Mandant oder eine globale Kette mit Mandanten-Tag?

**Richtung:** v1 setzt eine **einzelne** Kette um (RFC §5.2: „nicht dort anfangen" mit
Horizontalskalierung). Der Advisory-Lock-Key wird aber so gewählt, dass eine späterere Aufspaltung in
Shard-Ketten mit periodischem Cross-Shard-Anker möglich bleibt.

**Abwägung:** pro Mandant ist sauberer für Export und Löschung; global ist einfacher zu ankern.

## ADR-008 — Verhalten bei TSA-Ausfall

**Status:** **offen** — zu bestätigen in E8 (`JR-804`) · **Quelle:** RFC §15

Soll der Anchor-Job bei mehrtägiger TSA-Nichterreichbarkeit „fail closed" gehen und die Ingestion
anhalten?

**Richtung: nein.** Ingestion darf niemals stoppen — Post abzulehnen, um einen Zeitstempel zu
schützen, invertiert die Prioritäten und verursacht genau den Datenverlust, den das Feature
verhindern soll. Stattdessen laut und mit steigender Schwere eskalieren.

Die ADR wird in E8 auf _entschieden_ gesetzt, sobald das Eskalationsverhalten implementiert ist.

## ADR-009 — Erzwingung der Append-Only-Eigenschaft

**Status:** **offen** — zu entscheiden in E2 (`JR-205`)

Rechteentzug (`REVOKE UPDATE, DELETE`) oder Trigger, der auf `UPDATE`/`DELETE` eine Exception wirft?

**Abwägung:** Rechteentzug ist einfacher und billiger, hängt aber daran, dass die Anwendung nicht mit
einer privilegierten Rolle verbindet. Ein Trigger wirkt rollenunabhängig, ist aber selbst
veränderbar, wer `ALTER TABLE` darf. Beides ist kombinierbar.

Zu beachten: die Migrationsrolle braucht genug Rechte, um die Einschränkung überhaupt anzulegen.

## ADR-010 — `processEmail` erweitern oder eigener Journaling-Pfad

**Status:** **offen** — zu entscheiden in E6 (`JR-602`)

`IngestionService.processEmail()` enthält die vollständige Hash-, Dedupe- und
Storage-Pfad-Logik (Drei-Gate-Dedupe plus Byte-Hash-Gate) und ist bereits umfangreich. Erweitern
oder einen journaling-spezifischen Pfad daneben stellen?

**Abwägung:** Wiederverwendung vermeidet divergierende Dedupe-Semantik — der teuerste denkbare
Fehler in diesem Projekt. Ein separater Pfad hält den Journaling-Code lesbar, riskiert aber genau
diese Divergenz. Entscheidung erst, wenn der Parser (E5) zeigt, wie stark die Metadatenform abweicht.

## ADR-011 — Ledger-Backend: Postgres zuerst, steckbar

**Status:** entschieden (2026-07-27) · **Quelle:** RFC §5.4

Variante (a): Ledger in PostgreSQL mit `synchronous_commit = on`. Variante (b): lokales append-only
WAL, fsync'd, asynchron nach Postgres repliziert — **nicht** in v1, aber ohne Signaturänderung
nachrüstbar.

**Begründung:** RFC empfiehlt (a) als Default. (a) koppelt die Ack-Latenz an die DB-Verfügbarkeit;
das ist akzeptabel und liefert ein klares `451`, wenn die DB weg ist. (b) überlebt DB-Ausfälle, hat
aber mehr bewegliche Teile.

**Konsequenz:** `JR-207` baut die Schnittstelle steckbar. Solange (a) gilt: DB nicht erreichbar ⇒
`451`, nicht `250`.

## ADR-012 — Migrationspfad für Bestandsinstallationen

**Status:** **offen** — zu entscheiden in E12 · **Quelle:** RFC §15

Neue Kette ab Genesis mit einem Ereignis, das den Aggregatzustand des vorhandenen Archivs festhält —
oder Altdaten außerhalb der Kette lassen und als solche markieren?

**Richtung:** Letzteres. Der RFC nennt es „ehrlicher": Daten, die vor der Kette entstanden sind,
tragen deren Beweiskraft nicht, und das zu behaupten wäre falsch. Endgültig zu entscheiden, wenn der
Rollout-Pfad steht.

## ADR-013 — Merkle-Baum statt linearer Kette

**Status:** verworfen für v1 · **Quelle:** RFC §15

Ein Merkle-Baum erlaubt schnellere partielle Verifikation bei großen Installationen. Für v1 nicht
umgesetzt — die lineare Kette ist einfacher korrekt zu bekommen, und Korrektheit ist hier wichtiger
als Verifikationsgeschwindigkeit. Wiederaufgreifen, wenn `verify`-Laufzeiten real zum Problem werden.

---

## Nicht verhandelbar (keine ADR nötig)

Diese Punkte stehen im RFC als harte Anforderungen und sind im Skill
`.claude/skills/journal-ledger/SKILL.md` operativ festgehalten. Sie sind keine Entscheidungen,
sondern Vorgaben:

- `250 OK` erst nach fsync von Spool **und** Ledger (§3).
- Lokale Fehler ⇒ `4xx`, nie `5xx` (§3).
- Empfangene Bytes werden nie transformiert (§4.4).
- Parse-Fehler werden archiviert, nicht abgelehnt (§5.3).
- Kein Catch-all-Empfänger, kein Relaying (§4.3, §4.4).
- Empfangsereignis ≠ Nachricht: jede Receipt bekommt einen Ledger-Eintrag (§4.5).
- Ledger-Einträge werden nie gelöscht, auch nicht bei DSGVO-Löschung (§10).
- Hashing vor Verschlüsselung (§7).
- Keine Compliance-Behauptung über die Formulierung in §13 hinaus.
