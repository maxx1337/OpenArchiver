# SMTP Journaling Receiver — Projektgedächtnis

**Diese Verzeichnis ist die Quelle der Wahrheit für das Projekt.** Es existiert, damit keine Session
den Kontext neu aufbauen muss. Wer hier anfängt zu arbeiten, liest zuerst diese Datei, dann
`06-status.md`, dann `07-session-handover.md`.

> Diese Dokumente sind **absichtlich nicht** in `docs/.vitepress/config.mts` registriert und werden
> daher nicht auf die öffentliche Doku-Website publiziert. Sie sind interne Projektunterlagen.
> Planungsdokumente sind auf Deutsch, `CLAUDE.md`/Skills/Code/Commits auf Englisch.

---

## Worum es geht

Open Archiver ingestiert heute ausschließlich per **Pull** (IMAP, Microsoft Graph, PST/EML-Import).
Für Compliance-Archivierung ist das strukturell defekt: Was ein Nutzer zwischen Zustellung und
nächstem Sync hart löscht, wird nie archiviert — und die Lücke ist nicht nachweisbar.
Vollständigkeit lässt sich nur auf **Transportebene** garantieren, bevor ein Postfachnutzer die
Nachricht anfassen kann. Das Standardverfahren dafür ist **Journaling**.

Zweiter, konkreter Grund: **Exchange Online kann Journal-Reports nicht an ein Exchange-Online-Postfach
ausliefern.** Das Ziel muss ein externes, per SMTP erreichbares Archivsystem sein. Ohne
SMTP-Receiver ist Open Archiver damit für die Mehrheit der adressierbaren Nutzerbasis kein
gültiges Journaling-Ziel.

Ziel des Projekts: ein SMTP-Receiver mit **beweisbarer** Vollständigkeit und Manipulationserkennung
statt behaupteter Vollständigkeit — belastbar gegenüber GoBD / §147 AO / §257 HGB (und vergleichbar
SEC 17a-4, FINRA 4511, MiFID II).

## Lesereihenfolge

| #   | Datei                        | Inhalt                                                             | Wann lesen                              |
| --- | ---------------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| —   | `README.md`                  | dieses Dokument                                                    | immer zuerst                            |
| 00  | `00-rfc.md`                  | Der RFC im Original (EN), **byteidentisch** (in `.prettierignore`) | vor jeder Design-Entscheidung           |
| 01  | `01-gap-analyse.md`          | Ist-Zustand der Codebase vs. RFC-Forderungen                       | einmal, dann bei Bedarf                 |
| 02  | `02-architektur.md`          | Zielarchitektur, Prozess- und Credential-Topologie, Ledger-Design  | vor Implementierungsarbeit              |
| 03  | `03-backlog.md`              | Epics E1–E12 mit Tasks, Akzeptanzkriterien, Abhängigkeiten         | vor jeder Task                          |
| 04  | `04-testplan.md`             | RFC §12 → konkrete Testfälle, Einteilung CI/Nightly/manuell        | vor Testarbeit                          |
| 05  | `05-entscheidungen.md`       | ADR-Log: getroffene und bewusst offene Entscheidungen              | bei Design-Konflikten                   |
| 06  | `06-status.md`               | Fortschritt je Epic und Task                                       | **immer zuerst nach diesem README**     |
| 07  | `07-session-handover.md`     | Was ist der nächste konkrete Schritt                               | am Anfang und Ende jeder Session        |
| 08  | `08-risiken.md`              | Risiken mit Gegenmaßnahme                                          | bei Planungsänderungen                  |
| 09  | `09-befunde-bestandscode.md` | Defekte im **vorhandenen** Code, außerhalb des RFC-Scopes          | bevor man einen davon „nebenbei" behebt |

## Team und Rollen

| Rolle                | Umsetzung                                    | Zuständig für                                          |
| -------------------- | -------------------------------------------- | ------------------------------------------------------ |
| **Product Owner**    | Hauptthread (delegiert, implementiert nicht) | Backlog-Priorisierung, RFC-Abnahme, ADRs, Statuspflege |
| **Senior Developer** | Subagent `.claude/agents/senior-dev.md`      | Implementierung, Migrationen, Repo-Konventionen        |
| **Tester**           | Subagent `.claude/agents/tester.md`          | Test-Harness, adversariale Tests, unabhängige Abnahme  |

Der PO implementiert nicht selbst. Tasks werden mit Verweis auf die Task-ID aus `03-backlog.md`
delegiert; die Rolle steht dort in der Spalte „Rolle".

## Projekt-Skills

Diese Skills kapseln Wissen, das sonst in jeder Session neu erklärt werden müsste:

| Skill            | Wann er greift                                                                          |
| ---------------- | --------------------------------------------------------------------------------------- |
| `journal-ledger` | Empfangspfad, Spool, Ledger, Chain-Hashing, Anchoring, Crash-Recovery, SMTP-Statuscodes |
| `oa-migration`   | jede Schema-/Migrationsänderung (Drizzle)                                               |
| `oa-i18n`        | jeder neue nutzersichtbare String (2 Systeme × 11 Sprachen)                             |

Zusätzlich nutzbar aus dem Bestand: `doc-coauthoring` (Spec-Dokumente), `simplify`,
`security-review`, `review`, `run`, `skill-creator`, sowie `docx`/`pdf`/`xlsx` für
Auditor-Artefakte ab E9/E11.

## Zentrale Randbedingungen (nicht verhandelbar)

1. **`250 OK` erst nach fsync von Spool _und_ Ledger.** Der Acceptance-Contract (RFC §3) ist der
   Kern des Projekts. Details im Skill `journal-ledger`.
2. **Lokale Fehler ⇒ `4xx`, nie `5xx`.** Ein `5xx` erzeugt beim Sender einen NDR und verwirft die
   Nachricht endgültig.
3. **Empfangene Bytes werden nie transformiert.** Das Archivobjekt ist das Wire-Format.
4. **Parse-Fehler werden geloggt und archiviert, nicht abgelehnt.**
5. **Kein Catch-all-Empfänger, kein Relaying.**
6. **Keine Compliance-Behauptung.** Zulässig ist ausschließlich die Formulierung aus RFC §13.

## Aktueller Stand (Kurzfassung)

Epic 0 (Planung, Doku, Agent-Infrastruktur) ist abgeschlossen. **E1 ist abgenommen** (`JR-106a`,
2026-07-28) und in den Integrationsbranch gemergt: vitest mit drei Projects, CI gegen PostgreSQL 17,
`pnpm lint` repo-weit sauber. Eine Nacharbeit ist offen (`JR-105c` für F14–F16, fällig vor E2).

**E13 (IAM-Autorisierung härten) läuft** auf `claude/journaling-e13-iam-hardening`. `JR-1301` hat die
Regressionstests für F1/F3/F7/F8 auf den gewünschten Zustand umgestellt (21 rot), die fünf Fix-Tasks
`JR-1303`, `JR-1302`, `JR-1304`, `JR-1305`, `JR-1306` sind erledigt: **20 der 21 Tests sind grün, kein
vorher grüner Test ist rot geworden**, F1/F3/F7/F8 sowie F19/F20 sind behoben. Ein Test bleibt rot —
zwei `JR-1301`-Tests fordern für dieselbe Eingabe Gegenteiliges; das ist eine Entscheidung des PO und
keine offene Lücke (Vorlage in `06-status.md`). Nächster Schritt: `JR-1307` (Rolle DEV). Es existiert
noch **kein** Produktionscode für den Receiver selbst.

Verbindlich ist immer `06-status.md`, nicht dieser Abschnitt.

## Branch

`claude/enterprise-product-implementation-cxmmqe` ist **Integrationsbranch**, kein Arbeitsbranch.
Jedes Epic bekommt einen eigenen Zweig davon (`claude/journaling-e<N>-<kurzname>`), Rückmerge erst
nach unabhängiger Abnahme. `main` wird bis zur Abnahme von E12 nicht angefasst. Kein Pull Request
ohne ausdrückliche Aufforderung. Vollständige Regeln: **ADR-014** in `05-entscheidungen.md`.
