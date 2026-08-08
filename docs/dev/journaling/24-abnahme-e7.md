# Abnahme E7 (WORM-Storage) — `JR-7-06`

**Datum:** 2026-08-08 · **Geprüfter Commit:** `587b334` (Branch `claude/journaling-e7-worm-storage`,
lokal deckungsgleich mit `origin/claude/journaling-e7-worm-storage`, Arbeitsbaum sauber bis auf das
eigene, nicht committete `.oa-test-storage/`) · **CI-Lauf für diesen Commit:** `31247183509`
(`success`, 3 min 12 s) · **Rolle:** Tester, unabhängige Sitzung — hat keine E7-Scheibe selbst
umgesetzt (weder `JR-7-01`…`JR-7-04` (DEV) noch `JR-7-05` (TEST) noch die
Auftraggeber-Dokumentationssitzung zum Soft-Delete/Overwrite-Befund betrafen diese Sitzung).

**Urteil: angenommen mit Auflage.** Die WORM/Object-Lock-Kernlieferung (`JR-7-01`…`JR-7-05`) ist
solide umgesetzt, dokumentiert und — von mir selbst gegen ein frisches, unabhängig aufgesetztes
MinIO reproduziert — nachweislich korrekt und **nicht fail-open** (siehe Kalibrierung unten). Eine
Auflage bleibt offen und ist **kein** WORM-Defekt, sondern ein Verfahrensbruch: zwei Befunde, die der
Auftraggeber am 2026-08-07 ausdrücklich „in E7, nicht vorher" zur Behebung zugeordnet hatte (F60,
F66 — siehe unten), sind in der gesamten E7-Sitzungsfolge nicht angefasst worden. Das muss vor dem
Rückmerge explizit neu entschieden werden (Nachholen oder förmliche Neuzuordnung), nicht stillschweigend
verschwinden.

## Eigene Verifikation — nicht nur Berichte übernommen

**MinIO unabhängig selbst aufgesetzt**, nicht die Infrastruktur einer vorherigen Sitzung
weiterverwendet: eigener Docker-Container (`minio/minio:latest`, kein persistentes Volume, Ports
19010/19011, eigene Zugangsdaten), Health-Check `200` auf `/minio/health/live` vor dem Lauf, nach dem
Lauf wieder entfernt (Objekte darin waren ohnehin nur wenige Minuten unter COMPLIANCE-Lock, siehe
Dateikommentar von `journal-worm-object-lock.adv.test.ts`).

**Funktionslauf gegen dieses frische MinIO** (narrowed auf die eine Datei, damit **kein**
Zähleranspruch verbunden ist — s.u.):

```
OA_TEST_MINIO_ENDPOINT=http://127.0.0.1:19010 OA_TEST_MINIO_ACCESS_KEY=*** OA_TEST_MINIO_SECRET_KEY=*** \
OA_TEST_CLASSES=nightly OA_TEST_REQUIRE_INFRA=1 corepack pnpm exec dotenv -- vitest run \
  packages/backend/tests/adversarial/journal-worm-object-lock.adv.test.ts
```

Ergebnis: **4 passed (4)**, alle vier `coverageNotice`-Meldungen wortgleich zum dokumentierten Befund
(Fall 1/2 melden die Anwendungsseiten-Lücke, Fall 3/4 bestätigen Retention-Setzen und
Verkürzungs-Fehlschlag wörtlich).

**Kalibrierung, weil ein Test, der nie rot war, nichts beweist** (Rolle-Vorgabe „calibrate every
negative finding"): `S3StorageProvider.put()` temporär so verändert, dass es **nie** Object-Lock-
Parameter anhängt (`objectLockParams = {}` fest verdrahtet statt bedingt), derselbe Lauf wiederholt:

```
Test Files  1 failed (1)
     Tests  3 failed | 1 passed (4)
```

Fall 3 und Fall 4 (Retention-Behauptungen) und Fall 2 (das versionsscharfe `DeleteObject` scheitert
nur, wenn wirklich eine Sperre existiert) schlagen sofort fehl, sobald die Sperre fehlt; Fall 1 bleibt
grün, weil er per Definition nur das Überschreiben selbst prüft, das mit oder ohne Sperre gelingt. Das
zeigt: **die Suite erkennt eine kaputte Object-Lock-Verdrahtung tatsächlich**, sie ist kein
Fail-Open-Test, der unabhängig vom Produktionscode grün bliebe. Änderung danach per
`git checkout -- packages/backend/src/services/storage/S3StorageProvider.ts` vollständig
zurückgenommen, mit erneutem grünen Lauf (4/4) bestätigt; `git status`/`git diff --stat` zeigen
danach keine Abweichung außer dem immer schon vorhandenen, ungetrackten `.oa-test-storage/`.

**Voller, unnarrowed Basislauf** (kein `-t`, kein Dateifilter, kein `--project`, Standardauswahl
`ci`, damit ein echter Zählernachweis vorliegt, nicht „verified NOTHING"):

```
corepack pnpm exec dotenv -- vitest run
```

`Test Files 112 passed | 1 skipped (113)` · `Tests 1322 passed | 13 skipped (1335)` · Exit 0 ·
`[TEST-EXECUTED] unit: ci 1119/1119 · integration: ci 133/133 · adversarial: ci 70/70` — exakt wie in
`tests/support/suite-inventory.ts` erwartet (78+26+9 = 113 Dateien). **Kein einziger Fehlschlag** in
diesem eigenen Lauf — die zwei in `06-status.md`s `JR-7-05`-Protokoll genannten Fehlschläge
(`m365-range-refresh-cli.int.test.ts`, `journal-soak.adv.test.ts`s hängender `ci`-Smoke-Fall,
zugeordnet zu **F67**) sind beide dort selbst schon als Umgebungsartefakte dieser fremden Sitzung
kalibriert (per `git stash` isoliert reproduziert) und nicht durch `JR-7-05` verursacht; in meinem
eigenen, isolierten Lauf ohne parallele Last trat der F67-Hang gar nicht erst auf — konsistent mit der
dortigen Erklärung, nicht widersprüchlich dazu.

**Build/Typprüfung selbst wiederholt:** `corepack pnpm --filter @open-archiver/types build` grün
(keine Ausgabe außer dem `tsc`-Aufruf selbst); `corepack pnpm --filter @open-archiver/backend exec tsc
--noEmit` grün (keine Ausgabe). `corepack pnpm exec prettier --check` auf allen zehn durch E7
geänderten/neuen Dateien (`S3StorageProvider.ts`, `LocalFileSystemProvider.ts`, `config/storage.ts`,
`storage.types.ts`, die neue Testdatei, `tests/support/infra.ts`, `tests/support/suite-inventory.ts`,
`guide.md`, `06-status.md`, `09-befunde-bestandscode.md`) grün.

**Diff-Umfang der gesamten Epic-Verzweigung gegen den Integrationsbranch selbst nachgezählt** (nicht
nur den Sessionprotokollen vertraut):

```
git diff --stat claude/enterprise-product-implementation-cxmmqe...HEAD
```

11 Dateien, 952 Einfügungen, 7 Löschungen — genau die oben genannten zehn Code-/Test-/Doku-Dateien
plus `.env.example`. **Keine Datei unter `packages/backend/src/services/StorageService.ts` oder
`packages/journaling/src/spool/` ist Teil dieses Diffs** — das ist der Beleg für die Auflage unten,
nicht nur eine Vermutung aus dem Lesen der Sessionprotokolle.

## Kriterium → Beleg → Urteil

| ID        | Kriterium (gekürzt)                                                                                                                                                                                 | Beleg                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Urteil                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `JR-7-01` | `S3StorageProvider` um optionale Object-Lock-Parameter erweitern, bestehende Aufrufer unverändert, aktivierte Config setzt Retention                                                                | `S3StorageProvider.put()` (Zeilen 39–47) hängt `ObjectLockMode`/`ObjectLockRetainUntilDate` nur an, wenn **beide** Felder gesetzt sind, sonst `{}` — identischer `Upload`-Aufruf wie vorher. Einzige Instanziierungsstelle ist `StorageService.ts:29`, unverändert (`grep` bestätigt). Selbst gegen echtes MinIO verifiziert: case 3 des `JR-7-05`-Tests liest `GetObjectRetention` zurück und bestätigt `Mode=COMPLIANCE` plus die berechnete Frist; eigene Kalibrierung oben zeigt, dass ohne die Konfiguration keine Sperre entsteht                                                                                                                                                                                                                                  | **erfüllt**                                                                                                         |
| `JR-7-02` | Least-Privilege-Policy dokumentiert (kein `DeleteObject`/`DeleteObjectVersion`/`BypassGovernanceRetention`, kein verkürzendes `PutObjectRetention`), Test gegen MinIO belegt Löschversuch scheitert | `guide.md` Abschnitt „Least-privilege credentials for the S3 backend" (Zeilen 334–382): Beispiel-Policy verweigert exakt die drei geforderten Aktionen plus eine bedingte Verweigerung für verkürzendes `PutObjectRetention` über `s3:object-lock-remaining-retention-days`. `JR-7-05` case 2, von mir selbst gegen frisches MinIO reproduziert: ein versionsscharfer `DeleteObject`-Versuch mit denselben, gewöhnlichen Zugangsdaten scheitert genuin (`rejects.toBeTruthy()`, grün), kalibriert gegen ein ungesperrtes Kontrollobjekt mit denselben Zugangsdaten, das erfolgreich gelöscht wird — ein Fehlschlag ohne diese Kalibrierung hätte nichts über die Sperre selbst bewiesen                                                                                  | **erfüllt**                                                                                                         |
| `JR-7-03` | Local-FS als schwächer dokumentiert, gehärtet (dediziertes Mount, Rechte, `chattr +i` wo verfügbar)                                                                                                 | `guide.md` Abschnitt „Local filesystem storage is not WORM" (Zeilen 399–411) benennt die Schwäche unmissverständlich („no real WORM guarantee", „bypassed by whoever has root") und dokumentiert dediziertes Mount, restriktive Unix-Rechte und `chattr +i`. Code: `LocalFileSystemProvider.tryMakeImmutable()` ruft `chattr +i` nur auf Linux (`process.platform !== 'linux'` ⇒ No-Op, selbst gelesen), Fehler geloggt statt fatal, `STORAGE_LOCAL_HARDEN_IMMUTABLE=true` steuert es. **Nicht auf echtem Linux verifiziert** (dieser Host ist Windows, wie schon die vorherige Sitzung selbst einräumt) — nur der Nicht-Linux-No-Op-Zweig und die Kompilierung sind bestätigt, das war schon vorher bekannt und ist im Kriterium selbst nicht verlangt („wo verfügbar") | **erfüllt** (mit der bereits dokumentierten Einschränkung: `chattr +i` selbst nicht auf echtem Linux nachvollzogen) |
| `JR-7-04` | Retention-Konflikt-Dokumentation steht **vor** der Wahl der Aufbewahrungsfrist (Reihenfolge ist Teil des Kriteriums)                                                                                | Selbst per `grep -n "^#\{1,4\} "` über `guide.md` nachvollzogen, nicht nur behauptet: Zeile 304 „Retention under COMPLIANCE mode is irreversible — read this before choosing a period" steht vor Zeile 317 „Choosing a retention period and enabling Object Lock" — dieselbe Reihenfolge auch inhaltlich (der Einleitungssatz der Sektion, Zeile 302, verlangt ausdrücklich „Read the whole section — in the order it is written — before you set a retention period")                                                                                                                                                                                                                                                                                                   | **erfüllt**                                                                                                         |
| `JR-7-05` | WORM-Tests gegen MinIO: Überschreiben scheitert, Löschen scheitert, Retention gesetzt, Verkürzung scheitert — alle vier grün                                                                        | Von mir selbst gegen ein **frisches, unabhängig aufgesetztes** MinIO reproduziert: 4/4 grün, plus Kalibrierung (s.o.) beweist, dass ein Fehlschlag in der Verdrahtung tatsächlich rot würde. **Zwei der vier Fälle halten nicht wörtlich** wie im Backlog formuliert — das ist bereits vom Auftraggeber am 2026-08-08 akzeptiert und in `guide.md` dokumentiert (Abschnitt „What Object Lock protects — and what the application does not show you", Zeilen 384–397), nicht neu zu entscheiden. Das reale, versionsscharfe Object-Lock-Verhalten hält nachweislich, das ist die Substanz des Kriteriums                                                                                                                                                                  | **erfüllt** (mit der bereits entschiedenen, dokumentierten Abweichung in der wörtlichen Formulierung)               |
| `JR-7-06` | `JR-7-01`…`JR-7-05` erfüllt                                                                                                                                                                         | Alle fünf Zeilen oben erfüllt. **Auflage unten bleibt unabhängig davon offen** — sie hängt nicht an einer der fünf Zeilen, sondern an zwei vom Backlog getrennten, vom Auftraggeber aber ausdrücklich dieser Epoche zugeordneten Befunden                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **angenommen mit Auflage**                                                                                          |

## Die Auflage: F60 und F66, vom Auftraggeber „in E7, nicht vorher" zugeordnet, in E7 nicht angefasst

Das ist kein Fund, den ich neu aufmache — es ist eine bereits schriftlich getroffene
Auftraggeber-Entscheidung, deren Umsetzung ich beim Nachprüfen als fehlend vorfinde:

- `docs/dev/journaling/07-session-handover.md` (Zeilen 167–205, geschrieben beim Abschluss von E6,
  also **vor** dieser Epoche) nennt F60 und F66 ausdrücklich als „**Zwei Startpunkte**, beide bereits
  E7 zugeordnet, nicht neu zu entscheiden" — mit je einer konkreten Lösungsskizze (F60: Stream-Cipher
  oder Signatur ehrlich auf `Buffer` verengen; F66: mitgeführter Zähler statt vollem
  Verzeichnis-Walk).
- `docs/dev/journaling/09-befunde-bestandscode.md`, F66-Eintrag (Zeilen 3788–3791): „Entschieden vom
  Auftraggeber (2026-08-07): F66 wird nach E7 verschoben … die O(n²)-Latenz unter Rückstand wird **mit
  F60 zusammen in E7 behoben, nicht vorher**." F60 selbst (Zeilen 3457–3459) trägt denselben Status:
  „offen — vorgeschlagene Zuordnung: E7".
- Der Diff der gesamten Epic-Verzweigung (`git diff --stat
claude/enterprise-product-implementation-cxmmqe...HEAD`, oben zitiert) berührt **keine** der beiden
  betroffenen Dateien (`packages/backend/src/services/StorageService.ts` für F60, die Spool-Hochwasser-
  marken-Prüfung für F66). Die Sessionprotokolle in `06-status.md` für `JR-7-01`…`JR-7-05` erwähnen
  weder F60 noch F66 — kein Aufgreifen, keine begründete Ablehnung, keine neue Zuordnung.

**Warum das eine Auflage ist und keine Ablehnung:** Beide Befunde betreffen nicht die WORM/Object-
Lock-Substanz dieser Epoche — F60 ist eine Pufferungsfrage in `StorageService.put()`, F66 eine
O(n²)-Latenzfrage im Spool-Sweep, beide bereits vor E7 gemessen und beide ausdrücklich als „Acceptance-
Contract-Korrektheit unberührt" eingestuft. Die fünf WORM-Kriterien selbst — der eigentliche Gegenstand
von `JR-7-06` — sind unabhängig davon vollständig und nachweislich erfüllt. **Warum es trotzdem keine
stillschweigende Nebensache ist:** eine schriftliche, datierte Auftraggeber-Entscheidung („in E7, nicht
vorher") ist nicht eingehalten worden, und keine der E7-Sitzungen hat das bemerkt, begründet
zurückgestellt oder neu zur Entscheidung vorgelegt — genau das Muster, das dieses Projekt an anderer
Stelle wiederholt korrigiert hat (die stale „CI-Lücke"-Behauptung, `JR-6-08`s F64-Neubewertung). Vor dem
Rückmerge braucht es eine explizite neue Entscheidung: entweder F60/F66 werden vor dem Merge
nachgeholt, oder der Auftraggeber verschiebt sie **datiert und begründet** auf E8 (oder später) — nicht
per stillschweigendem Auslassen in der nächsten Statusaktualisierung.

## Nebenfund (nicht blockierend): `04-testplan.md` ist bei der `ci`/`nightly`-Klassifizierung von `JR-7-05` stehen geblieben

`docs/dev/journaling/04-testplan.md` Abschnitt 4 (Zeile 464) listet `JR-7-05` noch als „`ci` (MinIO)"
— das war der Plan aus E0, bevor feststand, dass `docker-compose.yml`/`ci.yml` kein MinIO
bereitstellen. Die tatsächliche, im Testfile selbst ausführlich begründete Entscheidung ist `nightly`
(kein Default-Endpoint, `probeMinio()` ohne Fallback — dieselbe „kein Standard-TSA-URL"-Logik wie beim
Anchoring). Die Begründung ist im Testfile stichhaltig und von mir nachvollzogen; nur die
Planungstabelle in `04-testplan.md` wurde nicht nachgezogen. Kosmetisch, nicht blockierend — aber ein
Prüfer, der nur `04-testplan.md` liest, würde erwarten, dass `JR-7-05` im normalen `pnpm test`
mitläuft, was nicht stimmt.

## F67 (Soak-Hang) — nicht neu untersucht, wie beauftragt

Wie im Auftrag vorgegeben: F67 ist bereits als bekannt, nicht blockierend und außerhalb von E7s
inhaltlichem Bereich (E6/`JR-6-07`) eingeordnet. Ich habe ihn nicht neu untersucht. Erwähnenswert nur:
mein eigener, isolierter Volllauf (oben) zeigt **keinen** Hang — konsistent mit F67s eigener Erklärung
(„läuft isoliert in ~1s durch", tritt nur unter voller Parallellast auf), kein neuer Widerspruch.

## Was ich selbst nachvollzogen habe vs. was ich übernommen habe

**Selbst nachvollzogen:**

- MinIO unabhängig neu aufgesetzt (nicht die Infrastruktur der `JR-7-05`-Sitzung wiederverwendet),
  Gesundheitscheck vor dem Lauf
- Alle vier `JR-7-05`-Fälle gegen dieses frische MinIO grün reproduziert
- **Kalibrierung durchgeführt, die die vorherige Sitzung nicht dokumentiert hatte**: Object-Lock-
  Parameter im Code deaktiviert, gezeigt, dass 3 von 4 Fällen dann rot werden, Änderung vollständig
  zurückgenommen und erneut grün bestätigt — das ist der Beleg, dass die Suite nicht fail-open ist,
  nicht nur eine Vermutung
- Vollen, unnarrowed Basislauf selbst gefahren (113 Dateien, 1322 passed, 13 skipped, exit 0, exakte
  Zählerübereinstimmung mit `suite-inventory.ts`) statt dem berichteten Lauf der Vorsitzung zu
  vertrauen
- `S3StorageProvider.ts`, `LocalFileSystemProvider.ts`, `storage.types.ts`, `config/storage.ts` und
  die Testdatei selbst gelesen, nicht nur die Zusammenfassungen in `06-status.md`
- `guide.md`s Abschnittsreihenfolge per `grep` über die echten Zeilennummern nachvollzogen, nicht nur
  die Behauptung „Reihenfolge stimmt" übernommen
- Den gesamten Epic-Diff (`git diff --stat` gegen den Integrationsbranch) selbst gezählt — das hat die
  Auflage (F60/F66) erst zuverlässig belegt, nicht nur aus dem Lesen der Sessionprotokolle vermutet
- CI-Lauf für den exakten geprüften Commit selbst abgerufen (`gh run list`), nicht nur den
  Status-Badge geglaubt
- `pnpm lint` (Prettier) auf allen zehn geänderten/neuen Dateien selbst geprüft
- Build (`@open-archiver/types`) und `tsc --noEmit` (`@open-archiver/backend`) selbst wiederholt

**Übernommen, mit Begründung:**

- Die bereits vom Auftraggeber entschiedene Bewertung der Fälle 1/2 aus `JR-7-05` (S3-Versionierung
  statt echtem Fehlschlag) wurde nicht neu verhandelt — das war ausdrücklich Teil des Auftrags
  („bereits entschieden, NICHT neu aufmachen"). Ich habe nur geprüft, dass die Dokumentation dazu
  tatsächlich vorhanden, korrekt und an der richtigen Stelle steht, nicht ob die Entscheidung selbst
  richtig war
- F67 wie beauftragt nicht neu untersucht
- `chattr +i` selbst nicht auf echtem Linux verifiziert (kein Linux-Host in dieser Sitzung verfügbar) —
  dieselbe Einschränkung, die die vorherige Sitzung schon einräumt; das Kriterium selbst verlangt
  „wo verfügbar" und der Nicht-Linux-Zweig ist geprüft

## Methodik

Keine Änderung an Produktionscode außer der einen, ausdrücklich als Kalibrierung deklarierten,
vollständig zurückgenommenen Testinjektion in `S3StorageProvider.ts` (per `git checkout --` restauriert,
`git status`/`git diff --stat` danach leer außer dem immer schon vorhandenen, ungetrackten
`.oa-test-storage/`). Kein Testcode geändert oder hinzugefügt — die vorhandene Suite für `JR-7-05` war
bei eigener Prüfung bereits vollständig und korrekt kalibriert (case 2 und case 4 tragen ihre eigene
Kalibrierung schon im Testfile), nichts nachzuziehen. Die eigenen Artefaktänderungen dieser Sitzung sind
dieses Abnahmeprotokoll sowie die Statusaktualisierungen (`06-status.md`, `07-session-handover.md`).
Eigener MinIO-Testcontainer nach Gebrauch entfernt (kein persistentes Volume, ohnehin nur Sekunden bis
Minuten Lebensdauer der darin unter Object Lock geschriebenen Testobjekte relevant).

**Kein Rückmerge durchgeführt** (Auftrag, CLAUDE.md §7) — das bleibt einer Folge-Sitzung nach
ausdrücklicher Freigabe vorbehalten, und angesichts der offenen Auflage sollte diese Freigabe die
F60/F66-Entscheidung einschließen, nicht nur den WORM-Code selbst.
