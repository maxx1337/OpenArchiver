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

**Stand:** 2026-07-30 (**`JR-105c` ist erledigt** — E1 hat keine offene Nacharbeit mehr, F14/F15/F16/F24
behoben. Davor in derselben Session-Kette: **E13 abgenommen** mit `JR-1309c`, **Rückmerge** `89d701f`,
**`JR-1312`** `dca1f1a`) · **Branch:** `claude/enterprise-product-implementation-cxmmqe` ·
Arbeitsbaum **sauber** · Volllauf auf dem Integrationsbranch **274 passed | 2 skipped** bei 19 Dateien,
Exit 0, 0 `oa_test_*`-Rückstände

### Der Stand in einem Satz

**E1 und E13 sind beide fertig, und das Messinstrument trägt jetzt, was ab E2 daran hängt.** Der
Inventar-Wächter zählte Dateien; seit `JR-105c` zählt er **ausgeführte Tests je Suite und je Klasse**,
also belegt ein grüner Lauf endlich, dass die `integration`-Suite gelaufen ist. **Nächster Schritt ist
E2** — der SMTP-Receiver, das eigentliche Projekt.

> ### Was diese Session gemacht hat
>
> 1. **`JR-105c` erledigt** (`b5b2190`, Grundlagenarbeit direkt auf dem Integrationsbranch). Umfang war
>    F14, F15, F16 und F24 — alle vier behoben. Volles Protokoll in `06-status.md` unter „`JR-105c`
>    erledigt", Behebung je Befund in `09-befunde-bestandscode.md`, Verfahren im Testplan §2.2/§2.6.
>    Kurzform der Konstruktion: ein Reporter misst die **ausgeführten** Tests je (Suite, Klasse), der
>    `globalSetup`-Teardown urteilt und wirft; Dateizahl **und** Testzahlen sind **Gleichheiten**; ein
>    absichtlich verengter Lauf prüft nichts und sagt das; die CI verlangt, dass die Prüfung anwendbar
>    war. F16/F24 lösen ein **Ledger-Verzeichnis je Lauf**, in das der Worker jede geholte Datenbank
>    einträgt — der Hauptprozess meldet den Rest namentlich, droppt ihn und macht einen unverengten Lauf
>    davon rot.
> 2. **Jeder Angriff wurde zuerst am Elternstand `e09b981` wiederholt**, statt den grünen
>    Ausgangszustand aus dem Befundtext zu übernehmen. Beides bestätigt: die Umetikettierung aller acht
>    Integrationsdateien war dort **Exit 0** mit „verified" von **beiden** Wächtern, und
>    `pnpm test -t "idempotent"` hinterließ **6** Datenbanken. Danach: Exit 1 bei unveränderten `8/8`
>    Dateien, und 0 Rückstände. Das ist der Grund, `git stash` einmal zu benutzen — die Messung „vorher"
>    ist billiger als die Diskussion darüber, ob der Befund noch stimmt.
> 3. **`CLAUDE.md` §5.1 war falsch und ist berichtigt.** Sie behauptete „zero test files, no test runner,
>    no test script anywhere in this repo" und eine CI ohne Test-Job — seit E1 unwahr. Das ist die
>    gefährlichste Sorte veralteter Doku: eine Folge-Session hätte einen **zweiten** Harness gebaut. §4
>    hat jetzt die Testkommandos, und die Lint-Notiz („CI does NOT run this") ist ebenfalls korrigiert.
>    Über den Umfang von `JR-105c` hinaus, deshalb hier ausdrücklich genannt.
> 4. **Eine Lücke im Sessionprotokoll geschlossen:** die Sessions zwischen `JR-1317` und dem Rückmerge
>    hatten ihre `###`-Abschnitte in `06-status.md`, aber keine Zeile in der Protokolltabelle. Nachgetragen
>    als eine Sammelzeile, gekennzeichnet als Nachtrag des PO.
>
> **Nichts steht offen aus dieser Session.** Kein Auftrag ist abgebrochen, kein Ergebnis fehlt.

### Die Umgebung hat sich geändert — lies das, bevor du „Immer zuerst" abarbeitest

**Diese Session lief auf einem Windows-11-Host, nicht in einem Linux-Container.** Die Anleitung unter
„Immer zuerst" und alle früheren Sessionprotokolle (`/var/tmp`, `apt`, pgdg, `psql -f`) setzen Linux
voraus. Was hier tatsächlich gilt — jeder Punkt gemessen, nicht vermutet:

| Sache                    | Zustand auf diesem Host                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm`                   | **nicht im PATH.** `corepack pnpm …` benutzen — liefert das gepinnte 10.13.1. Node 24.14.0, npm 11.9.0                                                                                                                                                                                                                             |
| PostgreSQL               | **nicht installiert.** Kein Dienst, kein `psql`, kein Docker/Podman. Lösung unten                                                                                                                                                                                                                                                  |
| `psql.exe`               | **existiert auch im Wegwerf-Cluster nicht** — die Windows-Binärdistribution ist minimal. SQL über einen Node-`postgres`-Client fahren                                                                                                                                                                                              |
| WSL `Ubuntu-24.04`       | vorhanden, aber **nackt** (kein Node, kein Postgres) — **nicht** die Umgebung der Vorsessions                                                                                                                                                                                                                                      |
| Redis, Meilisearch, Tika | **seit 2026-07-31 über Docker Sandboxes fahrbar**, mit Auflagen — eigener Abschnitt unten. Valkey und Meilisearch vom Host aus belegt, Tika nur im Container                                                                                                                                                                       |
| Docker                   | **keine Docker Engine und kein Docker Desktop auf dem Host**, auch nicht in WSL. Installiert ist `Docker.sbx` (**Docker Sandboxes** 0.37.1, winget) — ein anderes Produkt, das Agenten sandboxt; die Engine steckt _innerhalb_ einer Sandbox. `sbx.exe` liegt unter `%LOCALAPPDATA%\DockerSandboxes\bin` und ist **nicht im PATH** |
| `git fetch/push`         | **braucht zwei Handgriffe.** `origin` ist `git@github.com:maxx1337/OpenArchiver.git` über SSH, `~/.ssh/id_rsa` ist **passphrase-geschützt**. Ohne geladenen Key endet ein nicht-interaktiver Aufruf mit `Could not read from remote repository`, ein interaktiver **hängt** an der Passphrase-Abfrage. Lösung siehe unten          |
| `pnpm lint`              | **strukturell rot: 388 Dateien** — `core.autocrlf=true` ohne `.gitattributes`, siehe **F35**. Das ist **kein** Formatierungsfehler im Repository. **Nicht** mit `prettier --write` „beheben" — das schriebe 388 Dateien um. Stattdessen `corepack pnpm exec prettier --check <eigene Dateien>`                                     |

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

### Infrastruktur über Docker Sandboxes (`sbx`) — was am 2026-07-31 gemessen wurde

Der Auftraggeber hat **Docker Sandboxes** installiert. Das ist **nicht** Docker Desktop: es gibt auf dem
Host weiterhin kein `docker`, und `sbx` ist ein Werkzeug, das Agenten in isolierte Umgebungen setzt. Die
Docker Engine steckt _innerhalb_ einer Sandbox — und darüber ist `docker-compose.yml` fahrbar.

```powershell
$sbx = "$env:LOCALAPPDATA\DockerSandboxes\bin\sbx.exe"   # nicht im PATH
& $sbx create shell --name oa-infra -m 4g "X:\NEW_DEVELOP.GIT\OpenArchiver"
# Der Workspace wird nach /x/NEW_DEVELOP.GIT/OpenArchiver gemountet (Laufwerksbuchstabe kleingeschrieben)
& $sbx exec oa-infra bash -lc "docker version; docker compose version"   # 29.6.1 / v5.2.0
```

Die Compose-Dienste haben **absichtlich keine Port-Mappings** (nur das interne Netz — der App-Container
spricht sie über den Namen an). Für Zugriff vom Host braucht es beides: ein Override **außerhalb** des
Repositorys und `sbx ports`.

```bash
# in der Sandbox, /tmp/oa-ports.yml -- NICHT im Repository anlegen
services: { postgres: { ports: ["5432:5432"] }, valkey: { ports: ["6379:6379"] },
            meilisearch: { ports: ["7700:7700"] }, tika: { ports: ["9998:9998"] } }
# Compose validiert die ganze Datei, auch wenn man nur einen Dienst startet:
export POSTGRES_DB=open_archive POSTGRES_USER=admin POSTGRES_PASSWORD=password \
       REDIS_PASSWORD=devpassword MEILI_MASTER_KEY=aSampleMasterKey STORAGE_LOCAL_ROOT_PATH=/data
docker compose -f docker-compose.yml -f /tmp/oa-ports.yml up -d postgres valkey meilisearch tika
```

```powershell
& $sbx ports oa-infra --publish 5432:5432   # -> 127.0.0.1:5432 und [::1]:5432
```

**Was damit belegt ist:** PostgreSQL **17.10** (Nutzer `admin`, **`CREATEDB` vorhanden** — der Harness
braucht das), Valkey antwortet auf `AUTH` + `PING`, Meilisearch liefert `/health` `200`. Tika läuft
(Jetty auf `0.0.0.0:9998` im Container), ist aber vom Host aus **nicht** erreichbar.

**Drei Auflagen, alle gemessen — wer sie nicht kennt, sucht den Fehler im Harness:**

1. **Die Sandbox stoppt im Leerlauf**, und dann hört nichts. Das sieht vom Host wie `ECONNREFUSED` aus.
   Container **und** Portfreigaben kommen beim nächsten Start von selbst zurück (`restart: unless-stopped`
   greift, und erneutes `--publish` antwortet mit `409 … already published`). Jedes `sbx exec` startet
   sie. Praktisch heißt das: **unmittelbar vor einem Testlauf ein `sbx exec … true` absetzen**, und
   Messungen nicht über eine längere Pause hinweg für gültig halten.
2. **Der Portforwarder überlebt die parallele Integrationslast nicht.** Ein Volllauf vom Host gegen das
   weitergeleitete Postgres endete mit **16 Fehlschlägen**, alle `read ECONNRESET` bzw.
   `write CONNECTION_CLOSED 127.0.0.1:5432` — acht Testdateien parallel, jede mit eigener Datenbank und
   41 Migrationen. Derselbe Commit ist gegen den **Embedded-Cluster** grün (`274 passed | 2 skipped`).
   Ein einzelner Connect durch den Forwarder ist dagegen schnell und stabil (4 ms).
3. **`sbx` erzwingt im Sandbox-Netz eine Default-Deny-Policy.** `curl http://tika:9998/version`
   _innerhalb_ der Sandbox antwortet `403 Blocked by network policy … no matching allow rule`. Das ist der
   Zweck des Produkts, kein Defekt. Für Tika braucht es eine Regel über `sbx policy allow` — nicht
   probiert.

**Empfehlung daraus:** **Postgres weiter aus dem Embedded-Cluster** fahren (grün, schnell, kein
Forwarder), und `sbx`-Docker für **Valkey, Meilisearch und Tika** ab E4/E6 nutzen — die brauchen wenige,
langlebige Verbindungen und nicht die Verbindungsrate des Harness. Die Alternative, **die ganze Suite
_in_ der Sandbox** zu fahren, umgeht den Forwarder vollständig, ist aber nicht geprüft und hat ein
sichtbares Problem: der Workspace ist ein Bind-Mount, und `node_modules` darin ist **für Windows**
gebaut. Das bräuchte `sbx create --clone` oder eine getrennte Installation.

> **Es liegt eine Sandbox `oa-infra-probe` auf dem Host** (4 GiB, vier laufende Container), angelegt für
> diese Messung. Sie ist nützlich, kostet aber Speicher. Entfernen:
> `& $sbx rm -f oa-infra-probe`. Die Sandbox `claude-Maxim` des Auftraggebers wurde nicht angefasst.

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

### Nächster konkreter Schritt — **E2**, und davor zwei Entscheidungen

**`ADR-007` ist am 2026-07-31 entschieden: eine Kette _je Mandant_.** Begründung, sieben Konsequenzen und
die verworfene Alternative stehen in `05-entscheidungen.md`; was das an E2s Tasks ändert, steht als
eigener Block im Backlog unter „Was `ADR-007` an diesem Epic ändert" (betrifft `JR-203`, `JR-204`,
`JR-206`, `JR-208`, `JR-209`).

**Offen ist noch, was vor der ersten Zeile Kettencode fallen muss** — beides ist später **nicht**
korrigierbar, weil es im Genesis-Hash jeder Kette steckt:

| Punkt                              | Frage                                                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`chain_scope_id`** (aus ADR-007) | `ingestion_sources.id` (**Empfehlung**, Begründung in ADR-007) oder `journaling_sources.id`?                                                                                                                       |
| **ADR-006**, Task **`JR-203`**     | Kodierung und Genesis-String fixieren — **inklusive `chain_scope_id` im Genesis** (Vorgabe aus ADR-007) — plus: woher kommt die `deployment_id`, und was passiert beim Klonen einer Installation aus einem Backup? |

Der Vorschlag zur Reihenfolge: **die Spaltenfrage klären, dann `JR-203`** (PO, reine Doku, ADR-006 auf
Status „entschieden"), dann die übrigen E2-Tasks aus `03-backlog.md`.

```
Arbeite JR-201 bis JR-20x aus docs/dev/journaling/03-backlog.md ab —
Rolle senior-dev, Branch claude/journaling-e2-ledger vom Integrationsbranch.
Vorher: ADR-006 und ADR-007 in 05-entscheidungen.md entscheiden.
```

**Was für E2 an dieser Umgebung gilt:** **Redis/Valkey, Meilisearch und Tika sind seit 2026-07-31
fahrbar** — über Docker Sandboxes, siehe den Abschnitt „Infrastruktur über Docker Sandboxes" oben. Drei
Auflagen dort gemessen, die vorher zu lesen sind; die wichtigste: **Postgres bleibt beim
Embedded-Cluster**, weil der Portforwarder der Sandbox die parallele Integrationslast nicht überlebt
(16 Fehlschläge mit `ECONNRESET`, derselbe Commit gegen den Embedded-Cluster grün).

**Was das Messinstrument jetzt hergibt, und was ab E2 daran hängt:** ein grüner Lauf belegt seit
`JR-105c`, dass **die deklarierten Tests je Suite und Klasse ausgeführt wurden** — nicht nur, dass die
Dateien existieren. Ab E2 ruhen die Aussagen über Durabilität und Hash-Kette genau darauf. Zwei
Konsequenzen für jede E2-Task:

- **Jede neue Testdatei ändert zwei Zahlen** in `tests/support/suite-inventory.ts` (`expectedFiles` und
  `expectedTests`), und zwar im **selben** Commit. Die Fehlermeldung nennt die einzutragende Zahl.
- **Ein Beleg aus einem `-t`-Lauf ist kein Beleg.** Ein verengter Lauf gibt „verified NOTHING" aus und
  prüft keine Zahl. Wer einen grünen Lauf zitiert, zitiert die Testzahl mit: vollständig ist heute
  **274 passed | 2 skipped** bei 19 Dateien.

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

**`ADR-007` ist entschieden** (2026-07-31, Auftraggeber: eine Kette je Mandant). **Offen und blockierend
bleiben zwei Punkte**, beide vor der ersten Zeile Kettencode und beide später nicht korrigierbar: welche
Spalte `chain_scope_id` ist (`ingestion_sources.id` empfohlen), und **ADR-006** — Kodierung plus
Genesis-String, jetzt mit `chain_scope_id` darin, plus Herkunft der `deployment_id` und das Verhalten beim
Klonen einer Installation. Alles andere ist Arbeit ohne Entscheidungsbedarf.

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
