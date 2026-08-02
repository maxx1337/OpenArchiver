# Status

**Diese Datei ist die verbindliche Fortschrittsquelle.** Sie wird am Ende **jeder** Session
aktualisiert — auch wenn nichts fertig wurde. Ein nicht aktualisierter Status ist schlimmer als
keiner, weil er Fortschritt behauptet, der nicht existiert.

Legende: `[ ]` offen · `[~]` in Arbeit · `[x]` fertig und abgenommen · `[!]` blockiert

**Letzte Aktualisierung:** 2026-08-01 (**E2 ist abgenommen und zurückgemergt** — die zweite,
**unabhängige** Runde `JR-2-10a` hat 24 von 24 Kriterien erfüllt gefunden, in einer frischen Sitzung,
die weder `JR-2-08` noch `JR-2-09` noch `JR-2-10` geschrieben hat; der Rückmerge ist am 2026-08-01
vollzogen (`eb340a9`, `--no-ff`, kein Squash). Ein neuer Befund **F39**, niedrig, kein Produktdefekt.
**Nächstes Epic: E3**) · **Branch:** `claude/enterprise-product-implementation-cxmmqe`
(Integrationsbranch; E1, E13 und E2 sind zurückgemergt)

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

| Reihenfolge | Epic | Titel                              | Status                                                              | Fertig / Gesamt          |
| ----------- | ---- | ---------------------------------- | ------------------------------------------------------------------- | ------------------------ |
| —           | E0   | Planung, Doku, Agent-Infrastruktur | **fertig**                                                          | 6 / 6                    |
| 1           | E1   | Test- und CI-Fundament             | **abgenommen + gemergt**, Nacharbeit `JR-1-05c` erledigt            | 10 / 10                  |
| 2           | E13  | IAM-Autorisierung härten           | **abgenommen + gemergt** (`JR-13-09c`, 4. Runde), Folge-Tasks offen | 9 / 9 + 8 / 8 Nacharbeit |
| 3           | E2   | Ledger und Hash-Chain              | **abgenommen + gemergt** (`JR-2-10a`, 2. Runde, unabhängig)         | 11 / 11                  |
| 4           | E3   | Spool und Acceptance-Contract      | **abgenommen + gemergt** (`JR-3-08`, 21/21, unabhängig)             | 9 / 9                    |
| 5           | E4   | `smtp-ingress`-Service             | offen                                                               | 0 / 13                   |
| 6           | E5   | Journal-Report-Parser              | offen                                                               | 0 / 9                    |
| 7           | E6   | Phase-B-Worker                     | offen                                                               | 0 / 8                    |
| 8           | E7   | WORM-Storage                       | offen                                                               | 0 / 6                    |
| 9           | E8   | Anchoring                          | offen                                                               | 0 / 6                    |
| 10          | E9   | `verify`-CLI                       | offen                                                               | 0 / 8                    |
| 11          | E10  | Completeness-Monitoring            | offen                                                               | 0 / 8                    |
| 12          | E11  | Compliance-Features                | offen                                                               | 0 / 10                   |
| 13          | E12  | Rollout und Dokumentation          | offen                                                               | 0 / 9                    |

111 Tasks in den Epics (E0 lieferte 102; E13 kam mit 9 hinzu). Dazu **`JR-13-10`** als Folge-Task nach
E13 (Variante C aus ADR-017) — er gehört zu keinem Epic und zählt nicht in die Abnahme von `JR-13-09`.

**Produktionscode für den Receiver:** seit E2 gibt es welchen — `packages/journaling` (kanonische
Kodierung, Merkle, `PostgresLedgerWriter`) und die Migrationen `0041`/`0042`. Ein SMTP-Empfangspfad
existiert weiterhin nicht; der beginnt mit E3/E4.

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

### `JR-1-05c` erledigt (2026-07-30, `b5b2190`) — der Wächter zählt jetzt Tests, nicht Dateien

**Umfang:** F14, F15, F16, F24. Grundlagenarbeit direkt auf dem Integrationsbranch, wie im Handover
vorgesehen. Kein Produktionscode: der Diff berührt `tests/support/*`, `packages/backend/tests/*`,
`vitest.config.ts` und `.github/workflows/ci.yml`.

**Was gebaut wurde, und warum in dieser Form**

1. **Ein zweiter Wächter zählt _ausgeführte_ Tests je Suite _und je Klasse_**
   (`tests/support/executed-tests.ts`), verglichen mit `SUITES[].expectedTests`. Ausgeführt heißt
   `passed` oder `failed`. **Je Klasse** ist der tragende Teil: die Umetikettierung aus F14 verringert
   die Gesamtzahl **nicht**, sie verschiebt die Tests in eine Klasse, die die Standardauswahl nicht
   fährt — also fällt `expectedTests.ci` der Suite auf 0 und nur eine klassenweise Zählung sieht das.
   Nebeneffekt, der Arbeit spart: dieselbe Tabelle trägt `pnpm test:nightly` mit, ohne eine zweite.
2. **Gleichheit statt Untergrenze**, auch für die Dateizahl (`minimumFiles` → `expectedFiles`). Das ist
   wörtlich der in F15 vorgeschlagene Minimalfix. Der Preis ist eine Zahl je Commit, der die Zählung
   ändert; beide Fehlermeldungen nennen die einzutragende Zahl, damit der ehrliche Weg ein Copy-paste
   ist und nicht eine Suche.
3. **Mechanik: Reporter misst, `globalSetup`-Teardown urteilt.** Zählen kann erst nach dem Lauf
   passieren, und vitest hat dort keinen Assertions-Haken. Die Reihenfolge ist **gemessen**, nicht
   angenommen (vitest 3.2.7): `globalSetup` → Tests → `onTestRunEnd` → Zusammenfassung → `onFinished` →
   Teardown, und ein werfender Teardown endet mit **Exit 1**. Die Messdatei wird vor dem Lauf
   **gelöscht** und danach **verlangt** — wer den Reporter aus `vitest.config.ts` entfernt, macht den
   Lauf rot statt den Wächter abzuschalten. Dieselbe Positiv-Konstruktion wie beim Inventar-Report.
4. **Ein verengter Lauf prüft nichts und sagt das.** `-t`, Dateifilter, `--project`, `--shard`: der
   Lauf bleibt grün und gibt „verified NOTHING" als Coverage-Hinweis aus. Begründung: ein Wächter, der
   `pnpm test -t` rot macht, ist ein Wächter, den man abzuschalten lernt. Damit das Zugeständnis nicht
   dort greift, wo die Zusicherung gebraucht wird, verlangt `assert-inventory-report.mjs`, dass die
   Prüfung **anwendbar** war — in der CI ist die Hintertür also zu.
5. **Die CI liest das Urteil, statt es nachzurechnen.** Der Teardown schreibt sein Verdikt in die
   Messdatei zurück. Zwei Implementierungen einer Regel laufen auseinander — das ist **F29**, und der
   Fehler wird hier nicht wiederholt.
6. **Der Hauptprozess besitzt den Rückstand dieses Laufs** (`tests/support/harness-ledger.ts` und
   `harness-residue.ts`). Der Worker trägt jede geholte Datenbank in ein Ledger-Verzeichnis dieses
   Laufs ein und löscht den Eintrag erst, wenn der Drop stattgefunden hat; der Teardown meldet, was
   übrig ist, mit Namen, Label und Worker-PID, **droppt** es und macht den Lauf rot, sofern er nicht
   verengt war. Bewusst **nicht** „alle `oa_test_*` abfragen und die Differenz bilden": das hätte die
   lebende Datenbank eines fremden, parallelen Laufs für Rückstand halten können, und genau das war
   **F12**. `acquireTestDatabase()` verweigert den Dienst ohne Ledger-Verzeichnis, **bevor** es etwas
   anlegt.
7. **Ein drittes Modul, das nichts importiert** (`tests/support/test-classes.ts`) trägt Klassenliste,
   Auswahlparser und das `[ci] `-Label. `classification.ts` importiert `vitest` und ist für den
   Hauptprozess unerreichbar; der Wächter muss dasselbe Label **lesen**, das jener **schreibt**. Die
   Alternative wäre eine zweite Kopie des Formats gewesen — dieselbe Falle wie F29, siehe Fallstrick 18.

**Zwei Annahmen wurden vorab gemessen, statt sie zu glauben** (beide in einer Wegwerf-Konfiguration,
danach entfernt): dass ein werfender `globalSetup`-Teardown den Exit-Code auf 1 setzt und **nach**
`onFinished` läuft, und dass eine in `globalSetup` gesetzte Env-Variable die geforkten Worker erreicht
(`ppid` des Workers = pid des Hauptprozesses, Variable angekommen). Das Ledger hängt vollständig an der
zweiten.

**Nachweis. Jeder Angriff wurde zuerst am Elternstand `e09b981` wiederholt**, damit der grüne
Ausgangszustand belegt ist und nicht aus dem Befundtext übernommen. Umgebung: Wegwerf-Cluster
PostgreSQL **17.10** (dieselbe Version wie die CI), `OA_TEST_REQUIRE_INFRA=1`.

| Zustand                                           | Elternstand `e09b981`                      | mit `JR-1-05c`                                                               |
| ------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| legitim                                           | Exit 0, `250 passed \| 2 skipped`          | **Exit 0**, `274 passed \| 2 skipped`, 19 Dateien                            |
| alle 8 Integrationsdateien `ci` → `nightly`       | **Exit 0**, beide Wächter „verified"       | **Exit 1**, `integration: ci 0/55`, Dateien weiter `8/8`                     |
| eine Datei nur `it.skip`                          | (F14 (b), im Befund belegt)                | **Exit 1**, `integration: ci 52/55`, Dateien weiter `8/8`                    |
| `pg-harness.int.test.ts` löschen + Datei addieren | (F15, im Befund belegt)                    | **Exit 1**, `integration: ci 43/55`, Dateien weiter `8/8`                    |
| `throw` im Modul-Scope nach dem `acquire`         | Rückstand lautlos, **keine** Meldung       | **Exit 1**, Datenbank **namentlich** gemeldet, gedroppt, danach 0 Rückstände |
| `pnpm test -t "idempotent"`                       | Exit 0, **6** Datenbanken liegen geblieben | **Exit 0**, 6 gemeldet und gedroppt, danach **0**                            |
| `pnpm test:unit` (`--project`)                    | Exit 0                                     | **Exit 0** plus „verified NOTHING"-Hinweis                                   |
| `pnpm test:nightly`                               | Exit 0                                     | **Exit 0**, `adversarial: … nightly 1/1`, 1 Skip (manual)                    |

Die Umetikettierung deckte zusätzlich **sechs Rückstände** auf, die vorher lokal lautlos geblieben
wären — die skippenden Suiten führen ihr `afterAll` nicht aus. Das ist F16 und F24 in einem Lauf.

**Die CI-Klebeschicht ist in beide Richtungen geprüft:** gegen die grünen Reports Exit 0 („Executed-test
inventory verified for unit, integration, adversarial"), gegen die Messung des `--project`-Laufs Exit 1
(„CI must run an unnarrowed `pnpm test`"), gegen eine fehlende Messdatei Exit 1.

**Eigene Tests für den Wächter:** `packages/backend/tests/unit/executed-tests.test.ts` (15 Fälle) baut
die vier Akzeptanzszenarien als **Daten** und prüft das Urteil, dazu Label-Round-trip, nicht gewählte
Klasse, fehlende Suite, unklassifizierte Tests, unbekanntes Project und die Tabelle selbst;
`harness-ledger.test.ts` (8 Fälle) prüft die Buchführung samt Verweigerung eines Namens, den der Harness
nie erzeugt, und samt truncierten Eintrags. Bewusst **keine** vitest-in-vitest-Kindprozesse: das Urteil
ist genau deshalb eine reine Funktion der Messung. Dass die **Messung** stimmt, ist die andere
Behauptung, und die trägt die Tabelle oben.

**Zwei Dinge über den Umfang hinaus, benannt statt versteckt:** die Dateizahl ist jetzt ebenfalls eine
Gleichheit (F15 hatte genau das vorgeschlagen), und die Ausnahme für verengte Läufe war nicht gefordert
— ohne sie wären `pnpm test:unit` und jeder `-t`-Lauf dauerhaft rot.

**Hygiene:** `pnpm --filter @open-archiver/backend test:types` grün; Prettier für alle 14 berührten
Dateien grün (über die Prettier-API gegen eine LF-Normalisierung in Node geprüft, wegen **F35** nicht
über `pnpm lint`); 0 `oa_test_*`-Rückstände am Ende; der Wegwerf-Cluster ist im Scratchpad und wird
abgebaut.

---

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

### Abnahme `JR-2-10a` (2026-08-01) — Ergebnis: **abgenommen, 24/24, unabhängig**

**Die zweite Runde, angeordnet weil die erste nicht unabhängig war.** Frische Sitzung, Rolle TEST,
Subagent `tester`; sie hat weder `JR-2-08` noch `JR-2-09` noch `JR-2-10` geschrieben. Das Protokoll der
ersten Runde wurde ausdrücklich als **Prüfgegenstand** behandelt — keine seiner Aussagen übernommen.
**Ein neuer Befund: F39** (niedrig, Testpräzision, kein Produktdefekt).

#### Was diese Runde geleistet hat, das die erste nicht konnte

Der Auftrag war ausdrücklich, die erste Runde **nicht nachzuspielen**, sondern an ihren sechs selbst
benannten dünnen Stellen anzusetzen. Alle sechs sind mit neuer, eigener Evidenz beantwortet:

| Dünne Stelle der ersten Runde                                       | Was `JR-2-10a` gemessen hat                                                                                                                                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Die 50 Kodier-Unit-Tests nur über die ADR-Vektoren mitgeprüft       | **Fünf Mutationsproben (M1–M5) am Encoder.** Vier davon exakt von der zuständigen Assertion gefangen, **ohne Übersprechen** auf unbeteiligte Fälle. Die eine Ausnahme ist **F39**                                   |
| `JR-2-07`s Vertragssuite nie mutiert — ihre „Zähne" ungeprüft       | **Drei selbst geschriebene, sabotierte Backends** gegen die Suite gefahren, alle drei gefangen; dazu eine **Kalibrierung** mit einem ehrlichen Backend (0 Fehlschläge), damit die Suite nicht einfach immer meckert |
| Gleichzeitigkeit in `JR-2-08` nur indirekt über PK-Konflikte belegt | **Direkt gemessen:** max. **20 gleichzeitig offene Transaktionen** bei 20 Writern, über `pg_stat_activity` während des Laufs gezählt — nicht mehr erschlossen                                                       |
| `readChainHeads()` als ungeprüftes Prüfwerkzeug (`DISTINCT ON`)     | **Mutiert:** `ORDER BY … DESC` → `ASC`; Fall (c) der Tamper-Suite wird korrekt **rot**. Das Werkzeug ist scharf, (c) und (d) ruhen nicht auf einem falschen Kopf                                                    |
| `verifyChain()` nur gegen „meldet etwas" vs. „meldet nichts"        | **Eigene 10-Fall-Matrix „Manipulation → erwartete Befundart"**, synthetisch, ohne Datenbank. Alle 10 korrekt — darunter `genesis_mismatch` und `chain_break`, die die DB-Suite **nie isoliert provoziert**          |
| Migrationen nur vorwärts, auf leerer Datenbank                      | **`0041`/`0042` gegen eine Datenbank mit echten Bestandsdaten** (Nutzer, Ingestion-Source, Archived-Email) migriert: sauber, FK und Trigger greifen korrekt gegen die Bestandszeilen                                |

**Die ADR-006-§6-Vektoren wurden ein zweites Mal unabhängig nachgerechnet** — und bewusst anders als
in der ersten Runde: die Erwartungswerte sind **frisch aus der ADR-Markdown transkribiert**, nicht aus
`tests/support/adr-006-vectors.ts` übernommen, und gegen `packages/journaling/dist` gerechnet.
**12/12**, einschließlich D4/D5 (Duplizier-Regel gegen RFC 6962) über eine eigene
RFC-6962-Reimplementierung mit Kreuzprobe gegen `merkleRoot()`.

#### Der Verlauf der Abnahme — zwei Lücken, vom PO gefunden, vom Prüfer geschlossen

**Das gehört ins Protokoll, weil es zeigt, woran die Prüfung der Prüfung hängt.** Die erste Fassung
des Berichts nannte als Ergebnis „**22 von 22**" — eine Zahl, die sich aus seiner eigenen
Kriterientabelle nicht herleiten ließ (24 Zeilen, davon eine als Zusatzmessung markiert, eine mit
zwei Kriterien gebündelt). Auf die Rückfrage des PO hin ergab die Nachzählung **zwei echte Lücken**,
nicht bloß einen Zählfehler:

1. **Ein Kriterium der ersten Runde fehlte vollständig:** „die Aussagen ruhen nicht auf einer
   abgeschalteten Suite". `grep` über den Bericht nach `REQUIRE_INFRA`/`DATABASE_URL`: kein Treffer.
   **Ausgerechnet das Kriterium, das alle anderen trägt** — die gesamte Evidenz für `JR-2-04`…`JR-2-09`
   ruht auf `integration 92/92` und `adversarial 18/18`. **Nachgemessen:** ohne `DATABASE_URL` und mit
   `OA_TEST_REQUIRE_INFRA=1` **scheitern beide E2-Suiten laut und benannt** („… counts as a failure
   rather than a skip"), sie überspringen nicht.
2. **Zwei Aussagen waren nur zitiert, nicht gemessen** — dieselbe Schwäche, die die erste Runde an
   sich selbst kritisiert hatte. **Nachgeholt:** die **F38-Regression frisch mutiert**
   (`$16::text::jsonb` → `$16`, Test rot, zurückgesetzt) und die **Datenbankseite von
   `JR-2-04`/`JR-2-05` mit einem eigenen Skript neu gemessen** (13 Einzelprüfungen, alle PASS: 18
   Spalten, `remote_ip` als `text`, µs-`CHECK` `23514`, `duplicate_of = seq` abgewiesen, 4 Trigger
   `tgenabled='O'`, `ON DELETE restrict` `23503`).

Beide Nachmessungen bestätigten den bestehenden Befund. **Hätte eine davon widersprochen, wäre E2
nicht abgenommen** — der Prüfer war ausdrücklich angewiesen, das Urteil nicht zu retten und die
Kriterienmenge nicht rückwirkend passend zu schneiden.

**Der PO hat daraufhin den _vollständigen_ Abgleich verlangt**, weil er selbst nur die 8-Zeilen-Tabelle
der ersten Runde durchgesehen hatte, nicht deren 16 Vektor- und 21 Datenbankprüfungen. Dieser Abgleich
förderte **elf weitere Punkte** zutage, die nur gelesen statt gemessen oder ungenau gemessen waren:

3. **Drei der 16 Vektorprüfungen** (`chain_scope_id` getauscht, `remote_ip` getauscht, gleiche Eingabe
   zweimal) waren aus dem bestehenden Test gelesen, nicht selbst gegen `dist` gerechnet.
   **Nachgeholt, alle drei PASS.**
4. **Acht der 21 Datenbankprüfungen** fehlten oder waren ungenau: `TRUNCATE` auf beiden Tabellen,
   `DELETE` auf `deployment_identity`, der **exakte** Fehlercode `23001` statt eines
   Meldungsmusters, „ganze Sekunde akzeptiert", und „nach den sechs Ablehnungen stehen alle Zeilen
   noch da". **Nachgeholt, alle PASS.**

> **Ein Detail daraus verdient festgehalten zu werden, weil es wie ein Widerspruch aussah und keiner
> war.** Der Prüfer maß für „zweite Zeile in `deployment_identity` abgewiesen" den Code `23514`,
> während `JR-2-10` `23505` berichtet. Beide stimmen: ein Duplikat mit `id=1` verletzt den
> **Primärschlüssel** (`23505`), ein Einfügen mit `id=2` den **CHECK**, der die Tabelle auf eine Zeile
> begrenzt (`23514`). Der Prüfer hat den Unterschied aufgeklärt und **beide** Wege gemessen, statt die
> Abweichung als Nebensache abzutun — das ist der Umgang, den ein Protokoll verdient.

**Bilanz des Abgleichs: 24 von 24 Kriterien, jedes mit einer eigenen Messung dieser Sitzung
unterlegt.** Keiner der drei Blöcke aus `JR-2-10`s Protokoll enthält noch einen Punkt, der hier nicht
frisch nachgerechnet wäre — mit der einen ausdrücklich benannten Ausnahme (`JR-2-10`s M3, siehe unten).

**Zur Zahl 24 selbst:** sie ist nicht dieselbe Menge wie die 23 der ersten Runde, sondern eine
durchnummerierte Liste **je Akzeptanzkriterien-Klausel** aus `03-backlog.md` für `JR-2-01`…`JR-2-09`,
plus das Kernkriterium und — als Zeile 24 — der Verfahrensnachweis „die Aussagen ruhen nicht auf einer
abgeschalteten Suite". Drei Backlog-Zeilen (`JR-2-02`s Golden-File-Klausel, `JR-2-03`s zweite Hälfte,
`JR-2-10`s Kernkriterium) verlangen **dieselbe** Tatsache und stehen als **eine** Zeile, statt dieselbe
Messung dreifach zu zählen.

**Zeile 24 ist in beide Richtungen gemessen**, nicht nur in der erwarteten: ohne `DATABASE_URL` und
**mit** `OA_TEST_REQUIRE_INFRA=1` scheitern alle fünf E2-Testdateien einzeln, **Exit 1**; ohne die
Variable überspringen sie sichtbar (`SKIPPED SUITE` je Datei, 36 Tests skipped, **Exit 0**) — das
dokumentierte Normalverhalten. Und `.github/workflows/ci.yml:57` setzt `OA_TEST_REQUIRE_INFRA: '1'`
mit einem Kommentar, der genau diesen Zweck nennt (**vom PO selbst nachgesehen**). Die CI kann sich
also nicht stillschweigend grün überspringen.

> **Die Zahl „23" der ersten Runde war aus deren Protokoll nicht herleitbar** — es führt keine
> nummerierte Kriterienliste, sondern vier Prosablöcke mit je eigener Zählung. Dass die zweite Runde
> erst ein Kriterium verlieren und dann elf Punkte nur zitieren konnte, ohne dass es im Bericht
> auffiel, liegt auch daran. **Ab jetzt gilt: eine Abnahme führt eine durchnummerierte Liste, eine
> Zeile je Kriterium**, sodass die Kopfzahl nachzählbar ist und eine Folgerunde etwas zum Abhaken hat.

> **Und eine Lehre für den PO, nicht für den Prüfer:** die Statuspflege zu diesem Protokoll wurde
> einmal **zu früh** committet (`443e083`, „23/23") — der PO hatte den vollständigen Abgleich
> beauftragt und dann nicht auf dessen Ergebnis gewartet. Berichtigt im Folgecommit. **Wer eine
> Nachforderung stellt, schreibt den Status erst, wenn sie beantwortet ist.**

#### Was `JR-2-10a` ausdrücklich **nicht** geprüft hat

Ehrlich ausgewiesen statt stillschweigend gelassen — das ist die Lehre aus der ersten Runde:

- **`JR-2-01` „baut eigenständig"** ist per `tsc`-Lauf plus `grep` belegt, **nicht** per isoliertem
  Checkout ohne die übrigen Workspace-Pakete. Ein versteckter transitiver Import über
  `node_modules`-Hoisting wäre damit nicht ausgeschlossen (laut `dependencies` aber nicht plausibel).
- **Die 16 Feldmutationen nicht einzeln nachgestellt.** Gelesen wurde, dass `MUTATIONS` strukturell auf
  genau 16 verschiedene Felder geprüft wird; **eine** eigene Mutation (`tlsVersion`) kam hinzu. Das ist
  eine Stichprobe, keine erschöpfende Nachrechnung.
- **`JR-2-10`s Mutationsprobe M3** (Sperre im Quellcode entfernt) wurde **nicht** mit derselben Mutation
  wiederholt. Stattdessen liegt die Eigenschaft als **ständiger** Regressionstest im Testbaum
  (`withoutAdvisoryLock()`), der dreimal grün lief. **Andere Evidenz, nicht dieselbe** — und als
  solche benannt statt gleichgesetzt.
- **Anchoring und Inklusionsbeweis** gelesen, aber nicht mutiert — Gegenstand von E8.
- **Crash-/Kill-Szenarien** sind nicht E2 (das ist `JR-4-10`), **`pnpm lint`** nicht ausgeführt (F35).

#### Der Volllauf — vom PO selbst reproduziert

Der Prüfer meldet drei identische Vollläufe. **Der PO hat einen vierten selbst gefahren**, weil dieser
eine Beleg alle anderen trägt:

```
Test Files  30 passed (30)
     Tests  398 passed | 2 skipped (400)
[TEST-EXECUTED] unit: ci 288/288 · integration: ci 92/92 · adversarial: ci 18/18 · selection: ci
Duration 114.37s   ·   JR-2-08: 10000 appends by 20 concurrent writers in 100582 ms (99/s)
```

`git status --porcelain` leer, `HEAD` unverändert `2ff0573` — **jede Mutation dieser Runde ist
zurückgenommen worden.** Vom PO unabhängig geprüft, nicht nur berichtet.

### Abnahme `JR-2-10` (2026-08-01) — Ergebnis: **23/23, aber nicht unabhängig** (gilt nicht als Abnahme)

> **Dieses Protokoll ist die _erste_ Runde und zählt nicht als Abnahme.** Es steht hier unverändert,
> weil es Prüfgegenstand von `JR-2-10a` war. Die Abnahme von E2 ist `JR-2-10a` oben.

**23 Kriterien geprüft, 23 erfüllt.** Keine neuen Befunde. Zwei benannte Grenzen und **ein Vorbehalt
zum Verfahren**, der zuerst kommt, weil er die Aussagekraft dieses Protokolls betrifft.

#### Der Vorbehalt: diese Abnahme ist nicht unabhängig

**`JR-2-08` und `JR-2-09` wurden in derselben Sitzung von derselben Instanz geschrieben, die sie hier
abnimmt.** ADR-014 und ADR-021 verlangen eine unabhängige Abnahme, und dieses Protokoll erfüllt das
nicht. Es ist bei der Bewertung entsprechend zu gewichten: **der Auftraggeber entscheidet, ob eine
zweite, unabhängige Runde nötig ist, bevor zurückgemergt wird.** Der Rückmerge ist deshalb **nicht**
vollzogen worden — anders als bei E1 und E13, wo er der Abnahme unmittelbar folgte.

Was zur Kompensation getan wurde, statt es zu behaupten: **nichts wurde aus den Berichten der
Umsetzung übernommen.** Jede Aussage ist neu gemessen, mit eigenen Werkzeugen, und die tragenden
Aussagen zusätzlich durch **Mutationsproben** — der Produktionscode wurde gezielt sabotiert, und die
Suite musste das melden. Eine Mutationsprobe kann ein Testautor nicht dadurch bestehen, dass er
optimistisch war.

#### Die vier Mutationsproben — der härteste Teil des Protokolls

Jede Mutation wurde am Quellcode vorgenommen, `packages/journaling` neu gebaut, der betroffene Test
gefahren, und der Zustand danach mit `git checkout --` zurückgesetzt; `git status --porcelain` war
vor **und** nach jeder Probe leer.

| #   | Mutation                                                                                           | Erwartung                | Gemessen                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| M1  | `$16::text::jsonb` → `$16` (der F38-Fix rückgängig)                                                | F38-Regressionsfall rot  | **rot**: „event_payload was stored as a JSON string, not an object — F38 is back"                                          |
| M2  | `stringField(record.tlsVersion, …)` → `stringField(null, …)`                                       | (f) und die Vektoren rot | **rot**: ADR-Vektoren 13/16 (Recordlänge, `SHA256(record)`, `chain_hash(1)`), Fall (f) rot, **und die RFC-Gegenprobe rot** |
| M3  | `SELECT pg_advisory_xact_lock($1)` → `SELECT $1::bigint`                                           | Lasttest rot             | **rot** nach 295 ms: `duplicate key value violates unique constraint "journal_ledger_chain_scope_id_seq_pk"`               |
| M4  | in (f) `set tls_version = 'TLSv1.3'` → `set tls_version = tls_version` (Manipulation ohne Wirkung) | (f) rot                  | **rot**: `expected [] to have a length of 1` — der Verifier meldet bei unmanipulierter Kette **nichts**                    |

**M4 ist die wichtigste der vier.** Sie schließt die Fehlerklasse aus, an der eine Tamper-Suite
lautlos scheitert: ein Verifier, der immer meckert, macht jeden Tamper-Test grün, ohne zu
unterscheiden. Der Verifier produziert nachweislich keine Falsch-positiven — und das deckt sich mit
der zweiten, unabhängigen Beobachtung, dass er über **10 000** unmanipulierte Zeilen keinen einzigen
Befund meldet.

**M2 belegt zusätzlich, dass die RFC-Gegenprobe ihren Zweck erfüllt.** Sie wurde rot, als die
Kodierung um genau ein Feld in Richtung RFC-Formel zurückgeschnitten wurde — das ist die Regression,
gegen die sie geschrieben ist, und sie fängt sie.

#### Testvektoren aus ADR-006 §6 — das Kernkriterium von `JR-2-10`

Geprüft mit einem eigenen Skript, das die Vektoren **aus `05-entscheidungen.md` parst** statt sie
abzutippen, und sie gegen `packages/journaling/dist` (das gebaute Artefakt, das die Tests importieren)
rechnet. Abtippen hätte belegt, dass das Skript mit sich selbst übereinstimmt; so ist belegt, dass der
Code mit der **Entscheidung** übereinstimmt, und die Prüfung bleibt gültig, wenn eine Seite sich ändert.

**16 von 16 Prüfungen bestanden**, darunter alle acht Vektoren (`G1`, `G2`, Recordlänge **351 Byte**,
`SHA256(record)`, `chain_hash(1)`, Blatt, Wurzeln über 2 und 3 Blätter) und die Eigenschaftsnachweise,
die die ADR als „alle ausgeführt" bezeichnet: `rcpt`-Reihenfolge getauscht ⇒ anderer Hash,
`event_payload`-Schlüssel umgestellt ⇒ **gleicher** Hash, `chain_scope_id` getauscht ⇒ anderer Hash,
`remote_ip` getauscht ⇒ anderer Hash, gleiche Eingabe zweimal ⇒ identische Bytes.

Die Merkle-Regel wurde in beide Richtungen nachgerechnet, mit einer **hier** implementierten
Duplizier-Regel als Vergleich: unter ihr gilt `root[A,B,C] == root[A,B,C,C]` (**true**, `D4`), unter
RFC 6962 nicht (**false**, `D5`), und `merkleRoot()` aus dem Produktionscode liefert die RFC-6962-Wurzel.
Damit ist ADR-022 Festlegung 1 — der Anker bezeugt die **Menge** der Ketten — nicht nur behauptet.

#### Datenbankseite: `JR-2-04` und `JR-2-05`, direkt gemessen

**Nicht über den Testharness des Projekts**, weil Harness und Tests Teil dessen sind, was abgenommen
wird. Stattdessen eine eigene Datenbank, die echten Migrationen des Repositorys angewandt, und die
Anweisungen aus den Akzeptanzkriterien direkt abgesetzt. **21 von 21 Prüfungen bestanden:**

- `deployment_identity` trägt nach der Migration **genau eine** Zeile mit einer echten UUID; eine
  zweite wird abgewiesen (`23505`).
- Ein µs-Wert, der kein ms-Vielfaches ist, wird vom `CHECK` abgewiesen (`23514`); ein ms-Vielfaches und
  eine ganze Sekunde werden angenommen. **Das ist das ausdrücklich benannte Kriterium von `JR-2-04`.**
- `duplicate_of = seq` wird abgewiesen (`23514`) — das in `JR-2-04` selbst gefundene Loch ist zu.
- Das Löschen einer `ingestion_source` mit Ledger-Zeilen ist blockiert (`23503`, `ON DELETE restrict`).
- 18 Spalten; `size_bytes` und `content_sha256` **nullable** (ADR-006, `anchor`-Events); `remote_ip` ist
  **`text`**, nicht `inet`.
- **Vier** Trigger vorhanden und `tgenabled = 'O'`. `UPDATE`, `DELETE` **und `TRUNCATE`** werden auf
  **beiden** Tabellen mit `23001` abgewiesen — sechs Anweisungen, sechs Ablehnungen. `INSERT` läuft
  weiter, und nach den sechs abgewiesenen Anweisungen stehen noch alle drei Zeilen da.

#### Die übrigen Kriterien

| Kriterium                                               | Beleg                                                                                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JR-2-01`: kein Import aus `@open-archiver/backend`     | `grep` über `packages/journaling/src/` — ein Treffer, und der ist der Kommentar, der die Regel benennt. `dependencies` = nur `@open-archiver/types` |
| `JR-2-06`: Hash-Vorberechnung strukturell unmöglich     | `LedgerAppendRequest` hat **15** Felder; `seq`, `prevChainHash`, `chainHash` sind **keines** davon — am gebauten `.d.ts` abgelesen                  |
| `JR-2-07`: eine Vertragssuite, zwei Implementierungen   | beide Testdateien importieren `../support/ledger-backend-contract`; einmal `InMemoryLedgerBackend`, einmal `PostgresLedgerWriter`                   |
| `JR-2-08`: reproduzierbar mit geloggtem Seed            | `resolveSeed('journal-ledger-concurrency')`, und der Seed steht in der Durchsatzmeldung jedes Laufs                                                 |
| `JR-2-09`: (d) und (h) sind eigene Befundarten          | `LedgerFinding` führt `split_brain` als eigene Variante; das Fehlen einer Kette wird über den Ankervergleich gemeldet, nicht als `chain_break`      |
| Die Aussagen ruhen nicht auf einer abgeschalteten Suite | ohne `DATABASE_URL` und mit `OA_TEST_REQUIRE_INFRA=1` **scheitern beide E2-Suiten laut und benannt** statt zu überspringen                          |
| Volllauf nach allen vier Mutationsproben                | **398 passed \| 2 skipped** bei 30 Dateien, Exit 0, `unit 288/288 · integration 92/92 · adversarial 18/18`                                          |
| `06-status.md` aktualisiert                             | dieser Abschnitt                                                                                                                                    |

#### Zwei Grenzen, die zu benennen sind — keine Mängel

1. **Die Fälle (c) und (e) aus Testplan §12.5 sind in E2 nur so weit darstellbar, wie es ohne E7/E8
   geht, und das ist so gewollt.** Der Testplan sagt selbst, dass (c) E8 voraussetzt. Der „Anker" ist
   im Test eine festgehaltene Merkle-Wurzel, kein RFC-3161-Token; (e) prüft folglich, dass ein
   manipulierter Inklusionspfad die **Wurzel** nicht mehr trifft, nicht dass eine **Token-Signatur**
   fehlschlägt. Für die Aussage von (c) ist das ausreichend — es zählt, dass der Wert das System vor
   der Manipulation verlassen hat, nicht wo er liegt. **In E8/E9 ist beides gegen ein echtes Token
   nachzuziehen** (`JR-8-05`, `JR-9-07` führen dieselben Fälle über die CLI).
2. **Das F13-Kriterium ist sinngemäß, nicht wörtlich erfüllt.** Es verlangt, die Frist „über die
   erwartete Laufzeit zu heben". Der Code **prüft** den wirksamen Wert und hebt ihn nur, wenn er
   darunter liegt — beim Standardwert von zwei Stunden greift er also nicht. Das ist die sichere
   Richtung: ein bedingungsloses Setzen auf den Bedarf (30 min) wäre gegenüber dem Standard eine
   **Senkung** und damit genau der Fehler, der F12 war. Die Abweichung ist im Code begründet, und die
   nicht behebbare Gegenrichtung — ein fremder Prozess liest seine eigene Umgebung — ist dort ebenfalls
   ausgeschrieben statt überspielt.

#### Was diese Abnahme ausdrücklich **nicht** behauptet

- **Kein SMTP-Empfangspfad.** E2 liefert den Ledger, nicht den Receiver. Der Acceptance-Contract
  (`250 OK` erst nach fsync von Spool **und** Ledger) ist damit **nicht** erfüllt — es gibt keinen
  Spool und niemanden, der `250` sendet. Das ist E3/E4.
- **Keine Durability-Aussage über Variante (b).** Die Vertragssuite prüft Signaturen; die Pflichtenliste
  in `ledger-port.ts` ist eine Liste von Schulden, kein Nachweis.
- **F37 bleibt offen** (die Anwendung verbindet als Superuser und Eigentümer und kann den Trigger selbst
  abschalten). Der Trigger schließt **F1** als Manipulationsweg; die Rechtetrennung ist E11.

---

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

### `JR-13-12` erledigt (2026-07-30) — Grundlagenarbeit direkt auf dem Integrationsbranch

Die dritte, veraltete Stelle des Berechtigungsvokabulars ist berichtigt
(`docs/services/iam-service/iam-policy.md`): die Action **`export`** fehlte in der Liste, und **`manage`**
war als Aufzählung `create/read/update/delete/search/sync` beschrieben statt als das, was es ist.

**Das Kriterium ist gemessen, nicht behauptet.** Ein Vergleichsskript liest alle drei Stellen — die
Union-Typen aus `iam.types.ts`, die `validActions`/`validSubjects`-Sets aus `policy-validator.ts` und die
zwei Aufzählungen aus der Markdown-Datei — und stellt sie nebeneinander: **8 Actions und 7 Subjects,
Übereinstimmung an allen drei Stellen**, und kein Satz beschreibt `manage` mehr als feste Aufzählung.

**Die drei neu geschriebenen Faktenaussagen sind ebenfalls gemessen** — gegen den **gebauten** Code
(`dist/iam-policy/ability.js`), nicht gegen den Entwurf. Das ist die direkte Lehre aus E13, wo dreimal in
Folge der Defekt in Text saß, der in derselben Runde neu geschrieben wurde:

| Aussage der neuen Doku                             | Messung                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `manage` deckt `export` mit ab                     | `manage all` → `can('export', 'archive')` = **true**                |
| `manage` deckt auch künftige Actions ab            | `manage archive` → `can('teleport', 'archive')` = **true**          |
| `manage` ist keine Aufzählung                      | die explizite Sechserliste → `can('export', 'archive')` = **false** |
| `manage` wirkt nur auf seinem Subject (Gegenprobe) | `manage archive` → `can('export', 'ingestion')` = **false**         |

**Mitgezogen, weil sie sonst widersprüchlich zurückbleiben:** `CLAUDE.md` §5.4 (Überschrift und der
Absatz „(3) is stale") und der Eintrag in `09-befunde-bestandscode.md` unter „Bereits im Backlog erfasste
Bestandsprobleme", der die Sache `JR-11-03` zuordnete. **Kein Produktionscode, kein Test, keine Migration.**

### Abnahme `JR-13-09c` (2026-07-30) — Ergebnis: **E13 ABGENOMMEN**

**Rolle Tester, Umfang `JR-13-07` Kriterium 12 und `JR-13-18` (F31 tragend, F32–F34 mit).** Prüfgegenstand
`939df10`. **Ohne DEV-Bericht** — es gab keine Entwicklerbehauptung, die der Prüfer hätte übernehmen
können; jede Zahl stammt aus einem eigenen Lauf. Host war ein **Windows-11-Rechner**, nicht der
Linux-Container der Vorsessions; PostgreSQL **17.10** als Wegwerf-Cluster (dieselbe Version wie die CI).

**Umfang.** `git show --stat 939df10`: **eine** Datei,
`docs/user-guides/upgrade-and-migration/access-control-changes.md`, 79 eingefügt / 45 entfernt — vom PO
unabhängig nachgeprüft. `git log --oneline --name-only 939df10..31bed24` bestätigt, dass die sieben
Commits darüber ausschließlich Planungsdokumente und `.claude/agents/*.md` anfassen, nie die geprüfte
Seite und nie Produktionscode.

| #   | Kriterium                                              | Ergebnis                                                                                                                                                                          |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Anker der Textprüfung neu gesetzt                      | **erfüllt** — vergiftete Wegwerf-Kopie mit dem exakten F31-Satz, Scanner feuert dort (1/7); erst danach der reale Lauf gewertet: **0/7** bekannte Brüche                          |
| 2   | Ganze Seite, nicht nur der Diff                        | **erfüllt** — 675 Zeilen gegen ein breiteres, unkalibriertes Raster; zwei Treffer, beide **Negationen** („neither stands in for the other"), also ADR-020-konform. Kein Neufund   |
| 3   | Beide F31-Hälften getrennt                             | **erfüllt** — Absolutsatz weg **und** dritte Oberfläche benannt (Z. 649). Dritte Zahl **gemessen**: Archiv `read`/`search` bleiben `undefined`, `ingestion/read` kippt auf `"-1"` |
| 4   | Die fünf neuen Faktenaussagen von `JR-13-18`           | **erfüllt** — alle fünf einzeln mit Fixture-Rollen gegen die **wörtlich aus der `.md` extrahierte** Query 2 gemessen (Belege unten)                                               |
| 5   | Umfang, Volllauf, `lint`, `docs:build`, Blob-Identität | **erfüllt** — `250 passed \| 2 skipped` bei **17** Dateien, Exit 0; Sonde entfernt; `docs:build` Exit 0, kein `dist/dev/`; `FilterBuilder.ts`/`mongoToMeli.ts` blob-identisch     |

**Die fünf Faktenaussagen im Einzelnen**, jede gegen echtes Postgres gefahren:

- **(a)** Der Befund „archive search granted without archive read" nennt **keine** Regelnummer — die
  Ausgabe enthält keine Ziffer.
- **(b)** F33s Aufteilung stimmt: eine verunstaltete Aktion mit Skalar-`conditions` erzeugt **keine**
  Zeile (verloren), dieselbe Aktion mit `$regex` **erscheint** (kommt an, weil aus der Regel statt aus
  dem Paar gelesen). Zusatzprobe: ein blanker Skalar an Stelle einer Regel **stoppt die Abfrage nicht**,
  die folgende Regel wird korrekt als „#2" gezählt.
- **(c)** F32 „finds all five": alle fünf Nicht-Array-Formen von `policies` (Objekt, String, Zahl,
  Boolean, `null`) kommen zurück. Die zitierten Fehlertexte sind real geprüft — Objekt →
  `cannot extract elements from an object`, Zahl → `cannot extract elements from a scalar`.
- **(d)** F34 „just as readily": alle vier Formen **innerhalb** eines wertseitigen `$in` werden gemeldet.
- **(e)** Eine reine `cannot`-Regel mit `action: 'manage'`, `subject: 'all'` erzeugt **je drei** Zeilen —
  eine pro (`read archive`, `search archive`, `read ingestion`).

**Aufräumen:** alle Wegwerf-Datenbanken gelöscht, 0 `oa_test_*`/`oa_probe_*` übrig, Arbeitsbaum leer,
kein Produktionscode und kein Planungsdokument vom Prüfer angefasst.

> **Der eine Vorbehalt des Prüfberichts ist widerlegt — vom PO nachgemessen.** Der Bericht meldete einen
> neuen niedrigen Befund („F36"): eine Prettier-Warnung an der geprüften Seite, die angeblich **auch nach**
> CRLF→LF-Normalisierung bestehen bleibt und von einem tab-eingerückten JSON-Block herrühre. Beides ist
> falsch. `.prettierrc` setzt **`useTabs: true`** — die Tabs sind vorgeschrieben, nicht fehlerhaft. Und
> die Normalisierung hält der Gegenprobe nicht stand: eine LF-Kopie derselben Datei ist `prettier --check`
> **grün (Exit 0)**, die CRLF-Kopie rot, und die Prettier-API liefert nach CRLF-Normalisierung **0**
> abweichende Zeilen bei 675. Die Warnung ist damit **reines F35** und kein zusätzlicher Defekt. Geführt
> als **F36 (widerlegt)** in `09-befunde-bestandscode.md`, damit die nächste Session denselben Kandidaten
> nicht erneut für echt hält. **Das Verdikt ändert sich dadurch nicht — es verliert nur seine Einschränkung.**

### E13 — `JR-13-18` committet (2026-07-29, Rolle `senior-dev`) — **ohne DEV-Bericht**, Abnahme offen

**Commit `939df10`** („docs(upgrade): let each check report its own surfaces, and no more"), **eine**
Datei: `docs/user-guides/upgrade-and-migration/access-control-changes.md`, 79 Zeilen ergänzt / 45
entfernt. `git show --stat` bestätigt den Umfang; die temporäre Messsonde
`packages/backend/tests/integration/f31-third-number.int.test.ts` ist aus dem Arbeitsbaum entfernt.

> **Es liegt kein Bericht der Rolle `senior-dev` vor.** Der Agent hat sich zweimal als verfügbar
> gemeldet, ohne die Nacharbeit zu berichten; eine ausdrückliche Nachforderung blieb unbeantwortet.
> **Alles unten ist die Lesart des PO aus dem Diff, nicht gemessen** — insbesondere fehlen der Nachweis
> über `FilterBuilder.create` für die dritte Zahl, die Ergebnisse von `lint`/`docs:build`/`dist/dev` und
> die Angabe, wie der Autor seinen eigenen neuen Text gegen ADR-020 geprüft hat. `JR-13-09c` muss deshalb
> **alles selbst messen** und darf nichts übernehmen. Das ist für diese Runde eher ein Vorteil: es gibt
> keine Behauptung, die ein Prüfer versehentlich durchwinken könnte.

**Was der Diff zeigt (PO-Lesart, zu verifizieren):**

| Befund  | Umsetzung im Diff                                                                                                                                                                                                                                                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F31** | Die **dritte Zahl** ist aufgenommen: „rows the archive list returns, the result count of one search, and how many entries the ingestion sources list shows. **All three, because they are filtered separately and can move separately**"                                                                                                             |
| **F31** | Der Absolutsatz ist durch sein **Gegenteil** ersetzt und nennt den F31-Fall als Warnung: „**Do not read one number for another**: a role with archive grants whose only statement about ingestion sources is a prohibition — the shape change 1 describes — keeps both archive numbers and loses the ingestion sources list entirely"                |
| **F31** | Neuer Abschnitt **„What this check does not show you"**: „Three unchanged numbers are three unchanged numbers. That is what was measured, and **it is not a verdict on the role**", dazu vier benannte unsichtbare Fälle und „a moved number does not name its own cause"                                                                            |
| **F31** | Die Bürgschaft ist in **beiden** Richtungen negiert: „neither stands in for the other: each reports what it can measure and says what it cannot" · „is worth running for that reason, **not because it stands in for this list**" · „**neither result excuses you from the other**"                                                                  |
| **F32** | Beide Fehlertexte genannt (`an object` für ein Objekt, `a scalar` für String/Zahl/Boolean/JSON-`null`), Heilmittel „**which finds all five**"                                                                                                                                                                                                        |
| **F33** | „reported **in part**" mit Angabe, welche Befunde verloren gehen (die drei bedingungsfreien und der für ein nicht-objektartiges `conditions`) und welche ankommen (die aus dem `conditions`, „because those are read from the rule rather than from the pair"); die bare Skalar-Regel bleibt „skipped without a row, and without stopping the query" |
| **F34** | „That is **a class of position rather than a single case**", mit der Erweiterung, dass ein Operatorname, ein Condition-Key oder ein leeres `$or` an derselben wertseitigen Stelle „just as readily" gemeldet wird                                                                                                                                    |

**Der Verhaltenscheck nennt seinen Umfang jetzt selbst:** „What it measures are **the three surfaces the
application builds a row filter for** — the same three the row-level findings of Query 2 are limited to —
and nothing besides them." Damit ist die Konstruktion aus ADR-020s Berichtigung umgesetzt: jedes
Verfahren benennt, was es messen kann, und keines bürgt für das andere.

**Fünf neue Faktenaussagen sind mit dem Fix entstanden und sind ungeprüft** — sie sind präziser als der
alte Text und deshalb leichter falsch. `JR-13-09c` muss jede einzeln nachmessen: dass der Befund „archive
search granted without archive read" **keine** Regelnummer nennt; die F33-Aufteilung in verlorene und
ankommende Befunde inklusive „names the rule number with no action or subject beside it"; F32s „finds all
five"; F34s „just as readily"; und dass `manage` sowie `subject: "all"` gegen **jede** der drei
Berechtigungen gematcht werden.

### Abnahme `JR-13-09b` (2026-07-29) — Ergebnis: **E13 zum dritten Mal nicht abgenommen**

Unabhängige Session, Rolle `tester`, HEAD `2a4ea80`, **schmaler Umfang**: `JR-13-07`s Kriterium 12 und die
Kriterien von `JR-13-17`, nicht die 23 Kriterien von `JR-13-09a` erneut. 18 Kriterien einzeln,
**17 erfüllt**.

**Gebrochen ist Kriterium 12 — die Textprüfung gegen ADR-020. Neuer Befund F31**, dieselbe Klasse wie
F27 und F30. Der Absolutsatz ist nicht verschwunden, sondern von der Abfrage in den **Verhaltenscheck**
gewandert, den `JR-13-17` neu geschrieben hat. Details in `09-befunde-bestandscode.md` unter **F31**, die
Ursachenanalyse in ADR-020s Berichtigung. Drei weitere niedrige Befunde: **F32**, **F33**, **F34**.

**Die Abfrageseite von `JR-13-17` (a) ist unabhängig belegt und in Ordnung** — das ist der Teil, den
`JR-13-09a` als gebrochen gemeldet hatte:

| Kriterium                                                         | Beleg                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Blöcke **wörtlich** aus der `.md` (Fallstrick 17)                 | `fenced blocks total: 5 (json, bash, sql, sql, sql)` · `sql blocks: 3` · `query1.sql` Zeilen 205–209 / 115 B / `sha256=d17c3469…` · `query2.sql` Zeilen 234–450 / 9843 B / `sha256=d9a3542f…` · `query3.sql` Zeilen 542–613 / 2997 B / `sha256=0afb4a14…`                                                          |
| psql-Meta-Befehle in den Blöcken                                  | `0` in allen fünf Fences (Muster `^\s*\\[a-zA-Z?!]`) — es ist nichts psql-Spezifisches im Spiel                                                                                                                                                                                                                    |
| **Alle acht** F30-Formen gemeldet, je mit Position                | 8 × `REPORTED`, u. a. `[empty condition object] rule #1: "conditions" -> "$not" is {}` · `[condition node is not an object] … the body of "conditions" -> "$not" is 5` · `"conditions" -> "$or" -> [] -> "$and" -> [] is {}` · `a branch of "conditions" -> "$or" is 5`                                            |
| Gegenproben und die Wurzelformen aus `JR-13-14`                   | 15 Gegenproben, alle `REPORTED`: `condition branch list is empty` für `{"$or": []}`/`{"$and": []}`; die 9 Wurzelwerte je 2 Zeilen `conditions is not an object` **mit der richtigen der zwei Lesarten**; `{}` an der Wurzel; `attachment.name`; `$regex`; `{"$or": 5}` als `condition branch list is not an array` |
| **Keine Falsch-positiven** (der Hauptrisikopunkt)                 | 18 Kontrollen `silent OK` in **allen drei** Ausgaben — die drei `predefined_*` wörtlich aus dem Produktionscode (`UserService.ts:259–274`, `iam.controller.ts:108–146`) plus 15 normale Formen inkl. F4-Form, F5-Form, tief verschachtelt, `$exists:false`, „Regel ist kein Objekt"                                |
| Fallstrick 20 vermieden                                           | `jsonb_typeof(b.value) <> 'object'` steht nur unter `c.key IN ('$or','$and')` bzw. `c.key = '$not'` — geprüft wird nur ein Knoten in **struktureller** Position                                                                                                                                                    |
| `cannot` mit Operator-Bedingung ⇒ genau **eine** Zeile            | `-> 1 row(s)`: `[prohibition with an operator condition] rule #2 uses the operator $ne inside a "cannot" condition` — kein Formbefund daneben (Änderung 5, beabsichtigt)                                                                                                                                           |
| Kreuzvergleich gegen den **echten** Übersetzer                    | 42 Bedingungswerte durch `dist/helpers/mongoToDrizzle.js` gegen die Q2-Ausgabe: **`false negatives (refused but silent): 0`**, `over-reports (accepted but reported): 1` — und das ist die dokumentierte Übermeldung                                                                                               |
| Bewusste Abweichung 1 (`conditions: 5` ohne Zeilenfilter)         | `DEV-1 … (dashboard) -> 0 row(s) in Q2` — wie dokumentiert, kein Befund                                                                                                                                                                                                                                            |
| Bewusste Abweichung 2 (`{"id":{"$in":[{}]}}`)                     | `-> 1 row(s)`: `[empty condition object] rule #1: "conditions" -> "id" -> "$in" -> [] is {}` — Übermeldung mit Position, wie dokumentiert                                                                                                                                                                          |
| F28 unberührt                                                     | Q3 zwei Zeilen, `key=userEmial` → `archived_emails.user_emial` **und** `ingestion_sources.user_emial`                                                                                                                                                                                                              |
| Query 1 funktioniert weiter                                       | `{"email":"no-role@example.com"}` — der Nutzer **mit** Rolle erscheint nicht                                                                                                                                                                                                                                       |
| Volllauf, Exit 0, zitierte Testzahl                               | `Test Files 17 passed (17)` · `Tests 250 passed \| 2 skipped (252)` · `Duration 19.72s` · `TEST_EXIT=0`                                                                                                                                                                                                            |
| Die 2 Skips identifiziert                                         | `SKIPPED SUITE [nightly] mongoToDrizzle() adversarial -- 25000 seeded trees` · `SKIPPED SUITE [manual] … 30000 ms soak`, beide in `tests/adversarial/mongo-to-drizzle.adv.test.ts`                                                                                                                                 |
| `predefined-roles.int.test.ts` 7/7                                | `✓ integration … predefined-roles.int.test.ts (7 tests) 2255ms`, 0 Fehler                                                                                                                                                                                                                                          |
| `FilterBuilder.ts` / `mongoToMeli.ts` blob-identisch zu `13a7114` | `f7efead24dc7935b67d5cb68210a4496f71dfe0d` bzw. `9e1ba29fefb11c536678c69441d3420e4ff025af`, je in beiden Revisionen                                                                                                                                                                                                |
| Keine Rückstände                                                  | `git status --short` leer · `oa_test_* databases: 0` nach jeder Probe und nach der Suite                                                                                                                                                                                                                           |

**Kriterium 13 (`JR-13-07`s Kriterium 12) ist auf der Abfrageseite erfüllt und im selben Dokument wieder
entwertet:** Query 2 meldet alle acht F30-Formen **und** die F31-Rolle korrekt
(`prohibition without a matching grant: read ingestion is forbidden by rule #2, but no rule grants it`) —
die Seite sagt dem Betreiber aber, er dürfe genau diese Meldung verwerfen. Deshalb bricht F31 dieses
Kriterium, obwohl die SQL stimmt.

**Umgebung dieser Abnahme — sie unterscheidet sich von allen vorherigen.** Windows-11-Host statt
Linux-Container. PostgreSQL **17.10** (`on x86_64-windows, compiled by msvc-19.44.35226`), Wegwerf-Cluster
aus `@embedded-postgres/windows-x64@17.10.0-beta.17` im Scratchpad — keine Systeminstallation, kein
Docker, kein Dienst. **41 Migrationen / 141 Statements** direkt aus `src/database/migrations` in
Journal-Reihenfolge, 22 Tabellen in `public`. `corepack pnpm` 10.13.1 (pnpm ist nicht im PATH),
Node 24.14.0. **`psql.exe` fehlt** in der Windows-Binärdistribution — die SQL-Blöcke liefen über einen
Node-`postgres`-Client.

**Was in dieser Umgebung nicht prüfbar war:**

- **Der Remote-Abgleich.** `git ls-remote origin refs/heads/claude/journaling-e13-iam-hardening` →
  `fatal: Could not read from remote repository. Please make sure you have the correct access rights`
  (dritter erfolgloser Versuch der Session). `HEAD` = `2a4ea80` = lokale `origin/…`-Ref und deckt sich mit
  dem Handover; dass der Remote denselben Stand trägt, ist **unbestätigt**. Entscheidung des
  Auftraggebers: auf dem lokalen Stand arbeiten, **kein Push vor dem Abgleich**.
- **`psql` selbst.** Die Blöcke enthalten keine Meta-Befehle, es ist also nichts psql-Spezifisches im
  Spiel — dass psql zeichengleich ausgibt, ist aber nicht gemessen (`JR-13-09a` hatte das auf 16.13/17.10
  getan).
- **Die Vor-E13-Hälfte von F31.** Gemessen ist nur `HEAD`. Dass dieselbe Rolle vor dem Update alle
  Ingestion-Quellen sah, steht in Änderung 1 der Seite und ist durch die E13-Regressionssuite belegt,
  wurde hier aber nicht gegen den `FilterBuilder` von `efea6bc` nachgemessen. Der Befund hängt nicht
  daran — er betrifft die **Vollständigkeit der zwei vorgeschriebenen Zahlen**, und die ist aus der Seite
  selbst belegt.
- **Die 7 Fälle von `predefined-roles.int.test.ts`** sind auf Dateiebene grün, nicht einzeln über einen
  JSON-Report ausgewiesen.
- **Meilisearch, Redis, Tika, Docker** fehlen; für diesen Umfang nicht gebraucht.

**Kein Produktionscode, kein Test, keine öffentliche Doku geändert.** Proben nur im Scratchpad.
Zwei unversionierte Dateien mit kaputten Namen (Shell-Quoting-Reste aus der Umgebungsprüfung dieser
Session, 0 B bzw. `---`) lagen im Repository-Wurzelverzeichnis und sind entfernt. Neu auf der Platte,
`.gitignore`-gedeckt: `packages/backend/dist`, `packages/types/dist` (für den Übersetzer-Kreuzvergleich
gebaut). Der Cluster läuft weiter, auf Anweisung des PO.

> **Fallstrick für Folge-Sessions (kein Produktbefund).** `postgres.js` serialisiert einen an einen
> `jsonb`-Parameter gebundenen JS-Wert **selbst**. Ein vorher mit `JSON.stringify` erzeugter String wird
> damit doppelt kodiert und landet als jsonb-_String_ in `roles.policies`; Query 2 **und** Query 3 brechen
> dann bei **jeder** Rolle mit `cannot extract elements from a scalar` ab — was exakt wie ein
> Abfragedefekt aussieht und in dieser Abnahme eine Diagnoserunde gekostet hat. Richtig: Bindung als
> `$3::text::jsonb` **plus** Selbstprüfung `jsonb_typeof(policies) = 'array'` direkt nach dem Insert.
> Ohne die Selbstprüfung kommt derselbe Fehler still wieder.

> **Zweiter Fallstrick, gefährlicher als der erste: eine Textprüfung gegen diese Seite ist fail-open,
> wenn sie den Whitespace nicht normalisiert.** Die Prosa in `access-control-changes.md` ist **hart
> umbrochen**; der F31-Satz steht über zwei Zeilen (`… unchanged is\n not affected …`). Das erste Muster
> des Prüfers enthielt dort ein einfaches Leerzeichen und meldete deshalb
> `still carries the F31 absolute: false` — **das Werkzeug erklärte den bekannten Defekt für behoben.**
> Aufgefallen ist es nur, weil beide Werkzeuge gegen den **noch unbehobenen** Stand kalibriert wurden
> (`KNOWN BREAK 2`, Selbsttest `F31 sentence still present: true` / `scanner flags it: true`). Das ist
> dieselbe Fehlerklasse wie „ein Test, der nie rot war, belegt nichts", eine Ebene höher: nicht der
> Prüfgegenstand war fail-open, sondern die **Prüfung**. Jede künftige Textzusicherung gegen diese Datei
> normalisiert zuerst den Whitespace und weist einen Selbsttest gegen den Vor-Fix-Stand aus.
>
> **Verallgemeinert und in `.claude/agents/tester.md` aufgenommen** („Calibrate every negative finding"):
> die Fehlerklasse ist nicht „hart umbrochene Prosa", sondern **ein Negativbefund ohne Kalibrierung**.
> „Ich habe nichts gefunden" ist erst ein Ergebnis, wenn dasselbe Werkzeug den bekannten Fall findet.
> Daraus folgt eine zweite Regel, die in `JR-13-09c` greift: **entfernt der Fix genau den Satz, an dem der
> Selbsttest hängt, verliert die Prüfung ihren Anker** und ein sauberer Lauf belegt wieder nichts. Dann
> ist der Anker neu zu setzen — Wegwerf-Kopie des behobenen Artefakts, den Fall absichtlich wieder
> einsetzen, zeigen dass das Werkzeug ihn noch meldet.

### E13 — `JR-13-17` erledigt (2026-07-29, Rolle `senior-dev`) — F30 behoben, ADR-020 umgesetzt

**Eine Datei geändert:** `docs/user-guides/upgrade-and-migration/access-control-changes.md`
(`07ac661`). **Kein Produktionscode, kein Test, keine Migration, kein i18n-Key.**
`packages/backend/src/helpers/conditionKey.ts` war die **Referenz**, aus der die Abfragebedingungen
abgeleitet sind, und ist nicht angefasst.

#### (a) Die zwei Formbefunde stehen auf Knotenebene

`cond` trägt jetzt eine Spalte `path` (Wurzel `"conditions"`, Objektkind `-> "key"`, Arrayelement
`-> []`), damit jede Meldung die **Position** nennt. Die Prädikate sind aus `checkConditionsShape()` und
den Rekursionsstellen in `mongoToDrizzle` abgeleitet:

| Befundtyp                               | Woraus                                                                     | Prädikat                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `empty condition object`                | `cond` (ersetzt den Wurzel-Befundtyp `empty conditions object` aus `pair`) | `c.node = '{}'::jsonb` — **jede** Position                                            |
| `condition node is not an object`       | `cond`                                                                     | Element eines `$or`/`$and`-Arrays bzw. Rumpf eines `$not`, `jsonb_typeof <> 'object'` |
| `condition branch list is not an array` | `cond`                                                                     | `$or`/`$and`, dessen Wert kein Array ist                                              |
| `conditions is not an object`           | `pair` — **unverändert**                                                   | Wurzelvergleich, mit den zwei Lesarten je Wert                                        |

**Der Fallstrick, bewusst umgangen:** ein pauschales `jsonb_typeof(c.node) <> 'object'` hätte **jedes
Blatt** jeder normalen Bedingung gemeldet (Fallstrick 20). Geprüft wird nur ein Knoten, der als
Bedingungsobjekt gelesen wird — die Elemente einer Operandenliste (`$in`) sind Werte und bleiben außen
vor.

#### Nachweis 1 — die acht F30-Formen werden gemeldet

Blöcke mit einem Skript aus der `.md` **extrahiert und wörtlich** gefahren (Fallstrick 17), PostgreSQL
16.13 ohne Docker (Fallstrick 8), alle 41 Migrationen per `psql -f`, 26 gesäte Rollen:

```
python3 extract.py docs/user-guides/upgrade-and-migration/access-control-changes.md ./sql
psql -v ON_ERROR_STOP=1 -d oa_probe_final -f ./sql/query2.sql
```

```
 F30-1 not-empty-object        | empty condition object          | rule #1: "conditions" -> "$not" is {}, which states no condition …
 F30-2 not-scalar              | condition node is not an object | rule #1: the body of "conditions" -> "$not" is 5, not an object of condition keys
 F30-3 or-and-empty-branch     | empty condition object          | rule #1: "conditions" -> "$or" -> [] -> "$and" -> [] is {} …
 F30-4 cannot-key-empty-object | empty condition object          | rule #2: "conditions" -> "userEmail" is {} …
 F30-5 or-scalar-branch        | condition node is not an object | rule #1: a branch of "conditions" -> "$or" is 5, not an object of condition keys
 F30-6 or-empty-first          | empty condition object          | rule #1: "conditions" -> "$or" -> [] is {} …
 F30-7 or-empty-last           | empty condition object          | rule #1: "conditions" -> "$or" -> [] is {} …
 F30-8 and-empty-last          | empty condition object          | rule #1: "conditions" -> "$and" -> [] is {} …
```

**Gegenproben im selben Lauf, alle weiter gemeldet:** `{"$or": []}` und `{"$and": []}`
(`condition branch list is empty`), `conditions: 5` (`conditions is not an object`, mit der richtigen
Lesart, je Paar eine Zeile), `conditions: {}` an der Wurzel, `attachment.name` flach und in einem
`$or`-Zweig. Query 1 → 0 Zeilen, Query 2 → 16, Query 3 → 0, Exit 0.

**Zusätzliche Formen derselben Klasse, in einem zweiten Lauf gemessen** (nicht in F30 aufgeführt, vom
Übersetzer aber ebenfalls verweigert): `{"$or": 5}`, `{"$or": {…}}`, `{"$and": {}}` ⇒
`condition branch list is not an array`; `{"$not": []}`, `{"$or": [{…}, null]}`, `{"$or": [{…}, []]}`,
`{"$or": [{…}, ["x"]]}` ⇒ `condition node is not an object`. Query 3 findet den Tippfehler-Key unter
`manage all` weiter (F28 unberührt, zwei Zeilen).

#### Nachweis 2 — keine Falsch-positiven (der Hauptrisikopunkt)

Maschinell verglichen, nicht gelesen: die Namensspalte von Query 2 gegen die Sollmenge.

```
=== must stay silent: predefined_* + OK-* controls ===
silent OK  Super Admin | End user | Read only
silent OK  OK-1 {"userEmail":"a@x"}            OK-5 $or aus zwei Objekten
silent OK  OK-2 {"id":{"$in":[…]}}             OK-6 $and mit verschachteltem $or
silent OK  OK-3 {"ingestionSource.userId":…}   OK-7 cannot mit $not um eine Gleichheit
silent OK  OK-4 can mit {"$ne":…}              OK-8 unbedingter Grant + read ingestion
=== must be reported: F30-* + CTR-* ===   reported OK  14 / 14
```

Alle drei Abfragen: **0 Zeilen** für diese elf Rollen. Eine `cannot`-Regel mit Operator-Bedingung
liefert genau die **beabsichtigte** Zeile `prohibition with an operator condition` (Änderung 5) und
**keinen** Formbefund. Weitere Formen, die schweigen: `{"$and":[{"$or":[{"$not":{…}}]}]}`,
`{"id":{"$in":[…,"x",5]}}`, eine Regel, die selbst kein Objekt ist.

#### Gegen den Übersetzer gekreuzt (Fallstrick 15)

37 Bedingungswerte durch `dist/helpers/mongoToDrizzle.js` und daneben die Q2-Ausgabe gestellt:
**verweigert ⇒ gemeldet** und **übersetzbar ⇒ still**, mit genau zwei benannten, bewussten Abweichungen:

| Form                                   | Übersetzer   | Q2                 | warum das richtig ist                                                                                                                                       |
| -------------------------------------- | ------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conditions: 5` an `can read settings` | `REFUSED`    | **nicht gemeldet** | für `settings` wird **kein** Zeilenfilter gebaut, es ändert sich nichts. Der Wurzelbefund bleibt an `pair` gebunden — die Seite sagt das jetzt ausdrücklich |
| `{"id": {"$in": [{}]}}`                | `TRANSLATES` | **gemeldet**       | leeres Objekt in einer **Operandenliste**. Übermeldung, nicht Untermeldung; die Position steht in der Meldung                                               |

#### (b) Der Abdeckungsanspruch ist weg — der eigentliche Fix

| Vorher                                                                           | Jetzt                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| „**It examines:** … walked **recursively** … **the empty object**"               | „**What it reports:**" — Aufzählung der Befundtypen; kein „recursively" als Zusage                                                                                                                                                                                                      |
| „the values inside a condition … **not one this release changes**"               | ein Wert, der selbst eine **Struktur** ist, ändert die Wirkung und wird als Formbefund gemeldet; nur ein **skalarer** Wert nicht                                                                                                                                                        |
| „No rows means the query found none of the shapes it looks for"                  | „**cannot be shown to be complete** … Read an empty result as an indication, **not as a clearance**"                                                                                                                                                                                    |
| „lists **every** shape of policy this affects"                                   | „describes the shapes … plus a behaviour check that does not depend on the shapes at all"                                                                                                                                                                                               |
| „to **find out which** of your roles behave differently"                         | „to **look for** the roles that behave differently"                                                                                                                                                                                                                                     |
| „the third query below is what **covers** this case" / „Query 3 **covers** that" | je „**looks for**", mit dem Zusatz „for the subjects it can resolve"                                                                                                                                                                                                                    |
| „Log in as a user of each role you changed" (ein Satz)                           | **verifizierbare Gegenprobe in drei Schritten** ohne Formliste: zwei Zahlen je Rolle vorher notieren, nachher (oder auf einer Kopie) erneut messen, vergleichen — plus der Hinweis, dass eine unübersetzbare Bedingung jetzt einen **Fehler** erzeugt statt still ein falsches Ergebnis |

**Neu gesagt, weil es vorher offenblieb:** der Wurzel-Formbefund ist an (Action, Subject) gebunden, die
Befunde **innerhalb** von `conditions` nicht; die Formprüfung beim Speichern (`400`) gilt nur für das
`conditions` der Regel selbst — ein verschachtelter Formfehler fällt erst zur Abfragezeit auf (am Code
geprüft: `PolicyValidator` ruft `checkConditionsShape()` nur auf der Wurzel, `areConditionKeysValid()`
prüft darunter nur Keys); ein Array-`conditions` wird gemeldet, aber **nicht betreten** (gemessen:
`conditions: [{"$or": []}]` ⇒ zwei Zeilen `conditions is not an object`, kein Zweigbefund).

#### Grüne Läufe

```
pnpm lint                                            → All matched files use Prettier code style!
pnpm --filter @open-archiver/backend test:types      → Exit 0
pnpm --filter @open-archiver/backend build           → Exit 0
pnpm docs:build                                      → build complete, Exit 0; docs/.vitepress/dist/dev fehlt weiterhin
DATABASE_URL=… OA_TEST_REQUIRE_INFRA=1 pnpm test     → Test Files 17 passed (17) · Tests 250 passed | 2 skipped (252) · EXIT=0
```

Die zwei neuen Ankerverweise sind im **gebauten** HTML aufgelöst (`id="how-to-read-an-empty-result"`,
`id="after-the-upgrade"` vorhanden, drei bzw. zwei `href`-Vorkommen). Suchindex ohne `dev/`-Pfad.
Proben liefen ausschließlich in `/var/tmp` und im Scratchpad, **nicht** im Repository; nach dem
Volllauf **0** `oa_test_*`-Rückstände, Cluster und Prüfdatenbanken restlos entfernt.

**Nicht angefasst, bewusst:** `FilterBuilder.ts`, `mongoToMeli.ts`, `conditionKey.ts`, die Laufzeitseite
von F26 (bleibt `JR-13-11`), `JR-13-10`/`JR-13-11`/`JR-13-12`/`JR-13-16`.

### Abnahme `JR-13-09a` (2026-07-29) — Ergebnis: **E13 erneut nicht abgenommen**

Unabhängige Session, Rolle `tester`, HEAD `2a8df48`, **zuerst gegen das Remote abgeglichen**
(`git ls-remote` = lokal, kein Container-Rollback). Umfang wie in `JR-13-09a` festgelegt: die zwei in
`JR-13-09` gebrochenen Kriterien einzeln, die Kriterien von `JR-13-13`/`JR-13-14`/`JR-13-15`, ein
Volllauf, der Nachweis über F2/F4/F5/F6/F9/F10 **im Code**, und die Doku-Hygiene. **`JR-13-16`,
`JR-13-10`, `JR-13-11`, `JR-13-12` waren nicht Teil der Prüfung.**

**23 Kriterien geprüft: 22 erfüllt, 1 nicht erfüllt.**

| #   | Task       | Kriterium                                                                     | Ergebnis                | Beleg                                                                                                                                                                                                       |
| --- | ---------- | ----------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `JR-13-06` | `PolicyValidator` weist einen Key mit unauflösbarer Relation beim Anlegen ab  | **erfüllt**             | `foo.bar`, `attachment.name`, `a.b.c`, `ingestionSource.userId.x`, `INGESTIONSOURCE.userId` je REJECT; über `IamController.createRole` **HTTP 400** mit dem Key im Text                                     |
| 2   | `JR-13-06` | Ein Key mit `"` wird abgewiesen, nicht escaped                                | **erfüllt**             | 26 Keys durch beide Gates, eigene Erwartung je Fall; alle Injektionsvarianten REJECT/REFUSE                                                                                                                 |
| 3   | `JR-13-06` | Ein unbekannter, syntaktisch harmloser Key bleibt zugelassen (ADR-019)        | **erfüllt (bewusst)**   | `foo` und `_private` an beiden Gates ACCEPT, Query 3 findet `foo`                                                                                                                                           |
| 4   | `JR-13-13` | Validator und Übersetzer sind **deckungsgleich**, gegen ein erwartetes Urteil | **erfüllt**             | eigene Tabelle, 26 Keys × 2 Gates × erwartetes Urteil: **0 Divergenzen, 0 falsche Urteile**; die drei Restspalte reproduziert                                                                               |
| 5   | `JR-13-13` | Nicht-Objekt-`conditions` wird beim Anlegen abgewiesen (`400`)                | **erfüllt**             | `5`, `0`, `-1`, `null`, `[]`, `[{…}]`, `""`, `"userEmail"`, `false`, `true` → REJECT (vor E13: alle ACCEPT); über den Controller je **400**; `{}`, `{userEmail:…}`, absent → 201                            |
| 6   | `JR-13-13` | Laufzeitverhalten gespeicherter Policies unverändert                          | **erfüllt**             | `FilterBuilder.ts` blob-identisch zu `13a7114`; `conditions: null`/`""`/`false` → `UNRESTRICTED` vor **und** nach E13                                                                                       |
| 7   | `JR-13-14` | Die Blöcke **aus der Markdown-Datei** wörtlich gegen echtes Postgres          | **erfüllt**             | Extraktionsskript → 3 Blöcke → `psql -f -`, 41 Migrationen per `psql -f`, 54 gesäte Rollen; Q1 3, Q2 33, Q3 5 Zeilen, Exit 0                                                                                |
| 8   | `JR-13-14` | `conditions: 5` wird gemeldet (F27)                                           | **erfüllt**             | Q2 `conditions is not an object`, mit der richtigen der beiden Lesarten je Wert                                                                                                                             |
| 9   | `JR-13-14` | Tippfehler-Key unter `manage all` wird gemeldet (F28)                         | **erfüllt**             | Q3 zwei Zeilen: `archived_emails.user_emial` **und** `ingestion_sources.user_emial`                                                                                                                         |
| 10  | `JR-13-14` | Die drei `predefined_*` und die Gegenproben in **keiner** Ausgabe             | **erfüllt**             | P1–P3 plus drei handgeschriebene Kontrollen und die Sonde „Regel ist kein Objekt": 0 Zeilen in Q1/Q2/Q3                                                                                                     |
| 11  | `JR-13-14` | Kein Absolutsatz mehr im Dokument                                             | **erfüllt**             | „No rows means no role … is affected" ist ersatzlos weg; an seiner Stelle „How to read an empty result"                                                                                                     |
| 12  | `JR-13-07` | Ein Betreiber kann **vorher** feststellen, welche Rollen betroffen sind       | **nicht erfüllt (F30)** | 8 Formen mit `pre ≠ post` werden von **keiner** Abfrage gemeldet; 4 davon kippen von „sieht alles / alle Zeilen" auf „jede Anfrage scheitert". Zwei Sätze der Seite sind damit widerlegt                    |
| 13  | `JR-13-15` | Behauptung und Code stimmen überein, per `grep` nach der Befundnummer         | **erfüllt**             | `grep -rn "F4\|F5\|finding F" --include=*.ts packages/backend/src/ \| grep -v test` findet **F4** (`mongoToDrizzle.ts:93`) und **F5** (`:133`)                                                              |
| 14  | —          | Volllauf ⇒ Exit 0, mit Testzahl                                               | **erfüllt**             | `250 passed \| 2 skipped` (252 Fälle, 49 Suites, 17 Dateien), `success: true`, Exit 0                                                                                                                       |
| 15  | —          | Die 2 Skips sind die bekannten `nightly`/`manual`-Suiten und nichts anderes   | **erfüllt**             | aus dem JSON-Report: beide in `tests/adversarial/mongo-to-drizzle.adv.test.ts`, `[nightly]` 25000 Bäume und `[manual]` 30000-ms-Soak                                                                        |
| 16  | —          | `predefined-roles.int.test.ts` alle **sieben** Fälle grün                     | **erfüllt**             | 7 / 7 `passed`, je mit `fullName` aus dem JSON-Report                                                                                                                                                       |
| 17  | —          | `FilterBuilder.ts` und `mongoToMeli.ts` seit `13a7114` unberührt              | **erfüllt**             | Blob-Hashes identisch (`f7efead…`, `9e1ba29…`), `git diff 13a7114..HEAD` für beide leer                                                                                                                     |
| 18  | —          | Die **Laufzeitseite von F26** ist offen geblieben                             | **erfüllt**             | `FilterBuilder.ts:51–53` liest weiter `!rule.conditions`; gemessen `UNRESTRICTED` für `null`/`""`/`false`                                                                                                   |
| 19  | `JR-13-13` | Das eine umgedrehte Pin ist begründet und nicht mehr als nötig                | **erfüllt**             | alter `policy-validator.test.ts` gegen neuen Validator ⇒ `1 failed \| 52 passed`, genau `a.b.c`; Diff berührt **einen** Testfall, die Operator-Hälfte bleibt grün; sonst nur `minimumFiles` 7 ⇒ 8           |
| 20  | —          | F2, F4, F5, F6, F9, F10 unverändert **im Code**                               | **erfüllt**             | `ability.ts`, `AuthorizationService.ts`, `mongoToMeli.ts` blob-identisch zu `efea6bc`; F4/F5 pre gegen post auf 11 Eingaben gleich, F6 (`{action: [], …}`) pre=post=ACCEPT; Produktionscode-Diff: 5 Dateien |
| 21  | —          | Öffentliche Doku ohne interne IDs, Nutzlast, Compliance-Behauptung            | **erfüllt**             | `grep` über `docs/user-guides`, `docs/services`, `docs/enterprise`: kein `JR-1xxx`, keine F-Nummer, kein `1=1`/`drop table`, keine GoBD/WORM/„tamper-proof"-Behauptung                                      |
| 22  | —          | `10-upstream-meldung.md` nicht im Build und nicht im Suchindex                | **erfüllt**             | `pnpm docs:build` Exit 0, `dist/dev/` existiert nicht, 0 HTML-Seiten unter `dev/`; Suchindex: 0 Vorkommen von `dev/`, kein „upstream"; Gegenkontrolle „Access Control Changes" **ist** drin                 |
| 23  | —          | `main` unangetastet, kein PR aus dieser Arbeit                                | **erfüllt**             | `main` = `a560b8c`, HEAD ist **kein** Vorfahre von `main`; PR-Liste: nur `#1` und `#2`, beide `closed`, `merged: false`                                                                                     |

#### Der Bruch, einzeln: **F30**

Die Formprüfung, die `JR-13-13` eingeführt hat, wirkt in `mongoToDrizzle` **rekursiv** — jeder
`$or`/`$and`/`$not`-Zweig geht erneut durch `checkConditionsShape()`, und ein leerer Bedingungsknoten
wird auf jeder Ebene abgewiesen. Query 2 der Betreiberanleitung prüft beides nur an der **Wurzel**.
Gemessen (`FilterBuilder` `efea6bc` gegen `HEAD` im selben Prozess, echtes PostgreSQL 16.13,
`('archive','read')`):

```
pre               post     Q2/Q3     conditions
UNRESTRICTED      THROWS   SILENT    {"$not": {}}
UNRESTRICTED      THROWS   SILENT    {"$not": 5}
UNRESTRICTED      THROWS   SILENT    {"$or": [{"$and": [{}]}]}
FILTER(2/2 rows)  THROWS   SILENT    can archive + cannot archive {"userEmail": {}}
FILTER(0/2 rows)  THROWS   SILENT    {"$or": [{"userEmail": "…"}, 5]}
FILTER(0/2 rows)  THROWS   SILENT    {"$or": [{}, {"userEmail": "…"}]}
FILTER(0/2 rows)  THROWS   SILENT    {"$or": [{"userEmail": "…"}, {}]}
FILTER(0/2 rows)  THROWS   SILENT    {"$and": [{"userEmail": "…"}, {}]}
```

Entscheidend ist nicht die Unvollständigkeit an sich — die Seite darf und soll sagen, dass eine
Abfrage über schemaloses JSONB nicht beweisbar vollständig ist. Entscheidend ist, dass zwei **positive**
Sätze der Seite widerlegt sind: „walked recursively through nested objects and arrays: **the empty
object**, …" (der leere Objektknoten wird nur an der Wurzel geprüft) und „the values inside a
condition … **not one this release changes**" (für `{"userEmail": {}}` ändert sich die Wirkung von
„alle Zeilen sichtbar" auf „jede Anfrage scheitert"). Volle Fassung in `09-befunde-bestandscode.md`
unter **F30**, inklusive Behebungsvorschlag.

**Warum das die Abnahme kippt und nicht als Restrisiko durchgeht:** `JR-13-07`s einziger Zweck ist die
Frage „bin ich betroffen?". Die PO-Vorgabe zu `JR-13-14` lautete „die Abfragen decken alle **heute
bekannten** Formen ab, und das Dokument sagt genau, welche das sind" — die Knotenform ist seit
`JR-13-13` bekannt und steht in dem Prädikat, das beide Gates benutzen. Es ist derselbe Fehlermodus wie
F27, eine Ebene tiefer, mit derselben Gefahrenrichtung.

#### Was gehalten hat — gemessen, nicht übernommen

- **Die zwei Gates sind wirklich deckungsgleich**, und zwar gegen eine **eigene** Erwartungstabelle
  (Fallstrick 16): 26 Keys, darunter fünf, die die ausgelieferte Testdatei nicht führt
  (`ingestionSource` als einzelnes Segment, `INGESTIONSOURCE.userId` und `ingestionsource.userId` für
  die Groß-/Kleinschreibung der Relationstabelle, `ingestionSource..userId`, `$`). 0 Divergenzen,
  0 falsche Urteile. Die drei Restspalte (`foo`, `$regex`, `{}`) sind reproduziert.
- **Der HTTP-Pfad ist jetzt gemessen** — das war in `JR-13-09` „nicht prüfbar". `IamController.createRole`
  wurde mit einem synthetischen `req`/`res` direkt aufgerufen (die Importkette braucht nur `db` und
  `logger`, nicht den Server): 11 abzuweisende Formen ⇒ je **400** mit dem Key bzw. dem Wert im Text,
  5 zulässige Formen ⇒ je **201**.
- **Die Versionslücke 16.13 / 17.10 ist für die Betreiber-SQL geschlossen** — auch das war in
  `JR-13-09` offen. PostgreSQL **17.10** (dieselbe Version wie die CI) aus dem pgdg-Repository
  installiert, eigener Cluster auf Port 5433, alle 41 Migrationen per `psql -f`, dieselben 54 Rollen
  gesät, dieselben drei extrahierten Blöcke: **Ausgabe zeichenweise identisch zu 16.13** in allen drei
  Blöcken (3 / 33 / 5 Zeilen). Auch der dokumentierte Abbruch bei einem `policies`, das kein Array ist,
  ist auf 17.10 wortgleich (`ERROR: cannot extract elements from an object`).
- **Kein Falsch-positives bei den harmlosen Rollen.** P1–P3 (`predefined_*`), C1 (handgeschrieben,
  Bedingung auf existierenden Spalten), C2 (unbedingte Grants), C3 (`cannot` mit einfacher Gleichheit)
  und die Sonde „Regel ist kein Objekt" erscheinen in keiner der drei Ausgaben. F4/F5-Formen
  (`{sizeBytes: {$gte, $lte}}`, `{userEmail: null}`) ebenfalls nicht — richtig, denn ihre Wirkung
  ändert sich nicht.
- **Die Vorher/Nachher-Tabelle aus `JR-13-14` hält vollständig.** Alle 17 Wurzelwerte nachgemessen,
  einschließlich der Unterscheidung „falsy ⇒ unverändert `UNRESTRICTED`" gegen „truthy ⇒ `THROWS`",
  und jeder wird gemeldet.

#### Was **nicht** prüfbar war

- **Die Meilisearch-Hälfte in Ausführung.** Keine Engine im Container; geprüft ist die erzeugte
  Filterzeichenkette bzw. dass `mongoToMeli` wirft. Unverändert gegenüber `JR-13-09`.
- **Ob eine reale Installation eine der acht F30-Formen besitzt.** Wie bei F27 ist die Eintrittsrate
  nicht messbar; belegt ist, dass die Formen speicherbar waren, dass ihre Wirkung kippt und dass die
  Anleitung sie nicht meldet.
- **Der Volllauf gegen PostgreSQL 17.10.** Für die **Suite** bleibt der Nachweis der CI-Lauf aus
  `JR-13-09`; nur die Betreiber-SQL ist hier auf 17.10 gemessen worden.
- **Vollständigkeit der Formliste.** Meine acht F30-Formen sind konstruiert, nicht erschöpfend. Eine
  Abfrage über schemaloses JSONB ist gegen unbekannte Formen nicht beweisbar vollständig — genau
  deshalb ist `JR-13-16` (Regressionstest für die Betreiber-SQL) die richtige Absicherung.

**Kein Produktionscode, kein Test, keine öffentliche Doku geändert.** Alle Proben liefen in einem
Wegwerf-Verzeichnis (`packages/backend/.probe/`, danach gelöscht) und in Wegwerf-Datenbanken. Nach dem
**Volllauf** 0 `oa_test_*`-Rückstände; beide Cluster (16.13 und 17.10), die Prüfdatenbanken und die
pgdg-Paketquelle sind restlos entfernt. `pnpm lint` grün,
`pnpm --filter @open-archiver/backend test:types` grün, `pnpm docs:build` grün.

### E13 — Nacharbeit `JR-13-13`–`JR-13-15` erledigt (2026-07-29, Rolle `senior-dev`)

Drei Commits auf `claude/journaling-e13-iam-hardening`, je einer pro Task, gepusht. **Kein Rückmerge,
kein PR** — `JR-13-09a` kommt zuerst. Stand vor Beginn `13a7114`, gegen
`git ls-remote origin refs/heads/claude/journaling-e13-iam-hardening` abgeglichen: identisch, kein
Container-Rollback.

**Suite: `224 passed | 2 skipped` (Exit 0) vorher ⇒ `250 passed | 2 skipped` (Exit 0) nachher**, 16 ⇒
17 Dateien, `unit` von 7 auf 8 (`minimumFiles` in `tests/support/suite-inventory.ts` mit angehoben).
Die 2 Skips sind unverändert die `[nightly]`- und `[manual]`-Suite. Gemessen gegen einen lokalen
PostgreSQL-16.13-Cluster ohne Docker, `OA_TEST_REQUIRE_INFRA=1`, 0 `oa_test_*`-Rückstände.

#### `JR-13-13` (`cfb1462`) — ein Prädikat statt zwei Kopien

`packages/backend/src/helpers/conditionKey.ts` ist **neu** und importiert **nichts**. Es besitzt
`relationToTableMap`, `resolveConditionKey()` (Form + Relation, liefert `table`/`column` mit),
`isConditionOperatorKey()` und `checkConditionsShape()`. Beide Gates fragen dieses Modul:
`PolicyValidator.areConditionKeysValid()` und `mongoToDrizzle.getDrizzleColumn()`; beide haben ihre
eigenen Regexe und ihre eigene Segmentlogik verloren.

**Begründung der Ablage** (die Frage aus dem Task): der Validator darf `mongoToDrizzle` nicht
importieren, sonst zieht er `drizzle-orm` in eine Klasse, die heute nur Typen importiert — und damit in
jeden Unit-Test, der eine Policy validiert. Umgekehrt hat ein SQL-Übersetzer nichts im IAM-Modul zu
suchen, und `relationToTableMap` gehört neben den Code, der einen Tabellennamen rendert. Bleibt: ein
drittes, abhängigkeitsfreies Modul in `helpers/`, neben dem Übersetzer.

`conditions` selbst muss jetzt ein **Objekt** sein oder fehlen; Skalar, Array und `null` werden beim
Anlegen abgewiesen. `undefined` gilt als **abwesend**, nicht als fehlerhaft — `JSON.stringify` verwirft
es ohnehin, die beiden sind nach einem Datenbank-Roundtrip nicht unterscheidbar. **Das Laufzeitverhalten
für bereits gespeicherte Policies ist unverändert:** `FilterBuilder.ts` ist in diesem Commit nicht
angefasst.

Neuer Test `packages/backend/tests/unit/condition-key-gates.test.ts` (26 Fälle): 20 Keys und 9
`conditions`-Formen durch **beide** Gates, Urteile nebeneinander, plus je Fall das **erwartete** Urteil
— „beide sind sich einig" allein wäre auch von zwei gleichsinnig kaputten Gates erfüllt. Die drei
Restspalte (Spaltenexistenz, Operatornamen, `conditions: {}`) sind **grüne Assertions**, kein Kommentar;
sie zu schließen macht die Datei rot und zwingt zum Lesen der Begründung.

**Eine Ausnahme zur Regel „kein vorher grüner Test wird rot", benannt und begründet:**
`policy-validator.test.ts` „accepts conditions it does not understand" pinnte, dass `a.b.c` akzeptiert
wird. Einzeln nachgemessen — alter Test gegen neuen Validator: `1 failed | 52 passed`, genau dieser
Fall. Der Pin dokumentierte die Lücke, die F29 ist; er ist ersetzt, nicht gelöscht: die Hälfte zum
unbekannten Operator bleibt grün, die Hälfte zum Key ist umgedreht, mit der Begründung im Test.

**Kein neuer i18n-Key.** Der Ablehnungsgrund wird wie bisher hinter `req.t('iam.invalidPolicy')`
angehängt (`iam.controller.ts:55`, `:91`); dass diese Gründe englisch sind, ist Bestandszustand und
wird hier nicht verändert. Keine Migration, kein Schemaeingriff.

#### `JR-13-14` (`c17144e`) — beides, wie entschieden

Query 2 bekommt den Befundtyp `conditions is not an object`, gespeist aus `pair`, mit einer Detailzeile,
die den Wert wörtlich ausgibt und die beiden Lesarten unterscheidet. Query 3 bildet `subject = 'all'`
über eine neue CTE `subject_table` auf **beide** Tabellen ab. Der Absolutsatz ist **ersatzlos** weg; an
seiner Stelle steht „How to read an empty result" mit zwei Listen (was geprüft wird, was nicht) und der
Begründung, dass eine Abfrage über schemaloses JSONB gegen unbekannte Formen nicht beweisbar vollständig
sein kann. Dazu **Änderung 8** im Fließtext für die neue Ablehnung beim Speichern.

**Beleg, aus der Markdown-Datei extrahiert und wörtlich gefahren** (Fallstrick 17), gegen echtes
PostgreSQL 16.13 mit den realen Migrationen und 29 gesäten Rollen:

```
extracted 3 sql block(s)
BLOCK 1 (Query 1)  → 1 row  (no-role@example.com)
BLOCK 2 (Query 2)  → 25 rows
BLOCK 3 (Query 3)  → 9 rows
```

Nie gemeldet, in **keiner** Ausgabe: `predefined_super_admin`, `predefined_end_user`,
`predefined_read_only_user`, die Kontrolle `C1 hand-written but unaffected`, und die Sonde
`P2 rule is not an object`.

**Falsch-negativ-Prüfung** nach der Methode aus Fallstrick 15 — Übersetzer `efea6bc` gegen HEAD, im
selben Prozess, rein (kein `db`-Import nötig), 17 `conditions`-Werte:

```
value                | pre-E13                  | post-E13   | gemeldet von
{}                   | NO FILTER (unrestricted) | REFUSED    | Q2 empty conditions object
null / "" / 0 / false| NO FILTER (unrestricted) | REFUSED *  | Q2 conditions is not an object
5 / true             | NO FILTER (unrestricted) | REFUSED    | Q2 conditions is not an object
"userEmail"          | FILTER                   | REFUSED    | Q2 conditions is not an object
[] / [{userEmail}]   | NO FILTER (unrestricted) | REFUSED    | Q2 conditions is not an object
{foo.bar}            | FILTER                   | REFUSED    | Q2 unresolvable relation
{a.b.c}              | FILTER                   | REFUSED    | Q2 key is not a column reference
{attachment.name}    | FILTER                   | REFUSED    | Q2 unresolvable relation
{$regex}             | NO FILTER (unrestricted) | REFUSED    | Q2 unsupported operator
{$or: []}            | NO FILTER (unrestricted) | REFUSED    | Q2 branch list is empty
{userEmail}          | FILTER                   | FILTER     | — (Kontrolle, schweigt)
{userEmial} (Tippf.) | FILTER                   | FILTER     | Q3 (unverändert defekt, beide Releases)
```

`*` Für die **falsy** Familie entscheidet `FilterBuilder` über `!rule.conditions`, **bevor** der
Übersetzer läuft; das Ergebnis der Anwendung ist vor und nach E13 `UNRESTRICTED` (deckt sich mit F26).
Der Übersetzer ist strenger geworden, die Entscheidung nicht. Die Seite sagt genau das.

**Null Falsch-negative:** jeder Wert mit `pre ≠ post` wird von einer der Abfragen gemeldet.

**Ein Falsch-positives, das ich selbst eingebaut und vor dem Commit korrigiert habe:** ein
`ELSE st.table_name` ohne Segmentzahl-Wächter machte in Query 3 aus `foo.bar` fälschlich
`archived_emails.bar`. Aufgefallen ist es genau durch den wörtlichen Lauf, nicht durch das Lesen des
Entwurfs.

**Eine Randlage, die kein Falsch-positives ist:** `manage all` mit `{"userEmail": …}` wird von Query 3
für `ingestion_sources` gemeldet, weil dort keine Spalte `user_email` existiert. Die Regel funktioniert
fürs Archiv und lässt die Ingestion-Liste scheitern — das ist ein echter Befund, und die Seite erklärt,
wie er zu lesen ist.

**Zusätzlich zur Ehrlichkeit gemessen:** ein `roles.policies`, das **kein Array** ist, lässt beide
Abfragen mit `ERROR: cannot extract elements from an object` **abbrechen** statt still zu überspringen.
Der erste Entwurf des Doku-Absatzes behauptete „silently skipped" — das war falsch und ist korrigiert,
samt der Abfrage, mit der ein Betreiber die Zeile findet.

#### `JR-13-15` (`5c8a521`) — was ich gewählt habe: beides

Der PO hatte keine Präferenz. Gewählt ist **beides**, weil jede der beiden Varianten allein etwas
Unwahres stehen lässt:

- **Die Behauptung ist eingeschränkt.** `06-status.md` und `07-session-handover.md` sagen jetzt, dass in
  `JR-13-06` nur **F4** einen Kommentar bekam und der F5-Kommentar erst mit `JR-13-15` kam. Den Code so zu
  ändern, dass ein alter Satz nachträglich stimmt, würde verfälschen, welcher Commit was getan hat.
- **Der F5-Kommentar ist nachgezogen**, `mongoToDrizzle.ts:130–134`, attribuiert an `JR-13-15`. Ein Leser
  von `eq(column, value)` kann sonst nicht erkennen, dass `= NULL` bekannt und gewollt offen ist.

Prüfung wie im Kriterium:
`grep -rn "F4\|F5\|finding F" --include=*.ts packages/backend/src/ | grep -v test` findet jetzt beide
Nummern.

#### Bewusst nicht angefasst

F2, F4, F5, F6, F9, F10, F17, F18, F23, F24 bleiben offen; F4 und F5 sind im **Verhalten** unverändert
(Golden-Pins grün), nur kommentiert. `FilterBuilder.ts` und `mongoToMeli.ts` sind in allen drei Commits
**nicht** angefasst — die Laufzeitseite von F26 gehört zu `JR-13-11`. `JR-13-10`, `JR-13-11`, `JR-13-12`
und `JR-13-16` sind nicht angerührt.

`pnpm lint` grün · `pnpm --filter @open-archiver/backend test:types` grün ·
`pnpm --filter @open-archiver/backend build` grün · `pnpm docs:build` grün, `docs/.vitepress/dist/dev/`
existiert **nicht** · lokaler Cluster und Prüfdatenbank restlos entfernt · keine internen `JR-*`-IDs
und keine Befundnummern in der öffentlichen Doku (gegen `grep` geprüft).

### Abnahme `JR-13-09` (2026-07-29) — Ergebnis: **E13 nicht abgenommen**

Unabhängige Abnahme in eigener Session, Rolle `tester`, HEAD `54536cd`. **Zuerst gegen das Remote
abgeglichen:** `git log --oneline -1` = `54536cd`, `git ls-remote origin refs/heads/…` =
`54536cd31b1a…` — identisch, kein Container-Rollback.

> **Urteil: E13 ist nicht abnehmbar.** Die **fünf Codekorrekturen sind sauber und unabhängig belegt** —
> der Injektionsweg ist an beiden Gates zu, `FilterBuilder` ist fail-closed, alle 23 Regressionstests
> sind ohne den Fix rot und mit ihm grün. Gebrochen ist die **betreibersichtbare Hälfte**: `JR-13-07`s
> Prüf-SQL hat ein gemessenes falsch-negatives für genau die Form, die von „sieht alles" auf „sieht
> nichts" umschlägt (**F27**), und die veröffentlichte Doku behauptet eine Ablehnung beim Speichern,
> die nicht stattfindet (**F29**, zugleich eine Lücke in `JR-13-06`s Kriterium). Beides ist klein zu
> beheben; keines davon darf mit einem Rückmerge unter den Tisch fallen, weil `JR-13-07`s ganzer Zweck
> die Vorbereitung des Betreibers ist.

**Umfang:** alle neun Tasks gegen ihre Kriterien aus `03-backlog.md`, nicht nur die letzte Runde.
Fünf neue Befunde: **F25**, **F26**, **F27**, **F28**, **F29**. Kein Produktionscode, kein Test, keine
öffentliche Doku geändert; alle Proben liefen in Wegwerf-Kopien unter `/var/tmp` und sind entfernt.

#### Urteil je Akzeptanzkriterium

| Task         | Kriterium (gekürzt)                                                                    | Ergebnis                    | Beleg                                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **JR-13-01** | Jeder Test ist **vor** dem Fix rot und **nach** dem Fix grün, beides protokolliert     | **erfüllt**                 | Produktionscode auf `efea6bc` zurückgedreht (Wegwerf-Kopie) ⇒ `23 failed \| 201 passed \| 2 skipped`; HEAD ⇒ `224 passed \| 2 skipped`                       |
| **JR-13-01** | — je Fix einzeln nachweisbar (eigene Verschärfung)                                     | **erfüllt**                 | Vier Einzelreverts: `mongoToDrizzle` 11 rot, `FilterBuilder` 8, `policy-validator` 2, `SearchService` 1; Vereinigung 22, Volllauf 23                         |
| **JR-13-01** | — kein vorher grüner Test ist rot geworden                                             | **erfüllt**                 | Statusdiff `8984ce9` ⇄ HEAD je `fullName`: rot⇒grün **21**, grün⇒nicht-grün **0**, 1 Fall umbenannt (F21-Invertierung), 226 = 226                            |
| **JR-13-03** | Nur diese zwei Zeilen geändert; kein weiterer `FilterBuilder`-Aufruf, kein Route-Gate  | **erfüllt**                 | `git diff efea6bc..HEAD -- SearchService.ts` = 2 Zeilen + Kommentare; `search.routes.ts` blob-identisch; `git diff --name-only … api/**` leer                |
| **JR-13-02** | `auditor-specific-mailbox.json` liefert **keine** Zeile für `dev@openarchiver.com`     | **erfüllt**                 | Eigene Sonde, Fixture **von der Platte**, echtes PG 16.13, `read` **und** `search`: 0 Zeilen, die verbotene Zeile nie dabei                                  |
| **JR-13-02** | Nutzer ohne Rolle bekommt `1=0`, nicht `undefined`. Gegen echtes Postgres              | **erfüllt**                 | `drizzleFilter` und `searchFilter` beide **definiert**; `searchFilter = ingestionSourceId = "-1"`; 0 Zeilen                                                  |
| **JR-13-04** | Unbekannter Operator ⇒ Verweigerung, **kein Zweig wird stillschweigend weggelassen**   | **erfüllt**                 | 7 `RED UNTIL JR-13-04`-Fälle grün und ohne den Fix rot; ADR-018-Fall in beide Richtungen mutationsgeprüft (Vorrunde), hier per Revert bestätigt              |
| **JR-13-05** | `cannot … { $in: […] }` schließt tatsächlich aus, in Drizzle …                         | **erfüllt**                 | `$in`/`$nin`/`$gte`: `not "ingestion_source_id" in ($1)` statt `not … = $1` mit dem Operatorobjekt als Parameter                                             |
| **JR-13-05** | … **und** im Meili-Filter                                                              | **teilweise / strukturell** | `(NOT (ingestionSourceId IN ["…"]))` statt `(ingestionSourceId != [object Object])`. **Kein Meilisearch in dieser Umgebung** — nicht ausgeführt              |
| **JR-13-06** | Ein Key mit `"` wird **abgewiesen**, nicht escaped-durchgelassen                       | **erfüllt**                 | 12 Nutzlasten, beide Gates: `validator=REJECT`, `mongoToDrizzle=REFUSED`, Legacy-Rolle ⇒ Deny, 0 fremde Zeilen                                               |
| **JR-13-06** | Relationszweig ebenso                                                                  | **erfüllt** (Übersetzer)    | `ingestionSource.userId" is not null …` und `ingestionSource."x" or 1=1 --` REFUSED; `sql.raw` ist aus dem Zweig entfernt                                    |
| **JR-13-06** | Ein unbekannter, syntaktisch harmloser Key ebenso                                      | **bewusst nicht erfüllt**   | `foo` wird weiter übersetzt — **durch ADR-019 entschieden** und als `JR-13-11` geführt. Kein Kriteriumsbruch, sondern eine dokumentierte Änderung            |
| **JR-13-06** | `PolicyValidator` weist solche Policies **beim Anlegen** ab                            | **nicht erfüllt**           | **F29**: Validator ACCEPT für `a.b.c`, `attachment.name`, `foo.bar`, die `mongoToDrizzle` REFUSED. Nicht von ADR-019 gedeckt                                 |
| **JR-13-07** | Der Hinweis nennt die betroffenen Formen **konkret** statt pauschal zu warnen          | **erfüllt**                 | 7 Änderungen benannt; Query 2 meldet 13 von 13 gesäten betroffenen Rollen, Query 3 den Tippfehler, Query 1 den Nutzer ohne Rolle                             |
| **JR-13-07** | — die drei `predefined_*`-Rollen erscheinen in keiner Ausgabe                          | **erfüllt**                 | 25 Rollen gesät; die 3 `predefined_*` und die unbetroffene Gegenprobe in **keiner** der drei Ausgaben                                                        |
| **JR-13-07** | Ein Betreiber kann **vor** dem Update feststellen, welche seiner Rollen betroffen sind | **nicht erfüllt**           | **F27**: `conditions: 5` ⇒ vor E13 **unbeschränktes Archiv**, nach E13 Deny — **beide** Abfragen schweigen. **F28**: Tippfehler unter `manage all` ebenfalls |
| **JR-13-08** | Entwurf liegt vor und ist **nicht** versendet                                          | **erfüllt**                 | `10-upstream-meldung.md` vorhanden; keine offenen PRs, keine neuen Issues; die Datei ist über `srcExclude` unpubliziert (unten belegt)                       |
| **JR-13-09** | Negative Assertions je Rolle                                                           | **erfüllt**                 | Alle 8 Fixtures mit `expect(...).toBe(false)`-Ketten in `ability.test.ts`; 5 davon plus die 3 `predefined_*` zeilenscharf gegen echtes PG                    |
| **JR-13-09** | Nachweis, dass F2/F4/F5/F6/F9/F10 unverändert offen dokumentiert sind …                | **erfüllt**                 | Alle sechs in `09-befunde-bestandscode.md` weiter `Status: offen`; Verhalten gemessen unverändert (unten)                                                    |
| **JR-13-09** | … und **nicht stillschweigend mitverändert** wurden                                    | **erfüllt**                 | F2/F9/F10-Dateien blob-identisch zu `efea6bc`; F4/F5/F6 pre-gegen-post auf denselben Eingaben identisch. **Aber F25**: der F5-Kommentar fehlt                |

#### Die Suite ist wirklich vollständig gelaufen — nicht nur grün

Der Fallstrick aus dem Handover (Punkt 6, F14/F15: der Wächter zählt **Dateien**, nicht ausgeführte
Tests) ist gezielt gegengeprüft. Testzahl mitzitiert, nicht nur „grün":

```
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres OA_TEST_REQUIRE_INFRA=1 pnpm test
  [TEST-INVENTORY] unit: 7 file(s) (min 7) · integration: 8 (min 8) · adversarial: 1 (min 1) · unclassified: 0
  Test Files  16 passed (16)
       Tests  224 passed | 2 skipped (226)        EXIT=0
```

- **Die 2 Skips sind genau die bekannten**, aus dem JSON-Report je `fullName` gelesen:
  `[nightly] mongoToDrizzle() adversarial -- 25000 seeded trees` und
  `[manual] … 30000 ms soak`, beide mit Grund `class '…' not selected`. **Keine dritte Übersprung.**
- **Alle 8 `integration`-Dateien sind gelaufen**, mit Fallzahlen: `filter-builder-f1-f3` 7,
  `filter-builder-f7` 6, `filter-builder-f8` 4, `filter-builder` 5, `mongo-to-meli` 10, `pg-harness`
  13, `postgres-availability` 3, `predefined-roles` 7. Alle acht rufen `suiteRequiring('ci', …)` auf.
- **`minimumFiles` hat aktuell kein Spiel** (7/7, 8/8, 1/1) — F15s Klasse ist heute nicht auslösbar.
- **Unabhängige Bestätigung auf PostgreSQL 17.10:** CI-Run
  [30456242256](https://github.com/maxx1337/OpenArchiver/actions/runs/30456242256) auf `54536cd`,
  14/14 Schritte `success`, `starting PostgreSQL 17.10`, `Tests 224 passed | 2 skipped (226)`,
  `Suite inventory verified: unit 7/7, integration 8/8, adversarial 1/1`,
  „No oa*test*\* databases left behind." **Die Versionslücke 16.13/17.10 ist damit für die Suite
  geschlossen** — für die Prüf-SQL aus `JR-13-07` **nicht**, siehe „Was nicht prüfbar war".
- Die roten CI-Läufe der Rot-Phase sind ebenfalls belegt und nicht bloß behauptet: `f6a55c0`,
  `8984ce9`, `bbcd3e5` ⇒ `failure`; ab `704e8d1` ⇒ `success`.

#### `predefined-roles.int.test.ts` ist kein Tautologie-Test

Zwei Mutationen am **Produktionscode** der Rollendefinition, beide in einer Wegwerf-Kopie:

| Mutation                                                                      | Ergebnis                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `predefined_read_only_user`: `action: ['read','search']` ⇒ `['read']`         | **4 von 7 rot**, darunter beide ADR-017-Kernfälle („no predefined role reaches the null branch", „read and search give byte-identical results")                                           |
| `createDefaultRoles()` wirft (der Aufrufer schluckt den Fehler und loggt nur) | **6 von 7 rot**, mit der vorgesehenen Meldung „the production role bootstrap did not create every predefined role … a silent failure here would otherwise produce a green but empty test" |

Die Rollen kommen tatsächlich aus dem Produktionscode (`IamController.getRoles()` für die zwei
Default-Rollen, `UserService.createAdminRole()` für den Super Admin) und die „green but empty test"-Falle
ist konstruktiv geschlossen. Die im Test dupliziert nachgebaute Zweig-Klassifikation ist bewusst eine
**zweite** Messung und keine Wiederholung der Implementierung.

#### Der Injektionsweg ist zu — ADR-019s Behauptung hält

12 Nutzlasten, drei Gates, gegen echtes PostgreSQL 16.13. Nutzlast 1 ist die vierte, lauffähige aus
F1; Nutzlasten 5–12 sind Umgehungsversuche gegen `^[A-Za-z_][A-Za-z0-9_]*$` (NUL-Byte, Newline,
Relationszweig, verdoppeltes Anführungszeichen, Fullwidth-Homoglyph, mehrteilige Keys).

```
validator | translator | Legacy-Rolle (Validator umgangen) | key
REJECT    | REFUSED    | FilterBuilder threw (deny)        | userEmail" is not null or "id" is not null or "userEmail
REJECT    | REFUSED    | FilterBuilder threw (deny)        | id" or 1=1 --
REJECT    | REFUSED    | FilterBuilder threw (deny)        | id" is not null or "id
REJECT    | REFUSED    | FilterBuilder threw (deny)        | userEmail" is not null or "id" is not null --
REJECT    | REFUSED    | NOT STORABLE (jsonb)             | userEmail"<NUL> is not null or …
REJECT    | REFUSED    | FilterBuilder threw (deny)        | userEmail"\n is not null or …
REJECT    | REFUSED    | FilterBuilder threw (deny)        | ingestionSource.userId" is not null or …
REJECT    | REFUSED    | FilterBuilder threw (deny)        | ingestionSource."x" or 1=1 --
REJECT    | REFUSED    | FilterBuilder threw (deny)        | userEmail""
REJECT    | REFUSED    | FilterBuilder threw (deny)        | user＂Email        (Fullwidth U+FF02)
REJECT    | REFUSED    | FilterBuilder threw (deny)        | userEmail or 1=1
REJECT    | REFUSED    | FilterBuilder threw (deny)        | a.b."c" or 1=1 --
ACCEPT    | TRANSLATED | sql-error (Spalte fehlt)         | __proto__      ← ADR-019-Restspalt, JR-13-11
ACCEPT    | TRANSLATED | sql-error (Spalte fehlt)         | constructor    ← dito
```

**Keine Nutzlast erreicht eine fremde Zeile, keine erzeugt einen unbeschränkten Filter** — auch dann
nicht, wenn die Rolle direkt in die Datenbank geschrieben wird und den Validator damit umgeht. Das
NUL-Byte scheitert schon an `jsonb` („unsupported Unicode escape sequence", `22P05`), also an Postgres
und nicht an der Anwendung. `__proto__`/`constructor` sind gültige Identifier und laufen in einen
Spaltenfehler — genau der in ADR-019 benannte Restspalt, fail-closed.

#### F2/F4/F5/F6/F9/F10: unverändert — mit einer Ausnahme in der Doku darüber

| Befund      | Datei                                   | Nachweis                                                                                                                        |
| ----------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **F2**      | `ability.ts`, `AuthorizationService.ts` | Blob-identisch zu `efea6bc` (`8720b523…`, `3e0c3043…`)                                                                          |
| **F9, F10** | `mongoToMeli.ts`                        | Blob-identisch zu `efea6bc` (`9e1ba29f…`) — die Datei wurde auf dem ganzen Branch nicht angefasst                               |
| **F4**      | `mongoToDrizzle.ts`                     | Verhalten identisch (pre gegen post, 4 Eingaben); Kommentar vorhanden und **korrekt** (`:107–108`); grüner Golden-Pin           |
| **F5**      | `mongoToDrizzle.ts`                     | Verhalten identisch (3 Eingaben, inkl. Relationszweig); grüner Golden-Pin — **aber der behauptete Kommentar fehlt ⇒ F25**       |
| **F6**      | `policy-validator.ts`                   | `{action: [], subject: 'x'}` ⇒ `valid: true` vor **und** nach E13, ebenso zwei Varianten; die Änderung ist ein reiner Schritt 3 |

Der Produktionscode-Diff des Branches umfasst **genau vier Dateien**
(`git diff --name-only efea6bc..HEAD -- 'packages/**/src/**' | grep -v test`), keine davon eine
Datei der Befunde F2/F9/F10.

#### Die öffentliche Doku sagt nichts Unzulässiges

- **Keine internen IDs:** `grep -nE "JR-[0-9]{3,4}|ADR-[0-9]{3}|\bF[0-9]{1,2}\b|befunde"` über beide
  angefassten öffentlichen Dateien ⇒ **kein Treffer**.
- **Keine Compliance-Behauptung:** `grep -niE "GoBD|§ *147|§ *257|HGB|17a-4|FINRA|MiFID|revisionssicher|tamper-proof|compliant with|certif"` ⇒ **kein Treffer**.
- **Keine ausnutzbare Nutzlast:** kein `is not null or`, kein `or 1=1`, kein Key mit eingebettetem
  Anführungszeichen in der öffentlichen Doku.
- **`10-upstream-meldung.md` ist nicht gebaut und nicht indexiert:** `pnpm docs:build` grün (20,1 s),
  `docs/.vitepress/dist/dev` **existiert nicht**, kein `dist`-Treffer für `upstream-meldung`,
  `Upstream-Sicherheitsmeldung`, `befunde-bestandscode` oder `is not null or`. Der lokale Suchindex
  (`dist/assets/chunks/@localSearchIndexroot.*.js`, 401 KB, 49 Seitenpfade) enthält **keinen** Pfad
  unter `dev/`; Gegenkontrolle: der neue öffentliche Satz „prohibition without a matching grant" ist
  darin enthalten. `srcExclude: ['dev/**']` ist unangetastet. `git status` nach dem Build sauber, also
  hat `docs:build` auch `docs/api/openapi.json` nicht verändert.

#### `main` unangetastet, kein neuer PR

`origin/main` = `a560b8c` („V0.5.2 release: update docs (#420)") — reiner Upstream-Stand. Keiner der
14 E13-Commits ist Vorfahre von `origin/main` (`git merge-base --is-ancestor` für `f6a55c0`,
`bcac6bd`, `dcec017`, `704e8d1`, `efb5582`, `54536cd`: alle negativ). Der Integrationsbranch enthält
E13 **nicht** — kein Rückmerge stattgefunden. Pull Requests im Repository: **nur #1 und #2**, beide
`state: closed`, `merged: false`; **kein** PR aus E13. (Nebenbefund für den Handover: die dort noch
als „zwei **offene** Pull Requests" geführten #1/#2 sind inzwischen geschlossen.)

#### Sonstige Messungen

`pnpm lint` grün · `pnpm --filter @open-archiver/types build` grün ·
`pnpm --filter @open-archiver/backend build` grün · `pnpm --filter @open-archiver/backend test:types`
grün · `pnpm --filter @open-archiver/frontend check` „0 errors and 0 warnings" ·
`find packages/backend/dist -name '*.test.*'` leer.

**Rückstände nach dem Vollauf: 0** (`select count(*) from pg_database where datname like
'oa\_test\_%'` ⇒ `0`). **F24 gegengeprüft:** auch die dateigefilterten Einzelläufe dieser Abnahme
haben nichts liegen gelassen — F24 betrifft den `-t`-Fallfilter, nicht ein positionales Dateiargument.
Der lokale PostgreSQL-16.13-Cluster ist restlos entfernt (`pg_isready` ⇒ „no response",
Datenverzeichnis gelöscht), ebenso beide Wegwerf-Kopien und die Prüfdatenbank `oa_sqlcheck`.

#### Was nicht prüfbar war

| Punkt                                                                       | Grund                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Die Prüf-SQL gegen PostgreSQL 17.10**                                     | Lokal liegen nur die 16er-Binaries (`/usr/lib/postgresql/16`). Die Abfragen benutzen ausschließlich Sprachmittel ab PG 9.4 (`WITH RECURSIVE`, `WITH ORDINALITY`, `jsonb_each`, `string_to_array`), das Risiko ist also gering — **gemessen ist es nicht.** Die **Suite** dagegen läuft nachweislich auf 17.10 (CI-Run oben) |
| **Die Meilisearch-Hälfte von `JR-13-05` in Ausführung**                     | Kein Meilisearch in dieser Umgebung. Geprüft ist die **erzeugte Filterzeichenkette** (`NOT (… IN […])` statt `[object Object]`), nicht dass die Engine sie so auswertet                                                                                                                                                     |
| **Ob Meilisearch `NOT (sizeBytes >= 1000)` überhaupt annimmt**              | `sizeBytes` steht nicht in `filterableAttributes` (`SearchService.ts:476`) — vorbestehend, F9-Nachbarschaft, nicht von E13 verursacht und hier nicht entscheidbar                                                                                                                                                           |
| **Der HTTP-Pfad (`400` beim Speichern) end-to-end**                         | Nur die Ebene `PolicyValidator.isValid()` gemessen. Dass `iam.controller.ts` daraus ein `400` macht, ist gelesen, nicht ausgeführt — ein Servertest scheitert an der Importkette (Redis, `STORAGE_TYPE`, Fallstricke 10)                                                                                                    |
| **Ob eine reale Installation eine Rolle mit skalarem `conditions` besitzt** | F27s Auslöser ist eine fehlerhafte Policy. Die Eintrittswahrscheinlichkeit ist unbekannt und in diesem Repository nicht feststellbar; belegt ist nur, dass der Absolutsatz der Anleitung falsch ist                                                                                                                         |

#### Was zu tun ist, damit E13 abnehmbar wird

Klein und klar abgegrenzt, in dieser Reihenfolge:

1. **F29** — `PolicyValidator.areConditionKeysValid()` auf ≤ 2 Segmente und auf `relationToTableMap`
   prüfen. Danach stimmen beide Gates überein und `access-control-changes.md` §6 ist wieder wahr.
   Damit ist `JR-13-06`s letztes Kriterium erfüllt.
2. **F27** — Query 2 um einen Befundtyp für `conditions` erweitern, das existiert und **nicht**
   `object` ist; oder den Satz „No rows means no role … is affected" auf das entschärfen, was die
   Abfrage trägt.
3. **F28** — `subject = 'all'` in Query 3 auf beide Tabellen abbilden, oder die Grenze ausdrücklich
   mit `all` benennen.
4. **F25** — den F5-Kommentar nachziehen oder die Statusaussage auf F4 einschränken (Doku, minimal).
5. **F26** — PO entscheidet, ob der falsy-`conditions`-Fall noch in E13 gehört oder zu `JR-13-11`.
   Er ist **kein** Regress und bricht kein Kriterium.

Danach **erneute Abnahme** (`JR-13-09a`) — nur der geänderte Umfang plus ein Volllauf, nicht alles neu.

### E13 — `JR-13-07` erledigt (2026-07-29, Rolle `senior-dev`)

Zwei Lieferungen, **kein Produktionscode, keine Teständerung, keine Migration**.

**1. ADR-016 geschrieben**, der Platzhalter in `05-entscheidungen.md` ist ersetzt. Die Nummernlücke
zwischen ADR-015 und ADR-017 bleibt inhaltlich erklärt (der Hinweis „nicht umnummerieren" steht jetzt
im ADR selbst statt im Platzhalter). Kern des Arguments, wie vom PO vorgegeben: nicht „Sicherheit geht
vor", sondern **„kein Recht auf dieses Subject" und „darf alles sehen" wurden vom selben Wert
dargestellt, und der unsichere war der Default** — in diesem Zustand ist keine Zugriffsaussage über
das Archiv belegbar. Verworfene Alternative („Verhalten beibehalten und nur dokumentieren", auch als
Schalter) mit dem konkreten Grund: **E11s Auditor-Rolle ist auf genau diesen Mechanismus gebaut**,
E11 wäre mit dem alten Verhalten nicht abnehmbar.

**2. Betreiberdoku in der öffentlichen Doku, englisch (ADR-003):**

| Datei                                                              | Rolle                                                                                                       |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `docs/user-guides/upgrade-and-migration/access-control-changes.md` | **neu** — Release-Hinweis plus Prüfanleitung mit drei SQL-Abfragen                                          |
| `docs/.vitepress/config.mts`                                       | Sidebar-Eintrag unter „Upgrading and Migration" (eine unverlinkte Seite wäre erreichbar, aber unauffindbar) |
| `docs/services/iam-service/iam-policy.md`                          | zwei neue Abschnitte: „Condition Keys" und „When No Rule Applies", mit Verweis auf die Upgrade-Seite        |

**Warum diese Ablage:** die Prüfung findet **vor** einem Update statt, also gehört sie in die
Sidebar-Sektion, die ein Betreiber genau dann öffnet („Upgrading and Migration") — nicht in die
Service-Referenz, die man beim Schreiben einer Policy liest. Umgekehrt musste `iam-policy.md`
angefasst werden, weil dort die Semantik steht, die sich geändert hat: die Seite beschrieb bisher
nicht, was passiert, wenn **keine** Regel greift. Wer nur die Upgrade-Seite gelesen hätte, hätte die
Regel beim nächsten Policy-Schreiben nicht wiedergefunden.

**Was die Anleitung nennt** — alle sieben Verhaltensänderungen, jede mit der betroffenen Policy-Form
und einer Handlungsanweisung: (1) kein `can` ⇒ deny, mit den drei Formen (Nutzer ohne Rolle als
Query 1, `cannot`-only, `search` ohne `read`); (2) unbedingtes `cannot` ⇒ deny; (3) `conditions: {}`
⇒ deny; (4) Suche filtert über `search` statt `read`; (5) `cannot` mit Operator schließt jetzt
**wirklich** aus, Nutzer sehen also **weniger** Zeilen (aus `JR-13-05`/F8 — nicht in der
Handover-Liste, aber betreibersichtbar); (6) Condition-Keys gegen die Form geprüft, `400` beim
Speichern, Fehler zur Abfragezeit bei Bestandsrollen; (7) unübersetzbare Bedingung ⇒ Fehler statt
stillschweigend falschem Ergebnis (ADR-018).

**Ausdrücklich als Restspalt benannt** (ADR-019): ein Key, der nur die Spaltenexistenz verletzt, wird
von der Anwendung **nicht** geprüft. Eigener Abschnitt „What is still not checked" plus Query 3, die
diese Prüfung selbst vornimmt — mit dem Satz „The application does **not** perform this check. The
query does, and only for those two subjects." Nichts ist als „vollständig geprüft" dargestellt.

**F17 aufgenommen:** ein eigener Abschnitt sagt, dass in einer frischen Installation **nur** die
Super-Admin-Rolle existiert, dass die anderen beiden `predefined_*`-Policies Vorlagen in der Doku und
keine Datenbankzeilen sind, und dass eine fehlende Read-Only-Rolle **kein Fehler der Installation**
ist. Derselbe Abschnitt hält fest, dass keine der `predefined_*`-Rollen betroffen ist — mit dem
Beleg, dass ein automatisierter Test das gegen eine echte Datenbank prüft, ohne Dateinamen zu nennen.
**Keine Pauschalwarnung.**

**Die Prüf-SQL ist gegen echtes Postgres ausgeführt**, nicht nur geschrieben — PostgreSQL 16.13,
lokaler Cluster ohne Docker. Vorgehen: `roles`/`users`/`user_roles` nach dem Drizzle-Schema angelegt,
14 Rollen eingespielt (die drei `predefined_*`, zehn absichtlich betroffene, eine unbetroffene
Gegenprobe), dazu sieben Randfälle. Die veröffentlichten Blöcke wurden **aus der Markdown-Datei
extrahiert und wörtlich ausgeführt**, nicht aus dem Entwurf.

```
Query 2 — 10 von 10 betroffenen Rollen gemeldet, je mit Regelnummer:
 Auditor prohibition only | prohibition without a matching grant         | read archive is forbidden by rule #1, but no rule grants it
 Auditor prohibition only | prohibition without a matching grant         | search archive is forbidden by rule #1, but no rule grants it
 Blanket revoke           | prohibition without conditions               | rule #2 forbids read archive and carries no condition
 Empty branch list        | condition branch list is empty               | rule #1: $or has no branches
 Empty conditions         | empty conditions object                      | rule #1 (can read archive) has "conditions": {}
 Injection shaped key     | condition key is not a column reference      | rule #1: key "userEmail\" is not null or \"id"
 Operator prohibition     | prohibition with an operator condition       | rule #2 uses the operator $in inside a "cannot" condition
 Regex condition          | unsupported condition operator               | rule #1: operator "$regex"
 Search without read      | archive search granted without archive read  | search archive is granted, read archive is not
 Unknown relation key     | condition key names an unresolvable relation | rule #1: key "attachment.name" (…)

Query 3 — der Restspalt, den die Anwendung nicht prüft:
 Typo in column name | 1 | archive | userEmial | archived_emails | user_emial

Query 1 — Nutzer ohne Rolle:  orphan@example.com
```

**Die drei `predefined_*`-Rollen und die unbetroffene Gegenprobe erscheinen in keiner Ausgabe** — das
ist der Grund, warum die Anleitung ohne Pauschalwarnung auskommen kann. Die Randfälle sind ebenfalls
geprüft: ein Skalar als Policy-Element, ein leeres `policies`-Array, `manage`/`all` als
**einelementiges Array** (kein Falschtreffer), `a.b.c`, `$nor`, `$not` um eine Operator-Bedingung,
`conditions: null` an einem `cannot`. Kein Fehler, kein Falschtreffer.

**Belege:**

```
pnpm lint                                  → All matched files use Prettier code style!
pnpm docs:build                            → build complete in 19.46s
ls -d docs/.vitepress/dist/dev             → No such file or directory   (srcExclude greift)
docs/.vitepress/dist/user-guides/upgrade-and-migration/access-control-changes.html vorhanden
DATABASE_URL=… OA_TEST_REQUIRE_INFRA=1 pnpm test
  Test Files  16 passed (16)
       Tests  224 passed | 2 skipped (226)     EXIT=0
```

**Kein neuer i18n-Key** — die Doku enthält keine UI-Zeichenkette, und es wurde keine Meldung im
Produktionscode geändert. Keine `JR-*`-ID, keine F-Nummer und kein Ausnutzungsbeispiel in der
öffentlichen Doku; keine Compliance-Behauptung. `docs/api/openapi.json` ist durch `docs:build`
**nicht** verändert worden (`git status` sauber für diese Datei).

**Ein Befund beim Schreiben, nicht behoben (Auftrag: melden):** `docs/services/iam-service/iam-policy.md`
listet in „Actions" die Action `export` weiterhin nicht und beschreibt `manage` als Expansion auf
`create/read/update/delete/search/sync` statt als echten Wildcard — das ist die in `CLAUDE.md` §5.4
benannte stale Stelle (3) des Permission-Vokabulars. Sie liegt in derselben Datei, die `JR-13-07`
angefasst hat, gehört aber nicht zu dieser Task. **Vorschlag an den PO:** eigene, nur
dokumentarische Task; die Quellen (1) und (2) sind bereits einig, es ist reine Doku-Nacharbeit.

### E13 — Grün-Lauf der Fixes `JR-13-02`–`JR-13-06` (2026-07-29, Rolle `senior-dev`)

**Ausgangsstand (derselbe Lauf wie unter „Rot-Läufe `JR-13-01`", auf `8984ce9` reproduziert):**

```
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres OA_TEST_REQUIRE_INFRA=1 pnpm test
 Test Files  6 failed | 10 passed (16)
      Tests  21 failed | 203 passed | 2 skipped (226)      EXIT=1
```

**Endstand (`dcec017`, gleiches Kommando, gleicher Cluster):**

```
 Test Files  1 failed | 15 passed (16)
      Tests  1 failed | 223 passed | 2 skipped (226)       EXIT=1
```

**Der Nachweis „kein vorher grüner Test ist rot geworden" ist maschinell geführt**, nicht durch
Zählen: beide Läufe wurden mit `--reporter=json` protokolliert und die Statuslisten je Testnamen
verglichen (`8984ce9` gegen `dcec017`).

| Übergang                | Anzahl | Anmerkung                                                                            |
| ----------------------- | ------ | ------------------------------------------------------------------------------------ |
| rot ⇒ grün              | **20** | alle `RED UNTIL JR-13xx` außer einem                                                 |
| grün ⇒ nicht grün       | **0**  | keine Regression                                                                     |
| Fall verschwunden / neu | 1 / 1  | derselbe Golden-Fall, umbenannt: `translates …` ⇒ `refuses …` (die F21-Invertierung) |
| noch rot                | **1**  | Testwiderspruch, aufgelöst in `704e8d1` per ADR-018 ⇒ Endstand `224 passed`, Exit 0  |

`predefined-roles.int.test.ts` ist mit **allen sieben** Fällen grün geblieben — eine
Standardinstallation verhält sich vor und nach den Fixes identisch, wie ADR-017 behauptet.

**Geänderter Produktionscode — vier Dateien, nichts sonst** (`git diff --stat 8984ce9..HEAD`):

| Datei                                | Task                  | Änderung                                                                                                                                   |
| ------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/services/SearchService.ts`      | `JR-13-03`            | Zeilen 311/423: drittes Argument `'read'` ⇒ `'search'`, plus je ein erklärender Kommentar. Kein Route-Gate angefasst                       |
| `src/services/FilterBuilder.ts`      | `JR-13-02`,`JR-13-05` | `null` ⇒ deny; unbedingtes `cannot` ⇒ deny (F20); `undefined` aus dem Übersetzer ⇒ deny (F19); `cannot`-Ausschluss über `$not` statt `$ne` |
| `src/helpers/mongoToDrizzle.ts`      | `JR-13-04`,`JR-13-06` | unübersetzbare Bedingungen werfen statt zu verschwinden; Condition-Keys gegen eine Allowlist; `sql.raw` entfernt; Rückgabetyp `SQL`        |
| `src/iam-policy/policy-validator.ts` | `JR-13-06`            | Schritt 3 von `isValid()` implementiert: Condition-Keys rekursiv geprüft, auch in `$or`/`$and`/`$not`                                      |

**Zwei Testdateien geändert — ausschließlich die vom PO freigegebene F21-Invertierung:**

| Datei                                         | Änderung                                                                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/helpers/mongoToDrizzle.test.ts`          | `attachment.name` erwartet jetzt eine Abweisung; der F21-Vorbehalt im Suite-Kommentar durch die Entscheidung ersetzt; neuer `it.each` für `mustRefuseKey`-Golden-Fälle |
| `tests/fixtures/mongo-to-drizzle-golden.json` | Fall `foo.bar`: von einem Übersetzungsfall auf **`mustRefuseKey`** umgestellt, alte Ausgabe in `observedBeforeE13` festgehalten                                        |

> **Warum ein eigener Marker `mustRefuseKey` und nicht `mustFailClosed`:** der F3-Test assertiert
> ausdrücklich, dass die Golden-Datei **drei** `mustFailClosed`-Fälle trägt. Der `foo.bar`-Fall gehört
> zu F1/`JR-13-06`, nicht zu F3. Ein eigener Marker lässt die F3-Zahl unverändert und hält die
> Gesamtzahl der Testfälle bei 226 — sonst wären es 225 und jede Zahl in diesem Dokument müsste neu
> gelesen werden.

**Die Allowlist prüft die Form des Keys plus die Relation, nicht die Existenz der Spalte.** Ein Key
wird angenommen als einzelner Identifier (`^[A-Za-z_][A-Za-z0-9_]*$`) oder als
`<relation>.<identifier>`, sofern die Relation in `relationToTableMap` steht. Abgewiesen wird damit
jeder Key mit SQL-Syntax **und** jeder mit unbekannter Relation (`attachment.name`, `foo.bar`,
`a.b.c`). Ein einzelner, unbekannter, syntaktisch harmloser Key (`foo`) wird **weiterhin
übersetzt** — eine echte Spalten-Allowlist ist in `mongoToDrizzle` nicht formulierbar, weil die
Funktion keinen Tabellenkontext hat, und sie würde drei weitere heute grüne Pins brechen
(`{a:1}`, `{b:2}`, `{n:{$gt:1}}`, dazu die `FIELDS`-Liste der adversarialen Suite). Das ist die
einzige Abweichung von der Formulierung „jeder unbekannte Key" in der F21-Entscheidung und wird hier
festgehalten, damit sie nicht als Versehen gelesen wird. **Vorschlag:** eine spaltengenaue Prüfung
gehört dorthin, wo das Subject bekannt ist — also in die Nähe von `JR-13-10`.

**Bewusst nicht angefasst** (kein Scope-Creep, `JR-13-09` prüft das): F2, F4, F5, F6, F9, F10, F17,
F18, F23. F4 (nur der erste Operator wird gelesen) und F5 (`{field:null}` ⇒ `= NULL`) sind in
`mongoToDrizzle` im Verhalten erhalten, ihre Pins sind grün. **Berichtigt (F25, `JR-13-15`):** einen
Kommentar hat in diesem Commit nur **F4** bekommen; der F5-Kommentar ist in `JR-13-15` nachgezogen
worden, nicht hier. `mongoToMeli.ts` ist unverändert. **Keine Migration, kein Schemaeingriff, kein neuer i18n-Key**
— der Ablehnungsgrund des Validators wird wie die bestehenden Gründe hinter
`req.t('iam.invalidPolicy')` auf Englisch angehängt (`iam.controller.ts`); dass diese drei Gründe
nicht lokalisiert sind, ist ein Bestandszustand, den E13 nicht verändert.

`pnpm lint` grün · `pnpm --filter @open-archiver/backend test:types` grün ·
`pnpm --filter @open-archiver/backend build` grün · keine `oa_test_*`-Rückstände · lokaler
PostgreSQL-16.13-Cluster restlos entfernt. Kein Frontend-Code berührt, `svelte-check` daher nicht
einschlägig.

### E13 — Der Testwiderspruch, **aufgelöst** (ADR-018, `704e8d1`)

> **Erledigt.** Die Vorlage unten bleibt als Herleitung stehen; entschieden ist sie in **ADR-018**:
> die Unit-Erwartung gilt, die Integrationszeile war falsch und ist korrigiert. Ein unübersetzbarer
> Zweig wird **verweigert**, nicht durch ein never-true-Prädikat je Zweig ersetzt — letzteres kippt
> unter `$not` zu `not(false)` = wahr und verliert damit ein Verbot.
>
> Die korrigierte `it` prüft jetzt über einen lokalen Helfer `refusesAndExposesNothing()` sowohl die
> Verweigerung **als auch**, falls ein Deny-Prädikat zurückkommt, dass dieses Prädikat gegen echtes
> Postgres **keine** Zeile liefert. Damit bleibt der Grund erhalten, warum der Fall in der
> Integrationssuite liegt: die Behauptung ist nicht „der Übersetzer verweigert", sondern „durch das,
> was er zurückgibt, ist keine Zeile erreichbar".
>
> **Mutationsgeprüft in beide Richtungen**, damit die Umschreibung kein Test ist, der bloß aufgehört
> hat zu scheitern: mit dem Übersetzer vor `JR-13-04` scheitert der Fall an der Einzelzweig-Form, mit
> einem Mutanten, der nur den Leerheits-Fall behebt und weiter Zweige verwirft, an der partiellen
> Disjunktion.
>
> **Lehre für kommende `RED UNTIL`-Sätze:** zwei Erwartungen mit **demselben** Tag müssen gegeneinander
> geprüft werden, bevor der Fix beginnt. Hier war keiner der beiden Tests für sich falsch — der Tell
> war, dass beide dieselbe Task nannten.

#### Ursprüngliche Entscheidungsvorlage (zur Herleitung)

```
RED UNTIL JR-13-04: the Drizzle half alone is fail-closed for an untranslatable condition (F3)
  tests/integration/filter-builder-f1-f3.int.test.ts
```

**Er ist mit seinem Geschwistertest aus derselben Task unvereinbar.** Beide beschreiben die
_strukturell identische_ Eingabe — eine Disjunktion aus einem übersetzbaren und einem
unübersetzbaren Zweig — und fordern Gegenteiliges:

| Ort                                                      | Eingabe                                              | Forderung                                                                     |
| -------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/helpers/mongoToDrizzle.test.ts:203`                 | `{ $or: [ {id:'a'}, {subject:{$regex:'x'}} ] }`      | `expectFailClosed` ⇒ **throw oder `1=0`/`false`**                             |
| `tests/integration/filter-builder-f1-f3.int.test.ts:236` | `{ $or: [ {userEmail:E}, {subject:{$regex:'…'}} ] }` | ein Prädikat, das **genau `[rows.mine]`** liefert — also weder noch           |
| `tests/integration/filter-builder-f1-f3.int.test.ts:223` | `{ $or: [ {subject:{$regex:'…'}} ] }`                | ein Prädikat, das **keine** Zeile liefert — der Aufruf ist **nicht** in `try` |

Eine Implementierung kann höchstens zwei der drei erfüllen. Gewählt ist **werfen**, aus drei Gründen:

1. Das Akzeptanzkriterium von `JR-13-04` lautet „kein Zweig wird stillschweigend weggelassen" — auch
   im `$or` (dort verengend, F22). Die Forderung des Unit-Tests deckt sich damit, die zweite
   Assertion des Integrationstests hält gerade das F22-Verhalten fest, das das Kriterium verbietet.
2. `mongoToMeli` **wirft** für genau diese Form schon heute, und ein **grüner** Test hält das fest
   (`tests/integration/mongo-to-meli.int.test.ts:147`). `FilterBuilder.create()` lehnt eine solche
   Policy also bereits vor E13 ab. Ein never-true-Prädikat im Drizzle-Zweig hätte die beiden
   Übersetzer auseinanderlaufen lassen.
3. Ein never-true-Prädikat pro Zweig ist am `$not` nicht durchhaltbar: `not(false)` ist **wahr** —
   aus einem verlorenen Verbot würde eine Erlaubnis.

**Der Fix ist nicht das Problem, die Testfassung ist es.** Empfehlung an den PO: die beiden Aufrufe
in `filter-builder-f1-f3.int.test.ts` (Zeilen 223 und 236) durch `expectFailClosed` bzw. ein
`try`/`catch` ersetzen und die Erwartung `[rows.mine]` streichen — sie pinnt die F22-Verengung, die
`JR-13-04` beseitigen soll. **Das ist eine Teständerung und gehört zur Rolle `tester`, nicht zum
DEV**; sie wurde deshalb nicht vorgenommen und der Test bleibt rot. Danach ist der Endstand
`224 passed | 2 skipped`, Exit 0.

### E13 — Rot-Läufe `JR-13-01` (2026-07-29)

**Der Branch ist rot, und das ist das Ergebnis.** Die Vorgängertests hielten F1/F3/F7/F8 als
_bestanden_ fest — ein grüner Test, der eine Sicherheitslücke beschreibt, lässt sie vermessen
aussehen. Sie fordern jetzt den gewünschten Zustand.

**Kommando und Ausgabe (lokaler PostgreSQL-16.13-Cluster, danach restlos entfernt):**

```
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres OA_TEST_REQUIRE_INFRA=1 pnpm test
```

```
[TEST-INVENTORY] unit: 7 file(s) (min 7) · integration: 8 file(s) (min 8) · adversarial: 1 file(s) (min 1) · unclassified: 0
 Test Files  6 failed | 10 passed (16)
      Tests  21 failed | 203 passed | 2 skipped (226)
EXIT=1
```

Zum Vergleich der Ausgangsstand auf `efea6bc`, gleiches Kommando: `10 passed`,
`197 passed | 2 skipped`, Exit `0`. Der Zuwachs an grünen Tests (197 → 203) kommt aus den
Gegenproben, der Zuwachs an roten aus den Anforderungen.

**21 rote Tests, jeder einer DEV-Task zugeordnet.** Das Titelpräfix `RED UNTIL JR-13xx` steht im
Testnamen, ist also im Lauf sichtbar und filterbar (`pnpm test -t "RED UNTIL JR-13-02"`).

| Task         | Rot | Datei(en)                                                                                                                                                       |
| ------------ | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **JR-13-02** | 5   | `tests/integration/filter-builder-f7.int.test.ts` (4), `tests/integration/filter-builder-f1-f3.int.test.ts` (1, F20)                                            |
| **JR-13-03** | 1   | `tests/unit/filter-builder-call-sites.test.ts`                                                                                                                  |
| **JR-13-04** | 7   | `src/helpers/mongoToDrizzle.test.ts` (5, davon 3 aus der Golden-Datei), `tests/integration/filter-builder-f1-f3.int.test.ts` (2, davon 1 = F19)                 |
| **JR-13-05** | 3   | `tests/integration/filter-builder-f8.int.test.ts` (`$in`, `$nin`, `$gte`)                                                                                       |
| **JR-13-06** | 5   | `src/helpers/mongoToDrizzle.test.ts` (2), `src/iam-policy/policy-validator.f1-conditions.test.ts` (2), `tests/integration/filter-builder-f1-f3.int.test.ts` (1) |

**Kein Opt-out-Mechanismus, bewusst.** Es gibt kein `it.skip`, kein `it.fails`, keine
Umgebungsvariable, die die roten Tests grün oder still macht. Jeder solche Schalter ist ein Hebel, um
das Epic fertig aussehen zu lassen, während der Defekt offen ist — und genau diese Fehlerform hat
`JR-13-01` gerade beseitigt. Die Isolation, die man tatsächlich braucht, liefert vitest schon: ein
fehlschlagender Fall macht seinen eigenen Fall rot, die übrigen 15 Dateien laufen und berichten
weiter. `it.fails` ist zusätzlich untauglich: es meldet **grün**, solange der Defekt besteht.

**Neue und geänderte Dateien:**

| Datei                                                                    | Klasse | Rolle                                                                               |
| ------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------- |
| `packages/backend/tests/support/fail-closed.ts`                          | —      | gemeinsamer Fail-closed-Vertrag (`expectFailClosed`, `redUntil`, …)                 |
| `packages/backend/tests/support/express-i18n-augmentation.d.ts`          | —      | Typ-Import, damit `test:types` einen Express-Controller verträgt (F23)              |
| `packages/backend/src/iam-policy/policy-validator.f1-conditions.test.ts` | `ci`   | F1 an der Validierungsgrenze                                                        |
| `packages/backend/tests/unit/filter-builder-call-sites.test.ts`          | `ci`   | ADR-017/`JR-13-03`: Aufrufstellen-Inventar                                          |
| `packages/backend/tests/integration/filter-builder-f7.int.test.ts`       | `ci`   | F7a, F7b, ADR-017-Semantik                                                          |
| `packages/backend/tests/integration/filter-builder-f8.int.test.ts`       | `ci`   | F8, drei Operator-Formen                                                            |
| `packages/backend/tests/integration/filter-builder-f1-f3.int.test.ts`    | `ci`   | F1 ausgeführt gegen Postgres, F3/F19/F20                                            |
| `packages/backend/tests/integration/predefined-roles.int.test.ts`        | `ci`   | ADR-017-Wirkungsanalyse, **grün** vor und nach dem Fix                              |
| `packages/backend/src/helpers/mongoToDrizzle.test.ts`                    | `ci`   | geändert: F1-Block und drei F3-Pins umgebaut, `it.fails` entfernt                   |
| `packages/backend/tests/fixtures/mongo-to-drizzle-golden.json`           | —      | geändert: drei `failOpen`-Fälle ⇒ `mustFailClosed`                                  |
| `packages/backend/tests/integration/filter-builder.int.test.ts`          | `ci`   | geändert: F1/F3/F7/F8-Blöcke entfernt, bleibt grün vor und nach dem Fix             |
| `tests/support/suite-inventory.ts`                                       | —      | `minimumFiles` bewusst auf den neuen Bestand: unit 5 → **7**, integration 4 → **8** |
| `packages/backend/tests/unit/suite-inventory.test.ts`                    | `ci`   | geändert: hartkodierte `4` durch `suiteMinimum('integration')` ersetzt              |

Klasse durchweg `ci`: alles läuft in unter 10 s, die `integration`-Dateien brauchen nur die Postgres,
die der CI-Job schon bereitstellt. Kein `nightly`, kein `manual` — es gibt hier keinen Soak und keine
externe Infrastruktur. **F14 beachtet:** die Mindestzahlen sind auf den exakten Bestand gehoben, nicht
mit Spiel gelassen (das ist F15s Fehlerform).

### ADR-017s Wirkungsanalyse: **hält** — Nachweis erbracht

`tests/integration/predefined-roles.int.test.ts` legt die drei Rollen über **Produktionscode** an
(`UserService.createAdminRole()`, und `createDefaultRoles()` über seinen echten Auslöser
`IamController.getRoles()`), nicht über eine Kopie der Policies. Zwei unabhängige Hälften:

**1. Zweig-Sonde.** Von außen liefern `FilterBuilder.ts:31` (gewollter Vollzugriff) und `:49` (der
F7-Defekt) heute **denselben** Wert, sind also nicht unterscheidbar. Die Sonde leitet den Zweig aus
der echten Ability neu ab (`rulesFor` + `rulesToQuery`, wie `FilterBuilder`) und berichtet ihn:

```
predefined_super_admin    / read archive   -> unconditional-can
predefined_super_admin    / search archive -> unconditional-can
predefined_super_admin    / read ingestion -> unconditional-can
predefined_end_user       / read archive   -> translated-query
predefined_end_user       / search archive -> translated-query
predefined_end_user       / read ingestion -> translated-query
predefined_read_only_user / read archive   -> unconditional-can
predefined_read_only_user / search archive -> unconditional-can
predefined_read_only_user / read ingestion -> unconditional-can
```

Kein `null-branch`. **ADR-017s Tabelle ist bestätigt**, für alle drei (Action, Subject)-Paare, die die
vier `FilterBuilder.create()`-Aufrufstellen verwenden.

**2. Verhaltens-Momentaufnahme, und die eigentliche Aussage.** Für jede der drei Rollen sind das
Ergebnis für `('archive','read')` und für `('archive','search')` **identisch** (Filter-Text, gebundene
Parameter, Meili-Filter). Damit ist `JR-13-03`s Änderung des dritten Arguments für eine
Standardinstallation belegbar wirkungsfrei — unabhängig davon, was `JR-13-02` mit dem `null`-Zweig
macht. Dazu die Zeilen: `predefined_end_user` sieht genau seine eigenen Quellen
(`"ingestion_sources"."user_id" = $1`, Meili `(ingestionSourceId IN [...])`), die beiden anderen alles.

**Zwei Einschränkungen, beide neu und beide benannt:**

- **F18** — die Aussage gilt **je Aufrufstelle, nicht je Rolle.** Über das volle Vokabular (8 Actions
  × 7 Subjects) erreichen `predefined_end_user` **39** und `predefined_read_only_user` **46** Paare den
  `null`-Zweig; nur `manage: all` erreicht ihn nie. Heute harmlos, weil keine Aufrufstelle einen
  Filter für diese Paare baut — und deshalb wacht `tests/unit/filter-builder-call-sites.test.ts`
  jetzt darüber, dass es bei vier Aufrufstellen bleibt.
- **F17** — **zwei der drei Rollen werden in einer echten Installation nie angelegt.**
  `createAdminRole()` legt bei der Ersteinrichtung `predefined_super_admin` an und erfüllt damit
  dauerhaft den Auslöser `!roles.some(r => r.slug?.includes('predefined_'))`, sodass
  `createDefaultRoles()` nie läuft. Nachgewiesen. `JR-13-07`s Prüfanleitung muss das sagen: ausgeliefert
  gibt es **keine Read-Only-Rolle**, jede eingeschränkte Rolle ist handgeschrieben und hat die Form von
  `auditor-specific-mailbox.json` — genau die Form, die F7 unwirksam macht. **F7s praktische Schwere
  steigt dadurch.**

Fazit: `JR-13-07` bleibt in der entschärften Fassung richtig, muss aber F17 aufnehmen. Die scharfe
Formulierung („der Fix bricht Bestandsinstallationen") ist **nicht** nötig.

### Was `JR-13-01` bewusst nicht getan hat

- **Kein Produktionscode geändert.** `FilterBuilder.ts`, `SearchService.ts`, `mongoToDrizzle.ts`,
  `mongoToMeli.ts`, `policy-validator.ts` und alle Routen sind unberührt
  (`git diff --stat -- packages/backend/src ':!*.test.ts'` ist leer).
- **F17, F18, F21, F22 nicht behoben und nicht rot gemacht.** Sie liegen außerhalb der vier Befunde,
  die E13 beauftragt hat; ein roter Test ohne zuständige Task blockiert nur `JR-13-09`. Sie sind
  gemeldet und, wo sinnvoll, als Ist-Zustand mit lauter `coverageNotice` festgehalten (F17).
- **Kein Test durch `SearchService` hindurch.** Zwei Gründe, beide im Testkopf benannt: es läuft kein
  Meilisearch in dieser Umgebung, und ein Import von `SearchService` zieht über `IngestionService` →
  `jobs/queues.ts` drei BullMQ-Queues gegen ein nicht vorhandenes Redis. Der Action-Versatz ist
  deshalb über das **Aufrufstellen-Inventar** am Quelltext geprüft, die Semantik dahinter
  verhaltensmäßig über `FilterBuilder`. Die Lücke ist eine Aussage über die Verdrahtung, nicht über das
  Verhalten — wer sie schließen will, braucht ADR-017s Variante C (`JR-13-10`) oder Meilisearch im
  Testaufbau.
- **F4, F5, F9, F10 unverändert** als offen dokumentiert und weiterhin als Ist-Zustand gepinnt.
- **PostgreSQL 17 nicht geprüft.** Lokal 16.13, CI 17.10 — die Versionslücke aus `JR-1-04`/`JR-1-06a`
  besteht unverändert. Für diese Befunde ist sie unkritisch (kein versionsabhängiges Verhalten
  berührt), sie ist aber nicht ausgeschlossen: der F1-Nachweis hängt an der Operator-Präzedenz und der
  Typprüfung von Postgres, und beides ist zwischen 16 und 17 unverändert, aber nicht gemessen.

---

## E5 — Journal-Report-Parser (Parallelsession B, seit 2026-08-02)

> **Dieser Abschnitt gehört einer zweiten, gleichzeitig laufenden Session.** Regeln, Kollisionsflächen
> und Merge-Richtung stehen in `12-parallelbetrieb.md`. Session B fasst weder `07-session-handover.md`
> noch die Abschnitte der E3-Session in dieser Datei an — auch nicht die Kopfzeile
> „Letzte Aktualisierung", die der E3-Session gehört.

**Branch:** `claude/journaling-e5-parser`, abgezweigt vom Integrationsbranch bei `9725a5d`, am
2026-08-02 auf `d201612` rebased (E3 abgenommen und zurückgemergt). **Kein E5-Commit ist je auf dem
Integrationsbranch gelandet** — mit `git merge-base --is-ancestor` für alle drei geprüft, nachdem
`d201612` die Upstream-Falle beschrieben hat; `git push -u` lief hier direkt nach dem Anlegen.
**Warum parallel möglich:** E3 lebt in `packages/journaling/src/spool/*`, E5 in
`packages/journaling/src/parser/*` — kein geteiltes Byte. E5 ist reine Logik über Bytes: keine
Datenbank, kein Storage, kein SMTP. Die Backlog-Abhängigkeit E5 → E4 betrifft **eine** Task
(`JR-5-05`), und die SMTP-Envelope ist dort ein Eingabeparameter, kein Code aus E4.

| Task      | Stand                                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `JR-5-01` | **[x] erledigt** 2026-08-02 (S1 + Review-Nacharbeit)                                                                             |
| `JR-5-02` | **[x] erledigt** 2026-08-02 (S1 + Review-Nacharbeit)                                                                             |
| `JR-5-03` | **[x] erledigt** 2026-08-02 (S2 + Review-Nacharbeit)                                                                             |
| `JR-5-04` | **[~] parserseitig erledigt, Rest hängt an E6** — der Ledger-Eintrag, der Storage, die Indexierung und der Alarm sind E6s Arbeit |
| `JR-5-05` | **[x] erledigt** 2026-08-02 (S3 + drei Runden Review)                                                                            |
| `JR-5-06` | **[x] erledigt** 2026-08-02 (S3)                                                                                                 |
| `JR-5-07` | **[x] erledigt** 2026-08-02 (S4) — mit einem Befund an E6, siehe unten                                                           |
| `JR-5-08` | **[x] erledigt** 2026-08-02 (S5 Korpus + S6 Reparatur) — zwei Befunde, alle behoben                                              |
| `JR-5-09` | **[x] erledigt** 2026-08-02 — **angenommen mit Auflage**, Auflage geschlossen (F43)                                              |

### Was `JR-5-01`/`JR-5-02` liefern

`packages/journaling/src/parser/` zerlegt einen Exchange-Journal-Report in Außenobjekt, Innenmail und
Envelope, ohne die übergebenen Bytes anzufassen. `Recipient:` wird als eigene, **reihenfolgetreue und
nicht deduplizierte** Liste geführt statt in `to`/`cc` gefaltet — dort erscheinen Blindkopie-Empfänger
und Verteilerlisten-Mitglieder, und das ist die Existenzberechtigung des Features. An der Fixture
gemessen: der Bcc-Empfänger und alle drei DL-Mitglieder stehen in `recipients` und in **weder** `to`
**noch** `cc`. Feldzeilen, die der Parser nicht modelliert, bleiben unter ihrem Namen erhalten statt
verworfen zu werden. Der Parser **wirft nicht** — jeder Fehlerpfad wird zu `kind: 'parse_failed'`
(RFC §5.3).

### Der Befund, der die Scheibe geprägt hat: `mailparser` und `Content-Disposition: inline`

Der erste DEV-Entwurf begründete einen handgeschriebenen MIME-Splitter damit, `mailparser` steige
durch die `message/rfc822`-Grenze durch. **Die Begründung stimmt, aber nur unter einer Bedingung**,
die der Kommentar unterschlug. Gegen `mailparser@3.7.4` gemessen:

```
disposition=(keine)    | Innentext in .text = false | attachments = 1
disposition=inline     | Innentext in .text = TRUE  | attachments = 0
disposition=attachment | Innentext in .text = false | attachments = 1
```

Bei `inline` mischt `mailparser` den Körper der Innenmail in dieselbe `.text` wie den Reportteil — der
Envelope-Parser läse seine Feldzeilen dann aus einem Text, in dem die Innenmail steht, **ohne Fehler
und ohne Spur**. Die Entwurfsentscheidung ist damit richtig; ausgeschrieben ist sie im **Nachtrag zu
ADR-027**, samt Quellstellen (`mailsplit/lib/message-splitter.js:373-378`, `mail-parser.js:806`), und
die drei Zeilen laufen als Test bei jedem CI-Lauf mit — **damit die nächste Session das Modul nicht
als überflüssige Komplexität löscht**, nachdem sie den harmlosen Fall geprüft hat.

### Das PO-Review, weil es vier weitere Punkte gefunden hat

Der DEV-Bericht war ehrlich und die Zahlen reproduzierten exakt — die Mängel lagen trotzdem im Code:
`splitAddressList()` zerlegte `"Doe, John" <john@contoso.com>` in fünf Trümmer (jetzt über
`mailparser`s eigenen Adressparser), eine Feldnamen-Liste konnte vom `switch` wegdriften (jetzt aus
einer Dispatch-Tabelle abgeleitet), `undisclosedRecipients` verlor als einzelnes Bool, welches Feld den
Platzhalter trug (jetzt eine Feldliste), und `findLineStarts()` hielt eine Körperzeile `--B1EXTRA` bei
Boundary `B1` für einen Trenner (jetzt mit RFC-2046-Prüfung des Zeilenrests).

**Die Lehre ist nicht „prüfe Berichte".** Alle vier waren aus dem Diff lesbar, keiner davon hätte einen
Test rot gemacht, und drei hätten still falsche Metadaten erzeugt.

### Was `JR-5-03`/`JR-5-04` liefern

**S/MIME:** `contentEncrypted` wird am **Content-Type des Innenteils** entschieden, nicht daran, ob
`mailparser` gestolpert ist — die Bibliothek wirft bei verschlüsseltem Körper nämlich gar nicht, das
Signal wäre also wertlos gewesen. `multipart/signed` bleibt ausdrücklich ausgenommen: ein
**signierter** Innenteil ist lesbar und indexierbar, ein **verschlüsselter** nicht, und die beiden zu
verwechseln hieße entweder Chiffrat zu indexieren oder lesbare Post nicht.

**Kein Innenteil:** `kind: 'journal_report'` mit `innerMessage: { present: false }` — der Envelope
bleibt **vollständig** erhalten. Der Aufrufer erkennt am `present === false`, dass zusätzlich ein
`parse_failed`-Ereignis fällig ist.

**Nicht-Wurf:** sieben absichtlich kaputte Eingaben (abgeschnitten, falsche Boundary, verschachtelte
Multiparts, 8-Bit-Müll, leerer Puffer, nur Header, Boundary ohne Abschluss) — keine erzeugt eine
Ausnahme.

**Was `JR-5-04` parserseitig beiträgt:** `JournalParseFailed` trägt `extractableHeaders`, damit E6s
„Extrahierbares wird indexieren" überhaupt etwas hat. Ein `parse_failed`, das nur einen `reason`
trägt, macht Indexierung unmöglich.

### Der Befund aus dem S2-Review: eine grüne Suite, die den Envelope verlor

Der erste S2-Entwurf gab im Fall „Reportteil in Ordnung, Innenteil fehlt" ein `parse_failed` zurück
und reduzierte den zu diesem Zeitpunkt **vollständig geparsten** Envelope auf drei Felder
(`subject`/`from`/`messageId`). Verloren gingen dabei `bcc`, `recipients` samt
Verteilerlisten-Expansion, `onBehalfOf` und `unknownFields` — also genau das, was RFC §6.1 „the entire
justification for this feature" nennt und woran `JR-5-02` abgenommen wird. Ein fehlender **Innen**teil
ist kein Grund, den **Außen**-Envelope zu verwerfen.

Verschärfend: `InnerMessageAbsent { present: false }` steht seit S1 im Typ und wurde von **nichts**
mehr erzeugt. Für einen Fall gab es zwei Mechanismen, und der ungenutzte war der, der die Daten
behält.

> **Die Lehre ist nicht „prüfe Berichte", sondern etwas Unangenehmeres: die Suite war grün.**
> `582 passed`, kein einziger roter Test — weil keiner geprüft hat, ob der Envelope einen fehlenden
> Innenteil überlebt. Der Befund lag nicht im Code, sondern in der Abwesenheit einer Behauptung.
> **Für `JR-5-08` (Korpus, Rolle TEST) ist das die eigentliche Vorgabe:** jede Fixture muss eine
> Aussage darüber tragen, was **erhalten bleibt**, nicht nur darüber, was erkannt wird.

Festgelegte Invariante, ab jetzt gültig für jeden Pfad im Parser: **ist der Envelope einmal geparst,
darf ihn kein Rückgabeweg fallen lassen.**

Zwei weitere Punkte aus demselben Review: `ParseFailedAlert`/`ParseFailedAlertSink` waren ohne
Erzeuger und ohne Aufrufer entstanden — eine Naht, die keine ist, mit dem Risiko, dass E6 sie
übernimmt, **weil es sie gibt**. Gestrichen; die Alarmierung definiert E6, wenn sie ihren Kontext
kennt. Und die veraltete S/MIME-Form `application/x-pkcs7-mime` hatte keine Fixture („aus
Zeitgründen") — nachgezogen.

### Was `JR-5-05`/`JR-5-06` liefern

Die Union kennt jetzt vier Arten: `journal_report`, `plain_bcc`, `ndr`, `parse_failed`. Der SMTP-Envelope
kommt als **injizierter Parameter** herein — unter genau den Feldnamen, die E3 schon vergeben hat
(`envelopeFrom`, `envelopeRcpt` aus `JournalTransactionInput` und der Ledger-Zeile), damit derselbe
Sachverhalt nicht unter zwei Namen durch Ingress, Ledger und Parser läuft. Das ist zugleich die Naht,
an der E4 andockt, ohne dass E5 auf E4 warten musste.

`plain_bcc` trägt `reducedEnvelopeFidelity: true` — bei einer Plain-BCC-Kopie fehlen die
Blindkopie-Empfänger **strukturell**, weil kein Journal-Report sie liefert, und das Ergebnis sagt das,
statt es zu verschweigen. Postfix-`always_bcc` und Google-Routing werden bewusst **nicht**
unterschieden: aus den Bytes ist der Unterschied nicht ableitbar, eine Unterscheidung hätte Information
vorgetäuscht.

NDR-Erkennung wiegt drei Signale und sagt im Code, welches das stärkste ist: der **Null-Absender**,
weil er aus der SMTP-Transaktion kommt und nicht aus einem Header, den der Absender selbst setzt.

### Der teuerste Befund des Epics: dreimal aus der Form auf die Art geschlossen

`JR-5-05` hat drei Review-Runden gebraucht, und alle drei waren **dieselbe** Ursache auf einer anderen
MIME-Ebene:

| Runde | Was als Beleg galt                      | Was in Wirklichkeit dieselbe Form hat |
| ----- | --------------------------------------- | ------------------------------------- |
| R1    | `multipart/mixed` mit `text/plain`-Teil | jede Mail mit Anhang                  |
| R3    | mindestens ein erkanntes Envelope-Feld  | jede zitierte Weiterleitung           |
| R4    | ein `message/rfc822`-Teil ist vorhanden | „Als Anlage weiterleiten"             |

Gemessen, nicht vermutet. R1 ließ eine Plain-BCC-Kopie als Journal-Report durchgehen und den
Nachrichtenkörper als `_unparsed` in die Envelope-Metadaten wandern. R3 war **schlimmer**: die zitierten
`To:`/`Cc:`-Zeilen einer Weiterleitung wurden zu Envelope-Empfängern — aus **verlorenem** Nachweis wurde
**erfundener**. R4 behauptete bei „als Anlage weiterleiten" einen maßgeblichen, aber **leeren** Envelope,
also „dieser Report hatte keine Empfänger" über eine Nachricht, die welche hatte.

> **Die Regel, die daraus im Modulkommentar steht:** Die MIME-Struktur belegt **nie**, dass eine
> Nachricht ein Journal-Report ist — jede ihrer Formen entsteht auch bei gewöhnlicher Post. Beleg ist
> ausschließlich der **Inhalt** des Reportteils: eine `Recipient:`-Zeile (die Exchange immer schreibt und
> die eine zitierte Weiterleitung nie reproduziert, weil sie kein RFC-5322-Header ist) **und** ein
> Feldzeilenanfang. Die Struktur entscheidet danach nur noch, was **zusätzlich** verfügbar ist.
>
> **Und die Richtungsregel für jede Klassifikation:** die Fehlerrichtung ist immer „reduzierte
> Fidelity", nie „erfundener Nachweis". Im Zweifel `plain_bcc` — das sagt „unvollständig", was bei
> Unsicherheit wahr ist; `journal_report` behauptet „maßgeblich", was dann falsch ist.

Die Prüfung sitzt seit R4 **vor** der Verzweigung über den Innenteil. Der Innenteil entscheidet nur noch,
ob `innerMessage.present` gesetzt wird — nicht mehr, _ob_ es ein Journal-Report ist.

**Zwei Dinge daran sind für die Abnahme wichtiger als die Korrektur selbst.** Erstens: Über die
Akzeptanzkriterien war nichts davon erreichbar. `JR-5-01` bis `JR-5-06` waren einzeln erfüllt, während
der Parser Alltagspost falsch einordnete. Zweitens: Die Suite war in **jeder** der drei Runden grün.
Sichtbar wurde es nur, indem reale Nachrichtenformen durchprobiert wurden — sieben Formen, gegen das
gebaute Paket gefahren, nicht gegen die Absicht.

**Damit ist `JR-5-08` keine Fixture-Sammelaufgabe mehr, sondern die eigentliche Prüfarbeit des Epics.**
Der Korpus muss Alltagsformen enthalten, die **keine** Journal-Reports sind — Weiterleitung zitiert,
Weiterleitung als Anlage, Mail mit Anhang, Autoreply, Kalendereinladung, `multipart/alternative` —, und
je Fixture aussagen, **was erhalten bleibt**, nicht nur, was erkannt wird.

### Was `JR-5-07` liefert

`resolveOwner(envelope, domainGroups)` in `packages/journaling/src/parser/owner-resolution.ts` — rein,
synchron, ohne Datenbank, ohne Konfiguration, **ohne Logger**. Die von Kriterium 4 verlangte Warnung ist
ein **Wert** im Ergebnis (`warning: string | null`, nicht-null genau bei `method === 'fallback'`); den
Logaufruf macht der Aufrufer in E6. `packages/journaling` bekommt keinen Logger, auch nicht für „nur eine
Zeile".

Die vier dokumentierten Tabellenzeilen aus `docs/enterprise/journaling/guide.md` sind gegen das gebaute
Paket nachgefahren, dazu vier eigene Fälle:

```
OK  Tabelle Z1 alice@old-brand.com -> alice@company.com            method=alias-domain-match
OK  Tabelle Z2 alice@company.com   -> alice@company.com            method=primary-domain-match
OK  Tabelle Z3 bob@subsidiary.io   -> bob@subsidiary.io            method=primary-domain-match
OK  Tabelle Z4 external@gmail.com  -> default_fallback@company.com method=fallback
OK  ohne Gruppen (Heuristik)       -> x@fremd.tld                  method=heuristic-no-groups
OK  GROSS in Domain                -> alice@company.com            method=alias-domain-match
OK  Ausgang: nur sender passt      -> alice@company.com            method=primary-domain-match
OK  Reihenfolge To vor Cc          -> a@company.com                method=primary-domain-match
```

**Der Weg steht im Ergebnis, nicht nur das Ziel.** `method` unterscheidet vier Wege — exakter Treffer,
Alias-Normalisierung, Heuristik ohne Gruppen, Fallback —, die nicht gleich viel wert sind. Das ist die
Richtungsregel aus S3 auf dieses Problem angewandt: aus einer passenden Domain auf Eigentümerschaft zu
schließen ist eine Annahme, und ein geratener Eigentümer, der als sicher ausgegeben wird, wäre der
verbotene Fall. `additionalMatches` führt außerdem mit, wenn **mehrere** Teilnehmer gepasst haben.

Die Signatur nimmt bewusst nur `OwnerResolutionEnvelope` (ein `Pick` aus `ParsedEnvelope`), sodass
`plain_bcc`- und `ndr`-Ergebnisse **gar nicht erst kompilieren** statt zur Laufzeit geraten zu werden.

### Befund aus `JR-5-07`: die dokumentierte Reihenfolge kennt `Recipient:` nicht

Die veröffentlichte Seite bestimmt den Eigentümer aus `To`/`Cc`/`Bcc`/`From` — also aus den Feldern, die
die **Header spiegeln**. Sie erwähnt `Recipient:` an keiner Stelle, obwohl genau dieses Feld die wahre
SMTP-Empfängerliste trägt und im Typ selbst als „the entire justification for this feature" beschrieben
ist.

Folge: Ein Empfänger, der **nur** in der Envelope steht — der klassische Fall ist die
Verteilerlisten-Expansion —, beeinflusst die Eigentümerbestimmung nicht. Eine Nachricht an eine Liste
wird unter der **Listenadresse** abgelegt, nicht unter dem expandierten Mitglied.

**Entscheidung des PO (2026-08-02): der Code folgt der Doku, der Widerspruch geht an E6.** Begründung:
Die veröffentlichte Seite still zu unterlaufen wäre die schlechtere Hälfte beider Welten, und **erst in
E6 entscheidet sich, was `archived_emails.userEmail` überhaupt bedeutet** — ob je Nachricht ein
Archiveintrag entsteht oder je betroffenem Postfach. Ohne diese Festlegung ist nicht entscheidbar, ob
das expandierte Mitglied den Eigentümer stellen soll. **`JR-6-02` muss das mitentscheiden** (dort steht
ohnehin ADR-010 offen: `processEmail` erweitern vs. eigener Pfad).

Die naheliegende Zwischenform, falls E6 sie will: `recipients` als **Auffang vor** dem
`default_fallback`-Zweig. Das ändert **keine** der vier dokumentierten Tabellenzeilen und macht keine
Aussage der Seite falsch — es fügt einen Schritt hinzu, wo die Seite heute aufgibt.

### Zweiter offener Punkt aus `JR-5-07`: doppelt konfigurierte Alias-Domain

Steht dieselbe Domain in **zwei** Gruppen als Alias, gewinnt die erste in Array-Reihenfolge; innerhalb
einer Gruppe `main` vor `aliases`. Das ist dokumentiert und getestet, aber es ist ein **Tie-Break, keine
Prüfung** — beanstanden kann der Parser es nicht, weil er per Architekturregel keine Konfiguration
bekommt, sondern nur die fertigen Gruppen.

**Vorgeschlagene Folgeaufgabe für `packages/backend`** (Nummer vergibt der Auftraggeber, die JR-Folge ist
zwischen den Sessions geteilt): eine Validierung dort, wo `journaling_sources.organizationDomains`
tatsächlich geschrieben wird — eine Domain in zwei Gruppen ist ein Bedienfehler, der beim Speichern
auffallen sollte und nicht erst bei der Ablage einer Nachricht.

### `JR-5-08`: der Korpus hat geliefert, wofür er gebaut wurde

Acht neue Fixtures, und zwar **nicht nur** die Journal-Formen aus dem Backlog, sondern Alltagspost, die
**keine** Journal-Reports ist: Kalendereinladung, Newsletter, Abwesenheitsnotiz, Mail mit Anhang,
zitierter Report im Fließtext. Diese Ergänzung war der Zweck — alle drei Fehlklassifikationen aus
`JR-5-05` kamen von gewöhnlicher Post, die als Journal-Report durchging.

Die Rolle TEST hat **drei Tests rot gelassen**, statt den Korpus um die Befunde herumzubauen. Genau
richtig: ein Korpus, der sich am Fehler vorbeischreibt, ist wertlos.

**Befund A — die Suche nach dem Reportteil geht nur eine Ebene tief.**
`multipart/mixed(multipart/alternative(text/plain, text/html), Anhang)` ist das, was **jeder**
HTML-schreibende Client für „Mail mit Anhang" erzeugt. Auf oberster Ebene gibt es kein `text/plain`,
also kam `parse_failed` heraus — mit Ledger-Ereignis **und** Operator-Alarm, für Alltagsverkehr. In
einem `always_bcc`-Postfach wäre das die Mehrheit. **Ein Alarm, der ständig feuert, ist derselbe
Ausfall wie einer, der nie feuert.**

Behoben in der besseren der beiden Richtungen: Wo es gar keinen Kandidaten für einen Reportteil gibt,
kann der Diskriminator **nicht einmal laufen** — dann ist „das ist kein Journal-Report" die einzige
Aussage, die der Parser stützen kann, und `parse_failed` („da war ein kaputter Versuch") behauptet mehr,
als er weiß. Die Suche bleibt bewusst flach: sie in `multipart/alternative` hineinzulehren hätte den
Fehler „Struktur belegt die Art" nur eine Ebene tiefer verschoben.

**Befund B — der inhaltliche Diskriminator ist vom Absender fälschbar.** Die fünfte Ausprägung
derselben Ursache, und die, die das **Verfahren** widerlegt statt nur ein Kriterium. Führt zu
**ADR-028**. Die Ausnutzbarkeit ist gemessen und ungleich verteilt:

| Betriebsart         | greift der Angriff? | warum                                                                        |
| ------------------- | ------------------- | ---------------------------------------------------------------------------- |
| Exchange-Journaling | **nein**            | Exchange wickelt ein; der gefälschte Inhalt sitzt im nie befragten Innenteil |
| Plain BCC / Routing | **ja**              | kein Wrapper — die Angreifernachricht **ist** die oberste Ebene              |

Er greift also genau dort, wo Journal-Reports gar nicht vorkommen — und das ist der Beweis der
Reparatur: `parseJournalReport(raw, smtpEnvelope, sourceMode)`. Gemessen an denselben Bytes:

```
content-forged-fake-report-as-attachment.eml    infer=journal_report  plain-bcc=plain_bcc
content-forged-fake-report-with-fake-inner.eml  infer=journal_report  plain-bcc=plain_bcc
```

**Die Grenze ist nicht weggeschrieben worden.** Unter `'infer'` behaupten beide Fixtures weiterhin
messbar `journal_report` mit absenderbestimmtem `sender` — als **dokumentierte Grenze**, im Test und im
Kommentar so benannt. Was der Parser nicht leisten kann, steht dort ausdrücklich: wer wirklich
zugestellt hat, entscheidet sich an der SMTP-Transaktion (`JR-4-05`), und keine Inhaltsprüfung ersetzt
das.

**Befund C — eine Abwesenheitsnotiz wurde als `ndr` ausgegeben**, weil `Auto-Submitted` als
eigenständiges Signal zählte. Ein Archiv, das eine Urlaubsantwort unter „Unzustellbarkeit" ablegt,
behauptet ein Zustellproblem, das es nie gab.

> **Hier hat der DEV den PO widerlegt, und das ist der Eintrag wert.** Meine Vorgabe lautete, RFC 3834
> unterscheide `auto-generated` (DSN) von `auto-replied` (Autoresponder), man müsse also nur den Wert
> auswerten. Der Agent hat den RFC geholt statt sie zu glauben: **§7 setzt `auto-replied` in seinem
> eigenen Beispiel auf einen Urlaubsautoresponder**, und §5 erlaubt denselben Token auf einer echten
> DSN. **Der Wert kann die beiden Fälle nicht trennen.** Die gewählte Lösung ist deshalb besser als die
> vorgegebene: tragend sind allein die RFC-3464-Struktur und der **Null-Absender** aus der
> SMTP-Transaktion; `Auto-Submitted` ist Bestätigung, nie Beleg. Dabei fiel ein **vorhandener** Test aus
> `JR-5-06` auf, der das widerlegte Verhalten festgeschrieben hatte.

### Gegenprobe nach der Reparatur

Sechzehn Formen gegen das gebaute Paket, nicht gegen die Absicht — alle wie erwartet: echte Reports
(vollständig, Innenteil fehlt, Bcc-only, Report umschließt NDR) bleiben `journal_report`;
Weiterleitung zitiert, Weiterleitung als Anlage, Mail mit Anhang, Kalendereinladung, Newsletter,
Abwesenheitsnotiz sind `plain_bcc`; der DSN bleibt `ndr`. Die sieben kaputten Eingaben aus S3 werfen
weiterhin nicht, und die vier Tabellenzeilen aus S4 sind unberührt.

### `JR-5-09`: Abnahme durch die Rolle TEST — **angenommen mit Auflage**

Die Prüferin hat die Basiszahlen selbst nachgefahren statt sie zu glauben (deckungsgleich), die acht
Kriterien einzeln am **gebauten** Paket gemessen, und die zwei Fallen, die ich ihr vorgelegt habe, beide
eingehalten:

- **Reichweite über E5 hinaus:** `JR-5-01` (Storage), `JR-5-03` (Indexierung) und `JR-5-04`
  (Ledger, Alarm) verlangen Dinge, die es in einem reinen Parser nicht gibt. Sie hat sie als
  **teilweise** ausgewiesen und per `grep` belegt, dass **kein** Test etwas davon behauptet — statt
  Häkchen für nicht vorhandene Strecken zu setzen.
- **ADR-028s Grenze:** keine Beschönigung gefunden. Die Fälschungs-Fixtures liefern unter `'infer'`
  weiterhin messbar `journal_report`, und Kommentar wie Test benennen das.

Sechs Kriterien erfüllt, zwei teilweise mit benannter Reichweite, eines (`JR-5-07`) mit einem **neuen
Befund**. Bemerkenswert an ihrer Arbeit ist ein Schritt, der selten vorkommt: Ihre erste
Quoted-Printable-Sonde schlug an, und sie hat **das eigene Werkzeug** geprüft, nicht den Parser
beschuldigt — das Fixture enthielt einen QP-Soft-Linebreak, der zwei Zeilen verschmolz. Ein Fehlalarm,
den sie selbst abgefangen hat.

### F43 — Whitespace in einer konfigurierten Domain landete in der Eigentümeradresse

Vergeben 2026-08-02 (PO), gefunden von `JR-5-09`. Der Vergleich lief über `normalizedConfiguredDomain()`
(trimmt), die **Ausgabe** benutzte die rohe Zeichenkette. Ein versehentliches Leerzeichen in
`organizationDomains` passte damit weiterhin — und wanderte in die Adresse. Nachgemessen, und in einem
Punkt schlimmer als gemeldet:

```
'company.com '   -> "alice@company.com "            Whitespace am Ende
' company.com'   -> "alice@ company.com"            Whitespace MITTEN in der Adresse
'company.com\t'  -> "alice@company.com\t"
```

Eine solche Adresse ist nie zustellbar und vergleicht sich mit nichts — und sie wäre nach E6 in
`archived_emails.userEmail` gelandet. **Behoben** an beiden Ausgabestellen (Treffer- und Fallback-Pfad),
mit acht Regressionstests.

**Zwei Dinge sind dabei bewusst _nicht_ passiert.** Die **Groß-/Kleinschreibung** wird weiter erhalten —
das ist entworfen, nicht versehentlich, und Trimmen ist eine andere Frage als Kleinschreiben; ein Test
hält beides zugleich fest (`' Company.COM '` ⇒ `alice@Company.COM`). Und ein `main`, der **gar keine
Domain** ist (`'admin@company.com'` ⇒ `default_fallback@admin@company.com`, zwei `@`), wird **nicht
repariert**: zu raten, welche Hälfte der Betreiber meinte, wäre genau der verbotene Zug — aus einer
kaputten Eingabe einen Wert erfinden. Ein Test hält diese Grenze fest, statt sie später entdecken zu
lassen. Sie gehört in die Konfigurationsprüfung im Backend, zusammen mit der doppelt konfigurierten
Domain aus `JR-5-07`.

### Zwei Abdeckungslücken, bewusst offen

`Recipient:` mit spitzen Klammern und eine semikolongetrennte `Recipient:`-Liste werden nicht
normalisiert. Beides sind **Lücken, keine Defekte**: Sie hängen an der Annahme, Exchange schreibe eine
nackte Adresse pro Zeile — und die ist ohne echtes Exchange-Sample nicht überprüfbar. **Die Prüferin hat
das ausdrücklich als unverifiziert gemeldet, statt eine Exchange-Struktur plausibel zu erfinden.** Das
war die Vorgabe, und sie ist der Grund, warum diese beiden Lücken hier stehen und nicht als geprüft
gelten.

### Zahlen

| Stand                         | Volllauf                                            |
| ----------------------------- | --------------------------------------------------- |
| Basis `9725a5d` (vor E5)      | 40 Dateien, `486 passed \| 3 skipped`, unit 371/371 |
| nach `JR-5-01`/`JR-5-02`      | 43 Dateien, `525 passed \| 3 skipped`, unit 410/410 |
| nach der Review-Nacharbeit    | 43 Dateien, `540 passed \| 3 skipped`, unit 425/425 |
| nach dem Rebase auf `d201612` | 45 Dateien, `559 passed \| 5 skipped`, unit 425/425 |
| nach `JR-5-03`/`JR-5-04`      | 45 Dateien, `582 passed \| 5 skipped`, unit 448/448 |
| nach `JR-5-05`/`JR-5-06`      | 45 Dateien, `602 passed \| 5 skipped`, unit 468/468 |
| nach `JR-5-07`                | 46 Dateien, `625 passed \| 5 skipped`, unit 491/491 |
| `JR-5-08` Korpus, 3 rot       | 47 Dateien, `633 passed \| 3 failed`, unit 502/502  |
| nach der Reparatur (S6)       | 47 Dateien, `638 passed \| 5 skipped`, unit 504/504 |
| nach `JR-5-09` + F43          | 47 Dateien, `646 passed \| 5 skipped`, unit 512/512 |

Bis zur Review-Nacharbeit jeweils `integration 97/97 · adversarial 18/18`, nach dem Rebase
`integration 97/97 · adversarial 37/37` (E3s zwei adversariale Dateien kamen mit), Exit 0. Die `398 passed | 2 skipped` bei 30 Dateien
aus dem E2-Handover sind **überholt** — die Differenz zur Basis sind E3s zehn Dateien.

### Drei Punkte für den Auftraggeber

0. ~~**Der Integrationsbranch ist lint-rot in E3s Gebiet**~~ — **erledigt**.
   `packages/journaling/src/spool/acceptance.ts` hat Session A beim E3-Abschluss selbst formatiert.
   Nach dem Rebase auf `d201612` ist `pnpm lint` repo-weit grün. Session B hat die Datei nie
   angefasst (fremdes Gebiet, `12-parallelbetrieb.md` §5) — die Meldung hat gereicht.
1. **`pnpm test` ist nicht in `dotenv --` gewickelt** (`package.json:28`), anders als `CLAUDE.md` §4
   für alle Root-Skripte behauptet. Ohne exportiertes `DATABASE_URL` überspringt die gesamte
   `integration`-Suite sichtbar, aber der Lauf sieht unverdächtig aus. **Aufgenommen als F42**
   (2026-08-02, PO) — nach E3s **F40** und **F41** war das die nächste freie Nummer. Behoben wird er
   nicht in E5: `package.json` ist gemeinsames Gebiet, und ein Griff hinein während E3s Abschluss wäre
   genau der Konflikt, den `12-parallelbetrieb.md` §3.2 vermeiden will.
2. ~~**Die ADR-Nummer 027 könnte kollidieren**~~ — **gegengeprüft, sie tut es nicht**. Session A hat
   im gesamten E3-Abschluss keine ADR geschrieben; ADR-027 ist nach dem Rebase die einzige mit dieser
   Nummer.

---

## E3 – E12 (offen)

Tasklisten stehen in `03-backlog.md`. Sie werden hier erst beim Beginn des jeweiligen Epics
ausgerollt, um diese Datei lesbar zu halten.

Offene ADRs, die vor bzw. während der Epics zu entscheiden sind:

| ADR         | Thema                                                                                                                                                                                                                                                                                                                                         | Epic                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| ADR-016     | fail-closed rechtfertigt den Verhaltensbruch aus F7                                                                                                                                                                                                                                                                                           | E13 (`JR-13-07`)       |
| ~~ADR-006~~ | **Entschieden 2026-07-31 (`JR-2-03`): 16 gehashte Felder statt der acht aus RFC §5.2, Genesis mit `deployment_id` und `chain_scope_id` als UUID-Textform, `deployment_identity`-Tabelle, Merkle nach RFC 6962**                                                                                                                               | E2 (`JR-2-03`)         |
| ~~ADR-007~~ | **Entschieden 2026-07-31: eine Kette je Mandant, `chain_scope_id` = `ingestion_sources.id`**                                                                                                                                                                                                                                                  | E2                     |
| ~~ADR-022~~ | **Entschieden 2026-07-31: Ankerform ist ein Merkle-Aggregat über alle Kettenköpfe, ein Token je Lauf.** Folgt aus ADR-007 Konsequenz 4; die Baumkodierung ist nach ADR-006/`JR-2-03` vorgezogen                                                                                                                                               | E8, vorgezogen nach E2 |
| ~~ADR-023~~ | **Entschieden 2026-07-31: TSA-Auswahl.** Kein Standard-URL; qualifizierte eIDAS-TSA in der Produktion mit GoBD-Anspruch, `open-tsa.eu` sonst und in `nightly`, `ci` hermetisch                                                                                                                                                                | E8                     |
| ADR-009     | Append-Only-Erzwingung: Rechteentzug oder Trigger                                                                                                                                                                                                                                                                                             | E2 (`JR-2-05`)         |
| ADR-010     | `processEmail` erweitern oder eigener Journaling-Pfad                                                                                                                                                                                                                                                                                         | E6 (`JR-6-02`)         |
| ADR-008     | TSA-Ausfallverhalten bestätigen                                                                                                                                                                                                                                                                                                               | E8 (`JR-8-04`)         |
| ADR-012     | Migrationspfad für Bestandsinstallationen                                                                                                                                                                                                                                                                                                     | E12                    |
| ~~ADR-024~~ | **Entschieden 2026-08-02: ein vollständig getrennter Stack je Endkunde**, geteilter Postgres-Server als dokumentierte Dichteoption. **Betriebsverantwortung mitentschieden: Phase 1 betreibt der Endkunde selbst, in Phase 2 bietet der Auftraggeber den Betrieb zusätzlich als Dienst an.** Neu offen daraus: das Haftungsprofil für Phase 2 | erledigt vor E4        |

---

## Sessionprotokoll

| Datum           | Ergebnis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Nächster Schritt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 2026-07-27      | E0 abgeschlossen: Gap-Analyse, Architektur, Backlog (102 Tasks), Testplan, ADR-Log, `CLAUDE.md`, 2 Subagents, 3 Skills. Kein Produktionscode (ADR-001).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | E1 starten mit `JR-1-01`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-07-27      | Nachtrag: ADR-004 als falsch korrigiert und Veröffentlichungs-Leck via `srcExclude` geschlossen; ADR-014 (Branch-Strategie) ergänzt; `CLAUDE.md` §7 und Handover um Sessionstart-Anleitung erweitert. Build-Nachweis offen (kein `pnpm install` möglich).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `claude/journaling-e1-test-foundation` abzweigen, dann `JR-1-01`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-07-27      | `JR-1-05a` erledigt auf `claude/journaling-e1-test-foundation`: 7 handgeschriebene Dateien formatiert, 6 generierte per ADR-015 in `.prettierignore`. `pnpm lint` repo-weit grün und bleibt es nach beiden Generatorläufen. Kein Push (sammelt bis Ende E1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `JR-1-01` (vitest einrichten), danach `JR-1-05` (CI-Workflow)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-07-27      | `JR-1-01`/`JR-1-02`/`JR-1-03` erledigt: vitest 3.2 mit drei Projects (`unit`/`integration`/`adversarial`), Harness in `tests/support/` (Klassifizierung, Seeds, Infra-Probe, Coverage-Hinweise), 146 Testfälle grün, Exit-Code beider Richtungen aktiv verifiziert, Fixture-Ladung durch Umbenennen belegt. Sechs IAM-Befunde (F1–F6) an DEV gemeldet, keiner behoben. Kein Push.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `JR-1-04` (isolierte Postgres-Basis), danach `JR-1-05` (CI-Workflow)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-07-28      | `JR-1-04` **geschrieben, Abnahme offen**: `pg-harness` mit eigener Datenbank je Aufruf (Schema-Isolation scheitert an `"public"`-qualifizierten Migrationen), Migrationen über `drizzle-orm/postgres-js/migrator`, garantiertes Teardown plus Sweeper. Lokaler PostgreSQL-16.13-Cluster aus den vorinstallierten Binaries gestartet: 32 Integrationstests grün, `pnpm test` 181 grün, zwei parallele Läufe gleichzeitig grün, 0 Rückstände. Vier neue Befunde F7–F10 (F7 hoch: `FilterBuilder` fail-open) plus F4-Nachtrag. Kein Push.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `JR-1-05` (CI-Workflow mit `postgres:17-alpine`), danach `JR-1-06` (Abnahme E1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-07-28      | `JR-1-05` **erledigt, CI-Lauf grün**: `.github/workflows/ci.yml` (Job `verify`, Trigger `pull_request` + `push`, Node 22 / pnpm 10.13.1 aus `engines`/`packageManager`, pnpm-Store gecacht), reiner Prüf-Workflow (kein `format`, kein Auto-Fix, kein Commit, Log nach `$RUNNER_TEMP`, `permissions: contents: read`), `postgres:17-alpine` als Service-Container, zwei Nachlaufprüfungen (übersprungene `integration`-Suite und `oa_test_*`-Rückstände machen den Job rot; beide in beide Richtungen gegengeprüft). Lauf 1 fand **F11**: die vorgegebene Schrittfolge ist auf einem frischen Checkout nicht lauffähig, weil `@open-archiver/types` über das gitignorierte `dist` auflöst — 54 × `TS2307`. Behoben durch einen vorgeschalteten `pnpm --filter @open-archiver/types build`; lokal beidseitig reproduziert. Lauf 3 (`1bad10c`) grün: PostgreSQL 17.10, 181 Tests, `integration` sichtbar gelaufen, 0 Rückstände. Bestehende vier Workflows unverändert.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `JR-1-06` (Abnahme E1): `JR-1-04` und `JR-1-05` vorlegen — deren CI-Bedingung ist erfüllt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-07-28      | `JR-1-06` (Abnahme E1) **durchgeführt, Ergebnis: E1 nicht abgenommen.** 15 Kriterien einzeln gegen `03-backlog.md` geprüft, 14 erfüllt: `JR-1-01`, `JR-1-02`, `JR-1-03`, `JR-1-05a` und `JR-1-05` abgenommen. `JR-1-04` **abgelehnt** — neuer Befund **F12**: der Test `sweeps a stale database…` legt seine Fixture-DB unter dem festen Namen `oa_test_1609459200000_999999_deadaa_sweeptest` an, zwei gleichzeitige Läufe gegen dasselbe Postgres kollidieren daher reproduzierbar (4/4) mit `duplicate key … pg_database_datname_index`; der bisherige Nachweis „zwei Läufe gleichzeitig grün" ist widerlegt. CI unberührt (eigener Service-Container je Job) und weiterhin grün. Zusätzlich belegt: die grün aussehende Fehlerform ohne `DATABASE_URL` (Exit 0 bei „149 passed \| 34 skipped") wird von Nachlaufprüfung 1 in allen drei Nichtverfügbarkeits-Modi rot gemacht, legitime `nightly`/`manual`-Skips lösen sie nicht aus; zwei Lücken derselben Prüfung gefunden (abwesende statt übersprungene Suite; falsch benannte `*.test.ts` unter `tests/integration/` wird von keinem Project eingesammelt). Kein Produktionscode geändert, kein Befund behoben. Dokumentenhygiene: **F11 nach `09-befunde-bestandscode.md` verschoben**, F-Nummerierung liegt jetzt in einer Datei.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Entscheidung des Auftraggebers zu **F12**; danach Nacharbeit `JR-1-04`, erneute Teilabnahme, dann `JR-13-01`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-07-28      | `JR-1-04a` und `JR-1-05b` **erledigt** (Nacharbeit aus der Ablehnung von E1). **F12 behoben**, dreiteilig: prozessspezifische Fixture-Namen über `buildForeignFixtureName()`, `sweepStaleHarnessDatabases({ staleMs, restrictTo })` mit SQL-seitiger Einschränkung und konstruktiver Verweigerung eines gesenkten Schwellwerts ohne `restrictTo`, plus Fixture-Alter unter die Standardfrist gezogen (der 2021er Zeitstempel war ein drittes, in der Abnahme nicht genanntes Teilproblem). Reproduktion vorher 3/3 rot, dabei der bis dahin nur hergeleitete zweite Pfad **beobachtet** (ein Lauf verlor seine eigene Datenbank an den Sweeper des anderen). Nachher: **5 Doppelläufe grün**, plus 3 Tripel- und 3 versetzte Runden, 0 Rückstände, keine Runde unsauber. `JR-1-05b`: beide Lücken der CI-Nachlaufprüfung mit **positiven** Erwartungen geschlossen — `tests/support/suite-inventory.ts` als einzige Quelle der Include-Globs prüft in `globalSetup` Mindestdateizahlen je Suite und verbietet testartig benannte Dateien ohne Project; `OA_TEST_REQUIRE_INFRA=1` macht fehlende Infrastruktur in der CI zum Fehlschlag statt zum Skip; die Log-Suche ist ersetzt durch eine Report-Datei, deren Fehlen den Job rot macht. Beide Richtungen und alle vier Proben belegt und zurückgebaut. Neuer Befund **F13** (verbleibende Sweeper-Lücke bei Läufen > 2 h, für die E2/E3-Soaks relevant), kein Produktionscode berührt, F1–F11 unangetastet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **`JR-1-06a`** (erneute Abnahme E1) — muss unabhängig von dieser Session laufen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-07-28      | `JR-1-06a` (erneute Abnahme E1) **durchgeführt, Ergebnis: E1 abgenommen.** HEAD `0a94308` zuerst gegen `origin` abgeglichen (identisch — kein Container-Rollback). Alle 20 Kriterien einzeln geprüft und alle erfüllt, keines übernommen: `pnpm test` ⇒ `10 passed`, `197 passed \| 2 skipped`, Exit `0`; Sonden in `packages/types/` und `packages/frontend/` ohne Config-Änderung eingesammelt, dieselbe Sonde fehlschlagend ⇒ Exit `1`; **F12 bestätigt behoben** über 10 nebenläufige Runden (5 Doppel-, 3 versetzte, 2 Dreifachläufe), alle Teilläufe Exit `0`, 0 Rückstände; alle acht IAM-Fixtures einzeln umbenannt ⇒ jedes Mal Exit `1`; CI-Run **30368442950** auf HEAD grün, 14/14 Schritte `success`, `starting PostgreSQL 17.10`, alle vier `integration`-Dateien mit `✓` und Testzahlen, `Suite inventory verified: … integration 4/4`, „No `oa_test_*` databases left behind."; vier Bestandsworkflows blob-identisch in Merge-Base/HEAD/Worktree; genau **ein** `permissions: contents: read` ohne Job-Override; `pnpm lint` grün, erzwungener `pnpm db:generate` (⇒ `0041_whole_sally_floyd.sql`) lässt ihn grün; Produktionscode unberührt (echter Pre-E1-Build vs. HEAD-Build: **233** `dist`-Dateien, Listen identisch, 1 Datei nur im Zeilenumbruch verschieden, md5 nach Whitespace-Strip gleich); `JR-1-05b` beidseitig belegt, zusätzlich der von der alten Prüfung nicht erfasste **Lösch**-Fall; `00-rfc.md` seit `6d6564c` unverändert, `srcExclude: ['dev/**']` intakt. **Neun Angriffe auf die neue Inventurprüfung**, sechs hielten, drei nicht ⇒ neue Befunde **F14** (Datei- statt Testebene: `ci` → `nightly` schaltet die Suite ab und bleibt grün), **F15** (`minimumFiles`-Spiel verdeckt eine Löschung), **F16** (Rückstand nach Modul-Throw lokal nicht angekündigt) — keiner bricht ein Kriterium, alle drei nach `JR-13-05`. Die lazy-Guard-Fehlerklasse ist geschlossen (`OA_TEST_REQUIRE_INFRA=yes` bricht auch bei laufender DB ab). **F13** nachgeprüft und als schwach bestätigt: die Zwischenregel steht in keiner Backlog-Zeile von `JR-2-08`/`JR-6-07`/`JR-4-10` und nicht in §12.6, und es gibt keine Laufzeitprüfung. Kein Produktionscode geändert, kein Befund behoben, kein Rückmerge, kein PR angefasst; PostgreSQL-16.13-Cluster restlos entfernt (Versionslücke zur CI-17.10 bleibt bestehen und ist benannt).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `JR-13-01` (E13, Branch `claude/journaling-e13-iam-hardening`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-07-28      | **Rückmerge E1 in den Integrationsbranch** (`efb769c`, `--no-ff`, gepusht als `b4ae8f7`). ADR-014 gibt ihn nach unabhängiger Abnahme frei; `main` bleibt bis E12 unangetastet. **Kein Squash** — die aufgeräumte Sicht liefert bereits `git log --first-parent` (ein Merge-Commit je Epic), und ein Squash würde die dokumentierte Ablehnung von E1 (`cab0e38`) sowie die beweisbare Formatierungs-Reinheit von `JR-1-05a` (ADR-015) vernichten. Zusätzlich: **`JR-1-05c`** für F14–F16 angelegt (fällig vor E2; der Wächter zählt Dateien statt ausgeführter Tests), die **F13-Zwischenregel** in die Akzeptanzkriterien von `JR-2-08`/`JR-6-07` übernommen, und der falsche Verweis „F14–F16 → `JR-13-05`" korrigiert (`JR-13-05` ist E13s Task für F8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `JR-13-01` (E13) auf `claude/journaling-e13-iam-hardening`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-07-29      | **ADR-017 entschieden (Auftraggeber): Variante B.** `SearchService.ts:311`/`:423` bauen den Filter künftig für `('archive','search')` — dieselbe (Action, Subject), unter der `requirePermission` den Request durchlässt; `search.routes.ts` bleibt unverändert. `JR-13-03` ist damit von Entscheidung auf Umsetzung geschärft (Datei und Zeilen im Backlog benannt), `JR-13-02` freigegeben. Variante A verworfen (entwertet die Action `search`, die `predefined_read_only_user` getrennt erteilt), Variante C verworfen für E13 und als **`JR-13-10`** danach vorgemerkt — nicht Teil von `JR-13-09`. Am Code nachgeprüft und in ADR-017 belegt: **keine der drei `predefined_*`-Rollen trifft den `null`-Zweig in `FilterBuilder.ts:49`**, eine Standardinstallation verhält sich vor und nach dem F7-Fix gleich; damit ist die frühere PO-Aussage „der Fix bricht Bestandsinstallationen" korrigiert und `JR-13-07` entsprechend entschärft. Erreichbar bleibt der Zweig über Nutzer ohne Rolle, `cannot`-only-Policies auf `archive` und handgeschriebene Rollen mit `search` ohne `read` — **F7 bleibt Schwere hoch.** ADR-016 bleibt für `JR-13-07` reserviert, die Nummernlücke ist Absicht. Nur Dokumentation, kein Produktionscode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `JR-13-01` (E13) auf `claude/journaling-e13-iam-hardening`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-07-29      | **`JR-13-01` erledigt (Rolle `tester`) — der Epic-Branch ist absichtlich rot.** Die F1/F3/F7/F8-Tests, die den Defekt als _bestanden_ festhielten (inkl. `it.fails`), sind zu Regressionstests umgebaut, die den gewünschten Zustand fordern: **21 rote Tests**, `pnpm test` ⇒ `6 failed \| 10 passed` Dateien, `21 failed \| 203 passed \| 2 skipped`, Exit `1` (Ausgangsstand `efea6bc`: `197 passed`, Exit `0`). Jeder rote Test trägt `RED UNTIL JR-13xx` im Namen und ist einer DEV-Task zugeordnet (1302: 5, 1303: 1, 1304: 7, 1305: 3, 1306: 5). **Kein Opt-out-Schalter** — ein `it.skip`/`it.fails` oder eine Env-Variable wäre ein Hebel, das Epic fertig aussehen zu lassen; vitest isoliert ohnehin je Fall. Vier neue Testdateien plus zwei Support-Dateien, `minimumFiles` bewusst auf den neuen Bestand (unit 5→7, integration 4→8, F14/F15 beachtet). **ADR-017s Wirkungsanalyse hält:** die drei `predefined_*`-Rollen werden über Produktionscode angelegt, keine trifft an einer der drei Aufrufstellen den `null`-Zweig, und `('archive','read')` und `('archive','search')` liefern je Rolle identische Ergebnisse — `JR-13-03` ist für eine Standardinstallation belegbar wirkungsfrei. **Sieben neue Befunde F17–F23**, davon zwei mit Gewicht: **F17** (zwei der drei „ausgelieferten" Rollen werden nie angelegt, weil `createAdminRole()` den Bootstrap-Auslöser dauerhaft erfüllt ⇒ es gibt ausgeliefert keine Read-Only-Rolle, F7s praktische Schwere steigt) und **F18** (ADR-017s Aussage gilt je Aufrufstelle, nicht je Rolle: 39 bzw. 46 von 56 Paaren treffen den Zweig). F1s Ausnutzbarkeit ist erstmals **gegen echtes Postgres** belegt — von vier Payloads läuft genau einer, und er hebt über drizzles unklammerte `and()`-Verkettung auch die Einschränkung des Aufrufers auf. Kein Produktionscode geändert (`git diff` gegen `src` ohne Tests ist leer), `pnpm lint` grün, `test:types` grün, Backend-Build grün, 0 Datenbank-Rückstände, PostgreSQL-16.13-Cluster restlos entfernt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `JR-13-03`, dann `JR-13-02`/`JR-13-04`/`JR-13-05`/`JR-13-06` (Rolle DEV) — die roten Tests sind die Abnahme                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-07-29      | **Befunde aus `JR-13-01` durch den PO abgearbeitet, damit DEV nicht auf Entscheidungen wartet.** Zwei Aussagen von ADR-017 waren zu weit gefasst und sind per **Nachtrag** korrigiert: sie gelten **je Aufrufstelle, nicht je Rolle** (F18 — über das volle Vokabular treffen 39 bzw. 46 von 56 Paaren den `null`-Zweig), und „ausgeliefert" trifft auf zwei der drei Rollen gar nicht zu (F17). Die **Entscheidung Variante B bleibt** und ist durch `predefined-roles.int.test.ts` jetzt belegt statt hergeleitet. **F17 am Code nachgeprüft und bestätigt** (`createFirstAdmin` → `createAdminRole()` legt `predefined_super_admin` an, `getRoles` liegt hinter `requireAuth`): **F7s praktische Schwere steigt** — ausgeliefert existiert keine Read-Only-Rolle, jeder eingeschränkte Nutzer ist eine handgeschriebene Policy in der Form, die F7 unwirksam macht. **F21 entschieden: strenge Allowlist** — abgewiesen wird jeder unbekannte Key, nicht nur einer mit SQL-Syntax; die drei betroffenen grünen Pins werden im selben Commit wie der Fix invertiert (die einzige Stelle in E13, an der ein grüner Test bewusst umgedreht wird). **F22** eingearbeitet: `JR-13-04`s Kriterium lautet jetzt „kein Zweig wird stillschweigend weggelassen", mit der richtigen Gefahrenrichtung (`$and` und leere Zweigliste, nicht `$or`). **F17(a)** in `JR-13-07` aufgenommen. Offen beim Auftraggeber bleibt allein **F17(b)** — Rollen-Bootstrap reparieren? Produktentscheidung, nicht E13, blockiert nichts. Nur Dokumentation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `JR-13-03`, dann `JR-13-02`/`JR-13-04`/`JR-13-05`/`JR-13-06` (Rolle DEV)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-07-29      | **`JR-13-03`, `JR-13-02`, `JR-13-04`, `JR-13-05`, `JR-13-06` erledigt (Rolle `senior-dev`).** Produktionscode in vier Dateien, sonst nichts: `SearchService.ts` (ADR-017 B, Zeilen 311/423 auf `'search'`), `FilterBuilder.ts` (`null` ⇒ deny, unbedingtes `cannot` ⇒ deny (F20), `undefined` vom Übersetzer ⇒ deny (F19), `cannot`-Ausschluss über `$not` statt `$ne` (F8)), `mongoToDrizzle.ts` (unübersetzbare Bedingungen werfen, Key-Allowlist, `sql.raw` entfernt), `policy-validator.ts` (Condition-Keys werden beim Anlegen geprüft, rekursiv auch in `$or`/`$and`/`$not`). Keine Migration, kein i18n-Key, `mongoToMeli.ts` unberührt. **20 von 21 roten Tests grün, 0 Regressionen** — maschinell belegt über zwei `--reporter=json`-Läufe und einen Statusdiff je Testname, nicht durch Zählen. Der eine verbleibende rote Test war **kein fehlender Fix**, sondern ein Widerspruch zwischen zwei `JR-13-01`-Erwartungen mit demselben `RED UNTIL`-Tag; DEV hat ihn korrekt **nicht** angefasst und vorgelegt. Zwei benannte Abweichungen: die Key-Allowlist prüft Form und Relation statt Spaltenexistenz (⇒ ADR-019, `JR-13-11`), und ein gefilterter `-t`-Lauf hinterlässt Testdatenbanken (⇒ **F24**, nach `JR-1-05c`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Testwiderspruch entscheiden, dann `JR-13-07`/`JR-13-08`, dann Abnahme `JR-13-09`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-07-29      | **Testwiderspruch entschieden (ADR-018) und aufgelöst — E13s Suite ist grün: `224 passed \| 2 skipped`, Exit 0.** Entscheidung des PO: die Unit-Erwartung gilt, ein unübersetzbarer Zweig wird **verweigert** statt durch ein never-true-Prädikat je Zweig ersetzt — dieses kippt unter `$not` zu `not(false)` = wahr und verliert ein Verbot. Der Tester hat alle drei Begründungen **nachgemessen statt übernommen** und eine davon verstärkt: die beiden Erwartungen sind unter **jeder** Implementierung unvereinbar, weil keine prinzipielle Regel `{id:'a'}` anders behandelt als `{userEmail:…}`. Korrektur in `704e8d1`, **in beide Richtungen mutationsgeprüft**. **Dabei eine eigene Aussage des PO korrigiert:** „im `$or` nur verengend" (F22) gilt nur oben in einer `can`-Komposition — unter dem `$not`, wohin `FilterBuilder.ts:84` jede `cannot`-Bedingung setzt, ist derselbe Wegfall **fail-open**. `JR-13-04`s Kriterium und F22 sind entsprechend berichtigt. Neu: **ADR-018**, **ADR-019**, **`JR-13-11`**, **F24**. **E13 ist damit implementiert, aber nicht abgenommen** — `JR-13-07`, `JR-13-08`, `JR-13-09` stehen aus, `JR-13-09` muss in einer eigenen Session laufen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `JR-13-07` (Betreiberdoku + ADR-016) und `JR-13-08` (Upstream-Entwurf), dann `JR-13-09`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-07-29      | **`JR-13-07` erledigt (Rolle `senior-dev`): ADR-016 plus Betreiberdoku.** ADR-016 ersetzt den Platzhalter und begründet den Bruch nicht mit „Sicherheit geht vor", sondern damit, dass „kein Recht auf dieses Subject" und „darf alles sehen" vom **selben Wert** dargestellt wurden und der unsichere der Default war — ein Zustand ohne belegbare Zugriffsaussage über das Archiv. Verworfen: Verhalten beibehalten und nur dokumentieren (auch als Schalter), weil **E11s Auditor-Rolle auf genau diesem Mechanismus aufsetzt**. Die Betreiberdoku ist neu in `docs/user-guides/upgrade-and-migration/access-control-changes.md` (englisch, ADR-003, in der Sidebar verlinkt): sieben benannte Verhaltensänderungen, F17 („ausgeliefert existiert nur die Super-Admin-Rolle — eine fehlende Read-Only-Rolle ist kein Fehler der Installation"), der ADR-019-Restspalt als eigener Abschnitt „What is still not checked", **keine** Pauschalwarnung. Herzstück sind drei SQL-Abfragen gegen `roles.policies`, `users` und `user_roles`, **gegen echtes Postgres 16.13 ausgeführt** — aus der Markdown-Datei extrahiert und wörtlich gelaufen: 10 von 10 absichtlich betroffenen Rollen gemeldet, die drei `predefined_*` und die Gegenprobe in **keiner** Ausgabe, sieben Randfälle ohne Fehler und ohne Falschtreffer. `iam-policy.md` hat zwei neue Abschnitte („Condition Keys", „When No Rule Applies"), weil dort die geänderte Semantik nachgeschlagen wird. **Kein Produktionscode, keine Teständerung, keine Migration, kein i18n-Key.** `pnpm lint` grün, `pnpm docs:build` grün, `docs/.vitepress/dist/dev/` existiert weiterhin nicht, `pnpm test` `224 passed \| 2 skipped`, Exit 0. Gemeldet, nicht behoben: `iam-policy.md` führt die Action `export` weiterhin nicht und beschreibt `manage` falsch (`CLAUDE.md` §5.4, stale Stelle (3)) — Vorschlag: eigene Doku-Task.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-07-29      | **`JR-13-08` erledigt (Rolle PO): Upstream-Entwurf liegt in `10-upstream-meldung.md`, nicht versendet und nicht veröffentlicht.** Englischer Meldetext (vier Befunde: fail-open bei fehlender `can`-Regel samt F19/F20, Injection über Condition-Keys mit der einen funktionierenden Nutzlast, stilles Verwerfen unübersetzbarer Bedingungen samt Richtungskorrektur aus F22, wirkungsloser `cannot`-Ausschluss bei Operator-Bedingungen) plus F17 als getrennter Bug, dazu eine deutsche Entscheidungsvorlage: **Kanal** (keine `SECURITY.md` im Upstream ⇒ privates GitHub Security Advisory, **kein** öffentliches Issue), **Zeitpunkt**, **Absender/CVE**, und ob die Nutzlast bei einer öffentlichen Meldung entfernt wird. F2/F4/F5/F6/F9/F10 bewusst **nicht** enthalten — offen dokumentiert, in diesem Fork nicht behoben, eine Meldung ohne Fix und ohne eigene Prüfung wäre dünn. Die Datei liegt unter `docs/dev/journaling/` und ist damit über `srcExclude` unpubliziert; das ist Bedingung, weil sie eine funktionierende Injection gegen eine **nicht behobene** veröffentlichte Version enthält. **Kein Agent versendet sie.** Zusätzlich **`JR-13-12`** angelegt für die veraltete IAM-Doku (`export` fehlt, `manage` falsch beschrieben — die dritte Stelle aus `CLAUDE.md` §5.4): reine Doku, gehört auf den Integrationsbranch **nach** dem Rückmerge, ausdrücklich nicht in `JR-13-07` mitgenommen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `JR-13-09` — unabhängige Abnahme E13 in **eigener** Session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-07-29      | **`JR-13-09` (Abnahme E13) durchgeführt, Ergebnis: E13 nicht abgenommen.** HEAD `54536cd` zuerst gegen `origin` abgeglichen (identisch — kein Rollback). 21 Kriterien einzeln geprüft: **17 erfüllt**, 1 teilweise (Meili-Hälfte von `JR-13-05` strukturell, keine Engine vorhanden), 1 bewusst nicht erfüllt und durch ADR-019 gedeckt, **2 nicht erfüllt**. **`JR-13-01`s Kernkriterium unabhängig belegt statt übernommen:** Produktionscode in einer Wegwerf-Kopie auf `efea6bc` zurückgedreht ⇒ `23 failed \| 201 passed`, HEAD ⇒ `224 passed \| 2 skipped`; zusätzlich vier **Einzelreverts**, die jeden Fix einzeln als tragend zeigen (`mongoToDrizzle` 11 rot, `FilterBuilder` 8, `policy-validator` 2, `SearchService` 1); Statusdiff `8984ce9` ⇄ HEAD je `fullName`: rot⇒grün 21, grün⇒nicht-grün **0**. **Suite wirklich vollständig:** 16 Dateien, 226 Fälle, die 2 Skips sind aus dem JSON-Report als genau die `[nightly]`/`[manual]`-Suiten identifiziert, alle 8 `integration`-Dateien mit Fallzahlen gelaufen, `minimumFiles` ohne Spiel — plus CI-Run **30456242256** auf **PostgreSQL 17.10** mit demselben Ergebnis, womit die Versionslücke für die Suite geschlossen ist. **`predefined-roles.int.test.ts` ist kein Tautologie-Test** (zwei Produktionscode-Mutationen ⇒ 4/7 bzw. 6/7 rot, „green but empty test"-Falle greift). **Injektionsweg zu:** 12 Nutzlasten inkl. NUL-Byte, Newline, Fullwidth-Homoglyph und Relationszweig, drei Gates, Legacy-Rolle direkt in die DB geschrieben ⇒ jedes Mal Deny, **0** fremde Zeilen. **F7 fail-closed auf Zeilenebene** für `auditor-specific-mailbox.json` (Fixture von der Platte) und den Nutzer ohne Rolle, `read` **und** `search`. **F2/F4/F5/F6/F9/F10 unverändert:** F2/F9/F10-Dateien blob-identisch, F4/F5/F6 pre-gegen-post identisch gemessen. Öffentliche Doku ohne interne IDs, ohne Compliance-Behauptung, ohne Nutzlast; `10-upstream-meldung.md` nicht gebaut und **nicht im Suchindex** (49 indexierte Seiten, kein Pfad unter `dev/`). `main` = `a560b8c`, kein E13-Commit darin, kein Rückmerge, **kein** neuer PR. **Fünf neue Befunde: `F25`** (die Statusaussage „F4 **und F5** sind im Code kommentiert" ist für F5 falsch), **`F26`** (`can` mit falsy `conditions` ⇒ weiter Vollzugriff; kein Regress), **`F27`** (Query 2 falsch-negativ für skalares/Array-`conditions` — `conditions: 5` war vorher **unbeschränkt**), **`F28`** (Query 3 prüft `subject: "all"` nicht), **`F29`** (Validator und Übersetzer uneins über die Key-Form; die veröffentlichte Doku behauptet die strengere Variante). Kein Produktionscode, kein Test, keine öffentliche Doku geändert; Cluster, Wegwerf-Kopien und Prüfdatenbank restlos entfernt, 0 `oa_test_*`-Rückstände.                                                                                                                                                 | Nacharbeit F29 → F27 → F28 → F25 (F26: PO entscheidet), dann **`JR-13-09a`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-07-29      | **PO-Entscheidungen zur `JR-13-09`-Ablehnung — die Nacharbeit ist geschnitten, nichts wartet mehr auf mich.** Die Ablehnung ist berechtigt und beide Kernbefunde am Code nachgeprüft: **F29** — der Validator prüft nur die _Form_ der Key-Segmente, der Übersetzer zusätzlich die _Auflösbarkeit_ der Relation, also speichert `foo.bar` mit `200` und scheitert erst zur Abfragezeit, während die veröffentlichte Doku „Saving … fails with HTTP `400`" behauptet. **F27** — eine Policy-Form, die von „sieht alles" auf „sieht nichts" umschlägt, wird von **keiner** der drei Betreiber-Abfragen gefunden. Entscheidungen: (1) **F29 wird streng gelöst**, nicht durch Abschwächen der Doku — ein Key, der beim Speichern auffällt, ist für einen Betreiber strikt besser als einer, der zur Abfragezeit auffällt, und `JR-13-06`s Kriterium fordert es. Das Prädikat kommt aus **einer** Quelle, die Validator und Übersetzer gemeinsam nutzen. (2) Zur Frage des Testers „Abfragen erweitern **oder** Absolutsatz entschärfen": **beides** — nur entschärfen lässt den Betreiber ohne brauchbare Prüfung, nur erweitern erzeugt denselben Fehler eine Runde später, weil eine Abfrage über beliebiges JSONB gegen künftige Formen nie beweisbar vollständig ist. (3) **F26 zur Hälfte vorgezogen**: die Formprüfung von `conditions` selbst wandert in `JR-13-13` (Objekt oder nicht vorhanden; Skalar, Array, `null` werden abgewiesen), weil sie sich die Ursache mit F27 teilt; das Laufzeitverhalten für **bereits gespeicherte** solche Policies bleibt bei `JR-13-11`, sonst wäre es ein Regress-Risiko ohne Not. (4) Neu **`JR-13-16`**: die Betreiber-SQL bekommt einen Regressionstest gegen dieselben Fixtures wie der Code — sie war das **einzige** sicherheitsrelevante Artefakt in E13 ohne Test, und genau deshalb ist F27 durch alle Prüfungen gekommen. Ebenfalls bestätigt: **PR #1 und #2 sind geschlossen und nicht gemergt** (28.07.), `main` unverändert `a560b8c` — meine frühere Darstellung „zwei offene PRs, Entscheidung beim Auftraggeber" war einen Tag lang überholt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `JR-13-13`/`JR-13-14`/`JR-13-15` (DEV), dann `JR-13-16` (TEST), dann `JR-13-09a`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-07-29      | **`JR-13-16` aus E13 herausgenommen — Entscheidung des Auftraggebers, und sie ist berechtigt.** Das Epic war von 9 auf 14 Positionen gewachsen. Der größere Teil davon war die Abnahme, die ihren Zweck erfüllt hat — `JR-13-09` hat E13 mit zwei echten Befunden abgelehnt —, und drei weitere Themen hatte der PO bereits **aus** E13 herausgehalten (`JR-13-10`/`JR-13-11`/`JR-13-12`). `JR-13-16` war jedoch eine PO-Entscheidung zweiter Ordnung: ein Regressionstest für SQL-Schnipsel in einer **Doku-Seite**. E13s Zusage lautet „die Autorisierungsschicht ist fail-closed", und die ist seit `dcec017` erfüllt und unabhängig belegt — Injektionsweg an beiden Gates zu, `FilterBuilder` zeilenscharf fail-closed, jeder Regressionstest ohne seinen Fix rot, Suite grün auch in der CI auf PostgreSQL 17.10. Die Lücke, die `JR-13-16` bewachen soll (**F27**), ist **behoben** und in `JR-13-14` über eine Falsch-negativ-Prüfung gegen echtes Postgres belegt; der Test schützt gegen ihre **Wiederkehr**, nicht gegen ihren Fortbestand. Ein Epic, dessen Kernaussage unabhängig belegt ist, wird nicht von einer Absicherung zweiter Ordnung offengehalten. Die Task steht wortgleich unter „Folge-Task nach E13", zählt **nicht** zu `JR-13-09a`, und die Reihenfolge der vier Folge-Tasks ist festgelegt (`JR-13-12` → `JR-13-16` → `JR-13-11` → `JR-13-10`); keine blockiert E2. Nur Dokumentation, kein Produktionscode, kein Test angefasst.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `JR-13-09a` — die letzte Task von E13, eigene Session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-07-29      | **`JR-13-17` erledigt (Rolle `senior-dev`) — F30 behoben, und der Abdeckungsanspruch der Betreiberseite ist weg (ADR-020).** (a) Die zwei Formbefunde von Query 2 stehen auf **Knotenebene**: sie speisen aus der rekursiven CTE `cond` statt aus `pair`, `cond` trägt eine neue Spalte `path`, und jede Meldung nennt die Position (`"conditions" -> "$or" -> [] -> "$and" -> []`). Drei Befundtypen: `empty condition object` (`node = '{}'` in **jeder** Position, ersetzt den Wurzel-Typ), `condition node is not an object` (Element eines `$or`/`$and`-Arrays bzw. Rumpf eines `$not`) und `condition branch list is not an array`. Die Wurzelmeldung `conditions is not an object` bleibt unverändert. Die Prädikate sind aus `checkConditionsShape()` **abgeleitet**, nicht geraten; ein pauschales `jsonb_typeof(node) <> 'object'` wäre Fallstrick 20 gewesen. **Nachweis, Blöcke wörtlich aus der `.md` gegen PostgreSQL 16.13 mit 41 Migrationen, 26 gesäte Rollen:** alle **acht** F30-Formen gemeldet, `{"$or": []}`/`{"$and": []}` und alle Wurzelformen weiter gemeldet, sieben zusätzliche Formen derselben Klasse ebenfalls; **keine Falsch-positiven** — die drei `predefined_*` und acht Kontrollen (Gleichheit, `$in`, Relationskey, `can` mit Operator, `$or` aus Objekten, verschachteltes `$and`/`$or`, `$not` um eine Gleichheit, unbedingter Grant) in **keiner** der drei Ausgaben, maschinell verglichen. Gegen den Übersetzer gekreuzt (37 Werte, `dist/helpers/mongoToDrizzle.js`): verweigert ⇒ gemeldet und übersetzbar ⇒ still, mit **zwei** benannten, bewussten Abweichungen (`conditions: 5` an einem nicht gefilterten Subject wird nicht gemeldet — dort ändert sich nichts; `{"id":{"$in":[{}]}}` wird gemeldet, obwohl der Übersetzer es nimmt — Übermeldung). (b) **Der Anspruch ist weg:** „It examines" ⇒ „What it reports", kein „recursively" als Zusage, der widerlegte Satz zu „the values inside a condition" ersetzt (ein Wert, der selbst eine **Struktur** ist, ändert die Wirkung), ausdrücklich „**cannot be shown to be complete** … an indication, **not a clearance**", plus eine **verifizierbare Gegenprobe in drei Schritten ohne Formliste** und der Hinweis, dass eine unübersetzbare Bedingung jetzt einen **Fehler** erzeugt. **Vier weitere Abdeckungssätze** derselben Klasse gefunden und ersetzt („lists **every** shape", „find out which", zwei × „covers"), plus drei bisher offene Punkte ausdrücklich benannt (Scoping des Wurzelbefunds, `400` nur an der Wurzel, Array-`conditions` wird nicht betreten). **Kein Produktionscode, kein Test, keine Migration, kein i18n-Key**; `conditionKey.ts` war Referenz, nicht Ziel. `pnpm lint`, `test:types`, Backend-Build, `pnpm docs:build` grün, `dist/dev/` fehlt weiterhin, Suite unverändert `250 passed \| 2 skipped`, Exit 0, 0 `oa_test_*`-Rückstände, Cluster restlos entfernt. | **`JR-13-09b`** — schmale dritte Abnahme (Kriterium 12 und `JR-13-17`), eigene Session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-07-29 / 30 | **Lücke in dieser Tabelle, nachgetragen vom PO am 2026-07-30.** Die Sessions zwischen `JR-13-17` und dem Rückmerge haben ihre Protokolle als eigene `###`-Abschnitte oben in dieser Datei abgelegt, aber keine Zeile hier ergänzt. Der Reihe nach, jeweils mit Abschnitt: **Abnahme `JR-13-09b`** — E13 zum dritten Mal nicht abgenommen, 17 von 18 Kriterien, gebrochen war **F31** (der Abdeckungsanspruch war von der Abfrage auf den Verhaltenscheck gewandert, der zwei Zahlen vorschreibt, während die Anwendung **drei** Oberflächen filtert), Ursache in ADR-020 selbst, dazu F32–F34. **`JR-13-18`** — die dritte Zahl aufgenommen, der Absolutsatz durch sein Gegenteil ersetzt, die Bürgschaft in beiden Richtungen negiert; **ohne DEV-Bericht** committet, die Statusnotiz ist die Lesart des PO aus dem Diff. **Abnahme `JR-13-09c`** — **E13 abgenommen** in der vierten Runde, der Prüfer hat ohne DEV-Bericht gearbeitet und den durch `JR-13-18` entfernten Anker mit einer vergifteten Wegwerf-Kopie neu gesetzt, bevor er dem sauberen Lauf glaubte; der eine gemeldete Neubefund (**F36**) ist vom PO nachgemessen und **widerlegt** — reines **F35**. **Rückmerge `89d701f`** (`--no-ff`, kein Squash, damit die drei dokumentierten Ablehnungen erhalten bleiben). **`JR-13-12`** (`dca1f1a`) — die dritte Stelle des Berechtigungsvokabulars berichtigt, alle drei maschinell verglichen, 8 Actions und 7 Subjects.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `JR-1-05c` (F14–F16, F24), fällig vor E2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-07-30      | **`JR-1-05c` erledigt (`b5b2190`) — E1 hat keine offene Nacharbeit mehr.** Der Inventar-Wächter zählte Dateien; drei Wege, Abdeckung zu entfernen, lassen das Filesystem unverändert (F14, F15). Neu zählt ein Reporter die **ausgeführten** Tests **je Suite und je Klasse** gegen `SUITES[].expectedTests`, und der `globalSetup`-Teardown urteilt und wirft — vitest hat nach dem Lauf keinen Assertions-Haken, die Reihenfolge (`onTestRunEnd` → `onFinished` → Teardown, Wurf ⇒ Exit 1) ist vorab gemessen. Je Klasse ist der tragende Teil: die Umetikettierung verringert die Gesamtzahl nicht, sie verschiebt die Tests in eine nicht gefahrene Klasse. Dateizahl **und** Testzahlen sind jetzt **Gleichheiten** (F15s eigener Vorschlag); die Fehlermeldung nennt die einzutragende Zahl. Ein absichtlich verengter Lauf (`-t`, Dateifilter, `--project`, `--shard`) prüft nichts und **sagt das** — die CI verlangt dafür, dass die Prüfung anwendbar war, dort ist die Hintertür also zu; sie liest zudem das **Urteil** statt es nachzurechnen (F29 nicht wiederholen). **F16/F24**: der Worker trägt jede geholte Datenbank in ein **Ledger-Verzeichnis je Lauf** ein, der Hauptprozess meldet den Rest mit Namen und Worker-PID, droppt ihn und macht einen **unverengten** Lauf davon rot — bewusst nicht „alles abfragen und diffen", das hätte einen fremden Parallellauf treffen können (F12). **Jeder Angriff zuerst am Elternstand `e09b981` wiederholt:** Umetikettierung aller acht Integrationsdateien war dort **Exit 0** mit „verified" von beiden Wächtern, jetzt **Exit 1** bei unveränderten `8/8` Dateien; `it.skip`-Datei ⇒ `ci 52/55`; Löschen-plus-Hinzufügen ⇒ `ci 43/55`; Modul-Scope-Wurf ⇒ Datenbank namentlich gemeldet und gedroppt; `pnpm test -t "idempotent"` hinterließ **6** Datenbanken, jetzt **0**; legitim ⇒ `274 passed \| 2 skipped`, Exit 0. Alles gegen PostgreSQL **17.10**. Kein Produktionscode, `test:types` grün, Prettier grün, 0 Rückstände. **`CLAUDE.md` §5.1 war falsch** („zero test files, no test runner", CI ohne Test-Job) und ist berichtigt — sie hätte eine Folge-Session einen zweiten Harness bauen lassen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **E2** — davor die zwei ADRs **ADR-006** und **ADR-007** entscheiden und Redis/Meilisearch/Tika für diesen Host klären                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-07-31      | **ADR-007 vollständig entschieden (Auftraggeber): eine Kette _je Mandant_, und `chain_scope_id` = `ingestion_sources.id`.** Nicht eine globale Kette mit Mandanten-Tag — RFC §15 nennt per-tenant für **Export und Löschung** sauberer, und genau das muss dieses Produkt dauernd leisten; ein Kettenauszug für einen Auditor würde bei einer globalen Kette zwangsläufig Absender, Empfänger und Zeitpunkte anderer Mandanten offenlegen. **Die frühere Entwurfsrichtung war ein Denkfehler und ist berichtigt:** „für v1 eine einzelne Kette" berief sich auf RFC §5.2, dessen „do not start there" aber **Shard**-Ketten zur Horizontalskalierung meint, nicht eine fachliche Partition je Mandant. Als Kettenschlüssel gewählt ist das **Archiv**, nicht der Endpunkt: der Ledger muss stabiler sein als die Konfiguration, die ihn füllt — `journaling_sources` ist `paused`-bar, seine `routing_address` regenerierbar, es hängt per `onDelete: cascade` an der Ingestion-Source, und das Schema erlaubt mehrere Endpunkte je Archiv. `journaling_source_id` wird **Attribut** jeder Ledger-Zeile, damit „wer hat gesendet" im Beleg bleibt. Sieben Konsequenzen in ADR-007, davon drei nicht offensichtlich: die Kettenkennung **muss in den Genesis** (sonst sind zwei Ketten mit identischem erstem Ereignis hashgleich und ein Eintrag zwischen Mandanten verschiebbar), das **Ankern** wird teurer und braucht in E7/E8 die Wahl zwischen einem TSA-Zeitstempel je Mandant und einem Aggregat über alle Kettenköpfe, und **`verify` muss eine _fehlende_ Kette erkennen** — ein Zustand, den eine globale Kette nicht darstellen konnte. `02-architektur.md` §4, ADR-006 (Genesis) und E2s Tasks `JR-2-03`/`JR-2-04`/`JR-2-06`/`JR-2-08`/`JR-2-09` sind nachgezogen; **offen bleibt allein ADR-006**. **Umgebung — die Infrastrukturfrage für E2 ist geklärt.** Der Auftraggeber hat erst **Docker Sandboxes** (`Docker.sbx`), dann **Docker Desktop** installiert; beide Wege sind gemessen. Über Sandboxes lief die Infrastruktur (Docker 29.6.1 in der Sandbox, Workspace gemountet, Host-Zugriff über `sbx ports`), aber der **Portforwarder überlebte die parallele Integrationslast nicht**: 16 Fehlschläge, alle `read ECONNRESET` bzw. `write CONNECTION_CLOSED`, bei 4 ms für einen einzelnen Connect. Dazu zwei weitere Auflagen: die Sandbox stoppt im Leerlauf (Container **und** Portfreigaben kehren beim Start zurück), und `sbx` erzwingt im Sandbox-Netz eine **Default-Deny**-Netzpolicy (`403 Blocked by network policy` für `http://tika:9998`, weshalb Tika dort nicht erreichbar war). **Mit Docker Desktop** (Engine und Client **29.6.2**, Compose **v5.3.1**) ist derselbe Volllauf **grün**: `274 passed                                                                                                                                                                | 2 skipped`, Exit 0, 0 `oa*test*\*`-Rückstände, Verdikt `applicable`und ohne Verstoß. Alle vier Dienste laufen und sind vom Host aus belegt: PostgreSQL **17.10** mit`CREATEDB`, Valkey `AUTH`+`PING`, Meilisearch `/health` `200`, Tika `/version` `Apache Tika 3.2.2`. Zwei Fallen dabei, beide im Handover: Docker Desktop ist eine **Benutzer**installation, deren PATH-Eintrag eine ältere Shell nicht sieht — und es genügt **nicht**, `docker.exe`mit vollem Pfad aufzurufen, weil dann`docker-credential-desktop`fehlt und jedes`pull`mit`error getting credentials`abbricht. Der Port-Override liegt bewusst **außerhalb** des Repositorys;`docker-compose.yml`bleibt ohne Port-Mappings. Die Probe-Sandbox ist entfernt, die Sandbox`claude-Maxim` des Auftraggebers unangetastet. **Kein Code geändert.** | **`JR-2-03`** (ADR-006 fixieren, Rolle PO), dann die übrigen E2-Tasks |

| 2026-07-31 | **ADR-022 und ADR-023 entschieden — die Ankerfrage ist von E7/E8 vorgezogen**, weil die Baumkodierung zur **kanonischen Kodierung** gehört und damit in `JR-2-03` fällt: eine kanonische Kodierung, die die Baumform nicht abdeckt, ist in E8 nicht mehr nachrüstbar, ohne bestehende Anker zu invalidieren. **ADR-022: ein RFC-3161-Token über die Merkle-Wurzel aller Kettenköpfe**, nicht eines je Mandant. Kostengrund: täglich × 50 Mandanten wären 18.250 Token im Jahr gegen 365. Der **tragende** Grund ist aber ein anderer — der Inklusionsnachweis darf keine Fremddaten brauchen. **Dabei ist ein Fehler in ADR-007 aufgefallen und als solcher markiert:** die dort als gleichwertige Aggregatform genannte „kanonisch sortierte Liste" ist **verworfen**, weil der Nachweis, dass der Kopf von Mandant A enthalten war, die ganze Liste braucht — `chain_scope_id`, `seq` und Kopf-Hash **jedes anderen** Mandanten, wobei die `seq` das Nachrichtenvolumen verrät. Das ist genau die Offenlegung, deren Vermeidung der einzige Grund für ADR-007 war. Beim Merkle-Baum sind die Geschwister-Hashes opak. Sieben Festlegungen dazu, darunter: Blätter decken **jede** Kette ab (auch unveränderte — sonst ist eine gelöschte Kette von einer ruhenden nicht unterscheidbar, und ADR-007 Konsequenz 5 verpufft), Blatt- und Knoten-Hash **domain-separiert** (`0x00`/`0x01`, sonst ist die Baumstruktur ambig), das `anchor`-Event steht in **jeder** Kette mit ihrem Inklusionspfad (Mandantenexport damit **selbsttragend**), und der geankerte Kopf ist der Kopf **vor** dem Event. Ausdrücklich **nicht** die Merkle-Frage aus RFC §15 — dort geht es um einen Baum _anstelle_ der Kette als Performance-Optimierung, hier um einen Baum _über_ den Ketten als Bedingung für mandantenreine Nachweise. **ADR-023: TSA-Auswahl, und `open-tsa.eu` ist gemessen statt von der Seite übernommen.** Ein Token geholt und gegen die **gepinnten** CA-Zertifikate verifiziert: `HTTP 200`, 2513 Bytes, `openssl ts -verify` ⇒ `Verification: OK`, Policy-OID `1.3.6.1.4.1.59085.1.1`, sha256, Accuracy 1 s, `Ordering: yes`, Nonce zurückgegeben. **Zwei Gegenproben liefen ebenfalls:** ein verändertes Datum scheitert, und ohne gepinnte CA ist gar nichts verifizierbar (der Root ist in keinem Trust Store). **Ergebnis: kein qualifizierter Zeitstempel** — keine Beweisvermutung nach eIDAS Art. 41. Der härteste Einzelbeleg ist nicht das Fehlen einer Behauptung auf der Website, sondern die **private Enterprise-Policy-OID** im Token statt einer ETSI-Policy. Weitere Auflagen: ein Knoten (Redundanz laut Roadmap erst 2028+), spendenfinanziert, Signing-Cert **2 Jahre** bei **10** Jahren Aufbewahrung — das Token muss **mit** seiner Zertifikatskette archiviert werden. Gewählt daher für die `nightly`-Klasse (echter Endpunkt statt Mock, kostenlos), als dokumentierte Option ohne GoBD-Anspruch und optional als **zweiter** unabhängiger Zeitstempel; **`ci` bleibt hermetisch**, weil ein CI-Lauf nicht von einem fremden spendenfinanzierten Einzelknoten rot werden darf — dieselbe Fehlerklasse, gegen die `JR-1-05c` gerade gehärtet hat. Nachgezogen: `02-architektur.md` §8, ADR-006 (Merkle-Kodierung), E8-Block im Backlog, Testplan §12.5 (zwei neue Tamper-Fälle plus der Positivfall „Nachweis ohne Fremddaten") und die TSA-Abgrenzungszeile, R-15 in `08-risiken.md`. **Kein Code geändert.** | **`JR-2-03`** (ADR-006 fixieren — Kodierung, Genesis, **und** Merkle-Baumform), dann die übrigen E2-Tasks |

| 2026-07-31 | **`JR-2-03` erledigt (Rolle PO): ADR-006 entschieden — die letzte Entscheidung vor dem Kettencode.** Fünf Teile festgelegt und **mit einer Referenzimplementierung gemessen**, nicht hergeleitet: Feldkodierung, Genesis-String, `deployment_id`, Klonverhalten, Merkle-Kodierung. **Der wichtigste Befund ist ein Loch im RFC:** §5.2 legt die Tabelle mit 14 Spalten an, hasht aber nur **acht** — `remote_ip`, `ehlo_name`, `tls_version`, `tls_cipher` und `duplicate_of` bleiben draußen und wären nachträglich änderbar, **ohne die Kette zu brechen**. Konkret ließe sich `tls_version` von `NULL` auf `TLSv1.3` setzen und damit eine im Klartext empfangene Nachricht als verschlüsselt ausweisen, bei intakter Verifikation. Die Kodierung deckt jetzt **alle 16** wertetragenden Spalten ab (ausgenommen nur `chain_hash` selbst und `prev_chain_hash`, das angehängt wird); eine neue wertetragende Spalte erzwingt künftig ein neues Versionsbyte, keine Ausnahme. **Die Bytes:** Versionsbyte `0x01`, `uint32be(field_count)` als Sicherung gegen stille Feldänderung, je Feld Typ-Tag + `uint32be(len)` + Rohbytes, acht Tags, `NULL` als **eigenes** Tag (sonst ist „kein EHLO" von „leeres EHLO" nicht unterscheidbar), `envelope_rcpt` in **Empfangsreihenfolge**. **Drei Fallstricke mitentschieden, jeder einzelne macht `verify` unbrauchbar und fällt vor der ersten Verifikation nicht auf:** (1) `timestamptz` hat µs, JS `Date` hat ms — das Format bleibt µs, aber geschrieben werden nur ms-Vielfache, mit `CHECK`-Constraint (`JR-2-04`); (2) Node liefert auf Dual-Stack `::ffff:192.0.2.25` für eine IPv4-Verbindung, dieselbe Verbindung sonst `192.0.2.25` — `remote_ip` wird **vor** dem Hashen normalisiert; (3) `event_payload` ist RFC 8785 (JCS) **ohne Fließkommazahlen**, wodurch der schwierigste Teil des Standards wegfällt und kanonisches JSON „Schlüssel sortieren, dann `JSON.stringify`" wird. **`deployment_id` kommt in eine eigene Tabelle `deployment_identity`, und `system_settings` ist ausdrücklich verworfen** — am Bestandscode geprüft: das ist die über die Einstellungs-API **schreibbare** `jsonb`-Konfiguration (`language`, `theme`, `supportEmail`), ein `PUT` darauf hätte jede Kette der Installation unverifizierbar gemacht. Erzeugt wird sie **in der Migration** per `gen_random_uuid()` (kein Anwendungscode, kein Race, funktioniert im Container-Entrypoint); die Append-Only-Erzwingung aus `JR-2-05` umfasst sie mit. **Der geklonte Server ist nicht verhinderbar, und das steht so in der ADR:** Restore und Klon sind byteidentisch, wer hier sperrt, sperrt zuerst das Disaster Recovery. Also: Restore behält die Kennung, ein parallel laufender Klon ist ein **Split-Brain-Befund** (erkennbar an `UNIQUE (chain_scope_id, seq)` und an zwei Ankern derselben `deployment_id` mit verschiedenen Wurzeln), und der Anchor-Job **verweigert**, wenn das externe Ziel schon einen späteren Anker derselben Kennung trägt — damit fällt ein Klon beim ersten Ankerlauf auf statt Monate später. **Merkle: RFC 6962, ungerader Knoten wird hochgezogen, Duplizieren ist verworfen — und der Grund ist gemessen:** bei der Bitcoin-Regel liefern `[A,B,C]` und `[A,B,C,C]` **dieselbe** Wurzel, womit sich eine zusätzliche Kette in einen bestehenden Anker hineinbehaupten ließe und ADR-022 Festlegung 1 (der Anker bezeugt die **Menge** der Ketten) aufgehoben wäre; unter RFC 6962 sind beide Mengen verschieden. Die **Domain-Trennung ist vollständig nachgerechnet**: Blatt `0x00 ‖ …` = 77 Byte, Knoten = genau 65 Byte, Ledger-Record ≥ 117 Byte — Knoten und Record beginnen beide mit `0x01`, sind aber durch die Länge disjunkt, weshalb die RFC-Formel `SHA256(record ‖ prev)` unverändert bleiben konnte. Die Rechnung steht in der ADR, damit niemand die Präfixe „vereinheitlicht" und dabei jede Kette invalidiert. **Testvektoren sind Teil der ADR** (Genesis, Receipt-Record samt Länge und `chain_hash`, Merkle-Wurzeln über 1/2/3 Blätter, vier Eigenschaftsnachweise) — `JR-2-02`s Golden-File-Kriterium hat damit konkrete Zielwerte. Vorgaben an `JR-2-02`/`JR-2-04`/`JR-2-05`/`JR-8-02`/`JR-8-03`/`JR-2-09` in §7 der ADR; nachgezogen sind `02-architektur.md` §4, `README.md`, `03-backlog.md`, `04-testplan.md` und `07-session-handover.md`. **Kein Code geändert.** | **`JR-2-01`** — `packages/journaling` anlegen (Rolle DEV, Branch `claude/journaling-e2-ledger`) |

| 2026-07-31 | **`JR-2-01` und `JR-2-02` erledigt (Rolle DEV, Branch `claude/journaling-e2-ledger`) — der erste Produktionscode dieses Projekts.** `JR-2-01`: `packages/journaling` mit AGPL-`package.json`, `tsconfig.json` (Projektreferenz auf `types`, Tests aus dem Build ausgeschlossen) und `tsconfig.test.json` nach dem Muster des Backends. Die Abhängigkeitsregel ist **belegt statt behauptet**: ein `grep` über `src` und `tests` findet als externe Importe nur `@open-archiver/types`, `node:crypto`, `vitest` und `@oa-test/*` — kein `@open-archiver/backend`. Die Ledger-Typen liegen bewusst in **`packages/types`** (`journal-ledger.types.ts`), weil die Abhängigkeitsregel sonst keinen Sinn hätte und `verify` später dieselben Formen braucht. `JR-2-02`: `src/ledger/canonical-encoding.ts` und `src/ledger/merkle.ts`, exakt nach ADR-006 — Versionsbyte `0x01`, `field_count`-Präfix, acht Typ-Tags, **16** positionale Felder, `NULL` als eigenes Tag, `envelope_rcpt` in Empfangsreihenfolge, JCS-Teilmenge ohne Fließkommazahlen, Merkle nach RFC 6962 mit Blattsortierung über die UUID-Rohbytes. **Die Testvektoren der ADR sind getroffen**, byteidentisch: Genesis für zwei Scopes, Recordlänge **351**, `SHA256(record)`, `chain_hash(1)`, Blatt A und die Wurzeln über 1/2/3 Blätter. Das ist der Punkt der Übung — die Werte entstanden **vor** dem Code, in einer Referenzimplementierung, also kann dieser Test keine Tautologie sein. **Drei Entscheidungen der ADR sind als Verweigerung implementiert, nicht als Kommentar:** ein Zeitstempel, der kein ms-Vielfaches ist, wirft; eine UUID in Großschreibung wirft; ein nicht parsbares `remoteIp` wirft, statt as-is gehasht zu werden. `normalizeRemoteIp()` parst vollständig und gibt nach RFC 5952 wieder aus, statt der Eingabe zu vertrauen — `::ffff:192.0.2.25` und `192.0.2.25` sind derselbe Absender. **50 neue Unit-Tests in drei Dateien**, der tragende davon mutiert **jedes** der 16 Felder einzeln und verlangt einen anderen Kettenhash: fünf dieser Mutationen wären unter der RFC-Formel unentdeckbar, und der Test benennt bei jeder, welche. Der Merkle-Test implementiert die **verworfene** Duplizier-Regel lokal nach und zeigt sie kollidieren (`root[A,B,C] == root[A,B,C,C]`), damit der Grund für RFC 6962 nicht zur Folklore wird. **Zwei eigene Testfehler gefunden und behoben:** `SCOPE_A.toUpperCase()` ist ein No-op, weil die Vektor-UUIDs nur Ziffern enthalten — zwei Prüfungen „lehnt Großschreibung ab" hätten leer bestanden und sind jetzt gegen eine UUID mit Hex-Buchstaben plus eine Positivprobe geschrieben. **Volllauf gegen das Docker-Postgres: `324 passed \| 2 skipped` bei 22 Dateien, Exit 0**, `unit: ci 266/266 · integration: ci 55/55 · adversarial: ci 3/3`, 0 `oa_test_*`-Rückstände. `expectedFiles` 10→13 und `expectedTests.ci` 216→266 im selben Commit. `test:types` grün für `journaling` **und** `backend`, `tsc` des Backends grün, `svelte-check` 0/0 — die `types`-Erweiterung rippelt nirgends. Nachgezogen: `CLAUDE.md` §2 (neues Paket) und §5.1 (Volllaufzahl), Testplan §2.1 (beide Beispielausgaben trugen die alten Zahlen). | **`JR-2-04`** — Drizzle-Schema `journal_ledger` plus `deployment_identity` und Migration (Rolle DEV, Skill `oa-migration`) |

| 2026-07-31 | **`JR-2-04` erledigt (Rolle DEV): `journal_ledger` und `deployment_identity` sind migriert** — `0041_even_scream.sql`, Skill `oa-migration` befolgt, SQL und `meta/0041_snapshot.json` zusammen committet. **18 Spalten**, zusammengesetzter Primärschlüssel `(chain_scope_id, seq)` statt eines globalen `seq` (ADR-007 Konsequenz 1), **sechs `CHECK`-Constraints**, zwei Fremdschlüssel, zwei Indizes. **Das Akzeptanzkriterium ist gegen echtes PostgreSQL 17.10 belegt:** `'2026-07-31T10:15:30.123456Z'` wird von `journal_ledger_received_at_whole_ms` abgewiesen, ein ms-Vielfaches und eine ganze Sekunde werden angenommen. Vor dem Schreiben wurden **drei Formulierungen des CHECK gegen die Datenbank geprüft**, weil Postgres in `CHECK` nur `IMMUTABLE`-Ausdrücke erlaubt und `extract` auf `timestamptz` nur `STABLE` ist — alle drei werden akzeptiert, gewählt ist die Variante mit `at time zone 'UTC'`, weil sie die Zeitzonenunabhängigkeit explizit macht. **Drei Abweichungen von der naheliegenden Lösung, alle begründet:** (a) Hashes als **`bytea`**, nicht als hex-`text` wie `archived_emails.storage_hash_sha256` — diese Bytes gehen **in** einen Hash, und eine Textform fügt eine Groß-/Kleinschreibungsfrage an einem Wert hinzu, von dem die Kettenverifikation abhängt; der Preis ist **eine** explizite Konversion an der Vergleichsstelle in Phase B und `verify`. (b) `remote_ip` als **`text`**, nicht `inet`: der gehashte Wert **ist** dieser Text, und `inet` würde beim Lesen eine zweite Normalisierung anwenden, die davon abweichen könnte. (c) **kein** Fremdschlüssel auf `journaling_sources` — jede Referenzaktion wäre `SET NULL` (ändert ein gehashtes Feld, bricht die Kette) oder `CASCADE` (löscht Beweise); die Aussage „dieser Endpunkt hat gesendet" bleibt wahr, nachdem der Endpunkt entfernt wurde. `chain_scope_id` hat dagegen einen Fremdschlüssel mit **`ON DELETE restrict`**: das Löschen eines Archivs mit Ledger-Zeilen ist **blockiert**, was gewollt ist und E12 ein eigenes Verfahren abverlangt. **Beim Testschreiben ein Loch im eigenen Schema gefunden und geschlossen:** der zusammengesetzte Fremdschlüssel `(chain_scope_id, duplicate_of) → (chain_scope_id, seq)` verhindert den **Selbstverweis nicht**, weil Postgres Referenzintegrität am Ende des Statements prüft und das referenzierte Paar dann die gerade eingefügte Zeile ist — `duplicate_of = seq` wurde akzeptiert, eine Quittung wäre ihr eigenes Original. Der zusätzliche CHECK `duplicate_of < seq` schließt es und formuliert die eigentliche Regel: das Original kommt vor dem Duplikat. Weil die Migration zu diesem Zeitpunkt nur auf der lokalen Wegwerf-Datenbank lag und nicht committet war, wurde sie **ersetzt statt ergänzt** (DB zurückgesetzt, `_journal.json` aus `HEAD` geholt, neu generiert) — nach dem Anwenden wäre das nicht mehr zulässig gewesen. **Eine handgeschriebene Zeile in der Migration**, im SQL als solche markiert und begründet: das `INSERT` der Identitätszeile, weil `drizzle-kit` Schema und keine Daten erzeugt, die Zeile aber vor der ersten Kette existieren muss und `docker-entrypoint.sh` `db:migrate` vor dem Start ausführt. **16 Integrationstests** in `journal-ledger-schema.int.test.ts`; sie prüfen nicht „schlägt fehl", sondern **welcher Constraint** greift — der erste Entwurf tat das nicht und wäre bei einem SQL-Tippfehler grün gewesen, weil Drizzle den Postgres-Fehler in `cause` verpackt. Angewandtes Schema unabhängig nachgemessen: 11 Constraints, 3 Indizes, 18 Spalten, eine Identitätszeile mit echter UUID. Volllauf: **340 passed \| 2 skipped** bei 23 Dateien, Exit 0, `integration: ci 71/71`, 0 `oa_test_*`-Rückstände; `test:types` grün. | **`JR-2-05`** — Append-Only erzwingen, ADR-009 entscheiden (Umfang: `journal_ledger` **und** `deployment_identity`) |

| 2026-07-31 | **`JR-2-05` erledigt (Rolle DEV) und `ADR-009` entschieden — Trigger jetzt, Rechteentzug in E11.** Die ursprüngliche Frage der ADR lautete „Rechteentzug **oder** Trigger"; die Antwort des Auftraggebers ist beides, zeitlich getrennt nach Umsetzbarkeit. Umgesetzt ist der Trigger: Migration `0042_journal_ledger_append_only.sql`, eine **Custom-Migration** (`drizzle-kit generate --custom`, weil drizzle-kit keine Trigger abbilden kann, aber Journal und Nummerierung in derselben Folge bleiben sollen), eine `plpgsql`-Funktion mit `ERRCODE = restrict_violation` und **vier** Trigger — je Tabelle einer für `UPDATE OR DELETE` (row level) und einer für **`TRUNCATE`** (statement level). **Der `TRUNCATE`-Trigger ist kein Beiwerk:** `TRUNCATE` löst Row-Level-Trigger überhaupt nicht aus, ein reiner Row-Trigger hätte also eine einzelne Anweisung offen gelassen, die den kompletten Ledger entfernt. Umfang ist `journal_ledger` **und** `deployment_identity`, weil die `deployment_id` im Genesis-Hash jeder Kette steckt. **Gegen PostgreSQL 17.10 gemessen:** `UPDATE`, `DELETE` und `TRUNCATE` auf beiden Tabellen abgewiesen mit `23001`, `INSERT` weiterhin erlaubt — letzteres eigens geprüft, weil eine Schutzmaßnahme, die auch Appends blockiert, die Ingestion anhalten würde, und die darf niemals stoppen (ADR-008). **Neuer Befund `F37`, und er ist der Grund für die zweite Hälfte der ADR:** `docker-compose.yml` setzt `POSTGRES_USER: ${POSTGRES_USER:-admin}`, `.env.example` ebenso, und `DATABASE_URL` wird daraus gebildet — die `POSTGRES_USER`-Rolle eines `postgres`-Images ist **Superuser** und Eigentümer aller Tabellen. Gemessen: `current_user = admin`, `rolsuper = true`, `journal_ledger owner = admin`, und **beide** Umgehungen laufen erfolgreich (`SET session_replication_role = replica` ⇒ `UPDATE` durchgelassen; `ALTER TABLE … DISABLE TRIGGER` ⇒ erlaubt). In einer Standardinstallation ist der Trigger vom Anwendungskonto aus also zwei Anweisungen entfernt. **Was er trotzdem leistet, und das ist nicht wenig:** er schließt **F1** als Manipulationsweg, weil eine `WHERE`-Klausel-Injection weder ein `SET` noch ein `ALTER TABLE` absetzen kann — `postgres-js` benutzt das erweiterte Protokoll, es gibt kein Statement-Stacking. Die Nacharbeit (eigene Rolle ohne Eigentum mit nur `INSERT`/`SELECT`, Migration unter anderer Rolle, Startup-Check gegen Superuser-Verbindungen) ist in ADR-009 festgeschrieben und **E11** zugeordnet, nicht in E2 hineingezogen: sie berührt `.env`, `docker-compose.yml`, den Migrationspfad und die Betreiberdoku, und eine halb eingebaute Trennung erzeugt den Anschein der Erledigung. **8 Integrationstests.** Die Umgehbarkeit ist ausdrücklich **nicht** als Test festgeschrieben — ein Test, der „die Schutzmaßnahme ist umgehbar" behauptet, würde rot, sobald E11 die Rolle härtet, und niemand könnte Regression von beabsichtigter Behebung unterscheiden; stattdessen prüfen die Tests, dass alle vier Trigger vorhanden und **`tgenabled = 'O'`** sind, und ein `coverageNotice` benennt die Grenze auf jedem Lauf. Ebenfalls geprüft: die Fehlermeldung nennt Operation, Tabelle, Task-ID und den **Weg** (Löschung ist ein angehängtes `object_erased`-Event, kein `DELETE`) — eine Meldung, die nur „refused" sagt, lädt dazu ein, den Trigger abzuschalten. Nachgezogen: ADR-009 auf entschieden, `02-architektur.md` §1 (der gewählte Mechanismus, wie der Skill `oa-migration` es verlangt) und §12, F37 in `09-befunde-bestandscode.md`, `JR-2-09`s Zeile im Backlog (der Tamper-Test muss den Trigger jetzt gezielt abschalten, sonst prüft er nichts). Volllauf: **348 passed \| 2 skipped** bei 24 Dateien, Exit 0, `integration: ci 79/79`, 0 `oa_test_*`-Rückstände. | **`JR-2-06`** — `LedgerWriter.append()`: Advisory-Lock aus der Kettenkennung, Hash **innerhalb** der Sperre |

| 2026-07-31 | **`JR-2-06` erledigt (Rolle DEV): `PostgresLedgerWriter.append()` schreibt die Kette, und sie verifiziert sich nach dem Datenbank-Rundtrip.** Die Reihenfolge aus RFC §5.2 vollständig und in dieser Folge: `SET LOCAL synchronous_commit = on` → `pg_advisory_xact_lock($key)` → Kopf lesen → `seq = kopf.seq + 1` → Hash **innerhalb** der Sperre → `INSERT`, alles in **einer** Transaktion. **Das Akzeptanzkriterium „Hash-Berechnung außerhalb der Sperre ist im Code unmöglich (Struktur, nicht Kommentar)" ist über den Typ gelöst:** `LedgerAppendRequest` hat **kein** Feld für `seq`, `prevChainHash` oder `chainHash`. Zwei der drei Hash-Eingaben sind erst unter der Sperre bekannt, also kann ein Aufrufer nicht vorberechnen; und für ein vorberechnetes Ergebnis hat der Typ keinen Platz, also kann er auch keines hineinreichen. Das ist die Hälfte, die keinen Test braucht. Die andere Hälfte ist die Reihenfolge, und die ist **gegen einen aufzeichnenden Fake** geprüft: 14 Unit-Tests, die die Statements protokollieren und die Ordnung direkt prüfen — gegen echtes Postgres wäre sie unsichtbar, weil eine korrekte Kette und eine vor der Sperre gehashte Kette identisch aussehen, bis zwei Writer kollidieren, und dann ist der Fehlschlag sporadisch. Geprüft wird dort auch, dass es `pg_advisory_xact_lock` und **nicht** `pg_advisory_lock` ist (die Session-Variante würde einen gehaltenen Lock über einen Fehlerpfad hinaus lecken und die Kette blockieren, bis die Verbindung recycelt wird) und dass `seq` als **bigint** verarbeitet wird, auch wenn der Treiber es als String liefert — als `number` gelesen verlöre der Wert jenseits von 2^53 stillschweigend Präzision, und er wächst nur. **Der Lock-Key kommt aus `advisoryLockKey(chainScopeId)`** — SHA-256, erste 8 Bytes, als signed int64 — und bewusst **nicht** aus Postgres' `hashtext()`, das ausdrücklich nicht versionsstabil ist: ein Lock-Key, der sich bei einem Major-Upgrade ändert, ließe zwei Prozesse gleichzeitig in dieselbe Kette schreiben. Eine Kollision zweier Ketten auf denselben Key ist harmlos (sie serialisieren sich, langsamer, nie falsch); die Gegenrichtung wäre gefährlich und ist ausgeschlossen, weil dieselbe Kette immer denselben Key ergibt. **Der stärkste der 8 Integrationstests rechnet die Kette aus der Datenbank neu** und ist damit die kleinste denkbare Fassung von E9s `verify`: jeder Wert gelesen, neu kodiert, neu gehasht, gegen die gespeicherte `chain_hash` verglichen — über eine Kette mit wechselnden Empfängerzahlen und -reihenfolgen, unsortierten Payload-Schlüsseln und einem `anchor`-Event, dessen Empfangsfelder alle `NULL` sind. Ein Writer kann tadellos geordnet sein und trotzdem eine unverifizierbare Kette erzeugen, wenn ein gehashter Wert die Speicherung nicht übersteht; das fällt sonst erst Monate später auf. Ebenfalls belegt: `received_at` behält seine Mikrosekunden (`bigint * interval`, kein `to_timestamp(x/1000000.0)` — Fließkomma hat in einer Hash-Eingabe nichts zu suchen) und die Empfängerreihenfolge bleibt erhalten; **ein Rollback verbraucht keine `seq`** (deshalb `max(seq)+1` statt einer Sequenz, deren `nextval()` nicht zurückgedreht wird); und **zehn gleichzeitige Appends in dieselbe Kette** ergeben lückenlos 1…10 mit zehn **verschiedenen** Vorgängerhashes — ein doppelter wäre der Beweis, dass die Sperre nicht serialisiert. **Ein eigener Testfehler gefunden, und er ist eine echte Falle für E9:** `select seq::text as seq … order by seq` sortiert **lexikographisch** (1, 10, 2, …), weil das Alias die Spalte überschattet — der Test meldete einen Kettenbruch bei `seq` 10, den es nicht gab. Die Umkehrung ist die gefährliche Richtung: eine falsche Leseordnung kann einen **echten** Bruch verdecken. Behoben durch qualifiziertes `order by journal_ledger.seq`, plus eine Assertion auf die Leseordnung selbst, damit der Test seinen eigenen Sortierfehler fängt. Vorher wurde der Advisory-Lock **isoliert nachgemessen** (vier parallele Read-Modify-Write-Transaktionen mit 25 ms Fenster ⇒ `1,2,3,4`, keine Verschachtelung, Parameter kommt als `bigint` an), um den Writer als Ursache auszuschließen, statt am Test zu raten. `packages/backend` hat jetzt eine Abhängigkeit auf `@open-archiver/journaling` (von der Architektur §2 ausdrücklich erlaubt); der postgres-js-Adapter liegt bewusst noch unter `tests/support/`, weil erst E3/E4 einen Prozess haben, der eine solche Verbindung besitzt, und die Wahl des Besitzers zu ADR-002 gehört. `JR-2-07` ist damit zum großen Teil vorweggenommen: `LedgerBackend`/`LedgerTransactor`/`LedgerQuery` stehen in `src/ledger/ledger-port.ts`. Volllauf: **370 passed \| 2 skipped** bei 26 Dateien, Exit 0, `unit: ci 280/280 · integration: ci 87/87`, 0 `oa_test_*`-Rückstände; `test:types` grün für beide Pakete. | **`JR-2-07`** (Restbewertung steckbares Backend), dann `JR-2-08`/`JR-2-09` (Rolle TEST) |

| 2026-07-31 | **`JR-2-07` erledigt (Rolle DEV): die Steckbarkeit des Ledger-Backends ist gemessen, nicht bewertet.** Die Schnittstelle selbst war in `JR-2-06` entstanden; offen war die Aussage, dass Variante (b) aus RFC §5.4 (append-only WAL) **ohne Signaturänderung** nachrüstbar ist. Diese Aussage ist jetzt eine Messung: eine gemeinsame Vertragssuite in `packages/backend/tests/support/ledger-backend-contract.ts` mit **fünf** Fällen (leere Kette beginnt bei `seq` 1 am Genesis; der zurückgegebene Hash ist aus Request und `seq` **nachrechenbar**, was jede Implementierung an die kanonische Kodierung bindet; `seq` +1 und Verkettung an den Vorgänger; zwei Ketten unabhängig mit eigenem Genesis; nebenläufige Appends lückenlos serialisiert) läuft **zweimal** — gegen `PostgresLedgerWriter` (`ledger-backend-contract.int.test.ts`) und gegen ein Backend **ohne Datenbank** (`ledger-backend-contract.test.ts`). **Der Entwurf ist die Aussage:** die Suite prüft ausschließlich die **Rückgabewerte** von `append()`, weil `seq`, `prevChainHash` und `chainHash` die Kette **sind**; eine Suite, die Tabellenzeilen liest, wäre ein Postgres-Vertrag mit allgemeinem Namen und gegen (b) nicht lauffähig — also genau der Zustand, den die Task ausschließen soll. Die speicherseitige Hälfte bleibt, wo sie hingehört: `journal-ledger-writer.int.test.ts` liest jede Spalte zurück, kodiert und hasht neu (µs-Erhaltung, Array-Reihenfolge, `bytea`), denn das sind Eigenschaften von (a). **Der Nebenläufigkeitsfall hat belegbar Zähne:** `UnsynchronisedInMemoryLedgerBackend` ist dasselbe Backend ohne Sperre, und unter 12 parallelen Appends forkt es reproduzierbar — alle lesen denselben Kopf, beanspruchen `seq` 1 und nennen denselben Vorgänger. Ohne diese Gegenprobe hätte der Fall eine Runtime-Eigenschaft statt einer Sperre beobachten können: ein einthreadiger Runtime serialisiert von selbst, solange zwischen Kopf-Lesen und Schreiben kein `await` liegt — weshalb das In-Memory-Backend eine **absichtliche** Latenz von 1 ms an genau dieser Stelle trägt. Dritter Fall dazu: ein fehlgeschlagener Append darf die Kette nicht verklemmen (die Sperre wird auf dem **settled** Ergebnis verkettet, wie `pg_advisory_xact_lock` bei Abbruch freigibt). **Die Grenze ist ausdrücklich benannt, statt sie zu überspielen:** der Vertrag prüft die **Signatur**, nicht die Durability — das In-Memory-Backend besteht ihn und ist nur so lange durabel wie der Prozess. Deshalb steht in `ledger-port.ts` jetzt eine **Pflichtenliste**, die eine echte (b)-Implementierung über die Signatur hinaus schuldet: `fsync` auf Datei **und** Verzeichnis vor dem Resolve (der Resolve ist der Moment, in dem `250 OK` erlaubt wird), prozessübergreifende Serialisierung je Kette (ein In-Process-Mutex ist keine), kein verbrauchtes `seq` bei Fehlschlag, ein Crash-Recovery-Scan plus asynchrone Replikation nach Postgres, und Lesbarkeit für `verify` — als Pflichten formuliert, weil ein WAL, das den Vertrag erfüllt und diese Liste überspringt, schlimmer als nutzlos wäre: es sähe korrekt aus. **`InMemoryLedgerBackend` liegt bewusst unter `tests/support/` und darf nie nach `src/`** — ein konfigurierbares Ledger, das vergessen kann, macht die Zusage hinter `250 OK` zur Lüge; im Testbaum kann keine Konfiguration es wählen. Der Adapter-Umzug von `postgres-transactor.ts` nach `src/` bleibt bei E3/E4, wie vorgesehen: welcher Prozess mit welchen Credentials verbindet, ist ADR-002, und die Prozesse existieren noch nicht. Volllauf: **`383 passed \| 2 skipped`** bei 28 Dateien, Exit 0, `unit: ci 288/288 · integration: ci 92/92 · adversarial: ci 3/3`, 0 `oa_test_*`-Rückstände; `test:types` grün. `expectedFiles` 14→15 und 11→12, `expectedTests.ci` 280→288 und 87→92 im selben Commit. Nachgezogen: `CLAUDE.md` §5.1 und Testplan §2.1 (beide trugen die alten Zahlen). | **`JR-2-08`** — adversariale Ledger-Tests, 20 Writer × 500 Appends (Rolle TEST, F13-Frist beachten) |
| 2026-08-01 | **`JR-2-08` und `JR-2-09` erledigt (Rolle TEST) — und der Lasttest hat einen Produktionsfehler gefunden, bevor er Produktion werden konnte.** **`F38`:** `PostgresLedgerWriter` band `event_payload` als `JSON.stringify(...)` an `$16`; postgres-js entnimmt den Parametertyp der **Parameterbeschreibung des Servers**, sieht `jsonb` und kodiert den String ein **zweites** Mal — in der Spalte steht dann der JSON-_String_ `"{\"k\":1}"` statt des Objekts. Beim Schreiben schlägt nichts fehl; unverifizierbar wird **jede** Zeile mit Nutzlast, und gemerkt hätte man es mit `verify` in E9. Vier Parameterformen gegen PostgreSQL 17.10 gemessen: `$2` ⇒ string, **`$2::jsonb` ⇒ string** (der naheliegende Fix hilft nicht), `$2::text::jsonb` ⇒ object, rohes Objekt ⇒ object. Behoben mit dem doppelten Cast, weil er den Parametertyp auf `text` festnagelt und keinem Treiber mehr die Ableitung `jsonb` erlaubt. **Warum acht Integrationstests darüber hinweggelaufen sind, ist der lehrreiche Teil:** fünf Client-Varianten gegen dieselbe Datenbank gestellt — `harness.sql` ⇒ object, `postgres(url, {gleiche Optionen})` ⇒ string, `postgres(url)` ⇒ string, `postgres(url, {max: 20})` ⇒ string. Es liegt nicht an einer Option, sondern daran, dass `drizzle(client, …)` den ihm übergebenen Client **patcht** — und genau dieser eine Client ist der, durch den jeder Integrationstest schreibt. Der Ingress-Prozess aus E3/E4 wird drizzle per Architekturvorgabe nicht haben. Regel daraus, in F38 festgehalten: für alles in `packages/journaling`, das seine Verbindung injiziert bekommt, muss mindestens ein Test durch einen **nackten** Client schreiben. **`JR-2-08`** (4 Fälle): 10 000 Appends durch 20 nebenläufige Writer in 84–96 s (≈120/s), auf einem eigenen Pool mit **einer Verbindung je Writer** — mit dem `max: 4` des Harness wäre die Konkurrenz im Treiber ausgetragen worden statt in Postgres, und der Advisory-Lock kaum belastet. `seq` genau 1…10 000, die Leseordnung **vor** dem Kettenlauf geprüft (der lexikographische Sortierfehler aus `JR-2-06` wäre bei 10 000 Zeilen verheerend), Kette über alle Zeilen neu gerechnet, 10 000 verschiedene Vorgängerhashes. Der Rollback-Fall läuft **unter Last** (8 × 100 Commits gegen 4 × 25 Rollbacks in dieselbe Kette) und prüft zusätzlich, dass die Rollback-Writer wirklich `seq`-Nummern abgeleitet haben — sonst wäre der Negativtest eine Tautologie. **Gegenprobe:** derselbe Fall gegen einen Transactor, der das `pg_advisory_xact_lock`-Statement verschluckt, bricht (19 von 20 Appends scheitern, Befund `missing_entry`); ohne sie könnte der Lasttest grün sein, weil sich nichts überlappt hat. **F13** ist behandelt und die Richtung benannt: die Frist wird **nur angehoben, nie gesenkt** — wirksam gegen den **eigenen** Sweep, der sonst eine fremde lange Laufzeit abräumt; die Gegenrichtung (ein fremder Prozess räumt uns ab) ist von hier aus nicht behebbar und steht als solche im Code. **`JR-2-09`** (11 Fälle): alle acht Fälle aus Testplan §12.5, plus der Positivfall und die Trigger-Gegenprobe. Die Prüflogik (`tests/support/ledger-verifier.ts`) meldet **Befundart, `seq` und Feld** statt pass/fail; das Feld nur, wenn eine **zweite Quelle** vorliegt, und diese Grenze ist im Modul ausgeschrieben statt überspielt — ein Kettenhash bindet alle 16 Felder gleichzeitig, aus ihm allein ist nicht ableitbar, welches sich bewegt hat. Drei Fälle lassen die Kette **absichtlich heil**: die ab `seq` N vorwärts neu geschriebene Kette ist in sich makellos und nur gegen den vorher genommenen Anker auffällig (das ist die Begründung für Anchoring, als Assertion formuliert), die vollständig gelöschte Mandantenkette hinterlässt nichts, was brechen könnte, und wird nur durch den Vergleich zweier Merkle-Anker sichtbar — mit einer **ruhenden** Kette daneben, dem Fall, den ein Baum über nur die geänderten Ketten nicht von einer Löschung unterscheiden könnte —, und der Klon erzeugt zwei gültige Ketten aus demselben Genesis (`split_brain`, **eigene** Befundart). **(f) und (g) stehen gegen eine mitgelieferte Implementierung der RFC-Formel** (`tests/support/rfc-formula-encoding.ts`): unter den acht Feldern des RFC bleibt sowohl `tls_version: NULL → TLSv1.3` als auch eine umgeschriebene `remote_ip` **unentdeckt**, unter ADR-006s 16 Feldern nicht. Der Testplan verlangt, diese Fälle „zuerst rot gesehen" zu haben — so läuft der Nachweis auf **jedem** CI-Lauf statt einmal von Hand, und er ist über die **ganze** Liste der acht ungehashten Felder formuliert, nicht über zwei Feldnamen. Der Inklusionsnachweis wird mit einem **unabhängig** implementierten Audit-Path geführt (RFC 6962, `tests/support/merkle-audit-path.ts`), der nur `merkleLeaf`/`merkleNode` mit dem Produktionscode teilt und dieselbe Wurzel treffen muss; geprüft ist auch, dass im Nachweis **kein** fremder `chain_scope_id` vorkommt. Der Append-Only-Trigger wird gezielt abgeschaltet, im `finally` wieder aktiviert **und der Zustand danach ausgelesen** — sonst liefe der Rest der Datei unbemerkt ohne Schutz. **Ein Test des Inventar-Wächters mitrepariert:** `suite-inventory.test.ts` hatte eine adversariale Fixture-Datei hart verdrahtet und damit implizit `expectedFiles: 1` angenommen; jetzt leitet er sie ab wie die Unit-Fixtures. Volllauf: **398 passed \| 2 skipped** bei 30 Dateien, Exit 0, `unit: ci 288/288 · integration: ci 92/92 · adversarial: ci 18/18`, 0 `oa_test_*`-Rückstände; `test:types` grün für beide Pakete. `expectedFiles` adversarial 1→3, `expectedTests.ci` 3→18 im selben Commit. Nachgezogen: `CLAUDE.md` §5.1 (Testzahl und die neue Laufzeit von rund zwei Minuten), F38 in `09-befunde-bestandscode.md`. | **`JR-2-10`** — Abnahme E2 (Rolle PO, eigene Session) |
| 2026-08-01 | **Abnahme `JR-2-10` durchgeführt — Ergebnis: E2 abgenommen, 23 von 23 Kriterien erfüllt, keine neuen Befunde. Mit einem Vorbehalt zum Verfahren, der zuerst genannt sei: die Abnahme ist _nicht unabhängig_** — `JR-2-08`/`JR-2-09` stammen aus derselben Sitzung. ADR-014/ADR-021 verlangen Unabhängigkeit; deshalb ist der **Rückmerge nicht vollzogen** und liegt beim Auftraggeber, anders als bei E1 und E13. Zur Kompensation wurde **nichts** aus den Umsetzungsberichten übernommen, sondern alles neu gemessen — und die tragenden Aussagen zusätzlich durch **vier Mutationsproben**, die ein Testautor nicht durch Optimismus besteht: (M1) den F38-Fix rückgängig ⇒ Regressionsfall **rot**; (M2) `tlsVersion` aus der Kodierung genommen ⇒ ADR-Vektoren **rot** (Recordlänge, `SHA256(record)`, `chain_hash(1)`), Fall (f) **rot** **und die RFC-Gegenprobe rot** — womit belegt ist, dass sie genau die Regression fängt, gegen die sie geschrieben wurde; (M3) `pg_advisory_xact_lock` neutralisiert ⇒ Lasttest nach 295 ms **rot** mit Primärschlüsselverletzung; (M4) die Manipulation in (f) wirkungslos gemacht ⇒ Test **rot** mit „expected [] to have a length of 1". **M4 ist die wichtigste:** sie schließt die Klasse aus, an der eine Tamper-Suite lautlos scheitert — ein Verifier, der immer meckert, macht jeden Tamper-Test grün, ohne zu unterscheiden. Vor und nach jeder Probe war `git status --porcelain` leer. **Das Kernkriterium — „die Testvektoren aus ADR-006 §6 sind vom Code reproduziert" — ist mit einem Skript belegt, das die Vektoren aus `05-entscheidungen.md` _parst_ statt sie abzutippen** und gegen `packages/journaling/dist` rechnet: Abtippen hätte belegt, dass das Skript mit sich selbst übereinstimmt. **16/16**, darunter alle acht Vektoren (Recordlänge **351 Byte**, `SHA256(record)`, `chain_hash(1)`, Blatt, Wurzeln über 2 und 3 Blätter) und die fünf Eigenschaftsnachweise. Die Merkle-Regel in beide Richtungen nachgerechnet, mit einer hier implementierten Duplizier-Regel als Vergleich: unter ihr `root[A,B,C] == root[A,B,C,C]` (**true**), unter RFC 6962 **false**, und der Produktionscode liefert die RFC-6962-Wurzel — ADR-022 Festlegung 1 ist damit nachgerechnet, nicht geglaubt. **Die Datenbankseite (`JR-2-04`, `JR-2-05`) wurde bewusst _nicht_ über den Testharness geprüft**, weil Harness und Tests Teil des Abzunehmenden sind: eigene Datenbank, echte Migrationen, Anweisungen direkt abgesetzt, **21/21** — µs-`CHECK` weist `…123456` ab (`23514`) und nimmt ms-Vielfache an, `duplicate_of = seq` abgewiesen, `ON DELETE restrict` greift (`23503`), 18 Spalten, `size_bytes`/`content_sha256` nullable, `remote_ip` ist `text`, vier Trigger `tgenabled = 'O'`, sechs Anweisungen (`UPDATE`/`DELETE`/`TRUNCATE` × zwei Tabellen) sechsmal `23001`, `INSERT` weiterhin erlaubt und alle Zeilen noch da. Ebenfalls geprüft: ohne `DATABASE_URL` und mit `OA_TEST_REQUIRE_INFRA=1` **scheitern beide E2-Suiten laut und benannt** — die Aussagen ruhen nicht auf einer abgeschalteten Suite. **Zwei Grenzen benannt, beide keine Mängel:** die Fälle (c) und (e) sind ohne E7/E8 nur so weit darstellbar, wie es geht (der „Anker" ist eine festgehaltene Merkle-Wurzel, kein RFC-3161-Token — in `JR-8-05`/`JR-9-07` gegen ein echtes Token nachzuziehen), und das F13-Kriterium ist **sinngemäß statt wörtlich** erfüllt: der Code hebt die Frist nur, wenn der wirksame Wert darunter liegt, weil ein bedingungsloses Setzen auf 30 min gegenüber dem Standard von zwei Stunden eine **Senkung** und damit genau der Fehler wäre, der F12 war. Volllauf nach allen Mutationsproben: **398 passed \| 2 skipped** bei 30 Dateien, Exit 0, `unit 288/288 · integration 92/92 · adversarial 18/18`. **Kein Code geändert.** | **`JR-2-10a`** — zweite, unabhängige Abnahme in frischer Sitzung (Rolle TEST); danach Rückmerge nach ADR-014, dann **E3** |
| 2026-08-01 | **Entscheidung des Auftraggebers: es gibt eine zweite, unabhängige Abnahmerunde (`JR-2-10a`).** Vorgelegt wurden drei Wege — Rückmerge jetzt, zweite Runde, oder Rückmerge ohne E3-Beginn; gewählt ist die zweite Runde. Damit ist der Vorbehalt aus `JR-2-10` **aufgelöst statt hingenommen**, wie ADR-014 und ADR-021 es verlangen, und das Protokoll der ersten Runde wird zum **Prüfgegenstand**. Aufgenommen: `JR-2-10a` im Backlog, und im Handover eine Liste **„Was die erste Runde nicht geprüft hat"** mit sechs benannten dünnen Stellen — vom Prüfer der ersten Runde selbst benannt, damit die zweite Runde nicht die erste nachspielt: die 50 Kodierungs-Unit-Tests sind nur über die ADR-Vektoren mitgeprüft, `JR-2-07`s Vertragssuite ist nie mutiert worden, die **Zahl** gleichzeitiger Transaktionen in `JR-2-08` ist nur indirekt belegt (über die Primärschlüsselkonflikte ohne Sperre), `readLedgerChain()`/`readChainHeads()` sind ungeprüfte Prüfwerkzeuge (das `DISTINCT ON` trägt (c) und (d)), `verifyChain()` ist nie gegen eine Tabelle „Manipulation → erwartete Befundart" gefahren worden, und die Migrationen sind nur vorwärts auf einer leeren Datenbank geprüft. **Der Rückmerge wartet auf `JR-2-10a`.** Kein Code geändert. | **`JR-2-10a`** in einer **frischen** Sitzung |
| 2026-08-01 | **Abnahme `JR-2-10a` durchgeführt — Ergebnis: E2 ist abgenommen, 24 von 24 Kriterien, und diesmal _unabhängig_.** Frische Sitzung, Rolle TEST (Subagent `tester`), die weder `JR-2-08` noch `JR-2-09` noch `JR-2-10` geschrieben hat; das Protokoll der ersten Runde war **Prüfgegenstand, nicht Beleg**. Der Auftrag lautete ausdrücklich, die erste Runde **nicht nachzuspielen**, sondern an ihren sechs selbst benannten dünnen Stellen anzusetzen — **alle sechs sind mit neuer Evidenz beantwortet:** fünf Mutationsproben am Encoder (vier exakt von der zuständigen Assertion gefangen, ohne Übersprechen — die eine Ausnahme ist **F39**); `JR-2-07`s Vertragssuite gegen **drei selbst geschriebene, sabotierte Backends** gefahren, alle drei gefangen, mit Kalibrierung gegen ein ehrliches Backend, damit die Suite nicht einfach immer meckert; die Nebenläufigkeit **direkt über `pg_stat_activity` gemessen** statt aus PK-Konflikten erschlossen (max. **20 gleichzeitig offene Transaktionen** bei 20 Writern); `readChainHeads()` mutiert (`DESC` → `ASC`) ⇒ Fall (c) korrekt **rot**, das Prüfwerkzeug ist also scharf; eine **eigene 10-Fall-Matrix „Manipulation → erwartete Befundart"** direkt gegen `verifyChain()`, alle 10 korrekt, darunter `genesis_mismatch` und `chain_break`, die die DB-Suite nie isoliert provoziert; und die Migrationen `0041`/`0042` **gegen eine Datenbank mit echten Bestandsdaten** statt nur vorwärts auf einer leeren. Die ADR-006-§6-Vektoren ein zweites Mal unabhängig nachgerechnet, diesmal **frisch aus der ADR-Markdown transkribiert** statt aus der Repo-Fixture übernommen: **12/12**, inklusive D4/D5 über eine eigene RFC-6962-Reimplementierung. **Der Verlauf gehört ins Protokoll, weil er zeigt, woran die Prüfung der Prüfung hängt:** die erste Berichtsfassung nannte „22 von 22" — eine Zahl, die sich aus der eigenen Kriterientabelle nicht herleiten ließ. Die Rückfrage des PO förderte **zwei echte Lücken** zutage, keinen bloßen Zählfehler: (1) **ein Kriterium der ersten Runde fehlte vollständig** — „die Aussagen ruhen nicht auf einer abgeschalteten Suite", ausgerechnet das Kriterium, das alle anderen trägt, weil die gesamte Evidenz auf `integration 92/92` und `adversarial 18/18` ruht; nachgemessen: ohne `DATABASE_URL` und mit `OA_TEST_REQUIRE_INFRA=1` **scheitern beide E2-Suiten laut und benannt**, sie überspringen nicht; (2) **zwei Aussagen waren nur zitiert, nicht gemessen** — dieselbe Schwäche, die die erste Runde an sich selbst kritisiert hatte; nachgeholt durch eine **frische F38-Mutation** (`$16::text::jsonb` → `$16`, Test rot, zurückgesetzt) und eine **eigene Datenbankmessung** (13 Prüfungen, alle PASS). Beide Nachmessungen bestätigten den Befund; **hätte eine widersprochen, wäre E2 nicht abgenommen** — der Prüfer war angewiesen, das Urteil nicht zu retten und die Kriterienmenge nicht rückwirkend passend zu schneiden. **Daraufhin hat der PO den _vollständigen_ Abgleich verlangt**, weil er selbst nur die 8-Zeilen-Tabelle der ersten Runde durchgesehen hatte, nicht deren 16 Vektor- und 21 Datenbankprüfungen — und der förderte **elf weitere Punkte** zutage: (3) **drei der 16 Vektorprüfungen** (`chain_scope_id`/`remote_ip` getauscht, gleiche Eingabe zweimal) waren nur aus dem Test gelesen, nicht gegen `dist` gerechnet; (4) **acht der 21 Datenbankprüfungen** fehlten oder waren ungenau (`TRUNCATE` auf beiden Tabellen, `DELETE` auf `deployment_identity`, exakter Code `23001` statt Meldungsmuster, „ganze Sekunde akzeptiert", „alle Zeilen stehen nach den sechs Ablehnungen noch da"). Alle elf nachgeholt, **alle PASS**. **Ein scheinbarer Widerspruch dabei aufgeklärt statt abgetan:** für „zweite Zeile in `deployment_identity` abgewiesen" maß der Prüfer `23514`, `JR-2-10` berichtet `23505` — beide stimmen, weil ein Duplikat mit `id=1` den **Primärschlüssel** verletzt und ein `id=2` den **CHECK**; beide Wege wurden gemessen. **Zeile 24 ist in beide Richtungen belegt:** mit `OA_TEST_REQUIRE_INFRA=1` scheitern alle fünf E2-Dateien einzeln (**Exit 1**), ohne die Variable überspringen sie sichtbar (36 skipped, **Exit 0**, dokumentiertes Normalverhalten), und `.github/workflows/ci.yml:57` setzt sie — **vom PO selbst nachgesehen**. Die Zahl 24 ist **nicht dieselbe Menge** wie die 23 der ersten Runde, sondern eine durchnummerierte Liste je Backlog-Klausel plus Kernkriterium plus der Verfahrensnachweis als Zeile 24; drei Zeilen, die dieselbe Tatsache verlangen, stehen als eine. **Daraus eine Regel für künftige Abnahmen:** eine durchnummerierte Liste, eine Zeile je Kriterium, damit die Kopfzahl nachzählbar ist — die „23" der ersten Runde war es nicht, und genau deshalb konnte erst ein Kriterium herausfallen und dann elf Punkte nur zitiert bleiben. **Und eine Lehre für den PO:** die Statuspflege wurde einmal **zu früh** committet (`443e083`, „23/23"), obwohl der vollständige Abgleich schon beauftragt war — wer eine Nachforderung stellt, schreibt den Status erst, wenn sie beantwortet ist. Ausdrücklich **ungeprüft** ausgewiesen: `JR-2-01`s Baufähigkeit nur per `tsc`+`grep` statt isoliertem Checkout, die 16 Feldmutationen als Stichprobe, `JR-2-10`s M3 durch einen ständigen Regressionstest statt derselben Mutation (**andere Evidenz, nicht dieselbe** — so benannt), Anchoring/Inklusionsbeweis (E8), Crash-Szenarien (`JR-4-10`), `pnpm lint` (F35). **Volllauf vom PO selbst reproduziert**, weil dieser eine Beleg alle anderen trägt: **398 passed \| 2 skipped** bei 30 Dateien, `unit 288/288 · integration 92/92 · adversarial 18/18`, 114 s, 10 000 Appends in 100 582 ms (99/s). `git status --porcelain` leer, `HEAD` unverändert `2ff0573` — vom PO unabhängig geprüft. **Ein neuer Befund: F39** (niedrig, Testharness): der Test „is length-prefixed…" bleibt grün, wenn man das Längenpräfix entfernt — gefangen wird die Mutation nur vom Golden-File. Kein Produktdefekt. **Kein Code geändert.** | **Rückmerge nach ADR-014** — liegt beim Auftraggeber; danach **E3** |
| 2026-08-01 | **Rückmerge von E2 vollzogen** (`eb340a9`), vom Auftraggeber freigegeben, nachdem `JR-2-10a` E2 abgenommen hatte. `--no-ff`, **kein Squash** — wie bei E13 und aus demselben Grund: die 12 Commits tragen zwei Abnahmerunden, eine vom PO zurückgewiesene Berichtsfassung und `F38`; ein Squash hätte den Beleg getilgt, dass das Verfahren gewirkt hat. **Vor dem Merge geprüft statt angenommen:** beide Branches lokal deckungsgleich mit `origin` (`b4eda03` bzw. `b91d376`), Arbeitsbaum sauber, **0 Commits** auf dem Integrationsbranch, die E2 nicht hat (ohne `--no-ff` wäre es ein Fast-Forward gewesen — der Merge-Commit markiert die Epic-Grenze bewusst). **Nach dem Merge geprüft:** der Merge-Commit hat **zwei Eltern**, sein Baum ist **byteidentisch** mit `b4eda03`, und seit dem zitierten Volllauf (`398 passed \| 2 skipped`, 12:17) war außerhalb von `docs/` **nichts** geändert — damit gilt der Lauf unverändert für den gemergten Stand, ohne ihn zu wiederholen. Gepusht, `origin` bestätigt `eb340a9`. **`main` unangetastet, kein Pull Request.** | **E3** — Spool und Acceptance-Contract, eigener Branch `claude/journaling-e3-<kurzname>` vom Integrationsbranch |

| 2026-07-31 | **`ADR-024` als Entwurf vorgelegt (Rolle PO): Betriebsmodell „eine Instanz je Endkunde" — Status offen, der Auftraggeber entscheidet.** Anlass war seine Frage, welches Tenancy-Konzept das Projekt hat. Am Bestand gemessenes Ergebnis: es gibt keins, und der Code trägt keins — keine `tenant_id` in 41 Migrationen, fünf global eindeutige Spalten (`users.email`, `roles.name`, `retention_policies.name`, `ediscovery_cases.name`, `custodians.email`), ein hart verdrahteter Meili-Index `'emails'` an 12 Stellen, ein Storage-Root mit einem `STORAGE_ENCRYPTION_KEY`, eine Zeile `system_settings` per `UPDATE` ohne `WHERE`, feste `container_name` für alle fünf Compose-Dienste. Isolation entsteht heute allein aus CASL-Policies — der Schicht, die in 0.5.2 fail-open war (F7). **Empfohlen** ist ein getrennter Stack je Endkunde, als Dichteoption ein geteilter Postgres-**Server** mit eigener DB und Rolle je Kunde; **nicht empfohlen** ein geteilter Stack mit Tenant-Spalte. Zwei Begründungen wiegen schwerer als der Aufwand: die `deployment_id` steckt im Genesis-Hash (ADR-006/007), das Modell ist also nicht nachträglich änderbar; und Port 25 hat vor STARTTLS kein SNI, ein `RCPT TO`-Proxy auf gemeinsamer IP müsste den Acceptance-Contract brechen oder E3 verdoppeln. **Die größte Sofortwirkung ist aber die Begriffsklärung:** „Mandant" heißt in ADR-007 **Archiv**, nicht Endkunde — „täglich × 50 Mandanten" in ADR-022 meint 50 Archive **einer** Installation. Nachgezogen: `02-architektur.md` §4, `README.md`, `08-risiken.md` (**R-16** stilles Datenmischen bei geteiltem Meili/Valkey, **R-17** SMTP-Frontproxy vor dem Contract). `03-backlog.md` **absichtlich unverändert** (ADR-021, und die Tasks hängen an der Entscheidung — sie stehen als Konsequenzen 1–6 in der ADR). **Kein Code geändert.** | **Entscheidung des Auftraggebers zu `ADR-024`**: Betriebsmodell, Dichteoption ja/nein, und wer die Instanzen betreibt (AGPL §13). Danach unverändert **`JR-2-01`** |

| 2026-08-01 | **Branch `claude/instanzen-konzept-endkunden-ewixv0` auf den E2-Stand gebracht und `ADR-024` dagegen nachgeprüft (Rolle PO).** Der Integrationsbranch war von `b91d376` auf `79d80f1` weitergelaufen — das gesamte Epic E2 lag dazwischen. Merge mit `--no-ff`, ein Konflikt (das Protokollende dieser Datei, beide Seiten behalten). Gegenprobe: `git diff` gegen den Integrationsbranch zeigt **nur** die fünf Journaling-Doku-Dateien und **null Löschungen** — von E2 ist nichts verloren. Jede Behauptung von `ADR-024` neu gemessen statt aus Commit-Messages übernommen; **zwei Zahlen waren falsch:** 41 → **43** Migrationen, und die `'emails'`-Literale sind **13**, nicht 12 (die erste Fassung hatte Zeilen statt Vorkommen gezählt). Unverändert bestätigt: keine `tenant_id` in irgendeiner Tabelle (auch nicht in E2s `journal_ledger`/`deployment_identity`), fünf globale `unique()`, fünf feste `container_name`, weder `db`-Index noch `keyPrefix` in `config/redis.ts`, globale Queue-Namen. **Ein Abschnitt der ADR war überholt und ist neu gefasst:** die Dringlichkeit lautete „vor dem Kettencode" — der ist gebaut und gemergt, also lautet sie jetzt **vor E3/E4**, weil die erste angelegte Kette die `deployment_id` in ihren Genesis schreibt. **Zwei Punkte ergänzt:** (a) neuer Abschnitt „Klonen ist die Falle bei der Provisionierung" — ein Golden Image **nach** dem Migrationslauf gibt allen Kunden dieselbe `deployment_id`, laut Schemakommentar ein nicht verhinderbarer Split Brain, den `JR-2-09` Fall (h) schon als eigene Befundart prüft; daraus **R-18** mit Maßnahme. (b) **F37** stützt Begründung 4: der Append-Only-Trigger ist vom Eigentümer abschaltbar, und in einem geteilten Stack wären davon die Ledger aller Kunden erreichbar. F37 ist E2s Befund und bleibt bei E11. Status der ADR unverändert **offen**. `03-backlog.md` weiter unangetastet (ADR-021). **Kein Code geändert.** | **Entscheidung des Auftraggebers zu `ADR-024`** (Betriebsmodell, Dichteoption, Betriebsverantwortung samt AGPL §13) — sie steht vor E3. Sonst **E3** nach `07-session-handover.md` |

| 2026-08-01 | **Rückmerge von `ADR-024` in den Integrationsbranch vollzogen** (`b54bb33`), auf Weisung des Auftraggebers. `--no-ff`, **kein Squash** — wie bei E1, E13 und E2. **Das war kein Epic-Rückmerge und brauchte deshalb keine TEST-Abnahme:** ADR-014 fordert die unabhängige Abnahme für Epic-Branches nach dem Schema `claude/journaling-e<N>-<kurzname>`, und `claude/instanzen-konzept-endkunden-ewixv0` ist keiner — er enthält kein Epic, sondern eine ADR. Für genau diese Arbeit sagt dieselbe ADR: „Arbeit, die die Projektgrundlage betrifft (Dokumentation, ADRs, Agent-Infrastruktur), gehört weiterhin **direkt auf den Integrationsbranch**." Der Inhalt hätte also von Anfang an hier gelegen und lag nur wegen der Sessionvorgabe auf einem eigenen Zweig. **Vorher entschärft:** der _lokale_ Integrationsbranch hing noch auf `b91d376`, 14 Commits hinter `origin` — genau die Rollback-Falle aus `CLAUDE.md` §7; nachgezogen mit `--ff-only`, nicht mit `reset --hard`. **Vier Gegenproben nach dem Merge:** der Diff gegen `79d80f1` zeigt ausschließlich die fünf Journaling-Doku-Dateien; `git diff 79d80f1..HEAD -- packages apps .github CLAUDE.md tests` ist **leer**, von E2 ist nichts angetastet; der Merge-Commit hat die zwei erwarteten Eltern `79d80f1` und `83e17cd`; und der Baum ist identisch mit dem Quellbranch. `prettier --check .` repo-weit grün. **Die Suite ist in dieser Umgebung nicht lauffähig** — `pnpm install` scheitert reproduzierbar mit `ERR_PNPM_FETCH_403` auf `cdn.sheetjs.com` (`xlsx` als Tarball in `packages/backend/package.json:72`), zweimal gemessen. Statt einer Behauptung der mechanische Beleg, dass sie nicht betroffen sein kann: nur Markdown unter `docs/dev/journaling/` geändert, `tests/support/suite-inventory.ts` unangetastet, kein Test liest eine Datei unter `docs/`, und E2s ADR-006-Vektoren stehen als TypeScript-Konstanten in `packages/journaling/tests/support/adr-006-vectors.ts` (importiert nur `node:crypto` und Typen), werden also nicht aus der Markdown geparst — ADR-006 selbst wurde ohnehin nicht berührt. `main` unangetastet (`a560b8c`), kein PR. Der Quellbranch bleibt bestehen. **Kein Code geändert.** | **Entscheidung des Auftraggebers zu `ADR-024`** — Betriebsmodell, Dichteoption, Betriebsverantwortung samt AGPL §13; fällig vor E3/E4. Sonst **E3** nach `07-session-handover.md` |

| 2026-08-01 | **`ADR-025` entschieden (Auftraggeber): der Fork wird weitergeführt, keine eigenständige Anwendung.** Anlass war seine Frage, ob sich das noch lohnt, nachdem er im Upstream-Branch `ee-1.5.1-dev` eine kostenpflichtige Lizenz für Journaling und Aufbewahrungsfristen vermutete — verbunden mit der Annahme, die Lizenz verbiete nach §12/§13 Netzwerk-Deployments für Endkunden. **Beide Annahmen wurden geprüft, eine hielt nicht.** `LICENSE` ist hier **und** in `ee-1.5.1-dev` unveränderte AGPL-3.0: §12 (`LICENSE:517`) betrifft widersprüchliche Auflagen Dritter, §13 (`LICENSE:529`) ist eine **Angebotspflicht für den Quellcode, kein Betriebsverbot** — so wie ADR-024 es bereits festhielt. `packages/enterprise` existiert in **keinem** öffentlichen Branch, auch nicht in `ee-1.5.1-dev`; dieser Fork steht vollständig auf AGPL-Boden. Die Vermutung „wird kostenpflichtig" **stimmt** dagegen (`ee-feat(license): enforce the license verdict from the database`, 2026-07-28; Phone-Home seit v0.4.3) — sie ist aber der E0-Ausgangsbefund, keine neue Lage, und deren jüngster Commit („retry failed journal emails and quarantine") repariert **nachgelagert**, was ein Acceptance-Contract vorne verhindert. Gegen den Neubau sprach die Messung: `packages/journaling` sind 2.018 Zeilen mit `types` als einziger Abhängigkeit und wandern mit, aber `packages/backend` (16.348) und `packages/frontend` (17.842) wären nachzubauen — für eine Funktion, die nach `JR-12-01` ohnehin ein Flag ist. **Kein Code geändert**, fünf Dokumente. | **E3** nach `07-session-handover.md`. Zwei Tasks sind nach ADR-021 erst beim Erreichen ihres Epics anzulegen (ADR-025, letzter Abschnitt) — die Nummer `JR-12-06` ist dafür **vergeben** und darf nicht wiederverwendet werden |

| 2026-08-01 | **`ADR-026` entschieden und umgesetzt (Auftraggeber): Task-IDs schreiben sich `JR-<Epic>-<NN>`.** Ohne Trennzeichen war `JR-1101` nicht eindeutig lesbar — „Epic 1, Task 101" oder „Epic 11, Task 01". Dass es bisher trug, lag allein daran, dass niemand E1…E9 über Task 06 hinaus nummeriert hat; mit E10 bis E13 im Backlog war die Kollision keine theoretische mehr. Umgestellt wurden **1778 Vorkommen in 75 Dateien, 130 verschiedene IDs**, mechanisch und deterministisch (dreistellig ⇒ erste Ziffer ist das Epic, vierstellig ⇒ die ersten beiden), auf Weisung des Auftraggebers **auch in den abgeschlossenen Protokoll- und Abnahmeeinträgen** samt `11-archiv-e1.md`. **Keine Neuvergabe:** Epic, laufende Nummer und Suffix jedes Tasks sind unverändert, nur die Schreibweise nicht. **Eine Stelle ist eingefroren** — die Trigger-Fehlermeldung `(JR-205, ADR-009)` aus der **angewandten** Migration `0042_journal_ledger_append_only.sql` und die Assertion, die sie prüft; nach `CLAUDE.md` §5.2 wäre dafür eine neue Migration über die Append-Only-Funktion nötig, also ein Eingriff in die Manipulationssicherung für einen kosmetischen Gewinn. Zwei historische Abnahmezeilen behalten ihre **Suchmuster** (`kein JR-1xxx`), weil sie einen ausgeführten Befehl protokollieren. **Kein Verhalten geändert.** | **E3** nach `07-session-handover.md`. Neue IDs ab jetzt in der Form `JR-<Epic>-<NN>` vergeben; das Prüfmuster für „keine internen IDs in der öffentlichen Doku" steht in ADR-026 |

| 2026-08-01 | **E3 begonnen.** Branch `claude/journaling-e3-spool` vom Integrationsbranch (`944d9bd`) nach ADR-014. Der PO hat die acht Tasks nach Abhängigkeit statt nach Nummer geordnet — `JR-3-03` (FS-Port) **vor** `JR-3-01`, weil sonst der Schreibpfad zweimal geschrieben wird. **`JR-3-03` und `JR-3-01` sind erledigt** (Rolle DEV, zwei Commits `b35a0ca` und `021f8db`, je eine Scheibe nach ADR-021). `JR-3-03`: `SpoolFileSystem` mit `write`, Datei-`fsync` und **Verzeichnis-`fsync`** als drei getrennt abfangbaren Aufrufen, per Konstruktor injiziert, `NodeSpoolFileSystem` in Produktion, `FakeSpoolFileSystem` im Test — kein Monkey-Patching. `JR-3-01`: `<root>/{incoming,quarantine}/<shard>/<txid>.eml`, ULID vor dem Schreiben vergeben, Shard = erste zwei Hexzeichen von `SHA-256(txid)`, High-Water-Mark als **typisiertes** Ergebnis (kein SMTP-Code, der gehört zu E4). **Vom PO unabhängig nachgemessen**, nicht aus dem Bericht übernommen: `445 passed \| 2 skipped` bei 34 Dateien, `unit 335/335 · integration 92/92 · adversarial 18/18`; `suite-inventory.ts` je Scheibe im selben Commit fortgeschrieben; zod `^4.1.5` deckungsgleich mit `packages/backend`, keine Versionsdrift. **Zwei Befunde des PO beim Gegenlesen:** (1) `02-architektur.md` §3 beschrieb den Spool-Pfad **ohne** Shard-Ebene — Doku-Drift, hier korrigiert und um Layout, Sharding-Begründung und die Quarantäne-Zählung ergänzt. (2) Verzeichnis-`fsync` scheitert **auf Windows mit `EPERM`** (gemessen). Der Produktionspfad schluckt das **nicht** — `fs-port.ts:161` lässt den Fehler durch, der Empfang scheitert also laut statt still zu quittieren. Für `JR-3-06` heißt das: die Verzeichnis-fsync-Fälle sind auf diesem Host nicht aussagekräftig. | `JR-3-02` (Durable Write, streamender SHA-256, kein Vollpuffern) an DEV. **ADR-024 ist weiterhin offen** — für E3 unschädlich, keiner der acht Tasks erzeugt eine Produktionskette, aber **vor E4 zu entscheiden** |

| 2026-08-01 | **`JR-3-02` erledigt (Rolle DEV, `ee8b7f4`) — Durable Write.** `writeDurableSpoolFile(fs, {spoolRoot, txid, chunks})` streamt aus einem `AsyncIterable<Uint8Array>` in `incoming/<shard>/<txid>.eml`: schreiben, sofort in den laufenden `sha256` falten, nie sammeln — dann Datei-`fsync`, `close`, Verzeichnis-`fsync`, und erst danach auflösen. Fehler sind typisiert (`DurableWriteError` mit Stufe und `cause`). **Der PO hat zwei Dinge nicht dem Bericht geglaubt, sondern selbst gemessen.** (1) Der Volllauf: `457 passed \| 3 skipped` bei 35 Dateien, `unit 347/347 · integration 92/92 · adversarial 18/18`. (2) **Mutationsprobe gegen den Buffer-Reuse-Test:** die Implementierung wurde testweise auf Vollpufferung umgebaut (Chunks sammeln, am Ende hashen) — **genau ein Test wurde rot**, der Streaming-Test, die anderen elf blieben grün; danach byteidentisch zurückgebaut (`git status` leer). Der Test kann also rot werden, und er isoliert die richtige Eigenschaft. Das war die Auflage aus Testplan §12.5 („zuerst rot gesehen") und die Absicherung gegen die Fehlerklasse F14/F15. (3) Der `nightly`-Fall — **150 MB durch das echte Dateisystem ohne proportionalen Heap-Anstieg** — wurde vom PO separat ausgeführt und ist grün (2,5 s). Er ist `nightly`, weil er im `ci`-Lauf nicht tragbar ist; die Streaming-Eigenschaft bleibt über den deterministischen Buffer-Reuse-Test trotzdem in **jedem** `ci`-Lauf belegt. **Eine vom DEV vorgelegte Entscheidung ist bestätigt:** `stage: 'write'` deckt auch `mkdir` und `createFile` ab — für den Aufrufer dasselbe Ereignis, und die Trennung `451`/`452` kommt ohnehin aus `cause` (`ENOSPC`) statt aus der Stufe. In `02-architektur.md` §3 festgehalten, samt der Auflage an `JR-3-06`, unter `'write'` auch mkdir und createFile zu injizieren. **Der `close()`-Fehler wird bewusst geschluckt** — nach erfolgreichem `fsync` ist die Durability erreicht und darf nicht durch einen Aufräumfehler in eine Ablehnung verwandelt werden; im Fehlerfall würde er den echten Fehler verdecken. | `JR-3-04` (zweiphasige Annahme verdrahten: Spool → Hash → Ledger → Erfolgssignal) an DEV |

| 2026-08-01 | **`JR-3-04` ist angefangen und NICHT fertig — die DEV-Sitzung ist an einem Kontingentlimit abgebrochen**, nicht an der Aufgabe. Als `5f9f98c` **wip** gesichert, damit 703 Zeilen nicht verloren gehen und die nächste Sitzung nicht bei null anfängt: `spool/acceptance.ts` (301 Zeilen) verdrahtet High-Water-Mark → Durable Write → Ledger-Append → typisiertes Ergebnis, dazu 402 Zeilen Tests. **`tsc` sauber.** Vom PO gemessen statt vermutet: **13 von 14 Tests grün**, und der eine rote ist ausgerechnet die empirische Hälfte des schärfsten Kriteriums („berührt den Spool nicht erneut, nachdem `append()` aufgelöst hat“). Er scheitert an `expect(calls).toBe(1)` mit `calls === 0`, der Ledger wurde also **gar nicht erreicht**; der ungewrappte Happy-Path-Test daneben erreicht ihn und ist grün, einziger Unterschied ist der `timelineFileSystem`-Wrapper — das deutet auf **Instrumentierung im neuen Test**, nicht auf eine Vertragsverletzung. Diagnose ist Sache der nächsten DEV-Sitzung, das hier ist Indiz und kein Urteil. **Zwei weitere Lücken:** kein Integrationstest durch einen **nackten** `postgres()`-Client (F38-Auflage unerfüllt, alle 14 laufen gegen Fakes), und `suite-inventory.ts` ist **absichtlich nicht** fortgeschrieben — das Inventar für unabgenommene Arbeit hochzusetzen wäre das falsche Signal. **Der Branch ist damit bewusst rot**, wie `JR-13-01` es schon einmal war. **Warum wip statt revert:** der strukturelle Entwurf trägt und ist dokumentiert — `buildAcceptedTransaction(txid, await backend.append(request))` ist **eine** Anweisung, und der Builder nimmt weder `SpoolFileSystem` noch `LedgerBackend` entgegen, hat also gar keine Fähigkeit zu I/O. Dieselbe Technik wie `ledger-port.ts`, andersherum angewandt. | `JR-3-04` zu Ende bringen: den roten Test diagnostizieren, den F38-Integrationstest nachziehen, Inventar fortschreiben |

| 2026-08-01 | **`JR-3-04` ist fertig und abgenommen** (Rolle DEV, `39404cf` auf dem wip, ohne History-Rewrite). **Der rote Test war ein Testfehler, kein Vertragsbruch — und `acceptance.ts` ist seit dem wip byteidentisch unverändert**, vom PO per `git diff` belegt. Ursache: `fakeBackend()` gab `calls` als **Getter** zurück, und der Test destrukturierte ihn (`const { backend, calls } = …`). Destrukturierung wertet einen Getter **einmal** aus und kopiert den Schnappschuss heraus — keine lebende Bindung. Der Getter wurde vor dem ersten `append()` gelesen, `calls` blieb `0`. Behoben, indem der Getter **entfernt** statt umgangen wurde; der Test zählt jetzt `requests.length` über eine Array-Referenz. **PO-Mutationsprobe, unabhängig von der des Entwicklers:** ein `await this.fs.stat(…)` **nach** dem Ledger-Append eingesetzt ⇒ **drei** Tests rot, danach byteidentisch zurück (`git status` leer). Zwei Erkenntnisse daraus: (a) der strukturelle Schutz trägt — um überhaupt etwas einfügen zu können, musste die **eine** Anweisung `buildAcceptedTransaction(txid, await backend.append(request))` erst in zwei zerlegt werden, also genau der sichtbare Diff entstehen, der als Schutz beschrieben ist; (b) **eine Beobachtung für `JR-3-05` und E4:** eine fehlschlagende Operation nach dem Append wird vom umgebenden `try`/`catch` als `'ledger-append-failed'` **fehlklassifiziert** — der Append war erfolgreich, gemeldet würde sein Scheitern. Real wird das, wenn `append()` nach dem Commit auf dem Rückweg scheitert: E4 antwortet `451`, der Sender wiederholt, und es entstehen **zwei** Ledger-Einträge für eine Nachricht. Nach Skill §5 ist das korrekt (Empfangsereignisse, keine Nachrichten), **setzt aber die Dedup auf `content_sha256` mit `duplicate_of` voraus** — `JR-3-05`/E6 müssen das tragen, nicht annehmen. **F38-Auflage erfüllt:** neuer Integrationstest durch eine **eigene** `postgres()`-Verbindung, die nirgends an `drizzle()` gereicht wird. Dabei ein Befund von projektweiter Bedeutung: **`harness.sql` sieht nackt aus und ist es nicht** — `pg-harness.ts` ruft auf demselben Objekt `drizzle(client, {schema})` auf, und `drizzle()` patcht die Instanz statt sie zu umhüllen. Das ist die mechanische Erklärung dafür, dass acht Integrationstests an F38 vorbeiliefen, ohne dass einer schlampig war; als Regel in `04-testplan.md` §2.6 aufgenommen. **Vom PO nachgemessen:** `473 passed \| 3 skipped` bei 37 Dateien, `unit 361/361 · integration 94/94 · adversarial 18/18`, Exit 0. **Betriebshinweis des Entwicklers:** `packages/journaling/dist` war veraltet und auf`@open-archiver/journaling` auflösende Tests scheiterten mit `JournalAcceptance is not a constructor` — nach Änderungen an `src/` erst bauen. | `JR-3-05` (Crash-Recovery-Scan) an DEV |

| 2026-08-01 | **`JR-3-05` erledigt und abgenommen** (Rolle DEV, `8ce7bb6`) — Crash-Recovery-Scan. `runCrashRecoveryScan()` listet `incoming/`, schlägt **alle** txids in **einer** Abfrage nach (`findBySpoolTxIds()` → `WHERE spool_txid = ANY($1)`, gegen den seit `JR-2-04` bestehenden Index `journal_ledger_spool_txid_idx`) und entscheidet je Datei: Ledger-Eintrag vorhanden ⇒ Requeue-Kandidat, Datei bleibt liegen; kein Eintrag ⇒ `rename()` nach `quarantine/` **plus Alert** über eine injizierte Senke. **Kein Löschpfad — strukturell:** `SpoolFileSystem` hat sechs Methoden und `delete`/`unlink` ist keine davon, ein Regress bräuchte also einen sichtbaren Diff an `fs-port.ts`. **Vom PO nachgemessen:** `486 passed \| 3 skipped` bei 40 Dateien, `unit 371/371 · integration 97/97 · adversarial 18/18`; Index im Migrationstext bestätigt. Die Stapelabfrage statt N Einzelabfragen war eine Entwurfsentscheidung des Entwicklers und ist **richtig**: nach einer längeren Störung hätte ein Aufruf je Datei tausende serielle Roundtrips vor der ersten Annahme bedeutet. | **`JR-3-06`** (fsync-Fault-Injection) an TEST — mit der Auflage aus `JR-3-02`, unter `'write'` auch `mkdir` und `createFile` zu injizieren |

| 2026-08-01 | **PO-Befund bei der Abnahme von `JR-3-05`: `02-architektur.md` §5 war unterbestimmt — der Befund liegt in der Vorgabe, nicht im Code.** Der Scan entscheidet **allein am Ledger**, ohne Dateialter und ohne lokalen Zustand. Für den Absturzfall ist das genau richtig, und `JR-3-05` baut es bewusst so. Dadurch ist eine Transaktion **mitten in Phase A** vom Ledger aus aber nicht von einem Absturz zu unterscheiden — Bytes gefsynct in `incoming/`, Append noch offen. Läuft der Scan in diesem Moment, wandert die Datei in die Quarantäne, **danach** gelingt der Append, `250` geht raus, und der Ledger zeigt auf einen Pfad, an dem nichts mehr liegt. Kein Datenverlust, aber Phase B findet das Objekt nicht und die Vollständigkeitsargumentation zeigt eine Lücke mit einer harmlosen Erklärung, auf die niemand schnell kommt. Real wird das über die Prozesstopologie, nicht über exotisches Timing: Ingress und `journal-inbound`-Worker sind eigene Prozesse und starten unabhängig neu. **Als R-20 aufgenommen; `02-architektur.md` §5 trägt jetzt zwei verbindliche Vorgaben für E4/E6** — der Scan läuft **vor** dem Binden von Port 25 und **exklusiv** über einem Spool. Eine mtime-Schwelle ist ausdrücklich **keine** Lösung: sie ersetzte eine belegte Entscheidung durch eine geratene. **Der vom Entwickler vorgelegte `ENOENT`-Fall ist bestätigt und bleibt** (Scan gegen Scan: schon verschoben ⇒ kein Fehler, kein zweiter Alert), deckt aber ausdrücklich **nicht** Scan gegen laufende Annahme. | — |

| 2026-08-02 | **`JR-3-06` und `JR-3-07` erledigt (Rolle TEST, `7550a20` und `dd9ed2f`) — und die Scheibe hat getan, wofür sie da ist: sie hat etwas gefunden.** Die Sitzung endete **ohne Bericht**; der PO hat den Branchzustand deshalb ohne Vorlage geprüft, die Commit-Botschaften tragen die Begründung. **Nachgemessen:** `505 passed \| 5 skipped` bei 42 Dateien, `unit 371/371 · integration 97/97 · adversarial 37/37` — die adversariale Klasse ist von 18 auf 37 gewachsen. `JR-3-06` greift `accept()` an **allen fünf** Teiloperationen an, nicht an den drei des Backlogtextes; dafür musste `FakeSpoolFileSystem` um `failNextMkdir()` ergänzt werden — `mkdir` war **über keinen Einstiegspunkt** injizierbar, die PO-Auflage aus `JR-3-02` war also nicht nur unerfüllt, sondern unerfüllbar. `JR-3-07` liefert die geforderten zwei Teile: ein `ci`-Test durch die Naht (ENOSPC- **und** High-Water-Mark-Route, plus zwanzig abgewiesene Transaktionen ohne einen einzigen Ledger-Eintrag) und eine `manual`-Suite hinter `OA_TEST_SPOOL_DISKFULL_ROOT` für ein echtes größenbegrenztes Volume. **Sie ist auf diesem Host sichtbar übersprungen mit genanntem Grund, nicht still grün** — vom PO im Lauf bestätigt. **PO-Entscheidung dazu:** Testplan §12.3 nannte den echten Volume-Fall `nightly`; auf `manual` korrigiert, weil `nightly` unterstellt, er liefe irgendwo automatisch — er läuft nirgends, solange kein Linux-Host dafür bereitsteht. | **F40 entscheiden** (siehe nächste Zeile), dann `JR-3-08` — Abnahme E3 durch eine **frische** `tester`-Sitzung, die diese Tests nicht geschrieben hat |

| 2026-08-02 | **F40 aufgenommen — der Befund aus `JR-3-06`, gemeldet und bewusst nicht behoben.** Drei der fünf Teiloperationen (`write()`, Datei-`fsync`, Verzeichnis-`fsync`) hinterlassen bei einem **gewöhnlichen Laufzeitfehler** eine vollständige Spool-Datei ohne Ledger-Eintrag. **Das Nicht-Löschen ist richtig und bleibt** — Skill §3 verbietet es. Der Befund richtet sich gegen zwei Folgen: **(1)** `02-architektur.md` §5 behauptete, die liegengebliebene Datei sei „Beleg dafür, dass ein Absturz stattgefunden hat“. Sie ist es nicht — ein einzelner fehlgeschlagener `write()` erzeugt dieselbe Spur, und ein Test fädelt ein gescheitertes `accept()` direkt in `runCrashRecoveryScan()`, um zu zeigen, dass beides **ununterscheidbar** ist. Der Betreiber sucht einen Absturz, den es nie gab. **Satz korrigiert.** **(2)** Der eigentliche Schaden: `checkSpoolHighWaterMark()` zählt `quarantine/` bewusst mit (`JR-3-01`, richtig), aber **niemand leert die Quarantäne**. Wiederholte Schreibfehler füllen das Budget dauerhaft mit Rückständen, bis eine spätere, unabhängige, **gesunde** Transaktion mit `452` abgewiesen wird — die Fehlerbehandlung erzeugt den nächsten Ausfall. Zwei Richtungen stehen in F40, keine ist entschieden. | **Entscheidung des Auftraggebers:** F40 vor der Abnahme von E3 beheben oder danach |

| 2026-08-02 | **`JR-3-09` erledigt und abgenommen** (Rolle DEV, `45d00b7` + `3994e59`) — F40, Hälfte 1. Der Annahmepfad räumt seinen eigenen Rest: `quarantineSpoolFile()` wurde aus `crash-recovery.ts` herausgelöst und wird jetzt von **beiden** Pfaden benutzt, mit `QuarantineReason = 'no-ledger-entry' \| 'write-failed'`. **Kein Löschen** — nur `mkdir` + `rename`, und `SpoolFileSystem` hat weiterhin **keine** Löschmethode (vom PO nachgeprüft). Zwei Entwurfsentscheidungen, beide richtig: **(a)** Die Aufräumaktion wirft nie — sie läuft in einem `catch`, das den echten `DurableWriteError` schon hält, und ein zweiter, unabhängiger Fehler darf die Ursache für `451`/`452` nicht ersetzen. Schlimmstenfalls bleibt der Rest liegen wie zuvor und `JR-3-05` fängt ihn beim nächsten Start unter `'no-ledger-entry'` — schlechtere Diagnose, nie eine verlorene Nachricht. **(b)** Die fünf Teilfehler brauchen **keine** Fallunterscheidung: `rename()` wird immer versucht, `ENOENT` gilt als „nichts zu quarantänisieren“, womit `mkdir`- und `createFile`-Fehler ohne Sonderfall durchfallen. | **`JR-3-08`** — Abnahme E3 durch eine **frische** `tester`-Sitzung |

| 2026-08-02 | **PO-Nachforderung zu `JR-3-09`, und der Vorgang ist wichtiger als die Änderung.** Beim Gegenlesen fiel auf: `alertSink` war **optional** mit still verwerfendem Default, während derselbe Sink in `crash-recovery.ts` **Pflicht** ist. `apps/smtp-ingress` — das E4 erst schreibt — hätte ihn weglassen können: kein Compilerfehler, kein roter Test, kein Hinweis. Das ist **R-09** in den Konstruktor eingebaut und bricht den Standard, den dieses Modul sonst überall hält — **strukturell statt diszipliniert** (`LedgerAppendRequest`, `buildAcceptedTransaction`, die fehlende Löschmethode). Die Begründung für die Optionalität war, dass alle Aufrufer unverändert kompilieren: ein Migrationsargument, kein Sicherheitsargument — und der Compilerbruch ist genau das Signal, das E4 am Vergessen hindert. **Nachgezogen in `3994e59`:** Pflichtfeld, `DISCARDING_ALERT_SINK` entfernt, **31 Konstruktionsstellen** in 4 Dateien ziehen einen expliziten Sink nach; wer Alarme ignoriert, tut das jetzt sichtbar an der Aufrufstelle. **Vom PO nachgemessen:** `505 passed \| 5 skipped` bei 42 Dateien, `unit 371/371 · integration 97/97 · adversarial 37/37` — unverändert zur Basis, `suite-inventory.ts` unberührt, der Diff an `acceptance.ts` berührt **nur** Doku, Feld und Konstruktor, der Erfolgspfad ist unangetastet. **Verfahrensbefund — und er ging zunächst gegen die falsche Seite.** Erste Fassung dieser Zeile hielt fest, die beauftragte Sitzung sei nach der Nachforderung in den Leerlauf gegangen, **ohne sie umzusetzen und ohne zu widersprechen**. Das war der Stand, den der PO gemessen hatte (Arbeitsbaum sauber, `alertSink` weiterhin optional) — **und es war trotzdem falsch.** Die Sitzung hat die Nachforderung umgesetzt, der Argumentation ausdrücklich zugestimmt und berichtet; ihr Bericht traf nur **nach** dem Messpunkt ein. **Der eigentliche Fehler lag beim PO:** er hat aus einer Leerlaufmeldung auf Untatätigkeit geschlossen und eine **zweite** Sitzung für Arbeit beauftragt, die bereits lief. Folge: **zwei Sitzungen waren gleichzeitig auf demselben Arbeitsbaum** — hier folgenlos (die zweite fand die unversionierte Vorarbeit, prüfte sie und stellte fertig, es entstand genau ein Commit `3994e59`), aber es hätte ebenso gut zwei einander überschreibende Schreibläufe geben können. **Zwei Regeln daraus:** (1) Eine Leerlaufmeldung belegt **nicht**, dass eine Sitzung fertig ist — sie kann dem Bericht vorauseilen. Sie löst eine Prüfung des Branchzustands aus, **aber keine Neubeauftragung**. (2) Zwei Sitzungen dürfen nie gleichzeitig auf denselben Arbeitsbaum — wer parallelisieren will, braucht Worktree-Isolation, nicht Vorsicht. | — |

| 2026-08-02 | **`JR-3-08` durchgeführt — Ergebnis: E3 ist abgenommen, 21 von 21** (Rolle TEST, frische Sitzung, die keine Zeile davon geschrieben hat). Die Kriterien sind aus `03-backlog.md` in **atomare Klauseln** zerlegt und einzeln durchnummeriert, die Kopfzahl ist nachzählbar — die Auflage aus `JR-2-10a` ist eingehalten. Der Prüfer hat **nichts committet** und den Baum byteidentisch hinterlassen (vom PO geprüft). Klassen: `ci` `505 passed \| 5 skipped` bei 42 Dateien (deckungsgleich mit der behaupteten Basis), `nightly` 2/2 inklusive des 150-MB-Falls, `manual` — die `JR-3-07`-Suite ist **sichtbar** übersprungen und nennt win32 ausdrücklich als **unfähig**, nicht bloss ungeprüft. Zwei Kriterien tragen eine Host-Einschränkung statt eines Häkchens: die Hash-Gleichheit gegen echte Platte und der echte Volume-Fall — beide benannt, keins stillschweigend übersprungen. | **F41 entscheiden**, dann Rückmerge nach ADR-014 (Entscheidung des Auftraggebers) |

| 2026-08-02 | **F41 aufgenommen — und er korrigiert den PO.** Der Prüfer hat eine **dritte**, andere Mutationsprobe gegen die Zusage „nach dem Ledger-Append kann nichts mehr scheitern“ gefahren und dabei ein Loch im Testnetz gefunden: `timelineFileSystem()` (`acceptance.test.ts:141–143`) reicht **`readdir`, `stat` und `rename` ungetrackt durch**, `FakeSpoolFileSystem` protokolliert sie ebenfalls nicht. Eine Regression, die nach dem Append eine dieser drei einfügt und **gelingt**, bliebe unbemerkt; der Dokukommentar in `acceptance.ts` behauptet mehr, als das Netz hält. **Der PO hat den Befund unabhängig belegt** — nicht über die berichtete Reproduktion, die sich bei ihm **nicht** nachstellen liess (bei ihm wurden 3 Tests rot, nicht 14 grün), sondern direkt am Quelltext der Instrumentierung. **Was der PO daraus über sich selbst lernt:** seine beiden früheren Proben (zweiter `append()`, `fs.stat()` danach) wurden rot und galten ihm als Bestätigung des Netzes. Sie waren es nicht — sie wurden rot, weil die eingefügte Operation **scheiterte** und der umgebende `catch` sie als `'ledger-append-failed'` meldete, nicht weil ein Test sie **bemerkt** hätte. **Regel:** wer ein Netz per Mutation prüft, wählt eine Mutation, die **nur** über das Netz auffallen kann — also eine **gelingende** Operation. **Die strukturelle Zusage bleibt unberührt**, deshalb niedrig eingestuft und kein Ablehnungsgrund. | **Entscheidung des Auftraggebers 2026-08-02: vor dem Rückmerge beheben** — erledigt, siehe nächste Zeile |

| 2026-08-02 | **F41 behoben (`fe5b410`) und die Selbstkorrektur, die dabei herauskam.** `timelineFileSystem()` erfasst jetzt alle neun Operationen; `readdir`, `stat` und `rename` liefen bis dahin ungetrackt durch. Nachweis über drei Proben mit **gelingender** Operation, jede meldet `expected 'fs:<op>' to be 'ledger-append'`. **Vom PO nachgestellt:** zwei Zusicherungen rot, `ledger-append-failed`-Test **grün** — also beobachtet, nicht geworfen. Volllauf `505 passed \| 5 skipped` bei 42 Dateien, `suite-inventory.ts` unberührt (keine neuen Tests, nur mehr Instrumentierung). **Und jetzt der Teil, der den PO betrifft:** seine Mutationsproben gegen diese Zusage sind **nie ausgeführt worden**. Er schrieb `written.filePath`; die Variable heißt im Code `durable`. Jede Probe starb an einem `ReferenceError` **vor** dem beabsichtigten Aufruf und wurde vom `catch` als `'ledger-append-failed'` gemeldet — ununterscheidbar von einer Probe, die etwas belegt. Betroffen ist die Schlussfolgerung aus `JR-3-04` („drei Tests rot“) und die erste Fassung von F41. **Was davon stehen bleibt:** die **strukturelle** Zusage — `buildAcceptedTransaction()` besitzt keine I/O-Fähigkeit, und die eine Anweisung zu zerlegen ist ein sichtbarer Diff — hängt an keiner Probe und ist unberührt; sie ist inzwischen dreifach unabhängig belegt. **Was fällt:** die Behauptung, das Testnetz habe die Zugriffe bemerkt. Das tat es bis `fe5b410` nicht. **Regel:** eine Mutationsprobe muss belegen, dass sie tat, was sie tun sollte — die Fehlermeldung muss die erwartete Zusicherung nennen, sonst beweist „rot“ nur, dass irgendwo etwas geworfen hat. | Rückmerge E3 nach ADR-014, dann ADR-024 |

| 2026-08-02 | **Rückmerge E3 vollzogen** (`185e9bd`, `--no-ff`, **kein Squash**, wie bei E1, E13 und E2). Verifiziert: **zwei Eltern** (`9725a5d` und `d0628ad`), Baum **byteidentisch** zum E3-Kopf, Volllauf auf dem Integrationsbranch `505 passed \| 5 skipped` bei 42 Dateien, `unit 371/371 · integration 97/97 · adversarial 37/37`. Der Merge-Commit wurde erzwungen, obwohl der Integrationsbranch Vorfahr war — er markiert die Epic-Grenze. `main` unangetastet, kein Pull Request. **Dabei ein Vorfall, der ohne den Zustandsabgleich unbemerkt geblieben wäre:** der Remote-Integrationsbranch stand bereits auf `9725a5d`, also **mitten in E3** — elf Commits E3-Arbeit waren dort gelandet, **lange bevor `JR-3-08` sie abgenommen hatte**. Ursache: `git checkout -b <epic> origin/<integration>` — das Rezept aus dem Handover — setzt den **Upstream des Epic-Branches auf den Integrationsbranch**, ein Push aus dem Epic-Branch landet also dort. Der Reflog belegt es (`update by push`). **Verloren ging nichts** (`9725a5d` ist Vorfahr des E3-Kopfes) und **umgeschrieben wurde nichts** — die veröffentlichte Historie bleibt, der `--no-ff`-Merge setzt die Epic-Grenze nachträglich korrekt. **Geschlossen:** `push -u` beim Anlegen ist jetzt Teil des Rezepts in `07-session-handover.md` **und** der Git-Regeln in `CLAUDE.md` §7; der E3-Branch hat seinen eigenen Upstream bekommen. **Die Lehre ist nicht „Agenten pushen unerlaubt“, sondern: der PO hat einen Branch angelegt, dessen Upstream auf den falschen Zweig zeigte, und es zehn Commits lang nicht gemerkt.** | **ADR-024** — Betriebsmodell, vor E4 fällig |

| 2026-08-02 | **`ADR-024` entschieden (Auftraggeber) — damit ist vor E4 nichts mehr offen, was E4 blockiert.** Betriebsmodell: **ein vollständig getrennter Stack je Endkunde**, geteilter Postgres-Server mit eigener Datenbank und Rolle als dokumentierte Dichteoption; der geteilte Stack mit nachgerüsteter Tenant-Spalte bleibt verworfen. **Betriebsverantwortung mitentschieden, zweiphasig:** Phase 1 betreibt der **Endkunde selbst**, später bietet der Auftraggeber den Betrieb **zusätzlich** als Dienst an; beide Phasen bestehen dann nebeneinander. **Der Punkt, an dem man sich verrechnet, ist in der ADR jetzt eine Tabelle:** die Quelltextpflicht besteht in **beiden** Phasen, nur der Paragraf wechselt — Phase 1 ist _conveying_ nach AGPL §4–§6 (geschuldet dem Kunden als Empfänger), Phase 2 zusätzlich §13 (geschuldet den Nutzern der betriebenen Instanz). **Phase 1 befreit also nicht, sie verschiebt nur.** Erfüllt wird beides von **einem** Artefakt, dem Quelltext-Angebot in der UI aus ADR-025 — Phase 2 kostet dafür keinen Zusatzaufwand, nur einen anderen Adressaten. **Zwei Folgen sind nachgetragen:** (1) In Phase 1 ist **der Kunde der Betreiber** — Aufbewahrungsfrist, Object-Lock-Modus, TSA, Schlüssel, Monitoring und Verfahrensdokumentation entscheidet er, und `JR-12-04`s „von einem Betreiber ohne Codekenntnis befolgbar“ ist damit keine Stilfrage, sondern die Zielgruppe; R-02 (Object Lock ist irreversibel) trifft dann ihn. (2) **R-18 wird in Phase 2 vom Einzelfall zum Systemrisiko** — wer N Kundeninstanzen selbst betreibt, greift zum Golden Image, und ein Image **nach** dem Migrationslauf gibt fremden Kunden dieselbe `deployment_id`. Die Provisionierungs-Checkliste (Konsequenz 2) wird damit von einer Empfehlung zur **Betriebsvorschrift**. **Neu offen, bewusst nicht entschieden:** das **Haftungsprofil** für Phase 2 — Verfügbarkeitszusagen, Wiederanlaufzeiten, Aufbewahrung fremder Daten, wer im Prüfungsfall Auskunft gibt. Keine Architekturfrage; vermerkt, damit sie beim Übergang zu Phase 2 nicht zwischen zwei Epics verschwindet. **Die Folgetasks entstehen nach ADR-021 erst, wenn E12 ansteht**; die Liste in der ADR ist bis dahin die Vorlage. | **E4** — `smtp-ingress`-Service, 13 Tasks (`JR-4-01`…`JR-4-13`) |
