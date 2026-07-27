# Befunde im Bestandscode

Defekte, die beim Arbeiten am Journaling-Projekt **im vorhandenen Code** gefunden wurden. Sie sind
**nicht** Teil des RFC-Scopes und wurden bewusst **nicht** nebenbei behoben — eine Testaufgabe ist
nicht der Ort für stille Produktionsänderungen. Dieses Dokument existiert, damit sie nicht verloren
gehen.

Jeder Befund braucht eine Entscheidung des Auftraggebers: **jetzt beheben**, **in ein Epic
einplanen**, oder **bewusst akzeptieren**.

Herkunft: `JR-103` (Rolle `tester`), 2026-07-27. Die Befunde sind im Testcode markiert, teils mit
`it.fails` — dort schlägt der Marker fehl, sobald jemand den Defekt behebt, und die Erwartung muss
dann invertiert werden.

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
   `db`-Singleton, der beim Import wirft. Betrifft `JR-104`.
2. **`src/api/server.ts` type-checkt nicht unter `moduleResolution: bundler`** (Default-Import von
   `i18next-http-middleware`). Deshalb schließt `packages/backend/tsconfig.test.json` den
   Produktionscode aus und prüft nur Testdateien. Vorbestehend, kein Testproblem.
