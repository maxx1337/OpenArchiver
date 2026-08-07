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
Arbeite JR-1-01 bis JR-1-04 aus docs/dev/journaling/03-backlog.md ab.
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

### Billig verifizieren — die Zahlen dazu sind gemessen, nicht geschätzt

Der Auftraggeber hat am 2026-08-04 beanstandet, dass zu viele Tokens verbrannt werden. Gemessen an
dieser Sitzung sind das die tatsächlichen Posten, größter zuerst:

| Posten                                                            | Kosten                       | Gegenmittel                                                                                                                   |
| ----------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| ~~F35~~ — lokal war `prettier --check` strukturell rot            | ~7 000 Tokens je Sitzung     | **Behoben 2026-08-04** (`9c60f32`): `.gitattributes` setzt LF, `.eml`-Fixtures behalten CRLF. `pnpm lint` ist hier jetzt grün |
| Ein Volllauf, ungefiltert gelesen                                 | ~5 000 Tokens                | Ausgabe in eine Datei, dann **nur** Fehlschläge und Summenzeilen lesen (Rezept unten). Gefiltert: ~400 Tokens                 |
| CRLF-Warnungen von `git add`/`commit`/`diff`                      | ~2 500 Tokens je Sitzung     | `git config core.safecrlf false` (lokal, am 2026-08-04 gesetzt). Der eigentliche Fix ist wieder F35                           |
| Große Dokumente vollständig lesen                                 | 4 000–15 000 Tokens je Datei | `ctx_execute_file` mit einem Skript, das nur Struktur oder Treffer ausgibt — nie `cat` auf `06-status.md` oder `09-befunde…`  |
| Inhalte durchs Kontextfenster verschieben (etwa beim Archivieren) | ~55 000 Tokens vermieden     | `sed -n 'A,Bp' quelle > ziel` statt lesen-und-neu-schreiben. So sind die 195 000 Zeichen nach `18-archiv-e4-e5.md` gewandert  |

**Das Rezept für einen Volllauf** — er dauert knapp drei Minuten, die Ausgabe muss nicht gelesen werden:

```bash
DATABASE_URL=postgresql://admin:password@127.0.0.1:5432/open_archive OA_TEST_REQUIRE_INFRA=1 \
  corepack pnpm test > /tmp/run.log 2>&1; echo "EXIT=$?"
sed -r 's/\x1b\[[0-9;]*m//g' /tmp/run.log \
  | grep -E 'Test Files|Tests +[0-9]|TEST-EXECUTED|Suite inventory|FAIL|✗' | tail -12
```

Das `sed` entfernt nur die ANSI-Farbcodes, damit die Zeilen lesbar sind; **ohne es funktioniert das
`grep` auch** — am 2026-08-04 nachgemessen, nachdem eine erste Vermutung das Gegenteil behauptet hatte.

> **Für einen CI-Log gilt dasselbe Rezept nicht ganz.** `gh run view <id> --log` enthält **keine**
> `Tests …`-Summenzeile — dort nachgesehen, 1 462 Zeilen, kein einziges `passed |`. Wer sie dort sucht
> und nicht findet, darf **nicht** schließen, der Lauf habe nichts ausgeführt. Die tragenden Zeilen im
> CI-Log sind `Test Files`, `[TEST-EXECUTED]` und `Suite inventory verified`:
>
> ```bash
> gh run view <id> --log | grep -E 'Test Files|TEST-EXECUTED|Suite inventory'
> ```

`[TEST-EXECUTED]` und `Suite inventory verified` sind die Zeilen, die zählen — sie unterscheiden „grün"
von „grün, weil nichts geprüft wurde". **`--silent` ist verboten:** es unterdrückt die
`[TEST-COVERAGE NOTICE]`-Zeilen, und genau die tragen die Aussagen, die F48 und F52–F54 aufgedeckt
haben. Die Maschinenfassung derselben Messung liegt zusätzlich in
`node_modules/.cache/oa-test/executed-tests.json`.

**`pnpm gate` — dieselbe Idee, aber gegen CI-Wartezeit statt gegen Tokens.** `JR-6-02b` hat sechs
CI-Round-Trips gebraucht (Analyse: 53 Minuten reine Wartezeit), obwohl drei der sechs Fehlschläge
lokal fangbar gewesen wären. `scripts/pre-push-gate.mjs` (Werkzeug-Infrastruktur, keine Backlog-ID —
Begründung und Kalibrierung in `06-status.md` unter „Pre-Push-Gate") läuft in **unter zwei Minuten**
und macht **keinen** zweiten Volllauf und **keinen** zweiten Test-Harness — es ruft nur bestehende
Skripte/Tests mit anderer Umgebung auf:

```bash
DATABASE_URL=postgresql://admin:password@127.0.0.1:5432/open_archive \
REDIS_HOST=127.0.0.1 REDIS_PORT=6379 REDIS_PASSWORD=devpassword \
  corepack pnpm gate
```

Die drei letzten Variablen sind **Host-Infrastruktur, kein Prüfgegenstand** — anders als
`STORAGE_TYPE`/`ENCRYPTION_KEY`/etc. (deren Fehlen in `ci.yml` genau das ist, was Schritt 4/4 prüfen
soll) sagt ein fehlendes `DATABASE_URL` oder ein falsches `REDIS_PASSWORD` nichts über `ci.yml`,
sondern nur, dass diese Shell noch nicht eingerichtet ist. Ohne sie überspringt Schritt 4/4
automatisch, **mit einer Meldung, die die konkret ungeprüften Fehlschlagklassen namentlich nennt**
(`9af1492`, `41c407e`) statt nur „skipped with a stated reason" — genau das war **F65**, unabhängig
gemessen und behoben: davor blieb ein fehlendes `REDIS_PASSWORD` unbemerkt bis mitten im Testlauf und
brach mit vier `NOAUTH`-Stacktraces ab (Exit 1 auf sauberem Baum, die F35-Form). Dasselbe gilt, wenn
die lokale DB bereits migriert ist (dann fehlt die einzig geeignete **unmigrierte** Sonden-Datenbank,
und `postgres`s eigene Default-DB gleichen Namens wird als Ersatz benutzt, aber genauso benannt
übersprungen, falls auch sie migriert ist). Fängt gemessen (nicht behauptet, siehe `06-status.md`):
`test:types`-Lücken (0264405-Klasse), an CI-Import-Zeit fehlende Env-Vars wie `STORAGE_TYPE`
(9af1492-Klasse) und einen gespawnten Kindprozess, der stillschweigend die unmigrierte Wartungs-DB
benutzt (41c407e-Klasse). Fängt **nicht**: einen die Workflow-Datei selbst kaputtmachenden `${{ }}`-
Ausdruck (nur ein Heuristik-`warn`, kein Schema-Validator gefunden) und den hängenden-Shutdown-Fall
aus F64 (per Definition nur in CI beobachtbar).

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

**Stand:** 2026-08-08 — **E6 ist abgenommen und zurückgemergt.** `JR-6-08` (unabhängige TEST-Sitzung,
Protokoll `22-abnahme-e6.md`, Commit `eba887a`) hat E6 ohne Auflagen angenommen; der Rückmerge nach
`claude/enterprise-product-implementation-cxmmqe` ist vollzogen (`b5b7c8a`, `--no-ff`, kein Squash).
Damit sind **E1, E13, E2, E3, E4, E5 und E6** zurückgemergt — **E7 (WORM-Storage) ist das nächste
offene Epic.** Diese Datei und `06-status.md` sind am selben Tag erneut auf Diät gesetzt worden: das
vollständige E6-Sessionprotokoll (`JR-6-04`–`JR-6-08`, Rückmerge) liegt jetzt in
[`23-archiv-e6.md`](23-archiv-e6.md), fortsetzend zu
[`21-archiv-e6-jr601-jr602a-notizen.md`](21-archiv-e6-jr601-jr602a-notizen.md).

> **Zwei Befunde sind bereits E7 zugeordnet, nicht neu zu entscheiden:** **F60**
> (`StorageService.put()` puffert Streams) und **F66** (`checkSpoolHighWaterMark()` ist O(n²) bei
> wachsendem Spool-Rückstand, gemessen auf echtem Linux während der `JR-6-07`-Verifikation). Beide in
> `09-befunde-bestandscode.md`.

### Der Stand in einem Satz

**E1–E6 stehen vollständig und sind zurückgemergt.** Der Empfangspfad (`apps/smtp-ingress`, ESMTP,
Quell-/Empfänger-ACL, Crash-Recovery-Scan, `250 … queued as <seq>` erst nach Spool-fsync **und**
Ledger-Append) und der Journal-Report-Parser stehen seit E4/E5. Seit E6 gibt es die vollständige
Phase-B-Pipeline (`runPhaseBPipeline()`: eigener `journal-inbound`-Worker, Owner-Auflösung,
Archivierung über `processEmail()`, Indexierung, Spool-Freigabe), Idempotenz mit eigenem
Ledger-Event-Typ (`duplicate_marker`, ADR-037), einen Spool-Reconciler (ADR-038), die
Hash-vor-Verschlüsselung-Garantie, einen Object-Store-Ausfalltest und einen Soak-Test über echtes
SMTP (`nightly` 100.000 / `ci` 100 Nachrichten). Volles Detail: `06-status.md` und `23-archiv-e6.md`.

### Nächster konkreter Schritt — **E7 beginnen (WORM-Storage)**

Kriterien in `03-backlog.md`, Abschnitt E7. Neuen Epic-Zweig von der Integrationsbranch abzweigen —
**sofort den Upstream setzen**, das ist die Falle aus `CLAUDE.md` §7:

```bash
git fetch origin claude/enterprise-product-implementation-cxmmqe
git checkout -b claude/journaling-e7-worm-storage \
    origin/claude/enterprise-product-implementation-cxmmqe
git push -u origin claude/journaling-e7-worm-storage
```

**Zwei Startpunkte liegen schon bereit, beide bereits E7 zugeordnet, nicht neu zu entscheiden:**

- **F60** — `StorageService.put()` puffert einen Stream sofort zu einem Buffer, obwohl die Signatur
  Streams verspricht. Zu entscheiden dort: Verschlüsselung auf einen Stream-Cipher umstellen
  (`createCipheriv` kann streamen) oder die Signatur ehrlich auf `Buffer` verengen.
- **F66** — `checkSpoolHighWaterMark()` durchläuft bei jeder SMTP-Annahme den gesamten Spool-Baum,
  O(n²) bei wachsendem Rückstand. Naheliegender Fix (im Code selbst vorgeschlagen): ein mitgeführter
  Zähler statt eines vollen Verzeichnis-Walks pro Nachricht.

Beide betreffen `S3StorageProvider`/Spool-Layout, die E7 ohnehin für Object Lock anfasst — daher die
Zuordnung.

### Was ein neuer Agent zuerst lesen muss

1. `docs/dev/journaling/README.md` — Einstieg und Lesereihenfolge
2. `docs/dev/journaling/06-status.md` — verbindlicher Stand
3. diese Datei
4. `CLAUDE.md` — Repo-Konventionen und Fallstricke
5. Für die eigentliche Task: `03-backlog.md` (Akzeptanzkriterien E7) und `02-architektur.md`

### Offene Fragen an den Auftraggeber

**Stand 2026-08-08 — was wirklich offen ist:**

1. **`F43`: soll `JR-3-02`s Speichernachweis nachgemessen werden?** Die einzige Frage, die ein
   **abgenommenes** Epic (E3) berührt. `heapUsed` kann Vollpufferung in Node-`Buffer`n nicht sehen —
   gemessen, mit absichtlich eingebauter Regression kalibriert. Der **Code** ist mit hoher
   Wahrscheinlichkeit korrekt (`writeDurableSpoolFile()` streamt), der **Nachweis** trägt nicht.
   Kleiner Aufwand, aber Nacharbeit an einem abgenommenen Epic, also eine Entscheidung. Blockiert
   nichts.
2. **`F39`** (niedrig, Testharness) und **`F42`** (niedrig, totes `tsconfig.build.json`) — beheben
   oder bewusst akzeptieren? Beide blockieren nichts.
3. **`F17(b)`** — Rollen-Bootstrap reparieren? Unverändert eine Produktentscheidung.
4. **`F62`** (niedrig): soll `IJournalInboundJob` aus `packages/types` entfernt werden? Unbenutzt,
   aber ein exportierter Typ könnte theoretisch extern importiert sein. Blockiert nichts.
5. **`F64`** (mittel): der hängende Shutdown nach `worker.close()` — auf Anweisung nicht untersucht.
   Die `JR-6-08`-Abnahmesitzung hat das unabhängig als vertretbar bewertet (Workaround ändert die
   Korrektheit nicht, betrifft nur Prozessende). Blockiert nichts, aber weiterhin ungeklärt.

**Beantwortet und nicht mehr offen (Archiv):** alle bis 2026-08-07 abgeschlossenen Fragen — E2/E13-Ära,
E6 (F59/F60/F65/F66-Zuordnung, die Doku-Diäten vom 2026-08-03/08-06), `ADR-006`/`ADR-007`/`ADR-017`/
`ADR-020`/`ADR-029`, `F7`/`F12`/`F17`–`F26`, `JR-1-05c`, `JR-13-12`/`-16`/`-17` — liegen in
[`20-archiv-offene-fragen-bis-jr6.md`](20-archiv-offene-fragen-bis-jr6.md) und den E6-Archivdateien.

Die folgenden Punkte werden zum jeweiligen Epic zur Entscheidung vorgelegt und sind in
`05-entscheidungen.md` als offene ADRs geführt:

| Wann | Frage                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| E7   | Aufbewahrungsfrist für Object Lock COMPLIANCE. **Vorher lesen:** unter COMPLIANCE ist vorzeitige Löschung technisch unmöglich, auch für uns |
| E8   | ADR-008: TSA-Ausfallverhalten bestätigen                                                                                                    |
| E12  | Steht ein echter Exchange-Online-Tenant für `JR-12-08` zur Verfügung? Ohne ihn ist E12 nicht abnehmbar; Mocks sind kein Ersatz              |

### Fallstricke — jetzt in `15-fallstricke.md`

Die 34 Fallstricke, die in diesem Projekt Zeit gekostet haben, liegen seit dem 2026-08-03 in
**`15-fallstricke.md`** — inhaltlich unverändert und **mit unveränderter Nummerierung**, weil
projektweit als „Fallstrick N" darauf verwiesen wird. Sie sind Referenz, nicht „nächster Schritt":
diese Datei wird bei jedem Sessionende überschrieben, jene wächst nur.

**Die vier, die man vor der ersten Zeile Code kennen sollte:** `pnpm` ist nicht im PATH
(`corepack pnpm`), `pnpm lint` **war** auf diesem Host strukturell rot (F35, seit dem 2026-08-04
behoben — eine Rotmeldung ist wieder eine Aussage), ein Import kann eine Infrastruktur mitziehen, die
es nicht gibt, und `-t` ist ein Regex und kein Substring.

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
