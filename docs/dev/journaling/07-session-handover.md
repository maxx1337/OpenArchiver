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

**Stand:** 2026-07-29 (`JR-1302`–`JR-1306` erledigt) · **Branch:**
`claude/journaling-e13-iam-hardening` (Epic-Branch, abgezweigt vom Integrationsbranch bei `efea6bc`)

### Was zuletzt passiert ist

**Die fünf Fix-Tasks von E13 sind erledigt (Rolle `senior-dev`): `JR-1303`, `JR-1302`, `JR-1304`,
`JR-1305`, `JR-1306`.** Ein Commit je Task, in dieser Reihenfolge:

| Commit    | Task      | Kern der Änderung                                                                                                      |
| --------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `bcac6bd` | `JR-1303` | `SearchService.ts:311`/`:423` bauen den Filter für `('archive','search')` (ADR-017 B). Kein Route-Gate berührt         |
| `a309fd1` | `JR-1302` | `null` von `rulesToQuery` ⇒ deny; unbedingtes `cannot` ⇒ deny (**F20**); `undefined` vom Übersetzer ⇒ deny (**F19**)   |
| `45ac0e9` | `JR-1304` | `mongoToDrizzle` wirft statt zu verwerfen; Rückgabetyp `SQL`                                                           |
| `2311996` | `JR-1305` | `cannot`-Ausschluss über `{ $not: condition }` statt `{ $ne: value }`                                                  |
| `dcec017` | `JR-1306` | Allowlist für Condition-Keys, `sql.raw` entfernt, `PolicyValidator` prüft Condition-Keys; die drei F21-Pins invertiert |

```
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres OA_TEST_REQUIRE_INFRA=1 pnpm test
  vorher (8984ce9)   Tests  21 failed | 203 passed | 2 skipped (226)   EXIT=1
  nachher (dcec017)  Tests   1 failed | 223 passed | 2 skipped (226)   EXIT=1
```

**20 der 21 roten Tests sind grün, und kein vorher grüner Test ist rot geworden** — maschinell
geprüft, nicht gezählt: beide Läufe mit `--reporter=json` protokolliert und die Statusliste je
Testname verglichen (0 Übergänge grün ⇒ nicht grün). `predefined-roles.int.test.ts` ist mit allen
sieben Fällen **grün geblieben**. Die vollständige Tabelle steht in `06-status.md` unter „Grün-Lauf
der Fixes".

> **Der eine verbleibende rote Test ist ein Widerspruch zwischen zwei `JR-1301`-Tests, kein
> unfertiger Fix — und er braucht eine Entscheidung.**
> `RED UNTIL JR-1304: the Drizzle half alone is fail-closed for an untranslatable condition (F3)` in
> `tests/integration/filter-builder-f1-f3.int.test.ts` fordert für die teilweise übersetzbare
> Disjunktion ein Prädikat, das Zeilen liefert (Zeile 236: `[rows.mine]`), und ruft `mongoToDrizzle`
> in Zeile 223 ohne `try` auf. `src/helpers/mongoToDrizzle.test.ts:203` fordert für die
> **strukturell identische** Eingabe „throw oder `1=0`/`false`". Beides ist nicht gleichzeitig
> erfüllbar. Gewählt ist **werfen**, weil (a) `JR-1304`s Kriterium „kein Zweig wird stillschweigend
> weggelassen" lautet und die zweite Assertion gerade die F22-Verengung festhält, die das Kriterium
> verbietet, (b) `mongoToMeli` für dieselbe Form schon heute wirft und ein **grüner** Test das
> festhält (`mongo-to-meli.int.test.ts:147`), (c) ein never-true-Prädikat je Zweig am `$not` kippt:
> `not(false)` ist wahr. **Der Test wurde nicht angepasst** — Teständerungen sind Rolle `tester`.
> Empfehlung und Begründung in `06-status.md`; danach ist der Endstand `224 passed | 2 skipped`,
> Exit 0.

**Eine benannte Abweichung von der F21-Entscheidung.** „Abgewiesen wird jeder unbekannte Key" ist als
Allowlist über die **Form** des Keys plus die Relation umgesetzt: ein einzelner Identifier oder
`<relation>.<identifier>` mit Relation aus `relationToTableMap`. Damit fallen alle SQL-Syntax-Keys und
alle Keys mit unbekannter Relation heraus (`attachment.name`, `foo.bar`, `a.b.c`). Ein einzelner,
unbekannter, syntaktisch harmloser Key (`foo`) wird **weiter übersetzt**: `mongoToDrizzle` kennt die
Zieltabelle nicht, und eine spaltengenaue Allowlist hätte drei weitere heute grüne Pins gebrochen
(`{a:1}`, `{b:2}`, `{n:{$gt:1}}` plus die `FIELDS`-Liste der adversarialen Suite) — was der Auftrag
ausschloss. Vorschlag: spaltengenaue Prüfung dort, wo das Subject bekannt ist, also bei `JR-1310`.

**Geänderter Produktionscode: vier Dateien.** `src/services/SearchService.ts`,
`src/services/FilterBuilder.ts`, `src/helpers/mongoToDrizzle.ts`,
`src/iam-policy/policy-validator.ts`. **`mongoToMeli.ts` ist unverändert.** Geänderter Testcode: nur
die vom PO freigegebene F21-Invertierung in `src/helpers/mongoToDrizzle.test.ts` und
`tests/fixtures/mongo-to-drizzle-golden.json`. **Keine Migration, kein Schemaeingriff, kein neuer
i18n-Key** — der Ablehnungsgrund des Validators wird wie die bestehenden Gründe auf Englisch hinter
`req.t('iam.invalidPolicy')` angehängt; dass diese Gründe nicht lokalisiert sind, ist Bestandszustand.

**Bewusst nicht angefasst:** F2, F4, F5, F6, F9, F10, F17, F18, F22, F23. F4 und F5 sind in
`mongoToDrizzle` erhalten und jetzt im Code als bewusst offen kommentiert. `pnpm lint` grün,
`pnpm --filter @open-archiver/backend test:types` grün, Backend-Build grün, 0 `oa_test_*`-Rückstände,
lokaler PostgreSQL-16.13-Cluster restlos entfernt. Kein Rückmerge, kein PR.

### Was davor passiert ist — `JR-1301`

**`JR-1301` ist erledigt (Rolle `tester`). Der Epic-Branch war absichtlich rot.**

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

### Und davor — ADR-017

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

**`JR-1307` — Rolle DEV**, auf demselben Branch `claude/journaling-e13-iam-hardening`: die
Verhaltensänderung dokumentieren (Release-Hinweis **plus** Prüfanleitung für Bestandsinstallationen)
und als **ADR-016** festhalten, dass fail-closed den Bruch rechtfertigt. Die Nummernlücke zwischen
ADR-015 und ADR-017 ist dafür reserviert — **nicht umnummerieren**. Was die Anleitung sagen muss:

- Wer den `null`-Zweig traf, sieht künftig **nichts** statt alles. Die drei betroffenen Formen
  konkret benennen: Nutzer **ohne Rolle**, Policy mit **ausschließlich** `cannot`-Regeln auf einem
  Subject, handgeschriebene Rolle mit `search` ohne `read` auf `archive`. Keine Pauschalwarnung.
- Neu hinzugekommen und ebenfalls verhaltensändernd: ein **unbedingtes `cannot`** und ein `can` mit
  **leerem `conditions`** verweigern jetzt (F20/F19), eine Policy mit einem Condition-Key, den die
  Allowlist nicht kennt, **schlägt beim Anlegen fehl** (`400`) und bei einer bestehenden Rolle beim
  Abfragen (`JR-1306`) — für einen Betreiber ist das der sichtbarste Bruch, weil ein Tippfehler in
  einer gespeicherten Policy vorher wirkungslos war und jetzt laut ist.
- **F17 mit aufnehmen:** ausgeliefert existiert nur `predefined_super_admin`; wer nach
  `predefined_read_only_user` sucht, findet nichts, und das ist kein Fehler seiner Installation.
- Keine der drei `predefined_*`-Rollen ist betroffen — belegt durch
  `tests/integration/predefined-roles.int.test.ts`, das durch alle Fixes grün geblieben ist.

Danach `JR-1308` (Rolle PO, Entwurf, **nicht versenden**), dann `JR-1309` (Abnahme, Rolle TEST → PO).
**Rückmerge in den Integrationsbranch erst nach `JR-1309`** (ADR-014); `main` bleibt bis E12
unangetastet; kein PR ohne ausdrückliche Aufforderung.

**Vor `JR-1309` braucht der PO eine Entscheidung** zum verbleibenden roten Test (siehe „Offene Fragen
an den Auftraggeber"). Solange sie aussteht, endet `pnpm test` mit Exit 1, und `ci.yml` zeigt auf
`push` rote Läufe.

**Das Kommando, mit dem beide Läufe protokolliert wurden** — Postgres lokal ohne Docker, siehe
Fallstricke Punkt 8:

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres OA_TEST_REQUIRE_INFRA=1 pnpm test
```

Für den Nachweis „kein vorher grüner Test ist rot geworden" nicht die Zahlen vergleichen, sondern die
Statuslisten: `pnpm test --reporter=json --outputFile=<datei>` auf beiden Ständen und die Paare
`status` / `fullName` gegeneinander diffen. Die Gesamtzahl allein verdeckt einen Tausch.

### Was ein neuer Agent zuerst lesen muss

1. `docs/dev/journaling/README.md` — Einstieg und Lesereihenfolge
2. `docs/dev/journaling/06-status.md` — verbindlicher Stand
3. diese Datei
4. `CLAUDE.md` — Repo-Konventionen und Fallstricke
5. Für die eigentliche Task: `03-backlog.md` (Akzeptanzkriterien) und `02-architektur.md`

### Offene Fragen an den Auftraggeber

**Blockierend für die Abnahme `JR-1309`, nicht für `JR-1307`: der eine rote Test.**
`RED UNTIL JR-1304: the Drizzle half alone is fail-closed for an untranslatable condition (F3)` und
`src/helpers/mongoToDrizzle.test.ts:203` fordern für dieselbe Eingabeform Gegenteiliges — der
Integrationstest ein Prädikat, das Zeilen liefert, der Unit-Test „throw oder never-true". Der Fix hat
sich für **werfen** entschieden (Begründung in `06-status.md`, u. a. weil `mongoToMeli` für dieselbe
Form schon heute wirft und ein grüner Test das festhält). **Zu entscheiden: wird der Integrationstest
korrigiert?** Empfehlung: ja — Zeile 223 und 236 in `expectFailClosed` bzw. `try`/`catch` fassen und
die Erwartung `[rows.mine]` streichen, weil sie die F22-Verengung pinnt, die `JR-1304` beseitigen
soll. **Das ist eine Teständerung und gehört zur Rolle `tester`**, nicht zum DEV; sie wurde deshalb
nicht vorgenommen. Danach `224 passed | 2 skipped`, Exit 0.

**Zur Kenntnis, kein Entscheidungsbedarf: eine benannte Abweichung in `JR-1306`.** Die Allowlist prüft
Form des Keys plus Relation, nicht die Existenz der Spalte; ein einzelner unbekannter Key (`foo`) wird
weiter übersetzt. Begründung und Vorschlag (spaltengenaue Prüfung bei `JR-1310`) stehen unter „Was
zuletzt passiert ist" und in F21.

**F12 ist erledigt und braucht keine Entscheidung mehr.** Behoben in `JR-104a` (`653dd1c`), in
`JR-106a` unabhängig als behoben bestätigt (10 nebenläufige Runden, 0 Rückstände).

**Vom PO am 2026-07-29 abgearbeitet — kein Vorlagebedarf mehr:** **F18** (ADR-017 und F7 um „für die
Paare der heutigen Aufrufstellen" ergänzt, plus der F17-Nachtrag), **F21** (strenge Variante
entschieden und in `JR-1306` festgeschrieben, die drei Pins im selben Commit invertiert),
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
| **F21**     | **Umgesetzt in `JR-1306` (`dcec017`).** Die drei Pins sind im Fix-Commit invertiert. Eine benannte Abweichung: die Allowlist prüft die Form des Keys plus die Relation, nicht die Existenz der Spalte — ein einzelner unbekannter Key (`foo`) wird weiter übersetzt, weil `mongoToDrizzle` keinen Tabellenkontext hat. Vorschlag: spaltengenau bei `JR-1310`.                                                                                   |
| **F22**     | **Erledigt (PO).** `JR-1304`s Kriterium lautet jetzt „kein Zweig wird stillschweigend weggelassen", mit dem Hinweis, dass die fail-open-Richtung im `$and` und bei leerer Zweigliste liegt, nicht im `$or`.                                                                                                                                                                                                                                     |
| **F19/F20** | **Behoben** in `JR-1302` (`a309fd1`) bzw. mit `JR-1304` (`45ac0e9`): ein unbedingtes `cannot` verweigert, und ein `can` mit leerem `conditions` gilt nicht mehr als unbedingt. Beide Tests sind grün.                                                                                                                                                                                                                                           |
| **F23**     | Testharness: `tsconfig.test.json` sieht globale Augmentierungen nicht, die nur über Produktionsdateien ins Programm kommen. In `JR-1301` umgangen (`tests/support/express-i18n-augmentation.d.ts`), Ursache offen. Für E2 relevant, weil der Receiver eigene Express-Routen bekommt.                                                                                                                                                            |

**Nicht blockierend, aber entscheidungsbedürftig:**

| Punkt       | Sachstand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F13**     | Der unbeschränkte Sweep in `acquireTestDatabase()` kann einen fremden Lauf treffen, der **länger als die Frist** (Default 2 h) läuft; offene Verbindungen schützen ihn nicht, weil `postgres-js` untätige schließt. Heute unerreichbar (5-s-Suite), **erreichbar ab E2/E3** — konkret beim 100k-Soak aus `JR-208`. Drei plausible Entwürfe: Lauf-Register, PID-Lebendigkeitsprüfung (`process.kill(pid, 0)`), einmaliger Sweep pro Lauf. Vorerst gilt die Zwischenregel in `04-testplan.md` §2.6. **Spätestens vor `JR-208` zu entscheiden.**              |
| **ADR-017** | **Erledigt am 2026-07-29: Variante B, umgesetzt in `JR-1303` (`bcac6bd`).** Braucht keine Entscheidung mehr. Folgearbeit als `JR-1310` nach E13 vorgemerkt.                                                                                                                                                                                                                                                                                                                                                                                                |
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
12. **Ein gefilterter Lauf (`pnpm test -t "…"`) lässt `oa_test_*`-Datenbanken liegen.** Die
    `integration`-Dateien rufen `acquireTestDatabase()` im **Modul-Scope** auf, also bevor vitest die
    Fälle nach `-t` filtert; wird die Suite dann komplett übersprungen, läuft der zugehörige Teardown
    nicht. Ein **vollständiger** `pnpm test`-Lauf hinterlässt nachweislich **0** Rückstände. Wer
    zwischendurch mit `-t` arbeitet, muss vor der Abschlussprüfung aufräumen — sonst liest sich der
    eigene Zwischenstand wie ein Leck. Verwandt mit **F16**, aber nicht dieselbe Ursache; gehört in
    die Betrachtung von `JR-105c`.
    ```bash
    psql -tAc "select datname from pg_database where datname like 'oa\_test\_%'"
    ```

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
