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

**Stand:** 2026-08-01 (**`JR-208`, `JR-209` und die Abnahme `JR-210` erledigt** — E2 ist abgenommen,
23/23 Kriterien, **aber die Abnahme ist nicht unabhängig**, deshalb ist der Rückmerge nicht vollzogen
und liegt beim Auftraggeber. Der Lasttest hat **`F38`** gefunden und behoben: der Writer
speicherte `event_payload` doppelt JSON-kodiert, sobald der Treiber nicht durch `drizzle()` gelaufen war ·
davor am 2026-07-31 `JR-201`…`JR-207` und die ADRs `006`/`007`/`022`/`023`) · **Branch:**
`claude/journaling-e2-ledger` (E2, abgezweigt vom Integrationsbranch) · Volllauf gegen das
Docker-Postgres **398 passed | 2 skipped** bei 30 Dateien, Exit 0, `unit 288/288 · integration 92/92 ·
adversarial 18/18`, 0 `oa_test_*`-Rückstände, `test:types` grün für beide Pakete

### Der Stand in einem Satz

**Der Ledger ist gebaut, gemessen, angegriffen und abgenommen** — er hält 10 000 nebenläufige Appends
lückenlos aus, jede der acht Manipulationsarten aus Testplan §12.5 wird mit Befundart und `seq` gemeldet,
und die Abnahme `JR-210` hat 23 von 23 Kriterien erfüllt gefunden. **Der nächste Schritt ist keine Task,
sondern eine Entscheidung des Auftraggebers:** die Abnahme lief in derselben Sitzung wie `JR-208`/`JR-209`
und ist damit **nicht unabhängig** im Sinne von ADR-014/ADR-021. Deshalb ist der Rückmerge **nicht**
vollzogen. Fällt die Entscheidung „so ausreichend", folgt der Rückmerge und dann **E3**; fällt sie
„zweite Runde", ist die Abnahme in einer frischen Sitzung zu wiederholen — das Prüfmaterial dafür liegt
im Abnahmeprotokoll in `06-status.md`.

**Eine Sache verdient beim Lesen mehr Aufmerksamkeit als jede Testzahl:** `JR-208` hat mit **F38** einen
Fehler gefunden, der jede Ledger-Zeile mit `event_payload` unverifizierbar gemacht hätte — und acht
Integrationstests waren daran vorbeigelaufen, weil sie **alle** durch denselben Client schreiben, den
einzigen im Repository, den `drizzle()` gepatcht hat. Wer in E3/E4 weiterbaut, nimmt daraus die Regel
mit: alles in `packages/journaling` bekommt seine Verbindung injiziert, also muss mindestens ein Test
durch einen **nackten** `postgres()`-Client schreiben. Sonst prüft man den Treiber der Tests.

> ### Was diese Session gemacht hat
>
> 1. **`JR-208` erledigt** (`packages/backend/tests/adversarial/journal-ledger-concurrency.adv.test.ts`,
>    4 Fälle). 10 000 Appends durch 20 nebenläufige Writer in 84–96 s (≈120/s), `seq` genau 1…10 000, die
>    Kette **über alle Zeilen** neu gerechnet, 10 000 verschiedene Vorgängerhashes. Zwei Entwurfspunkte,
>    die den Unterschied machen: der Test bringt seinen **eigenen Pool mit einer Verbindung je Writer**
>    mit (mit dem `max: 4` des Harness wäre die Konkurrenz im Treiber ausgetragen worden, nicht in
>    Postgres), und der Rollback-Fall läuft **unter Last** — 8 Writer × 100 Commits gegen 4 × 25
>    Rollbacks in dieselbe Kette, 800 Zeilen, keine Lücke.
> 2. **Die Gegenprobe ist Teil der Task, nicht eine Zugabe.** Derselbe Lastfall gegen einen Transactor,
>    der das `pg_advisory_xact_lock`-Statement verschluckt, muss brechen — er tut es (19 von 20 Appends
>    scheitern). Ohne diesen Fall könnte der Lasttest grün sein, **weil sich die Appends nie überlappt
>    haben**, und niemand würde es merken.
> 3. **`F38` gefunden und behoben — der eigentliche Ertrag dieser Session.** Der Writer band
>    `event_payload` als `JSON.stringify(...)` an `$16`; postgres-js entnimmt den Parametertyp der
>    Parameterbeschreibung des Servers, sieht `jsonb` und kodiert den String ein **zweites** Mal. In der
>    Spalte stand danach ein JSON-_String_. Beim Schreiben schlägt nichts fehl — unverifizierbar wird
>    jede Zeile mit Nutzlast, und bemerkt hätte man es mit `verify` in E9. Vier Parameterformen gemessen:
>    `$2` ⇒ string, **`$2::jsonb` ⇒ string** (der naheliegende Fix hilft nicht), `$2::text::jsonb` ⇒
>    object, rohes Objekt ⇒ object.
> 4. **Warum acht Integrationstests das nicht gesehen haben, ist die Lehre daraus.** Fünf Client-Varianten
>    gegen dieselbe Datenbank: `harness.sql` ⇒ object, `postgres(url, {gleiche Optionen})` ⇒ string,
>    `postgres(url)` ⇒ string, `postgres(url, {max: 20})` ⇒ string. Es liegt an keiner Option, sondern
>    daran, dass `drizzle(client, …)` den Client **patcht** — und das ist der Client, durch den jeder
>    Integrationstest schreibt. Der Ingress-Prozess aus E3/E4 wird drizzle per Architekturvorgabe nicht
>    haben. **Regel für alles Weitere in `packages/journaling`: mindestens ein Test schreibt durch einen
>    nackten Client.**
> 5. **`JR-209` erledigt** (`journal-ledger-tamper.adv.test.ts`, 11 Fälle): alle acht Fälle aus Testplan
>    §12.5, der Positivfall (Inklusionsnachweis **ohne** Fremddaten) und die Gegenprobe, dass der Trigger
>    dieselbe Manipulation abweist, solange er an ist. Die Prüflogik meldet **Befundart, `seq` und Feld**
>    statt pass/fail.
> 6. **Drei der acht Fälle lassen die Kette absichtlich heil**, und das ist die Aussage, nicht eine
>    Schwäche: die ab `seq` N vorwärts neu geschriebene Kette ist in sich makellos (nur der vorher
>    genommene Anker sieht sie — das ist die Begründung für Anchoring, hier als Assertion), die vollständig
>    gelöschte Mandantenkette hinterlässt nichts, was brechen könnte (nur der Vergleich zweier
>    Merkle-Anker meldet sie, mit einer **ruhenden** Kette daneben als Unterscheidungsprobe), und der Klon
>    erzeugt zwei gültige Ketten aus demselben Genesis (**Split-Brain**, eigene Befundart).
> 7. **(f) und (g) stehen gegen eine mitgelieferte Implementierung der RFC-Formel.** Der Testplan verlangt,
>    diese beiden Fälle „zuerst gegen eine Implementierung nach der RFC-Formel rot gesehen" zu haben —
>    statt das einmal von Hand zu tun, liegt die verworfene Acht-Felder-Formel in
>    `tests/support/rfc-formula-encoding.ts` und der Nachweis läuft auf **jedem** CI-Lauf. Formuliert ist
>    er über die **ganze** Liste der acht ungehashten Felder, nicht über zwei Feldnamen: wer die Kodierung
>    in irgendeiner dieser Richtungen zurückschneidet, macht ihn rot.
> 8. **Eine Grenze ist ausgeschrieben statt überspielt.** Ein Kettenhash bindet alle 16 Felder
>    gleichzeitig — aus ihm allein ist **nicht** ableitbar, welches Feld sich bewegt hat. Der Verifier
>    nennt das Feld deshalb nur, wenn ihm eine **zweite Quelle** übergeben wird (hier: was der Test
>    geschrieben hat; in E9: Exportmanifest und gespeichertes Objekt). Der Ledger belegt _dass_ und _wo_,
>    die zweite Quelle belegt _was_.
> 9. **Mitrepariert:** `suite-inventory.test.ts` hatte eine adversariale Fixture-Datei hart verdrahtet und
>    damit implizit `expectedFiles: 1` angenommen — er wurde rot, als die Suite auf drei Dateien wuchs, mit
>    einer Meldung über Verletzungszahlen, die die Ursache nicht nennt. Jetzt leitet er die Fixtures ab,
>    wie es die Unit-Fixtures schon taten.
> 10. **`JR-210` durchgeführt: E2 abgenommen, 23/23** — und der Vorbehalt steht im Protokoll an erster
>     Stelle, weil er die Aussagekraft betrifft: **dieselbe Sitzung, die `JR-208`/`JR-209` geschrieben
>     hat, hat sie abgenommen.** Kompensiert wurde durch Messung statt Zitat — die ADR-Vektoren aus dem
>     Entscheidungsdokument **geparst** und gegen `dist` gerechnet (16/16), die Datenbankseite an einer
>     eigenen Datenbank mit den echten Migrationen (21/21, bewusst **nicht** über den Harness), und vier
>     **Mutationsproben**, die alle rot wurden. Die aufschlussreichste war M4: die Manipulation in Fall
>     (f) wirkungslos gemacht ⇒ der Verifier meldet **nichts** und der Test wird rot. Damit ist die
>     Fehlerklasse ausgeschlossen, an der eine Tamper-Suite lautlos scheitert — ein Verifier, der immer
>     meckert, macht jeden Tamper-Test grün. **Der Rückmerge ist nicht vollzogen**; er liegt beim
>     Auftraggeber.
>
> **Nichts steht offen aus dieser Session.** Kein Auftrag ist abgebrochen, kein Ergebnis fehlt. Was
> bewusst **nicht** getan wurde: der **Rückmerge** (siehe oben), die Rechtetrennung aus **F37** (gehört zu
> E11) und ein produktiver `verify`-Kern — die Prüflogik liegt absichtlich unter `tests/support/`, weil
> `verify` E9s Gegenstand ist und ein vorgezogener Kern dort die Entwurfsfreiheit nähme.

### Die Umgebung hat sich geändert — lies das, bevor du „Immer zuerst" abarbeitest

**Diese Session lief auf einem Windows-11-Host, nicht in einem Linux-Container.** Die Anleitung unter
„Immer zuerst" und alle früheren Sessionprotokolle (`/var/tmp`, `apt`, pgdg, `psql -f`) setzen Linux
voraus. Was hier tatsächlich gilt — jeder Punkt gemessen, nicht vermutet:

| Sache                     | Zustand auf diesem Host                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm`                    | **nicht im PATH.** `corepack pnpm …` benutzen — liefert das gepinnte 10.13.1. Node 24.14.0, npm 11.9.0                                                                                                                                                                                                                                                                          |
| PostgreSQL                | **seit 2026-07-31 über Docker Desktop**, `postgres:17-alpine` aus `docker-compose.yml`, Port 5432 nativ auf den Host gemappt. Der Volllauf dagegen ist **grün**. Der Wegwerf-Cluster unten bleibt als Rückfalloption beschrieben, wird aber nicht mehr gebraucht                                                                                                                |
| `psql.exe`                | **existiert auch im Wegwerf-Cluster nicht** — die Windows-Binärdistribution ist minimal. SQL über einen Node-`postgres`-Client fahren                                                                                                                                                                                                                                           |
| WSL `Ubuntu-24.04`        | vorhanden, aber **nackt** (kein Node, kein Postgres) — **nicht** die Umgebung der Vorsessions                                                                                                                                                                                                                                                                                   |
| Valkey, Meilisearch, Tika | **laufen ebenfalls** über `docker-compose.yml` und sind vom Host aus belegt: Valkey `AUTH`+`PING`, Meilisearch `/health` `200`, Tika `/version` `Apache Tika 3.2.2`. Damit ist die Infrastrukturfrage für E2 ff. geklärt                                                                                                                                                        |
| Docker                    | **Docker Desktop**, Client und Engine **29.6.2**, Compose **v5.3.1**, Linux-Engine. **Benutzerinstallation** unter `%LOCALAPPDATA%\Programs\DockerDesktop`; der PATH-Eintrag `…\resources\bin` existiert, aber eine **vor** der Installation gestartete Shell sieht ihn nicht — dann fehlt auch `docker-credential-desktop` und jedes `pull` bricht ab. Eigener Abschnitt unten |
| `git fetch/push`          | **braucht zwei Handgriffe.** `origin` ist `git@github.com:maxx1337/OpenArchiver.git` über SSH, `~/.ssh/id_rsa` ist **passphrase-geschützt**. Ohne geladenen Key endet ein nicht-interaktiver Aufruf mit `Could not read from remote repository`, ein interaktiver **hängt** an der Passphrase-Abfrage. Lösung siehe unten                                                       |
| `pnpm lint`               | **strukturell rot: 388 Dateien** — `core.autocrlf=true` ohne `.gitattributes`, siehe **F35**. Das ist **kein** Formatierungsfehler im Repository. **Nicht** mit `prettier --write` „beheben" — das schriebe 388 Dateien um. Stattdessen `corepack pnpm exec prettier --check <eigene Dateien>`                                                                                  |

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

### Infrastruktur über Docker Desktop — die Anleitung, gemessen am 2026-07-31

Der Auftraggeber hat **Docker Desktop** installiert. Damit ist die Infrastrukturfrage für E2 ff. erledigt:
alle vier Dienste aus `docker-compose.yml` laufen, und der **komplette Volllauf gegen dieses Postgres ist
grün** — `274 passed | 2 skipped`, Exit 0, 0 `oa_test_*`-Rückstände.

**Zwei Fallen zuerst, beide haben je einen Versuch gekostet:**

1. **`docker` ist nicht im PATH einer Shell, die vor der Installation gestartet wurde.** Es ist eine
   **Benutzer**installation: `%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin`. Der PATH-Eintrag
   existiert, aber nur für neue Prozesse.
2. **Es genügt nicht, `docker.exe` mit vollem Pfad aufzurufen.** Dann fehlt `docker-credential-desktop`
   im PATH, und jedes `pull` bricht ab mit `error getting credentials`. Das `bin`-Verzeichnis muss **in
   den PATH**, nicht nur die Binärdatei erreichbar sein.

```powershell
$env:PATH = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:PATH"
docker version --format "{{.Client.Version}} / {{.Server.Version}}"   # 29.6.2 / 29.6.2
docker compose version                                               # v5.3.1
```

Die Compose-Dienste haben **absichtlich keine Port-Mappings** — nur das interne Netz, der App-Container
spricht sie über den Namen an. Das bleibt so; der Override für Host-Zugriff liegt **außerhalb** des
Repositorys (im Scratchpad als `oa-ports.yml`):

```yaml
services:
    postgres: { ports: ['5432:5432'] }
    valkey: { ports: ['6379:6379'] }
    meilisearch: { ports: ['7700:7700'] }
    tika: { ports: ['9998:9998'] }
```

Es gibt **kein `.env`** im Repository, und Compose **validiert die ganze Datei**, auch wenn man nur einen
Dienst startet — ohne `STORAGE_LOCAL_ROOT_PATH` scheitert es an
`invalid spec: archiver-data:: empty section between colons` des App-Dienstes, den man gar nicht will.
Also alle fünf Variablen setzen:

```powershell
$env:POSTGRES_DB="open_archive"; $env:POSTGRES_USER="admin"; $env:POSTGRES_PASSWORD="password"
$env:REDIS_PASSWORD="devpassword"; $env:MEILI_MASTER_KEY="aSampleMasterKey"
$env:STORAGE_LOCAL_ROOT_PATH="/data"
docker compose -f docker-compose.yml -f <scratchpad>\oa-ports.yml up -d postgres valkey meilisearch tika
```

`DATABASE_URL=postgresql://admin:password@127.0.0.1:5432/open_archive` · `OA_TEST_REQUIRE_INFRA=1`

**Belegt, jeweils vom Host aus:** PostgreSQL **17.10** mit **`CREATEDB`** (das braucht
`acquireTestDatabase()`), Valkey `AUTH`+`PING`, Meilisearch `/health` `200`, Tika `/version`
`Apache Tika 3.2.2`. Es gibt **kein `psql`** — SQL weiterhin über einen Node-`postgres`-Client
(`leftovers.cjs` im Scratchpad nimmt die URL als Argument).

> **Der Wegwerf-Cluster unten wird nicht mehr gebraucht**, ist aber als Rückfalloption beschrieben und
> funktioniert unverändert. Er bleibt sinnvoll, wenn Docker Desktop einmal nicht läuft.

#### Docker Sandboxes (`sbx`) — was davon zu wissen bleibt

Vor Docker Desktop war **Docker Sandboxes** installiert (`Docker.sbx`, winget), und es ist es noch. Es ist
ein **anderes Produkt**: es sandboxt Agenten, `sbx.exe` liegt unter `%LOCALAPPDATA%\DockerSandboxes\bin`,
und die Engine steckt _innerhalb_ einer Sandbox. Der Weg funktioniert grundsätzlich — Docker 29.6.1 und
Compose v5.2.0 in der Sandbox, Workspace nach `/x/NEW_DEVELOP.GIT/OpenArchiver` gemountet, Host-Zugriff
über `sbx ports` — aber er ist für diese Suite **nicht** geeignet, und das ist gemessen:

- **Der Portforwarder überlebt die parallele Integrationslast nicht.** Volllauf vom Host: **16
  Fehlschläge**, alle `read ECONNRESET` bzw. `write CONNECTION_CLOSED` — acht Testdateien parallel, jede
  mit eigener Datenbank und 41 Migrationen. Ein einzelner Connect ist dagegen 4 ms schnell. Mit Docker
  Desktops nativem Port-Mapping ist derselbe Lauf grün.
- **Die Sandbox stoppt im Leerlauf**, und dann hört nichts — vom Host sieht das wie `ECONNREFUSED` aus.
  Container **und** Portfreigaben kommen beim nächsten Start von selbst zurück (erneutes `--publish`
  antwortet `409 … already published`).
- **`sbx` erzwingt im Sandbox-Netz eine Default-Deny-Netzpolicy**: `curl http://tika:9998/version`
  _innerhalb_ der Sandbox antwortet `403 Blocked by network policy`. Das ist der Zweck des Produkts, kein
  Defekt; eine Regel über `sbx policy allow` wäre nötig gewesen.

Die Probe-Sandbox `oa-infra-probe` ist **entfernt** (`sbx rm -f`). Die Sandbox `claude-Maxim` des
Auftraggebers wurde nicht angefasst.

**Git gegen das Remote — so hat es am 2026-07-30 funktioniert.** Der Windows-Dienst `ssh-agent` hält den
Key; Git-for-Windows bringt aber ein eigenes `ssh.exe` mit, das diesen Agent **nicht** kennt. Beides
zusammen gehört dazu:

```powershell
Start-Service ssh-agent            # StartupType ist Manual; der Start braucht keine Adminrechte
C:\Windows\System32\OpenSSH\ssh-add.exe $HOME\.ssh\id_rsa   # NICHT das ssh-add aus Git Bash
$env:GIT_SSH_COMMAND = "C:/Windows/System32/OpenSSH/ssh.exe"  # pro Aufruf, oder core.sshCommand setzen
git ls-remote origin refs/heads/<branch>
```

> Zwei Fallen: das `ssh-add` **aus Git Bash** spricht einen anderen Agent an (`SSH_AUTH_SOCK`) als den,
> den Windows-OpenSSH benutzt — es meldet `Error connecting to agent: No such file or directory`, solange
> kein eigener Agent in **derselben** Shell läuft. Und Shell-Zustand überlebt einen Tool-Aufruf nicht:
> `GIT_SSH_COMMAND` muss je Aufruf gesetzt werden, sonst greift wieder das mingw-`ssh`.

> **Zwei Fallstricke bei `pg_ctl` auf Windows:** der Aufruf **kehrt nicht zurück**, wenn stdout an eine
> Pipe hängt — in eine Datei umleiten und den Serverstart am Log bzw. an `postmaster.pid` prüfen, nicht am
> Rückgabewert. Und `postgres.exe --version` **vor** dem `initdb` prüfen: das Standardpaket
> `embedded-postgres` zieht die neueste Version (hier 18.4), was eine unnötige Versionslücke zur CI
> aufreißt.

**Die Binaries überleben die Session, der Datadir nicht.** Am 2026-07-30 lag das
`@embedded-postgres/windows-x64`-Paket der Vorsession noch auf der Platte — das hat den `npm install`
gespart, und `postgres.exe --version` hat 17.10 bestätigt, bevor `initdb` lief. **Erst prüfen, dann neu
installieren.** Die Scratchpads der Vorsessions liegen unter
`C:\Users\Maxim\AppData\Local\Temp\claude\X--NEW-DEVELOP-GIT-OpenArchiver\<session-id>\scratchpad`;
`Get-ChildItem <basis> -Directory` zeigt sie mit Datum. Dort liegen auch die Prüfwerkzeuge von `JR-1309b`
und `JR-1309c` (`adr020.cjs`, `thirdnumber.cjs`, `claims.cjs`, `extract.cjs`, `fixtures.cjs`, `run.cjs`,
`cross.cjs`, `overreport.cjs`, `sql/query1..3.sql`, `vocab.cjs`, `manage.cjs`) und aus `JR-105c`
`pg-up.ps1`, `lintcheck.cjs`, `lintfix.cjs`, `leftovers.cjs` (`--drop` räumt auf), `counts.cjs`
(Testzahlen je Suite und Klasse aus einem `--reporter=json`-Lauf) — **nicht** im Repository.

> **Am 2026-07-30 bestätigt:** die Binaries der Vorsession `7b5a77e0` lagen noch da, die Versionsabfrage
> sagte 17.10, und ein `initdb` in den eigenen Scratchpad genügte — kein `npm install`. Die vier
> Werkzeuge oben sind gegen **diesen** Host kalibriert und funktionieren unverändert.

> **Werkzeuge einer Vorsession sind gegen deren Stand kalibriert.** Ein grüner Lauf belegt nichts, wenn
> der Anker, an dem das Werkzeug hing, inzwischen entfernt wurde. `JR-1309c` hat das richtig gemacht: den
> gesuchten Satz in einer Wegwerf-Kopie **absichtlich wieder einsetzen**, zeigen dass das Werkzeug ihn
> findet, und erst dann dem sauberen Lauf glauben.

**Nützlich und schnell nachgebaut:** `lintcheck.cjs` prüft übergebene Dateien Prettier-konform **ohne**
über F35 zu stolpern (LF-Normalisierung in Node, Vergleich über die Prettier-API), `lintfix.cjs`
formatiert sie und schreibt die **Zeilenenden unverändert** zurück. Beide sind der praktische Ausweg aus
„`pnpm lint` ist auf diesem Host immer rot".

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

### Nächster konkreter Schritt — **`JR-210`**, die Abnahme von E2

**Alle drei Entscheidungen, die E2 blockierten, sind am 2026-07-31 gefallen: `ADR-007`, `ADR-022`,
`ADR-023` und zuletzt `ADR-006`.** Begründungen und Konsequenzen stehen in `05-entscheidungen.md`; was sie
an E2s Tasks ändern, steht als zwei Blöcke im Backlog („Was `ADR-007` an diesem Epic ändert", „Was
`ADR-006` an diesem Epic ändert").

**Was davon beim Implementieren wirklich zählt**, in der Reihenfolge, in der man darüber stolpert:

- **Die kanonische Kodierung deckt 16 Felder, nicht die acht der RFC-Formel** (ADR-006 §1). Das ist die
  eine Stelle, an der der RFC dem Entwurf **nicht** zu folgen ist. `04-testplan.md` §12.5 (f) und (g) sind
  die Gegenprobe, und sie müssen zuerst gegen eine Implementierung nach der RFC-Formel **rot** gesehen
  worden sein.
- **`chain_scope_id` = `ingestion_sources.id`** und geht in den Genesis; `seq` läuft je Kette, der
  Advisory-Lock-Key wird aus der Kettenkennung abgeleitet (ADR-007).
- **Drei Kodierfallstricke**, jeder macht `verify` unbrauchbar und fällt vorher nicht auf: µs-vs-ms beim
  Zeitstempel, `::ffff:`-IPv4 auf Dual-Stack-Sockets, JCS mit Fließkommazahlen (ADR-006 §3).
- **`ADR-006` §6 enthält Testvektoren.** `JR-202` muss sie treffen — das ist billiger und härter als ein
  selbst erfundenes Golden-File.

Offen bleibt in E2 allein **`ADR-009`** (Append-Only: Rechteentzug oder Trigger), und die ist Teil von
`JR-205`, blockiert also nichts davor. Ihr Umfang ist seit ADR-006 §4.2 **`journal_ledger` und
`deployment_identity`**.

**`JR-201` und `JR-202` sind erledigt** (2026-07-31, Branch `claude/journaling-e2-ledger`):
`packages/journaling` existiert, und `src/ledger/` trifft die Vektoren aus ADR-006 §6 byteidentisch. Was
davon für die nächsten Tasks gilt:

- **`encodeLedgerRecord()` ist die einzige Stelle, die Kettenbytes erzeugt.** `JR-206` (`append()`) ruft
  sie **innerhalb** der Sperre auf und baut den Record nicht selbst zusammen.
- **Drei Regeln der ADR sind als Verweigerung implementiert**, nicht als Kommentar: ein Zeitstempel ohne
  ms-Vielfaches, eine UUID in Großschreibung und ein nicht parsbares `remoteIp` werfen. `JR-204` muss den
  `CHECK` für die erste davon nachziehen, sonst hängt die Invariante allein am Anwendungscode.
- **Die Ledger-Typen liegen in `packages/types`** (`journal-ledger.types.ts`), nicht im Paket — sonst
  hätte die Abhängigkeitsregel keinen Sinn und `verify` (E9) bekäme eigene Formen.

**`JR-204` ist ebenfalls erledigt** (Migration `0041_even_scream.sql`). Was davon für die nächsten Tasks
zählt:

- **`JR-205` (Append-Only) hat zwei Tabellen im Umfang**, nicht eine: `journal_ledger` **und**
  `deployment_identity`. Die `deployment_id` steckt im Genesis jeder Kette.
- **Das Löschen einer `ingestion_source` mit Ledger-Zeilen ist blockiert** (`ON DELETE restrict`). Das
  ist gewollt, aber es heißt, dass E12 ein Verfahren für „Archiv nach Fristablauf entfernen" braucht —
  ein `DELETE` ist es nicht.
- **`duplicate_of < seq`** ist ein eigener CHECK, weil der zusammengesetzte Fremdschlüssel den
  Selbstverweis **nicht** verhindert: Postgres prüft Referenzintegrität am Statement-Ende, und dann ist
  das referenzierte Paar die gerade eingefügte Zeile.
- Die Migration enthält **eine handgeschriebene Zeile** — das `INSERT` der Identität. Sie ist im SQL als
  solche markiert und begründet; `db:generate` erzeugt keine Daten.

**`JR-205` ist erledigt, ADR-009 ist entschieden** (Trigger in E2, Rechteentzug in E11). Zwei Dinge
daraus, die die nächsten Tasks betreffen:

- **`UPDATE`, `DELETE` und `TRUNCATE` auf `journal_ledger` und `deployment_identity` sind ab jetzt
  abgewiesen.** Ein Test, der eine Ledger-Zeile aufräumen will, kann das nicht — Teardown droppt die
  Datenbank. `JR-209` (Tamper-Tests) muss den Trigger für seine Manipulationen **gezielt** umgehen
  (`ALTER TABLE … DISABLE TRIGGER` mit der Eigentümerrolle) und ihn danach wieder aktivieren.
- **`F37` ist offen und E11 zugeordnet:** die Anwendung verbindet als Superuser und Tabelleneigentümer,
  kann den Trigger also selbst abschalten. Gemessen, nicht vermutet. Was der Trigger heute leistet, ist
  das Schließen von **F1** als Manipulationsweg.

**`JR-206` ist erledigt.** `PostgresLedgerWriter.append()` in `packages/journaling/src/ledger/`. Vier
Dinge daraus, die die nächsten Tasks betreffen:

- **Die Hash-Vorberechnung ist strukturell ausgeschlossen, nicht per Kommentar:** `LedgerAppendRequest`
  hat kein `seq`, kein `prevChainHash`, kein `chainHash`. Wer den Writer erweitert, darf diese Felder
  **nicht** in die Anfrage aufnehmen — damit fiele die Garantie.
- **Der Lock-Key kommt aus `advisoryLockKey(chainScopeId)`**: SHA-256, erste 8 Bytes, als signed int64.
  Bewusst nicht Postgres' `hashtext()`, das nicht versionsstabil ist. Eine Kollision ist harmlos (zwei
  Ketten serialisieren sich), das Gegenteil wäre gefährlich und ist ausgeschlossen.
- **Der Adapter liegt noch unter `tests/support/postgres-transactor.ts`**, nicht in `src/`. Er zieht
  nach `src/`, sobald ein Prozess ihn besitzt (E3/E4) — wer ihn früher verschiebt, muss die
  Rechtetrennung aus ADR-002 mitentscheiden.
- **Ein Fallstrick für `verify` (E9), hier schon einmal getreten:** `select seq::text as seq … order by
seq` sortiert **lexikographisch** (1, 10, 2, …), weil das Alias die Spalte überschattet. Das meldete
  einen Kettenbruch, der nicht existierte — und kann in der Gegenrichtung einen echten verdecken.
  `ORDER BY` immer qualifizieren, und die Leseordnung selbst prüfen.

**`JR-207` ist erledigt.** Die Steckbarkeit ist **gemessen**: eine Vertragssuite
(`packages/backend/tests/support/ledger-backend-contract.ts`, fünf Fälle) läuft gegen
`PostgresLedgerWriter` **und** gegen ein Backend ohne Datenbank. Drei Dinge daraus für die nächsten Tasks:

- **Die Suite prüft nur die Rückgabewerte von `append()`.** Wer ihr einen Fall hinzufügt, der eine
  Tabelle liest, macht sie zu einem Postgres-Vertrag und entwertet den Beleg. Speicherseitige
  Zusicherungen gehören in `journal-ledger-writer.int.test.ts`.
- **`InMemoryLedgerBackend` bleibt im Testbaum.** Ein konfigurierbares Ledger, das vergessen kann, macht
  die Zusage hinter `250 OK` zur Lüge. Es ist ein Beweismittel, kein Backend.
- **Die Pflichtenliste für Variante (b) steht in `ledger-port.ts`** — fsync auf Datei und Verzeichnis,
  prozessübergreifende Serialisierung, kein `seq` bei Fehlschlag, Crash-Recovery, `verify`-Lesbarkeit.
  Der Vertrag prüft die Signatur, nicht die Durability; wer (b) baut, fängt bei dieser Liste an.

**`JR-208` und `JR-209` sind erledigt** (2026-08-01, Rolle TEST). Was davon für `JR-210` und für E3 gilt:

- **`F38` ist der Befund dieser Tasks**, und er ist behoben: `event_payload` wurde doppelt JSON-kodiert
  gespeichert, sobald der postgres-js-Client nicht durch `drizzle()` gelaufen war. Der Fix ist
  `$16::text::jsonb` im Writer — **ein einfaches `::jsonb` genügt nicht**, das ist gemessen. Wer in E3/E4
  weiteren SQL-Code in `packages/journaling` schreibt, prüft ihn gegen einen **nackten** Client; der
  Harness-Client ist der einzige gepatchte im Repository und deshalb kein Maßstab.
- **Die Prüflogik liegt unter `tests/support/ledger-verifier.ts` und gehört dorthin.** Sie ist bewusst
  **nicht** der Kern von E9s `verify`: sie kennt weder Objektspeicher noch Ankertabelle noch Exit-Codes.
  Wer in E9 anfängt, fängt bei den Befundarten an, die hier schon benannt sind — `missing_entry`,
  `chain_break`, `row_hash_mismatch`, `object_hash_mismatch`, `split_brain` — und bei der Grenze, dass
  das **Feld** eine zweite Quelle braucht.
- **Der Audit-Path (`tests/support/merkle-audit-path.ts`) ist eine unabhängige Zweitimplementierung.**
  E8 baut die produktive Variante; wenn sie da ist, hat sie hier eine Gegenprobe, die nur `merkleLeaf`
  und `merkleNode` mit ihr teilt. Nicht zusammenlegen — der Wert liegt in der Unabhängigkeit.
- **Ein voller Lauf dauert jetzt rund zwei Minuten**, weil `JR-208` zehntausend Zeilen schreibt. Das ist
  die im Backlog vorgegebene Menge und wird **nicht** stillschweigend reduziert (Testplan-Regel 6).

**Die Abnahme `JR-210` ist durchgeführt** (2026-08-01, 23/23, Protokoll in `06-status.md`). Offen ist
allein die Entscheidung des Auftraggebers zur fehlenden Unabhängigkeit. Je nachdem, wie sie ausfällt:

```
# Variante A — die Abnahme genügt:
Vollziehe den Rückmerge von claude/journaling-e2-ledger in den
Integrationsbranch nach ADR-014 (--no-ff, kein Squash, kein PR), und
beginne danach E3 aus docs/dev/journaling/03-backlog.md.

# Variante B — zweite, unabhängige Runde:
Nimm Epic 2 unabhängig ab — Rolle Tester, frische Sitzung. Kriterien aus
03-backlog.md (JR-201…JR-209) plus das Kernkriterium von JR-210: die
Testvektoren aus ADR-006 §6 müssen vom Code reproduziert sein. Das
Protokoll der ersten Abnahme steht in 06-status.md; prüfe seine Aussagen
nach, statt sie zu übernehmen. Achte besonders auf F38 — der Fix ist neu
und sein Regressionstest ist der einzige, der ihn hält.
```

**Was für E2 an dieser Umgebung gilt:** **die Infrastrukturfrage ist erledigt.** Postgres, Valkey,
Meilisearch und Tika laufen seit dem 2026-07-31 über **Docker Desktop** aus `docker-compose.yml`, alle vier
vom Host aus belegt, und der Volllauf gegen dieses Postgres ist **grün** (`274 passed | 2 skipped`, Exit 0,
0 Rückstände). Anleitung samt der zwei PATH-Fallen im Abschnitt „Infrastruktur über Docker Desktop" oben.

**Was das Messinstrument jetzt hergibt, und was ab E2 daran hängt:** ein grüner Lauf belegt seit
`JR-105c`, dass **die deklarierten Tests je Suite und Klasse ausgeführt wurden** — nicht nur, dass die
Dateien existieren. Ab E2 ruhen die Aussagen über Durabilität und Hash-Kette genau darauf. Zwei
Konsequenzen für jede E2-Task:

- **Jede neue Testdatei ändert zwei Zahlen** in `tests/support/suite-inventory.ts` (`expectedFiles` und
  `expectedTests`), und zwar im **selben** Commit. Die Fehlermeldung nennt die einzutragende Zahl.
- **Ein Beleg aus einem `-t`-Lauf ist kein Beleg.** Ein verengter Lauf gibt „verified NOTHING" aus und
  prüft keine Zahl. Wer einen grünen Lauf zitiert, zitiert die Testzahl mit: vollständig ist heute
  **398 passed | 2 skipped** bei 30 Dateien (274 bei 19 vor E2).

**Die übrigen Folge-Tasks aus E13, in dieser Reihenfolge und alle unblockiert** (keine blockiert E2, alle
können auch parallel oder später laufen): `JR-1316` (Regressionstest für die Betreiber-SQL — weiterhin
das einzige sicherheitsrelevante Artefakt aus E13 ohne Test), dann `JR-1311` (spaltengenaue Key-Prüfung,
schließt den Restspalt aus ADR-019 und die **Laufzeitseite von F26**), dann `JR-1310` (ADR-017 Variante C).

> **`main` bleibt bis E12 unangetastet.** Der Integrationsbranch ist jetzt der Arbeitsbranch für
> Grundlagenarbeit; das nächste Epic bekommt wieder einen eigenen Branch nach ADR-014.

**Unverändert offen und richtig so:** die **Laufzeitseite von F26** — ein bereits gespeichertes
`conditions: null` / `""` / `0` / `false` liefert weiter Vollzugriff, weil `FilterBuilder.ts:51–53`
unverändert `!rule.conditions` liest. In `JR-1309a` nachgemessen (`UNRESTRICTED` vor **und** nach E13)
und als erfülltes Kriterium verbucht; die Datei ist blob-identisch zu `13a7114`. Gehört zu `JR-1311`.
`JR-1310`, `JR-1311`, `JR-1312`, `JR-1316` waren und bleiben **nicht** Teil von E13s Abnahme.

### Was davor passiert ist — die Historie steht in `06-status.md`

**Diese Datei führt keine Sessionhistorie mehr.** Bis zum 2026-07-30 trug sie neun „Was davor passiert
ist"-Abschnitte mit rund 550 Zeilen — jeder von ihnen die Kurzfassung eines Protokolls, das in
`06-status.md` mit Kommandos und Ausgaben vollständig steht, und jeder Block verwies dafür selbst
dorthin. Der Kopf dieser Datei verlangt seit dem ersten Tag, dass der untere Teil **überschrieben** wird
statt angehängt; die Regel war verletzt, und eine doppelt geführte Historie ist die verlässlichste
Quelle für Widersprüche (am 2026-07-28 genau so passiert).

Wer die Vorgeschichte braucht, liest `06-status.md` — dort in dieser Reihenfolge (neueste zuerst):
`JR-1318`, Abnahme `JR-1309b`, `JR-1317`, Abnahme `JR-1309a`, Nacharbeit `JR-1313`–`JR-1315`, Abnahme
`JR-1309`, `JR-1307`, Grün-Lauf der Fixes `JR-1302`–`JR-1306`, der Testwiderspruch (ADR-018), Rot-Läufe
`JR-1301`, dazu E1 in `11-archiv-e1.md`. `JR-1308` steht ebenfalls in `06-status.md`.

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

> **Eine, und sie blockiert den Rückmerge: genügt die Abnahme `JR-210`, obwohl sie nicht unabhängig
> ist?** Sie lief in derselben Sitzung wie `JR-208`/`JR-209`; ADR-014 und ADR-021 verlangen eine
> unabhängige Abnahme. Das Ergebnis ist 23/23 bei vier bestandenen Mutationsproben, aber die Regel ist
> die Regel — deshalb ist der Rückmerge **nicht** vollzogen worden, und die Entscheidung liegt beim
> Auftraggeber. Die zwei Folgeprompts stehen oben unter „Nächster konkreter Schritt".

Ansonsten keine. `ADR-007`, `ADR-022`, `ADR-023` (alle 2026-07-31, Auftraggeber) und `ADR-006` (2026-07-31,
`JR-203`, Rolle PO) sind entschieden. Was in E2 noch offen ist — `ADR-009`, Append-Only per Rechteentzug
oder Trigger — ist Teil von `JR-205` und braucht keine Entscheidung des Auftraggebers vorab. Alles andere
ist Arbeit ohne Entscheidungsbedarf.

> **Eine Festlegung aus `ADR-006` verdient trotzdem den Blick des Auftraggebers**, weil sie eine
> Betriebsauflage erzeugt statt einer technischen Sperre: ein aus Produktionsdaten erzeugtes Staging- oder
> Testsystem **muss** mit abgeschaltetem SMTP-Ingress und abgeschaltetem Anchor-Job laufen. Ein Klon ist
> von einem Restore technisch nicht unterscheidbar, und wer hier eine Sperre einbaut, sperrt zuerst das
> Disaster Recovery (ADR-006 §4.3). Die Auflage gehört in den Deployment-Guide (E11); die technische
> Erkennung ist in `JR-802`/`JR-803`/`JR-209` verankert.

Die zuletzt blockierende Frage war **F30**, entschieden mit **ADR-020** und umgesetzt in
`JR-1317`/`JR-1318`.

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

**~~Doku-Nacharbeit am Permission-Vokabular~~ — erledigt am 2026-07-30 als `JR-1312`** (`dca1f1a`),
Grundlagenarbeit direkt auf dem Integrationsbranch, wie im Backlog vorgesehen. Kein Entscheidungsbedarf
mehr.

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

| Punkt       | Sachstand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F13**     | Der unbeschränkte Sweep in `acquireTestDatabase()` kann einen fremden Lauf treffen, der **länger als die Frist** (Default 2 h) läuft; offene Verbindungen schützen ihn nicht, weil `postgres-js` untätige schließt. Heute unerreichbar (5-s-Suite), **erreichbar ab E2/E3** — konkret beim 100k-Soak aus `JR-208`. Drei plausible Entwürfe: Lauf-Register, PID-Lebendigkeitsprüfung (`process.kill(pid, 0)`), einmaliger Sweep pro Lauf. Vorerst gilt die Zwischenregel in `04-testplan.md` §2.6. **Spätestens vor `JR-208` zu entscheiden.** |
| **ADR-017** | **Erledigt am 2026-07-29: Variante B, umgesetzt in `JR-1303` (`bcac6bd`).** Braucht keine Entscheidung mehr. Folgearbeit als `JR-1310` nach E13 vorgemerkt.                                                                                                                                                                                                                                                                                                                                                                                   |
| **F14–F16** | **Alle drei behoben in `JR-105c`** (`b5b2190`, 2026-07-30), zusammen mit **F24**. Kein Entscheidungsbedarf mehr. Der Wächter zählt jetzt ausgeführte Tests je Suite **und je Klasse**, die Dateizahl ist eine Gleichheit, und der Hauptprozess besitzt den Rückstand dieses Laufs über ein Ledger-Verzeichnis. Jeder Angriff zuerst am Elternstand wiederholt (Umetikettierung dort Exit 0, jetzt Exit 1). Protokoll in `06-status.md`.                                                                                                       |

| Punkt                                                    | Sachstand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **~~Zwei offene Pull Requests nach `main`~~ — erledigt** | **In `JR-1309` nachgeprüft (2026-07-29): beide sind geschlossen und _nicht_ gemergt.** `PR #1` (`claude/enterprise-product-implementation-cxmmqe` → `main`) und `PR #2` (`claude/journaling-e1-test-foundation` → `main`) stehen auf `state: closed`, `merged: false`, geschlossen am 2026-07-28. Es gibt **keinen** weiteren PR im Repository, insbesondere keinen aus E13. Damit ist auch die Nebenwirkung weg: ein Push löst wieder **einen** CI-Lauf aus (nur `push`), was an den E13-Läufen sichtbar ist. Kein Entscheidungsbedarf mehr. |
| **~~`JR-105c`~~ (F14–F16, F24) — erledigt**              | **Erledigt am 2026-07-30 (`b5b2190`).** Ein grüner CI-Lauf belegt jetzt, dass die deklarierten Tests je Suite und Klasse **ausgeführt** wurden. Zwei Folgen für jede weitere Task: eine neue Testdatei ändert `expectedFiles` **und** `expectedTests` im selben Commit, und ein `-t`-Lauf taugt nicht als Beleg (er meldet „verified NOTHING"). Details in `03-backlog.md` und `06-status.md`.                                                                                                                                                |

Die folgenden Punkte werden zum jeweiligen Epic zur Entscheidung vorgelegt und sind in
`05-entscheidungen.md` als offene ADRs geführt:

| Wann      | Frage                                                                                                                                                                                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~E2~~    | ~~Kanonische Kodierung und Genesis-String endgültig fixieren (ADR-006)~~ — **entschieden 2026-07-31 (`JR-203`):** 16 gehashte Felder statt der acht aus RFC §5.2, Genesis mit `deployment_id` und `chain_scope_id` als UUID-Textform, eigene `deployment_identity`-Tabelle, Merkle nach RFC 6962, mit Testvektoren         |
| ~~E2~~    | ~~Eine Kette global oder eine pro Mandant (ADR-007)~~ — **entschieden 2026-07-31: je Mandant, `chain_scope_id` = `ingestion_sources.id`**                                                                                                                                                                                  |
| ~~E7/E8~~ | ~~Welche TSA?~~ **Entschieden 2026-07-31, ADR-023:** kein Standard-URL; qualifizierte eIDAS-TSA in der Produktion mit GoBD-Anspruch, `open-tsa.eu` als kostenlose Option ohne diesen Anspruch und als echte TSA in `nightly`, `ci` hermetisch. **Ankerform: ADR-022** — ein Token über die Merkle-Wurzel aller Kettenköpfe |
| E7        | Aufbewahrungsfrist für Object Lock COMPLIANCE. **Vorher lesen:** unter COMPLIANCE ist vorzeitige Löschung technisch unmöglich, auch für uns                                                                                                                                                                                |
| E12       | Steht ein echter Exchange-Online-Tenant für `JR-1208` zur Verfügung? Ohne ihn ist E12 nicht abnehmbar; Mocks sind kein Ersatz                                                                                                                                                                                              |

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
3. **~~Die IAM-Doku ist stale, nicht der Code.~~ Erledigt am 2026-07-30 durch `JR-1312`.** Alle drei
   Stellen des Berechtigungsvokabulars stimmen jetzt überein (8 Actions, 7 Subjects, maschinell
   verglichen). Der Fallstrick bleibt als **Muster** stehen, weil er sich wiederholen wird: eine
   Vokabelliste, die an drei Stellen geführt wird, läuft auseinander, und die **Doku** ist die Stelle,
   die niemand testet. Wer künftig eine Action oder ein Subject hinzufügt, ändert `iam.types.ts`,
   `policy-validator.ts` **und** `docs/services/iam-service/iam-policy.md` — `CLAUDE.md` §5.4 nennt alle
   drei.
4. **Neue Drizzle-Schema-Dateien müssen in den Barrel** `packages/backend/src/database/schema.ts`.
   Sonst meldet `pnpm db:generate` „keine Änderungen" und man sucht lange.
5. **Backend-i18n-Strings brauchen einen Rebuild**, um im Container zu erscheinen: der
   `copy-assets`-Buildschritt kopiert `src/locales` nach `dist/locales`. Im Dev-Modus funktioniert es
   sofort, in Produktion erst nach `build`.
6. **Eine grüne Testsuite kann eine abgeschaltete Testsuite sein.** Ohne `DATABASE_URL` endet
   `pnpm test` mit Exit **0** bei „163 passed | 36 skipped". Dagegen gibt es drei Wächter:
   `OA_TEST_REQUIRE_INFRA=1` (in `ci.yml` gesetzt) macht fehlende Infrastruktur zum Fehlschlag, die
   Suite-Inventur im `globalSetup` verlangt **exakte** Dateizahlen je Suite, und seit `JR-105c`
   verlangt ein dritter die **exakten Zahlen ausgeführter Tests je Suite und Klasse** (das ist die
   Behebung von F14/F15 — die ersten zwei zählten keine Tests). Vollständig ist heute
   **274 passed | 2 skipped** bei 19 Dateien; die 2 Skips sind die `nightly`- und `manual`-Suite in
   `mongo-to-drizzle.adv.test.ts`, jede weitere übersprungene Suite ist erklärungsbedürftig.
   **Die Regel bleibt trotzdem, dass man die Testzahl mitzitiert** — und zwar aus einem neuen Grund:
   ein **verengter** Lauf (`-t`, Dateifilter, `--project`, `--shard`) prüft die Zahlen absichtlich
   **nicht** und gibt `verified NOTHING` aus. Ein grüner `pnpm test:unit` belegt über die
   `integration`-Suite genau nichts.
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
12. **~~Ein gefilterter Lauf (`pnpm test -t "…"`) lässt `oa_test_*`-Datenbanken liegen.~~ Behoben in
    `JR-105c` (F24).** Die Ursache bleibt richtig zu wissen, weil sie jede Task betrifft, die einen
    Harness im Modul-Scope holt: `acquireTestDatabase()` läuft beim **Laden** der Datei, also bevor
    vitest die Fälle nach `-t` filtert; wird danach jeder Fall übersprungen, läuft das `afterAll` nie.
    Neu meldet der Hauptprozess diese Datenbanken namentlich und **droppt** sie; ein unverengter Lauf
    wird davon zusätzlich rot. Gemessen: derselbe `-t`-Lauf hinterließ am Elternstand **6**
    Datenbanken, jetzt **0**. Die Nachprüfung von Hand ist damit unnötig, aber wer sie doch braucht —
    auf diesem Host gibt es **kein `psql`**, also über einen Node-`postgres`-Client:
    ```sql
    select datname from pg_database where datname like 'oa\_test\_%'
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

27. **Auf Windows zerstört eine Shell-Umleitung die Kodierung — und der anschließende Vergleich lügt.**
    Wer eine Datei mit `>` oder `Out-File` in PowerShell 5.1 umleitet, um sie zu normalisieren oder gegen
    ein Soll zu diffen, schreibt sie in einer anderen Kodierung zurück: die Em-Dashes und Anführungszeichen
    der englischen Betreiberdoku kommen zerstört an, und `Compare-Object` meldet danach Dutzende
    „inhaltlicher" Abweichungen, die keine sind. **Das hat am 2026-07-30 zweimal an einem Tag zugeschlagen**
    — beim Prüfer von `JR-1309c`, der daraus einen Befund gemacht hat (**F36**, widerlegt), und beim PO
    beim ersten Nachmessen. Regel: **jede Aussage über Zeilenenden, Einrückung oder Formatierung wird in
    Node gefahren**, nicht in der Shell — `fs.readFileSync(f, 'utf8')`, selbst normalisieren, Prettier über
    die API oder mit explizitem `--config` gegen eine selbst geschriebene Kopie. Die Gegenprobe, die den
    Fall entscheidet, ist billig: **eine LF-Kopie und eine CRLF-Kopie derselben Datei durch
    `prettier --check` schicken.** Ist nur die CRLF-Kopie rot, ist es F35 und sonst nichts.

28. **`git merge --no-squash` ist kein Flag.** Der Wunsch, „kein Squash" ausdrücklich hinzuschreiben, ist
    verständlich (ADR-014 verlangt es), aber `git merge` kennt nur `--squash`; `--no-squash` verschiebt die
    Argumente und endet in `merge: matching - not something we can merge`. **Kein Squash ist der Default** —
    `--no-ff` allein ist richtig und ausreichend. Und: eine mehrzeilige Commit-Message auf diesem Host
    lieber über `-F <datei>` als über einen PowerShell-Here-String übergeben.

29. **Wer behaupten will, ein Befund sei behoben, misst den Zustand _vorher_ — mit `git stash`, nicht mit
    dem Befundtext.** In `JR-105c` war der grüne Ausgangszustand für F14 und F24 im Befund dokumentiert;
    ihn am Elternstand trotzdem selbst zu reproduzieren hat 5 Minuten gekostet und zwei Aussagen belastbar
    gemacht, die sonst zitiert statt belegt gewesen wären (Umetikettierung ⇒ Exit 0 **mit** „verified" von
    beiden Wächtern; `-t`-Lauf ⇒ 6 liegengebliebene Datenbanken). Der Ablauf, der dabei sicher war:
    `(git diff; git status --porcelain) | sha256sum` **vor** `git stash push -u`, nach `git stash pop`
    denselben Hash prüfen — dann ist bewiesen, dass das Zurückholen vollständig war, statt es zu hoffen.

30. **vitest hat nach dem Lauf keinen Assertions-Haken, aber einen Umweg — und die Reihenfolge muss man
    messen.** Ein Reporter kann nicht rot machen; ein `globalSetup`-Teardown kann es. Gemessen in 3.2.7:
    `globalSetup` → Tests → `onTestRunEnd` → Zusammenfassung → `onFinished` → **Teardown**, und ein
    werfender Teardown endet mit **Exit 1**. Also: Reporter misst und schreibt, Teardown liest und urteilt.
    Ebenfalls gemessen statt geglaubt: eine in `globalSetup` gesetzte Env-Variable **erreicht** die
    geforkten Worker (`pool: 'forks'`, `ppid` des Workers = pid des Hauptprozesses). Beides mit einer
    Wegwerf-Config in 2 Minuten prüfbar — und beides trug in `JR-105c` je eine tragende Konstruktion.

31. **Ein Wächter, der die normalen Entwicklungskommandos rot macht, ist ein Wächter, den man abschaltet.**
    Die Testzahl-Prüfung aus `JR-105c` müsste `pnpm test -t "…"`, `pnpm test:unit` und jeden Dateifilter
    rot machen, weil dort weniger läuft. Sie tut es nicht: solche Läufe melden `verified NOTHING` und
    prüfen keine Zahl. Damit das Zugeständnis nicht die Zusicherung frisst, verlangt die CI-Klebeschicht,
    dass die Prüfung **anwendbar** war — in der Umgebung, um die es geht, gibt es die Ausnahme also nicht.
    Dieselbe Frage stellt sich bei jedem neuen Wächter: **wo darf er nachgeben, ohne dort nachzugeben, wo
    die Aussage gebraucht wird?**

32. **`-t` ist ein Regex, kein Substring.** `pnpm test -t "release() drops the database"` trifft **nichts**
    — die Klammern sind eine leere Gruppe, also verlangt das Muster „release" direkt gefolgt von „ drops".
    Der Lauf meldet dann „19 skipped" und Exit 0, was sich wie ein Fehler im Harness liest und keiner ist.
    Bei Testnamen mit `()`, `[]`, `$` oder `.` ein klammerfreies Teilstück nehmen (`-t "idempotent"`).

33. **Ein neu installiertes Werkzeug ist in einer laufenden Shell nicht da — und der vollständige Pfad
    genügt nicht.** Docker Desktop ist hier eine **Benutzer**installation
    (`%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin`); der PATH-Eintrag existiert, aber nur für neue
    Prozesse. Der naheliegende Ausweg, `docker.exe` mit vollem Pfad aufzurufen, scheitert eine Stufe
    später: dann fehlt `docker-credential-desktop` im PATH und jedes `pull` bricht mit
    `error getting credentials` ab. Richtig ist, das **`bin`-Verzeichnis in den PATH** zu setzen
    (`$env:PATH = "…\resources\bin;$env:PATH"`), nicht die Binärdatei zu adressieren. Derselbe Fall gilt
    für jedes Werkzeug mit Helper-Programmen — `git` und `ssh` eingeschlossen.

34. **`docker compose` validiert die ganze Datei, auch wenn man einen Dienst startet.** Hier scheitert
    `up -d postgres` an `invalid spec: archiver-data:: empty section between colons` — das kommt vom
    **App**-Dienst, den man gar nicht will, weil `STORAGE_LOCAL_ROOT_PATH` leer ist und es kein `.env` im
    Repository gibt. Die fünf Variablen aus dem Docker-Abschnitt oben immer mitgeben. Und: die
    Compose-Dienste haben **absichtlich keine Port-Mappings**; der Override dafür gehört **außerhalb** des
    Repositorys, sonst veröffentlicht eine Produktionsinstallation plötzlich ihre Datenbank.

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
