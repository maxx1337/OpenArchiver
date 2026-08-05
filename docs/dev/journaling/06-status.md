# Status

**Diese Datei ist die verbindliche Fortschrittsquelle.** Sie wird am Ende **jeder** Session
aktualisiert — auch wenn nichts fertig wurde. Ein nicht aktualisierter Status ist schlimmer als
keiner, weil er Fortschritt behauptet, der nicht existiert.

Legende: `[ ]` offen · `[~]` in Arbeit · `[x]` fertig und abgenommen · `[!]` blockiert

**Letzte Aktualisierung:** 2026-08-04 (**E4 und E5 sind abgenommen und zurückgemergt** — E5 mit
`JR-5-09`/`107346d`, E4 mit `JR-4-13`/`9503bc8`. Volllauf gegen den gemergten Baum: **1181 Tests** bei
95 Dateien, `unit ci 991 · integration ci 121 · adversarial ci 69`, CI-Lauf `30967766605` **success**.
Beim Rückmerge sind drei Nummernkreise kollidiert und nach **ADR-032** aufgelöst worden.
**Nächstes Epic: E6**) · **Branch:** `claude/enterprise-product-implementation-cxmmqe`
(Integrationsbranch; E1, E13, E2, E3, E5 und E4 sind zurückgemergt)

> **Am 2026-08-01 zusätzlich entschieden: `ADR-025` — der Fork wird weitergeführt.** Die Frage des
> Auftraggebers, ob angesichts einer kostenpflichtigen Upstream-Lizenz eine eigenständige Anwendung
> sinnvoller wäre, ist geprüft und verneint. Die Lizenzannahme („§12/§13 verbieten Deployments für
> Endkunden") hielt nicht stand — AGPL §13 ist eine **Angebotspflicht**, kein Verbot. Zwei Dinge
> ändern sich daraus für die tägliche Arbeit: die Abhängigkeitsregel in `02-architektur.md` §2 gilt
> jetzt **beidseitig** (Journaling-Logik darf nicht in `packages/backend` entstehen, damit die
> Herauslösung eine Verpackungsentscheidung bleibt), und die **Fork-Divergenz wird ab sofort
> gemessen** (`08-risiken.md` R-19, Ausgangswerte unter „Upstream-Merges" weiter unten).

### Upstream-Merges

Gegenmaßnahme zu **R-19**. Je Merge von `main` in den Integrationsbranch wird hier eine Zeile
ergänzt — nach ADR-014 ist das der einzige erlaubte Ort für einen Upstream-Merge, der Aufwand fällt
also gebündelt an derselben Stelle an.

| Datum      | Upstream-Version | Konfliktdateien  | Aufwand | Tests danach                       | Bemerkung                                                                                                                                            |
| ---------- | ---------------- | ---------------- | ------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-01 | `a560b8c` v0.5.2 | — (Ausgangswert) | —       | 398 passed / 2 skipped, 30 Dateien | Noch kein Merge nötig: `origin/main` ist identisch mit Upstream-`main`, und der Integrationsbranch ist 88 Commits voraus bei **0** Commits Rückstand |

**Ausgangsmessung der Konfliktfläche** (`e808898` gegen `origin/main`): 115 berührte Dateien, davon
**94 neu angelegt** und nur **21 geänderte Bestandsdateien**. Die 21 sind die Zahl, die zählt; sie
ist klein, weil ADR-002 fast alles in neue Dateien zwingt. Zwei davon sind die wahrscheinlichsten
Konfliktpunkte, weil Upstream sie bei jeder eigenen Migration ebenfalls anfasst:
`packages/backend/src/database/migrations/meta/_journal.json` und
`packages/backend/src/database/schema.ts`. Kollidiert einer von beiden, ist vor dem Auflösen gegen
`pnpm db:migrate` auf einer frischen Datenbank zu prüfen — ein grüner `pnpm build` genügt dort
nicht.

> **`JR-2-08` und `JR-2-09` sind erledigt (Rolle TEST, 2026-08-01), und die wichtigste Zeile ist keine
> Testzahl:** `JR-2-08` hat **F38** gefunden — der Writer speicherte `event_payload` doppelt JSON-kodiert,
> sobald der postgres-js-Client nicht durch `drizzle()` gelaufen war. Nichts schlug beim Schreiben fehl;
> unverifizierbar geworden wäre **jede** Ledger-Zeile mit Nutzlast, und aufgefallen wäre es erst mit
> `verify` in E9. Der Grund, warum acht Integrationstests darüber hinweggelaufen sind: sie schreiben alle
> durch `harness.sql`, den einzigen Client im Repository, den drizzle gepatcht hat — der Ingress-Prozess
> aus E3/E4 wird drizzle per Architekturvorgabe **nicht** haben. Behoben mit `$16::text::jsonb` (ein
> einfaches `::jsonb` genügt **nicht**, gemessen), Regressionsfall prüft `jsonb_typeof` direkt.
>
> **`JR-2-08`:** 10 000 Appends durch 20 nebenläufige Writer in 84–96 s (≈120/s) auf einem eigenen Pool mit
> einer Verbindung je Writer — mit dem `max: 4` des Harness wäre die Konkurrenz im Treiber ausgetragen
> worden statt in Postgres. `seq` genau 1…10 000, die Kette **über alle** Zeilen neu gerechnet, 10 000
> verschiedene Vorgängerhashes. Der Rollback-Fall läuft **unter Last** (8 Writer × 100 Commits gegen 4 ×
> 25 Rollbacks in dieselbe Kette): 800 Zeilen, keine Lücke — die Eigenschaft, für die `max(seq)+1` statt
> einer Sequenz gewählt wurde. Und eine **Gegenprobe**: derselbe Lastfall gegen einen Transactor, der das
> `pg_advisory_xact_lock`-Statement verschluckt, bricht (19 von 20 Appends scheitern). Ohne sie könnte der
> Lasttest grün sein, weil sich die Appends nie überlappt haben.
>
> **`JR-2-09`:** alle acht Fälle aus Testplan §12.5. Drei davon lassen die Kette **absichtlich heil**, und
> das ist die eigentliche Aussage: eine ab `seq` N vorwärts neu geschriebene Kette ist in sich makellos
> (nur der vorher genommene Anker sieht sie), eine vollständig gelöschte Mandantenkette hinterlässt nichts,
> was brechen könnte (nur der Vergleich zweier Merkle-Anker meldet sie), und ein Klon erzeugt zwei gültige
> Ketten aus demselben Genesis (**Split-Brain**, eigene Befundart, kein Kettenbruch). Die Fälle (f) und (g)
> stehen gegen eine **mitgelieferte Implementierung der RFC-Formel**, unter der beide unentdeckbar bleiben
> — Testplan §12.5 verlangt, sie „zuerst rot gesehen" zu haben, und so läuft dieser Nachweis auf jedem
> CI-Lauf statt einmal von Hand. Der Append-Only-Trigger wird gezielt abgeschaltet und **nachweislich**
> wieder aktiviert; ein eigener Fall zeigt, dass er dieselbe Manipulation abweist, solange er an ist.

> **`JR-2-07` ist erledigt (Rolle DEV, 2026-07-31): die Steckbarkeit ist belegt, nicht bewertet.** Das
> Akzeptanzkriterium lautete „(b) nicht implementiert, aber ohne Signaturänderung nachrüstbar" — eine
> Aussage über den Port, und eine solche Aussage ist so viel wert wie ihr Beleg. Also gibt es jetzt **eine**
> Vertragssuite (`tests/support/ledger-backend-contract.ts`), die **nur die Rückgabewerte** von `append()`
> prüft — `seq`, `prevChainHash`, `chainHash` **sind** die Kette; wo die Bytes liegen, ist Sache der
> Implementierung —, und sie läuft **zweimal**: gegen `PostgresLedgerWriter` und gegen ein Backend ohne
> jede Datenbank. Beide grün ⇒ nichts Postgres-spezifisches ist in den Port geleckt. Wäre etwas geleckt,
> ließe sich die zweite Implementierung nicht schreiben, und genau das ist das Signal, das die Task
> verlangt. **Der Nebenläufigkeitsfall hat nachweislich Zähne:** dasselbe Backend ohne Sperre forkt die
> Kette (alle 12 parallelen Appends lesen denselben Kopf und beanspruchen `seq` 1) — ohne diese Gegenprobe
> hätte der Fall auch eine Laufzeit-Eigenschaft statt einer Sperre beobachten können, weil ein
> einthreadiger Runtime ohne `await` zwischen Kopf-Lesen und Schreiben von selbst serialisiert. **Ehrlich
> benannt ist die Grenze:** der Vertrag prüft die **Signatur**, nicht die Durability — das In-Memory-Backend
> besteht ihn und ist nur so lange durabel wie der Prozess. Was (b) darüber hinaus schuldet, steht als
> Pflichtenliste in `ledger-port.ts` (fsync auf Datei **und** Verzeichnis, prozessübergreifende
> Serialisierung, kein `seq` bei Fehlschlag, Crash-Recovery-Scan, `verify`-Lesbarkeit). Volllauf:
> **383 passed | 2 skipped** bei 28 Dateien, Exit 0.

> **`JR-2-06` ist erledigt (Rolle DEV, 2026-07-31): `PostgresLedgerWriter.append()`.** Die Reihenfolge aus
> RFC §5.2 vollständig: `SET LOCAL synchronous_commit = on` → `pg_advisory_xact_lock` aus der
> Kettenkennung → Kopf lesen → `seq` ableiten → Hash **innerhalb** der Sperre → `INSERT`. Das
> Akzeptanzkriterium „außerhalb der Sperre unmöglich, strukturell" ist über den **Typ** gelöst:
> `LedgerAppendRequest` hat kein Feld für `seq`, `prevChainHash` oder `chainHash` — zwei der drei
> Hash-Eingaben sind erst unter der Sperre bekannt, und für ein vorberechnetes Ergebnis gibt es keinen
> Platz. **Der stärkste Test rechnet die Kette aus der Datenbank neu** und ist damit ein Mini-`verify`:
> jeder Wert gelesen, neu kodiert, neu gehasht, gegen die gespeicherte `chain_hash` verglichen. **Dabei
> ein eigener Testfehler gefunden, der eine wichtige Falle für E9 ist:** `select seq::text as seq … order
by seq` sortiert **lexikographisch** (1, 10, 2, …), weil das Alias die Spalte überschattet — der Test
> meldete einen Kettenbruch, den es nicht gab. Die Umkehrung ist die gefährliche: eine falsche
> Leseordnung kann einen echten Bruch verdecken. Volllauf: **370 passed | 2 skipped** bei 26 Dateien,
> Exit 0.

> **`JR-2-05` ist erledigt (Rolle DEV, 2026-07-31) und ADR-009 entschieden: Trigger jetzt, Rechteentzug in
> E11** — Entscheidung des Auftraggebers. Migration `0042_journal_ledger_append_only.sql` mit einer
> `plpgsql`-Funktion und **vier** Triggern: je Tabelle `UPDATE OR DELETE` (row level) und **`TRUNCATE`**
> (statement level). Der `TRUNCATE`-Trigger ist Pflicht, weil `TRUNCATE` keine Row-Trigger auslöst — ein
> reiner Row-Trigger hätte eine Anweisung offen gelassen, die den ganzen Ledger entfernt. Gemessen gegen
> PostgreSQL 17.10: alle sechs Mutationen abgewiesen (`23001`), `INSERT` weiterhin erlaubt.
> **Neuer Befund F37, gemessen statt vermutet:** die Anwendung verbindet in einer Standardinstallation als
> **Superuser und Tabelleneigentümer** (`POSTGRES_USER=admin` in `docker-compose.yml` und `.env.example`,
> `DATABASE_URL` daraus gebildet) und kann den Trigger daher mit
> `SET session_replication_role = replica` oder `ALTER TABLE … DISABLE TRIGGER` selbst abschalten —
> beides erfolgreich ausgeführt. Was der Trigger **heute** leistet: er schließt **F1** als
> Manipulationsweg, weil eine `WHERE`-Klausel-Injection kein `SET` und kein `ALTER TABLE` absetzen kann.
> Volllauf: **348 passed | 2 skipped** bei 24 Dateien, Exit 0.

> **`JR-2-04` ist erledigt (Rolle DEV, 2026-07-31): `0041_even_scream.sql`.** `journal_ledger` mit 18
> Spalten, zusammengesetztem Primärschlüssel `(chain_scope_id, seq)`, sechs `CHECK`-Constraints, zwei
> Fremdschlüsseln und zwei Indizes; dazu `deployment_identity` mit genau einer Zeile, in der Migration
> per `gen_random_uuid()` erzeugt. **Das Akzeptanzkriterium ist belegt:** ein Zeitstempel mit
> Mikrosekundenanteil wird von `journal_ledger_received_at_whole_ms` abgewiesen, gegen echtes Postgres
> 17.10. **Beim Testschreiben ein Schemaloch gefunden und geschlossen:** der zusammengesetzte
> Fremdschlüssel auf `(chain_scope_id, duplicate_of)` verhindert den **Selbstverweis nicht**, weil
> Postgres Referenzintegrität am Statement-Ende prüft und das referenzierte Paar dann die gerade
> eingefügte Zeile ist — eine Quittung wäre ihr eigenes Original geworden. Der zusätzliche CHECK
> `duplicate_of < seq` schließt das und formuliert die eigentliche Regel. Volllauf: **340 passed |
> 2 skipped** bei 23 Dateien, Exit 0.

> **`JR-2-01` und `JR-2-02` sind erledigt (Rolle DEV, 2026-07-31) — der erste Produktionscode des
> Projekts.** `packages/journaling` existiert, hängt nur an `@open-archiver/types` (per `grep` belegt), und
> `src/ledger/` enthält die kanonische Kodierung samt Merkle-Kodierung nach ADR-006. **Die Testvektoren
> der ADR sind getroffen** — Genesis, Recordlänge 351, `SHA256(record)`, `chain_hash(1)` und die Wurzeln
> über 1/2/3 Blätter, alle byteidentisch zu den Werten, die vor dem Code entstanden sind. Volllauf:
> **324 passed | 2 skipped** bei 22 Dateien, Exit 0, `unit: ci 266/266 · integration: ci 55/55 ·
adversarial: ci 3/3`. Der stärkste der 50 neuen Tests ist der, der **jedes** der 16 Felder einzeln
> mutiert und einen anderen Kettenhash verlangt: unter der RFC-Formel wären fünf dieser Mutationen
> unentdeckbar. Zwei eigene Testfehler sind dabei aufgefallen und behoben — `toUpperCase()` auf einer
> UUID aus reinen Ziffern ist ein No-op, die Prüfung „lehnt Großschreibung ab" hätte also leer bestanden.

> **`JR-2-03` ist erledigt (Rolle PO, 2026-07-31): ADR-006 entschieden.** Festgelegt sind die Bytes der
> kanonischen Kodierung, der Genesis-String, die Herkunft der `deployment_id`, das Verhalten beim Klonen
> einer Installation und die Merkle-Kodierung des Ankers. Alle Werte in der ADR sind mit einer
> Referenzimplementierung **gemessen**; sie enthält reproduzierbare Testvektoren, die `JR-2-02` treffen
> muss. Drei Festlegungen sind mehr als Formalitäten: **(a)** die Feldliste aus RFC §5.2 war
> **unvollständig** — sie hasht acht Spalten und lässt `remote_ip`, `tls_version`, `tls_cipher`,
> `ehlo_name` und `duplicate_of` außen vor, die damit nachträglich änderbar wären, ohne die Kette zu
> brechen; die Kodierung deckt jetzt alle **16** wertetragenden Spalten ab. **(b)** `deployment_id` liegt
> in einer **eigenen** Tabelle, nicht in `system_settings` — letztere ist über die Einstellungs-API
> schreibbar, ein `PUT` darauf hätte jede Kette unverifizierbar gemacht. **(c)** der ungerade
> Merkle-Knoten wird **hochgezogen** (RFC 6962), nicht dupliziert: bei der Duplizier-Regel liefern
> `[A,B,C]` und `[A,B,C,C]` dieselbe Wurzel, gemessen, was ADR-022 Festlegung 1 aufgehoben hätte.
> **Kein Code geändert.**

> **E13 ist abgenommen (2026-07-30, `JR-13-09c`).** Vier Abnahmerunden, drei Ablehnungen (F27/F28/F29 →
> F30 → F31), dann die Annahme. Der Prüfer hat ohne DEV-Bericht gearbeitet und **jede** Zahl selbst
> gemessen. Der einzige Vorbehalt seines Berichts — ein vermuteter neuer Befund an der Prettier-Prüfung
> — ist vom PO **nachgemessen und widerlegt** worden (siehe **F36** in `09-befunde-bestandscode.md`);
> er ist reines F35 (CRLF) und kein zusätzlicher Defekt. Damit steht die Annahme ohne Einschränkung.

> **`JR-13-17` ist erledigt (Rolle `senior-dev`, 2026-07-29) — die letzte inhaltliche Task von E13.**
> (a) Query 2 der Betreiberseite stellt die zwei Formbefunde auf **Knotenebene** (aus der rekursiven CTE
> `cond` statt aus `pair`, mit einer Positionsangabe je Befund): alle **acht** F30-Formen werden
> gemeldet, die Gegenproben weiter, und die drei `predefined_*`-Rollen plus acht Kontrollen schweigen in
> **jeder** Ausgabe — maschinell verglichen, Blöcke wörtlich aus der `.md` gegen PostgreSQL 16.13.
> (b) **Der Abdeckungsanspruch ist entfernt** (ADR-020): „It examines" ⇒ „What it reports", kein
> „recursively" als Zusage, der widerlegte Satz zu „the values inside a condition" ersetzt, ausdrücklich
> ergänzt, dass eine Abfrage über schemaloses JSONB **nicht als vollständig gezeigt werden kann** und ein
> leeres Ergebnis ein **Hinweis, keine Freigabe** ist, plus eine **verifizierbare Gegenprobe ohne
> Formliste** (je Rolle zwei Zahlen vor/nach dem Update vergleichen). Vier weitere Abdeckungssätze
> derselben Klasse standen auf der Seite und sind mit ersetzt. **Kein Produktionscode, kein Test, keine
> Migration**; Suite unverändert `250 passed | 2 skipped`, Exit 0. Details unten unter „`JR-13-17`
> erledigt" und in `09-befunde-bestandscode.md` unter **F30**.

> **`JR-13-09` ist durchgeführt. Ergebnis: E13 ist NICHT abgenommen.** Die fünf Codekorrekturen sind
> unabhängig belegt — Injektionsweg an beiden Gates zu (12 Nutzlasten inkl. Umgehungsversuchen, 0
> fremde Zeilen), `FilterBuilder` fail-closed auf Zeilenebene, **23** Regressionstests ohne den Fix rot
> und mit ihm grün, `224 passed | 2 skipped` auch auf PostgreSQL 17.10 in der CI. Gebrochen ist die
> **betreibersichtbare Hälfte**: **`JR-13-07`** (die Prüf-SQL findet eine Form nicht, die von „sieht
> alles" auf „sieht nichts" umschlägt — **F27**; Tippfehler unter `manage all` ebenfalls nicht —
> **F28**) und **`JR-13-06`s** letztes Kriterium (der `PolicyValidator` weist den Relationszweig beim
> Anlegen **nicht** ab, entgegen der veröffentlichten Doku — **F29**). Fünf neue Befunde: **F25**–**F29**.
> Vollständige Tabelle je Kriterium unten unter „Abnahme `JR-13-09`". **Kein Rückmerge.**
>
> `JR-13-01` (rote Tests), `JR-13-03`, `JR-13-02`, `JR-13-04`, `JR-13-05`, `JR-13-08` sind abgenommen;
> `JR-13-06` bis auf ein Kriterium; `JR-13-07` abgelehnt.
>
> **Der eine zuletzt verbliebene rote Test war ein Widerspruch in `JR-13-01` selbst**, kein fehlender
> Fix: zwei Erwartungen mit demselben `RED UNTIL JR-13-04`-Tag forderten für strukturell gleiche
> Eingaben Unvereinbares. Entschieden in **ADR-018** (die Unit-Erwartung gilt; ein unübersetzbarer
> Zweig wird verweigert, nicht durch ein Sentinel ersetzt), korrigiert in `704e8d1` und in beide
> Richtungen mutationsgeprüft.
>
> **Dabei ist eine Aussage von mir korrigiert worden**, die ich am selben Tag selbst geschrieben
> hatte: „im `$or` nur verengend" (F22) gilt **nur** oben in einer `can`-Komposition. Unter dem `$not`,
> wohin `FilterBuilder.ts:84` **jede** `cannot`-Bedingung setzt, ist derselbe Wegfall **fail-open** —
> `not A` ist wahr für jede Zeile, die der verlorene Zweig verbieten sollte. Richtig ist der unbedingte
> Satz: ein weggelassener Zweig ist nie harmlos.
>
> **ADR-019** hält eine Einschränkung meiner F21-Entscheidung fest: die Key-Allowlist prüft Form und
> Relation, **nicht** Spaltenexistenz. Der Injektionsweg ist zu (zweifach: `PolicyValidator` beim
> Anlegen, `mongoToDrizzle` zur Abfragezeit, `sql.raw` entfernt); der Restspalt ist ein
> Policy-Schreibfehler und wird als **`JR-13-11`** geführt.
>
> > **Nachtrag aus `JR-13-09`:** die Aussage „zweifach" ist zu grob. Für Keys mit SQL-Syntax stimmt sie
> > und ist gemessen. Für Keys, die **nur** die Relation oder die Segmentzahl verletzen
> > (`attachment.name`, `a.b.c`, `foo.bar`), greift **nur** `mongoToDrizzle` — der `PolicyValidator`
> > lässt sie durch (**F29**). Fail-closed, also kein Angriffsweg, aber die veröffentlichte Doku
> > behauptet das Gegenteil, und `JR-13-06`s letztes Kriterium ist damit nicht erfüllt.
>
> **ADR-017s Wirkungsanalyse hält** — belegt statt hergeleitet, mit zwei benannten Einschränkungen
> (**F17**, **F18**). Acht neue Befunde: **F17–F24**; behoben sind **F19**, **F20** (und **F1**,
> **F3**, **F7**, **F8**, **F22**), offen bleiben **F17**, **F18**, **F23**, **F24**. Aus der Abnahme
> `JR-13-09` kommen **F25–F29** hinzu, alle offen.
>
> `predefined-roles.int.test.ts` ist **grün geblieben** (alle 7 Fälle, TAP-Nachweis je Fall) — der
> Nachweis, dass eine Standardinstallation sich durch die Fixes nicht ändert. **In `JR-13-09`
> mutationsgeprüft** und damit als echter Nachweis bestätigt, nicht als Tautologie: eine Mutation an
> `predefined_read_only_user` macht 4 von 7 Fällen rot, ein stiller Ausfall des Rollen-Bootstraps 6 von 7.

> **ADR-017 ist entschieden (2026-07-29, Auftraggeber): Variante B.** `SearchService.ts:311` und
> `:423` rufen künftig `FilterBuilder.create(userId, 'archive', 'search')`; `search.routes.ts` bleibt
> unverändert. Damit ist `JR-13-03` von einer Entscheidung zu reiner Umsetzung geworden und `JR-13-02`
> ist freigegeben. **Es gibt jetzt keine blockierende offene Entscheidung mehr für E13.** Variante C
> (Divergenz konstruktiv ausschließen) ist als **`JR-13-10`** nach E13 vorgemerkt, ausdrücklich nicht
> Teil von E13s Abnahme.
>
> Dabei präzisiert: **keine der drei `predefined_*`-Rollen trifft den `null`-Zweig in
> `FilterBuilder`** — eine Standardinstallation verhält sich vor und nach dem F7-Fix gleich. Damit ist
> eine frühere, zu scharfe Aussage des PO korrigiert („der Fix bricht Bestandsinstallationen").
> Erreichbar bleibt der Zweig über einen Nutzer ohne Rolle, eine `cannot`-only-Policy auf `archive`
> und eine handgeschriebene Rolle mit `search` ohne `read`. **Die Schwere von F7 bleibt hoch.**
>
> **E1 ist abgenommen (`JR-1-06a`, 2026-07-28) und in den Integrationsbranch gemergt** (`efb769c`,
> `--no-ff`). Alle 15 Kriterien aus `JR-1-06` sowie die Kriterien von `JR-1-04a` und `JR-1-05b` sind
> erneut und unabhängig geprüft: **alle erfüllt**, keines nur übernommen. F12 ist als behoben
> bestätigt (10 nebenläufige Runden, 0 Rückstände). **F13 bleibt offen** (Entscheidung des
> Auftraggebers).
>
> Drei **neue** Befunde am Messinstrument sind eröffnet: **F14** (Klassen-Umetikettierung umgeht die
> Inventurprüfung), **F15** (`minimumFiles`-Spiel verdeckt eine gelöschte Testdatei) und **F16**
> (Rückstand nach Modul-Throw wird lokal nicht angekündigt). Keiner bricht ein Akzeptanzkriterium.
> Sie gehören nach **`JR-1-05c`** — nicht nach `JR-13-05`, das ist E13s Task für F8; der Verweis in der
> ersten Fassung dieses Abschnitts war falsch.
>
> **`JR-1-05c` ist vor E2 fällig.** Der Wächter zählt **Dateien statt ausgeführter Tests**: wer die
> vier Integrationsdateien auf `nightly` umklassifiziert, schaltet die Suite ab, und beide Wächter
> melden grün. Solange das offen ist, belegt ein grüner CI-Lauf **nicht**, dass die Integration-Suite
> gelaufen ist — und auf genau diesen Tests ruht jede Durability-Aussage in E2/E3.
>
> Nächster Schritt: **`JR-13-07`** (Rolle DEV), danach `JR-13-08` und die Abnahme `JR-13-09`. Vorher
> braucht der PO eine Entscheidung zum verbleibenden roten Test (siehe unten).

---

## Gesamtübersicht

Sortiert nach **Abarbeitungsreihenfolge**, nicht nach Epic-Nummer — E13 wurde nachträglich vor E2
eingeschoben (siehe `03-backlog.md`).

| Reihenfolge | Epic | Titel                              | Status                                                                                                   | Fertig / Gesamt                                                                                                                                                                                                                                                                                                |
| ----------- | ---- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —           | E0   | Planung, Doku, Agent-Infrastruktur | **fertig**                                                                                               | 6 / 6                                                                                                                                                                                                                                                                                                          |
| 1           | E1   | Test- und CI-Fundament             | **abgenommen + gemergt**, Nacharbeit `JR-1-05c` erledigt                                                 | 10 / 10                                                                                                                                                                                                                                                                                                        |
| 2           | E13  | IAM-Autorisierung härten           | **abgenommen + gemergt** (`JR-13-09c`, 4. Runde), Folge-Tasks offen                                      | 9 / 9 + 8 / 8 Nacharbeit                                                                                                                                                                                                                                                                                       |
| 3           | E2   | Ledger und Hash-Chain              | **abgenommen + gemergt** (`JR-2-10a`, 2. Runde, unabhängig)                                              | 11 / 11                                                                                                                                                                                                                                                                                                        |
| 4           | E3   | Spool und Acceptance-Contract      | **abgenommen + gemergt** (`JR-3-08`, 21/21, unabhängig)                                                  | 9 / 9                                                                                                                                                                                                                                                                                                          |
| 5           | E4   | `smtp-ingress`-Service             | **abgenommen + gemergt** (`JR-4-13`, 2026-08-04, unabhängige TEST-Sitzung, Protokoll `16-abnahme-e4.md`) | 21 / 21 + Abnahme. **Zählweise am 2026-08-03 berichtigt:** die Zeile zählte bis dahin die Splits `JR-4-05a`–`c` und `JR-4-06a`/`b` im **Zähler** mit, während der Nenner die Backlog-IDs meint. Gezählt werden jetzt die **IDs**; `JR-4-05` gilt mit `a`–`c` als erledigt, `JR-4-06` mit `a` und `b` (ADR-021) |
| 6           | E5   | Journal-Report-Parser              | **abgenommen + gemergt** (`JR-5-09`, Parallelsession B, Merge `107346d`)                                 | 9 / 9                                                                                                                                                                                                                                                                                                          |
| 7           | E6   | Phase-B-Worker                     | offen                                                                                                    | 0 / 8                                                                                                                                                                                                                                                                                                          |
| 8           | E7   | WORM-Storage                       | offen                                                                                                    | 0 / 6                                                                                                                                                                                                                                                                                                          |
| 9           | E8   | Anchoring                          | offen                                                                                                    | 0 / 6                                                                                                                                                                                                                                                                                                          |
| 10          | E9   | `verify`-CLI                       | offen                                                                                                    | 0 / 8                                                                                                                                                                                                                                                                                                          |
| 11          | E10  | Completeness-Monitoring            | offen                                                                                                    | 0 / 8                                                                                                                                                                                                                                                                                                          |
| 12          | E11  | Compliance-Features                | offen                                                                                                    | 0 / 10                                                                                                                                                                                                                                                                                                         |
| 13          | E12  | Rollout und Dokumentation          | offen                                                                                                    | 0 / 9                                                                                                                                                                                                                                                                                                          |

117 Tasks in den Epics (E0 lieferte 102; E13 kam mit 9 hinzu, E4 mit 6: `JR-4-14` und `JR-4-15` als
Auflagen aus **ADR-029**, `JR-4-16` für **F44**, `JR-4-17` für **ADR-030**, `JR-4-18` für den nie verdrahteten Crash-Recovery-Scan, `JR-4-19` für die Ledger-Verbindung, die sich
nach einem gescheiterten Start nicht erholt). Dazu **`JR-13-10`** als Folge-Task nach
E13 (Variante C aus ADR-017) — er gehört zu keinem Epic und zählt nicht in die Abnahme von `JR-13-09`.

**Produktionscode für den Receiver:** seit E2 gibt es welchen — `packages/journaling` (kanonische
Kodierung, Merkle, `PostgresLedgerWriter`) und die Migrationen `0041`/`0042`. **Seit E4 existiert der
SMTP-Empfangspfad** (`apps/smtp-ingress` plus `packages/journaling/src/ingress/`) und nimmt an; der
Satz „ein SMTP-Empfangspfad existiert weiterhin nicht" stand hier bis zur E4-Abnahme am 2026-08-04.

---

## E0 — Planung, Doku, Agent-Infrastruktur (fertig)

|     | Ergebnis                                                              | Datei                     |
| --- | --------------------------------------------------------------------- | ------------------------- |
| [x] | Codebase-Analyse und Gap-Analyse gegen den RFC                        | `01-gap-analyse.md`       |
| [x] | Zielarchitektur inkl. Prozess- und Credential-Topologie               | `02-architektur.md`       |
| [x] | Backlog E1–E12 mit 102 Tasks, Rollen, Akzeptanzkriterien              | `03-backlog.md`           |
| [x] | Testplan mit RFC-§12-Mapping und CI/Nightly/Manual-Einteilung         | `04-testplan.md`          |
| [x] | ADR-Log: 7 entschieden, 6 offen, 1 verworfen                          | `05-entscheidungen.md`    |
| [x] | Agent-Infrastruktur: `CLAUDE.md`, 2 Subagent-Rollen, 3 Projekt-Skills | `CLAUDE.md`, `.claude/**` |

### Zentrale Befunde aus E0

1. **Der Enterprise-SMTP-Listener ist Closed Source und in diesem Repository nicht vorhanden.** Nur
   Schema, Typen, Frontend-Formular, i18n-Strings, Env-Variablen und eine Doku-Seite, die abwesenden
   Code beschreibt. `apps/open-archiver-enterprise` und `packages/enterprise` fehlen.
2. **Der dokumentierte Enterprise-Ablauf erfüllt RFC §3 nicht** (Tempfile + BullMQ-Enqueue statt
   fsync'd Spool + Ledger vor `250`). Der Receiver wird daher direkt RFC-konform neu gebaut.
3. **Null Tests und kein Test-Runner im gesamten Repository.** Deshalb ist E1 das erste Epic.
4. **Doku-Drift im IAM:** `docs/services/iam-service/iam-policy.md` listet die Action `export` nicht
   und beschreibt `manage` falsch. Der **Code ist korrekt** — `iam.types.ts` und
   `iam-policy/policy-validator.ts` enthalten beide `export`. Behebung in `JR-11-03`.
5. Kein CLI im Repository — `verify` (E9) baut die Basis mit `node:util` `parseArgs`, ohne neue
   Dependency.
6. **ADR-004 war falsch und hätte die internen Dokumente veröffentlicht.** VitePress baut ohne
   `srcExclude` jede `.md` unter `docs/` zu einer Seite, und `search.provider: 'local'` indexiert
   sie — die Sidebar hat damit nichts zu tun. Behoben durch `srcExclude: ['dev/**']` in
   `docs/.vitepress/config.mts`. Nie wirksam geworden, weil nichts auf `main` liegt.
   **Nachweis erbracht:** `pnpm docs:build` läuft durch, `dist/dev/` existiert nicht, kein Satz aus
   `08-risiken.md` im Suchindex; Gegenkontrolle über `dist/SUMMARY.html` (nicht in der Sidebar, aber
   30 KB gebaut und indexiert) belegt den Mechanismus.

---

## E1 — Test- und CI-Fundament (**fertig**, abgenommen 2026-07-28 mit `JR-1-06a`)

**Das vollständige Protokoll dieses Epics steht in [`11-archiv-e1.md`](11-archiv-e1.md)** — 681 Zeilen,
unverändert ausgegliedert am 2026-07-30, weil ein abgenommenes und gemergtes Epic den aktuellen Stand
nicht verdecken soll. Dort: `JR-1-01`–`JR-1-05`, die Nacharbeit `JR-1-04a`/`JR-1-05b`, die abgelehnte Abnahme
`JR-1-06`, die bestandene `JR-1-06a`, F1–F16 in ihrem E1-Kontext und die CI-Einrichtung.

**Von E1 ist nichts mehr offen.** Die letzte Nacharbeit **`JR-1-05c`** (F14–F16, F24) ist am 2026-07-30
erledigt; Protokoll direkt darunter.

> **Das Protokoll von `JR-1-05c` liegt seit dem 2026-08-03 in `11-archiv-e1.md`** (Doku-Diät,
> inhaltlich unverändert). Was davon für jede weitere Task gilt, steht kurz in `07-session-handover.md`:
> eine neue Testdatei ändert `expectedFiles` **und** `expectedTests` im selben Commit, und ein
> verengter Lauf belegt nichts.

## E2 — Ledger und Hash-Chain (**fertig, abgenommen 2026-08-01 mit `JR-2-10a`, zurückgemergt**)

> **E2 ist abgenommen und zurückgemergt.** Die Abnahme ist die zweite, **unabhängige** Runde
> `JR-2-10a` (2026-08-01, Rolle TEST, frische Sitzung, 24/24). Die erste Runde `JR-2-10` bleibt als
> Protokoll stehen und zählt **nicht** als Abnahme; sie lief in derselben Sitzung wie
> `JR-2-08`/`JR-2-09`.
>
> **Der Rückmerge ist am 2026-08-01 vollzogen** (`eb340a9`, `--no-ff`, **kein Squash** — wie bei E13):
> 12 Commits, darunter zwei Abnahmerunden, eine abgelehnte Berichtsfassung und `F38`. Genau diese
> Zwischenschritte sind der Beleg, dass das Verfahren gewirkt hat, und ein Squash hätte ihn getilgt.
> Der Baum des Merge-Commits ist **byteidentisch** mit der Branchspitze `b4eda03`, und seit dem
> zitierten Volllauf war außerhalb von `docs/` nichts geändert — der Lauf gilt also unverändert für
> den gemergten Stand (nachgeprüft, nicht angenommen). Kein Pull Request, `main` unangetastet.

> **Die zwei Abnahmerunden von E2 liegen seit dem 2026-08-03 in `12-archiv-e13-e2.md`**
> (Doku-Diät, inhaltlich unverändert): `JR-2-10` (23/23, nicht unabhängig, zählte nicht) und
> `JR-2-10a` (24/24, unabhängig, abgenommen). E2 ist zurückgemergt (`eb340a9`).

## E13 — IAM-Autorisierung härten (**fertig, abgenommen 2026-07-30 mit `JR-13-09c`**)

**Branch:** `claude/journaling-e13-iam-hardening`, abgezweigt vom Integrationsbranch bei `efea6bc`,
**am 2026-07-30 nach der Annahme mit `--no-ff` zurückgemergt** (kein Squash — ein Squash hätte die drei
dokumentierten Ablehnungen getilgt und damit den Beleg, dass die Abnahme funktioniert hat).

**Der Weg dorthin, vier Runden:** `JR-13-09` hat E13 am 2026-07-29 abgelehnt (F27, F28, F29), die DEV-Nacharbeit
`JR-13-13`–`JR-13-15` hat diese drei behoben, und die **erneute Abnahme `JR-13-09a` hat E13 am
2026-07-29 wieder abgelehnt**: ein neuer Befund **F30** derselben Klasse eine Ebene tiefer. Alle
anderen 22 geprüften Kriterien sind erfüllt, die Codehälfte ist unabhängig belegt. `JR-13-17` hat F30
behoben und den Abdeckungsanspruch der **Abfrage** entfernt (ADR-020) — und die **dritte Abnahme
`JR-13-09b` hat E13 am 2026-07-29 zum dritten Mal abgelehnt** (**F31**): der Anspruch war nicht
verschwunden, sondern auf den **Verhaltenscheck** gewandert. 17 von 18 Kriterien erfüllt. `JR-13-18` hat
F31 (mit F32–F34) behoben, und die **vierte Abnahme `JR-13-09c` hat E13 am 2026-07-30 angenommen**.

> **Diesmal lag die Ursache beim PO, nicht in der Umsetzung.** ADR-020 nannte den Verhaltenscheck selbst
> „vollständig"; `JR-13-17` hat den Satz folgerichtig auf die Betreiberseite übernommen. Die ADR ist
> berichtigt („Berichtigung (2026-07-29, nach der Abnahme `JR-13-09b` — F31)"), `JR-13-18` setzt es um,
> `JR-13-09c` prüft es. **Die Abfrageseite von `JR-13-17` (a) hält** und ist in `JR-13-09b` unabhängig
> belegt — sie wird nicht erneut geprüft.

| Nacharbeit | Task                                                                                      | Rolle |
| ---------- | ----------------------------------------------------------------------------------------- | ----- |
| [x]        | JR-13-13 F29 + F26s Schreibseite: ein Prädikat für beide Gates — `cfb1462`                | DEV   |
| [x]        | JR-13-14 F27 + F28: Abfragen erweitert **und** Absolutsatz ersetzt — `c17144e`            | DEV   |
| [x]        | JR-13-15 F25: Behauptung eingeschränkt **und** F5-Kommentar nachgezogen — `5c8a521`       | DEV   |
| [x]        | JR-13-09a Erneute Abnahme E13 — **durchgeführt; Ergebnis: nicht abgenommen (F30)**        | TEST  |
| [x]        | JR-13-17 F30: Formbefunde auf Knotenebene **und** Abdeckungsanspruch weg — `07ac661`      | DEV   |
| [x]        | JR-13-09b **Schmale** dritte Abnahme — **durchgeführt; Ergebnis: nicht abgenommen (F31)** | TEST  |
| [x]        | JR-13-18 F31 (mit F32–F34) — `939df10`, **ohne DEV-Bericht**, PO-Lesart aus dem Diff      | DEV   |
| [x]        | JR-13-09c **Noch schmalere** vierte Abnahme — **durchgeführt; Ergebnis: ABGENOMMEN**      | TEST  |

> **`JR-13-16` ist aus dieser Liste herausgenommen** (Auftraggeber, 2026-07-29) und steht wortgleich
> unter „Folge-Task nach E13" in `03-backlog.md`. Sie sichert ein **Doku-Artefakt** ab, kein
> Autorisierungsverhalten; die Lücke dahinter (F27) ist behoben und in `JR-13-14` belegt. **Kein
> Kriterium von `JR-13-09a`.**

|     | Task                                                                                                                                                | Rolle     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| [x] | JR-13-01 Fehlschlagende Regressionstests für F1/F3/F7/F8 — **erledigt 2026-07-29**                                                                  | TEST      |
| [x] | JR-13-03 Action-Versatz auflösen (ADR-017, Variante B) — `bcac6bd`                                                                                  | DEV       |
| [x] | JR-13-02 `FilterBuilder`: `null` als deny (mit F19, F20) — `a309fd1`                                                                                | DEV       |
| [x] | JR-13-04 `mongoToDrizzle`: unübersetzbare Bedingungen laut scheitern lassen — `45ac0e9`; der Testwiderspruch ist in `704e8d1` per ADR-018 aufgelöst | DEV       |
| [x] | JR-13-05 `cannot`-Ausschluss mit Operator-Bedingungen korrekt bauen — `2311996`                                                                     | DEV       |
| [x] | JR-13-06 Condition-Keys gegen eine Allowlist prüfen — `dcec017`                                                                                     | DEV       |
| [~] | JR-13-07 Verhaltensänderung dokumentieren (ADR-016) — geschrieben 2026-07-29, in `JR-13-09` **abgelehnt** (F27, F28, F29)                           | DEV       |
| [x] | JR-13-08 Upstream-Meldung vorbereiten (nicht versenden) — **erledigt 2026-07-29**, in `JR-13-09` bestätigt                                          | PO        |
| [x] | JR-13-09 Abnahme E13 — **durchgeführt 2026-07-29; Ergebnis: E13 nicht abgenommen**                                                                  | TEST → PO |

> **Die vier Abnahmerunden von E13 liegen seit dem 2026-08-03 in `12-archiv-e13-e2.md`**
> (Doku-Diät, inhaltlich unverändert): `JR-13-09` bis `JR-13-09c`, die Nacharbeiten `JR-13-13`–`JR-13-15`,
> `JR-13-17`, `JR-13-18` und `JR-13-12`. E13 ist abgenommen und zurückgemergt (`89d701f`).

## E5 — Journal-Report-Parser (**fertig, abgenommen 2026-08-02 mit `JR-5-09`, zurückgemergt**)

9 / 9 Tasks. Entstanden als **Parallelsession B** neben E4, Merge `107346d`. Der Parser zerlegt einen
Journal-Report in Envelope und eingeschlossene Nachricht (`packages/journaling/src/parser/*`), liest
MIME mit `mailparser` (**ADR-027**) und löst den Eigentümer auf. Abnahme: angenommen mit einer Auflage,
die geschlossen wurde (**F58** — Whitespace einer konfigurierten Domain landete in der
Eigentümeradresse).

> **Das vollständige Protokoll liegt seit dem 2026-08-04 in `18-archiv-e4-e5.md`** (Doku-Diät,
> inhaltlich unverändert): alle neun Scheiben, die vier PO-Reviews, der Testkorpus aus `JR-5-08` und
> die Abnahme `JR-5-09`.

## E4 — `smtp-ingress`-Service (**fertig, abgenommen 2026-08-04 mit `JR-4-13`, zurückgemergt**)

21 / 21 Tasks plus Abnahme, Merge `9503bc8`. Der SMTP-Empfangspfad steht: ESMTP mit `PIPELINING`,
`8BITMIME`, `SMTPUTF8`, `SIZE`, `CHUNKING`/`BDAT`, `STARTTLS` und `AUTH`; Quell- und Empfänger-ACL gegen
`journaling_sources`; Crash-Recovery-Scan vor dem `listen()`; und `250 … queued as <seq>` **erst** nach
fsync von Spool **und** Ledger-Append. Der Server ist selbst gebaut (**ADR-029**), eine Transaktion
bleibt genau einer Kette zugeordnet (**ADR-030**), und die Ledger-Anbindung erholt sich ohne Neustart
(**ADR-031**).

**Aus E4 ist kein Befund offen.** F42–F51 behoben oder aufgelöst, F52/F53/F54 (`JR-4-21`), F55/F56 und
F50 (`JR-4-21a`), F47 bei der Abnahme als längst behoben erkannt.

> **Das Abnahmeprotokoll steht in `16-abnahme-e4.md`** — 24 Kriterienzeilen mit je einem Beleg. **Das
> vollständige Sessionprotokoll liegt seit dem 2026-08-04 in `18-archiv-e4-e5.md`**, inhaltlich
> unverändert: alle 21 Scheiben, die Befunde F42–F58 in ihrer Entstehung, und die Zahlen je Lauf.

## E3 – E12 (offen)

Tasklisten stehen in `03-backlog.md`. Sie werden hier erst beim Beginn des jeweiligen Epics
ausgerollt, um diese Datei lesbar zu halten.

Offene ADRs, die vor bzw. während der Epics zu entscheiden sind:

| ADR         | Thema                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Epic                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| ADR-016     | fail-closed rechtfertigt den Verhaltensbruch aus F7                                                                                                                                                                                                                                                                                                                                                                                                                                                           | E13 (`JR-13-07`)       |
| ~~ADR-006~~ | **Entschieden 2026-07-31 (`JR-2-03`): 16 gehashte Felder statt der acht aus RFC §5.2, Genesis mit `deployment_id` und `chain_scope_id` als UUID-Textform, `deployment_identity`-Tabelle, Merkle nach RFC 6962**                                                                                                                                                                                                                                                                                               | E2 (`JR-2-03`)         |
| ~~ADR-007~~ | **Entschieden 2026-07-31: eine Kette je Mandant, `chain_scope_id` = `ingestion_sources.id`**                                                                                                                                                                                                                                                                                                                                                                                                                  | E2                     |
| ~~ADR-022~~ | **Entschieden 2026-07-31: Ankerform ist ein Merkle-Aggregat über alle Kettenköpfe, ein Token je Lauf.** Folgt aus ADR-007 Konsequenz 4; die Baumkodierung ist nach ADR-006/`JR-2-03` vorgezogen                                                                                                                                                                                                                                                                                                               | E8, vorgezogen nach E2 |
| ~~ADR-023~~ | **Entschieden 2026-07-31: TSA-Auswahl.** Kein Standard-URL; qualifizierte eIDAS-TSA in der Produktion mit GoBD-Anspruch, `open-tsa.eu` sonst und in `nightly`, `ci` hermetisch                                                                                                                                                                                                                                                                                                                                | E8                     |
| ADR-009     | Append-Only-Erzwingung: Rechteentzug oder Trigger                                                                                                                                                                                                                                                                                                                                                                                                                                                             | E2 (`JR-2-05`)         |
| ADR-010     | `processEmail` erweitern oder eigener Journaling-Pfad                                                                                                                                                                                                                                                                                                                                                                                                                                                         | E6 (`JR-6-02`)         |
| ADR-008     | TSA-Ausfallverhalten bestätigen                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | E8 (`JR-8-04`)         |
| ADR-012     | Migrationspfad für Bestandsinstallationen                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | E12                    |
| ~~ADR-030~~ | **Entschieden 2026-08-03 (PO): eine Transaktion bleibt genau einer Kette zugeordnet** — der zweite `RCPT TO`, der eine andere Kette einführen würde, wird mit `452 4.5.3` abgewiesen (der Code, für den Sender schon Empfänger-Aufspaltung haben). „Erster gewinnt" bricht den Acceptance-Contract; „eine Receipt je Kette" scheitert an `findBySpoolTxIds()`, das genau einen Eintrag je `spool_txid` liefert — die Crash-Recovery wäre blind für den fehlenden zweiten. Umsetzung: `JR-4-17`, vor `JR-4-06` | E4 (`JR-4-05b`)        |
| ~~ADR-029~~ | **Entschieden 2026-08-02 (PO, auf Messung): der SMTP-Server wird selbst gebaut**, auf `node:net`/`node:tls`, ohne Fremdbibliothek — **kein** Node-SMTP-Server der Registry beherrscht `BDAT`, und ohne `BDAT` ist das Produkt für Exchange Online wertlos. Erzeugt zwei neue Tasks als Auflagen: `JR-4-14` (adversariale Protokollrobustheit) und `JR-4-15` (Sicherheitsdurchsicht)                                                                                                                           | E4 (`JR-4-02`)         |
| ~~ADR-024~~ | **Entschieden 2026-08-02: ein vollständig getrennter Stack je Endkunde**, geteilter Postgres-Server als dokumentierte Dichteoption. **Betriebsverantwortung mitentschieden: Phase 1 betreibt der Endkunde selbst, in Phase 2 bietet der Auftraggeber den Betrieb zusätzlich als Dienst an.** Neu offen daraus: das Haftungsprofil für Phase 2                                                                                                                                                                 | erledigt vor E4        |

---

## Sessionprotokoll

> **Hier stehen nur die Zeilen des laufenden Epics — im Moment ist das keine.** E4 und E5 sind
> abgenommen und zurückgemergt, E6 hat noch nicht begonnen.
>
> | Zeitraum                       | liegt in                               |
> | ------------------------------ | -------------------------------------- |
> | Planung bis Abschluss von E3   | `13-archiv-sessionprotokoll-bis-e3.md` |
> | E4 und E5 (2026-08-02 … 08-04) | `18-archiv-e4-e5.md`                   |
>
> Beide inhaltlich unverändert ausgegliedert.

> **Diese Datei ist am 2026-08-04 von 230 000 auf unter 50 000 Zeichen geschrumpft** — die beiden
> Protokolle machten 195 000 davon aus. Die Regel dahinter steht im `README.md`: das Protokoll eines
> Epics wandert ins Archiv, **sobald** es zurückgemergt ist. Sie wurde bei E4/E5 eingehalten, weil die
> Datei sonst bei jeder Sitzung wieder 64 000 Tokens Pflichtlektüre erzeugt hätte.

> **Kein Tabellenformat für Einträge, seit dem 2026-08-03.** Prettier richtet Tabellen auf die längste
> Zelle aus, und bei Einträgen dieser Länge kostet das Padding ein Vielfaches des Inhalts — damals
> gemessen: 147 908 Zeichen Inhalt, 346 564 nach dem Ausrichten. Ein Eintrag ist deshalb ein Abschnitt.
> **Neue Einträge kurz und in Feldform** (Task, Commit, Testzahl, CI-Lauf, Entscheidungen, offen).
