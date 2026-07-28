# Befunde im Bestandscode

Defekte, die beim Arbeiten am Journaling-Projekt **im vorhandenen Code** gefunden wurden. Sie sind
**nicht** Teil des RFC-Scopes und wurden bewusst **nicht** nebenbei behoben — eine Testaufgabe ist
nicht der Ort für stille Produktionsänderungen. Dieses Dokument existiert, damit sie nicht verloren
gehen.

Jeder Befund braucht eine Entscheidung des Auftraggebers: **jetzt beheben**, **in ein Epic
einplanen**, oder **bewusst akzeptieren**.

Herkunft: `JR-103` (F1–F6) und `JR-104` (F7–F10), Rolle `tester`, 2026-07-27/28. Die Befunde sind im
Testcode markiert, teils mit `it.fails` — dort schlägt der Marker fehl, sobald jemand den Defekt
behebt, und die Erwartung muss dann invertiert werden.

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
