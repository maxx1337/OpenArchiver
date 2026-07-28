# Befunde im Bestandscode

Defekte, die beim Arbeiten am Journaling-Projekt gefunden wurden, aber **nicht** Teil des
RFC-Scopes sind. Sie wurden bewusst **nicht** nebenbei behoben — eine Testaufgabe ist nicht der Ort
für stille Produktionsänderungen. Dieses Dokument existiert, damit sie nicht verloren gehen.

Jeder Befund braucht eine Entscheidung des Auftraggebers: **jetzt beheben**, **in ein Epic
einplanen**, oder **bewusst akzeptieren**.

**Die `F`-Nummerierung ist fortlaufend und liegt ausschließlich in dieser Datei.** Andere Dokumente
verweisen auf `F<N>`, führen aber keine eigenen Befunde — eine über zwei Dateien verteilte
Nummerierung hat schon einmal in die Irre geführt (F11 lag zunächst in `06-status.md`, verschoben am
2026-07-28 im Rahmen von `JR-106`).

Drei Kategorien, im Kopf jedes Befunds ausgewiesen:

| Kategorie                  | Bedeutung                                                                              | Befunde  |
| -------------------------- | -------------------------------------------------------------------------------------- | -------- |
| **Bestandscode**           | Defekt im vorhandenen Produktionscode des Repositorys                                  | F1–F10   |
| **Vorgegebenes Verfahren** | Defekt in einer im Backlog vorgegebenen Schrittfolge, **nicht** im Produktionscode     | F11      |
| **Testharness**            | Defekt in dem in E1 neu gebauten Testcode — unsere eigene Arbeit, kein Bestandsproblem | F12, F13 |

Herkunft: `JR-103` (F1–F6), `JR-104` (F7–F10), `JR-105` (F11), die Abnahme `JR-106` (F12) und die
Nacharbeit `JR-104a` (F13), Rolle `tester`, 2026-07-27/28. Die Bestandscode-Befunde sind im Testcode markiert, teils mit `it.fails` —
dort schlägt der Marker fehl, sobald jemand den Defekt behebt, und die Erwartung muss dann
invertiert werden.

---

## F1 — SQL-Injection über Policy-Condition-Keys

**Schwere:** hoch im Wirkungsgrad, aber **Super-Admin-Rechte als Voraussetzung** ·
**Ort:** `packages/backend/src/helpers/mongoToDrizzle.ts`, `getDrizzleColumn()` ·
**Status:** offen, **nicht behoben**

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

## F2 — `AppAbility`-Typ schützt Row-Level-Prüfungen nicht

**Schwere:** mittel · **Ort:** `packages/backend/src/iam-policy/ability.ts`,
`packages/backend/src/services/AuthorizationService.ts` · **Status:** offen

`AppAbility = MongoAbility<[AppActions, AppSubjects]>` deklariert als Subject nur die String-Union.
Ein CASL-getaggtes Objekt ist damit nicht an `can()` zuweisbar. Der Produktionscode castet das weg:
`AuthorizationService.can()` endet in `ability.can(action, subjectInstance as AppSubjects)`.

Folge: Der Typ gibt keine Sicherheit über die Korrektheit von Row-Level-Prüfungen. Die Tests
spiegeln den Cast bewusst und dokumentieren das in `ability.test.ts`.

## F3 — Fail-open-Übersetzung in `mongoToDrizzle`

**Schwere:** mittel · **Ort:** `packages/backend/src/helpers/mongoToDrizzle.ts` · **Status:** offen

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

**Schwere:** hoch · **Ort:** `packages/backend/src/services/FilterBuilder.ts` · **Status:** offen ·
**Herkunft:** `JR-104`, gegen echtes Postgres verifiziert

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
`FilterBuilder.ts:49–51` lautet `if (query === null) { return { drizzleFilter: undefined,
searchFilter: undefined }; // Full access }`, während der unmittelbar folgende Zweig für das **leere**
Query korrekt `sql`1=0``liefert. Der Autor kannte den „kein Zugriff"-Fall also — der`null`-Fall ist
genau verkehrt herum. `auditor-specific-mailbox.json`enthält für`archive`tatsächlich **nur** eine`inverted`-Regel und kein `can`; eine Policy, deren einziger Zweck das Verbot ist, erteilt damit
Vollzugriff. Der Action-Versatz zwischen `search.routes.ts:158` (`'search'`) und
`SearchService.ts:311`/`:423` (`'read'`) ist ebenfalls bestätigt.

**Bewertung des PO:** Das ist der schwerste Befund dieser Session — schwerer als F1. F1 setzt
Super-Admin voraus; F7 ist von einer **eingeschränkten** Rolle aus erreichbar und kehrt die Wirkung
einer restriktiven Policy ins Gegenteil. Betroffen ist die released Version 0.5.2.

**Direkte Projektrelevanz:** Die Auditor-Rolle aus `JR-1101` ist auf genau diesen Mechanismus
gebaut. `read-only-all.json` wäre unkritisch (es erteilt `can`), aber jede scope-einschränkende
Auditor-Policy im Stil von `auditor-specific-mailbox.json` wäre wirkungslos. **E11 kann nicht
abgenommen werden, solange F7 offen ist** — ein „read-only"-Auditor, der unbeschränkt liest, ist
keine Auditor-Rolle.

**Empfehlung:** `null` von `rulesToQuery` als **deny** behandeln (`sql`1=0``, wie es der bereits
vorhandene „No access"-Zweig für das leere Query tut), und die unbeschränkte Rückgabe auf den Fall
„nachweislich unbedingtes `can`" beschränken. Zusätzlich Action-Angleichung zwischen Route-Gate und
`FilterBuilder`-Aufruf.

## F8 — Der `cannot`-Ausschluss verarbeitet Operator-Bedingungen falsch

**Schwere:** mittel · **Ort:** `packages/backend/src/services/FilterBuilder.ts` · **Status:** offen ·
**Herkunft:** `JR-104`

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
**Status:** offen · **Herkunft:** `JR-104`

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
**Herkunft:** `JR-104`

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
**Ort:** die Schrittfolge in `03-backlog.md`, Task `JR-105`; behoben in `.github/workflows/ci.yml` ·
**Status:** **behoben** (2026-07-28, `1bad10c`) · **Herkunft:** `JR-105`, erster echter CI-Lauf

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
bereits gebaut vor. **Lokal beidseitig belegt**, zuletzt in der Abnahme `JR-106` (2026-07-28) nach
`rm -rf` **aller** gitignorierten Build-Artefakte (`packages/types/dist`, `packages/backend/dist`,
`packages/frontend/.svelte-kit`, beide `tsconfig.tsbuildinfo`):

- ohne den Schritt: `pnpm --filter @open-archiver/backend build` ⇒ 54 × `TS2307`, Exit 2 — identisch
  zum CI-Log;
- mit dem Schritt: Types-Build, Backend-Build, `svelte-check` (0/0), `test:types` und `pnpm test`
  (181 grün) alle grün.

Der `tsbuildinfo`-Hinweis ist keine Nebensache: `packages/types/tsconfig.json` hat
`composite: true`, ein bloßes Löschen von `dist` lässt `tsc` also wegen der stehengebliebenen
Build-Info **nichts** emittieren. Wer das nachstellen will, muss beides löschen.

**Lehre für künftige Epics:** eine im Backlog vorgegebene Kommandofolge ist eine Annahme, kein
Fakt. Sie gilt erst als lauffähig, wenn sie ohne vorhandene Build-Artefakte durchgelaufen ist.

## F12 — Zwei gleichzeitige Integrationsläufe kollidieren auf einem festen Datenbanknamen

**Kategorie:** Testharness — unsere eigene E1-Arbeit, **kein Bestandsproblem** ·
**Schwere:** mittel (Harness-Defekt; kein Durability- oder Autorisierungsrisiko, CI unberührt) ·
**Ort:** `packages/backend/tests/integration/pg-harness.int.test.ts`, Zeile 212 ·
**Status:** **behoben in `JR-104a`, 2026-07-28** (Nachweis unten) ·
**Herkunft:** `JR-106` (Abnahme E1), 2026-07-28

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

**Damit ist das Akzeptanzkriterium von `JR-104`** — „Zwei Integrationstests können parallel laufen,
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

Bei der Reproduktion für `JR-104a` ist der Pfad **eingetreten**, nicht nur hergeleitet. Runde 2 von
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
**Behoben in `JR-104a` (2026-07-28).** Beide Teile, wie in der Abnahme gefordert:

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

**Nachweis (2026-07-28, PostgreSQL 16.13 lokal, Code-Stand des `JR-104a`-Commits).** Ein einzelner
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
**Herkunft:** `JR-104a`, 2026-07-28

`acquireTestDatabase()` ruft bei **jedem** Aufruf `sweepStaleHarnessDatabases()` ohne `restrictTo`
und mit der Standardfrist von 2 h (`OA_TEST_PG_STALE_MS`). Die einzige Absicherung gegen einen
**fremden** laufenden Prozess ist damit das Alter im Namen: dessen Datenbanken sind jünger als die
Frist. Läuft ein fremder Prozess **länger als die Frist**, sind seine noch benutzten Datenbanken für
diesen Sweep nicht mehr von echtem Rückstand zu unterscheiden — offene Verbindungen schützen sie
nicht, weil `postgres-js` nach `idle_timeout` schließt und Wächter 2 dann null Backends sieht.

Das ist keine Neuentdeckung des Mechanismus — er steht seit `JR-104` im Kopfkommentar des Moduls und
in `04-testplan.md` §2.6. Neu ist die Einordnung: mit `JR-104a` sind alle anderen
prozessübergreifenden Pfade geschlossen, dieser ist der letzte, und die in E2/E3 geplanten Soaks
(`JR-208` 20 × 500 Appends, die 100k-Nachrichten-Nachtläufe) sind der erste Anlass, bei dem ein Lauf
die 2 h überhaupt erreichen kann. Eine bekannte Schwäche im Messinstrument nur in einem Docstring zu
führen, widerspricht Grundregel 6 des Testplans — deshalb steht sie jetzt hier mit einer Nummer.

**Warum nicht in `JR-104a` mitbehoben:** die Behebung ist keine Testkorrektur, sondern eine
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

## Bereits im Backlog erfasste Bestandsprobleme

Diese wurden in E0 gefunden und haben schon eine Task — sie gehören nicht in die Liste oben:

| Problem                                                                                                                      | Task                                             |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `docs/services/iam-service/iam-policy.md` listet die Action `export` nicht und beschreibt `manage` falsch (Code ist korrekt) | `JR-1103`                                        |
| Frontend hat keine Nav-Filterung; eingeschränkte Nutzer sehen Menüpunkte, die 403 liefern                                    | `JR-1102`                                        |
| `IamService`-Slug-Bug: `name.toLocaleLowerCase().replaceAll('', '_')`                                                        | Workaround in `JR-1101` (`slug` explizit setzen) |
| `docs/enterprise/journaling/guide.md` beschreibt abwesenden Code                                                             | `JR-1205`                                        |

## Offene Vorschläge, die Produktionscode betreffen

Bewusst nicht umgesetzt, weil sie über den jeweiligen Task hinausgehen:

1. **`FilterBuilder` eine Ability injizieren**, statt sie über `IamService.getAbilityForUser()` zu
   holen (optionaler Parameter `ability?: AppAbility` mit Fallback auf die heutige Auflösung). Damit
   wäre `FilterBuilder.create()` ohne Datenbank unit-testbar. Aktuell hängt es über `IamService` am
   `db`-Singleton, der beim Import wirft. `JR-104` hat den Weg über eine echte Datenbank genommen und
   die Lücke damit geschlossen; der Vorschlag bleibt sinnvoll, ist aber nicht mehr blockierend.
2. **`src/api/server.ts` type-checkt nicht unter `moduleResolution: bundler`** (Default-Import von
   `i18next-http-middleware`). Deshalb schließt `packages/backend/tsconfig.test.json` den
   Produktionscode aus und prüft nur Testdateien. Vorbestehend, kein Testproblem.
