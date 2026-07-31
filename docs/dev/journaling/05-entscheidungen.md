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
chain_hash(0) = SHA256( "open-archiver:journal-ledger:v1:" || <deployment_id> || <chain_scope_id> )
```

> **Vorgabe aus ADR-007 (entschieden 2026-07-31):** `chain_scope_id` **muss** in den Genesis. Es gibt
> eine Kette je Mandant; ohne die Kennung im Genesis hätten zwei Ketten mit identischem erstem Ereignis
> denselben Hash, und ein Eintrag ließe sich zwischen Mandanten verschieben, ohne die Kette zu brechen.
> `chain_scope_id` **ist `ingestion_sources.id`** (ADR-007, ebenfalls am 2026-07-31 entschieden).

**Ebenfalls noch offen und Teil dieser ADR: woher kommt `deployment_id`?** Naheliegend ist ein einmalig
bei der ersten Migration erzeugter Wert in `system_settings` (die Tabelle existiert, `SettingsService`
liest sie). Zu klären ist, was passiert, wenn eine Installation aus einem Backup **geklont** wird:
dieselbe `deployment_id` in zwei Installationen bedeutet zwei divergierende Ketten mit gleichem Genesis.

**Warum es eine ADR braucht:** Eine Änderung der Kodierung invalidiert jede bestehende Kette. Das ist
ein Migrationsvorgang, keine Refaktorierung. Das Versionsbyte existiert genau deshalb.

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
4. **Ankern (E8) wird teurer und braucht eine Entscheidung.** Entweder ein TSA-Zeitstempel je Kette —
   kostenpflichtig je Mandant — oder **ein** Anker über einen Aggregat-Hash aller Kettenköpfe
   (Merkle-Wurzel oder kanonisch sortierte Liste `(chain_scope_id, seq, chain_hash)`). Vorschlag:
   Aggregat, weil es die Kosten unabhängig von der Mandantenzahl hält und derselben Konstruktion folgt,
   die RFC §5.2 für Shards vorsieht. **Zu entscheiden in E7/E8**, nicht jetzt — aber die Aggregatform
   muss ankerbar sein, bevor E8 beginnt.
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

**Konkretes Argument aus der Praxis — Befund F1** (siehe `09-befunde-bestandscode.md`): Über
Policy-Condition-Keys lässt sich heute rohes SQL in die `WHERE`-Klausel jeder gescopeten Abfrage
injizieren. Voraussetzung ist Super-Admin, es ist also keine unauthentifizierte Lücke — aber es ist
eine Eskalation von „Anwendungsadministrator" zu „beliebiges SQL". Ein solcher Akteur könnte
`journal_ledger` direkt manipulieren und jede anwendungsseitige Append-Only-Disziplin umgehen.

Daraus folgt für diese ADR: **Anwendungscode-Disziplin allein genügt nicht.** Die Einschränkung muss
auf Datenbank-Rechteebene wirken, und die Rolle, mit der die Anwendung verbindet, darf sie nicht
selbst aufheben können. Das spricht dafür, Rechteentzug **und** Trigger zu kombinieren, statt sich
für eines zu entscheiden.

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

**Status:** entschieden (2026-07-27) · **Entscheider:** DEV (im Rahmen von `JR-105a`)

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
`pnpm format` nachziehen. Das macht den künftigen CI-Job aus `JR-105` bei jeder Schema- oder
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

## ADR-016 — Fail-closed rechtfertigt den Verhaltensbruch aus `JR-1302`

**Status:** entschieden (2026-07-29) · **Entscheider:** PO · **Betrifft:** F7, F19, F20, `JR-1302`,
`JR-1307`, E11

> **Zur Nummer:** ADR-016 liegt zwischen ADR-015 und ADR-017, und das ist Absicht — **nicht
> umnummerieren.** ADR-017 wurde zuerst geschrieben, weil sie `JR-1302` blockierte; ADR-016
> beschreibt dessen Ergebnis und hat die Nummer reserviert bekommen. Die Reihenfolge der Nummern ist
> die Reihenfolge der Sachlogik, nicht die der Entstehung.

**Entscheidung:** `FilterBuilder.create()` antwortet für **jedes** Ergebnis mit deny, das kein
nachweislich **unbedingtes `can`** ist — kein passendes Recht, nur Verbote, ein widerrufenes Recht,
eine Bedingungsmenge, die sich nicht ausdrücken lässt. Der damit verbundene Verhaltensbruch wird
**hingenommen** und über einen Release-Hinweis samt Prüfanleitung begleitet (`JR-1307`), nicht über
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

**E11s Auditor-Rolle ist auf genau diesen Mechanismus gebaut.** `JR-1101` liefert eine Rolle, die
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
  Formen aus F19/F20 und `JR-1306`. Deshalb ist `JR-1307` eine Prüfanleitung mit SQL gegen
  `roles.policies` und keine Pauschalwarnung.
- Der Bruch ist **laut**, nicht still: ein deny fällt auf, eine leere Ergebnisliste ist auffindbar.
  Der Zustand davor war das Gegenteil.

### Konsequenz

- `JR-1307` liefert Release-Hinweis und Prüfanleitung in der **öffentlichen** Doku
  (`docs/user-guides/upgrade-and-migration/access-control-changes.md`), englisch nach ADR-003, samt
  der getesteten SQL. Die Prüfanleitung ist Teil dieser Entscheidung, nicht Beigabe: der Bruch ist
  nur deshalb vertretbar, weil er vorab feststellbar ist.
- Wer die alte Semantik zurückholen will — auch als Schalter —, braucht eine ADR, die diese ersetzt.
- Die Anleitung darf **nicht** als „vollständig geprüft" gelesen werden: der Restspalt aus ADR-019
  (ein Key, der nur die Spaltenexistenz verletzt) fällt weiter erst zur Abfragezeit auf und ist als
  `JR-1311` geführt.

## ADR-017 — Action-Versatz zwischen Route-Gate und `FilterBuilder`

**Status:** entschieden (2026-07-29) · **Entscheider:** Auftraggeber · **Betrifft:** F7, `JR-1302`,
`JR-1303`

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
Änderung. Der Nachweis dafür ist der Integrationstest aus `JR-1301`, nicht diese Tabelle.

### Nachtrag 2026-07-29 — nachgemessen in `JR-1301`, zwei Einschränkungen

Die Entscheidung bleibt Variante B, und sie ist jetzt **belegt statt hergeleitet**:
`tests/integration/predefined-roles.int.test.ts` legt die drei Rollen über Produktionscode an und
zeigt, dass `('archive','read')` und `('archive','search')` je Rolle **identischen** Filtertext,
identische Bind-Parameter und identischen Meili-Filter ergeben. `JR-1303` ist damit für eine
Standardinstallation nachweisbar wirkungsfrei — unabhängig davon, was `JR-1302` mit dem `null`-Zweig
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
`JR-1307`s Betreiberanleitung muss den Sachverhalt aber benennen, sonst sucht ein Betreiber nach
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
`JR-1310` nach E13 vorgemerkt**, ausdrücklich nicht Teil von E13s Abnahme.

### Konsequenz

- `JR-1303` ist damit entschieden und gibt `JR-1302` frei.
- `JR-1301` muss die gewählte Semantik fordern: der Filter für eine Rolle mit bedingtem
  `search archive` entsteht aus deren `search`-Regeln.
- Wer diese Entscheidung umkehren will, braucht eine neue ADR, die diese ersetzt — keine stille
  Änderung des dritten Arguments.

## ADR-018 — Ein unübersetzbarer Zweig wird verweigert, nicht durch ein Sentinel ersetzt

**Status:** entschieden (2026-07-29) · **Entscheider:** PO · **Betrifft:** F3, F22, `JR-1304`,
`JR-1301`

`mongoToDrizzle` **wirft**, wenn eine Policy-Bedingung nicht übersetzbar ist. Es gibt **keinen**
milden Modus, und ein verworfener Zweig wird **nicht** durch ein „never-true"-Prädikat je Zweig
ersetzt.

**Anlass:** Nach den Fixes `JR-1302`–`JR-1306` blieb genau ein roter Test übrig, und zwar nicht
wegen eines fehlenden Fixes, sondern weil zwei Erwartungen aus `JR-1301` sich widersprachen:

| Ort                                             | Eingabe                                       | Forderung                                        |
| ----------------------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| `src/helpers/mongoToDrizzle.test.ts:227`        | `{ $or: [{id:'a'}, {subject:{$regex:'x'}}] }` | fail-closed, und **nicht** `"id" = $1`           |
| `tests/integration/filter-builder-f1-f3.int.ts` | strukturell identisch                         | ein Prädikat, unter dem `rows.mine` sichtbar ist |

Beide trugen `RED UNTIL JR-1304`. Unabhängig nachgemessen: die beiden sind **unter jeder
Implementierung** unvereinbar — es gibt keine prinzipielle Regel, die `{id:'a'}` anders behandelt als
`{userEmail:…}`, beide sind Gleichheit auf einer erlaubten Spalte.

**Entscheidung: die Unit-Erwartung gilt, die Integrationszeile war falsch.** Drei Gründe:

1. `JR-1304`s Kriterium lautet „kein Zweig wird stillschweigend weggelassen" und nennt das `$or`
   ausdrücklich. Die Integrationszeile forderte genau dieses Weglassen.
2. **Das Sentinel-Verfahren ist unsicher.** `FilterBuilder.ts:84` setzt jede `cannot`-Bedingung unter
   ein `$not`. Ein „never-true" je verworfenem Zweig ergibt dort `not(false)` = **wahr**: ein
   vakuumer Konjunkt, das Verbot ist weg. Gemessen am Übersetzer vor `JR-1304`:
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
Fehler ist auffindbar, ein falsches Ergebnis nicht. `JR-1307` muss es in der Betreiberanleitung
nennen.

## ADR-019 — Die Key-Allowlist prüft Form und Relation, nicht Spaltenexistenz

**Status:** entschieden (2026-07-29) · **Entscheider:** PO · **Betrifft:** F1, F21, `JR-1306`,
`JR-1311`

Die in `JR-1306` gebaute Allowlist lässt einen Key durch, wenn er **formal** eine Spaltenreferenz ist
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

**Konsequenz:** Der Restspalt wird als **`JR-1311`** geführt, nicht offen gelassen — spaltengenaue
Prüfung in `FilterBuilder.create()`, das `resourceType` bereits als Parameter hat. Unabhängig von
`JR-1310`; Variante C wird dafür nicht gebraucht. Bis dahin gilt: **ein Tippfehler in einer Policy
fällt beim Anlegen auf, wenn er die Form verletzt, und erst zur Abfragezeit, wenn er nur die
Spaltenexistenz verletzt.**

## ADR-020 — Betreiberdokumentation sagt, was sie meldet, nie was sie garantiert

**Status:** entschieden (2026-07-29) · **Entscheider:** PO · **Betrifft:** F27, F30, `JR-1307`,
`JR-1314`, `JR-1317`

Eine Prüfanleitung für Betreiber beschreibt **die Befunde, die sie meldet**. Sie behauptet **keine
Vollständigkeit** über Daten ohne festes Schema. Sätze der Form „es prüft rekursiv alle …", „ein
leeres Ergebnis heißt, dass keine Rolle betroffen ist" oder „diese Klasse ändert sich in diesem
Release nicht" sind in `docs/user-guides/upgrade-and-migration/access-control-changes.md` unzulässig.

**Begründung — zwei Ablehnungen derselben Klasse.** E13 ist zweimal an der betreibersichtbaren Hälfte
gescheitert, und beide Male an einem **positiven Abdeckungssatz**, nicht am Code:

| Runde      | Befund  | Widerlegter Satz                                                         | Gefundene Form                            |
| ---------- | ------- | ------------------------------------------------------------------------ | ----------------------------------------- |
| `JR-1309`  | **F27** | „No rows means no role … is affected"                                    | `conditions: 5` (Skalar an der Wurzel)    |
| `JR-1309a` | **F30** | „walked recursively … the empty object" · „not one this release changes" | `{"$or": [{…}, {}]}`, `{"userEmail": {}}` |

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
billige Erweiterung wird trotzdem mitgenommen (`JR-1317` (a)) — sie ist eine Verbesserung, nur keine
Grundlage für eine Zusage.

**Konsequenz:** `JR-1316` (Regressionstest für diese Abfragen) bleibt nach E13 und ist damit eine
Verbesserung statt einer Abnahmevoraussetzung — genau deshalb war es richtig, ihn aus E13 zu nehmen.
Wer künftig einen Abdeckungssatz in diese Seite schreibt, braucht eine ADR, die diese ersetzt.

### Berichtigung (2026-07-29, nach der Abnahme `JR-1309b` — F31)

**Der Satz „Diese Prüfung ist vollständig, weil sie das Verhalten misst statt die Datenform zu raten"
ist gestrichen. Er war selbst ein Abdeckungssatz** — derselbe, den diese ADR verbietet, nur über den
Verhaltenscheck statt über die Abfrage. Der Fehler liegt damit **in dieser ADR**, nicht in ihrer
Umsetzung: `JR-1317` hat den Anspruch folgerichtig auf die Betreiberseite übernommen
(`access-control-changes.md:621–623`, `:498–500`, `:631–632`), und `JR-1309b` hat ihn dort widerlegt.

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
Knotenebene aus `JR-1317` (a) bleiben richtig und sind in `JR-1309b` unabhängig belegt (alle acht
F30-Formen gemeldet, keine Falsch-positiven). Umgesetzt wird die Berichtigung in **`JR-1318`**.

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

| Runde      | Gebrochen an | Artefakt                 | Der Autorisierungscode |
| ---------- | ------------ | ------------------------ | ---------------------- |
| `JR-1309`  | F27, F29     | Prüf-SQL + Betreibertext | hielt                  |
| `JR-1309a` | F30          | Prüf-SQL + Betreibertext | hielt                  |
| `JR-1309b` | F31          | Betreibertext            | hielt                  |

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
