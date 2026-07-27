# Status

**Diese Datei ist die verbindliche Fortschrittsquelle.** Sie wird am Ende **jeder** Session
aktualisiert — auch wenn nichts fertig wurde. Ein nicht aktualisierter Status ist schlimmer als
keiner, weil er Fortschritt behauptet, der nicht existiert.

Legende: `[ ]` offen · `[~]` in Arbeit · `[x]` fertig und abgenommen · `[!]` blockiert

**Letzte Aktualisierung:** 2026-07-27 · **Branch:** `claude/journaling-e1-test-foundation`

---

## Gesamtübersicht

| Epic | Titel                              | Status     | Fertig / Gesamt |
| ---- | ---------------------------------- | ---------- | --------------- |
| E0   | Planung, Doku, Agent-Infrastruktur | **fertig** | 6 / 6           |
| E1   | Test- und CI-Fundament             | in Arbeit  | 1 / 7           |
| E2   | Ledger und Hash-Chain              | offen      | 0 / 10          |
| E3   | Spool und Acceptance-Contract      | offen      | 0 / 8           |
| E4   | `smtp-ingress`-Service             | offen      | 0 / 13          |
| E5   | Journal-Report-Parser              | offen      | 0 / 9           |
| E6   | Phase-B-Worker                     | offen      | 0 / 8           |
| E7   | WORM-Storage                       | offen      | 0 / 6           |
| E8   | Anchoring                          | offen      | 0 / 6           |
| E9   | `verify`-CLI                       | offen      | 0 / 8           |
| E10  | Completeness-Monitoring            | offen      | 0 / 8           |
| E11  | Compliance-Features                | offen      | 0 / 10          |
| E12  | Rollout und Dokumentation          | offen      | 0 / 9           |

**Produktionscode für den Receiver: keiner.** E0 hat ausschließlich Dokumentation und
Agent-Infrastruktur geliefert (ADR-001).

---

## E0 — Planung, Doku, Agent-Infrastruktur (fertig)

|     | Ergebnis                                                              | Datei                     |
| --- | --------------------------------------------------------------------- | ------------------------- |
| [x] | Codebase-Analyse und Gap-Analyse gegen den RFC                        | `01-gap-analyse.md`       |
| [x] | Zielarchitektur inkl. Prozess- und Credential-Topologie               | `02-architektur.md`       |
| [x] | Backlog E1–E12 mit 102 Tasks, Rollen, Akzeptanzkriterien              | `03-backlog.md`           |
| [x] | Testplan mit RFC-§12-Mapping und CI/Nightly/Manual-Einteilung         | `04-testplan.md`          |
| [x] | ADR-Log: 7 entschieden, 6 offen, 1 verworfen                          | `05-entscheidungen.md`    |
| [x] | Agent-Infrastruktur: `CLAUDE.md`, 2 Subagent-Rollen, 3 Projekt-Skills | `CLAUDE.md`, `.claude/**` |

### Zentrale Befunde aus E0

1. **Der Enterprise-SMTP-Listener ist Closed Source und in diesem Repository nicht vorhanden.** Nur
   Schema, Typen, Frontend-Formular, i18n-Strings, Env-Variablen und eine Doku-Seite, die abwesenden
   Code beschreibt. `apps/open-archiver-enterprise` und `packages/enterprise` fehlen.
2. **Der dokumentierte Enterprise-Ablauf erfüllt RFC §3 nicht** (Tempfile + BullMQ-Enqueue statt
   fsync'd Spool + Ledger vor `250`). Der Receiver wird daher direkt RFC-konform neu gebaut.
3. **Null Tests und kein Test-Runner im gesamten Repository.** Deshalb ist E1 das erste Epic.
4. **Doku-Drift im IAM:** `docs/services/iam-service/iam-policy.md` listet die Action `export` nicht
   und beschreibt `manage` falsch. Der **Code ist korrekt** — `iam.types.ts` und
   `iam-policy/policy-validator.ts` enthalten beide `export`. Behebung in `JR-1103`.
5. Kein CLI im Repository — `verify` (E9) baut die Basis mit `node:util` `parseArgs`, ohne neue
   Dependency.
6. **ADR-004 war falsch und hätte die internen Dokumente veröffentlicht.** VitePress baut ohne
   `srcExclude` jede `.md` unter `docs/` zu einer Seite, und `search.provider: 'local'` indexiert
   sie — die Sidebar hat damit nichts zu tun. Behoben durch `srcExclude: ['dev/**']` in
   `docs/.vitepress/config.mts`. Nie wirksam geworden, weil nichts auf `main` liegt.
   **Nachweis erbracht:** `pnpm docs:build` läuft durch, `dist/dev/` existiert nicht, kein Satz aus
   `08-risiken.md` im Suchindex; Gegenkontrolle über `dist/SUMMARY.html` (nicht in der Sidebar, aber
   30 KB gebaut und indexiert) belegt den Mechanismus.

---

## E1 — Test- und CI-Fundament (in Arbeit)

|     | Task                                                                           | Rolle |
| --- | ------------------------------------------------------------------------------ | ----- |
| [ ] | JR-101 vitest im Monorepo einrichten                                           | TEST  |
| [ ] | JR-102 Testkonventionen festlegen und dokumentieren                            | TEST  |
| [ ] | JR-103 Unit-Tests auf `PolicyValidator` / `createAbilityFor` / `FilterBuilder` | TEST  |
| [ ] | JR-104 Integrationstest-Basis mit isolierter Postgres-Instanz                  | TEST  |
| [x] | JR-105a Formatierungs-Commit (`pnpm format`) — **Vorbedingung für JR-105**     | DEV   |
| [ ] | JR-105 CI-Workflow: Lint, Build, `svelte-check`, Tests                         | DEV   |
| [ ] | JR-106 Abnahme E1                                                              | PO    |

**`JR-105a` erledigt (2026-07-27).** `pnpm lint` ist repo-weit grün, inklusive `.svelte`. Von den 13
beanstandeten Dateien wurden die **7 handgeschriebenen** formatiert (1 `.md`, 3 `.ts`, 3 `.svelte`);
die **6 generierten** gingen laut **ADR-015** in `.prettierignore` statt in den Commit, weil beide
Generatoren empirisch belegt mit `JSON.stringify(…, null, 2)` zurückschreiben und jede Formatierung
sofort überschreiben. Gegenprobe: nach `docs:gen-spec` **und** einem erzwungenen
`drizzle-kit generate` bleibt `pnpm lint` grün — das Akzeptanzkriterium ist damit erfüllt.

Nachweise: `pnpm lint` grün · `pnpm --filter @open-archiver/frontend check` 0 Fehler / 0 Warnungen ·
`pnpm --filter @open-archiver/backend build` erfolgreich · Token-Stream-Vergleich der drei `.ts`-Dateien
vor/nach Formatierung identisch (nur Whitespace, Quotes, `es5`-Trailing-Commas), Diffs der drei
`.svelte`-Dateien und der `.md`-Tabelle manuell geprüft — keine Logikänderung.

Einschränkung: `pnpm db:generate` ist im Container nicht lauffähig (kein `DATABASE_URL`, keine `.env`,
kein Postgres). Der drizzle-Nachweis lief über einen direkten `drizzle-kit generate`-Aufruf mit
Dummy-`DATABASE_URL`; Details und Bewertung in ADR-015.

Formal offen: die Abnahme von `JR-105a` gehört zu `JR-106` (Rolle PO).

---

## E2 – E12 (offen)

Tasklisten stehen in `03-backlog.md`. Sie werden hier erst beim Beginn des jeweiligen Epics
ausgerollt, um diese Datei lesbar zu halten.

Offene ADRs, die vor bzw. während der Epics zu entscheiden sind:

| ADR     | Thema                                                 | Epic          |
| ------- | ----------------------------------------------------- | ------------- |
| ADR-006 | Kanonische Kodierung, Genesis-String, `deployment_id` | E2 (`JR-203`) |
| ADR-007 | Lock-Key-Strategie, Mehrmandantenfähigkeit            | E2            |
| ADR-009 | Append-Only-Erzwingung: Rechteentzug oder Trigger     | E2 (`JR-205`) |
| ADR-010 | `processEmail` erweitern oder eigener Journaling-Pfad | E6 (`JR-602`) |
| ADR-008 | TSA-Ausfallverhalten bestätigen                       | E8 (`JR-804`) |
| ADR-012 | Migrationspfad für Bestandsinstallationen             | E12           |

---

## Sessionprotokoll

| Datum      | Ergebnis                                                                                                                                                                                                                                                    | Nächster Schritt                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 2026-07-27 | E0 abgeschlossen: Gap-Analyse, Architektur, Backlog (102 Tasks), Testplan, ADR-Log, `CLAUDE.md`, 2 Subagents, 3 Skills. Kein Produktionscode (ADR-001).                                                                                                     | E1 starten mit `JR-101`                                         |
| 2026-07-27 | Nachtrag: ADR-004 als falsch korrigiert und Veröffentlichungs-Leck via `srcExclude` geschlossen; ADR-014 (Branch-Strategie) ergänzt; `CLAUDE.md` §7 und Handover um Sessionstart-Anleitung erweitert. Build-Nachweis offen (kein `pnpm install` möglich).   | `claude/journaling-e1-test-foundation` abzweigen, dann `JR-101` |
| 2026-07-27 | `JR-105a` erledigt auf `claude/journaling-e1-test-foundation`: 7 handgeschriebene Dateien formatiert, 6 generierte per ADR-015 in `.prettierignore`. `pnpm lint` repo-weit grün und bleibt es nach beiden Generatorläufen. Kein Push (sammelt bis Ende E1). | `JR-101` (vitest einrichten), danach `JR-105` (CI-Workflow)     |
