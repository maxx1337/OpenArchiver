# Testplan

Ausgangslage **bei Abfassung dieses Dokuments (2026-07-27)**: das Repository hatte null Tests und keinen
Test-Runner — kein vitest, jest oder playwright, kein `test`-Script, kein Test-Job in der CI;
`CONTRIBUTING.md` verlangte Tests rein aspirativ. **E1 hat die Infrastruktur gebaut und ist abgenommen**
(`JR-106a`, 2026-07-28; Messinstrument-Nacharbeit `JR-105c` am 2026-07-30). Was in §2 steht, beschreibt
also den **Ist-Zustand**; ab §3 definiert dieses Dokument, was noch zu prüfen ist.

RFC §12 ist der Maßstab: _„Vollständigkeitsaussagen brauchen adversariale Tests, keine
Happy-Path-Tests."_

---

## 1. Grundregeln

1. **Aus Client-Sicht auswerten.** Bei Durability-Tests zählt, was der sendende Client als
   Statuscode gesehen hat — nicht, was der Server zu tun glaubte. Die Client-Sicht ist der Vertrag.
2. **Kein Test ohne Aussage.** „Wirft keine Exception" prüft nichts. Geprüft wird der beobachtbare
   Vertrag: der Statuscode, die existierende Ledger-Zeile, die Bytes auf der Platte.
3. **Determinismus durch Seeds.** Jede Randomisierung wird geseedet und der Seed geloggt. Ein
   flakiger adversarialer Test ist wertlos, weil seinen Fehlschlägen niemand glaubt. Der Seed muss
   eine exakte Wiederholung erlauben.
4. **Isolation.** Integrationstests bekommen eigenen Postgres-Namensraum und eigenes
   Spool-Verzeichnis. Nie von einem sauberen gemeinsamen Zustand ausgehen. Konkret ist es eine eigene
   **Datenbank** je Aufruf, nicht ein Schema — warum, steht in §2.6.
5. **Echte Infrastruktur bei Durability.** Ein gemockter `fsync` beweist nichts. Fault Injection
   läuft über eine schmale, explizit injizierte Dateisystem-Schnittstelle — kein Monkey-Patching
   globaler `fs`-Funktionen.
6. **Keine stillen Kürzungen.** Wird Abdeckung begrenzt (Stichprobe, übersprungene Plattform,
   reduzierte Iterationszahl), muss die Testausgabe das sagen. Stille Reduktion liest sich wie
   „abgedeckt", war es aber nicht.
7. **Fixtures enthalten keine echten personenbezogenen Daten.**

## 2. Konventionen

> Umgesetzt in JR-101/JR-102 (2026-07-27). Die Tabelle unten ist nicht mehr Entwurf, sondern
> beschreibt den Ist-Zustand; jede Zeile hat ein lauffähiges Beispiel im Repository.

### 2.1 Orte und Namen

| Art                        | Ort                                                     | Namensschema          | Beispiel                                                               |
| -------------------------- | ------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| Unit                       | neben dem Code                                          | `<name>.test.ts`      | `packages/backend/src/iam-policy/policy-validator.test.ts`             |
| Integration                | `tests/integration/` im jeweiligen Paket                | `<thema>.int.test.ts` | `packages/backend/tests/integration/postgres-availability.int.test.ts` |
| Adversarial / Durability   | `tests/adversarial/` im jeweiligen Paket                | `<thema>.adv.test.ts` | `packages/backend/tests/adversarial/mongo-to-drizzle.adv.test.ts`      |
| Fixtures                   | `tests/fixtures/` im jeweiligen Paket                   | sprechende Dateinamen | `packages/backend/tests/fixtures/mongo-to-drizzle-golden.json`         |
| Harness, paketübergreifend | `tests/support/` in der Repo-Wurzel, Alias `@oa-test/*` | `<thema>.ts`          | `tests/support/classification.ts`                                      |
| Harness, paketspezifisch   | `tests/support/` im jeweiligen Paket                    | `<thema>.ts`          | `packages/backend/tests/support/render-sql.ts`                         |

**Diese Namensschemata sind ab `JR-105b` erzwungen, nicht empfohlen.** Die Include-Globs der drei
Projects stehen in `tests/support/suite-inventory.ts`; `vitest.config.ts` importiert sie von dort, es
gibt sie also nur einmal. Derselbe Modul prüft in `globalSetup` — vor dem ersten Test, in **jedem**
Lauf und in jeder Umgebung — zwei positive Erwartungen:

1. **Jede Suite trifft genau `expectedFiles` Dateien.** Null Dateien ist ein Fehlschlag. Eine
   umbenannte oder gelöschte Suite macht damit rot, statt als „grün, weil nichts zu tun" zu gelten.
   Bis `JR-105c` war das eine **Untergrenze**; siehe unten, warum die Gleichheit gebraucht wird.
2. **Keine testartig benannte Datei ohne Project.** Alles, was `*.test.ts` / `*.spec.ts` (und die
   `.js`/`.mjs`/`.tsx`-Varianten) heißt und von keinem Include-Glob getroffen wird, bricht den Lauf
   mit Pfadangabe ab. Eine Datei `foo.test.ts` unter `tests/integration/` läuft also nicht bloß nicht
   — sie fällt auf.

Die Zahlen werden auf **jedem** Lauf gemeldet, auch auf einem grünen:
`[TEST-INVENTORY] unit: 10 file(s) (expected 10) · integration: 8 file(s) (expected 8) · adversarial: 1 file(s) (expected 1) · unclassified: 0`.
Wer eine Suite absichtlich verkleinert, ändert `expectedFiles` im selben Commit — sichtbar im Diff,
statt unbemerkt.

**Diese beiden Erwartungen sehen den Filesystem-Zustand, und genau darin liegt ihre Grenze.** Drei
Wege, Abdeckung zu entfernen, lassen das Filesystem unverändert und waren deshalb grün (**F14**,
**F15**): eine Suite von `ci` auf `nightly` umetikettieren, eine Datei mit ausschließlich `it.skip`
füllen, eine Datei löschen und gleichzeitig eine andere hinzufügen. Der erste Weg war der schlimmste —
ein Token je Datei schaltet die ganze `integration`-Suite ab, und **beide** Wächter melden „verified"
(am 2026-07-30 am Elternstand nachgemessen: Exit 0).

**Ab `JR-105c` gibt es deshalb eine dritte Erwartung, nach dem Lauf** (`tests/support/executed-tests.ts`):

3. **Je Suite und je Klasse müssen genau `expectedTests[klasse]` Tests _ausgeführt_ worden sein.**
   Ausgeführt heißt `passed` oder `failed`; `skipped` und `todo` zählen nicht. Eine nicht gewählte
   Klasse muss 0 beitragen. Gemeldet auf jedem Lauf als
   `[TEST-EXECUTED] unit: ci 216/216 … · selection: ci`.

Warum **Gleichheit** und nicht Untergrenze: eine Untergrenze ist Spiel, und eine Löschung in Höhe des
Spiels geht lautlos durch — das ist F15. Der Preis ist eine Zahl je Commit, der die Testzahl ändert;
die Fehlermeldung nennt die einzutragende Zahl. Warum **je Klasse**: eine Umetikettierung lässt die
Gesamtzahl unverändert und verschiebt die Tests nur in eine Klasse, die die Standardauswahl nicht
fährt. Dieselbe Tabelle trägt damit auch `pnpm test:nightly`, ohne eine zweite zu brauchen.

**Mechanik, weil sie nicht offensichtlich ist.** Zählen kann erst nach dem Lauf passieren, und vitest
hat dort keinen Assertions-Haken. Ein Reporter misst und schreibt die Messung, der
`globalSetup`-Teardown liest sie und wirft. Reihenfolge in 3.2.7 gemessen: `globalSetup` → Tests →
`onTestRunEnd` → Zusammenfassung → `onFinished` → Teardown; ein werfender Teardown endet mit Exit 1.
Die Messdatei wird **vor** dem Lauf gelöscht und **nach** dem Lauf verlangt — wer den Reporter aus
`vitest.config.ts` entfernt, macht den Lauf rot, statt den Wächter abzuschalten.

**Ein absichtlich verengter Lauf prüft nichts und sagt das.** `-t`, ein Dateifilter, `--project`,
`--shard`: die Zahlen sind dann nicht vergleichbar. Der Lauf bleibt grün und gibt einen
Coverage-Hinweis aus („verified NOTHING"), denn ein Wächter, der `pnpm test -t` rot macht, ist ein
Wächter, den man abzuschalten lernt. `assert-inventory-report.mjs` verlangt in der CI, dass die
Prüfung **anwendbar** war — dort ist das Zugeständnis also keins. Die CI liest zudem das **Urteil**
aus der Messdatei, statt es nachzurechnen: zwei Implementierungen einer Regel laufen auseinander
(**F29**).

Zwei Abweichungen vom ersten Entwurf, beide bewusst:

- **`tests/support/`** war nicht vorgesehen. Ohne einen gemeinsamen Ort für Klassifizierung, Seeds,
  Infrastruktur-Probes und Coverage-Hinweise wird jede dieser Regeln pro Testdatei neu und
  unterschiedlich erfunden. Paketübergreifendes liegt in der Wurzel (importierbar als
  `@oa-test/…`), paketspezifisches im Paket — Wurzel-Helfer dürfen keine Paket-Dependencies
  auflösen (pnpm ist strikt), `drizzle-orm`-nahe Helfer müssen deshalb im Backend liegen.
- **Bereits vorhandene Fixtures bleiben, wo sie sind.** `packages/backend/src/iam-policy/test-policies/*.json`
  wandern **nicht** nach `tests/fixtures/`. Sie sind Repo-Bestand; ein Verschieben wäre eine
  Änderung im Produktionsbaum aus kosmetischem Grund. Die Regel gilt für **neue** Fixtures.

### 2.2 Zwei Suites, und warum das keine Geschmacksfrage ist

`packages/backend/src/database/index.ts` wirft **beim Import**, wenn `DATABASE_URL` fehlt. Jede
Testdatei, die transitiv `../database` importiert, lässt sich in einer Umgebung ohne Konfiguration
nicht einmal einsammeln. Daraus folgt die Trennung in vitest-**Projects** (= Suites):

| Project       | Include-Glob                                                        | Braucht Infrastruktur                                |
| ------------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| `unit`        | `packages/*/src/**/*.test.ts`, `packages/*/tests/unit/**/*.test.ts` | nein — importiert nichts, was an `../database` hängt |
| `integration` | `packages/*/tests/integration/**/*.int.test.ts`                     | Postgres                                             |
| `adversarial` | `packages/*/tests/adversarial/**/*.adv.test.ts`                     | fallweise, je Test deklariert                        |

Konfiguration: **eine** Datei, `vitest.config.ts` in der Wurzel, mit `test.projects`. Kein
Config-File pro Paket — die Suite-Trennung ist global, und pro Paket eigene Projects zu definieren
würde eindeutige Projektnamen je Paket erzwingen und die DB-Gate-Logik vervielfachen. Die
Include-Globs zeigen auf `packages/*`, ein Paket mit neuen Tests (`packages/types`, später
`packages/journaling`) wird also ohne Config-Änderung gefunden.

Kommandos:

| Kommando                                          | Wirkung                      |
| ------------------------------------------------- | ---------------------------- |
| `pnpm test`                                       | alle Projects, Klasse `ci`   |
| `pnpm test:unit`                                  | nur `unit`                   |
| `pnpm test:integration`                           | nur `integration`            |
| `pnpm test:adversarial`                           | nur `adversarial`            |
| `pnpm test:nightly`                               | `OA_TEST_CLASSES=ci,nightly` |
| `pnpm test:manual`                                | `OA_TEST_CLASSES=manual`     |
| `pnpm --filter @open-archiver/backend test`       | nur die Tests dieses Pakets  |
| `pnpm --filter @open-archiver/backend test:types` | `tsc` über die Testdateien   |

Testdateien sind aus `packages/backend/tsconfig.json` **ausgeschlossen** — sie dürfen nicht nach
`dist` gelangen. Typgeprüft werden sie über `packages/backend/tsconfig.test.json` (`noEmit`,
`module: esnext`, `moduleResolution: bundler` — so wie vitest sie ausführt).

### 2.3 Klassifizierung

**Jeder Test wird klassifiziert** — `ci`, `nightly` oder `manual`. Die Klassifizierung steht im Test
selbst und im berichteten Suite-Namen, nicht nur in diesem Dokument. Umgesetzt durch
`suite(klasse, name, fn)` aus `@oa-test/classification`; der Suite-Name wird mit `[ci]` /
`[nightly]` / `[manual]` präfigiert.

| Klasse    | Läuft                          | Zeitbudget           |
| --------- | ------------------------------ | -------------------- |
| `ci`      | jeder Pull Request und Push    | Gesamtsuite < 10 Min |
| `nightly` | einmal täglich                 | unbegrenzt           |
| `manual`  | auf Anforderung, mit Protokoll | —                    |

Auswahl über `OA_TEST_CLASSES` (Kommaliste oder `all`), Default `ci`. Ein nicht ausgewählter Test
wird als **skipped** berichtet, mit dem Grund im Suite-Namen, plus Coverage-Hinweis in der Ausgabe.
Ein Tippfehler in `OA_TEST_CLASSES` bricht den Lauf ab, statt stillschweigend nichts zu laufen.

`suiteRequiring(klasse, name, probe, fn)` ergänzt das um Infrastruktur: ist die Probe negativ, wird
mit dem Grund der Probe übersprungen — „`DATABASE_URL` is not set" liest sich anders als „skipped".

**`OA_TEST_REQUIRE_INFRA=1` dreht das um** (`JR-105b`). In einer Umgebung, die die Infrastruktur
selbst bereitstellt — die CI mit ihrem Postgres-Service-Container — ist ein Skip wegen fehlender
Infrastruktur kein legitimer Skip, sondern ein defekter Job, der grün meldet. Mit gesetzter Variable
erzeugt `suiteRequiring` in diesem Fall einen **fehlschlagenden** Test mit dem Grund der Probe. Die
Klassenauswahl bleibt unberührt: `nightly` und `manual` dürfen in einem `ci`-Lauf weiter überspringen.
Ein Wert außerhalb von `1`/`true`/`0`/`false` bricht ab — beim Import geprüft, nicht erst dann, wenn
zufällig eine Probe negativ ausfällt. Der CI-Job setzt die Variable; sie ersetzt die frühere
Log-Suche nach dem **Fehlen** eines Skip-Hinweises, die eine _abwesende_ Suite nicht erkannte.

### 2.4 Seeds

`resolveSeed(name)` und `seededRng(seed)` aus `@oa-test/seed`. Der Seed kommt aus `OA_TEST_SEED`
oder wird gezogen; in **beiden** Fällen wird er ausgegeben, zusammen mit dem Replay-Kommando. Jede
Assertion in einem randomisierten Test hängt `rng.context({ iteration })` an ihre Meldung, damit ein
Fehlschlag exakt wiederholbar ist. `Math.random()` kommt im Generatorpfad nicht vor.

### 2.5 Sichtbare Coverage-Hinweise

`coverageNotice(text)` und `announceSampling(...)` aus `@oa-test/notice` schreiben nach stderr
(`[TEST-COVERAGE NOTICE] …`), überleben also jeden Reporter. Pflicht bei: übersprungener Klasse,
fehlender Infrastruktur, Stichprobe statt Vollauf, übersprungener Plattform. Grundregel 6 ist damit
maschinell umgesetzt und nicht nur Absicht.

### 2.6 Die Postgres-Basis der `integration`-Suite

> Umgesetzt in JR-104 (2026-07-28): `packages/backend/tests/support/pg-harness.ts`.

`acquireTestDatabase(label)` legt **eine eigene Datenbank je Aufruf** an, wendet die Migrationen des
Repositorys darauf an und gibt einen postgres-js-Client plus ein Drizzle-Handle zurück.
`release()` schließt die Verbindungen und löscht die Datenbank; die Registrierung als `afterAll`
läuft auch dann, wenn ein Test geworfen hat.

**Eigene Datenbank, nicht eigenes Schema — und das ist keine Wahl.** `search_path`-Isolation wäre
billiger und bräuchte kein `CREATEDB`. Sie funktioniert gegen **diese** Migrationen nicht, weil
drizzle-kit Enums und Fremdschlüsselziele schema-qualifiziert ausgibt, `CREATE TABLE` aber nicht:

```
migrations/0000_amusing_namora.sql:1    CREATE TYPE "public"."retention_action" AS ENUM(...)
migrations/0000_amusing_namora.sql:120  ... REFERENCES "public"."custodians"("id") ...
```

Unter `search_path = oa_test_x` entstünden die Tabellen in `oa_test_x`, die Fremdschlüssel zeigten
auf `public.custodians`, und ein zweiter paralleler Lauf kollidierte auf `CREATE TYPE "public"…`,
weil `CREATE TYPE` mit explizitem Schema `search_path` ignoriert. Migrationen dafür zu ändern ist
ausgeschlossen (CLAUDE.md 5.2). In einer frischen Datenbank ist `"public"` dagegen deren eigenes
`public`, und das Problem verschwindet.

| Env-Variable                | Default    | Zweck                                                                                                                                                                           |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | —          | Server **und** Zugangsdaten. Ohne sie überspringt die Suite sichtbar                                                                                                            |
| `OA_TEST_PG_MAINTENANCE_DB` | `postgres` | Datenbank für `CREATE`/`DROP DATABASE`                                                                                                                                          |
| `OA_TEST_PG_STALE_MS`       | `7200000`  | Ab welchem Alter ein `oa_test_*`-Rest als verwaist gilt und gelöscht wird                                                                                                       |
| `OA_TEST_REQUIRE_INFRA`     | `0`        | `1` ⇒ fehlende Infrastruktur **schlägt fehl**, statt sichtbar zu skippen                                                                                                        |
| `OA_TEST_INVENTORY_REPORT`  | —          | Pfad, unter dem `globalSetup` die Suite-Inventur als JSON ablegt                                                                                                                |
| `OA_TEST_EXECUTED_REPORT`   | —          | Pfad für Messung **und Urteil** der ausgeführten Tests (`JR-105c`). Ohne ihn `node_modules/.cache/oa-test/executed-tests.json`                                                  |
| `OA_TEST_HARNESS_LEDGER`    | —          | Wird von `globalSetup` je Lauf gesetzt. Verzeichnis, in dem der Harness seine geholten Datenbanken einträgt. **Nicht von Hand setzen**, außer man fährt den Harness ohne vitest |

**Rechteanforderung (relevant für ADR-009).** Die Rolle in `DATABASE_URL` braucht `CREATEDB` sowie
das Recht, in der neuen Datenbank DDL auszuführen. Das ist die **Bootstrap**-Rolle der Tests, nicht
die Anwendungsrolle: sobald `JR-205` Append-Only über Rechteentzug erzwingt, muss der Test die
eingeschränkte Anwendungsrolle **zusätzlich** anlegen und sich für die Append-Only-Prüfungen mit ihr
verbinden. Eine einzige allmächtige Rolle für beides würde `JR-205` unprüfbar machen.

**`DATABASE_URL` und der Import-Throw.** `src/database/index.ts` baut sein `db`-Singleton **beim
Import** und wirft ohne `DATABASE_URL`. Wer `FilterBuilder` oder `mongoToMeli` testet, muss daher in
dieser Reihenfolge arbeiten: Harness holen → `harness.bindAsProcessDatabaseUrl()` →
`await import(...)`. `bindAsProcessDatabaseUrl()` verweigert den Dienst, wenn das Singleton schon
existiert — der Fehler wird laut, statt still gegen die falsche Datenbank zu testen. Damit diese
`process.env`-Mutation nicht in eine andere Testdatei ausläuft, ist das Project `integration` auf
`pool: 'forks'` und `isolate: true` festgelegt; `fileParallelism` bleibt an, weil paralleles Laufen
gerade der Fall ist, den die Isolation aushalten muss.

**Rückstände.** Ein hart abgeschossener Worker (`SIGKILL`) führt kein Teardown aus.
`sweepStaleHarnessDatabases()` löscht solche Reste beim nächsten `acquire`, aber nur wenn sie
(a) nicht vom eigenen Prozess stammen, (b) keine offenen Verbindungen haben und (c) älter als
`OA_TEST_PG_STALE_MS` sind. Jede Löschung wird als Coverage-Hinweis ausgegeben — ein verschwindender
Rest darf nicht lautlos verschwinden, sonst verbirgt er, dass ein Lauf gestorben ist. `(c)` ist die
einzige Absicherung gegen einen **fremden** laufenden Prozess: `OA_TEST_PG_STALE_MS` unter die
längste Suite-Laufzeit zu setzen kann dessen Datenbank löschen (beim Verifizieren mit 1000 ms
beobachtet, und in **F12** noch einmal unfreiwillig). Default nicht absenken.

**Seit `JR-104a` ist das strukturell abgesichert, nicht nur eine Bitte.** `sweepStaleHarnessDatabases()`
nimmt `{ staleMs?, restrictTo? }`; `restrictTo` filtert im SQL, ein gesenkter `staleMs` **ohne**
`restrictTo` wirft. Wer eine kurze Frist braucht, muss also benennen, welche Datenbanken er meint —
fremde sind damit nicht „verschont", sondern unerreichbar. Fixture-Namen für die Sweeper-Tests kommen
aus `buildForeignFixtureName()`: fremdes PID-Feld (sonst greift der Eigen-PID-Wächter und der Test
prüft nichts), Eindeutigkeit über `process.pid` + Zufallsbytes im Tag.

**Seit `JR-105c` besitzt der Hauptprozess den Rückstand dieses Laufs — er rät ihn nicht.** Der Sweeper
oben räumt Reste **fremder, toter** Läufe auf; er sagt aber nichts über den eigenen. Und der eigene
entstand regelmäßig: `acquireTestDatabase()` läuft im **Modul-Scope** (es muss, siehe Import-Throw
oben), das Teardown hängt an `afterAll`. Wirft der Modul-Scope danach, läuft das `afterAll` nie
(**F16**); überspringt ein `-t`-Filter alle Fälle der Datei, ebenso (**F24**). Die versprochene
Sichtbarkeit gab es in beiden Fällen nicht: die `process.on('exit')`-Warnung feuert im geforkten
Worker, dessen Ausgabe nicht in der Zusammenfassung landet.

Jetzt schreibt der Worker jede geholte Datenbank in ein **Ledger-Verzeichnis** dieses Laufs
(`OA_TEST_HARNESS_LEDGER`, von `globalSetup` gesetzt, im Worker über die geerbte Umgebung erreichbar)
und löscht den Eintrag erst, wenn der Drop tatsächlich stattgefunden hat. Der Teardown liest, was übrig
ist: das ist **genau** der Rückstand dieses Laufs — kein Zeitstempel, keine Heuristik, und keine
Möglichkeit, die lebende Datenbank eines **fremden** Laufs dafür zu halten (das war F12). Er meldet ihn
mit Namen, Label und Worker-PID, **droppt** ihn, und macht den Lauf **rot, wenn der Lauf nicht verengt
war** — sonst würde das Aufräumen die Zusicherung des CI-Schritts „Assert no leftover test databases"
kassieren. Ein gefilterter Lauf meldet und räumt nur. `acquireTestDatabase()` verweigert den Dienst,
wenn kein Ledger-Verzeichnis gesetzt ist, **bevor** es etwas anlegt.

**Verbleibende Lücke — `F13`, für E2/E3 relevant.** Der unbeschränkte Sweep aus `acquireTestDatabase()`
läuft weiter mit der Standardfrist. Ein fremder Lauf, der **länger als die Frist** dauert, ist für ihn
nicht von echtem Rückstand zu unterscheiden. Regel bis zur Behebung: **jeder Lauf, der länger als 2 h
dauern kann — jeder Soak in E2/E3 — hebt `OA_TEST_PG_STALE_MS` über seine erwartete Laufzeit.** Die CI
ist unberührt, ein Job hat seinen eigenen Service-Container.

## 3. RFC §12 → konkrete Testfälle

### §12.1 Kill während DATA — `JR-410`

**Klasse:** `nightly` (500 Iterationen) + `ci`-Smoke mit 20 Iterationen.

`SIGKILL` an randomisierten Punkten während einer 50-MB-Übertragung. Der Testtreiber ist ein
separater Prozess, der (a) den Statuscode aufzeichnet, den er tatsächlich gelesen hat, und (b) nach
dem Neustart Spool und Ledger inspiziert.

**Assertion (die zentrale Invariante):** für jede Transaktion gilt _entweder_ der Client hat kein
`250` gesehen, _oder_ die Nachricht liegt vollständig im Spool und ist korrekt verkettet. Niemals
teilweise.

**Technik:** Kill-Punkt als Byte-Offset aus dem Seed ableiten; Prozess über Prozess-Signal beenden,
nicht über einen In-Process-Hook (ein Hook, der aufräumt, testet den Kill nicht).

### §12.2 fsync-Fault-Injection — `JR-306`

**Klasse:** `ci`.

Drei getrennte Fälle: Write scheitert, Datei-`fsync` scheitert, Verzeichnis-`fsync` scheitert.

**Assertion:** jeweils Fehlersignal für `451`, **nichts** quittiert, kein halber Spool-Eintrag, und
nach dem Fall ein sauberer Zustand.

**Technik:** die injizierbare Dateisystem-Schnittstelle aus `JR-303`. Der Verzeichnis-fsync-Fall ist
der leicht zu vergessene — er muss explizit dabei sein.

### §12.3 Disk full — `JR-307`

**Klasse:** `nightly` (braucht ein eigenes Volume).

Spool auf einem größenbegrenzten Volume (tmpfs mit `size=` oder Loop-Device), Nachricht überschreitet
die Kapazität.

**Assertion:** Signal für `452`, keine Teil-Einträge, Erholung nach Freigabe von Platz.

**Fallback für `ci`:** derselbe Pfad über die injizierbare Schnittstelle mit `ENOSPC` — als
Ergänzung, nicht als Ersatz. Beide Varianten benennen.

### §12.4 Object-Store-Ausfall — `JR-606`

**Klasse:** `ci` (MinIO gestoppt) .

**Assertion:** Nachrichten werden weiterhin mit `250` quittiert, der Backlog läuft nach Erholung
vollständig ab, die Kette ist unberührt.

Dies ist der Test, der belegt, dass Phase B den Acceptance-Contract nicht berührt.

### §12.5 Ledger-Tamper-Tests — `JR-209`, `JR-805`, `JR-907`

**Klasse:** `ci`.

| Fall | Manipulation                                    | Erwartung                                                                                        |
| ---- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| a    | gespeichertes Objekt verändern                  | Hash-Mismatch beim **korrekten** `seq`                                                           |
| b    | Ledger-Zeile löschen                            | Kettenbruch beim **korrekten** `seq`                                                             |
| c    | Kette ab `seq` N vorwärts neu schreiben         | Divergenz gegen den **ersten Anker nach N**                                                      |
| d    | Kette eines Mandanten **vollständig** entfernen | Befund beim Vergleich zweier aufeinanderfolgender Anker — die Kette fehlt im zweiten Merkle-Baum |
| e    | Inklusionspfad eines Ankers verändern           | Wurzel stimmt nicht mehr, Token-Prüfung schlägt fehl                                             |

Immer wird die **erste** Divergenz erwartet, mit `seq` **und** Feld — nicht nur pass/fail. Fall (c)
setzt E8 voraus und ist der eigentliche Beweis, dass Anchoring etwas leistet.

**Fälle (d) und (e) kommen aus ADR-007/ADR-022** und existieren erst, seit es eine Kette je Mandant und
einen Merkle-Anker darüber gibt. Zu (d): weil der Baum **jede** Kette als Blatt trägt — auch eine seit dem
letzten Anker unveränderte —, ist eine gelöschte Kette von einer ruhenden unterscheidbar. Genau das war
bei einer globalen Kette nicht darstellbar.

**Positivfall dazu, und er ist die eigentliche Zusage:** der Inklusionsnachweis eines Mandanten ist
**ohne Daten anderer Mandanten** prüfbar. Der Test bekommt Blatt, Geschwister-Hashes, Wurzel und Token —
und **nichts** über andere Ketten — und muss damit verifizieren. Schlägt das fehl, ist die
Mandantentrennung aus ADR-007 nur behauptet.

Zusatzfall aus E9: ein `object_erased`-Eintrag darf **kein** Kettenbruch sein, sondern muss als
absichtliche Löschung ausgewiesen werden (`JR-905`).

### §12.6 Soak — `JR-607`, plus Ledger-Nebenläufigkeit `JR-208`

**Klasse:** `nightly` (100.000 Nachrichten) + `ci`-Smoke (1.000).

100.000 Nachrichten, gemischte Größen, parallele Verbindungen.

**Assertion:** `seq` lückenlos, `verify` grün, Durchsatz protokolliert.

**Nicht** die Nightly-Menge stillschweigend auf CI-Größe reduzieren. Zwei benannte Varianten.

Ergänzend `JR-208`: 20 parallele Ledger-Writer × 500 Appends ⇒ lückenlos und korrekt verkettet;
erzwungener Rollback zwischen Seq-Ableitung und Commit ⇒ **keine** Lücke.

### §12.7 BDAT-Pfad — `JR-411`

**Klasse:** `ci`.

Einzel-Chunk, Multi-Chunk, `BDAT 0 LAST`, Chunk-Grenze mitten in einer Zeile.

**Assertion:** byteidentisches Ergebnis zum `DATA`-Pfad.

Exchange Online nutzt BDAT. Ein `DATA`-only-Receiver ist mit Exchange Online funktionslos — dieser
Test ist keine Randabdeckung.

### §12.8 Ende-zu-Ende mit echtem Exchange-Online-Tenant — `JR-1208`

**Klasse:** `manual`. Ergebnis wird protokolliert; ohne echten Tenant ist E12 nicht abnehmbar.

1. Journal-Rule für interne und externe Nachrichten.
2. Prüfen: DL-Expansions-Mitglieder und **Bcc**-Empfänger erscheinen in den gespeicherten Metadaten.
3. Receiver offline nehmen ⇒ Ausweichpostfach fängt die Reports auf.
4. Reconciliation-Job holt sie nach, ohne Duplikate im Storage.

**Nicht durch Mocks ersetzbar.** Die Journal-Report-Struktur echter Tenants ist der Punkt.
Der Parser-Korpus (`JR-508`) ist die Vorarbeit, nicht der Ersatz.

### §12.9 Oversize an der SIZE-Grenze — `JR-412`

**Klasse:** `ci`.

Exakt am Limit (annehmen), ein Byte darüber (`552 5.3.4` **mit** Alert), weit darüber.

RFC nennt das ausdrücklich einen stillen Datenverlust-Vektor. Ein Test, der nur den Statuscode prüft
und den Alert nicht, geht am Punkt vorbei.

## 4. Zusätzliche Testfelder außerhalb von §12

| Feld                   | Task    | Klasse       | Kern                                                                                                   |
| ---------------------- | ------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| Kanonische Kodierung   | JR-202  | `ci`         | Determinismus, Golden File, Permutations-Sensitivität, `event_payload`-Schlüsselreihenfolge irrelevant |
| Append-Only-Erzwingung | JR-205  | `ci`         | `UPDATE`/`DELETE` scheitern mit Anwendungsrechten                                                      |
| Crash-Recovery         | JR-305  | `ci`         | beide Zustände (Ledger vorhanden / fehlt), Quarantäne alarmiert, nie stilles Löschen                   |
| Response-Code-Tabelle  | JR-406  | `ci`         | jede Zeile der Tabelle als eigener Fall; kein lokaler Fehler erzeugt `5xx`                             |
| Byte-Treue             | JR-407  | `ci`         | ungewöhnliche Zeilenenden, 8-Bit-Inhalte, Dot-Stuffing-Grenzfälle                                      |
| Idempotenz             | JR-603  | `ci`         | zweifache Zustellung ⇒ 1 Objekt, 2 Ledger-Einträge, `duplicate_of` gesetzt                             |
| Hash über Plaintext    | JR-605  | `ci`         | exportieren, entschlüsseln, neu hashen ⇒ identisch                                                     |
| WORM                   | JR-705  | `ci` (MinIO) | Overwrite, Delete, Retention setzen, Verkürzung — alle vier                                            |
| Parser-Korpus          | JR-508  | `ci`         | DL-Expansion, Bcc-only, `On-Behalf-Of`, S/MIME, kein Innenteil, Plain-BCC, NDR                         |
| Monitoring             | JR-1007 | `ci`         | Signale lösen unter den erwarteten Bedingungen aus — **und nur dann**                                  |
| Auditor-Rechte         | JR-1109 | `ci`         | positiv und **negativ**; jeder Schreibversuch abgewiesen                                               |
| IAM-Grundlagen         | JR-103  | `ci`         | `PolicyValidator`, `createAbilityFor`, `FilterBuilder` über die bestehenden Fixtures                   |

## 5. Was in der CI nicht geht

Ehrliche Abgrenzung, damit niemand sie stillschweigend umgeht:

| Fall                          | Grund                              | Ausweg                                                                                             |
| ----------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| Echter Exchange-Online-Tenant | Fremdsystem, Credentials, Laufzeit | `manual`, protokolliert; Parser-Korpus als Vorarbeit                                               |
| Qualifizierte eIDAS-TSA       | kostenpflichtig, ratenbegrenzt     | `ci` **hermetisch**, `nightly` gegen `open-tsa.eu`, `manual` gegen die qualifizierte TSA — ADR-023 |
| 100k-Soak                     | Laufzeit                           | `nightly`, plus 1k-Smoke in `ci`                                                                   |
| Echtes Disk-Full              | braucht eigenes Volume             | `nightly` echt, `ENOSPC`-Injektion in `ci`                                                         |
| `chattr +i`                   | dateisystemabhängig                | übersprungen mit **sichtbarem** Hinweis, nie stillschweigend                                       |
| 500× Kill-during-DATA         | Laufzeit                           | `nightly` voll, 20× in `ci`                                                                        |

## 6. Abnahmeregel

Ein Epic gilt erst als abgeschlossen, wenn `TEST` **unabhängig** abgenommen hat. Die Abnahme
berichtet je Akzeptanzkriterium: **erfüllt / nicht erfüllt / nicht prüfbar**, jeweils mit Kommando
und Ausgabe. „Nicht prüfbar ohne echten Tenant" ist ein legitimes und nützliches Ergebnis — ein
stillschweigend als erfüllt markiertes Kriterium ist es nicht.
