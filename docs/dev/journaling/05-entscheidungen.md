# Entscheidungslog (ADR)

Jede Architektur- oder Prozessentscheidung wird hier festgehalten, damit sie in Folge-Sessions nicht
neu verhandelt wird. Status: **entschieden** · **offen** · **verworfen**.

Eine als _entschieden_ markierte Entscheidung wird nur mit einer neuen ADR geändert, die die alte
explizit ersetzt — nie durch stille Abweichung im Code.

> **Umnummerierung am 2026-08-04, beim Rückmerge von E4 — wer eine ADR-Nummer in einem älteren
> Commit, Kommentar oder Protokoll liest, muss das hier kennen.** E4 (`smtp-ingress`) und E5
> (Journal-Report-Parser) sind **parallel auf zwei Zweigen** entstanden und haben unabhängig
> voneinander dieselben Nummern vergeben. E4 hatte zusätzlich die bestehende ADR-026 (Task-IDs) auf
> ADR-029 verschoben, während der Integrationszweig sie als ADR-026 weiterführte. Aufgelöst nach dem
> Grundsatz **der eingehende Zweig gibt nach**, entschieden vom Auftraggeber:
>
> | vorher auf dem E4-Zweig                 | jetzt                                     |
> | --------------------------------------- | ----------------------------------------- |
> | ADR-026 — SMTP-Eigenimplementierung     | **ADR-029**                               |
> | ADR-027 — eine Kette pro Transaktion    | **ADR-030**                               |
> | ADR-028 — Erholung der Ledger-Anbindung | **ADR-031**                               |
> | ADR-029 — Task-IDs `JR-<Epic>-<NN>`     | **ADR-026** (zurück auf die Trunk-Nummer) |
>
> Unverändert bleiben die auf dem Integrationszweig vergebenen **ADR-027** (`mailparser`) und
> **ADR-028** (Betriebsart ist Konfiguration). Die Umstellung erfasste 98 Referenzen in 15 Dateien und
> ist mechanisch als Permutation ausgeführt worden, nicht von Hand.
>
> **Die Lehre steht in ADR-032:** zwei parallele Zweige, die beide aus demselben fortlaufenden
> Nummernkreis schöpfen, kollidieren zwangsläufig — das galt hier gleichzeitig für ADR-Nummern,
> Befundnummern (F42/F43) und Dateinamen (`12-`).

---

## ADR-001 — Umfang von Epic 0: nur Planung und Dokumentation

**Status:** entschieden (2026-07-27) · **Entscheider:** Auftraggeber

Epic 0 liefert ausschließlich Planung, Dokumentation und Agent-Infrastruktur. Kein Produktionscode.

**Begründung:** Der Auftrag lautete, alle nötigen Schritte und Tasks für das Team zu erstellen und so
zu dokumentieren, dass Folge-Sessions nichts neu erklärt bekommen müssen. Ein selbsttragendes
Projektgedächtnis ist die Voraussetzung für jede weitere Arbeit; verschränkt man es mit
Implementierung, entsteht beides halb.

**Konsequenz:** Nächster Schritt ist E1 (`JR-1-01`). Es existiert kein Receiver-Code.

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

**Status:** entschieden (2026-07-27), **Begründung korrigiert am 2026-07-27** ·
**Entscheider:** Auftraggeber

Die Planungsdokumente liegen versioniert unter `docs/dev/journaling/` und werden **nicht**
veröffentlicht. Der Ausschluss erfolgt über `srcExclude: ['dev/**']` in
`docs/.vitepress/config.mts`.

**Begründung:** Versionierung im Repository ist die Bedingung dafür, dass jede Session die Unterlagen
vorfindet. Interne Planung, Risikoliste und Gap-Analyse gehören aber nicht auf die öffentliche
Produktseite — die Risikoliste benennt Schwächen des Produkts ungeschminkt, und die Gap-Analyse
dokumentiert unter anderem, dass das Repository keinerlei Tests hat.

### Korrektur der ursprünglichen Begründung

Die erste Fassung dieser ADR begründete die Nicht-Veröffentlichung damit, dass die
VitePress-Sidebar explizit sei und „was nicht registriert ist, nicht publiziert wird". **Das war
falsch** und hätte zu einem Datenabfluss geführt:

- VitePress baut ohne `srcExclude` **jede** `.md`-Datei unter `docs/` zu einer Seite. Ein Fehlen in
  der `sidebar` bedeutet nur „nicht verlinkt", nicht „nicht publiziert" — die Seite ist per URL
  erreichbar.
- `themeConfig.search.provider` ist `'local'`. Die Seiten landen damit zusätzlich im **Suchindex**
  der Website und wären dort auffindbar gewesen, nicht nur durch Raten der URL.
- `.github/workflows/deploy-docs.yml` deployt bei jedem Push auf `main`, der `docs/**` berührt.

**Empirischer Beleg** (Build vom 2026-07-27): `docs/SUMMARY.md` ist in `config.mts` nirgends
registriert — `grep -c SUMMARY docs/.vitepress/config.mts` ergibt `0`. Trotzdem existiert nach
`pnpm docs:build` die Datei `docs/.vitepress/dist/SUMMARY.html` mit 30 KB, und der String erscheint
in `dist/assets/chunks/@localSearchIndexroot.*.js`. Genau das wäre mit den Planungsdokumenten
passiert.

Die Fehlannahme ist nie wirksam geworden, weil die Dokumente ausschließlich auf dem Feature-Branch
liegen und `main` bis zur Abnahme von E12 nicht angefasst wird (ADR-014). Sie steht hier bewusst
weiterhin dokumentiert: ein Entscheidungslog, das eigene Irrtümer stillschweigend überschreibt,
verliert genau den Wert, für den es geführt wird.

**Konsequenz:** Der `srcExclude`-Eintrag ist eine Schutzmaßnahme und darf nicht entfernt werden; er
trägt im Code einen entsprechenden Kommentar, und `CLAUDE.md` §7 weist darauf hin. Wer künftig
Sidebar-Einträge ergänzt, darf `dev/**` nicht mit aufnehmen.

**Nachweis erbracht** (2026-07-27): nach `pnpm docs:build` existiert `docs/.vitepress/dist/dev/`
nicht, keine `journaling`-Planungsdatei liegt im Build, und kein charakteristischer Satz aus
`08-risiken.md` findet sich im Suchindex. Gegenkontrolle: die reguläre Doku ist vollständig gebaut
(`dist/user-guides/installation.html`, `dist/enterprise/journaling/guide.html`) — der Build ist also
nicht einfach leer. Diese Prüfung ist bei jeder Änderung an der Doku-Config zu wiederholen.

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

**Status:** **entschieden** (2026-07-31) · **Entscheider:** PO · **Quelle:** RFC §5.2 ·
**Erfüllt Vorgaben aus:** ADR-007 Konsequenz 3, ADR-022 Festlegung 3

Diese ADR fixiert fünf Dinge: den Umfang und die Bytes der Feldkodierung, den Genesis-String, die
Herkunft der `deployment_id`, das Verhalten beim Klonen einer Installation und die Merkle-Kodierung des
Ankers. Sie ist die letzte Entscheidung vor der ersten Zeile Kettencode.

**Jede Zahl in dieser ADR ist gemessen, nicht hergeleitet.** Die Festlegungen wurden als
Referenzimplementierung ausgeführt; die Testvektoren in §6 und die Längenrechnungen in §5.3 sind deren
Ausgabe. Wo unten „belegt" steht, ist genau das gemeint.

### 1. Umfang: gehasht wird jede wertetragende Spalte, nicht die RFC-Feldliste

**Die Feldliste in RFC §5.2 ist unvollständig, und das ist der wichtigste Befund dieser ADR.** Der RFC
legt die Tabelle mit 14 Spalten an, hasht aber nur acht davon:

```
chain_hash(n) = SHA256( canonical_encode(seq, received_at, content_sha256, event_type,
                        event_payload, envelope_from, envelope_rcpt, size_bytes) || prev )
```

Nicht im Hash sind damit `remote_ip`, `ehlo_name`, `tls_version`, `tls_cipher` und `duplicate_of` —
und, da der RFC ADR-007 vorausgeht, auch `chain_scope_id`, `journaling_source_id` und `spool_txid`.
Jede dieser Spalten ließe sich nachträglich ändern, **ohne die Kette zu brechen**. Konkret: wer
Datenbankzugriff hat, könnte `tls_version` von `NULL` auf `TLSv1.3` setzen und damit eine
unverschlüsselt empfangene Nachricht als verschlüsselt ausweisen, oder `remote_ip` auf einen anderen
Absender umschreiben — bei intakter Verifikation. Ein Ledger, dessen Verifikation solche Felder nicht
abdeckt, bezeugt sie nicht; sie im Beleg zu führen und nicht zu hashen, ist schlimmer als sie
weglassen, weil es Beweiskraft behauptet, die nicht existiert.

**Festlegung: `canonical_encode` deckt alle 16 wertetragenden Spalten von `journal_ledger` ab.**
Ausgenommen sind genau zwei, und beide aus einem strukturellen Grund: `chain_hash` ist das Ergebnis
selbst, und `prev_chain_hash` wird gemäß RFC-Formel **angehängt**, nicht als Feld kodiert. Eine
Spalte, die später hinzukommt und einen Wert trägt, erzwingt ein neues Versionsbyte — nicht eine
Ausnahme.

> Der Skill `journal-ledger` gibt die RFC-Formel wörtlich wieder. Er ist für E2 verbindlich, und diese
> ADR weicht von ihm **nicht in der Form** ab (`SHA256(record ‖ prev)` bleibt), sondern **erweitert die
> Feldliste**. Das ist die Präzisierung, für die `JR-2-03` existiert.

### 2. Die Bytes

**Rahmen.** Ein Record ist:

```
record  := 0x01                    -- Versionsbyte des Kodierungsformats
         ‖ uint32be(field_count)   -- 16 für v1
         ‖ field_1 ‖ … ‖ field_n
field   := tag(1 Byte) ‖ uint32be(len) ‖ value_bytes
```

Das `field_count`-Präfix ist Absicht: es macht eine stille Feldänderung zu einem Hashunterschied auch
dann, wenn ein Feld am Ende bloß entfällt. `len` ist immer die Länge von `value_bytes`, auch bei
zusammengesetzten Typen — jedes Feld ist damit überspringbar, ohne seinen Inhalt zu verstehen.

**Typ-Tags.**

| Tag    | Typ            | `len` | Wert                                                  |
| ------ | -------------- | ----- | ----------------------------------------------------- |
| `0x00` | `NULL`         | 0     | keine Bytes                                           |
| `0x01` | `UINT64`       | 8     | big-endian, unsigned                                  |
| `0x02` | `TIMESTAMP_US` | 8     | int64 big-endian, Mikrosekunden seit Unix-Epoche, UTC |
| `0x03` | `STRING`       | var   | UTF-8, **ohne** Unicode-Normalisierung                |
| `0x04` | `BYTES`        | var   | Rohbytes                                              |
| `0x05` | `UUID`         | 16    | Rohbytes (RFC 4122 Netzwerkreihenfolge)               |
| `0x06` | `ARRAY_STR`    | var   | `uint32be(count)` ‖ (`uint32be(len)` ‖ UTF-8)\*       |
| `0x07` | `JSON`         | var   | kanonisches JSON nach §3.3, UTF-8                     |

`NULL` ist ein **eigenes Tag**, nicht ein leerer Wert: `NULL` und der leere String müssen verschieden
hashen, sonst ist „kein EHLO gesendet" von „EHLO mit leerem Namen" nicht unterscheidbar.

**Keine Unicode-Normalisierung** ist eine Festlegung gegen die Intuition. NFC würde die Bytes
verändern, die empfangen wurden; der Ledger ist ein Beleg über empfangene Bytes. Verboten sind nur
ungepaarte Surrogate — die lehnt PostgreSQL ohnehin ab.

**Feldreihenfolge v1** — positional, die Reihenfolge ist Teil des Formats:

| #   | Feld                   | Tag                    | Bei `receipt`                           |
| --- | ---------------------- | ---------------------- | --------------------------------------- |
| 1   | `chain_scope_id`       | `UUID`                 | Pflicht (ADR-007)                       |
| 2   | `seq`                  | `UINT64`               | Pflicht                                 |
| 3   | `received_at`          | `TIMESTAMP_US`         | Pflicht                                 |
| 4   | `event_type`           | `STRING`               | Pflicht                                 |
| 5   | `remote_ip`            | `STRING` \| `NULL`     | Pflicht, normalisiert nach §3.2         |
| 6   | `ehlo_name`            | `STRING` \| `NULL`     | wie empfangen                           |
| 7   | `tls_version`          | `STRING` \| `NULL`     | `NULL` = Klartextverbindung             |
| 8   | `tls_cipher`           | `STRING` \| `NULL`     |                                         |
| 9   | `envelope_from`        | `STRING` \| `NULL`     |                                         |
| 10  | `envelope_rcpt`        | `ARRAY_STR` \| `NULL`  | **Empfangsreihenfolge**, nicht sortiert |
| 11  | `size_bytes`           | `UINT64` \| `NULL`     |                                         |
| 12  | `content_sha256`       | `BYTES` (32) \| `NULL` | über Plaintext-Wire-Bytes               |
| 13  | `duplicate_of`         | `UINT64` \| `NULL`     | `seq` des Originals                     |
| 14  | `journaling_source_id` | `UUID` \| `NULL`       | „wer hat gesendet" (ADR-007)            |
| 15  | `spool_txid`           | `STRING` \| `NULL`     | Crash-Recovery hängt daran              |
| 16  | `event_payload`        | `JSON` \| `NULL`       | kanonisch nach §3.3                     |

Die Empfangsreihenfolge von `envelope_rcpt` ist **nicht** sortiert, weil die Reihenfolge der
`RCPT TO`-Kommandos Teil des Belegs ist. Sortieren würde eine Information vernichten, die eine
Verteilerlisten-Expansion erst nachvollziehbar macht.

Bei Ereignissen ohne SMTP-Transaktion (`anchor`, `retention_expiry`, `object_erased`,
`legal_hold_set`) sind die Felder 5–13 und 15 `NULL`. **Das ist eine Vorgabe an `JR-2-04`:**
`size_bytes` und `content_sha256` müssen `NULL`-fähig sein, anders als im `CREATE TABLE` des RFC.
`0` statt `NULL` zu schreiben wäre eine Behauptung über eine Nachricht, die es nicht gibt.

### 3. Drei Fallstricke, die hier mitentschieden sind

Alle drei sind Stellen, an denen dieselbe Zeile auf zwei Rechnern verschieden hasht. Jede davon macht
`verify` unbrauchbar, und keine fällt vor der ersten Verifikation auf.

**3.1 Zeitstempel: Format in Mikrosekunden, geschriebene Werte in Millisekunden.** `timestamptz` hat
in PostgreSQL Mikrosekundenauflösung, JavaScripts `Date` hat Millisekunden. Ein Wert, der über ein
`Date` gelaufen ist, verliert die letzten drei Dezimalstellen — der Writer hasht also andere Bytes als
`verify` nach dem Roundtrip liest, und der Bruch tritt genau in einem von tausend Fällen auf.

Festlegung: das Feld bleibt `TIMESTAMP_US` (das Format soll nicht an der Auflösung einer
Laufzeitumgebung hängen), aber die Anwendung schreibt **ausschließlich Werte, deren
Mikrosekundenanteil durch 1000 teilbar ist**. `JR-2-04` sichert das mit einem `CHECK`-Constraint ab,
damit die Invariante in der Datenbank steht und nicht in einem Kommentar. Millisekunden sind für einen
SMTP-Empfangszeitpunkt reichlich; ein nicht nachbaubarer Hash ist fatal. **Verworfen:** die Spalte als
`bigint`-Mikrosekunden zu führen — das verliert Zeitzonen- und Vergleichssemantik in SQL und macht
jede Auswertung fehleranfällig, um eine Auflösung zu retten, die niemand braucht.

**3.2 IP-Normalisierung: IPv4 bleibt IPv4.** Node liefert auf einem Dual-Stack-Socket
`::ffff:192.0.2.25` für eine IPv4-Verbindung. Dieselbe Verbindung über einen IPv4-Listener liefert
`192.0.2.25`. Beide bezeichnen denselben Absender und hashen verschieden.

Festlegung: `remote_ip` wird **vor** dem Hashen und vor dem `INSERT` normalisiert — IPv4-mapped-IPv6
auf die IPv4-Schreibweise, IPv6 komprimiert nach RFC 5952, Kleinbuchstaben. Kodiert wird die
kanonische **Textform**, nicht die Rohbytes: der Wert steht in Betriebsmeldungen und in Prüfberichten,
und eine Form, die ein Mensch mit dem Log vergleichen kann, ist hier mehr wert als zwei gesparte Bytes.

**3.3 `event_payload`: kanonisches JSON, und keine Fließkommazahlen.** Erlaubt sind Objekt, Array,
String, Boolean, `null` und **ganzzahlige** Zahlen im Bereich ±(2^53−1). Serialisierung: Schlüssel
sortiert nach UTF-16-Code-Units, kein Whitespace, minimales JSON-Escaping — das ist RFC 8785 (JCS),
auf diese Teilmenge eingeschränkt.

Die Einschränkung ist der eigentliche Inhalt der Festlegung: die Zahlenserialisierung ist der einzige
schwierige Teil von RFC 8785, und mit dem Verbot von Nicht-Ganzzahlen fällt er weg — kanonisches JSON
reduziert sich dann auf „Schlüssel sortieren, dann `JSON.stringify`", was ohne fremde Abhängigkeit
korrekt zu bekommen ist. Größere Ganzzahlen als 2^53−1 gehören als String in das Payload. Ein
`undefined`-Wert wird weggelassen, nicht zu `null` — sonst hängt der Hash daran, ob ein Feld gesetzt
oder abwesend war, und das ist in JavaScript keine stabile Unterscheidung.

### 4. Genesis, `deployment_id` und der geklonte Server

**4.1 Genesis-String.**

```
chain_hash(0) = SHA256( "open-archiver:journal-ledger:v1:" ‖ deployment_id ‖ ":" ‖ chain_scope_id )
```

Beide Kennungen als **kanonische UUID-Textform in Kleinbuchstaben** (36 Zeichen, RFC 4122 §3), ASCII,
mit `:` als Trenner. Das ist eine **bewusste Ausnahme** von §2, wo UUIDs 16 Rohbytes sind, und sie ist
zu erhalten, nicht zu „korrigieren": der Genesis-Hash ist der einzige Wert der ganzen Kette, den ein
Prüfer ohne unseren Code nachrechnen können soll —

```
printf 'open-archiver:journal-ledger:v1:<dep>:<scope>' | sha256sum
```

— und diese Nachrechenbarkeit ist mehr wert als die formale Einheitlichkeit. Der Trenner ist nötig,
weil ohne ihn zwei verschiedene Kennungspaare denselben String bilden könnten, sobald eine Kennung je
ihre feste Länge verliert.

**4.2 Herkunft der `deployment_id`: eigene Tabelle, nicht `system_settings`.** Die naheliegende
Variante aus der Entwurfsrichtung ist **verworfen**, und zwar am Bestandscode geprüft:
`system_settings` ist eine einzelne Zeile mit einer `jsonb`-Spalte `config`, deren Typ
`SystemSettings` in `packages/types/src/system.types.ts` `language`, `theme`, `supportEmail` und die
Security-Policy enthält — es ist die über die Einstellungs-API **schreibbare** Konfiguration. Eine
Kennung, die im Genesis-Hash jeder Kette steckt, darf nicht über denselben Endpunkt änderbar sein, der
das Anwendungsthema umstellt. Ein `PUT` auf die Einstellungen würde sonst jede Kette der Installation
unverifizierbar machen.

Festlegung: eine eigene Tabelle `deployment_identity` mit genau einer Zeile, `deployment_id uuid`,
erzeugt **in der Migration selbst** per `gen_random_uuid()`. Gründe: kein Anwendungscode, kein Race
zwischen zwei startenden Prozessen, und es funktioniert auch im Container-Entrypoint, der
`pnpm db:migrate` vor dem ersten Start ausführt. Die Tabelle wird durch dieselbe
Append-Only-Erzwingung geschützt wie `journal_ledger` (**Vorgabe an ADR-009/`JR-2-05`**: der Umfang der
Erzwingung ist `journal_ledger` **und** `deployment_identity`) und trägt einen `CHECK`, der eine
zweite Zeile ausschließt.

**4.3 Der geklonte Server: nicht verhinderbar, aber erkennbar — und das ehrlich sagen.** Zwei
Installationen mit derselben `deployment_id`, die beide weiterlaufen, erzeugen divergierende Ketten
mit identischem Genesis. Das lässt sich **nicht** technisch verhindern: ein Restore aus einem Backup
und ein Klon zum Nebenbetrieb sind byteidentisch, und der Restore ist ein legitimer, notwendiger
Vorgang. Wer hier eine Sperre einbaut, sperrt zuerst das Disaster Recovery.

Festlegung in drei Teilen:

1. **Ein Restore ist dieselbe Installation.** Die `deployment_id` bleibt unverändert und wird beim
   Restore **nicht** neu erzeugt — sie ist die Identität des Archivs, nicht der Maschine. Die Kette
   setzt sich fort. Eine neue Installation bekommt automatisch eine neue Kennung, weil die Migration
   auf einer leeren Datenbank läuft.
2. **Ein parallel weiterlaufender Klon ist ein Split-Brain und wird als Befund gemeldet, nicht
   verhindert.** Erkannt wird er an zwei Stellen, die beide ohnehin existieren: `UNIQUE
(chain_scope_id, seq)` innerhalb einer Datenbank, und das externe append-only Ankerziel (ADR-022
   Festlegung 7) — zwei Anker mit derselben `deployment_id` für denselben Zeitraum, aber
   verschiedenen Wurzeln, sind ein Split-Brain und nichts anderes. **Vorgaben:** das externe Ziel
   erhält die `deployment_id` mit (`JR-8-03`), und `verify` meldet den Fall als eigenen Befund neben
   „Kette fehlt" (`JR-2-09`, `JR-8-05`).
3. **Der Anchor-Job weigert sich, wenn das externe Ziel schon einen späteren Anker derselben
   `deployment_id` trägt** (**Vorgabe an `JR-8-02`**). Damit fällt ein Klon beim **ersten** Ankerlauf
   auf und nicht Monate später bei einer Prüfung. Das ist die billigste wirksame Härtung, die ohne
   Sperre auskommt.

Dazu gehört eine Betreiberauflage, die keine Technik ersetzen kann: **ein aus Produktionsdaten
erzeugtes Test- oder Staging-System läuft mit abgeschaltetem SMTP-Ingress und abgeschaltetem
Anchor-Job.** Das gehört in den Deployment-Guide (E11), und zwar als Anforderung, nicht als Hinweis.

### 5. Merkle-Kodierung des Ankers

Vorgabe aus ADR-022 Festlegung 3. `verify` muss den Baum byteidentisch nachbauen, deshalb steht die
Kodierung hier und nicht in E8.

**5.1 Blatt und Knoten.**

```
leaf(chain)  = SHA256( 0x00 ‖ record3(chain_scope_id, head_seq, head_chain_hash) )
node(l, r)   = SHA256( 0x01 ‖ l ‖ r )
```

`record3` ist derselbe Rahmen aus §2 mit `field_count = 3` und den Tags `UUID`, `UINT64`, `BYTES`.
Eine Kodierfunktion, zwei Schemata — die Blattkodierung erbt damit jede Eigenschaft aus §2 und §3
automatisch.

**5.2 Baumform: RFC 6962, der ungerade Knoten wird hochgezogen.** Blätter sortiert nach den **16
Rohbytes** der `chain_scope_id`; die Wurzel ist `MTH` nach RFC 6962 §2.1, also Aufteilung an der
größten Zweierpotenz **kleiner** als die Blattzahl. Ein einzelnes Blatt ist die Wurzel; die leere
Blattmenge tritt nicht auf, weil ohne Kette nicht geankert wird.

**Duplizieren ist verworfen, und der Grund ist gemessen.** Bei der Bitcoin-Regel („letzten Knoten
verdoppeln") liefern die Blattmengen `[A,B,C]` und `[A,B,C,C]` **dieselbe** Wurzel — in der
Referenzimplementierung nachgestellt und bestätigt. Genau das würde ADR-022 Festlegung 1 aufheben: der
Anker soll die **Menge** der Ketten bezeugen, und bei der Duplizier-Regel ließe sich eine zusätzliche
Kette in einen bestehenden Anker hineinbehaupten. Unter RFC 6962 sind dieselben zwei Mengen
verschieden — ebenfalls gemessen (§6, D4/D5).

**5.3 Domain-Trennung ist vollständig, auch gegenüber dem Ledger-Hash.** Drei Hash-Preimages treten im
System auf, und keine zwei können verwechselt werden:

| Preimage      | Aufbau                 | Länge                       |
| ------------- | ---------------------- | --------------------------- |
| Merkle-Blatt  | `0x00 ‖ record3`       | 77 Byte, beginnt mit `0x00` |
| Merkle-Knoten | `0x01 ‖ 32 ‖ 32`       | genau 65 Byte               |
| Ledger-Record | `record16 ‖ prev_hash` | ≥ 117 Byte                  |

Das Blatt ist durch sein führendes `0x00` von beiden anderen getrennt. Knoten und Ledger-Record
beginnen beide mit `0x01` — der Knoten wegen ADR-022, der Record wegen seines Versionsbytes —, sind
aber durch die Länge disjunkt: ein Record mit 16 Feldern ist selbst bei durchgehend `NULL`-Feldern
1 + 4 + 16·5 = 85 Byte, plus 32 Byte `prev_chain_hash` also **mindestens 117**, gegen genau 65 beim
Knoten. Die Kollisionsfreiheit hängt damit an einer Längenrechnung und nicht an einem Präfix; das ist
der Preis dafür, die RFC-Formel `SHA256(record ‖ prev)` unverändert zu lassen, und er ist hier notiert,
damit niemand die Präfixe später „vereinheitlicht" und dabei jede bestehende Kette invalidiert.

### 6. Testvektoren

Erzeugt mit der Referenzimplementierung am 2026-07-31. **`JR-2-02` muss diese Werte reproduzieren** —
sie sind der Golden-File-Test, den das Akzeptanzkriterium dort verlangt.

Eingaben: `deployment_id = 00000000-0000-4000-8000-000000000001`,
`scope_A = 11111111-1111-4111-8111-111111111111`,
`scope_B = 22222222-2222-4222-8222-222222222222`,
`scope_C = 33333333-3333-4333-8333-333333333333`.

| Vektor                                  | Wert                                                               |
| --------------------------------------- | ------------------------------------------------------------------ |
| `G1` genesis(dep, scope_A)              | `02f0c72949b5ac8058d7f6ab2ee6241c0f730eaf8cdd53799254fc0cda3f8a14` |
| `G2` genesis(dep, scope_B)              | `52d2fdd7b5380cf2fcce9736f9be57ca99a263d67a9005f62a5ea221c22a1b49` |
| `V3` leaf(scope_A, 1, SHA256("head-A")) | `0a33f4d7fdc3c771eb4df31c88ab194bafd6093e5be00514a0408425483db323` |
| `V3` root über 2 Blätter `[A,B]`        | `72bcc7f6caf87be729b79c879677cd36463a19debe9b0eb6c8b344c4f5f5c422` |
| `V3` root über 3 Blätter `[A,B,C]`      | `97edaf856349af16d247b665078c53a99b7e0f0fd2906bcdff822c0125e2b9bc` |

Blätter `B` und `C` verwenden `head_seq = 7` bzw. `0` und `SHA256("head-B")` / `SHA256("head-C")` als
Kopf-Hash. Die Wurzel über ein Blatt ist das Blatt selbst.

Der Receipt-Vektor `V1` (`seq = 1`, `received_at = 2026-07-31T10:15:30.123Z` ⇒ `1785492930123000` µs,
`remote_ip = 192.0.2.25`, `ehlo_name = mail.example.com`, `tls_version = TLSv1.3`,
`tls_cipher = TLS_AES_256_GCM_SHA384`, `envelope_from = sender@example.com`,
`envelope_rcpt = [a@example.com, b@example.com]`, `size_bytes = 4096`,
`content_sha256 = SHA256("journal-report-bytes")`, `duplicate_of = NULL`,
`journaling_source_id = aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
`spool_txid = 01JZZ0000000000000000000AA`, `event_payload = {"parse_failed":false,"phase":"A"}`):

| Vektor                          | Wert                                                               |
| ------------------------------- | ------------------------------------------------------------------ |
| Recordlänge                     | 351 Byte                                                           |
| `SHA256(record)`                | `cf5a92f4208a06c239d8b330a820ad5030570b1d784b1695b4cd7de105522522` |
| `chain_hash(1)` mit `prev = G1` | `6ae132b63a3b3077ff80d988b76b190a7e954f2cdfcb1216d9b7dc6973889d92` |

**Eigenschaftsnachweise**, alle ausgeführt: `rcpt`-Reihenfolge getauscht ⇒ anderer Hash;
`event_payload`-Schlüssel umgestellt ⇒ **gleicher** Hash; `chain_scope_id` getauscht ⇒ anderer Hash
(das ist ADR-007 Konsequenz 3 als Test); `remote_ip` getauscht ⇒ anderer Hash (das ist §1 als Test).
`D4`: Duplizier-Regel ⇒ `root[A,B,C] == root[A,B,C,C]`, **true**. `D5`: RFC 6962 ⇒ dieselbe
Gleichheit, **false**.

### 7. Was diese ADR anderen Tasks vorgibt

| Task      | Vorgabe                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------- |
| `JR-2-02` | 16 Felder in der Reihenfolge aus §2; Vektoren aus §6 als Golden-File; JCS-Teilmenge aus §3.3    |
| `JR-2-04` | `size_bytes`/`content_sha256` nullable; `CHECK` auf ms-Vielfache; Tabelle `deployment_identity` |
| `JR-2-05` | Append-Only-Erzwingung umfasst `deployment_identity` mit                                        |
| `JR-8-02` | Ankern verweigern, wenn das Ziel einen späteren Anker derselben `deployment_id` trägt           |
| `JR-8-03` | `deployment_id` geht an das externe Ziel mit                                                    |
| `JR-2-09` | Split-Brain (gleicher Genesis, divergierende Ketten) ist ein eigener Befund                     |

### 8. Warum es eine ADR braucht

Eine Änderung der Kodierung invalidiert jede bestehende Kette. Das ist ein Migrationsvorgang, keine
Refaktorierung. Das Versionsbyte existiert genau deshalb — und es ist zu erhöhen, sobald sich an §2
oder §3 etwas ändert, auch wenn die Änderung „nur" ein zusätzliches Feld ist.

## ADR-007 — Lock-Key-Strategie und Mehrmandantenfähigkeit

**Status:** **entschieden** (2026-07-31) · **Entscheider:** Auftraggeber · **Quelle:** RFC §15

**Eine Kette je Mandant.** Nicht eine globale Kette mit Mandanten-Tag.

**Begründung:** RFC §15 stellt die Abwägung selbst so: _„Per-tenant is cleaner for export and erasure;
global is simpler to anchor."_ Export und Löschung sind die Operationen, die dieses Produkt dauernd
ausführen muss — ein Auditor bekommt die Kette **eines** Mandanten, und eine DSGVO-Löschung wirkt
innerhalb **eines** Mandanten. Bei einer globalen Kette wäre beides nur mit Filterung über fremde
Metadaten möglich, und ein Kettenauszug für einen Auditor würde zwangsläufig Absender, Empfänger und
Zeitpunkte anderer Mandanten offenlegen. Das Ankern ist die einfachere Seite und die billigere Stelle,
den Preis zu bezahlen (siehe Konsequenz 4).

**Diese Entscheidung widerspricht RFC §5.2 nicht** — und die frühere Entwurfsrichtung hier hat genau
das verwechselt. RFC §5.2 sagt zu **Shard**-Ketten: _„If horizontal scaling is needed later, partition
into per-shard chains with a periodic cross-shard aggregate anchor — but do not start there."_ Das ist
eine Aussage über **Skalierungspartitionierung**, nicht über eine fachliche Partition je Mandant. Der
Satz „für v1 wird eine einzelne Kette umgesetzt" in `02-architektur.md` §4 stützte sich auf diese
Verwechslung und ist mit dieser ADR berichtigt. Die Serialisierungsforderung des RFC (§5.2: _„Writes
must be serialized"_) bleibt unangetastet — sie gilt jetzt **je Kette**.

### Was der Mandant technisch ist: `ingestion_sources.id`

**Entschieden am 2026-07-31 durch den Auftraggeber, im selben Zug wie die Partition selbst.**
`chain_scope_id` **ist** `ingestion_sources.id` — eine Kette je Archiv. `journaling_source_id` kommt als
**Attribut** in jede Ledger-Zeile, damit „wer hat gesendet" im Beleg steht, ohne eine zweite Kette zu
sein; eine Sicht je Endpunkt ist dann eine Abfrage.

Die Abwägung, die zu dieser Wahl geführt hat — sie war zwischen zwei Spalten, die beide schon im Schema
existieren, und sie ist **nicht** später korrigierbar, weil die Kennung im Genesis-Hash steckt:

| Kandidat                | Bedeutung                                                                                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ingestion_sources.id`  | Das Archiv. `journaling_sources.ingestion_source_id` ist laut Schemakommentar „the backing ingestion source that owns all archived emails"; Storage-Pfade sind nach dieser ID benannt (`CLAUDE.md` §5.5) |
| `journaling_sources.id` | Der SMTP-Endpunkt. Trägt `organization_domains`, `allowed_ips`, eigene SMTP-Credentials und `routing_address`                                                                                            |

**Drei Gründe für `ingestion_sources.id`, alle am vorhandenen Schema geprüft:**

1. **Der Ledger ist der Beleg und muss stabiler sein als die Konfiguration, die ihn füllt.** Ein
   `journaling_sources`-Datensatz ist Endpunktkonfiguration: er kann `paused` werden, seine
   `routing_address` ist „immutable **unless regenerated**", und er hängt mit
   `onDelete: 'cascade'` an der Ingestion-Source. Eine Kette, deren Genesis an eine neu erzeugbare
   Konfigurationszeile gebunden ist, forkt bei jeder Neuanlage.
2. **Export und Löschung — die Begründung dieser ADR — wirken auf das Archiv**, nicht auf den
   Endpunkt. Retention und Compliance-Policy ebenfalls.
3. **Das Schema erlaubt mehrere Endpunkte je Archiv** (kein `unique` auf `ingestion_source_id`). Bei
   Kandidat 2 hätte ein Archiv dann zwei unabhängige Ketten, und eine Vollständigkeitsaussage über
   dieses Archiv müsste beide prüfen und ihre Beziehung begründen.

**Verworfen: `journaling_sources.id`.** Sie ist näher an „wer hat gesendet" und trägt die
Organisationsdomänen — aber ein Archiv mit zwei Endpunkten hätte zwei unabhängige Ketten, und eine Kette
würde an einer Zeile hängen, die neu angelegt werden kann.

### Konsequenzen

1. **`journal_ledger` bekommt eine Kettenspalte**, und `seq` ist **je Kette** fortlaufend, nicht
   global: `UNIQUE (chain_scope_id, seq)`. Ein globales `seq` wäre ein zweiter, versteckter
   Serialisierungspunkt.
2. **Der Advisory-Lock-Key wird aus der Kettenkennung abgeleitet**, nicht konstant. Das ist der
   eigentliche Inhalt von „Lock-Key-Strategie" in dieser ADR. Nebeneffekt, nicht Zweck: zwei Mandanten
   blockieren sich beim Append nicht mehr gegenseitig. `pg_advisory_xact_lock` bleibt Pflicht
   (`02-architektur.md` §4), und der Hash wird weiterhin **innerhalb** der Sperre berechnet.
3. **Die Kettenkennung muss in den Genesis-Hash.** Sonst haben zwei Ketten mit identischem erstem
   Ereignis identische Hashes, und ein Eintrag ließe sich zwischen Mandanten verschieben, ohne die
   Kette zu brechen. Das ist eine **Vorgabe an ADR-006**, dort einzuarbeiten:
   `chain_hash(0) = SHA256( "open-archiver:journal-ledger:v1:" || deployment_id || chain_scope_id )`.
4. **Ankern (E8) wird teurer.** ~~Entweder ein TSA-Zeitstempel je Kette oder ein Anker über einen
   Aggregat-Hash aller Kettenköpfe (Merkle-Wurzel **oder** kanonisch sortierte Liste); zu entscheiden in
   E7/E8.~~ **Entschieden am 2026-07-31 in [ADR-022](#adr-022--ankerform-merkle-aggregat-über-alle-kettenköpfe):
   ein Merkle-Baum über alle Kettenköpfe, ein Token je Ankerlauf.**

    > **Die durchgestrichene Fassung war falsch, und zwar in der Richtung, die diese ADR verhindern soll.**
    > Sie stellte „Merkle-Wurzel" und „kanonisch sortierte Liste" als gleichwertige Aggregatformen
    > nebeneinander. Sie sind es nicht: bei einer sortierten Liste als gestempelter Eingabe braucht der
    > Nachweis, dass der Kopf von Mandant A enthalten war, **die ganze Liste** — also `chain_scope_id`,
    > `seq` und Kopf-Hash **jedes anderen** Mandanten, wobei die `seq` das Nachrichtenvolumen verrät. Das
    > ist genau die mandantenübergreifende Offenlegung, deren Vermeidung der einzige Grund für diese ADR
    > ist. Die sortierte Liste ist damit **verworfen**, nicht eine Option. Begründung und Gegenentwurf in
    > ADR-022.

5. **`verify` (E9) muss Ketten aufzählen und eine _fehlende_ Kette erkennen.** Bei einer globalen Kette
   war „die Kette fehlt" nicht darstellbar; jetzt ist „Mandant X hat keine Kette mehr" ein
   Manipulationsbefund und braucht einen eigenen adversarialen Testfall in §12.
6. **Completeness-Monitoring (E10) rechnet je Mandant.** Eine globale Lückenzahl würde einen
   vollständig ausgefallenen Mandanten hinter dem Verkehr der anderen verstecken.
7. **Die Testmatrix wächst um einen Fall, der vorher nicht existierte:** nebenläufige Appends in
   **verschiedene** Ketten müssen sich nicht serialisieren, nebenläufige Appends in **dieselbe** Kette
   müssen es. Beides ist zu prüfen — die zweite Hälfte ist der Vertrag, die erste der Grund für den
   abgeleiteten Lock-Key.

**Verworfen:** globale Kette mit Mandanten-Tag. Sie ist billiger zu ankern und bleibt die
Rückfalloption, falls die Aggregatform aus Konsequenz 4 sich als nicht ankerbar erweist — dann braucht
es eine neue ADR, die diese hier ausdrücklich ersetzt.

## ADR-008 — Verhalten bei TSA-Ausfall

**Status:** **offen** — zu bestätigen in E8 (`JR-8-04`) · **Quelle:** RFC §15

Soll der Anchor-Job bei mehrtägiger TSA-Nichterreichbarkeit „fail closed" gehen und die Ingestion
anhalten?

**Richtung: nein.** Ingestion darf niemals stoppen — Post abzulehnen, um einen Zeitstempel zu
schützen, invertiert die Prioritäten und verursacht genau den Datenverlust, den das Feature
verhindern soll. Stattdessen laut und mit steigender Schwere eskalieren.

Die ADR wird in E8 auf _entschieden_ gesetzt, sobald das Eskalationsverhalten implementiert ist.

> **Welche** TSA es ist, entscheidet **ADR-023**; diese ADR regelt nur, was bei deren Ausfall passiert.
> Zwei Hinweise, die seit dem 2026-07-31 dazugehören: durch das Merkle-Aggregat aus **ADR-022** trifft ein
> Ausfall alle Mandanten **gleichzeitig** — ein fehlender Anker statt N, was die Eskalation vereinfacht.
> Und wer nach ADR-023 einen kostenlosen Einzelknoten benutzt, muss diese ADR gelesen haben: der Anker
> fehlt dann, die Annahme läuft weiter, und die Nachweiskette hat für diesen Zeitraum eine Lücke.

## ADR-009 — Erzwingung der Append-Only-Eigenschaft

**Status:** **entschieden** (2026-07-31) · **Entscheider:** Auftraggeber · **Umsetzung:** `JR-2-05`
(Trigger, E2) und **E11** (Rechteentzug)

**Beides, aber nicht gleichzeitig: der Trigger jetzt, der Rechteentzug in E11.** Die ursprüngliche
Frage lautete „Rechteentzug **oder** Trigger". Die Antwort ist beides — die zwei Mechanismen decken
verschiedene Angreifer ab —, und sie sind unterschiedlich weit umsetzbar, weshalb die Entscheidung sie
zeitlich trennt.

**Umfang beider Mechanismen: `journal_ledger` _und_ `deployment_identity`.** Die `deployment_id` steckt
im Genesis-Hash jeder Kette (ADR-006 §4.2); sie zu ändern entwertet jede Kette der Installation genauso
sicher wie das Umschreiben einer Ledger-Zeile.

### Was in E2 umgesetzt ist (`JR-2-05`, Migration `0042_journal_ledger_append_only.sql`)

Eine `plpgsql`-Triggerfunktion, die `RAISE EXCEPTION` mit `ERRCODE = restrict_violation` wirft, und
**vier** Trigger — je Tabelle einer für `UPDATE OR DELETE` (row level) und einer für `TRUNCATE`
(statement level).

**Der TRUNCATE-Trigger ist kein Beiwerk.** `TRUNCATE` löst Row-Level-Trigger überhaupt nicht aus, also
hätte ein reiner Row-Trigger `TRUNCATE journal_ledger` als offene Tür stehen lassen — eine Anweisung,
die den gesamten Ledger entfernt.

**Gemessen** (PostgreSQL 17.10, Rolle `admin`, siehe F37):

```
UPDATE / DELETE / TRUNCATE auf journal_ledger und deployment_identity  ⇒ refused [23001]
INSERT                                                                 ⇒ allowed
```

### Warum der Rechteentzug trotzdem nötig ist — und warum er nach E11 gehört

Der Trigger hält gegen den Weg, der praktisch zählt: **F1** injiziert rohes SQL in eine `WHERE`-Klausel
und kann weder ein `SET` noch ein `ALTER TABLE` absetzen (`postgres-js` benutzt das erweiterte Protokoll,
also kein Statement-Stacking). Ein Akteur, der darüber eine Ledger-Zeile umschreiben will, scheitert.

Er hält **nicht** gegen jemanden mit beliebigem SQL auf dieser Verbindung, und das ist **gemessen, nicht
vermutet** (F37): `SET session_replication_role = replica` und
`ALTER TABLE … DISABLE TRIGGER` sind beide erfolgreich, weil `POSTGRES_USER` in einem `postgres`-Image
**Superuser** und Eigentümer aller Tabellen ist — und `.env.example` bildet `DATABASE_URL` aus genau
dieser Rolle. In einer Standardinstallation ist der Trigger vom Anwendungskonto aus zwei Anweisungen weit
entfernt.

**Die Konsequenz ist eine Deployment-Anforderung, keine Codeänderung**, und deshalb ist sie in E11
verankert und nicht in E2 hineingezogen worden: eine eigene Rolle für die Anwendung, die nichts besitzt
und auf beiden Tabellen nur `INSERT` und `SELECT` hält; die Migration unter einer anderen Rolle; und ein
Startup-Check, der laut wird, wenn die Anwendung als Superuser oder als Eigentümer dieser Tabellen
verbindet. Ohne den dritten Punkt ist eine korrekt konfigurierte Installation von einer
Standardinstallation nicht unterscheidbar, und der Betreiber erfährt den Unterschied nie.

**Verworfen: die Rollentrennung in E2 mitnehmen.** Sie berührt `.env`, `docker-compose.yml`, den
Migrationspfad und die Betreiberdoku. Eine halb eingebaute Trennung — Rolle angelegt, aber Migration und
Doku nicht angepasst — wäre schlechter als eine dokumentierte Anforderung, weil sie den Anschein der
Erledigung erzeugt.

**Verworfen: nur Rechteentzug, ohne Trigger.** Er wirkt nicht gegen die Rolle, die die Objekte besitzt,
und genau die führt heute die Migrationen aus.

### Was diese ADR nicht behauptet

Der Trigger macht das Ledger nicht unangreifbar für einen Datenbankadministrator. Dagegen wirkt allein
das **Ankern** (E8): ein externer RFC-3161-Zeitstempel über die Merkle-Wurzel, den niemand mit
Datenbankzugriff rückwirkend fälschen kann. Trigger und Rechteentzug erhöhen die Kosten eines Eingriffs
und machen den unbeabsichtigten unmöglich; der Nachweis gegen den absichtlichen liegt außerhalb der
Datenbank.

## ADR-010 — `processEmail` erweitern oder eigener Journaling-Pfad

**Status:** **entschieden** (2026-08-05, `JR-6-02a`) · **Entscheider:** PO auf Messung ·
**Quelle:** RFC §2/§7, Architektur §6

`IngestionService.processEmail()` enthält die vollständige Hash-, Dedupe- und Storage-Pfad-Logik
(Drei-Gate-Dedupe plus Byte-Hash-Gate) und ist bereits umfangreich. Erweitern oder einen
journaling-spezifischen Pfad daneben stellen?

Die ursprüngliche Abwägung lautete: Wiederverwendung vermeidet divergierende Dedupe-Semantik — **der
teuerste denkbare Fehler in diesem Projekt** —, ein separater Pfad hält den Journaling-Code lesbar,
riskiert aber genau diese Divergenz. Entschieden werden sollte erst, „wenn der Parser (E5) zeigt, wie
stark die Metadatenform abweicht". Der Parser steht seit E5, die Bedingung ist erfüllt.

### Entscheidung: **keine der beiden.** Wiederverwenden — **unverändert** — hinter einem injizierten Port

`processEmail()` wird **nicht angefasst** und **nicht nachgebaut**. Die Phase-B-Pipeline liegt in
`packages/journaling/src/phase-b/` und erreicht das Archivieren über einen Port
(`ArchiveObjectPort`), dessen einzige Implementierung in `packages/backend` `processEmail()`
**unmodifiziert** aufruft.

**Erstens, weil der Bestand für genau diesen Aufrufer gebaut ist** — das ist der Fund, der die Frage
entscheidet, und er stand in keiner der beiden Optionen:

| Stelle im Bestand                                    | Was sie beweist                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `processEmail(…, skipTempFileCleanup)`               | Der Parameter ist laut Kommentar „für die **journaling fan-out loop**, die `processEmail()` mehrfach mit demselben `EmailObject` aufruft"  |
| `isJournaled: source.provider === 'smtp_journaling'` | Wird an **drei** `INSERT`-Stellen gesetzt; `smtp_journaling` steht im `ingestionProviderEnum` und in `IngestionCredentials`                |
| `preserveOriginalFile`-Modus                         | Speichert `rawEmlBuffer` **unverändert**, hasht ihn **vor** `storage.put()`, erzeugt **keine** Attachment-Zeilen — Byte-Treue plus ADR-006 |
| Gate 2 (Shared-File-Reference)                       | Eine physische Datei, **N** `archived_emails`-Zeilen mit je eigenem `userEmail` — genau die Fan-out-Form, die ein Journal-Report braucht   |

Diese Verdrahtung lag im **Enterprise-Overlay**, das in diesem Repository fehlt (CLAUDE.md §2). Der
Aufrufer ist weg, die für ihn gebaute Schnittstelle ist da. Sie nachzubauen hieße, eine zweite
Dedupe-Semantik neben eine bestehende zu stellen, die für diesen Fall schon Vorkehrungen trägt.

**Zweitens, weil „erweitern" ADR-025 verletzt.** Journaling-Semantik in `processEmail()` hineinzulegen
heißt, sie in `packages/backend` entstehen zu lassen — und zwar so, dass sie sich nur mit ihm zusammen
betreiben lässt. Genau das verbietet ADR-025, und nicht aus Ästhetik: es kassiert die Option, die
Herauslösung eine **Verpackungsentscheidung** bleiben zu lassen. Ein Port kostet eine Datei und hält
beide Regeln gleichzeitig ein — Architektur §6 („Worker in `packages/backend`") und ADR-025
(„Logik nicht dort").

**Drittens, weil das Gegenargument gemessen nicht trägt.** Der ernsteste Einwand gegen
Wiederverwendung war der Speicher: `processEmail()` liest mit `readFile()` die **ganze** Nachricht in
den Heap, während E3 (`JR-3-02`) ausdrücklich streamt, um genau das zu vermeiden. Nachgemessen am
Code: **`StorageService.put()` puffert einen übergebenen Stream ohnehin sofort zu einem Buffer**
(`streamToBuffer()`, weil AES-256-CBC über ganze Buffer läuft) — obwohl die Signatur von
`IStorageProvider.put()` `Buffer | NodeJS.ReadableStream` verspricht. **Ein eigener Pfad würde also
genauso puffern.** Die Volllpufferung ist eine Eigenschaft der Storage-Schicht, nicht von
`processEmail()`, und damit **kein Unterscheidungsmerkmal zwischen den Optionen**. Als eigener Befund
festgehalten: **F60**, zuzuordnen zu **E7** (WORM-Storage), wo der S3-Provider ohnehin angefasst wird.

### Was die Pipeline trotzdem selbst tun muss — und warum das kein Widerspruch ist

Wiederverwendung heißt nicht, dass `processEmail()` Phase B **ist**. Drei Zusagen kann es
konstruktionsbedingt nicht erfüllen, weil es den Ledger nicht kennt. Sie liegen deshalb **vor** dem
Port, in `packages/journaling`:

1. **`content_sha256` ist die Autorität, nicht der `Message-ID`-Header.** `processEmail()`s Gate 1 und
   2 schlüsseln auf `messageIdHeader`; RFC §4.5 und `JR-6-03` verlangen Objekt-Dedupe auf
   `content_sha256`. Das ist **die** Divergenz, vor der diese ADR warnt — sie wird nicht dadurch
   vermieden, dass man den Bestand benutzt, sondern dadurch, dass die Pipeline den Hash **vorher**
   prüft und dem Port eine hash-abgeleitete Identität übergibt. Ein Journal-Report mit gefälschtem
   oder fehlendem `Message-ID` deduped damit dennoch korrekt.
2. **Die Spool-Bytes werden gegen die Ledger-Zeile geprüft, bevor irgendetwas archiviert wird.** Stimmt
   der Hash der Spool-Datei nicht mit dem `content_sha256` der Receipt überein, ist die Datei nicht
   das, was quittiert wurde ⇒ **Quarantäne und Alarm, nie archivieren, nie löschen**.
3. **Jede Receipt bleibt im Ledger.** `processEmail()` gibt bei einem Duplikat `null` zurück — für
   Phase B bedeutet das nicht „nichts zu tun", sondern „Objekt existiert, jetzt `duplicate_of`
   schreiben" (`JR-6-03`). Ein Empfangsereignis ist nicht die Nachricht.

### Konsequenz

- `packages/backend` bekommt **einen Adapter**, keine Journaling-Logik. Der Prüfpunkt jedes Reviews im
  Journaling-Umfeld (ADR-025) bleibt anwendbar.
- **`processEmail()` bleibt unverändert.** Wer es doch anfassen muss, hat diese ADR zu ändern, nicht zu
  umgehen — und muss dann sagen, was mit der Herauslösungsoption geschieht.
- Der Journaling-Pfad benutzt eine `ingestion_sources`-Zeile mit `provider = 'smtp_journaling'` und
  `preserveOriginalFile = true`. Beides existiert; `isJournaled` folgt daraus von allein.
- **Verworfen: `processEmail()` erweitern.** Verletzt ADR-025, wächst eine Methode mit drei
  Dedupe-Gates weiter, und der einzige gemessene Vorteil (Speicher) existiert nicht.
- **Verworfen: eigener Storage-/Dedupe-Pfad.** Erzeugt die zweite Dedupe-Semantik, die diese ADR als
  teuersten denkbaren Fehler benennt — und zwar ohne Gegenwert, weil der Bestand die Fan-out-Form
  schon hat.

## ADR-011 — Ledger-Backend: Postgres zuerst, steckbar

**Status:** entschieden (2026-07-27) · **Quelle:** RFC §5.4

Variante (a): Ledger in PostgreSQL mit `synchronous_commit = on`. Variante (b): lokales append-only
WAL, fsync'd, asynchron nach Postgres repliziert — **nicht** in v1, aber ohne Signaturänderung
nachrüstbar.

**Begründung:** RFC empfiehlt (a) als Default. (a) koppelt die Ack-Latenz an die DB-Verfügbarkeit;
das ist akzeptabel und liefert ein klares `451`, wenn die DB weg ist. (b) überlebt DB-Ausfälle, hat
aber mehr bewegliche Teile.

**Konsequenz:** `JR-2-07` baut die Schnittstelle steckbar. Solange (a) gilt: DB nicht erreichbar ⇒
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

## ADR-014 — Branch-Strategie: Epic-Branches über einem Integrationsbranch

**Status:** entschieden (2026-07-27) · **Entscheider:** Auftraggeber

`claude/enterprise-product-implementation-cxmmqe` ist **Integrationsbranch**, kein Arbeitsbranch. Pro
Epic wird davon ein eigener Zweig abgezweigt und nach Abnahme zurückgemergt.

| Regel          | Festlegung                                                                            |
| -------------- | ------------------------------------------------------------------------------------- |
| Namensschema   | `claude/journaling-e<N>-<kurzname>`, z. B. `claude/journaling-e1-test-foundation`     |
| Abzweigpunkt   | immer der Integrationsbranch, nie `main`, nie ein anderer Epic-Branch                 |
| Rückmerge      | erst nach unabhängiger Abnahme durch die Rolle `TEST` (siehe `04-testplan.md` §6)     |
| Upstream-Drift | `main` regelmäßig in den **Integrationsbranch** mergen, nie in einzelne Epic-Branches |
| `main`         | wird **erst nach Abnahme von E12** angefasst. Kein früher E1-Merge                    |
| Pull Requests  | keine ohne ausdrückliche Aufforderung des Auftraggebers                               |

**Begründung:** 102 Tasks über 12 Epics in einem einzigen Branch ergäben einen Diff, der nicht mehr
reviewbar ist, und ein schiefgelaufenes Epic ließe sich nicht isoliert verwerfen. Gerade bei E3/E4
(Durability-Semantik, Risiko „sehr hoch") ist die Möglichkeit, einen Stand wegzuwerfen, der
eigentliche Wert. `main` bekommt gesquashte Release-Commits aus dem Upstream
`LogicLabs-OU/OpenArchiver` (V0.5.0 → V0.5.1 → V0.5.2); die Drift wird über die Projektlaufzeit
relevant und soll an genau einer Stelle aufgelöst werden, nicht zwölfmal.

**Warum kein früher Merge von E1 nach `main`:** Das Test- und CI-Fundament wäre isoliert nützlich und
risikoarm — der Auftraggeber hat sich dennoch für vollständige Isolation entschieden. Preis: `main`
bekommt bis zur Abnahme von E12 keine CI, und die Upstream-Drift wächst länger. Bewusst akzeptiert.

**Verworfene Alternative:** Epic-Branches direkt gegen `main` mit PRs. Die Epics hängen linear
voneinander ab (E2 braucht E1, E3 braucht E2); jedes müsste gemergt sein, bevor das nächste starten
kann — ein liegengebliebenes Review blockiert das Projekt.

**Konsequenz:** Die ursprüngliche Sessionvorgabe „alle Entwicklung und alle Pushes auf
`claude/enterprise-product-implementation-cxmmqe`" ist damit ausdrücklich aufgehoben. Arbeit, die die
Projektgrundlage betrifft (Dokumentation, ADRs, Agent-Infrastruktur), gehört weiterhin direkt auf den
Integrationsbranch.

## ADR-015 — Generierte Dateien werden von Prettier ausgenommen, nicht formatiert

**Status:** entschieden (2026-07-27) · **Entscheider:** DEV (im Rahmen von `JR-1-05a`)

Die sechs generierten Dateien unter den 13 Prettier-Beanstandungen werden **nicht** mitformatiert,
sondern in `.prettierignore` aufgenommen. Nur die sieben handgeschriebenen Dateien gehen in den
Formatierungs-Commit.

| Eintrag in `.prettierignore`                     | Generator            | Läuft bei                         |
| ------------------------------------------------ | -------------------- | --------------------------------- |
| `docs/api/openapi.json`                          | `pnpm docs:gen-spec` | jedem `docs:dev` und `docs:build` |
| `packages/backend/src/database/migrations/meta/` | `pnpm db:generate`   | jeder Schemaänderung              |

**Begründung — empirisch belegt:** Beide Generatoren schreiben ihre Ausgabe mit
`JSON.stringify(…, null, 2)`, also mit zwei Leerzeichen Einrückung. Das Repo-Prettier ist auf
`useTabs: true` konfiguriert. Formatieren und Generieren widersprechen sich damit dauerhaft.

Belege:

- `docs/api/openapi.json`: Datei mit `prettier --write` formatiert (`--check` danach grün), dann
  `pnpm docs:gen-spec` ausgeführt → `--check` sofort wieder rot, Inhalt byteidentisch zum
  ursprünglich committeten Stand. Schreibstelle: `packages/backend/scripts/generate-openapi-spec.mjs`
  Zeile 732, `writeFileSync(outputPath, JSON.stringify(spec, null, 2))`.
- `migrations/meta/`: alle `meta/*.json` formatiert (`--check` grün), dann eine Wegwerf-Spalte ins
  Schema gesetzt und `drizzle-kit generate` ausgeführt → drizzle-kit hat `_journal.json`
  unformatiert zurückgeschrieben und ein ebenfalls unformatiertes `0041_snapshot.json` angelegt.
  Bestätigt in `drizzle-kit@0.31.4` (`bin.cjs`): `JSON.stringify(journal, null, 2)`. Wegwerf-Änderung
  vollständig zurückgenommen.

Gegenprobe nach der Änderung: beide Generatoren erneut ausgeführt → `pnpm lint` bleibt grün. Damit
ist das Akzeptanzkriterium „`pnpm db:generate` erzeugt danach keine erneute Lint-Verletzung" erfüllt.

**Verworfene Alternative:** die generierten Dateien mitformatieren und nach jedem Generatorlauf
`pnpm format` nachziehen. Das macht den künftigen CI-Job aus `JR-1-05` bei jeder Schema- oder
API-Änderung grundlos rot und verlagert die Reparatur auf den Entwickler, der zufällig die nächste
Migration schreibt.

**Umfang der Ausnahme:** bewusst der ganze Ordner `migrations/meta/`, nicht einzelne Snapshots — jede
künftige Migration legt eine weitere `NNNN_snapshot.json` an, eine Dateiliste wäre sofort veraltet.
Die `migrations/*.sql` brauchen keinen Eintrag: Prettier hat keinen SQL-Parser und lässt sie
ohnehin unangetastet.

**Nicht verifiziert:** `pnpm db:generate` selbst ist in diesem Container nicht lauffähig —
`packages/backend/drizzle.config.ts` wirft beim Import, wenn `DATABASE_URL` fehlt, und es gibt weder
`.env` noch einen Postgres auf Port 5432. Der Nachweis lief deshalb über einen direkten
`drizzle-kit generate`-Aufruf mit gesetztem Dummy-`DATABASE_URL`. Das ist zulässig, weil `generate`
rein aus dem Schema arbeitet und keine Verbindung aufbaut (die Ausführung bestätigt das: 22 Tabellen
gelesen, Migration geschrieben, kein Verbindungsfehler) — die **Wrapper-Kette**
`dotenv -- pnpm --filter … drizzle-kit generate` ist damit aber nicht end-to-end getestet. Sie
beeinflusst das Ausgabeformat nicht.

**Konsequenz:** Wer `docs/api/openapi.json` oder einen drizzle-Snapshot künftig doch formatiert
sehen will, braucht eine neue ADR, die diese ersetzt. Der Review von Snapshots (Skill
`oa-migration`) bleibt unverändert Pflicht — „von Prettier ignoriert" heißt nicht „nicht
reviewpflichtig".

## ADR-016 — Fail-closed rechtfertigt den Verhaltensbruch aus `JR-13-02`

**Status:** entschieden (2026-07-29) · **Entscheider:** PO · **Betrifft:** F7, F19, F20, `JR-13-02`,
`JR-13-07`, E11

> **Zur Nummer:** ADR-016 liegt zwischen ADR-015 und ADR-017, und das ist Absicht — **nicht
> umnummerieren.** ADR-017 wurde zuerst geschrieben, weil sie `JR-13-02` blockierte; ADR-016
> beschreibt dessen Ergebnis und hat die Nummer reserviert bekommen. Die Reihenfolge der Nummern ist
> die Reihenfolge der Sachlogik, nicht die der Entstehung.

**Entscheidung:** `FilterBuilder.create()` antwortet für **jedes** Ergebnis mit deny, das kein
nachweislich **unbedingtes `can`** ist — kein passendes Recht, nur Verbote, ein widerrufenes Recht,
eine Bedingungsmenge, die sich nicht ausdrücken lässt. Der damit verbundene Verhaltensbruch wird
**hingenommen** und über einen Release-Hinweis samt Prüfanleitung begleitet (`JR-13-07`), nicht über
einen Kompatibilitätsschalter abgefedert.

Wer bisher den `null`-Zweig traf, sah das **ganze** Archiv und sieht künftig **nichts**. Das ist die
größte Verhaltensänderung, die E13 auslöst.

### Warum das kein „Sicherheit geht vor" ist

Das Argument ist nicht abstrakt, sondern eine Aussage über die Aussagekraft des Systems: **„kein Recht
auf dieses Subject" und „darf alles sehen" wurden vom selben Wert dargestellt** —
`{ drizzleFilter: undefined, searchFilter: undefined }` —, **und der unsichere war der Default.**
`FilterBuilder.ts:49` bildete das `null` von `rulesToQuery` auf genau diesen Wert ab, kommentiert als
„Full access", während der unmittelbar folgende Zweig für das leere Query korrekt ``sql`1=0` ``
lieferte.

Die Folge ist keine Größenordnung von Risiko, sondern das Fehlen einer Eigenschaft: **in diesem
Zustand ist keine Zugriffsaussage über das Archiv belegbar.** Man kann einer Rolle nicht ansehen, ob
sie einschränkt. Zwei Policies, von denen eine ein Postfach freigibt und die andere ein Postfach
verbietet, liefern dieselbe Wirkung — Vollzugriff. Damit ist auch keine Aussage darüber möglich, wer
ein Archivobjekt gesehen haben **kann**, und genau diese Aussage ist der Zweck der Zugriffsschicht
über einem Archiv (RFC §11). F19 und F20 sind dieselbe Verwechslung an zwei weiteren Stellen: ein
`can` mit leerem `conditions` und ein `cannot` ohne Bedingung landeten ebenfalls bei „darf alles
sehen".

Fail-closed stellt die Unterscheidbarkeit her: unbeschränkt ist ab jetzt genau ein Fall, und der ist
im Code benannt. Alles andere ist ein Filter oder ein deny.

### Verworfene Alternative: Verhalten beibehalten und nur dokumentieren

Die naheliegende Alternative war, `null` weiter als Vollzugriff zu behandeln und das Verhalten
lediglich zu dokumentieren — „wer einschränken will, muss ein `can` erteilen" —, notfalls mit einem
Schalter, der die alte Semantik erhält. Das ist nicht tragfähig, aus einem konkreten Grund und nicht
aus Vorsicht:

**E11s Auditor-Rolle ist auf genau diesen Mechanismus gebaut.** `JR-11-01` liefert eine Rolle, die
lesen und suchen darf und sonst nichts, in der Form von `auditor-specific-mailbox.json`. Diese Form
erteilt für `archive` **kein** `can`, sondern nur ein Verbot — und traf damit exakt den `null`-Zweig.
Ein „read-only"-Auditor, der unbeschränkt liest, ist keine Auditor-Rolle; **E11 wäre mit dem alten
Verhalten nicht abnehmbar.** Dokumentieren hätte bedeutet, die Einschränkung als nicht existent zu
beschreiben und E11 die Grundlage zu entziehen.

Verschärfend kommt F17 dazu: ausgeliefert existiert **keine** Read-Only-Rolle, weil der
Rollen-Bootstrap in einer echten Installation nie läuft. Jeder eingeschränkte Nutzer ist damit eine
handgeschriebene Policy in genau der Form, die der `null`-Zweig ins Gegenteil verkehrt. Das ist nicht
der Ausnahmefall, sondern der einzige Weg, den ein Betreiber hat.

**Auch der Schalter ist verworfen.** Er müsste dokumentiert werden, und jede Installation, die ihn
setzt, hätte wieder keine belegbare Zugriffsaussage — derselbe Zustand, nur mit Namen. Ein
Kompatibilitätsschalter über einer Autorisierungsentscheidung ist eine dauerhafte zweite Semantik,
die jeder künftige Test mitprüfen müsste.

### Was den Bruch verträglich macht

- **Keine der drei `predefined_*`-Rollen ist betroffen** — belegt, nicht hergeleitet, durch
  `tests/integration/predefined-roles.int.test.ts`, das durch alle fünf Fixes grün geblieben ist
  (Einschränkungen: ADR-017, Nachtrag, Punkte 1 und 2).
- Die betroffenen Formen sind **benennbar und abfragbar**: drei Formen für den `null`-Zweig plus die
  Formen aus F19/F20 und `JR-13-06`. Deshalb ist `JR-13-07` eine Prüfanleitung mit SQL gegen
  `roles.policies` und keine Pauschalwarnung.
- Der Bruch ist **laut**, nicht still: ein deny fällt auf, eine leere Ergebnisliste ist auffindbar.
  Der Zustand davor war das Gegenteil.

### Konsequenz

- `JR-13-07` liefert Release-Hinweis und Prüfanleitung in der **öffentlichen** Doku
  (`docs/user-guides/upgrade-and-migration/access-control-changes.md`), englisch nach ADR-003, samt
  der getesteten SQL. Die Prüfanleitung ist Teil dieser Entscheidung, nicht Beigabe: der Bruch ist
  nur deshalb vertretbar, weil er vorab feststellbar ist.
- Wer die alte Semantik zurückholen will — auch als Schalter —, braucht eine ADR, die diese ersetzt.
- Die Anleitung darf **nicht** als „vollständig geprüft" gelesen werden: der Restspalt aus ADR-019
  (ein Key, der nur die Spaltenexistenz verletzt) fällt weiter erst zur Abfragezeit auf und ist als
  `JR-13-11` geführt.

## ADR-017 — Action-Versatz zwischen Route-Gate und `FilterBuilder`

**Status:** entschieden (2026-07-29) · **Entscheider:** Auftraggeber · **Betrifft:** F7, `JR-13-02`,
`JR-13-03`

**Entscheidung: Variante B.** `SearchService` baut seinen Row-Level-Filter künftig für die Action,
unter der die Route den Request tatsächlich autorisiert hat:

```diff
- const { searchFilter } = await FilterBuilder.create(userId, 'archive', 'read');
+ const { searchFilter } = await FilterBuilder.create(userId, 'archive', 'search');
```

in `packages/backend/src/services/SearchService.ts:311` und `:423`. Die beiden Suchrouten in
`api/routes/search.routes.ts` bleiben **unverändert**.

### Der Befund

Das Route-Gate und der Filteraufbau prüfen unterschiedliche Actions:

| Ort                                                    | geprüfte (Action, Subject)                        |
| ------------------------------------------------------ | ------------------------------------------------- |
| `api/routes/search.routes.ts:158` GET `/search`        | `requirePermission('search', 'archive')`          |
| `api/routes/search.routes.ts:211` GET `/search/facets` | `requirePermission('search', 'archive')`          |
| `services/SearchService.ts:311`                        | `FilterBuilder.create(userId, 'archive', 'read')` |
| `services/SearchService.ts:423`                        | `FilterBuilder.create(userId, 'archive', 'read')` |

Eine Rolle mit `can search archive` und **ohne** `read archive` passiert damit das Gate, während
`rulesToQuery` für `('read','archive')` `null` liefert — was `FilterBuilder` heute als „Full access"
auslegt (F7). Der Versatz ist die Erreichbarkeit von F7 über die Suche.

Er existiert **nur** an diesen zwei Routen. Alle vier `FilterBuilder.create`-Aufrufe im Repository
verwenden die Action `'read'`, aber die übrigen Routen gaten selbst auf `read`
(`archived-email.routes.ts:66`/`:138`, `storage.routes.ts:70`, `integrity.routes.ts:56`); der vierte
Aufruf, `IngestionService.ts:137`, arbeitet auf dem Subject `'ingestion'`, nicht `'archive'`.

### Warum Variante B

Row-Level-Scoping muss sich nach denselben (Action, Subject) richten, unter denen der Request
autorisiert wurde. Alles andere ist zwei Wahrheiten über dieselbe Anfrage. B ist zugleich die
minimale Änderung, die F7s Weg über die Suchroute schließt.

**Auswirkung auf die ausgelieferten Rollen: keine.** Geprüft am Code
(`api/controllers/iam.controller.ts` `createDefaultRoles`, `services/UserService.ts:270`):

| Rolle                       | Regel für `archive`                    | Verhalten bei Action `search`                                                                  |
| --------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `predefined_super_admin`    | `manage: all`, unbedingt               | unbedingtes `can` ⇒ Vollzugriff, wie bei `read`                                                |
| `predefined_end_user`       | `manage archive` **mit** `conditions`  | CASLs `manage` ist ein echter Wildcard und deckt `search`; dieselbe Bedingung, derselbe Filter |
| `predefined_read_only_user` | `action: ['read','search']`, unbedingt | `search` ist explizit erteilt ⇒ Vollzugriff, wie bei `read`                                    |

Keine dieser drei Rollen erreicht den `null`-Zweig in `FilterBuilder.ts:49` — weder vor noch nach der
Änderung. Der Nachweis dafür ist der Integrationstest aus `JR-13-01`, nicht diese Tabelle.

### Nachtrag 2026-07-29 — nachgemessen in `JR-13-01`, zwei Einschränkungen

Die Entscheidung bleibt Variante B, und sie ist jetzt **belegt statt hergeleitet**:
`tests/integration/predefined-roles.int.test.ts` legt die drei Rollen über Produktionscode an und
zeigt, dass `('archive','read')` und `('archive','search')` je Rolle **identischen** Filtertext,
identische Bind-Parameter und identischen Meili-Filter ergeben. `JR-13-03` ist damit für eine
Standardinstallation nachweisbar wirkungsfrei — unabhängig davon, was `JR-13-02` mit dem `null`-Zweig
macht.

Zwei Aussagen dieses Abschnitts waren aber zu weit gefasst:

1. **Der Satz gilt je Aufrufstelle, nicht je Rolle (F18).** Über das volle Vokabular (8 Actions × 7
   Subjects) erreicht `predefined_end_user` den `null`-Zweig für 39 von 56 Paaren,
   `predefined_read_only_user` für 46 — eine Read-Only-Rolle hat naturgemäß kein `create archive`.
   Nur `manage: all` erteilt für jedes Paar ein unbedingtes `can`. Richtig gelesen lautet die Aussage:
   **für die (Action, Subject)-Paare der heute existierenden vier Aufrufstellen** trifft keine der drei
   Rollen den `null`-Zweig. Eine fünfte Aufrufstelle mit einer anderen Action — `export archive` aus
   E11 ist der naheliegende Kandidat — kann das umstoßen. `tests/unit/filter-builder-call-sites.test.ts`
   wacht deshalb darüber, dass es bei vier bleibt.
2. **„Ausgeliefert" trifft auf zwei der drei Rollen nicht zu (F17).** `createDefaultRoles()` läuft in
   einer echten Installation **nie**: `createFirstAdmin()` legt `predefined_super_admin` an und
   erfüllt damit dauerhaft den Bootstrap-Auslöser `!roles.some(r => r.slug?.includes('predefined_'))`.
   Eine Standardinstallation hat **eine** Rolle, nicht drei.

Punkt 2 macht die Wirkungsanalyse nicht falsch — die beiden nicht existierenden Rollen können den
Zweig erst gar nicht treffen —, aber er verschiebt die Lesart von F7 in die unangenehme Richtung:
**ausgeliefert gibt es keine Read-Only-Rolle.** Jeder eingeschränkte Nutzer ist eine handgeschriebene
Policy, und die naheliegende Form dafür ist die von `auditor-specific-mailbox.json` — genau die Form,
die F7 ins Gegenteil verkehrt. **F7s praktische Schwere steigt dadurch.** Der Fix für F17 ist eine
Produktentscheidung (welche Rollen liefert Open Archiver aus?) und gehört **nicht** in E13;
`JR-13-07`s Betreiberanleitung muss den Sachverhalt aber benennen, sonst sucht ein Betreiber nach
einer Rolle, die es nicht gibt.

### Verworfen: Variante A — Suchrouten zusätzlich auf `read` gaten

Eine Rolle mit `search` ohne `read` bekäme ein klares `403` statt eines leeren Ergebnisses, was für
den Betreiber besser diagnostizierbar wäre. Der Preis ist zu hoch: wenn `read` ohnehin nötig ist,
trägt `search` auf `archive` keine eigene Information mehr. Das Vokabular verlöre eine Unterscheidung,
die `docs/services/iam-service/iam-policy.md` ausdrücklich führt, und `predefined_read_only_user`
erteilt beide Actions genau deshalb getrennt.

### Verworfen für E13: Variante C — Divergenz konstruktiv ausschließen

Die in `requirePermission` geprüfte (Action, Subject) am Request mitführen und `FilterBuilder` daraus
speisen, statt sie im Service erneut zu wählen. Damit könnte der Versatz nicht wiederkehren — die
Fehlerklasse verschwindet, nicht nur dieser Fall. Das ist richtig, aber es berührt die Middleware,
alle vier Aufrufstellen und die Service-Signaturen: eine Refaktorierung, keine Sicherheitskorrektur,
und sie gehört nicht in ein Epic, dessen Zweck das Schließen einer Autorisierungslücke ist. **Als
`JR-13-10` nach E13 vorgemerkt**, ausdrücklich nicht Teil von E13s Abnahme.

### Konsequenz

- `JR-13-03` ist damit entschieden und gibt `JR-13-02` frei.
- `JR-13-01` muss die gewählte Semantik fordern: der Filter für eine Rolle mit bedingtem
  `search archive` entsteht aus deren `search`-Regeln.
- Wer diese Entscheidung umkehren will, braucht eine neue ADR, die diese ersetzt — keine stille
  Änderung des dritten Arguments.

## ADR-018 — Ein unübersetzbarer Zweig wird verweigert, nicht durch ein Sentinel ersetzt

**Status:** entschieden (2026-07-29) · **Entscheider:** PO · **Betrifft:** F3, F22, `JR-13-04`,
`JR-13-01`

`mongoToDrizzle` **wirft**, wenn eine Policy-Bedingung nicht übersetzbar ist. Es gibt **keinen**
milden Modus, und ein verworfener Zweig wird **nicht** durch ein „never-true"-Prädikat je Zweig
ersetzt.

**Anlass:** Nach den Fixes `JR-13-02`–`JR-13-06` blieb genau ein roter Test übrig, und zwar nicht
wegen eines fehlenden Fixes, sondern weil zwei Erwartungen aus `JR-13-01` sich widersprachen:

| Ort                                             | Eingabe                                       | Forderung                                        |
| ----------------------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| `src/helpers/mongoToDrizzle.test.ts:227`        | `{ $or: [{id:'a'}, {subject:{$regex:'x'}}] }` | fail-closed, und **nicht** `"id" = $1`           |
| `tests/integration/filter-builder-f1-f3.int.ts` | strukturell identisch                         | ein Prädikat, unter dem `rows.mine` sichtbar ist |

Beide trugen `RED UNTIL JR-13-04`. Unabhängig nachgemessen: die beiden sind **unter jeder
Implementierung** unvereinbar — es gibt keine prinzipielle Regel, die `{id:'a'}` anders behandelt als
`{userEmail:…}`, beide sind Gleichheit auf einer erlaubten Spalte.

**Entscheidung: die Unit-Erwartung gilt, die Integrationszeile war falsch.** Drei Gründe:

1. `JR-13-04`s Kriterium lautet „kein Zweig wird stillschweigend weggelassen" und nennt das `$or`
   ausdrücklich. Die Integrationszeile forderte genau dieses Weglassen.
2. **Das Sentinel-Verfahren ist unsicher.** `FilterBuilder.ts:84` setzt jede `cannot`-Bedingung unter
   ein `$not`. Ein „never-true" je verworfenem Zweig ergibt dort `not(false)` = **wahr**: ein
   vakuumer Konjunkt, das Verbot ist weg. Gemessen am Übersetzer vor `JR-13-04`:
   `{ $and: [{ $not: {userEmail} }, { $not: <unübersetzbar> }] }` ⇒ `not "user_email" = $1`, das
   zweite Verbot fehlt schlicht.
3. `mongoToMeli` wirft für dieselbe Form schon **vor** E13, festgehalten von einem grünen Test
   (`mongo-to-meli.int.test.ts:141`). `FilterBuilder.create()` hat solche Policies also immer
   abgelehnt — nur eben abhängig davon, dass der Suchübersetzer streng bleibt.

**Konsequenz:** Wer `mongoToDrizzle` später einen „gib zurück, was du kannst"-Modus geben will, hebt
damit F3 und F22 wieder auf und braucht eine ADR, die diese ersetzt. Der Aufrufer, der eine
Verweigerung nicht will, muss die Policy reparieren, nicht den Übersetzer aufweichen.

**Nebenwirkung, bewusst akzeptiert:** eine Policy, die vor E13 stillschweigend zu wenig oder zu viel
zeigte, führt jetzt zu einem Fehler statt zu einem falschen Ergebnis. Das ist die Absicht — ein
Fehler ist auffindbar, ein falsches Ergebnis nicht. `JR-13-07` muss es in der Betreiberanleitung
nennen.

## ADR-019 — Die Key-Allowlist prüft Form und Relation, nicht Spaltenexistenz

**Status:** entschieden (2026-07-29) · **Entscheider:** PO · **Betrifft:** F1, F21, `JR-13-06`,
`JR-13-11`

Die in `JR-13-06` gebaute Allowlist lässt einen Key durch, wenn er **formal** eine Spaltenreferenz ist
— ein einzelner Identifier oder `<relation>.<identifier>` mit einer Relation aus
`relationToTableMap`. Sie prüft **nicht**, ob die Spalte existiert. Ein einzelner unbekannter, aber
syntaktisch harmloser Key wie `foo` wird weiter übersetzt und scheitert erst an Postgres.

**Das ist eine Einschränkung meiner eigenen F21-Entscheidung.** Ich hatte „jeder unbekannte Key wird
abgewiesen" verfügt, ohne zu berücksichtigen, dass `mongoToDrizzle` ein **subjektagnostischer**
Übersetzer ist: er bekommt nur das Query-Objekt und weiß nicht, gegen welche Tabelle er baut. Eine
spaltengenaue Liste dort hätte entweder falsch sein müssen oder die Formtests des Übersetzers
gebrochen, die absichtlich mit synthetischen Feldnamen arbeiten (`{a:1}`, `{b:2}`, `{n:{$gt:1}}`).

**Warum das trotzdem tragfähig ist:** Der Zweck von F1 war der Injektionsweg, und der ist zu — an
**zwei** Stellen. `PolicyValidator` weist eine Policy mit einem nicht-identifierartigen Key beim
Anlegen ab (400 aus `iam.controller.ts`), und `mongoToDrizzle` weist sie zur Abfragezeit erneut ab;
`sql.raw` ist aus dem Relationszweig entfernt. Der Restspalt ist ein **Policy-Schreibfehler**, kein
Angriffsweg: `"foo" = $1` trifft keine Spalte und erzeugt einen Fehler, kein stilles Ergebnis.

**Konsequenz:** Der Restspalt wird als **`JR-13-11`** geführt, nicht offen gelassen — spaltengenaue
Prüfung in `FilterBuilder.create()`, das `resourceType` bereits als Parameter hat. Unabhängig von
`JR-13-10`; Variante C wird dafür nicht gebraucht. Bis dahin gilt: **ein Tippfehler in einer Policy
fällt beim Anlegen auf, wenn er die Form verletzt, und erst zur Abfragezeit, wenn er nur die
Spaltenexistenz verletzt.**

## ADR-020 — Betreiberdokumentation sagt, was sie meldet, nie was sie garantiert

**Status:** entschieden (2026-07-29) · **Entscheider:** PO · **Betrifft:** F27, F30, `JR-13-07`,
`JR-13-14`, `JR-13-17`

Eine Prüfanleitung für Betreiber beschreibt **die Befunde, die sie meldet**. Sie behauptet **keine
Vollständigkeit** über Daten ohne festes Schema. Sätze der Form „es prüft rekursiv alle …", „ein
leeres Ergebnis heißt, dass keine Rolle betroffen ist" oder „diese Klasse ändert sich in diesem
Release nicht" sind in `docs/user-guides/upgrade-and-migration/access-control-changes.md` unzulässig.

**Begründung — zwei Ablehnungen derselben Klasse.** E13 ist zweimal an der betreibersichtbaren Hälfte
gescheitert, und beide Male an einem **positiven Abdeckungssatz**, nicht am Code:

| Runde       | Befund  | Widerlegter Satz                                                         | Gefundene Form                            |
| ----------- | ------- | ------------------------------------------------------------------------ | ----------------------------------------- |
| `JR-13-09`  | **F27** | „No rows means no role … is affected"                                    | `conditions: 5` (Skalar an der Wurzel)    |
| `JR-13-09a` | **F30** | „walked recursively … the empty object" · „not one this release changes" | `{"$or": [{…}, {}]}`, `{"userEmail": {}}` |

Die Policies liegen als JSONB, also ohne Schema. Zu jeder Abfrage, die Abdeckung behauptet, lässt sich
eine Ebene tiefer eine Form konstruieren, die sie nicht kennt — der Anspruch ist **prinzipiell**
falsifizierbar, nicht nur zufällig falsch. Ein Betreiber, der „ist abgedeckt" liest und kein Ergebnis
bekommt, zieht dann den gefährlichsten möglichen Schluss.

**Was an die Stelle tritt:** die Liste der gemeldeten Befundtypen, der ausdrückliche Satz, dass ein
leeres Ergebnis ein **Hinweis und keine Freigabe** ist, und eine Gegenprobe, die **nicht** von einer
Aufzählung von JSON-Formen abhängt — jede eingeschränkte Rolle einmal ausüben und das Ergebnis
vergleichen. Diese Gegenprobe hängt nicht an einer Formliste; **vollständig ist sie damit nicht** —
sie misst genau die Oberflächen, die sie ausübt, und nur die (siehe Berichtigung unten).

**Verworfene Alternative:** die Abfragen so lange erweitern, bis sie vollständig sind. Zweimal
versucht, zweimal von einer tieferen Form eingeholt; die dritte Runde hätte dasselbe Ergebnis. Die
billige Erweiterung wird trotzdem mitgenommen (`JR-13-17` (a)) — sie ist eine Verbesserung, nur keine
Grundlage für eine Zusage.

**Konsequenz:** `JR-13-16` (Regressionstest für diese Abfragen) bleibt nach E13 und ist damit eine
Verbesserung statt einer Abnahmevoraussetzung — genau deshalb war es richtig, ihn aus E13 zu nehmen.
Wer künftig einen Abdeckungssatz in diese Seite schreibt, braucht eine ADR, die diese ersetzt.

### Berichtigung (2026-07-29, nach der Abnahme `JR-13-09b` — F31)

**Der Satz „Diese Prüfung ist vollständig, weil sie das Verhalten misst statt die Datenform zu raten"
ist gestrichen. Er war selbst ein Abdeckungssatz** — derselbe, den diese ADR verbietet, nur über den
Verhaltenscheck statt über die Abfrage. Der Fehler liegt damit **in dieser ADR**, nicht in ihrer
Umsetzung: `JR-13-17` hat den Anspruch folgerichtig auf die Betreiberseite übernommen
(`access-control-changes.md:621–623`, `:498–500`, `:631–632`), und `JR-13-09b` hat ihn dort widerlegt.

**Wie er widerlegt ist.** Der vorgeschriebene Vergleich nennt **zwei** Zahlen (Zeilen der Archivliste,
Trefferzahl einer Suche). Dieselbe Seite benennt in Zeile 223–224 **drei** Oberflächen, für die die
Anwendung einen Zeilenfilter baut: Archiv lesen, Archiv suchen, **Ingestion-Quellen auflisten**. Eine
Rolle mit Archiv-Grants und nur einem Verbot auf der Ingestion-Seite — die Form, die Änderung 1 selbst
als typisch beschreibt — lässt beide Zahlen unverändert, während die Quellenliste fail-closed auf
`ingestionSourceId = "-1"` umschlägt. Die Seite lud ausdrücklich dazu ein, die **zutreffende** Meldung
von Query 2 daraufhin zu verwerfen („whatever the queries did or did not report about it"). Das ist der
gefährlichste mögliche Schluss, also genau der, den diese ADR verhindern soll.

**Was stattdessen gilt: kein Element dieser Seite bürgt für ein anderes.** Weder die Abfragen für den
Verhaltenscheck noch der Verhaltenscheck für die Abfragen. Jedes von beiden meldet, was es messen kann,
und **benennt die Oberflächen, die es messen kann**; „deckt den Rest ab" ist in **jeder** Richtung
unzulässig. Für den Verhaltenscheck kommt eine zweite Pflicht hinzu: er muss **alle** Oberflächen
nennen, für die die Anwendung einen Zeilenfilter baut — sonst misst er nicht einmal das, was er zu
messen behauptet.

**Die Lehre nach drei Ablehnungen derselben Klasse.** Streicht man den falsifizierbaren Anspruch nur an
einer Stelle, **wandert er** (Abfrage ⇒ Verhaltenscheck) statt zu verschwinden. Aufzugeben ist die
**Konstruktion** „ein Teil der Seite bürgt für den Rest", nicht der jeweilige Satz. Eine vierte
Ersatzbürgschaft ist damit ausgeschlossen.

**Was diese Berichtigung nicht ändert:** die Streichung der Abdeckungsansprüche der Abfrage und die
Knotenebene aus `JR-13-17` (a) bleiben richtig und sind in `JR-13-09b` unabhängig belegt (alle acht
F30-Formen gemeldet, keine Falsch-positiven). Umgesetzt wird die Berichtigung in **`JR-13-18`**.

---

## ADR-021 — Abnahmeeinheit ist die Scheibe, nicht das Epic

**Status:** entschieden (2026-07-30) · **Entscheider:** Auftraggeber · **Betrifft:** ADR-014, alle
offenen Epics E2–E12, die Rollen `senior-dev` und `tester`

Ein Epic wird **nicht** als Ganzes abgenommen. Die Abnahmeeinheit ist die **Scheibe**: ein Artefakt mit
**einer** Fehlerklasse, mit eigenen Kriterien, in **einer** Session abschließbar. Ein Epic ist danach nur
noch eine Klammer um mehrere Scheiben.

**Begründung — E13 wurde nicht von großen Tasks aufgehalten, sondern von einer monolithischen Abnahme.**
Die fünf Fix-Tasks liefen in einer Session durch (fünf Commits). Was Wochen kostete, waren **vier
Abnahmerunden** mit 21, 23, 18 und einer offenen Kriterienliste — und **alle drei Ablehnungen trafen
dasselbe Artefakt**, die betreibersichtbare Dokumentation:

| Runde       | Gebrochen an | Artefakt                 | Der Autorisierungscode |
| ----------- | ------------ | ------------------------ | ---------------------- |
| `JR-13-09`  | F27, F29     | Prüf-SQL + Betreibertext | hielt                  |
| `JR-13-09a` | F30          | Prüf-SQL + Betreibertext | hielt                  |
| `JR-13-09b` | F31          | Betreibertext            | hielt                  |

Der Code war nach Runde 1 unabhängig belegt und wurde danach **dreimal mitgeprüft, ohne je zu brechen**.
Wären Code und Betreiberdoku getrennte Scheiben gewesen, wäre die Codehälfte nach Runde 1 abgenommen und
zurückgemergt worden, und die drei Wiederholungen hätten ein Textartefakt betroffen statt ein Epic.

**Die Regeln:**

1. **Eine Scheibe = ein Artefakt + eine Fehlerklasse + eine Abnahme.** Produktionscode, Testharness,
   Migration und **betreibersichtbare Dokumentation** sind verschiedene Fehlerklassen und damit
   verschiedene Scheiben — auch wenn sie zum selben Befund gehören.
2. **Höchstens ~8 Abnahmekriterien je Scheibe.** Wer mehr braucht, hat zwei Scheiben.
3. **Was einmal unabhängig belegt ist, wird nicht neu geprüft.** Eine Wiederholungsabnahme prüft die
   Nacharbeit und die Kriterien, die sie berührt — nicht die ganze Liste. In E13 ab Runde 3 so gemacht,
   und es hat gehalten.
4. **Rückmerge je Scheibe**, sobald sie unabhängig lauffähig und abgenommen ist (präzisiert ADR-014,
   ersetzt es nicht). Eine noch offene Doku-Scheibe wird dann als Blocker für **E12** (Rollout) geführt,
   nicht als Blocker für den Merge des Codes. **`main` bleibt bis zur Abnahme von E12 unangetastet.**
5. **Eine Scheibe muss in einer Session abschließbar sein.** Das ist keine Stilfrage: in der Session vom
   2026-07-29 ist der Prüfer **mitten im Auftrag** an ein Session-Limit gelaufen. Bei einer Scheibe
   kostet das eine Scheibe, bei einem Epic-Monolithen die ganze Runde.

**Wann zerlegt wird:** wenn ein Epic **ansteht**, nicht vorab für alle. Elf Epics jetzt in Scheiben zu
planen wäre selbst der Monolith, den diese ADR abschafft — und Planung, die erst in Wochen gebraucht
wird, veraltet bis dahin. Entscheidung des Auftraggebers vom 2026-07-30: **nur das Prinzip
festschreiben**, `03-backlog.md` bleibt unverändert.

**Verworfen:** „Abnahme am Epic-Ende beibehalten, aber Kriterien kürzen." Das verkleinert die Liste, nicht
die Kopplung — eine gebrochene Doku-Zeile hätte weiter den Merge des Codes blockiert.

---

## ADR-022 — Ankerform: Merkle-Aggregat über alle Kettenköpfe

**Status:** **entschieden** (2026-07-31) · **Entscheider:** Auftraggeber · **Quelle:** RFC §5.5, §15 ·
**Folgt aus:** ADR-007 Konsequenz 4

Ein Ankerlauf holt **ein** RFC-3161-Token über die **Merkle-Wurzel** aller Kettenköpfe — nicht ein Token
je Mandant, und nicht ein Token über eine sortierte Liste der Köpfe.

**Begründung, zwei Gründe, und der zweite ist der tragende:**

1. **Kosten.** Ein Token je Mandant skaliert mit Mandanten × Frequenz: täglich × 50 Mandanten sind
   **18.250** Token im Jahr gegen **365** beim Aggregat. Bei einer qualifizierten TSA mit Token-Preis ist
   das der Unterschied zwischen vernachlässigbar und Budgetposten. Der Ausweg „Ankerfrequenz je Mandant
   senken" wäre, die Nachweislücke zu vergrößern, um Geld zu sparen.
2. **Der Inklusionsnachweis darf keine Fremddaten brauchen.** Bei einer sortierten Liste als gestempelter
   Eingabe muss ein Prüfer die **ganze Liste** rekonstruieren können, um zu zeigen, dass der Kopf von
   Mandant A enthalten war — inklusive `chain_scope_id`, `seq` und Kopf-Hash jedes anderen Mandanten,
   wobei `seq` das Nachrichtenvolumen verrät. Beim Merkle-Baum besteht der Nachweis aus A's Blatt,
   ~log₂(N) Geschwister-Hashes, der Wurzel und dem Token darüber. Geschwister-Hashes sind opak.

> **Das ist nicht die Merkle-Frage aus RFC §15.** Dort steht: _„Is a Merkle tree worth it over a linear
> chain for large deployments (faster partial verification)? Probably yes eventually, not for v1."_ Das
> fragt nach einem Baum **anstelle** der Kette, als Performance-Optimierung — und die Antwort bleibt
> „nicht für v1". Hier geht es um einen Baum **über** den Ketten, und er ist keine Optimierung, sondern
> die Bedingung dafür, dass ein Mandantenexport ohne Fremddaten prüfbar ist.

### Festlegungen

1. **Blätter decken _jede_ existierende Kette ab, nicht nur die seit dem letzten Anker veränderten.**
   Damit bezeugt der Anker auch die **Menge** der Ketten, und „die Kette von Mandant X ist verschwunden"
   wird durch Vergleich zweier aufeinanderfolgender Anker erkennbar — das ist ADR-007 Konsequenz 5. Nimmt
   man nur veränderte Köpfe auf, ist eine gelöschte Kette von einer ruhenden nicht zu unterscheiden, und
   der Befund verschwindet.
2. **Domain-separierte Hashes.** Blatt = `H(0x00 ‖ canonical(chain_scope_id, head_seq, head_chain_hash))`,
   innerer Knoten = `H(0x01 ‖ links ‖ rechts)`. Ohne die Präfixe ist die Baumstruktur ambig — ein Blatt
   ließe sich als innerer Knoten ausgeben und umgekehrt. Blätter werden **gehasht**, nicht im Klartext in
   den Baum gelegt: ein geleaktes Blatt verrät dann nichts.
3. **Deterministische Baumform.** Blätter nach `chain_scope_id` sortiert, und die Regel für den ungeraden
   Knoten (Hochziehen **oder** Duplizieren) explizit. Beides gehört in **ADR-006**, weil `verify` den Baum
   byteidentisch nachbauen muss; die Vorgabe steht dort.
4. **Das `anchor`-Event wird in _jede_ Kette geschrieben** und trägt die Wurzel, den Inklusionspfad
   **dieser** Kette und das Token beziehungsweise eine Referenz darauf. Damit ist ein Mandantenexport
   **selbsttragend**: die Kette enthält ihren eigenen Ankernachweis und ist ohne jede Fremddaten prüfbar.
   Das ist die Auszahlung des Entwurfs. Kosten: N Ledger-Zeilen je Lauf — Zeilen sind billig, Token nicht.
5. **Der geankerte Kopf ist der Kopf _vor_ dem `anchor`-Event.** Sonst entsteht eine Zirkularität: das
   Event verändert den Kopf, den es bezeugen soll. Steht hier, weil es beim Implementieren die
   naheliegende Falle ist.
6. **TSA-Ausfall trifft alle Mandanten gleich** — ein fehlender Anker statt N. **ADR-008 bleibt
   unverändert:** laut eskalieren, Ingestion **niemals** stoppen.
7. **RFC §5.5 Punkt 4 bleibt unberührt.** Mindestens ein externes, append-only Ziel, unabhängig von der
   TSA. Das Aggregat ändert nur, _was_ dorthin geht: Wurzel, Token und die Kettenkopf-Liste.

**Verworfen: ein Token je Kette.** Vertretbar bei 1–3 Mandanten, weil es ohne Baum-Mechanik in `verify`
auskommt. Nicht gewählt, weil der Baum wenig Code ist und die Umstellung sonst beim vierten Mandanten
fällig wird — dann aber mit Bestandsketten und Bestandsankern.

**Verworfen: sortierte Liste als Aggregat.** Siehe Grund 2. Sie war bis zum 2026-07-31 in ADR-007
Konsequenz 4 als gleichwertige Option genannt; das war ein Fehler und ist dort als solcher markiert.

## ADR-023 — TSA-Auswahl: kein Standard, und wofür `open-tsa.eu` taugt

**Status:** **entschieden** (2026-07-31) · **Entscheider:** Auftraggeber · **Quelle:** RFC §5.5 ·
**Berührt nicht:** ADR-008 (Ausfallverhalten)

**Ausgeliefert wird weiterhin _kein_ TSA-URL.** Das war schon Akzeptanzkriterium von `JR-8-01` und steht in
`02-architektur.md` §7; diese ADR bestätigt es und beantwortet die bis dahin offene Frage „welche TSA?":

| Klasse                                 | TSA                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| Produktion, deutsche/GoBD-Installation | **qualifizierte TSA unter eIDAS**, Betreiberentscheidung, kostenpflichtig                 |
| Produktion, ohne GoBD/eIDAS-Anspruch   | `open-tsa.eu` ist eine dokumentierte, kostenlose Option — mit den Auflagen unten          |
| Test `nightly`                         | `open-tsa.eu`, echter Endpunkt statt Mock                                                 |
| Test `ci`                              | **hermetisch** — lokaler Responder oder aufgezeichnetes Token, **nie** ein fremder Dienst |
| Test `manual`                          | die qualifizierte TSA des Betreibers                                                      |

### Was `open-tsa.eu` ist — am 2026-07-31 gemessen, nicht von der Seite übernommen

Ein Token wurde geholt und gegen die **gepinnten** CA-Zertifikate verifiziert; beide Gegenproben liefen:

```
HTTP 200 · Token 2513 Bytes · openssl ts -verify  ⇒  Verification: OK
Policy OID 1.3.6.1.4.1.59085.1.1 · Hash sha256 · Accuracy 1 s · Ordering: yes · Nonce zurückgegeben
verändertes Datum  ⇒ Verifikation schlägt fehl        (erwartet)
ohne gepinnte CA   ⇒ nicht verifizierbar              (Root ist nicht im Trust Store)
```

| Punkt                 | Befund                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Protokoll             | RFC 3161, `https://tsr.open-tsa.eu`, SHA-256/384/512 — passt unmittelbar auf `JR-8-01`             |
| Kosten / Lizenz       | kostenlos, Code MIT, spendenfinanziert (Ko-fi)                                                     |
| Betrieb               | **ein** Knoten, Nürnberg. Redundanz (Helsinki/Falkenstein, GeoDNS) laut Roadmap **Phase 3, 2028+** |
| Reife                 | live seit **April 2026**, ~5.161 Token ausgestellt                                                 |
| Vertrauensanker       | **eigene CA-Hierarchie, Root nicht in Trust Stores** — `ca.crt` muss gepinnt werden                |
| Zertifikatslaufzeiten | Signing-Cert **2 Jahre** (2026–2028), Intermediate 10, TSA-Root 15, Root 25                        |
| eIDAS                 | **kein Qualifikationsanspruch**, kein Trusted-List-Eintrag, keine SLA-Aussage                      |

**Daraus folgt: es ist kein qualifizierter Zeitstempel.** Damit gibt es keine Beweisvermutung für Datum
und Zeit nach eIDAS Art. 41, und die Forderung aus `02-architektur.md` §7 („für deutsche Installationen
soll es eine qualifizierte TSA unter eIDAS sein") ist damit nicht erfüllt. Der härteste Einzelbeleg ist
nicht das Fehlen einer Behauptung auf der Website, sondern die **Policy-OID im Token**:
`1.3.6.1.4.1.59085.1.1` ist eine private Enterprise-OID, keine ETSI-Policy für qualifizierte Zeitstempel.

### Wofür es trotzdem gewählt ist

1. **Echte TSA in der `nightly`-Klasse.** Der Testplan sah dort einen Mock vor, weil eine qualifizierte
   TSA Geld kostet und ratenbegrenzt ist. Ein kostenloser, echter RFC-3161-Endpunkt ersetzt den Mock durch
   das Original — ohne Kosten und ohne Betreiber-Credentials im Test.
2. **Dokumentierte Option** für Installationen ohne GoBD/eIDAS-Anspruch (NGO, Forschung, interne Archive),
   im Deployment-Guide mit den Auflagen aus der Tabelle im Fließtext.
3. **Optional als _zweiter_, unabhängiger Zeitstempel** neben einer qualifizierten TSA — zwei unabhängige
   Bezeugungen zum Preis von einer. `JR-8-01` muss dafür eine **Liste** von TSA-URLs akzeptieren, nicht
   einen Einzelwert.

**Ausdrücklich nicht in `ci`.** Ein CI-Lauf darf nicht von einem fremden, spendenfinanzierten Einzelknoten
abhängen: das erzeugt rote Läufe ohne eigenen Defekt — genau die Fehlerklasse, gegen die `JR-1-05c` das
Messinstrument gehärtet hat, und die schnellste Art, einen Wächter unglaubwürdig zu machen.

**Auflagen, die in die Betreiberdoku gehören:** `ca.crt` pinnen (der Root ist in keinem Trust Store); das
Token **mit seiner Zertifikatskette** archivieren, weil das Signing-Cert 2 Jahre lebt und die
Aufbewahrungsfrist 10 Jahre; und bei Verlass auf einen kostenlosen Einzelknoten das Ausfallverhalten aus
ADR-008 kennen — der Anker fehlt dann, die Annahme läuft weiter.

## ADR-024 — Betriebsmodell: eine Instanz je Endkunde

**Status:** **entschieden** (2026-08-02) — der Auftraggeber ist der Empfehlung des PO vom 2026-07-31
gefolgt und hat zugleich die Betriebsverantwortung entschieden (Abschnitt unten) ·
**Entscheider:** Auftraggeber · **Quelle:** ADR-006/ADR-007 (`deployment_id` im Genesis), RFC §15 ·
**Ersetzt nicht:** ADR-007 — diese ADR liegt eine Ebene darüber und widerspricht ihr nicht ·
**Gegen den E2-Stand nachgeprüft am 2026-08-01** (Kopf `79d80f1`): jede Zahl unten neu gemessen, zwei
korrigiert, ein Abschnitt durch den gemergten Kettencode überholt und neu gefasst, zwei Punkte
ergänzt (Klon-Split-Brain, F37)

**Entschieden: ein vollständig getrennter Stack je Endkunde.** Eigene App, Worker, `smtp-ingress`,
Postgres-Datenbank, Valkey, Meilisearch, Tika, Storage-Root, Schlüssel, Lizenz und eigene IP. Als
dokumentierte Dichteoption zulässig: ein **geteilter Postgres-Server** mit eigener Datenbank und
eigener Rolle je Kunde. **Nicht empfohlen:** ein geteilter Stack mit nachgerüsteter Tenant-Spalte.

### Warum das jetzt entschieden werden muss und nicht in E12

> **Dieser Abschnitt ist am 2026-08-01 neu gefasst.** Die erste Fassung argumentierte „muss vor dem
> Kettencode entschieden werden". Der Kettencode ist seit E2 gebaut, abgenommen (`JR-2-10a`) und
> zurückgemergt — das Argument ist überholt, die Dringlichkeit dadurch aber **größer**, nicht kleiner.

`chain_hash(0)` enthält die `deployment_id` (ADR-006, ADR-007 Konsequenz 3), und das ist seit E2 keine
Planung mehr, sondern Code: `deployment_identity` steht in
`packages/backend/src/database/schema/journal-ledger.ts`, ihr `id` ist per
`CHECK (id = 1)` auf **eine Zeile** gepinnt, die Zeile wird von der Migration `0041_even_scream.sql`
per `gen_random_uuid()` erzeugt, und `0042_journal_ledger_append_only.sql` schützt sie zusammen mit
`journal_ledger` gegen `UPDATE`/`DELETE`/`TRUNCATE`.

Daraus folgt der neue Zeitpunkt: **die nächste in Produktion angelegte Kette schreibt das
Betriebsmodell fest.** Ab dem ersten Genesis-Hash ist eine Änderung ein Migrationsvorgang über
bestehende Ketten und fällt unter das, was ADR-012 für Bestandsinstallationen noch offen hat.
Entschieden sein muss das also vor E3/E4 — dann nämlich entsteht der erste echte Empfang und mit ihm
die erste Kette. Solange kein Receiver läuft, ist es noch billig.

### Begriffsklärung: ein Endkunde ist nicht ein Mandant

**Das ist der Teil dieser ADR mit der größten Schutzwirkung**, unabhängig davon, wie der
Auftraggeber entscheidet. ADR-007 benutzt „Mandant" und meint damit `chain_scope_id` =
`ingestion_sources.id`, also ein **Archiv innerhalb einer Installation**. Wer „Mandant" als
„Endkunde" liest, zieht aus ADR-007 und ADR-022 falsche Schlüsse:

| Begriff               | Technisch                               | Ebene                           |
| --------------------- | --------------------------------------- | ------------------------------- |
| **Endkunde**          | eine Installation, eine `deployment_id` | ein Stack, ein Genesis-Präfix   |
| **Mandant** (ADR-007) | ein Archiv, `ingestion_sources.id`      | eine Kette innerhalb des Stacks |
| **Endpunkt**          | `journaling_sources.id`                 | Attribut in der Ledger-Zeile    |

Die Kostenrechnung „täglich × 50 Mandanten ⇒ 18.250 Token" in ADR-022 und R-15 meint deshalb **50
Archive einer Installation**, nicht 50 Kunden. Ein Kunde mit Tochtergesellschaften ist ein Kunde mit
mehreren Archiven — ADR-007 und ADR-022 bleiben dafür unverändert gültig.

### Der Ist-Zustand, am Code geprüft (2026-07-31, neu gemessen am 2026-08-01 gegen `79d80f1`)

Es gibt heute kein Mehrkundenkonzept, und der Bestand trägt auch keins. Nicht aus fehlender Doku
geschlossen, sondern am Schema gemessen. **Alle Zeilen sind nach dem E2-Merge neu gemessen; zwei
Zahlen waren falsch und sind korrigiert** — 41 → 43 Migrationen, und die `'emails'`-Literale sind
**13**, nicht 12 (die erste Fassung hatte Zeilen statt Vorkommen gezählt). Alles andere hält
unverändert:

| Stelle                                                                                  | Befund                                                                                                                     |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| alle Tabellen unter `schema/`, **43** Migrationen (Stand E2)                            | keine Spalte `tenant_id`/`organization_id`/`account_id` — auch nicht in `journal_ledger` und `deployment_identity` aus E2  |
| `schema/users.ts:10`, `:49`; `schema/compliance.ts:28`, `:79`; `schema/custodians.ts:6` | `users.email`, `roles.name`, `retention_policies.name`, `ediscovery_cases.name`, `custodians.email` sind global `unique()` |
| `services/SearchService.ts`, `services/IndexingService.ts`                              | ein einziger Index, Literal `'emails'` an **13** Stellen (10 + 3), kein Env-Var, kein Prefix                               |
| `services/IngestionService.ts:1056`, `:1199`; `config/storage.ts`                       | ein Storage-Root, ein `STORAGE_ENCRYPTION_KEY`, Pfade `open-archiver/<ingestionSourceId>/…`                                |
| `services/SettingsService.ts`                                                           | eine Zeile `system_settings`, `UPDATE` ohne `WHERE`                                                                        |
| `docker-compose.yml:6`, `:23`, `:36`, `:46`, `:58`                                      | feste `container_name` für alle fünf Dienste — zwei Stacks auf einem Host kollidieren beim Start                           |
| `services/FilterBuilder.ts`                                                             | Isolation entsteht **allein** aus CASL-Policy-Bedingungen; genau diese Schicht war in 0.5.2 fail-open (F7)                 |

Zwei global eindeutige Spalten allein schließen den geteilten Stack schon aus: zwei Kunden könnten
nicht beide ein `admin@…` oder eine Richtlinie „Standard 10 Jahre" führen.

### Begründung

1. **Die Journaling-Architektur setzt es voraus.** Eine Installation = eine `deployment_id` = eine
   Identität im Genesis. Siehe oben; nicht nachträglich korrigierbar.
2. **Der SMTP-Empfang erzwingt es praktisch.** Journaling braucht MX und eingehend TCP 25 je Kunde.
   Port 25 hat **vor** dem STARTTLS-Handshake kein SNI, also kein Routing nach Hostname. Eine
   gemeinsame IP für N Instanzen bräuchte einen Proxy, der nach `RCPT TO` verteilt — der stünde
   **vor** dem Acceptance-Contract, dürfte kein `250 OK` senden, bevor das Backend gefsynct hat, und
   müsste damit Spool und Ledger aus E3 verdoppeln. Das verletzt den ersten nicht verhandelbaren
   Punkt oder dupliziert ein ganzes Epic. Eine eigene IP je Instanz umgeht beides. Nebeneffekt:
   getrennte IP-Reputation, relevant nach R-07 und R-08.
3. **Schadensradius und Prüfbarkeit.** Kettenbruch, verunglückte Migration, Löschung nach Art. 17
   DSGVO und ein Prüferexport wirken auf genau einen Kunden. Ein Kettenauszug **kann** fremde
   Absender, Empfänger und Volumina nicht enthalten, weil sie nicht existieren — das ist stärker als
   die Filterung, die ADR-022 dafür baut. Pro Kunde werden außerdem ein eigener
   `STORAGE_ENCRYPTION_KEY`, eine eigene TSA-Klasse nach ADR-023 und eigene Aufbewahrungsfristen
   möglich; heute sind das alles instanzweite Env-Vars.
4. **Isolation strukturell statt policy-abhängig.** F7 hat gezeigt, dass die Policy-Schicht
   fail-open sein kann, und zwar in einer veröffentlichten Version. „Die Kundentrennung hält,
   solange niemand eine Rolle ohne Bedingung anlegt" ist gegenüber dem Prüfer eines
   Wirtschaftsprüfers nicht vertretbar. Nach ADR-020 dürfte die Betreiberdoku eine solche Trennung
   ohnehin nur **berichten**, nicht garantieren — bei getrennten Stacks ist die Aussage trivial
   wahr.

    > **E2 hat dieser Begründung am 2026-07-31 einen zweiten Beleg geliefert: F37.** Der
    > Append-Only-Trigger aus `JR-2-05` ist von einer Rolle, die die Tabellen **besitzt**, in zwei
    > Anweisungen abschaltbar — und in einer Standardinstallation ist `POSTGRES_USER` Superuser und
    > Eigentümer, `DATABASE_URL` benutzt genau diese Rolle (`02-architektur.md` §1). Der Rechteentzug
    > ist in ADR-009 festgeschrieben und **E11** zugeordnet, also noch offen. Solange er offen ist,
    > gilt: in einem geteilten Stack erreicht eine kompromittierte Anwendung die Ledger **aller**
    > Kunden, bei getrennten Stacks einen. F37 ist E2s Befund, nicht meiner — hier nur zitiert.

### Klonen ist die Falle bei der Provisionierung — ergänzt am 2026-08-01

**Diese Gefahr trifft ausgerechnet das empfohlene Modell**, und sie ist erst mit E2 sichtbar
geworden, weil `deployment_identity` jetzt existiert. Der Schemakommentar in
`schema/journal-ledger.ts` sagt es selbst:

> _„A restore from backup keeps this value — a restore is the same installation. Two installations
> running in parallel with the same `deployment_id` is a split brain, which is **not preventable**
> (a restore and a clone are byte-identical) and is therefore detected rather than blocked."_

Der naheliegende Weg, viele Kundeninstanzen aufzusetzen, ist ein Golden Image. Wird es **nach** dem
Migrationslauf erzeugt, trägt es die von `0041_even_scream.sql` gezogene `deployment_id` — und jeder
daraus geklonte Kunde bekommt **dieselbe**. Damit teilen fremde Kunden das Genesis-Präfix, und die
Anlage ist ein Split Brain zwischen Mandanten, den `verify` als Manipulationsbefund melden wird,
obwohl es ein Provisionierungsfehler war. `JR-2-09` prüft den Fall bereits als Fall (h) mit eigener
Befundart („a clone produces two valid chains from one genesis"), und ADR-006 §4.3 sowie
`JR-8-02`/`JR-8-03` behandeln die Erkennung.

**Regel, die daraus folgt:** die Migration läuft je Instanz **frisch**; ein Post-Migrations-Volume
oder -Image wird nie geklont. Golden Images sind erlaubt, aber nur **vor** `pnpm db:migrate` — und
`docker/docker-entrypoint.sh` fährt die Migration beim Start, was den sauberen Weg zum Standardweg
macht, sofern man kein Datenverzeichnis mitkopiert. Steht als Konsequenz 2 unten.

### Was es kostet — nach ADR-020 benannt, nicht beschönigt

- **RAM:** laut `docs/user-guides/installation.md` 4 GB je Instanz, 2 GB mit externem
  Postgres/Redis/Meilisearch. `smtp-ingress` und das Spool-Volume kommen hinzu (`JR-12-03`).
- **Betrieb × N:** `docker/docker-entrypoint.sh` fährt `pnpm db:migrate` beim Start, also N
  Migrationen je Upgrade. Zugleich der Vorteil: ein Kunde lässt sich als Canary hochziehen, statt
  alle gleichzeitig zu riskieren.
- **N Lizenzschlüssel** (`OA_LICENSE_KEY` gilt je Installation), N Backups, N `verify`-Läufe (E9), N
  Monitoring-Ziele (E10), N TSA-Zugänge (E8).
- **Provisionierung existiert nicht:** kein Helm-Chart, keine k8s-Manifeste, und die festen
  `container_name` müssen weg. Das steht in keinem Epic.

### Die Dichteoption und ihre Bedingungen

Zulässig ist ein **geteilter Postgres-Server** mit eigener Datenbank und eigener Rolle je Kunde. Das
funktioniert heute ohne Codeänderung, und die Rollentrennung fordert `02-architektur.md` §1 für die
vier Prozessrollen ohnehin. Ein geteilter Tika ist vertretbar, sieht aber den Klartext aller Kunden.

**Nicht geteilt werden dürfen Meilisearch und Valkey**, und der Grund ist in beiden Fällen, dass es
**leise** scheitert:

- **Meilisearch:** beide Instanzen schreiben in den Index `'emails'`. Kein Fehler, keine Warnung —
  nur kundenübergreifende Suchtreffer. Das ist der gefährlichste Fehlermodus im ganzen Bild.
- **Valkey:** die Queue-Namen sind global (`jobs/queues.ts:19`, `:24`, `:30`) und
  `config/redis.ts` bietet weder einen `db`-Index noch einen `keyPrefix`. Zwei Instanzen an einer
  Valkey ziehen sich gegenseitig die Jobs.

Wer die Dichteoption fahren will, braucht deshalb vorher `MEILI_INDEX_PREFIX` und einen
Redis-`keyPrefix` (Tasks unten). **Und einen Blick auf `config/redis.ts`:** bei
`REDIS_TLS_ENABLED=true` wird `rejectUnauthorized: false` gesetzt — für eine Valkey über eine
Netzgrenze ist das TLS ohne Zertifikatsprüfung. Nicht Teil dieser ADR, aber Bedingung für jede
geteilte Infrastruktur.

### Verworfen: geteilter Stack mit nachgerüsteter Tenant-Spalte

Er berührt jede Tabelle, alle fünf globalen Uniques, die Storage-Pfade, den Meili-Index, die
Import-Zeit-Config (`CLAUDE.md` §5.6) und `system_settings`. `chain_scope_id` kann das **nicht**
auffangen: es ist an `ingestion_sources.id` gebunden und steckt im Genesis-Hash. Entscheidend ist
aber nicht der Aufwand, sondern dass dieses Modell die Kundentrennung genau von der Schicht abhängig
macht, die in 0.5.2 fail-open war. Bleibt Rückfalloption, falls der Ressourcenbedarf des empfohlenen
Modells sich als untragbar erweist — dann braucht es eine neue ADR, die diese hier ersetzt.

### Betriebsverantwortung: zwei Phasen — entschieden am 2026-08-02

**Phase 1: der Endkunde betreibt seine Instanz selbst.** **Phase 2, später: der Auftraggeber bietet
den Betrieb zusätzlich als Dienst an, für Kunden, die das wünschen.** Beide Phasen bestehen dann
nebeneinander — Phase 2 ersetzt Phase 1 nicht.

#### Die AGPL-Folge ist in **beiden** Phasen eine Quelltextpflicht, nur gegenüber verschiedenen Leuten

Das ist der Punkt, an dem man sich am leichtesten verrechnet, deshalb steht er zuerst:

| Phase | Vorgang                                                 | Greift     | Wem geschuldet                              |
| ----- | ------------------------------------------------------- | ---------- | ------------------------------------------- |
| 1     | Software wird an den Kunden übergeben (_conveying_)     | AGPL §4–§6 | dem Kunden als Empfänger                    |
| 2     | Der Auftraggeber betreibt, Nutzer greifen übers Netz zu | AGPL §13   | den Nutzern der von ihm betriebenen Instanz |

**Phase 1 befreit also nicht von der Pflicht, sie verschiebt nur den Paragrafen.** Wer die Software
weitergibt, schuldet dem Empfänger den Corresponding Source — dafür braucht es §13 gar nicht.

**Erfüllt wird beides von genau einem Artefakt:** dem Quelltext-Angebot in der UI (Version, Commit,
Link auf Repository oder Tarball), das ADR-025 als E12-Task vorsieht. Einmal gebaut, deckt es beide
Phasen. Phase 2 erzeugt dafür **keinen** zusätzlichen Aufwand — nur einen anderen Adressaten.

> Feststellung, keine Rechtsberatung — wie schon in der ersten Fassung dieses Abschnitts.

#### Was Phase 1 für die Doku heißt

**„Der Betreiber" ist der Kunde.** Aufbewahrungsfristen, Object-Lock-Modus, TSA-Auswahl,
Schlüsselverwaltung, Monitoring-Ziele und die schriftliche Verfahrensdokumentation entscheidet und
verantwortet **er**. `JR-12-04` verlangt den Deployment-Guide ohnehin so — „von einem Betreiber ohne
Codekenntnis befolgbar" —, und das ist damit keine Stilfrage mehr, sondern die Zielgruppe. Der Guide
muss den Kunden **befähigen**, nicht informieren: R-02 (Object Lock COMPLIANCE ist irreversibel) trifft
dann ihn, und er muss die Frist bewusst wählen können, bevor sie unumkehrbar wird.

#### Was Phase 2 verschärft, und zwar messbar

**R-18 wird vom Einzelfall zum Systemrisiko.** Betreibt der Auftraggeber N Kundeninstanzen selbst, ist
ein Golden Image der naheliegende Weg — und ein Image, das **nach** dem Migrationslauf entsteht,
trägt die von `0041_even_scream.sql` gezogene `deployment_id`, sodass **fremde Kunden dasselbe
Genesis-Präfix teilen**. `verify` meldet das als Manipulationsbefund, obwohl es ein
Provisionierungsfehler war, womöglich erst Monate später bei der ersten Prüfung. Solange der Kunde
selbst installiert, ist das sein Einzelfall; als Dienst ist es ein Fehler, der **alle** Instanzen auf
einmal trifft. Konsequenz 2 unten wird damit von einer Empfehlung zu einer **Betriebsvorschrift**.

**Offen, und bewusst nicht hier entschieden: das Haftungsprofil.** Als Dienstanbieter betreibt der
Auftraggeber Compliance-Infrastruktur für Dritte — mit Verfügbarkeitszusagen, Wiederanlaufzeiten,
Aufbewahrung fremder Daten und der Frage, wer im Prüfungsfall gegenüber der Behörde Auskunft gibt.
Das ist keine Architekturfrage. Es steht hier, damit es beim Übergang zu Phase 2 nicht zwischen zwei
Epics verschwindet.

### Konsequenzen der Entscheidung

**Die Entscheidung ist seit dem 2026-08-02 da; die Tasks entstehen trotzdem erst, wenn E12 ansteht** —
nach ADR-021 bleibt `03-backlog.md` unverändert, bis das Epic dran ist, und die Taskzahl in
`06-status.md` wird gemeinsam mit ihnen fortgeschrieben. Bis dahin ist diese Liste die Vorlage:

1. `docker-compose.yml` ohne feste `container_name`, damit mehrere Stacks auf einem Host koexistieren
   (berührt `JR-12-03`).
2. Provisionierungs- und Stilllegungs-Checkliste je Instanz: Schlüssel, Lizenz, MX, IP, Bucket,
   TSA-Zugang, Monitoring-Ziel, Backup — und was beim Kundenabgang wie zu übergeben ist. **Zwei
   Punkte daraus sind seit E2 nicht mehr optional:**
    - **Die Migration läuft je Instanz frisch, ein Post-Migrations-Image wird nie geklont** — sonst
      teilen fremde Kunden eine `deployment_id` (Abschnitt „Klonen ist die Falle" oben).
    - **Stilllegung ist ein Verfahren, kein `DELETE`.** `journalLedger.chainScopeId` trägt
      `onDelete: 'restrict'`, ein Archiv mit Ledger-Zeilen lässt sich also nicht löschen — laut
      Schemakommentar ausdrücklich Absicht und nach E12 zu verfahren.
3. `MEILI_INDEX_PREFIX` in `config/search.ts` und die **13** `'emails'`-Literale gegen eine Konstante.
   Auch im empfohlenen Modell sinnvoll, als Schutz gegen versehentlich geteilte Infrastruktur.
4. Redis-`keyPrefix` bzw. `db`-Index in `config/redis.ts`, gleicher Grund.
5. `JR-12-04` (Deployment-Guide) nimmt das Betriebsmodell auf: eine IP je Instanz, MX je Kunde, und
   warum kein gemeinsamer Port-25-Proxy davor steht.
6. E9/E10 rechnen weiterhin je Kette; das Betriebsmodell ändert daran nichts, halbiert aber die
   Zahl der Ketten je `verify`-Lauf.

## ADR-025 — Fork weiterführen statt eigenständige Anwendung neu bauen

**Status:** **entschieden** (2026-08-01) · **Entscheider:** Auftraggeber · **Betrifft:** die
Projektfrage „lohnt sich das noch" · **Ersetzt nichts** — ADR-002 (Code-Ablage) und ADR-024
(Betriebsmodell) bleiben unverändert gültig, ADR-025 begründet, warum sie Bestand haben

**Der Fork wird weitergeführt. Es wird keine eigenständige Anwendung neu gebaut.** Die
Pull-Ingestionswege (Graph, IMAP, PST, Mbox, ZIP) bleiben erhalten, werden aber mit sichtbarer
Herkunft geführt und aus dem Compliance-Pfad genommen.

### Anlass

Der Auftraggeber fand im Upstream-Branch `ee-1.5.1-dev` Hinweise auf eine kostenpflichtige
Enterprise-Lizenz für Journaling und Aufbewahrungsfristen und stellte zwei Fragen: ob eine schlanke
Eigenentwicklung ohne Pull-Wege sinnvoller wäre, und ob die Quellcodelizenz nach §12/§13
Netzwerk-Deployments für Endkunden verbiete. Beide Annahmen wurden am 2026-08-01 gegen `e808898`
geprüft.

### Befund 1 — die Lizenzannahme trifft nicht zu

`LICENSE` ist in diesem Fork **und** in `ee-1.5.1-dev` der unveränderte FSF-Text der AGPL-3.0, 650
Zeilen.

| Stelle            | Was dort steht                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `LICENSE:517` §12 | „No Surrender of Others' Freedom" — widersprüchliche Auflagen Dritter (Gerichtsbeschluss, Vertrag, Patent-Royalty). Nichts zu Netzwerkbetrieb |
| `LICENSE:529` §13 | „Remote Network Interaction" — wer eine **modifizierte** Version betreibt, **muss** den Nutzern den Corresponding Source **anbieten**         |

§13 ist eine **Herausgabepflicht, kein Betriebsverbot**. Das ist keine neue Erkenntnis dieser ADR:
ADR-024 hält es im Abschnitt „Betriebsverantwortung und AGPL §13" bereits richtig fest. ADR-025
schreibt es nur an die Stelle, an der die Frage gestellt wurde.

Restriktiv lizenziert ist allein `packages/enterprise` / `apps/open-archiver-enterprise` von
LogicLabs. **Diese Pakete sind in keinem öffentlichen Branch enthalten — auch nicht in
`ee-1.5.1-dev`** (Tree-Abfrage der GitHub-API auf diesem Ref: nur `docs/enterprise/**`,
Frontend-Gates, Schema, Types). Sie waren nie Teil dieses Forks und werden nicht benutzt. Der Code
dieses Projekts steht vollständig auf AGPL-Boden.

> Feststellung, keine Rechtsberatung — wie ADR-024 an gleicher Stelle.

### Befund 2 — was in `ee-1.5.1-dev` tatsächlich passiert

Stand 2026-08-01, gemessen über `git ls-remote` und die GitHub-API:

- Der Branch ist aktiv; jüngste Commits 2026-07-28 und 2026-07-29.
- `ee-feat(license): enforce the license verdict from the database` — Lizenzdurchsetzung.
- `ee-v1.5.2-dev: retry failed journal emails and quarantine the raw message`.
- Phone-Home-Lizenzserver seit v0.4.3 (`LicensePingRequest`/`LicensePingResponse`), Route
  `packages/frontend/src/routes/dashboard/admin/license/`.
- `package.json` steht dort weiterhin auf `"version": "0.5.2"` — „1.5.1" ist die EE-Zählung, nicht
  die OSS-Version.

Die Annahme „wird kostenpflichtig" **stimmt**. Sie ist aber der Ausgangsbefund aus E0 (siehe
`06-status.md`, Zentrale Befunde 1 und 2) und damit keine neue Lage, sondern der Grund, warum dieses
Projekt existiert.

Der zweite Commit bestätigt E0-Befund 2 eher, als dass er ihn entkräftet: „retry failed journal
emails and quarantine" repariert **nachgelagert**, was ein Acceptance-Contract **vorne** verhindert.
Der dort dokumentierte Ablauf ist Tempfile + BullMQ-Enqueue, dann `250`; das erfüllt RFC §3 nicht.
Das kostenpflichtige Feature ist deshalb nicht dasselbe Produkt: es leistet „Journaling-Empfang",
dieses Projekt baut „Empfang mit einlösbarer Annahmezusage".

### Befund 3 — was ein Neubau kostet, gemessen statt geschätzt

| Baustein                | Umfang                     | Beim Neubau                                         |
| ----------------------- | -------------------------- | --------------------------------------------------- |
| `packages/journaling`   | 2.018 Zeilen               | wandert 1:1 mit — einzige Abhängigkeit ist `types`  |
| `packages/types`        | 1.622 Zeilen               | wandert weitgehend mit (MIT)                        |
| `packages/backend/src`  | 117 Dateien, 16.348 Zeilen | **nachzubauen**                                     |
| `packages/frontend/src` | 226 Dateien, 17.842 Zeilen | **nachzubauen**, inkl. 11 Sprachen × 2 i18n-Systeme |
| Migrationen             | 43                         | **neu zu schneiden**                                |

Zwei Punkte tragen die Entscheidung:

1. **Der Empfangspfad ist bereits entkoppelt.** `JR-4-01` fordert für `apps/smtp-ingress` als
   Akzeptanzkriterium: importiert **kein** `packages/backend/src/config/*` und **kein**
   `src/database/index.ts`. `packages/journaling` importiert heute ausschließlich `node:crypto`,
   `@open-archiver/types` und relative Pfade. Ein Neubau spart hier **nichts**, weil ADR-002 die
   Trennung bereits erzwingt.
2. **Die Pull-Connectoren sind ein Schalter, kein Fundament.** `JR-12-01` (Feature-Flag,
   standardmäßig aus), `JR-12-02` (Dedupe, journalisierte Kopie gewinnt) und `JR-12-07`
   (Umdokumentation auf Backfill/Reconciliation) stehen im Backlog. Was der Neubau einsparen soll,
   ist als Konfigurationsentscheidung längst geplant.

Ein Neubau würfe also rund 34.000 Zeilen weg — Storage mit S3 und Verschlüsselung, Meili-Suche,
CASL-IAM, `FilterBuilder`, Audit-Log, Retention-Lifecycle-Worker, Tika-Extraktion, Dashboard,
eDiscovery, Export — um eine Funktion loszuwerden, die ein Flag ist. Genau diese 34.000 Zeilen sind
das, was ein Prüfer benutzt: suchen, exportieren, Zugriff nachweisen, Aufbewahrung steuern.

### Befund 4 — wo der Einwand trägt und wo er zu weit geht

**Trägt:** Pull-Ingestion garantiert keine **Vollständigkeit**. Was zwischen zwei Syncs gelöscht
wird, kommt nie an. Das ist ein Vollständigkeits-, kein Unveränderbarkeitsproblem — Letzteres decken
die Hashes über Klartext-Bytes (`archived_emails.storage_hash_sha256`) bereits ab. Daraus folgt
„Journaling ist die maßgebliche Quelle", und genau so steht es in `JR-12-02`.

**Geht zu weit:** „nicht rechtskonform" als Pauschalurteil über die Importwege. Journaling erfasst
erst ab Einschaltdatum; für den Altbestand ist ein Erstimport (PST/Mbox/IMAP) zulässig und praktisch
unverzichtbar. Ein Produkt ohne Importweg kann keinen Bestand übernehmen — ein Verkaufshindernis
ohne Compliance-Gewinn. Der richtige Schnitt ist nicht „entfernen", sondern „aus dem Compliance-Pfad
nehmen und als Altdatenübernahme kennzeichnen".

### Befund 5 — das eigentliche Risiko ist die Fork-Divergenz

Dieser Fork steht auf 0.5.2; Upstream hat 0.5.2 am 2026-07-25 released und entwickelt im EE-Branch
weiter. Jeder `main`-Merge in den Integrationsbranch wird teurer. **Das** ist der Kostenpunkt, der
die Frage „lohnt es sich" trägt — nicht die Lizenz und nicht der Funktionsumfang. Er wurde bisher
nicht gemessen und ist als **R-19** aufgenommen.

### Konsequenzen

1. **Die Abhängigkeitsregel wird von einer Paketregel zur Ausstiegsoption.** `02-architektur.md` §2
   und `.claude/agents/senior-dev.md` halten ab sofort auch die **Richtung** fest: Journaling-Logik
   gehört nach `packages/journaling` / `apps/smtp-ingress`, der Bestand darf sie benutzen, nie
   umgekehrt. Damit bleibt „eigenständige Anwendung" jederzeit eine **Verpackungsentscheidung**
   statt einer Neuentwicklung. Das ist die eigentliche Absicherung gegen die Frage, die diese ADR
   ausgelöst hat — und der Grund, warum sie ohne Reue verneint werden kann.
2. **Fork-Divergenz wird gemessen.** `08-risiken.md` R-19 und eine Merge-Historie in `06-status.md`:
   je Upstream-Merge Datum, Version, Konfliktdateien, Aufwand. Übersteigt der Aufwand je Release den
   Nutzen, ist **das** der belegte Zeitpunkt für eine ersetzende ADR — nicht ein Gefühl.
3. **E3 bleibt der nächste Schritt.** Nichts an dieser ADR ändert die Reihenfolge.

### Erst bei Erreichen des Epics anzulegende Tasks

Nach ADR-021 bleibt `03-backlog.md` unverändert, bis das Epic ansteht; die Taskzahl in `06-status.md`
wird gemeinsam mit ihnen fortgeschrieben. Beide Nummern sind beim Anlegen gegen den Bestand zu
prüfen — **`JR-12-06` ist bereits vergeben** (RFC-§13-Nicht-Behauptung im README) und darf dafür
nicht wiederverwendet werden:

1. **In E11** (nächste freie Nummer, derzeit `JR-11-11`): Herkunft `journaled` vs. `imported` im
   **Prüfbericht und im Export-Manifest** ausweisen, damit die Vollständigkeitszusage genau auf den
   journalisierten Zeitraum bezogen werden kann. Baut auf `JR-11-04` (Manifest) auf. **Zuerst zu
   prüfen, ob eine neue Spalte nötig ist oder ein Join genügt** — die Herkunft hängt bereits an
   `ingestion_sources` bzw. `journaling_sources`.
2. **In E12** (nächste freie Nummer, derzeit `JR-12-10`): Quelltext-Angebot nach AGPL §13 in der UI —
   Version, Commit und Link auf das Repository oder einen Tarball-Endpoint —, plus ein Absatz im
   Betreiberleitfaden. Neue Strings fallen unter den Skill `oa-i18n` (11 Sprachen × 2 Systeme).
   Berührt `JR-11-08` (Build-Identität zeigt Commit und Image-Digest bereits an drei Stellen) und ist
   die operative Einlösung des in ADR-024 festgehaltenen §13-Punktes, **soweit der Auftraggeber
   selbst betreibt**. Wer betreibt, entscheidet ADR-024 — dort weiterhin **offen**.

## ADR-026 — Task-IDs schreiben sich `JR-<Epic>-<NN>`

> **Diese ADR hieß bis zum 2026-08-04 „ADR-029" — dieselbe Nummer wie die SMTP-ADR unten.** Die
> Doppelvergabe fiel beim Schreiben von ADR-029s Go-Nachtrag auf; der Auftraggeber hat die
> Umnummerierung entschieden. **Umnummeriert wurde diese**, nicht die SMTP-ADR: Die trägt 40
> Referenzen quer durchs Repo, darunter Produktivcode (`smtp-server.ts`), zwei Testdateien und
> `suite-inventory.ts`, und ihre beiden **Auflagen** (`JR-4-14`, `JR-4-15`) werden unter der Nummer
> zitiert. Diese hier hatte fünf Referenzen. **Die Nummer ist bewusst 029 und nicht eine Lücke
> davor** — 001 bis 028 sind vergeben, und eine ADR-Nummer ist ein Identifikator, kein Datum. Dass
> 029 damit älter ist als 027 und 028, ist der Preis dafür, keine bestehende Nummer zu recyceln.

**Status:** **entschieden** (2026-08-01, umnummeriert 2026-08-04) · **Entscheider:** Auftraggeber ·
**Betrifft:** `03-backlog.md` und jedes Dokument, jeden Kommentar und jeden Suite-Namen, der eine
Task-ID nennt

Task-IDs tragen ab sofort einen Bindestrich zwischen Epic und laufender Nummer:
**`JR-<Epic>-<NN>`**. Die laufende Nummer bleibt zweistellig, ein Nacharbeits-Suffix hängt als
Kleinbuchstabe direkt an. `JR-101` → `JR-1-01`, `JR-1309b` → `JR-13-09b`.

### Warum

Ohne Trennzeichen war die alte Schreibweise nicht eindeutig lesbar: `JR-1101` konnte „Epic 1,
Task 101" oder „Epic 11, Task 01" heißen. Aufgelöst wurde das bisher nur dadurch, dass **niemand**
Epic 1 über Task 06 hinaus nummeriert hat — eine Konvention, die nirgends stand und beim ersten
zweistelligen Task in E1…E9 gebrochen wäre. Mit E10 bis E13 im Backlog war die Kollision keine
theoretische mehr.

**Es ist ausdrücklich keine Neuvergabe.** Epic, laufende Nummer und Suffix bleiben je Task
unverändert; nur die Schreibweise ändert sich. Der Satz „Task-IDs werden nie neu vergeben" in
`03-backlog.md` gilt weiter.

### Umsetzung, am 2026-08-01

Mechanisch über alle nachverfolgten Dateien mit den Endungen `.md`, `.ts`, `.json`, `.mjs`, `.yml`,
`.svelte`. Abbildung deterministisch: **dreistellig ⇒ die erste Ziffer ist das Epic** (E1…E9),
**vierstellig ⇒ die ersten beiden** (E10…E13). Eine Mapping-Tabelle ist nicht nötig, weil die Regel
die Abbildung vollständig bestimmt und umkehrbar ist.

- **1778 Vorkommen in 75 Dateien** umgestellt, **130 verschiedene IDs**.
- Auch die abgeschlossenen Protokoll- und Abnahmeeinträge, einschließlich `11-archiv-e1.md` —
  Entscheidung des Auftraggebers. Zwei Schreibweisen nebeneinander hätten genau die
  Verwechslungsgefahr erhalten, die diese ADR abstellt. Wer die alte Schreibweise sucht, findet sie
  in der Git-Historie vor diesem Commit.
- Führungsnullen am Epic (`JR-01-01`) wurden erwogen und **verworfen** — der Auftraggeber hat die
  kürzere Form gewählt.

### Die eine Stelle, die nicht mitgezogen wurde

`packages/backend/src/database/migrations/0042_journal_ledger_append_only.sql:28` erzeugt die
Fehlermeldung des Append-Only-Triggers im Wortlaut
`… the journal ledger is append-only (JR-205, ADR-009).`, und
`tests/integration/journal-ledger-append-only.int.test.ts:171` prüft sie mit
`toMatch(/JR-205, ADR-009/)`. Beide bleiben in der **alten** Schreibweise stehen, ebenso der
Kopfkommentar von `0041_even_scream.sql` (`JR-204`).

**Grund:** Das sind **angewandte Migrationen**. `CLAUDE.md` §5.2 verbietet, sie zu ändern; eine
Textänderung an der Trigger-Meldung wäre eine neue Migration, die die `plpgsql`-Funktion neu
definiert — also ein Eingriff in die Manipulationssicherung für einen kosmetischen Gewinn. Der
Aufwand-Risiko-Schnitt geht klar dagegen aus.

Alle **anderen** Vorkommen in derselben Testdatei (Dateikopf, Suite-Name, Abdeckungshinweis) sind
umgestellt; nur die Zeile, die den Laufzeittext der Datenbank spiegelt, ist eingefroren. Wer den
Trigger irgendwann aus einem anderen Grund neu schreibt, zieht die Schreibweise dabei mit.

### Ebenfalls bewusst unverändert

Zwei historische Abnahmezeilen in `06-status.md` nennen die **Suchmuster**, mit denen damals geprüft
wurde (`kein JR-1xxx`, `grep -nE "JR-[0-9]{3,4}|…"`). Sie protokollieren einen ausgeführten Befehl
und wären umgeschrieben schlicht falsch. Für künftige Prüfungen — etwa „keine internen IDs in der
öffentlichen Doku" in `JR-12-09` — lautet das Muster jetzt:

```
grep -nE "JR-[0-9]{1,2}-[0-9]{2}[a-z]?|ADR-[0-9]{3}|\bF[0-9]{1,2}\b"
```

### Belegt

Voller Lauf nach der Umstellung unverändert: **398 passed | 2 skipped** bei 30 Dateien,
`unit 288/288 · integration 92/92 · adversarial 18/18`. Suite-Namen enthalten IDs (etwa
`[ci] ledger appends under concurrency (JR-2-08)`), das Inventar aus `JR-1-05c` zählt aber Tests je
Suite und Klasse und nicht deren Namen — die Umbenennung geht daran vorbei. Dazu `tsc` und
`tsc -p tsconfig.test.json` je Exit 0, `svelte-check` 0 Fehler / 0 Warnungen, Prettier sauber über
alle 75 Dateien.

## ADR-027 — `mailparser` als MIME-Leser in `packages/journaling`

**Status:** **entschieden** (2026-08-02) · **Entscheider:** Auftraggeber · **Betrifft:** E5, und
jede spätere Stelle in `packages/journaling`, die MIME liest

Der Journal-Report-Parser aus E5 zerlegt MIME mit **`mailparser` ^3.7.4** — derselben Version, die
`packages/backend` seit Langem für die Pull-Ingestion nutzt. `packages/journaling` bekommt damit die
erste Fremdabhängigkeit außer `zod`.

### Warum das die Architekturregel nicht bricht

`CLAUDE.md` §2 fasst `packages/journaling` als „depends on `types` **only**" zusammen. Das ist die
Kurzfassung; die Regel selbst steht in **ADR-002** und lautet anders: das Paket darf **nicht von
`packages/backend` abhängen**, und **Konfiguration und DB-Verbindung werden injiziert**. Verboten ist
also die Kopplung an den Monolithen und an seine Umgebung — nicht jede Bibliothek. `zod` steht seit
`JR-3-01` als Präzedenzfall in denselben `dependencies`.

`mailparser` ist eine reine Bibliothek: kein Prozess, kein Netz, keine Umgebungsvariable, keine
Datenbank. Sie berührt keine der Eigenschaften, die ADR-002 schützt.

### Warum dieselbe Bibliothek wie das Backend, und nicht eine kleinere

Das ist der eigentliche Grund, und er ist inhaltlich, nicht bequem: **dieselbe Nachricht kann über
beide Wege ins Archiv kommen** — per IMAP-Pull und per Journal-Report —, und `JR-12-02` verlangt
ausdrücklich, dass daraus **ein** Archiveintrag wird. Zwei verschiedene MIME-Implementierungen im
selben Repository würden für dieselben Bytes unterschiedliche Header-Interpretationen liefern können:
andere Entfaltung gefalteter Header, andere Behandlung von RFC-2231-Parametern, andere
Zeichensatz-Erkennung. Der Unterschied wäre nicht theoretisch sichtbar, sondern als Metadaten-Drift
zwischen zwei Kopien derselben Mail — und zwar genau in dem Produkt, dessen Zweck Nachweisbarkeit ist.

Eine Abhängigkeit weniger wäre der Gewinn gewesen. Eine Divergenz mehr der Preis. Der Schnitt geht
klar in eine Richtung.

### Verworfene Alternativen

- **`postal-mime`** — kleiner und ohne Node-Bindung, aber es wäre die **zweite** MIME-Implementierung
  im Repository, mit genau der oben beschriebenen Divergenz als Folge. Verworfen.
- **Eigener MIME-Leser** — verworfen ohne langes Abwägen. MIME ist RFC 2045–2049 plus RFC 2231, dazu
  gefaltete Header, verschachtelte Multiparts und die Abweichungen realer Absender. Ein selbst
  geschriebener Leser scheitert nicht laut, sondern still: er lässt ein `Bcc` fallen, das niemand
  vermisst, weil niemand es je gesehen hat. Bei einem Feature, dessen ganze Begründung die
  Blindkopie-Empfänger sind, ist das die teuerste denkbare Fehlerklasse.

### Nachtrag vom 2026-08-02: die eine schmale Ausnahme, und warum sie nötig war

`JR-5-01` hat beim Umsetzen eine Stelle gefunden, an der `mailparser` das Verlangte **nicht** leisten
kann, und `packages/journaling/src/parser/mime-split.ts` teilt deshalb die **oberste** MIME-Ebene von
Hand. Das steht im Wortlaut gegen den eben verworfenen Punkt und wird hier deshalb ausgeschrieben,
statt es im Code zu verstecken.

**Der Befund, gemessen gegen `mailparser@3.7.4`** — dieselbe Nachricht, nur die
`Content-Disposition` des `message/rfc822`-Teils variiert:

```
disposition=(keine)    | Innentext in ParsedMail.text = false | attachments = 1
disposition=inline     | Innentext in ParsedMail.text = TRUE  | attachments = 0
disposition=attachment | Innentext in ParsedMail.text = false | attachments = 1
```

Bei `inline` steigt `mailparser` durch die `message/rfc822`-Grenze **durch** und mischt den Körper der
Innenmail in dieselbe `.text` wie den Reportteil. Ursache: `mailsplit/lib/message-splitter.js:373-378`
setzt `messageNode = true` nur bei `disposition === 'inline'` (Default-Config), und erst dann greift
der `break` in `mail-parser.js:806`, worauf die Kinder `showMeta = true` bekommen.

Für diesen Parser wäre das der schlimmste denkbare Ausgang: Er läse die Envelope-Feldzeilen aus einem
Text, in dem die Innenmail steht — **ohne Fehler, ohne Ausnahme, ohne Spur**. Ein Absender bestimmt
damit, was in den Metadaten landet.

**Umfang der Ausnahme, damit sie nicht wächst:** Das Modul trennt die Kinder **einer**
`multipart/mixed`-Hülle anhand des Boundary und gibt jedes Kind **einzeln** an `mailparser`. Es
dekodiert nichts (kein Base64, kein Quoted-Printable, kein Zeichensatz), es steigt in kein Kind
hinab, und alles außerhalb der von RFC §6.1 beschriebenen Form liefert `null` ⇒ `parse_failed`. Die
Entkodierung bleibt vollständig bei `mailparser`, wie diese ADR es vorsieht.

**Belegt statt behauptet:** Die drei Zeilen oben laufen als Test bei **jedem** CI-Lauf mit, samt einer
Gegenprobe, dass `splitJournalReportMime()` die `inline`-Fixture korrekt trennt. Das ist Absicht: eine
Begründung, die nur im Kommentar steht, wird von der nächsten Session widerlegt, die den harmlosen
Fall prüft und das Modul für überflüssige Komplexität hält.

Diese Ausnahme gilt für die oberste Ebene des Journal-Reports. **Jede weitere Handarbeit an MIME
braucht eine eigene ADR** — der verworfene Punkt oben gilt unverändert.

### Was die Entscheidung ausdrücklich **nicht** erlaubt

1. **`mailparser` liegt nie im Pfad der archivierten Bytes.** Das Archivobjekt ist und bleibt die rohe
   Außenmail, wie empfangen (RFC §4.4, Randbedingung 3). Was `mailparser` produziert, sind
   **Metadaten** — nie die Eingabe für Storage oder für einen Hash. Ein Test hält den Eingabepuffer
   byteweise gegen sich selbst.
2. **Ein Wurf aus `mailparser` verlässt den Parser nicht.** Parse-Fehler werden zu einem Ergebnistyp
   (`parse_failed`), nicht zu einer Ausnahme — RFC §5.3: archivieren, nicht ablehnen. Die
   Bibliothek ist tolerant, aber sie ist nicht unfehlbar, und ihr Verhalten bei bösartiger Eingabe ist
   keine Zusage, auf die sich der Acceptance-Contract stützen darf.
3. **Keine weitere Fremdabhängigkeit ohne eigene ADR.** Diese Entscheidung gilt für `mailparser`,
   nicht als allgemeine Öffnung von `packages/journaling`.

### Konsequenz

`packages/journaling/package.json` bekommt `mailparser` und `@types/mailparser` in derselben Version
wie `packages/backend`. Weichen die beiden je auseinander, ist das ein Befund und keine Kleinigkeit —
die Begründung dieser ADR hängt an der Gleichheit.

## ADR-028 — Die Betriebsart ist Konfiguration, keine Ableitung aus der Nachricht

**Status:** **entschieden** (2026-08-02) · **Entscheider:** PO · **Betrifft:** E5s Parser, E4s
Quellenkonfiguration, E6s Aufrufer · **Nummer beim Rückmerge gegenprüfen** (`17-parallelbetrieb.md` §6)

`parseJournalReport()` bekommt einen optionalen Hinweis auf die **erwartete Quellenart**
(`'exchange-journal' | 'plain-bcc' | 'infer'`, Voreinstellung `'infer'`). Bei `'plain-bcc'` ist
`journal_report` **kein möglicher Ausgang**, unabhängig davon, wonach der Inhalt aussieht.

### Warum: fünfmal dieselbe Ursache

E5 hat in fünf Runden fünfmal denselben Fehler gemacht, jedes Mal eine Ebene tiefer:

| #   | Was als Beleg galt                      | Was dieselbe Form hat       | gefunden durch  |
| --- | --------------------------------------- | --------------------------- | --------------- |
| 1   | `multipart/mixed` mit `text/plain`-Teil | jede Mail mit Anhang        | PO-Review R1    |
| 2   | mindestens ein erkanntes Envelope-Feld  | jede zitierte Weiterleitung | PO-Review R3    |
| 3   | ein `message/rfc822`-Teil ist vorhanden | „Als Anlage weiterleiten"   | PO-Review R4    |
| 4   | `Recipient:` + Feldzeilenanfang         | **vom Absender fälschbar**  | `JR-5-08`, TEST |
| 5   | `Auto-Submitted`                        | jede Abwesenheitsnotiz      | `JR-5-08`, TEST |

Die ersten drei widerlegen, dass die **Struktur** die Art belegt. Der vierte widerlegt den Ersatz —
denn `Recipient:` und Feldzeilenanfang sind **Inhalt**, und Inhalt schreibt der Absender. Damit ist
nicht ein Diskriminator zu schwach, sondern **die Ableitung als Verfahren** falsch.

### Der Angriff, und warum er nur die Hälfte der Installationen trifft

Gemessen an zwei Fixtures aus `JR-5-08`: eine Nachricht mit einem `text/plain`-Teil, der mit
`Recipient:`-Zeilen beginnt, wird als `journal_report` mit **absenderbestimmtem** `sender` und
`recipients` ausgegeben — die zweite Fixture erfindet dazu eine „Originalnachricht" als
`message/rfc822`-Teil.

- **Exchange-Journaling:** Exchange wickelt die Angreifernachricht in einen **echten** Journal-Report.
  Der Reportteil oberster Ebene ist Exchanges eigener, der gefälschte Inhalt sitzt im Innenteil und wird
  für Envelope-Felder nie herangezogen. **Nicht ausnutzbar.**
- **Plain BCC / Routing** (Postfix `always_bcc`, Google Workspace): es gibt keinen Wrapper, die
  Angreifernachricht **ist** die oberste Ebene. **Ausnutzbar** — ein Außenstehender bestimmt Absender
  und Empfänger eines Archiveintrags.

Der Angriff greift also genau dort, wo Journal-Reports **überhaupt nicht vorkommen**. Und das ist der
Beweis der Entscheidung: Der Betreiber **weiß**, welche Art Quelle er eingerichtet hat. Solange der
Parser es errät, entscheidet der Absender mit.

### Was diese ADR ausdrücklich **nicht** behauptet

`'plain-bcc'` schließt die Fälschung für diese Betriebsart. `'infer'` tut es **nicht** — und das steht
so im Modulkommentar und in den Tests, statt weggeschrieben zu werden. Vor allem aber:

> **Der Parser sieht nur Bytes.** Wer tatsächlich zugestellt hat, entscheidet sich an der
> SMTP-Transaktion — `allowed_sources` als CIDR-Liste, explizite `journal_recipients`, kein Catch-all,
> optional `AUTH` (RFC §4.3, `JR-4-05`). Diese Zusage kann der Parser weder ersetzen noch behaupten.
> Eine Installation, die Journal-Reports von beliebigen Absendern annimmt, ist auf der Transportebene
> defekt, und keine Inhaltsprüfung repariert das.

### Konsequenz

`JR-4-05` (Quellenkonfiguration) und `JR-6-02` (Aufrufer) müssen die Betriebsart **durchreichen**; ein
Aufrufer, der sie kennt und `'infer'` übergibt, verschenkt die Zusage. Die Voreinstellung bleibt
`'infer'`, damit E5 für sich lauffähig bleibt — sie ist eine Übergangs-, keine Zielbetriebsart.

---

## ADR-029 — SMTP-Empfangspfad: Eigenimplementierung statt Bibliothek

**Status:** **entschieden** (2026-08-02) · **Entscheider:** PO, auf der Messung von `JR-4-02` und
einer **eigenen Gegenprobe** · **Quelle:** Backlog E4 (`JR-4-02`, `JR-4-03`), RFC §4.1/§4.2, Skill
`journal-ledger` §10 · **Berührt nicht:** ADR-002 (Code-Ablage) — die Aufteilung dünne App /
Logik im Paket bleibt unverändert

**Entschieden: der SMTP-Server wird selbst implementiert**, auf `node:net` und `node:tls`, in
`packages/journaling/src/ingress/smtp-server.ts`. Keine SMTP-Server-Bibliothek als Abhängigkeit.

### Warum — das Kriterium ist `BDAT`, und es ist nicht verhandelbar

Der Projektzweck steht und fällt mit Exchange Online (`README.md`, erster Abschnitt: Exchange Online
kann Journal-Reports nicht an ein Exchange-Online-Postfach ausliefern, das Ziel muss extern und per
SMTP erreichbar sein). Exchange Online spricht `CHUNKING`/`BDAT`; das Backlog sagt dazu
ausdrücklich „das ist nicht optional". Damit ist `BDAT`-Fähigkeit kein Auswahlkriterium unter
mehreren, sondern eine Ausschlussbedingung.

**Gemessen, nicht aus READMEs gelesen** — `JR-4-02` hat die Pakete entpackt und den ausgelieferten
Quelltext geprüft, der PO hat es unabhängig wiederholt:

| Kandidat                | Ergebnis                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smtp-server` 3.19.2    | **Kein `BDAT`.** 17 Kommando-Handler (`AUTH`, `DATA`, `EHLO`, `HELO`, `HELP`, `KILL`, `MAIL`, `NOOP`, `QUIT`, `RCPT`, `RSET`, `SHELL`, `STARTTLS`, `VRFY`, `WIZ`, `XCLIENT`, `XFORWARD`), kein `handler_BDAT`. Der eigene Quellkommentar sagt es: „BINARYMIME is not supported as it requires BDAT command (RFC 3030)" |
| `haraka`                | **Kein `BDAT`** — und ein vollständiges `outbound/`-Modul (Queueing, Relay, Bounces), weil es ein MTA _sein_ will. Scheitert unabhängig davon an Skill §10 („kein ausgehender Mailpfad")                                                                                                                               |
| `simplesmtp`            | Unmaintained seit 2015, kein `BDAT`                                                                                                                                                                                                                                                                                    |
| übrige Registry-Treffer | `fake-smtp-server`, `maildev`, `smtp-tester`, `test-smtp-server` u. ä. — Testattrappen, überwiegend auf `smtp-server` aufgebaut, keine Produktionsserver                                                                                                                                                               |

Eine Registry-Suche nach `bdat` liefert zwei Treffer, beide ohne Bezug zu SMTP. **Es gibt in Node
keinen SMTP-Server mit `BDAT`.**

### Nachtrag 2026-08-03: die Prämisse ist richtig, ihre Begründung im RFC war es nicht

**Der Auftraggeber hat die Entscheidung angezweifelt** — ob eine fertige Bibliothek (`smtp-server`)
nicht den Aufwand erheblich senken würde. Die Rückfrage war berechtigt und hat die ADR verbessert,
denn die Begründung, auf der sie stand, hielt der Prüfung **nicht** stand.

`00-rfc.md:127` sagt: „**`CHUNKING` / `BDAT`** — Exchange Online uses BDAT. Not optional." Der erste
Halbsatz begründet den zweiten nicht. **RFC 3030 verlangt das Gegenteil:** ein Server, der `BDAT`
anbietet, **muss** `DATA` weiter unterstützen, und ein Client darf `DATA` benutzen. Kündigt ein
Empfänger `CHUNKING` nicht an, fällt jeder normkonforme Sender auf `DATA` zurück — genau deshalb
liefert Exchange Online an die Mehrheit der Mailserver im Internet aus, die `CHUNKING` nicht
anbieten. „Exchange benutzt BDAT" ist damit **kein** Argument für Unverzichtbarkeit.

**Unverzichtbar ist es aus einem anderen Grund, und der trägt:** Microsoft 365 **entfernt seit
einigen Jahren keine „bare line feeds" mehr** aus Nachrichten — früher tat es das, um an ältere
Empfänger ausliefern zu können, und hat damit aufgehört, weil das Signaturen (DKIM) zerstört. Eine
Nachricht mit einem `LF` ohne vorangehendes `CR` **ist über `DATA` nicht übertragbar**: `DATA` ist
zeilenorientiert und endet auf `<CRLF>.<CRLF>`. Microsoft schreibt dazu ausdrücklich, dass für solche
Nachrichten `CHUNKING` erforderlich ist und ein Ziel ohne `BDAT` sie **nicht annehmen kann**; der
Sendeversuch endet in `barelinefeedsareillegal`.

**Für dieses Produkt ist das die schlimmste denkbare Lückenart.** Ein Journal-Report, dessen
Originalnachricht ein Bare-LF enthält, käme nie an — und ob er eines enthält, hängt an der
Byte-Zusammensetzung der archivierten Mail, nicht an einer Einstellung. Die Lücke wäre also
**unsystematisch und unauffällig**, in einem System, dessen einziger Zweck **beweisbare
Vollständigkeit** ist. Ein Archiv, das „alles außer manchen" enthält, ist genau das, was dieses
Projekt ersetzen soll (`README.md`, erster Abschnitt: die Pull-Ingestion ist defekt, _weil_ ihre
Lücke nicht nachweisbar ist).

**Der `00-rfc.md`-Satz bleibt unverändert** — die Datei ist byteidentisch zu halten (`.prettierignore`,
ADR-004). Die tragende Begründung steht hier.

### Was der Umstieg konkret kosten und sparen würde — gemessen, nicht geschätzt

Weil die Frage wiederkommen wird, hier die Zahlen aus dem entpackten Paket (`smtp-server` 3.19.2):

| Punkt                                           | Befund                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ließe sich `handler_BDAT` „von außen" ergänzen? | Der Dispatch ist `handler = this['handler_' + commandName]` (`lib/smtp-connection.js:603`), ein Prototype-Lookup — ein Handler wäre also über einen Deep-Import in `smtp-server/lib/smtp-connection` und einen Prototype-Patch grundsätzlich anfügbar         |
| **Aber `BDAT` ist kein Kommando-Problem**       | `lib/smtp-stream.js` (295 Zeilen) kennt **zwei** Modi: Kommandozeilen und `_dataMode` (Terminatorsuche mit Dot-Unstuffing). Ein „lies genau `n` rohe Bytes"-Modus — der, in dem `BDAT` arbeitet — **existiert nicht**. Er müsste **in** die Bibliothek hinein |
| Was der Umstieg spart                           | `STARTTLS` (`JR-4-04`), `AUTH`/SASL (Teil von `JR-4-05`), Timeouts, Parameter-Parsing, Dot-Unstuffing — real, aber der Größenordnung nach **rund 1,5 von 16** E4-Tasks                                                                                        |
| Was der Umstieg kostet                          | `JR-4-02`, `JR-4-03` und `JR-4-16` sind fertig, getestet und gemessen — sie wären wegzuwerfen; die Byte-Treue (Randbedingung 3) liefe künftig durch fremden Stream-Code; der `BDAT`-Eingriff läge an drei Stellen in nicht-öffentlicher API                   |
| Unerwünschtes, das mitkommt                     | `handler_VRFY`, `handler_XCLIENT`, `handler_XFORWARD`, `handler_WIZ`, `handler_SHELL` — ADR-029 schließt die ersten drei ausdrücklich aus, weil `XCLIENT`/`XFORWARD` einer Gegenstelle erlauben, `remote_ip`/`ehlo_name` zu setzen, also gehashte Felder      |

**Die Entscheidung bleibt damit bestehen**, aber ihre Begründung ist ausgetauscht: nicht „keine
Bibliothek kann `BDAT`" allein, sondern „`BDAT` ist für Vollständigkeit unverzichtbar **und** keine
Bibliothek kann es, und die eine, die man umbauen könnte, müsste an ihrem Bytestrom-Parser umgebaut
werden — genau an der Stelle, an der unser Kernversprechen hängt."

### Die dritte Option, und warum sie verworfen ist

Neben „Bibliothek nehmen" und „selbst bauen" gab es **`smtp-server` forken und `BDAT` nachrüsten**.
Diese Option ist **abgewogen, nicht gemessen** — das gehört hier hin, weil der Rest dieser ADR auf
Messung beruht und der Unterschied nicht verwischt werden soll. Gegen den Fork sprechen drei Punkte:

1. **Das Hauptargument für einen Fork trägt gerade dort nicht, wo er gebraucht würde.** Man forkt,
   um die gehärtete Substanz zu erben. Der nachgerüstete `BDAT`-Pfad ist aber genau der Teil, den
   niemand gehärtet hat — die geerbte Härtung deckt den `DATA`-Pfad ab, den wir ohnehin bekommen
   hätten.
2. **Der Eingriff läge im fremden Zustandsautomaten an der Stelle, an der die Byte-Treue entsteht.**
   Randbedingung 3 des Projekts (Bytes werden nie transformiert) ist eine Aussage über genau diesen
   Codepfad. Sie über einen fremden, umgebauten Automaten zu belegen ist teurer als über 627 Zeilen
   eigenen Code.
3. **Ein Fork ist über die Projektlaufzeit Wartung ohne Ertrag** — Upstream-Änderungen müssen
   nachgezogen werden, ohne dass Upstream je das Feature bekommt, dessentwegen geforkt wurde.

### Was das kostet, und was es einbringt

**Es bringt ein**, dass zwei Zusicherungen strukturell statt argumentativ werden: es gibt in diesem
Prozess **keinen** ausgehenden Mailpfad, weil kein solcher Code existiert (`JR-4-07` wird damit
belegbar statt behauptbar), und die empfangenen Bytes durchlaufen keinen fremden Filter.

**Es kostet die geerbte Härtung.** Wer eine etablierte Bibliothek einsetzt, erbt deren Umgang mit
überlangen Zeilen, unvollständigen Kommandos, Kommandofluten, ungültigen Sequenzen und
Ressourcenerschöpfung — Verhalten, das dort über Jahre an echtem Verkehr entstanden ist. Dieser
Erwerb entfällt und **muss deshalb selbst hergestellt werden**. Das ist keine Anmerkung, sondern
eine Auflage:

> **Auflage 1:** `JR-4-14` (neu, Rolle TEST) — adversariale Protokollrobustheit. Ohne diese Task
> ist E4 nicht abnehmbar; `JR-4-13` nimmt sie in seine Kriterien auf.
>
> **Auflage 2:** `JR-4-15` (neu, Rolle TEST) — Sicherheitsdurchsicht des Empfangspfads, bevor
> `JR-4-13` läuft. Dieser Prozess terminiert TLS, nimmt Bytes von unauthentifizierten Gegenstellen
> an und ist der einzige Teil des Systems, der von außen erreichbar ist.

### Was bewusst **nicht** implementiert wird

Der Befehlssatz bleibt auf das beschränkt, was ein Journaling-Empfänger braucht. Insbesondere
**kein `VRFY`/`EXPN`** (Auskunft über Empfänger ist ein Informationsleck und für dieses Produkt
ohne Nutzen) und **kein `XCLIENT`/`XFORWARD`** (sie erlauben einer Gegenstelle, die protokollierte
Herkunft zu setzen — in einem System, dessen Ledger `remote_ip` und `ehlo_name` hasht, wäre das
eine Manipulationsschnittstelle). Wer einen dieser Befehle später aufnimmt, ändert damit die
Aussagekraft der Kette und braucht eine eigene Entscheidung.

### Konsequenz für die Abhängigkeitslage

`node:net`/`node:tls` sind Builtins, keine npm-Pakete. `packages/journaling` hängt damit
unverändert **nur** von `@open-archiver/types` und `zod` ab — die Frage „Bibliothek ins Paket oder
in die App" hat sich aufgelöst, statt entschieden zu werden. Die Protokollierung (`pino`) liegt in
der App und wird über den Port `IngressLogger` injiziert, wie `SpoolFileSystem`, `LedgerBackend` und
`QuarantineAlertSink`.

### Nachtrag 2026-08-04: **Go war nie geprüft** — nachgeholt, Entscheidung bestätigt, Vorlage übernommen

**Der Auftraggeber hat die Entscheidung ein zweites Mal angezweifelt**, diesmal mit konkreten
Kandidaten außerhalb von Node: [`go-smtp`](https://github.com/emersion/go-smtp),
[`net/smtp`](https://pkg.go.dev/net/smtp) und
[`microbus/smtpingress`](https://docs.microbus.io/package-reference/coreservices/smtpingress/).
Anlass waren **F52** und **F53** — zwei Defekte, die `JR-4-14` gefunden hat und die genau in die
Kategorie fallen, die diese ADR als Kosten ihrer eigenen Entscheidung benannt hat („es kostet die
geerbte Härtung").

**Die Rückfrage war berechtigt, und sie hat eine echte Lücke getroffen.** Der Satz „Es gibt in Node
keinen SMTP-Server mit `BDAT`" ist richtig — aber die Tabelle darüber prüft **ausschließlich
npm-Pakete**, und das stand nirgends. Für andere Sprachen galt die Aussage nie.

**Gemessen am Quelltext, nach demselben Maßstab wie oben:**

| Kandidat               | Befund                                                                                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `go-smtp` (emersion)   | **Kann `BDAT` vollständig, serverseitig.** `handleBdat()` in `conn.go:993`, `bdatPipe`, `CHUNKING` in den Capabilities, eigene Byte-Zählung, korrektes `RSET`-Verhalten. Ein echter Kandidat — in **Go** |
| `net/smtp`             | Scheidet aus: **Client** (`SendMail`), kein Server; von Go als eingefroren markiert                                                                                                                      |
| `microbus/smtpingress` | Scheidet aus: kein `BDAT`/`CHUNKING`, und es setzt das vollständige Microbus-Substrat samt NATS voraus                                                                                                   |

**Warum die Entscheidung trotzdem bestehen bleibt — der Grund ist nicht der SMTP-Server, sondern der
Acceptance-Contract.** `250` fällt erst nach fsync von Spool **und** Ledger-Append. Beides muss im
selben Prozess liegen wie der Protokollzustand. Ein Go-Ingress müsste deshalb mitnehmen:

| Bereich   | Umfang heute | Lage                                                                                        |
| --------- | ------------ | ------------------------------------------------------------------------------------------- |
| `ingress` | 5 309 Zeilen | `go-smtp` ersetzt das **Protokoll**, nicht ACL gegen Postgres, Rate-Limits, TLS-Config      |
| `spool`   | 1 684 Zeilen | **E3, abgenommen**                                                                          |
| `ledger`  | 1 154 Zeilen | **E2, abgenommen** — kanonische Kodierung über 16 Felder, Chain-Hash, Merkle, Advisory-Lock |

Der Ledger ist der Ausschlussgrund: ihn in Go nachzubauen hieße, die **Hash-Kette zweimal zu
implementieren**. Weicht die kanonische Kodierung um ein Byte ab, entsteht ein Kettenbruch — also
exakt der Befund, den das Produkt als Manipulation meldet. Die Alternative, eine IPC-Grenze zwischen
fsync und `250`, legt eine Prozessgrenze in den kritischen Pfad und verkompliziert die
Crash-Recovery. Dazu kämen 21 Testdateien zum Empfangspfad (allein die fünf großen 2 606 Zeilen),
darunter der Kill-Test, der als erster belegt hat, dass die Kernzusage unter `SIGKILL` hält.

**Entscheidung des Auftraggebers (2026-08-04): bei der Node-Eigenimplementierung bleiben — aber die
Lösungen von `go-smtp` übernehmen, statt sie neu herzuleiten.** Das ist der Teil, der diese ADR
verändert: der Eigenbau bleibt, hört aber auf, seine Härtung selbst zu erfinden.

#### Die Vorlage, die dabei zu übernehmen ist

`go-smtp` löst **F52 und F53 strukturell**, nicht durch Einzelprüfungen — und genau das ist der
Unterschied zu unserer Implementierung:

1. **`lineLimitReader` (`conn.go:38`, `60-69`): die Zeilenlängengrenze sitzt im _Reader_, nicht in
   der Parselogik.** Damit greift sie unabhängig davon, ob das CRLF im selben Chunk ankommt (**F52**)
   und unabhängig davon, ob die Verarbeitungsschleife gerade läuft (**F53**). Unsere Prüfung liegt in
   `drainCommandCarry()` und in der von `onData()` überspringbaren Schleife — deshalb hat sie zwei
   Lücken statt keiner.
2. **Für `BDAT` wird das Limit gezielt abgeschaltet und exakt wiederhergestellt** (`LineLimit = 0` in
   Zeile 1075, zurück auf `MaxLineLength` in 1091 und 1098), weil Chunks binär und ohne
   Zeilenstruktur sind. Die Fallunterscheidung, die man leicht vergisst.
3. **`strconv.ParseUint(args[0], 10, 32)` statt `Atoi`** — im Quelltext kommentiert mit „so we will
   not accept negative values". Erschlägt den negativen `BDAT`-Längenfall an der Wurzel.
4. **Oversize bei `BDAT`: `552` senden _und_ den angekündigten Chunk verwerfen**
   (`io.Copy(Discard, LimitReader(…))`), damit die Verbindung synchron bleibt — dasselbe Verhalten,
   das `JR-4-12` prüft.
5. **Grenzen als benannte Serverfelder mit Defaults**: `MaxLineLength` (2000), `MaxRecipients`,
   `MaxMessageBytes`, getrennte `ReadTimeout`/`WriteTimeout`, Idle-Timeout → `421`.

**Lizenz:** `go-smtp` steht unter **MIT**, dieses Projekt unter **AGPL-3.0**. MIT ist damit
verträglich. Übernommen werden **Lösungsansätze**, nicht Quelltext — die Umsetzung ist TypeScript
gegen `node:net`. Wo eine Stelle erkennbar nachgebaut ist, gehört ein Verweis auf `go-smtp` samt
MIT-Hinweis in den Dateikommentar; das ist guter Stil und hält die Herkunft nachvollziehbar.

**Was das für `JR-4-15` bedeutet:** Auflage 2 bleibt bestehen und wird durch diesen Nachtrag nicht
kleiner. Sie prüft künftig einen Empfangspfad, dessen Grenzen an der Transportschicht sitzen — die
Durchsicht wird dadurch aussagekräftiger, nicht überflüssig.

## ADR-030 — Eine Transaktion, die Journal-Empfänger mehrerer Ketten adressiert

**Status:** **entschieden** (2026-08-03) · **Entscheider:** PO · **Quelle:** `JR-4-05b` hat den Fall
erkannt und ausdrücklich **nicht** gelöst, wie beauftragt · **Umsetzung:** `JR-4-17` (neu), **vor
`JR-4-06`** · **Berührt:** ADR-007 (eine Kette je Archiv), Skill `journal-ledger` §5 (eine Receipt je
Transaktion)

**Entschieden: der zweite und jeder weitere `RCPT TO`, der eine _andere_ Kette einführen würde, wird
mit `452 4.5.3` abgewiesen.** Eine SMTP-Transaktion bleibt damit eindeutig **einer** Kette zugeordnet.
Mehrere Empfänger **derselben** Quelle und ein doppelt genannter Empfänger bleiben unproblematisch und
werden angenommen.

### Der Fall

`journaling_sources.routing_address` bestimmt die Quelle, deren `ingestion_source_id` die
`chain_scope_id` **ist** (ADR-007). Adressiert eine Transaktion zwei gültige Journal-Adressen
verschiedener Quellen, ist die Kettenzuordnung ambig — eine Transaktion erzeugt aber genau eine
Receipt in genau einer Kette. Praktisch tritt das ein, wenn ein Endkunde mehrere Archive auf einer
Installation betreibt und eine Nachricht in zwei Journalregeln fällt.

### Die drei Wege, und warum zwei ausfallen

**Verworfen: „der erste Empfänger gewinnt".** Der Sender hätte für **beide** Empfänger ein `250`
bekommen, während nur eine Kette einen Eintrag hat. Das ist keine Ungenauigkeit, sondern ein direkter
Bruch des Acceptance-Contracts: `250` ist die Zusage, dass **diese** Nachricht durabel liegt, und für
den zweiten Mandanten wäre sie unwahr. Ein stiller Verlust in genau dem Archiv, dessen
Vollständigkeit bewiesen werden soll.

**Verworfen für v1: „eine Receipt je betroffener Kette, ein Spool-Objekt".** Inhaltlich die sauberste
Variante — verlustfrei, und jede Mandantenkette bliebe für sich vollständig, was ADR-007 anstrebt.
Sie scheitert an einer **gemessenen** Eigenschaft des bestehenden Kerns, nicht an einer Vermutung:

- `LedgerLookup.findBySpoolTxIds()` (`packages/journaling/src/ledger/ledger-lookup-port.ts`) liefert
  eine `ReadonlyMap<string, LedgerEntryByTxId>` — **genau einen** Eintrag je `spool_txid`. Zwei
  Receipts unter derselben Transaktions-ID würden die Crash-Recovery blind dafür machen, dass ein
  zweiter Eintrag fehlt: sie sähe „Ledger vorhanden" und reihte Phase B nach, während eine Kette
  lückenhaft bliebe. Das ist ein Eingriff in `JR-3-05`, den **abgenommenen** kritischsten Pfad.
- Der Ausweg wäre ein **atomarer Append über mehrere Ketten** — beide Einträge in einer
  Datenbanktransaktion, damit „einer da ⇒ alle da" gilt. `PostgresLedgerWriter.append()` nimmt aber
  einen Advisory-Lock **je Kette**; zwei Locks in einer Transaktion brauchen eine erzwungene
  Sperrreihenfolge, sonst gibt es Deadlocks zwischen zwei Transaktionen mit vertauschten Ketten.
- Der Index auf `spool_txid` ist **nicht** unique (`0041_even_scream.sql`), eine Migration wäre also
  nicht nötig — das ist der einzige Teil, der billig wäre.

**Für einen Randfall ist das zu viel Risiko am Kern.** Die Variante bleibt als Ausbaupfad benannt,
mit dieser Kostenliste.

### Warum `452 4.5.3` und nicht `550`

`452 4.5.3` („too many recipients") ist der Code, für den sendende MTAs **bereits** eine
Empfänger-Aufspaltung implementiert haben — er ist die übliche Antwort auf ein Empfängerlimit, und
ein Sender reicht die abgelehnten Empfänger in einer **eigenen** Transaktion nach. Genau das löst den
Fall: getrennt gesendet ist jede Transaktion wieder eindeutig. Ein `550` wäre endgültig und würde die
zweite Kette verlieren.

### Das Restrisiko, ausdrücklich benannt

**Diese Entscheidung hängt an fremdem Verhalten.** Spaltet ein Sender nicht auf, verzögert er die
Zustellung an die zweite Adresse und erzeugt am Ende einen NDR. Das ist hinzunehmen, weil es die
**sichtbare** Fehlerart ist: ein NDR landet bei einem Menschen, eine fehlende Ledger-Zeile bei
niemandem. Das Projekt existiert, weil die Pull-Ingestion Lücken erzeugt, **die man nicht bemerkt**
(`README.md`); eine Lücke, die einen NDR erzeugt, ist die zulässige Sorte.

Drei Auflagen daraus:

1. **`JR-4-17`** setzt die Abweisung um. Heute **protokolliert** `recordMatchedRecipient()` den Fall
   nur — richtig so, aber es ist noch keine Entscheidung im Code.
2. **Der Fall muss in E10 (Monitoring) sichtbar werden**, nicht nur im Prozessprotokoll. Ein
   Betreiber, dessen Sender nicht aufspaltet, muss es erfahren, ohne Logs zu lesen.
3. **`JR-12-08`** (echter Exchange-Online-Tenant) messe, ob Exchange tatsächlich aufspaltet. Fällt
   die Messung negativ aus, ist der oben benannte Ausbaupfad zu bauen — dann mit dem vollen Preis für
   Recovery und Sperrreihenfolge.

## ADR-031 — Erholung der Ledger-Anbindung: Provider statt Wert, Wiederholung bis zum ersten Erfolg

**Status:** **entschieden** (2026-08-03) · **Entscheider:** PO · **Quelle:** `JR-4-06a` hat die Lücke
selbst offengelegt und vorgelegt; Task `JR-4-19` · **Berührt:** Skill `journal-ledger` §2
(Metadaten-DB nicht erreichbar ⇒ `451`), Architektur §5 (Scan über einen Spool, in den niemand
schreibt), ADR-018 (Verfügbarkeit zuerst, dann fail closed)

**Der Defekt.** `apps/smtp-ingress` baute seine Ledger-Anbindung **einmal**, beim Start. War die
Datenbank in diesem Moment nicht erreichbar oder nicht migriert, blieb `journalAcceptance`
**dauerhaft** `undefined`: der Prozess band seinen Port, sah gesund aus und antwortete jeder
Transaktion `451`, bis ihn jemand neu startete — lange nachdem Exchange Online seine Wiederholungen
aufgegeben und NDRs erzeugt hatte. Tabellenkonform war das; der Defekt war die fehlende Erholung.

**Drei Festlegungen:**

1. **`EsmtpServer` nimmt einen Provider, keinen Wert** (`journalAcceptanceProvider`), aufgelöst
   **genau einmal je Transaktion** bei `MAIL FROM`. Ein Wert war zweifach eingefroren (Serverfeld plus
   Kopie je Verbindung), eine nachträgliche Verdrahtung also unmöglich — auch für neue Verbindungen.
   Die Auflösung wird für die Dauer der Transaktion festgehalten, weil dieselbe Antwort darüber
   entscheidet, ob überhaupt eine `SpoolWriteBridge` geöffnet wird; ein Provider, der mitten in der
   Transaktion umschaltet, ist ein Absturz oder eine Quittung ohne Spool-Datei. Der bestehende
   Wert-Parameter bleibt und wird im Konstruktor in einen konstanten Provider gehoben — dieselbe
   Normalisierung, die `requireTlsResolver` für `tls.requireTls` schon macht.
2. **Wiederholt wird bis zum ersten Erfolg, danach wird der Timer abgeschaltet.** Ein späterer
   Ausfall braucht diese Maschinerie nicht: `postgres-js` verbindet je `append()` neu, und
   `JournalAcceptance` bildet einen fehlgeschlagenen Append bereits auf `451` ab, nie auf `250`.
   Weiterlaufendes Polling kostete eine Verbindung je Intervall und stellte die Frage „Verdrahtung
   wieder entfernen?", die keine gute Antwort hat.
3. **Der Crash-Recovery-Scan läuft in jedem Versuch mit.** Zulässig, weil vor der ersten Verdrahtung
   **kein Byte** in den Spool gelangt (ohne Acceptance keine `SpoolWriteBridge`) — genau die
   Vorbedingung aus Architektur §5. Weil der Timer beim ersten Erfolg endet, läuft der Scan nie
   parallel zu einer Annahme; das Scan-gegen-Annahme-Rennen, das `crash-recovery-lock.ts`
   ausdrücklich **nicht** löst, bleibt unerreichbar. Die Gegenvariante (nur beim Boot scannen) ließe
   den Spool einer abgestürzten Installation genau dann unabgeglichen, wenn die Datenbank beim
   Neustart weg war — F40s Kapazitätsproblem.

**Was sich nicht ändert, und das ist der Kern:** bis zum ersten Erfolg antwortet **jede**
`DATA`/`BDAT … LAST` mit `451 4.3.0` und **nie** `250`. Es wird nichts quittiert, was keinen
Ledger-Eintrag hat. Ein werfender Provider fällt defensiv auf `451` zurück statt den Prozess
mitzunehmen (er läuft im `data`-Handler des Sockets).

**Nicht geschlossen:** eine Bereitschaftssonde, die „nicht konfiguriert" von „konfiguriert, aber noch
nicht verdrahtet" unterscheidbar macht (`ledger-config.ts` fragt danach). `JournalAcceptanceBootstrap`
hat mit `isWired()` die Antwort, aber es gibt keinen Endpunkt, der sie ausliefert — Sache von E10.

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

---

## ADR-032 — Fortlaufende Nummernkreise gehören dem Integrationszweig, nicht dem Epic-Zweig

**Status:** **entschieden** (2026-08-04) · **Entscheider:** Auftraggeber · **Betrifft:** ADR-Nummern,
Befundnummern in `09-befunde-bestandscode.md`, Dateinamen in `docs/dev/journaling/`

Beim Rückmerge von E4 kollidierten **drei** Nummernkreise gleichzeitig, weil E4 und E5 parallel auf
zwei Zweigen entstanden sind und beide aus demselben fortlaufenden Vorrat geschöpft haben:

| Kreis             | Kollision                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| **ADR-Nummern**   | ADR-026, ADR-027 und ADR-028 doppelt vergeben; E4 hatte zusätzlich die bestehende ADR-026 verschoben          |
| **Befundnummern** | F42/F43 doppelt — E5 vergab sie in `06-status.md` und `17-parallelbetrieb.md` statt in `09-befunde…`          |
| **Dateinamen**    | `12-parallelbetrieb.md` (E5) gegen `12-archiv-e13-e2.md` (E4) — E5s Datei heißt jetzt `17-parallelbetrieb.md` |

Das war kein Versehen einer einzelnen Sitzung, sondern die zwangsläufige Folge davon, dass ein
fortlaufender Zähler auf zwei Zweigen gleichzeitig weitergezählt wird. Er verhält sich wie eine
Sequenz ohne Sperre.

### Entscheidung

1. **Der Integrationszweig führt die Nummernkreise.** Kollidiert ein Epic-Zweig beim Rückmerge, gibt
   **der eingehende Zweig nach** — unabhängig davon, welche Seite billiger umzustellen wäre. Der Trunk
   ist bereits abgenommen und wird von Folgearbeit referenziert; er ist der stabile Bezugspunkt.
2. **Eine Nummer wird nie umgewidmet.** Was der Trunk als ADR-026 führt, bleibt ADR-026. Eine
   Verschiebung wie die von E4 (Task-IDs von 026 auf 029) ist auch dann unzulässig, wenn sie auf dem
   eigenen Zweig konsistent aussieht.
3. **Befundnummern werden ausschließlich in `09-befunde-bestandscode.md` vergeben.** Die Regel stand
   dort schon; E5 hat sie verletzt, indem es F42/F43 in Statusdokumenten vergab. Wer in einem anderen
   Dokument einen Befund nennt, verweist auf eine dort bereits angelegte Nummer.
4. **Wer einen Epic-Zweig eröffnet, reserviert seine Nummern vorab auf dem Integrationszweig** — ein
   Platzhalterabschnitt (`## ADR-0NN — reserviert für E<N>`) genügt und kostet einen Commit. Das ist
   die eigentliche Gegenmaßnahme: Kollisionen entstehen beim Vergeben, nicht beim Mergen.

### Konsequenz

Die Umnummerierung ist in der Notiz am Kopf dieser Datei dokumentiert. Sie hat 98 Referenzen in 15
Dateien erfasst und ist als mechanische Permutation ausgeführt worden, nicht von Hand — bei einer
Zyklusabbildung (026→029→026) ist die naheliegende Reihenfolge von Einzelersetzungen falsch, und der
Fehler wäre stumm geblieben.

**Nicht entschieden ist der Umgang mit Task-IDs** (`JR-<Epic>-<NN>`). Sie kollidieren strukturell
nicht, weil die Epic-Nummer im Präfix steht — genau die Eigenschaft, die den anderen drei Kreisen
fehlt. Wenn ein künftiger Kreis neu entsteht, ist das die Vorlage.

## ADR-033 — Owner-Auflösung für `plain_bcc`, `ndr` und `parse_failed`: derselbe Resolver, eine zweite Envelope-Quelle

**Status:** **entschieden** (2026-08-05, `JR-6-02b`) · **Entscheider:** PO ·
**Quelle:** RFC §6.2, `docs/enterprise/journaling/guide.md` („How Owner Resolution Works"), die von E5
ausdrücklich offen gelassene Frage

`resolveOwner()` ist auf `OwnerResolutionEnvelope` typisiert, also auf `to`/`cc`/`bcc`/`sender` eines
**Journal-Report-Envelopes** — und nur `JournalReportParsed` trägt einen. E5 hat das bewusst so
getypt und die Folgefrage ausdrücklich weitergegeben:

> „Whether/how to resolve an owner for those two kinds is an open question left to whichever later
> slice needs it."

`JR-6-02b` ist diese Scheibe: Phase B muss **jede** Nachricht archivieren, auch eine, die nicht als
Journal-Report geparst werden konnte — abgelehnt wird nichts, die Receipt existiert schon.

### Was die drei schwächeren Ergebnisarten tatsächlich tragen

| Art            | Vorhanden                                                                        | **Nicht** vorhanden             |
| -------------- | -------------------------------------------------------------------------------- | ------------------------------- |
| `plain_bcc`    | `SmtpTransactionEnvelope` (`envelopeFrom`, `envelopeRcpt`), `ExtractableHeaders` | `to`/`cc`/`bcc` als Adressliste |
| `ndr`          | dasselbe, plus `signals`                                                         | dasselbe                        |
| `parse_failed` | `ExtractableHeaders` (`subject`, `from`, `messageId`)                            | jede Envelope-Information       |

### Entscheidung

1. **`resolveOwner()` wird nicht verbreitert.** E5s Typisierung bleibt: ein Resolver, der die ganze
   Union nimmt und zur Laufzeit einen Ersatz errät, ist genau das, was dort verworfen wurde.
2. **Für die drei Arten wird der Envelope aus den eigenen RFC-5322-Kopfzeilen der Außenmail gebaut**
   (`To`/`Cc`/`Bcc`/`From` über `splitHeaderAndBody()` plus `parseHeaderAddressList()`) und **derselbe**
   `resolveOwner()` darüber laufen gelassen. **Ein Resolver, zwei Envelope-Quellen** — dieselbe
   Begründung wie in ADR-010 für die Dedupe: zwei Implementierungen derselben Zuordnungsregel wären der
   teuerste denkbare Fehler, und die Regel ist hier „welche Domain gehört uns".
3. **`envelopeRcpt` wird nie als Owner benutzt.** Das ist die tragende Festlegung. Bei einer
   Plain-BCC-Kopie ist `RCPT TO` **die Archivadresse selbst** (E5 hat das gemessen und dokumentiert:
   Postfix spielt die Originalempfänger auf dem `always_bcc`-Zweig nicht nach). Sie als Owner zu nehmen
   würde jede solche Nachricht **einem Pseudo-Postfach** zuschreiben — und dabei wie eine **gelungene**
   Auflösung aussehen. Ein falscher Owner, der sich als richtig ausgibt, ist schlimmer als ein
   eingeräumt unbekannter.
4. **Die Fidelität wird mitgeführt** (`'journal-report'` / `'rfc5322-headers'` / `'none'`), damit ein
   kopfzeilen-abgeleiteter Owner nie mit einem report-abgeleiteten verwechselt wird. `resolveOwner()`
   unterscheidet über `OwnerResolutionMethod` schon, **wie sehr** man `ownerEmail` trauen darf; diese
   Angabe sagt zusätzlich, **woher der Eingang kam**.

### Warum der kopfzeilen-abgeleitete Envelope schwächer, aber echt ist

- **`plain_bcc`:** `To`/`Cc` der Außenmail **sind** die Empfängerkopfzeilen der Originalnachricht — die
  BCC-Kopie ist eine Kopie derselben Bytes, Postfix schreibt sie nicht um. Das ist keine Notlösung,
  sondern die beste vorhandene Quelle.
- **`ndr`:** die Empfängerkopfzeile eines Bounce ist der **ursprüngliche Absender**, und das ist für
  einen Bounce der richtige Owner. `extractableHeaders.from` wäre es **nicht** — dort steht der
  Mailer-Daemon.
- **`parse_failed`:** was lesbar ist, wird gelesen; was nicht, führt zu `fallback`.

**Ehrlich benannt, weil es kein Resolver behebt:** in Plain-BCC-Betrieb ist ein **reiner
BCC-Empfänger spurlos verloren** (E5: „any genuine Bcc recipient is gone without a trace"). Das ist
eine Eigenschaft dieses Betriebsmodus, nicht ein Mangel der Auflösung. Es gehört in die Betreiberdoku
neben die Empfehlung, echtes Journaling zu benutzen — und es ist der Grund, warum die Fidelität
mitgeführt wird statt weggeglättet.

### Konsequenz

- `parseHeaderAddressList()` in `parser/envelope.ts` ist jetzt **exportiert** und kennt `'From'`. Kein
  zweiter Adressparser; ADR-027 bleibt eingehalten (`mailparser` ist die einzige Parsing-Abhängigkeit).
- Löst die Auflösung nichts auf (`method === 'fallback'`), wird der konfigurierte Unresolved-Owner
  benutzt, die Zeile markiert und **alarmiert** — nie abgelehnt.
- **Verworfen: aus `envelopeRcpt` einen Owner machen.** Siehe Punkt 3.
- **Verworfen: die drei Arten gar nicht auflösen und pauschal in ein Sammelpostfach legen.** Das wirft
  die `To`/`Cc`-Information weg, die in zwei der drei Fälle vorhanden **und** korrekt ist.

## ADR-034 — Phase-B-Pipeline: Fan-out über jeden aufgelösten Owner, Spool-Freigabe ist Löschen, kein E2E-Suchbeleg in der CI

**Status:** **entschieden** (2026-08-05, `JR-6-02b`) · **Entscheider:** DEV, auf Messung ·
**Quelle:** Architektur §6, ADR-010, ADR-033, `docs/dev/journaling/07-session-handover.md`s
Auftragstext für `JR-6-02b`

`JR-6-02b` verbindet Gate (`JR-6-02a`), Parser (E5) und Owner-Auflösung (ADR-033) zu
`runPhaseBPipeline()` (`packages/journaling/src/phase-b/pipeline.ts`) und schließt drei Fragen, die
keine der vorherigen Entscheidungen schon beantwortet hatte.

### 1. Fan-out: jeder aufgelöste Owner wird archiviert, nicht nur der Gewinner

`resolveOwner()` liefert einen Gewinner **plus** `additionalMatches` — andere `to`/`cc`/`bcc`-Adressen,
die ebenfalls eine konfigurierte Domain treffen (JR-5-07 harte Vorgabe 4). Bisher hatte das niemand
konsumiert. `JR-6-02b`s Auftrag ("je aufgelöstem Owner ein `processEmail`-Aufruf") verlangt genau das:
die Pipeline archiviert Gewinner **und** jeden zusätzlichen Treffer, dedupliziert auf die normalisierte
Adresse (derselbe Empfänger in `To` und `Cc` archiviert einmal, nicht zweimal).

**Konsequenz für `OwnerResolutionWinner`:** `additionalMatches` trug bisher nur `{field, address}` —
die rohe, nicht normalisierte Adresse. Für den Fan-out fehlte die alias-zu-primär-Domain-Normalisierung
je Treffer. Ergänzt um `normalizedEmail` (`packages/types/src/journal-parser.types.ts`), berechnet in
`winnerOf()` genau wie für den Gewinner selbst — ein Resolver, eine Normalisierungsregel, für alle
Treffer gleich (dieselbe Begründung wie ADR-010 für die Dedupe-Semantik). `owner-resolution.test.ts`
ist entsprechend angepasst (`normalizedEmail` in jeder `winner`/`additionalMatches`-Zusicherung), ohne
neue Fälle — die bestehenden Tests beweisen weiterhin dasselbe Verhalten, nur mit dem vollständigeren
Objekt.

### 2. `content_sha256` ist die Identität, die `processEmail()`s Gates sehen — nicht der echte `Message-Id`-Header

ADR-010 warnt ausdrücklich vor der Divergenz zwischen `processEmail()`s `messageIdHeader`-Schlüsselung
und RFC §4.5s Hash-Dedupe. Der Backend-Adapter (`journal-archive-object-adapter.ts`) löst das, indem er
den `EmailObject.headers`-Eintrag `message-id` **synthetisch aus dem verifizierten
`contentSha256Hex`** baut (`<phase-b-sha256-<hex>@journal.internal>`) — nie aus dem tatsächlichen
Header der Nachricht. Ein Journal-Report mit gefälschtem oder fehlendem `Message-Id` dedupliziert damit
korrekt auf Objekt-Identität.

**Ein `null` von `processEmail()` wird nicht als „nichts zu tun" behandelt.** Der Adapter löst die
**bereits existierende** `archived_emails`-Zeile mit demselben Schlüssel auf, den Gate 1 benutzt hat,
und gibt `{kind: 'duplicate', archivedEmailId}` zurück — nicht nur `{kind: 'duplicate'}`. Grund: ein
Retry desselben Jobs (nach einem Absturz zwischen erfolgreichem Archivieren und der Indexierung) sieht
beim zweiten Versuch für **alle** Owner „bereits vorhanden" und würde ohne die Id nichts mehr
indexieren — die Nachricht bliebe archiviert, aber nie durchsuchbar. Mit der Id indexiert die Pipeline
jeden Owner **unbedingt**, ob frisch archiviert oder als Duplikat erkannt.

### 3. Spool-Freigabe ist Löschen, keine dritte Spool-Verzeichnisebene

`SpoolEntryReleaser.release()` (`packages/journaling/src/phase-b/spool-entry-releaser.ts`) löscht die
Spool-Datei per `fs.unlink`. Kein neues `SpoolFileSystem`-Verfahren (sechs bestehende Implementierungen
hätten eine neue Pflichtmethode für einen Concern gebraucht, der nur Phase B betrifft — dieselbe
Begründung, die `spool-entry-reader.ts` schon für den Lese-Port gab). Kein drittes Spool-Verzeichnis
neben `incoming/`/`quarantine/`: die Architektur dokumentiert keines, und die dauerhafte Aufzeichnung
nach erfolgreicher Phase B ist das archivierte Objekt plus die Ledger-Receipt, nicht die Spool-Kopie.
Aufgerufen **ausschließlich** als letzter Schritt von `runPhaseBPipeline()`, nachdem jeder Owner
archiviert (oder korrekt als Duplikat erkannt) **und** indexiert wurde — ein Fehler an jeder früheren
Stelle wirft, bevor die Datei je gelöscht wird.

### 4. Der Prozessor wirft für jeden Nicht-Erfolg — keine Rückgabe eines Fehlerwerts

`runPhaseBPipeline()` wirft (nie ein Ergebnisobjekt mit `success: false`) für: Gate-Ablehnung
(`PhaseBSpoolEntryRefusedError`, nach dem Alert), eine unlesbare Spool-Datei
(`PhaseBSpoolFileUnreadableError`), fehlende Owner-Konfiguration (`PhaseBOwnerConfigMissingError`) und
einen Archivierungsfehler (`PhaseBArchiveFailedError`). `journal-inbound.processor.ts` fängt das nicht
ab — ein rejecteter Promise lässt BullMQ den Job scheitern lassen, was `JR-6-04`s Reconciler und einen
Betreiber gleichermaßen lesen können. Diese Haltung ist keine neue Entscheidung, sondern die
Durchsetzung dessen, was `JR-6-01` schon für den Platzhalter-Prozessor festgelegt hatte.

### 5. `envelope_from`/`envelope_rcpt` mussten den Ledger-Lookup erneut verlassen

`LedgerEntryByTxId` (`JR-3-05`) trug diese beiden Felder nicht — der einzige bisherige Aufrufer
(Crash-Recovery) brauchte sie nicht. `parseJournalReport()`s NDR/Plain-BCC-Unterscheidung braucht aber
genau `envelope_from`s Null-Reverse-Path-Signal (RFC §5321.5.5). Erweitert um beide Felder (`?? null`
für fehlende Spalten, dieselbe Absicherung wie bei `content_sha256`/`size_bytes` in `JR-6-02a`) und bis
in `SpoolEntryArchive` durchgereicht — derselbe Fund, aus demselben Grund, den `JR-6-02a` schon einmal
für `eventType`/`content_sha256`/`size_bytes` gemacht hat: der Lese-Port wächst mit dem, was Phase B
tatsächlich braucht, nicht mit dem, was ein früherer Aufrufer zufällig schon abgefragt hatte.

### 6. Kein automatisierter Ende-zu-Ende-Test gegen echtes Meilisearch — mit einem manuellen Beleg statt eines geschätzten

**Zwei unabhängige Gründe, nicht nur einer:**

- **Die CI hat keinen Meilisearch-Service-Container.** `.github/workflows/ci.yml` startet `postgres`
  und `valkey` (seit `JR-6-01`), aber kein `meilisearch` — ein committeter Test, der echte Suche
  braucht, könnte in der CI grundsätzlich nicht laufen, unabhängig von jeder anderen Entscheidung.
  Einen Service-Container hinzuzufügen ist dieselbe Art Infrastrukturentscheidung wie `JR-6-01`s
  `valkey`-Container — eine, die dem Auftraggeber vorgelegt wird, nicht nebenbei in dieser Scheibe
  mitgezogen wird.
- **Die neuen Backend-Adapter hängen am Prozess-Singleton `db`**, genau wie `IngestionService` und
  jeder bestehende Service in `packages/backend` (keine Dependency Injection einer Datenbankverbindung
  — anders als `packages/journaling`, wo das die Regel ist). Der Test-Harness isoliert
  Integrationstests dagegen über `acquireTestDatabase()` in eine **eigene** Wegwerf-Datenbank je Datei.
  Beides gleichzeitig zu wollen — echte Adapter, echte Isolation — geht mit dem heutigen Zuschnitt
  nicht ohne eine Dependency-Injection-Änderung an `IngestionService`/`StorageService`, die über diese
  Scheibe hinausgeht.

**Was stattdessen steht:** ein manueller Lauf gegen echtes Postgres, echtes Meilisearch und das echte
Dateisystem (`docker-compose`-Infrastruktur dieses Hosts, `basic-journal-report.eml`-Fixture),
protokolliert im Sitzungsbericht — Fan-out auf drei Owner (`bob`/`carol`/`dave@contoso.com`), alle drei
archiviert, indexiert, per Volltextsuche nach `"Quarterly numbers"` mit drei Treffern gefunden, die
Spool-Datei nach Abschluss gelöscht. Das ist **einmal** demonstriert, nicht durch einen Lauf, den
irgendjemand wiederholen kann, ohne die Schritte von Hand nachzubauen — der Unterschied zwischen einem
Beleg und einem Test. Ob ein committeter Test diesen Grad an Beleg verdient (und mit welcher der beiden
oben genannten Änderungen), ist eine Entscheidung des Auftraggebers.

## ADR-035 — Der Ende-zu-Ende-Test wird automatisiert, gegen echtes Meilisearch, über die bestehende Harness-Bindung — kein DI-Umbau von `IngestionService`/`StorageService`

**Status:** **entschieden** (2026-08-05, `JR-6-02b`) · **Entscheider:** Auftraggeber, auf Vorlage von DEV
· **Quelle:** `03-backlog.md`s Akzeptanzkriterium von `JR-6-02`/`JR-6-08` („Ende-zu-Ende von der
Spool-Datei bis zum durchsuchbaren Treffer"), DEVs Sitzungsbericht zu `JR-6-02b`

**Entschieden: ein manueller, einmaliger Nachweis erfüllt das Akzeptanzkriterium nicht.** Er fängt
keine Regression und macht E6 ohne Weiteres nicht abnehmbar (`JR-6-08`). Der Test wird automatisiert
— `packages/backend/tests/integration/journal-phase-b-e2e.int.test.ts`.

### Die Weggabelung: DI-Umbau vs. Harness-Ausnahme — beide verworfen, eine dritte gefunden

DEVs Bericht zu `JR-6-02b` nannte zwei Wege: (i) `IngestionService`/`StorageService` um eine
injizierbare Datenbankverbindung erweitern, oder (ii) eine dokumentierte Ausnahme vom
Isolationsprinzip der Test-Harness (der neue Test liefe gegen die geteilte Wartungsdatenbank statt
gegen eine eigene, migrierte). Der Auftraggeber hat (i) vorgezogen — **eine Ausnahme vom
Isolationsprinzip wäre dauerhaft und würde die Aussagekraft jedes künftigen Integrationstests mit
verwässern, nicht nur die dieses einen; eine DI-Naht ist örtlich und testbar.**

**Bei der Umsetzung stellte sich heraus: (i) ist bereits vorhanden, nur ungenutzt.**
`packages/backend/tests/support/pg-harness.ts` hat seit `JR-1-04` genau diesen Mechanismus:
`harness.bindAsProcessDatabaseUrl()` setzt `process.env.DATABASE_URL` auf die isolierte, migrierte
Datenbank, **bevor** `src/database`s Singleton importiert wird — und ein per dynamischem `import()`
verzögerter Import von `IngestionService`/`StorageService`/den neuen Phase-B-Adaptern **nach** dieser
Bindung lässt deren `db`-Singleton korrekt gegen die isolierte Datenbank auflösen. `mongoToMeli()`,
`FilterBuilder` und `predefined-roles.int.test.ts` benutzen diesen Weg bereits. Kein Zeilenumbau an
`IngestionService`/`StorageService` — beide bleiben unverändert, wie ADR-010 es für `processEmail()`
schon verlangt.

**Konsequenz für die ursprüngliche Weggabelung:** Route (i) wird genommen, aber nicht als neue
Dependency-Injection-Naht, sondern als **Wiederverwendung** einer bereits bestehenden. Route (ii)
bleibt verworfen — die Begründung des Auftraggebers dagegen gilt unverändert, auch wenn (i) am Ende
billiger war als angenommen.

### Meilisearch in der CI — gemessen, nicht angenommen wie bei `valkey`

`JR-6-01`s `valkey`-Service-Container hat eine dokumentierte Einschränkung: ein Service-Container
nimmt kein `command`, und `valkey-server --requirepass …` ist genau das — der Broker läuft in der CI
deshalb ohne Passwort. Für Meilisearch **wurde geprüft, ob dieselbe Einschränkung zutrifft**, statt es
anzunehmen: `MEILI_MASTER_KEY` ist eine dokumentierte Umgebungsvariable
(`https://www.meilisearch.com/docs/learn/security/basic_security`), keine Kommandozeilenoption.
Gemessen an einem Container, der exakt so gestartet wurde, wie ein GitHub-Actions-Service-Container
ihn startet (`docker run -e MEILI_MASTER_KEY=... -p 7700:7700 getmeili/meilisearch:v1.38`, kein
`command`): `/health` antwortet ohne Schlüssel, `/indexes` antwortet `401` ohne Schlüssel, `403` mit
falschem Schlüssel, `200` mit dem richtigen. Authentifizierung ist damit in der CI **vollständig**
prüfbar — anders als bei `valkey`, keine Einschränkung zu dokumentieren.

`probeMeilisearch()` (`tests/support/infra.ts`) folgt demselben Muster wie `probeRedis()`: ein reiner
TCP-Connect, der nur Erreichbarkeit prüft, nie den Schlüssel. Eine falsche `MEILI_MASTER_KEY` erreicht
den Test deshalb als echter Fehlschlag beim tatsächlichen `SearchService`-Aufruf, nicht als Skip — F48
zum dritten Mal vermieden, nicht wiederholt.

### Was der Test beweist, und wie er kalibriert wurde

Dieselbe Kette wie der manuelle Nachweis (ADR-034 Punkt 6): Spool-Datei → Tor → Parsen →
Owner-Fan-out → `processEmail()` → Indexierung → Volltextsuche findet **jeden** aufgelösten Owner →
Spool-Datei danach gelöscht. Der Fan-out auf drei Owner (`bob`/`carol`/`dave@contoso.com`) ist Teil
der Zusicherung, nicht Kulisse — er ist der Grund, warum E5 existiert.

**Zweimal kalibriert, nach dem Muster von `JR-13-09c`:** ein Glied absichtlich entfernt, Rot gesehen,
zurückgenommen, Grün bestätigt.

1. Spool-Freigabe deaktiviert (`releaseSpoolEntry.release()` auskommentiert) → Test schlägt exakt an
   der Zusicherung „Spool-Datei ist gelöscht" fehl (`ENOENT` erwartet, Datei existierte noch).
2. Fan-out auf den Gewinner verkürzt (`ownerCandidatesOf(ownerResult).slice(0, 1)`) → Test schlägt
   exakt an der Owner-Liste fehl (`['bob@contoso.com']` statt aller drei).

Beide Male nach dem Zurücknehmen wieder grün, mit identischem `git diff` (keine Restspur der
Kalibrierung im committeten Code).

### Warum die Suchassertionen nach `ingestionSourceId` filtern statt Trefferzahlen zu zählen

Der Meilisearch-Index `emails` ist — anders als die Postgres-Datenbank — nicht je Testdatei isoliert:
lokal ist es derselbe Index wie jeder andere reale Lauf gegen dieselbe Meilisearch-Instanz (in der CI
dagegen frisch, weil der Service-Container keinen Zustand vom letzten Lauf trägt). Eine Zusicherung
„die Suche nach X liefert 3 Treffer" wäre heute wahr und in dem Moment falsch, in dem irgendetwas
anderes ein Dokument mit demselben Fixture-Text indexiert. Jede Zusicherung filtert deshalb auf die
`ingestionSourceId` dieses Laufs, und `afterAll` löscht die erzeugten Dokumente wieder — dieselbe
Disziplin, die `seedIngestionSource()` für Postgres-Zeilen schon anwendet.

### Konsequenz

- `packages/backend/tests/support/iam-seed.ts`s `seedJournalingSource()` bekommt ein optionales
  `organizationDomains`-Feld (Default `[]`, der Spaltendefault — kein bestehender Aufrufer ändert sein
  Verhalten).
- `.github/workflows/ci.yml` bekommt einen `meilisearch`-Service-Container plus
  `MEILI_HOST`/`MEILI_MASTER_KEY` im Job-`env:`.
- **Verworfen:** DI-Umbau von `IngestionService`/`StorageService` (unnötig, siehe oben) und die
  Harness-Ausnahme (Begründung des Auftraggebers bleibt gültig).

## ADR-036 — Doku-Diät (E6): Ausnahme von der Regel, dass Grundlagenarbeit auf den Integrationszweig gehört

**Status:** **entschieden** (2026-08-06) · **Entscheider:** Auftraggeber · **Grundlage:** ADR-032
Punkt 4, `CLAUDE.md` §7

Der Zweig `claude/journaling-e6-phase-b-worker` schöpfte ADR-Nummern ausschließlich aus **033–036**;
**033** ist mit der Owner-Auflösung für die schwächeren Parse-Ergebnisse vergeben, **034** mit der
Phase-B-Pipeline, **035** mit der Automatisierung des Ende-zu-Ende-Tests (alle oben). **036** war bis
zum 2026-08-06 nur reserviert; mit diesem Eintrag ist der Vorrat erschöpft — eine weitere Nummer für
E6 braucht eine neue Reservierung auf dem Integrationszweig.

### Die Regel, von der abgewichen wird

`CLAUDE.md` §7: „Grundlagenarbeit (Doku, ADRs, Agent-Infrastruktur) gehört direkt auf den
Integrationsbranch." Epic-Zweige tragen Epic-Arbeit, nicht Projektgedächtnis-Pflege — genau deshalb
kollidierten bei E4/E5s parallelen Zweigen ADR-Nummern, Befundnummern und Dateinamen gleichzeitig
(ADR-032).

### Die Abweichung

Die Doku-Diät vom 2026-08-06 (Fortsetzung der vom 2026-08-03) läuft **auf dem Epic-Zweig**, nicht auf
dem Integrationszweig.

### Begründung

`06-status.md` und `07-session-handover.md` — die beiden größten Ziele der Diät — werden von der
**laufenden** E6-Arbeit aktiv beschrieben und stehen nur auf dem Epic-Zweig im aktuellen Stand. Eine
Diät auf dem Integrationszweig hätte parallel zur E6-Arbeit denselben zwei Dateien gearbeitet und beim
Rückmerge einen Handkonflikt in genau den Dateien garantiert, die das Projektgedächtnis tragen — die
schlechteste denkbare Stelle für eine manuelle Konfliktauflösung. Das ist dieselbe Fehlerklasse, vor
der ADR-032 warnt (zwei Zweige, ein Vorrat), nur an Dateiinhalten statt an Nummernkreisen.

### Konsequenz

Diese Abweichung gilt **nur für diese Diät**. Reine Doku-/ADR-Arbeit ohne Überlappung mit laufender
Epic-Arbeit bleibt Grundlagenarbeit und gehört weiter auf den Integrationszweig, wie `CLAUDE.md` §7 es
verlangt. Reservierungen laufen mit der Abnahme des Epics aus; nicht gebrauchte Nummern fallen an den
allgemeinen Vorrat zurück.

## ADR-037 — Eigener `journal_event_type`-Wert für den `duplicate_of`-Marker

**Status:** **entschieden** (2026-08-06) · **Entscheider:** Auftraggeber · **Nummer reserviert** auf
dem Integrationszweig (`e8256f7`, Pool **037–040**, Grundlage und Anlass dort unter „ADR-037 bis
ADR-040 — Nachschub für E6" — dieser Abschnitt füllt sie, statt die Begründung zu wiederholen).

### Der Fehler, den diese Entscheidung schließt

Der `duplicate_of`-Marker aus `JR-6-03` (`5e9551f`) trug `event_type = 'receipt'`, weil der Enum keinen
anderen Wert kannte. Der einzige Diskriminator — `spool_txid is null` — stand nur in einem Doc-Comment,
nie erzwungen: die Form von **F46** (zwei Seiten stimmen über etwas überein, das niemand prüft). Jede
künftige Abfrage, die `receipt`-Zeilen gegen angenommene Nachrichten hält (`verify`, E9, wird das tun),
hätte für zwei Zustellungen drei Receipts statt zwei gezählt.

### Entschieden: eigener Enum-Wert per Migration, `duplicate_marker`

Gegen die Alternative „so lassen, Invariante schriftlich festhalten" — Begründung für den Zeitpunkt
(E7/E9 bauen auf der Semantik auf) steht in der Reservierung. Name **`duplicate_marker`**: sagt, was
die Zeile ist, ohne wie eine Receipt zu klingen.

### Migration

`0043_whole_meltdown.sql`: `ALTER TYPE "public"."journal_event_type" ADD VALUE 'duplicate_marker';` —
ein einzeiliger, additiver `ADD VALUE`, kein `DROP`/Rename. Lokal gegen eine frisch angelegte,
leere Datenbank geprüft (`pnpm db:migrate` dort, dann in einer **separaten** Verbindung ein Insert mit
dem neuen Wert): der neue Wert ist außerhalb der Migrations-Transaktion sofort benutzbar. Innerhalb der
Migration selbst wird er nirgends verwendet — die Datei tut nur die eine `ALTER TYPE`-Anweisung —, also
trifft die von Postgres dokumentierte „nicht in derselben Transaktion benutzbar"-Einschränkung diesen
Ablauf ohnehin nicht.

### Bestehende Zeilen bleiben unverändert — das ist korrekt, keine Lücke

`event_type` ist eines der 16 gehashten Felder (`JournalLedgerRecord` in
`packages/types/src/journal-ledger.types.ts`). Eine vor dieser Migration geschriebene Marker-Zeile hat
ihren `chain_hash` bereits über `event_type = 'receipt'` berechnet, und der Ledger ist Append-only
(ADR-009) — nichts daran wird nachträglich geändert, und nichts müsste: der Hash ist exakt so richtig
wie das Byte, das ihn erzeugt hat. Die Erweiterung wirkt nur **vorwärts**, auf den nächsten Marker, den
`runPhaseBPipeline()` schreibt. **Kein `FORMAT_VERSION`-Sprung nötig:** der kanonische Encoder
(`stringField(record.eventType, 'eventType')` in `packages/journaling/src/ledger/canonical-encoding.ts`)
hasht jeden String generisch — er hat keine feste Zuordnung von Event-Typ zu Byte-Code, der dieser Wert
beitreten müsste.

### Vokabular an drei Stellen nachgezogen (`CLAUDE.md` §5.4-Muster, hier auf `journal_event_type`)

1. `packages/backend/src/database/schema/journal-ledger.ts` — `journalEventTypeEnum` (Quelle der
   Wahrheit, per Migration erweitert)
2. `packages/types/src/journal-ledger.types.ts` — `JournalEventType`-Union
3. `packages/journaling/src/ledger/ledger-port.ts` — `LedgerAppendRequest['eventType']`

Punkt 3 war bis zu dieser Entscheidung eine **eigene, handkopierte** Literal-Union derselben sechs
Werte, nicht ein Import von `JournalEventType` — genau die Duplikation, die den fehlenden Wert
unbemerkt ließ. Behoben, nicht nur ergänzt: `ledger-port.ts` importiert jetzt `JournalEventType` aus
`@open-archiver/types` (die Abhängigkeit ist laut Architekturregel ohnehin erlaubt), also gibt es ab
jetzt nur noch **eine** TypeScript-Quelle für diese Liste, nicht zwei, die zufällig übereinstimmen.

### Zählende Verbraucher gefunden und bewertet

32 Dateien mit `event_type`/`'receipt'`-Treffern durchsucht (grep über das Repository). **Drei**
brauchten eine Änderung:

- `packages/journaling/src/phase-b/pipeline.ts` — der Marker selbst, `eventType: 'receipt'` →
  `'duplicate_marker'`.
- `packages/backend/tests/integration/journal-ledger-schema.int.test.ts` — `carries every declared
event type` erwartete die alten sechs Werte erschöpfend; jetzt sieben.
- `packages/backend/tests/integration/journal-phase-b-e2e.int.test.ts` — die `JR-6-03`-Zustellungsprobe
  filterte `event_type = 'receipt'` und erwartete drei Zeilen (die tragende Falle, die ADR-037 gerade
  behebt); jetzt zwei getrennte Abfragen, `receipt` erwartet **zwei**, `duplicate_marker` erwartet
  **eine** — die Zählung, die vorher zu hoch war, ist jetzt die Aussage, die der Test trifft.

Die übrigen 29 Treffer sind Fixture-Defaults (ein beliebiger gültiger Event-Typ für einen Testaufbau,
der nicht vom Marker handelt) oder Round-Trip-Prüfungen einer einzelnen, bekannten Zeile — keine
Zählung von `receipt`-Zeilen gegen angenommene Nachrichten, also unverändert richtig.

### Kalibriert

Beide geänderten Tests: Marker versehentlich wieder als `'receipt'` geschrieben →
`pipeline.test.ts` rot exakt an `expect(marker.eventType).toBe('duplicate_marker')`; die reale
Ende-zu-Ende-Probe (`journal-phase-b-e2e.int.test.ts`, echtes Postgres) rot exakt an
`expect(receiptRows).toHaveLength(2)` mit „got 3". Beide zurückgenommen, danach wieder grün.

### Für die Konfliktauflösung beim Rückmerge

`05-entscheidungen.md` ist jetzt auf **beiden** Seiten verändert: der Integrationszweig trägt die
Reservierung „ADR-037 bis ADR-040 — Nachschub für E6" (Status **reserviert**), dieser Zweig trägt den
oben gefüllten ADR-037-Abschnitt (Status **entschieden**). Beim Rückmerge gewinnt dieser Abschnitt; die
Reservierungstabelle auf dem Integrationszweig muss um 037 gekürzt werden (038–040 bleiben offen).

## ADR-038 — Der Reconciler ist ein wiederkehrender Job auf der bestehenden `journal-inbound`-Queue, kein eigener Prozess und nicht im `sync-scheduler`

**Status:** **entschieden** (2026-08-06, `JR-6-04`) · **Nummer:** aus dem nach ADR-032 reservierten
Kreis 037–040

**Die Frage.** Architektur §3 verlangt, dass ein Reconciler „periodisch" den Spool nach Einträgen
sweept, die einen Ledger-Eintrag haben, aber noch nicht Phase-B-fertig sind. Wo läuft dieses
„periodisch"? Drei Möglichkeiten standen offen: ein vierter Worker-Prozess, ein Job im bestehenden
`sync-scheduler.ts`, oder ein wiederkehrender Job auf der Queue, die der `journal-inbound`-Worker
schon bedient.

**Die Entscheidung: der dritte Weg.** `journalInboundQueue.add(JOURNAL_RECONCILE_JOB_NAME, {}, {
jobId, repeat })`, registriert vom `journal-inbound`-Worker unmittelbar nach dem Bau seines `Worker`,
mit einem zweiten `case` im Job-Dispatch.

**Warum nicht der `sync-scheduler`.** Er läuft nach der Prozesstabelle in `CLAUDE.md` §3 in **jeder**
OSS-Installation, unbedingt. Der Journaling-Empfänger ist dagegen **Opt-in** — genau deshalb steckt
der `journal-inbound`-Worker nicht in `pnpm start:workers` und `apps/smtp-ingress` nicht in
`start:oss`. Einen Sweep für ein Subsystem aus einem Prozess zu planen, den auch jemand fährt, der
das Subsystem nie ausgerollt hat, hätte diese Grenze aufgeweicht: der Job wäre in jeder Installation
registriert und liefe gegen einen Spool, den es dort nicht gibt.

**Warum kein eigener Prozess.** Er bräuchte dieselbe Postgres-Verbindung, dieselbe
Spool-Wurzel-Auflösung und dieselbe Shutdown-Behandlung wie der `journal-inbound`-Worker — und **F63
und F64 sind die gemessenen Kosten genau dieser Verdrahtung**, einmal schon bezahlt. Ein zweiter
Prozess hätte sie ein zweites Mal fällig gemacht, für eine Aufgabe, die pro Durchlauf eine gebündelte
Ledger-Abfrage und einen `readdir`-Walk kostet. Der Sweep teilt jetzt `ledgerLookup`, `spoolRoot` und
`ledgerSql` mit dem Prozess, der sie ohnehin hält, testet und beim Herunterfahren schließt.

**Der Preis, benannt statt entdeckt:** wer den `journal-inbound`-Worker nicht ausrollt, hat auch
keinen Reconciler — dieselbe Kette, die schon im Doc-Comment des Workers steht („Post, die angenommen
und nie archiviert wird"). Das Sicherheitsnetz hängt am selben Prozess wie die Arbeit, die es
absichert. Gegenmittel bleiben **E10** (Monitoring von Spool-Tiefe und Phase-B-Backlog) und **E11**
(Deployment-Verdrahtung).

**Zwei Eigenschaften, die die Entscheidung tragen und gemessen sind, nicht angenommen.**
`queue.add()` mit festem `jobId` und gleichem `repeat` ist idempotent — die Registrierung bei **jedem**
Worker-Start ist deshalb harmlos und braucht kein „genau einmal"-Verfahren. Und `add()` mit
deterministischer `jobId` ist ein **No-op**, solange BullMQ die Id kennt, auch im `failed`-Set: ein
Reconciler, der nur `add()` aufruft, hätte einen gescheiterten Job als „wieder eingereiht" gemeldet
und ihn für immer liegen lassen. Deshalb `retry()` für `failed`/`completed`, und deshalb prüft
`journal-spool-reconciler.int.test.ts` diese No-op-Eigenschaft **selbst**, statt sie aus der
Dokumentation zu zitieren.

**Der Sweep selbst ist bewusst dünn** und in `reconciler.ts`s Modulkommentar begründet:
`runExclusiveCrashRecoveryScan()` aus `JR-3-05`/`JR-4-18` plus eine Schleife. „Datei liegt in
`incoming/` und hat eine Ledger-Zeile" ist **genau** dessen `requeue`-Liste, weil eine Datei
`incoming/` erst mit `SpoolEntryReleaser.release()` am Ende einer erfolgreichen Phase B verlässt. Ein
zweiter Spool-Walk hätte die Sharding-, `readdir`- und Quarantäne-Race-Analyse von `JR-3-05`
verdoppelt, ohne etwas hinzuzufügen. **Exklusiv** und nicht der blanke Scan, weil dieser Sweep und der
Boot-Scan von `apps/smtp-ingress` jetzt wirklich aus zwei unabhängigen Prozessen gegen denselben Spool
laufen.

**Verworfene Nebenoption:** eine eigene Queue für den Sweep. Sie hätte einen eigenen Worker oder einen
eigenen `case` in diesem gebraucht — und der Reconciler braucht keine Isolation von den Jobs, die er
selbst einreiht.
