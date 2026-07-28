# Session-Handover

Diese Datei beantwortet zwei Fragen: **wie startet man eine Session**, und **was ist der nächste
konkrete Schritt?** Der untere Teil wird am Ende jeder Session überschrieben (nicht angehängt — die
Historie steht im Sessionprotokoll in `06-status.md`).

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

1. **`pnpm install`** — der Container ist flüchtig, `node_modules` fehlt in jeder neuen Session.
   Ohne das läuft weder `pnpm lint` noch ein Build noch `pnpm test`.
2. **Auf den richtigen Branch wechseln.** Epic-Arbeit läuft nie direkt auf dem Integrationsbranch:

    ```bash
    git fetch origin claude/enterprise-product-implementation-cxmmqe
    git checkout -b claude/journaling-e<N>-<kurzname> \
        origin/claude/enterprise-product-implementation-cxmmqe
    ```

    Regeln in `05-entscheidungen.md` (ADR-014) und `CLAUDE.md` §7. Grundlagenarbeit (Doku, ADRs,
    Agent-Infrastruktur) gehört direkt auf den Integrationsbranch.

---

## Aktueller Eintrag

**Stand:** 2026-07-28 (nach Abnahme `JR-106`) · **Branch:** `claude/journaling-e1-test-foundation`

### Was zuletzt passiert ist

**E1 ist gebaut, aber nicht abgenommen.** Die unabhängige Abnahme `JR-106` (Rolle `tester`) lief am
2026-07-28 vollständig durch und hat 15 Akzeptanzkriterien einzeln geprüft:

- **abgenommen:** `JR-101` (vitest, drei Projects), `JR-102` (Konventionen, Klassifizierung, Seeds,
  Coverage-Hinweise), `JR-103` (146 Testfälle, alle acht IAM-Fixtures nachweislich von der Platte
  geladen), `JR-105a` (Formatierung mechanisch als reine Prettier-Ausgabe belegt), `JR-105`
  (CI-Workflow, Lauf auf HEAD grün gegen PostgreSQL 17.10, bestehende vier Workflows byteidentisch,
  kein schreibender Schritt).
- **abgelehnt:** `JR-104`. Neuer Befund **F12** in `09-befunde-bestandscode.md`: der Testfall
  `sweeps a stale database from a dead run…` legt seine Fixture-Datenbank unter dem **festen** Namen
  `oa_test_1609459200000_999999_deadaa_sweeptest` an. Zwei gleichzeitige Integrationsläufe gegen
  dasselbe Postgres kollidieren dadurch reproduzierbar (4 von 4) mit
  `duplicate key … pg_database_datname_index`. Damit bricht das Kriterium „zwei Integrationstests
  parallel, ohne sich zu beeinflussen" in der prozessübergreifenden Lesart, und der bisher dafür
  geführte Nachweis in `06-status.md` ist widerlegt. **Die CI ist nicht betroffen** (ein Lauf je Job,
  eigener Service-Container) und weiterhin grün.

Nebenbei aus der Abnahme: `pnpm db:generate` ist im Container **doch** lauffähig, sobald
`DATABASE_URL` gesetzt ist — die Restlücke aus ADR-015 ist damit geschlossen. Und zwei Lücken der
CI-Nachlaufprüfung 1 sind belegt: sie erkennt eine _übersprungene_, nicht eine _abwesende_
`integration`-Suite, und eine Datei in `tests/integration/` mit der Endung `*.test.ts` statt
`*.int.test.ts` wird von **keinem** Project eingesammelt und bleibt trotzdem grün.

**Kein Produktionscode geändert, kein Befund F1–F12 behoben.** Das ist E13-Arbeit.

### Nächster konkreter Schritt

**`JR-1301` — Epic E13 (IAM-Autorisierung härten).** Rolle: `DEV` (Subagent `senior-dev`).
Branch: `claude/journaling-e13-iam-hardening`, abgezweigt vom **Integrationsbranch**:

```bash
git fetch origin claude/enterprise-product-implementation-cxmmqe
git checkout -b claude/journaling-e13-iam-hardening \
    origin/claude/enterprise-product-implementation-cxmmqe
```

Vorher, in dieser Reihenfolge:

1. `pnpm install` (siehe „Immer zuerst" oben).
2. **Entscheidung des Auftraggebers zu F12 einholen.** Zwei Wege: (a) F12 als kleine Nacharbeit an
   `JR-104` vorziehen (Fixture-Namen aus `process.pid` + Zufallssuffix bilden, Sweeper-Aufruf im Test
   auf ein eigenes Label einschränken), danach prozessübergreifende Parallelität **mehrfach** neu
   belegen und E1 abnehmen; oder (b) F12 bewusst als Harness-Einschränkung akzeptieren und im
   Testplan festhalten, dass parallele Läufe gegen dasselbe Postgres nicht unterstützt sind.
   Empfehlung des Testers: (a) — der Aufwand ist gering und der Harness ist die Grundlage jeder
   Durability-Aussage in E2/E3.
3. Der Rückmerge von `claude/journaling-e1-test-foundation` in den Integrationsbranch liegt beim
   Auftraggeber und ist noch nicht erfolgt.

E13 hängt an E1, nicht an der Abnahme von E1 im formalen Sinn — der Harness ist benutzbar und
`FilterBuilder` ist über `tests/integration/filter-builder.int.test.ts` abgedeckt, was `JR-1301` als
Regressionsnetz braucht. F12 betrifft nur den **gleichzeitigen** Doppellauf.

Danach `JR-1302` … `JR-1309` gemäß `03-backlog.md`. **F7** ist der Grund, warum E13 vor E2 steht und
warum E11 ohne E13 nicht abnehmbar ist.

### Was ein neuer Agent zuerst lesen muss

1. `docs/dev/journaling/README.md` — Einstieg und Lesereihenfolge
2. `docs/dev/journaling/06-status.md` — verbindlicher Stand
3. diese Datei
4. `CLAUDE.md` — Repo-Konventionen und Fallstricke
5. Für die eigentliche Task: `03-backlog.md` (Akzeptanzkriterien) und `02-architektur.md`

### Offene Fragen an den Auftraggeber

**Blockierend für die Abnahme von E1:**

| Punkt   | Frage                                                                                                                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F12** | Nacharbeiten (Fixture-Namen prozessspezifisch machen) und E1 danach abnehmen, oder die Einschränkung „keine parallelen Läufe gegen dasselbe Postgres" bewusst akzeptieren und im Testplan festhalten? |

**Nicht blockierend, aber entscheidungsbedürftig:**

| Punkt                                     | Sachstand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Zwei offene Pull Requests nach `main`** | **PR #1** (`claude/enterprise-product-implementation-cxmmqe` → `main`) und **PR #2** (`claude/journaling-e1-test-foundation` → `main`) sind offen. Beide **widersprechen ADR-014**: `main` wird bis zur Abnahme von E12 nicht angefasst, und Epic-Branches mergen in den Integrationsbranch, nicht nach `main`. Nebenwirkung: jeder Push löst seitdem **zwei** CI-Läufe aus (`push` und `pull_request` auf demselben SHA) und verdoppelt die Laufzeitkosten. **Die Entscheidung liegt beim Auftraggeber. Kein Agent schließt oder merged sie eigenmächtig.** |
| **Rückmerge E1**                          | `claude/journaling-e1-test-foundation` ist nach `origin` gepusht, aber nicht in den Integrationsbranch gemergt. Der Merge ist Sache des Auftraggebers und sollte auf die F12-Entscheidung warten.                                                                                                                                                                                                                                                                                                                                                            |

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
3. **Die IAM-Doku ist stale, nicht der Code.** `docs/services/iam-service/iam-policy.md` listet die
   Action `export` nicht; `iam.types.ts` und `policy-validator.ts` enthalten sie beide. Wer der Doku
   glaubt, „fixt" einen Bug, der nicht existiert.
4. **Neue Drizzle-Schema-Dateien müssen in den Barrel** `packages/backend/src/database/schema.ts`.
   Sonst meldet `pnpm db:generate` „keine Änderungen" und man sucht lange.
5. **Backend-i18n-Strings brauchen einen Rebuild**, um im Container zu erscheinen: der
   `copy-assets`-Buildschritt kopiert `src/locales` nach `dist/locales`. Im Dev-Modus funktioniert es
   sofort, in Produktion erst nach `build`.
6. **Eine grüne Testsuite kann eine abgeschaltete Testsuite sein.** Ohne `DATABASE_URL` endet
   `pnpm test` mit Exit **0** bei „149 passed | 34 skipped". Deshalb hat `ci.yml` eine Nachlaufprüfung,
   die genau diesen Fall rot macht. Wer einen grünen Lauf als Beleg zitiert, muss die Testzahl
   mitzitieren — 181 ist vollständig, 149 nicht.
7. **Lokale Build-Artefakte verdecken Fehler, die CI findet.** `packages/types/dist` und
   `packages/*/tsconfig.tsbuildinfo` sind gitignoriert und liegen im Container aus früheren Sessions
   vor. Für jede Aussage über einen frischen Checkout müssen **beide** gelöscht werden — wegen
   `composite: true` emittiert `tsc` sonst nichts (F11).
8. **PostgreSQL lokal starten geht auch ohne Docker**: `/usr/lib/postgresql/16/bin/{initdb,pg_ctl}`,
   aber **nicht als `root`** (`su postgres`) und mit einem **kurzen** `unix_socket_directories` —
   der Scratchpad-Pfad überschreitet die 107-Byte-Grenze für Unix-Sockets. Cluster danach entfernen.
   Achtung: lokal ist es 16.13, die CI fährt 17.10.

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
