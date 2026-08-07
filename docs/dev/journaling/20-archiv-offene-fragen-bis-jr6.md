# Archiv: beantwortete Fragen an den Auftraggeber (bis E6)

**Ausgegliedert am 2026-08-06 aus `07-session-handover.md`** (Doku-Diät, inhaltlich unverändert). Diese
Fragen sind **beantwortet, entschieden oder erledigt** — sie stehen hier, damit die Entscheidungen und
ihre Begründungen nicht verloren gehen, ohne die aktuell noch offenen Fragen (die weiterhin in
`07-session-handover.md` unter „Offene Fragen an den Auftraggeber" stehen) zu verdecken.

---

**Beantwortet und nicht mehr offen:** die Rückfrage des Auftraggebers vom 2026-08-03, ob statt des
Eigenbaus eine fertige SMTP-Bibliothek (`smtp-server`) genommen werden sollte. Geprüft, verneint, und
der **Nachtrag in `ADR-029`** hält sowohl das Ergebnis als auch die Aufwandsrechnung fest — inklusive
der Korrektur, dass die Begründung im RFC („Exchange Online uses BDAT. Not optional.") **nicht** trug
und durch die Bare-LF-Begründung ersetzt ist. Wer die Frage erneut stellt, findet dort beide
Rechnungen.

> **~~Der Rückmerge von E2~~ — freigegeben und am 2026-08-01 vollzogen** (`eb340a9`, `--no-ff`, kein
> Squash). Die Bedingung aus ADR-014 war mit `JR-2-10a` erfüllt (24/24, frische Sitzung). Kein
> Entscheidungsbedarf mehr; der nächste Schritt ist **E3**.
>
> **Offen und wirklich beim Auftraggeber: `F39`** (niedrig, Testharness) — beheben oder bewusst
> akzeptieren? Der
> Test „is length-prefixed…" bleibt grün, wenn man das Längenpräfix entfernt; gefangen wird die
> Mutation nur vom Golden-File. Kein Produktdefekt, blockiert nichts. Ein Vorschlag steht im Befund.
> Sinnvoller Ort wäre die nächste Arbeit an `packages/journaling`.
>
> **~~Genügt die Abnahme `JR-2-10`, obwohl sie nicht unabhängig ist?~~ — entschieden am 2026-08-01:
> nein, es gibt eine zweite Runde (`JR-2-10a`); sie ist durchgeführt und hat E2 abgenommen.** Die erste
> Runde lief in derselben Sitzung wie `JR-2-08`/`JR-2-09`; ADR-014 und ADR-021 verlangen Unabhängigkeit,
> und der Auftraggeber hat auf der Regel bestanden. **Das hat sich gelohnt:** die zweite Runde hat die
> sechs dünnen Stellen der ersten geschlossen und dabei einen weiteren Befund (**F39**) gefunden — und
> der PO hat im Bericht der zweiten Runde ein **ganz fehlendes Kriterium** entdeckt, das erst auf
> Nachfrage nachgemessen wurde. Beide Runden zusammen haben mehr belegt als eine doppelt so gründliche
> hätte belegen können.

Ansonsten keine. `ADR-007`, `ADR-022`, `ADR-023` (alle 2026-07-31, Auftraggeber) und `ADR-006` (2026-07-31,
`JR-2-03`, Rolle PO) sind entschieden. Was in E2 noch offen ist — `ADR-009`, Append-Only per Rechteentzug
oder Trigger — ist Teil von `JR-2-05` und braucht keine Entscheidung des Auftraggebers vorab. Alles andere
ist Arbeit ohne Entscheidungsbedarf.

> **Eine Festlegung aus `ADR-006` verdient trotzdem den Blick des Auftraggebers**, weil sie eine
> Betriebsauflage erzeugt statt einer technischen Sperre: ein aus Produktionsdaten erzeugtes Staging- oder
> Testsystem **muss** mit abgeschaltetem SMTP-Ingress und abgeschaltetem Anchor-Job laufen. Ein Klon ist
> von einem Restore technisch nicht unterscheidbar, und wer hier eine Sperre einbaut, sperrt zuerst das
> Disaster Recovery (ADR-006 §4.3). Die Auflage gehört in den Deployment-Guide (E11); die technische
> Erkennung ist in `JR-8-02`/`JR-8-03`/`JR-2-09` verankert.

Die zuletzt blockierende Frage war **F30**, entschieden mit **ADR-020** und umgesetzt in
`JR-13-17`/`JR-13-18`.

**Zwei Punkte aus `JR-13-17`, beide nicht blockierend, beide Entscheidung des Auftraggebers:**

1. **`JR-13-16` vorziehen?** Unverändert vorgelegt, jetzt mit einem Argument mehr: die Abfrage hat nach
   `JR-13-17` drei neue Befundtypen und eine neue CTE-Spalte, und sie ist weiterhin das einzige
   sicherheitsrelevante Artefakt in E13 ohne Test. ADR-020 nimmt ihr die Beweislast, nicht die
   Regressionsgefahr.
2. **Zwei bewusst hingenommene Abweichungen** in der neuen Fassung, beide in `06-status.md` und in F30
   belegt: `conditions: 5` an einer Regel für ein Subject **ohne** Zeilenfilter wird nicht gemeldet (dort
   ändert sich nichts — der Wurzelbefund bleibt an (Action, Subject) gebunden), und ein leeres Objekt in
   einer **Operandenliste** (`{"id": {"$in": [{}]}}`) **wird** gemeldet, obwohl der Übersetzer es
   akzeptiert. Die zweite ist eine Übermeldung mit Positionsangabe; die Vorgabe „leerer Objektknoten in
   jeder Position" lässt sie zu. Wer das anders will, braucht eine Entscheidung dazu — DEV hat sie nicht
   von sich aus enger gezogen.

**Zur Kenntnis, kein Entscheidungsbedarf für die Abnahme:** **F26** (ein `can` mit falsy `conditions`
liefert weiter Vollzugriff) ist **kein** Regress und bricht kein Kriterium. Er gehört inhaltlich zu
`JR-13-11`. Vorziehen ja/nein ist eine Produktentscheidung, nicht E13s Abnahme.

**~~Doku-Nacharbeit am Permission-Vokabular~~ — erledigt am 2026-07-30 als `JR-13-12`** (`dca1f1a`),
Grundlagenarbeit direkt auf dem Integrationsbranch, wie im Backlog vorgesehen. Kein Entscheidungsbedarf
mehr.

**Zur Kenntnis, kein Entscheidungsbedarf: eine benannte Abweichung in `JR-13-06`.** Die Allowlist prüft
Form des Keys plus Relation, nicht die Existenz der Spalte; ein einzelner unbekannter Key (`foo`) wird
weiter übersetzt. Begründung und Vorschlag (spaltengenaue Prüfung bei `JR-13-10`) stehen unter „Was
zuletzt passiert ist" und in F21.

**F12 ist erledigt und braucht keine Entscheidung mehr.** Behoben in `JR-1-04a` (`653dd1c`), in
`JR-1-06a` unabhängig als behoben bestätigt (10 nebenläufige Runden, 0 Rückstände).

**Vom PO am 2026-07-29 abgearbeitet — kein Vorlagebedarf mehr:** **F18** (ADR-017 und F7 um „für die
Paare der heutigen Aufrufstellen" ergänzt, plus der F17-Nachtrag), **F21** (strenge Variante
entschieden und in `JR-13-06` festgeschrieben, die drei Pins im selben Commit invertiert),
**F22** (`JR-13-04`s Kriterium auf „kein Zweig wird stillschweigend weggelassen" umformuliert, mit der
richtigen Gefahrenrichtung), **F17(a)** (in `JR-13-07` erledigt: die Betreiberdoku sagt, dass
ausgeliefert nur die Super-Admin-Rolle existiert und eine fehlende Read-Only-Rolle kein Fehler der
Installation ist). **F19/F20** brauchten ohnehin keine Entscheidung und sind über die roten Tests Teil
der Abnahme.

**Offen und wirklich beim Auftraggeber: nur `F17(b)`** — soll der Rollen-Bootstrap repariert werden?
Das ist eine Produktentscheidung (welche Rollen liefert Open Archiver aus?), keine Härtung, und sie
gehört nicht in E13. **Blockiert nichts.**

**Restliche Punkte aus `JR-13-01`, zur Kenntnis:**

| Punkt       | Sachstand                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F17**     | (a) **Erledigt:** die Betreiberdoku aus `JR-13-07` nimmt auf, dass ausgeliefert keine Read-Only-Rolle existiert, und ADR-017 hat den Nachtrag. (b) **Offen beim Auftraggeber:** soll der Bootstrap repariert werden? Produktänderung, keine Härtung, nicht in E13. PO-Nachprüfung am Code bestätigt: `createFirstAdmin` → `createAdminRole()` legt `predefined_super_admin` an, `getRoles` liegt hinter `requireAuth`, der Bootstrap kann danach nie mehr feuern. |
| **F18**     | **Erledigt (PO).** ADR-017 hat einen Nachtrag: die Aussage gilt für die Paare der heutigen vier Aufrufstellen, nicht für jede (Action, Subject) je Rolle. Das Aufrufstellen-Inventar wacht darüber.                                                                                                                                                                                                                                                               |
| **F21**     | **Umgesetzt in `JR-13-06` (`dcec017`).** Die drei Pins sind im Fix-Commit invertiert. Eine benannte Abweichung: die Allowlist prüft die Form des Keys plus die Relation, nicht die Existenz der Spalte — ein einzelner unbekannter Key (`foo`) wird weiter übersetzt, weil `mongoToDrizzle` keinen Tabellenkontext hat. Vorschlag: spaltengenau bei `JR-13-10`.                                                                                                   |
| **F22**     | **Erledigt (PO).** `JR-13-04`s Kriterium lautet jetzt „kein Zweig wird stillschweigend weggelassen", mit dem Hinweis, dass die fail-open-Richtung im `$and` und bei leerer Zweigliste liegt, nicht im `$or`.                                                                                                                                                                                                                                                      |
| **F19/F20** | **Behoben** in `JR-13-02` (`a309fd1`) bzw. mit `JR-13-04` (`45ac0e9`): ein unbedingtes `cannot` verweigert, und ein `can` mit leerem `conditions` gilt nicht mehr als unbedingt. Beide Tests sind grün.                                                                                                                                                                                                                                                           |
| **F23**     | Testharness: `tsconfig.test.json` sieht globale Augmentierungen nicht, die nur über Produktionsdateien ins Programm kommen. In `JR-13-01` umgangen (`tests/support/express-i18n-augmentation.d.ts`), Ursache offen. Für E2 relevant, weil der Receiver eigene Express-Routen bekommt.                                                                                                                                                                             |

**Nicht blockierend, aber entscheidungsbedürftig:**

| Punkt       | Sachstand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F13**     | Der unbeschränkte Sweep in `acquireTestDatabase()` kann einen fremden Lauf treffen, der **länger als die Frist** (Default 2 h) läuft; offene Verbindungen schützen ihn nicht, weil `postgres-js` untätige schließt. Heute unerreichbar (5-s-Suite), **erreichbar ab E2/E3** — konkret beim 100k-Soak aus `JR-2-08`. Drei plausible Entwürfe: Lauf-Register, PID-Lebendigkeitsprüfung (`process.kill(pid, 0)`), einmaliger Sweep pro Lauf. Vorerst gilt die Zwischenregel in `04-testplan.md` §2.6. **Spätestens vor `JR-2-08` zu entscheiden.** |
| **ADR-017** | **Erledigt am 2026-07-29: Variante B, umgesetzt in `JR-13-03` (`bcac6bd`).** Braucht keine Entscheidung mehr. Folgearbeit als `JR-13-10` nach E13 vorgemerkt.                                                                                                                                                                                                                                                                                                                                                                                   |
| **F14–F16** | **Alle drei behoben in `JR-1-05c`** (`b5b2190`, 2026-07-30), zusammen mit **F24**. Kein Entscheidungsbedarf mehr. Der Wächter zählt jetzt ausgeführte Tests je Suite **und je Klasse**, die Dateizahl ist eine Gleichheit, und der Hauptprozess besitzt den Rückstand dieses Laufs über ein Ledger-Verzeichnis. Jeder Angriff zuerst am Elternstand wiederholt (Umetikettierung dort Exit 0, jetzt Exit 1). Protokoll in `06-status.md`.                                                                                                        |

| Punkt                                                    | Sachstand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **~~Zwei offene Pull Requests nach `main`~~ — erledigt** | **In `JR-13-09` nachgeprüft (2026-07-29): beide sind geschlossen und _nicht_ gemergt.** `PR #1` (`claude/enterprise-product-implementation-cxmmqe` → `main`) und `PR #2` (`claude/journaling-e1-test-foundation` → `main`) stehen auf `state: closed`, `merged: false`, geschlossen am 2026-07-28. Es gibt **keinen** weiteren PR im Repository, insbesondere keinen aus E13. Damit ist auch die Nebenwirkung weg: ein Push löst wieder **einen** CI-Lauf aus (nur `push`), was an den E13-Läufen sichtbar ist. Kein Entscheidungsbedarf mehr. |
| **~~`JR-1-05c`~~ (F14–F16, F24) — erledigt**             | **Erledigt am 2026-07-30 (`b5b2190`).** Ein grüner CI-Lauf belegt jetzt, dass die deklarierten Tests je Suite und Klasse **ausgeführt** wurden. Zwei Folgen für jede weitere Task: eine neue Testdatei ändert `expectedFiles` **und** `expectedTests` im selben Commit, und ein `-t`-Lauf taugt nicht als Beleg (er meldet „verified NOTHING"). Details in `03-backlog.md` und `06-status.md`.                                                                                                                                                 |
