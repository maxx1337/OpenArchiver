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

**Stand:** 2026-08-04 (**E4 ist abgenommen und zurückgemergt; E5 ebenfalls — beide Parallelzweige
sind zusammengeführt**) · **Branch:** `claude/enterprise-product-implementation-cxmmqe`
(Integrationsbranch) · Volllauf **gegen den gemergten Baum**: **1181 Tests** bei 95 Dateien —
`unit ci 991 · integration ci 121 · adversarial ci 69`, `[TEST-EXECUTED]` vorhanden

> **E4 ist abgenommen (`JR-4-13`, 2026-08-04, unabhängige TEST-Sitzung).** Urteil: angenommen mit zwei
> Auflagen, **beide in derselben Sitzung erledigt**. Das Protokoll mit einem Beleg je Kriterium steht
> in **`16-abnahme-e4.md`** (`71d2b85`, nachgeführt `c79aff4`). Erledigt sind alle 21 IDs
> (`JR-4-01`…`JR-4-12`, `JR-4-14`…`JR-4-21` samt `JR-4-21a`) **und** die Abnahme.

> **Aus E4 ist kein Befund offen.** F42–F51 behoben oder aufgelöst; F52/F53/F54 in `JR-4-21`,
> F50/F55/F56 in `JR-4-21a`, **F47** bei der Abnahme als längst behoben erkannt und korrigiert.

> **Der Rückmerge ist vollzogen** (`9503bc8`, `--no-ff`, kein Squash), freigegeben vom Auftraggeber am
> 2026-08-04. Der Epic-Branch ist vorher gepusht worden, damit die Abnahmehistorie nicht nur im
> Container liegt.

> **Beim Rückmerge sind drei Nummernkreise kollidiert**, weil E4 und E5 parallel auf zwei Zweigen
> entstanden sind: ADR-Nummern (026/027/028 doppelt, plus eine von E4 verschobene 026),
> Befundnummern (F42/F43 doppelt) und Dateinamen (`12-`). Aufgelöst nach dem Grundsatz **der
> eingehende Zweig gibt nach**; E4s ADRs heißen jetzt **029/030/031**, E5s Befunde **F57/F58**, und
> `12-parallelbetrieb.md` heißt **`17-parallelbetrieb.md`**. Die Regel dazu ist **ADR-032** — wer
> einen Epic-Zweig eröffnet, reserviert seine Nummern vorab auf dem Integrationsbranch.

> **E3 ist abgenommen (`JR-3-08`, 21/21) und am 2026-08-02 zurückgemergt** (`185e9bd`, `--no-ff`).

### Der Stand in einem Satz

**Der SMTP-Empfangspfad steht und nimmt an.** `apps/smtp-ingress` spricht ESMTP mit `PIPELINING`,
`8BITMIME`, `SMTPUTF8`, `SIZE`, `CHUNKING`, `STARTTLS` und `AUTH`, prüft Quell- und Empfänger-ACL gegen
`journaling_sources`, fährt beim Start den Crash-Recovery-Scan, und antwortet auf das Ende von `DATA`
bzw. `BDAT … LAST` mit **`250 … queued as <seq>`** — erst nachdem Spool-fsync **und** Ledger-Append
durch sind. Seit `JR-4-19` übersteht er auch einen Start ohne erreichbare Ledger-Datenbank: er
antwortet `451`, holt die Verdrahtung im Hintergrund nach und nimmt danach **ohne Neustart** an.
**Offen sind `JR-4-21` (Härtung, läuft), `JR-4-15` (Sicherheitsdurchsicht) und die Abnahme.**

Seit `JR-4-10` ist die zentrale Zusage nicht mehr nur strukturell begründet, sondern **gemessen**:
unter echtem `SIGKILL` während einer 50-MB-Übertragung haben in CI-Lauf `30862834098` sieben von
zwanzig Runden den `250`-Zweig gezogen — und **alle sieben** hatten eine passende, byteexakt geprüfte,
korrekt verkettete Ledger-Zeile. Kein Fall von „teilweise".

**`JR-4-14` hat drei Defekte gefunden, und sie haben eine gemeinsame Wurzel** (`F52`, `F53`, `F54` in
`09-befunde-bestandscode.md`): Die Zeilenlängengrenze wird in der **Parselogik** geprüft statt beim
Hereinkommen der Bytes. Deshalb hängt ihr Ergebnis von der Chunk-Zerlegung ab — ~2 000 Byte ⇒
falsches `250` · **100 KB ⇒ korrekt `500` in 25 ms** · ~200 KB ⇒ Fehlschlag · 2 MB ⇒ keine Antwort.
**Dass der Fall bei 100 KB funktioniert, ist der Beleg**, nicht die Ausnahme: dort greift der intakte
`idx === -1`-Zweig, weil Node in mehreren `data`-Ereignissen liefert.

**Daraus ist `JR-4-21` entstanden (Rolle DEV, läuft), und mit ihr eine Änderung an ADR-029.** Der
Auftraggeber hat die Eigenimplementierung ein zweites Mal angezweifelt, diesmal mit Go-Kandidaten —
und traf eine echte Lücke: die Kandidatentabelle der ADR prüft **ausschließlich npm-Pakete**.
Gemessen: `go-smtp` kann `BDAT` vollständig serverseitig. **Die Entscheidung bleibt trotzdem**, aber
aus einem anderen Grund als bisher: nicht das Protokoll ist der Blocker, sondern der
Acceptance-Contract — ein Go-Ingress müsste Spool (E3) und Ledger (E2) mitnehmen, also die Hash-Kette
zweimal implementieren. **Was sich ändert:** Der Eigenbau hört auf, seine Härtung selbst zu erfinden;
`go-smtp` ist ab jetzt die Vorlage (`lineLimitReader` — Grenze im **Reader** statt im Parser).
Vollständig im Nachtrag zu ADR-029, `05-entscheidungen.md`.

> **Ein Fehler, aus dem eine Regel geworden ist:** Nachdem der Tester am Nutzungslimit ausgefallen
> war, hat der PO einen Ersatz gestartet — und nach dem Limit-Reset bauten **zwei** Tester dieselbe
> Scheibe im selben Arbeitsbaum. `tests/support/suite-inventory.ts` trägt exakte Zahlen und verträgt
> genau einen Bearbeiter. **Nie zwei Rollen gleichzeitig auf einer Scheibe, auch nicht nach einem
> Ausfall** — erst prüfen, ob die erste Rolle zurück ist. Der Doppellauf hat zwar F52 unabhängig
> bestätigt und über einen ungeklärten roten Fall F54 zutage gefördert, aber das rechtfertigt ihn
> nicht.

### Was diese Session gemacht hat

> **Neun Scheiben abgeschlossen:** `JR-4-01` (Prozessskelett, zod-Config, Import-Graph-Nachweis),
> `JR-4-02` (ESMTP-Server — **und ADR-029**), `JR-4-03` (`CHUNKING`/`BDAT`), `JR-4-16` (F44),
> `JR-4-04` (STARTTLS/TLS), `JR-4-05a`/`b`/`c` (Quell-ACL und erste Datenbankanbindung,
> Empfänger-ACL, `AUTH` über TLS), `JR-4-17` (ADR-030), `JR-4-06a` (`accept()` verdrahtet, erstes
> `250`), `JR-4-18` (Crash-Recovery-Scan verdrahtet), `JR-4-20` (F46), `JR-4-06b` (ganze Codetabelle,
> Graceful Drain), `JR-4-07` (kein Relaying, Byte-Treue), `JR-4-08` (Verbindungs- und Ratengrenzen).
>
> **Zwei ADRs:** **ADR-029** — der SMTP-Server ist **selbst gebaut**, weil kein Node-Paket `BDAT`
> beherrscht; der Auftraggeber hat die Entscheidung zu Recht angezweifelt, und der **Nachtrag** hat
> die Begründung ausgetauscht: „Exchange benutzt BDAT" trägt nicht (RFC 3030 verlangt `DATA`-Fallback),
> tragend ist, dass Microsoft **bare line feeds** nicht mehr entfernt und solche Nachrichten über
> `DATA` **nicht übertragbar** sind. **ADR-030** — eine Transaktion bleibt genau **einer** Kette
> zugeordnet; ein zweiter `RCPT TO` für eine andere Kette bekommt `452 4.5.3`.
>
> **Sieben Befunde: F42–F48.** Die vier, die zählen:
>
> - **F44** (hoch, behoben in `JR-4-16`): nach einem `552` las der Server den Nachrichtenrumpf als
>   SMTP-Kommandos — gemessen, drei Rumpfzeilen mit `250` beantwortet. Mit `JR-4-06` wäre daraus ein
>   falscher Ledger-Eintrag geworden, denn `envelope_from` ist ein gehashtes Feld.
> - **F46** (hoch, behoben in `JR-4-20`): `RecipientAclEvaluator.evaluate` und
>   `SourceAclEvaluator.evaluate` hießen gleich, TypeScript typisiert strukturell — jeder `RCPT TO`
>   lief gegen die IP-Allowlist, der Empfang war **funktionsunfähig**. Kein Test sah es, weil **jeder**
>   ein Fake statt der produktiven Verdrahtung benutzte.
> - **F48** (hoch, aufgelöst): **alle zwölf CI-Läufe zwischen 07:22 und 11:08 sind fehlgeschlagen**,
>   am Lint-Schritt, vierzehn Scheiben lang unbemerkt — und damit lief in der CI **weder Build noch
>   Suite**. Das wog schwer, weil `fsyncDirectory()` auf diesem Windows-Host mit `EPERM` scheitert und
>   `accept()` den Ledger erst danach anfasst: **lokal erreicht kein Lauf den Append.** Der Kern des
>   Projekts war lokal unprüfbar und in der CI ungeprüft. Beides ist zu.
> - **F43** (mittel, offen): `heapUsed` sieht Node-`Buffer` nicht — ein Speichernachweis muss über
>   `arrayBuffers` laufen und **kalibriert** sein. Setzt ein Fragezeichen hinter `JR-3-02`s
>   abgenommene Zusicherung; zu prüfen ist der **Nachweis**, nicht der Code.
>
> **Vier neue Tasks aus diesen Funden:** `JR-4-16` (F44), `JR-4-17` (ADR-030), `JR-4-18`
> (Crash-Recovery-Scan — war gebaut, getestet, abgenommen und **von niemandem aufgerufen**),
> `JR-4-19` (Ledger-Verbindung erholt sich nach Startfehler nicht), `JR-4-20` (F46). E4 hat damit
> **20** Tasks, das Projekt 117.
>
> **Verfahren geändert (Entscheidung des Auftraggebers, Kostenprüfung):** die wiederkehrende
> Auftrags-Boilerplate steht jetzt in `.claude/agents/senior-dev.md` und `tester.md` statt in jedem
> Auftrag (~40 % jedes Prompts), das Berichtsformat ist eine feste Struktur, und **nach jedem Push
> wird der CI-Lauf geprüft**. Dabei zwei veraltete Rollenanweisungen korrigiert — `tester.md` behauptete
> „zero tests and no test runner", seit E1 falsch, und `senior-dev.md` verlangte `pnpm lint`, das auf
> diesem Host nicht grün werden kann.
>
> **Vereinbart, aber nicht begonnen: die Doku-Diät.** Die Pflichtlektüre (README + Status + Handover +
> Backlog + Skill) ist auf **689.000 Zeichen ≈ 170.000 Tokens** gewachsen; einzelne
> Sessionprotokollzeilen in `06-status.md` sind bis 8.531 Zeichen lang. Sie soll **nach der
> E4-Abnahme** auf unter 40.000 Tokens gebracht werden: Protokolle abgeschlossener Epics ins Archiv,
> Statuseinträge als Felder statt Prosa.

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

### Nächster konkreter Schritt — **E6, der Phase-B-Worker**

**E4 und E5 sind beide abgenommen und zurückgemergt.** `JR-4-13` ist am 2026-08-04 in einer
unabhängigen TEST-Sitzung durchgeführt worden (24 Kriterienzeilen mit Beleg, zwei Auflagen, beide
sofort erledigt, Protokoll **`16-abnahme-e4.md`**), der Rückmerge ist `9503bc8`. E5 war bereits über
`107346d` gemergt (`JR-5-09`) — beide Statusdateien hatten das nur nicht nachgetragen.

**Damit ist der Empfangspfad vollständig und der Parser steht.** Was fehlt, ist das Stück dazwischen:
**E6 — der Phase-B-Worker**, der eine gespoolte Nachricht aufnimmt, den Journal-Report parst und den
Archiveintrag erzeugt. Er ist der erste Verbraucher **beider** eben zusammengeführter Epics, und die
erste Stelle, an der ihr Zusammenspiel überhaupt ausgeführt wird — bisher existiert es nur als
Schnittstelle.

Der Prompt für die nächste Sitzung:

```
Weiter mit dem Journaling-Projekt. Lies docs/dev/journaling/07-session-handover.md
und arbeite den nächsten Schritt ab.
```

> **Vor der ersten E6-Scheibe: die Nummern reservieren.** Nach **ADR-032** legt ein neuer Epic-Zweig
> seine ADR- und Befundnummern **vorab auf dem Integrationsbranch** an. Das ist die Gegenmaßnahme zu
> genau der Kollision, die der E4-Rückmerge gekostet hat — drei Nummernkreise gleichzeitig, 98
> Referenzen in 15 Dateien. Ein Platzhalter-Commit kostet eine Minute.

> **Die Abnahme selbst ist erledigt und wird nicht wiederholt.** Der frühere Prompt „Nimm E4
> unabhängig ab" steht nur noch als Muster oben unter „Wie eine Session gestartet wird".

| Scheibe                  | Ergebnis                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| ~~`JR-4-10`~~            | CI `30862834098`: 7 von 20 Runden zogen den `250`-Zweig, alle 7 mit passender Ledger-Zeile                  |
| ~~`JR-4-11`, `JR-4-12`~~ | CI `30864243188`: `BDAT` byteidentisch zu `DATA`, `SIZE`-Grenzmatrix mit Alarm-Nachweis über beide Wege     |
| ~~`JR-4-14`~~            | CI `30900280611`: 25 adversariale Fälle, **TLS-1.1-Nachweis erbracht**, drei Defekte gefunden (F52/F53/F54) |
| ~~`JR-4-21`~~            | CI `30902593426`: Grenze an die Transportschicht verlegt; alle vier Größen einheitlich in 1–11 ms           |
| ~~`JR-4-15`~~            | CI `30905525089`: alle sechs Punkte beantwortet, zwei Befunde (F55/F56)                                     |
| ~~`JR-4-21a`~~           | CI `30914997638`: F50/F55/F56 behoben; Durchsatzverhältnis kurz/lang von ≈ 13,9× auf ≈ 1,48× gefallen       |
| ~~`JR-4-13`~~            | **Abnahme durchgeführt 2026-08-04, unabhängige TEST-Sitzung: E4 ABGENOMMEN.** Protokoll `16-abnahme-e4.md`  |

> **Zwei Dinge, die `JR-4-21` mitbringen muss, sonst ist der Fix nicht belegt:**
>
> 1. **Der F54-Testfall ist nicht deterministisch.** Er trifft ein Rennen nur manchmal — CI-Lauf
>    `30900280611` ist mit ihm **zufällig** grün durchgelaufen. Ein einzelner grüner Lauf belegt den
>    Fix deshalb **nicht**. Verlangt ist eine **Wiederholung** (mindestens zehn Läufe) mit
>    Vorher/Nachher-Rate gegen den ungefixten Stand.
> 2. **Die vier Größen müssen sich danach gleich verhalten**: ~2 000 Byte, 100 KB, ~200 KB, 2 MB.
>    Die **Stabilität** über alle vier ist der eigentliche Beweis, dass die Grenze jetzt an der
>    Transportschicht sitzt. Ein Ergebnis, das noch von der Chunk-Zerlegung abhängt, ist nicht
>    deterministisch geworden, sondern nur seltener falsch.
>
> **Danach zurück an TEST** (Nacharbeit an `JR-4-14`): F54 innerhalb des Tests ~10× wiederholen statt
> einmal, die Größenreihe vollständig abbilden, die `RED UNTIL JR-4-21`-Marker entfernen und bei F54
> den Zusatz „Vorschlag, noch nicht vom Auftraggeber bestätigt" streichen — **der PO hat ihn
> bestätigt**.

> **Zwei TEST-Scheiben nie parallel an zwei Bearbeiter.** `tests/support/suite-inventory.ts` trägt
> **exakte** Zahlen für Dateien und Tests. Zwei gleichzeitige Bearbeiter auf demselben Branch
> überschreiben sich dort zwangsläufig, und das Ergebnis ist ein Inventar, das zu keinem der beiden
> Stände passt. `JR-4-11` und `JR-4-12` sind deshalb als **ein** Auftrag vergeben.

> **Die Lehre aus `JR-4-10`, und sie gilt für jede weitere TEST-Scheibe:** die Suite war zweimal
> hintereinander **auf jeder Plattform** untauglich und meldete trotzdem grün — einmal ein zu früher
> Kill, einmal eine 945-Byte-Füllzeile, die jede Nachricht mit Null-Bytes auffüllte, sodass `DATA` nie
> abgeschlossen wurde. Beide Male lautete das Symptom „keine Antwort, dann Kill", und das ist von F48
> **nicht unterscheidbar**. Sichtbar wurden sie erst durch einen Zähler, der den **nicht gezogenen**
> Zweig ausweist („0 Versuche" vs. „N Versuche, alle gescheitert"). **Wo die Kernaussage einer Suite
> plattformabhängig ist, gehört diese Zählung dazu** — sonst ist „grün auf Windows" und „grün, weil
> nichts geprüft wurde" derselbe Text.

**Was `JR-4-13` an Material mitbekommt, das nicht im Backlog steht:**

- **Zwei Kriterien sind aus ihren Scheiben herausgewandert.** „Version und Cipher stehen **im
  Ledger-Eintrag**" (`JR-4-04`) ist nur zur Hälfte erfüllt gewesen — die Ledger-Seite prüft `JR-4-13`
  gegen `JR-4-06a`. Und „**TLS 1.1 wird abgelehnt**" war offen und ist an `JR-4-14` übergegangen —
  **dort erbracht** (2026-08-04): ein von Hand auf Byte-Ebene gebauter TLS-1.1-`ClientHello` nach
  echtem `STARTTLS` auf den rohen Socket, Antwort ein fataler `protocol_version`-Alert
  (`15 03 02 00 02 02 46`), nie ein `ServerHello`. **Mit einer Einschränkung, die die Abnahme kennen
  muss:** Senkt man `TLS_MIN_VERSION` testweise auf `'TLSv1.1'`, bleibt die Ablehnung bestehen, weil
  dieses OpenSSL (3.5.6) TLS 1.0/1.1 unterhalb der Node-Konfigurationsebene abschaltet. **Dass** TLS
  1.1 abgewiesen wird, ist bewiesen; **dass die Konfiguration die Ursache ist**, in dieser Umgebung
  nicht isolierbar. So auch im Dateikommentar vermerkt.
- **Sechs Befunde sind nach der jeweiligen Scheibe entstanden und alle behoben** — die Abnahme prüft
  also einen Stand, den keine der ursprünglichen Scheiben so getestet hat: **F52/F53/F54** (`JR-4-21`,
  Zeilenlängengrenze an der falschen Schicht), **F55/F56** (`JR-4-21a`, `RCPT`-Limit und
  Cipher-Filter), **F50** (`JR-4-21a`, Durchsatz). Die zugehörigen Regressionstests liegen in
  `smtp-protocol-robustness.adv.test.ts` (F54 mit **vier Größen à zehn Wiederholungen**) und den
  TLS-/Empfänger-Suiten.
- **Zwei Fixes waren zuerst wirkungslos oder schädlich, und beide Male hat es nur eine Prüfung
  gefangen, die man hätte weglassen können.** `JR-4-21`s erste Fassung zerschoss die Byte-Treue
  (`JR-4-07`), gefunden vom **Volllauf**. `JR-4-21a`s erste F56-Fassung setzte `ciphers` auf
  Socket-Ebene, was Node **ignoriert**, sobald ein `secureContext` übergeben wird — gefunden allein
  daran, dass der **Kalibrierungslauf grün blieb, obwohl er rot werden musste**. Wer diese Scheiben
  nachprüft, sollte beide Stellen als Erstes ansehen.
- **Vom PO ausdrücklich nicht nachgemessen** (steht auch im Statuseintrag zu `JR-4-05b`): die drei
  Wege, über die ein Catch-all doch konfigurierbar sein könnte, die Adressvergleichs-Entscheidung
  samt Sonderfällen und die bewusste `postmaster`-Abweichung von RFC 5321 §4.5.1.
- **Vom PO entschieden und nicht als Lücke zu werten:** „Object-Store nicht erreichbar ⇒ `250`" ist
  **strukturell** belegt (kein Codepfad) statt per Fehlerinjektion. Das ist der stärkere Nachweis — eine
  Injektion würde einen Ausfall simulieren, den es in diesem Prozess nicht geben kann.
- **Bewusst hingenommen:** pausiert ein Sender beim Shutdown exakt zwischen zwei `BDAT`-Chunks, läuft
  der Drain in den regulären Idle-Timeout statt sofort abzuschließen. Kein Datenverlust, nur langsamer.

> **~~Zuerst, vor jeder neuen Scheibe: `F49`~~ — erledigt am 2026-08-03.** Die Invariante **hält**
> (gerade `async`-Sequenz in `main()`: `await`-Scan vor `await server.listen()`); untauglich war nur
> das Instrument. Der Test hält den Scan jetzt **von außen** an — er nimmt selbst
> `pg_advisory_xact_lock(crashRecoveryScanLockKey(spoolRoot))` — und messt am **Port** statt am Log:
> ungewährter Waiter in `pg_locks` ⇒ `ECONNREFUSED`, nach Freigabe `220` auf demselben Port. Gegen
> eine nicht-`await`ete Scan-Variante kalibriert (`expected 'connected' to be 'refused'`). Kein
> Produktionscode geändert, Testzahl unverändert. Details in `09-befunde-bestandscode.md` unter F49,
> inklusive der einen bewusst offen gelassenen Kleinigkeit (`pino` und `console.log` schreiben
> weiterhin auf denselben Dateideskriptor — kein Test hängt mehr daran).

**Drei Dinge, die beim Weiterarbeiten zählen:**

1. **Der CI-Lauf ist Teil des Belegs, nicht Nachsorge** (F48). `fsyncDirectory()` scheitert auf diesem
   Windows-Host mit `EPERM`, und `accept()` schreibt den Ledger erst danach — **lokal erreicht kein Lauf
   den Append.** Ein Ergebnis ohne grünen CI-Lauf sagt über den Acceptance-Contract nichts. Nach jedem
   Push: `gh run list --branch <branch> --limit 1`, bei Rot `gh run view <id> --log-failed`.
2. **Die zwei Lint-Ausfälle heute hatten dieselbe Ursache** und werden wiederkommen: die
   Per-Datei-Prettier-Prüfung läuft über LF-normalisierte Kopien (F35-Umgehung), und wer zu viel
   normalisiert, verdeckt einen echten Verstoß. `scratchpad/lintfix.cjs` formatiert über die
   Prettier-API und **erhält die Zeilenenden** — das ist der verlässliche Weg.
3. **Das Nutzungslimit hat in diesem Epic sechs Runden getroffen**, zwei davon mit erheblicher
   uncommitteter Arbeit. Deshalb steht in der Rollendatei: **Inventar ziehen und committen, sobald die
   erste Testdatei steht.** Ein Zwischenstand mit gezogenem Inventar ist lauffähig und prüfbar; einer
   ohne ist wertlos, egal wie viel Code darin liegt.

> **`JR-4-09` ist erledigt (2026-08-03) — und eine Entscheidung daraus gilt weiter.** Der Helfer
> **holt** die Endpunktliste nicht: sie kommt als Datei oder über `stdin`, der Download ist ein
> dokumentierter `curl`-Schritt in der Betreiberdoku. Grund: der erste Entwurf benutzte `fetch` und
> wurde von `JR-4-07`s Wächter „kein ausgehender Aufruf im Empfängerquelltext" zu Recht rot gemeldet.
> Von drei Auswegen (Ausnahme im Wächter, eigenes Workspace-Paket, nicht holen) hat der Auftraggeber
> **„nicht holen"** gewählt — der Wächter bleibt unangetastet und der Mail-Host braucht keinen
> ausgehenden Internetzugang. **Wer diesen Wächter künftig rot sieht, weicht ihn nicht auf**, sondern
> legt die Alternativen vor.

> **`JR-4-19` ist erledigt (2026-08-03), und zwei Dinge daraus gelten weiter.** **(1)**
> `EsmtpServer` nimmt seit ADR-031 einen **Provider** statt eines Werts für `journalAcceptance`,
> aufgelöst **genau einmal je Transaktion** bei `MAIL FROM` und für deren Dauer festgehalten. Wer das
> anfasst, muss wissen: dieselbe Auflösung entscheidet, ob überhaupt eine `SpoolWriteBridge` geöffnet
> wird — ein Provider, der mitten in der Transaktion neu gelesen wird, führt zu einer Quittung ohne
> Spool-Datei oder zu einem hängenden Transfer (beides ist als Kalibrierung gemessen). **(2)** Der
> Retry-Timer endet beim **ersten** Erfolg; ein späterer Ausfall ist bereits durch `accept()` →
> `451` abgedeckt und braucht keine Wiederverdrahtung.

**Der Einstiegsprompt für die nächste Session:**

```
Weiter mit dem Journaling-Projekt. Lies docs/dev/journaling/07-session-handover.md
und arbeite E4 weiter ab — als Nächstes die TEST-Scheiben JR-4-10 bis JR-4-12.
```

> **Für die Abnahme `JR-4-13` eine eigene Sitzung starten**, mit dem Prompt: „Nimm E4 unabhängig ab —
> Rolle Tester, Kriterien aus `03-backlog.md`." Die Sitzung, die gebaut hat, kann nicht abnehmen; in E2
> hat der Auftraggeber genau darauf bestanden, und die erzwungene zweite Runde hat zwei echte Lücken und
> einen weiteren Befund gefunden.

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

**Stand 2026-08-03 — was wirklich offen ist, in dieser Reihenfolge:**

1. **`F43`: soll `JR-3-02`s Speichernachweis nachgemessen werden?** Das ist die einzige Frage, die
   ein **abgenommenes** Epic berührt. `heapUsed` kann Vollpufferung in Node-`Buffer`n nicht sehen —
   gemessen, mit absichtlich eingebauter Regression kalibriert. Der **Code** ist mit hoher
   Wahrscheinlichkeit korrekt (`writeDurableSpoolFile()` streamt), der **Nachweis** trägt nicht. Der
   Aufwand ist klein (dieselbe Kalibrierung einmal dort fahren), aber es ist Nacharbeit an E3 und
   damit eine Entscheidung, keine Aufgabe. **Blockiert E4 nicht.**
2. **`F39`** (niedrig, Testharness) und **`F42`** (niedrig, totes `tsconfig.build.json`) — beheben
   oder bewusst akzeptieren? Beide blockieren nichts. Sinnvoller Ort für F39 wäre die nächste Arbeit
   an `packages/journaling`, also E4 oder E5.
3. **`F17(b)`** — Rollen-Bootstrap reparieren? Unverändert eine Produktentscheidung, kein Teil von E4.

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
(`corepack pnpm`), `pnpm lint` ist auf diesem Host strukturell rot (F35) und darf **nicht** mit
`--write` „behoben" werden, ein Import kann eine Infrastruktur mitziehen, die es nicht gibt, und
`-t` ist ein Regex und kein Substring.

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
