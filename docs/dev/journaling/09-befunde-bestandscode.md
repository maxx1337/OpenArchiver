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

| Kategorie                  | Bedeutung                                                                              | Befunde               |
| -------------------------- | -------------------------------------------------------------------------------------- | --------------------- |
| **Bestandscode**           | Defekt im vorhandenen Produktionscode des Repositorys                                  | F1–F10, F17, F19, F20 |
| **Vorgegebenes Verfahren** | Defekt in einer im Backlog vorgegebenen Schrittfolge, **nicht** im Produktionscode     | F11, F18, F21, F22    |
| **Testharness**            | Defekt in dem in E1 neu gebauten Testcode — unsere eigene Arbeit, kein Bestandsproblem | F12–F16, F23          |

Herkunft: `JR-103` (F1–F6), `JR-104` (F7–F10), `JR-105` (F11), die Abnahme `JR-106` (F12), die
Nacharbeit `JR-104a` (F13), die Abnahme `JR-106a` (F14–F16) und `JR-1301` (F17–F23), Rolle `tester`,
2026-07-27 bis 2026-07-29.

> **Seit `JR-1301` (2026-07-29) markiert der Testcode die vier E13-Befunde nicht mehr als bestanden.**
> F1, F3, F7 und F8 waren bis dahin mit `it.fails` bzw. mit Assertions auf den **Ist**-Zustand
> festgehalten — ein grüner Test, der eine Sicherheitslücke beschreibt. Sie fordern jetzt den
> gewünschten Zustand, mit dem Titelpräfix `RED UNTIL JR-13xx`. Die Rot-Läufe sind in
> `06-status.md` protokolliert. Für Befunde **außerhalb** von E13s Umfang (F4, F5, F9, F10, F17) gilt
> weiter: Ist-Zustand festhalten, laut in einer `coverageNotice` benennen, nicht beheben — es gibt
> keine Task dafür, und ein roter Test ohne Zuständigen blockiert nur die Abnahme.

> **Stand 2026-07-29 nach den Fixes `JR-1302`–`JR-1306`: F1, F3, F7, F8, F19 und F20 sind behoben**,
> F21 ist umgesetzt. 20 der 21 roten Tests sind grün, kein vorher grüner Test ist rot geworden. Der
> eine noch rote Test ist ein Widerspruch zwischen zwei `JR-1301`-Tests und keine offene Lücke —
> Vorlage in `06-status.md` unter „Der eine verbleibende rote Test".
>
> **Unverändert offen und ausdrücklich nicht mitbehandelt:** F2, F4, F5, F6, F9, F10, F13–F18, F22,
> F23. `JR-1309` prüft, dass sie nicht stillschweigend mitverändert wurden.

---

## F1 — SQL-Injection über Policy-Condition-Keys

**Schwere:** hoch im Wirkungsgrad, aber **Super-Admin-Rechte als Voraussetzung** ·
**Ort:** `packages/backend/src/helpers/mongoToDrizzle.ts`, `getDrizzleColumn()` ·
**Status:** **behoben** in `JR-1306` (`dcec017`, 2026-07-29)

> **Behoben (`JR-1306`, `dcec017`).** Condition-Keys werden gegen eine Allowlist geprüft statt
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

**Ausnutzbarkeit gegen echtes Postgres nachgewiesen (`JR-1301`, 2026-07-29).** Bis hierher war F1 am
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
**Status:** **behoben** in `JR-1304` (`45ac0e9`, 2026-07-29) — eine Testfassung bleibt rot, siehe unten

> **Behoben (`JR-1304`, `45ac0e9`).** `mongoToDrizzle` wirft, statt eine Bedingung zu verwerfen:
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

**Richtung korrigiert (`JR-1301`, 2026-07-29) — siehe F22.** Der oben zitierte `$or`-Fall ist
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
**Status:** **behoben** in `JR-1302` (`a309fd1`) und `JR-1303` (`bcac6bd`), 2026-07-29 ·
**Herkunft:** `JR-104`, gegen echtes Postgres verifiziert

> **Behoben.** `JR-1302` (`a309fd1`) bildet `null` von `rulesToQuery` auf denselben Deny ab, den der
> vorhandene „No access"-Zweig liefert (``sql`1=0` `` plus ein nie zutreffender Suchfilter); die
> unbeschränkte Rückgabe bleibt allein dem nachweislich unbedingten `can`. `JR-1303` (`bcac6bd`)
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

**Zwei Präzisierungen aus `JR-1301` (2026-07-29)** — die Aussage oben gilt **für die
(Action, Subject)-Paare der heutigen vier Aufrufstellen**, nicht für jedes Paar je Rolle (**F18**: über
das volle Vokabular treffen `predefined_end_user` 39 und `predefined_read_only_user` 46 von 56 Paaren
den Zweig). Und „ausgeliefert" trifft auf zwei der drei Rollen gar nicht zu (**F17**): der
Rollen-Bootstrap läuft in einer echten Installation nie, es existiert nur `predefined_super_admin`.

Das ändert die Schwere **nicht** — es erhöht sie praktisch. F7a und F7b sind real, ein Nutzer ohne
Rolle entsteht schon durch das Löschen einer Rolle, und weil ausgeliefert **keine** Read-Only-Rolle
existiert (F17), ist jeder eingeschränkte Nutzer eine handgeschriebene Policy in der Form von
`auditor-specific-mailbox.json` — also in genau der Form, die F7 ins Gegenteil verkehrt. Das ist nicht
der Ausnahmefall, sondern der einzige Weg, den ein Betreiber hat. Es korrigiert nur eine frühere, zu scharfe Aussage des PO, der
Fix aus `JR-1302` „bräche Bestandsinstallationen": eine Standardinstallation mit den drei
`predefined_*`-Rollen verhält sich vor und nach dem Fix gleich. Der Nachweis dafür ist der
Integrationstest aus `JR-1301`, nicht diese Feststellung.

**Bewertung des PO:** Das ist der schwerste Befund dieser Session — schwerer als F1. F1 setzt
Super-Admin voraus; F7 ist von einer **eingeschränkten** Rolle aus erreichbar und kehrt die Wirkung
einer restriktiven Policy ins Gegenteil. Betroffen ist die released Version 0.5.2.

**Direkte Projektrelevanz:** Die Auditor-Rolle aus `JR-1101` ist auf genau diesen Mechanismus
gebaut. `read-only-all.json` wäre unkritisch (es erteilt `can`), aber jede scope-einschränkende
Auditor-Policy im Stil von `auditor-specific-mailbox.json` wäre wirkungslos. **E11 kann nicht
abgenommen werden, solange F7 offen ist** — ein „read-only"-Auditor, der unbeschränkt liest, ist
keine Auditor-Rolle.

**Empfehlung:** `null` von `rulesToQuery` als **deny** behandeln (``sql`1=0` ``, wie es der bereits
vorhandene „No access"-Zweig für das leere Query tut — Einschränkung dazu unter F19), und die
unbeschränkte Rückgabe auf den Fall „nachweislich unbedingtes `can`" beschränken. Zusätzlich
Action-Angleichung zwischen Route-Gate und `FilterBuilder`-Aufruf — **entschieden in ADR-017 als
Variante B**, umzusetzen in `JR-1303`.

**Reichweite bestätigt (`JR-1301`, 2026-07-29) — mit zwei Einschränkungen.** Der in ADR-017
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
**Status:** **behoben** in `JR-1305` (`2311996`, 2026-07-29) · **Herkunft:** `JR-104`

> **Behoben (`JR-1305`, `2311996`).** Die Negation entsteht auf Query-Ebene (`{ $not: condition }`
> je `cannot`-Regel, alle per `$and` verknüpft) statt durch Einwickeln des **Werts** in `$ne`. `$not`
> komponiert mit jedem Operator, und beide Übersetzer implementieren es bereits. Die drei roten Fälle
> (`$in`, `$nin`, `$gte`) sind grün, der Gegenprobefall für die skalare Bedingung ist grün geblieben.

> **Regressionstests seit `JR-1301`:** `tests/integration/filter-builder-f8.int.test.ts`, drei rote
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

## F14 — Die Suite-Inventur wacht über Dateien, nicht über gelaufene Tests

**Kategorie:** Testharness — unsere eigene E1-Arbeit ·
**Schwere:** mittel (kein Kriteriumsbruch, aber genau die Fehlerklasse, gegen die `JR-105b` existiert) ·
**Ort:** `tests/support/suite-inventory.ts` zusammen mit `tests/support/classification.ts` ·
**Status:** **offen** — gehört nach `JR-1305` · **Herkunft:** Abnahme `JR-106a`, 2026-07-28

`JR-105b` hat die zwei in `JR-106` gefundenen Löcher geschlossen: eine abwesende Suite und eine
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
Klassen-Skip nicht zu unterscheiden — und genau dieses Nichtunterscheiden ist in `JR-105b` bewusst
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

## F15 — `minimumFiles` verdeckt eine gelöschte Testdatei, sobald die Suite wächst

**Kategorie:** Testharness — unsere eigene E1-Arbeit ·
**Schwere:** niedrig heute (Spiel = 0), **mittel ab E2** (wird durch jede neue Testdatei erreichbar) ·
**Ort:** `tests/support/suite-inventory.ts`, `SUITES[].minimumFiles` ·
**Status:** **offen** — gehört nach `JR-1305` · **Herkunft:** Abnahme `JR-106a`, 2026-07-28

Die Mindestzahlen sind hartkodiert und stehen heute **genau** auf dem Bestand (`unit` 5/5,
`integration` 4/4, `adversarial` 1/1). Deshalb macht jede Löschung heute rot — das ist belegt und
das Kriterium ist erfüllt. Der Wert ist aber eine **Untergrenze**, kein Soll: sobald eine Suite über
ihre Mindestzahl wächst, entsteht Spiel, und eine Löschung in Höhe des Spiels geht still durch.

**Reproduktion (belegt):** eine zusätzliche `integration`-Datei anlegen (⇒ `5 (min 4)`, grün), dann
`pg-harness.int.test.ts` löschen — die eine Datei, die den gesamten `JR-104`-Isolationsvertrag
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

## F16 — Rückstand nach einem Modul-Throw wird lokal nicht angekündigt

**Kategorie:** Testharness — unsere eigene E1-Arbeit ·
**Schwere:** niedrig (CI fängt es, lokaler Rückstand verfällt nach 2 h) ·
**Ort:** `packages/backend/tests/support/pg-harness.ts`, `installExitWarning()` ·
**Status:** **offen** — gehört nach `JR-1305` · **Herkunft:** Abnahme `JR-106a`, 2026-07-28

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

## F17 — Zwei der drei „ausgelieferten" Rollen werden in einer echten Installation nie angelegt

**Kategorie:** Bestandscode · **Schwere:** mittel (kein Sicherheitsloch, aber die
Wirkungsanalyse von ADR-017 und die Betreiberanleitung in `JR-1307` stehen darauf) ·
**Ort:** `packages/backend/src/api/controllers/iam.controller.ts:17`,
`packages/backend/src/services/UserService.ts:231/:252` · **Status:** offen, **nicht behoben** ·
**Herkunft:** `JR-1301`, gegen echtes Postgres verifiziert

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
2. **`JR-1307`s Prüfanleitung muss das sagen.** „Keine der drei ausgelieferten Rollen ist betroffen"
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
Wiederholung in F7 dieses Dokuments · **Status:** offen · **Herkunft:** `JR-1301`

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
verwenden, hält die Aussage — siehe die Tabelle unter „Rot-Läufe `JR-1301`" in `06-status.md`.

**Warum es trotzdem notiert wird:** eine unausgesprochene Vorbedingung wird falsch, sobald jemand
eine fünfte Aufrufstelle mit einer anderen Action ergänzt — `export archive` für den Export aus E11
ist der naheliegende Kandidat. Der Test hält die Vorbedingung jetzt maschinell fest: das
Aufrufstellen-Inventar in `tests/unit/filter-builder-call-sites.test.ts` wird rot, wenn eine fünfte
Stelle auftaucht. **Empfehlung:** ADR-017 und F7 um die Einschränkung „für die Paare der heutigen
Aufrufstellen" ergänzen.

## F19 — Ein `can` mit **leerem** `conditions`-Objekt bedeutet Vollzugriff

**Kategorie:** Bestandscode · **Schwere:** mittel · **Ort:**
`packages/backend/src/services/FilterBuilder.ts:53`, `src/helpers/mongoToDrizzle.ts` ·
**Status:** **behoben** in `JR-1302` (`a309fd1`) und `JR-1304` (`45ac0e9`), 2026-07-29 ·
**Herkunft:** `JR-1301`

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
`RED UNTIL JR-1304: a can rule with empty conditions must not mean full access (F19)`).

Eigene Nummer, obwohl es zur F3-Familie gehört: F3 benennt „leeres `$or`/`$and` oder leere Query".
`{ $or: [ {} ] }` ist keine davon, und eine Behebung, die nur `{}` und `{ $or: [] }` abfängt, lässt
diese Form offen.

**Nebenbefund, nicht abgesichert: der Deny-Zweig in Zeile 53 ist womöglich unerreichbar.**
`JR-1302` soll ihn als Vorlage benutzen („wie der bereits vorhandene ‚No access'-Zweig"). Er feuert
nur, wenn `rulesToQuery` ein **leeres, nicht-`null`** Objekt liefert. Nach der Implementierung von
`@casl/ability/extra` passiert das genau dann, wenn eine nicht-invertierte Regel **ohne** Bedingungen
gefunden wird und keine invertierte mit Bedingungen davor lag — und dieser Fall wird schon von Zeile 31
abgefangen. In keinem der über zwanzig Policy-Zuschnitte, die jetzt unter Test stehen, wurde der Zweig
erreicht. **Nicht bewiesen:** eine Konstruktion, die ihn erreicht, wurde nicht gefunden, und
„unerreichbar" lässt sich mit Tests nicht zeigen. Für `JR-1302` heißt das: die Vorlage existiert im
Quelltext, aber es gibt keinen laufenden Fall und keinen Test, der sie abdeckt.

## F20 — Ein `cannot` **ohne** Bedingungen wird vollständig ignoriert

**Kategorie:** Bestandscode · **Schwere:** mittel (in der HTTP-Kette durch `requirePermission`
abgefedert, in Serviceaufrufen nicht) · **Ort:**
`packages/backend/src/services/FilterBuilder.ts:27–33` · **Status:** **behoben** in `JR-1302`
(`a309fd1`, 2026-07-29) · **Herkunft:** `JR-1301`

> **Behoben (`JR-1302`, `a309fd1`).** `FilterBuilder` sammelt jetzt zusätzlich die `cannot`-Regeln
> **ohne** Bedingung und antwortet für sie mit deny, bevor der Zweig „unbedingtes `can`" greift. Ein
> pauschales Verbot lässt sich nicht als Filter ausdrücken, also ist deny die einzige richtige Antwort.

Der Ausschlussfilter sammelt nur `cannot`-Regeln, die eine Bedingung tragen:

```ts
const cannotConditions = rules.filter((rule) => rule.inverted === true && rule.conditions);
```

Ein pauschales `cannot read archive` fällt damit heraus, `cannotConditions.length === 0` gilt, und
Zeile 31 antwortet mit **Vollzugriff** — für einen Nutzer, dem die Action ausdrücklich entzogen
wurde. Belegt gegen echtes Postgres (`filter-builder-f1-f3.int.test.ts`, roter Test
`RED UNTIL JR-1302: an unconditional cannot is not ignored (F20)`).

`ability.can('read', 'archive')` ist für diesen Nutzer `false`, das Route-Gate liefert also `403` —
Verteidigung in der Tiefe ist vorhanden. Trotzdem ist `FilterBuilder`s eigene Antwort falsch, und
`JR-1302`s Kriterium („unbeschränkte Rückgabe nur noch bei nachweislich **unbedingtem** `can`") ist
nicht erfüllt, solange sie so bleibt: ein widerrufenes `can` ist kein unbedingtes.

## F21 — `JR-1306`s Allowlist widerspricht drei bestehenden, grünen Pins

**Kategorie:** Vorgegebenes Verfahren · **Schwere:** niedrig (Arbeitsplanung, kein Defekt) ·
**Ort:** `packages/backend/src/helpers/mongoToDrizzle.test.ts` (Suite „column name mapping"),
`packages/backend/tests/fixtures/mongo-to-drizzle-golden.json` Fall „unknown relation key is emitted
as one identifier containing a dot" · **Status:** **erledigt** — strenge Variante entschieden (PO,
2026-07-29) und in `JR-1306` (`dcec017`) umgesetzt, die drei Pins im selben Commit invertiert ·
**Herkunft:** `JR-1301`

`JR-1306` soll Condition-Keys „gegen eine **Allowlist** bekannter Spalten prüfen statt zu escapen".
Das Akzeptanzkriterium spricht nur von Keys mit `"`. Eine echte Allowlist weist aber auch
**unbekannte, syntaktisch harmlose** Keys ab, und drei grüne Assertions halten für genau die das
heutige Verhalten fest: `attachment.name` ⇒ `"attachment.name" = $1`, `foo.bar` ⇒ `"foo.bar" = $1`
(Golden-Datei), sowie die Aussage „resolves only the relations listed in `relationToTableMap`".

Die Regressionstests aus `JR-1301` fordern **nicht** die Abweisung solcher Keys — bewusst, damit der
Test nicht eine Entscheidung vorwegnimmt, die die Task offenlässt. Zu klären ist also: gilt die
Allowlist nur für Keys mit SQL-Syntax (dann bleiben die drei Pins gültig) oder für alle unbekannten
Keys (dann gehören sie im selben Commit invertiert)? **Empfehlung:** die strenge Variante, mit
Anpassung der drei Pins — ein unbekannter Key ist ein Policy-Fehler und trifft in SQL ohnehin keine
Spalte, führt also entweder zu einem Laufzeitfehler oder zu einem falschen Ergebnis.

**Entscheidung (PO, 2026-07-29): die strenge Variante, der Empfehlung folgend.** Sie war ohnehin schon
im Aufgabentext von `JR-1306` angelegt — „ein unbekannter Key ist ohnehin ein Fehler und gehört
fail-closed behandelt" lässt die milde Lesart nicht zu. Kein Vorlagebedarf beim Auftraggeber: für
einen Betreiber ändert sich nur, dass ein Tippfehler in einer Policy künftig beim Anlegen auffällt
statt stillschweigend eine Regel ohne Wirkung zu erzeugen. Die drei Pins werden im selben Commit wie
der Fix invertiert, damit kein Zwischenstand existiert, in dem Test und Code sich widersprechen.

**Umgesetzt in `JR-1306` (`dcec017`, 2026-07-29), mit einer benannten Einschränkung.** Abgewiesen wird
jeder Key mit SQL-Syntax und jeder Key mit **unbekannter Relation** (`attachment.name`, `foo.bar`,
`a.b.c`). Ein einzelner, unbekannter, syntaktisch harmloser Key (`foo`) wird dagegen **weiter
übersetzt**: `mongoToDrizzle` kennt die Zieltabelle nicht, eine spaltengenaue Allowlist ist dort also
nicht formulierbar, und sie hätte drei weitere heute grüne Pins gebrochen (`{a:1}`, `{b:2}`,
`{n:{$gt:1}}` sowie die `FIELDS`-Liste der adversarialen Suite) — was der Auftrag ausdrücklich
ausschloss. Die spaltengenaue Prüfung gehört dorthin, wo das Subject bekannt ist, also in die Nähe von
`JR-1310`. Die drei Pins sind wie vorgesehen im Fix-Commit invertiert; der Golden-Fall trägt dafür den
eigenen Marker `mustRefuseKey`, damit die von `JR-1301` assertierte Zahl der drei
`mustFailClosed`-Fälle (F3) unverändert bleibt.

## F22 — F3s `$or`-Beispiel beschreibt die Wirkungsrichtung falsch

**Kategorie:** Vorgegebenes Verfahren · **Schwere:** niedrig, aber irreführend ·
**Ort:** F3 in diesem Dokument, sowie das Akzeptanzkriterium von `JR-1304` („der `$or`-Fall aus F3
erweitert die Disjunktion nicht mehr") · **Status:** **behoben** in `JR-1304` (`45ac0e9`), Beschreibung
am 2026-07-29 korrigiert (siehe unten) · **Herkunft:** `JR-1301`

`{ $or: [ {id:'a'}, {subject:{$regex:'x'}} ] }` ⇒ `"id" = $1`. Beide Texte nennen das eine
Erweiterung der Disjunktion. Gemessen ist `A` **enger** als `A or B`: der Nutzer sieht weniger
Zeilen, nicht mehr. Das ist ein Funktionsdefekt (die gespeicherte Policy bedeutet etwas anderes als
sie sagt), aber fail-**closed**.

Fail-open ist derselbe Mechanismus an zwei anderen Stellen: im `$and` negierter
`cannot`-Bedingungen — dort ist jeder weggelassene Zweig ein weggelassenes Verbot — und wenn **alle**
Zweige verschwinden, weil `or()`/`and()` über eine leere Liste `undefined` liefert.

**Warum das zählt:** wer `JR-1304` nach dem Kriterium abarbeitet, kann aus „erweitert die Disjunktion"
schließen, der `$or`-Fall sei der gefährliche und die Leerheits-Fälle Randfälle. Es ist umgekehrt.
**Empfehlung:** das Kriterium von `JR-1304` auf „lässt keinen Zweig stillschweigend weg" umformulieren.

### Korrektur 2026-07-29 — „im `$or` nur verengend" ist selbst zu grob

**Status:** **behoben** in `JR-1304` (`45ac0e9`); die Beschreibung hier war zweimal ungenau.

Der Abschnitt oben — und in seinem Gefolge die Fassung, die ich am 2026-07-29 in `JR-1304`s
Akzeptanzkriterium geschrieben habe („weder im `$or` (**dort verengend**, F22) …") — sagt, der `$or`-Fall
sei die harmlose Richtung. Das gilt nur, solange die Disjunktion **oben** in einer
`can`-Komposition steht. Unter einem `$not` kippt sie, und `FilterBuilder` setzt seit `JR-1305`
**jede** `cannot`-Bedingung genau dort hin (`FilterBuilder.ts:84`):

```ts
query = { $and: cannotConditions.map((condition) => ({ $not: condition })) };
```

Gemessen am Übersetzer vor `JR-1304` (`git show 45ac0e9^:…`, in einer Wegwerf-Kopie):

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
Herkunft der Messung: die Nacharbeit an `JR-1301` (`704e8d1`).

## F23 — `tsconfig.test.json` und `tsconfig.json` sind sich über globale Augmentierungen nicht einig

**Kategorie:** Testharness — unsere eigene E1-Arbeit · **Schwere:** niedrig ·
**Ort:** `packages/backend/tsconfig.test.json` · **Status:** in `JR-1301` umgangen, Ursache offen ·
**Herkunft:** `JR-1301`

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
**Status:** offen · **Herkunft:** `JR-1302`–`JR-1306` (Rolle DEV, 2026-07-29)

`acquireTestDatabase()` wird im **Modul-Scope** der Integrationsdateien aufgerufen, also beim Laden —
und das passiert **vor** der Auswertung des `-t`-Filters. Der Teardown einer Suite, deren Fälle der
Filter alle überspringt, läuft dagegen nicht. Ein gezielter Lauf wie
`pnpm test -t "RED UNTIL JR-1302"` legt daher `oa_test_*`-Datenbanken an und lässt sie liegen. Ein
**vollständiger** Lauf hinterlässt nachweislich 0.

Nicht gefährlich, aber irreführend: wer nach einem gefilterten Lauf auf Rückstände prüft, findet
welche und sucht den Fehler an der falschen Stelle. Dieselbe Wurzel wie **F16** (Wurf im Modul-Scope
nach `acquireTestDatabase()`) — der Erwerb liegt vor allem, was ihn absichern könnte.

**Gehört nach `JR-105c`**, das ohnehin die Messinstrument-Befunde F14–F16 zusammenfasst und **vor E2**
fällig ist. Umgehung bis dahin: nach einem gefilterten Lauf einmal vollständig laufen, oder
`sweepStaleHarnessDatabases()` von Hand aufrufen.

## F25 — Die Statusaussage „F4 **und F5** sind im Code als bewusst offen kommentiert" ist für F5 falsch

**Kategorie:** Doku über den eigenen Code · **Schwere:** niedrig ·
**Ort:** `06-status.md` („Bewusst nicht angefasst"), `07-session-handover.md` · **Status:** offen ·
**Herkunft:** Abnahme `JR-1309` (2026-07-29)

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
`JR-1309` gegen den Code prüfen sollte. Behebung: entweder den F5-Kommentar nachziehen oder die
Aussage in beiden Statusdateien auf F4 einschränken.

## F26 — Ein `can` mit **falsy**, aber vorhandenem `conditions` bedeutet weiter Vollzugriff

**Schwere:** mittel (Voraussetzung: Rollenschreibrecht, also Super Admin — dieselbe Vorbedingung wie
F1) · **Ort:** `packages/backend/src/services/FilterBuilder.ts:51–53`,
`packages/backend/src/iam-policy/policy-validator.ts:76` · **Status:** offen ·
**Herkunft:** Abnahme `JR-1309` (2026-07-29)

`JR-1302` hat **F19** behoben: ein `can` mit `conditions: {}` gilt nicht mehr als unbedingt. Die
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

**Bricht kein Akzeptanzkriterium von `JR-1302`** (dessen Kriterien nennen
`auditor-specific-mailbox.json` und den Nutzer ohne Rolle, beide erfüllt). Vorschlag: zusammen mit
`JR-1311` behandeln — dort wird `conditions` ohnehin schärfer geprüft. PO entscheidet über den Ort.

## F27 — Query 2 der Betreiberanleitung hat **falsch-negative**: `conditions` als Skalar oder Array wird nicht gefunden

**Kategorie:** veröffentlichte Betreiberdokumentation · **Schwere:** mittel ·
**Ort:** `docs/user-guides/upgrade-and-migration/access-control-changes.md`, Query 2 **und** Query 3,
jeweils die `cond`-CTE · **Status:** offen · **Herkunft:** Abnahme `JR-1309` (2026-07-29)

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
**Status:** offen · **Herkunft:** Abnahme `JR-1309` (2026-07-29)

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
`packages/backend/src/helpers/mongoToDrizzle.ts` `getDrizzleColumn()` · **Status:** offen ·
**Herkunft:** Abnahme `JR-1309` (2026-07-29)

Der Validator akzeptiert **beliebig viele** punktgetrennte Identifier-Segmente und **jede**
Relation; der Übersetzer akzeptiert höchstens zwei Segmente und nur Relationen aus
`relationToTableMap`. Gemessen, beide Gates auf demselben Key:

```
key="foo"                       validator=ACCEPT  mongoToDrizzle=TRANSLATED   (ADR-019-Restspalt, JR-1311)
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
2. **`JR-1306`s Akzeptanzkriterium** endet auf „Relationszweig ebenso; `PolicyValidator` weist solche
   Policies **beim Anlegen** ab". Für den Relationszweig und für Keys mit mehr als zwei Segmenten tut
   er das nicht.

**Nicht von ADR-019 gedeckt.** ADR-019 nimmt ausdrücklich nur die **Spaltenexistenz** aus (`foo`) und
begründet das damit, dass `mongoToDrizzle` subjektagnostisch ist. Die Relation kennt der Validator
dagegen genauso gut wie der Übersetzer — `relationToTableMap` ist eine Konstante. Behebung ist klein:
`areConditionKeysValid()` auf ≤ 2 Segmente und auf `relationToTableMap` prüfen, dann sind beide Gates
deckungsgleich und die Doku stimmt wieder.

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
