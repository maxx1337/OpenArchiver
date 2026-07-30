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

**Stand:** 2026-07-29 (**`JR-1309b` hat E13 zum _dritten_ Mal abgelehnt — F31; ADR-020 ist berichtigt,
`JR-1318` ist committet, die vierte Abnahme `JR-1309c` ist beauftragt aber _nicht durchgeführt_**) ·
**Branch:** `claude/journaling-e13-iam-hardening`, HEAD **`e22b5af`** · Arbeitsbaum **sauber** ·
**nicht gepusht** (SSH-Key gesperrt, siehe Umgebung)

### Der Stand in einem Satz

`JR-1309b` hat E13 zum dritten Mal abgelehnt (17 von 18 Kriterien erfüllt): der Abdeckungsanspruch war
nicht verschwunden, sondern von der Abfrage auf den **Verhaltenscheck** gewandert (**F31**) — Ursache war
**ADR-020 selbst**, die den Verhaltenscheck „vollständig" nannte. Die ADR ist berichtigt, **`JR-1318`
(`939df10`) setzt es um**, und **die vierte Abnahme `JR-1309c` ist der einzige offene Schritt**.

> ### Warum die Session hier endet — und was das für den Start bedeutet
>
> **Der Tester-Subagent ist mitten im Auftrag `JR-1309c` an ein Session-Limit gelaufen**
> („You've hit your session limit · resets 3:30am"). Die Abnahme ist **beauftragt, aber nicht
> durchgeführt** — es liegt **kein** Ergebnis vor, auch kein teilweises. Der vollständige Auftragstext
> steht unten; er kann wörtlich erneut vergeben werden.
>
> **Zwei Dinge sind dadurch ungewöhnlich und dürfen nicht als Nachlässigkeit missverstanden werden:**
>
> 1. **`JR-1318` hat keinen DEV-Bericht.** Der Agent hat committet und sich dann zweimal als verfügbar
>    gemeldet, ohne zu berichten; die Nachforderung blieb unbeantwortet. Was in `06-status.md` unter
>    „`JR-1318` committet" steht, ist die **Lesart des PO aus dem Diff**, nicht gemessen. `JR-1309c` muss
>    daher **alles selbst messen**. Das ist kein Schaden — es gibt keine Behauptung, die ein Prüfer
>    versehentlich übernehmen könnte.
> 2. **Die Statuspflege ist committet** (`e22b5af`, sieben Dateien: die sechs Planungsdokumente plus
>    `.claude/agents/tester.md`). Der Arbeitsbaum ist sauber. Prüfgegenstand von `JR-1309c` ist allein
>    `939df10`; `e22b5af` ist Statuspflege und Rollendefinition, kein Prüfgegenstand.
> 3. **Nichts ist gepusht.** `939df10` und `e22b5af` liegen nur lokal. Der Remote-Stand ist zuletzt bei
>    `2a4ea80` bekannt — **unbestätigt**, weil `git ls-remote` nicht durchläuft. Vor dem ersten Push:
>    Abgleich nachholen (`git merge --ff-only origin/<branch>`, nie `reset --hard`).

### Die Umgebung hat sich geändert — lies das, bevor du „Immer zuerst" abarbeitest

**Diese Session lief auf einem Windows-11-Host, nicht in einem Linux-Container.** Die Anleitung unter
„Immer zuerst" und alle früheren Sessionprotokolle (`/var/tmp`, `apt`, pgdg, `psql -f`) setzen Linux
voraus. Was hier tatsächlich gilt — jeder Punkt gemessen, nicht vermutet:

| Sache                    | Zustand auf diesem Host                                                                                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm`                   | **nicht im PATH.** `corepack pnpm …` benutzen — liefert das gepinnte 10.13.1. Node 24.14.0, npm 11.9.0                                                                                                                                                                                                              |
| PostgreSQL               | **nicht installiert.** Kein Dienst, kein `psql`, kein Docker/Podman. Lösung unten                                                                                                                                                                                                                                   |
| `psql.exe`               | **existiert auch im Wegwerf-Cluster nicht** — die Windows-Binärdistribution ist minimal. SQL über einen Node-`postgres`-Client fahren                                                                                                                                                                               |
| WSL `Ubuntu-24.04`       | vorhanden, aber **nackt** (kein Node, kein Postgres) — **nicht** die Umgebung der Vorsessions                                                                                                                                                                                                                       |
| Redis, Meilisearch, Tika | fehlen. Für E13 nicht gebraucht; für E2 ff. zu klären                                                                                                                                                                                                                                                               |
| `git fetch/push`         | **funktioniert nicht.** `origin` ist `git@github.com:maxx1337/OpenArchiver.git`, `~/.ssh/id_rsa` ist **passphrase-geschützt**, der Dienst `ssh-agent` ist `Stopped`/`Manual`. Ein nicht-interaktiver Aufruf endet mit `Could not read from remote repository`, ein interaktiver **hängt** an der Passphrase-Abfrage |
| `pnpm lint`              | **strukturell rot: 388 Dateien** — `core.autocrlf=true` ohne `.gitattributes`, siehe **F35**. Das ist **kein** Formatierungsfehler im Repository. **Nicht** mit `prettier --write` „beheben" — das schriebe 388 Dateien um. Stattdessen `corepack pnpm exec prettier --check <eigene Dateien>`                      |

**Wegwerf-Cluster ohne Systeminstallation** — so ist er in dieser Session entstanden, PostgreSQL
**17.10**, dieselbe Version wie die CI und wie `JR-1309a`:

```powershell
# in einem Verzeichnis ausserhalb des Repositorys (Scratchpad):
npm install embedded-postgres "@embedded-postgres/windows-x64@17.10.0-beta.17"
# Binaries dann unter node_modules/@embedded-postgres/windows-x64/native/bin
#   -> nur initdb.exe, pg_ctl.exe, postgres.exe (KEIN psql.exe)
initdb -D <datadir> -U postgres --auth=trust --auth-local=trust --auth-host=trust -E UTF8 --locale=C
pg_ctl -D <datadir> -l <logfile> -o "-p 5432 -c listen_addresses=127.0.0.1" start
```

`DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres` · `OA_TEST_REQUIRE_INFRA=1`

> **Zwei Fallstricke bei `pg_ctl` auf Windows:** der Aufruf **kehrt nicht zurück**, wenn stdout an eine
> Pipe hängt — in eine Datei umleiten und den Serverstart am Log bzw. an `postmaster.pid` prüfen, nicht am
> Rückgabewert. Und `postgres.exe --version` **vor** dem `initdb` prüfen: das Standardpaket
> `embedded-postgres` zieht die neueste Version (hier 18.4), was eine unnötige Versionslücke zur CI
> aufreißt.

**Der Cluster dieser Session ist am Ende gestoppt und der Datadir gelöscht.** Die Prüfwerkzeuge von
`JR-1309b` (`adr020.cjs`, `thirdnumber.cjs`, `claims.cjs`, `extract.cjs`, `fixtures.cjs`, `run.cjs`,
`cross.cjs`, `overreport.cjs`, `sql/query1..3.sql`) liegen unter
`C:\Users\Maxim\AppData\Local\Temp\claude\X--NEW-DEVELOP-GIT-OpenArchiver\7b5a77e0-2ad8-461a-a03c-5648527b2cf7\scratchpad`
— **nicht** im Repository. Sie sind gegen den Vor-Fix-Stand kalibriert und für `JR-1309c` wertvoll; ist
das Verzeichnis weg, sind sie neu zu bauen (dann Punkt 1 des nächsten Schritts besonders beachten).

> **Zwei Lücken, die `JR-1309` offenlassen musste, sind in `JR-1309a` geschlossen:** der **HTTP-400-Pfad**
> ist end-to-end gemessen (`IamController.createRole` direkt aufgerufen, 11 × `400` mit dem Key bzw. Wert
> im Text, 5 × `201`), und die **Betreiber-SQL ist auf PostgreSQL 17.10** gefahren — zeichenweise
> identische Ausgabe wie auf 16.13 in allen drei Blöcken. Wie: `postgresql-17` (17.10-1, dieselbe
> Version wie die CI) aus dem pgdg-Repository (`https://apt.postgresql.org/pub/repos/apt noble-pgdg`),
> eigener Cluster auf Port **5433**, alle 41 Migrationen per `psql -f`, danach Paketquelle und Cluster
> restlos entfernt.

> **`JR-1316` ist am 2026-07-29 aus E13 herausgenommen worden — Entscheidung des Auftraggebers.** Sie
> sichert kein Autorisierungsverhalten, sondern ein **Doku-Artefakt** ab, und sie war **kein** Kriterium
> von `JR-1309a`. **F30 ist allerdings genau der Fall, gegen den sie schützen würde** — die Betreiber-SQL
> ist weiterhin das einzige sicherheitsrelevante Artefakt in E13 ohne Test, und sie ist jetzt zum
> zweiten Mal die Stelle, an der die Abnahme scheitert. Das ist ein Argument für ein Vorziehen, keine
> Entscheidung des Testers.
>
> > **Nachtrag `JR-1317` (DEV):** die Abfrage hat nach diesem Fix **drei** neue Befundtypen und eine neue
> > CTE-Spalte und ist weiterhin ohne Test. ADR-020 nimmt ihr die Beweislast — sie **meldet** nur noch —,
> > aber die Regression, gegen die `JR-1316` schützt, bleibt möglich: ein späterer Eingriff kann sie
> > stillschweigend wieder auf die Wurzel zurückdrehen oder ein Falsch-positives einführen. Die Reihenfolge
> > entscheidet der Auftraggeber; DEV legt es nur erneut vor.

### Nächster konkreter Schritt — die vierte Abnahme `JR-1309c`

**Nichts wartet auf eine Entscheidung.** `JR-1318` ist committet (`939df10`), ADR-020 ist berichtigt, der
Umfang von `JR-1309c` steht in `03-backlog.md`. **Noch schmaler** heißt: `JR-1307`s Kriterium 12 und die
Kriterien von `JR-1318`, **nicht** die Abfrageseite erneut — `JR-1309b` hat sie unabhängig belegt und
`JR-1318` fasst keine SQL an.

```
Nimm Epic 13 ein viertes Mal ab — Rolle Tester, Umfang JR-1309c.
Branch claude/journaling-e13-iam-hardening, HEAD 939df10.
Umfang: JR-1307 Kriterium 12 und JR-1318 (F31 tragend, F32-F34 mit).
Es liegt KEIN DEV-Bericht vor - alles selbst messen.
```

Was `JR-1309c` prüfen muss, und wo der Hebel liegt:

1. **Der Anker der Textprüfung ist weg — er muss neu gesetzt werden.** `JR-1318` hat genau den Satz
   entfernt, an dem der Selbsttest des Scanners hing; ein sauberer Lauf belegt damit wieder nichts.
   Vorgehen (vom Prüfer selbst vorgeschlagen): Wegwerf-Kopie der behobenen Seite, den F31-Satz
   **absichtlich wieder einsetzen**, zeigen dass das Werkzeug ihn noch findet. **Whitespace zuerst
   normalisieren** — die Prosa ist hart umbrochen, und genau daran hat die Prüfung in `JR-1309b` schon
   einmal ein falsches „behoben" gemeldet (Fallstricke unten).
2. **Die Textprüfung läuft über die _ganze_ Seite, nicht über den Diff.** Dreimal in Folge saß der Defekt
   in Text, der **in derselben Runde neu geschrieben** wurde. Erwartung: kein bekannter Bruch **und** kein
   neuer Abdeckungssatz. Ein neuer Fund geht **unbewertet** an den PO — der Prüfer meldet Ort, Wortlaut
   und Regel, er entscheidet nicht.
3. **Beide F31-Hälften getrennt prüfen, keine trägt die andere.** Der Absolutsatz muss weg **und** die
   dritte zeilengefilterte Oberfläche (Ingestion-Quellenliste) muss benannt sein. Ein reines Streichen
   wäre Text ohne Reichweite. Die dritte Zahl ist über `FilterBuilder.create` zu **messen**: an einer
   Rolle mit Archiv-Grants und nur einem Verbot auf der `ingestion`-Seite bleiben beide Archivzahlen
   stehen, während der Filter auf `ingestionSourceId = "-1"` umschlägt.
4. **Die fünf neuen Faktenaussagen von `JR-1318` sind ungeprüft** und präziser als der alte Text, damit
   leichter falsch: dass der Befund „archive search granted without archive read" **keine** Regelnummer
   nennt; F33s Aufteilung in verlorene und ankommende Befunde samt „names the rule number with no action
   or subject beside it"; F32s „finds all five"; F34s „just as readily"; und dass `manage` **und**
   `subject: "all"` gegen jede der drei Berechtigungen gematcht werden. Vollständig aufgelistet in
   `06-status.md` unter „`JR-1318` committet".
5. **Umfang und Volllauf:** `git show --stat` gegen „ausschließlich `access-control-changes.md`"; Suite
   `250 passed | 2 skipped` bei **17** Dateien (die temporäre Sonde ist entfernt — eine andere Zahl oder
   eine zusätzliche Testdatei ist eine **Abweichung und zu berichten**); `lint`, `docs:build`,
   `dist/dev/` existiert nicht; `FilterBuilder.ts`/`mongoToMeli.ts` blob-identisch zu `13a7114`.

**Erst nach der Annahme:** Rückmerge in den Integrationsbranch (ADR-014, `--no-ff`, **kein Squash** — ein
Squash würde die **drei** dokumentierten Ablehnungen tilgen und damit den Beleg, dass die Abnahme
funktioniert hat), dann `JR-1312` als Grundlagenarbeit direkt dort. `main` bleibt bis E12 unangetastet.
Nächstes Epic ist **E2**, fällig ist davor **`JR-105c`** (F14–F16, F24).

**Unverändert offen und richtig so:** die **Laufzeitseite von F26** — ein bereits gespeichertes
`conditions: null` / `""` / `0` / `false` liefert weiter Vollzugriff, weil `FilterBuilder.ts:51–53`
unverändert `!rule.conditions` liest. In `JR-1309a` nachgemessen (`UNRESTRICTED` vor **und** nach E13)
und als erfülltes Kriterium verbucht; die Datei ist blob-identisch zu `13a7114`. Gehört zu `JR-1311`.
`JR-1310`, `JR-1311`, `JR-1312`, `JR-1316` waren und bleiben **nicht** Teil von E13s Abnahme.

### Was zuletzt passiert ist — `JR-1317` (F30 behoben, ADR-020 umgesetzt)

Rolle `senior-dev`, zwei Commits: **`07ac661`** die einzige inhaltliche Datei
(`docs/user-guides/upgrade-and-migration/access-control-changes.md`), der **Folgecommit** die Statuspflege
(`06-status.md`, `07-session-handover.md`, `09-befunde-bestandscode.md`, `README.md`).
Vollständige Fassung mit Kommandos und Ausgaben in `06-status.md` unter „`JR-1317` erledigt", die
Befundauflösung in `09-befunde-bestandscode.md` unter **F30**.

**(a) Knotenebene.** `cond` trägt eine neue Spalte `path` (Wurzel `"conditions"`, Objektkind
`-> "key"`, Arrayelement `-> []`), und drei Befundtypen speisen aus `cond` statt aus `pair`:

| Befundtyp                               | Prädikat                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `empty condition object`                | `c.node = '{}'::jsonb` in **jeder** Position (ersetzt `empty conditions object`) |
| `condition node is not an object`       | `$or`/`$and`-Arrayelement bzw. `$not`-Rumpf mit `jsonb_typeof <> 'object'`       |
| `condition branch list is not an array` | `$or`/`$and`, dessen Wert kein Array ist                                         |
| `conditions is not an object`           | **unverändert** aus `pair`, Wurzel, mit den zwei Lesarten je Wert                |

Die Prädikate sind aus `checkConditionsShape()` und den Rekursionsstellen in `mongoToDrizzle`
**abgeleitet**. Geprüft wird nur ein Knoten in **struktureller** Position; ein pauschales
`jsonb_typeof(node) <> 'object'` hätte jedes Blatt jeder normalen Bedingung gemeldet (Fallstrick 20).

**Beide Nachweise, Blöcke wörtlich aus der `.md` gegen PostgreSQL 16.13, 41 Migrationen, 26 Rollen:**
alle **acht** F30-Formen werden gemeldet, je mit Position; `{"$or": []}`/`{"$and": []}` und alle
Wurzelformen weiter; **keine Falsch-positiven** — drei `predefined_*` und acht Kontrollen in **keiner**
der drei Ausgaben, maschinell verglichen. Zusätzlich gegen den Übersetzer gekreuzt (37 Werte über
`dist/helpers/mongoToDrizzle.js`): verweigert ⇒ gemeldet, übersetzbar ⇒ still, mit zwei benannten
bewussten Abweichungen (siehe Punkt 3 oben).

**(b) Der Abdeckungsanspruch ist weg** — das war der eigentliche Fix (ADR-020). „It examines" ⇒ „What it
reports"; „recursively" steht nicht mehr als Zusage; der widerlegte Satz zu „the values inside a
condition" ist ersetzt; ausdrücklich ergänzt, dass eine Abfrage über schemaloses JSONB **nicht als
vollständig gezeigt werden kann** und ein leeres Ergebnis ein **Hinweis, keine Freigabe** ist; an die
Stelle der Zusage tritt eine **verifizierbare Gegenprobe ohne Formliste** (zwei Zahlen je Rolle
vorher/nachher vergleichen) samt dem Hinweis, dass eine unübersetzbare Bedingung jetzt einen **Fehler**
erzeugt. **Vier weitere Abdeckungssätze** derselben Klasse waren auf der Seite und sind mit ersetzt.

**Kein Produktionscode, kein Test, keine Migration, kein i18n-Key.** `conditionKey.ts` war Referenz,
nicht Ziel; kein Defekt darin gefunden. `pnpm lint`, `test:types`, Backend-Build und `pnpm docs:build`
grün, `docs/.vitepress/dist/dev/` fehlt weiterhin, Suite unverändert `250 passed | 2 skipped`, Exit 0.
Proben liefen in `/var/tmp` und im Scratchpad, **nicht** im Repository; 0 `oa_test_*`-Rückstände nach dem
Volllauf, Cluster und Prüfdatenbanken restlos entfernt.

### Was davor passiert ist — die Abnahme `JR-1309a`

Unabhängige Session, Rolle `tester`, HEAD `2a8df48`, zuerst gegen das Remote abgeglichen (identisch).
Vollständige Kriterientabelle mit Kommandos und Ausgaben in `06-status.md` unter „Abnahme `JR-1309a`".

**F30 in einer Tabelle** — `FilterBuilder` von `efea6bc` gegen den von `HEAD` im selben Prozess, echtes
PostgreSQL 16.13 mit den 41 Migrationen, 54 gesäte Rollen, Paar `('archive','read')`, die drei
` ```sql `-Blöcke wörtlich aus der veröffentlichten Datei:

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

Gegenprobe im selben Lauf: `{"$or": []}` und `{"$and": []}` **werden** gemeldet, ein Formfehler an einem
**Key** in beliebiger Tiefe ebenfalls, und die drei `predefined_*` plus drei handgeschriebene Kontrollen
erscheinen in **keiner** Ausgabe. Der Ausfall betrifft die **Knotenform**, nicht die Rekursion.

**Was gehalten hat, gemessen statt übernommen:** die zwei Gates urteilen deckungsgleich **und** richtig
(26 Keys × 2 Gates × eigene Erwartung, 0 Divergenzen — darunter fünf Keys, die die ausgelieferte
Testdatei nicht führt, etwa die Groß-/Kleinschreibung der Relationstabelle); alle 10 Nicht-Objekt-Formen
von `conditions` werden beim Anlegen mit `400` abgewiesen, vor E13 waren alle 10 `ACCEPT`; die
Vorher/Nachher-Tabelle aus `JR-1314` hält an allen 17 Wurzelwerten; `predefined-roles.int.test.ts` 7/7
grün; `FilterBuilder.ts` und `mongoToMeli.ts` blob-identisch zu `13a7114`; F2/F9/F10-Dateien
blob-identisch zu `efea6bc`, F4/F5/F6 pre gegen post gleich; genau **ein** vorher grüner Pin ist
umgedreht (alter `policy-validator.test.ts` gegen neuen Validator ⇒ `1 failed | 52 passed`); Suite
`250 passed | 2 skipped`, Exit 0, die 2 Skips aus dem JSON-Report als `[nightly]`/`[manual]`
identifiziert; öffentliche Doku ohne interne IDs, Nutzlast und Compliance-Behauptung;
`docs/.vitepress/dist/dev/` existiert nicht und der Suchindex enthält keinen `dev/`-Pfad; `main` =
`a560b8c`, kein PR aus E13.

**Kein Produktionscode, kein Test, keine öffentliche Doku geändert.** Proben in
`packages/backend/.probe/` (danach gelöscht) und in Wegwerf-Datenbanken. 0 `oa_test_*`-Rückstände nach
dem **Volllauf**; beide Cluster (16.13 auf 5432, 17.10 auf 5433), die Prüfdatenbanken und die
pgdg-Paketquelle sind restlos entfernt.

### Was davor passiert ist — die Nacharbeit `JR-1313`–`JR-1315`

Rolle `senior-dev`, drei Commits, je einer pro Task, gepusht. Vollständige Fassung mit allen Ausgaben in
`06-status.md` unter „E13 — Nacharbeit `JR-1313`–`JR-1315` erledigt".

| Commit    | Task      | Kern                                                                                                               |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| `cfb1462` | `JR-1313` | neues, **importfreies** Modul `src/helpers/conditionKey.ts`; beide Gates fragen es; `conditions` muss Objekt sein  |
| `c17144e` | `JR-1314` | Query 2 neuer Befundtyp, Query 3 `subject = 'all'` → beide Tabellen, Absolutsatz **ersatzlos** weg, Änderung 8 neu |
| `5c8a521` | `JR-1315` | Behauptung auf F4 eingeschränkt **und** F5-Kommentar nachgezogen — beides, mit Begründung                          |

**Warum `conditionKey.ts` und nicht eines der beiden Gates:** der Validator darf `mongoToDrizzle` nicht
importieren (zieht `drizzle-orm` in eine Klasse, die nur Typen importiert, und damit in jeden
Policy-Unit-Test), und ein SQL-Übersetzer hat nichts im IAM-Modul zu suchen; `relationToTableMap` gehört
neben den Code, der Tabellennamen rendert.

**Belege, die eine Abnahme nachrechnen kann:**

- **Suite vorher/nachher:** `224 passed | 2 skipped` ⇒ `250 passed | 2 skipped`, 16 ⇒ 17 Dateien, `unit`
  `minimumFiles` 7 ⇒ 8. Beides Exit 0, 0 `oa_test_*`-Rückstände nach dem Volllauf.
- **Der eine getroffene Pin, einzeln nachgemessen:** alter `policy-validator.test.ts` gegen den neuen
  Validator ⇒ `1 failed | 52 passed`, genau „accepts conditions it does not understand" (`a.b.c`). Er
  dokumentierte F29 und ist ersetzt, nicht gelöscht.
- **Die Betreiber-SQL wörtlich aus der Datei gefahren**, PostgreSQL 16.13, 29 gesäte Rollen: Query 1 → 1
  Zeile, Query 2 → 25, Query 3 → 9. Die drei `predefined_*`, die Kontrolle und die Sonde
  `P2 rule is not an object` erscheinen in **keiner** Ausgabe.
- **Falsch-negativ-Prüfung:** Übersetzer `efea6bc` gegen HEAD auf 17 `conditions`-Werten im selben
  Prozess; jeder Wert mit `pre ≠ post` wird von einer der Abfragen gemeldet, **0 Ausnahmen**.
- **Kein neuer i18n-Key, keine Migration, kein Schemaeingriff.** `FilterBuilder.ts` und `mongoToMeli.ts`
  sind in allen drei Commits nicht angefasst.

### Was davor passiert ist — die Abnahme `JR-1309`

Unabhängige Session, Rolle `tester`, HEAD `54536cd` **zuerst gegen das Remote abgeglichen** (identisch
— kein Rollback). 21 Kriterien einzeln: **17 erfüllt**, 1 teilweise, 1 bewusst nicht erfüllt und durch
ADR-019 gedeckt, **2 nicht erfüllt**. Vollständige Tabelle mit Kommandos und Ausgaben in `06-status.md`
unter „Abnahme `JR-1309`".

**Was gehalten hat — und wie es gemessen wurde, nicht übernommen:**

- **`JR-1301`s Kernkriterium („ein Test, der nie rot war, belegt nichts").** Produktionscode in einer
  **Wegwerf-Kopie** auf `efea6bc` zurückgedreht ⇒ `23 failed | 201 passed | 2 skipped`. Zusätzlich vier
  **Einzelreverts**: `mongoToDrizzle` 11 rot, `FilterBuilder` 8, `policy-validator` 2, `SearchService`
  1 — jeder Fix ist einzeln tragend. Ein Fall (F19) braucht **zwei** Reverts, das ist Tiefenverteidigung.
  Statusdiff `8984ce9` ⇄ HEAD je `fullName`: rot⇒grün **21**, grün⇒nicht-grün **0**.
- **Die Suite ist wirklich vollständig gelaufen** (Fallstrick 6, F14/F15): 16 Dateien, 226 Fälle, die
  **2 Skips aus dem JSON-Report identifiziert** als genau die `[nightly]`- und `[manual]`-Suiten, alle
  8 `integration`-Dateien mit Fallzahlen, `minimumFiles` ohne Spiel (7/7, 8/8, 1/1).
- **Die Versionslücke 16.13/17.10 ist für die Suite geschlossen:** CI-Run **30456242256** auf `54536cd`
  gegen `PostgreSQL 17.10`, 14/14 Schritte grün, `224 passed | 2 skipped`. Die roten CI-Läufe der
  Rot-Phase (`f6a55c0`, `8984ce9`, `bbcd3e5`) sind ebenfalls belegt.
- **`predefined-roles.int.test.ts` ist kein Tautologie-Test.** Zwei Mutationen am Produktionscode der
  Rollendefinition ⇒ 4 von 7 bzw. 6 von 7 Fällen rot, inklusive der „green but empty test"-Falle.
- **Der Injektionsweg ist zu.** 12 Nutzlasten (F1 #4 plus NUL-Byte, Newline, Fullwidth-Homoglyph,
  Relationszweig, mehrteilige Keys), drei Gates, eine **Legacy-Rolle direkt in die Datenbank
  geschrieben** ⇒ jedes Mal Deny, **0** fremde Zeilen, kein unbeschränkter Filter.
- **F7 fail-closed auf Zeilenebene**, nicht am Rückgabewert: `auditor-specific-mailbox.json` (Fixture
  **von der Platte**) und ein Nutzer ohne Rolle liefern für `read` **und** `search` 0 Zeilen, und der
  Deny ist ein echtes Prädikat (`1=0` / `ingestionSourceId = "-1"`), kein fehlender Filter.
- **F2/F4/F5/F6/F9/F10 unverändert.** F2/F9/F10-Dateien blob-identisch zu `efea6bc`; F4/F5/F6 pre gegen
  post auf denselben Eingaben identisch gemessen. Produktionscode-Diff des Branches: **genau vier
  Dateien**, keine davon eine Datei dieser Befunde.
- **Öffentliche Doku sauber:** keine internen IDs, keine Compliance-Behauptung, keine Nutzlast.
  `10-upstream-meldung.md` ist **nicht** gebaut (`dist/dev` existiert nicht) und **nicht** im
  Suchindex (49 indexierte Seiten, kein Pfad unter `dev/`; Gegenkontrolle: der neue öffentliche Satz
  **ist** darin).
- **`main` = `a560b8c`**, kein E13-Commit darin, kein Rückmerge, **kein** neuer PR.

**Fünf neue Befunde, alle offen** (Details in `09-befunde-bestandscode.md`):

| Befund  | Kern                                                                                                                                        | Schwere        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **F25** | Die Statusaussage „F4 **und F5** sind im Code als bewusst offen kommentiert" ist für **F5 falsch** — F4 hat den Kommentar, F5 nicht         | niedrig        |
| **F26** | Ein `can` mit **falsy** `conditions` (`""`, `0`, `false`, `null`) liefert weiter **Vollzugriff**; der Validator akzeptiert es. Kein Regress | mittel         |
| **F27** | Query 2 der Betreiberdoku ist **falsch-negativ** für ein `conditions`, das kein Objekt ist: `conditions: 5` war vorher **unbeschränkt**     | mittel         |
| **F28** | Query 3 prüft Keys nicht für Regeln mit `subject: "all"` — ein Tippfehler dort wird nicht gemeldet, filtert aber das Archiv                 | niedrig–mittel |
| **F29** | `PolicyValidator` und `mongoToDrizzle` sind uneins über die Key-Form; die **veröffentlichte Doku** behauptet die strengere Variante         | niedrig        |

**Was nicht prüfbar war** (vollständig in `06-status.md`): die **Prüf-SQL gegen PostgreSQL 17.10**
(lokal nur 16er-Binaries — die Abfragen benutzen nur Sprachmittel ab PG 9.4, gemessen ist es aber
nicht); die **Meilisearch-Hälfte von `JR-1305` in Ausführung** (keine Engine — geprüft ist die erzeugte
Filterzeichenkette); der **HTTP-Pfad `400` end-to-end** (nur `PolicyValidator.isValid()` gemessen, ein
Servertest scheitert an der Importkette, Fallstrick 10); und **ob eine reale Installation eine Rolle
mit skalarem `conditions` besitzt** (F27s Auslöser ist eine fehlerhafte Policy — belegt ist nur, dass
der Absolutsatz der Anleitung falsch ist).

**Kein Produktionscode, kein Test, keine öffentliche Doku geändert.** Alle Proben liefen in
Wegwerf-Kopien unter `/var/tmp`; Cluster, Kopien und die Prüfdatenbank sind restlos entfernt,
0 `oa_test_*`-Rückstände nach dem Volllauf.

### Was davor passiert ist — `JR-1308`

**`JR-1308` ist erledigt (Rolle PO): der Entwurf liegt in `10-upstream-meldung.md`, ist _nicht_
versendet und _nicht_ veröffentlicht.** Englischer Meldetext, wie er versendet würde, plus eine
deutsche Entscheidungsvorlage darüber.

> **Kein Agent versendet diesen Text, öffnet damit ein Issue oder einen Pull Request.** Kanal,
> Zeitpunkt und Absender entscheidet der Auftraggeber. Die Datei liegt bewusst unter
> `docs/dev/journaling/` — sie beschreibt **nicht behobene** Lücken einer veröffentlichten Version und
> enthält eine funktionierende Injection-Nutzlast; `srcExclude: ['dev/**']` hält sie von der
> Doku-Website fern und muss das weiter tun.

Inhalt: vier Befunde (fail-open ohne `can`-Regel samt F19/F20, Injection über Condition-Keys,
stilles Verwerfen unübersetzbarer Bedingungen samt der Richtungskorrektur aus F22, wirkungsloser
`cannot`-Ausschluss bei Operator-Bedingungen), dazu **F17** als getrennter Bug statt als Teil des
Advisories. Zu entscheiden sind: **Kanal** (Upstream hat keine `SECURITY.md` ⇒ privates GitHub
Security Advisory, **kein** öffentliches Issue), **Zeitpunkt und Frist**, **Absender und ob eine CVE
beantragt wird**, und ob die Nutzlast bei einer öffentlichen Meldung entfernt wird.

**F2/F4/F5/F6/F9/F10 sind bewusst nicht enthalten** — offen dokumentiert, in diesem Fork nicht behoben;
eine Meldung ohne Fix und ohne eigene Prüfung wäre dünn. Ein Patch-Set für Upstream ist **noch nicht**
erzeugt: es müsste erst von den E1-Harness-Abhängigkeiten getrennt werden, die Upstream nicht hat.

**Zusätzlich `JR-1312` angelegt** für die veraltete IAM-Doku (`export` fehlt in der Action-Liste,
`manage` als Aufzählung statt als Wildcard beschrieben — die dritte Stelle aus `CLAUDE.md` §5.4). Reine
Dokumentation, gehört auf den **Integrationsbranch nach dem Rückmerge**. Bewusst **nicht** in `JR-1307`
mitgenommen, obwohl DEV dieselbe Datei angefasst hat: das hätte den Diff eines Sicherheits-Epics um
eine sachfremde Korrektur erweitert.

### Was davor passiert ist — `JR-1307`

**`JR-1307` ist erledigt (Rolle `senior-dev`), zwei Commits.** `efb5582` liefert ADR-016 und die
Betreiberdoku, `9b407db` die Statuspflege.

**ADR-016 ersetzt den Platzhalter in `05-entscheidungen.md`.** Status entschieden, Entscheider PO. Das
Argument ist wie vorgegeben nicht „Sicherheit geht vor": **„kein Recht auf dieses Subject" und „darf
alles sehen" wurden vom selben Wert dargestellt, und der unsichere war der Default** — ein Zustand, in
dem keine Zugriffsaussage über das Archiv belegbar ist, weil man einer Rolle nicht ansehen kann, ob sie
einschränkt. Verworfen ist die Alternative „Verhalten beibehalten und nur dokumentieren", auch in der
Schalter-Variante, mit dem konkreten Grund: **E11s Auditor-Rolle ist auf genau diesen Mechanismus
gebaut**, `auditor-specific-mailbox.json` erteilt für `archive` kein `can` und traf damit exakt den
`null`-Zweig — E11 wäre mit dem alten Verhalten nicht abnehmbar. Die Nummernlücke zwischen ADR-015 und
ADR-017 bleibt; der Hinweis „nicht umnummerieren" steht jetzt **im ADR selbst** statt im Platzhalter.

**Die Betreiberdoku liegt in der öffentlichen Doku, englisch (ADR-003):**

| Datei                                                              | Änderung                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `docs/user-guides/upgrade-and-migration/access-control-changes.md` | **neu** — Release-Hinweis plus Prüfanleitung mit drei SQL-Abfragen                |
| `docs/.vitepress/config.mts`                                       | Sidebar-Eintrag „Access Control Changes" unter „Upgrading and Migration"          |
| `docs/services/iam-service/iam-policy.md`                          | zwei neue Abschnitte „Condition Keys" und „When No Rule Applies", mit Querverweis |

**Begründung der Ablage:** die Prüfung findet **vor** einem Update statt, gehört also in die
Sidebar-Sektion, die ein Betreiber genau dann öffnet. `iam-policy.md` musste zusätzlich angefasst
werden, weil dort die geänderte Semantik nachgeschlagen wird — die Seite beschrieb bisher nicht, was
passiert, wenn **keine** Regel greift. `srcExclude: ['dev/**']` ist unangetastet;
`docs/.vitepress/dist/dev/` existiert nach `pnpm docs:build` weiterhin **nicht** (geprüft).

**Sieben Verhaltensänderungen sind benannt**, jede mit betroffener Policy-Form und Handlungsanweisung:
kein `can` ⇒ deny (mit allen drei Formen); unbedingtes `cannot` ⇒ deny; `conditions: {}` ⇒ deny; die
Suche filtert über `search` statt `read`; ein `cannot` mit Operator-Bedingung schließt jetzt
**wirklich** aus, Nutzer sehen also **weniger** Zeilen (aus `JR-1305`/F8 — stand nicht in der
Auftragsliste, ist aber betreibersichtbar und deshalb aufgenommen); Condition-Keys werden gegen die
Form geprüft (`400` beim Speichern, Fehler zur Abfragezeit bei Bestandsrollen); eine unübersetzbare
Bedingung führt zu einem **Fehler** statt zu einem stillschweigend falschen Ergebnis (ADR-018).

**Der ADR-019-Restspalt hat einen eigenen Abschnitt** („What is still not checked") und wird
ausdrücklich **nicht** als geprüft dargestellt: „The application does **not** perform this check. The
query does, and only for those two subjects." **F17 ist aufgenommen** — in einer frischen Installation
existiert nur die Super-Admin-Rolle, die beiden anderen `predefined_*`-Policies sind Vorlagen in der
Doku und keine Datenbankzeilen, und eine fehlende Read-Only-Rolle ist **kein Fehler der Installation**.
**Keine Pauschalwarnung**, mit dem Beleg, dass ein automatisierter Test die Unbetroffenheit der
`predefined_*`-Rollen gegen eine echte Datenbank prüft.

**Die Prüf-SQL ist gegen echtes Postgres ausgeführt** (16.13, lokaler Cluster ohne Docker, Fallstricke
Punkt 8) und **aus der Markdown-Datei extrahiert und wörtlich gelaufen**, nicht aus dem Entwurf:
Query 2 meldet **10 von 10** absichtlich betroffenen Rollen je mit Regelnummer, Query 3 findet den
Tippfehler-Key, den die Anwendung nicht prüft, Query 1 den Nutzer ohne Rolle. **Die drei
`predefined_*`-Rollen und die unbetroffene Gegenprobe erscheinen in keiner Ausgabe** — das trägt die
Aussage „keine Pauschalwarnung". Sieben Randfälle ohne Fehler und ohne Falschtreffer: Skalar als
Policy-Element, leeres `policies`-Array, `manage`/`all` als einelementiges Array, `a.b.c`, `$nor`,
`$not` um eine Operator-Bedingung, `conditions: null` an einem `cannot`. Vollständige Ausgaben in
`06-status.md` unter „E13 — `JR-1307` erledigt".

**Kein Produktionscode, keine Teständerung, keine Migration, kein i18n-Key** (die Doku enthält keine
UI-Zeichenkette). Keine `JR-*`-ID, keine F-Nummer, kein Ausnutzungsbeispiel und keine
Compliance-Behauptung in der öffentlichen Doku. `docs/api/openapi.json` ist durch `docs:build` nicht
verändert worden. `pnpm lint` grün, `pnpm docs:build` grün, `pnpm test` `224 passed | 2 skipped`,
Exit 0, 0 `oa_test_*`-Rückstände, Cluster restlos entfernt.

**Ein Befund beim Schreiben, gemeldet und nicht behoben:**
`docs/services/iam-service/iam-policy.md` listet die Action `export` weiterhin nicht und beschreibt
`manage` als Expansion auf `create/read/update/delete/search/sync` statt als echten CASL-Wildcard —
die in `CLAUDE.md` §5.4 benannte stale Stelle (3) des Permission-Vokabulars. Sie liegt in derselben
Datei, die `JR-1307` angefasst hat, gehört aber nicht zu dieser Task; (1) und (2) sind bereits einig,
es ist reine Doku-Nacharbeit. **Vorschlag: eigene Task, PO entscheidet.**

### Was davor passiert ist — die fünf Fix-Tasks

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

**Erledigt: der Widerspruch ist entschieden und aufgelöst (`704e8d1`, ADR-018).** Der PO hat so
entschieden wie oben vorgeschlagen — die Unit-Erwartung gilt. Der Tester hat **alle drei
Begründungen nachgemessen statt sie zu übernehmen** und eine verstärkt: die beiden Erwartungen sind
unter **jeder** Implementierung unvereinbar, weil keine prinzipielle Regel `{id:'a'}` anders behandelt
als `{userEmail:…}` — beide sind Gleichheit auf einer erlaubten Spalte. Die Korrektur ist **in beide
Richtungen mutationsgeprüft**, ist also kein Test, der bloß aufgehört hat zu scheitern. Endstand:
`224 passed | 2 skipped`, Exit **0**, 16/16 Dateien grün.

> **Dabei ist eine Aussage des PO korrigiert worden.** „Im `$or` nur verengend" (F22 und, in meiner
> Fassung vom 2026-07-29, `JR-1304`s Kriterium) gilt **nur**, solange die Disjunktion oben in einer
> `can`-Komposition steht. Unter dem `$not` — und `FilterBuilder.ts:84` setzt **jede**
> `cannot`-Bedingung genau dorthin — ist derselbe Wegfall **fail-open**: `not A` ist wahr für jede
> Zeile, die der verlorene Zweig verbieten sollte. Richtig ist der unbedingte Satz: **ein weggelassener
> Zweig ist nie harmlos; die Richtung hängt von der Komposition ab, und die kennt der Übersetzer
> nicht.** F22 und `JR-1304`s Kriterium sind berichtigt, ADR-018 hält fest, dass `mongoToDrizzle`
> deshalb auch später keinen milden Modus bekommen darf.

**Eine benannte Abweichung von der F21-Entscheidung.** „Abgewiesen wird jeder unbekannte Key" ist als
Allowlist über die **Form** des Keys plus die Relation umgesetzt: ein einzelner Identifier oder
`<relation>.<identifier>` mit Relation aus `relationToTableMap`. Damit fallen alle SQL-Syntax-Keys und
alle Keys mit unbekannter Relation heraus (`attachment.name`, `foo.bar`, `a.b.c`). Ein einzelner,
unbekannter, syntaktisch harmloser Key (`foo`) wird **weiter übersetzt**: `mongoToDrizzle` kennt die
Zieltabelle nicht, und eine spaltengenaue Allowlist hätte drei weitere heute grüne Pins gebrochen
(`{a:1}`, `{b:2}`, `{n:{$gt:1}}` plus die `FIELDS`-Liste der adversarialen Suite) — was der Auftrag
ausschloss. Vorschlag: spaltengenaue Prüfung dort, wo das Subject bekannt ist, also bei `JR-1310`.

**Vom PO angenommen und festgeschrieben (ADR-019), mit einer Korrektur am Vorschlag.** Die Abweichung
ist tragfähig: der Zweck von F1 war der Injektionsweg, und der ist an **zwei** Stellen zu — der
`PolicyValidator` weist eine Policy mit nicht-identifierartigem Key beim Anlegen ab, `mongoToDrizzle`
erneut zur Abfragezeit, und `sql.raw` ist aus dem Relationszweig entfernt. Der Restspalt ist ein
Policy-Schreibfehler, kein Angriffsweg. Er wird als **`JR-1311`** geführt — und zwar **nicht** bei
`JR-1310`: die spaltengenaue Prüfung gehört in `FilterBuilder.create()`, das `resourceType` bereits als
Parameter bekommt, und braucht Variante C dafür nicht. Meine F21-Formulierung „jeder unbekannte Key"
war zu absolut geschrieben, ohne zu berücksichtigen, dass `mongoToDrizzle` subjektagnostisch ist.

**Geänderter Produktionscode: vier Dateien.** `src/services/SearchService.ts`,
`src/services/FilterBuilder.ts`, `src/helpers/mongoToDrizzle.ts`,
`src/iam-policy/policy-validator.ts`. **`mongoToMeli.ts` ist unverändert.** Geänderter Testcode: nur
die vom PO freigegebene F21-Invertierung in `src/helpers/mongoToDrizzle.test.ts` und
`tests/fixtures/mongo-to-drizzle-golden.json`. **Keine Migration, kein Schemaeingriff, kein neuer
i18n-Key** — der Ablehnungsgrund des Validators wird wie die bestehenden Gründe auf Englisch hinter
`req.t('iam.invalidPolicy')` angehängt; dass diese Gründe nicht lokalisiert sind, ist Bestandszustand.

**Bewusst nicht angefasst:** F2, F4, F5, F6, F9, F10, F17, F18, F22, F23. F4 und F5 sind in
`mongoToDrizzle` im Verhalten erhalten; **berichtigt (F25, `JR-1315`):** als bewusst offen kommentiert
wurde in diesem Commit nur **F4**, der F5-Kommentar kam erst mit `JR-1315`. `pnpm lint` grün,
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

### Material, das `JR-1308` verwendet hat (erledigt — der aktuelle nächste Schritt steht oben)

> Dieser Abschnitt beschrieb `JR-1308` als nächsten Schritt. **`JR-1308` ist erledigt** (und in
> `JR-1309` als erfüllt bestätigt), der Entwurf liegt in `10-upstream-meldung.md`. Der nächste Schritt
> ist die Nacharbeit `JR-1313`–`JR-1315` — siehe oben. Die Materialliste bleibt stehen, weil sie beim
> Versenden noch gebraucht wird.
>
> **Ergänzung aus `JR-1309`:** wenn der Auftraggeber die Meldung versendet, gehört **F29** mit hinein —
> der `PolicyValidator` weist einen Key mit unbekannter Relation beim Anlegen **nicht** ab, obwohl das
> die naheliegende Erwartung ist. Für Upstream ist das keine eigene Lücke (der dortige Code prüft
> Condition-Keys überhaupt nicht), aber es gehört in den **Fix-Vorschlag**, damit der nicht unvollständig
> übernommen wird. **F25–F28** sind Befunde an **diesem** Fork und gehören nicht in die Meldung.

Material lag vollständig vor und musste nicht neu erarbeitet werden: F7 in
`09-befunde-bestandscode.md` (Befund, Erreichbarkeit, Bewertung, gegen echtes Postgres verifiziert),
ADR-016 (Begründung der gewählten Semantik), ADR-017 (der Action-Versatz als zweiter Weg),
`tests/integration/filter-builder-f7.int.test.ts` (Reproduktion) und die vier Commits `bcac6bd`,
`a309fd1`, `45ac0e9`, `2311996`, `dcec017` (Fix-Vorschlag). **Für die Reproduktion in einer
öffentlichen Meldung gilt dieselbe Zurückhaltung wie in der Betreiberdoku:** F1s vierter Payload ist
lauffähig und gehört nicht in einen offenen Kanal, solange der Auftraggeber nicht über den Kanal
entschieden hat.

**Rückmerge in den Integrationsbranch erst nach einer _angenommenen_ Abnahme** (ADR-014) — `JR-1309`
**und** `JR-1309a` haben E13 abgelehnt; `main` bleibt bis E12 unangetastet; kein PR ohne ausdrückliche
Aufforderung.

**Das Kommando für den Suitenlauf** — Postgres lokal ohne Docker, siehe Fallstricke Punkt 8:

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

**Keine blockierende Frage.** Die eine blockierende Frage war **F30**; der Auftraggeber hat sie mit
**ADR-020** entschieden (beheben **und** den Anspruch aufgeben), und `JR-1317` hat sie umgesetzt. Nächster
Schritt ist reine Prüfarbeit (`JR-1309b`).

**Zwei Punkte aus `JR-1317`, beide nicht blockierend, beide Entscheidung des Auftraggebers:**

1. **`JR-1316` vorziehen?** Unverändert vorgelegt, jetzt mit einem Argument mehr: die Abfrage hat nach
   `JR-1317` drei neue Befundtypen und eine neue CTE-Spalte, und sie ist weiterhin das einzige
   sicherheitsrelevante Artefakt in E13 ohne Test. ADR-020 nimmt ihr die Beweislast, nicht die
   Regressionsgefahr.
2. **Zwei bewusst hingenommene Abweichungen** in der neuen Fassung, beide in `06-status.md` und in F30
   belegt: `conditions: 5` an einer Regel für ein Subject **ohne** Zeilenfilter wird nicht gemeldet (dort
   ändert sich nichts — der Wurzelbefund bleibt an (Action, Subject) gebunden), und ein leeres Objekt in
   einer **Operandenliste** (`{"id": {"$in": [{}]}}`) **wird** gemeldet, obwohl der Übersetzer es
   akzeptiert. Die zweite ist eine Übermeldung mit Positionsangabe; die Vorgabe „leerer Objektknoten in
   jeder Position" lässt sie zu. Wer das anders will, braucht eine Entscheidung dazu — DEV hat sie nicht
   von sich aus enger gezogen.

**Zur Kenntnis, kein Entscheidungsbedarf für die Abnahme:** **F26** (ein `can` mit falsy `conditions`
liefert weiter Vollzugriff) ist **kein** Regress und bricht kein Kriterium. Er gehört inhaltlich zu
`JR-1311`. Vorziehen ja/nein ist eine Produktentscheidung, nicht E13s Abnahme.

**Neu vorgelegt aus `JR-1307`, nicht blockierend: eine Doku-Nacharbeit.**
`docs/services/iam-service/iam-policy.md` listet die Action `export` weiterhin nicht und beschreibt
`manage` als Expansion auf `create/read/update/delete/search/sync` statt als echten CASL-Wildcard —
die in `CLAUDE.md` §5.4 benannte stale Stelle (3) des Permission-Vokabulars. `JR-1307` hat dieselbe
Datei angefasst, den Punkt aber **nicht** behoben, weil er nicht zur Task gehört. (1) und (2) sind
bereits einig; es ist reine Doku-Nacharbeit. **Zu entscheiden: eigene Task, und in welchem Epic?**

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
richtigen Gefahrenrichtung), **F17(a)** (in `JR-1307` erledigt: die Betreiberdoku sagt, dass
ausgeliefert nur die Super-Admin-Rolle existiert und eine fehlende Read-Only-Rolle kein Fehler der
Installation ist). **F19/F20** brauchten ohnehin keine Entscheidung und sind über die roten Tests Teil
der Abnahme.

**Offen und wirklich beim Auftraggeber: nur `F17(b)`** — soll der Rollen-Bootstrap repariert werden?
Das ist eine Produktentscheidung (welche Rollen liefert Open Archiver aus?), keine Härtung, und sie
gehört nicht in E13. **Blockiert nichts.**

**Restliche Punkte aus `JR-1301`, zur Kenntnis:**

| Punkt       | Sachstand                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F17**     | (a) **Erledigt:** die Betreiberdoku aus `JR-1307` nimmt auf, dass ausgeliefert keine Read-Only-Rolle existiert, und ADR-017 hat den Nachtrag. (b) **Offen beim Auftraggeber:** soll der Bootstrap repariert werden? Produktänderung, keine Härtung, nicht in E13. PO-Nachprüfung am Code bestätigt: `createFirstAdmin` → `createAdminRole()` legt `predefined_super_admin` an, `getRoles` liegt hinter `requireAuth`, der Bootstrap kann danach nie mehr feuern. |
| **F18**     | **Erledigt (PO).** ADR-017 hat einen Nachtrag: die Aussage gilt für die Paare der heutigen vier Aufrufstellen, nicht für jede (Action, Subject) je Rolle. Das Aufrufstellen-Inventar wacht darüber.                                                                                                                                                                                                                                                              |
| **F21**     | **Umgesetzt in `JR-1306` (`dcec017`).** Die drei Pins sind im Fix-Commit invertiert. Eine benannte Abweichung: die Allowlist prüft die Form des Keys plus die Relation, nicht die Existenz der Spalte — ein einzelner unbekannter Key (`foo`) wird weiter übersetzt, weil `mongoToDrizzle` keinen Tabellenkontext hat. Vorschlag: spaltengenau bei `JR-1310`.                                                                                                    |
| **F22**     | **Erledigt (PO).** `JR-1304`s Kriterium lautet jetzt „kein Zweig wird stillschweigend weggelassen", mit dem Hinweis, dass die fail-open-Richtung im `$and` und bei leerer Zweigliste liegt, nicht im `$or`.                                                                                                                                                                                                                                                      |
| **F19/F20** | **Behoben** in `JR-1302` (`a309fd1`) bzw. mit `JR-1304` (`45ac0e9`): ein unbedingtes `cannot` verweigert, und ein `can` mit leerem `conditions` gilt nicht mehr als unbedingt. Beide Tests sind grün.                                                                                                                                                                                                                                                            |
| **F23**     | Testharness: `tsconfig.test.json` sieht globale Augmentierungen nicht, die nur über Produktionsdateien ins Programm kommen. In `JR-1301` umgangen (`tests/support/express-i18n-augmentation.d.ts`), Ursache offen. Für E2 relevant, weil der Receiver eigene Express-Routen bekommt.                                                                                                                                                                             |

**Nicht blockierend, aber entscheidungsbedürftig:**

| Punkt       | Sachstand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F13**     | Der unbeschränkte Sweep in `acquireTestDatabase()` kann einen fremden Lauf treffen, der **länger als die Frist** (Default 2 h) läuft; offene Verbindungen schützen ihn nicht, weil `postgres-js` untätige schließt. Heute unerreichbar (5-s-Suite), **erreichbar ab E2/E3** — konkret beim 100k-Soak aus `JR-208`. Drei plausible Entwürfe: Lauf-Register, PID-Lebendigkeitsprüfung (`process.kill(pid, 0)`), einmaliger Sweep pro Lauf. Vorerst gilt die Zwischenregel in `04-testplan.md` §2.6. **Spätestens vor `JR-208` zu entscheiden.**              |
| **ADR-017** | **Erledigt am 2026-07-29: Variante B, umgesetzt in `JR-1303` (`bcac6bd`).** Braucht keine Entscheidung mehr. Folgearbeit als `JR-1310` nach E13 vorgemerkt.                                                                                                                                                                                                                                                                                                                                                                                                |
| **F14–F16** | Drei Befunde am Messinstrument aus `JR-106a`, alle **offen** und alle **ohne Kriteriumsbruch**: die Suite-Inventur zählt Dateien statt gelaufene Tests (eine Umetikettierung `ci` → `nightly` schaltet die `integration`-Suite ab und bleibt grün), `minimumFiles` verdeckt eine Löschung sobald die Suite wächst, und ein Rückstand nach Modul-Throw wird lokal nicht angekündigt. Inhaltlich gehören alle drei nach **`JR-1305`**, wo `JR-106` den „Ausweg" für genau diese Klasse schon eingeplant hat. Vor E2 zu entscheiden, ob dort mitbehoben wird. |

| Punkt                                                    | Sachstand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **~~Zwei offene Pull Requests nach `main`~~ — erledigt** | **In `JR-1309` nachgeprüft (2026-07-29): beide sind geschlossen und _nicht_ gemergt.** `PR #1` (`claude/enterprise-product-implementation-cxmmqe` → `main`) und `PR #2` (`claude/journaling-e1-test-foundation` → `main`) stehen auf `state: closed`, `merged: false`, geschlossen am 2026-07-28. Es gibt **keinen** weiteren PR im Repository, insbesondere keinen aus E13. Damit ist auch die Nebenwirkung weg: ein Push löst wieder **einen** CI-Lauf aus (nur `push`), was an den E13-Läufen sichtbar ist. Kein Entscheidungsbedarf mehr. |
| **`JR-105c`** (F14–F16)                                  | **Fällig vor E2, kein Entscheidungsbedarf — nur Arbeit.** Der Inventar-Wächter zählt **Dateien statt ausgeführter Tests**: wer die vier Integrationsdateien auf `nightly` umklassifiziert, schaltet die Suite ab und **beide** Wächter melden grün. Solange das offen ist, belegt ein grüner CI-Lauf nicht, dass die Integration-Suite gelaufen ist. Details in `03-backlog.md` unter „Nach der Abnahme aufgetreten".                                                                                                                         |

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
    die Betrachtung von `JR-105c`. **Als F24 erfasst** und in `JR-105c`s Umfang aufgenommen.
    ```bash
    psql -tAc "select datname from pg_database where datname like 'oa\_test\_%'"
    ```
13. **Ein in einem Zug geschriebener `RED UNTIL`-Satz kann sich selbst widersprechen — und keiner der
    beiden Tests sieht für sich falsch aus.** In `JR-1301` forderten zwei Erwartungen mit demselben
    `RED UNTIL JR-1304`-Tag für strukturell gleiche Eingaben Unvereinbares; aufgefallen ist es erst,
    als vier Fixes gelandet waren und einer nicht grün werden konnte. **Der Tell war, dass beide
    dieselbe Task nannten.** Wer rote Tests vorab schreibt, prüft die Erwartungen eines Tags
    **gegeneinander**, bevor der Fix beginnt — nicht erst gegen den Code. Aufgelöst in ADR-018.
14. **Ein Kommentar, der einen Befund „bewusst offen" markiert, muss nachgezählt werden — nicht je
    Aussage, sondern je Befundnummer.** In `JR-1306` behaupteten beide Statusdateien, F4 **und** F5
    seien im Code als bewusst offen kommentiert. F4 ist es, F5 nicht (**F25**). Der Satz war in einem
    Zug geschrieben, und weil F4 und F5 dieselbe Datei betreffen, liest er sich richtig. Prüfung ist
    ein Einzeiler:

    ```bash
    grep -rn "F4\|F5\|finding F" --include=*.ts packages/backend/src/ | grep -v test
    ```

15. **Eine Abfrage in einer Betreiberanleitung braucht konstruierte falsch-negative, nicht nur
    Positiv- und Negativfälle.** `JR-1307`s Prüf-SQL fand 13 von 13 absichtlich betroffenen Rollen und
    keine der Gegenproben — und war trotzdem falsch, weil beide `cond`-CTEs auf
    `jsonb_typeof(… ) = 'object'` filtern und damit jede Policy mit skalarem oder Array-`conditions`
    unsichtbar machen (**F27**). Genau diese Form war vor E13 **unbeschränkter Zugriff**. Die Methode,
    die es gefunden hat: für jede Form, die die Abfrage **nicht** meldet, die Anwendung **vor und nach**
    dem Fix auf derselben Policy messen (`FilterBuilder` von `efea6bc` gegen den von `HEAD`, beide im
    selben Testprozess) und die Differenz gegen die Meldung stellen. „Ändert sich und wird nicht
    gemeldet" ist der Befund.

16. **Zwei Gates, die dieselbe Regel prüfen sollen, prüfen sie nicht automatisch gleich.**
    `PolicyValidator` und `mongoToDrizzle` sollten nach `JR-1306` dieselbe Key-Form akzeptieren; sie tun
    es für SQL-Syntax, aber nicht für Relation und Segmentzahl (**F29**). Gefunden mit einer Tabelle,
    die **jeden** Key durch **beide** Gates schickt und die Urteile nebeneinander ausgibt — nicht mit
    zwei getrennten Testdateien, in denen jedes Gate für sich richtig aussieht.

17. **SQL in der Doku wird aus der Doku ausgeführt, nicht aus dem Entwurf.** In `JR-1307` wich die
    veröffentlichte Fassung der Prüfabfrage an einer Stelle vom getesteten Entwurf ab (eine
    CTE-Referenz musste beim Einfügen qualifiziert werden). Der Beleg ist deshalb ein Skript, das die
    ` ```sql `-Blöcke aus der Markdown-Datei extrahiert und **wörtlich** gegen Postgres laufen lässt —
    sonst belegt der grüne Lauf den Entwurf und nicht das, was ein Betreiber kopiert. Zusätzlich
    gehören zu einer solchen Abfrage **Negativfälle**: dass die drei `predefined_*`-Rollen in **keiner**
    Ausgabe erscheinen, trägt die Aussage „keine Pauschalwarnung".

18. **Ein Prädikat, das zwei Module teilen sollen, hat oft in keinem der beiden ein Zuhause.** Bei
    `JR-1313` war der naheliegende Griff, `PolicyValidator` aus `mongoToDrizzle` importieren zu lassen —
    das zieht `drizzle-orm` in eine Klasse, die heute nur Typen importiert, und damit in jeden Unit-Test,
    der eine Policy validiert. Die Gegenrichtung ist genauso falsch: ein SQL-Übersetzer, der das
    IAM-Policy-Modul importiert. Richtig war ein **drittes Modul, das nichts importiert**
    (`src/helpers/conditionKey.ts`). Der Test dafür ist nicht Geschmack, sondern die Frage, welche
    Abhängigkeit dadurch **neu** entsteht.

19. **Ein Restspalt, den man als Kommentar festhält, ist nicht festgehalten.** F29 stand genau deshalb
    still: der Validator trug einen ausführlichen Kommentar darüber, was er bewusst **nicht** prüft, und
    die Divergenz war trotzdem da. In `JR-1313` sind die drei Restspalte deshalb **grüne Assertions**
    (`tests/unit/condition-key-gates.test.ts`, Suite „deliberate gaps"): wer einen davon schließt, macht
    die Datei rot und muss die Begründung lesen. Ein Kommentar wird beim Ändern überlesen, ein roter Test
    nicht.

20. **Eine Doku-Abfrage kann durch eine Erweiterung ein neues Falsch-**positives** bekommen, und das
    sieht man nur im Lauf.** Beim Abbilden von `subject = 'all'` auf beide Tabellen (F28) ersetzte ich die
    `CASE`-Kette in Query 3 durch einen Join und schrieb `ELSE st.table_name` — damit wurde aus `foo.bar`
    plötzlich `archived_emails.bar`, also ein Spaltenbefund für einen Key, der ein **Formbefund** von
    Query 2 ist. Beim Lesen des Diffs war das unsichtbar; im wörtlichen Lauf gegen die gesäten Rollen
    stand es in der ersten Ausgabezeile. Der Wächter `array_length(...) = 1` muss bleiben.

21. **`jsonb_array_elements` bricht ab, es überspringt nicht.** Ein `roles.policies`, das kein JSON-Array
    ist, beendet beide Betreiberabfragen mit `ERROR: cannot extract elements from an object`. Der erste
    Entwurf des Doku-Absatzes „was wird nicht geprüft" behauptete „silently skipped" — falsch, und in die
    gefährliche Richtung falsch, weil ein Betreiber „skipped" als „unauffällig" liest. Wer über eine
    JSONB-Spalte behauptet, was eine Abfrage tut oder nicht tut, sät die Form vorher ein.

22. **Eine Prüfung, die rekursiv wirkt, braucht eine Abfrage, die rekursiv prüft — und der Beleg dafür ist
    ein verschachtelter Fall, nicht ein Wurzelfall.** `JR-1314` hat F27 an der **Wurzel** von `conditions`
    geschlossen und dort vollständig; `checkConditionsShape()` läuft in `mongoToDrizzle` aber in **jedem**
    `$or`/`$and`/`$not`-Zweig erneut. Ergebnis: `conditions: 5` wird gemeldet, `conditions: {"$not": 5}`
    nicht (**F30**). Beim Lesen des Diffs ist das unsichtbar, weil beide Befundtypen richtig aussehen — die
    rekursive CTE `cond` liegt direkt daneben und wird für die Formbefunde nur nicht benutzt. Regel für die
    nächste solche Abfrage: **jede** Form, die im Code an mehr als einer Stelle geprüft wird, mit einem
    Fall auf **jeder** dieser Stellen einsäen, nicht nur mit einem.

23. **Der HTTP-`400`-Pfad ist prüfbar, ohne den Server zu starten.** `JR-1309` hat ihn als „nicht prüfbar"
    verbucht, weil ein Servertest an der Importkette scheitert (Fallstrick 10). `IamController` importiert
    aber nur `IamService`, `PolicyValidator` und `logger`, also nur `db` — mit gesetztem `DATABASE_URL`
    lässt sich `controller.createRole(req, res)` mit einem synthetischen `res` (`status()`/`json()` als
    Rückgabe von `this`) und `req = { body: { name, policies }, t: k => k }` direkt aufrufen und der
    Statuscode ablesen. Das ist deutlich mehr Aussage als `PolicyValidator.isValid()` allein, weil es die
    Schleife über `policies` und die Antwortbildung mitprüft.

24. **PostgreSQL 17.10 lässt sich im Container nachinstallieren** — damit ist die Versionslücke
    16.13 / 17.10 nicht nur für die CI-Suite, sondern auch für SQL-Artefakte schließbar:

    ```bash
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor > /etc/apt/keyrings/pgdg.gpg
    echo "deb [signed-by=/etc/apt/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt noble-pgdg main" \
        > /etc/apt/sources.list.d/pgdg-probe.list
    apt-get update -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/pgdg-probe.list -o Dir::Etc::sourceparts=/dev/null
    apt-get install -y --no-install-recommends postgresql-17     # 17.10-1.pgdg24.04+1, exakt die CI-Version
    ```

    Danach ein zweiter Cluster auf einem **anderen Port** (`-p 5433`, eigenes `unix_socket_directories`),
    dieselben Migrationen, dieselben Fixtures, und die Ausgaben beider Versionen zeichenweise diffen.
    Paketquelle, Keyring und Cluster hinterher entfernen.

25. **Wenn eine Prüfanleitung zweimal an derselben Klasse scheitert, ist der Satz das Problem, nicht die
    Abfrage.** F27 und F30 waren beide „die Abfrage kennt eine Form nicht" — und beide Male hätte eine
    ehrliche Grenzangabe die Ablehnung verhindert. Die dritte Runde hat deshalb den **Anspruch** aufgegeben
    (ADR-020) und die Abfrage nur nebenbei erweitert. Praktische Regel für jede Betreiberdoku über
    schemalose Daten: erst prüfen, ob es eine Aussage gibt, die **verhaltensbasiert** und damit vollständig
    ist (hier: jede Rolle einmal ausüben und vergleichen), und die Abfrage als Suchhilfe daneben stellen —
    nicht als Beweis. Beim Umbau reicht es **nicht**, die zwei benannten Sätze zu ersetzen: auf derselben
    Seite standen vier weitere Abdeckungssätze (`lists **every** shape`, `find out which`, zweimal
    `covers`), von denen keiner im Befund stand.

26. **Ein Prädikat, das im Code an mehreren Stellen wirkt, wird aus dem Code abgelesen — und die
    Positionen mit.** Für `JR-1317` war die Referenz `checkConditionsShape()` **plus** die drei Stellen, an
    denen `mongoToDrizzle` sich selbst aufruft (Wurzel, `$or`/`$and`-Element, `$not`-Rumpf). Genau diese
    Liste ist das Prädikat der Abfrage geworden. Wer stattdessen „Knoten ist kein Objekt" schreibt, meldet
    jedes Blatt jeder normalen Bedingung (Fallstrick 20); wer nur die Wurzel prüft, ist bei F30. Der
    Gegentest dazu ist billig und hat beide Fehler ausgeschlossen: dieselben Bedingungswerte durch den
    **gebauten** Übersetzer (`dist/helpers/mongoToDrizzle.js`, ein `node`-Einzeiler, kein Test im Repo)
    schicken und „verweigert" gegen „gemeldet" stellen. Jede Abweichung muss man dann benennen können — bei
    `JR-1317` waren es zwei, beide erklärbar.

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
