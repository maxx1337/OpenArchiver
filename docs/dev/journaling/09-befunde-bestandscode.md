# Befunde im Bestandscode

Defekte, die beim Arbeiten am Journaling-Projekt gefunden wurden, aber **nicht** Teil des
RFC-Scopes sind. Sie wurden bewusst **nicht** nebenbei behoben — eine Testaufgabe ist nicht der Ort
für stille Produktionsänderungen. Dieses Dokument existiert, damit sie nicht verloren gehen.

Jeder Befund braucht eine Entscheidung des Auftraggebers: **jetzt beheben**, **in ein Epic
einplanen**, oder **bewusst akzeptieren**.

**Die `F`-Nummerierung ist fortlaufend und liegt ausschließlich in dieser Datei.** Andere Dokumente
verweisen auf `F<N>`, führen aber keine eigenen Befunde — eine über zwei Dateien verteilte
Nummerierung hat schon einmal in die Irre geführt (F11 lag zunächst in `06-status.md`, verschoben am
2026-07-28 im Rahmen von `JR-1-06`).

> **Reservierung für E6: `F59` bis `F70`** (angelegt 2026-08-05 auf dem Integrationszweig, Grundlage
> **ADR-032** Punkt 4). Höchste vergebene Nummer beim Eröffnen des Zweigs
> `claude/journaling-e6-phase-b-worker`: **F58**. Wer in E6 einen Befund aufnimmt, nimmt die nächste
> freie Nummer **aus diesem Block** — und legt den Abschnitt trotzdem hier an, nicht im Statusdokument
> (Punkt 3 derselben ADR: genau das hat E5 mit F42/F43 verletzt). Reicht der Block nicht, wird er
> **hier** erweitert, nicht auf dem Epic-Zweig. Nicht gebrauchte Nummern fallen mit der Abnahme des
> Epics an den Vorrat zurück.

Drei Kategorien, im Kopf jedes Befunds ausgewiesen:

| Kategorie                  | Bedeutung                                                                              | Befunde                                         |
| -------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Bestandscode**           | Defekt im vorhandenen Produktionscode des Repositorys                                  | F1–F10, F17, F19, F20, F26, F29, F60            |
| **Vorgegebenes Verfahren** | Defekt in einer im Backlog vorgegebenen Schrittfolge, **nicht** im Produktionscode     | F11, F18, F21, F22                              |
| **Testharness**            | Defekt in dem in E1 neu gebauten Testcode — unsere eigene Arbeit, kein Bestandsproblem | F12–F16, F23, F24, F39, F41, F43, F47, F48, F49 |
| **Doku über eigenen Code** | Unzutreffende Aussage über den eigenen Code oder in der veröffentlichten Betreiberdoku | F25, F27, F28, F30, F31–F34                     |
| **Entwicklungsumgebung**   | Defekt, der nur die Arbeitsfähigkeit betrifft, nicht das ausgelieferte Produkt         | F35, F42                                        |
| **Deployment**             | Defekt in der ausgelieferten Betriebsumgebung, nicht im Code selbst                    | F37                                             |
| **Neuer Code**             | Defekt in Produktionscode, der in diesem Projekt selbst entstanden ist (ab E2)         | F38, F40, F44, F45, F46, F58, F59, F61          |

Herkunft: `JR-1-03` (F1–F6), `JR-1-04` (F7–F10), `JR-1-05` (F11), die Abnahme `JR-1-06` (F12), die
Nacharbeit `JR-1-04a` (F13), die Abnahme `JR-1-06a` (F14–F16), `JR-13-01` (F17–F23), die Abnahme
`JR-13-09` (F24–F29), die Abnahme `JR-13-09a` (F30) und die Abnahme `JR-13-09b` (F31–F34), Rolle
`tester`, 2026-07-27 bis 2026-07-29. Dazu `JR-13-09c` (F36), `JR-2-05` (F37), `JR-2-08` (F38) und die
zweite Abnahme `JR-2-10a` (F39), 2026-07-30 bis 2026-08-01.

> **F31 ist der einzige Befund dieser Liste, dessen Ursache in einer ADR liegt und nicht im Code oder
> in seiner Umsetzung.** ADR-020 hat den Verhaltenscheck selbst „vollständig" genannt; `JR-13-17` hat
> diesen Anspruch folgerichtig auf die Betreiberseite übernommen. Die Berichtigung steht in ADR-020
> unter „Berichtigung (2026-07-29, nach der Abnahme `JR-13-09b` — F31)". Wer F31 liest, ohne sie zu
> lesen, hält den Befund für einen Schreibfehler — er ist ein Denkfehler des PO.

> **Seit `JR-13-01` (2026-07-29) markiert der Testcode die vier E13-Befunde nicht mehr als bestanden.**
> F1, F3, F7 und F8 waren bis dahin mit `it.fails` bzw. mit Assertions auf den **Ist**-Zustand
> festgehalten — ein grüner Test, der eine Sicherheitslücke beschreibt. Sie fordern jetzt den
> gewünschten Zustand, mit dem Titelpräfix `RED UNTIL JR-13xx`. Die Rot-Läufe sind in
> `06-status.md` protokolliert. Für Befunde **außerhalb** von E13s Umfang (F4, F5, F9, F10, F17) gilt
> weiter: Ist-Zustand festhalten, laut in einer `coverageNotice` benennen, nicht beheben — es gibt
> keine Task dafür, und ein roter Test ohne Zuständigen blockiert nur die Abnahme.

> **Stand 2026-07-29 nach den Fixes `JR-13-02`–`JR-13-06`: F1, F3, F7, F8, F19 und F20 sind behoben**,
> F21 ist umgesetzt. 20 der 21 roten Tests sind grün, kein vorher grüner Test ist rot geworden. Der
> eine noch rote Test ist ein Widerspruch zwischen zwei `JR-13-01`-Tests und keine offene Lücke —
> Vorlage in `06-status.md` unter „Der eine verbleibende rote Test".
>
> **Unverändert offen und ausdrücklich nicht mitbehandelt:** F2, F4, F5, F6, F9, F10, F13–F18, F22,
> F23. `JR-13-09` prüft, dass sie nicht stillschweigend mitverändert wurden.

---

## Alle Befunde auf einen Blick

**Diese Tabelle ist am 2026-08-03 entstanden** (Doku-Diät) und wird bei jedem neuen Befund
mitgeführt. Sie ersetzt das Lesen der Datei nicht, sie ersetzt das **Durchblättern**: die
Volltexte stehen unverändert darunter, und wer nur wissen will, ob eine Nummer offen ist,
findet es hier.

| Nr.      | Befund                                                                                                                                                | Schwere | Status     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------- |
| **F1 **  | SQL-Injection über Policy-Condition-Keys                                                                                                              | hoch    | behoben    |
| **F2 **  | AppAbility-Typ schützt Row-Level-Prüfungen nicht                                                                                                      | mittel  | offen      |
| **F3 **  | Fail-open-Übersetzung in mongoToDrizzle                                                                                                               | mittel  | behoben    |
| **F4 **  | Zweiter Operator wird stillschweigend verworfen                                                                                                       | mittel  | offen      |
| **F5 **  | { field: null } wird zu "field" = NULL                                                                                                                | niedrig | offen      |
| **F6 **  | { action: [], subject: 'x' } besteht die Validierung                                                                                                  | niedrig | behoben    |
| **F7 **  | FilterBuilder ist fail-open, wenn keine can-Regel greift                                                                                              | hoch    | behoben    |
| **F8 **  | Der cannot-Ausschluss verarbeitet Operator-Bedingungen falsch                                                                                         | mittel  | behoben    |
| **F9 **  | mongoToMeli-Platzhalter greift nur bei skalarer Bedingung                                                                                             | niedrig | offen      |
| **F10 ** | Die expandierte IN-Liste ist unsortiert                                                                                                               | niedrig | offen      |
| **F11 ** | Die vorgegebene CI-Schrittfolge ist auf einem frischen Checkout nicht lauffähig                                                                       | mittel  | behoben    |
| **F12 ** | Zwei gleichzeitige Integrationsläufe kollidieren auf einem festen Datenbanknamen                                                                      | mittel  | behoben    |
| **F13 ** | Der unbeschränkte Sweep kann einen fremden Lauf treffen, der länger als die Frist läuft                                                               | niedrig | offen      |
| **F14 ** | Die Suite-Inventur wacht über Dateien, nicht über gelaufene Tests                                                                                     | mittel  | behoben    |
| **F15 ** | minimumFiles verdeckt eine gelöschte Testdatei, sobald die Suite wächst                                                                               | niedrig | behoben    |
| **F16 ** | Rückstand nach einem Modul-Throw wird lokal nicht angekündigt                                                                                         | niedrig | behoben    |
| **F17 ** | Zwei der drei „ausgelieferten" Rollen werden in einer echten Installation nie angelegt                                                                | mittel  | behoben    |
| **F18 ** | ADR-017s Aussage über den null-Zweig gilt je Aufrufstelle, nicht je Rolle                                                                             | niedrig | offen      |
| **F19 ** | Ein can mit leerem conditions-Objekt bedeutet Vollzugriff                                                                                             | mittel  | behoben    |
| **F20 ** | Ein cannot ohne Bedingungen wird vollständig ignoriert                                                                                                | mittel  | behoben    |
| **F21 ** | JR-13-06s Allowlist widerspricht drei bestehenden, grünen Pins                                                                                        | niedrig | —          |
| **F22 ** | F3s $or-Beispiel beschreibt die Wirkungsrichtung falsch                                                                                               | niedrig | behoben    |
| **F23 ** | tsconfig.test.json und tsconfig.json sind sich über globale Augmentierungen nicht einig                                                               | niedrig | offen      |
| **F24 ** | Ein gefilterter pnpm test -t "…" hinterlässt Testdatenbanken                                                                                          | niedrig | behoben    |
| **F25 ** | Die Statusaussage „F4 und F5 sind im Code als bewusst offen kommentiert" ist für F5 falsch                                                            | niedrig | behoben    |
| **F26 ** | Ein can mit falsy, aber vorhandenem conditions bedeutet weiter Vollzugriff                                                                            | mittel  | behoben    |
| **F27 ** | Query 2 der Betreiberanleitung hat falsch-negative: conditions als Skalar oder Array wird nic…                                                        | mittel  | behoben    |
| **F28 ** | Query 3 prüft Keys nicht für Regeln mit subject: "all"                                                                                                | niedrig | behoben    |
| **F29 ** | PolicyValidator und mongoToDrizzle sind sich über die erlaubte Key-Form nicht einig                                                                   | niedrig | behoben    |
| **F30 ** | Die Betreiberabfrage prüft die Form von conditions nur an der Wurzel, der Übersetzer an jedem…                                                        | mittel  | behoben    |
| **F31 ** | Der Verhaltenscheck behauptet die Vollständigkeit, die der Abfrage genommen wurde                                                                     | mittel  | offen      |
| **F32 ** | Der zitierte Fehlertext gilt nur für ein policies, das ein Objekt ist                                                                                 | niedrig | offen      |
| **F33 ** | „is skipped without a row" untertreibt, was die Abfrage tut                                                                                           | niedrig | offen      |
| **F34 ** | „The known case" liest sich als Aufzählung, ist aber keine                                                                                            | niedrig | offen      |
| **F35 ** | pnpm lint ist auf einem Windows-Host strukturell rot: keine .gitattributes                                                                            | mittel  | behoben    |
| **F36 ** | widerlegt: die Prettier-Warnung an access-control-changes.md ist reines F35                                                                           | keine   | widerlegt  |
| **F37 ** | die Anwendung verbindet als Superuser und Tabelleneigentümer, und kann damit jede Datenbank-S…                                                        | mittel  | offen      |
| **F38 ** | event_payload wird doppelt JSON-kodiert gespeichert, sobald der Treiber nicht durch drizzle g…                                                        | hoch    | behoben    |
| **F39 ** | ein Eigenschaftstest trägt die Eigenschaft nur im Namen: das Längenpräfix ist nicht das, was …                                                        | niedrig | —          |
| **F40 ** | eine Spool-Datei ohne Ledger-Eintrag belegt keinen Absturz, und ihr Müll frisst die Kapazität…                                                        | mittel  | offen      |
| **F41 ** | das Testnetz für „nach dem Ledger-Append passiert nichts mehr“ hat drei Löcher                                                                        | niedrig | offen      |
| **F42 ** | tsconfig.build.json kennt weder packages/journaling noch apps/\* und wird von nichts benutzt                                                          | niedrig | offen      |
| **F43 ** | der Heap-Nachweis misst am Speicher vorbei, in dem die Nachricht liegt                                                                                | mittel  | offen      |
| **F44 ** | nach einem 552 im DATA-Pfad liest der Server den Nachrichtenrumpf als SMTP-Kommandos                                                                  | hoch    | behoben    |
| **F45 ** | ein verworfener Iterator verließ den Durable Write als nackter Error, nicht als DurableWriteE…                                                        | mittel  | behoben    |
| **F46 ** | zwei Ports mit gleichem Methodennamen, und der Empfängerpfad prüft in Produktion die falsche …                                                        | hoch    | behoben    |
| **F47 ** | der Typcheck für packages/journaling läuft in der CI nicht, und ist deshalb rot                                                                       | mittel  | behoben    |
| **F48 ** | jeder CI-Lauf des E4-Branches ist fehlgeschlagen, vierzehn Scheiben lang unbemerkt                                                                    | hoch    | behoben    |
| **F49**  | Der Reihenfolgetest „Scan vor listen()" ist flaky — bei identischem Code grün und rot                                                                 | mittel  | behoben    |
| **F50**  | Der DATA-Pfad schreibt einmal pro SMTP-Zeile auf die Platte statt gepuffert — Durchsatz hängt an der Zeilenlänge, nicht an der Nachrichtengröße       | mittel  | behoben    |
| **F51**  | `smtp-ingress-ledger-recovery.int.test.ts` zählte eine Logzeile, bevor die gepipte stdout sie geliefert hatte — Beobachtung am Log statt am Verhalten | niedrig | behoben    |
| **F52**  | `MAX_COMMAND_LINE_BYTES` greift nur bei einer nie terminierten Zeile, nicht bei einer überlangen, aber in einem Stück CRLF-terminierten               | mittel  | behoben    |
| **F53**  | `commandCarry` wächst während eines suspendierten Fensters (AUTH, settling accept()) völlig ungeprüft                                                 | mittel  | behoben    |
| **F54**  | behoben in `JR-4-21` — der `500`-Abbruchpfad ist jetzt idempotent (`oversizedLineRejected`-Latch)                                                     | mittel  | behoben    |
| **F55**  | kein Limit für angenommene `RCPT TO` je Transaktion, Speicherverstärkung ~13× gemessen                                                                | mittel  | behoben    |
| **F56**  | kein Cipher-Suite-Filter, Server verhandelt `AES128-SHA` (kein Forward Secrecy) unter TLS 1.2                                                         | mittel  | behoben    |
| **F57**  | `pnpm test` war nicht in `dotenv --` gewickelt — ohne exportiertes `DATABASE_URL` übersprang die ganze `integration`-Suite, der Lauf sah grün aus     | mittel  | behoben    |
| **F58**  | Whitespace in einer konfigurierten Domain landete unverändert in der Eigentümeradresse (`alice@ company.com`)                                         | mittel  | behoben    |
| **F59**  | latenter Defekt beim `journal-inbound`-Worker-Boot, nie ein beobachteter Fehlschlag zugeordnet                                                        | niedrig | behoben    |
| **F60**  | `StorageService.put()` puffert einen Stream sofort zu einem Buffer, obwohl die Signatur Streams verspricht                                            | mittel  | offen (E7) |
| **F61**  | zurückgesetzter Socket reißt den SMTP-Empfänger ab — Ablehnungspfade ohne `error`-Handler                                                             | mittel  | behoben    |
| **F62**  | `IJournalInboundJob` ist totes Gerüst, in der Architektur-Doku noch als künftiger Payload beworben                                                    | niedrig | offen      |
| **F63**  | `journal-inbound`-Worker zieht Storage/DB in den Modulscope, CI-Umgebung war darauf nicht vorbereitet                                                 | mittel  | behoben    |
| **F64**  | Worker beendet sich nach `worker.close()` nicht selbst — ein offenes Handle hält den Prozess am Leben                                                 | mittel  | offen      |
| **F65**  | Pre-Push-Gate behandelte eigene Infrastruktur-Vorbedingungen (`DATABASE_URL`/`REDIS_PASSWORD`) asymmetrisch                                           | niedrig | behoben    |
| **F66**  | `checkSpoolHighWaterMark()` läuft bei jeder SMTP-Annahme über den gesamten Spool — O(n²) Gesamtkosten bei wachsendem Rückstand                        | hoch    | offen      |
| **F67**  | `journal-soak.adv.test.ts`s `ci`-Smoke-Fall (100 Nachrichten) hängt reproduzierbar 600s unter voller Suite-Parallellast, läuft isoliert in ~1s durch  | hoch    | offen      |

---

## F1 — SQL-Injection über Policy-Condition-Keys

**Schwere:** hoch im Wirkungsgrad, aber **Super-Admin-Rechte als Voraussetzung** ·
**Ort:** `packages/backend/src/helpers/mongoToDrizzle.ts`, `getDrizzleColumn()` ·
**Status:** **behoben** in `JR-13-06` (`dcec017`, 2026-07-29)

> **Behoben (`JR-13-06`, `dcec017`).** Condition-Keys werden gegen eine Allowlist geprüft statt
> escaped: angenommen wird ein einzelner Identifier oder `<relation>.<identifier>` mit einer Relation
> aus `relationToTableMap`, alles andere wirft. `sql.raw` ist aus dem Relationszweig entfernt, beide
> Hälften gehen durch `sql.identifier`. `PolicyValidator.isValid()` weist dieselben Keys **vor** dem
> Speichern ab, rekursiv auch in `$or`/`$and`/`$not`, sodass `iam.controller.ts` mit `400` antwortet.
> Einschränkung, bewusst und in `06-status.md` begründet: ein einzelner **unbekannter, syntaktisch
> harmloser** Key (`foo`) wird weiter übersetzt — eine spaltengenaue Allowlist ist in
> `mongoToDrizzle` nicht formulierbar, weil die Funktion keinen Tabellenkontext hat.

Ein Condition-Key mit einem doppelten Anführungszeichen schreibt rohes SQL in die `WHERE`-Klausel
jeder über `FilterBuilder` gescopeten Abfrage:

```
mongoToDrizzle({ 'id" or 1=1 --': 'v' })   →   "id" or 1=1 --" = $1
```

Der Relations-Zweig ist schlimmer, weil er `sql.raw` benutzt:

```
{ 'ingestionSource.x" or 1=1 --': 'v' }   →   "ingestion_sources"."x" or 1=1 --" = $1
```

**Verifiziert (PO, 2026-07-27):**

1. `escapeName(name) { return `"${name}"`; }` in drizzles Postgres-Dialekt (`pg-core/dialect.js:73`)
   — ein eingebettetes `"` wird **nicht** verdoppelt.
2. `PolicyValidator.isValid()` inspiziert `conditions` **überhaupt nicht** — kein Treffer für
   `conditions` in `policy-validator.ts`.
3. Der Testfall rendert die Injection tatsächlich (`pnpm test --project unit -t "F1"`).

**Einordnung — hier weicht der PO von der Meldung ab.** Der Tester hat „Schwere: hoch" gemeldet. Das
Wirkungsausmaß rechtfertigt das, die Ausnutzbarkeit relativiert es: Condition-Keys stammen aus
`roles.policies` (JSONB), und die rollenschreibenden Endpunkte verlangen `requirePermission('manage',
'all')`, also **Super Admin** (`api/routes/iam.routes.ts`, Zeilen 124–128 u. a.). Es ist also **keine**
unauthentifizierte Lücke und **keine** Eskalation aus einer eingeschränkten Rolle heraus — ein
Auditor kann sich damit nicht selbst hochziehen.

**Warum es für dieses Projekt trotzdem zählt:** Es ist eine Eskalation von „Anwendungsadministrator"
zu „beliebiges SQL". Genau das ist das Bedrohungsmodell, gegen das das Ledger existiert. RFC §5.1
formuliert es so: wer das Objekt ändern kann, kann auch die Hash-Zeile ändern. Ein Administrator mit
SQL-Zugriff könnte `journal_ledger` direkt manipulieren und damit jede anwendungsseitige
Append-Only-Disziplin umgehen.

**Konsequenz für das Projekt:** Das ist das konkrete Argument für **ADR-009** — Append-Only muss auf
**Datenbank-Rechteebene** erzwungen werden, nicht im Anwendungscode, und die Anwendungsrolle darf die
Einschränkung nicht selbst aufheben können. In ADR-009 ist F1 als Begründung verlinkt.

**Empfehlung:** Keys gegen eine Allowlist bekannter Spalten prüfen, statt sie zu escapen. Eine
Allowlist ist hier die stärkere Lösung, weil ein unbekannter Key ohnehin ein Fehler ist und
fail-closed behandelt werden sollte (siehe F3).

**Ausnutzbarkeit gegen echtes Postgres nachgewiesen (`JR-13-01`, 2026-07-29).** Bis hierher war F1 am
**gerenderten** SQL belegt, nicht am ausgeführten. Der Nachweis fehlte, und er ist nicht trivial: von
vier Payloads laufen drei **nicht**.

| Condition-Key                                              | Gerendertes Prädikat                                                | Ergebnis in Postgres                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------- |
| `id" or 1=1 --`                                            | `"id" or 1=1 --" = $1`                                              | Typfehler (`text or boolean`)         |
| `userEmail" is not null or "id" is not null --`            | `… --" = $1`                                                        | Syntaxfehler: `--` frisst die Klammer |
| `id" is not null or "id`                                   | `"id" is not null or "id" = $1`                                     | Typfehler: E-Mail gegen `uuid`        |
| `userEmail" is not null or "id" is not null or "userEmail` | `"user_email" is not null or "id" is not null or "user_email" = $1` | **läuft, liefert alle Zeilen**        |

Wer aus einem `invalid input syntax for type uuid` im Log auf Eindämmung schließt, irrt: die
Bedingungen sind nur „balancierter Ausdruck, kein `--`, passender Typ in der letzten Vergleichsstelle".
Der vierte Payload erfüllt sie und macht aus einer auf ein Postfach eingeschränkten Policy eine, die
das ganze Archiv liefert.

**Verschärfend: der Ausbruch reicht über den Filter hinaus.** `and()` in drizzle verkettet seine
Operanden **ohne** sie zu klammern. Ein Aufrufer, der `and(drizzleFilter, <eigene Einschränkung>)`
baut — also jeder — erzeugt `A or B = $1 and <Einschränkung>`, was als
`A or (B = $1 and <Einschränkung>)` geparst wird. Das injizierte `or` hebt damit auch die
**Einschränkung des Aufrufers** auf, nicht nur die der Policy. Der Testfall in
`filter-builder-f1-f3.int.test.ts` assertiert deshalb auf eine konkrete fremde Zeile und nicht auf
„nicht gleich der erwarteten Menge": die erste Fassung dieses Tests wurde **grün, weil die Injection
zu gut funktionierte** (die Ergebnismenge war größer als die beiden erwarteten Zeilen).

Regressionstests: `src/helpers/mongoToDrizzle.test.ts` (Rendering, 2 rote Fälle),
`src/iam-policy/policy-validator.f1-conditions.test.ts` (Validierungsgrenze, 2 rote Fälle),
`tests/integration/filter-builder-f1-f3.int.test.ts` (Ausführung gegen Postgres, 1 roter Fall).

## F2 — `AppAbility`-Typ schützt Row-Level-Prüfungen nicht

**Schwere:** mittel · **Ort:** `packages/backend/src/iam-policy/ability.ts`,
`packages/backend/src/services/AuthorizationService.ts` · **Status:** offen

`AppAbility = MongoAbility<[AppActions, AppSubjects]>` deklariert als Subject nur die String-Union.
Ein CASL-getaggtes Objekt ist damit nicht an `can()` zuweisbar. Der Produktionscode castet das weg:
`AuthorizationService.can()` endet in `ability.can(action, subjectInstance as AppSubjects)`.

Folge: Der Typ gibt keine Sicherheit über die Korrektheit von Row-Level-Prüfungen. Die Tests
spiegeln den Cast bewusst und dokumentieren das in `ability.test.ts`.

## F3 — Fail-open-Übersetzung in `mongoToDrizzle`

**Schwere:** mittel · **Ort:** `packages/backend/src/helpers/mongoToDrizzle.ts` ·
**Status:** **behoben** in `JR-13-04` (`45ac0e9`, 2026-07-29) — eine Testfassung bleibt rot, siehe unten

> **Behoben (`JR-13-04`, `45ac0e9`).** `mongoToDrizzle` wirft, statt eine Bedingung zu verwerfen:
> unbekannter Operator, leeres Bedingungsobjekt, leeres `$or`/`$and`, ein unübersetzbarer Zweig in
> `$or`/`$and`, ein unübersetzbares `$not`. Der Rückgabetyp ist `SQL`, nicht mehr `SQL | undefined`;
> `FilterBuilder` behandelt ein trotzdem auftretendes `undefined` als deny. Nicht mitbehoben, weil
> außerhalb von E13: **F4** (nur der erste Operator wird gelesen) und **F5** (`{field:null}` ⇒
> `= NULL`); beide sind im Code kommentiert und durch grüne Pins festgehalten.
>
> **Offen bleibt eine Testfassung, nicht der Defekt:** `filter-builder-f1-f3.int.test.ts` fordert für
> die teilweise übersetzbare Disjunktion ein Prädikat, das Zeilen liefert, während
> `mongoToDrizzle.test.ts` für dieselbe Form „throw oder never-true" fordert. Beide können nicht
> gleichzeitig grün sein; Vorlage und Empfehlung in `06-status.md` unter „Der eine verbleibende rote
> Test".

Unbekannter Operator, leeres `$or`/`$and` oder leere Query liefern `undefined` — also **kein Filter**.
Für `FilterBuilder` bedeutet „kein Filter" **unbeschränkt**.

Schlimmer: ein einzelner unübersetzbarer Zweig innerhalb eines `$or` wird verworfen und **erweitert
die Disjunktion stillschweigend**:

```
{ $or: [ {id:'a'}, {subject:{$regex:'x'}} ] }   →   "id" = $1
```

Ein `$not` um eine unübersetzbare Bedingung verwirft die Negation komplett.

**Empfehlung:** `undefined` bei den Aufrufern als **deny** behandeln, und unübersetzbare Bedingungen
laut scheitern lassen statt weglassen.

**Richtung korrigiert (`JR-13-01`, 2026-07-29) — siehe F22.** Der oben zitierte `$or`-Fall ist
gemessen eine **Verengung**, keine Erweiterung: `A or B` wird zu `A`, der Nutzer sieht also _weniger_
Zeilen als die Policy gewährt. Fail-open ist die Richtung dort, wo das Weglassen die Bedingung
vollständig verschwinden lässt — beim `$and` negierter `cannot`-Bedingungen und bei einer Disjunktion,
deren **einziger** Zweig unübersetzbar ist (`{ $or: [ <unübersetzbar> ] }` ⇒ `undefined` ⇒
unbeschränkt). Genau diese Form erzeugt `rulesToQuery` für eine Rolle mit **einer** bedingten
`can`-Regel, also den Normalfall einer scope-einschränkenden Policy. Die Anforderung lautet deshalb
„nicht stillschweigend weglassen", nicht „nicht erweitern". Zwei weitere Leerheits-Formen, die F3 nicht
benennt, sind als **F19** eröffnet.

Regressionstests: `src/helpers/mongoToDrizzle.test.ts` (5 rote Fälle, davon 3 aus der Golden-Datei)
und `tests/integration/filter-builder-f1-f3.int.test.ts` (2 rote Fälle gegen echte Zeilen).

## F4 — Zweiter Operator wird stillschweigend verworfen

**Schwere:** mittel · **Ort:** `packages/backend/src/helpers/mongoToDrizzle.ts` · **Status:** offen

Es wird nur `Object.keys(value)[0]` gelesen:

```
{ sizeBytes: { $gte: 1, $lte: 5 } }   →   "size_bytes" >= $1
```

Die Obergrenze fehlt. Bei einer Policy, die einen Bereich einschränken soll, ist das eine stille
Rechteerweiterung.

## F5 — `{ field: null }` wird zu `"field" = NULL`

**Schwere:** niedrig · **Ort:** `packages/backend/src/helpers/mongoToDrizzle.ts` · **Status:** offen

Trifft in SQL niemals eine Zeile. Die funktionierende Form ist `$exists: false`. Fail-closed, also
harmlos in der Wirkung, aber still — eine Policy tut nicht, was ihr Autor annimmt.

## F6 — `{ action: [], subject: 'x' }` besteht die Validierung

**Schwere:** niedrig · **Ort:** `packages/backend/src/iam-policy/policy-validator.ts` ·
**Status:** offen

`[]` ist truthy, daher greift die Missing-Fields-Prüfung nicht, und die Schleife iteriert null Mal.
Keine Rechteausweitung, aber eben auch keine Validierung.

## F7 — `FilterBuilder` ist fail-open, wenn keine `can`-Regel greift

**Schwere:** hoch · **Ort:** `packages/backend/src/services/FilterBuilder.ts` ·
**Status:** **behoben** in `JR-13-02` (`a309fd1`) und `JR-13-03` (`bcac6bd`), 2026-07-29 ·
**Herkunft:** `JR-1-04`, gegen echtes Postgres verifiziert

> **Behoben.** `JR-13-02` (`a309fd1`) bildet `null` von `rulesToQuery` auf denselben Deny ab, den der
> vorhandene „No access"-Zweig liefert (``sql`1=0` `` plus ein nie zutreffender Suchfilter); die
> unbeschränkte Rückgabe bleibt allein dem nachweislich unbedingten `can`. `JR-13-03` (`bcac6bd`)
> beseitigt den Action-Versatz, über den F7 durch die Suchroute erreichbar war. Alle vier roten F7-Fälle
> und der ADR-017-Fall sind grün, `predefined-roles.int.test.ts` ist grün geblieben.

`rulesToQuery()` aus `@casl/ability/extra` liefert `null`, wenn die Regelliste für
(Action, Subject) **keine nicht-invertierte** Regel enthält — sowohl wenn es überhaupt keine Regel
gibt als auch wenn es nur `cannot`-Regeln gibt. `FilterBuilder.create()` bildet `null` auf
`{ drizzleFilter: undefined, searchFilter: undefined }` ab, kommentiert als „Full access".

„Kein Recht auf dieses Subject" und „darf alles sehen" werden damit vom **selben Wert** dargestellt,
und der unsichere ist der Default. Zwei belegte Fälle:

- **F7a:** Ein Nutzer **ohne jede Rolle** erhält `undefined`, und die Abfrage liefert die Zeile.
- **F7b:** `auditor-specific-mailbox.json` verbietet `read`/`search` auf `archive` für
  `userEmail = dev@openarchiver.com` und erteilt für `archive` **kein** `can`. Ergebnis: unbeschränkt
  — die ausdrücklich verbotene Zeile kommt zurück. Der Integrationstest prüft genau das, nicht nur
  den Rückgabewert.

**Erreichbarkeit — die Middleware schützt hier nicht.** `requirePermission` übergibt nie ein
Resource-Objekt (`api/middleware/requirePermission.ts`), bedingte Regeln passieren das Gate also
immer. Und die Suchroute prüft `('search', 'archive')` (`api/routes/search.routes.ts:158`), während
`SearchService` seinen Filter für `('read', 'archive')` baut (`services/SearchService.ts:311`, `:423`).
Eine Rolle mit `can search archive` und **ohne** `read archive` passiert damit das Gate und bekommt
eine **ungefilterte** Suche über das gesamte Archiv. Dasselbe `undefined` erreicht
`ArchivedEmailService.findAll` (`services/ArchivedEmailService.ts:62`).

Das ist F3 an der Stelle, an der es Folgen hat.

**Unabhängig verifiziert (PO, 2026-07-28).** Nachgeprüft am Code, nicht am Testbericht:
`FilterBuilder.ts:49–51` lautet
`if (query === null) { return { drizzleFilter: undefined, searchFilter: undefined }; // Full access }`,
während der unmittelbar folgende Zweig für das **leere** Query korrekt ``sql`1=0` `` liefert. Der
Autor kannte den „kein Zugriff"-Fall also — der `null`-Fall ist genau verkehrt herum.
`auditor-specific-mailbox.json` enthält für `archive` tatsächlich **nur** eine `inverted`-Regel und
kein `can`; eine Policy, deren einziger Zweck das Verbot ist, erteilt damit Vollzugriff. Der
Action-Versatz zwischen `search.routes.ts:158` (`'search'`) und `SearchService.ts:311`/`:423`
(`'read'`) ist ebenfalls bestätigt.

**Reichweite präzisiert (PO, 2026-07-29) — keine der ausgelieferten Rollen trifft den `null`-Zweig.**
Geprüft an `api/controllers/iam.controller.ts` `createDefaultRoles` und `services/UserService.ts:270`:
`predefined_super_admin` (`manage: all`) und `predefined_read_only_user`
(`action: ['read','search']`) erteilen **unbedingte** `can`-Regeln und werden schon von
`FilterBuilder.ts:31` abgefangen; `predefined_end_user` hat `manage archive` **mit** `conditions`,
woraus `rulesToQuery` eine echte Query liefert. Der `null`-Zweig ist damit erreichbar über genau drei
Formen: einen Nutzer **ohne jede Rolle** (F7a), eine handgeschriebene Policy mit **ausschließlich**
`cannot`-Regeln auf `archive` (F7b), und eine handgeschriebene Rolle mit `can search archive` **ohne**
`read archive` (der Action-Versatz, siehe ADR-017).

**Zwei Präzisierungen aus `JR-13-01` (2026-07-29)** — die Aussage oben gilt **für die
(Action, Subject)-Paare der heutigen vier Aufrufstellen**, nicht für jedes Paar je Rolle (**F18**: über
das volle Vokabular treffen `predefined_end_user` 39 und `predefined_read_only_user` 46 von 56 Paaren
den Zweig). Und „ausgeliefert" trifft auf zwei der drei Rollen gar nicht zu (**F17**): der
Rollen-Bootstrap läuft in einer echten Installation nie, es existiert nur `predefined_super_admin`.

Das ändert die Schwere **nicht** — es erhöht sie praktisch. F7a und F7b sind real, ein Nutzer ohne
Rolle entsteht schon durch das Löschen einer Rolle, und weil ausgeliefert **keine** Read-Only-Rolle
existiert (F17), ist jeder eingeschränkte Nutzer eine handgeschriebene Policy in der Form von
`auditor-specific-mailbox.json` — also in genau der Form, die F7 ins Gegenteil verkehrt. Das ist nicht
der Ausnahmefall, sondern der einzige Weg, den ein Betreiber hat. Es korrigiert nur eine frühere, zu scharfe Aussage des PO, der
Fix aus `JR-13-02` „bräche Bestandsinstallationen": eine Standardinstallation mit den drei
`predefined_*`-Rollen verhält sich vor und nach dem Fix gleich. Der Nachweis dafür ist der
Integrationstest aus `JR-13-01`, nicht diese Feststellung.

**Bewertung des PO:** Das ist der schwerste Befund dieser Session — schwerer als F1. F1 setzt
Super-Admin voraus; F7 ist von einer **eingeschränkten** Rolle aus erreichbar und kehrt die Wirkung
einer restriktiven Policy ins Gegenteil. Betroffen ist die released Version 0.5.2.

**Direkte Projektrelevanz:** Die Auditor-Rolle aus `JR-11-01` ist auf genau diesen Mechanismus
gebaut. `read-only-all.json` wäre unkritisch (es erteilt `can`), aber jede scope-einschränkende
Auditor-Policy im Stil von `auditor-specific-mailbox.json` wäre wirkungslos. **E11 kann nicht
abgenommen werden, solange F7 offen ist** — ein „read-only"-Auditor, der unbeschränkt liest, ist
keine Auditor-Rolle.

**Empfehlung:** `null` von `rulesToQuery` als **deny** behandeln (``sql`1=0` ``, wie es der bereits
vorhandene „No access"-Zweig für das leere Query tut — Einschränkung dazu unter F19), und die
unbeschränkte Rückgabe auf den Fall „nachweislich unbedingtes `can`" beschränken. Zusätzlich
Action-Angleichung zwischen Route-Gate und `FilterBuilder`-Aufruf — **entschieden in ADR-017 als
Variante B**, umzusetzen in `JR-13-03`.

**Reichweite bestätigt (`JR-13-01`, 2026-07-29) — mit zwei Einschränkungen.** Der in ADR-017
angekündigte Nachweis ist erbracht: für die drei (Action, Subject)-Paare, die die vier
`FilterBuilder.create()`-Aufrufstellen verwenden, trifft keine der drei `predefined_*`-Rollen den
`null`-Zweig, und die Ergebnisse für `('archive','read')` und `('archive','search')` sind je Rolle
identisch. Die ADR-017-Änderung ist für eine Standardinstallation damit belegbar wirkungsfrei. Die
Einschränkungen: die Aussage gilt **je Aufrufstelle, nicht je Rolle** (**F18**), und zwei der drei
Rollen werden in einer echten Installation **nie angelegt** (**F17**) — womit ausgeliefert keine
Read-Only-Rolle existiert und jede eingeschränkte Rolle handgeschrieben in der Form von
`auditor-specific-mailbox.json` entsteht, also genau in der Form, die F7 unwirksam macht.

Regressionstests: `tests/integration/filter-builder-f7.int.test.ts` (4 rote, 2 grüne Fälle),
`tests/integration/predefined-roles.int.test.ts` (7 grüne Fälle, der Nachweis für die
Wirkungsanalyse), `tests/unit/filter-builder-call-sites.test.ts` (1 roter Fall für den
Action-Versatz).

## F8 — Der `cannot`-Ausschluss verarbeitet Operator-Bedingungen falsch

**Schwere:** mittel · **Ort:** `packages/backend/src/services/FilterBuilder.ts` ·
**Status:** **behoben** in `JR-13-05` (`2311996`, 2026-07-29) · **Herkunft:** `JR-1-04`

> **Behoben (`JR-13-05`, `2311996`).** Die Negation entsteht auf Query-Ebene (`{ $not: condition }`
> je `cannot`-Regel, alle per `$and` verknüpft) statt durch Einwickeln des **Werts** in `$ne`. `$not`
> komponiert mit jedem Operator, und beide Übersetzer implementieren es bereits. Die drei roten Fälle
> (`$in`, `$nin`, `$gte`) sind grün, der Gegenprobefall für die skalare Bedingung ist grün geblieben.

> **Regressionstests seit `JR-13-01`:** `tests/integration/filter-builder-f8.int.test.ts`, drei rote
> Fälle (`$in`, `$nin`, `$gte` auf einer numerischen Spalte) und ein grüner Gegenprobefall für die
> skalare Bedingung, die schon heute korrekt ausschließt. Die Meili-Hälfte wird strukturell geprüft
> (kein `[object Object]`, die ausgeschlossene ID kommt weiter vor) — es läuft kein Meilisearch in
> dieser Umgebung.

Trifft ein unbedingtes `can` mit `cannot`-Regeln zusammen, baut `FilterBuilder` den Ausschluss so:

```ts
newCondition[key] = { $ne: (condition as any)[key] };
```

Ist der Bedingungswert selbst ein Operator-Objekt, entsteht `{ $ne: { $in: [...] } }`. Beide
Übersetzer verstehen das nicht:

```
mongoToDrizzle → not "ingestion_source_id" = $1   mit Parameter  { "$in": ["…"] }
mongoToMeli    → ingestionSourceId != [object Object]
```

Der Ausschluss, den der Policy-Autor geschrieben hat, findet nicht statt. Betroffen ist jede
`cannot`-Bedingung mit `$in`/`$nin`/`$gte`/… — also genau die ausdrucksstarken.

**Empfehlung:** Negation auf Query-Ebene bilden (`{ $not: condition }` bzw. `$nor`) statt Werte in
`$ne` zu wickeln, und unübersetzbare Formen laut scheitern lassen (siehe F3).

## F9 — `mongoToMeli`-Platzhalter greift nur bei skalarer Bedingung

**Schwere:** niedrig bis mittel · **Ort:** `packages/backend/src/helpers/mongoToMeli.ts` ·
**Status:** offen · **Herkunft:** `JR-1-04`

Die Sonderbehandlung für `ingestionSource.userId` — Auflösung zu
`ingestionSourceId IN [...]` über eine Abfrage auf `ingestion_sources` — liegt im `else`-Zweig und
wird nur bei einem **skalaren** Bedingungswert erreicht. Die gleichwertige explizite Schreibweise
`{ 'ingestionSource.userId': { $eq: id } }` überspringt sie und erzeugt
`ingestionSource.userId = "…"`. Dieses Attribut steht **nicht** in `filterableAttributes`
(`services/SearchService.ts:476`: `from,to,cc,bcc,timestamp,ingestionSourceId,userEmail,hasAttachments`).

Zwei Schreibweisen derselben Policy ergeben also einen funktionierenden und einen nicht erfüllbaren
Filter. **Nicht verifiziert:** ob Meilisearch den Filter ablehnt oder still nichts liefert — im
Container läuft kein Meilisearch. Geprüft ist der emittierte Attributname.

## F10 — Die expandierte `IN`-Liste ist unsortiert

**Schwere:** niedrig · **Ort:** `packages/backend/src/helpers/mongoToMeli.ts` · **Status:** offen ·
**Herkunft:** `JR-1-04`

`select id from ingestion_sources where user_id = …` hat kein `order by`, die erzeugte
Filter-Zeichenkette ist für gleiche Eingaben also nicht stabil. Für Meilisearch selbst irrelevant,
aber die Funktion ist damit als Cache-Key unbrauchbar und gegen ein Golden File nicht vergleichbar.

## Nachtrag zu F4 — betrifft auch `mongoToMeli`

F4 war gegen `mongoToDrizzle` gemeldet. `mongoToMeli` hat dieselbe Form (`Object.keys(value)[0]`),
verliert also ebenfalls die zweite Grenze: `{ timestamp: { $gte: 1, $lte: 5 } }` → `timestamp >= 1`.
Eine bereichsbeschränkende Policy wird damit auf **beiden** Pfaden zu still erweiterten Rechten.

---

## F11 — Die vorgegebene CI-Schrittfolge ist auf einem frischen Checkout nicht lauffähig

**Kategorie:** vorgegebenes Verfahren — **kein Defekt im Produktionscode** ·
**Schwere:** mittel (blockierte jeden CI-Lauf, bis der Schritt ergänzt war) ·
**Ort:** die Schrittfolge in `03-backlog.md`, Task `JR-1-05`; behoben in `.github/workflows/ci.yml` ·
**Status:** **behoben** (2026-07-28, `1bad10c`) · **Herkunft:** `JR-1-05`, erster echter CI-Lauf

Lauf 1 des neuen Workflows (`d0bb792`, Push) wurde bei „Build backend" rot:
**54 × `TS2307: Cannot find module '@open-archiver/types'`**.

Ursache: `@open-archiver/types` wird über `main: dist/index.js` / `types: dist/index.d.ts`
aufgelöst, und `dist` steht in `.gitignore`. Auf einem frischen Checkout existiert es also nicht, und
`pnpm --filter @open-archiver/backend build` zieht die Workspace-Dependency **nicht** mit — nur
`pnpm build:oss` tut das, weil es `./packages/*` filtert und pnpm topologisch ordnet. Betroffen sind
drei der fünf im Task genannten Schritte: Backend-Build, `svelte-check` und `test:types`.

Das ist damit **kein CI-Fehler, sondern eine Lücke der im Task vorgegebenen Schrittfolge.** Kleinste
Korrektur: ein vorgeschalteter Schritt `pnpm --filter @open-archiver/types build`. Die vorgegebenen
Kommandos bleiben wörtlich erhalten; im Job-Log ist sichtbar, welches Paket bricht, wenn eines
bricht.

Warum die lokalen Läufe das verdeckten: `packages/types/dist` lag im Container aus früheren Sessions
bereits gebaut vor. **Lokal beidseitig belegt**, zuletzt in der Abnahme `JR-1-06` (2026-07-28) nach
`rm -rf` **aller** gitignorierten Build-Artefakte (`packages/types/dist`, `packages/backend/dist`,
`packages/frontend/.svelte-kit`, beide `tsconfig.tsbuildinfo`):

- ohne den Schritt: `pnpm --filter @open-archiver/backend build` ⇒ 54 × `TS2307`, Exit 2 — identisch
  zum CI-Log;
- mit dem Schritt: Types-Build, Backend-Build, `svelte-check` (0/0), `test:types` und `pnpm test`
  (181 grün) alle grün.

Der `tsbuildinfo`-Hinweis ist keine Nebensache: `packages/types/tsconfig.json` hat
`composite: true`, ein bloßes Löschen von `dist` lässt `tsc` also wegen der stehengebliebenen
Build-Info **nichts** emittieren. Wer das nachstellen will, muss beides löschen.

> ### Nachtrag 2026-07-31 (`JR-2-06`): dieser Befund wiederholt sich mit **jedem** neuen Workspace-Paket
>
> Sobald `packages/backend` von `@open-archiver/journaling` abhing, war der CI-Lauf an genau derselben
> Stelle rot — `test:types` mit `TS2307: Cannot find module '@open-archiver/journaling'` —, während der
> lokale Lauf grün war, weil ein `dist` aus dem Paketbau herumlag. Dieselbe Ursache, ein Paket weiter.
>
> Behoben mit einem zweiten vorgeschalteten Schritt in `.github/workflows/ci.yml`
> (`pnpm --filter @open-archiver/journaling build`), und **beidseitig belegt** nach dem Löschen von
> `dist` **und** `tsconfig.tsbuildinfo` aller drei Pakete: ohne den Schritt **25 × `TS2307`**, mit ihm
> **0** Fehler.
>
> **Für die nächsten Epics heißt das:** `apps/smtp-ingress` (E4) und `apps/oa-verify` (E9) brauchen
> denselben Schritt, sobald etwas anderes von ihnen abhängt — und wer es vergisst, sieht es **nicht**
> lokal. Beim ersten Nachstellen ist mir genau das passiert: `rm -rf dist` allein ließ auch den
> _types_-Build nichts emittieren, sodass die Messung 30 Fehler zeigte und den Fix zu widerlegen
> schien. Die Build-Info gehört mitgelöscht, sonst misst man etwas anderes als einen frischen Checkout.

**Lehre für künftige Epics:** eine im Backlog vorgegebene Kommandofolge ist eine Annahme, kein
Fakt. Sie gilt erst als lauffähig, wenn sie ohne vorhandene Build-Artefakte durchgelaufen ist.

## F12 — Zwei gleichzeitige Integrationsläufe kollidieren auf einem festen Datenbanknamen

**Kategorie:** Testharness — unsere eigene E1-Arbeit, **kein Bestandsproblem** ·
**Schwere:** mittel (Harness-Defekt; kein Durability- oder Autorisierungsrisiko, CI unberührt) ·
**Ort:** `packages/backend/tests/integration/pg-harness.int.test.ts`, Zeile 212 ·
**Status:** **behoben in `JR-1-04a`, 2026-07-28** (Nachweis unten) ·
**Herkunft:** `JR-1-06` (Abnahme E1), 2026-07-28

Der Test `sweeps a stale database from a dead run but leaves a fresh one alone` legt seine
Fixture-Datenbanken unter **festen** Namen an:

```ts
const stale = 'oa_test_1609459200000_999999_deadaa_sweeptest';
const fresh = `oa_test_${Date.now()}_999999_deadbb_sweeptest`;
```

`stale` enthält keinen prozessspezifischen Anteil. Laufen zwei Integrationsläufe gleichzeitig gegen
**dasselbe** Postgres, scheitert der zweite an

```
PostgresError: duplicate key value violates unique constraint "pg_database_datname_index"
```

**Reproduktion (4 von 4 Versuchen, PostgreSQL 16.13 lokal):**

```bash
pnpm test:integration & pnpm test:integration & wait
```

⇒ ein Lauf `exit=0` (32/32), der andere `exit=1` (`1 failed | 31 passed`). Welcher der beiden
verliert, ist Zeitfrage; dass einer verliert, war in dieser Umgebung nicht vermeidbar.

**Damit ist das Akzeptanzkriterium von `JR-1-04`** — „Zwei Integrationstests können parallel laufen,
ohne sich zu beeinflussen" — **in der prozessübergreifenden Lesart nicht erfüllt.** Innerhalb eines
Laufs hält es (4 Dateien parallel, 32 Tests grün, plus der eigene Testfall
`keeps four concurrent acquisitions apart`). Der in `06-status.md` als Nachweis geführte Satz
„Zwei vollständige Läufe gleichzeitig ⇒ beide `exit=0`, 30/30 bzw. 30/30" ist für den heutigen Code
**widerlegt** — er nennt 30 Tests, die Datei hat 32; der Nachweis kann nur gegen einen früheren
Zwischenstand gelaufen sein.

**Zweiter Kollisionspfad — bei der Nacharbeit dann doch beobachtet.** Der Sweeper schützt
eigene Datenbanken über `Number(match[2]) === process.pid` (`tests/support/pg-harness.ts:257`). Die
Fixtures tragen die **Fremd**-PID `999999`. Der Folgetest `never sweeps a database this process
created` setzt `OA_TEST_PG_STALE_MS = '1'` und ruft `sweepStaleHarnessDatabases()` — er darf damit
die `fresh`-Fixture eines **gleichzeitig** laufenden fremden Prozesses löschen (fremde PID, keine
offenen Verbindungen, Alter > 1 ms). Ein Fix, der nur den festen Namen ändert, lässt diesen Pfad
offen.

Bei der Reproduktion für `JR-1-04a` ist der Pfad **eingetreten**, nicht nur hergeleitet. Runde 2 von
drei Doppelläufen gegen den unveränderten Stand `d2441fb` machte **beide** Läufe rot, mit zwei
verschiedenen Fehlern:

```
Lauf B:  PostgresError: duplicate key value violates unique constraint "pg_database_datname_index"
         → sweeps a stale database from a dead run but leaves a fresh one alone

Lauf A:  Error: Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"
         Caused by: PostgresError: database "oa_test_1785229665275_8980_dc2823_own_not_swept"
                    does not exist        detail: 'It seems to have just been dropped or renamed.'
         → never sweeps a database this process created, whatever the threshold
```

Lauf A hat also seine **eigene, gerade angelegte** Datenbank verloren, weil Lauf B mit
`OA_TEST_PG_STALE_MS = '1'` global gesweept hat. Das ist genau der beschriebene Pfad, und er ist
schlimmer als der Duplicate-Key: die Fehlermeldung zeigt auf `CREATE SCHEMA`, also auf einen
Migrationsschritt, und nicht auf die Ursache. Wer nur den Namen repariert hätte, hätte diesen Lauf
später als Flake abgetan.

**Kein Einfluss auf die CI.** Ein GitHub-Actions-Job fährt einen Lauf gegen einen eigenen
Service-Container; zwei gleichzeitige Jobs haben je eigenes Postgres. Die grünen Läufe sind echt.
Betroffen ist die lokale Nutzung und jede künftige Aufstellung, in der sich mehrere Läufe ein
Postgres teilen (Matrix-Jobs mit gemeinsamem Service, Entwicklerrechner).

**Vorgeschlagene Behebung** (Rolle `tester`, nicht in der Abnahme selbst erledigt, weil eine Abnahme
nichts reparieren darf, was sie prüft): beide Fixture-Namen aus `process.pid` **und** einem
Zufallssuffix bilden — genau wie `harnessDatabaseName()` es tut — und den 2021er Zeitstempel nur als
Alterskennzeichen behalten. Für den zweiten Pfad zusätzlich das Fixture-Paar über ein eindeutiges
Label kenntlich machen und den Sweeper im Test auf dieses Label einschränken, statt ihn global mit
`STALE_MS=1` laufen zu lassen. Danach die prozessübergreifende Parallelität erneut belegen, und
zwar mehrfach — ein einzelner grüner Doppellauf ist bei einem Zeitfensterdefekt kein Nachweis.
**Behoben in `JR-1-04a` (2026-07-28).** Beide Teile, wie in der Abnahme gefordert:

1. **Namen prozessspezifisch.** Neu `buildForeignFixtureName(label, createdAtMs)` in
   `tests/support/pg-harness.ts`. Das PID-Feld des Namens trägt weiter die Fremd-PID
   (`FOREIGN_FIXTURE_PID = 999999`) — es **muss** fremd sein, sonst greift Wächter 1 und der Test
   könnte einen Sweep nie beobachten. Die Eindeutigkeit liegt deshalb im Tag: `process.pid` plus vier
   Zufallsbytes, in dem Namensteil, den der Sweeper nicht interpretiert. Über 63 Byte wird
   **geworfen**, nicht abgeschnitten — Abschneiden würde die Kollision wieder einführen.
2. **Sweeper-Aufruf eingeschränkt.** `sweepStaleHarnessDatabases()` nimmt jetzt
   `{ staleMs?, restrictTo? }`. `restrictTo` filtert **im SQL** (`and d.datname = any($1)`), fremde
   Datenbanken werden also nicht „von einem Wächter verschont", sondern nie gelesen. Und die eine
   gefährliche Kombination ist konstruktiv ausgeschlossen: ein gesenkter `staleMs` **ohne**
   `restrictTo` wirft, statt zu sweepen. Ein eigener Testfall belegt das
   (`refuses a lowered threshold without a restriction`).
3. **Drittes, in der Abnahme nicht genanntes Teilproblem** — der 2021er Zeitstempel der
   `stale`-Fixture. Er liegt jenseits der Standardfrist von 2 h, also hätte der **legitime**,
   unbeschränkte Sweep aus `acquireTestDatabase()` eines fremden Laufs sie weiterhin löschen dürfen,
   auch bei eindeutigem Namen. Die Fixture ist jetzt 60 s alt und der Testsweep benutzt eine Frist von
   10 s — beides weit unter der Standardfrist, damit ein fremder Lauf sie nicht anfassen kann. Das
   `process.env.OA_TEST_PG_STALE_MS`-Setzen im Test ist damit ersatzlos weg; es war prozessglobal und
   hat jeden gleichzeitigen Sweep im selben Prozess mitgesenkt.

Neuer Testfall `cannot touch a database outside restrictTo, however sweepable it looks`: eine
Bystander-Fixture erfüllt **alle drei** Wächter (fremde PID, keine Verbindungen, über der Frist) und
muss trotzdem überleben, weil sie nicht in der Liste steht. Damit ist der Schutz selbst geprüft und
nicht nur benutzt.

**Nachweis (2026-07-28, PostgreSQL 16.13 lokal, Code-Stand des `JR-1-04a`-Commits).** Ein einzelner
grüner Doppellauf ist bei einem Zeitfensterdefekt kein Nachweis, deshalb wiederholt:

```bash
for i in 1 2 3 4 5; do
    ( vitest run --project integration ) & ( vitest run --project integration ) & wait
done
```

| Runde                       | Lauf A            | Lauf B            | `oa_test_*` danach |
| --------------------------- | ----------------- | ----------------- | ------------------ |
| 1                           | `exit=0`, 34 grün | `exit=0`, 34 grün | 0 Zeilen           |
| 2                           | `exit=0`, 34 grün | `exit=0`, 34 grün | 0 Zeilen           |
| 3                           | `exit=0`, 34 grün | `exit=0`, 34 grün | 0 Zeilen           |
| 4                           | `exit=0`, 34 grün | `exit=0`, 34 grün | 0 Zeilen           |
| 5                           | `exit=0`, 34 grün | `exit=0`, 34 grün | 0 Zeilen           |
| 6 (`pnpm test` vollständig) | `exit=0`, 197/2   | `exit=0`, 197/2   | 0 Zeilen           |
| 7 (`pnpm test` vollständig) | `exit=0`, 197/2   | `exit=0`, 197/2   | 0 Zeilen           |

Zusätzlich, gegen einen Zwischenstand desselben Fixes: **drei** gleichzeitige Läufe × 3 Runden und
zwei um 1,5 s versetzte Läufe × 3 Runden, alle 15 Prozesse `exit=0`, keine Rückstände. Am Ende
enthielt der Cluster nur `postgres`, `template0`, `template1`. Zum Vergleich der Ausgangsstand
`d2441fb`: 3 von 3 Runden rot (Runde 2 beidseitig).

**Nicht behoben, weil nicht Teil von F12:** der unbeschränkte Sweep mit der Standardfrist kann
weiterhin die Datenbanken eines fremden Laufs löschen, der **länger als 2 h** läuft. Für die heutige
Suite (5 s) unerreichbar, für die geplanten Soaks in E2/E3 nicht — siehe **F13**.

---

## F13 — Der unbeschränkte Sweep kann einen fremden Lauf treffen, der länger als die Frist läuft

**Kategorie:** Testharness — unsere eigene E1-Arbeit ·
**Schwere:** niedrig heute, **mittel ab E2/E3** (latent; wird erst durch lange Läufe erreichbar) ·
**Ort:** `packages/backend/tests/support/pg-harness.ts`, `sweepStaleHarnessDatabases()` und
`acquireTestDatabase()` · **Status:** **offen** — Regel dokumentiert, konstruktiv nicht ausgeschlossen ·
**Herkunft:** `JR-1-04a`, 2026-07-28

`acquireTestDatabase()` ruft bei **jedem** Aufruf `sweepStaleHarnessDatabases()` ohne `restrictTo`
und mit der Standardfrist von 2 h (`OA_TEST_PG_STALE_MS`). Die einzige Absicherung gegen einen
**fremden** laufenden Prozess ist damit das Alter im Namen: dessen Datenbanken sind jünger als die
Frist. Läuft ein fremder Prozess **länger als die Frist**, sind seine noch benutzten Datenbanken für
diesen Sweep nicht mehr von echtem Rückstand zu unterscheiden — offene Verbindungen schützen sie
nicht, weil `postgres-js` nach `idle_timeout` schließt und Wächter 2 dann null Backends sieht.

Das ist keine Neuentdeckung des Mechanismus — er steht seit `JR-1-04` im Kopfkommentar des Moduls und
in `04-testplan.md` §2.6. Neu ist die Einordnung: mit `JR-1-04a` sind alle anderen
prozessübergreifenden Pfade geschlossen, dieser ist der letzte, und die in E2/E3 geplanten Soaks
(`JR-2-08` 20 × 500 Appends, die 100k-Nachrichten-Nachtläufe) sind der erste Anlass, bei dem ein Lauf
die 2 h überhaupt erreichen kann. Eine bekannte Schwäche im Messinstrument nur in einem Docstring zu
führen, widerspricht Grundregel 6 des Testplans — deshalb steht sie jetzt hier mit einer Nummer.

**Warum nicht in `JR-1-04a` mitbehoben:** die Behebung ist keine Testkorrektur, sondern eine
Verhaltensänderung des Sweepers, und sie hat mindestens drei plausible Formen, zwischen denen der PO
entscheiden sollte:

1. **Lauf-Registry** — jeder Lauf schreibt eine Zeile in eine gemeinsame Tabelle in der
   Maintenance-DB und aktualisiert einen Heartbeat; gesweept wird nur, wessen Heartbeat alt ist.
   Löst es vollständig, führt aber gemeinsamen Zustand in den Harness ein.
2. **Lebenszeichen per PID** — `process.kill(pid, 0)` auf die im Namen kodierte PID; lebt der
   Besitzer, nicht anfassen. Billig, aber nur gültig, wenn alle Läufe auf demselben Host laufen — in
   CI-Matrizen mit gemeinsamem Service-Container gilt das nicht.
3. **Sweepen nur beim ersten `acquire` eines Laufs** plus eine Frist, die aus der erwarteten
   Suite-Laufzeit hergeleitet wird. Reduziert das Fenster, schließt es nicht.

**Zwischenregel bis dahin (in `04-testplan.md` festgehalten):** wer einen Lauf startet, der länger als
`OA_TEST_PG_STALE_MS` dauern kann — jeder Soak in E2/E3 — muss die Variable über die erwartete
Laufzeit heben. Die CI ist unberührt: ein Job hat seinen eigenen Service-Container.

---

## F14 — Die Suite-Inventur wacht über Dateien, nicht über gelaufene Tests

**Kategorie:** Testharness — unsere eigene E1-Arbeit ·
**Schwere:** mittel (kein Kriteriumsbruch, aber genau die Fehlerklasse, gegen die `JR-1-05b` existiert) ·
**Ort:** `tests/support/suite-inventory.ts` zusammen mit `tests/support/classification.ts` ·
**Status:** **behoben** in `b5b2190` (`JR-1-05c`, 2026-07-30) · **Herkunft:** Abnahme `JR-1-06a`, 2026-07-28

`JR-1-05b` hat die zwei in `JR-1-06` gefundenen Löcher geschlossen: eine abwesende Suite und eine
falsch benannte Testdatei machen den Lauf rot. Beide Kriterien sind erfüllt und beidseitig belegt.
Die Prüfung zählt aber **Dateien**, und der Schaden, den sie verhindern soll — „die
`integration`-Abdeckung verschwindet, während CI grün bleibt" — ist ohne jede Datei­änderung
erreichbar.

**Reproduktion (belegt):** in allen vier Dateien unter `packages/backend/tests/integration/`
`suiteRequiring('ci', …)` zu `suiteRequiring('nightly', …)` ändern — ein Token je Datei. Ergebnis:

```
[TEST-INVENTORY] unit: 5 file(s) (min 5) · integration: 4 file(s) (min 4) · adversarial: 1 file(s) (min 1) · unclassified: 0
 Test Files  6 passed | 4 skipped (10)
      Tests  163 passed | 36 skipped (199)
EXIT=0
Suite inventory verified: unit 5/5, integration 4/4, adversarial 1/1, 0 unclassified test files.   ← assert exit=0
```

Die gesamte `integration`-Suite läuft nicht mehr, und **beide** Wächter melden „verifiziert".
`OA_TEST_REQUIRE_INFRA=1` greift nicht: `suiteRequiring()` prüft die Klassenauswahl **vor** der
Infrastruktur und delegiert bei nicht gewählter Klasse an `suite()`, das regulär skippt. Der
Coverage-Hinweis wird gedruckt (`class 'nightly' not selected`), ist aber vom legitimen
Klassen-Skip nicht zu unterscheiden — und genau dieses Nichtunterscheiden ist in `JR-1-05b` bewusst
so gebaut worden.

**Dieselbe Klasse, zweiter Weg:** eine korrekt benannte Datei, deren Tests alle `it.skip` / `it.todo`
sind, zählt voll zur Mindestzahl. Belegt: `197 passed | 3 skipped | 1 todo`, Exit `0`.

**Restlücke am Rand:** die Erkennungsregel `\.(?:test|spec)\.[cm]?[jt]sx?$` spiegelt vitests eigene
Namenskonvention. Eine Datei namens `probe-test.ts`, `probe.tests.ts` oder `probe.integration.ts`
mit `expect(1).toBe(2)` ist für Wächter **und** vitest unsichtbar: Exit `0`, Dateiname nirgends im
Log. Das ist geringer zu gewichten als die beiden Wege oben (niemand benennt so absichtlich einen
Test), gehört aber genannt.

**Mögliche Formen einer Behebung** (Entscheidung nicht Teil dieser Abnahme):

1. **Mindestzahl gelaufener Tests je Suite**, nicht nur Dateien — der Inventurreport trägt die
   Zahlen ohnehin schon durch die CI. Erfasst F14 und F15 gemeinsam.
2. **Klassenzugehörigkeit deklarativ je Suite festschreiben** (z. B. eine Liste „diese Datei ist
   `ci`" neben den Include-Globs), sodass eine Umetikettierung im Diff **und** zur Laufzeit auffällt.
3. **Skip-Budget**: eine Obergrenze übersprungener Tests im `ci`-Lauf, überschritten ⇒ rot.

**Behoben in `JR-1-05c` (`b5b2190`, 2026-07-30) — Variante 1, plus eine Ergänzung.** Der Wächter zählt
jetzt **ausgeführte Tests je Suite _und je Klasse_** (`tests/support/executed-tests.ts`), verglichen mit
`SUITES[].expectedTests`. Je Klasse ist der Teil, der Weg (a) trifft: die Umetikettierung lässt die
Gesamtzahl unverändert und verschiebt die Tests nur in eine Klasse, die die Standardauswahl nicht fährt,
also fällt `expectedTests.ci` der Suite auf 0. Weg (b) fällt auf, weil `skipped`/`todo` nicht als
ausgeführt gelten. Ein Reporter misst, der `globalSetup`-Teardown urteilt und wirft — vitest hat nach
dem Lauf keinen Assertions-Haken; die Messdatei wird vor dem Lauf gelöscht und danach verlangt, sodass
das Entfernen des Reporters rot macht statt abzuschalten.

Beide Zustände am 2026-07-30 gegen PostgreSQL 17.10 gemessen, jeweils **vorher und nachher**:

| Zustand                                | Elternstand `e09b981`       | mit `JR-1-05c`                                  |
| -------------------------------------- | --------------------------- | ----------------------------------------------- | ---------- |
| alle 8 Integrationsdateien → `nightly` | **Exit 0**, beide grün      | **Exit 1**, `integration: ci 0/55`, Dateien 8/8 |
| eine Datei nur `it.skip`               | (Klasse belegt, s. F14 (b)) | **Exit 1**, `integration: ci 52/55`             |
| legitimer Zustand                      | Exit 0                      | Exit 0, `274 passed                             | 2 skipped` |

**Die Restlücke am Rand bleibt offen und ist es wert, genannt zu werden:** eine Datei namens
`probe-test.ts` oder `probe.integration.ts` ist für vitest **und** für beide Wächter unsichtbar. Sie
zählt zu keiner Suite, also senkt sie auch keine Testzahl. Wer so benennt, tut es absichtlich; die
Erkennungsregel bleibt bei vitests Namenskonvention.

## F15 — `minimumFiles` verdeckt eine gelöschte Testdatei, sobald die Suite wächst

**Kategorie:** Testharness — unsere eigene E1-Arbeit ·
**Schwere:** niedrig heute (Spiel = 0), **mittel ab E2** (wird durch jede neue Testdatei erreichbar) ·
**Ort:** `tests/support/suite-inventory.ts`, `SUITES[].minimumFiles` ·
**Status:** **behoben** in `b5b2190` (`JR-1-05c`, 2026-07-30) · **Herkunft:** Abnahme `JR-1-06a`, 2026-07-28

Die Mindestzahlen sind hartkodiert und stehen heute **genau** auf dem Bestand (`unit` 5/5,
`integration` 4/4, `adversarial` 1/1). Deshalb macht jede Löschung heute rot — das ist belegt und
das Kriterium ist erfüllt. Der Wert ist aber eine **Untergrenze**, kein Soll: sobald eine Suite über
ihre Mindestzahl wächst, entsteht Spiel, und eine Löschung in Höhe des Spiels geht still durch.

**Reproduktion (belegt):** eine zusätzliche `integration`-Datei anlegen (⇒ `5 (min 4)`, grün), dann
`pg-harness.int.test.ts` löschen — die eine Datei, die den gesamten `JR-1-04`-Isolationsvertrag
trägt, 13 Tests:

```
[TEST-INVENTORY] … integration: 4 file(s) (min 4) … unclassified: 0
 Test Files  10 passed (10)
      Tests  185 passed | 2 skipped (187)      ← 12 Tests weniger
EXIT=0
Suite inventory verified: … integration 4/4 …  ← assert exit=0
```

Der Kopfkommentar sagt, das Anheben sei „optional". Genau dieses Optional ist der Pflegepfad, auf
dem der Wächter zu wachen aufhört: E2 legt Dateien an, niemand hebt die Zahl, und die erste
Konsolidierung danach verliert Abdeckung, ohne dass etwas rot wird. Behebung sinnvollerweise
zusammen mit F14 (Variante 1 dort deckt beides ab); minimal: die Zahlen als **Gleichheit** statt als
Untergrenze prüfen, mit einer Meldung, die zum Anpassen in derselben Änderung auffordert.

**Behoben in `JR-1-05c` (`b5b2190`, 2026-07-30) — beide vorgeschlagenen Wege, nicht nur einer.**
`minimumFiles` heißt jetzt `expectedFiles` und wird auf **Gleichheit** geprüft; die Testzahlen aus F14
ebenso. Damit gibt es kein Spiel mehr, in dem eine Löschung Platz findet. Der Preis ist genau der
benannte: eine Zahl je Commit, der die Zählung ändert — und beide Fehlermeldungen nennen die
einzutragende Zahl, damit der ehrliche Weg ein Copy-paste ist und nicht eine Suche.

Der Zustand des Befundes selbst nachgemessen: `pg-harness.int.test.ts` (13 Tests) gelöscht **und**
gleichzeitig eine Datei mit einem Test hinzugefügt ⇒ Dateien weiter `8/8` grün, aber
`integration: ci 43/55` und **Exit 1**. Am Elternstand war derselbe Eingriff Exit 0.

## F16 — Rückstand nach einem Modul-Throw wird lokal nicht angekündigt

**Kategorie:** Testharness — unsere eigene E1-Arbeit ·
**Schwere:** niedrig (CI fängt es, lokaler Rückstand verfällt nach 2 h) ·
**Ort:** `packages/backend/tests/support/pg-harness.ts`, `installExitWarning()` ·
**Status:** **behoben** in `b5b2190` (`JR-1-05c`, 2026-07-30) · **Herkunft:** Abnahme `JR-1-06a`, 2026-07-28

Eine `integration`-Datei ruft `acquireTestDatabase()` im **Modul-Scope** — sie muss das, weil
`src/database` sein Singleton beim Import baut (Testplan §2.6). Das Teardown hängt dagegen an einem
`afterAll`. Wirft der Modul-Scope **nach** dem `acquire` — der Alltagsfall eines Tipp- oder
Typfehlers in einer Testdatei, und in E2/E3 wird das häufig passieren — läuft dieses `afterAll` nie
und die Datenbank bleibt liegen.

Dass Rückstand entstehen kann, ist bekannt und vorgesehen; das Modul verspricht dafür ausdrücklich
Sichtbarkeit: „Anything dropped is announced: residue disappearing silently would hide the fact that
an earlier run died", umgesetzt als `process.on('exit')`-Warnung
`process exited with N harness database(s) still present`. **Diese Warnung erscheint in genau diesem
Fall nicht.** Belegt mit einem injizierten `throw` direkt vor dem `suiteRequiring(...)`-Aufruf in
`filter-builder.int.test.ts`:

```
 Test Files  1 failed | 9 passed (10)     EXIT=1
--- did it announce the leak? ---
(nichts)
leftovers after: oa_test_1785250142201_13433_bdeb2d_filter_builder
```

Ursache: der Wurf passiert im geforkten Worker (`pool: 'forks'`), dessen `exit`-Handler nicht auf dem
Weg zur Ausgabe des Hauptprozesses landet. Der Handler selbst wird korrekt **eifrig** installiert
(direkt nach `liveHarnesses.add()`), das ist nicht der Fehler — die Meldung kommt nur nicht an.

**Kein Kriteriumsbruch:** der Lauf ist rot, und in der CI fängt der Schritt
„Assert no leftover test databases" (`if: always()`) den Rückstand und macht den Job rot. Nur
**lokal** verschwindet er lautlos in die 2-h-Frist des Sweepers. Naheliegende Behebung: den Rückstand
im Hauptprozess feststellen statt im Worker — etwa eine `globalTeardown`, die dieselbe Abfrage fährt
wie der CI-Schritt und ihr Ergebnis ausgibt. Das würde zugleich den lokalen Lauf auf dieselbe
Zusicherung heben, die die CI schon hat.

**Behoben in `JR-1-05c` (`b5b2190`, 2026-07-30) — auf dem vorgeschlagenen Weg: der Rückstand wird im
Hauptprozess festgestellt.** Nicht über eine erneute Abfrage aller `oa_test_*`-Namen, sondern über ein
**Ledger-Verzeichnis je Lauf** (`tests/support/harness-ledger.ts`): der Worker schreibt jede geholte
Datenbank hinein und löscht den Eintrag erst, wenn der Drop stattgefunden hat. Was übrig bleibt, ist
**genau** der Rückstand dieses Laufs — die Variante „alles abfragen und die Differenz bilden" hätte die
lebende Datenbank eines fremden, parallelen Laufs für Rückstand halten können, und das war F12.

Der Teardown meldet den Rückstand mit Namen, Label und Worker-PID, **droppt** ihn und macht den Lauf
rot, sofern er nicht absichtlich verengt war. Die `process.on('exit')`-Warnung im Worker bleibt stehen,
mit einem Kommentar, der sagt, dass sie **nicht** die Zusicherung ist — sie spricht nur noch für den
Fall, dass ein Worker stirbt, ohne dass der Lauf den Teardown erreicht.

Nachgemessen mit demselben injizierten `throw` wie im Befund, direkt vor dem `suiteRequiring(...)` in
`filter-builder.int.test.ts`: `Test Files 1 failed | 18 passed`, die Datenbank **namentlich gemeldet**,
gedroppt, danach `leftovers: 0`. Zusätzlich zeigte die F14-Reproduktion (alle acht Dateien auf
`nightly`) **sechs** Rückstände, die vorher lokal lautlos geblieben wären.

## F17 — Zwei der drei „ausgelieferten" Rollen werden in einer echten Installation nie angelegt

**Kategorie:** Bestandscode · **Schwere:** mittel (kein Sicherheitsloch, aber die
Wirkungsanalyse von ADR-017 und die Betreiberanleitung in `JR-13-07` stehen darauf) ·
**Ort:** `packages/backend/src/api/controllers/iam.controller.ts:17`,
`packages/backend/src/services/UserService.ts:231/:252` · **Status:** offen, **nicht behoben** ·
**Herkunft:** `JR-13-01`, gegen echtes Postgres verifiziert

`createDefaultRoles()` — die einzige Stelle, die `predefined_end_user` und
`predefined_read_only_user` anlegt — hat genau einen Aufrufer, und der ist bedingt:

```ts
// api/controllers/iam.controller.ts, getRoles()
if (!roles.some((r) => r.slug?.includes('predefined_'))) {
	await this.createDefaultRoles();
}
```

Bei der Ersteinrichtung ruft `createFirstAdmin()` (`UserService.ts:231`) aber
`createAdminRole()` auf, und das legt die Rolle mit dem Slug **`predefined_super_admin`** an. Damit
ist `roles.some(r => r.slug?.includes('predefined_'))` von diesem Moment an dauerhaft `true` und der
Bootstrap läuft nie. Vorher kann er auch nicht laufen: `GET /roles` liegt hinter `requireAuth`, und
vor der Ersteinrichtung existiert kein Nutzer.

**Nachweis** (`tests/integration/predefined-roles.int.test.ts`, Testfall
`OBSERVED (F17): the real setup order leaves the two default roles uncreated`): nach
`createAdminRole()` und einem anschließenden `getRoles()` enthält die `roles`-Tabelle genau
`[predefined_super_admin]`.

**Folgen:**

1. **ADR-017s Wirkungsanalyse betrachtet drei Rollen; eine Standardinstallation hat eine.** Die
   Analyse bleibt richtig — sie ist nur weiter auf der sicheren Seite als gedacht, weil die beiden
   nicht existierenden Rollen ohnehin keinen `null`-Zweig treffen können.
2. **`JR-13-07`s Prüfanleitung muss das sagen.** „Keine der drei ausgelieferten Rollen ist betroffen"
   liest sich, als gäbe es drei; ein Betreiber, der nach `predefined_read_only_user` sucht, findet
   nichts und weiß nicht, ob das ein Fehler ist.
3. **Es gibt ausgeliefert keine Read-Only-Rolle.** Wer einen eingeschränkten Nutzer braucht — der
   Auditor aus E11, der Prüfer eines Wirtschaftsprüfers — muss die Policy von Hand schreiben, und
   zwar genau in der Form von `auditor-specific-mailbox.json`. Das ist die Form, die F7 ins Gegenteil
   verkehrt. **F7s praktische Schwere steigt damit**, sie sinkt nicht.

**Nicht Teil von E13.** Kein Sicherheitsdefekt, keine Task, und der Fix ist eine Produktänderung
(welche Rollen liefert Open Archiver aus?), keine Härtung. Entscheidung des Auftraggebers.
Naheliegend: die Bedingung auf die konkret fehlenden Slugs prüfen statt auf das Präfix, oder die
Default-Rollen in `createFirstAdmin()` mitanlegen.

## F18 — ADR-017s Aussage über den `null`-Zweig gilt je Aufrufstelle, nicht je Rolle

**Kategorie:** Vorgegebenes Verfahren (Präzision einer ADR-Aussage) · **Schwere:** niedrig ·
**Ort:** `05-entscheidungen.md` ADR-017, Abschnitt „Auswirkung auf die ausgelieferten Rollen"; die
Wiederholung in F7 dieses Dokuments · **Status:** offen · **Herkunft:** `JR-13-01`

ADR-017 formuliert rollenbezogen und unbedingt: „Keine dieser drei Rollen erreicht den `null`-Zweig
in `FilterBuilder.ts:49`". Über das gesamte Vokabular ist das falsch. Gemessen (8 Actions × 7
Subjects, je Rolle, `tests/integration/predefined-roles.int.test.ts`):

| Rolle                       | (Action, Subject)-Paare, die den `null`-Zweig erreichen |
| --------------------------- | ------------------------------------------------------- |
| `predefined_super_admin`    | 0 von 56                                                |
| `predefined_end_user`       | **39** von 56                                           |
| `predefined_read_only_user` | **46** von 56                                           |

Nur `manage: all` erteilt für jedes Paar ein unbedingtes `can`. Die beiden anderen Rollen haben
naturgemäß Paare ohne passende Regel — `create archive` bei einer Read-Only-Rolle etwa — und für die
liefert `rulesToQuery` `null`.

**Harmlos, solange die Aussage richtig gelesen wird:** keine Aufrufstelle baut heute einen Filter für
eines dieser Paare. Für die drei Paare, die die vier `FilterBuilder.create()`-Aufrufe tatsächlich
verwenden, hält die Aussage — siehe die Tabelle unter „Rot-Läufe `JR-13-01`" in `06-status.md`.

**Warum es trotzdem notiert wird:** eine unausgesprochene Vorbedingung wird falsch, sobald jemand
eine fünfte Aufrufstelle mit einer anderen Action ergänzt — `export archive` für den Export aus E11
ist der naheliegende Kandidat. Der Test hält die Vorbedingung jetzt maschinell fest: das
Aufrufstellen-Inventar in `tests/unit/filter-builder-call-sites.test.ts` wird rot, wenn eine fünfte
Stelle auftaucht. **Empfehlung:** ADR-017 und F7 um die Einschränkung „für die Paare der heutigen
Aufrufstellen" ergänzen.

## F19 — Ein `can` mit **leerem** `conditions`-Objekt bedeutet Vollzugriff

**Kategorie:** Bestandscode · **Schwere:** mittel · **Ort:**
`packages/backend/src/services/FilterBuilder.ts:53`, `src/helpers/mongoToDrizzle.ts` ·
**Status:** **behoben** in `JR-13-02` (`a309fd1`) und `JR-13-04` (`45ac0e9`), 2026-07-29 ·
**Herkunft:** `JR-13-01`

> **Behoben.** Zwei voneinander unabhängige Riegel: `FilterBuilder` behandelt ein `undefined` aus dem
> Übersetzer als deny (`a309fd1`), und `mongoToDrizzle` wirft für das leere Bedingungsobjekt, aus dem
> `{ $or: [ {} ] }` besteht (`45ac0e9`). Der `can`-Regel mit `conditions: {}` wird damit kein
> Vollzugriff mehr zugeschrieben; sie wird abgelehnt.

Gefunden beim Schreiben einer Gegenprobe für den vorhandenen „No access"-Zweig, die fehlschlug. Eine
Regel `{ action: 'read', subject: 'archive', conditions: {} }` läuft so durch:

1. `hasUnconditionalCan` ist `false`, denn `!{}` ist `false` — Zeile 31 greift nicht.
2. `rulesToQuery` schiebt die Bedingung in `$or`, weil `{}` truthy ist ⇒ `{ $or: [ {} ] }`.
3. `Object.keys(query).length` ist `1` — der Deny-Zweig in Zeile 53 greift **nicht**.
4. `mongoToDrizzle({ $or: [ {} ] })` ⇒ `or()` über eine leere Liste ⇒ `undefined`.

Ergebnis: kein Filter, also alle Zeilen. Belegt gegen echtes Postgres in
`tests/integration/filter-builder-f1-f3.int.test.ts` (roter Test
`RED UNTIL JR-13-04: a can rule with empty conditions must not mean full access (F19)`).

Eigene Nummer, obwohl es zur F3-Familie gehört: F3 benennt „leeres `$or`/`$and` oder leere Query".
`{ $or: [ {} ] }` ist keine davon, und eine Behebung, die nur `{}` und `{ $or: [] }` abfängt, lässt
diese Form offen.

**Nebenbefund, nicht abgesichert: der Deny-Zweig in Zeile 53 ist womöglich unerreichbar.**
`JR-13-02` soll ihn als Vorlage benutzen („wie der bereits vorhandene ‚No access'-Zweig"). Er feuert
nur, wenn `rulesToQuery` ein **leeres, nicht-`null`** Objekt liefert. Nach der Implementierung von
`@casl/ability/extra` passiert das genau dann, wenn eine nicht-invertierte Regel **ohne** Bedingungen
gefunden wird und keine invertierte mit Bedingungen davor lag — und dieser Fall wird schon von Zeile 31
abgefangen. In keinem der über zwanzig Policy-Zuschnitte, die jetzt unter Test stehen, wurde der Zweig
erreicht. **Nicht bewiesen:** eine Konstruktion, die ihn erreicht, wurde nicht gefunden, und
„unerreichbar" lässt sich mit Tests nicht zeigen. Für `JR-13-02` heißt das: die Vorlage existiert im
Quelltext, aber es gibt keinen laufenden Fall und keinen Test, der sie abdeckt.

## F20 — Ein `cannot` **ohne** Bedingungen wird vollständig ignoriert

**Kategorie:** Bestandscode · **Schwere:** mittel (in der HTTP-Kette durch `requirePermission`
abgefedert, in Serviceaufrufen nicht) · **Ort:**
`packages/backend/src/services/FilterBuilder.ts:27–33` · **Status:** **behoben** in `JR-13-02`
(`a309fd1`, 2026-07-29) · **Herkunft:** `JR-13-01`

> **Behoben (`JR-13-02`, `a309fd1`).** `FilterBuilder` sammelt jetzt zusätzlich die `cannot`-Regeln
> **ohne** Bedingung und antwortet für sie mit deny, bevor der Zweig „unbedingtes `can`" greift. Ein
> pauschales Verbot lässt sich nicht als Filter ausdrücken, also ist deny die einzige richtige Antwort.

Der Ausschlussfilter sammelt nur `cannot`-Regeln, die eine Bedingung tragen:

```ts
const cannotConditions = rules.filter((rule) => rule.inverted === true && rule.conditions);
```

Ein pauschales `cannot read archive` fällt damit heraus, `cannotConditions.length === 0` gilt, und
Zeile 31 antwortet mit **Vollzugriff** — für einen Nutzer, dem die Action ausdrücklich entzogen
wurde. Belegt gegen echtes Postgres (`filter-builder-f1-f3.int.test.ts`, roter Test
`RED UNTIL JR-13-02: an unconditional cannot is not ignored (F20)`).

`ability.can('read', 'archive')` ist für diesen Nutzer `false`, das Route-Gate liefert also `403` —
Verteidigung in der Tiefe ist vorhanden. Trotzdem ist `FilterBuilder`s eigene Antwort falsch, und
`JR-13-02`s Kriterium („unbeschränkte Rückgabe nur noch bei nachweislich **unbedingtem** `can`") ist
nicht erfüllt, solange sie so bleibt: ein widerrufenes `can` ist kein unbedingtes.

## F21 — `JR-13-06`s Allowlist widerspricht drei bestehenden, grünen Pins

**Kategorie:** Vorgegebenes Verfahren · **Schwere:** niedrig (Arbeitsplanung, kein Defekt) ·
**Ort:** `packages/backend/src/helpers/mongoToDrizzle.test.ts` (Suite „column name mapping"),
`packages/backend/tests/fixtures/mongo-to-drizzle-golden.json` Fall „unknown relation key is emitted
as one identifier containing a dot" · **Status:** **erledigt** — strenge Variante entschieden (PO,
2026-07-29) und in `JR-13-06` (`dcec017`) umgesetzt, die drei Pins im selben Commit invertiert ·
**Herkunft:** `JR-13-01`

`JR-13-06` soll Condition-Keys „gegen eine **Allowlist** bekannter Spalten prüfen statt zu escapen".
Das Akzeptanzkriterium spricht nur von Keys mit `"`. Eine echte Allowlist weist aber auch
**unbekannte, syntaktisch harmlose** Keys ab, und drei grüne Assertions halten für genau die das
heutige Verhalten fest: `attachment.name` ⇒ `"attachment.name" = $1`, `foo.bar` ⇒ `"foo.bar" = $1`
(Golden-Datei), sowie die Aussage „resolves only the relations listed in `relationToTableMap`".

Die Regressionstests aus `JR-13-01` fordern **nicht** die Abweisung solcher Keys — bewusst, damit der
Test nicht eine Entscheidung vorwegnimmt, die die Task offenlässt. Zu klären ist also: gilt die
Allowlist nur für Keys mit SQL-Syntax (dann bleiben die drei Pins gültig) oder für alle unbekannten
Keys (dann gehören sie im selben Commit invertiert)? **Empfehlung:** die strenge Variante, mit
Anpassung der drei Pins — ein unbekannter Key ist ein Policy-Fehler und trifft in SQL ohnehin keine
Spalte, führt also entweder zu einem Laufzeitfehler oder zu einem falschen Ergebnis.

**Entscheidung (PO, 2026-07-29): die strenge Variante, der Empfehlung folgend.** Sie war ohnehin schon
im Aufgabentext von `JR-13-06` angelegt — „ein unbekannter Key ist ohnehin ein Fehler und gehört
fail-closed behandelt" lässt die milde Lesart nicht zu. Kein Vorlagebedarf beim Auftraggeber: für
einen Betreiber ändert sich nur, dass ein Tippfehler in einer Policy künftig beim Anlegen auffällt
statt stillschweigend eine Regel ohne Wirkung zu erzeugen. Die drei Pins werden im selben Commit wie
der Fix invertiert, damit kein Zwischenstand existiert, in dem Test und Code sich widersprechen.

**Umgesetzt in `JR-13-06` (`dcec017`, 2026-07-29), mit einer benannten Einschränkung.** Abgewiesen wird
jeder Key mit SQL-Syntax und jeder Key mit **unbekannter Relation** (`attachment.name`, `foo.bar`,
`a.b.c`). Ein einzelner, unbekannter, syntaktisch harmloser Key (`foo`) wird dagegen **weiter
übersetzt**: `mongoToDrizzle` kennt die Zieltabelle nicht, eine spaltengenaue Allowlist ist dort also
nicht formulierbar, und sie hätte drei weitere heute grüne Pins gebrochen (`{a:1}`, `{b:2}`,
`{n:{$gt:1}}` sowie die `FIELDS`-Liste der adversarialen Suite) — was der Auftrag ausdrücklich
ausschloss. Die spaltengenaue Prüfung gehört dorthin, wo das Subject bekannt ist, also in die Nähe von
`JR-13-10`. Die drei Pins sind wie vorgesehen im Fix-Commit invertiert; der Golden-Fall trägt dafür den
eigenen Marker `mustRefuseKey`, damit die von `JR-13-01` assertierte Zahl der drei
`mustFailClosed`-Fälle (F3) unverändert bleibt.

## F22 — F3s `$or`-Beispiel beschreibt die Wirkungsrichtung falsch

**Kategorie:** Vorgegebenes Verfahren · **Schwere:** niedrig, aber irreführend ·
**Ort:** F3 in diesem Dokument, sowie das Akzeptanzkriterium von `JR-13-04` („der `$or`-Fall aus F3
erweitert die Disjunktion nicht mehr") · **Status:** **behoben** in `JR-13-04` (`45ac0e9`), Beschreibung
am 2026-07-29 korrigiert (siehe unten) · **Herkunft:** `JR-13-01`

`{ $or: [ {id:'a'}, {subject:{$regex:'x'}} ] }` ⇒ `"id" = $1`. Beide Texte nennen das eine
Erweiterung der Disjunktion. Gemessen ist `A` **enger** als `A or B`: der Nutzer sieht weniger
Zeilen, nicht mehr. Das ist ein Funktionsdefekt (die gespeicherte Policy bedeutet etwas anderes als
sie sagt), aber fail-**closed**.

Fail-open ist derselbe Mechanismus an zwei anderen Stellen: im `$and` negierter
`cannot`-Bedingungen — dort ist jeder weggelassene Zweig ein weggelassenes Verbot — und wenn **alle**
Zweige verschwinden, weil `or()`/`and()` über eine leere Liste `undefined` liefert.

**Warum das zählt:** wer `JR-13-04` nach dem Kriterium abarbeitet, kann aus „erweitert die Disjunktion"
schließen, der `$or`-Fall sei der gefährliche und die Leerheits-Fälle Randfälle. Es ist umgekehrt.
**Empfehlung:** das Kriterium von `JR-13-04` auf „lässt keinen Zweig stillschweigend weg" umformulieren.

### Korrektur 2026-07-29 — „im `$or` nur verengend" ist selbst zu grob

**Status:** **behoben** in `JR-13-04` (`45ac0e9`); die Beschreibung hier war zweimal ungenau.

Der Abschnitt oben — und in seinem Gefolge die Fassung, die ich am 2026-07-29 in `JR-13-04`s
Akzeptanzkriterium geschrieben habe („weder im `$or` (**dort verengend**, F22) …") — sagt, der `$or`-Fall
sei die harmlose Richtung. Das gilt nur, solange die Disjunktion **oben** in einer
`can`-Komposition steht. Unter einem `$not` kippt sie, und `FilterBuilder` setzt seit `JR-13-05`
**jede** `cannot`-Bedingung genau dort hin (`FilterBuilder.ts:84`):

```ts
query = { $and: cannotConditions.map((condition) => ({ $not: condition })) };
```

Gemessen am Übersetzer vor `JR-13-04` (`git show 45ac0e9^:…`, in einer Wegwerf-Kopie):

```
{ $and: [ { $not: { $or: [ {userEmail}, {subject:{$regex}} ] } } ] }
  ⇒  not "user_email" = $1        beabsichtigt: not ("user_email" = $1 or <unübersetzbar>)
```

`not A` ist wahr für **jede** Zeile, die der weggefallene Zweig verbieten sollte. Ein `cannot`, dessen
Bedingung eine Disjunktion mit einem unübersetzbaren Zweig ist, war damit **fail-open durch den
`$or`-Wegfall selbst** — nicht nur über `$and` und die Leerheits-Fälle. Richtig ist deshalb der
unbedingte Satz: **ein weggelassener Zweig ist nie harmlos, die Richtung hängt von der Komposition ab,
und die kennt der Übersetzer nicht.** Genau deshalb darf `mongoToDrizzle` auch später keinen
milden Modus bekommen (ADR-018).

Keine eigene F-Nummer: es ist derselbe Mechanismus wie F22, nur mit korrekt bestimmter Richtung.
Herkunft der Messung: die Nacharbeit an `JR-13-01` (`704e8d1`).

## F23 — `tsconfig.test.json` und `tsconfig.json` sind sich über globale Augmentierungen nicht einig

**Kategorie:** Testharness — unsere eigene E1-Arbeit · **Schwere:** niedrig ·
**Ort:** `packages/backend/tsconfig.test.json` · **Status:** in `JR-13-01` umgangen, Ursache offen ·
**Herkunft:** `JR-13-01`

Sobald eine Testdatei einen Express-Controller importiert, meldet
`pnpm --filter @open-archiver/backend test:types` Fehler in **unberührtem Produktionscode**:
zehn × `TS2339: Property 't' does not exist on type 'Request'` in `iam.controller.ts`. Der Build ist
davon nicht betroffen.

Ursache: `req.t` kommt aus einem `declare global { namespace Express { … } }` in der `index.d.ts` von
`i18next-http-middleware`. Eine solche Augmentierung wirkt nur, wenn **irgendetwas im Programm** das
Paket importiert. Im Build tut das `src/api/server.ts`; `tsconfig.test.json` schließt
Produktionscode aber absichtlich aus (`include: ["src/**/*.test.ts", "tests/**/*.ts"]`, siehe
Vorschlag 2 unten), also fehlt die Augmentierung. `"types": ["node"]` hilft hier nicht, weil das Paket
keine ambiente Deklaration ausliefert.

Umgangen durch `packages/backend/tests/support/express-i18n-augmentation.d.ts` — ein reiner
Typ-Import ohne Laufzeitwirkung. Das ist eine Behebung des Symptoms. Die Fehlerklasse bleibt: jede
weitere globale Augmentierung, die nur über eine Produktionsdatei ins Programm kommt, fehlt im
Test-Programm ebenfalls, und sie fällt erst auf, wenn eine Testdatei die betroffene Datei importiert.
Für E2 relevant, weil der Receiver eigene Express-Routen bekommt.

## F24 — Ein gefilterter `pnpm test -t "…"` hinterlässt Testdatenbanken

**Kategorie:** Testharness · **Schwere:** niedrig (Entwicklerkomfort, kein Produktdefekt) ·
**Ort:** `packages/backend/tests/support/pg-harness.ts` im Zusammenspiel mit vitests `-t`-Filter ·
**Status:** **behoben** in `b5b2190` (`JR-1-05c`, 2026-07-30) · **Herkunft:** `JR-13-02`–`JR-13-06` (Rolle DEV, 2026-07-29)

`acquireTestDatabase()` wird im **Modul-Scope** der Integrationsdateien aufgerufen, also beim Laden —
und das passiert **vor** der Auswertung des `-t`-Filters. Der Teardown einer Suite, deren Fälle der
Filter alle überspringt, läuft dagegen nicht. Ein gezielter Lauf wie
`pnpm test -t "RED UNTIL JR-13-02"` legt daher `oa_test_*`-Datenbanken an und lässt sie liegen. Ein
**vollständiger** Lauf hinterlässt nachweislich 0.

Nicht gefährlich, aber irreführend: wer nach einem gefilterten Lauf auf Rückstände prüft, findet
welche und sucht den Fehler an der falschen Stelle. Dieselbe Wurzel wie **F16** (Wurf im Modul-Scope
nach `acquireTestDatabase()`) — der Erwerb liegt vor allem, was ihn absichern könnte.

**Gehört nach `JR-1-05c`**, das ohnehin die Messinstrument-Befunde F14–F16 zusammenfasst und **vor E2**
fällig ist. Umgehung bis dahin: nach einem gefilterten Lauf einmal vollständig laufen, oder
`sweepStaleHarnessDatabases()` von Hand aufrufen.

**Behoben in `JR-1-05c` (`b5b2190`, 2026-07-30), zusammen mit F16 — dieselbe Wurzel, dieselbe Lösung.**
Das Ledger sieht die im Modul-Scope geholten Datenbanken unabhängig davon, ob der Filter später alle
Fälle der Datei überspringt. Der Teardown meldet und droppt sie; **rot wird ein gefilterter Lauf davon
nicht** — ein Wächter, der `pnpm test -t` rot macht, ist ein Wächter, den man abzuschalten lernt.

Vorher/nachher mit demselben Kommando (`pnpm test -t "idempotent"`) am 2026-07-30 gemessen:

|                    | Elternstand `e09b981` | mit `JR-1-05c`                            |
| ------------------ | --------------------- | ----------------------------------------- |
| Exit               | 0                     | 0                                         |
| `oa_test_*` danach | **6**                 | **0**                                     |
| Meldung            | keine                 | 6 Namen, Label, Worker-PID, „dropped now" |

Die Umgehung aus dem Befund („nach einem gefilterten Lauf einmal vollständig laufen") ist damit
gegenstandslos.

## F25 — Die Statusaussage „F4 **und F5** sind im Code als bewusst offen kommentiert" ist für F5 falsch

**Kategorie:** Doku über den eigenen Code · **Schwere:** niedrig ·
**Ort:** `06-status.md` („Bewusst nicht angefasst"), `07-session-handover.md` ·
**Status:** **behoben** in `5c8a521` (`JR-13-15`) · **Herkunft:** Abnahme `JR-13-09` (2026-07-29)

> **Behebung (`JR-13-15`, 2026-07-29):** beide Seiten, nicht eine. Die Aussage in `06-status.md` und
> `07-session-handover.md` ist auf F4 eingeschränkt und benennt ausdrücklich, dass der F5-Kommentar
> erst mit `JR-13-15` kam — eine Umschreibung, die eine alte Behauptung durch eine Codeänderung
> nachträglich wahr macht, würde verfälschen, welcher Commit was getan hat. **Zusätzlich** trägt
> `mongoToDrizzle.ts:130–134` jetzt den F5-Kommentar, weil ein Leser von `eq(column, value)` sonst
> nicht erkennen kann, dass `= NULL` bekannt und gewollt offen ist. Prüfung wie im Kriterium:
> `grep -rn "F4\|F5\|finding F" --include=*.ts packages/backend/src/ | grep -v test` findet beide.

Beide Statusdateien behaupten wörtlich: „F4 (nur der erste Operator wird gelesen) und F5
(`{field:null}` ⇒ `= NULL`) sind in `mongoToDrizzle` erhalten und **jetzt mit einem Kommentar als
bewusst offen markiert**". Nachgeprüft am Code:

```
grep -rn "F4\|F5\|finding F" --include=*.ts packages/backend/src/ | grep -v test
  packages/backend/src/helpers/mongoToDrizzle.ts:108:  … (finding F4) and is deliberately left as it is: it is outside E13's scope.
  → kein einziger Treffer für F5
```

**F4 hat den Kommentar** (`mongoToDrizzle.ts:107–108`, direkt über `Object.keys(value)[0]`).
**F5 hat keinen.** Der `{field:null}`-Fall entsteht implizit im `else`-Zweig (`mongoToDrizzle.ts:146`,
`eq(column, value)`), unkommentiert.

**Das Verhalten beider ist unverändert** — unabhängig gemessen, indem der Übersetzer von `efea6bc`
gegen den von `HEAD` auf denselben Eingaben verglichen wurde:

```
{"sizeBytes":{"$gte":1,"$lte":5}}        pre = post = "size_bytes" >= $1        params [1]
{"deletedAt":null}                       pre = post = "deleted_at" = $1         params [null]
{"userEmail":null}                       pre = post = "user_email" = $1         params [null]
{"sizeBytes":{"$gt":1,"$lt":9,"$gte":2}} pre = post = "size_bytes" > $1         params [1]
{"ingestionSource.userId":null}          pre = post = "ingestion_sources"."user_id" = $1  [null]
```

Beide sind zusätzlich durch grüne Golden-Pins festgehalten (`second operator in the same object is
dropped`, `literal null becomes = NULL, not IS NULL`). Es ist also **kein** Code- und **kein**
Verhaltensdefekt, sondern eine unbelegte Aussage über den eigenen Code — genau die Klasse, die
`JR-13-09` gegen den Code prüfen sollte. Behebung: entweder den F5-Kommentar nachziehen oder die
Aussage in beiden Statusdateien auf F4 einschränken.

## F26 — Ein `can` mit **falsy**, aber vorhandenem `conditions` bedeutet weiter Vollzugriff

**Schwere:** mittel (Voraussetzung: Rollenschreibrecht, also Super Admin — dieselbe Vorbedingung wie
F1) · **Ort:** `packages/backend/src/services/FilterBuilder.ts:51–53`,
`packages/backend/src/iam-policy/policy-validator.ts:76` ·
**Status:** **Schreibseite behoben** in `cfb1462` (`JR-13-13`), **Laufzeitseite offen** (`JR-13-11`) ·
**Herkunft:** Abnahme `JR-13-09` (2026-07-29)

> **Behebung, halb (`JR-13-13`, 2026-07-29):** `PolicyValidator.isValid()` prüft die Form von
> `conditions` selbst über `checkConditionsShape()` — `conditions` muss ein Objekt sein oder fehlen,
> Skalar, Array und `null` werden **beim Anlegen** mit `400` abgewiesen. Eine solche Policy kann also
> nicht mehr neu entstehen. **Bewusst nicht geändert:** das Verhalten für **bereits gespeicherte**
> Policies dieser Form. `FilterBuilder.ts:51–53` liest weiter `!rule.conditions`, also bleibt ein
> gespeichertes `conditions: null` / `""` / `0` / `false` unbeschränkt — das ist ADR-016s Familie und
> gehört zu `JR-13-11`. Gemessen (Übersetzer `efea6bc` gegen HEAD, rein, ohne DB): für die falsy
> Familie entscheidet `FilterBuilder` vor dem Übersetzer, das Ergebnis ist vor und nach E13
> `UNRESTRICTED`. Die Betreiber-SQL aus `JR-13-14` meldet beide Hälften.

`JR-13-02` hat **F19** behoben: ein `can` mit `conditions: {}` gilt nicht mehr als unbedingt. Die
Prüfung ist aber eine **Truthiness**-Prüfung (`!rule.conditions`), und `{}` ist das einzige _truthy_
Mitglied dieser Familie. Jeder falsy Wert wird weiter als „unbedingtes `can`" gelesen und liefert
`{ drizzleFilter: undefined, searchFilter: undefined }` — Vollzugriff. Gegen echtes Postgres 16.13
gemessen, eine Rolle je Variante, `('archive','read')`:

```
validator=ACCEPT | THROWS (deny)                              | conditions: {}      (F19, behoben)
validator=ACCEPT | UNRESTRICTED (2 von 2 Zeilen erreichbar)   | conditions: ""
validator=ACCEPT | UNRESTRICTED (2 von 2 Zeilen erreichbar)   | conditions: 0
validator=ACCEPT | UNRESTRICTED (2 von 2 Zeilen erreichbar)   | conditions: false
validator=ACCEPT | UNRESTRICTED (2 von 2 Zeilen erreichbar)   | conditions: null
validator=ACCEPT | THROWS (deny)                              | conditions: 5
validator=ACCEPT | THROWS (deny)                              | conditions: "userEmail"
```

`PolicyValidator` prüft die Keys hinter `if (policy.conditions)`, also **gar nicht** für einen falsy
Wert — die Policy ist über `POST /roles` speicherbar.

**Kein Regress:** vor und nach E13 identisch (`FilterBuilderPre` gegen `FilterBuilder` auf derselben
Rolle, beide `UNRESTRICTED`). Aber es ist dieselbe Familie, die **ADR-016** beseitigen soll: „kein
Recht auf dieses Subject" und „darf alles sehen" dürfen nicht vom selben Wert dargestellt werden. Für
`conditions: null` ist Vollzugriff vertretbar („keine Bedingung"); für `""`, `0` und `false` ist es
ein stillschweigend erweitertes Recht aus einer offensichtlich fehlerhaften Policy.

**Bricht kein Akzeptanzkriterium von `JR-13-02`** (dessen Kriterien nennen
`auditor-specific-mailbox.json` und den Nutzer ohne Rolle, beide erfüllt). Vorschlag: zusammen mit
`JR-13-11` behandeln — dort wird `conditions` ohnehin schärfer geprüft. PO entscheidet über den Ort.

## F27 — Query 2 der Betreiberanleitung hat **falsch-negative**: `conditions` als Skalar oder Array wird nicht gefunden

**Kategorie:** veröffentlichte Betreiberdokumentation · **Schwere:** mittel ·
**Ort:** `docs/user-guides/upgrade-and-migration/access-control-changes.md`, Query 2 **und** Query 3,
jeweils die `cond`-CTE · **Status:** **behoben** in `c17144e` (`JR-13-14`) ·
**Herkunft:** Abnahme `JR-13-09` (2026-07-29)

> **Behebung (`JR-13-14`, 2026-07-29):** beides, wie vom PO entschieden.
>
> 1. **Query 2 hat einen eigenen Befundtyp** `conditions is not an object`, gespeist aus `pair`
>    (nicht aus `cond`, denn es gibt in einem Skalar keine Keys zu begehen). Die Detailzeile gibt den
>    Wert wörtlich aus und unterscheidet die beiden Lesarten: falsy (`null`, `false`, `0`, `""`) ⇒
>    „gilt als keine Bedingung, wie vorher", alles andere ⇒ „gilt als unübersetzbare Bedingung, die
>    Anfrage wird verweigert, wo sie vorher unbeschränkt oder ein Fehler war".
> 2. **Der Absolutsatz ist ersatzlos weg.** An seiner Stelle steht „How to read an empty result" mit
>    zwei Listen — was die Abfragen prüfen und was nicht — und der ausdrücklichen Begründung, dass
>    eine Abfrage über schemaloses JSONB gegen unbekannte Formen nicht beweisbar vollständig sein
>    kann. Ein neuer Absolutsatz ist bewusst **nicht** an seine Stelle getreten.
>
> Zusätzlich als **Änderung 8** dokumentiert: ein `conditions`, das kein Objekt ist, wird beim
> Speichern abgewiesen (`JR-13-13`); die Lesart bereits gespeicherter Policies ist unverändert, und die
> Seite sagt, welche davon weiter unbeschränkt sind und welche jetzt verweigert werden.
>
> **Beleg:** die ` ```sql `-Blöcke aus der veröffentlichten Datei extrahiert und **wörtlich** gegen
> PostgreSQL 16.13 gefahren, 29 gesäte Rollen. Falsch-negativ-Prüfung nach der Methode aus
> Fallstrick 15: jeder `conditions`-Wert, dessen Übersetzung sich zwischen `efea6bc` und HEAD
> unterscheidet, wird von einer der Abfragen gemeldet — 0 Ausnahmen. Die drei `predefined_*`, die
> Kontrolle `C1` und eine Sonde mit einer Regel, die kein Objekt ist, erscheinen in **keiner**
> Ausgabe.

Beide `cond`-CTEs sind auf `jsonb_typeof(… -> 'conditions') = 'object'` gefiltert. Ein `conditions`,
das ein **Skalar** oder ein **Array** ist, ist damit für beide Abfragen unsichtbar — obwohl sich das
Verhalten ändert. Die Blöcke wurden **aus der veröffentlichten Markdown-Datei extrahiert und wörtlich**
gegen ein echtes PostgreSQL 16.13 mit 25 gesäten Rollen ausgeführt; parallel wurde die Anwendung vor
(`efea6bc`) und nach E13 auf derselben Policy gemessen:

```
CHANGED  pre=SQL-ERROR     post=THROWS(deny)  docQuery=SILENT  | conditions: "userEmail"  (String)
CHANGED  pre=SQL-ERROR     post=THROWS(deny)  docQuery=SILENT  | conditions: [ {...} ]    (Array)
CHANGED  pre=UNRESTRICTED  post=THROWS(deny)  docQuery=SILENT  | conditions: 5            (Zahl)
CHANGED  pre=UNRESTRICTED  post=THROWS(deny)  docQuery=reports | conditions: {}           (Kontrolle)
```

**Der dritte Fall ist der gefährliche.** `conditions: 5` ist vor E13 **unbeschränkter Zugriff auf das
ganze Archiv** und danach eine Verweigerung — das ist wörtlich die Kopfzeile von Änderung 1 („a user
who previously saw everything through such a role now sees nothing"). Die Anleitung sagt dazu:

> **No rows means no role in your installation is affected by the changes numbered 1 to 7 above.**

Dieser Satz ist mit einem Gegenbeispiel widerlegt. Ein Betreiber mit genau dieser Rolle liest „nicht
betroffen" und verliert nach dem Update den Zugriff, ohne Vorwarnung.

**Einschränkung, damit die Schwere nicht überzeichnet wird:** ein skalares `conditions` ist eine
**fehlerhafte** Policy, keine übliche. Die Eintrittswahrscheinlichkeit ist niedrig. Falsch ist die
**Unbedingtheit** der Zusage, nicht die Nützlichkeit der Abfrage: sie findet 13 von 13 absichtlich
betroffenen Formen und meldet keine der vier Gegenproben. Behebung: `cond` auf jedes `conditions`
ausdehnen, das existiert und nicht `object` ist, und einen eigenen Befundtyp dafür ausgeben — oder den
Absolutsatz entschärfen.

## F28 — Query 3 prüft Keys nicht für Regeln mit `subject: "all"`

**Kategorie:** veröffentlichte Betreiberdokumentation · **Schwere:** niedrig bis mittel ·
**Ort:** `docs/user-guides/upgrade-and-migration/access-control-changes.md`, Query 3, CTE `resolved` ·
**Status:** **behoben** in `c17144e` (`JR-13-14`) · **Herkunft:** Abnahme `JR-13-09` (2026-07-29)

> **Behebung (`JR-13-14`, 2026-07-29):** die `CASE`-Kette in `resolved` ist durch einen Join auf eine
> neue CTE `subject_table (subject, table_name)` ersetzt, die `all` auf **beide** Tabellen abbildet
> (`archive`→`archived_emails`, `ingestion`→`ingestion_sources`, `all`→beide). `resolved` ist
> `SELECT DISTINCT`, weil ein relationspräfigierter Key sonst zwei identische Zeilen ergäbe.
>
> **Gemessen:** die gesäte Rolle `A02 typo key under manage all` erzeugt jetzt zwei Zeilen
> (`archived_emails.user_emial`, `ingestion_sources.user_emial`), vorher keine. Eine nur unter `all`
> auftretende Randlage ist dabei sichtbar geworden und ist kein Falsch-positives: `manage all` mit
> `{"userEmail": …}` wird für `ingestion_sources` gemeldet, weil dort keine Spalte `user_email`
> existiert — die Regel funktioniert fürs Archiv und lässt die Ingestion-Liste scheitern. Die Seite
> erklärt das ausdrücklich.
>
> **Nebenbefund derselben Änderung, korrigiert vor dem Commit:** ein `ELSE st.table_name` ohne
> Segmentzahl-Wächter machte aus `foo.bar` fälschlich `archived_emails.bar`. Der Wächter
> `array_length(...) = 1` und `WHERE table_name IS NOT NULL` sind wieder da; ein nicht auflösbares
> Relationspräfix ist ein Formbefund von Query 2, nicht ein Spaltenbefund von Query 3.

`resolved.table_name` wird nur für `subject = 'archive'` bzw. `'ingestion'` gesetzt und die
Ergebniszeile über `WHERE table_name IS NOT NULL` verworfen. Eine Regel mit `subject: "all"` filtert
aber sehr wohl das Archiv, weil `FilterBuilder`/CASL `all` auf jedes Subject abbildet. Gemessen:

```
Rolle: [{"action":"manage","subject":"all","conditions":{"userEmial":"x@example.com"}}]
  Anwendung vor E13:  SQL-ERROR      (Spalte user_emial existiert nicht)
  Anwendung nach E13: SQL-ERROR      (unverändert)
  Query 3:            keine Zeile
  Query 2:            keine Zeile
```

Zum Vergleich findet Query 3 denselben Tippfehler zuverlässig, sobald das Subject `archive` ist:
`A11 typo column name | 1 | archive | userEmial | archived_emails | user_emial`.

Die Anleitung **benennt** die Grenze („The application does not perform this check. The query does,
and only for those two subjects."), aber ein Leser schließt daraus nicht, dass eine `manage all`-Regel
herausfällt — `all` **ist** für ihn diese beiden Subjects. Behebung: `subject = 'all'` auf beide
Tabellen abbilden (zwei Zeilen je Key) oder die Grenze ausdrücklich mit `all` benennen.

## F29 — `PolicyValidator` und `mongoToDrizzle` sind sich über die erlaubte Key-Form nicht einig

**Schwere:** niedrig (fail-closed, kein Injektionsweg) · **Ort:**
`packages/backend/src/iam-policy/policy-validator.ts` `areConditionKeysValid()` gegen
`packages/backend/src/helpers/mongoToDrizzle.ts` `getDrizzleColumn()` ·
**Status:** **behoben** in `cfb1462` (`JR-13-13`) · **Herkunft:** Abnahme `JR-13-09` (2026-07-29)

> **Behebung (`JR-13-13`, 2026-07-29):** nicht „dieselbe Regel zweimal richtig geschrieben", sondern
> **ein** Prädikat. `packages/backend/src/helpers/conditionKey.ts` ist ein Modul, das **nichts**
> importiert, und besitzt `relationToTableMap`, `resolveConditionKey()`, `isConditionOperatorKey()`
> und `checkConditionsShape()`. Beide Gates fragen es: `PolicyValidator.areConditionKeysValid()` und
> `mongoToDrizzle.getDrizzleColumn()`.
>
> **Warum dort:** der Validator darf `mongoToDrizzle` nicht importieren, sonst zieht er `drizzle-orm`
> in eine Klasse, die heute nur Typen importiert — und damit in jeden Unit-Test, der eine Policy
> validiert. Umgekehrt hat ein SQL-Übersetzer nichts im IAM-Policy-Modul zu suchen, und
> `relationToTableMap` gehört neben den Code, der einen Tabellennamen rendert. Also ein drittes,
> abhängigkeitsfreies Modul in `helpers/`, neben dem Übersetzer.
>
> **Neuer Test:** `packages/backend/tests/unit/condition-key-gates.test.ts` schickt **jeden** Key
> durch **beide** Gates und stellt die Urteile nebeneinander — die Konstruktion aus Fallstrick 16.
> Jeder Fall nennt zusätzlich das erwartete Urteil, weil „beide sind sich einig" auch von zwei
> gleichsinnig kaputten Gates erfüllt wird. 20 Keys, 9 `conditions`-Formen.
>
> **Die drei Restspalte sind als grüne Assertions festgehalten**, nicht als Kommentar — genau das hat
> F29 stehen lassen: Spaltenexistenz (`foo`, ADR-019, `JR-13-11`), Operatornamen (`$regex` — SQL- und
> Suchübersetzer haben verschiedene Mengen, eine Schreibzeit-Allowlist könnte mit keiner der beiden
> übereinstimmen) und `conditions: {}` (ein Objekt, also speicherbar; bei Benutzung verweigert).
>
> **Ein vorher grüner Pin ist getroffen und ersetzt:** `policy-validator.test.ts` „accepts conditions
> it does not understand" behauptete, `a.b.c` werde akzeptiert. Er dokumentierte die Lücke; die Hälfte
> zum unbekannten Operator bleibt, die Hälfte zum Key ist umgedreht, mit Begründung im Test.

Der Validator akzeptiert **beliebig viele** punktgetrennte Identifier-Segmente und **jede**
Relation; der Übersetzer akzeptiert höchstens zwei Segmente und nur Relationen aus
`relationToTableMap`. Gemessen, beide Gates auf demselben Key:

```
key="foo"                       validator=ACCEPT  mongoToDrizzle=TRANSLATED   (ADR-019-Restspalt, JR-13-11)
key="a.b.c"                     validator=ACCEPT  mongoToDrizzle=REFUSED      ← Divergenz
key="attachment.name"           validator=ACCEPT  mongoToDrizzle=REFUSED      ← Divergenz
key="foo.bar"                   validator=ACCEPT  mongoToDrizzle=REFUSED      ← Divergenz
key="ingestionSource.userId"    validator=ACCEPT  mongoToDrizzle=TRANSLATED
key="id\" or 1=1 --"            validator=REJECT  mongoToDrizzle=REFUSED
```

Folge: eine Rolle mit `attachment.name` wird mit **HTTP 200** gespeichert und macht danach jede über
`FilterBuilder` gescopte Anfrage dieser Rolle unbrauchbar. Fail-closed, also kein Sicherheitsproblem —
aber zwei Aussagen sind damit falsch:

1. **Die veröffentlichte Doku behauptet das Gegenteil.** `access-control-changes.md` §6: „**Saving** a
   role whose condition key is not of that shape fails with HTTP `400` and a message naming the key",
   und „Only `ingestionSource` resolves as a relation prefix. A two-part key with any other prefix, and
   a key with more than two parts, is **refused**." Die Form ist dort als „column name, optionally
   prefixed by a **resolvable** relation" definiert — `attachment.name` erfüllt sie nicht und wird beim
   Speichern trotzdem angenommen.
2. **`JR-13-06`s Akzeptanzkriterium** endet auf „Relationszweig ebenso; `PolicyValidator` weist solche
   Policies **beim Anlegen** ab". Für den Relationszweig und für Keys mit mehr als zwei Segmenten tut
   er das nicht.

**Nicht von ADR-019 gedeckt.** ADR-019 nimmt ausdrücklich nur die **Spaltenexistenz** aus (`foo`) und
begründet das damit, dass `mongoToDrizzle` subjektagnostisch ist. Die Relation kennt der Validator
dagegen genauso gut wie der Übersetzer — `relationToTableMap` ist eine Konstante. Behebung ist klein:
`areConditionKeysValid()` auf ≤ 2 Segmente und auf `relationToTableMap` prüfen, dann sind beide Gates
deckungsgleich und die Doku stimmt wieder.

## F30 — Die Betreiberabfrage prüft die Form von `conditions` nur an der **Wurzel**, der Übersetzer an **jedem Knoten**

**Kategorie:** veröffentlichte Betreiberdokumentation · **Schwere:** mittel ·
**Ort:** `docs/user-guides/upgrade-and-migration/access-control-changes.md`, Query 2 (Befundtyp
`empty conditions object` und `conditions is not an object`) sowie der Abschnitt „How to read an
empty result" · **Status:** **behoben** in `JR-13-17` (2026-07-29) · **Herkunft:** Abnahme `JR-13-09a`
(2026-07-29)

`JR-13-14` hat **F27** für die Wurzel behoben: ein `conditions`, das existiert und kein Objekt ist,
wird gemeldet. Die Prüfung, die `mongoToDrizzle` seit `JR-13-13` vornimmt, gilt aber **rekursiv** —
`checkConditionsShape()` läuft in jedem `$or`/`$and`/`$not`-Zweig erneut, und ein leerer
Bedingungsknoten wird auf jeder Ebene mit `the condition object is empty` abgewiesen. Query 2 prüft
beides nur an der Wurzel: der Befundtyp `conditions is not an object` speist sich aus `pair`
(`p.rule -> 'conditions'`), der Befundtyp `empty conditions object` aus `p.rule -> 'conditions' =
'{}'::jsonb`. Beide sehen keinen **verschachtelten** Knoten, obwohl die rekursive CTE `cond` daneben
liegt.

Gemessen mit `FilterBuilder` von `efea6bc` gegen den von `HEAD` im selben Prozess, gegen echtes
PostgreSQL 16.13 mit den 41 Migrationen, 54 gesäte Rollen, Paar `('archive','read')`; die drei
` ```sql `-Blöcke wörtlich aus der veröffentlichten Datei extrahiert:

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

Die ersten vier sind die gefährliche Richtung: **vor** dem Update sieht die Rolle das ganze Archiv
bzw. alle Zeilen, **danach** scheitert jede Anfrage, die die Policy braucht — wörtlich die Kopfzeile
von Änderung 1 („a user who previously saw everything through such a role now sees nothing"). Zur
Gegenprobe: `{"$and": []}` und `{"$or": []}` **werden** gemeldet, ebenso jeder Formfehler an einem
**Key** in beliebiger Tiefe (`{"$or": [{…}, {"attachment.name": "v"}]}`), und die drei
`predefined_*`-Rollen sowie drei unbetroffene handgeschriebene Kontrollen erscheinen in **keiner**
Ausgabe. Der Ausfall betrifft genau die Knotenform, nicht die Rekursion an sich.

**Zwei Sätze der veröffentlichten Seite sind damit widerlegt** — das ist der eigentliche Befund, denn
eine unvollständige Abfrage mit ehrlicher Grenzangabe wäre vertretbar:

1. Unter „It examines": _„a `conditions` that **is** an object, walked recursively through nested
   objects and arrays: **the empty object**, operator keys, condition key shapes, and empty
   `$or`/`$and` branch lists."_ Der leere Objektknoten wird **nicht** rekursiv geprüft, sondern nur
   an der Wurzel. Ein Betreiber mit `{"$or": [{"userEmail": "a@x"}, {}]}` liest hier „ist abgedeckt",
   erhält keine Zeile und verliert nach dem Update den Zugriff dieser Rolle.
2. Unter „It does not examine": _„the values inside a condition. A condition on the right column with
   the wrong value is a policy mistake, but **not one this release changes**."_ Das ist für
   `{"userEmail": {}}` falsch, und in die beruhigende Richtung falsch: richtige Spalte, falscher Wert,
   und die Wirkung kippt von „alle Zeilen sichtbar" auf „jede Anfrage scheitert".

**Kein Codedefekt.** Das Laufzeitverhalten ist fail-closed und richtig; F30 liegt ausschließlich in
der betreibersichtbaren Hälfte. **Kein Regress gegenüber `JR-13-09`:** die Vorher/Nachher-Tabelle aus
`JR-13-14` (17 `conditions`-Werte an der Wurzel) hält vollständig — alle acht Formen hier sind
verschachtelt und standen in keiner der bisher geprüften Listen.

**Bricht `JR-13-07`s Akzeptanzkriterium** („ein Betreiber kann **vor** dem Update feststellen, welche
seiner Rollen betroffen sind") und die PO-Vorgabe zu `JR-13-14` („die Abfragen decken alle **heute
bekannten** Formen ab, und das Dokument sagt genau, welche das sind") — die Knotenform ist seit
`JR-13-13` bekannt, sie steht im Prädikat, das beide Gates benutzen. `JR-13-14`s eigene, engere
Kriterien sind erfüllt.

**Behebung ist klein und liegt an einer Stelle:** in Query 2 die beiden Formbefunde aus `cond` statt
aus `pair` speisen (die CTE trägt den Knoten in `node` schon mit) — ein `jsonb_typeof(c.node)`, das
weder `object` noch ein Operandenwert ist, plus `c.node = '{}'::jsonb` für jeden Knoten, nicht nur
für die Wurzel. Dazu die zwei zitierten Sätze berichtigen. Solange das offen ist, darf die Seite den
leeren Objektknoten nicht als geprüft aufführen.

### Behoben in `JR-13-17` (`07ac661`, 2026-07-29) — und der Anspruch ist mit weg (ADR-020)

**(a) Die zwei Formbefunde stehen auf Knotenebene.** Query 2s `cond` trägt jetzt eine Spalte `path`
(Wurzel `"conditions"`, Objektkind `-> "key"`, Arrayelement `-> []`), und die Befunde speisen aus
`cond`:

| Befundtyp                               | Prädikat                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `empty condition object`                | `c.node = '{}'::jsonb` — **jede** Position, Wurzel eingeschlossen (ersetzt `empty conditions object`)         |
| `condition node is not an object`       | Element eines `$or`/`$and`-Arrays bzw. Rumpf eines `$not` mit `jsonb_typeof <> 'object'`                      |
| `condition branch list is not an array` | `$or`/`$and`, dessen Wert kein Array ist                                                                      |
| `conditions is not an object`           | **unverändert** an der Wurzel, mit den zwei Lesarten je Wert (der Wert wird nicht betreten — Array bleibt so) |

Die Prädikate sind aus `checkConditionsShape()`/`mongoToDrizzle` abgeleitet, nicht geraten: geprüft
wird nur ein Knoten, der als **Bedingungsobjekt** gelesen wird. Ein pauschales
„`jsonb_typeof(node) <> 'object'`" wäre der Fehler aus Fallstrick 20 gewesen — es hätte jedes Blatt
jeder normalen Bedingung gemeldet.

**Nachweis, Blöcke wörtlich aus der `.md` extrahiert, PostgreSQL 16.13 mit den 41 Migrationen,
26 gesäte Rollen:** alle **acht** F30-Formen werden gemeldet, je mit Position
(`"conditions" -> "$or" -> [] -> "$and" -> []`); Gegenprobe `{"$or": []}`/`{"$and": []}` weiter
gemeldet, ebenso `conditions: 5`, `conditions: {}` und die Key-Formbefunde. **Keine Falsch-positiven:**
die drei `predefined_*`-Rollen und acht Kontrollen (`{"userEmail":"a@x"}`, `{"id":{"$in":[…]}}`,
`{"ingestionSource.userId":"…"}`, ein `can` mit Operator, `$or` aus Objekten, verschachteltes
`$and`/`$or`, `$not` um eine Gleichheit, unbedingter Grant) erscheinen in **keiner** der drei
Ausgaben — maschinell verglichen, nicht gelesen. Eine `cannot`-Regel mit Operator liefert genau die
**beabsichtigte** Zeile `prohibition with an operator condition` (Änderung 5) und **keinen** Formbefund.

**Gegen den Übersetzer gekreuzt** (`dist/helpers/mongoToDrizzle.js`, 37 Bedingungswerte): jede von
`mongoToDrizzle` **verweigerte** Form wird von Query 2 gemeldet, mit einer bewusst dokumentierten
Ausnahme, und jede **übersetzbare** Form schweigt, mit einer:

- `conditions: 5` an einer Regel für ein Subject, für das **kein** Zeilenfilter gebaut wird
  (`read settings`), wird **nicht** gemeldet — der Wurzelbefund ist wie bisher an `pair` gebunden. Das
  ist richtig: dort ändert sich kein Verhalten. Die Seite sagt das jetzt ausdrücklich.
- `{"id": {"$in": [{}]}}` **wird** gemeldet, obwohl der Übersetzer es akzeptiert: ein leeres Objekt in
  einer **Operandenliste** ist keine Bedingung. Bewusst in Kauf genommen — die Regel „leerer
  Objektknoten in jeder Position" ist die Vorgabe, die Position steht in der Meldung, und die Policy
  ist ohnehin unsinnig. Über-, nicht Untermeldung.

**(b) Der Abdeckungsanspruch ist weg — das ist der eigentliche Fix.** „It examines" ⇒ „What it
reports"; das Wort „recursively" steht nicht mehr als Zusage; der widerlegte Satz „the values inside a
condition … not one this release changes" ist ersetzt (ein Wert, der selbst eine **Struktur** ist,
ändert die Wirkung und wird gemeldet); ausdrücklich ergänzt, dass eine Abfrage über schemaloses JSONB
**nicht als vollständig gezeigt werden kann** und ein leeres Ergebnis ein **Hinweis, keine Freigabe**
ist. An die Stelle der Zusage tritt eine **verifizierbare Gegenprobe ohne Aufzählung von JSON-Formen**:
je eingeschränkte Rolle vor dem Update zwei Zahlen notieren (Archivliste, eine Suche), nach dem Update
oder auf einer Kopie erneut messen, vergleichen — plus der Hinweis, dass eine unübersetzbare Bedingung
jetzt einen **Fehler** erzeugt statt still ein falsches Ergebnis.

Vier weitere Abdeckungssätze derselben Klasse standen auf der Seite und sind mit ersetzt: „lists
**every** shape of policy this affects", „to **find out which** of your roles behave differently", „the
third query below is what **covers** this case" und „Query 3 below **covers** that". Zusätzlich sagt die
Seite jetzt, was sie vorher offenließ: der Wurzel-Formbefund ist an (Action, Subject) gebunden, die
Befunde **innerhalb** von `conditions` nicht; und die Formprüfung beim Speichern (`400`) gilt nur für
das `conditions` der Regel selbst, ein verschachtelter Formfehler fällt erst zur Abfragezeit auf.

**Kein Produktionscode, kein Test, keine Migration.** `conditionKey.ts` war die Referenz, nicht das
Ziel. Suite unverändert `250 passed | 2 skipped`, Exit 0.

## F31 — Der Verhaltenscheck behauptet die Vollständigkeit, die der Abfrage genommen wurde

**Kategorie:** veröffentlichte Betreiberdokumentation · **Schwere:** mittel ·
**Ort:** `docs/user-guides/upgrade-and-migration/access-control-changes.md:625–632`, `:621–623` und
`:498–500`, alle drei von `JR-13-17` neu geschrieben · **Status:** offen, Behebung in `JR-13-18` ·
**Herkunft:** Abnahme `JR-13-09b` (2026-07-29) · **Ursache:** ADR-020 selbst, siehe deren Berichtigung

`JR-13-17` hat den Abdeckungsanspruch der **Abfrage** gestrichen — korrekt und unabhängig belegt. Er ist
dabei nicht verschwunden, sondern auf den **Verhaltenscheck** gewandert, den dieselbe Task neu
geschrieben hat. Die tragende Stelle:

> `3. **Compare them.** … A role whose numbers are unchanged is not affected, whatever the queries did
or did not report about it.`

„numbers" sind laut Schritt 1 genau **zwei** Zahlen: „how many rows the archive list returns, and the
result count of one search". Dieselbe Seite benennt in Zeile 223–224 aber **drei** Oberflächen, für die
die Anwendung einen Zeilenfilter baut — „reading archived emails, searching the archive, and **listing
ingestion sources**". Die dritte kommt im Verhaltenscheck nicht vor.

Gemessen an einer Rolle in genau der Form, die Änderung 1 der Seite selbst als typisch beschreibt
(Archiv-Grants mit übersetzbarer Bedingung, zur `ingestion`-Seite nur ein Verbot):

```
Query 2 auf diese Rolle:
    [prohibition without a matching grant] read ingestion is forbidden by rule #2, but no rule grants it

FilterBuilder.create(user, archive, read)    -> drizzleFilter=SQL present  searchFilter="(userEmail = \"3ef6…\")"
FilterBuilder.create(user, archive, search)  -> drizzleFilter=SQL present  searchFilter="(userEmail = \"3ef6…\")"
FilterBuilder.create(user, ingestion, read)  -> drizzleFilter=SQL present  searchFilter="ingestionSourceId = \"-1\""
```

Beide vorgeschriebenen Zahlen sind strukturell unverändert — `read` und `search` stehen in derselben
Regel mit derselben Bedingung, was die Seite in Zeile 86 selbst als von Änderung 4 unberührt nennt —,
während die Liste der Ingestion-Quellen fail-closed auf den Sperrfilter umschlägt. **Ein Betreiber, der
die Anleitung befolgt, notiert zwei unveränderte Zahlen und verwirft eine zutreffende Meldung von
Query 2.** Das ist die von ADR-020 verbotene Satzform mit anderem Signalträger und der gefährlichste
mögliche Schluss — genau der, den die ADR verhindern soll.

Zweite Stelle, dieselbe Bürgschaft in umgekehrter Richtung: „the queries report what has been written
down, and **the behaviour check is what covers the rest**." Dritte: „This check looks at behaviour
instead, and that is why it does not depend on any list of shapes being complete" — als Aussage über
Unabhängigkeit von Formlisten wahr, als Vollständigkeit gelesen falsch.

**Nicht behebbar durch einen Satzfix allein.** ADR-020 trug die Prämisse („Diese Prüfung ist
vollständig, weil sie das Verhalten misst statt die Datenform zu raten"), also hätte die nächste Runde
den Satz wieder hingeschrieben. Aufzugeben ist die **Konstruktion** „ein Teil der Seite bürgt für den
Rest", nicht der jeweilige Satz. Die ADR ist berichtigt.

## F32 — Der zitierte Fehlertext gilt nur für ein `policies`, das ein Objekt ist

**Kategorie:** veröffentlichte Betreiberdokumentation · **Schwere:** niedrig ·
**Ort:** `access-control-changes.md:512–516` · **Status:** offen, Behebung in `JR-13-18` ·
**Herkunft:** Abnahme `JR-13-09b` (2026-07-29)

Die Seite zitiert genau einen Fehlertext für den Abbruchfall. Gemessen für alle fünf Nicht-Array-Typen:

```
policies = {"action":"read"}   jsonb_typeof=object   -> cannot extract elements from an object
policies = "abc"               jsonb_typeof=string   -> cannot extract elements from a scalar
policies = 5                   jsonb_typeof=number   -> cannot extract elements from a scalar
policies = true                jsonb_typeof=boolean  -> cannot extract elements from a scalar
policies = null                jsonb_typeof=null     -> cannot extract elements from a scalar
```

Das angegebene Heilmittel `jsonb_typeof(policies) <> 'array'` findet **alle fünf**, ist also richtig.
Falsch ist nur der Wortlaut: in vier von fünf Fällen lautet die Meldung `a scalar`, und wer nach dem
zitierten Text sucht, findet ihn nicht. (`policies` ist `NOT NULL DEFAULT '[]'::jsonb`, ein
SQL-`NULL` ist ausgeschlossen.)

## F33 — „is skipped without a row" untertreibt, was die Abfrage tut

**Kategorie:** veröffentlichte Betreiberdokumentation · **Schwere:** niedrig, Richtung sicher ·
**Ort:** `access-control-changes.md:493–497` · **Status:** offen, Behebung in `JR-13-18` ·
**Herkunft:** Abnahme `JR-13-09b` (2026-07-29)

Unter _What it does not report_ steht, eine Regel mit `action`/`subject`, das weder String noch
String-Array ist, werde „skipped without a row". Gemessen:

```
action/subject not a string or array of strings -> Q2 rows: 2
    [empty condition object] rule #1: "conditions" is {}, …   (action: 5)
    [empty condition object] rule #2: "conditions" is {}, …   (subject: {"s":1})
```

Bedingungsbefunde erscheinen trotzdem, weil die CTE `cond` aus `rule` speist und nicht aus `pair` —
seit `JR-13-17` (a) ist das gerade der Zweck der Umstellung. Eine **bare Skalar-Regel** (`5`,
`"nonsense"` im Policy-Array) wird tatsächlich ohne Zeile übersprungen und bricht die Abfrage **nicht**
ab; dieser Teil der Aussage hält. Die Richtung ist harmlos — die Seite verspricht weniger, als sie
liefert —, die Aussage ist trotzdem falsch.

## F34 — „The known case" liest sich als Aufzählung, ist aber keine

**Kategorie:** veröffentlichte Betreiberdokumentation · **Schwere:** niedrig, Richtung sicher ·
**Ort:** `access-control-changes.md:502–510` · **Status:** offen, Behebung in `JR-13-18` ·
**Herkunft:** Abnahme `JR-13-09b` (2026-07-29)

Der Abschnitt über Übermeldungen nennt **einen** Fall. Gemessen sind sechs derselben Klasse, alle
wertseitig und alle mit Position:

```
OVER-REPORT accepted | reported | {"id":{"$in":[{}]}}            (der dokumentierte Fall)
OVER-REPORT accepted | reported | {"id":{"$in":[{"bad key":1}]}}
OVER-REPORT accepted | reported | {"id":{"$in":[{"a.b.c":1}]}}
OVER-REPORT accepted | reported | {"id":{"$in":[{"$regex":1}]}}
OVER-REPORT accepted | reported | {"id":{"$nin":[{"$or":[]}]}}
OVER-REPORT accepted | reported | {"userEmail":{"$eq":{}}}
            accepted | silent   | {"id":{"$in":[{"a":1}]}} · {"subject":{"$in":[[]]}} · {"userEmail":{"$in":[null]}}
```

Vier sind älter als `JR-13-17`; **neu** durch die Knotenebene sind `{"id":{"$in":[{}]}}` (dokumentiert)
und `{"userEmail":{"$eq":{}}}` (nicht dokumentiert). Der generelle Vorbehalt darüber deckt die Klasse
ab — nur die Formulierung „The known case" suggeriert Vollständigkeit. Dieselbe Lesefalle wie F31,
hier ohne Schaden.

## F35 — `pnpm lint` ist auf einem Windows-Host strukturell rot: keine `.gitattributes`

**Kategorie:** Entwicklungsumgebung (kein Produktdefekt, kein Testharness-Defekt) · **Schwere:** mittel
für die Arbeitsfähigkeit, **null** für das Produkt · **Ort:** fehlende `.gitattributes`, `.prettierrc`
ohne `endOfLine` · **Status:** **behoben am 2026-08-04, Commit `9c60f32`** (PO, auf Freigabe des
Auftraggebers) · **Herkunft:** PO, 2026-07-29, beim Sessionabschluss von E13

> **Behoben.** `.gitattributes` setzt `* text=auto eol=lf`, `.prettierrc` nennt `endOfLine: "lf"` jetzt
> ausdrücklich. **`corepack pnpm lint` ist auf diesem Windows-Host von 481 gemeldeten Dateien auf
> `All matched files use Prettier code style!` gegangen, Exit 0.** Am Repository hat sich dabei **kein
> Byte** geändert: `git add --renormalize .` erzeugte einen leeren Diff, weil der Index immer schon LF
> hielt — die Änderung betrifft ausschließlich, was beim Auschecken im Arbeitsbaum landet.
>
> **Die Ausnahme ist der eigentliche Inhalt dieses Fixes.** Ein pauschales `eol=lf` hätte die 28
> `.eml`-Fixtures unter `packages/journaling/tests/fixtures/` auf LF normalisiert. Die liegen dort
> **absichtlich mit CRLF**: RFC 5321/5322 definieren CRLF als Zeilenende, und diese Dateien sind die
> Wire-Bytes, gegen die der Parser aus E5 und der Byte-Treue-Roundtrip aus `JR-4-07` messen. Eine
> Normalisierung hätte nicht „Formatierung korrigiert", sondern **die Eingabe verändert, gegen die der
> Byte-Treue-Nachweis geführt wird** — und zwar ohne dass ein Test rot geworden wäre, der es meldet.
> Deshalb `*.eml -text` (keine Konversion in beide Richtungen). **Vorher gemessen statt angenommen:**
> genau 42 getrackte Blobs enthalten CR, das sind 28 `.eml` und 14 `.png` — nichts sonst.
>
> **Was der Befund gekostet hat, bevor er behoben war:** Am 2026-08-04 hat die Ambiguität einen
> **Fehlbefund** erzeugt. Bei der E4-Abnahme habe ich Kopien von Planungsdokumenten im Scratchpad
> gegen Prettier geprüft — außerhalb des Repositorys findet Prettier die `.prettierrc` nicht und misst
> gegen Defaults (2 Leerzeichen statt Tabs, doppelte Anführungszeichen, Breite 80). Ergebnis: die
> Meldung an den Auftraggeber, zwei Dokumente seien schon vor meinen Änderungen nicht konform gewesen.
> Sie war falsch; aufgefallen ist es nur, weil der CI-Lauf gegen denselben Commit grün war und dieser
> Widerspruch nicht auflösbar blieb. **Eine Prüfung, deren Rotmeldung man gewohnheitsmäßig ignorieren
> muss, prüft nichts** — das ist derselbe Mechanismus wie bei F48, nur mit umgekehrtem Vorzeichen.

Das Repository hat **keine `.gitattributes`**, und `.prettierrc` setzt `endOfLine` nicht — Prettiers
Standard ist `"lf"`. Auf einem Windows-Host mit `core.autocrlf=true` (dem Git-for-Windows-Default) wird
damit **jede** Textdatei mit CRLF ausgecheckt, und `pnpm lint` meldet:

```
[warn] Code style issues found in 388 files. Run Prettier with --write to fix.
 ELIFECYCLE  Command failed with exit code 1.
```

**Das ist kein Formatierungsfehler im Repository.** Im Index und in `origin` stehen LF-Zeilenenden; die
CRLF entstehen erst beim Checkout, und `git diff --stat` zeigt entsprechend nur inhaltliche Änderungen
(Gegenprobe: `939df10` ist 79+/45− bei 674 Zeilen, keine Ganzdatei-Umschreibung). Git sagt es beim
Stagen sogar selbst: `LF will be replaced by CRLF the next time Git touches it`.

**Warum es trotzdem zählt:** `pnpm lint` ist laut `CLAUDE.md` §4 das Gate, das **die CI nicht fährt** —
es muss von Hand laufen. Ein Gate, das auf einer ganzen Plattform immer rot ist, wird übersprungen oder,
schlimmer, mit `prettier --write` „behoben": das schreibt 388 Dateien um, erzeugt einen Diff über das
halbe Repository und macht jede Codearchäologie unmöglich. **Diesen Fehler nicht machen.**

**Arbeitsweise bis zur Behebung:** `corepack pnpm exec prettier --check <die eigenen Dateien>` statt
`pnpm lint`. Das ist in dieser Session so gemacht worden (7 Dateien, grün).

**Task-Vorschlag, PO entscheidet — nicht in E13:** eine `.gitattributes` mit `* text=auto eol=lf` ist die
richtige Lösung, weil sie unabhängig von der lokalen `core.autocrlf` gilt. Der Preis ist ein einmaliger
Normalisierungs-Commit über den Bestand (`git add --renormalize .`), der **allein stehen** muss, wie
`JR-1-05a`. Die billige Alternative `endOfLine: "auto"` in `.prettierrc` schwächt die Prüfung und lässt
gemischte Zeilenenden im Repository zu. **Gehört auf den Integrationsbranch, nicht in ein Epic**, und
nicht in denselben Commit wie eine inhaltliche Änderung.

## F36 — **widerlegt:** die Prettier-Warnung an `access-control-changes.md` ist reines F35

**Kategorie:** Messfehler in einem Prüfbericht (kein Produktdefekt) · **Schwere:** keine ·
**Status:** **widerlegt, kein Befund** — hier geführt, damit der Kandidat nicht erneut „gefunden" wird ·
**Herkunft:** Prüfbericht `JR-13-09c` (2026-07-30), widerlegt vom PO am selben Tag

Der Bericht zu `JR-13-09c` meldete einen neuen niedrigen Befund: `prettier --check` warne an
`docs/user-guides/upgrade-and-migration/access-control-changes.md`, und zwar **auch nach**
CRLF→LF-Normalisierung, verursacht durch einen mit **Tabs statt Leerzeichen** eingerückten JSON-Block
(Zeilen 44–54). **Beide Hälften sind falsch:**

1. **Die Tabs sind vorgeschrieben, nicht fehlerhaft.** `.prettierrc` setzt `"useTabs": true`. Ein
   tab-eingerückter Block ist genau das, was Prettier in diesem Repository verlangt.
2. **Die Normalisierung hat nicht gehalten.** Drei unabhängige Messungen:
    - Prettier-**API**, Eingabe und Soll beide auf LF normalisiert: **0** abweichende Zeilen bei 675,
      `identisch nach CRLF-Normalisierung: true`.
    - Prettier-**CLI** gegen eine LF-Kopie derselben Datei: **Exit 0**, „All matched files use Prettier
      code style!".
    - Dieselbe CLI gegen die CRLF-Kopie: **Exit 1**, Warnung.

Die Warnung entsteht **ausschließlich** aus den Zeilenenden und ist damit **F35**, nicht ein zusätzlicher
Defekt. Sie ist auch unabhängig davon nicht `939df10` zuzurechnen: die sieben tab-eingerückten Zeilen
stehen vor **und** nach dem Commit unverändert da (`git show 939df10^:…` liefert dieselben sieben).

> **Die Ursache ist ein Windows-Fallstrick, und er hat an einem Tag zweimal zugeschlagen** — beim Prüfer
> und beim PO. Wer eine Datei in PowerShell mit `>` oder `Out-File` umleitet, um sie zu normalisieren oder
> zu vergleichen, ändert dabei die **Kodierung**: die Em-Dashes dieser Seite werden zerstört, und der
> anschließende Vergleich meldet Dutzende „inhaltlicher" Abweichungen, die keine sind. **Für jede Aussage
> über Zeilenenden oder Formatierung auf diesem Host: den Vergleich in Node fahren**, nicht in der Shell —
> `fs.readFileSync(f, 'utf8')`, selbst normalisieren, und Prettier über die API oder mit explizitem
> `--config` gegen eine selbst geschriebene Kopie. Als **Fallstrick 27** im Handover geführt.

## Bereits im Backlog erfasste Bestandsprobleme

Diese wurden in E0 gefunden und haben schon eine Task — sie gehören nicht in die Liste oben:

| Problem                                                                                                                              | Task                                              |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| ~~`docs/services/iam-service/iam-policy.md` listet die Action `export` nicht und beschreibt `manage` falsch~~ **behoben 2026-07-30** | `JR-13-12` (nicht `JR-11-03`)                     |
| Frontend hat keine Nav-Filterung; eingeschränkte Nutzer sehen Menüpunkte, die 403 liefern                                            | `JR-11-02`                                        |
| `IamService`-Slug-Bug: `name.toLocaleLowerCase().replaceAll('', '_')`                                                                | Workaround in `JR-11-01` (`slug` explizit setzen) |
| `docs/enterprise/journaling/guide.md` beschreibt abwesenden Code                                                                     | `JR-12-05`                                        |

## Offene Vorschläge, die Produktionscode betreffen

Bewusst nicht umgesetzt, weil sie über den jeweiligen Task hinausgehen:

1. **`FilterBuilder` eine Ability injizieren**, statt sie über `IamService.getAbilityForUser()` zu
   holen (optionaler Parameter `ability?: AppAbility` mit Fallback auf die heutige Auflösung). Damit
   wäre `FilterBuilder.create()` ohne Datenbank unit-testbar. Aktuell hängt es über `IamService` am
   `db`-Singleton, der beim Import wirft. `JR-1-04` hat den Weg über eine echte Datenbank genommen und
   die Lücke damit geschlossen; der Vorschlag bleibt sinnvoll, ist aber nicht mehr blockierend.
2. **`src/api/server.ts` type-checkt nicht unter `moduleResolution: bundler`** (Default-Import von
   `i18next-http-middleware`). Deshalb schließt `packages/backend/tsconfig.test.json` den
   Produktionscode aus und prüft nur Testdateien. Vorbestehend, kein Testproblem.

## F37 — die Anwendung verbindet als Superuser und Tabelleneigentümer, und kann damit jede Datenbank-Schutzmaßnahme selbst abschalten

**Kategorie:** Deployment / Rechtetrennung · **Schwere:** mittel (hoch, sobald ein
Compliance-Anspruch daran hängt) · **Status:** offen, **Nacharbeit in E11** ·
**Herkunft:** gemessen am 2026-07-31 bei `JR-2-05`

`docker-compose.yml` setzt `POSTGRES_USER: ${POSTGRES_USER:-admin}`, `.env.example` setzt
`POSTGRES_USER=admin`, und `DATABASE_URL` wird aus genau dieser Rolle gebildet. Die
`POSTGRES_USER`-Rolle eines `postgres`-Images ist **Superuser** und Eigentümer aller Objekte, die die
Migration anlegt. In einer Standardinstallation verbindet die Anwendung also mit Superuser-Rechten.

**Gemessen gegen die laufende Instanz** (PostgreSQL 17.10, Rolle `admin`):

```
current_user = admin · rolsuper = true · journal_ledger owner = admin
UPDATE / DELETE / TRUNCATE auf journal_ledger und deployment_identity  ⇒ refused [23001]
INSERT                                                                 ⇒ allowed
SET session_replication_role = replica, dann UPDATE                    ⇒ ALLOWED
ALTER TABLE journal_ledger DISABLE TRIGGER journal_ledger_append_only  ⇒ ALLOWED
```

**Was das für den Append-Only-Trigger aus `JR-2-05` bedeutet.** Er hält gegen den Weg, der praktisch
zählt — **F1** (SQL-Injection über Policy-Condition-Keys) injiziert in eine `WHERE`-Klausel und kann
weder ein `SET` noch ein `ALTER TABLE` absetzen, weil `postgres-js` das erweiterte Protokoll benutzt
und kein Statement-Stacking erlaubt. Ein Akteur, der über diesen Weg eine Ledger-Zeile umschreiben
wollte, scheitert am Trigger. Er hält **nicht** gegen jemanden, der beliebiges SQL als diese Rolle
ausführen kann; für den ist der Trigger zwei Anweisungen weit entfernt.

**Das ist der Grund, warum ADR-009 zwei Mechanismen verlangt** und warum die zweite Hälfte eine
Deployment-Anforderung ist, keine Codeänderung: solange die Anwendung als Eigentümer verbindet, ist
jede tabellenseitige Maßnahme von ihr aus aufhebbar. Nachzuarbeiten in **E11**:

1. Eine eigene Rolle für die Anwendung, die **nichts besitzt** und auf `journal_ledger` /
   `deployment_identity` nur `INSERT` und `SELECT` hält.
2. Die Migration läuft unter einer **anderen** Rolle — sie braucht Eigentümerrechte, die Anwendung
   nicht.
3. Ein Startup-Check, der laut wird, wenn die Anwendung als Superuser oder als Eigentümer dieser
   Tabellen verbindet. Ohne ihn ist eine korrekt konfigurierte Installation von einer
   Standardinstallation nicht unterscheidbar, und der Betreiber erfährt es nie.

Nicht in E2 behoben, weil eine Rollentrennung `.env`, `docker-compose.yml`, den Migrationspfad und die
Betreiberdoku berührt — das ist E11s Gegenstand, und eine halb eingebaute Trennung wäre schlechter als
eine dokumentierte Anforderung.

## F38 — `event_payload` wird doppelt JSON-kodiert gespeichert, sobald der Treiber nicht durch drizzle gepatcht ist

**Kategorie:** Neuer Code (E2) · **Schwere:** hoch — jede Ledger-Zeile mit `event_payload` wäre
unverifizierbar · **Status:** **behoben** im selben Zug (`JR-2-08`) ·
**Herkunft:** gemessen am 2026-08-01 bei `JR-2-08`, Rolle `tester`

`PostgresLedgerWriter.insert()` band `event_payload` als `JSON.stringify(...)` an `$16`. postgres-js
entnimmt den Parametertyp der **Parameterbeschreibung des Servers**, sieht dort `jsonb` und
serialisiert den übergebenen String ein **zweites** Mal. In der Spalte steht dann der JSON-_String_
`"{\"k\":1}"` statt des Objekts `{"k":1}`.

Nichts schlägt beim Schreiben fehl. Was fehlschlägt, ist `verify` — Monate später und für **jede**
Zeile mit Nutzlast: zurückgelesen wird ein String, dessen kanonische Kodierung nicht die des
gehashten Objekts ist. Der Kettenhash der Zeile passt nicht mehr zu ihrem Inhalt.

**Gemessen gegen PostgreSQL 17.10, vier Parameterformen auf einem nackten postgres-js-Client:**

```
$2                  mit JSON.stringify(obj)   ->  jsonb_typeof = string   (falsch)
$2::jsonb           mit JSON.stringify(obj)   ->  jsonb_typeof = string   (falsch)
$2::text::jsonb     mit JSON.stringify(obj)   ->  jsonb_typeof = object   (richtig)
$2                  mit dem Objekt selbst     ->  jsonb_typeof = object   (richtig)
```

**Der einfache Cast `::jsonb` hilft nicht** — er lässt `jsonb` als abgeleiteten Parametertyp stehen.
Nur der Umweg über `text` legt den Typ in der Parameterbeschreibung auf `text` fest, sodass kein
Treiber mehr `jsonb` ableiten und ein zweites Mal kodieren kann. Behoben ist es so.

**Warum `JR-2-06` das nicht gefunden hat, und das ist der eigentlich lehrreiche Teil.** Der einzige
postgres-js-Client im Repository, der sich **nicht** so verhält, ist `harness.sql` — weil
`drizzle(client, …)` den ihm übergebenen Client patcht. Und genau dieser Client ist der, durch den
jeder Integrationstest schreibt. Gemessen, fünf Varianten, dieselbe Datenbank, derselbe Writer:

```
harness.sql (durch drizzle gelaufen)              -> object
postgres(url, {gleiche Optionen wie der Harness}) -> string
postgres(url)                                     -> string
postgres(url, {max: 20})                          -> string
```

Es liegt also nicht an einer Option, sondern daran, **durch welche Bibliothek der Client einmal
gelaufen ist**. Der Ingress-Prozess aus E3/E4 wird drizzle nicht in seiner Nähe haben — die
Architektur verbietet es ausdrücklich (`packages/journaling` darf nicht von `packages/backend`
abhängen) —, also wäre die Produktion die erste Stelle gewesen, an der es auffällt.

**Regel, die daraus folgt und über diesen Befund hinausgeht:** ein Integrationstest, der nur über
`harness.sql` schreibt, prüft den Treiber der _Tests_, nicht den der Anwendung. Für alles in
`packages/journaling` — das seine Verbindung per Definition injiziert bekommt — muss mindestens ein
Test über einen **nackten** Client schreiben. `JR-2-08` tut das jetzt (`pool`), und der benannte
Regressionsfall in `journal-ledger-concurrency.adv.test.ts` prüft `jsonb_typeof` direkt statt nur
über den Kettenhash, damit ein Rückfall sagt, _was_ kaputt ist.

---

## F39 — ein Eigenschaftstest trägt die Eigenschaft nur im Namen: das Längenpräfix ist nicht das, was ihn rot macht

**Schwere:** niedrig · **Kategorie:** Testharness · **Ort:**
`packages/journaling/src/ledger/canonical-encoding.test.ts:166–180`, Fall „is length-prefixed, so
field boundaries cannot be shifted" · **Gefunden:** `JR-2-10a` (zweite Abnahme E2, 2026-08-01, Rolle
`tester`), Mutationsprobe M4 · **Keine Auswirkung auf das Produkt** — die Kodierung selbst ist
korrekt und das Längenpräfix vorhanden.

Der Test soll belegen, dass die kanonische Kodierung ihre Felder längenpräfigiert, sodass sich
Feldgrenzen nicht verschieben lassen. Er stellt zwei Records gegenüber, bei denen zwei benachbarte
`STRING`-Felder ein Zeichen zwischen sich verschieben (`ehloName:'ab', tlsVersion:'cd'` gegen
`ehloName:'a', tlsVersion:'bcd'`), und fordert unterschiedliche Bytes.

**Entfernt man das Längenpräfix vollständig** — `field()` liefert `tag ‖ value` statt
`tag ‖ len ‖ value` —, **bleibt dieser Test grün.** Die beiden Records unterscheiden sich dann
immer noch, aber aus einem anderen Grund: das Tag-Byte des Folgefelds (`0x03`) landet an einer
anderen Position, und die Bytefolgen weichen zufällig trotzdem voneinander ab. Die Länge selbst
trägt in genau diesem Wertepaar nichts zur Unterscheidung bei.

**Gefangen wird die Mutation trotzdem** — vom Golden-File (`adr-006-vectors.test.ts`: Recordlänge
351 und `SHA256(record)` weichen ab), also von einem Test, der die Eigenschaft nicht im Namen führt.
Das ist der ganze Befund: die Eigenschaft ist abgesichert, aber nicht dort, wo ein Leser sie
abgesichert glaubt. Wer das Golden-File einmal anfasst oder ersetzt, verliert die Absicherung, ohne
dass ein rot werdender Test ihn darauf stößt.

> Die übrigen vier Mutationsproben derselben Runde (M1, M2, M3, M5) wurden **genau** von den
> zuständigen Tests gefangen, ohne Übersprechen auf unbeteiligte Fälle. F39 ist die eine Ausnahme
> von fünf.

**Vorschlag (nicht umgesetzt — eine Abnahme ist nicht der Ort für stille Änderungen):** die
Testwerte so wählen, dass die Länge die einzige Unterscheidung ist — etwa ein Feld variabler Länge
am **Ende** des Records, wo kein Tag-Byte folgt, das die Verschiebung sichtbar macht. Dann prüft der
Fall die Länge und nicht die Tag-Position.

**Entscheidung des Auftraggebers offen:** beheben (kleine Teständerung, gehört sinnvollerweise in
die nächste Arbeit an `packages/journaling`), oder bewusst akzeptieren, weil das Golden-File die
Eigenschaft trägt. **Blockiert nichts** und war kein Hindernis für die Abnahme von E2.

## F40 — eine Spool-Datei ohne Ledger-Eintrag belegt **keinen** Absturz, und ihr Müll frisst die Kapazität auf

**Schwere:** mittel · **Kategorie:** Verfügbarkeit und Betriebsaussage · **Ort:**
`packages/journaling/src/spool/durable-write.ts`, `…/acceptance.ts`,
`docs/dev/journaling/02-architektur.md` §5 · **Gefunden:** `JR-3-06` (2026-08-02, Rolle `tester`),
gemeldet und **nicht** behoben · **Status:** **offen**

Drei der fünf Teiloperationen des durablen Schreibens — `write()`, Datei-`fsync` und
Verzeichnis-`fsync` — hinterlassen bei einem **gewöhnlichen Laufzeitfehler** eine vollständige
Spool-Datei ohne Ledger-Eintrag. `SpoolFileSystem` hat keine Löschmethode, und
`writeDurableSpoolFile()` räumt nicht weg, was es angelegt hat.

**Das Nicht-Löschen ist richtig und bleibt.** Skill §3 verbietet ausdrücklich, eine Spool-Datei ohne
Ledger-Eintrag ohne durable Aufzeichnung zu entfernen. Der Befund richtet sich nicht dagegen,
sondern gegen zwei Folgen, die bisher niemand ausgesprochen hat.

**Erstens: die Aussage in `02-architektur.md` §5 ist falsch.** Dort stand, die liegengebliebene Datei
sei „Beleg dafür, dass ein Absturz stattgefunden hat“. Sie ist es nicht — ein einzelner
fehlgeschlagener `write()` erzeugt dieselbe Spur, ohne dass irgendetwas abgestürzt wäre. Der Test
`„an ordinary write failure looks exactly like a crash to JR-3-05“` fädelt ein gescheitertes
`accept()` direkt in `runCrashRecoveryScan()` und zeigt: die Datei wird quarantänisiert und
alarmiert, **ununterscheidbar von einem echten Absturz**. Der Betreiber sucht dann einen Absturz,
den es nie gab. Satz korrigiert am 2026-08-02.

**Zweitens, und das ist der eigentliche Schaden: der Müll frisst das Kapazitätsbudget.**
`checkSpoolHighWaterMark()` zählt `quarantine/` bewusst mit (`JR-3-01`, richtig — sonst bliebe ein
langsam volllaufender Spool unsichtbar). Nur leert die Quarantäne niemand. Wiederholte
Schreibfehler — also genau der Fall, in dem das System ohnehin schon leidet — füllen das Budget
dauerhaft mit Rückständen, bis eine **spätere, unabhängige, völlig gesunde** Transaktion mit `452`
abgewiesen wird. Ein zweiter Testfall belegt das. Das ist eine schleichende Selbstblockade: die
Fehlerbehandlung erzeugt den nächsten Ausfall.

**Zwei Richtungen, keine davon hier entschieden:**

1. Der Annahmepfad verschiebt seinen eigenen Rest bei einem Schreibfehler **selbst** nach
   `quarantine/`, mit eigenem Grund (`'write-failed'` statt `'no-ledger-entry'`). Dann ist der
   spätere Alarm ehrlich, und der Scan sieht nichts, was er falsch deuten könnte. Löscht nichts,
   verletzt Skill §3 also nicht. Kostet einen weiteren fehlbaren Aufruf im Fehlerpfad.
2. Die Quarantäne bekommt ein Verfahren — Aufbewahrungsfrist, Betreiber-Freigabe, Alarm bei
   Erreichen eines Anteils am Budget. Gehört dann zu E10 (Monitoring) und E12 (Betriebsleitfaden).

Beide schließen einander nicht aus; (1) macht die Meldung ehrlich, (2) macht den Speicher wieder
frei. **Sie ersetzen einander aber auch nicht** — (1) allein gibt **kein** Byte frei, weil die
Quarantäne im Budget bleibt.

**Entscheidung des Auftraggebers vom 2026-08-02: vor der Abnahme von E3 beheben, Hälfte 1.**
Angelegt als **`JR-3-09`** in E3 (DEV). **Hälfte 2 bleibt offen** und ist keine Codefrage: sie
verlangt ein Verfahren — Aufbewahrungsfrist für die Quarantäne, Betreiber-Freigabe, Alarm bei
Erreichen eines Anteils am Budget — und gehört damit zu **E10** (Monitoring) und **E12**
(Betriebsleitfaden). Bis dahin gilt: ein Spool, der wiederholt Schreibfehler sieht, läuft langsam
voll, und **niemand räumt ihn automatisch**.

## F41 — das Testnetz für „nach dem Ledger-Append passiert nichts mehr“ hat drei Löcher

**Schwere:** niedrig · **Kategorie:** Testharness · **Ort:**
`packages/journaling/src/spool/acceptance.test.ts:141–143` (`timelineFileSystem()`),
`packages/journaling/tests/support/fake-spool-fs.ts`, sowie der Dokukommentar in
`packages/journaling/src/spool/acceptance.ts` · **Gefunden:** `JR-3-08` (Abnahme E3, 2026-08-02,
Rolle `tester`), gemeldet und **nicht** behoben · **Status:** **offen** ·
**Kein Produktdefekt** — der Produktionscode ist korrekt, nur unzureichend eingezäunt.

`timelineFileSystem()` instrumentiert `mkdir`, `createFile`/`write`/`fsync`/`close` und
`fsyncDirectory`. **`readdir`, `stat` und `rename` reicht es ungetrackt durch** (Zeilen 141–143), und
`FakeSpoolFileSystem` führt für sie auch kein eigenes Protokoll. Eine Regression, die nach dem
Ledger-Append eine dieser drei Operationen einfügt und die **gelingt**, würde von keinem Test
bemerkt.

Der Dokukommentar in `acceptance.ts` behauptet mehr, als das Netz hält: „`accept.test.ts` asserts the
empirical half of this: after `backend.append()` resolves, the fake filesystem's call log is
unchanged“. Das gilt für vier der sieben Operationen des Ports.

**Die strukturelle Zusage bleibt unberührt** und ist der Grund, warum der Befund niedrig eingestuft
ist: `buildAcceptedTransaction()` ist synchron, total und bekommt weder `SpoolFileSystem` noch
`LedgerBackend`, kann also gar keine Operation auslösen; und
`buildAcceptedTransaction(txid, await this.backend.append(request))` ist **eine** Anweisung, deren
Zerlegung ein sichtbarer Diff ist. Was fehlt, ist der zweite Zaun hinter dem ersten.

**Ein Nachtrag zur Aufklärungsgeschichte, weil er lehrreich ist.** Drei Mutationsproben wurden gegen
diese Zusage gefahren — zwei vom PO (ein zweiter `append()`, ein `fs.stat()` danach) und eine vom
Prüfer. Die beiden des PO wurden **rot** und galten als Bestätigung des Netzes. Sie waren es nicht:
sie wurden rot, weil die eingefügte Operation **scheiterte** und der umgebende `catch` sie als
`'ledger-append-failed'` meldete — nicht, weil ein Test sie **bemerkt** hätte. Erst eine Probe mit
einer **gelingenden** Operation trennt beides. Wer ein Netz per Mutation prüft, muss die Mutation so
wählen, dass sie **nur** über das Netz auffallen kann.

**Behoben am 2026-08-02 (`fe5b410`), vor dem Rückmerge.** `timelineFileSystem()` erfasst jetzt
**alle neun** Operationen auf derselben Zeitachse — die bestehende Zusicherung „nach dem letzten
`ledger-append` folgt nichts“ greift damit automatisch für alle, ohne eine zweite Buchführung in
`FakeSpoolFileSystem` einzuführen. Dokukommentar in `acceptance.ts` auf das zurückgenommen, was das
Netz trägt. Nachweis über drei Proben mit **gelingender** Operation (`stat`, `rename`, `readdir`),
jede meldet `expected 'fs:<op>' to be 'ledger-append'` — also rot, **weil beobachtet**. Vom PO mit
`stat(durable.filePath)` unabhängig nachgestellt: zwei Zusicherungen rot, und der
`ledger-append-failed`-Test bleibt **grün**, was belegt, dass nichts geworfen hat.

### Nachtrag: warum der PO das Loch dreimal übersehen hat

Der Absatz oben schrieb, seine beiden früheren Proben seien „rot geworden, weil die eingefügte
Operation **scheiterte**“. Das war die halbe Wahrheit. **Sie sind nie ausgeführt worden:** der PO
schrieb `written.filePath`, die Variable heißt im Code aber `durable`. Jede seiner Proben starb an
einem `ReferenceError` — **vor** dem beabsichtigten Dateisystemaufruf —, wurde vom umgebenden `catch`
als `'ledger-append-failed'` gemeldet und sah damit exakt so aus wie eine Probe, die etwas bewiesen
hat.

**Die Regel daraus ist schärfer als ‚wähle eine gelingende Mutation‘:** eine Mutationsprobe muss
belegen, dass sie **das getan hat, was sie tun sollte**. Rot allein ist kein Beleg — die
Fehlermeldung muss die erwartete Zusicherung nennen. `expected 'fs:stat' to be 'ledger-append'`
beweist etwas; `expected { kind: 'ledger-append-failed' } to deeply equal { kind: 'accepted' }`
beweist nur, dass irgendwo etwas geworfen hat, und verrät nicht, was.

---

## F42 — `tsconfig.build.json` kennt weder `packages/journaling` noch `apps/*` und wird von nichts benutzt

**Schwere:** niedrig · **Kategorie:** Entwicklungsumgebung · **Ort:** `tsconfig.build.json`
(Repo-Wurzel) · **Gefunden:** `JR-4-01` (2026-08-02, Rolle DEV), gemeldet und **nicht** behoben ·
**Status:** **offen**

Das Aggregat referenziert `packages/types`, `packages/backend` und `packages/frontend`. Seit E2 gibt
es `packages/journaling`, seit `JR-4-01` `apps/smtp-ingress` — beide fehlen. `grep -rn
"tsconfig.build.json"` findet **keine** Verwendung in einem Skript, in `package.json` oder in der CI.

**Warum es trotzdem hier steht und nicht ignoriert wird:** eine Datei, die aussieht wie der
Projektbau, es aber nicht ist, wird irgendwann von jemandem benutzt — und liefert dann einen grünen
Build, der zwei Pakete nicht angefasst hat. Entweder sie wird vervollständigt oder entfernt.

---

## F43 — der Heap-Nachweis misst am Speicher vorbei, in dem die Nachricht liegt

**Schwere:** mittel · **Kategorie:** Testharness · **Ort:** der Speichernachweis von `JR-3-02`
(`packages/journaling`, Durable-Write-Pfad) und jede weitere Stelle, die „ohne proportionalen
Heap-Anstieg" über `process.memoryUsage().heapUsed` belegt · **Gefunden:** `JR-4-03` (2026-08-02,
Rolle DEV) beim Aufbau des eigenen Nachweises · **Status:** **offen** · **Betrifft ein bereits
abgenommenes Epic** (E3, `JR-3-08`)

**Node-`Buffer`-Inhalte liegen außerhalb des V8-Heaps.** Wer Vollpufferung über `heapUsed` sucht,
sucht am falschen Ort: `JR-4-03` hat zur Kalibrierung absichtlich eine Voll-Pufferung eingebaut und
gemessen — `heapUsed` blieb **flach bei 13–17 MB**, also exakt so, wie der korrekte Code aussieht,
während 150 MB gepuffert wurden. Umgestellt auf `process.memoryUsage().arrayBuffers` trennt die
beiden Zustände deutlich: **166 MB** mit Regression, **unter 40 MB** ohne. In beiden Richtungen
verifiziert.

**Die Folge ist keine Vermutung, sondern eine Frage an einen abgenommenen Nachweis:** `JR-3-02`s
Akzeptanzkriterium lautet „150-MB-Nachricht ohne proportionalen Heap-Anstieg", und `JR-3-08` hat es
abgenommen. Wenn dieser Nachweis über `heapUsed` geführt wurde, belegt er die Eigenschaft **nicht** —
unabhängig davon, ob der Produktionscode korrekt ist (er ist es aller Wahrscheinlichkeit nach, weil
`writeDurableSpoolFile()` streamt). Zu prüfen ist der **Nachweis**, nicht der Code: dieselbe
Kalibrierung dort einmal fahren.

**Die allgemeine Regel dahinter**, weil sie sich wiederholen wird: ein Messinstrument, das eine
absichtlich eingebaute Regression **nicht** rot macht, misst nicht die Eigenschaft, die es zu messen
vorgibt. Jeder Speichernachweis in diesem Projekt bekommt diese Kalibrierung, bevor er zitiert wird.

---

## F44 — nach einem `552` im `DATA`-Pfad liest der Server den Nachrichtenrumpf als SMTP-Kommandos

**Schwere:** **hoch** · **Kategorie:** Neuer Code · **Ort:**
`packages/journaling/src/ingress/smtp-server.ts`, `DataScanner.push()`/`handleDataChunk()` →
`finishData()` → `completeTransfer()` · **Gefunden:** von `JR-4-03` (2026-08-02, Rolle DEV) als
Klasse benannt, vom PO am selben Tag **gemessen und in der Schwere heraufgestuft** · **Status:**
**behoben** in `JR-4-16` (`packages/journaling/src/ingress/smtp-server.ts`, Rolle DEV, 2026-08-02)

> **Behoben (`JR-4-16`).** `DataScanner` setzt bei einem `SIZE`-Überlauf nicht mehr `finished = true`
> mitten im Strom. Beide Abbruchstellen — die zeilenweise Byte-Zählung in `scan()` **und** die
> `carry`-Deckelung für eine „Zeile" ohne jedes `CRLF` in `push()` — setzen jetzt `oversize = true`
> und wechseln in einen Verwerfungs-Scan (`scanDiscard()`), der über beliebig viele weitere
> `push()`-Aufrufe hinweg liest und verwirft, bis der echte `<CRLF>.<CRLF>`-Terminator gefunden ist —
> `BDAT`s eigene Disziplin (deklarierte Länge immer vollständig abzählen, bevor reagiert wird) als
> Vorbild genommen, wie vom PO verlangt. Erst wenn der Scanner `done: true` meldet, ruft
> `handleDataChunk()` `finishData()`/`completeTransfer()` auf; `oversize` allein löst das nicht mehr
> aus. `completeTransfer()` bleibt dabei der einzige Anschlusspunkt für `JR-4-06`, unverändert.
>
> **Ressourcengrenze der verworfenen Bytes:** `scanDiscard()` puffert nichts — es ist ein
> Automat aus vier Skalaren (`discardSawCr`/`discardLineDisqualified`/`discardLineLength`/
> `discardFirstByte`), der pro Zeile nur deren erste zwei Bytes kennen muss, um zu wissen, ob sie ein
> einzelner Punkt war. Der Speicherbedarf zwischen den `push()`-Aufrufen bleibt damit O(1),
> unabhängig davon, wie viel eine Gegenstelle nach der Überschreitung noch sendet. Sendet sie nie
> einen Terminator, bleibt `state` weiter `'data'`, und der bereits vorhandene, bei jedem Chunk neu
> gestellte `dataTimeoutMs`-Timer (`armDataTimer()` in `handleDataChunk()`, unverändert) beendet die
> Verbindung mit `421 4.4.2` — kein neuer Mechanismus, keine neue Erschöpfungslücke.
>
> **Testfall im Repository, rot ohne den Fix:** `packages/journaling/tests/unit/smtp-server-protocol.test.ts`,
> Suite „`DATA` oversize does not desync the connection (JR-4-16, F44)" — die Probe des PO als
> Regressionstest nachgebaut (Rumpf und „geschmuggelte" Kommandozeilen in getrennten
> `writeRaw()`-Aufrufen, nicht in einem kombinierten Write, exakt wie der Befund es verlangt), plus
> ein Test für den legitimen Fall (Sender sendet nach der Überschreitung bis zum echten Terminator
> weiter) und einer für die Ressourcengrenze (Sender verstummt, ohne je einen Terminator zu senden).
> Vor dem Fix zurückgenommen: alle drei schlagen fehl, mit benannter Zusicherung, nicht nur
> „irgendetwas ist anders" — u. a. `promise resolved "[ '552 5.3.4 ...' ]" instead of rejecting` (ein
> `552` kam an, wo keine Antwort erwartet war) und `expected '552 ...' to match /^421 4\.4\.2/`.
> Ergänzend in `packages/journaling/src/ingress/smtp-server.test.ts`: die reinen `DataScanner`-Fälle
> für beide Abbruchstellen, ebenfalls rot ohne den Fix — die Zusicherung nannte `done: false`, wo
> `done: true` ankam. Voller Lauf danach: `628 passed | 6 skipped`, 48 Dateien (vorher
> `622 passed | 6 skipped`, +6 neue Tests: 3 je Datei).

`DataScanner` setzt bei Überschreitung des `SIZE`-Limits sofort `finished = true`, ohne bis zum
`<CRLF>.<CRLF>`-Terminator weiterzulesen. `completeTransfer()` antwortet `552 5.3.4` und setzt
`state = 'ready'`. **Der Sender weiß davon nichts und sendet den Rest seiner Nachricht** — und dieser
Rest läuft ab jetzt durch `processCommandLine()`.

**Gemessen** (Probe des PO gegen den gebauten Server, `sizeLimitBytes: 1000`, Rumpf 1500 Byte, danach
in einem **eigenen** TCP-Segment drei Zeilen aus dem „Rumpf"):

```
552 5.3.4 Message size exceeds fixed maximum message size
250 2.1.0 Ok        <- auf  MAIL FROM:<attacker@evil.invalid>
250 2.1.5 Ok        <- auf  RCPT TO:<j@example.com>
250 2.0.0 Ok        <- auf  NOOP
```

**Nachrichteninhalt wird zu Envelope.** Sobald `JR-4-06` `JournalAcceptance.accept()` anschließt,
entsteht daraus ein Ledger-Eintrag mit einem `envelope_from`, den nie ein Sender gesendet hat — und
`envelope_from`/`envelope_rcpt` gehören zu den 16 gehashten Feldern (ADR-006). Der Ledger würde einen
Empfang bezeugen, den es nicht gab. Deshalb **hoch**, obwohl heute noch nichts archiviert wird: der
Defekt wird durch die nächste Scheibe scharf, nicht durch einen Angriff.

**Zwei Details, die die Einordnung tragen:**

1. **Es braucht keinen Angreifer.** Ein legitimer Sender mit einer zu großen Nachricht sendet nach dem
   `552` genauso weiter. Der konstruierte Fall ist nur die schnellste Art, es sichtbar zu machen.
2. **Es hängt an der TCP-Segmentierung, und die kontrolliert die Gegenstelle.** Die erste Probe des PO
   war **negativ** — sie sendete Rumpf und Kommandos in **einem** `write`, und der Rest desselben
   Chunks wird verworfen, weil `handleDataChunk()` ihn nicht aufteilt. Erst mit einem eigenen Segment
   trat der Fall ein. **Eine Probe, die den Fall verfehlt, ist kein Beleg für seine Abwesenheit** —
   dieselbe Lehre wie in F41s Nachtrag, hier innerhalb einer Viertelstunde ein zweites Mal.

**Der `BDAT`-Pfad hat den Defekt nicht**, und zwar strukturell: `handleBdatChunkBytes()` zählt die
deklarierte Chunk-Länge immer vollständig ab, bevor es auf ein Oversize reagiert, und gibt den
Überhang gezielt an die Kommandoverarbeitung zurück. Der Fix für `DATA` folgt derselben Linie —
nach Oversize bis zum Terminator weiterlesen und verwerfen, dann antworten; alternativ die Verbindung
nach der Antwort schließen. Was `JR-4-16` daraus macht, entscheidet die Task; ein stiller
Zustandswechsel nach `'ready'` mitten im Rumpf ist keine der beiden Möglichkeiten.

---

## F45 — ein verworfener Iterator verließ den Durable Write als nackter `Error`, nicht als `DurableWriteError`

**Schwere:** mittel · **Kategorie:** Neuer Code · **Ort:**
`packages/journaling/src/spool/durable-write.ts`, die `for await`-Schleife über `request.chunks` ·
**Gefunden und behoben:** `JR-4-06a` (2026-08-03, Rolle DEV) beim Verdrahten des Oversize-Abbruchs ·
**Status:** **behoben**, mit Regressionstest

`writeDurableSpoolFile()` fasste seine eigenen Dateisystemaufrufe in `DurableWriteError`, ließ aber
einen Fehler **aus dem Iterator** ungefasst durch — die `for await`-Schleife lag außerhalb des
`try`/`catch`. Das war in E3 **latent**, weil kein Aufrufer den Abbruchweg benutzte: alle Quellen waren
Arrays oder Testgeneratoren, die nicht werfen.

**Scharf wird es genau mit `JR-4-06a`.** Dort bricht der Server einen laufenden Spool-Write bei
Überschreitung des `SIZE`-Limits über den Iterator ab (`bridge.abort()`).
`JournalAcceptance.accept()` unterscheidet aber **nach Typ**: ein `DurableWriteError` wird zu einem
typisierten Ergebnis (`'spool-write-failed'` bzw. `'spool-capacity-exceeded'`, plus Quarantäne der
eigenen Leiche nach `JR-3-09`), **alles andere wird bewusst weitergeworfen** — `acceptance.ts` nennt
das „a programming error in the filesystem seam itself", und es zu verschlucken hieße, einen Fehler
hinter einem Retry zu verstecken, der nie gelingen kann. Ein nackter `Error` aus dem Iterator wäre
also als **unbehandelte Ausnahme** aus dem Annahmepfad geflogen, statt `552` zu erzeugen.

**Die Lehre steht in diesem Projekt schon zweimal:** eine Fehlerklassifikation nach Typ ist nur so gut
wie die Vollständigkeit der Stelle, die den Typ setzt. Wer einen `try`-Block um „die eigenen Aufrufe"
legt und eine fremde, **injizierte** Quelle daneben laufen lässt, hat einen zweiten Fehlerpfad, den
niemand sieht — solange keine Quelle wirft. Dasselbe Muster wie F41 (das Testnetz deckte vier von
sieben Operationen ab) und F44 (die Probe traf den Fall nicht): der ungeprüfte Rand, nicht die Mitte.

---

## F46 — zwei Ports mit gleichem Methodennamen, und der Empfängerpfad prüft in Produktion die falsche Sache

**Schwere:** **hoch** · **Kategorie:** Neuer Code · **Ort:**
`packages/journaling/src/ingress/smtp-server.ts` (`RecipientAclEvaluator` / `SourceAclEvaluator`),
`packages/journaling/src/ingress/source-acl-cache.ts`, verdrahtet in
`apps/smtp-ingress/src/index.ts` · **Gefunden:** `JR-4-18` (2026-08-03, Rolle DEV), gemeldet und
**nicht** behoben · **Status:** **behoben** in `JR-4-20` (Rolle DEV, 2026-08-03)

`RecipientAclEvaluator.evaluate` und `SourceAclEvaluator.evaluate` tragen denselben Methodennamen.
TypeScript typisiert **strukturell**, also erfüllt `SourceAclCache` beide Schnittstellen über seine
**eine** `evaluate(remoteIp)`-Methode — die CIDR-Prüfung. Die eigentlich zuständige
`evaluateRecipient(rcptToAddress)` wird nie aufgerufen.

**Wirkung in Produktion:** `apps/smtp-ingress/src/index.ts` übergibt den Cache als
`recipientAclEvaluator`, also läuft jeder `RCPT TO` gegen die IP-Allowlist. `normalizeRemoteIp()`
wirft bei einer E-Mail-Adresse, das Ergebnis wird zu `'unavailable'`, und der Server antwortet
**immer `451 4.3.0`** — nie `550`, nie `250`, unabhängig vom Inhalt von `journaling_sources`.
**Der empfängerbasierte Empfang ist damit vollständig funktionsunfähig**, sobald `apps/smtp-ingress`
echt läuft.

### Warum weder Compiler noch Testsuite es gesehen haben

Der Compiler **kann** es nicht sehen: strukturelle Kompatibilität ist hier gewollte Sprachsemantik,
kein Fehler. Und die Suite konnte es nicht sehen, weil **jeder** Test seine eigene, korrekte
Verdrahtung mitbringt statt der produktiven: `smtp-recipient-acl-protocol.test.ts` benutzt ein
handgeschriebenes Fake und sagt das in einem eigenen Kommentar, `journal-smtp-accept-e2e.int.test.ts`
ein Inline-Objekt. Aufgefallen ist es erst, als `JR-4-18` zum ersten Mal den **echten** Prozess mit
dem **echten** Cache startete.

**Das ist der eigentliche Befund, und er ist größer als die Namenskollision:** die Stelle, an der
dieser Prozess seine Objekte zusammensteckt, wird von keinem Test durchlaufen. Jeder Test prüft eine
Nachbildung der Verdrahtung, nie die Verdrahtung. Eine Namenskollision ist nur die erste Art von
Fehler, die dort unbemerkt bleibt — ein vergessener Parameter, ein vertauschtes Argument oder ein
nicht gestarteter Cache wären genauso unsichtbar. `JR-4-20` behebt deshalb beides: die Kollision
strukturell, **und** die untestete Verdrahtung.

> **Behoben in `JR-4-20`** (2026-08-03, `78f2d96`). `RecipientAclEvaluator.evaluate` heißt jetzt
> `evaluateRecipient` — `SourceAclCache` musste dafür **nicht** geändert werden, sie hatte die
> Methode längst, nur war sie an keiner Schnittstelle und wurde nie aufgerufen. Der Nachweis gegen
> künftige Vertauschung ist ein Kompilierfehler: `tests/unit/acl-evaluator-port-shapes.test.ts`
> weist beide Richtungen mit `@ts-expect-error` zurück, geprüft über `tsc -p tsconfig.test.json`
> (vor dem Fix kompilierten beide Zeilen anstandslos — deshalb war es unsichtbar). Alle übrigen
> Ports des Prozesses auf dieselbe Falle geprüft: keine weitere Kollision. Und die zweite Hälfte ist
> ebenfalls zu: `bindSourceAclCache()` ist jetzt **die** Verdrahtung, die Produktion **und** Test
> gemeinsam aufrufen. Der Beleg, wie stark die Lücke war: **jeder** bestehende Test benutzte ein
> Fake mit `evaluate:` und wurde von der Umbenennung rot — genau deshalb hatte keiner den Defekt
> gesehen. Volllauf danach `846 passed | 7 skipped` bei 67 Dateien.

---

## F47 — der Typcheck für `packages/journaling` läuft in der CI nicht, und ist deshalb rot

**Schwere:** mittel · **Kategorie:** Testharness · **Ort:**
`.github/workflows/ci.yml` (Schrittfolge) und `packages/journaling/tests/unit/smtp-acceptance-wiring.test.ts:408` ·
**Gefunden:** vom PO am 2026-08-03, nachdem `JR-4-18` und `JR-4-20` unabhängig denselben roten
Typfehler gemeldet und als vorbestehend bestätigt hatten · **Status:** **behoben in `JR-4-06b`,
Commit `25a7e91`** (Rolle DEV, 2026-08-04)

> **Behoben (`JR-4-06b`).** Der CI-Schritt „Typecheck journaling test files" existiert
> (`.github/workflows/ci.yml:108-109`, eingeführt durch `25a7e91` — mit `git log -S` gegengeprüft),
> und `corepack pnpm --filter @open-archiver/journaling test:types` läuft mit **Exit 0** durch.
> **Nachtrag (PO, 2026-08-04, `JR-4-13`):** Dieser Befund stand als Auflage 2 der E4-Abnahme noch
> zehn Scheiben lang auf „offen", obwohl er längst behoben war — sowohl hier als auch in der
> Übersichtstabelle. Der Tester hat es bei der Abnahme gefunden. Zusammen mit F50/F52/F53/F55/F56,
> deren Detailabschnitte „behoben" führten, während die Übersichtstabelle „offen" sagte, ist das
> dasselbe Muster wie die doppelt geführte Statusfassung in `README.md`: **eine zweite Fassung
> derselben Wahrheit veraltet, sobald sie existiert.** Wer einen Status ändert, ändert beide Stellen.

Zwei Teile, und der zweite erklärt den ersten:

1. `corepack pnpm --filter @open-archiver/journaling test:types` ist rot —
   `Record<string, unknown> | null` ist nicht zu `CanonicalJsonValue` zuweisbar (entstanden in
   `JR-4-06a`).
2. **Die CI prüft das nie.** `ci.yml` fährt `test:types` ausschließlich für
   `@open-archiver/backend`. `packages/journaling` — das Paket, in dem seit E2 der gesamte
   Ledger-, Spool- und Ingress-Code entsteht — wird gebaut (`build`), aber sein Testprogramm wird
   nicht typgeprüft.

**Warum das mehr ist als ein Typfehler:** der Wächter deckt die Stelle nicht ab, an der dieses
Projekt inzwischen den größten Teil seines Codes schreibt.

---

## F48 — **jeder** CI-Lauf des E4-Branches ist fehlgeschlagen, vierzehn Scheiben lang unbemerkt

**Schwere:** **hoch** · **Kategorie:** Testharness / Verfahren · **Gefunden:** vom PO am 2026-08-03,
nachdem `JR-4-07`s Bericht die Windows-`EPERM`-Grenze beim Verzeichnis-fsync beschrieb ·
**Status:** **Ursache behoben** (`1fc7de4`), **Verfahrenslücke offen** — siehe unten

**Alle zwölf CI-Läufe zwischen `JR-4-17` (07:22) und `JR-4-07` (11:08) sind fehlgeschlagen**, jeder
nach etwa einer Minute, jeder am **Lint**-Schritt: `prettier --check .` meldete **fünf** Dateien mit
echten Formatierungsverstößen (`06-status.md`, `smtp-ingress-crash-recovery-boot.int.test.ts`,
`source-acl-cache.ts`, `smtp-acceptance-wiring.test.ts`, `smtp-starttls-protocol.test.ts`). Das ist
**nicht** F35: in der CI ist der Checkout LF, und es waren fünf Dateien, nicht 388.

**Der Schaden ist nicht die Formatierung, sondern was dahinter nicht mehr lief.** Lint ist Schritt 7
von 14; Build, `svelte-check`, `test:types` und die **gesamte Testsuite** sind in der CI seit dem
2026-08-03 07:22 **überhaupt nicht ausgeführt worden**.

**Und genau dort liegt der einzige Beleg für die Kernaussage dieses Epics.**
`NodeSpoolFileSystem.fsyncDirectory()` scheitert auf diesem Windows-Host mit `EPERM`, und
`JournalAcceptance.accept()` ruft `backend.append()` **erst nach** erfolgreichem Verzeichnis-fsync auf
(`JR-4-07` hat das ausdrücklich beschrieben, `JR-4-06a` hatte es schon behandelt). Auf diesem Host
erreicht also **kein** Lauf den Ledger-Append. Die Aussage „`250` erst nach fsync von Spool **und**
Ledger" — der Kern des ganzen Projekts — ist damit **lokal nicht prüfbar** und war zugleich in der CI
nicht geprüft. Vierzehn Scheiben wurden auf Zahlen abgenommen, die diesen Pfad nicht enthalten.

### Zwei Ursachen, und die zweite ist die eigentliche

1. **Technisch:** die Per-Datei-Prettier-Prüfung der Scheiben lief über LF-normalisierte Kopien, um
   F35 zu umgehen — und eine Umgehung, die zu viel normalisiert, verdeckt einen echten Verstoß. Behoben
   in `1fc7de4` (Formatierung über die Prettier-API mit erhaltenen Zeilenenden, danach erneut geprüft).
2. **Verfahren:** **der PO hat nach keinem einzigen Push den CI-Lauf angesehen.** Der Auftrag „zitiere
   die Zahlen, nicht das Wort grün" war an die DEV-Rolle gerichtet und wurde dort befolgt — aber
   niemand hat gefragt, ob dieselben Zahlen auch auf der Plattform entstehen, auf der sie zählen. Als
   Gegenmaßnahme steht in `.claude/agents/senior-dev.md` jetzt die Pflicht, nach dem Push den CI-Lauf
   zu prüfen und seine Schlussfolgerung neben den lokalen Zahlen zu berichten; **der PO prüft ihn ab
   sofort selbst, bevor er eine Scheibe für erledigt erklärt.**

> **Die Lehre ist dieselbe wie in F14/F15 und Fallstrick 6, eine Ebene höher:** eine grüne Zahl belegt
> nur das, was der Lauf ausgeführt hat. Bisher war die Frage „ist die Suite gelaufen?" — jetzt lautet
> sie „**ist sie dort gelaufen, wo der Pfad existiert?**"

### Aufgelöst am 2026-08-03: der erste grüne Lauf, und was er zusätzlich belegt

Lauf **`30808478519`** auf `1fc7de4` ist **`success`** (2 min 27 s):

```
Test Files  72 passed (72)
[TEST-EXECUTED] unit: ci 742/742 · integration: ci 111/111 · adversarial: ci 37/37
Suite inventory verified: unit 49/49, integration 18/18, adversarial 5/5, 0 unclassified test files.
No oa_test_* databases left behind.
```

Die Zahlen sind mit den lokalen identisch (742 + 111 + 37 = 890) — **aber die 111
Integrationstests sind auf Linux gelaufen**, also durch den Ledger-Append, den `EPERM` auf dem
Windows-Host abschneidet. Damit ist der Acceptance-Contract zum ersten Mal über seine **ganze** Länge
gemessen und nicht nur bis zum Verzeichnis-fsync. Die vierzehn Scheiben davor sind damit nachträglich
gedeckt; der Vorbehalt aus diesem Befund ist eingelöst, nicht weggeredet.

Nebenbefund aus demselben Lauf, **nicht** neu und **nicht** blockierend: der Harness lässt
„stale-looking" Datenbanken stehen, solange etwas mit ihnen verbunden ist
(`oa_test_…_ledger_concurrency` während `JR-2-08`s Lastlauf) und meldet das als
`TEST-COVERAGE NOTICE`. Am Ende steht trotzdem „No `oa_test_*` databases left behind." — das
Verhalten ist F13s bekannter Bereich und arbeitet hier korrekt. Ein Typfehler in einer

> `packages/journaling`-Testdatei fällt niemandem auf, solange ihn nicht zufällig ein Agent beim
> Arbeiten sieht — hier haben es zwei unabhängig voneinander gemeldet, und beide haben ihn korrekt als
> nicht ihren eingeordnet und liegen gelassen. Dieselbe Klasse wie F14/F15 (der Wächter zählte
> Dateien statt Tests) und wie F35s Nebenwirkung: **ein grüner Lauf, dessen Grün eine Lücke im
> Messbereich ist.**

> **Behoben (`JR-4-20`).** Beide Hälften, wie im Befund gefordert:
>
> **1. Die Kollision strukturell ausgeschlossen, nicht nur umbenannt.** `RecipientAclEvaluator`
> (`packages/journaling/src/ingress/smtp-server.ts`) heißt jetzt `evaluateRecipient(rcptToAddress)`
> statt `evaluate(rcptToAddress)` — der Name, den `SourceAclCache` für diese Rolle bereits **hatte**,
> nur nie über eine Schnittstelle erreichbar war. `handleRcpt()` ruft jetzt
> `this.recipientAclEvaluator.evaluateRecipient(parsed.address)`. Der Nachweis, dass ein künftiger
> Vertauscher nicht mehr kompiliert, ist selbst ein Test, kein Kommentar:
> `packages/journaling/tests/unit/acl-evaluator-port-shapes.test.ts` weist per `@ts-expect-error`
> nach, dass ein Objekt, das nur `SourceAclEvaluator` implementiert, `RecipientAclEvaluator` nicht
> mehr erfüllt (und umgekehrt) — geprüft durch `tsc -p tsconfig.test.json`
> (`pnpm --filter @open-archiver/journaling test:types`), nicht durch die Laufzeit-Assertion allein.
> Die übrigen Ports desselben Prozesses (`AuthCredentialEvaluator.lookupCredential`,
> `PasswordVerifier.compare`, `SourceAclLookup.listActiveSources`, `LedgerBackend.append`,
> `IngressLogger.{debug,info,warn,error}`) tragen dieselbe Falle **nicht** — jeder Methodenname ist im
> gesamten Ingress-Prozess einzigartig, mechanisch nachvollzogen durch die Methodennamen aller
> exportierten Ports in `packages/journaling/src/ingress/` und `packages/journaling/src/ledger/`.
>
> **2. Die untestete Verdrahtung geschlossen.** `bindSourceAclCache()` (neu, in
> `packages/journaling/src/ingress/source-acl-cache.ts`) ist die eine Funktion, die einen
> `SourceAclCache` auf die drei `EsmtpServerOptions`-Rollen abbildet;
> `apps/smtp-ingress/src/index.ts` ruft jetzt genau diese Funktion statt drei Objektliteral-Zeilen
> auszuschreiben. `packages/journaling/tests/unit/source-acl-cache-wiring.test.ts` ruft **dieselbe**
> Funktion, verdrahtet einen echten `SourceAclCache` in einen echten `EsmtpServer` und fährt über
> eine echte Loopback-Verbindung — kein Fake mehr an der Stelle, die den Befund verursacht hat.
> Zusätzlich prüft `smtp-ingress-crash-recovery-boot.int.test.ts`s dritter Fall (`JR-4-18`) jetzt über
> den echten, kompilierten Prozess: `RCPT TO` einer gesäten Route antwortet `250 2.1.5` (die
> Regression, die vor diesem Fix `451` war), `DATA` bleibt `451 4.3.0` (das eigentliche Ziel dieses
> Tests: `journalAcceptance` unverdrahtet nach fehlgeschlagenem Crash-Recovery-Scan).
>
> **Voller Lauf:** `846 passed | 7 skipped`, 67 Dateien (vorher `843 passed | 7 skipped`, 65 Dateien);
> `unit: ci 698/698`, `integration: ci 111/111`, `adversarial: ci 37/37` — exakt, keine Verletzung der
> Suite-Inventur.

---

## F49 — der Reihenfolgetest „Scan vor `listen()`" ist flaky, und der Beweis dafür ist billig

**Schwere:** mittel · **Kategorie:** Testharness · **Ort:**
`packages/backend/tests/integration/smtp-ingress-crash-recovery-boot.int.test.ts`, der Fall
„runs before listen(): the log line precedes »listening«, a ledgered file is requeued, an orphan is
quarantined" (`JR-4-18`) · **Gefunden:** vom PO am 2026-08-03 beim CI-Lauf der Doku-Diät ·
**Status:** **behoben am 2026-08-03** (Rolle DEV, siehe „Behoben" unten)

Der Test belegt eine tragende Zusicherung aus `02-architektur.md` §5: der Crash-Recovery-Scan läuft
**vor** dem Binden des Ports. Er tut das über die Byte-Offsets zweier Log-Zeilen in `stdout` des echten
Kindprozesses — und scheitert reproduzierbar **nicht** reproduzierbar:

```
× runs before listen(): the log line precedes "listening", …
  → expected 581 to be greater than 853
```

**Der Beleg, dass es Flakiness ist und keine Regression, kostet nichts:** derselbe Test war im Lauf
`30822606272` (`4795688`) **grün** und im Lauf `30824258066` (`552d234`) **rot** — und zwischen diesen
beiden Commits ist **ausschließlich Dokumentation** geändert worden (die Doku-Diät). Der
Produktionscode und der Testcode sind byteidentisch. Ein Test, der bei identischem Code beides liefert,
misst etwas anderes als das, was er zu messen vorgibt.

**Die wahrscheinliche Ursache, nicht gemessen:** die beiden Zeilen entstehen über `pino` und landen
über die `stdout`-Pipe eines Kindprozesses. Reihenfolge **im Puffer** ist nicht dasselbe wie
Reihenfolge **der Ereignisse** — Pufferungsgrenzen, Schreibvorgänge in verschiedenen Ticks und die
Frage, ob `pino` synchron oder über einen Transport schreibt, kommen alle in Betracht.

**Warum das mehr ist als ein nerviger Test:** solange er flaky ist, ist die Zusicherung „Scan vor
`listen()`" **nicht** belastbar belegt — jeder grüne Lauf kann Zufall sein, so wie jeder rote.
Und ein flakiger Test in der CI kostet mehr als seine Aussage wert ist, weil er die nächste Abnahme
mit einem Rauschen belastet, das niemand mehr von einem echten Fehlschlag unterscheidet
(`tester.md`: „a flaky adversarial test is useless because nobody will trust its failures").

**Was zu tun ist, in dieser Reihenfolge:** erst herausfinden, **ob die Invariante hält** (kann der Port
gebunden sein, bevor der Scan fertig ist?) — das ist die Frage, die zählt. Erst danach den Nachweis
reparieren. Ein Offset-Vergleich in einem gepufferten Stream ist wahrscheinlich das falsche Instrument;
belastbar wäre eine Beobachtung, die nicht von Pufferung abhängt, etwa ein Verbindungsversuch **während**
des Scans, der abgewiesen werden muss, oder eine Sequenznummer, die der Prozess selbst in beide Zeilen
schreibt.

> **Der Fund ist ein Nebenprodukt der neuen Regel** (F48): weil der PO seit heute nach jedem Push den
> CI-Lauf prüft, ist ein Fehlschlag aufgefallen, der bei einem reinen Dokumentations-Commit sonst
> niemandem aufgefallen wäre — und der gerade deshalb so gut beweisbar war.

### Behoben am 2026-08-03: die Invariante hält, das Instrument war falsch

**Die Reihenfolge stimmt, und zwar strukturell.** `main()` in `apps/smtp-ingress/src/index.ts` ist eine
gerade `async`-Sequenz: `await buildJournalAcceptance(...)` — darin `await runExclusiveCrashRecoveryScan(...)`
— steht **vor** `await server.listen(...)`. Es gibt keinen Pfad, auf dem der Port bindet, bevor der Scan
zurückgekehrt ist. Der Befund betraf nie das Verhalten, nur seinen Nachweis.

**Der Nachweis hängt jetzt am Port statt am Log.** Der Testfall (neuer Name: „does not bind its port until
the scan is done …") hält den Scan **von außen** an — er nimmt selbst
`pg_advisory_xact_lock(crashRecoveryScanLockKey(spoolRoot))`, denselben Schlüssel, den
`runExclusiveCrashRecoveryScan()` braucht — und messt in diesem Zustand:

1. der Kindprozess ist **beweisbar im Scan**: er steht in `pg_locks` als **ungewährter** Waiter auf genau
   diesem Schlüssel (kein `sleep`, keine Logzeile — ein Zustand, aus dem Server gelesen);
2. ein TCP-Connect auf den Port wird **abgelehnt** (`ECONNREFUSED`), und die Orphan-Datei liegt noch
   unangetastet in `incoming/`;
3. nach der Freigabe des Locks antwortet **derselbe** Port mit einem `220`-Banner. Das ist die Gegenprobe,
   die (2) erst zu einem Beleg über die **Reihenfolge** macht statt über einen falschen Port oder einen
   abgestürzten Prozess.

**Kalibriert, nicht nur grün gesehen.** Mit einer absichtlich eingebauten Regression — derselbe Scan, aber
nicht mehr `await`ed, sodass der Port bindet, während er läuft — schlägt der Fall mit
`expected 'connected' to be 'refused'` fehl (und die beiden anderen Fälle der Datei ebenfalls). Ohne diese
Gegenprobe wäre auch der neue Test nur eine Behauptung. Danach viermal in Folge grün, Volllauf
`927 passed | 7 skipped` bei 75 Dateien.

**Was bewusst nicht angefasst wurde: die gemischten Schreibpfade selbst.** `index.ts` schreibt seine
Scan-Zeile über `pino` und seine „listening"-Zeile über `console.log` — zwei unabhängige Puffer auf
demselben Dateideskriptor. **Welche** der beiden Seiten im roten CI-Lauf nachhing, ist **nicht gemessen**;
auf diesem Windows-Host ließ sich die Umkehrung in 3 × 60 Läufen einer Nachbildung nicht reproduzieren
(Node behandelt Pipes auf Windows asynchron, auf Linux synchron — der rote Lauf war Linux). Für den Fix ist
es gleichgültig: der Test vergleicht keine Logzeilen mehr, er **wartet** nur noch auf ihr Vorhandensein, und
das ist von Pufferung unabhängig. **Offen als kleine Betriebsunschönheit:** die Ausgabe eines Laufs kann
„listening" vor „scan complete" zeigen, obwohl die Ereignisse anders lagen. Wer das schließen will, legt
beide Zeilen auf **einen** synchronen Schreibpfad (`pino.destination({ dest: 1, sync: true })`, `console.log`
durch `logger.info` ersetzt); Nutzen ist hier nur die Lesbarkeit des Logs, kein Test hängt mehr davon ab.

## F50 — der `DATA`-Pfad schreibt einmal pro SMTP-Zeile auf die Platte statt gepuffert: Durchsatz hängt an der Zeilenlänge, nicht an der Nachrichtengröße

**Schwere:** mittel · **Kategorie:** Empfangspfad, Performance · **Ort:**
`packages/journaling/src/ingress/smtp-server.ts` (`DataScanner.scan()`, ruft `onContent` einmal je
gefundener CRLF-terminierter Zeile auf), `packages/journaling/src/ingress/spool-write-bridge.ts`
(`SpoolWriteBridge.push()`, ein Objekt je Aufruf, keine Zusammenfassung), `packages/journaling/src/spool/durable-write.ts:160`
(`for await (const chunk of chunks) { await handle.write(chunk); }` — ein `fs`-Write-Aufruf je
Objekt) · **Gefunden:** von TEST am 2026-08-04 beim Bau der `JR-4-10`-Kill-Tests, als ein 20-Runden-
Smoke-Lauf nach zehn Minuten nicht fertig war · **Status:** **behoben in `JR-4-21a`, Commit
`543d73d`** (Rolle DEV, 2026-08-04)

> **Behoben (`JR-4-21a`).** `SpoolWriteBridge.push()` sammelt gepushte Chunks jetzt in einem internen
> Puffer und reicht erst ab `DEFAULT_FLUSH_THRESHOLD_BYTES` (128 KiB, aus dem im Befund selbst
> genannten 64-256-KiB-Rahmen) ein zusammengefasstes Objekt an den Stream weiter — `handle.write()`
> in `durable-write.ts` bekommt dadurch deutlich weniger, dafür größere Chunks, unabhängig davon, wie
> kurz die Zeilen waren, aus denen sie stammen. `end()` leert den Restpuffer auch unterhalb der
> Schwelle (eine Nachricht verliert ihren letzten, nicht vollen Block nicht), `abort()` verwirft ihn
> (ein abgebrochener Schreibvorgang braucht ihn nie). **Unverändert:** `writeDurableSpoolFile()`
> selbst, die fsync-Semantik, die Fehlerpfade (`ENOSPC` etc.), Byte-Treue (`Buffer.concat()`
> transformiert kein Byte) und die Rückstau-Eigenschaft — der Speicherbedarf bleibt ein kleines
> Vielfaches eines Flush-Batches, nicht proportional zur Nachrichtengröße.
>
> **Gemessen** (Skript gegen den echten, kompilierten `SpoolWriteBridge`/`writeDurableSpoolFile()`,
> 50 MB, je einmal mit 60-Byte- und mit 998-Byte-Zeilen, „vorher" per `git stash` auf **nur**
> `spool-write-bridge.ts` zurückgesetzt):
>
> | Zeileninhalt | vorher                | nachher              | Beschleunigung |
> | ------------ | --------------------- | -------------------- | -------------- |
> | 60 Byte      | 58 720 ms (0,88 MB/s) | 629 ms (82,14 MB/s)  | ≈ 93×          |
> | 998 Byte     | 4 110 ms (12,19 MB/s) | 425 ms (117,88 MB/s) | ≈ 9,7×         |
>
> Die eigentliche Signatur des Befunds — der Faktor zwischen kurzen und langen Zeilen bei derselben
> Bytemenge — fällt von **≈ 13,9×** (58 720 / 4 110 ms) auf **≈ 1,48×** (629 / 425 ms): der Durchsatz
> hängt jetzt weit überwiegend an der Bytezahl, nicht mehr an der Zeilenzahl. Die „vorher"-Zahlen
> reproduzieren die ursprüngliche Messung fast exakt (53 816 ms/4 288 ms dort gegen 58 720 ms/4 110 ms
> hier — derselbe Mechanismus, derselbe Host).
>
> **Testfall:** drei neue Fälle in `spool-write-bridge.test.ts` (Batching kleiner Pushes zu wenigen,
> größeren Chunks ohne Byteverlust oder Umordnung; `end()` leert den Restpuffer auch unterhalb der
> Schwelle; `abort()` verwirft ihn), zwei bestehende Fälle dort mit explizitem
> `flushThresholdBytes: 1` versehen, um die Chunkzahl-Wasserlinie unabhängig vom neuen
> Byte-Batching zu isolieren. Zusätzlich eine dauerhafte **Coverage-Notiz**, keine Assertion (wie vom
> Auftraggeber verlangt): `tests/unit/spool-write-bridge-throughput.test.ts` schreibt bei jedem
> `ci`-Lauf 50 MB in beiden Zeilenformen und protokolliert beide Durchsätze über `coverageNotice()` —
> derselbe Mechanismus, den `JR-2-08`/`JR-4-10` schon nutzen. `byte-fidelity-roundtrip.test.ts`
> (`JR-4-07`) und `bdat-data-byte-fidelity.test.ts` (`JR-4-11`) blieben grün. Voller Lauf danach:
> `1038 passed | 8 skipped`, 89 Dateien.

### Was gemessen wurde

Derselbe reale, kompilierte `apps/smtp-ingress`-Prozess, dieselbe 50-MB-`DATA`-Übertragung über einen
echten Loopback-Socket, nur die **Zeilenlänge** des Nachrichteninhalts verändert (Zeilen exakt an
CRLF-Grenzen ausgerichtet, damit der Terminator sauber erkannt wird):

| Zeileninhalt                                | Zeilen (bei 50 MB) | Schreibdauer | Durchsatz  |
| ------------------------------------------- | ------------------ | ------------ | ---------- |
| 60 Byte                                     | 845 626            | 53 816 ms    | 0,93 MB/s  |
| 998 Byte (RFC-Maximum, RFC 5321 §4.5.3.1.6) | 52 429             | 4 288 ms     | 11,66 MB/s |

Derselbe Effekt, kleinerer Maßstab (5 MB, drei Zeilenlängen, zur Bestätigung dass es an der
**Zeilenzahl** und nicht an der absoluten Nachrichtengröße hängt):

| Zeileninhalt | Zeilen (bei 5 MB) | Schreibdauer |
| ------------ | ----------------- | ------------ |
| 60 Byte      | 84 563            | 3 105 ms     |
| 200 Byte     | 25 955            | 1 059 ms     |
| 998 Byte     | 5 243             | 281 ms       |

Der Durchsatz ist **umgekehrt proportional zur Zeilenzahl, nicht zur Bytezahl** — der Faktor 12,5
zwischen den beiden 50-MB-Zeilen entspricht fast genau dem Verhältnis der Zeilenzahlen (16,1). Das
ist die Signatur eines **konstanten Overheads je Zeile**, nicht eines Effekts, der mit der
Nachrichtengröße selbst skaliert.

### Warum, mechanisch

`DataScanner.scan()` ruft `this.onContent(Buffer.concat([contentLine, CRLF]))` **einmal je in `carry`
gefundener Zeile** auf (`smtp-server.ts` Zeile ~797), unabhängig davon, wie viele Zeilen ein einzelner
Socket-„data"-Event geliefert hat. Jeder Aufruf geht über `SpoolWriteBridge.push()` als **ein**
Objekt in einen `objectMode`-`Readable` (`spool-write-bridge.ts`), und `writeDurableSpoolFile()`s
`for await`-Schleife (`durable-write.ts:160`) ruft für **jedes** Objekt einzeln
`await handle.write(chunk)` — ein echter `fs.promises.FileHandle.write()`-Aufruf je SMTP-Zeile, egal
wie kurz die Zeile ist. Die Kommentare in `durable-write.ts` und `spool-write-bridge.ts` begründen das
Streaming-Design ausdrücklich mit der Vermeidung von Vollpufferung im Heap (JR-3-02, der berechtigte
Grund) — aber Streaming pro Zeile ist nicht dieselbe Entscheidung wie Streaming pro Socket-Chunk. Ein
Socket-„data"-Event liefert typischerweise zehn bis mehrere hundert Kilobyte auf einmal; wird das in
Hunderttausende Ein-Zeilen-Schreibaufrufe zerlegt, dominiert der Aufrufoverhead (Promise-Erzeugung,
Systemaufruf, auf Windows zusätzlich der bekannt teurere Datei-I/O-Pfad) vollständig über die
tatsächliche Bytezahl.

### Warum das mehr als eine Marginalie ist

1. **RFC-Ausgangslage widerspricht sich selbst mit diesem Befund.** `docs/dev/journaling/00-rfc.md`
   verlangt ausdrücklich Nachrichten bis 150 MB (Exchange-Online-Journal-Reports wickeln die gesamte
   MIME-Struktur ein zweites Mal ein) — und genau solche Nachrichten bestehen zu einem erheblichen
   Teil aus **kurzen** Zeilen: Base64-kodierte Anhänge brechen bei 76 Zeichen um (RFC 2045 §6.8), viel
   häufiger als die 998-Byte-Obergrenze. Eine 50-MB-Nachricht mit überwiegend Base64-Inhalt hat in der
   Größenordnung von 650 000 Zeilen — näher am langsamen Ende dieser Tabelle als am schnellen.
2. **Das trifft `JR-4-10` unmittelbar.** Ein 500-Runden-Nightly-Soak mit dem in diesem Befund
   gemessenen langsamen Zeilenprofil (60 Byte) hätte, grob gerechnet, im Mittel weit über zehn Sekunden
   je Runde allein für den Schreibanteil gebraucht — bei 500 Runden mehrere Stunden zusätzlich, nur für
   dieses eine Testfeld. Der 20-Runden-`ci`-Smoke-Test aus diesem Befund lief deshalb über zehn Minuten,
   ohne fertig zu werden. **Die konkrete Abhilfe in `JR-4-10`s eigenem Test:** Zeilen am RFC-Maximum
   (998 Byte Inhalt), dokumentiert in `smtp-ingress-kill-during-data.adv.test.ts`s eigenem Kommentar,
   mit Verweis hierher — der Test bleibt eine ehrliche 50-MB-`DATA`-Übertragung, wählt aber bewusst die
   Zeilenform, die dieses Problem nicht auslöst, statt es stillschweigend zu umgehen.
3. **Nicht ausgeschlossen, aber auch nicht gemessen: eine Verstärkung auf diesem Windows-Host.**
   `fs.promises`-Aufrufe sind auf Windows über den Threadpool spürbar teurer als auf Linux
   (`libuv`s Windows-Backend hat keinen echten asynchronen Datei-I/O-Pfad für alle Operationen). Der
   Faktor könnte auf Linux kleiner ausfallen — aber selbst dort bleibt die Architektur **O(Zeilenzahl)**
   statt **O(Chunkzahl)**, und die relative Verlangsamung durch kurze Zeilen (der Faktor ~12,5 in der
   eigenen Messung) ist eine Eigenschaft des Codes, nicht der Plattform.

### Was nicht behauptet wird

Kein Datenverlust, keine Verletzung des Acceptance-Contracts — jede einzelne Zeile wird korrekt
geschrieben, nur langsam. Auch keine unbegrenzte Verzögerung: die Schleife terminiert, sie ist nur
teuer. Nicht geprüft: ob ein Absender-seitiger SMTP-`DATA`-Timeout (bei Exchange Online oder einem
anderen MTA) bei einer hinreichend zeilenreichen 150-MB-Nachricht auf einem produktiven Linux-Host
tatsächlich vor Abschluss der Übertragung feuert — das wäre der Nachweis, der aus dieser Beobachtung
eine **hohe** statt einer **mittleren** Einstufung machen würde, und er braucht eine reale Zielumgebung,
keinen Entwicklerhost.

### Umsetzung

Wie oben beschrieben in `JR-4-21a` behoben: `SpoolWriteBridge` sammelt kurze `onContent`-Zeilen in
einem Zwischenpuffer bis zu 128 KiB, statt jede einzeln an `handle.write()` weiterzugeben —
`writeDurableSpoolFile()` selbst blieb unverändert, die Streaming-Eigenschaft (O(1) Speicher
gegenüber der Nachrichtengröße) ist erhalten.

## F51 — `smtp-ingress-ledger-recovery.int.test.ts` zählte eine Logzeile, bevor die gepipte stdout sie geliefert hatte

**Schwere:** niedrig · **Kategorie:** Testharness (Testinstabilität) · **Ort:**
`packages/backend/tests/integration/smtp-ingress-ledger-recovery.int.test.ts:313-314` (vor der
Reparatur) · **Gefunden:** vom PO am 2026-08-04 anhand des CI-Laufs `30863769294` (`JR-4-11`-Push) ·
**Status:** **behoben in diesem Commit**

### Was passiert ist

CI-Lauf `30863769294` schlug in `smtp-ingress-ledger-recovery.int.test.ts` (`JR-4-19`) fehl:

```
expected 0 to be greater than or equal to 1
```

Alle funktionalen Zusicherungen unmittelbar davor waren grün — der Client hatte `451 4.3.0` erhalten,
`incoming/` war leer. Gefehlt hat allein `countOccurrences(output.stdout(), UNWIRED_LINE) >= 1`,
direkt nach dem Empfang der `451`-Antwort abgefragt, ohne zu warten.

### Die Ursache

`smtp-server.ts` schreibt die Logzeile („acceptance path not yet wired") **synchron vor** dem
`writeResponse(451, …)`-Aufruf, im selben Funktionsdurchlauf — die Reihenfolge in der
Produktionsanwendung ist korrekt und war nie das Problem. Aber die beiden Ereignisse erreichen den
Testprozess über **zwei unabhängige Kanäle**: die `451`-Antwort über den TCP-Socket, die Logzeile über
die gepipte `stdout` des Kindprozesses. Ein Test, der `output.stdout()` in dem Moment abfragt, in dem
die Socket-Antwort eintrifft, unterstellt, dass beide Kanäle synchron ankommen — das tun sie nicht.

Das ist derselbe Fallstrick, den `F49` in dieser Sitzung schon einmal gelernt hat: **am Log messen,
nicht am Verhalten.** Die Datei macht es an anderer Stelle (Zeile 287-291, wartet auf „listening on
port") bereits richtig — nur diese eine Stelle nicht.

### Der Fix

`countOccurrences(...) >= 1` wird jetzt über dasselbe `waitUntil()`-Muster abgewartet, das die Datei
für „listening on port" schon benutzt, **bevor** gezählt wird:

```ts
await waitUntil(
	() => countOccurrences(output.stdout(), UNWIRED_LINE) >= 1,
	5_000,
	'the process never logged that acceptance was not yet wired'
);
const unwiredBefore = countOccurrences(output.stdout(), UNWIRED_LINE);
expect(unwiredBefore).toBeGreaterThanOrEqual(1);
```

Die übrigen `output.stdout()`-Abfragen derselben Datei wurden auf dasselbe Muster geprüft: Zeile
293-295 (Prüfung auf „could not build journal acceptance") folgt bereits einem `waitUntil` auf
„listening on port" **auf demselben Pipe** — da Node die Schreibvorgänge eines einzelnen Kindprozesses
auf **einem** Deskriptor in Schreibreihenfolge ausliefert, ist die Reihenfolge zwischen zwei Zeilen
auf demselben Pipe garantiert, unabhängig davon, wann die zweite Zeile beobachtet wird. Zeile 328
(Zählung von `PROMOTION_LINE`) folgt bereits einem eigenen `waitUntil`. Zeile 337 (Prüfung, dass die
Zählung **unverändert** blieb) prüft eine Abwesenheit, nicht ein Erscheinen — dort gibt es kein
Rennen in dieselbe Richtung, die diesen Befund ausgelöst hat. Keine weitere Stelle in der Datei zeigt
dasselbe Muster.

### Kalibrierung

Die Logzeile wurde in `packages/journaling/src/ingress/smtp-server.ts` testweise entfernt (nur der
`this.logger.info(...)`-Aufruf, `writeResponse(451, …)` blieb), `journaling`/`smtp-ingress-app` neu
gebaut, der reparierte Test gegen echtes Postgres gefahren:

```
× starts unusable, answers 451 with an untouched spool, then accepts on the same connection once
  the database is fixed -- no restart
  → the process never logged that acceptance was not yet wired: condition not met within 5000ms
```

Der reparierte Test wird also **rot**, wenn die Zeile wirklich fehlt — nicht nur, wenn sie langsam
ankommt. Anschließend die Entfernung vollständig zurückgenommen (`git diff` gegen
`packages/journaling/src/ingress/smtp-server.ts` zeigt **keine** Abweichung), neu gebaut, der Test
lief wieder grün.

### Was nicht angefasst wurde

Kein Produktionscode-Fix — die Ursache liegt ausschließlich in der Beobachtung des Tests, nicht im
Verhalten des Servers. Keine Änderung an der Aussage des Kriteriums selbst, nur an der Art, wie sie
gemessen wird.

## F52 — `MAX_COMMAND_LINE_BYTES` greift nur bei einer nie terminierten Zeile, nicht bei einer überlangen, aber in einem Stück CRLF-terminierten

**Schwere:** mittel · **Kategorie:** Empfangspfad, RFC-Konformität/Ressourcenbegrenzung · **Ort:**
`packages/journaling/src/ingress/smtp-server.ts:1390-1397` (`SmtpConnection.drainCommandCarry`) ·
**Gefunden:** von TEST am 2026-08-04 beim Bau von `JR-4-14` (adversariale Protokollrobustheit,
ADR-029 Auflage 1, Fallgruppe „überlange Envelope-Adressen") · **Status:** **behoben in `JR-4-21`,
Commit `3b2bc66`** (Rolle DEV, 2026-08-04)

> **Behoben (`JR-4-21`).** Die Grenze sitzt jetzt zeilenweise in `drainCommandCarry()` selbst: der
> `idx !== -1`-Zweig prüft `idx > MAX_COMMAND_LINE_BYTES`, **bevor** die Zeile extrahiert wird, genau
> die Prüfung, die hier gefehlt hat — der `idx === -1`-Zweig war unverändert schon richtig. Das ist
> nach `go-smtp`s Vorlage (ADR-029-Nachtrag), aber **nicht** als ein eifriger Scan über den ganzen
> Puffer: eine erste Fassung hat genau das versucht und `JR-4-07`s Byte-Treue-Suite zerschossen, weil
> ein pipeliniertes `BDAT <n> LAST` samt eigenem Inhalt in einem Paket wie eine überlange Zeile aussah
> — gefunden vom **Volllauf**, nicht von F52/F53s eigenen Tests. Die Schleife prüft deshalb genau eine
> Zeile zur Zeit, in der Reihenfolge, in der sie ohnehin verarbeitet wird, und verlässt sich darauf,
> nie ein zweites `indexOf(CRLF)` aufzurufen, sobald eine Zeile `DATA`/`BDAT` einleitet — das ist
> dieses Projekts strukturelles Gegenstück zu `go-smtp`s `LineLimit = 0`, ohne eigenes Flag.
>
> **Kalibriert, wiederholt statt einmalig:** ein eigenständiges `node`-Skript (kein `vitest`) hat
> gegen den echten, kompilierten Server je 10 Verbindungen bei ~2 000 Byte gefahren, einmal gegen den
> Fix und einmal gegen den per `git stash` auf **nur** `smtp-server.ts` zurückgesetzten Vorzustand:
> **10/10 `250` vorher, 10/10 `500 5.5.1` nachher**, beide Male in 1–8 ms. Testfall in
> `packages/journaling/tests/adversarial/smtp-protocol-robustness.adv.test.ts`, jetzt „fixed in
> `JR-4-21` (F52): …" statt der bisherigen „FINDING"-Dokumentation des Ist-Zustands.

### Was gemessen wurde

RFC 5321 §4.5.3.1.4 begrenzt eine Kommandozeile auf 512 Oktette. `drainCommandCarry()` prüft dieses
Limit — aber nur in einem einzigen Zweig:

```ts
const idx = this.commandCarry.indexOf(CRLF);
if (idx === -1) {
	if (this.commandCarry.length > MAX_COMMAND_LINE_BYTES) {
		this.writeResponse(500, '5.5.1', 'Line too long');
		this.socket.end();
	}
	return;
}
const lineBuf = this.commandCarry.subarray(0, idx);
```

`MAX_COMMAND_LINE_BYTES` (512) wird ausschließlich abgefragt, wenn `indexOf(CRLF)` **kein**
Ergebnis liefert — also nur, solange eine Zeile noch nicht durch ihr eigenes `CRLF` abgeschlossen
ist. Sobald `commandCarry` ein `CRLF` enthält, egal an welcher Position, nimmt der Code den
`idx !== -1`-Zweig, extrahiert die komplette Zeile (`subarray(0, idx)`, beliebig lang) und
verarbeitet sie ganz normal über `processCommandLine()` — ohne die Zeile jemals gegen das Limit zu
prüfen.

Das ist über einen echten Socket reproduzierbar, deterministisch, nicht auf TCP-Fragmentierung
angewiesen: ein einzelner `write()`-Aufruf mit einer 2000-Byte-Adresse **plus ihrem eigenen
CRLF** —

```ts
const oversizedAddress = 'a'.repeat(2_000);
await client.writeRaw(`MAIL FROM:<${oversizedAddress}@example.com>\r\n`);
```

— wird mit `250` beantwortet, nicht mit `500 5.5.1`. Der Test, der das zeigt, steht in
`packages/journaling/tests/adversarial/smtp-protocol-robustness.adv.test.ts` (Gruppe „a line that
never completes with CRLF …", Fall „FINDING (see report/F52) …") und ist absichtlich als
Dokumentation des **Ist-Zustands** formuliert, nicht als Regressionsschutz für ein gewünschtes
Verhalten: der Kommentar dort sagt ausdrücklich, dass eine künftige Behebung diese Zeile ändern
muss, nicht nur den Test lockern darf.

### Warum das mehr als ein Format-Detail ist

1. **RFC-Konformität**: die 512-Byte-Grenze ist in RFC 5321 kein Vorschlag, sondern eine Zusage an
   den Client („MUST be able to receive... 512 octets"), die diese Implementierung damit für jede
   Zeile bricht, die vollständig in einem TCP-Segment ankommt.
2. **Ressourcenbegrenzung**: die Grenze ist genau der Mechanismus, den `JR-4-14`s Akzeptanzkriterium
   „lässt den Speicher unbegrenzt wachsen" adressieren soll. Für eine Zeile, die **fragmentiert**
   ankommt, greift die Prüfung zuverlässig (siehe die zwei grünen Fälle im selben Testfile, die
   genau das zeigen — 50 000 Byte in einem Stück und 40×20 Byte über mehrere Schreibvorgänge treffen
   beide den `idx === -1`-Zweig und werden korrekt mit `500`+Verbindungsabbruch beantwortet). Wie
   groß eine „in einem Stück" ankommende Zeile in der Praxis werden kann, hängt von Node/`libuv`s
   Lesepuffergröße und der Sendegeschwindigkeit des Angreifers ab — nicht unbegrenzt, aber ohne
   diesen Fund auch nicht durch `MAX_COMMAND_LINE_BYTES` begrenzt, sondern nur durch das, was ein
   einzelner `read()`-Syscall zurückgibt (in dieser Messung genügten 2000 Byte problemlos; nicht
   gemessen, wie weit sich das treiben lässt, bevor das Betriebssystem selbst fragmentiert).
3. **Betrifft mehr als `MAIL FROM`**: derselbe Zweig gilt für **jede** Kommandozeile — eine
   überlange `RCPT TO`, ein überlanger, aber syntaktisch gültiger Verb-Präfix, jede Zeile. Die
   Fallgruppe „überlange Envelope-Adressen" aus dem Backlog ist der Fall, der es zuerst auffällig
   gemacht hat, aber die Ursache ist allgemein.

### Kalibrierung

Der Fund ist eine direkte Ableitung aus dem Quelltext (die `if (idx === -1)`-Verzweigung lässt keine
andere Lesart zu), zusätzlich am echten `EsmtpServer` über einen echten Loopback-Socket gemessen,
nicht nur am Quelltext behauptet — der oben zitierte Testfall demonstriert `250` statt `500` mit dem
tatsächlichen Server. Eine Gegenprobe mit einer **kurzen** Adresse (unter 512 Byte) ergibt ebenfalls
`250` — das beweist an sich nichts (das ist der Normalfall), zeigt aber, dass der Fund nicht an
irgendeinem Nebeneffekt der Testadresse hängt.

### Was nicht angefasst wurde

Kein Produktionscode-Fix — Befund dokumentiert, gemeldet, Entscheidung liegt beim Auftraggeber (E4
Randbedingung: „Kein Produktionscode-Fix ohne Rückfrage"). Ein möglicher Fix: den Längen-Check auch
im `idx !== -1`-Zweig ausführen (`idx > MAX_COMMAND_LINE_BYTES` prüfen, bevor die Zeile extrahiert
wird) — nicht umgesetzt, nur als Richtung notiert.

### Koordinationsnotiz — aufgelöst durch den PO (2026-08-04)

Zwei unabhängig entstandene `JR-4-14`-Dateien trafen genau diesen Defekt aus verschiedenen
Richtungen: der eigene Testfall der zweiten, zwischenzeitlich vorhandenen Datei
(`packages/journaling/tests/unit/smtp-adversarial-protocol.test.ts`, Fall „an envelope address that
pushes the whole command line over the length cap …") war **unabhängig davon rot**
(`expected '250 2.1.0 Ok' to match /^500 5\.5\.1/`) — zwei getrennt geschriebene Suiten, die denselben
Defekt treffen, sind ein stärkerer Beleg als eine. Der PO hat die Nummern entschieden: **F52 bleibt
dieser Fund**, der andersartige Fund derselben zweiten Datei (`commandCarry` wächst während eines
suspendierten Fensters ungeprüft) ist **F53** (eigener Abschnitt unten, Finder: tester-jr-4-10). Die
zweite Datei ist inzwischen vollständig in
`packages/journaling/tests/adversarial/smtp-protocol-robustness.adv.test.ts` aufgegangen (ihre
eigenständigen Fälle übernommen, u. a. der F53-Nachweis mit echtem `PasswordVerifier`, die
Verbindungslimit-Verfeinerung mit einem noch offenen zweiten Slot, und die Kalibrierung von
`expectServerStillAcceptsAValidMessage()` gegen einen geschlossenen Port) und danach gelöscht.

## F53 — `commandCarry` wächst während eines suspendierten Fensters (`AUTH`, settling `accept()`) völlig ungeprüft

**Schwere:** mittel · **Kategorie:** Empfangspfad, Ressourcenbegrenzung · **Ort:**
`packages/journaling/src/ingress/smtp-server.ts` (`SmtpConnection.onData()`, der
`commandProcessingSuspended`-Zweig) · **Gefunden von:** tester-jr-4-10, beim eigenständigen Bau einer
zweiten `JR-4-14`-Suite in derselben Sitzung · **Status:** **behoben in `JR-4-21`, Commit `3b2bc66`**
(Rolle DEV, 2026-08-04)

> **Behoben (`JR-4-21`).** Anders als F52 (zeilenweise Prüfung in `drainCommandCarry()`) prüft der
> `commandProcessingSuspended`-Zweig eifrig über den **ganzen** neu zusammengesetzten Puffer
> (`appendDuringSuspension()`), weil `drainCommandCarry()` hier per Definition nicht läuft. Das ist
> nur deshalb sicher, weil ein suspendiertes Fenster (laufender `AUTH`-Bcrypt-Vergleich oder
> settelnder `accept()`-Aufruf) protokollbedingt **nie** rohe `DATA`/`BDAT`-Inhaltsbytes trägt —
> `bdatChunkRemaining` ist zu diesem Zeitpunkt bereits `null`, `dataScanner` bereits fertig. Geprüft
> wird die Länge jeder einzelnen, durch CRLF abgegrenzten Zeile im Puffer, nicht die Gesamtlänge —
> sonst würde legitim gepipelinete, aber gestapelte kurze Kommandozeilen fälschlich abgelehnt.
>
> **Kalibriert:** derselbe Testfall in `smtp-protocol-robustness.adv.test.ts` (400-ms-Fenster,
> 20 MB Flut) zeigt nach dem Fix eine sichtbar andere Form — die Verbindung wird jetzt innerhalb des
> ersten überlangen Chunks abgelehnt statt die volle Fensterdauer zu füllen, gemessen: 2,0 MB
> gesendet statt der vollen Flut, `arrayBuffers` +5,1 MB statt der ungebremsten Werte vor dem Fix.
> Nicht als Schwelle assertiert (unverändert keine vom Auftraggeber freigegebene Obergrenze), aber
> die Testbeschreibung ist von „reported as F53, not fixed here" auf „fixed in `JR-4-21`" umgestellt.

### Was gemessen wurde

`onData()` behandelt drei Fälle: `state === 'data'`, ein offenes `BDAT`, und — als dritten,
eigenständigen Zweig — `commandProcessingSuspended`:

```ts
if (this.commandProcessingSuspended) {
	// ... erläuternder Kommentar im Quelltext ...
	this.commandCarry = Buffer.concat([this.commandCarry, chunk]);
	return;
}
```

Dieser Zweig hängt jeden eingehenden Chunk **bedingungslos** an `commandCarry` an und kehrt sofort
zurück — er ruft `drainCommandCarry()` gar nicht auf, und `drainCommandCarry()` ist die **einzige**
Stelle, an der `MAX_COMMAND_LINE_BYTES` je geprüft wird (siehe F52 oben). Solange
`commandProcessingSuspended` `true` ist — laufender `AUTH`-Bcrypt-Vergleich
(`verifyCredentials()`) oder ein settelnder `accept()`-Aufruf —, gibt es für die Größe von
`commandCarry` **keine** Prüfung jeder Art, unabhängig davon, ob die eingehenden Bytes fragmentiert
oder in einem Stück ankommen (der Unterschied, der F52 von F53 trennt, spielt hier keine Rolle mehr).

**Gemessen** (Testfall „measures commandCarry growth during one suspended AUTH window", übernommen
nach `packages/journaling/tests/adversarial/smtp-protocol-robustness.adv.test.ts`): während eines
einzigen, 400 ms langen suspendierten `AUTH LOGIN`-Fensters (ein absichtlich verzögerter
`PasswordVerifier` steht für die reale Kosten eines Bcrypt-Vergleichs) wurden vor dem Fix
**~6,0 MB** CRLF-freier Bytes gesendet, und `process.memoryUsage().arrayBuffers` wuchs dabei um:
**28,3 MB** (CI, Linux, Lauf `30900280611`), **76,6 MB** und **83,7 MB** (zwei lokale Läufe
verschiedener Bearbeiter unter Windows) — über mehrere Läufe eines Bearbeiters hinweg zwischen
**54,6 und 135,0 MB**. **Reproduzierbar ist die Größenordnung — ein Vielfaches der gesendeten
Menge —, nicht der einzelne Wert:** der CI-Wert ist mit knapp Faktor 5 der niedrigste der vier
Messungen, und die Aussage hält trotzdem. Vermutete, nicht weiter verifizierte Ursache der Streuung:
der GC-Zeitpunkt relativ zum Messpunkt und Zwischenzustände wiederholter `Buffer.concat()`-Aufrufe,
von denen jeder eine neue, größere Kopie alloziert, während die alte kurzfristig doppelt gehalten
wird, bis der GC sie einsammelt. **Nach dem Fix** (`JR-4-21`) wurden bei **2,0 MB** gesendeter Daten
nur noch **4,0 MB** (CI) bzw. **5,1 MB** (lokal) Wachstum gemessen — die Ablehnung greift jetzt
innerhalb des ersten überlangen Chunks, statt die volle Fensterdauer zu füllen. Nach Ablauf des
Fensters antwortet der Server korrekt (`535` falsche Zugangsdaten oder `501` bei einer als
SASL-Fortsetzung fehlinterpretierten Flut) — der Prozess erholt sich, das Fenster ist nur eine
Verzögerung, keine dauerhafte Sperre.

### Warum das ernster ist als reine Speicherkosmetik

Die Fensterdauer ist an einen echten, langsamen kryptographischen Vergleich gekoppelt (Bcrypt,
Kostenfaktor 10 laut `smtp-server.ts`s eigenem `AUTH_DUMMY_PASSWORD_HASH`-Kommentar) — ein Angreifer
kann das Fenster **selbst nicht verlängern**, aber er kann es **beliebig oft öffnen** (jeder
`AUTH`-Versuch öffnet ein neues, bis `MAX_AUTH_ATTEMPTS_PER_CONNECTION` = 3 pro Verbindung greift)
und **jedes einzelne Fenster** mit so vielen Bytes fluten, wie die Netzwerkverbindung in der
Fensterzeit zulässt — ohne die sonst überall geltende 512-Byte-Grenze.

### Kalibrierung

Nicht als Schwelle assertiert (es gibt keine vom Auftraggeber freigegebene Obergrenze, gegen die
sich "bestanden/durchgefallen" sinnvoll entscheiden ließe) — die Zahl wird protokolliert
(`console.warn`), nicht geprüft. Die Kalibrierung liegt in der Mechanik selbst: derselbe Testfall
zeigt, dass der Prozess nach dem Fenster korrekt antwortet (kein Hänger), und der Verzögerungsmechanismus
(`slowVerifier`) macht das Fenster deterministisch beobachtbar, ohne von echtem `bcryptjs`-Timing
abhängig zu sein (dieselbe Begründung, die `smtp-auth-protocol.test.ts`s `RecordingPasswordVerifier`
für einen Fake statt echtem `bcryptjs` schon gibt).

### Was nicht angefasst wurde

Kein Produktionscode-Fix — Befund dokumentiert, gemeldet, Entscheidung liegt beim Auftraggeber.
Ein möglicher Fix: `commandCarry` auch im `commandProcessingSuspended`-Zweig gegen eine Obergrenze
prüfen (nicht notwendigerweise `MAX_COMMAND_LINE_BYTES`, da hier keine Kommandozeile erwartet wird,
sondern Rohbytes bis zur Wiederaufnahme) — nicht umgesetzt, nur als Richtung notiert.

## F54 — der Abbruchpfad von `MAX_COMMAND_LINE_BYTES` ist nicht idempotent: eine fragmentiert ankommende überlange Zeile kann zu einem `ECONNRESET` statt einem sauberen `500` führen

**Schwere:** mittel · **Kategorie:** Empfangspfad, Protokollkonformität · **Ort:**
`packages/journaling/src/ingress/smtp-server.ts` (`drainCommandCarry()`, der `idx === -1`-Zweig, und
`onData()`, der Zweig für den ordinären Kommando-Modus) · **Gefunden:** von TEST am 2026-08-04, beim
Untersuchen, warum ein für `JR-4-14` übernommener Testfall mit einer 2-MB-Adresse zuverlässig am
5-Sekunden-`testTimeout` der `unit`-Projektkonfiguration scheiterte, statt (wie die ursprüngliche
Fallbeschreibung erwartete) mit einem schnellen `250` · **Status:** **behoben in `JR-4-21`, Commit
`3b2bc66`** (Rolle DEV, 2026-08-04). Vom Auftraggeber bestätigt — der Zusatz „Vorschlag, noch nicht
bestätigt" ist entfernt.

> **Behoben (`JR-4-21`).** Zwei Mechanismen: `oversizedLineRejected` (neues Feld) latcht die erste
> Ablehnung — jeder weitere `onData()`-Aufruf prüft dieses Flag **zuerst** und tut sonst nichts mehr,
> also auch keinen zweiten `writeResponse()`/`socket.end()`-Aufruf. Das allein reicht nicht: dieselbe
> Kollisionsklasse tritt auch auf, wenn eine **andere** asynchrone Fortsetzung (`verifyCredentials`s
> Bcrypt-`.then()`, `completeTransfer`s `accept()`-Fortsetzung) nach einer bereits erfolgten Ablehnung
> noch schreiben will — deshalb prüfen `writeResponse()`/`writePlain()` jetzt zusätzlich
> `socket.writableEnded` (nicht nur `socket.destroyed`, das `socket.end()` nicht synchron setzt).
>
> **Kalibriert, mit Wiederholung statt einem Lauf** (Auftraggeber-Anforderung, weil ein einzelner
> grüner Lauf hier nichts beweist — der Fall ist ohne Wiederholung nicht sicher von einem seltenen
> Rennen zu unterscheiden): der reguläre `vitest`-Testfall zehnmal hintereinander gegen den Fix
> gefahren, **10/10 grün**. Zusätzlich ein eigenständiges `node`-Skript (kein `vitest`, kein
> Pro-Test-Timeout) gegen den echten kompilierten Server, **10 Verbindungen je Größe**, an der vom
> Auftraggeber benannten Größenmatrix:
>
> | Größe   | vorher (10 Läufe, nur `smtp-server.ts` per `git stash` zurückgesetzt) | nachher (10 Läufe) |
> | ------- | --------------------------------------------------------------------- | ------------------ |
> | ~2000 B | 10/10 falsches `250` (F52)                                            | 10/10 `500 5.5.1`  |
> | 100 KB  | 10/10 `500` (war nie kaputt — der `idx === -1`-Zweig griff schon)     | 10/10 `500`        |
> | ~200 KB | 10/10 Reset/Hänger, keine lesbare Antwort                             | 10/10 `500`        |
> | 2 MB    | 10/10 Reset/Hänger, keine lesbare Antwort                             | 10/10 `500`        |
>
> Nach dem Fix antworten alle vier Größen einheitlich in 1–11 ms — keine Chunk-Abhängigkeit mehr, das
> Signal, das laut Auftraggeber zeigt, dass die Grenze jetzt an der richtigen Schicht sitzt. Der
> `RED UNTIL JR-4-21`-Marker im Testfall (`smtp-protocol-robustness.adv.test.ts`) ist entfernt.
>
> **Die eigentliche Erkenntnis dieser Scheibe liegt nicht in F52/F53/F54 selbst, sondern in einer
> Regression, die der Fix zwischenzeitlich selbst eingeführt hat:** eine erste Fassung hat die
> Zeilenlängengrenze als eifrigen Scan über den **ganzen** neu zusammengesetzten Puffer umgesetzt
> („die Grenze sitzt im Reader" zu wörtlich genommen) und damit `JR-4-07`s Byte-Treue-Suite
> zerschossen: ein pipeliniertes `BDAT <n> LAST` samt eigenem Inhalt in einem Paket sah, bevor die
> Kommandozeile geparst war, wie eine einzige überlange Zeile aus. **Gefunden hat das der Volllauf,
> nicht F52s oder F53s eigene Tests** — genau die Konstellation, vor der `go-smtp`s `LineLimit = 0`
> um `BDAT` (ADR-029-Nachtrag, Punkt 2) warnt. Behoben, indem F52 zeilenweise **innerhalb**
> `drainCommandCarry()`s bestehender Schleife prüft (die dort ohnehin nie ein zweites `indexOf(CRLF)`
> auf Inhaltsbytes aufruft) und nur F53s Fall — wo Inhaltsbytes protokollbedingt ausgeschlossen sind —
> weiterhin eifrig über den ganzen Puffer scannt.

### Was gemessen wurde

Eine überlange, **fragmentiert** ankommende Kommandozeile (groß genug, dass Node den `write()` nicht
als einen einzigen `data`-Event zustellt — ab ca. 100 KB reproduzierbar gemessen, siehe Tabelle) löst
den in F52 zitierten `idx === -1`-Zweig korrekt aus: `writeResponse(500, '5.5.1', 'Line too long')`
gefolgt von `this.socket.end()`. Das Problem liegt **danach**: `commandCarry` wird bei diesem Aufruf
**nicht** zurückgesetzt, und es gibt kein Merkmal wie „diese Verbindung wurde bereits abgelehnt,
ignoriere alles Weitere". Trifft nach dem `socket.end()` ein **weiterer** Chunk derselben,
bereits im Zustellungsprozess befindlichen Zeile ein (üblich: der Client hat den ganzen `write()`
schon an das Betriebssystem übergeben, bevor er überhaupt eine Antwort lesen konnte), ruft
`onData()` erneut `drainCommandCarry()` auf, das **erneut** `writeResponse(500, …)` und **erneut**
`this.socket.end()` aufruft — auf einem Socket, der sich bereits im Schließen befindet. Gemessen,
mit echtem Logger: das erzeugt zuverlässig

```
smtp-ingress: socket error {"err":{"code":"ERR_STREAM_WRITE_AFTER_END"}}
```

und der Socket wird daraufhin mit einem **RST** statt einem geordneten FIN geschlossen — was beim
Client als `ECONNRESET` ankommt. **Nicht deterministisch, ob der Client die ursprüngliche
`500`-Zeile noch zu lesen bekommt, bevor der Reset eintrifft** — in wiederholten Läufen desselben
Szenarios kam die `500`-Zeile manchmal beim Client an (im gepufferten `data`-Text sichtbar) und
manchmal nicht (ein Testklient, der auf eine vollständige, mit Regex erkannte Antwortzeile wartet,
sah in mehreren Läufen **gar keine** Antwort und lief in seinen eigenen 15/30-Sekunden-Timeout,
obwohl der Server nach wenigen Millisekunden bereits geantwortet **und** sich beendet hatte).

**Größentabelle** (einzelner `write()`, lokal auf diesem Host gemessen, `EsmtpServer` ohne TLS/ACL):

| Adressgröße                                     | Beobachtung                                                                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10 KB, 50 KB                                    | ein `data`-Event, komplette Zeile inkl. CRLF sofort verarbeitet → `250` (F52)                                                                                                      |
| 100 KB                                          | fragmentiert, erster Chunk > 512 Byte ohne CRLF → korrektes `500`, keine Wiederholung beobachtet                                                                                   |
| 200 KB – 1600 KB (jede gemessene Zwischengröße) | fragmentiert, **wiederholter** `writeResponse`+`socket.end()`-Aufruf, `ERR_STREAM_WRITE_AFTER_END`, `ECONNRESET` beim Client, `500`-Zeile beim Client **nicht zuverlässig lesbar** |

Die genaue Schwelle zwischen „ein Chunk" und „mehrere Chunks" ist eine Eigenschaft von Node/`libuv`s
Lesepuffergröße auf diesem Host, nicht eine feste, dokumentierte Konstante — auf einem anderen Host
oder unter anderer Last kann sie abweichen.

### Warum das über F52 hinausgeht

F52 sagt: eine überlange **atomare** Zeile wird nie geprüft und einfach akzeptiert. Dieser Fund sagt
etwas Schärferes über den **Ablehnungspfad selbst**: die Ablehnung, wenn sie greift, ist nicht
idempotent, und ihr Fehlschlag beim zweiten Versuch beschädigt die ursprüngliche, bereits
geschriebene Antwort möglicherweise noch **vor** deren zuverlässiger Zustellung. Das verletzt „jeder
Fall ist aus Client-Sicht ausgewertet" im wörtlichen Sinn: aus Client-Sicht ist das Ergebnis für
identische Eingaben bei wiederholten Läufen manchmal ein korrektes `500`, manchmal ein nackter
Verbindungsabbruch ohne jede SMTP-Antwort — kein Crash des Serverprozesses (der Prozess selbst lief
in jedem Lauf weiter und nahm danach neue Verbindungen an), aber ein für den Sender nicht
unterscheidbares Verhalten von einem Netzwerkfehler.

### Kalibrierung

Reproduzierbar mit einem eigenständigen Skript gegen den echten, kompilierten `EsmtpServer`
(`node:net`, kein `vitest`, keine Zeitbeschränkung) über eine Größenreihe (10 KB bis 1600 KB) sowie
zweimal wiederholt bei 200 KB — beide Läufe zeigten denselben `ERR_STREAM_WRITE_AFTER_END` und
`ECONNRESET`, mit unterschiedlicher Reihenfolge zwischen dem Log-Eintrag und dem Zustellzeitpunkt der
`500`-Zeile beim Client (nicht deterministisch, aber der Fehler selbst reproduzierbar). Keine
Produktionscode-Änderung vorgenommen.

### Was nicht angefasst wurde

Kein Produktionscode-Fix, und **diese Nummer (F54) ist ein Vorschlag, keine vom Auftraggeber
bestätigte Zuweisung** — anders als F52/F53 wurde sie nicht vorab vergeben, weil der Fund erst bei
der Zusammenführung der beiden `JR-4-14`-Dateien entstand. Ein möglicher Fix: `commandCarry` beim
ersten `writeResponse(500, …)` leeren und einen Zustand „bereits abgelehnt" setzen, den jeder weitere
`onData()`-Aufruf zuerst prüft, bevor er irgendetwas anderes tut — nicht umgesetzt, nur als Richtung
notiert.

## F55 — kein Limit für die Anzahl angenommener `RCPT TO` je Transaktion

**Schwere:** mittel · **Kategorie:** Empfangspfad, Ressourcenbegrenzung · **Ort:**
`packages/journaling/src/ingress/smtp-server.ts` (`SmtpConnection.handleRcpt()`,
`recordMatchedRecipient()`, die Felder `rcptTo`/`matchedRecipients`) · **Gefunden:** von TEST am
2026-08-04, im Rahmen von `JR-4-15` (ADR-029 Auflage 2, Scope-Punkt „Ressourcengrenzen je
Verbindung") · **Status:** **behoben in `JR-4-21a`, Commit `8755d9b`** (Rolle DEV, 2026-08-04)

> **Behoben (`JR-4-21a`).** `smtp-config.ts` bekommt ein neues Feld `maxRecipientsPerTransaction`
> (Default `1000`, per Zod auf `.min(100, ...)` begrenzt — RFC 5321 §4.5.3.1.8 verlangt, dass ein
> Server **mindestens** 100 Empfänger je Nachricht annimmt, ein niedrigerer Wert wäre also selbst ein
> Normverstoß, keine bloß strengere Einstellung). `handleRcpt()` prüft `this.rcptTo.length >=
this.smtp.maxRecipientsPerTransaction` **unbedingt**, vor der ACL-Verzweigung — die Grenze gilt
> also unabhängig davon, ob überhaupt ein `recipientAclEvaluator` konfiguriert ist. Bei Überschreitung
> antwortet der Server `452 4.5.3`, mit einem Text, der sich bewusst von ADR-030s eigenem `452 4.5.3`
> („andere Kette") unterscheidet — sonst könnte ein Betreiber die beiden Ursachen im Log nicht
> auseinanderhalten. Die Transaktion läuft danach weiter: `452` weist nur diesen einen Empfänger
> zurück, `DATA`/`BDAT` schließt mit den bereits angenommenen Empfängern normal ab.
>
> **Kalibriert:** die beiden Durchsetzungsfälle in `smtp-protocol-robustness.adv.test.ts` wurden gegen
> den per `git stash` zurückgesetzten Vorzustand gefahren und schlugen dort mit der benannten
> Zusicherung fehl (`expected '250 2.1.5 Ok' to match /^452 4\.5\.3/`), danach zurückgenommen
> (`git diff` leer) und wieder grün nachgefahren.
>
> **Testfall:** drei neue Fälle in `smtp-protocol-robustness.adv.test.ts` (Empfänger bis zur
> konfigurierten Grenze angenommen, der nächste mit unterscheidbarem `452 4.5.3` abgewiesen und die
> Transaktion schließt trotzdem ab; jeder weitere Empfänger über der Grenze wird abgewiesen, nicht nur
> der erste; die unveränderte Default-Konfiguration nimmt mindestens die RFC-Untergrenze von 100
> Empfängern an) plus vier neue Fälle in `smtp-config.test.ts` (Default ≥ 100, ein Wert unter 100 wird
> abgelehnt, genau 100 wird angenommen, ein nicht-ganzzahliger Wert wird abgelehnt). Voller Lauf
> danach: `1034 passed | 8 skipped`, 88 Dateien.

### Was gemessen wurde

`handleRcpt()` prüft die Empfänger-ACL, ADR-030s Ketten-Zugehörigkeit (`452 4.5.3` bei einer
**anderen** Kette) und — bei authentifizierten Verbindungen — die Quellen-Übereinstimmung. Danach
folgt unbedingt:

```ts
this.recordMatchedRecipient(parsed.address, decision.sourceId, decision.chainScopeId);
// ...
this.rcptTo.push(parsed.address);
```

Für **jeden** syntaktisch gültigen `RCPT TO`, der zur bereits zugeordneten Kette gehört (auch
derselbe Empfänger beliebig oft — laut Backlog-Kommentar ausdrücklich zulässig: „doppelte Empfänger
bleiben zulässig"), wachsen `rcptTo` und `matchedRecipients` um ein Element. Es gibt **keine**
Konfiguration, keine Konstante und keine Prüfung, die die Anzahl der `RCPT TO`-Kommandos einer
Transaktion begrenzt — anders als bei realen MTAs (Postfix' `smtpd_recipient_limit`, Default 1000).

**Gemessen**, gegen den echten, kompilierten `EsmtpServer` über einen echten Loopback-Socket, mit
demselben Empfänger einer bereits zugeordneten Kette wiederholt (`RCPT TO:<victim@example.com>`,
gepipelinet in einem Schreibvorgang):

| Anzahl `RCPT TO` | Gesendete Bytes (Client) | Antwortzeit gesamt | `heapUsed`-Wachstum (Server) |
| ---------------- | ------------------------ | ------------------ | ---------------------------- |
| 1 000            | ~30 KB                   | 51 ms              | nicht einzeln gemessen       |
| 100 000          | ~3 MB                    | 845 ms             | nicht einzeln gemessen       |
| 1 000 000        | ~30 MB                   | 3 931 ms           | **395,4 MB**                 |

Jede einzelne Anfrage wird korrekt mit `250 2.1.5` beantwortet — kein Hänger, kein Absturz, keine
falsche Antwort. Der Server bleibt **funktional korrekt**, aber der Speicherverbrauch wächst
proportional zur Anzahl der Empfänger, ohne jede Obergrenze: 30 MB Eingabe erzeugen ~395 MB
Heap-Wachstum auf dem Server — ein Verstärkungsfaktor von gut **13×** bei dieser Messung, und ohne
Deckel wächst er mit jedem weiteren `RCPT TO` weiter.

### Warum das ein eigenständiger Befund ist, nicht nur F52/F53 in neuer Form

Anders als F52/F53/F54 (alle drei: eine Kommandozeile bzw. ein Puffer wird nicht gegen
`MAX_COMMAND_LINE_BYTES` geprüft) ist hier **jede einzelne** Kommandozeile für sich genommen kurz und
gültig — das Problem ist nicht die Zeilenlänge, sondern die **Anzahl** der Zeilen, die dieselbe
Transaktion anhäufen darf, bevor `DATA`/`BDAT` überhaupt beginnt. Der `go-smtp`-Vorlage aus dem
ADR-029-Nachtrag (`JR-4-21`) begegnet dieser Klasse von Fund nicht — `lineLimitReader` begrenzt
Byte-Länge, nicht Anzahl-der-Kommandos-einer-Sorte.

### Kalibrierung

Reproduzierbar mit einem eigenständigen Skript (`node`, kein `vitest`) gegen den echten,
kompilierten Server: eine erste, naive Fassung des Meßskripts erzeugte einen scheinbaren Hänger bei
schon 5 000 Wiederholungen — nachgesehen war das ein Fehler im **Testklienten** (eine
`String.slice()`-basierte Zeilenpufferung, die bei großen Antwortmengen selbst zum Engpass wurde),
nicht am Server. Mit einem korrigierten, zählbasierten Klienten (keine Zeichenketten-Pufferung)
liefen 1 000 000 Anfragen in unter 4 Sekunden durch — das ist die Zahl oben, und die Lehre selbst ist
Teil des Befunds: **die eigene Meßmethode zuerst gegen einen bekannten Fall geprüft**, bevor „hängt"
als Serververhalten statt als Werkzeugfehler gemeldet wird (Testrollen-Regel: ein Prüfwerkzeug, das
fail-open ist, ist derselbe Fehler eine Ebene höher).

### Was nicht angefasst wurde

Kein Produktionscode-Fix — Befund dokumentiert, gemeldet, Entscheidung liegt beim Auftraggeber.
Ein möglicher Fix: eine konfigurierbare Obergrenze für `rcptTo.length` je Transaktion, bei
Überschreitung `452 4.5.3` (derselbe Code, den ADR-030 für „zu viele Empfänger" schon benutzt, nur
aus einem anderen Grund) — nicht umgesetzt, nur als Richtung notiert.

## F56 — kein expliziter Cipher-Suite-Filter: der Server verhandelt `AES128-SHA` (keine Forward Secrecy) unter TLS 1.2

**Schwere:** mittel · **Kategorie:** Empfangspfad, TLS-Konfiguration · **Ort:**
`packages/journaling/src/ingress/tls-config.ts` (`ingressTlsConfigSchema`, kein `ciphers`-Feld),
`smtp-server.ts` (`buildTlsSocketOptions()`, setzte nur `minVersion`) · **Gefunden:** von TEST am
2026-08-04, im Rahmen von `JR-4-15`, Scope-Punkt „TLS-Parameter" · **Status:** **behoben in
`JR-4-21a`, Commit `819403f`** (Rolle DEV, 2026-08-04)

> **Behoben (`JR-4-21a`).** `TLS_CIPHERS` (`tls-config.ts`) ist eine feste, PFS-und-AEAD-only-Liste
> (nur `ECDHE`/`DHE`-Schlüsselaustausch, nur `GCM`/`ChaCha20-Poly1305`) — kein reiner RSA-Austausch,
> kein CBC/SHA-1 mehr aushandelbar. **Die erste Fassung setzte diese Liste an der falschen Stelle**:
> als `ciphers`/`honorCipherOrder` im Optionsobjekt, das `buildTlsSocketOptions()` an
> `new tls.TLSSocket(plainSocket, options)` übergibt — genau daneben, wo `minVersion` steht, also
> naheliegend, aber gemessen wirkungslos. Sobald ein `secureContext` bereits übergeben wird (was in
> diesem Prozess immer der Fall ist), ignoriert Node einen Cipher-Parameter auf Socket-Ebene
> vollständig; die Aushandlung folgt ausschließlich der Cipher-Liste, die beim Bau des
> `secureContext` selbst (`tls.createSecureContext()`) galt. Ein Client, der nur `AES128-SHA`
> anbietet, bekam diesen Cipher **trotz** gesetztem `ciphers`-Feld weiterhin ausgehandelt — an
> genau dieser Stelle hätte ein reiner Optionsobjekt-Test (ohne echten Socket) den Fehler nicht
> gefunden. Der Fix sitzt jetzt in `EsmtpServer`s Konstruktor:
> `tls.createSecureContext({ cert, key, ciphers: TLS_CIPHERS, honorCipherOrder: true })`.
> `buildTlsSocketOptions()` setzt weiterhin nur `minVersion`.
>
> **Kalibriert, in beiden Richtungen, gegen einen echten `net.Server` + `tls.TLSSocket`/echten
> TLS-Client:** ein Client mit `ciphers: 'AES128-SHA', minVersion/maxVersion: 'TLSv1.2'` gegen den
> unveränderten (Vorzustand-)Server verhandelte `AES128-SHA` erfolgreich — auch mit der (wirkungslosen)
> ersten Fixfassung. Erst mit `ciphers`/`honorCipherOrder` am `secureContext` selbst antwortet der
> Server „no shared cipher", derselbe Client scheitert mit einem fatalen Handshake-Alert. TLS 1.3
> bleibt unberührt (eigener Testfall, `getProtocol() === 'TLSv1.3'`), ein gewöhnlicher Client
> verhandelt weiterhin `ECDHE-RSA-AES128-GCM-SHA256` — Exchange Online und vergleichbare Absender
> bleiben also zugelassen. `smtp-starttls-protocol.test.ts` (`JR-4-04`, TLS 1.2 **und** 1.3
> Ende-zu-Ende) und `smtp-tls11-clienthello-rejection.test.ts` (`JR-4-14`) blieben grün.
>
> **Testfall:** neue Datei `packages/journaling/tests/unit/smtp-tls-cipher-filter.test.ts` (3 Fälle:
> `AES128-SHA` wird abgelehnt, ein gewöhnlicher Client verhandelt weiterhin Forward-Secrecy-AEAD, TLS
> 1.3 unberührt), plus zwei angepasste Fälle in `smtp-server.test.ts` (`buildTlsSocketOptions` setzt
> **weder** `ciphers` noch `honorCipherOrder`; `TLS_CIPHERS` selbst enthält keine CBC/SHA-1- oder
> reine-RSA-Suite). Voller Lauf danach: `1027 passed | 8 skipped`, 88 Dateien.

### Was gemessen wurde

`buildTlsSocketOptions()` übergibt an `new tls.TLSSocket(...)` ausschließlich `isServer`,
`secureContext` und `minVersion: 'TLSv1.2'` — kein `ciphers`-String, kein `honorCipherOrder`. Damit
gilt für die Cipher-Auswahl unter TLS 1.2 ausschließlich Node/OpenSSLs **Standard**-Liste, die vom
verhandelnden **Client** eingeschränkt werden kann, aber vom Server nicht vorab verengt wird.

Gemessen gegen einen echten `tls.TLSSocket({ isServer: true, secureContext, minVersion: 'TLSv1.2' })`
mit genau dieser Konfiguration: ein Client, der explizit nur `AES128-SHA`
(`TLS_RSA_WITH_AES_128_CBC_SHA` — reiner RSA-Schlüsselaustausch ohne Forward Secrecy, CBC-Betriebsart,
SHA-1-MAC) anbietet, bekommt genau diesen Cipher ausgehandelt:

```
[AES128-SHA] negotiated: TLSv1.2 AES128-SHA
[AES128-SHA] client negotiated: AES128-SHA
```

Zum Vergleich: ein gewöhnlicher, nicht eingeschränkter Client verhandelt von sich aus
`ECDHE-RSA-AES128-GCM-SHA256` (Forward Secrecy, AEAD) — das Standardverhalten ist also gut, nur nicht
**erzwungen**. `DES-CBC3-SHA` (3DES) ließ sich mit diesem Node-Client nicht gegenprüfen (OpenSSL 3.x
verweigert 3DES bereits beim Aufbau des Client-Kontexts) — das ist eine Einschränkung des
**Prüfwerkzeugs**, kein Beleg, dass der Server 3DES ablehnen würde; nicht weiter verifiziert.

### Warum das ein eigenständiger Befund ist

Ein Angreifer kann den Cipher einer TLS-1.2-Aushandlung nicht einseitig erzwingen (die
`Finished`-Nachricht bindet die Aushandlung kryptographisch ab) — das eigentliche Risiko ist ein
**legitimer, aber veralteter** Absender (ein alter Exchange-Server, eine schlecht konfigurierte
MTA), der von sich aus nur `AES128-SHA` anbietet und dessen Journal-Mail dann ohne Forward Secrecy
verschlüsselt wird: wird der private Schlüssel dieser Verbindung später kompromittiert (oder der
Serverschlüssel selbst), lässt sich mitgeschnittener historischer Datenverkehr rückwirkend
entschlüsseln — genau das, was Forward Secrecy verhindern soll. Für ein Compliance-Archivsystem, das
selbst hochsensible Inhalte transportiert, ist das ein begründetes Härtungsziel, auch ohne aktiven
Angreifer im Aushandlungspfad.

### Kalibrierung

Direkt am echten `tls.TLSSocket`-Konstrukt mit der exakten, im Quelltext verwendeten Optionsmenge
gemessen (nicht am Quelltext allein behauptet). Als Gegenprobe: derselbe Aufbau ohne
Client-seitige `ciphers`-Einschränkung verhandelt den erwarteten starken Cipher
(`ECDHE-RSA-AES128-GCM-SHA256`) — der Fund betrifft also nur den Fall eines Clients, der selbst eine
schwächere Auswahl anbietet, nicht das Serververhalten im Normalfall.

### Was nicht angefasst wurde

Kein Produktionscode-Fix — Befund dokumentiert, gemeldet, Entscheidung liegt beim Auftraggeber. Ein
möglicher Fix: `buildTlsSocketOptions()` einen expliziten `ciphers`-String mitgeben, der
Nicht-PFS-Suiten (reiner RSA-Schlüsselaustausch) und `3DES`/`RC4`/`NULL` ausschließt (z. B. Mozillas
„intermediate"-Profil als Ausgangspunkt) — nicht umgesetzt, nur als Richtung notiert.

## `JR-4-15` — Sicherheitsdurchsicht des Empfangspfads (ADR-029 Auflage 2): Ergebnis je Scope-Punkt

Rolle TEST, 2026-08-04. Akzeptanzkriterium wörtlich: „Jeder Punkt des Umfangs ist mit Befund oder
mit begründetem ‚unauffällig' beantwortet; Befunde landen hier; kein Punkt bleibt unbeantwortet
stehen." Sechs Punkte, in der Reihenfolge des Backlogs:

1. **TLS-Parameter** — **Befund F56** (kein Cipher-Suite-Filter, `AES128-SHA` ohne Forward Secrecy
   aushandelbar). Die Versionsgrenze selbst (`TLS_MIN_VERSION = 'TLSv1.2'`) ist bereits durch `JR-4-14`
   mit einem von Hand gebauten TLS-1.1-`ClientHello` bewiesen abgelehnt
   (`smtp-tls11-clienthello-rejection.test.ts`) — dieser Teilpunkt ist unauffällig.

2. **Ressourcengrenzen je Verbindung** — **Befund F55** (kein Limit für die Anzahl `RCPT TO` je
   Transaktion, Speicherverstärkung ~13× gemessen). Alle übrigen Grenzen sind vorhanden und durch
   `JR-4-14` bereits gehärtet geprüft: `MAX_COMMAND_LINE_BYTES` (F52/F53/F54, behoben in `JR-4-21`),
   `MAX_AUTH_ATTEMPTS_PER_CONNECTION = 3`, `PerSourceConnectionLimiter`,
   `PerSourceTransactionRateLimiter`, die drei Protokoll-Timeouts (`connectionTimeoutMs`/
   `commandTimeoutMs`/`dataTimeoutMs`), das `SIZE`-Limit. Unauffällig bis auf F55.

3. **Informationsgehalt der Antworttexte** — **unauffällig, begründet.** Jeder `writeResponse()`-/
   `writePlain()`-Aufruf in `smtp-server.ts` übergibt einen literalen, im Quelltext fest geschriebenen
   String — mechanisch bestätigt durch `smtp-5xx-inventory.test.ts`s erschöpfenden Scan aller
   `5xx`-Aufrufstellen (der nur literale Argumente erkennt und deshalb eine variable Zusammensetzung
   ohnehin melden würde). Keine Aufrufstelle interpoliert `err.message`, `cause`, einen Stacktrace,
   einen absoluten Pfad oder einen Konfigurationswert in eine an den Client gesendete Zeile. Ein
   unauthentifizierter Peer erfährt aus einer Antwort also nie mehr als den SMTP-Code und einen
   generischen, vorab festgelegten Text.

4. **Envelope-Werte auf dem Weg in Protokoll und Ledger** — **geprüft, unauffällig mit einer
   Einschränkung.** `remote_ip`/`ehlo_name` sind angreiferkontrolliert und fließen an zwei Stellen:
   gehasht in die Kette (`canonical-encoding.ts`) und als Klartext-Spalten in `journal_ledger`
   (`journal-ledger.ts`-Schema). Log-Injection im klassischen Sinn (eine eingeschleuste Newline, die
   eine gefälschte Logzeile erzeugt) ist strukturell ausgeschlossen, weil `apps/smtp-ingress` echtes
   `pino` benutzt — jeder Log-Aufruf erzeugt ein einzeiliges JSON-Objekt, in dem eine eingebettete
   Newline als `\n`-Escape innerhalb eines JSON-Strings landet, nicht als literarischer Zeilenumbruch.
   Ein NUL-Byte in `ehloName` — messbar über einen Angreifer-`EHLO`-Parameter erreichbar
   (`smtp-protocol-robustness.adv.test.ts`) — ist in einer Postgres-`text`-Spalte nicht darstellbar
   (`22021: invalid byte sequence for encoding "UTF8": 0x00`, gemessen gegen die echte Testdatenbank)
   und lässt `PostgresLedgerWriter.append()` fehlschlagen — gemessen End-zu-Ende über den echten Draht
   in `smtp-ingress-envelope-hostile-values.int.test.ts` (3 Fälle, alle grün): der Fehler wird von
   `JournalAcceptance.accept()`s generischem `try`/`catch` aufgefangen, ordnungsgemäß als
   `ledger-append-failed` klassifiziert und mit `451 4.3.0` beantwortet — kein Absturz, kein `5xx`,
   die Spool-Datei bleibt für die Crash-Recovery unangetastet liegen, und derselbe Chain-Append
   funktioniert danach normal weiter (Kette bleibt an Position 1, kein Loch). Die Einschränkung: nicht
   geprüft ist, ob ein ANSI-Escape-Zeichen (nicht NUL) in `ehlo_name` beim Betrachten der `pino`-JSON-
   Ausgabe in einem Terminal-Viewer (nicht in der strukturierten Datei selbst) etwas Störendes
   anzeigen könnte — das ist eine Eigenschaft des Log-**Betrachters**, nicht dieser Anwendung, und
   außerhalb dieser Scheibe nicht weiter verfolgt.

5. **Speicherverhalten bei 150 MB** — **geprüft, unauffällig, mit benannter Lücke.** Der `BDAT`-Pfad
   ist bereits mit einem Nightly-Test bei exakt 150 MB (`150 x 1 MiB`-Chunks) gemessen und bleibt
   deutlich unter dem beobachteten Rausch-Rahmen (`smtp-server-protocol.test.ts`, `arrayBuffers`-
   Metrik, F43-Lehre bereits berücksichtigt). Der `DATA`-Pfad ist **nicht separat** bei 150 MB
   gemessen — strukturell identisch gepuffert (`writeDurableSpoolFile()` streamt für beide Pfade), aber
   nicht empirisch bestätigt für `DATA` im Speziellen. Zusätzlich gilt **F50** (nicht neu, hier nur
   verknüpft): der Durchsatz hängt an der Zeilenzahl, nicht an der Bytezahl — 50 MB mit 60-Byte-Zeilen
   brauchen ~54 s, mit 998-Byte-Zeilen ~4 s; bei 150 MB mit kurzen Zeilen ist entsprechend mit
   deutlich über einer Minute Laufzeit zu rechnen, was selbst kein Speicherproblem ist, aber die
   Verbindung lange in Anspruch nimmt (Ressourcengrenzen-Punkt oben).

6. **Keine Ableitung von Dateipfaden aus Angreiferdaten** — **unauffällig, begründet.**
   `incomingFilePath()`/`quarantineFilePath()`/`shardOf()` (`spool/layout.ts`) sind ausschließlich
   Funktionen von `spool_txid` — serverseitig per `generateTxId()` erzeugt (`crypto.randomBytes` plus
   Zeitstempel, `spool/txid.ts`), nie aus `mailFrom`/`rcptTo`/`ehloName`/`remoteAddress` abgeleitet.
   Mechanisch bestätigt: kein `path.join`/`path.resolve` in `packages/journaling/src/spool/*.ts` oder
   `src/ingress/*.ts` referenziert einen dieser Bezeichner.

**Neue Testdatei:** `packages/backend/tests/integration/smtp-ingress-envelope-hostile-values.int.test.ts`
(3 Fälle, `ci`, echtes Postgres) — Punkt 4. Kein neuer Test für Punkt 1/2 (F55/F56) über die bereits
zitierten Messskripte hinaus — beide Funde sind gemessen und dokumentiert, aber (wie bei F52/F53/F54
vor `JR-4-21`) noch nicht als dauerhafte Regressionstests committet, weil beide Fixes vom Auftraggeber
noch nicht freigegeben sind und ein Regressionstest gegen eine noch nicht entschiedene Obergrenze
nichts Belastbares prüfen könnte.

---

## F57 — `pnpm test` war nicht in `dotenv --` gewickelt: die `integration`-Suite übersprang sich sichtbar, der Lauf sah unverdächtig aus

**Schwere:** mittel · **Kategorie:** Testharness · **Ort:** `package.json` (die sieben `test*`-Skripte) ·
**Gefunden:** 2026-08-02 vom PO in Parallelsession B (E5) · **Status:** **behoben in E5, Commit
`914c026`** (2026-08-02)

> **Aus E5 übernommen und umnummeriert.** Dieser Befund wurde in Parallelsession B als **F42**
> vergeben und in `06-status.md` dokumentiert statt hier — beides hat sich beim Rückmerge von E4 als
> Fehler erwiesen: E4 hatte F42 zur selben Zeit für einen anderen Befund vergeben, und eine
> Befundnummer außerhalb dieser Datei zu vergeben verletzt die Regel im Kopf dieses Dokuments.
> **ADR-032** hält beides fest. Die ausführliche Fassung mit den Messungen steht weiterhin im
> E5-Abschnitt von `06-status.md`.

`CLAUDE.md` §4 sagt, alle Root-Skripte seien in `dotenv -- …` gewickelt und läsen die `.env`. Für die
`test*`-Skripte stimmte das nicht. Ohne **exportiertes** `DATABASE_URL` übersprang die gesamte
`integration`-Suite — sichtbar in der Ausgabe, aber ohne Fehlschlag: **`integration: ci 0/97`, Exit 0.**
Das ist dieselbe Klasse wie F48 und F14/F15: ein Lauf, der grün meldet, weil nichts geprüft wurde.

**Behoben** durch Wickeln aller sieben `test*`-Skripte. Vorher an der installierten Version gemessen
statt aus der Dokumentation geschlossen: `dotenv-cli` verträgt eine **fehlende** `.env` (Exit 0), und
bereits gesetzte Umgebungsvariablen behalten **Vorrang** vor der Datei — die CI setzt `DATABASE_URL`
im Workflow und bleibt daher unberührt. **Beleg der Wirkung:** `pnpm test` ohne exportiertes
`DATABASE_URL` liefert seitdem `integration: ci 97/97` statt `0/97`.

---

## F58 — Whitespace in einer konfigurierten Domain landete unverändert in der Eigentümeradresse

**Schwere:** mittel · **Kategorie:** Neuer Code · **Ort:** `packages/journaling/src/parser/owner-resolution.ts`
(Treffer- und Fallback-Ausgabepfad) · **Gefunden:** 2026-08-02 in der Abnahme `JR-5-09` ·
**Status:** **behoben in E5, Commit `d579c35`** (2026-08-02)

> **Aus E5 übernommen und umnummeriert** — vergeben war **F43**, dieselbe Nummer, die E4 parallel für
> den Heap-Nachweis benutzte. Siehe **ADR-032**; die ausführliche Fassung steht im E5-Abschnitt von
> `06-status.md`.

Der Vergleich lief über `normalizedConfiguredDomain()` (trimmt), die **Ausgabe** benutzte die rohe
Zeichenkette. Ein versehentliches Leerzeichen in `organizationDomains` passte damit weiterhin — und
wanderte in die erzeugte Adresse:

```
'company.com '   -> "alice@company.com "            Whitespace am Ende
' company.com'   -> "alice@ company.com"            Whitespace MITTEN in der Adresse
'company.com\t'  -> "alice@company.com\t"
```

Eine solche Adresse ist nie zustellbar und vergleicht sich mit nichts — und sie wäre nach E6 in
`archived_emails.userEmail` gelandet. **Behoben** an beiden Ausgabestellen mit acht Regressionstests.

**Bewusst nicht mitbehoben:** Die Groß-/Kleinschreibung bleibt erhalten (entworfen, nicht versehentlich;
ein Test hält `' Company.COM '` ⇒ `alice@Company.COM` fest). Und ein `main`, das gar keine Domain ist
(`'admin@company.com'` ⇒ `default_fallback@admin@company.com`), wird **nicht** repariert: zu raten,
welche Hälfte der Betreiber meinte, hieße aus einer kaputten Eingabe einen Wert zu erfinden. Ein Test
hält diese Grenze fest. Sie gehört in die Konfigurationsprüfung im Backend.

## F59 — `shutting down` kann verlorengehen: `console.log` und direkt danach `process.exit(0)` auf einem Pipe-stdout

**Schwere:** niedrig (Diagnostik, kein Datenverlust) · **Kategorie:** Neuer Code ·
**Ort:** `apps/smtp-ingress/src/index.ts` `shutdown()` (Zeilen 332 und 349–352) ·
**Gefunden:** 2026-08-05 in `JR-6-01`, durch einen roten CI-Lauf (`30999645177`) an einem Test, den
diese Scheibe nicht angefasst hat · **Status:** **behoben, aber er war nie die Ursache der roten
CI-Läufe.** Die Ursache ist **F61** (ein zurückgesetzter Socket riss den Prozess ab, bevor er seinen
`SIGTERM`-Handler erreichte). F59 selbst ist ein **echter, aber latenter** Defekt: `process.exit()` leert
keinen Pipe-stdout, und der Fix dafür (`writeLineThenFlush()`) bleibt richtig und ist behalten. **Was an
F59 falsch war, ist die Zuschreibung** — zweimal wurde ein Fehlschlag mit ihm erklärt, den er nicht
verursacht hat. Siehe „Erster Fix — was er war und was er nicht war"

Der Shutdown-Pfad schreibt seine einzige Bestätigungszeile mit `console.log` und ruft danach in
beiden Zweigen von `server.close()` `process.exit(0)`:

```ts
console.log(`smtp-ingress: received ${signal}, shutting down`); // Zeile 332
// …
server.close().then(
	() => closeConnections().finally(() => process.exit(0)),
	() => closeConnections().finally(() => process.exit(0))
);
```

**`process.exit()` leert keine noch anstehenden asynchronen `stdout`-Schreibvorgänge.** Wenn `stdout`
ein **Pipe** ist — genau der Fall, sobald ein Elternprozess die Ausgabe mitliest, also in jedem Test
und unter jedem Prozess-Supervisor —, sind Schreibvorgänge auf Linux asynchron. Zwischen Zeile 332 und
dem `exit` liegt normalerweise genug Zeit; unter CPU-Konkurrenz nicht zwangsläufig.

**Wie es aufgefallen ist, und warum das die interessantere Hälfte ist.** `JR-6-01` hat 33 Tests
hinzugefügt, davon fünf, die Prozesse starten und wieder abräumen. Auf dem CI-Runner ist damit
`packages/journaling/tests/unit/ingress-process-boot.test.ts` rot geworden —
`expected '[dotenv@17.2.0] injecting env (0) fro…' to contain 'shutting down'` —, ein Test aus
`JR-4-01`, den diese Scheibe nicht berührt. Der Prozess **war** beendet (`waitUntil(() => exited)`
lief durch), nur seine letzte Zeile fehlte. Der Befund ist damit **nicht** durch neue Last entstanden,
sondern von ihr **sichtbar gemacht**: die Zusage „ein SIGTERM erzeugt eine Shutdown-Meldung" war schon
vorher nur wahrscheinlich, nicht sicher.

**Zwei Wege, und sie sind nicht gleichwertig:**

1. **Im Produktionscode.** Auf das `exit` verzichten, wenn der Ereignis-Loop von allein leerläuft, oder
   vor dem `exit` auf das `drain` von `process.stdout` warten. Das behebt die Ursache — eine
   Betriebsmeldung, die ein Supervisor-Log erreichen soll, darf nicht davon abhängen, wie schnell die
   Maschine gerade ist.
2. **Im Test.** Auf die Zeile nicht mehr prüfen. Das macht den Lauf grün und die Zusage unprüfbar; die
   Meldung bleibt verlierbar. **Nicht empfohlen.**

**Nicht mitentschieden:** derselbe Prozess loggt über `pino` **und** `console.log` auf denselben
Dateideskriptor (in **F49** ausdrücklich offen gelassen). Der Fix für (1) sollte diese Stelle nicht
stillschweigend mitumbauen — das ist eine eigene Entscheidung.

### Erster Fix — was er war und was er nicht war

**Der unten beschriebene Fix ist richtig und bleibt — er hat nur den beobachteten Fehlschlag nicht
behoben, weil dieser eine andere Ursache hatte.** CI `31005188529` ist danach mit **genau derselben**
Meldung rot geworden (`expected … to contain 'shutting down'`). Die Ursache steht als **F61** weiter
unten: der Prozess stürzte mit einem unbehandelten `ECONNRESET` ab und erreichte seinen `SIGTERM`-Handler
**nie**, also konnte keine Flush-Verbesserung etwas ändern.

**Wie es zu der falschen Entwarnung kam, und das ist der eigentliche Lehrsatz.** Nach dem Fix liefen
vier Versuche derselben Revision grün (CI `31003830220`), und daraus wurde geschlossen, der Fix wirke —
mit derselben Rate-Argumentation, die `JR-4-21` für **F54** verlangt hatte. Der Schluss war falsch, und
zwar auf eine Weise, die es wert ist, hier zu stehen: **eine Vorher/Nachher-Rate belegt einen Fix nur
dann, wenn die Stichprobe groß genug für die Grundrate ist.** Bei „2 von 3 rot" liegt die Ausfallrate
grob bei 50–65 %; vier grüne Läufe in Folge sind darunter zwar unwahrscheinlich (≈ 2–6 %), aber **die
vier Läufe waren Wiederholungen ein und derselben Revision auf demselben Runner-Typ** und damit keine
unabhängigen Ziehungen im Sinne der Annahme. Vier Läufe sind schlicht zu wenig; F54 verlangte
ausdrücklich **mindestens zehn**, und diese Zahl wurde hier nicht eingehalten.

**Was jetzt zuerst passiert, statt eines zweiten Rateversuchs:** die Fehlermeldung des Tests trug
**nur `stdout`**. Damit war aus dem Log nicht unterscheidbar, ob (a) der Handler lief und seine Zeile
verlor, oder (b) der Prozess aus einem anderen Grund starb, ohne den Handler zu erreichen. Genau diese
Unterscheidung entscheidet, welcher Fix richtig ist. `ingress-process-boot.test.ts` meldet deshalb ab
jetzt **Exit-Code, terminierendes Signal und `stderr`** mit — eine Diagnose, keine
Verhaltensänderung. Erst mit diesen drei Werten wird der zweite Fix bestimmt.

**Die Diagnose hat (b) ergeben, nicht (a)** — Exit-Code 1, kein Signal,
`node:events:497 throw er; // Unhandled 'error' event`, `Error: read ECONNRESET`. Der Handler lief nie.
Der bereitgehaltene Kandidat (synchrones `fs.writeSync` auf Deskriptor 1) wurde deshalb **nicht**
ausgeliefert: er hätte nichts geändert, und ihn trotzdem einzubauen wäre der dritte Rateversuch gewesen.
**F59 bleibt damit als latenter Defekt behoben, ohne dass ihm je ein beobachteter Fehlschlag zugeordnet
werden kann.** Ob `process.exit()` hier je eine Zeile verloren hat, ist unbewiesen — der Fix ist trotzdem
richtig, weil die Zusage („eine Betriebsmeldung erreicht das Log") sonst von der Maschinengeschwindigkeit
abhängt.

### Behebung, erster Versuch (2026-08-05, Variante 1 — Entscheidung des Auftraggebers)

Auslöser war der **zweite** Treffer: zwei von drei Pushes des E6-Zweigs endeten rot, jedes Mal an
demselben Test, jedes Mal an derselben Ursache. Damit war der Befund kein Randfall mehr, sondern hat die
CI als Beleg entwertet — genau das, was **F48** dieses Projekt schon einmal gekostet hat. Ein roter Lauf,
der immer dieselbe bekannte Ursache hat, ist schlimmer als ein flackernder Test.

**Was geändert wurde.** `writeLineThenFlush()` in
`packages/journaling/src/ingress/graceful-exit.ts`: schreibt eine Zeile und löst erst auf, wenn der Stream
den Schreibvorgang quittiert hat. `apps/smtp-ingress`s `shutdown()` **wartet** darauf, und zwar **nach**
dem Drain — vorher zu warten würde das Schließen der Verbindungen einer Logzeile unterordnen, nachher
kostet es im Normalfall nichts und greift nur in dem Fall, der kaputt war: ein Drain, der schneller fertig
ist als die Pipe.

**Drei Eigenschaften, die zur Entscheidung gehören:**

- **Die Wartezeit ist begrenzt** (2 s) und das Promise **lehnt nie ab**. Ein unbegrenztes Warten würde
  eine verlorene Logzeile gegen einen **hängenden Shutdown** tauschen, und das ist der schlechtere
  Tausch: ein Supervisor `SIGKILL`t einen Prozess, der nicht aufhört, und ein `SIGKILL` während Phase B
  ist genau das, was Spool und Reconciler danach aufräumen müssen. Ein `stdout`, dessen Leser weg ist
  (`EPIPE`), ist ein realer Zustand.
- **Der Helfer liegt in `packages/journaling`, nicht in `apps/smtp-ingress`** — aus einem
  Harness-Grund, der es wert ist, gemerkt zu werden: **kein Projekt-Glob erfasst `apps/`**, eine
  Testdatei dort würde von niemandem gesammelt und der Unclassified-Check würde den Lauf zu Recht rot
  melden. Prüfbares Verhalten gehört dorthin, wo Tests hinreichen, statt einen Glob für einen Helfer zu
  verbreitern.
- **F49 bleibt unberührt.** Der Helfer nimmt den Stream als Parameter und hat keine Meinung darüber, dass
  `pino` und `console.log` auf denselben Deskriptor schreiben.

**Wie der Fix belegt ist — und wie ausdrücklich nicht.** Der Regressionstest prüft **nicht** noch einmal,
dass ein gestarteter Ingress „shutting down" ausgibt: das ist die Zusicherung, die geflackert hat (einer
von drei CI-Läufen), und sie ein weiteres Mal zu behaupten würde die Laune des Runners messen. Geprüft
wird der **Mechanismus**, gegen einen Stream, dessen Callback der Test selbst auslöst: das Promise löst
nicht auf, bevor der Stream quittiert hat, und es löst trotzdem auf, wenn der Stream nie quittiert. Eine
der neun Fälle ist eine **Gegenprobe**, die die unbehobene Form nachbaut (schreiben, dann ohne Warten
„beenden") und zeigt, dass der Schreibvorgang in dem Moment noch unterwegs war, in dem der Prozess
gestorben wäre.

**Auf diesem Windows-Host ist die Wirkung nicht messbar** — die Zusicherung in
`ingress-process-boot.test.ts` steht hinter `process.platform !== 'win32'`, weil Windows kein
catchbares `SIGTERM` an ein Kind liefert. Der Beleg für die Wirkung ist deshalb dieselbe Form, die
`JR-4-21` für **F54** verlangt hat: eine **Rate vorher gegen nachher**, nicht ein einzelner grüner Lauf.
Vorher: **2 von 3 Läufen rot** (`30999645177`, `31002635354`; grün war nur der Wiederholungslauf von
`30999645177`). Nach dem ersten Fix: vier Versuche grün (`31003830220`) — **und danach wieder rot**
(`31005188529`). Die vier grünen Läufe haben den Fix **nicht** belegt; siehe „Erster Fix —
unzureichend" oben. Der Mechanismus-Test (`graceful-exit.test.ts`) bleibt gültig und deterministisch: er
prüft, dass `writeLineThenFlush()` tut, was es zusagt. Was er nicht prüfen kann, ist, ob **dieses**
Versprechen die Ursache des Befunds trifft.

## F60 — `StorageService.put()` puffert einen Stream sofort zu einem Buffer, obwohl die Signatur Streams verspricht

**Schwere:** mittel · **Kategorie:** Bestandscode ·
**Ort:** `packages/backend/src/services/StorageService.ts` `put()` (Zeilen 68–72),
Signatur in `packages/types/src/storage.types.ts` `IStorageProvider.put()` ·
**Gefunden:** 2026-08-05 bei der Entscheidung zu **ADR-010** (`JR-6-02a`) ·
**Status:** **behoben in E7**, Commit `d6d80eb`. `put()` unterscheidet jetzt `Buffer` (kurzer,
bereits gepufferter Pfad, unverändert) von einem Stream: letzterer läuft durch einen neuen
`putStream()`, der Präfix+IV direkt in einen `PassThrough` schreibt und `content -> cipher ->
PassThrough` per `stream/promises`' `pipeline()` **gleichzeitig** mit `this.provider.put()`
laufen lässt (keiner der beiden wird vorher vollständig abgewartet) — das Byte-Format
(`ENCRYPTION_PREFIX` + 16-Byte-IV + Ciphertext) bleibt unverändert, verifiziert durch direktes
Entschlüsseln der Rohbytes beider Pfade. Kalibrierter Nachweis (F43-Muster): ein Fake-`IStorageProvider`
zählt, wie viele Chunks ankommen, bevor die Quelle endet — gegen den Vorzustand (Commit vor `d6d80eb`
zurückgesetzt) schlägt genau diese Assertion mit `expected 0 to be greater than or equal to 2` fehl,
weil der alte Code `provider.put()` erst nach `streamToBuffer()`s `'end'` überhaupt aufruft. Erster
Testfall überhaupt für diese Klasse: `packages/backend/src/services/StorageService.test.ts` (6 Tests).
Geprüfte Aufrufer: `upload.controller.ts`s Busboy-Filestream ist der einzige produktive
Stream-Aufrufer und hängt seinen eigenen `'error'`-Listener bereits vor dem `put()`-Aufruf an — das
verträgt sich mit `pipeline()`s eigenen Listenern, kein Aufrufer liest den Content-Stream doppelt.

Die Schnittstelle verspricht Streaming:

```ts
put(path: string, content: Buffer | NodeJS.ReadableStream): Promise<void>;
```

Die Implementierung löst es sofort auf:

```ts
async put(path: string, content: Buffer | NodeJS.ReadableStream): Promise<void> {
	const buffer = Buffer.isBuffer(content) ? content : await streamToBuffer(content);
	// … verschlüsselt und schreibt den ganzen Buffer
}
```

Der Grund ist nachvollziehbar und kein Versehen: die transparente Verschlüsselung (AES-256-CBC, Magic
`oa_enc_idf_v1::` + IV) läuft über einen ganzen Buffer. **Der Effekt ist aber, dass es im ganzen
Repository keinen streamenden Schreibpfad gibt** — ein Aufrufer, der sorgfältig streamt, um Heap zu
sparen, verliert diese Eigenschaft an der Storage-Grenze, ohne dass irgendetwas es ihm sagt.

**Warum das hier auffiel, und warum es dort nicht hingehört, wo es aufgefallen ist.** ADR-010 hatte als
ernstesten Einwand gegen die Wiederverwendung von `processEmail()`, dass es mit `readFile()` die ganze
Nachricht in den Heap liest — während E3 (`JR-3-02`) ausdrücklich streamt, um genau das zu vermeiden,
und diese Zusage abgenommen ist. Die Messung hat den Einwand **aufgelöst statt bestätigt**: ein eigener
Pfad hätte an `storage.put()` genauso gepuffert. Damit war die Vollpufferung kein
Unterscheidungsmerkmal mehr zwischen den ADR-Optionen — aber sie ist nicht verschwunden, sondern nur an
ihren tatsächlichen Ort gewandert.

**Was es für Phase B konkret bedeutet:** bei `SMTP_SIZE_LIMIT_BYTES` von 50 MB und der Concurrency 3
des `journal-inbound`-Workers liegen im schlechtesten Fall drei Nachrichten **doppelt** im Heap (roher
Buffer plus verschlüsseltes Ergebnis). Das ist beherrschbar und wird hier bewusst hingenommen; es ist
kein Grund, `JR-6-02` anders zu bauen.

**Nicht mitentschieden, gehört aber zusammen:** ob die Verschlüsselung auf einen Stream-Cipher
umgestellt wird (`createCipheriv` kann streamen — die Magic-und-IV-Präambel ließe sich vorschalten) oder
ob die Signatur ehrlich auf `Buffer` verengt wird. **Die zweite Variante ist die kleinere Änderung und
die schlechtere:** sie macht die Grenze sichtbar, hebt sie aber nicht auf, und E7 will für Object Lock
ohnehin an denselben Code. Wichtig ist nur, dass die Signatur und das Verhalten aufhören, sich zu
widersprechen — **eine Schnittstelle, die Streaming verspricht und puffert, lädt jeden künftigen
Aufrufer dazu ein, eine Speicherzusage zu geben, die sie nicht hält.**

## F61 — ein zurückgesetzter Socket reißt den ganzen SMTP-Empfänger ab: die Ablehnungspfade hängen keinen `error`-Handler an

**Schwere:** **hoch** (fernauslösbarer Absturz des Empfängers, trivialer Denial of Service) ·
**Kategorie:** Neuer Code ·
**Ort:** `packages/journaling/src/ingress/smtp-server.ts` `EsmtpServer.handleConnection()` — die drei
Ablehnungspfade (`denied`, `unavailable`, Verbindungsgrenze) ·
**Gefunden:** 2026-08-05 in E6, als Nebenprodukt der Diagnose zu **F59** ·
**Status:** **behoben am 2026-08-05**, mit kalibriertem Regressionstest
(`tests/unit/smtp-connection-reset-crash.test.ts`, 5 Fälle)

> **Der Beleg ist diesmal der Test, nicht die Lauf-Rate — und das ist der Unterschied zu F59.** Der
> Regressionstest ist **deterministisch und kalibriert**: mit zurückgenommenem Fix meldet der Lauf
> `Unhandled Errors: Error: read ECONNRESET`, auf **jeder** Plattform. Die CI-Rate bestätigt nur:
> **4 von 4 Läufen grün** nach dem Fix (CI `31008541750`, ein Push plus drei Wiederholungen), vorher
> 3 von 9 rot. Vier Läufe wären für sich genommen **kein** Beleg — genau dieser Fehlschluss ist bei F59
> passiert. Sie sind hier nur die Gegenprobe zu einer Aussage, die schon anders bewiesen ist.

`handleConnection()` beantwortet drei Fälle mit `socket.end(text)` und kehrt **zurück, ohne je eine
`SmtpConnection` zu bauen** — und der einzige `'error'`-Listener des ganzen Verbindungspfads lag in
deren Konstruktor (`attachSocketHandlers`). Ein `net.Socket` **ohne** `'error'`-Listener verschluckt den
Fehler nicht: `EventEmitter` **wirft** ihn, und eine unbehandelte Ausnahme im Accept-Pfad beendet den
Prozess.

Gemessen, nicht geschlossen — so sah es aus:

```
exit code 1, terminating signal null
node:events:497
      throw er; // Unhandled 'error' event
Error: read ECONNRESET
    at TCP.onStreamRead (node:internal/stream_base_commons:216:20)
```

**Warum das schwer wiegt.** Der `denied`-Pfad ist der Pfad **jeder** IP, die nicht auf der ACL steht.
Wer den Port erreichen kann und nicht zugelassen ist, kann den Empfänger mit einer
Connect-dann-Reset-Schleife anhalten. Ein abgestürzter Empfänger nimmt keine Post an — Absender
warten und wiederholen, es ist also Verfügbarkeit und kein Datenverlust, aber es ist der billigste
denkbare Denial of Service gegen einen Compliance-Empfänger. Und es braucht keine Absicht: ein
Load-Balancer-Healthcheck, ein Portscanner oder ein MTA, der aufgibt, erzeugt dasselbe RST.

**Behebung:** ein `'error'`-Listener **als Erstes** in `handleConnection()`, vor jedem Zweig, der
zurückkehren kann. Er loggt nur, solange keine `SmtpConnection` den Socket besitzt — danach loggt diese
selbst, und eine zweite Zeile wäre nur eine Dopplung.

### Wie er gefunden wurde, und warum das die lehrreichere Hälfte ist

**F61 ist die tatsächliche Ursache der roten CI-Läufe, die zweimal F59 zugeschrieben wurden.** Der
Ablauf ist es wert, festgehalten zu werden:

1. `ingress-process-boot.test.ts` wurde rot mit `expected … to contain 'shutting down'`. Das sah aus wie
   eine verlorene Logzeile.
2. Daraus wurde **F59**, mit einer plausiblen und sogar zutreffenden Ursachenbeschreibung
   (`process.exit()` leert keinen Pipe-stdout) — nur war sie **nicht die Ursache dieses Fehlschlags**.
3. Der Fix für F59 wurde gebaut, ausgeliefert, und vier grüne Läufe wurden als Beleg gemeldet. Beides
   war falsch: der Beleg (zu wenige, abhängige Läufe) und die Diagnose.
4. Erst als die Zusicherung **Exit-Code, Signal und `stderr`** mitmeldete, war die Antwort eindeutig —
   und eine andere: Exit-Code 1, kein Signal, `Unhandled 'error' event`. Der Prozess hat seinen
   `SIGTERM`-Handler **nie erreicht**; die fehlende Zeile war ein **Symptom**.

**Der Lehrsatz ist der Diagnosewert einer Zusicherung, nicht der Bug.** Der Test hatte drei
Beobachtungen zur Hand — Ausgabe, Exit-Code, Signal — und meldete eine. Das hat zwei Runden Fixarbeit
in die falsche Richtung geschickt. Eine Zusicherung, die nur einen Teil des Beobachtbaren berichtet, ist
kein halber Beleg, sondern ein **Hinweisgeber auf die falsche Ursache**.

**Und ein zweiter, angenehmerer Befund:** die Ursache ist **plattformunabhängig** reproduzierbar. Das
Symptom war Linux-only (auf Windows steht die Zusicherung hinter `platform !== 'win32'`), der Absturz
nicht — mit zurückgenommenem Fix meldet der Lauf **auf diesem Windows-Host**
`Unhandled Errors: Error: read ECONNRESET`. `socket.resetAndDestroy()` erzeugt ein echtes RST, deshalb
schlägt der nächste Lesevorgang der Gegenseite **jedes Mal** fehl statt manchmal: aus einem Wettlauf ist
ein deterministischer Test geworden.

## F62 — `IJournalInboundJob` ist totes, aus der Zeit vor `JR-6-01` stammendes Gerüst und wird in der Architektur-Doku noch als künftiger Payload beworben

**Gefunden:** `JR-6-02b` (2026-08-05), beim Verdrahten des Phase-B-Prozessors gegen die tatsächliche
`JournalInboundJobData`-Payload.

**Der Fund.** `packages/types/src/journaling.types.ts` definiert `IJournalInboundJob`
(`journalingSourceId`, `tempFilePath`, `remoteAddress`, `receivedAt`) — eine Payload-Form, die
**vollständig durch den Ledger nachschlagbar** wäre, statt kopiert zu werden. Eine Suche über das
gesamte Repository (`grep -rl IJournalInboundJob`) findet **keinen einzigen Aufrufer, keinen
Konstruktor, keine Verwendung** außerhalb der eigenen Definition. `docs/dev/journaling/02-architektur.md`
§3 beschrieb bis zu diesem Fund sogar ausdrücklich, dieser Typ bleibe „als Payload nutzbar" und sein
`tempFilePath`-Feld werde „künftig" auf den Spool-Pfad zeigen — eine Beschreibung, die der tatsächlich
getroffenen und umgesetzten `JR-6-01`-Entscheidung direkt widerspricht.

**Warum das mehr als Aufräumen ist.** `JR-6-01` hat, mit ausführlicher, gemessener Begründung
(`06-status.md`), genau **gegen** diese Form entschieden: eine Payload mit `journalingSourceId` und
`tempFilePath` kopiert Werte, die der Ledger schon hält, und eine solche Kopie kann **unentdeckbar**
von ihrer Ledger-Zeile abweichen (dieselbe Klasse Fehler wie F46). Die tatsächliche Payload
(`JournalInboundJobData`, `packages/journaling/src/phase-b/queue-contract.ts`) trägt genau ein Feld,
`spoolTxId`. Dass der ältere Typ weiterhin exportiert und in der Architektur-Doku als Zielzustand
beschrieben stand, ist ein Fund derselben Art, die dieses Register schon mehrfach verzeichnet hat: eine
Doku-Aussage, die stillschweigend hinter der tatsächlich getroffenen Entscheidung zurückblieb, statt
sie zu korrigieren, sobald sie getroffen war.

**Behoben, teilweise:** `02-architektur.md` §3 trägt jetzt eine Korrektur mit Verweis auf diesen Befund
und auf `JR-6-01`s tatsächliche Entscheidung. **Nicht behoben:** `IJournalInboundJob` selbst ist noch
nicht aus `packages/types` entfernt — das ist eine eigenständige Aufräumarbeit mit eigenem Review
(ein exportierter Typ ohne Aufrufer könnte von einem externen Konsumenten des Pakets importiert sein,
auch wenn nichts im Repository selbst ihn nutzt), und liegt außerhalb des Umfangs von `JR-6-02b`.

**Schwere:** niedrig — der Typ wird nirgends konstruiert, richtet also keinen Schaden an. Der Wert des
Fundes liegt in der korrigierten Doku-Aussage, nicht in einer Verhaltensänderung.

## F63 — der `journal-inbound`-Worker bekam mit `JR-6-02b` seine ersten echten, dauerhaften Postgres-Verbindungen, und die CI-Umgebung war darauf nicht vorbereitet

**Gefunden:** `JR-6-02b` (2026-08-05), fünf rote CI-Läufe in Folge nach dem ersten grünen lokalen
Volllauf, bevor der sechste grün wurde (`31054880932`).

**Der Fund, in zwei Teilen — jeder für sich unauffällig, zusammen vier CI-Iterationen teuer.**
`JR-6-01`s Prozessor war ein reiner Platzhalter (kein DB-Zugriff, kein Storage-Zugriff); `JR-6-02b`
verdrahtet ihn gegen `IngestionService`/`StorageService`/`PostgresLedgerLookup`, und zwei
Eigenschaften dieser Verdrahtung, die lokal (mit vollständig gesetzten Umgebungsvariablen und einer
migrierten Datenbank) unsichtbar bleiben, waren in der CI-Umgebung sofort sichtbar. **Ein dritter,
zunächst hier mitgeführter Punkt (ein hängender Shutdown) ist kein CI-Umgebungsproblem und steht
jetzt richtig gerahmt als eigener Befund: F64.**

1. **`config/storage.ts` wirft beim Import, nicht bei der ersten Benutzung.** Ein bloßes
   `import { StorageService } from '...'` am Kopf einer Datei reicht, um `Invalid STORAGE_TYPE:
undefined` auszulösen, wenn `STORAGE_TYPE` nicht gesetzt ist — unabhängig davon, ob und wann
   `new StorageService()` tatsächlich aufgerufen wird. Die CI hatte `STORAGE_TYPE`/
   `STORAGE_LOCAL_ROOT_PATH`/`ENCRYPTION_KEY` nie gesetzt, weil `.github/workflows/ci.yml`s eigener
   Kommentar bis dahin zutraf: „the integration suite never touches `config/storage.ts`". Der erste
   rote Lauf riss dabei **23 von 106 Testdateien** mit, nicht nur die eine, die den Worker spawnt —
   ein einzelner Import-Fehlschlag in einem Kindprozess genügte, um den ganzen Vitest-Lauf als
   Fehlschlag zu melden.
2. **`process.env.DATABASE_URL` in der CI ist absichtlich die unmigrierte Wartungsdatenbank.**
   `acquireTestDatabase()` erzeugt daraus je Testdatei eine eigene, migrierte Datenbank — aber ein
   Test, der einen **Kindprozess spawnt** statt die Harness direkt zu benutzen, muss die
   Verbindungszeichenkette dieser isolierten Datenbank **explizit** an den Kindprozess weiterreichen.
   `journal-inbound-worker.int.test.ts` tat das nie, weil der Platzhalter-Prozessor nie eine
   Datenbankabfrage brauchte. Der Fehlschlag war `relation "journal_ledger" does not exist`.

**Warum das kein Einzelfall bleiben muss.** Jeder künftige Worker-Prozess, der zum ersten Mal echten
DB-/Storage-Zugriff bekommt (etwa `JR-6-04`s Reconciler), trifft auf dieselben zwei Fallen, wenn er
gegen die CI läuft, ohne dass jemand sie vorher kennt: die CI setzt nur, was der jeweils letzte
Prozess brauchte, nicht was ein neuer Prozess braucht. Wer den nächsten Worker gegen echte Services
verdrahtet, sollte **vorher** `corepack pnpm --filter @open-archiver/backend test:types` **beider**
betroffenen Pakete laufen lassen (nicht nur eines, siehe auch die separate Lehre in `JR-6-02b`s
Statuseintrag) und den CI-Job-`env:`-Block auf fehlende Variablen prüfen, statt es dem ersten
CI-Lauf zu überlassen, es zu melden. Der Reconciler wird außerdem in den Bestand treffen, den F64
beschreibt, wenn er als eigener Prozess läuft.

**Schwere:** mittel — kein Datenverlust, keine Sicherheitsfrage, aber vier CI-Iterationen für eine
einzige Scheibe sind genau die Art Kosten, die eine Lehre rechtfertigt, nicht nur einen Fix.

## F64 — der `journal-inbound`-Worker beendet sich nach `worker.close()` nicht selbst; ein offenes Handle irgendwo im `IngestionService`/`StorageService`/DB-Singleton-Graphen hält den Prozess am Leben

**Gefunden:** `JR-6-02b` (2026-08-05), beim CI-Lauf, der zum ersten Mal die SIGTERM-Zusicherung von
`JR-6-01` tatsächlich erreichte (die vorherigen roten Läufe — F63 — endeten vorher).

**Was gemessen ist, nicht vermutet:** nach einem `worker.close()`, der laut BullMQ erfolgreich
aufgelöst hat (kein Job mehr aktiv), blieb der Prozess **mindestens 20 Sekunden** am Leben, statt sich
von selbst zu beenden. Schließen der einen bekannten neuen Verbindung dieser Scheibe (`ledgerSql`,
der bare Postgres-Client aus `journal-ledger-query-adapter.ts`) behob es **nicht** — der Prozess
hing weiterhin.

**Was nicht gemessen ist:** welches Handle genau. Der Verdachtsraum ist eingegrenzt (`IngestionService`,
`StorageService`, oder der `packages/backend/src/database`-Singleton, alle drei zum ersten Mal in
diesem Prozess importiert), aber nicht weiter isoliert — auf ausdrückliche Anweisung nicht, siehe
unten.

**Das ist kein Befund über die CI-Umgebung, im Unterschied zu F63.** Ein Worker, der sich nach
abgeschlossenem Drain nicht selbst beenden kann, verhält sich in Produktion identisch: dort holt ihn
ein Supervisor mit `SIGKILL`, und genau das soll ein graceful Shutdown verhindern. Der
20-Sekunden-Fehlschlag im Test war der **Melder**, nicht der Defekt — er wäre in jeder Umgebung
aufgetreten, die tatsächlich bis zum Ende der Wartezeit misst.

**Behoben, ohne die Ursache zu identifizieren:** `journal-inbound.worker.ts`s `shutdown()` ruft nach
`worker.close()` einen bestmöglichen `ledgerSql.end()` und danach **`process.exit(0)`** explizit auf.
Das ist ein bewusster Kompromiss, keine Reparatur: ein erzwungener Exit nach einem bestätigt
abgeschlossenen Drain ist derselbe Tausch, den diese Datei an anderer Stelle schon eingeht (ein
hängender Prozess ist der schlechtere Ausgang, weil ein Supervisor ihn ohnehin `SIGKILL`t). **Auf
ausdrückliche Anweisung nicht weiter untersucht** — das Ziel dieser Scheibe war die korrekte
Verbuchung, nicht die Ursachenfindung.

**Nebenbefund, im selben `shutdown()`:** die Fehlerbehandlung von `ledgerSql.end()` protokolliert mit
`logger.warn(...)` **unmittelbar vor** `process.exit(0)`. Das ist exakt die Reihenfolge, die **F59**
war (`console.log` gefolgt von `process.exit()`, ohne dass der Aufrufer weiß, ob der Log-Schreibvorgang
auf einem Pipe-stdout abgeschlossen ist, bevor der Prozess endet). Hier ist die Schwere niedrig, weil
diese Zeile **keine Zusicherung** trägt, die ein Test prüft (anders als F59s „shutting down"-Zeile) —
aber das Muster ist dasselbe, in einer neuen Datei, und ist billig zu benennen, solange es auffällt.
Kein Fix in dieser Scheibe; für ein tatsächliches Auftreten wäre `writeLineThenFlush()`
(`apps/smtp-ingress`) die bereits vorhandene Lösung.

**Schwere:** mittel — kein Datenverlust, aber eine offene Frage über den Ressourcen-Umgang der drei
neu importierten Services, die jeder künftige Worker-Prozess mit denselben Abhängigkeiten wieder
treffen wird (siehe F63s Verweis für `JR-6-04`).

## F65 — das lokale Pre-Push-Gate behandelte seine eigenen Infrastruktur-Vorbedingungen asymmetrisch

**Gefunden:** Rolle TEST, unabhängig, durch drei tatsächliche Läufe auf dem sauberen Kopf-Commit
`d96bd26` von `scripts/pre-push-gate.mjs` (2026-08-06, kein Backlog-Task — Werkzeug-Infrastruktur nach
`JR-6-02b`s Kostenanalyse) · **Status:** **behoben** (`1611434`), dreifach nachkalibriert

`DATABASE_URL` und `REDIS_PASSWORD` sind Host-Infrastruktur für Schritt 4/4 des Gates, kein
Prüfgegenstand — anders als `STORAGE_TYPE`/`ENCRYPTION_KEY`/etc. (deren Fehlen in `ci.yml` genau das
ist, was geprüft werden soll) sagt ihr Fehlen nichts über `ci.yml`, sondern nur, dass diese Shell noch
nicht eingerichtet ist. Die Behandlung war asymmetrisch:

1. **Fehlendes `DATABASE_URL`** überspringt Schritt 4/4 handwerklich korrekt, nannte aber nie, welche
   Fehlschlagklassen dadurch ungeprüft bleiben — und da kein `.env` im Repository liegt, ist das der
   **Normalfall** auf einem frischen Checkout, nicht der Randfall. Die alte Schlusszeile „All checks
   passed or were skipped with a stated reason" hätte das verdeckt (Form von F48/`JR-4-10`).
2. **Fehlendes/falsches `REDIS_PASSWORD` wurde gar nicht geprüft.** Ein reiner TCP-Connect (die einzige
   Prüfung, die es vorher gab) gelingt gegen Valkey mit `--requirepass` unabhängig vom Passwort, weil
   Auth oberhalb der TCP-Ebene passiert. Die Folge: Build und `vitest` liefen an und scheiterten mitten
   im Testlauf mit vier `ReplyError: NOAUTH Authentication required`-Stacktraces, ohne genannte Ursache
   — **Exit 1 auf sauberem Baum**, die F35-Form.

**Behoben:** `probeRedisRequiresAuth()` spricht `PING`, und nur bei einer `-NOAUTH`-Antwort zusätzlich
`AUTH <password>` + erneutes `PING` — beantwortet „kommt Schritt 4/4 überhaupt durch" **vor** jedem
Build/Spawn. Beide Vorbedingungen benennen beim Überspringen jetzt explizit, welche Klassen ungeprüft
bleiben (`9af1492`, `41c407e`) und das lokale Rezept. Die Summary-Zeile unterscheidet „All checks
passed" von „All runnable checks passed. Step 4/4 … was SKIPPED".

**Kalibriert, alle drei vom Prüfer gemessenen Zustände nachgefahren:** nichts gesetzt → Exit 0 mit
Namensnennung; nur `DATABASE_URL` → Exit 0 (vorher Exit 1 mit `NOAUTH`); beide korrekt gesetzt →
Exit 0, alle vier Schritte `PASS`. Gegenprobe: `41c407e`s ursprüngliche Kalibrierung (Test auf
`41c407e~1` zurückgesetzt) meldet danach weiterhin exakt dieselbe `AssertionError`, unverändert von
diesem Umbau — zurückgesetzt, `git diff --cached --stat` danach leer.

**Schwere:** niedrig — kein Produktionscode betroffen, aber ein Gate, das auf sauberem Baum rot wird,
verliert das Vertrauen, von dem seine Wirkung abhängt (dieselbe Lehre wie F35).

## F66 — `checkSpoolHighWaterMark()` durchläuft bei jeder SMTP-Annahme den gesamten Spool-Baum: O(n²) Gesamtkosten bei wachsendem Rückstand

**Gefunden:** PO, während der `JR-6-07`-Nachverifikation auf echtem Linux (WSL2/Ubuntu 24.04, natives
ext4, nicht über `/mnt/*`) · **Status:** **offen, Zuordnung E7 entschieden** (Auftraggeber,
2026-08-07) · Schwere **hoch** — Ursache bereits in `layout.ts`s eigenem Kommentar seit
`JR-3-01`/`JR-3-04` als „links open" benannt, aber nie behoben, und diese Scheibe ist der erste
**empirische** Beleg, dass es kein theoretisches Randproblem ist.

**Fundort:** `packages/journaling/src/spool/layout.ts` — `checkSpoolHighWaterMark()` ruft
`computeDirectoryUsageBytes()` auf, das den kompletten Spool-Baum (`incoming/` **und**
`quarantine/`, alle 256 Shard-Verzeichnisse) durchläuft und **jede einzelne Datei** `stat()`-t.
Aufgerufen von `packages/journaling/src/spool/acceptance.ts:290`, **vor jeder einzelnen
SMTP-Annahme** („reject before a single byte is written"). Der Kommentar in `layout.ts` (Zeilen
44–52) benennt das Problem selbst wörtlich: „doing it once per SMTP transaction at meaningful spool
depth is `O(entries)` work on the hot path the acceptance contract is supposed to keep fast. A
maintained running counter [...] is the likely production shape; this module deliberately does not
decide that."

**Nicht das Sharding.** 256 Shard-Verzeichnisse (Git-Style, erstes Byte von `SHA-256(txid)`) sind bei
10.000–100.000 Nachrichten mit ~39–390 Dateien pro Shard trivial für jedes Dateisystem. Der Fehler
liegt allein darin, dass der **gesamte** Baum bei **jeder** Annahme neu durchlaufen wird, egal wie
groß er schon ist.

**Gemessen, nicht vermutet.** Ein diagnostischer Soak-Lauf (`JR-6-07`s Testdatei, temporär auf 10.000
Nachrichten/20-Minuten-Budget reduziert und mit Fortschrittsprotokollierung alle 500 Nachrichten
versehen — nicht committet, reine Diagnose) auf echtem Linux ergab eine klar monotone,
nicht-plateauende Verlangsamung der **Momentanrate**:

| Nachrichten-Fenster | Momentanrate |
| ------------------- | ------------ |
| 0–500               | ~33/s        |
| 500–1.000           | ~15,5/s      |
| 1.000–1.500         | ~10,6/s      |
| 1.500–2.000         | ~7,2/s       |
| 2.000–2.500         | ~5,9/s       |
| 3.000–3.500         | ~4,3/s       |
| 4.000–4.500         | ~2,3/s       |

Der Lauf erreichte 5.000 von 10.000 Nachrichten nach ~1.011.000ms und lief danach in das
20-Minuten-Diagnose-Timeout. Ein vorheriger, unveränderter Lauf mit den committeten 100.000
Nachrichten scheiterte bereits am eigenen 3-Stunden-Budget (`NIGHTLY_SOAK_BUDGET_MS`) — nicht an
einer Assertion, sondern an `Error: Test timed out in 10800000ms`. Beide Zahlen sind konsistent mit
O(n²): die kumulierte Zeit bis N Nachrichten wächst quadratisch, nicht linear.

**Warum das über `JR-6-07`s Testrahmen hinausgeht:** Der Soak-Test lässt den Spool bewusst
unabgeräumt (Phase A only, siehe `journal-soak.adv.test.ts`s eigene Scope-Begründung), was diesen
Effekt künstlich verstärkt gegenüber normalem Betrieb, in dem Phase B kontinuierlich abräumt. Aber
genau dieselbe Bedingung — ein wachsender, unabgeräumter Spool — entsteht bei jedem **echten**,
länger andauernden Phase-B-Ausfall (`JR-6-06`s Szenario, nur bei realistisch viel größerem
Rückstand als den 1–2 Nachrichten, die dort getestet wurden). Jede neu ankommende Nachricht während
eines solchen Ausfalls würde messbar langsamer akzeptiert als die vorherige. Das bedroht nicht die
**Korrektheit** der zentralen Randbedingung aus `CLAUDE.md` („`250 OK` erst nach fsync von Spool und
Ledger") — die bleibt erfüllt — aber ihre **Latenzgarantie** wächst unbegrenzt mit dem Rückstand, und
bei genug Rückstand drohen SMTP-client-seitige Timeouts, die den Sender zu Wiederholungsversuchen
oder im Extremfall zu einem NDR zwingen könnten.

**Naheliegender Fix** (nicht umgesetzt, da außerhalb des Scopes dieser Verifikationssitzung): der im
Code selbst vorgeschlagene „maintained running counter" — bei jedem Schreiben inkrementiert, bei
jeder Freigabe durch Phase B oder den Reconciler (`JR-6-04`) dekrementiert, gegen einen vollen
Verzeichnis-Walk beim Crash-Recovery-Scan (`JR-3-05`) abgeglichen, der ohnehin beim Start läuft.

**Zuordnung: E7** (WORM-Storage), wo `S3StorageProvider`/Spool-Layout ohnehin angefasst werden —
analog zu F60. **Entschieden vom Auftraggeber am 2026-08-07: nach E7 verschoben, blockiert `JR-6-08`
nicht.** Die Acceptance-Contract-Korrektheit ist unberührt; die O(n²)-Latenz unter Rückstand wird mit
F60 zusammen in E7 behoben, nicht vorher.

**Status:** **behoben in E7**, Commit `c0cb970`. Genau der im Kommentar vorgeschlagene Zähler: neue
Klasse `SpoolUsageTracker` (`packages/journaling/src/spool/spool-usage-tracker.ts`,
`increment`/`decrement`/`current`/`reset`), als **optionaler** DI-Kollaborator an
`JournalAcceptance` übergeben — Schritt 0 von `accept()` liest bei vorhandenem Tracker
`evaluateHighWaterMark(tracker.current(), ...)` (`O(1)`, kein I/O) statt `checkSpoolHighWaterMark()`
zu rufen; fehlt der Tracker, bleibt exakt das Vorzustands-Verhalten (voller Walk pro Aufruf) erhalten
— keiner der ~40 bestehenden `JournalAcceptance`-Konstruktionsaufrufe musste geändert werden.
Inkrementiert nach jedem erfolgreichen durablen Schreiben **und** nach jeder Quarantäne von
Schreibfehler-Trümmern (per `fs.stat()` auf die tatsächlich verschobene Datei) — die in
`spool-fsync-fault-injection.adv.test.ts` bereits abgenommene "Quarantäne-Trümmer erodieren das
Budget" (F40 Hälfte 2) bleibt dadurch mit Tracker exakt gleich, nicht vereinfacht.

**Gemessener Beleg (`acceptance.test.ts`s neue "F66"-Suite):** mit Tracker macht `accept()` bei einem
mit 200 Quarantäne-Dateien vorbefüllten Spool **null** `readdir`/`stat`-Aufrufe (Timeline-Assertion);
ohne Tracker steigt die Anzahl der `readdir`-Aufrufe messbar mit der Rückstandsgröße (4 vs. 200
Dateien, `large > small`, beide `> 0`). Das ist der Vorher/Nachher-Vergleich, den F66 selbst mit der
Momentanraten-Tabelle gefordert hat, hier als Aufruf-Zähler statt Wanduhrzeit — reicht laut Auftrag,
ein voller 100.000er-Soak musste nicht wiederholt werden.

**Nicht geschlossen, bewusst offengelegt statt versteckt — der Cross-Process-Punkt:** `apps/smtp-ingress`
(inkrementiert) und der `journal-inbound`-Worker (`runPhaseBPipeline()`, dekrementiert bei
`release()`) sind zwei getrennte OS-Prozesse über demselben Spool-Verzeichnis, kein gemeinsamer
Prozess. Ein reiner In-Memory-`SpoolUsageTracker` in einem Prozess ist für den anderen unsichtbar —
`PhaseBPipelineDeps.usageTracker` existiert als Schnittstelle (für eine künftige, wirklich
prozessübergreifend geteilte Implementierung, z. B. Redis-gestützt), wird aber in
`journal-inbound.processor.ts` bewusst **nicht** verdrahtet: ein Dekrement auf eine Instanz zu rufen,
die niemandes High-Water-Mark-Prüfung je liest, würde nach einem Fix aussehen und nichts messen — genau
die F41/F43/F44-Form, vor der `CLAUDE.md` warnt. Mitigation: `SpoolUsageReconciler`
(`start`/`stop`/`reconcileNow()`, gleiche Form wie `JournalAcceptanceBootstrap`/`SourceAclCache`) läuft
in `apps/smtp-ingress` alle 5 Minuten und resettet den Tracker auf einen frischen Walk — der O(n)-Walk
bleibt also bestehen, nur nicht mehr auf dem Hot Path. **Für den Auftraggeber zu entscheiden:** ob eine
echte prozessübergreifend geteilte Zähler-Implementierung (Redis o. ä.) für eine spätere Epic
angesetzt werden soll, statt sich auf die 5-Minuten-Reconciliation zu verlassen.

## F67 — `journal-soak.adv.test.ts`s `ci`-Smoke-Fall hängt 600s unter voller Suite-Parallellast, obwohl er isoliert in ~1s durchläuft

**Gefunden:** TEST, während der `JR-7-05`-Verifikationssitzung (E7, WORM-Storage) auf Windows, beim
Versuch, einen echten Volllauf (`pnpm test` bzw. `pnpm run test:nightly`-Äquivalent) als Beleg für die
vier neuen WORM-Testfälle zu erzeugen · **Status:** **offen** · Schwere **hoch** — ein `ci`-Test hängt,
statt schnell fehlzuschlagen, unter gewöhnlicher Parallellast für volle 10 Minuten.

**Nicht F66.** F66 ist eine graduelle O(n²)-Verlangsamung mit wachsendem, unabgeräumtem Spool-Rückstand
(bei 4.000–4.500 Nachrichten noch ~2,3/s, kein Hang). Der hier beschriebene Fall betrifft den
`ci`-Smoke-Fall mit nur **100** Nachrichten — dafür ist F66s Kurve bei weitem nicht groß genug, um
einen zehnminütigen Stillstand zu erklären. Zwei verschiedene Mechanismen, zufällig im selben Testfile.

**Beobachtung:** Ein voller `pnpm run test:nightly`-Lauf (`OA_TEST_CLASSES=ci,nightly`,
`OA_TEST_REQUIRE_INFRA=1`, echtes Postgres/Valkey/Meilisearch/Tika **und** ein für `JR-7-05` extra
gestartetes MinIO) blieb nach dem Fehlschlag des `nightly`-Soak-Falls (100.000 Nachrichten,
`no SMTP reply within 600000ms`) über 20 Minuten ohne jede neue Log-Zeile stehen; ein verwaister
`apps/smtp-ingress/dist/index.js`-Prozess (aus `smtp-ingress-kill-during-data.adv.test.ts`) war noch
aktiv, der übergeordnete `pnpm`/`vitest`-Baum reagierte nicht mehr auf normales Fortschreiten und wurde
per `taskkill /F /T` beendet. Ein zweiter, unabhängiger Versuch — dieses Mal nur `ci`-Klasse
(`pnpm exec dotenv -- vitest run`, kein `OA_TEST_CLASSES`-Override) — lief 677,65s und endete mit
demselben Fehlerbild, dieses Mal im **`ci`-Smoke-Fall selbst** (100 Nachrichten, nicht dem
100.000er-`nightly`-Fall):

```
FAIL adversarial journal-soak.adv.test.ts > [ci] soak smoke (JR-6-07) -- 100 messages over 10 connections
  > accepts 100 mixed-size messages gaplessly (or fails safe on this platform)
Error: no SMTP reply within 600000ms
```

**Kalibriert — nicht durch `JR-7-05`s Änderungen verursacht.** `git stash` auf die drei durch `JR-7-05`
geänderten/neuen Dateien (`tests/support/infra.ts`, `tests/support/suite-inventory.ts`,
`packages/backend/tests/adversarial/journal-worm-object-lock.adv.test.ts`) angewendet, derselbe
`ci`-Smoke-Fall **isoliert** erneut ausgeführt (`vitest run --project adversarial -t "soak smoke"`):
lief in **1133ms** durch, exakt im dokumentierten, erwarteten Windows-Pfad (`directory-fsync` ist
POSIX-only, also 106 abgelehnte Antworten/s statt 250er). Der Hang tritt also **nur unter voller
Parallellast des restlichen Suite-Laufs** auf, nicht am unveränderten Code selbst und nicht an
`JR-7-05`s eigenen vier neuen Testfällen (die liefen in derselben Sitzung isoliert viermal grün in
554ms gegen echtes MinIO).

**Wahrscheinliche Ursache (nicht abschließend isoliert):** Ressourcenkonkurrenz unter voller
Parallellast auf diesem konkreten Windows-Host — mehrere `tinypool`-Worker-Prozesse,
`smtp-ingress-kill-during-data.adv.test.ts` (echte Prozess-Spawns/-Kills) und
`journal-ledger-concurrency.adv.test.ts` (20×500 nebenläufige DB-Appends) liefen im selben Fenster,
zusätzlich diese Sitzung eigene Docker-Last (MinIO für `JR-7-05`, plus die ohnehin laufenden
Postgres/Valkey/Meilisearch/Tika-Container). Nicht geprüft: ob dasselbe auf einem weniger
ausgelasteten Host oder auf echtem Linux-CI reproduziert — `06-status.md`s eigene CI-Historie nennt
durchgehend grüne Läufe, was nahelegt, dass es sich um eine host-/lastspezifische Eigenschaft dieser
Sitzung handelt, nicht um einen deterministischen Code-Defekt. Nicht widerlegt: eine Wechselwirkung
mit F66 (ein wachsender, unabgeräumter Spool aus einem vorherigen Testlauf im selben Prozessbaum
würde `checkSpoolHighWaterMark()` zusätzlich verlangsamen) — dafür reicht die Beobachtung hier aber
nicht aus, um mehr als eine Vermutung zu formulieren.

**Warum das trotzdem ein Befund ist, nicht nur eine Umgebungsnotiz:** Ein `ci`-klassifizierter Test
soll bei jedem PR laufen. Ein Test, der unter gewöhnlicher Parallellast (kein synthetischer Extremfall
— genau das, was ein voller `pnpm test` immer erzeugt) zehn Minuten hängt statt schnell durchzulaufen
oder schnell fehlzuschlagen, ist ein CI-Zuverlässigkeitsrisiko, unabhängig davon, ob die zugrunde
liegende Acceptance-Contract-Korrektheit verletzt ist (sie ist es nicht — der Client sah nie `250`,
das ist der dokumentierte fail-safe Pfad, nur eben nicht _schnell_).

**Nicht behoben hier** (TEST-Rolle, `packages/backend/src/**`/Testcode-Untersuchung wäre Sache von
DEV). **Zuordnung:** offen, Entscheidung beim Auftraggeber — Vorschlag: auf einem weniger ausgelasteten
Host oder echtem Linux-CI reproduzieren, bevor eine Ursache (Ressourcenkonkurrenz vs. F66-Wechselwirkung
vs. etwas Drittes) angenommen wird. Blockiert `JR-7-05`/`JR-7-06` nicht — die vier WORM-Fälle selbst sind
unabhängig davon grün belegt (siehe `06-status.md`, Abschnitt E7).
