# Session-Handover

Diese Datei beantwortet genau eine Frage: **Was ist der nächste konkrete Schritt, und welche Dateien
betrifft er?** Sie wird am Ende jeder Session überschrieben (nicht angehängt — die Historie steht im
Sessionprotokoll in `06-status.md`).

---

## Aktueller Eintrag

**Stand:** 2026-07-27 · **Branch:** `claude/enterprise-product-implementation-cxmmqe`

### Was zuletzt passiert ist

Epic 0 abgeschlossen: Codebase-Analyse, Gap-Analyse gegen den RFC, Zielarchitektur, Backlog mit 101
Tasks über 12 Epics, Testplan, ADR-Log und die Agent-Infrastruktur (`CLAUDE.md`, Subagents
`senior-dev` und `tester`, Skills `journal-ledger`, `oa-migration`, `oa-i18n`).

**Kein Produktionscode** — so entschieden in ADR-001.

### Nächster konkreter Schritt

**`JR-101` — vitest im Monorepo einrichten.** Rolle: `TEST` (Subagent `tester`).

Vorher, in dieser Reihenfolge:

1. `pnpm install` — im Container fehlen die `node_modules` vollständig. Ohne sie läuft weder
   `pnpm lint` noch ein Build.
2. Prüfen, ob Postgres/Valkey/Meilisearch erreichbar sind (`docker-compose.yml`), denn `JR-104`
   braucht eine echte Datenbank.
3. **`JR-105a` erledigen, bevor `JR-105` beginnt.** Bereits geprüft: `pnpm lint` schlägt auf dem
   heutigen Bestand fehl (neun Dateien, Liste in `03-backlog.md` unter E1). Der CI-Job wäre sonst
   von der ersten Minute an rot. Vorher entscheiden, ob die fünf generierten
   `migrations/meta/*.json` formatiert oder in `.prettierignore` aufgenommen werden — sonst
   entsteht eine Endlosschleife zwischen `pnpm db:generate` und `pnpm format`.

Betroffene Dateien für `JR-101`:

- Root `package.json` — `test`-Script, `vitest` als devDependency
- `packages/backend/package.json`, `packages/types/package.json` — je ein `test`-Script
- neue vitest-Konfiguration auf Root- und Paketebene
- **kein** bestehender Produktionscode

Danach `JR-102` … `JR-106` gemäß `03-backlog.md`.

### Was ein neuer Agent zuerst lesen muss

1. `docs/dev/journaling/README.md` — Einstieg und Lesereihenfolge
2. `docs/dev/journaling/06-status.md` — verbindlicher Stand
3. diese Datei
4. `CLAUDE.md` — Repo-Konventionen und Fallstricke
5. Für die eigentliche Task: `03-backlog.md` (Akzeptanzkriterien) und `02-architektur.md`

### Offene Fragen an den Auftraggeber

Keine blockierenden. Die folgenden Punkte werden zum jeweiligen Epic zur Entscheidung vorgelegt und
sind in `05-entscheidungen.md` als offene ADRs geführt:

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
