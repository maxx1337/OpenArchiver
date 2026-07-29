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

**Stand:** 2026-07-29 (ADR-017 entschieden) · **Branch:**
`claude/enterprise-product-implementation-cxmmqe` (Integrationsbranch)

### Was zuletzt passiert ist

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

### Was davor passiert ist

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

**`JR-1301`** — Epic E13 (IAM-Autorisierung härten), Branch
`claude/journaling-e13-iam-hardening`, abgezweigt vom **Integrationsbranch**:

```bash
git fetch origin claude/enterprise-product-implementation-cxmmqe
git checkout -b claude/journaling-e13-iam-hardening \
    origin/claude/enterprise-product-implementation-cxmmqe
```

E1 ist jetzt formal abgenommen, der Harness ist benutzbar, und `FilterBuilder` ist über
`tests/integration/filter-builder.int.test.ts` abgedeckt — das ist das Regressionsnetz, das `JR-1301`
braucht. Danach `JR-1302` … `JR-1309` gemäß `03-backlog.md`. **F7** ist der Grund, warum E13 vor E2
steht und warum E11 ohne E13 nicht abnehmbar ist.

**ADR-017 ist entschieden**, `JR-1303` blockiert also nichts mehr. Zwei Dinge muss `JR-1301` deshalb
konkret leisten:

1. Der Regressionstest für F7 fordert die Semantik aus ADR-017 — der Filter für eine Rolle mit
   **bedingtem** `search archive` entsteht aus deren `search`-Regeln.
2. **Die drei `predefined_*`-Rollen gehören als Integrationstest gegen echtes Postgres dazu**, vor und
   nach dem Fix mit identischem Ergebnis. Das ist der Beleg für „keine Regression in
   Standardinstallationen" — die Tabelle in ADR-017 ist nur die Herleitung, nicht der Nachweis.

### Was ein neuer Agent zuerst lesen muss

1. `docs/dev/journaling/README.md` — Einstieg und Lesereihenfolge
2. `docs/dev/journaling/06-status.md` — verbindlicher Stand
3. diese Datei
4. `CLAUDE.md` — Repo-Konventionen und Fallstricke
5. Für die eigentliche Task: `03-backlog.md` (Akzeptanzkriterien) und `02-architektur.md`

### Offene Fragen an den Auftraggeber

**F12 ist erledigt und braucht keine Entscheidung mehr.** Behoben in `JR-104a` (`653dd1c`), in
`JR-106a` unabhängig als behoben bestätigt (10 nebenläufige Runden, 0 Rückstände).

**Blockierend: nichts.** E1 ist mit `JR-106a` abgenommen, `JR-1301` kann beginnen.

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
