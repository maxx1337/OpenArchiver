# Parallelbetrieb zweier Sessions

Diese Datei regelt, wie zwei Sessions gleichzeitig am Journaling-Projekt arbeiten, ohne sich
gegenseitig Arbeit zu zerstören. Sie ist am 2026-08-02 entstanden, als der Auftraggeber eine zweite
Session eröffnet hat, während E3 noch lief.

> Sie ist bewusst eine **eigene Datei**. Eine neue Datei kann per Definition nicht in einen
> Merge-Konflikt geraten — und ein Dokument, dessen Zweck das Vermeiden von Konflikten ist, sollte
> nicht selbst einer sein. Das ist kein Wortspiel, sondern die erste Anwendung der Regel weiter unten.

---

## 1. Ausgangslage

| Session   | Gegenstand                             | Branch                                            |
| --------- | -------------------------------------- | ------------------------------------------------- |
| Session A | **E3** — Spool und Acceptance-Contract | `claude/enterprise-product-implementation-cxmmqe` |
| Session B | **E5** — Journal-Report-Parser         | `claude/journaling-e5-parser`                     |

Session A arbeitet **direkt auf dem Integrationsbranch**. Das weicht von ADR-014 ab, ist aber der
Zustand, den Session B vorgefunden hat, und Session B ändert ihn nicht — sie zweigt davon ab, wie
ADR-014 es für ein Epic vorsieht.

Stand bei Beginn von Session B: `9725a5d`, `JR-3-01`…`JR-3-05` committet, offen `JR-3-06`
(fsync-Fault-Injection), `JR-3-07` (Disk-Full) und die Abnahme `JR-3-08`.

> **Nachtrag 2026-08-02: E3 ist abgenommen (21/21) und zurückgemergt** (`185e9bd`, `--no-ff`, kein
> Squash). Session A hat dabei nachträglich sichtbar gemacht, **warum** sie auf dem Integrationsbranch
> stand statt auf einem Epic-Zweig — siehe §8. Der Parallelbetrieb geht damit in seine zweite Form
> über: Session B arbeitet auf `claude/journaling-e5-parser` weiter, der Integrationsbranch ist
> vorerst niemandes Arbeitsbranch. **Die Regeln unten gelten unverändert**, denn sobald eine dritte
> Session ein weiteres Epic aufmacht, ist die Lage dieselbe.

## 2. Warum E5 überhaupt parallel geht

Nicht, weil E5 unwichtig wäre, sondern weil es **kein Byte mit E3 teilt**:

- E3 lebt in `packages/journaling/src/spool/*`, E5 in `packages/journaling/src/parser/*`.
- E5 ist reine Logik über Bytes: keine Datenbank, kein Storage, kein SMTP-Server, keine Konfiguration.
  Es braucht keine der Nähte, die E3 gerade legt.
- Die im Backlog notierte Abhängigkeit E5 → E4 betrifft **eine** Task: `JR-5-05` (Plain-BCC-Fallback)
  braucht die SMTP-Transaktions-Envelope. Die ist ein **Eingabeparameter** des Parsers, kein Code aus
  E4 — E5 definiert die Naht, E4 füllt sie später.

Wer eine andere Parallelarbeit aufmacht, prüft zuerst genau das: **teilt sie ein Verzeichnis mit der
laufenden?** Wenn ja, ist sie nicht parallel, sondern nur gleichzeitig.

## 3. Die drei geteilten Dateien

E5s Code kollidiert nirgends. Drei geteilte Dateien tun es doch, und für jede gilt eine Regel.

### 3.1 `tests/support/suite-inventory.ts`

`expectedFiles` und `expectedTests` sind **exakte** Zahlen, keine Untergrenzen (JR-1-05c). Beide
Sessions fügen Testdateien hinzu, also ist ein Konflikt hier **sicher**.

> **Regel: die Zahlen werden nie von Hand gerechnet und nie aus einem Konflikt „gemittelt".**
> Nach jedem Merge des Integrationsbranchs in den E5-Branch wird ein **Volllauf** gemacht, und
> eingetragen wird exakt die Zahl, die die Fehlermeldung nennt — sie nennt sie im Klartext.

Ein aus dem Konflikt heraus geratener Wert ist die gefährlichste Auflösung, die es hier gibt: er
sieht plausibel aus, ist grün, und deckt die Abweichung zu, gegen die dieser Wächter gebaut wurde.

### 3.2 `pnpm-lock.yaml` und `packages/*/package.json`

E5 nimmt `mailparser` in `packages/journaling` auf (ADR-027), E3 hat zuletzt `zod` dort eingetragen.

> **Regel: Lock-Konflikte werden durch `pnpm install` nach dem Merge aufgelöst, nie durch Handedit.**

### 3.3 `06-status.md` und `07-session-handover.md`

Beide Sessions machen Statuspflege, und beide Dateien sind Fließtext — das ist der unangenehmste
Konflikttyp, weil git ihn nicht sinnvoll auflösen kann und ein Fehler dabei still ist.

> **Regel: Session B fasst `07-session-handover.md` nicht an.** Der Handover beantwortet „was ist der
> nächste Schritt", und der nächste Schritt des Projekts ist E3s Abnahme, nicht E5s Fortschritt. Er
> gehört Session A.
>
> **Regel: Session B schreibt in `06-status.md` ausschließlich in einen eigenen, klar überschriebenen
> E5-Abschnitt** — nie in E3s Absätze, auch nicht korrigierend.

## 4. Merge-Richtung

```
Integrationsbranch ──────▶ claude/journaling-e5-parser        oft, am besten vor jedem Commit
Integrationsbranch ◀────── claude/journaling-e5-parser        erst nach der unabhängigen Abnahme JR-5-09
```

Der Rückmerge passiert **nach** `JR-5-09`, mit `--no-ff` und ohne Squash, wie bei E2, E13 und E3.
`main` wird bis zur Abnahme von E12 nicht angefasst (ADR-014).

**Für die Vorwärtsrichtung wird `rebase` benutzt, nicht `merge`** (Entscheidung des Auftraggebers,
2026-08-02, beim E3-Rückmerge angewandt):

```bash
git fetch origin claude/enterprise-product-implementation-cxmmqe
git rebase origin/claude/enterprise-product-implementation-cxmmqe
git push --force-with-lease origin claude/journaling-e5-parser
```

Das ist hier zulässig, weil auf den Epic-Branch **nur diese eine Session** schreibt — es gibt keinen
fremden Stand, den ein Force-Push überschreiben könnte. `--force-with-lease` statt `--force` ist
trotzdem Pflicht: es bricht ab, falls doch jemand dazwischengeschrieben hat, statt dessen Arbeit
stillschweigend zu verwerfen. Die Regel gilt **ausschließlich** für den Epic-Branch; auf dem
Integrationsbranch wird nichts umgeschrieben.

**Häufig nachziehen ist die eigentliche Maßnahme.** Drei kleine Konflikte über eine Woche kosten
zusammen weniger als einer am Ende, und vor allem: ein kleiner Konflikt ist einer, den man noch
verstehen kann.

> **Ein sauberer Rebase ist kein Beleg dafür, dass die Zahlen stimmen.** Beim Nachziehen auf `d201612`
> gab es **keinen einzigen Konflikt**, obwohl beide Sessions `tests/support/suite-inventory.ts`
> geändert hatten — E3 die `adversarial`-Zahlen, E5 die `unit`-Zahlen, also verschiedene Zeilen. Git
> hat beide Seiten übernommen, und ob die zusammengesetzten Zahlen der Wirklichkeit entsprechen, weiß
> es nicht. **Nach jedem Rebase deshalb ein Volllauf**, egal wie glatt er durchlief. (Hier stimmten
> sie: 45 Dateien, `559 passed | 5 skipped`.)

## 5. Was Session B ausdrücklich nicht anfasst

- alles unter `packages/journaling/src/spool/*`
- `packages/journaling/tests/support/fake-spool-fs.ts`
- `vitest.config.ts`
- `docs/dev/journaling/07-session-handover.md`
- E3s Absätze in `06-status.md`

Auch nicht „nebenbei mitrepariert". Wer in fremdem Gebiet etwas Kaputtes findet, notiert es und
meldet es dem PO — er behebt es nicht.

## 6. Befundnummern sind eine geteilte Folge

`09-befunde-bestandscode.md` nummeriert fortlaufend (zuletzt **F39**). Vergeben **beide** Sessions
unabhängig ein `F40`, stehen hinterher zwei verschiedene Befunde unter derselben Nummer, und zwar in
einem Dokument, auf das ADRs und Abnahmeberichte namentlich verweisen.

> **Regel: Session B vergibt keine F-Nummer selbst.** Sie beschreibt den Befund und legt ihn dem PO
> zur Nummernvergabe vor.

Für **ADR-Nummern** gilt dasselbe Risiko, und hier ist es bereits eingegangen worden:
**ADR-027** in `05-entscheidungen.md` hat sich Session B selbst gegeben, nachdem sie die höchste
vorhandene Nummer (ADR-026) nachgesehen hatte. Schreibt Session A in derselben Zeit ebenfalls eine
ADR, ist das genau die Kollision, vor der dieser Abschnitt warnt.

> **Deshalb: beim Rückmerge wird die Nummer gegen `05-entscheidungen.md` gegengeprüft** und
> gegebenenfalls hochgezogen — samt der Verweise darauf (`packages/journaling/package.json`-Kommentar
> gibt es nicht, aber `12-parallelbetrieb.md`, `03-backlog.md` und `06-status.md` nennen sie).

## 7. Die Umgebung dieser Session (Linux-Container, 2026-08-02)

Anders als der Windows-Host der Vorsessions, und anders als der Handover beschreibt:

- **Kein Docker-Daemon.** `docker` liegt im PATH, aber `/var/run/docker.sock` existiert nicht —
  `docker compose up` scheitert. Der Weg über `docker-compose.yml` steht hier nicht zur Verfügung.
- **PostgreSQL 16 ist lokal installiert.** `service postgresql start`, dann Rolle und Datenbank
  anlegen (`CREATE ROLE admin LOGIN PASSWORD 'password' CREATEDB SUPERUSER;`,
  `CREATE DATABASE open_archive OWNER admin;`). Die Suite läuft dagegen vollständig grün; sie ist
  laut `JR-13-09a` auch gegen 17.10 zeichenweise gleich.
- **`node_modules` fehlt in jeder neuen Session** — `pnpm install` ist Pflicht.
- **`packages/types` und `packages/journaling` müssen gebaut sein, bevor `pnpm test` läuft.** Beide
  zeigen mit `main` auf `dist/`; ohne Build brechen 16 Testdateien mit einem
  `packageEntryFailure` aus vite ab, dessen Meldung die Ursache nicht nennt.
  `pnpm --filter @open-archiver/types --filter @open-archiver/journaling build` genügt.
- **`pnpm test` ist _nicht_ in `dotenv --` gewickelt**, anders als `CLAUDE.md` §4 es für alle
  Root-Skripte behauptet (`package.json:28`: `"test": "vitest run"`). Ohne exportiertes
  `DATABASE_URL` überspringt die gesamte `integration`-Suite **sichtbar**, aber der Lauf sieht auf den
  ersten Blick normal aus. Aufruf deshalb mit vorangestelltem `DATABASE_URL=…` oder über
  `pnpm exec dotenv -- pnpm test`.
  Dieser Punkt ist ein Kandidat für einen Befund; die Nummer vergibt der PO (§6).

**Volllauf auf `9725a5d` mit dieser Umgebung, vor jeder E5-Änderung:**

```
Test Files  40 passed (40)
     Tests  486 passed | 3 skipped (489)
unit: ci 371/371 · integration: ci 97/97 · adversarial: ci 18/18
```

Das ist die Basis, gegen die E5s Zahlen gelesen werden — **nicht** die `398 passed | 2 skipped` bei
30 Dateien aus dem E2-Handover. Die Differenz sind E3s zehn Dateien aus `JR-3-01`…`JR-3-05`.

**Nach dem Rebase auf `d201612` (E3 abgenommen und gemergt) lautet die Basis:** 42 Dateien,
`505 passed | 5 skipped` ohne E5, mit E5 **45 Dateien, `559 passed | 5 skipped`**,
`unit 425/425 · integration 97/97 · adversarial 37/37`.

Zwei Umgebungspunkte sind seit der ersten Fassung dazugekommen bzw. erledigt:

- **PostgreSQL überlebt einen Containerneustart nicht.** Kommt die `integration`-Suite plötzlich mit
  `0/97` zurück, obwohl `DATABASE_URL` gesetzt ist, läuft der Dienst nicht mehr:
  `service postgresql start`. Der sichtbare Skip nennt „`DATABASE_URL` is not set" — die Meldung
  zeigt in die falsche Richtung, der Ausfall liegt am Dienst, nicht an der Variablen.
- **Der Lint-Rückstand in `packages/journaling/src/spool/acceptance.ts` ist erledigt** — Session A hat
  ihn beim E3-Abschluss selbst behoben. `pnpm lint` ist repo-weit grün.

## 8. Was der E3-Abschluss über Epic-Branches gelernt hat — und was das hier bedeutet

`d201612` hält einen Befund fest, der Session B direkt betroffen hätte:
**`git checkout -b <epic> origin/<integration>` setzt den Upstream des Epic-Branches auf den
Integrationsbranch.** Ein anschließendes blankes `git push` landet damit **auf dem
Integrationsbranch** — ohne Merge-Commit, ohne Abnahme, ohne Warnung. Bei E3 sind so elf Commits vor
der Abnahme auf die Hauptlinie gelangt.

Session B hat exakt dieses Rezept benutzt. **Gegengeprüft und sauber:** alle drei E5-Commits sind
mit `git merge-base --is-ancestor` gegen den Integrationsbranch geprüft, keiner ist dort gelandet.
Der Grund ist, dass unmittelbar nach dem Anlegen `git push -u origin claude/journaling-e5-parser`
lief und den Upstream damit korrigiert hat, bevor der erste Push fällig war.

> **Regel: `git push -u origin <epic>` gehört an das Ende des Anlegens, nicht an den ersten Push.**
> Die Lücke dazwischen ist genau so groß wie die Zahl der Commits, die man vorher macht.
