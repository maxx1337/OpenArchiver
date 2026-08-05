# Archiv: Protokolle der abgenommenen Epics E13 und E2

**Ausgegliedert aus `06-status.md` am 2026-08-03** im Rahmen der Doku-Diät (Entscheidung des
Auftraggebers nach einer Kostenprüfung). **Inhaltlich ist nichts gekürzt** — die Abschnitte stehen
hier unverändert, Zeichen für Zeichen, wie sie im Status standen.

Grund: die Pflichtlektüre des Projekts war auf rund 170 000 Tokens gewachsen, davon allein 105 000
in `06-status.md`. Was hier liegt, ist **abgeschlossen und abgenommen** — es wird nicht mehr für die
nächste Task gebraucht, sondern nur, wenn jemand die Historie rekonstruiert.

Enthalten: die vier E13-Abnahmerunden (`JR-13-09` bis `JR-13-09c`) mit ihren Nacharbeiten, und die
zwei E2-Abnahmerunden (`JR-2-10`, `JR-2-10a`). Beide Epics sind abgenommen und zurückgemergt —
E13 am 2026-07-30 (`89d701f`), E2 am 2026-08-01 (`eb340a9`).

---

## E13 — IAM-Autorisierung härten: die vier Abnahmerunden

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

---

## E2 — Ledger und Hash-Chain: die zwei Abnahmerunden

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
