# Session-Handover

Diese Datei beantwortet zwei Fragen: **wie startet man eine Session**, und **was ist der nächste
konkrete Schritt?** Der untere Teil wird am Ende jeder Session überschrieben (nicht angehängt — die
Historie steht im Sessionprotokoll in `06-status.md`).

> **Wer nach dem Schreiben dieses Handovers noch committet, aktualisiert ihn im selben Zug.** Der
> Handover ist das **letzte** Artefakt einer Session, nicht ein mittleres. Am 2026-07-28 ist genau das
> schiefgegangen: der Tester schrieb ihn in `69f7d68`, danach kamen Merge und ein neuer Task — und der
> Handover führte den längst vollzogenen Rückmerge weiter als „offene Entscheidung des
> Auftraggebers". Eine Folge-Session hätte auf falscher Grundlage gearbeitet. Gegenprobe vor dem
> Sessionende: lässt sich „was ist der nächste Schritt und welche Dateien betrifft er?" **allein** aus
> `README.md` → `06-status.md` → dieser Datei beantworten?

---

## Wie eine Session gestartet wird

Es muss nichts erklärt werden. `CLAUDE.md` wird automatisch gelesen und verweist auf
`docs/dev/journaling/README.md`; die Subagents `senior-dev` und `tester` sowie die Skills
`journal-ledger`, `oa-migration` und `oa-i18n` sind registriert und greifen von allein. Ein Einzeiler
genügt.

**Arbeitsstart (der Normalfall):**

```
Weiter mit dem Journaling-Projekt. Lies docs/dev/journaling/07-session-handover.md
und arbeite den nächsten Schritt ab.
```

**Gezielte Tasks:**

```
Arbeite JR-101 bis JR-104 aus docs/dev/journaling/03-backlog.md ab.
```

**Unabhängige Abnahme:**

```
Nimm Epic 1 unabhängig ab — Rolle Tester, Kriterien aus 03-backlog.md.
```

**Sessionende** (die Rolle `senior-dev` macht die Statuspflege laut Definition of Done selbst; dieser
Prompt ist für den Fall, dass eine Session abrupt endet):

```
Aktualisiere 06-status.md und 07-session-handover.md, committe und pushe.
```

### Immer zuerst

1. **Gegen das Remote abgleichen — vor allem anderen.** Der Container kann auf einen **älteren Stand
   zurückgesetzt** worden sein, während alles unverdächtig aussieht: Arbeitsbaum sauber,
   `node_modules` inklusive `vitest` vorhanden, die Dateien der letzten Epics scheinbar da. Der
   **Reflog zeigt die verlorenen Commits dann nicht** — sie existieren im Container gar nicht.

    ```bash
    git fetch origin <branch>
    git log --oneline -1                      # lokaler Stand
    git ls-remote origin refs/heads/<branch>  # tatsächlicher Remote-Stand
    ```

    Weichen sie ab: `git merge --ff-only origin/<branch>`. Bewusst `--ff-only` und **nicht**
    `reset --hard` — es schlägt fehl, falls der Stand wirklich divergiert, statt stillschweigend etwas
    zu verwerfen.

    Am 2026-07-28 ist genau das passiert: lokal `36cf6bd`, remote `653dd1c`, drei Commits fehlten.
    Wer das nicht prüft, arbeitet gegen eine veraltete Basis — damals gegen die **unbehobene**
    F12-Version des Test-Harness.

2. **`pnpm install`** — der Container ist flüchtig, `node_modules` fehlt in jeder neuen Session.
   Ohne das läuft weder `pnpm lint` noch ein Build noch `pnpm test`.
3. **Auf den richtigen Branch wechseln.** Epic-Arbeit läuft nie direkt auf dem Integrationsbranch:

    ```bash
    git fetch origin claude/enterprise-product-implementation-cxmmqe
    git checkout -b claude/journaling-e<N>-<kurzname> \
        origin/claude/enterprise-product-implementation-cxmmqe
    ```

    Regeln in `05-entscheidungen.md` (ADR-014) und `CLAUDE.md` §7. Grundlagenarbeit (Doku, ADRs,
    Agent-Infrastruktur) gehört direkt auf den Integrationsbranch.

---

## Aktueller Eintrag

**Stand:** 2026-07-29 (`JR-1301` erledigt) · **Branch:** `claude/journaling-e13-iam-hardening`
(Epic-Branch, abgezweigt vom Integrationsbranch bei `efea6bc`)

### Was zuletzt passiert ist

**`JR-1301` ist erledigt (Rolle `tester`). Der Epic-Branch ist absichtlich rot.**

```
DATABASE_URL=… OA_TEST_REQUIRE_INFRA=1 pnpm test
 Test Files  6 failed | 10 passed (16)
      Tests  21 failed | 203 passed | 2 skipped (226)      EXIT=1
```

> **Diese 21 roten Tests sind das Arbeitsergebnis, nicht ein Schaden.** E13s Reihenfolge ist
> rot → Fix → grün; ein Test, der nie rot war, belegt nichts. `ci.yml` feuert auf `push`, der Branch
> zeigt also rote CI-Läufe, bis `JR-1302`–`JR-1306` gelandet sind. **Nicht durch Abschwächen der Tests
> „reparieren".** Bis `JR-1301` hielten dieselben Tests F1/F3/F7/F8 als _bestanden_ fest, teils per
> `it.fails` — ein grüner Test, der eine Sicherheitslücke beschreibt. Genau das war der Defekt.

Jeder rote Test trägt `RED UNTIL JR-13xx` im Namen, ist also im Lauf sichtbar und filterbar:
`pnpm test -t "RED UNTIL JR-1302"`. Zuordnung: `JR-1302` 5 · `JR-1303` 1 · `JR-1304` 7 ·
`JR-1305` 3 · `JR-1306` 5. Es gibt **keinen** Opt-out-Schalter — Begründung in `06-status.md`.

**ADR-017s Wirkungsanalyse hält, jetzt belegt statt hergeleitet.**
`packages/backend/tests/integration/predefined-roles.int.test.ts` legt die drei `predefined_*`-Rollen
über Produktionscode an und zeigt: keine trifft an einer der drei tatsächlich benutzten
(Action, Subject)-Paare den `null`-Zweig, und `('archive','read')` und `('archive','search')` liefern
je Rolle **identische** Ergebnisse. `JR-1303` ist damit für eine Standardinstallation belegbar
wirkungsfrei. Diese Datei ist grün und muss grün bleiben.

**Sieben neue Befunde `F17`–`F23`**, zwei davon mit Gewicht für E13:

- **F17** — `predefined_end_user` und `predefined_read_only_user` werden in einer echten Installation
  **nie angelegt**: `createAdminRole()` legt bei der Ersteinrichtung `predefined_super_admin` an und
  erfüllt damit dauerhaft den Bootstrap-Auslöser `!roles.some(r => r.slug?.includes('predefined_'))`.
  Folge: ausgeliefert gibt es **keine Read-Only-Rolle**, jede eingeschränkte Rolle ist handgeschrieben
  und hat die Form von `auditor-specific-mailbox.json` — genau die Form, die F7 unwirksam macht.
  **`JR-1307` muss das aufnehmen**; die entschärfte Fassung bleibt richtig.
- **F18** — ADR-017s „keine der drei Rollen trifft den `null`-Zweig" gilt **je Aufrufstelle, nicht je
  Rolle**: über das volle Vokabular treffen 39 bzw. 46 von 56 Paaren den Zweig. Heute harmlos; das
  Aufrufstellen-Inventar in `tests/unit/filter-builder-call-sites.test.ts` wacht darüber.

Außerdem: **F1 ist erstmals gegen echtes Postgres ausgenutzt** — von vier Payloads läuft genau einer,
und er hebt über drizzles unklammerte `and()`-Verkettung auch die Einschränkung des **Aufrufers** auf.
F3s `$or`-Beispiel beschreibt die Wirkungsrichtung falsch (**F22**: Verengung, nicht Erweiterung; die
fail-open-Richtung liegt beim `$and` und bei den Leerheits-Fällen). Zwei zusätzliche Fail-open-Formen
in `FilterBuilder`: **F19** (`can` mit leerem `conditions`) und **F20** (unbedingtes `cannot` wird
ignoriert) — beide inhaltlich in `JR-1302`/`JR-1304` mitzubehandeln, beide bereits rot.

**Kein Produktionscode geändert** (`git diff --stat -- packages/backend/src ':!*.test.ts'` ist leer),
`pnpm lint` grün, `pnpm --filter @open-archiver/backend test:types` grün, Backend-Build grün, 0
`oa_test_*`-Rückstände, lokaler PostgreSQL-16.13-Cluster restlos entfernt.

### Was davor passiert ist

**ADR-017 ist entschieden: Variante B** (Auftraggeber, 2026-07-29). Der Action-Versatz wird dort
aufgelöst, wo der Filter gebaut wird, nicht am Route-Gate:

```diff
  # packages/backend/src/services/SearchService.ts, Zeilen 311 und 423
- const { searchFilter } = await FilterBuilder.create(userId, 'archive', 'read');
+ const { searchFilter } = await FilterBuilder.create(userId, 'archive', 'search');
```

`api/routes/search.routes.ts` bleibt unverändert. `ArchivedEmailService.ts:62` bleibt auf `'read'`
(seine Routen gaten auf `read`), `IngestionService.ts:137` ebenfalls (Subject `ingestion`, kein
Versatz). Variante A ist verworfen, Variante C verworfen für E13 und als **`JR-1310`** nach E13
vorgemerkt — ausdrücklich **nicht** Teil der Abnahme `JR-1309`.

**Damit ist keine Entscheidung mehr blockierend für E13.** `JR-1303` ist von „PO entscheidet" auf
reine Umsetzung geschärft und gibt `JR-1302` frei.

**Eine frühere Aussage des PO ist korrigiert.** „Der F7-Fix bricht Bestandsinstallationen" war zu
scharf. Am Code nachgeprüft (`iam.controller.ts` `createDefaultRoles`, `UserService.ts:270`): keine der
drei `predefined_*`-Rollen erreicht den `null`-Zweig in `FilterBuilder.ts:49` — zwei erteilen
unbedingte `can`-Regeln und werden schon von Zeile 31 abgefangen, `predefined_end_user` hat
`manage archive` **mit** Bedingungen, woraus `rulesToQuery` eine echte Query liefert. Erreichbar ist
der Zweig über einen Nutzer **ohne Rolle**, eine `cannot`-only-Policy auf `archive`, und eine
handgeschriebene Rolle mit `search` ohne `read`. **F7 bleibt Schwere hoch** — die ersten zwei Formen
sind real, und die zweite ist genau die Form jeder scope-einschränkenden Auditor-Policy aus E11.
`JR-1307` ist entsprechend entschärft: die Prüfanleitung bleibt, die Pauschalwarnung fällt.

Geändert wurden nur `05-entscheidungen.md` (ADR-017 plus ein Platzhalter, der ADR-016 für `JR-1307`
reserviert — **die Nummernlücke ist Absicht, nicht umnummerieren**), `03-backlog.md` (`JR-1303`
geschärft, `JR-1307` entschärft, `JR-1310` angelegt), `09-befunde-bestandscode.md` (F7-Reichweite) und
diese beiden Statusdateien. **Kein Produktionscode.**

### Und davor

**E1 ist abgenommen.** Die erneute unabhängige Abnahme `JR-106a` (Rolle `tester`, eigene Session,
HEAD `0a94308`) hat **alle** `JR-106`-Kriterien noch einmal geprüft — nicht nur die Nacharbeit, weil
`JR-104a`/`JR-105b` `vitest.config.ts`, `classification.ts`, `pg-harness.ts` und `ci.yml` angefasst
hatten — plus die Kriterien von `JR-104a` und `JR-105b`. **Ergebnis: alle 20 geprüften Kriterien
erfüllt.** Die vollständige Tabelle mit Kommandos und Ausgaben steht in `06-status.md` unter „Abnahme
`JR-106a`".

Die Belege in Kurzform: `pnpm test` ⇒ `10 passed`, `197 passed | 2 skipped`, Exit `0`; Sonden in
`packages/types/` und `packages/frontend/` werden ohne Config-Änderung gefunden, dieselbe Sonde mit
fehlschlagender Assertion ⇒ Exit `1`; **F12 bestätigt behoben** über 10 nebenläufige Runden
(5 Doppel-, 3 versetzte, 2 Dreifachläufe) mit 0 Rückständen; alle acht IAM-Fixtures einzeln umbenannt
⇒ jedes Mal Exit `1`; CI-Run **30368442950** auf HEAD grün gegen **PostgreSQL 17.10** mit allen vier
`integration`-Dateien sichtbar gelaufen; die vier Bestandsworkflows blob-identisch; `pnpm lint` grün;
ein erzwungener `pnpm db:generate` (⇒ `0041_whole_sally_floyd.sql`) lässt `pnpm lint` grün. Der
Produktionscode ist unberührt: echter Pre-E1-Build gegen HEAD-Build verglichen — **233** `dist`-Dateien,
Dateilisten identisch, eine Datei byteverschieden und nur im Zeilenumbruch.

**Drei neue Befunde am Messinstrument, keiner davon ein Kriteriumsbruch** (Details in
`09-befunde-bestandscode.md`):

- **F14** — die Suite-Inventur wacht über **Dateien**, nicht über gelaufene Tests. `suiteRequiring('ci', …)`
  in den vier `integration`-Dateien zu `'nightly'` zu ändern schaltet die ganze Suite ab
  (`163 passed | 36 skipped`), und beide Wächter melden „verifiziert", Exit `0`. `OA_TEST_REQUIRE_INFRA=1`
  greift nicht, weil die Klassenauswahl **vor** der Infrastrukturprüfung liegt. Dieselbe Klasse:
  eine Datei, deren Tests alle `it.skip` sind, zählt voll zur Mindestzahl.
- **F15** — `minimumFiles` ist eine Untergrenze. Heute steht sie exakt auf dem Bestand, also macht
  jede Löschung rot. Sobald eine Suite darüber wächst, geht eine Löschung in Höhe des Spiels still
  durch — belegt durch Löschen von `pg-harness.int.test.ts` (13 Tests) bei grünem Lauf.
- **F16** — wirft eine `integration`-Datei im Modul-Scope **nach** ihrem `acquireTestDatabase()`,
  bleibt die Datenbank liegen und die vorgesehene Meldung `… still present` erscheint **nicht**
  (Wurf im geforkten Worker). CI fängt es, lokal verschwindet der Rückstand lautlos.

**Was gehalten hat:** Verzeichnis umbenannt **und** gelöscht ⇒ rot; `foo.test.ts` unter
`tests/integration/` ⇒ rot; `.spec.ts`/`.test.mts`/`.test.tsx` ⇒ rot; Testdatei außerhalb `packages/`
(auch in `apps/`) ⇒ rot; leere Testdatei ⇒ rot. Und die **lazy-Guard-Fehlerklasse ist konstruktiv
geschlossen**: `OA_TEST_REQUIRE_INFRA=yes` bricht **auch bei laufender Datenbank** ab, weil
`isInfraRequired()` beim Laden von `classification.ts` eifrig aufgerufen wird.

**F13 ausdrücklich nachgeprüft und als schwach bestätigt:** die Zwischenregel aus `04-testplan.md` §2.6
steht **nicht** in den Backlog-Zeilen `JR-208`/`JR-607`/`JR-410` und **nicht** in §12.6 — also nirgends
dort, wo jemand nachschlägt, der einen Soak schreibt. Es gibt auch keine Laufzeitprüfung. Empfehlung:
die Regel in die Akzeptanzkriterien von `JR-208` und `JR-607` aufnehmen, unabhängig von der Wahl des
F13-Entwurfs.

**Kein Produktionscode geändert, kein Befund F1–F13 behoben, kein PR angefasst.**
Der lokale PostgreSQL-16.13-Cluster ist restlos entfernt.

**Danach, durch den PO (nicht mehr durch den Tester):**

- **E1 ist in den Integrationsbranch gemergt** — `efb769c`, `--no-ff`, gepusht als `b4ae8f7`. ADR-014
  gibt den Rückmerge nach unabhängiger Abnahme frei; **`main` bleibt bis E12 unangetastet.** Der
  Integrationsbranch enthält damit den Test-Harness, weshalb E13 von dort abzweigen kann.
  **Kein Squash**, bewusst: die aufgeräumte Sicht liefert schon
  `git log --first-parent origin/main..HEAD` (ein Merge-Commit je Epic), und ein Squash würde
  `cab0e38` („five tasks accepted, JR-104 rejected") tilgen sowie `JR-105a` seine mechanisch
  beweisbare Formatierungs-Reinheit nehmen (ADR-015). Ob beim späteren Merge nach `main` gesquasht
  wird, ist dort zu entscheiden.
- **`JR-105c` angelegt** für F14–F16, fällig **vor E2**.
- **F13-Zwischenregel in die Akzeptanzkriterien von `JR-208` und `JR-607`** übernommen — genau die
  Empfehlung des Testers, weil sie vorher an keiner Stelle stand, die jemand liest.
- Korrigiert: die erste Fassung von `06-status.md` verwies F14–F16 auf `JR-1305`. Das ist E13s Task
  für F8; richtig ist `JR-105c`.

### Nächster konkreter Schritt

**`JR-1303`, dann `JR-1302` / `JR-1304` / `JR-1305` / `JR-1306` — Rolle DEV**, auf demselben Branch
`claude/journaling-e13-iam-hardening`. Die Reihenfolge steht in `03-backlog.md`; `JR-1303` zuerst, weil
ADR-017 es zu reiner Umsetzung gemacht hat.

**Die roten Tests sind die Abnahme.** Jede der vier Fix-Tasks hat ihre Zielmenge im Testnamen:

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres OA_TEST_REQUIRE_INFRA=1 \
  pnpm test -t "RED UNTIL JR-1302"      # 5 Fälle
```

Fertig ist eine Task, wenn **ihre** roten Fälle grün sind **und** kein bisher grüner Fall rot wurde.

> **Eine ausdrückliche Ausnahme von „kein grüner Fall wird rot": `JR-1306`.** Die F21-Entscheidung
> (strenge Allowlist) macht drei heute grüne Pins gegenstandslos — `attachment.name`, `foo.bar` in
> `tests/fixtures/mongo-to-drizzle-golden.json` und „resolves only the relations listed in
> `relationToTableMap`". Sie werden im **selben** Commit wie der Fix invertiert, nicht davor und nicht
> danach, damit kein Stand existiert, in dem Test und Code sich widersprechen. Das ist die einzige
> Stelle in E13, an der ein grüner Test bewusst umgedreht wird.
> Der Endstand von E13 ist `pnpm test` ⇒ Exit `0` bei `224 passed | 2 skipped`. Betroffene
> Produktionsdateien je Task:

| Task        | Datei(en)                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| **JR-1303** | `src/services/SearchService.ts` Zeilen 311 und 423 — **nur** das dritte Argument, sonst nichts            |
| **JR-1302** | `src/services/FilterBuilder.ts` (`null`-Zweig Zeile 49; dazu **F19** und **F20**)                         |
| **JR-1304** | `src/helpers/mongoToDrizzle.ts` (Leerheits- und Unbekannt-Fälle), Aufrufer behandeln `undefined` als deny |
| **JR-1305** | `src/services/FilterBuilder.ts` Zeilen 39–46 (`cannot`-Ausschluss), beide Übersetzer                      |
| **JR-1306** | `src/helpers/mongoToDrizzle.ts` `getDrizzleColumn()` **und** `src/iam-policy/policy-validator.ts`         |

**Vier Dinge, die der DEV wissen muss, bevor er anfängt:**

1. **`packages/backend/tests/integration/predefined-roles.int.test.ts` ist grün und muss grün
   bleiben.** Es ist der Nachweis, dass eine Standardinstallation sich nicht ändert. Wird es rot, ist
   der Fix eine Regression für Bestandsinstallationen — nicht der Test.
2. **`JR-1306`: vor dem Anfangen F21 entscheiden.** Gilt die Allowlist nur für Keys mit SQL-Syntax
   oder für alle unbekannten Keys? Die strenge Variante macht drei heute grüne Pins rot
   (`attachment.name`, `foo.bar` in der Golden-Datei, „resolves only the relations listed in
   `relationToTableMap`") — die gehören dann im selben Commit invertiert. Die Regressionstests fordern
   die strenge Variante **nicht**, damit sie die Entscheidung nicht vorwegnehmen.
3. **`JR-1304`: F22 lesen.** Das Akzeptanzkriterium sagt „der `$or`-Fall erweitert die Disjunktion
   nicht mehr". Gemessen ist der `$or`-Fall eine **Verengung**; fail-open ist das `$and` negierter
   `cannot`-Bedingungen und jede Form, in der **alle** Zweige verschwinden. Wer nach dem Wortlaut
   arbeitet, behebt den harmlosen Fall.
4. **`JR-1302`: die Vorlage, auf die die Task verweist, feuert nie.** Der „No access"-Zweig in
   `FilterBuilder.ts:53` wurde in keinem der über zwanzig Policy-Zuschnitte unter Test erreicht und ist
   nach Lesart von `@casl/ability/extra` wahrscheinlich unerreichbar (Notiz unter F19). Es gibt also
   keinen laufenden Fall und keinen Test, der sie abdeckt — die Semantik muss aus dem Kriterium kommen,
   nicht aus der Beobachtung.

Danach `JR-1307` / `JR-1308`, dann `JR-1309` (Abnahme, Rolle TEST → PO). **Rückmerge in den
Integrationsbranch erst nach `JR-1309`** (ADR-014); `main` bleibt bis E12 unangetastet; kein PR ohne
ausdrückliche Aufforderung.

### Was ein neuer Agent zuerst lesen muss

1. `docs/dev/journaling/README.md` — Einstieg und Lesereihenfolge
2. `docs/dev/journaling/06-status.md` — verbindlicher Stand
3. diese Datei
4. `CLAUDE.md` — Repo-Konventionen und Fallstricke
5. Für die eigentliche Task: `03-backlog.md` (Akzeptanzkriterien) und `02-architektur.md`

### Offene Fragen an den Auftraggeber

**F12 ist erledigt und braucht keine Entscheidung mehr.** Behoben in `JR-104a` (`653dd1c`), in
`JR-106a` unabhängig als behoben bestätigt (10 nebenläufige Runden, 0 Rückstände).

**Blockierend: nichts.** `JR-1303` kann beginnen.

**Vom PO am 2026-07-29 abgearbeitet — kein Vorlagebedarf mehr:** **F18** (ADR-017 und F7 um „für die
Paare der heutigen Aufrufstellen" ergänzt, plus der F17-Nachtrag), **F21** (strenge Variante
entschieden und in `JR-1306` festgeschrieben, die drei Pins werden im selben Commit invertiert),
**F22** (`JR-1304`s Kriterium auf „kein Zweig wird stillschweigend weggelassen" umformuliert, mit der
richtigen Gefahrenrichtung), **F17(a)** (`JR-1307` nimmt auf, dass ausgeliefert keine Read-Only-Rolle
existiert). **F19/F20** brauchten ohnehin keine Entscheidung und sind über die roten Tests Teil der
Abnahme.

**Offen und wirklich beim Auftraggeber: nur `F17(b)`** — soll der Rollen-Bootstrap repariert werden?
Das ist eine Produktentscheidung (welche Rollen liefert Open Archiver aus?), keine Härtung, und sie
gehört nicht in E13. **Blockiert nichts.**

**Restliche Punkte aus `JR-1301`, zur Kenntnis:**

| Punkt       | Sachstand                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F17**     | (a) **Erledigt (PO):** `JR-1307` nimmt auf, dass ausgeliefert keine Read-Only-Rolle existiert, und ADR-017 hat den Nachtrag. (b) **Offen beim Auftraggeber:** soll der Bootstrap repariert werden? Produktänderung, keine Härtung, nicht in E13. PO-Nachprüfung am Code bestätigt: `createFirstAdmin` → `createAdminRole()` legt `predefined_super_admin` an, `getRoles` liegt hinter `requireAuth`, der Bootstrap kann danach nie mehr feuern. |
| **F18**     | **Erledigt (PO).** ADR-017 hat einen Nachtrag: die Aussage gilt für die Paare der heutigen vier Aufrufstellen, nicht für jede (Action, Subject) je Rolle. Das Aufrufstellen-Inventar wacht darüber.                                                                                                                                                                                                                                             |
| **F21**     | **Entschieden (PO): strenge Variante.** Abgewiesen wird jeder unbekannte Key, nicht nur einer mit SQL-Syntax; die drei Pins werden im selben Commit invertiert. Steht in `JR-1306`.                                                                                                                                                                                                                                                             |
| **F22**     | **Erledigt (PO).** `JR-1304`s Kriterium lautet jetzt „kein Zweig wird stillschweigend weggelassen", mit dem Hinweis, dass die fail-open-Richtung im `$and` und bei leerer Zweigliste liegt, nicht im `$or`.                                                                                                                                                                                                                                     |
| **F19/F20** | Zwei weitere Fail-open-Formen in `FilterBuilder`. Kein Entscheidungsbedarf, aber sie erweitern den Umfang von `JR-1302` und `JR-1304` um je einen Fall. Beide sind rot und damit Teil der Abnahme.                                                                                                                                                                                                                                              |
| **F23**     | Testharness: `tsconfig.test.json` sieht globale Augmentierungen nicht, die nur über Produktionsdateien ins Programm kommen. In `JR-1301` umgangen (`tests/support/express-i18n-augmentation.d.ts`), Ursache offen. Für E2 relevant, weil der Receiver eigene Express-Routen bekommt.                                                                                                                                                            |

**Nicht blockierend, aber entscheidungsbedürftig:**

| Punkt       | Sachstand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F13**     | Der unbeschränkte Sweep in `acquireTestDatabase()` kann einen fremden Lauf treffen, der **länger als die Frist** (Default 2 h) läuft; offene Verbindungen schützen ihn nicht, weil `postgres-js` untätige schließt. Heute unerreichbar (5-s-Suite), **erreichbar ab E2/E3** — konkret beim 100k-Soak aus `JR-208`. Drei plausible Entwürfe: Lauf-Register, PID-Lebendigkeitsprüfung (`process.kill(pid, 0)`), einmaliger Sweep pro Lauf. Vorerst gilt die Zwischenregel in `04-testplan.md` §2.6. **Spätestens vor `JR-208` zu entscheiden.**              |
| **ADR-017** | **Erledigt am 2026-07-29: Variante B.** Braucht keine Entscheidung mehr. Umsetzung in `JR-1303`, Folgearbeit als `JR-1310` nach E13 vorgemerkt.                                                                                                                                                                                                                                                                                                                                                                                                            |
| **F14–F16** | Drei Befunde am Messinstrument aus `JR-106a`, alle **offen** und alle **ohne Kriteriumsbruch**: die Suite-Inventur zählt Dateien statt gelaufene Tests (eine Umetikettierung `ci` → `nightly` schaltet die `integration`-Suite ab und bleibt grün), `minimumFiles` verdeckt eine Löschung sobald die Suite wächst, und ein Rückstand nach Modul-Throw wird lokal nicht angekündigt. Inhaltlich gehören alle drei nach **`JR-1305`**, wo `JR-106` den „Ausweg" für genau diese Klasse schon eingeplant hat. Vor E2 zu entscheiden, ob dort mitbehoben wird. |

| Punkt                                     | Sachstand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Zwei offene Pull Requests nach `main`** | **PR #1** (`claude/enterprise-product-implementation-cxmmqe` → `main`) und **PR #2** (`claude/journaling-e1-test-foundation` → `main`) sind offen. Beide **widersprechen ADR-014**: `main` wird bis zur Abnahme von E12 nicht angefasst, und Epic-Branches mergen in den Integrationsbranch, nicht nach `main`. Nebenwirkung: jeder Push löst seitdem **zwei** CI-Läufe aus (`push` und `pull_request` auf demselben SHA) und verdoppelt die Laufzeitkosten. **Die Entscheidung liegt beim Auftraggeber. Kein Agent schließt oder merged sie eigenmächtig.** |
| **`JR-105c`** (F14–F16)                   | **Fällig vor E2, kein Entscheidungsbedarf — nur Arbeit.** Der Inventar-Wächter zählt **Dateien statt ausgeführter Tests**: wer die vier Integrationsdateien auf `nightly` umklassifiziert, schaltet die Suite ab und **beide** Wächter melden grün. Solange das offen ist, belegt ein grüner CI-Lauf nicht, dass die Integration-Suite gelaufen ist. Details in `03-backlog.md` unter „Nach der Abnahme aufgetreten".                                                                                                                                        |

Die folgenden Punkte werden zum jeweiligen Epic zur Entscheidung vorgelegt und sind in
`05-entscheidungen.md` als offene ADRs geführt:

| Wann  | Frage                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| E2    | Kanonische Kodierung und Genesis-String endgültig fixieren (ADR-006) — invalidiert später jede Kette, wenn geändert                         |
| E2    | Eine Kette global oder eine pro Mandant (ADR-007)                                                                                           |
| E7/E8 | Welche TSA? Für deutsche Installationen sollte es eine qualifizierte TSA unter eIDAS sein — kostenpflichtig, Betreiberentscheidung          |
| E7    | Aufbewahrungsfrist für Object Lock COMPLIANCE. **Vorher lesen:** unter COMPLIANCE ist vorzeitige Löschung technisch unmöglich, auch für uns |
| E12   | Steht ein echter Exchange-Online-Tenant für `JR-1208` zur Verfügung? Ohne ihn ist E12 nicht abnehmbar; Mocks sind kein Ersatz               |

### Fallstricke, die schon Zeit gekostet haben

1. **`docs/enterprise/journaling/guide.md` beschreibt Code, der nicht existiert.** `grep` nach
   `smtp-server`/`SMTPServer`/`journal-inbound` liefert genau zwei Treffer, und beide sind
   **Kommentare** — ein Doc-Kommentar in `packages/types/src/journaling.types.ts:79` und ein
   erklärender Kommentar in `packages/backend/src/jobs/processors/schedule-continuous-sync.processor.ts:29`.
   Keine Implementierung, kein Prozessor, keine Queue-Registrierung. Immer `grep` vor der Annahme,
   ein dokumentiertes Feature sei implementiert — und Treffer daraufhin ansehen, ob sie Code sind.
2. **`apps/open-archiver-enterprise` und `packages/enterprise` fehlen**, werden aber von Root-Scripts
   referenziert. `pnpm build:enterprise` und `dev:enterprise` funktionieren hier nicht — die
   `:oss`-Varianten nehmen.
3. **Die IAM-Doku ist stale, nicht der Code.** `docs/services/iam-service/iam-policy.md` listet die
   Action `export` nicht; `iam.types.ts` und `policy-validator.ts` enthalten sie beide. Wer der Doku
   glaubt, „fixt" einen Bug, der nicht existiert.
4. **Neue Drizzle-Schema-Dateien müssen in den Barrel** `packages/backend/src/database/schema.ts`.
   Sonst meldet `pnpm db:generate` „keine Änderungen" und man sucht lange.
5. **Backend-i18n-Strings brauchen einen Rebuild**, um im Container zu erscheinen: der
   `copy-assets`-Buildschritt kopiert `src/locales` nach `dist/locales`. Im Dev-Modus funktioniert es
   sofort, in Produktion erst nach `build`.
6. **Eine grüne Testsuite kann eine abgeschaltete Testsuite sein.** Ohne `DATABASE_URL` endet
   `pnpm test` mit Exit **0** bei „163 passed | 36 skipped". Dagegen gibt es zwei Wächter:
   `OA_TEST_REQUIRE_INFRA=1` (in `ci.yml` gesetzt) macht fehlende Infrastruktur zum Fehlschlag, und
   die Suite-Inventur im `globalSetup` verlangt Mindestdateizahlen je Suite. **Beide zählen nicht,
   wie viele Tests gelaufen sind** — siehe F14/F15. Wer einen grünen Lauf als Beleg zitiert, muss
   die Testzahl mitzitieren: **197 passed | 2 skipped** ist vollständig, alles darunter nicht. Die
   2 Skips sind die `nightly`- und `manual`-Suite in `mongo-to-drizzle.adv.test.ts`; jede weitere
   übersprungene Suite ist erklärungsbedürftig.
7. **Lokale Build-Artefakte verdecken Fehler, die CI findet.** `packages/types/dist` und
   `packages/*/tsconfig.tsbuildinfo` sind gitignoriert und liegen im Container aus früheren Sessions
   vor. Für jede Aussage über einen frischen Checkout müssen **beide** gelöscht werden — wegen
   `composite: true` emittiert `tsc` sonst nichts (F11).
8. **PostgreSQL lokal starten geht auch ohne Docker**: `/usr/lib/postgresql/16/bin/{initdb,pg_ctl}`,
   aber **nicht als `root`** (`su postgres`) und mit einem **kurzen** `unix_socket_directories` —
   der Scratchpad-Pfad überschreitet die 107-Byte-Grenze für Unix-Sockets. Cluster danach entfernen.
   Achtung: lokal ist es 16.13, die CI fährt 17.10.
9. **`and()` in drizzle klammert seine Operanden nicht.** `and(a, b)` rendert `(a and b)`, nicht
   `((a) and (b))`. Enthält `a` ein `or`, verschiebt sich die Präzedenz: `x or y and b` ist
   `x or (y and b)`. Das hat in `JR-1301` einen Test **grün** gemacht, der einen Angriff belegen sollte —
   die Injection war so wirksam, dass sie auch die Einschränkung des Testfalls aufhob und damit _mehr_
   Zeilen lieferte als die erwartete Menge. Wer Zugriffs-Assertions schreibt: auf die konkrete fremde
   Zeile prüfen („`theirs` darf nicht vorkommen"), nicht auf Gleichheit mit einer Erwartungsmenge.
10. **Ein Import kann eine Infrastruktur mitziehen, die es nicht gibt.** `src/services/SearchService.ts`
    importiert `IngestionService`, das `jobs/queues.ts` importiert, das beim Laden drei BullMQ-`Queue`s
    gegen Redis öffnet. Ebenso wirft `src/config/storage.ts` beim Import ohne `STORAGE_TYPE`. Vor einem
    Test, der einen Service importiert, dessen Importkette prüfen — sonst hängt der Worker.
11. **`pnpm --filter @open-archiver/backend test:types` kann an unberührtem Produktionscode scheitern**,
    sobald eine Testdatei einen Express-Controller importiert: `req.t` existiert im Test-Programm nicht
    (F23). Der Build ist davon nicht betroffen, die Ursache liegt in `tsconfig.test.json`.

---

## Vorlage für den nächsten Handover

```markdown
**Stand:** <Datum> · **Branch:** claude/enterprise-product-implementation-cxmmqe

### Was zuletzt passiert ist

<Tasks mit IDs, Ergebnis, was bewusst nicht gemacht wurde und warum>

### Nächster konkreter Schritt

<Task-ID, Rolle, betroffene Dateien, notwendige Vorarbeiten>

### Was ein neuer Agent zuerst lesen muss

<Reihenfolge>

### Offene Fragen an den Auftraggeber

<blockierend / nicht blockierend trennen>

### Fallstricke, die Zeit gekostet haben

<konkret, mit Dateipfad>
```
