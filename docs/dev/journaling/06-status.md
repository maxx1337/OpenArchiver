# Status

**Diese Datei ist die verbindliche Fortschrittsquelle.** Sie wird am Ende **jeder** Session
aktualisiert — auch wenn nichts fertig wurde. Ein nicht aktualisierter Status ist schlimmer als
keiner, weil er Fortschritt behauptet, der nicht existiert.

Legende: `[ ]` offen · `[~]` in Arbeit · `[x]` fertig und abgenommen · `[!]` blockiert

**Letzte Aktualisierung:** 2026-08-05 (**E6 läuft: `JR-6-01` und `JR-6-02a` erledigt, ADR-010
entschieden, **ADR-033 entschieden**. F59 behoben, **F61 gefunden und behoben** — sie war die wahre
Ursache der roten Läufe; F60 neu und offen.** Volllauf: **1276 passed | 8 skipped** bei 104 Dateien,
`unit ci 1081 · integration ci 126 · adversarial ci 69`, Exit 0; CI `31018325835` success. Vor der ersten Scheibe sind nach **ADR-032** die Nummernkreise reserviert worden:
ADR-033–036, F59–F70 — **F59 und F60 sind daraus vergeben**) · **Branch:**
`claude/journaling-e6-phase-b-worker` (Epic-Zweig über dem Integrationsbranch
`claude/enterprise-product-implementation-cxmmqe`; E1, E13, E2, E3, E5 und E4 sind zurückgemergt)

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
| 7           | E6   | Phase-B-Worker                     | **in Arbeit** (`JR-6-01` und `JR-6-02a` erledigt, ADR-010 entschieden)                                   | 1 / 8 + `JR-6-02a`. Gezählt werden die **Backlog-IDs** (ADR-021): `JR-6-02` gilt erst mit `a` **und** `b` als fertig                                                                                                                                                                                           |
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

## E6 — Phase-B-Worker (**in Arbeit**, Zweig `claude/journaling-e6-phase-b-worker`)

Kriterien in `03-backlog.md`. Vor der ersten Scheibe sind nach **ADR-032** die Nummernkreise auf dem
Integrationszweig reserviert worden (`fc15edc`): **ADR-033–036** und **F59–F70**. `ADR-010` ist
ausdrücklich **nicht** Teil der Reservierung — die Entscheidung „`processEmail` erweitern oder eigener
Journaling-Pfad" trägt diese Nummer seit dem 2026-07-27 und wird in `JR-6-02` gefüllt.

- [x] `JR-6-01` — `journal-inbound`-Worker als eigener Prozess, `start:journal-worker`, Queue-Parameter
      begründet (2026-08-05, `d0f4840`)
- [~] `JR-6-02` — Verarbeitung Spool → Parser → Storage → `archived_emails` → Index → Spool frei.
  **Aufgeteilt nach ADR-021:**
    - [x] `JR-6-02a` — **ADR-010 entschieden** (`41068aa`) plus das Tor, das entscheidet, ob eine
          Spool-Datei überhaupt archiviert werden darf (`fba499c`)
    - [x] `JR-6-02b` — **Code fertig, Abnahme durch TEST offen.** Erledigt: **ADR-033** (Owner-Auflösung
          für `plain_bcc`/`ndr`/`parse_failed`), **ADR-034** (Fan-out über jeden aufgelösten Owner,
          Backend-Adapter auf `processEmail()`, Indexierung, Spool-Freigabe als Löschen) und **ADR-035**
          (der Ende-zu-Ende-Test ist automatisiert, `journal-phase-b-e2e.int.test.ts`, gegen echtes
          Postgres über die bestehende Harness-Bindung und echtes Meilisearch über einen neuen
          CI-Service-Container, zweimal kalibriert). `runPhaseBPipeline()` verbindet alles; **Ende-zu-Ende
          ist jetzt ein Test, kein manueller Nachweis mehr.**
- [ ] `JR-6-03` — Idempotenz: ein Objekt, zwei Receipts, `duplicate_of`
- [ ] `JR-6-04` — Spool-Reconciler (Redis ist Optimierung, nicht Autorität)
- [ ] `JR-6-05` — Hash-vor-Verschlüsselung festschreiben und testen
- [ ] `JR-6-06` — TEST: Object-Store-Ausfall
- [ ] `JR-6-07` — TEST: Soak, 100.000 Nachrichten (`nightly` plus `ci`-Smoke, F13-Frist heben)
- [ ] `JR-6-08` — Abnahme E6

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
> injizierten Port**, aufgerufen aus einer Pipeline in `packages/journaling`. Der Fund, der die Frage
> entscheidet, stand in keiner der beiden Optionen — **`processEmail()` ist für genau diesen Aufrufer
> gebaut**: `skipTempFileCleanup` existiert laut Kommentar „für die journaling fan-out loop",
> `isJournaled` wird an drei `INSERT`-Stellen aus `provider === 'smtp_journaling'` gesetzt, und Gate 2
> erzeugt die Fan-out-Form (eine physische Datei, **N** `archived_emails`-Zeilen). Diese Verdrahtung lag
> im Enterprise-Overlay, das hier fehlt: **der Aufrufer ist weg, die für ihn gebaute Schnittstelle ist
> da.** „Erweitern" hätte zudem ADR-025 verletzt.
>
> **Das ernsteste Gegenargument trägt gemessen nicht**, und daraus ist **F60** geworden:
> `StorageService.put()` puffert einen übergebenen Stream ohnehin sofort zu einem Buffer, obwohl
> `IStorageProvider.put()` Streams verspricht. Ein eigener Pfad hätte genauso gepuffert — die
> Vollpufferung ist eine Eigenschaft der Storage-Schicht, nicht von `processEmail()`. Vorgeschlagene
> Zuordnung: **E7**, wo `S3StorageProvider` für Object Lock ohnehin angefasst wird.
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

> **ADR-033 ist entschieden (2026-08-05, erster Teil von `JR-6-02b`): Owner-Auflösung für die drei
> Ergebnisarten ohne Journal-Report-Envelope.** `resolveOwner()` wird **nicht** verbreitert — E5s
> Typisierung bleibt. Statt dessen bekommen `plain_bcc`, `ndr` und `parse_failed` einen Envelope aus den
> **eigenen RFC-5322-Kopfzeilen der Außenmail**, und **derselbe** `resolveOwner()` läuft darüber: ein
> Resolver, zwei Envelope-Quellen, dieselbe Begründung wie ADR-010 für die Dedupe.
>
> **Die tragende Festlegung ist eine Verneinung: `envelopeRcpt` wird nie als Owner benutzt.** Bei einer
> Plain-BCC-Kopie ist `RCPT TO` die **Archivadresse selbst** (von E5 gemessen) — sie als Owner zu nehmen
> würde jede solche Nachricht einem Pseudo-Postfach zuschreiben und dabei wie eine **gelungene**
> Auflösung aussehen. Drei der elf Tests bauen genau diese Falle nach: ein `envelopeRcpt` von
> `archive@ourcompany.com`, dessen Domain **konfiguriert ist**, also hätte ein Resolver, der danach
> greift, einen zuversichtlichen `primary-domain-match` auf das falsche Postfach gemeldet.
>
> **Warum der kopfzeilen-abgeleitete Envelope schwächer, aber echt ist:** bei `plain_bcc` **sind** `To`/`Cc`
> der Außenmail die Empfängerkopfzeilen der Originalnachricht (die Kopie ist eine Kopie derselben Bytes);
> bei einem `ndr` ist die Empfängerkopfzeile der **ursprüngliche Absender**, und das ist für einen Bounce
> der richtige Owner — `extractableHeaders.from` wäre es nicht, dort steht der Mailer-Daemon.
>
> **Ehrlich benannt und von keinem Resolver behebbar:** in Plain-BCC-Betrieb ist ein reiner
> BCC-Empfänger **spurlos verloren**. Eigenschaft des Betriebsmodus, gehört in die Betreiberdoku — und der
> Grund, warum die Fidelität (`journal-report` / `rfc5322-headers` / `none`) mitreist statt weggeglättet zu
> werden.
>
> `parseHeaderAddressList()` ist dafür **exportiert** worden und kennt jetzt `'From'`. Nachbauen war keine
> Option: ein naiver Komma-Split macht aus `"Doe, Jane" <jane@…>` zwei Bogus-Adressen, und ADR-027 lässt
> nur `mailparser` als Parsing-Abhängigkeit zu.

> **Die roten CI-Läufe hatten eine andere Ursache als F59, und sie heißt F61.** Der Prozess stürzte mit
> einem unbehandelten `ECONNRESET` ab und erreichte seinen `SIGTERM`-Handler **nie** — die fehlende
> Shutdown-Zeile war ein **Symptom**. `EsmtpServer.handleConnection()`s drei Ablehnungspfade kehrten
> zurück, ohne je einen `'error'`-Listener anzuhängen; ein `net.Socket` ohne solchen Listener lässt
> `EventEmitter` **werfen**. Der `denied`-Pfad ist der Pfad **jeder** IP, die nicht auf der ACL steht, also
> konnte jeder, der den Port erreicht, den Empfänger mit einer Connect-dann-Reset-Schleife anhalten —
> **Schwere hoch**, behoben, mit fünf kalibrierten Regressionsfällen. **Und die Ursache ist
> plattformunabhängig reproduzierbar:** mit zurückgenommenem Fix meldet der Lauf auch auf diesem
> Windows-Host `Unhandled Errors: Error: read ECONNRESET`. Aus einem Wettlauf ist ein deterministischer
> Test geworden.
>
> **Der Lehrsatz ist der Diagnosewert einer Zusicherung, nicht der Bug.** Der Test hatte drei
> Beobachtungen zur Hand — Ausgabe, Exit-Code, Signal — und meldete **eine**. Das hat **zwei** Runden
> Fixarbeit in die falsche Richtung geschickt, samt einer falschen Entwarnung aus vier grünen Läufen
> (F54 verlangte mindestens zehn, und vier Wiederholungen einer Revision sind keine unabhängigen
> Ziehungen). Eine Zusicherung, die nur einen Teil des Beobachtbaren berichtet, ist kein halber Beleg,
> sondern ein Hinweisgeber auf die **falsche** Ursache.
>
> **F59 bleibt richtig und behoben, nur nie belegt zugeordnet.**
> CI `31005188529` ist **nach** dem Fix mit genau derselben Meldung rot geworden. Die vier grünen Läufe,
> die als Beleg gemeldet wurden (`31003830220`), waren **Wiederholungen derselben Revision** und damit zu
> wenige und zu abhängige Ziehungen: bei einer Grundrate um 50–65 % sind vier grüne Läufe
> unwahrscheinlich, aber nicht aussagekräftig — **F54 verlangte ausdrücklich mindestens zehn**, und diese
> Zahl wurde nicht eingehalten. Der Lehrsatz gehört zu F59 im Befundregister.
>
> **Was stattdessen zuerst passiert ist:** die Fehlermeldung des Tests trug **nur `stdout`**, also war
> nicht unterscheidbar, ob der Handler lief und seine Zeile verlor oder ob der Prozess aus einem anderen
> Grund starb. Genau das entscheidet, welcher Fix richtig ist. `ingress-process-boot.test.ts` meldet
> jetzt **Exit-Code, Signal und `stderr`** mit. Der zweite Fix wird erst nach diesen Werten bestimmt,
> nicht geraten. Ein Kandidat steht bereit (synchrones `fs.writeSync` auf Deskriptor 1), falls die Daten
> „Handler lief" zeigen.
>
> Der Rest des ersten Fixes bleibt und ist nicht falsch — er ist nur nicht hinreichend: zwei von
> drei Pushes dieses Zweigs endeten rot, jedes Mal an demselben Test, jedes Mal an derselben Ursache — ein
> roter Lauf mit immer derselben bekannten Ursache ist schlimmer als ein flackernder Test, weil er die CI
> als Beleg entwertet (die Lehre aus **F48**). `writeLineThenFlush()` löst erst auf, wenn der Stream den
> Schreibvorgang quittiert hat, und `shutdown()` wartet darauf — **nach** dem Drain, nicht davor.
> Begrenzt auf zwei Sekunden und ohne Ablehnung, weil ein **hängender** Shutdown der schlechtere Tausch
> wäre: ein Supervisor `SIGKILL`t einen Prozess, der nicht aufhört.
>
> **Auf diesem Windows-Host ist die Wirkung nicht messbar** — die Zusicherung steht hinter
> `platform !== 'win32'`, weil Windows kein catchbares `SIGTERM` an ein Kind liefert. Der Beleg muss
> deshalb aus der CI kommen, und **genau dort ist er nicht erbracht worden**: siehe oben.
>
> **Der Helfer liegt in `packages/journaling`, nicht in `apps/smtp-ingress`, und der Grund ist eine
> Harness-Eigenschaft, die man kennen sollte: kein Projekt-Glob erfasst `apps/`.** Eine Testdatei dort
> würde von niemandem gesammelt, und der Unclassified-Check würde den Lauf zu Recht rot melden. Prüfbares
> Verhalten gehört dorthin, wo Tests hinreichen — nicht ein Glob verbreitert.

> **Eine Zusage in `JR-6-01` ist plattformabhängig und sagt das.** Windows kennt kein POSIX-Signal:
> `child.kill('SIGTERM')` ruft `TerminateProcess`, der Handler im Worker läuft nie. Der
> Graceful-Shutdown-Nachweis ist damit **nur auf dem Linux-CI-Runner** erbringbar — dieselbe Lage wie
> `fsyncDirectory()` (F48), dieselbe Regel: der Test läuft **immer** (`expectedTests` ist exakt und
> darf nicht je Plattform abweichen), prüft auf Windows das tatsächliche Windows-Verhalten und gibt eine
> `coverageNotice` aus, die die ungeprüfte Zusage **namentlich** benennt. Kein `skipIf` — ein
> übersprungener Assert druckt wie ein bestandener.

---

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

### 2026-08-05 — E6 eröffnet, `JR-6-01`

- **Rolle:** DEV (Hauptthread, kein Subagent — der Auftraggeber hat keinen angefordert)
- **Commits:** `fc15edc` (Nummernreservierung, auf dem **Integrationszweig**), `d0f4840` (`JR-6-01`,
  auf dem Epic-Zweig)
- **Zweig:** `claude/journaling-e6-phase-b-worker`, mit `git push -u` sofort auf eigenen Upstream
  gesetzt — die Falle aus E3 (`git checkout -b <epic> origin/<integration>` setzt den Upstream auf den
  **Integrationszweig**, und ein `git push` landet dort)
- **Tests:** 33 neu (28 `unit`, 5 `integration`). Volllauf **1214 passed | 8 skipped** bei 98 Dateien,
  Exit 0, `unit ci 1019/1019 · integration ci 126/126 · adversarial ci 69/69`
- **CI:** `30999645177` **success** — 98 Dateien, `unit 1019/1019 · integration 126/126 ·
adversarial 69/69`, der neue `valkey`-Service trägt. **Der erste Versuch desselben Laufs war rot**,
  an einem Test, den diese Scheibe nicht angefasst hat: daraus ist **F59** geworden, der
  Wiederholungslauf war grün. Auf dem Linux-Runner meldet der Plattform-Zähler
  `SIGTERM graceful-shutdown branch exercised on linux: exit code 0, no terminating signal` — die
  Zusage, die auf Windows nachweislich unprüfbar ist, ist dort also **erbracht**
- **Entscheidungen:** keine neue ADR. Drei Festlegungen im Code begründet (Queue-Vertrag in
  `packages/journaling`, Ein-Feld-Payload, werfender Processor) — siehe den E6-Abschnitt oben
- **Offen:** `JR-6-02`, und mit ihr **ADR-010**
- **Nicht getan, absichtlich:** die vereinbarte Doku-Diät (Pflichtlektüre unter 40 000 Tokens). Sie
  war „nach der E4-Abnahme" verabredet und ist weiterhin offen; diese Sitzung hat sie nicht angefasst,
  um die erste E6-Scheibe nicht mit einem Umbau der Projektakten zu vermischen

### 2026-08-05 — `JR-6-02a` und der F59-Fix (Fortsetzung derselben Sitzung)

- **Rolle:** DEV (Hauptthread)
- **Commits:** `41068aa` (ADR-010 entschieden, F60 aufgenommen), `fba499c` (`JR-6-02a`: das Tor),
  `72509b5` (F59 behoben)
- **Tests:** 44 neu gegenüber dem Vormittag (35 in `JR-6-02a`, 9 im F59-Fix). Volllauf **1260 passed |
  8 skipped** bei 102 Dateien, Exit 0, `unit 1065/1065 · integration 126/126 · adversarial 69/69`
- **CI:** `31003830220`, **4 von 4 Versuchen success**. Die vier Versuche sind der Beleg für den
  F59-Fix, nicht Bequemlichkeit — vorher waren 2 von 3 Läufen rot
- **Entscheidungen:** **ADR-010** (siehe oben — die Antwort ist keine der beiden ADR-Optionen);
  `JR-6-02` nach **ADR-021** in `a`/`b` geteilt; F59 auf Entscheidung des Auftraggebers im
  Produktionscode behoben statt im Test entschärft
- **Befunde:** **F59 behoben**, **F60 neu und offen** (`StorageService.put()` puffert Streams,
  vorgeschlagene Zuordnung E7)
- **Offen:** `JR-6-02b` — Parser und Owner-Auflösung anschließen, Backend-Adapter auf `processEmail()`,
  Indexierung, Spool-Freigabe, Ende-zu-Ende bis zum durchsuchbaren Treffer
- **Nicht getan, absichtlich:** die Doku-Diät, weiterhin. Und der `duplicate_of`-Pfad — er gehört zu
  `JR-6-03` und wurde bewusst nicht vorgezogen, obwohl das Tor die Stelle schon kennt

### 2026-08-05 — `JR-6-02b` fertiggestellt (neue Sitzung)

- **Rolle:** DEV (Subagent `senior-dev`)
- **Commits:** `cb1a524` (Code + Tests), `440c492` (Doku, ADR-034, F62), plus **sechs
  Nacharbeits-Commits**, alle aus roten CI-Läufen, nicht aus lokalen Funden: `0264405` (`test:types`
  von `packages/journaling` war lokal nie gelaufen, zwei Fakes fehlten die neuen
  `envelopeFrom`/`envelopeRcpt`-Felder), `9af1492`/`49a0bc1` (CI setzte `STORAGE_TYPE`/
  `STORAGE_LOCAL_ROOT_PATH`/`ENCRYPTION_KEY` nie, weil der Worker vor dieser Scheibe keinen
  DB-/Storage-Zugriff brauchte — siehe **F63**), `41c407e` (der gespawnte Worker brauchte eine
  **migrierte** Testdatenbank, nicht `process.env.DATABASE_URL`s Wartungsdatenbank), `3d0fadb`/
  `c2987e9` (eine offene `postgres-js`-Verbindung hielt den Prozess nach `worker.close()` am Leben;
  behoben mit `process.exit(0)` nach bestätigtem Drain). **F63** fasst alle drei CI-spezifischen
  Ursachen zusammen
- **Tests:** 21 neu gegenüber dem Vortag (11 `pipeline.test.ts`, 3 `spool-entry-releaser.test.ts`,
  2 `ledger-lookup.test.ts`, 5 `journal-inbound.options.test.ts`). Volllauf **1297 passed | 8
  skipped** bei 106 Dateien, Exit 0, `unit ci 1102/1102 · integration ci 126/126 ·
adversarial ci 69/69` — unverändert über alle Nacharbeits-Commits hinweg
- **CI:** `31054880932`, **success** nach fünf vorangegangenen roten Läufen (`31050995086` Parse-Fehler
  in der Workflow-Datei selbst, `31051952349` `test:types`, `31052494990`/`31052830240`
  Workflow-Parse-Problem mit einem `${{ runner.temp }}`-Ausdruck in job-scope `env:`, `31053663551`
  unmigrierte Datenbank, `31054317990` hängender Shutdown). 106 Dateien,
  `unit 1102/1102 · integration 126/126 · adversarial 69/69`, `Suite inventory verified: unit 77/77,
integration 22/22, adversarial 7/7, 0 unclassified test files`
- **Entscheidungen:** **ADR-034** (Fan-out über jeden aufgelösten Owner via `normalizedEmail`;
  Spool-Freigabe ist Löschen, kein drittes Spool-Verzeichnis; der Prozessor wirft für jeden
  Nicht-Erfolg; `envelope_from`/`envelope_rcpt` erneut in den Ledger-Lookup gezogen; kein
  automatisierter E2E-Test gegen echtes Meilisearch, mit Begründung). Details in
  `05-entscheidungen.md`
- **Manuell verifiziert, nicht automatisiert:** echtes Postgres + echtes Meilisearch +
  echtes Dateisystem — `basic-journal-report.eml` fanned out auf drei Owner
  (`bob`/`carol`/`dave@contoso.com`), alle drei archiviert und indexiert, Volltextsuche nach
  `"Quarterly numbers"` findet alle drei, Spool-Datei danach gelöscht. Siehe ADR-034 Punkt 6 für
  die Begründung, warum das kein committeter Test wurde
- **Befunde:** **F62** neu (`IJournalInboundJob` ist totes Gerüst, Architektur-Doku korrigiert),
  **F63** neu (drei CI-spezifische Ursachen — fehlende `STORAGE_TYPE`/`ENCRYPTION_KEY`, unmigrierte
  Wartungsdatenbank, hängender Shutdown durch eine offene `postgres-js`-Verbindung — kosteten fünf
  CI-Iterationen für diese Scheibe)
- **Offen:** `JR-6-03` (Idempotenz/`duplicate_of`), `JR-6-04` (Reconciler), `JR-6-05`–`JR-6-07`
  (Test-Slices), `JR-6-08` (Abnahme). Die Entscheidung, ob ein automatisierter Meilisearch-E2E-Test
  gebaut wird (und mit welcher CI-/DI-Änderung), liegt beim Auftraggeber
- **Nicht getan, absichtlich:** die Doku-Diät, weiterhin. `IJournalInboundJob` selbst wurde nicht aus
  `packages/types` entfernt (F62) — nur die Doku-Aussage über seine Rolle korrigiert

### 2026-08-05 — Auftrag (a): der Ende-zu-Ende-Test wird automatisiert (Fortsetzung derselben Rolle)

- **Rolle:** DEV (Subagent `senior-dev`)
- **Auftrag:** der Auftraggeber hat entschieden, dass der manuelle Nachweis aus der vorigen Scheibe
  automatisiert wird (Backlog-Akzeptanzkriterium von `JR-6-02`/`JR-6-08`), über Route (i) (DI) statt
  Route (ii) (Harness-Ausnahme) — **ADR-035**
- **Commits:** `32fa49f` (Code + Test), `faa26d5` (Doku, ADR-035, F64)
- **Tests:** 1 neu (`journal-phase-b-e2e.int.test.ts`). Volllauf **1298 passed | 8 skipped** bei 107
  Dateien, Exit 0, `unit ci 1102/1102 · integration ci 127/127 · adversarial ci 69/69`
- **CI:** `31083864864`, **success** (Kopf-Commit `faa26d5`) — 107 Dateien,
  `unit 1102/1102 · integration 127/127 · adversarial 69/69`,
  `Suite inventory verified: unit 77/77, integration 23/23, adversarial 7/7, 0 unclassified
test files`. Erster Lauf, der den neuen `meilisearch`-Service-Container tatsächlich benutzt
- **Entscheidung, gemessen statt angenommen:** die vermeintlich nötige DI-Naht an
  `IngestionService`/`StorageService` existierte bereits (`pg-harness.ts`s
  `bindAsProcessDatabaseUrl()` + verzögerter dynamischer Import, seit `JR-1-04` von
  `filter-builder*`/`mongo-to-meli`/`predefined-roles` benutzt) — kein Umbau von Produktionscode
  nötig. Details samt der verworfenen Alternative in ADR-035
- **Meilisearch in der CI:** ein `meilisearch`-Service-Container plus
  `MEILI_HOST`/`MEILI_MASTER_KEY` im Job-`env:`. Gemessen (nicht angenommen wie bei `valkey`):
  `MEILI_MASTER_KEY` ist eine Umgebungsvariable, keine Kommandozeilenoption — Authentifizierung ist
  in der CI vollständig prüfbar, keine `valkey`-artige Einschränkung. `probeMeilisearch()`
  (`tests/support/infra.ts`) neu, nach demselben Muster wie `probeRedis()`
- **Kalibriert, zweimal, nach `JR-13-09c`s Muster:** Spool-Freigabe deaktiviert → Test schlägt an der
  Spool-Zusicherung fehl; Fan-out auf den Gewinner verkürzt → Test schlägt an der Owner-Liste fehl.
  Beide zurückgenommen, danach wieder grün, `git diff` bestätigt keine Restspur
- **Befunde:** **F64** neu (der hängende Shutdown aus F63 Punkt 3 ist kein CI-Umgebungsproblem,
  sondern ein reales Produktionsverhalten, das der CI-Lauf nur zuerst gemessen hat — als eigener
  Befund geführt, F63 entsprechend gekürzt und verweist darauf; Nebenbefund im selben Text: dasselbe
  `logger.warn`-vor-`process.exit()`-Muster wie F59, niedrige Schwere, nicht behoben)
- **Offen:** `JR-6-03`, `JR-6-04`, `JR-6-05`–`JR-6-07`, `JR-6-08` unverändert
- **Nicht getan, absichtlich:** die Ursache von F64 nicht weiter untersucht (ausdrückliche Anweisung:
  „Untersuchen sollst du es jetzt nicht — nur richtig verbuchen"). Die Doku-Diät weiterhin offen

### 2026-08-06 — Pre-Push-Gate (Werkzeug-Infrastruktur, keine Backlog-ID)

- **Rolle:** DEV (Subagent `senior-dev`)
- **Auftrag:** kein Backlog-Task. Nach einer Kostenanalyse von `JR-6-02b` (sechs CI-Round-Trips, 53
  Minuten reine Wartezeit für genau diese Scheibe) hat der Auftraggeber ein lokales Gate beauftragt,
  das die **fangbaren** der sechs Fehlschläge lokal abfängt, bevor gepusht wird — ausdrücklich **kein**
  zweiter Volllauf (die knapp drei Minuten sind genau das, was das Gate vermeiden soll) und **kein**
  zweiter Test-Harness (CLAUDE.md §5.1: bestehende Skripte/Tests werden mit anderer Umgebung
  aufgerufen, keine neue Prüf-Logik gebaut)
- **Commit:** `88b6719` (`scripts/pre-push-gate.mjs`, `packages/backend/scripts/gate-check-schema.mjs`,
  `package.json`-Skript `gate`)
- **Was es prüft, `corepack pnpm gate`, unter zwei Minuten:** (1) `test:types` beider Pakete, (2)
  Prettier nur auf geänderten Dateien (F35 — nie repo-weit), (3) `svelte-check` (die CI führt es
  bedingungslos aus), (4) Boot des `journal-inbound`-Workers unter `ci.yml`s **eigenem** `env:`-Block —
  frisch aus der Workflow-Datei geparst, nie aus dem lokalen `.env` übernommen —, gegen eine
  **garantiert unmigrierte** Sonden-Datenbank (Postgres' eigene, immer vorhandene Default-Datenbank
  `postgres`, benutzt, wenn die lokale Entwickler-DB bereits migriert ist)
- **Kalibriert, dreimal, nach `JR-13-09c`s Muster — Messung, kein Argument:**
    - **0264405** (`test:types`-Lücke): `alerts.test.ts`/`smtp-acceptance-wiring.test.ts` auf
      `0264405~1` zurückgesetzt → Gate meldet `[FAIL] test:types @open-archiver/journaling` mit exakt
      den ursprünglichen TS2322/TS2345-Fehlern → zurückgesetzt, `git status --short` zeigt keine Restspur
    - **9af1492** (`STORAGE_TYPE` fehlte in der CI): `ci.yml`s `STORAGE_TYPE`/`STORAGE_LOCAL_ROOT_PATH`/
      `ENCRYPTION_KEY`/`MEILI_HOST`/`MEILI_MASTER_KEY`-Block entfernt → Gate meldet
      `Error: Invalid STORAGE_TYPE: undefined` und `[FAIL] worker boot check` → zurückgesetzt, `git diff`
      danach leer
    - **41c407e** (unmigrierte DB im gespawnten Kind): `journal-inbound-worker.int.test.ts` auf
      `41c407e~1` zurückgesetzt (23 Zeilen DB-Isolation entfernt) → Gate meldet
      `AssertionError: expected 'relation "journal_ledger" does not ex…' to contain 'could not be read'`
      — exakt die erwartete Fehlerklasse, nicht irgendein beliebiger Fehlschlag → zurückgesetzt,
      `git diff --cached --stat` danach leer
- **Ausdrücklich NICHT gefangen, und das Gate sagt das selbst während des Laufs:**
    - **49a0bc1** (ein `${{ runner.temp }}`-Ausdruck, der GitHub Actions' Workflow-Parser brach): nur ein
      Heuristik-`warn`, wenn ein aus `ci.yml` geparster Env-Wert `${{` enthält — kein Schema-Validator
      für Workflow-Dateien für diesen Host gefunden, ausdrücklich als nicht-autoritativ markiert
    - **3d0fadb/c2987e9** (F64, der hängende Shutdown durch ein offenes `postgres-js`-Handle): per
      Definition nicht lokal reproduzierbar (die Zusicherung steht laut `JR-6-01`s Handover-Eintrag
      ohnehin nur auf dem Linux-Runner), kein Versuch unternommen
- **Ablage:** `scripts/` (Repo-Wurzel) für den Haupt-Gate, `packages/backend/scripts/` für den
  DB-Schema-Helfer — dessen `postgres`-Import löst so gegen `packages/backend/node_modules` auf statt
  eine neue Root-Abhängigkeit zu brauchen. Kein bestehendes Skript umgebaut, nur `gate` in
  `package.json` neu ergänzt
- **Ein Entwurfsfehler unterwegs, selbst gefangen, nicht von außen gemeldet:** der erste Entwurf baute
  die Kind-Umgebung als `{ ...process.env, ...ciEnv, … }` — eine bereits lokal exportierte
  `STORAGE_TYPE` hätte ihr Fehlen in `ciEnv` **überdeckt** und genau die Fehlerklasse unsichtbar
  gemacht, die dieser Schritt fangen soll. Behoben: die konfigurationsrelevanten Schlüssel
  (`STORAGE_TYPE`, `STORAGE_LOCAL_ROOT_PATH`, `STORAGE_ENCRYPTION_KEY`, `ENCRYPTION_KEY`, `MEILI_HOST`,
  `MEILI_MASTER_KEY`, `JWT_SECRET`, `OA_TEST_REQUIRE_INFRA`) werden vor dem Overlay explizit aus einer
  Kopie von `process.env` gelöscht, damit `ci.yml`s eigene Erklärung — oder ihr Fehlen — für sie
  entscheidet, nicht die Entwicklerumgebung
- **CI:** `31087687090` **success** für den Kopf-Commit `d5f77cf` (die Doku selbst) — 107 Dateien
  unverändert gegenüber dem Vortag, `unit ci 1102/1102 · integration ci 127/127 · adversarial ci
69/69`, `Suite inventory verified: unit 77/77, integration 23/23, adversarial 7/7, 0 unclassified
test files`. Erwartungsgemäß unverändert — das Gate selbst ist reine Werkzeug-Infrastruktur, die
  CI läuft nicht darüber
- **Nicht Teil dieses Auftrags, wie vom Auftraggeber ausdrücklich ausgeschlossen:** F64s Ursache, F62,
  F60, F43, F39, F42, F17(b), die Doku-Diät, `JR-6-03`/`JR-6-04`
- **Numerierung:** keine neue ADR, keine neue F-Nummer vergeben — dieser Auftrag hat keinen Bedarf an
  einer Entscheidung oder einem neuen Befund erzeugt; ADR-036 bleibt reserviert und unvergeben
