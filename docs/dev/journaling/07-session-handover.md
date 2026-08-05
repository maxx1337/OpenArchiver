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

**Stand:** 2026-08-05 (**E6 hat begonnen, `JR-6-01` ist erledigt**) · **Branch:**
`claude/journaling-e6-phase-b-worker` (Epic-Zweig, eigener Upstream gesetzt) · Volllauf: **1214 passed
| 8 skipped** bei 98 Dateien — `unit ci 1019/1019 · integration ci 126/126 · adversarial ci 69/69`,
Exit 0

> **Vor der ersten Scheibe sind nach ADR-032 die Nummernkreise reserviert worden** (`fc15edc`, auf dem
> **Integrationszweig**): **ADR-033–036** und **F59–F70**. `ADR-010` ist ausdrücklich **nicht** Teil
> der Reservierung — sie trägt ihre Nummer seit dem 2026-07-27 und wird in `JR-6-02` gefüllt, nicht neu
> vergeben.

> **E4 und E5 sind abgenommen und zurückgemergt** — E4 mit `JR-4-13`/`9503bc8` (Protokoll
> `16-abnahme-e4.md`, 21 IDs plus Abnahme), E5 mit `JR-5-09`/`107346d`, E3 mit `JR-3-08`/`185e9bd`.
> **Aus E4 ist kein Befund offen.** Beim E4-Rückmerge kollidierten drei Nummernkreise; aufgelöst nach
> „der eingehende Zweig gibt nach", die Regel daraus ist **ADR-032**.

> **Ein Befund ist neu und offen: `F59`.** `apps/smtp-ingress` schreibt seine Shutdown-Zeile mit
> `console.log` und ruft direkt danach `process.exit(0)` — das leert einen **Pipe**-stdout auf Linux
> nicht, die Zeile kann verlorengehen. Aufgefallen ist er **nicht** durch eine Änderung an diesem Code,
> sondern weil `JR-6-01`s 33 neue Tests (fünf davon starten Prozesse) den Wettlauf auf dem CI-Runner
> wahrscheinlich genug gemacht haben: `ingress-process-boot.test.ts` aus `JR-4-01` wurde rot, obwohl
> diese Scheibe ihn nicht angefasst hat. Der Prozess **war** beendet, nur seine letzte Zeile fehlte.
> **Er braucht eine Entscheidung des Auftraggebers** — Empfehlung steht in
> `09-befunde-bestandscode.md`: im Produktionscode beheben, nicht im Test wegprüfen.

### Der Stand in einem Satz

**Der Empfangspfad steht, der Parser steht, und Phase B hat jetzt einen Prozess — aber noch keinen
Inhalt.** `apps/smtp-ingress` spricht ESMTP mit `PIPELINING`, `8BITMIME`, `SMTPUTF8`, `SIZE`,
`CHUNKING`, `STARTTLS` und `AUTH`, prüft Quell- und Empfänger-ACL, fährt beim Start den
Crash-Recovery-Scan und antwortet auf das Ende von `DATA` bzw. `BDAT … LAST` mit
**`250 … queued as <seq>`** — erst nachdem Spool-fsync **und** Ledger-Append durch sind. Seit
`JR-6-01` gibt es dahinter den `journal-inbound`-Worker als eigenen Prozess mit begründeten
Queue-Parametern; **was fehlt, ist `JR-6-02`** — die Verarbeitung selbst, von der Spool-Datei bis zum
durchsuchbaren Treffer.

### Was diese Session gemacht hat

> **Eine Scheibe: `JR-6-01`** (`d0f4840`), plus die Nummernreservierung nach ADR-032 auf dem
> Integrationszweig (`fc15edc`). Volllauf **1214 passed | 8 skipped** bei 98 Dateien, Exit 0.

**Der Plan, auf den der Auftraggeber verwiesen hat, war leer.** `C:\Users\Maxim\.claude\plans\e6-phase-B-worker.md`
existiert mit 0 Byte. Gearbeitet wurde deshalb aus diesem Handover, der den nächsten Schritt eindeutig
festlegte. Wer dieselbe Datei noch einmal genannt bekommt, sollte sie nicht für maßgeblich halten.

**Drei Festlegungen sind im Code begründet und keine ADR** — sie folgen aus bereits entschiedenen ADRs,
statt neue Fragen zu öffnen:

1. **Der Queue-Vertrag liegt in `packages/journaling`** (`src/phase-b/queue-contract.ts`), nicht neben
   dem `Queue`-Objekt im Backend. `apps/smtp-ingress` reiht den Phase-B-Hinweis nach dem `250` ein
   (Architektur §3 Schritt 7) und darf nicht aus `packages/backend` importieren — eine Konstante dort
   hätte beide Seiten über ein **kopiertes Stringliteral** übereinstimmen lassen, also über nichts.
   Das ist die Form von **F46**. Das Modul hat bewusst **keinen** BullMQ-Import: der Reconciler muss
   entscheiden können, was einzureihen ist, ohne einen Redis-Client dafür zu brauchen.
2. **Die Payload trägt genau ein Feld** (`spoolTxId`). Die Queue ist Optimierung, nicht Autorität, also
   darf nichts darin stehen, was Spool und Ledger nicht selbst hergeben. Eine Kopie von `seq` wäre eine
   **zweite Quelle** für einen Wert, den der Ledger hält — und eine Payload, die ihrer Ledger-Zeile
   widerspricht, wäre **nicht entdeckbar**, weil niemand die beiden vergleicht. Ein Test hält die
   Feldbreite strukturell fest, damit ein zweites Feld eine Entscheidung kostet.
3. **Der Processor wirft, statt zu quittieren.** Ein **fertiger** Phase-B-Job behauptet, die Nachricht
   sei archiviert und durchsuchbar — genau das liest `JR-6-04`s Reconciler, um einen Spool-Eintrag
   liegen zu lassen. Ein Platzhalter, der loggt und zurückkehrt, stellte diese Behauptung **falsch und
   grün** auf. `JR-4-10` und F48 sind zweimal dieselbe Lehre: die Abwesenheit von Arbeit und ihr Erfolg
   drucken gleich.

**Die Queue hat eigene Job-Optionen, und das ist Absicht.** Die geteilten `defaultJobOptions`
(5 Versuche in ~31 s) sind für Phase B falsch: ein gewöhnlicher Storage-Aussetzer würde damit jede
wartende Nachricht an den Reconciler übergeben — und ein Sicherheitsnetz, das bei jedem Neustart einer
Abhängigkeit greift, **ist** der Normalpfad, hinter dem ein echter Reconciler-Defekt verschwindet.
Jetzt 10 Versuche ab 5 s (≈ 85 min), `removeOnFail` groß, weil ein gescheiterter Phase-B-Job der
billigste Beleg dafür ist, woraus der Backlog bestand.

**Der Worker ist absichtlich nicht in `pnpm start:workers`**, wie `apps/smtp-ingress` nicht in
`start:oss` steckt: Opt-in-Subsystem. **Der Preis ist benannt:** wer den Ingress ausrollt und diesen
Prozess vergisst, bekommt Post, die **angenommen und nie archiviert** wird — nichts bricht laut, das
`250` ist ehrlich, der Spool wächst. Gegenmittel sind **E10** (Monitoring) und **E11** (Verdrahtung).

**Neu im Harness: `probeRedis()`** — die erste Suite des Repositorys, die Redis statt Postgres braucht.
Dazu ein `valkey`-Service in der CI. Er hat **kein Passwort**, und das ist eine Einschränkung, keine
Vereinfachung: ein Actions-Service-Container nimmt kein `command`, `--requirepass` ist dort nicht
setzbar. Der AUTH-Pfad wird lokal ausgeübt; `probeRedis()` ist ein reiner TCP-Connect, damit ein
**falsches** Passwort als Verbindungsfehler ankommt und nicht als Skip.

**Eine Zusage ist plattformabhängig und sagt das.** Windows kennt kein POSIX-Signal, `child.kill()`
beendet statt zu signalisieren — der Graceful-Shutdown-Nachweis ist nur auf dem Linux-CI-Runner
erbringbar. Der Test läuft trotzdem **immer** (`expectedTests` ist exakt und darf nicht je Plattform
abweichen), prüft auf Windows das tatsächliche Windows-Verhalten und gibt eine `coverageNotice` aus,
die die ungeprüfte Zusage **namentlich** benennt. Kein `skipIf`.

**Ein neuer Befund, F59, und er ist nicht von dieser Scheibe verursacht** — sondern von ihr sichtbar
gemacht. Siehe den Kasten oben; er braucht eine Entscheidung des Auftraggebers.

**Weiterhin offen und nicht angefasst: die Doku-Diät.** Sie war „nach der E4-Abnahme" verabredet
(Pflichtlektüre unter 40 000 Tokens). Diese Sitzung hat sie bewusst liegen gelassen, um die erste
E6-Scheibe nicht mit einem Umbau der Projektakten zu vermischen.

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
| `pnpm lint`               | **grün, seit F35 am 2026-08-04 behoben ist** (`9c60f32`). Bis dahin war es hier strukturell rot (zuletzt 481 Dateien), weil `core.autocrlf=true` ohne `.gitattributes` alles als CRLF auscheckte. **Eine Rotmeldung ist ab jetzt wieder eine Aussage** und darf nicht mehr weggedeutet werden — aber weiterhin **nie** mit repoweitem `prettier --write` „beheben"              |

**Wegwerf-Cluster ohne Systeminstallation** — so ist er in dieser Session entstanden, PostgreSQL
**17.10**, dieselbe Version wie die CI und wie `JR-13-09a`:

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
`Get-ChildItem <basis> -Directory` zeigt sie mit Datum. Dort liegen auch die Prüfwerkzeuge von `JR-13-09b`
und `JR-13-09c` (`adr020.cjs`, `thirdnumber.cjs`, `claims.cjs`, `extract.cjs`, `fixtures.cjs`, `run.cjs`,
`cross.cjs`, `overreport.cjs`, `sql/query1..3.sql`, `vocab.cjs`, `manage.cjs`) und aus `JR-1-05c`
`pg-up.ps1`, `lintcheck.cjs`, `lintfix.cjs`, `leftovers.cjs` (`--drop` räumt auf), `counts.cjs`
(Testzahlen je Suite und Klasse aus einem `--reporter=json`-Lauf) — **nicht** im Repository.

> **Am 2026-07-30 bestätigt:** die Binaries der Vorsession `7b5a77e0` lagen noch da, die Versionsabfrage
> sagte 17.10, und ein `initdb` in den eigenen Scratchpad genügte — kein `npm install`. Die vier
> Werkzeuge oben sind gegen **diesen** Host kalibriert und funktionieren unverändert.

> **Werkzeuge einer Vorsession sind gegen deren Stand kalibriert.** Ein grüner Lauf belegt nichts, wenn
> der Anker, an dem das Werkzeug hing, inzwischen entfernt wurde. `JR-13-09c` hat das richtig gemacht: den
> gesuchten Satz in einer Wegwerf-Kopie **absichtlich wieder einsetzen**, zeigen dass das Werkzeug ihn
> findet, und erst dann dem sauberen Lauf glauben.

**Nützlich und schnell nachgebaut:** `lintcheck.cjs` prüft übergebene Dateien Prettier-konform **ohne**
über F35 zu stolpern (LF-Normalisierung in Node, Vergleich über die Prettier-API), `lintfix.cjs`
formatiert sie und schreibt die **Zeilenenden unverändert** zurück. Beide sind der praktische Ausweg aus
„`pnpm lint` ist auf diesem Host immer rot".

> **Zwei Lücken, die `JR-13-09` offenlassen musste, sind in `JR-13-09a` geschlossen:** der **HTTP-400-Pfad**
> ist end-to-end gemessen (`IamController.createRole` direkt aufgerufen, 11 × `400` mit dem Key bzw. Wert
> im Text, 5 × `201`), und die **Betreiber-SQL ist auf PostgreSQL 17.10** gefahren — zeichenweise
> identische Ausgabe wie auf 16.13 in allen drei Blöcken. Wie: `postgresql-17` (17.10-1, dieselbe
> Version wie die CI) aus dem pgdg-Repository (`https://apt.postgresql.org/pub/repos/apt noble-pgdg`),
> eigener Cluster auf Port **5433**, alle 41 Migrationen per `psql -f`, danach Paketquelle und Cluster
> restlos entfernt.

> **`JR-13-16` ist am 2026-07-29 aus E13 herausgenommen worden — Entscheidung des Auftraggebers.** Sie
> sichert kein Autorisierungsverhalten, sondern ein **Doku-Artefakt** ab, und sie war **kein** Kriterium
> von `JR-13-09a`. **F30 ist allerdings genau der Fall, gegen den sie schützen würde** — die Betreiber-SQL
> ist weiterhin das einzige sicherheitsrelevante Artefakt in E13 ohne Test, und sie ist jetzt zum
> zweiten Mal die Stelle, an der die Abnahme scheitert. Das ist ein Argument für ein Vorziehen, keine
> Entscheidung des Testers.
>
> > **Nachtrag `JR-13-17` (DEV):** die Abfrage hat nach diesem Fix **drei** neue Befundtypen und eine neue
> > CTE-Spalte und ist weiterhin ohne Test. ADR-020 nimmt ihr die Beweislast — sie **meldet** nur noch —,
> > aber die Regression, gegen die `JR-13-16` schützt, bleibt möglich: ein späterer Eingriff kann sie
> > stillschweigend wieder auf die Wurzel zurückdrehen oder ein Falsch-positives einführen. Die Reihenfolge
> > entscheidet der Auftraggeber; DEV legt es nur erneut vor.

### Nächster konkreter Schritt — **`JR-6-02`, und mit ihr fällt ADR-010**

Der Prompt für die nächste Sitzung:

```
Weiter mit dem Journaling-Projekt. Lies docs/dev/journaling/07-session-handover.md
und arbeite den nächsten Schritt ab.
```

**Der Zweig steht schon:** `claude/journaling-e6-phase-b-worker`, mit eigenem Upstream, `JR-6-01`
gepusht, CI-Lauf `30999645177` **success** (98 Dateien, `unit 1019/1019 · integration 126/126 ·
adversarial 69/69`). Nicht neu abzweigen, nicht neu reservieren — die Nummern liegen bereit.

`JR-6-02` ist die Verarbeitung: **Spool lesen → Journal-Report parsen → Außenobjekt in den Storage →
Metadaten nach `archived_emails` → indexieren → Spool freigeben.** Sie ist der erste Verbraucher
**beider** in E4/E5 zusammengeführter Epics und die erste Stelle, an der ihr Zusammenspiel überhaupt
ausgeführt wird. Der Einstiegspunkt ist eine einzige Funktion:
`packages/backend/src/jobs/processors/journal-inbound.processor.ts` — sie wirft heute und ist genau dafür
so gebaut, dass `JR-6-02` sie **füllt** statt den Prozess umzubauen.

> **Was `JR-6-01` an Material mitgibt, das nicht im Backlog steht — und der Reihe nach das Wichtigste:**
>
> **(1) ADR-010 ist die Scheibe, nicht ein Nebenprodukt.** Die Frage lautet: `processEmail()`
> erweitern oder einen journaling-spezifischen Pfad daneben stellen? Die ADR hält als Abwägung fest,
> dass Wiederverwendung **divergierende Dedupe-Semantik vermeidet — der teuerste denkbare Fehler in
> diesem Projekt** — und ein separater Pfad genau diese Divergenz riskiert. Sie sollte erst
> entschieden werden, „wenn der Parser zeigt, wie stark die Metadatenform abweicht". **Der Parser ist
> jetzt da** (E5, `packages/journaling/src/parser/`), die Bedingung ist erfüllt.
>
> **(2) Es gibt einen echten Widerspruch zwischen Architektur §6 und ADR-025, und `JR-6-01` hat ihn
> auf eine Weise aufgelöst, die `JR-6-02` fortsetzen muss.** §6 sagt „neuer Worker-Prozess **in
> `packages/backend`**". ADR-025 sagt, journaling-spezifische Logik dürfe **nie so in
> `packages/backend` entstehen, dass sie sich nur mit ihm zusammen betreiben lässt** — und begründet
> das nicht ästhetisch, sondern damit, dass eine spätere Herauslösung eine **Verpackungsentscheidung**
> bleiben soll. Beides gilt, und beides ist erfüllbar: **das Prozessgerüst gehört ins Backend, die
> Pipeline nach `packages/journaling`, mit injizierten Ports.** So liegt es nach `JR-6-01` — der
> Worker im Backend, der Vertrag in `packages/journaling`, keine Journaling-Logik im Backend außer
> Verdrahtung. `StorageService`, `IndexingService` und `IngestionService` sind Backend-Dienste und
> werden **hineingegeben**, nicht importiert. **Das ist die eigentliche Vorentscheidung zu ADR-010:**
> „`processEmail` erweitern" heißt zwangsläufig, Journaling-Semantik in `packages/backend` zu legen.
> Wer sich dafür entscheidet, muss ADR-025 ausdrücklich adressieren, nicht übersehen.
>
> **(3) Hashing vor Verschlüsselung ist Bestand und muss Bestand bleiben.** `content_sha256` über die
> **Plaintext-Wire-Bytes**, `StorageService` verschlüsselt danach — damit der Hash gegen einen
> Re-Export prüfbar bleibt (CLAUDE.md §5.5, Architektur §7). `JR-6-05` schreibt es fest und testet es;
> `JR-6-02` darf die Reihenfolge nicht vorher schon umdrehen.
>
> **(4) Parse-Fehler lehnen nichts ab.** Sie setzen `parse_failed`, indexieren was extrahierbar ist
> und alarmieren (Architektur §6). Eine Nachricht, die schon quittiert ist, kann nicht nachträglich
> abgelehnt werden — der Ledger-Eintrag existiert.
>
> **(5) Der Reconciler (`JR-6-04`) liest den Job-Zustand.** Deshalb wirft der Processor heute, statt zu
> quittieren, und deshalb ist die Payload ein Feld breit. Wer in `JR-6-02` einen Zwischenzustand
> einführt („Objekt liegt, Metadaten fehlen"), muss sagen, **woran der Reconciler ihn erkennt** — aus
> Spool und Ledger, nicht aus Redis.
>
> **(6) `JR-6-03` kommt gleich danach und teilt sich die Dedupe-Stelle.** Ein Objekt, **zwei**
> Ledger-Einträge, der zweite mit `duplicate_of`. Empfangsereignis ≠ Nachricht. Wer die Dedupe in
> `JR-6-02` baut, sollte diese Trennung schon dort anlegen, statt sie danach nachzurüsten.

**Drei Dinge, die beim Weiterarbeiten zählen** — unverändert gültig, jedes einmal teuer bezahlt:

1. **Der CI-Lauf ist Teil des Belegs, nicht Nachsorge** (F48). `fsyncDirectory()` scheitert auf diesem
   Windows-Host mit `EPERM`, und `accept()` schreibt den Ledger erst danach — **lokal erreicht kein
   Lauf den Append.** Nach jedem Push: `gh run list --branch <branch> --limit 1`, bei Rot
   `gh run view <id> --log-failed`. **Neu dazu:** die `integration`-Suite braucht jetzt zusätzlich ein
   **gebautes `packages/backend/dist`** (der Worker-Start-Test spawnt die kompilierte Datei). Fehlt es,
   skippt die Suite sichtbar mit einer Meldung, die zum Bauen auffordert — unter
   `OA_TEST_REQUIRE_INFRA=1` ist das ein Fehlschlag. **Der lokale Volllauf will also einen Build
   vorher**, so wie die CI ihn ohnehin macht.
2. **Wo die Kernaussage einer Suite plattformabhängig ist, gehört ein Zähler dazu**, der den **nicht
   gezogenen** Zweig ausweist. Sonst sind „grün auf Windows" und „grün, weil nichts geprüft wurde"
   derselbe Text (`JR-4-10`, F48). `JR-6-01`s SIGTERM-Fall ist das Muster: immer laufen, intern
   verzweigen, `coverageNotice` mit Namen der ungeprüften Zusage — **kein `skipIf`**, weil
   `expectedTests` exakt ist und nicht je Plattform abweichen darf.
3. **Inventar ziehen und committen, sobald die erste Testdatei steht.** Das Nutzungslimit hat in E4
   sechs Runden getroffen, zwei mit erheblicher uncommitteter Arbeit. Ein Zwischenstand mit gezogenem
   Inventar ist lauffähig und prüfbar; einer ohne ist wertlos, egal wie viel Code darin liegt. Und:
   **nie zwei Rollen gleichzeitig auf einer Scheibe** — `tests/support/suite-inventory.ts` trägt exakte
   Zahlen und verträgt genau einen Bearbeiter.

> **Zwei Dinge liegen zur Entscheidung beim Auftraggeber:**
>
> - **F59** (siehe oben): im Produktionscode beheben oder im Test wegprüfen. Empfehlung: beheben. Der
>   Befund macht die CI **sporadisch** rot — der Erstlauf von `JR-6-01` fiel darüber, der
>   Wiederholungslauf war grün. Solange er offen ist, muss ein roter Lauf an
>   `ingress-process-boot.test.ts` **erst gegen F59 geprüft** werden, bevor er als neuer Defekt gilt.
> - **Die Doku-Diät**, weiterhin offen: Pflichtlektüre auf unter 40 000 Tokens. Verabredet war „nach
>   der E4-Abnahme"; sie ist seit zwei Sitzungen fällig und wächst mit jedem Statuseintrag.

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

0. **`F59`: `shutting down` kann verlorengehen — im Produktionscode beheben oder im Test wegprüfen?**
   Neu und die einzige Frage, die **die CI sporadisch rot macht**. `apps/smtp-ingress` schreibt die
   Zeile mit `console.log` und ruft direkt danach `process.exit(0)`; das leert einen Pipe-stdout auf
   Linux nicht. **Empfehlung: im Produktionscode beheben** — eine Betriebsmeldung, die ein
   Supervisor-Log erreichen soll, darf nicht davon abhängen, wie schnell die Maschine gerade ist. Die
   Alternative macht den Lauf grün und die Zusage unprüfbar. Solange offen: ein roter Lauf an
   `ingress-process-boot.test.ts` ist **erst gegen F59 zu prüfen**, bevor er als neuer Defekt gilt.
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
4. **Die Doku-Diät** — verabredet „nach der E4-Abnahme", seit zwei Sitzungen fällig, nicht begonnen.
   Pflichtlektüre auf unter 40 000 Tokens. Keine Entscheidung nötig, nur eine Freigabe der Zeit dafür.

**Beantwortet und nicht mehr offen:** die Rückfrage des Auftraggebers vom 2026-08-03, ob statt des
Eigenbaus eine fertige SMTP-Bibliothek (`smtp-server`) genommen werden sollte. Geprüft, verneint, und
der **Nachtrag in `ADR-029`** hält sowohl das Ergebnis als auch die Aufwandsrechnung fest — inklusive
der Korrektur, dass die Begründung im RFC („Exchange Online uses BDAT. Not optional.") **nicht** trug
und durch die Bare-LF-Begründung ersetzt ist. Wer die Frage erneut stellt, findet dort beide
Rechnungen.

> **~~Der Rückmerge von E2~~ — freigegeben und am 2026-08-01 vollzogen** (`eb340a9`, `--no-ff`, kein
> Squash). Die Bedingung aus ADR-014 war mit `JR-2-10a` erfüllt (24/24, frische Sitzung). Kein
> Entscheidungsbedarf mehr; der nächste Schritt ist **E3**.
>
> **Offen und wirklich beim Auftraggeber: `F39`** (niedrig, Testharness) — beheben oder bewusst
> akzeptieren? Der
> Test „is length-prefixed…" bleibt grün, wenn man das Längenpräfix entfernt; gefangen wird die
> Mutation nur vom Golden-File. Kein Produktdefekt, blockiert nichts. Ein Vorschlag steht im Befund.
> Sinnvoller Ort wäre die nächste Arbeit an `packages/journaling`.
>
> **~~Genügt die Abnahme `JR-2-10`, obwohl sie nicht unabhängig ist?~~ — entschieden am 2026-08-01:
> nein, es gibt eine zweite Runde (`JR-2-10a`); sie ist durchgeführt und hat E2 abgenommen.** Die erste
> Runde lief in derselben Sitzung wie `JR-2-08`/`JR-2-09`; ADR-014 und ADR-021 verlangen Unabhängigkeit,
> und der Auftraggeber hat auf der Regel bestanden. **Das hat sich gelohnt:** die zweite Runde hat die
> sechs dünnen Stellen der ersten geschlossen und dabei einen weiteren Befund (**F39**) gefunden — und
> der PO hat im Bericht der zweiten Runde ein **ganz fehlendes Kriterium** entdeckt, das erst auf
> Nachfrage nachgemessen wurde. Beide Runden zusammen haben mehr belegt als eine doppelt so gründliche
> hätte belegen können.

Ansonsten keine. `ADR-007`, `ADR-022`, `ADR-023` (alle 2026-07-31, Auftraggeber) und `ADR-006` (2026-07-31,
`JR-2-03`, Rolle PO) sind entschieden. Was in E2 noch offen ist — `ADR-009`, Append-Only per Rechteentzug
oder Trigger — ist Teil von `JR-2-05` und braucht keine Entscheidung des Auftraggebers vorab. Alles andere
ist Arbeit ohne Entscheidungsbedarf.

> **Eine Festlegung aus `ADR-006` verdient trotzdem den Blick des Auftraggebers**, weil sie eine
> Betriebsauflage erzeugt statt einer technischen Sperre: ein aus Produktionsdaten erzeugtes Staging- oder
> Testsystem **muss** mit abgeschaltetem SMTP-Ingress und abgeschaltetem Anchor-Job laufen. Ein Klon ist
> von einem Restore technisch nicht unterscheidbar, und wer hier eine Sperre einbaut, sperrt zuerst das
> Disaster Recovery (ADR-006 §4.3). Die Auflage gehört in den Deployment-Guide (E11); die technische
> Erkennung ist in `JR-8-02`/`JR-8-03`/`JR-2-09` verankert.

Die zuletzt blockierende Frage war **F30**, entschieden mit **ADR-020** und umgesetzt in
`JR-13-17`/`JR-13-18`.

**Zwei Punkte aus `JR-13-17`, beide nicht blockierend, beide Entscheidung des Auftraggebers:**

1. **`JR-13-16` vorziehen?** Unverändert vorgelegt, jetzt mit einem Argument mehr: die Abfrage hat nach
   `JR-13-17` drei neue Befundtypen und eine neue CTE-Spalte, und sie ist weiterhin das einzige
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
`JR-13-11`. Vorziehen ja/nein ist eine Produktentscheidung, nicht E13s Abnahme.

**~~Doku-Nacharbeit am Permission-Vokabular~~ — erledigt am 2026-07-30 als `JR-13-12`** (`dca1f1a`),
Grundlagenarbeit direkt auf dem Integrationsbranch, wie im Backlog vorgesehen. Kein Entscheidungsbedarf
mehr.

**Zur Kenntnis, kein Entscheidungsbedarf: eine benannte Abweichung in `JR-13-06`.** Die Allowlist prüft
Form des Keys plus Relation, nicht die Existenz der Spalte; ein einzelner unbekannter Key (`foo`) wird
weiter übersetzt. Begründung und Vorschlag (spaltengenaue Prüfung bei `JR-13-10`) stehen unter „Was
zuletzt passiert ist" und in F21.

**F12 ist erledigt und braucht keine Entscheidung mehr.** Behoben in `JR-1-04a` (`653dd1c`), in
`JR-1-06a` unabhängig als behoben bestätigt (10 nebenläufige Runden, 0 Rückstände).

**Vom PO am 2026-07-29 abgearbeitet — kein Vorlagebedarf mehr:** **F18** (ADR-017 und F7 um „für die
Paare der heutigen Aufrufstellen" ergänzt, plus der F17-Nachtrag), **F21** (strenge Variante
entschieden und in `JR-13-06` festgeschrieben, die drei Pins im selben Commit invertiert),
**F22** (`JR-13-04`s Kriterium auf „kein Zweig wird stillschweigend weggelassen" umformuliert, mit der
richtigen Gefahrenrichtung), **F17(a)** (in `JR-13-07` erledigt: die Betreiberdoku sagt, dass
ausgeliefert nur die Super-Admin-Rolle existiert und eine fehlende Read-Only-Rolle kein Fehler der
Installation ist). **F19/F20** brauchten ohnehin keine Entscheidung und sind über die roten Tests Teil
der Abnahme.

**Offen und wirklich beim Auftraggeber: nur `F17(b)`** — soll der Rollen-Bootstrap repariert werden?
Das ist eine Produktentscheidung (welche Rollen liefert Open Archiver aus?), keine Härtung, und sie
gehört nicht in E13. **Blockiert nichts.**

**Restliche Punkte aus `JR-13-01`, zur Kenntnis:**

| Punkt       | Sachstand                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F17**     | (a) **Erledigt:** die Betreiberdoku aus `JR-13-07` nimmt auf, dass ausgeliefert keine Read-Only-Rolle existiert, und ADR-017 hat den Nachtrag. (b) **Offen beim Auftraggeber:** soll der Bootstrap repariert werden? Produktänderung, keine Härtung, nicht in E13. PO-Nachprüfung am Code bestätigt: `createFirstAdmin` → `createAdminRole()` legt `predefined_super_admin` an, `getRoles` liegt hinter `requireAuth`, der Bootstrap kann danach nie mehr feuern. |
| **F18**     | **Erledigt (PO).** ADR-017 hat einen Nachtrag: die Aussage gilt für die Paare der heutigen vier Aufrufstellen, nicht für jede (Action, Subject) je Rolle. Das Aufrufstellen-Inventar wacht darüber.                                                                                                                                                                                                                                                               |
| **F21**     | **Umgesetzt in `JR-13-06` (`dcec017`).** Die drei Pins sind im Fix-Commit invertiert. Eine benannte Abweichung: die Allowlist prüft die Form des Keys plus die Relation, nicht die Existenz der Spalte — ein einzelner unbekannter Key (`foo`) wird weiter übersetzt, weil `mongoToDrizzle` keinen Tabellenkontext hat. Vorschlag: spaltengenau bei `JR-13-10`.                                                                                                   |
| **F22**     | **Erledigt (PO).** `JR-13-04`s Kriterium lautet jetzt „kein Zweig wird stillschweigend weggelassen", mit dem Hinweis, dass die fail-open-Richtung im `$and` und bei leerer Zweigliste liegt, nicht im `$or`.                                                                                                                                                                                                                                                      |
| **F19/F20** | **Behoben** in `JR-13-02` (`a309fd1`) bzw. mit `JR-13-04` (`45ac0e9`): ein unbedingtes `cannot` verweigert, und ein `can` mit leerem `conditions` gilt nicht mehr als unbedingt. Beide Tests sind grün.                                                                                                                                                                                                                                                           |
| **F23**     | Testharness: `tsconfig.test.json` sieht globale Augmentierungen nicht, die nur über Produktionsdateien ins Programm kommen. In `JR-13-01` umgangen (`tests/support/express-i18n-augmentation.d.ts`), Ursache offen. Für E2 relevant, weil der Receiver eigene Express-Routen bekommt.                                                                                                                                                                             |

**Nicht blockierend, aber entscheidungsbedürftig:**

| Punkt       | Sachstand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F13**     | Der unbeschränkte Sweep in `acquireTestDatabase()` kann einen fremden Lauf treffen, der **länger als die Frist** (Default 2 h) läuft; offene Verbindungen schützen ihn nicht, weil `postgres-js` untätige schließt. Heute unerreichbar (5-s-Suite), **erreichbar ab E2/E3** — konkret beim 100k-Soak aus `JR-2-08`. Drei plausible Entwürfe: Lauf-Register, PID-Lebendigkeitsprüfung (`process.kill(pid, 0)`), einmaliger Sweep pro Lauf. Vorerst gilt die Zwischenregel in `04-testplan.md` §2.6. **Spätestens vor `JR-2-08` zu entscheiden.** |
| **ADR-017** | **Erledigt am 2026-07-29: Variante B, umgesetzt in `JR-13-03` (`bcac6bd`).** Braucht keine Entscheidung mehr. Folgearbeit als `JR-13-10` nach E13 vorgemerkt.                                                                                                                                                                                                                                                                                                                                                                                   |
| **F14–F16** | **Alle drei behoben in `JR-1-05c`** (`b5b2190`, 2026-07-30), zusammen mit **F24**. Kein Entscheidungsbedarf mehr. Der Wächter zählt jetzt ausgeführte Tests je Suite **und je Klasse**, die Dateizahl ist eine Gleichheit, und der Hauptprozess besitzt den Rückstand dieses Laufs über ein Ledger-Verzeichnis. Jeder Angriff zuerst am Elternstand wiederholt (Umetikettierung dort Exit 0, jetzt Exit 1). Protokoll in `06-status.md`.                                                                                                        |

| Punkt                                                    | Sachstand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **~~Zwei offene Pull Requests nach `main`~~ — erledigt** | **In `JR-13-09` nachgeprüft (2026-07-29): beide sind geschlossen und _nicht_ gemergt.** `PR #1` (`claude/enterprise-product-implementation-cxmmqe` → `main`) und `PR #2` (`claude/journaling-e1-test-foundation` → `main`) stehen auf `state: closed`, `merged: false`, geschlossen am 2026-07-28. Es gibt **keinen** weiteren PR im Repository, insbesondere keinen aus E13. Damit ist auch die Nebenwirkung weg: ein Push löst wieder **einen** CI-Lauf aus (nur `push`), was an den E13-Läufen sichtbar ist. Kein Entscheidungsbedarf mehr. |
| **~~`JR-1-05c`~~ (F14–F16, F24) — erledigt**             | **Erledigt am 2026-07-30 (`b5b2190`).** Ein grüner CI-Lauf belegt jetzt, dass die deklarierten Tests je Suite und Klasse **ausgeführt** wurden. Zwei Folgen für jede weitere Task: eine neue Testdatei ändert `expectedFiles` **und** `expectedTests` im selben Commit, und ein `-t`-Lauf taugt nicht als Beleg (er meldet „verified NOTHING"). Details in `03-backlog.md` und `06-status.md`.                                                                                                                                                 |

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
