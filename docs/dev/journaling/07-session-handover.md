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

**Stand:** 2026-08-06 — **E6 läuft: `JR-6-01`, `JR-6-02a`, `JR-6-02b`, `JR-6-03` erledigt, `ADR-037`
entschieden** (`JR-6-02` insgesamt code-fertig, TEST-Abnahme offen; ADR-010, ADR-033, ADR-034,
ADR-035, ADR-037 entschieden; F59 und F61 behoben, F62/F63/F64 offen) · **Branch:**
`claude/journaling-e6-phase-b-worker` (Epic-Zweig, eigener Upstream gesetzt) · Volllauf:
**1301 passed | 8 skipped** bei 107 Dateien — `unit ci 1104/1104 · integration ci 128/128 ·
adversarial ci 69/69` (unverändert seit `JR-6-03` — ADR-037 korrigierte drei Assertions, fügte keine
hinzu), Exit 0 · zuletzt `37ba891` · **CI `31115643168` success** · **`pnpm gate` (kein
Backlog-Task):** `88b6719`+`d5f77cf`, F65-Fix `1611434` — unverändert seit der letzten Sitzung

> **Vor der ersten Scheibe sind nach ADR-032 die Nummernkreise reserviert worden** (`fc15edc`, auf dem
> **Integrationszweig**): **ADR-033–036** und **F59–F70**. `ADR-010` ist ausdrücklich **nicht** Teil
> der Reservierung — sie trägt ihre Nummer seit dem 2026-07-27 und wurde in `JR-6-02` gefüllt. **033**,
> **034** und **035** sind vergeben (Owner-Auflösung für die drei schwächeren Parse-Ergebnisse, die
> Phase-B-Pipeline, die Automatisierung des Ende-zu-Ende-Tests); **036** ist mit der Doku-Diät gefüllt.
> Nachschub **ADR-037–040** am 2026-08-06 auf dem Integrationszweig nachreserviert (`e8256f7`), weil
> 033–036 erschöpft waren; **037** ist jetzt mit dem `duplicate_marker`-Event-Typ gefüllt (siehe unten),
> 038–040 bleiben offen.

> **E4 und E5 sind abgenommen und zurückgemergt** — E4 mit `JR-4-13`/`9503bc8`, E5 mit `JR-5-09`/`107346d`,
> E3 mit `JR-3-08`/`185e9bd`. **Aus E4 ist kein Befund offen.**

### Der Stand in einem Satz

**Der Empfangspfad steht, der Parser steht, Phase B hat einen vollständigen Verarbeitungspfad mit
automatisiertem Ende-zu-Ende-Beleg, und Idempotenz ist jetzt Teil davon.** `apps/smtp-ingress` spricht
ESMTP, prüft Quell- und Empfänger-ACL, fährt beim Start den Crash-Recovery-Scan und antwortet auf
`DATA`/`BDAT … LAST` mit `250 … queued as <seq>` erst nach Spool-fsync **und** Ledger-Append. Seit
`JR-6-01` gibt es den `journal-inbound`-Worker als eigenen Prozess; seit `JR-6-02a` das **Tor**; seit
`JR-6-02b` die vollständige Pipeline (`runPhaseBPipeline()`): parsen (E5) → Owner auflösen
(ADR-033/034) → archivieren (ADR-010) → indexieren → Spool-Datei löschen, mit automatisiertem
Ende-zu-Ende-Test (ADR-035). Seit **`JR-6-03`** schreibt ein `'duplicate'`-Ergebnis, das eine **andere**
Spool-Transaktion als die eigene betrifft, einen `duplicate_of`-Marker in den Ledger
(`LedgerLookup.findOriginalReceiptSeq()`, `MIN(seq)` über Chain+Hash unterscheidet das von einem
Job-Retry). Seit **`ADR-037`** trägt dieser Marker einen eigenen `event_type`
(`duplicate_marker`), nicht mehr `'receipt'` — eine Zählung von Receipts gegen angenommene Nachrichten
(`verify`, E9) zählt ihn dadurch nicht mehr doppelt. **Was fehlt:** `JR-6-04` (Spool-Reconciler).

### Was diese Session gemacht hat

**`ADR-037` (eigener Event-Typ für den `duplicate_of`-Marker).** Migration `0043_whole_meltdown.sql`
(`ALTER TYPE ... ADD VALUE 'duplicate_marker'`, lokal gegen eine frische Datenbank geprüft — der neue
Wert ist außerhalb der Migrations-Transaktion sofort nutzbar). Vokabular an drei Stellen synchron:
`journalEventTypeEnum` (Schema), `JournalEventType` (`packages/types`), und
`LedgerAppendRequest['eventType']` in `ledger-port.ts` — letzteres war bis jetzt eine **eigene,
handkopierte** Literal-Union derselben Werte statt eines Imports, genau die F46-Form, die den
fehlenden Wert unbemerkt ließ; jetzt importiert es `JournalEventType` direkt. 32 Dateien mit
`event_type`/`'receipt'`-Treffern durchsucht, 3 geändert (der Marker selbst in `pipeline.ts`, der
Enum-Vollständigkeitstest in `journal-ledger-schema.int.test.ts`, die `JR-6-03`-Zustellungsprobe in
`journal-phase-b-e2e.int.test.ts` — deren Zählung war die eigentliche Falle: `event_type = 'receipt'`
lieferte vorher 3 Zeilen für 2 Zustellungen, jetzt 2). Beide geänderten Tests kalibriert (Marker
versehentlich wieder als `'receipt'` geschrieben, rot an der jeweils erwarteten Stelle,
zurückgenommen). Volle Fassung in `05-entscheidungen.md` unter **ADR-037**.

**Vorher, `JR-6-03` (Idempotenz/`duplicate_of`), Commit `5e9551f`.** Volle Begründung als Doc-Comment in
`ledger-lookup-port.ts`/`pipeline.ts`, Kurzfassung im Sessionprotokoll (`06-status.md`,
2026-08-06). Neue Methode `LedgerLookup.findOriginalReceiptSeq()`, ein neuer `ledgerAppend`-Port in
`PhaseBPipelineDeps`, und die Marker-Logik in der Owner-Schleife. +3 Tests (2 `pipeline.test.ts`, 1
`journal-phase-b-e2e.int.test.ts`), beide kalibriert.

> **Eine eigene Nacharbeit aus dieser Session, wichtiger als der Code:** der Bericht zu `JR-6-03`
> erreichte den Auftraggeber nicht, weil er nur als Text ausgegeben statt per Nachricht geschickt
> wurde — die Rückfrage zur Drei-Zeilen-Lesart lief damit ins Leere, und der Statuseintrag behauptete
> „an den Auftraggeber zurückgegeben", was nie zutraf. Seither: Berichte per Nachricht schicken, und
> „zurückgegeben" erst schreiben, wenn eine Antwort da ist — vorher „offen, Rückfrage gestellt".

### Die Umgebung hat sich geändert — Referenz in `19-umgebung-windows-host.md`

**Verschoben am 2026-08-06** (Doku-Diät, inhaltlich unverändert) — diese Anleitung (Docker Desktop,
Wegwerf-Cluster, Docker Sandboxes, `git`/`ssh-agent` unter Windows, `pg_ctl`-Fallstricke) wird
gebraucht, **wenn die lokale Infrastruktur klemmt**, nicht bei jedem Sessionstart. Vollständig und
unverändert in [`19-umgebung-windows-host.md`](19-umgebung-windows-host.md). Die zwei E13-Notizen, die
hier ohne eigene Überschrift dahinter standen, liegen jetzt in `12-archiv-e13-e2.md`.

### Nächster konkreter Schritt — **`JR-6-04` (Spool-Reconciler)**

Der Prompt für die nächste Sitzung:

```
Weiter mit dem Journaling-Projekt. Lies docs/dev/journaling/07-session-handover.md
und arbeite den nächsten Schritt ab.
```

**Der Zweig steht:** `claude/journaling-e6-phase-b-worker`, eigener Upstream. Letzter **inhaltlicher**
Commit `37ba891`, CI `31115643168` **success** — 107 Dateien, `unit 1104/1104 · integration 128/128 ·
adversarial 69/69`; danach nur der Doku-Nachtrag mit dieser Lauf-Nummer. Gleichstand deshalb gegen
`git ls-remote` prüfen, nicht gegen diesen Hash. Nicht neu abzweigen, nicht neu reservieren.

> **Dazwischen (`88b6719`/`d5f77cf`, kein Backlog-Task): das lokale Pre-Push-Gate `pnpm gate`.**
> Kalibriert gegen drei der sechs `JR-6-02b`-CI-Fehlschläge (0264405, 9af1492, 41c407e — jeweils rot
> an der exakt erwarteten Stelle, danach sauber zurückgesetzt). Fängt **nicht** 49a0bc1 (nur ein
> Heuristik-`warn`) und **nicht** F64s hängenden Shutdown (per Definition nicht lokal reproduzierbar).
> Details in `06-status.md` unter „Pre-Push-Gate" und in `07-session-handover.md` unter „Billig
> verifizieren". Ändert an `JR-6-03`/`JR-6-04` als nächstem Schritt nichts.
>
> **Nacharbeit `F65` (`1611434`), von TEST unabhängig gefunden und gemessen:** `DATABASE_URL` und
> `REDIS_PASSWORD` sind Host-Infrastruktur, kein Prüfgegenstand, und wurden vorher asymmetrisch
> behandelt — ein fehlendes `DATABASE_URL` überspringt Schritt 4/4 zwar korrekt, nannte aber nie die
> dadurch ungeprüften Klassen (`9af1492`/`41c407e`), und ein fehlendes/falsches `REDIS_PASSWORD` wurde
> **gar nicht** geprüft und führte zu vier `NOAUTH`-Stacktraces mitten im Testlauf — **Exit 1 auf
> sauberem Baum** (die F35-Form). Behoben mit `probeRedisRequiresAuth()` (spricht `PING`/`AUTH` selbst,
> vor jedem Build/Spawn) und benannten Skip-Meldungen für beide Fälle. Kalibriert gegen alle drei vom
> Prüfer gemessenen Zustände plus einer Gegenprobe, dass `41c407e`s ursprüngliche Kalibrierung weiter
> greift. Details in `06-status.md` unter „F65".

> **`F63`/`F64`, gelesen bevor der nächste Worker echten DB-/Storage-Zugriff bekommt** (`JR-6-04`s
> Reconciler zum Beispiel): volle Fassung — beide Ursachen der CI-Iterationen samt der Lehre für
> künftige Worker, und der hängende Shutdown als reales, nicht identifiziertes Produktionsverhalten —
> steht **in gleicher oder größerer Tiefe** in `09-befunde-bestandscode.md` (am 2026-08-06 dorthin
> verschoben, nicht gekürzt). `F64` auf ausdrückliche Anweisung nicht weiter untersucht.

> **Auftrag (a), erledigt (Fortsetzung derselben Sitzung, `32fa49f`):** der Ende-zu-Ende-Test ist
> automatisiert. Volle Begründung (die DI-Naht, die schon existierte, die gemessene
> Meilisearch-CI-Auth, die zweifache Kalibrierung) steht in gleicher oder größerer Tiefe in
> `05-entscheidungen.md` unter **ADR-035**.

**`JR-6-03` und `ADR-037` sind erledigt** — Umsetzung siehe „Was diese Session gemacht hat" oben. Die
Drei-Zeilen-Auslegungsfrage ist **entschieden**, nicht mehr offen: `2b62c26` korrigiert das
Backlog-Kriterium selbst, `ADR-037` behebt den eigentlichen Fehler dahinter (der Marker brauchte einen
eigenen Event-Typ, sonst hätte jede künftige Receipt-Zählung ihn mitgezählt).

**Was `JR-6-04` zu tun hat** (Spool-Reconciler): ein periodischer Sweep über Spool-Einträge mit
Ledger-Eintrag, aber unvollständiger Phase B, reiht sie nach — Redis ist Optimierung, nicht Autorität.
`journalInboundJobId()` (`queue-contract.ts`) ist bereits deterministisch aus der `spoolTxId` abgeleitet,
genau damit der Reconciler idempotent nachreihen kann.

**Zwei Dinge, die beim Weiterarbeiten zählen:**

1. **Der lokale Volllauf braucht weiterhin einen Build vorher:**
   `corepack pnpm --filter @open-archiver/journaling build` und
   `corepack pnpm --filter @open-archiver/backend build`. Der `copy-assets`-Schritt des Backends
   scheitert auf diesem Host (`pnpm` nicht im PATH), **nach** dem `tsc` — für die Tests genügt das.
2. **Für einen echten Volllauf werden jetzt mehr Umgebungsvariablen gebraucht als vorher** (seit
   `JR-6-02b` die Backend-Adapter gegen `IngestionService`/`StorageService`/`SearchService` verdrahtet):
   `STORAGE_TYPE=local`, `STORAGE_LOCAL_ROOT_PATH=<schreibbarer Pfad>`,
   `ENCRYPTION_KEY=<32+ Bytes>`, `JWT_SECRET=<beliebig>`, `MEILI_MASTER_KEY`, `MEILI_HOST` — zusätzlich
   zu `DATABASE_URL`/`OA_TEST_REQUIRE_INFRA=1`/`REDIS_*`. Ohne sie scheitern **einige**
   Integrationstestdateien schon beim Import (`Invalid STORAGE_TYPE: undefined` bzw.
   `ENCRYPTION_KEY is not set`) — sichtbar als „Failed Suites", nicht als stiller Skip, aber leicht mit
   einer echten Regression zu verwechseln, wenn man die Fehlermeldung nicht liest.

> **Zur Entscheidung beim Auftraggeber:**
>
> - **~~`JR-6-03`s Drei-Zeilen-Lesart~~ — entschieden.** Drei Zeilen sind die einzige implementierbare
>   Form (append-only Ledger); der eigentliche Fehler war der fehlende eigene Event-Typ für den
>   Marker, behoben mit **ADR-037**. Kein Entscheidungsbedarf mehr.
> - **~~Soll ein automatisierter Ende-zu-Ende-Test gegen echtes Meilisearch gebaut werden?~~ —
>   entschieden und erledigt** (Auftrag (a), siehe oben, ADR-035). Kein Entscheidungsbedarf mehr.
> - **F64** (neu): soll der hängende Shutdown untersucht werden (welches Handle genau)? Ausdrücklich
>   noch nicht angefasst, auf Anweisung. Blockiert `JR-6-03`/`JR-6-04` nicht — `process.exit(0)` bleibt
>   der Produktionscode, bis jemand die Ursache findet und einen echten Fix vorschlägt.
> - **F62** (unverändert, niedrige Schwere): soll `IJournalInboundJob` aus `packages/types` entfernt
>   werden? Unbenutzt, aber ein exportierter Typ könnte theoretisch extern importiert sein. Blockiert
>   nichts.
> - **F60** (unverändert): `StorageService.put()` puffert einen Stream. Vorgeschlagene Zuordnung E7.
>   Blockiert `JR-6-03`/`JR-6-04` nicht.
> - **F43**, **F39**, **F42**, **F17(b)** — unverändert, blockieren nichts.
> - **Die Doku-Diät** — **erledigt am 2026-08-06** (dieser Auftrag). Pflichtlektüre unter 40 000
>   Tokens, Vorher/Nachher-Tabelle in `06-status.md`.

### Was davor passiert ist — die Historie steht in `06-status.md`

**Diese Datei führt keine Sessionhistorie mehr.** Bis zum 2026-07-30 trug sie neun „Was davor passiert
ist"-Abschnitte mit rund 550 Zeilen — jeder von ihnen die Kurzfassung eines Protokolls, das in
`06-status.md` mit Kommandos und Ausgaben vollständig steht, und jeder Block verwies dafür selbst
dorthin. Der Kopf dieser Datei verlangt seit dem ersten Tag, dass der untere Teil **überschrieben** wird
statt angehängt; die Regel war verletzt, und eine doppelt geführte Historie ist die verlässlichste
Quelle für Widersprüche (am 2026-07-28 genau so passiert).

Wer die Vorgeschichte braucht, liest `06-status.md` — dort in dieser Reihenfolge (neueste zuerst):
`JR-13-18`, Abnahme `JR-13-09b`, `JR-13-17`, Abnahme `JR-13-09a`, Nacharbeit `JR-13-13`–`JR-13-15`, Abnahme
`JR-13-09`, `JR-13-07`, Grün-Lauf der Fixes `JR-13-02`–`JR-13-06`, der Testwiderspruch (ADR-018), Rot-Läufe
`JR-13-01`, dazu E1 in `11-archiv-e1.md`. `JR-13-08` steht ebenfalls in `06-status.md`.

**Was hier bleibt** und nicht nach `06-status.md` gehört, weil es kein Protokoll ist: der aktuelle Stand
und der nächste Schritt (oben), die Umgebungsbeschreibung, die **Fallstricke** (unten — sie werden
projektweit als „Fallstrick N" referenziert), die offenen Fragen an den Auftraggeber und die Vorlage.

### Was ein neuer Agent zuerst lesen muss

1. `docs/dev/journaling/README.md` — Einstieg und Lesereihenfolge
2. `docs/dev/journaling/06-status.md` — verbindlicher Stand
3. diese Datei
4. `CLAUDE.md` — Repo-Konventionen und Fallstricke
5. Für die eigentliche Task: `03-backlog.md` (Akzeptanzkriterien) und `02-architektur.md`

### Offene Fragen an den Auftraggeber

**Stand 2026-08-05 — was wirklich offen ist, in dieser Reihenfolge:**

0. **`F60`: `StorageService.put()` puffert Streams, obwohl die Signatur Streams verspricht** — jetzt
   beheben oder E7 zuordnen? **Empfehlung: E7**, wo `S3StorageProvider` für Object Lock ohnehin
   angefasst wird. Zu entscheiden ist dort auch, **wie**: die Verschlüsselung auf einen Stream-Cipher
   umstellen (`createCipheriv` kann streamen) oder die Signatur ehrlich auf `Buffer` verengen. Die
   zweite Variante ist kleiner und schlechter — sie macht die Grenze sichtbar, hebt sie aber nicht auf.
   **Blockiert E6 nicht:** die Vollpufferung ist bewusst hingenommen (bei 50 MB und Concurrency 3 liegen
   im schlechtesten Fall drei Nachrichten doppelt im Heap).
    > **~~`F59`~~ und ~~`F61`~~ sind behoben.** F61 war die wahre Ursache der roten Läufe, F59 ein
    > latenter Defekt, dem nie ein beobachteter Fehlschlag zugeordnet werden konnte. Ein roter Lauf an
    > `ingress-process-boot.test.ts` ist damit **wieder eine Aussage** — und er meldet jetzt Exit-Code,
    > Signal und `stderr` mit, was diese Runde gekostet hat, weil er es vorher nicht tat.
1. **`F43`: soll `JR-3-02`s Speichernachweis nachgemessen werden?** Das ist die einzige Frage, die
   ein **abgenommenes** Epic berührt. `heapUsed` kann Vollpufferung in Node-`Buffer`n nicht sehen —
   gemessen, mit absichtlich eingebauter Regression kalibriert. Der **Code** ist mit hoher
   Wahrscheinlichkeit korrekt (`writeDurableSpoolFile()` streamt), der **Nachweis** trägt nicht. Der
   Aufwand ist klein (dieselbe Kalibrierung einmal dort fahren), aber es ist Nacharbeit an E3 und
   damit eine Entscheidung, keine Aufgabe. **Blockiert E6 nicht.**
2. **`F39`** (niedrig, Testharness) und **`F42`** (niedrig, totes `tsconfig.build.json`) — beheben
   oder bewusst akzeptieren? Beide blockieren nichts. Sinnvoller Ort für F39 wäre die nächste Arbeit
   an `packages/journaling`, also E6.
3. **`F17(b)`** — Rollen-Bootstrap reparieren? Unverändert eine Produktentscheidung, kein Teil von E6.
4. ~~**Die Doku-Diät**~~ — **erledigt am 2026-08-06.** Pflichtlektüre war auf über 70 000 Tokens
   gewachsen; jetzt unter 40 000. Vorher/Nachher-Tabelle mit Methode in `06-status.md` unter
   „Doku-Diät (E6)".

**Beantwortet und nicht mehr offen (Archiv):** alle bis 2026-08-05 abgeschlossenen Fragen — E2/E13-Ära,
`ADR-006`/`ADR-007`/`ADR-017`/`ADR-020`/`ADR-029`, `F7`/`F12`/`F17`–`F26`, geschlossene Pull Requests,
`JR-1-05c`, `JR-13-12`/`-16`/`-17` — liegen seit 2026-08-06 unverändert in
[`20-archiv-offene-fragen-bis-jr6.md`](20-archiv-offene-fragen-bis-jr6.md) (Doku-Diät).

Die folgenden Punkte werden zum jeweiligen Epic zur Entscheidung vorgelegt und sind in
`05-entscheidungen.md` als offene ADRs geführt:

| Wann      | Frage                                                                                                                                                                                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~E2~~    | ~~Kanonische Kodierung und Genesis-String endgültig fixieren (ADR-006)~~ — **entschieden 2026-07-31 (`JR-2-03`):** 16 gehashte Felder statt der acht aus RFC §5.2, Genesis mit `deployment_id` und `chain_scope_id` als UUID-Textform, eigene `deployment_identity`-Tabelle, Merkle nach RFC 6962, mit Testvektoren        |
| ~~E2~~    | ~~Eine Kette global oder eine pro Mandant (ADR-007)~~ — **entschieden 2026-07-31: je Mandant, `chain_scope_id` = `ingestion_sources.id`**                                                                                                                                                                                  |
| ~~E7/E8~~ | ~~Welche TSA?~~ **Entschieden 2026-07-31, ADR-023:** kein Standard-URL; qualifizierte eIDAS-TSA in der Produktion mit GoBD-Anspruch, `open-tsa.eu` als kostenlose Option ohne diesen Anspruch und als echte TSA in `nightly`, `ci` hermetisch. **Ankerform: ADR-022** — ein Token über die Merkle-Wurzel aller Kettenköpfe |
| E7        | Aufbewahrungsfrist für Object Lock COMPLIANCE. **Vorher lesen:** unter COMPLIANCE ist vorzeitige Löschung technisch unmöglich, auch für uns                                                                                                                                                                                |
| E12       | Steht ein echter Exchange-Online-Tenant für `JR-12-08` zur Verfügung? Ohne ihn ist E12 nicht abnehmbar; Mocks sind kein Ersatz                                                                                                                                                                                             |

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
