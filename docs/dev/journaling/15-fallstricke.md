# Fallstricke, die schon Zeit gekostet haben

**Ausgegliedert aus `07-session-handover.md` am 2026-08-03** (Doku-Diät). **Inhaltlich
unverändert**, und die **Nummerierung ist unverändert** — projektweit wird als „Fallstrick N"
darauf verwiesen, also darf sich keine Nummer verschieben.

Sie liegen hier statt im Handover, weil sie **Referenz** sind und nicht „der nächste Schritt".
Der Handover wird bei jedem Sessionende überschrieben; diese Liste wächst nur.

**Wann lesen:** wenn ein Werkzeug sich unerwartet verhält, ein Test grün ist, der rot sein sollte,
oder eine Messung nicht das misst, was sie zu messen vorgibt. Wer neu anfängt, liest sie **nicht**
vollständig — er sucht darin.

---

1. **`docs/enterprise/journaling/guide.md` beschreibt Code, der nicht existiert.** `grep` nach
   `smtp-server`/`SMTPServer`/`journal-inbound` liefert genau zwei Treffer, und beide sind
   **Kommentare** — ein Doc-Kommentar in `packages/types/src/journaling.types.ts:79` und ein
   erklärender Kommentar in `packages/backend/src/jobs/processors/schedule-continuous-sync.processor.ts:29`.
   Keine Implementierung, kein Prozessor, keine Queue-Registrierung. Immer `grep` vor der Annahme,
   ein dokumentiertes Feature sei implementiert — und Treffer daraufhin ansehen, ob sie Code sind.
2. **`apps/open-archiver-enterprise` und `packages/enterprise` fehlen**, werden aber von Root-Scripts
   referenziert. `pnpm build:enterprise` und `dev:enterprise` funktionieren hier nicht — die
   `:oss`-Varianten nehmen.
3. **~~Die IAM-Doku ist stale, nicht der Code.~~ Erledigt am 2026-07-30 durch `JR-13-12`.** Alle drei
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
   Suite-Inventur im `globalSetup` verlangt **exakte** Dateizahlen je Suite, und seit `JR-1-05c`
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
   `x or (y and b)`. Das hat in `JR-13-01` einen Test **grün** gemacht, der einen Angriff belegen sollte —
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
    `JR-1-05c` (F24).** Die Ursache bleibt richtig zu wissen, weil sie jede Task betrifft, die einen
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
    beiden Tests sieht für sich falsch aus.** In `JR-13-01` forderten zwei Erwartungen mit demselben
    `RED UNTIL JR-13-04`-Tag für strukturell gleiche Eingaben Unvereinbares; aufgefallen ist es erst,
    als vier Fixes gelandet waren und einer nicht grün werden konnte. **Der Tell war, dass beide
    dieselbe Task nannten.** Wer rote Tests vorab schreibt, prüft die Erwartungen eines Tags
    **gegeneinander**, bevor der Fix beginnt — nicht erst gegen den Code. Aufgelöst in ADR-018.
14. **Ein Kommentar, der einen Befund „bewusst offen" markiert, muss nachgezählt werden — nicht je
    Aussage, sondern je Befundnummer.** In `JR-13-06` behaupteten beide Statusdateien, F4 **und** F5
    seien im Code als bewusst offen kommentiert. F4 ist es, F5 nicht (**F25**). Der Satz war in einem
    Zug geschrieben, und weil F4 und F5 dieselbe Datei betreffen, liest er sich richtig. Prüfung ist
    ein Einzeiler:

    ```bash
    grep -rn "F4\|F5\|finding F" --include=*.ts packages/backend/src/ | grep -v test
    ```

15. **Eine Abfrage in einer Betreiberanleitung braucht konstruierte falsch-negative, nicht nur
    Positiv- und Negativfälle.** `JR-13-07`s Prüf-SQL fand 13 von 13 absichtlich betroffenen Rollen und
    keine der Gegenproben — und war trotzdem falsch, weil beide `cond`-CTEs auf
    `jsonb_typeof(… ) = 'object'` filtern und damit jede Policy mit skalarem oder Array-`conditions`
    unsichtbar machen (**F27**). Genau diese Form war vor E13 **unbeschränkter Zugriff**. Die Methode,
    die es gefunden hat: für jede Form, die die Abfrage **nicht** meldet, die Anwendung **vor und nach**
    dem Fix auf derselben Policy messen (`FilterBuilder` von `efea6bc` gegen den von `HEAD`, beide im
    selben Testprozess) und die Differenz gegen die Meldung stellen. „Ändert sich und wird nicht
    gemeldet" ist der Befund.

16. **Zwei Gates, die dieselbe Regel prüfen sollen, prüfen sie nicht automatisch gleich.**
    `PolicyValidator` und `mongoToDrizzle` sollten nach `JR-13-06` dieselbe Key-Form akzeptieren; sie tun
    es für SQL-Syntax, aber nicht für Relation und Segmentzahl (**F29**). Gefunden mit einer Tabelle,
    die **jeden** Key durch **beide** Gates schickt und die Urteile nebeneinander ausgibt — nicht mit
    zwei getrennten Testdateien, in denen jedes Gate für sich richtig aussieht.

17. **SQL in der Doku wird aus der Doku ausgeführt, nicht aus dem Entwurf.** In `JR-13-07` wich die
    veröffentlichte Fassung der Prüfabfrage an einer Stelle vom getesteten Entwurf ab (eine
    CTE-Referenz musste beim Einfügen qualifiziert werden). Der Beleg ist deshalb ein Skript, das die
    ` ```sql `-Blöcke aus der Markdown-Datei extrahiert und **wörtlich** gegen Postgres laufen lässt —
    sonst belegt der grüne Lauf den Entwurf und nicht das, was ein Betreiber kopiert. Zusätzlich
    gehören zu einer solchen Abfrage **Negativfälle**: dass die drei `predefined_*`-Rollen in **keiner**
    Ausgabe erscheinen, trägt die Aussage „keine Pauschalwarnung".

18. **Ein Prädikat, das zwei Module teilen sollen, hat oft in keinem der beiden ein Zuhause.** Bei
    `JR-13-13` war der naheliegende Griff, `PolicyValidator` aus `mongoToDrizzle` importieren zu lassen —
    das zieht `drizzle-orm` in eine Klasse, die heute nur Typen importiert, und damit in jeden Unit-Test,
    der eine Policy validiert. Die Gegenrichtung ist genauso falsch: ein SQL-Übersetzer, der das
    IAM-Policy-Modul importiert. Richtig war ein **drittes Modul, das nichts importiert**
    (`src/helpers/conditionKey.ts`). Der Test dafür ist nicht Geschmack, sondern die Frage, welche
    Abhängigkeit dadurch **neu** entsteht.

19. **Ein Restspalt, den man als Kommentar festhält, ist nicht festgehalten.** F29 stand genau deshalb
    still: der Validator trug einen ausführlichen Kommentar darüber, was er bewusst **nicht** prüft, und
    die Divergenz war trotzdem da. In `JR-13-13` sind die drei Restspalte deshalb **grüne Assertions**
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
    ein verschachtelter Fall, nicht ein Wurzelfall.** `JR-13-14` hat F27 an der **Wurzel** von `conditions`
    geschlossen und dort vollständig; `checkConditionsShape()` läuft in `mongoToDrizzle` aber in **jedem**
    `$or`/`$and`/`$not`-Zweig erneut. Ergebnis: `conditions: 5` wird gemeldet, `conditions: {"$not": 5}`
    nicht (**F30**). Beim Lesen des Diffs ist das unsichtbar, weil beide Befundtypen richtig aussehen — die
    rekursive CTE `cond` liegt direkt daneben und wird für die Formbefunde nur nicht benutzt. Regel für die
    nächste solche Abfrage: **jede** Form, die im Code an mehr als einer Stelle geprüft wird, mit einem
    Fall auf **jeder** dieser Stellen einsäen, nicht nur mit einem.

23. **Der HTTP-`400`-Pfad ist prüfbar, ohne den Server zu starten.** `JR-13-09` hat ihn als „nicht prüfbar"
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
    Positionen mit.** Für `JR-13-17` war die Referenz `checkConditionsShape()` **plus** die drei Stellen, an
    denen `mongoToDrizzle` sich selbst aufruft (Wurzel, `$or`/`$and`-Element, `$not`-Rumpf). Genau diese
    Liste ist das Prädikat der Abfrage geworden. Wer stattdessen „Knoten ist kein Objekt" schreibt, meldet
    jedes Blatt jeder normalen Bedingung (Fallstrick 20); wer nur die Wurzel prüft, ist bei F30. Der
    Gegentest dazu ist billig und hat beide Fehler ausgeschlossen: dieselben Bedingungswerte durch den
    **gebauten** Übersetzer (`dist/helpers/mongoToDrizzle.js`, ein `node`-Einzeiler, kein Test im Repo)
    schicken und „verweigert" gegen „gemeldet" stellen. Jede Abweichung muss man dann benennen können — bei
    `JR-13-17` waren es zwei, beide erklärbar.

27. **Auf Windows zerstört eine Shell-Umleitung die Kodierung — und der anschließende Vergleich lügt.**
    Wer eine Datei mit `>` oder `Out-File` in PowerShell 5.1 umleitet, um sie zu normalisieren oder gegen
    ein Soll zu diffen, schreibt sie in einer anderen Kodierung zurück: die Em-Dashes und Anführungszeichen
    der englischen Betreiberdoku kommen zerstört an, und `Compare-Object` meldet danach Dutzende
    „inhaltlicher" Abweichungen, die keine sind. **Das hat am 2026-07-30 zweimal an einem Tag zugeschlagen**
    — beim Prüfer von `JR-13-09c`, der daraus einen Befund gemacht hat (**F36**, widerlegt), und beim PO
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
    dem Befundtext.** In `JR-1-05c` war der grüne Ausgangszustand für F14 und F24 im Befund dokumentiert;
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
    Wegwerf-Config in 2 Minuten prüfbar — und beides trug in `JR-1-05c` je eine tragende Konstruktion.

31. **Ein Wächter, der die normalen Entwicklungskommandos rot macht, ist ein Wächter, den man abschaltet.**
    Die Testzahl-Prüfung aus `JR-1-05c` müsste `pnpm test -t "…"`, `pnpm test:unit` und jeden Dateifilter
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

35. **Es gibt zwei `test:types`-Schritte in der CI, und ein grüner Volllauf prüft keinen von beiden.**
    `pnpm --filter @open-archiver/backend test:types` **und** `pnpm --filter @open-archiver/journaling
test:types` (`.github/workflows/ci.yml`, zwei getrennte Schritte). `vitest` transpiliert ohne
    Typprüfung, ein Volllauf sagt über Typen also nichts. In `JR-4-19` am 2026-08-03 genau so
    passiert: Volllauf grün, `backend test:types` grün, **CI rot** an zwei Typfehlern in einer neuen
    Datei unter `packages/journaling/tests/unit/` — ein Typ, den `smtp-server.ts` nur **importiert**
    statt zu re-exportieren (`JournalTransactionInput` gehört `spool/acceptance.ts`), und ein
    Fake-Rückgabewert, dem zwei Felder fehlten. **Vor jedem Push beide Filter fahren**, wenn Dateien
    in beiden Paketen berührt wurden. Verwandt: **F47** (derselbe Schritt fehlte in der CI ganz).
    Und: ein `as never` im Test hätte den zweiten Fehler verdeckt — Fakes richtig typisieren, nicht
    wegcasten.

---
