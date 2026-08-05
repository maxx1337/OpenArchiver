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

| #     | Datei                        | Inhalt                                                                    | Wann lesen                                 |
| ----- | ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| —     | `README.md`                  | dieses Dokument                                                           | immer zuerst                               |
| 00    | `00-rfc.md`                  | Der RFC im Original (EN), **byteidentisch** (in `.prettierignore`)        | vor jeder Design-Entscheidung              |
| 01    | `01-gap-analyse.md`          | Ist-Zustand der Codebase vs. RFC-Forderungen                              | einmal, dann bei Bedarf                    |
| 02    | `02-architektur.md`          | Zielarchitektur, Prozess- und Credential-Topologie, Ledger-Design         | vor Implementierungsarbeit                 |
| 03    | `03-backlog.md`              | Epics E1–E12 mit Tasks, Akzeptanzkriterien, Abhängigkeiten                | vor jeder Task                             |
| 04    | `04-testplan.md`             | RFC §12 → konkrete Testfälle, Einteilung CI/Nightly/manuell               | vor Testarbeit                             |
| 05    | `05-entscheidungen.md`       | ADR-Log: getroffene und bewusst offene Entscheidungen                     | bei Design-Konflikten                      |
| 06    | `06-status.md`               | Fortschritt je Epic und Task                                              | **immer zuerst nach diesem README**        |
| 07    | `07-session-handover.md`     | Was ist der nächste konkrete Schritt                                      | am Anfang und Ende jeder Session           |
| 08    | `08-risiken.md`              | Risiken mit Gegenmaßnahme                                                 | bei Planungsänderungen                     |
| 09    | `09-befunde-bestandscode.md` | Defekte im **vorhandenen** Code, außerhalb des RFC-Scopes                 | bevor man einen davon „nebenbei" behebt    |
| 10    | `10-upstream-meldung.md`     | **Entwurf** der Upstream-Sicherheitsmeldung — **nicht versendet**         | nur wenn der Auftraggeber sie versendet    |
| 11    | `11-archiv-e1.md`            | Protokoll des abgenommenen Epics E1, unverändert ausgegliedert            | nur bei Fragen zur E1-Historie             |
| 15    | `15-fallstricke.md`          | Die 34 Fallstricke, die Zeit gekostet haben — **Referenz, nicht Lektüre** | wenn ein Werkzeug sich unerwartet verhält  |
| 16    | `16-abnahme-e4.md`           | Abnahmeprotokoll E4 (`JR-4-13`): Kriterium → Beleg → Urteil               | nur bei Fragen zur E4-Abnahme              |
| 17    | `17-parallelbetrieb.md`      | Regeln für zwei gleichzeitig laufende Sessions                            | **sobald eine zweite Session läuft**       |
| 18    | `18-archiv-e4-e5.md`         | Protokolle der abgenommenen Epics E4 und E5                               | nur für Historie, nie für die nächste Task |
| 11–14 | Archivdateien                | Protokolle und Task-Tabellen der **abgenommenen** Epics (E1, E13, E2, E3) | nur für Historie, nie für die nächste Task |

> **`17-parallelbetrieb.md` hieß bis zum Rückmerge von E4 `12-parallelbetrieb.md`.** Sie kollidierte
> mit `12-archiv-e13-e2.md` aus der Diät vom 2026-08-03 — beide Nummern waren parallel auf zwei
> Zweigen vergeben worden. Umbenannt statt umnummeriert, weil die Archivdateien 12–14 ein
> zusammenhängender Satz sind. Die Regel dahinter steht in **ADR-032**.

> **Am 2026-08-03 ist dieses Verzeichnis auf Diät gesetzt worden** (Entscheidung des Auftraggebers
> nach einer Kostenprüfung): die Pflichtlektüre war auf rund **170 000 Tokens** gewachsen, allein
> `06-status.md` auf 105 000. **Inhaltlich ist nichts gekürzt** — Protokolle und Task-Tabellen der
> abgenommenen Epics stehen unverändert in `11-archiv-e1.md`, `12-archiv-e13-e2.md`,
> `13-archiv-sessionprotokoll-bis-e3.md` und `14-archiv-backlog-abgeschlossen.md`, die Fallstricke in
> `15-fallstricke.md`. Was hier bleibt, ist das, was für die **nächste Task** gebraucht wird.
>
> **Zwei Regeln, damit es so bleibt:** ein Statuseintrag ist ab jetzt **Feldstruktur, nicht Prosa**
> (Task, Commit, Testzahl, CI-Lauf, Entscheidungen, offen) — die bestehenden Prosaeinträge sind der
> Grund, warum eine einzelne Protokollzeile bis zu 8 531 Zeichen lang war. Und das Protokoll eines
> Epics wandert ins Archiv, **sobald** das Epic zurückgemergt ist, nicht irgendwann später.

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

## Aktueller Stand

**Verbindlich ist `06-status.md`, und nur diese Datei.** Dieser Abschnitt hat bis zum 2026-08-03 eine
zehntausend Zeichen lange Zweitfassung des Status geführt — sie war zuletzt auf dem Stand von E2/E3
stehen geblieben, während der Status längst E4 beschrieb. **Eine doppelt geführte Wahrheit ist die
verlässlichste Quelle für Widersprüche**, und genau das ist am 2026-07-28 schon einmal passiert.
Deshalb steht hier nur noch das Gerüst:

| Epic   | Stand                                                                          |
| ------ | ------------------------------------------------------------------------------ |
| E0     | fertig — Planung, Architektur, Backlog, Testplan, ADR-Log, Agent-Infrastruktur |
| E1     | **abgenommen + gemergt** — vitest mit drei Projects, CI gegen PostgreSQL 17    |
| E13    | **abgenommen + gemergt** — IAM-Autorisierung gehärtet (vier Abnahmerunden)     |
| E2     | **abgenommen + gemergt** — Ledger, kanonische Kodierung, Merkle, Hash-Kette    |
| E3     | **abgenommen + gemergt** — Spool und Acceptance-Contract                       |
| **E4** | **abgenommen** (`JR-4-13`) — `smtp-ingress`; Rückmerge offen                   |
| E5–E12 | offen                                                                          |

**Was E4 heute kann:** ESMTP mit `PIPELINING`, `8BITMIME`, `SMTPUTF8`, `SIZE`, `CHUNKING`/`BDAT`,
`STARTTLS` und `AUTH`; Quell- und Empfänger-ACL gegen `journaling_sources`; Crash-Recovery-Scan beim
Start; und `250 … queued as <seq>` **erst** nach fsync von Spool **und** Ledger. **Seit dem 2026-08-04
ist E4 abgenommen** (`JR-4-13`, unabhängige TEST-Sitzung, Protokoll `16-abnahme-e4.md`); offen ist nur
noch der Rückmerge in den Integrationsbranch.

**Wo der nächste Schritt steht:** `07-session-handover.md`. **Wo die Entscheidungen stehen:**
`05-entscheidungen.md` — für E4 sind das **ADR-029** (der SMTP-Server ist selbst gebaut, weil kein
Node-Paket `BDAT` beherrscht und Nachrichten mit bare line feeds sonst nie ankommen) und **ADR-030**
(eine Transaktion bleibt genau einer Kette zugeordnet).

## Branch

`claude/enterprise-product-implementation-cxmmqe` ist **Integrationsbranch**, kein Arbeitsbranch.
Jedes Epic bekommt einen eigenen Zweig davon (`claude/journaling-e<N>-<kurzname>`), Rückmerge erst
nach unabhängiger Abnahme. `main` wird bis zur Abnahme von E12 nicht angefasst. Kein Pull Request
ohne ausdrückliche Aufforderung. Vollständige Regeln: **ADR-014** in `05-entscheidungen.md`.
