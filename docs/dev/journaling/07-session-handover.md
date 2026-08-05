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

**Stand:** 2026-08-05 — **E6 läuft: `JR-6-01`, `JR-6-02a`, `JR-6-02b` erledigt** (Code fertig,
TEST-Abnahme offen; ADR-010, ADR-033, ADR-034 entschieden; F59 und F61 behoben, F62/F63 neu) ·
**Branch:** `claude/journaling-e6-phase-b-worker` (Epic-Zweig, eigener Upstream gesetzt) · Volllauf:
**1297 passed | 8 skipped** bei 106 Dateien — `unit ci 1102/1102 · integration ci 126/126 ·
adversarial ci 69/69`, Exit 0 · **CI `31054880932` success** (nach fünf vorangegangenen roten Läufen,
siehe F63)

> **Vor der ersten Scheibe sind nach ADR-032 die Nummernkreise reserviert worden** (`fc15edc`, auf dem
> **Integrationszweig**): **ADR-033–036** und **F59–F70**. `ADR-010` ist ausdrücklich **nicht** Teil
> der Reservierung — sie trägt ihre Nummer seit dem 2026-07-27 und wurde in `JR-6-02` gefüllt. **033**
> und **034** sind jetzt vergeben (Owner-Auflösung für die drei schwächeren Parse-Ergebnisse bzw. die
> Phase-B-Pipeline); **035–036** bleiben reserviert.

> **E4 und E5 sind abgenommen und zurückgemergt** — E4 mit `JR-4-13`/`9503bc8`, E5 mit `JR-5-09`/`107346d`,
> E3 mit `JR-3-08`/`185e9bd`. **Aus E4 ist kein Befund offen.**

### Der Stand in einem Satz

**Der Empfangspfad steht, der Parser steht, und Phase B hat jetzt einen Prozess, ein Tor und einen
vollständigen Verarbeitungspfad.** `apps/smtp-ingress` spricht ESMTP, prüft Quell- und
Empfänger-ACL, fährt beim Start den Crash-Recovery-Scan und antwortet auf `DATA`/`BDAT … LAST` mit
`250 … queued as <seq>` erst nach Spool-fsync **und** Ledger-Append. Seit `JR-6-01` gibt es den
`journal-inbound`-Worker als eigenen Prozess; seit `JR-6-02a` das **Tor**, das entscheidet, ob eine
Spool-Datei überhaupt archiviert werden darf; seit **`JR-6-02b`** die vollständige Pipeline
(`runPhaseBPipeline()`): parsen (E5) → Owner auflösen (ADR-033, jetzt mit Fan-out über jeden
aufgelösten Owner, nicht nur den Gewinner, ADR-034) → über den Port aus ADR-010 archivieren →
`IndexingService.indexEmailBatch()` → Spool-Datei löschen. **Manuell einmal gegen echtes
Postgres/Meilisearch/Dateisystem bewiesen**, ende-zu-Ende von der Spool-Datei bis zum durchsuchbaren
Treffer (siehe unten) — **kein automatisierter Test dafür**, aus zwei benannten Gründen (kein
Meilisearch-Service-Container in der CI; die neuen Backend-Adapter hängen am Prozess-Singleton `db`,
nicht an der isolierten Test-Harness-Datenbank). **Was fehlt:** `JR-6-03` (Idempotenz/`duplicate_of`)
und `JR-6-04` (Spool-Reconciler).

### Was diese Session gemacht hat

> **Eine Scheibe, acht Commits.** `cb1a524` (Code+Tests), `440c492` (Doku/ADR-034/F62), und sechs
> Nacharbeits-Commits — jeder aus einem roten CI-Lauf, keiner aus einem lokalen Fund:
> `0264405`/`9af1492`/`49a0bc1`/`41c407e`/`3d0fadb`/`c2987e9`. **F63** fasst die drei zugrunde
> liegenden Ursachen zusammen (fehlende `STORAGE_TYPE`/`ENCRYPTION_KEY` in der CI, eine unmigrierte
> Datenbank für den gespawnten Worker, eine offene `postgres-js`-Verbindung, die den Shutdown
> hängen ließ). Volllauf **1297 passed | 8 skipped** bei 106 Dateien, Exit 0 (vorher: 1276 passed |
> 8 skipped bei 104 Dateien), **CI `31054880932` success**.

**Was gebaut wurde, in der Reihenfolge der Architektur §6:**

1. **Fan-out über jeden aufgelösten Owner, nicht nur den Gewinner (ADR-034).** `resolveOwner()`
   liefert seit E5 einen Gewinner plus `additionalMatches` (JR-5-07 harte Vorgabe 4), aber niemand
   konsumierte die zusätzlichen Treffer. `OwnerResolutionWinner` (`packages/types`) hat jetzt
   `normalizedEmail`, berechnet in `winnerOf()` mit derselben Alias-zu-Primärdomain-Regel wie für den
   Gewinner — ein Resolver, eine Normalisierungsregel, für alle Treffer gleich. Die Pipeline
   dedupliziert auf die normalisierte Adresse, bevor sie archiviert.
2. **Der Backend-Adapter auf `processEmail()` (ADR-010 umgesetzt).**
   `journal-archive-object-adapter.ts` baut aus dem Gate-Verdikt und der aufgelösten Owner-Adresse ein
   `EmailObject` und ruft `IngestionService.processEmail(..., skipTempFileCleanup: true)` **unverändert**
   auf. Die Identität, die die Dedupe-Gates sehen, ist der **verifizierte `content_sha256`**
   (`<phase-b-sha256-<hex>@journal.internal>`), nie der echte `Message-Id`-Header (ADR-010 Punkt 1). Ein
   `null` von `processEmail()` (Duplikat) löst die **bereits existierende** `archived_emails`-Id auf, statt
   „nichts zu tun" zu bedeuten — sonst würde ein Retry nach einem Absturz zwischen Archivieren und
   Indexieren nichts mehr indexieren.
3. **Indexierung** über `IndexingService.indexEmailBatch()`, unbedingt für **jeden** Owner-Ausgang
   (`archived` **und** `duplicate`) — genau das schließt die Retry-Lücke aus Punkt 2.
4. **Spool-Freigabe ist Löschen** (`SpoolEntryReleaser.release()`, `fs.unlink`), kein drittes
   Spool-Verzeichnis neben `incoming/`/`quarantine/` — die Architektur dokumentiert keines, und die
   dauerhafte Aufzeichnung ist das archivierte Objekt plus die Ledger-Receipt, nicht die Spool-Kopie.
   Aufgerufen **ausschließlich** als letzter Schritt, nachdem jeder Owner archiviert/dedupliziert **und**
   indexiert wurde.
5. **`envelope_from`/`envelope_rcpt` erneut in den Ledger-Lookup gezogen.** `LedgerEntryByTxId`
   (`JR-3-05`) trug diese Felder nicht — der einzige bisherige Aufrufer (Crash-Recovery) brauchte sie
   nicht. `parseJournalReport()`s NDR-Erkennung braucht aber genau `envelope_from`s
   Null-Reverse-Path-Signal. Erweitert bis in `SpoolEntryArchive` durchgereicht, derselbe Fund wie
   `JR-6-02a`s Erweiterung um `eventType`/`content_sha256`/`size_bytes`.
6. **Der Prozessor wirft für jeden Nicht-Erfolg** — Gate-Ablehnung, unlesbare Spool-Datei, fehlende
   Owner-Konfiguration, Archivierungsfehler — nie eine Rückgabe eines Fehlerwerts. Das ist keine neue
   Entscheidung, sondern die Durchsetzung dessen, was `JR-6-01` für den Platzhalter schon festgelegt
   hatte.

**Manuell verifiziert, nicht automatisiert (ADR-034 Punkt 6):** ein Skript gegen echtes lokales
Postgres/Meilisearch/Dateisystem hat `basic-journal-report.eml` durch die komplette Pipeline
geschickt — Fan-out auf drei Owner (`bob`/`carol`/`dave@contoso.com`, alle drei
`primary-domain-match`), alle drei archiviert und indexiert, Volltextsuche nach `"Quarterly numbers"`
findet alle drei mit korrektem `subject`/`from`/`to`, die Spool-Datei war danach gelöscht. **Warum kein
committeter Test:** `.github/workflows/ci.yml` hat `postgres` und `valkey` als Service-Container, aber
**keinen** `meilisearch` — ein Test mit echter Suche könnte in der CI grundsätzlich nicht laufen. Und
die neuen Backend-Adapter (`journal-archive-object-adapter.ts`,
`journal-organization-domains-adapter.ts`) benutzen wie `IngestionService` das Prozess-Singleton `db`,
nicht die isolierte Test-Harness-Datenbank (`acquireTestDatabase()`) — beide Fragen (Meilisearch in
der CI, Dependency Injection der DB in den Backend-Services) sind Infrastrukturentscheidungen für den
Auftraggeber, nicht Nacharbeit dieser Scheibe.

**Ein neuer Befund: F62**, niedrige Schwere. `IJournalInboundJob`
(`packages/types/src/journaling.types.ts`) hat keinen einzigen Aufrufer im Repository und wird nicht
verwendet — ein Überbleibsel aus der Zeit vor `JR-6-01`s tatsächlicher Entscheidung
(`JournalInboundJobData`, ein Feld: `spoolTxId`). `02-architektur.md` §3 beschrieb ihn noch als
künftigen Payload; das ist jetzt korrigiert. Der Typ selbst ist nicht entfernt — das ist eine
eigenständige Aufräumarbeit außerhalb dieser Scheibe.

**Nicht verändert, weil außerhalb des Auftrags:** `JR-6-03` (Idempotenz-Ledgerzeile `duplicate_of`) und
`JR-6-04` (Spool-Reconciler). Das Tor kennt die Stelle für `duplicate_of` bereits
(`classifySpoolEntry()`s Verdikte), aber sie wird nicht gebaut, bevor `JR-6-03` sie beauftragt.

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

### Nächster konkreter Schritt — **`JR-6-03` (Idempotenz/`duplicate_of`), dann `JR-6-04` (Reconciler)**

Der Prompt für die nächste Sitzung:

```
Weiter mit dem Journaling-Projekt. Lies docs/dev/journaling/07-session-handover.md
und arbeite den nächsten Schritt ab.
```

**Der Zweig steht:** `claude/journaling-e6-phase-b-worker`, eigener Upstream, zuletzt `c2987e9`.
CI `31054880932` **success** — 106 Dateien, `unit 1102/1102 · integration 126/126 ·
adversarial 69/69`. Nicht neu abzweigen, nicht neu reservieren.

**Erledigt: `JR-6-01`, `JR-6-02a`, `JR-6-02b`.** `ADR-010`, `ADR-033`, `ADR-034` sind entschieden;
Gate, Pipeline und Backend-Adapter stehen; Ende-zu-Ende ist **manuell** bewiesen (siehe oben und
`05-entscheidungen.md` ADR-034 Punkt 6), aber nicht automatisiert. `JR-6-02` insgesamt ist damit
**code-fertig** — die formelle Abnahme (Rolle TEST/PO) steht noch aus.

> **F63, gelesen bevor der nächste Worker echten DB-/Storage-Zugriff bekommt (`JR-6-04`s
> Reconciler zum Beispiel):** fünf der sechs Nacharbeits-Commits dieser Scheibe waren CI-Iterationen,
> keine lokalen Funde — `packages/journaling`s eigenes `test:types` war lokal nie gelaufen (nur das
> von `packages/backend`), die CI setzte `STORAGE_TYPE`/`ENCRYPTION_KEY` nie (der Platzhalter-Worker
> hatte sie nie gebraucht), der gespawnte Worker griff auf die unmigrierte Wartungsdatenbank statt auf
> eine isolierte migrierte zu, und eine offene `postgres-js`-Verbindung ließ den Shutdown hängen. Alle
> drei Ursachen und die Lehre daraus stehen in **F63** (`09-befunde-bestandscode.md`).

**Was `JR-6-03` zu tun hat** (Backlog: „Idempotenz: Objekt-Dedupe auf `content_sha256`, aber jede
Receipt bleibt im Ledger, Duplikate mit `duplicate_of`"):

1. **Die Stelle existiert bereits, wird aber nicht benutzt.** `ArchiveObjectOutcome`'s `'duplicate'`-Fall
   (`packages/journaling/src/phase-b/archive-object-port.ts`) trägt `archivedEmailId` der
   **bereits existierenden** Zeile — genau der Ort, an dem `JR-6-03` einen `duplicate_of`-Ledger-Eintrag
   schreiben muss. `runPhaseBPipeline()` (`pipeline.ts`) sieht diesen Fall bereits (indexiert ihn
   unbedingt), schreibt aber **keine** Ledger-Zeile dafür — das ist absichtlich `JR-6-03`
   überlassen worden (siehe `JR-6-02a`s Handover-Eintrag, Punkt 3/4 der „vier Dinge").
2. **Der `duplicate_of`-Eintrag darf die `spool_txid` des Originals NICHT wiederverwenden** —
   `LedgerLookup.findBySpoolTxIds()` gibt eine Map zurück, eine zweite Zeile mit derselben `spool_txid`
   würde **stillschweigend kollabieren** (dieselbe Warnung wie in `JR-6-02a`s Handover-Eintrag,
   dort ausführlich begründet).
3. **Ein neuer Ledger-Append-Port wird gebraucht.** `runPhaseBPipeline()` bekommt heute keinen
   `LedgerBackend`/`append()`-Zugriff (bewusst: Phase B sollte nicht ungefragt in den Ledger schreiben
   können, bevor diese Entscheidung getroffen ist). `JR-6-03` muss entscheiden, ob dieser Port in die
   Pipeline injiziert wird (analog zu `archiveObject`/`indexBatch`) oder ob der `duplicate_of`-Eintrag
   an anderer Stelle geschrieben wird.
4. **Test:** dieselbe Nachricht zweimal zugestellt ⇒ ein Objekt, **zwei** Ledger-Einträge, zweiter mit
   gesetztem `duplicate_of` auf den Original-`seq`.

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

> **Zur Entscheidung beim Auftraggeber (neu in dieser Sitzung):**
>
> - **Soll ein automatisierter Ende-zu-Ende-Test gegen echtes Meilisearch gebaut werden?** Er würde
>   (a) einen `meilisearch`-Service-Container in `.github/workflows/ci.yml` brauchen (dieselbe Art
>   Entscheidung wie `JR-6-01`s `valkey`-Container) und (b) entweder eine Dependency-Injection-Änderung
>   an `IngestionService`/`StorageService`/`SearchService` (damit sie die isolierte
>   Test-Harness-Datenbank statt des Prozess-Singletons `db` nehmen können) oder eine bewusste
>   Ausnahme vom Isolations-Prinzip für genau diese Testklasse. Der manuelle Beleg (siehe oben) steht;
>   was fehlt, ist die Automatisierung. Details in `05-entscheidungen.md` ADR-034 Punkt 6.
> - **F62** (neu, niedrige Schwere): soll `IJournalInboundJob` aus `packages/types` entfernt werden?
>   Unbenutzt, aber ein exportierter Typ könnte theoretisch extern importiert sein. Blockiert nichts.
> - **F60** (unverändert): `StorageService.put()` puffert einen Stream. Vorgeschlagene Zuordnung E7.
>   Blockiert `JR-6-03`/`JR-6-04` nicht.
> - **F43**, **F39**, **F42**, **F17(b)** — unverändert, blockieren nichts.
> - **Die Doku-Diät**, weiterhin fällig: Pflichtlektüre unter 40 000 Tokens.

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
