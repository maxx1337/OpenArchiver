# Abnahme E4 (`smtp-ingress`) — `JR-4-13`

**Datum:** 2026-08-04 · **Geprüfter Commit:** `b951be2` (Branch `claude/journaling-e4-smtp-ingress`,
lokal und remote deckungsgleich, Arbeitsbaum sauber) · **CI-Lauf für diesen Commit:** `30915618389`
(`success`) · **Rolle:** Tester, unabhängige Sitzung (hat keine E4-Scheibe selbst geschrieben) ·
**Nachtrag:** `a28b6af` (Auflage 1, s. u.)

**Urteil: angenommen mit Auflagen.** Kein einziges der 21 Backlog-Kriterien war beim Nachprüfen
tatsächlich verletzt. Auflage 1 ist seit `a28b6af` erledigt; Auflage 2 (Doku-Korrektur F47) bleibt
offen, macht der PO.

## Eigener Volllauf

```
pnpm test
DATABASE_URL=postgresql://admin:password@127.0.0.1:5432/open_archive
OA_TEST_REQUIRE_INFRA=1
```

**1038 passed | 8 skipped** (1046 gesamt) bei **89 Dateien**, 155 s Laufzeit —
`unit ci 848/848 · integration ci 121/121 · adversarial ci 69/69`. Kein `-t`, kein Dateifilter, kein
`--project` — kein „verified NOTHING". Deckt sich exakt mit dem im Session-Handover behaupteten
Stand.

**Nach `a28b6af` (Auflage 1) erneut gefahren:** **1040 passed | 8 skipped** (1048 gesamt) bei
**90 Dateien**, 147 s Laufzeit — `unit ci 850/850 · integration ci 121/121 · adversarial ci 69/69`,
Exit 0. Die Differenz ist exakt eine Datei/zwei Tests — `smtp-tls-fields-reach-acceptance.test.ts`,
s. u.

**CI-Lauf `30915618389`** (derselbe Commit) heruntergeladen und ausgewertet statt nur den Status
geglaubt: dieselben Zahlen, plus die auf diesem Windows-Host strukturell unerreichbare Kernaussage —
`JR-4-10` (Kill-during-DATA) zog dort den `250`-Zweig 8×/20, **alle 8 mit passender,
byteexakt geprüfter Ledger-Zeile**. Lokal auf Windows zog dieselbe Suite ihn 0×/20 (F48,
`fsyncDirectory()` `EPERM`) — korrekt als „Zweig nicht genommen" ausgewiesen, nicht als
unauffälliges Grün.

`tests/support/suite-inventory.ts`: **unit 61/61, integration 21/21, adversarial 7/7** Dateien,
laut CI-Log exakt bestätigt („Suite inventory verified").

## Kriterium → Beleg → Urteil

| ID               | Kriterium (gekürzt)                                                           | Beleg                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Urteil  |
| ---------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| JR-4-01          | Eigener Prozess, zod-Konfiguration, kein Backend-Import                       | `packages/journaling/tests/unit/ingress-import-graph.test.ts` (Volllauf grün); `apps/smtp-ingress/src/index.ts` importiert nachweislich nur `@open-archiver/journaling`                                                                                                                                                                                                                                                                                                                                                      | erfüllt |
| JR-4-02          | ESMTP-Erweiterungen (`PIPELINING`/`8BITMIME`/`SMTPUTF8`/`SIZE`), Timeouts     | Eigener Probe-Client bestätigt alle Erweiterungen in der `EHLO`-Antwort (Session-Log der Abnahme); `packages/journaling/src/ingress/smtp-config.test.ts` (Volllauf)                                                                                                                                                                                                                                                                                                                                                          | erfüllt |
| JR-4-03          | `CHUNKING`/`BDAT` vollständig, byteidentisch zu `DATA`                        | Volllauf grün; CI `30864243188` (referenziert im Handover, von mir nicht erneut abgerufen)                                                                                                                                                                                                                                                                                                                                                                                                                                   | erfüllt |
| JR-4-04          | TLS ≥ 1.2, `require_tls` → `530 5.7.0`, TLS 1.1 abgelehnt                     | `packages/journaling/tests/unit/smtp-tls11-clienthello-rejection.test.ts` — handgebauter TLS-1.1-`ClientHello` (`0x03, 0x02` in Record- **und** Handshake-Layer), Antwort fataler `protocol_version`-Alert, nie ein `ServerHello`; lokal **und** in CI grün. Kalibrierungsgrenze im Dateikommentar korrekt benannt (Ursache ist OpenSSL 3.5.6, nicht isolierbar von `TLS_MIN_VERSION` allein)                                                                                                                                | erfüllt |
| JR-4-04 (Zusatz) | „Version/Cipher stehen im Ledger-Eintrag"                                     | `packages/journaling/tests/unit/smtp-tls-fields-reach-acceptance.test.ts` (`a28b6af`) — 2 Fälle (echter TLS-1.3-Handshake; echter TLS-1.2-Handshake mit explizitem Nicht-Standard-Cipher), je ein realer `EsmtpServer` mit `journalAcceptance` ab Konstruktion, `client.startTls()` **ohne** `try`/`catch` (ein Fehlschlag muss die Suite rot machen, nicht die Assertion überspringen — die F48-Lektion), `secureSocket.getProtocol()`/`getCipher()` gegen die tatsächlich bei `accept()` angekommenen Felder verglichen    | erfüllt |
| JR-4-05a         | Quell-ACL (CIDR, `554` bei Connect), erste DB-Anbindung, `421` bei DB-Ausfall | `packages/journaling/tests/unit/smtp-source-acl-protocol.test.ts`, `packages/journaling/src/ingress/source-acl-cache.test.ts` (Volllauf)                                                                                                                                                                                                                                                                                                                                                                                     | erfüllt |
| JR-4-05b         | Empfänger-ACL, kein Catch-all                                                 | `buildRecipientIndex()` (`source-acl-cache.ts:196-230`) nutzt exaktes `Map.get()`, keine Wildcard-/Präfixlogik; `journaling_sources.routing_address` ist `NOT NULL`, DB-generiert (`journaling-sources.ts:39`). **Selbst geprüft:** kein API-Controller im Repository berührt `journaling_sources` (`grep` über `packages/backend/src/api` ohne Treffer) — heute existiert nicht einmal ein Konfigurationspfad zu dieser Spalte, ein Catch-all also erst recht nicht                                                         | erfüllt |
| JR-4-05c         | `AUTH` PLAIN/LOGIN nur über TLS, bcrypt                                       | `smtp-server.ts:1640` — `538 5.7.11` unbedingt vor Passwortprüfung; Volllauf grün                                                                                                                                                                                                                                                                                                                                                                                                                                            | erfüllt |
| JR-4-06a         | `JournalAcceptance.accept()` verdrahtet, erstes `250` mit `seq`               | `packages/journaling/tests/unit/smtp-acceptance-wiring.test.ts`; produktive Verdrahtung in `apps/smtp-ingress/src/index.ts:219-226` gelesen                                                                                                                                                                                                                                                                                                                                                                                  | erfüllt |
| JR-4-06b         | Codetabelle vollständig, kein lokaler Fehler → `5xx`                          | `packages/journaling/tests/unit/smtp-response-code-table.test.ts` — **11 von 11** Skill-§2-Zeilen, je ein `it()` über echten Loopback-Socket. Zusätzlich **selbst** alle 4xx/5xx-Codes in `smtp-server.ts` enumeriert (17 Stück über `grep`): jeder zusätzliche Code (`450/454/500/501/503/504/535/538`) ist ein Protokoll-/Client-Fehler, keiner eine als `5xx` verkleidete lokale Störung                                                                                                                                  | erfüllt |
| JR-4-07          | Kein Relaying, Byte-Treue                                                     | `packages/journaling/tests/unit/no-outbound-mail-path.test.ts` — Quelltext- **und** `package.json`-Scan mit eingebauter Selbstkalibrierung (jedes Pattern muss sein eigenes Sample UND nichts Harmloses treffen); Volllauf grün                                                                                                                                                                                                                                                                                              | erfüllt |
| JR-4-08          | Per-Source Connection-/Rate-Limits → `4xx`, nie Abbruch ohne Antwort          | `packages/journaling/tests/unit/smtp-rate-limit-protocol.test.ts` — 8 Fälle, u. a. „volle Zeile vor Verbindungsschluss" (`421`) und „Verbindung bleibt offen" (`450`)                                                                                                                                                                                                                                                                                                                                                        | erfüllt |
| JR-4-09          | M365-Helper holt die Liste nicht selbst                                       | `apps/smtp-ingress/src/refresh-m365-ranges.ts` liest nur Datei/`stdin`; `curl`-Zeile ist dokumentierter Betreiberschritt; kein `fetch` im Quelltext (durch JR-4-07-Wächter mitgeprüft)                                                                                                                                                                                                                                                                                                                                       | erfüllt |
| JR-4-10          | Kill-during-DATA: entweder kein `250`, oder Nachricht vollständig verkettet   | s. o., CI `30915618389`: 8/20 zogen den `250`-Zweig, **alle 8** mit passender Ledger-Zeile. Kein Fall von „teilweise"                                                                                                                                                                                                                                                                                                                                                                                                        | erfüllt |
| JR-4-11          | BDAT-Pfad explizit, byteidentisch zu `DATA`                                   | Volllauf grün; CI `30864243188` (Handover-Referenz)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | erfüllt |
| JR-4-12          | Oversize an der `SIZE`-Grenze (exakt/+1/weit darüber)                         | Volllauf grün; CI `30864243188` (Handover-Referenz)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | erfüllt |
| JR-4-14          | Adversariale Protokollrobustheit, TLS-1.1-Nachweis                            | `packages/journaling/tests/adversarial/smtp-protocol-robustness.adv.test.ts` (25 Fälle) und die TLS-1.1-Datei s. o.                                                                                                                                                                                                                                                                                                                                                                                                          | erfüllt |
| JR-4-15          | Sicherheitsdurchsicht des Empfangspfads                                       | F55/F56 gefunden, in `JR-4-21a` behoben (s. u.); alle sechs Umfangspunkte beantwortet laut `09-befunde-bestandscode.md`                                                                                                                                                                                                                                                                                                                                                                                                      | erfüllt |
| JR-4-16          | F44 beheben (Rumpf nach `552` als Kommandos gelesen)                          | Fix vorhanden, Regressionsfall im Volllauf grün                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | erfüllt |
| JR-4-17          | ADR-027: zweite Kette in einer Transaktion → `452 4.5.3`                      | `smtp-server.ts:2253-2280` — zwei Stellen bestätigt, Text unterscheidbar von F55s eigenem `452`                                                                                                                                                                                                                                                                                                                                                                                                                              | erfüllt |
| JR-4-18          | Crash-Recovery-Scan vor `listen()` verdrahtet                                 | `apps/smtp-ingress/src/index.ts` — Scan in der linearen `async`-Sequenz vor `server.listen()` gelesen; `packages/backend/tests/integration/smtp-ingress-crash-recovery-boot.int.test.ts` (3 Fälle: Port bleibt zu bis Scan fertig/F49, zwei Prozesse race nicht, fehlgeschlagener Scan → dauerhaft `451`, nie `250`)                                                                                                                                                                                                         | erfüllt |
| JR-4-19          | Ledger-Verbindung erholt sich nach Startfehler, ohne Neustart                 | `packages/journaling/src/ingress/journal-acceptance-bootstrap.test.ts` — 7 Fälle inkl. „promotes ohne Neustart", „stoppt nach erstem Erfolg", „koalesziert nebenläufige Versuche"                                                                                                                                                                                                                                                                                                                                            | erfüllt |
| JR-4-20          | F46 strukturell geschlossen (ACL-Evaluatoren nicht vertauschbar)              | **Selbst geprüft statt geglaubt:** `SourceAclEvaluator.evaluate`/`RecipientAclEvaluator.evaluateRecipient` sind unterschiedliche Methodennamen; `tsc -p tsconfig.test.json` lief bei mir grün mit den zwei `@ts-expect-error`-Zeilen in `acl-evaluator-port-shapes.test.ts:42/46` aktiv — ein wirkungsloses `@ts-expect-error` hätte tsc als „unused directive" gemeldet, tat es aber nicht. `source-acl-cache-wiring.test.ts` beweist zusätzlich die produktive `bindSourceAclCache()`-Funktion über echten Loopback-Socket | erfüllt |
| JR-4-21          | Zeilenlängengrenze an der Transportschicht (F52/F53/F54)                      | `smtp-protocol-robustness.adv.test.ts` — **4 Größen (~2000 B/100 KB/~200 KB/2 MB) × 10 Wiederholungen**, jede verlangt exakt `500 5.5.1` und sauberen Schluss, nie `ECONNRESET`, nie `250`                                                                                                                                                                                                                                                                                                                                   | erfüllt |
| JR-4-21a         | F50 (Batching), F55 (`RCPT`-Limit), F56 (Cipher-Filter)                       | F55: 3 Testfälle grün, unterscheidbarer `452`-Text. F50: Byte-Treue-Test für `SpoolWriteBridge` grün. F56: eigene Suite (`smtp-tls-cipher-filter.test.ts`) vorhanden                                                                                                                                                                                                                                                                                                                                                         | erfüllt |

## Auflagen

**Auflage 1 — erledigt (`a28b6af`).** Regressionstest für „TLS-Version/Cipher landen im
Ledger-Eintrag" fehlte. Die Behauptung war inhaltlich korrekt (von mir zuerst per Scratch-Probe
nachgewiesen: echter Handshake → `accept()`-Aufruf, Werte identisch), aber kein committeter Test
hielt das fest — der Auftraggeber hat entschieden, dass genau diese Lücke (Verhalten korrekt,
Wächter fehlt) vor der Protokollierung von E4 als abgenommen nachgezogen wird, mit Verweis auf F46
(dort war ein Feld ebenfalls nur deshalb unsichtbar falsch, weil kein Test den produktiven Pfad
berührte). Nachgezogen als `packages/journaling/tests/unit/smtp-tls-fields-reach-acceptance.test.ts`
— echter STARTTLS-Handshake gegen einen realen `EsmtpServer` (`journalAcceptance` ab Konstruktion,
wie `apps/smtp-ingress/src/index.ts`), zweimal (TLS 1.3 mit Standardwerten, TLS 1.2 mit explizitem
Nicht-Standard-Cipher), `client.startTls()` ohne `try`/`catch`, damit ein Fehlschlag die Suite rot
macht statt die Assertion still zu überspringen (F48-Lektion). `tests/support/suite-inventory.ts`
im selben Commit aktualisiert (`unit` 61→62 Dateien, `ci` 848→850 Tests). Volllauf danach:
**1040 passed | 8 skipped** (1048) bei **90 Dateien** — `unit ci 850/850 · integration ci 121/121 ·
adversarial ci 69/69`, Exit 0.

**Auflage 2 — F47 in `09-befunde-bestandscode.md` steht als „offen", ist aber seit `25a7e91`
(`JR-4-06b`) behoben.** Der CI-Schritt „Typecheck journaling test files" existiert
(`.github/workflows/ci.yml:108-109`), und `pnpm --filter @open-archiver/journaling test:types` läuft
sauber durch (selbst ausgeführt, keine Fehler). Reine Doku-Korrektur, keine Code-Änderung nötig.

## Nicht Teil dieser Abnahme

F42 (totes `tsconfig.build.json`, niedrig) und F43 (Heap-Nachweis aus `JR-3-02`, Epic E3) sind
ausdrücklich offene, nicht blockierende Fragen an den Auftraggeber außerhalb von E4 — unverändert,
keine neue Bewertung nötig.

## Methodik

Keine Änderung an Produktionscode. Für Auflage 1 wurde testweise `tests/support/suite-inventory.ts`
auf `62`/`849` gesetzt, eine Probe-Datei angelegt (ein Buffer-Bug im eigenen Zeilen-Reader dabei
gefunden und behoben, sonst hätte die Probe nichts bewiesen), das Ergebnis erhalten, danach die
Probe-Datei gelöscht und `suite-inventory.ts` zurückgesetzt — `git status` am Ende sauber verifiziert.
Alle übrigen Befunde sind durch Lesen des produktiven Quelltextes, eigene Testläufe (lokal und
heruntergeladener CI-Log) und gezielte Gegenproben (z. B. vollständige Enumeration aller `4xx`/`5xx`-
Codes in `smtp-server.ts`) belegt, nicht durch Vertrauen in Kommentare oder frühere Statuseinträge.

**Nacharbeit zu Auflage 1** (`a28b6af`): ebenfalls keine Änderung an Produktionscode, nur an
Testcode und Testinventar. Die neue Suite wurde zuerst isoliert gefahren (2/2 grün, `tsc` sauber),
danach der volle `pnpm test`-Lauf (s. o.) — nicht nur die neue Datei für sich genommen.
