# Testplan

Ausgangslage: **Das Repository hat heute null Tests und keinen Test-Runner.** Kein vitest, jest oder
playwright, kein `test`-Script, kein Test-Job in der CI. `CONTRIBUTING.md` verlangt Tests rein
aspirativ. E1 baut die Infrastruktur; dieses Dokument definiert, was danach geprüft wird.

RFC §12 ist der Maßstab: _„Vollständigkeitsaussagen brauchen adversariale Tests, keine
Happy-Path-Tests."_

---

## 1. Grundregeln

1. **Aus Client-Sicht auswerten.** Bei Durability-Tests zählt, was der sendende Client als
   Statuscode gesehen hat — nicht, was der Server zu tun glaubte. Die Client-Sicht ist der Vertrag.
2. **Kein Test ohne Aussage.** „Wirft keine Exception" prüft nichts. Geprüft wird der beobachtbare
   Vertrag: der Statuscode, die existierende Ledger-Zeile, die Bytes auf der Platte.
3. **Determinismus durch Seeds.** Jede Randomisierung wird geseedet und der Seed geloggt. Ein
   flakiger adversarialer Test ist wertlos, weil seinen Fehlschlägen niemand glaubt. Der Seed muss
   eine exakte Wiederholung erlauben.
4. **Isolation.** Integrationstests bekommen eigenes Postgres-Schema und eigenes Spool-Verzeichnis.
   Nie von einem sauberen gemeinsamen Zustand ausgehen.
5. **Echte Infrastruktur bei Durability.** Ein gemockter `fsync` beweist nichts. Fault Injection
   läuft über eine schmale, explizit injizierte Dateisystem-Schnittstelle — kein Monkey-Patching
   globaler `fs`-Funktionen.
6. **Keine stillen Kürzungen.** Wird Abdeckung begrenzt (Stichprobe, übersprungene Plattform,
   reduzierte Iterationszahl), muss die Testausgabe das sagen. Stille Reduktion liest sich wie
   „abgedeckt", war es aber nicht.
7. **Fixtures enthalten keine echten personenbezogenen Daten.**

## 2. Konventionen

| Art                      | Ort                                      | Namensschema          |
| ------------------------ | ---------------------------------------- | --------------------- |
| Unit                     | neben dem Code                           | `<name>.test.ts`      |
| Integration              | `tests/integration/` im jeweiligen Paket | `<thema>.int.test.ts` |
| Adversarial / Durability | `tests/adversarial/`                     | `<thema>.adv.test.ts` |
| Fixtures                 | `tests/fixtures/`                        | sprechende Dateinamen |

**Jeder Test wird klassifiziert** — `ci`, `nightly` oder `manual` — und die Klassifizierung ist im
Test selbst sichtbar (Tag/Describe-Präfix), nicht nur in diesem Dokument.

| Klasse    | Läuft                          | Zeitbudget           |
| --------- | ------------------------------ | -------------------- |
| `ci`      | jeder Pull Request und Push    | Gesamtsuite < 10 Min |
| `nightly` | einmal täglich                 | unbegrenzt           |
| `manual`  | auf Anforderung, mit Protokoll | —                    |

## 3. RFC §12 → konkrete Testfälle

### §12.1 Kill während DATA — `JR-410`

**Klasse:** `nightly` (500 Iterationen) + `ci`-Smoke mit 20 Iterationen.

`SIGKILL` an randomisierten Punkten während einer 50-MB-Übertragung. Der Testtreiber ist ein
separater Prozess, der (a) den Statuscode aufzeichnet, den er tatsächlich gelesen hat, und (b) nach
dem Neustart Spool und Ledger inspiziert.

**Assertion (die zentrale Invariante):** für jede Transaktion gilt _entweder_ der Client hat kein
`250` gesehen, _oder_ die Nachricht liegt vollständig im Spool und ist korrekt verkettet. Niemals
teilweise.

**Technik:** Kill-Punkt als Byte-Offset aus dem Seed ableiten; Prozess über Prozess-Signal beenden,
nicht über einen In-Process-Hook (ein Hook, der aufräumt, testet den Kill nicht).

### §12.2 fsync-Fault-Injection — `JR-306`

**Klasse:** `ci`.

Drei getrennte Fälle: Write scheitert, Datei-`fsync` scheitert, Verzeichnis-`fsync` scheitert.

**Assertion:** jeweils Fehlersignal für `451`, **nichts** quittiert, kein halber Spool-Eintrag, und
nach dem Fall ein sauberer Zustand.

**Technik:** die injizierbare Dateisystem-Schnittstelle aus `JR-303`. Der Verzeichnis-fsync-Fall ist
der leicht zu vergessene — er muss explizit dabei sein.

### §12.3 Disk full — `JR-307`

**Klasse:** `nightly` (braucht ein eigenes Volume).

Spool auf einem größenbegrenzten Volume (tmpfs mit `size=` oder Loop-Device), Nachricht überschreitet
die Kapazität.

**Assertion:** Signal für `452`, keine Teil-Einträge, Erholung nach Freigabe von Platz.

**Fallback für `ci`:** derselbe Pfad über die injizierbare Schnittstelle mit `ENOSPC` — als
Ergänzung, nicht als Ersatz. Beide Varianten benennen.

### §12.4 Object-Store-Ausfall — `JR-606`

**Klasse:** `ci` (MinIO gestoppt) .

**Assertion:** Nachrichten werden weiterhin mit `250` quittiert, der Backlog läuft nach Erholung
vollständig ab, die Kette ist unberührt.

Dies ist der Test, der belegt, dass Phase B den Acceptance-Contract nicht berührt.

### §12.5 Ledger-Tamper-Tests — `JR-209`, `JR-805`, `JR-907`

**Klasse:** `ci`.

| Fall | Manipulation                            | Erwartung                                   |
| ---- | --------------------------------------- | ------------------------------------------- |
| a    | gespeichertes Objekt verändern          | Hash-Mismatch beim **korrekten** `seq`      |
| b    | Ledger-Zeile löschen                    | Kettenbruch beim **korrekten** `seq`        |
| c    | Kette ab `seq` N vorwärts neu schreiben | Divergenz gegen den **ersten Anker nach N** |

Immer wird die **erste** Divergenz erwartet, mit `seq` **und** Feld — nicht nur pass/fail. Fall (c)
setzt E8 voraus und ist der eigentliche Beweis, dass Anchoring etwas leistet.

Zusatzfall aus E9: ein `object_erased`-Eintrag darf **kein** Kettenbruch sein, sondern muss als
absichtliche Löschung ausgewiesen werden (`JR-905`).

### §12.6 Soak — `JR-607`, plus Ledger-Nebenläufigkeit `JR-208`

**Klasse:** `nightly` (100.000 Nachrichten) + `ci`-Smoke (1.000).

100.000 Nachrichten, gemischte Größen, parallele Verbindungen.

**Assertion:** `seq` lückenlos, `verify` grün, Durchsatz protokolliert.

**Nicht** die Nightly-Menge stillschweigend auf CI-Größe reduzieren. Zwei benannte Varianten.

Ergänzend `JR-208`: 20 parallele Ledger-Writer × 500 Appends ⇒ lückenlos und korrekt verkettet;
erzwungener Rollback zwischen Seq-Ableitung und Commit ⇒ **keine** Lücke.

### §12.7 BDAT-Pfad — `JR-411`

**Klasse:** `ci`.

Einzel-Chunk, Multi-Chunk, `BDAT 0 LAST`, Chunk-Grenze mitten in einer Zeile.

**Assertion:** byteidentisches Ergebnis zum `DATA`-Pfad.

Exchange Online nutzt BDAT. Ein `DATA`-only-Receiver ist mit Exchange Online funktionslos — dieser
Test ist keine Randabdeckung.

### §12.8 Ende-zu-Ende mit echtem Exchange-Online-Tenant — `JR-1208`

**Klasse:** `manual`. Ergebnis wird protokolliert; ohne echten Tenant ist E12 nicht abnehmbar.

1. Journal-Rule für interne und externe Nachrichten.
2. Prüfen: DL-Expansions-Mitglieder und **Bcc**-Empfänger erscheinen in den gespeicherten Metadaten.
3. Receiver offline nehmen ⇒ Ausweichpostfach fängt die Reports auf.
4. Reconciliation-Job holt sie nach, ohne Duplikate im Storage.

**Nicht durch Mocks ersetzbar.** Die Journal-Report-Struktur echter Tenants ist der Punkt.
Der Parser-Korpus (`JR-508`) ist die Vorarbeit, nicht der Ersatz.

### §12.9 Oversize an der SIZE-Grenze — `JR-412`

**Klasse:** `ci`.

Exakt am Limit (annehmen), ein Byte darüber (`552 5.3.4` **mit** Alert), weit darüber.

RFC nennt das ausdrücklich einen stillen Datenverlust-Vektor. Ein Test, der nur den Statuscode prüft
und den Alert nicht, geht am Punkt vorbei.

## 4. Zusätzliche Testfelder außerhalb von §12

| Feld                   | Task    | Klasse       | Kern                                                                                                   |
| ---------------------- | ------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| Kanonische Kodierung   | JR-202  | `ci`         | Determinismus, Golden File, Permutations-Sensitivität, `event_payload`-Schlüsselreihenfolge irrelevant |
| Append-Only-Erzwingung | JR-205  | `ci`         | `UPDATE`/`DELETE` scheitern mit Anwendungsrechten                                                      |
| Crash-Recovery         | JR-305  | `ci`         | beide Zustände (Ledger vorhanden / fehlt), Quarantäne alarmiert, nie stilles Löschen                   |
| Response-Code-Tabelle  | JR-406  | `ci`         | jede Zeile der Tabelle als eigener Fall; kein lokaler Fehler erzeugt `5xx`                             |
| Byte-Treue             | JR-407  | `ci`         | ungewöhnliche Zeilenenden, 8-Bit-Inhalte, Dot-Stuffing-Grenzfälle                                      |
| Idempotenz             | JR-603  | `ci`         | zweifache Zustellung ⇒ 1 Objekt, 2 Ledger-Einträge, `duplicate_of` gesetzt                             |
| Hash über Plaintext    | JR-605  | `ci`         | exportieren, entschlüsseln, neu hashen ⇒ identisch                                                     |
| WORM                   | JR-705  | `ci` (MinIO) | Overwrite, Delete, Retention setzen, Verkürzung — alle vier                                            |
| Parser-Korpus          | JR-508  | `ci`         | DL-Expansion, Bcc-only, `On-Behalf-Of`, S/MIME, kein Innenteil, Plain-BCC, NDR                         |
| Monitoring             | JR-1007 | `ci`         | Signale lösen unter den erwarteten Bedingungen aus — **und nur dann**                                  |
| Auditor-Rechte         | JR-1109 | `ci`         | positiv und **negativ**; jeder Schreibversuch abgewiesen                                               |
| IAM-Grundlagen         | JR-103  | `ci`         | `PolicyValidator`, `createAbilityFor`, `FilterBuilder` über die bestehenden Fixtures                   |

## 5. Was in der CI nicht geht

Ehrliche Abgrenzung, damit niemand sie stillschweigend umgeht:

| Fall                          | Grund                              | Ausweg                                                       |
| ----------------------------- | ---------------------------------- | ------------------------------------------------------------ |
| Echter Exchange-Online-Tenant | Fremdsystem, Credentials, Laufzeit | `manual`, protokolliert; Parser-Korpus als Vorarbeit         |
| Qualifizierte eIDAS-TSA       | kostenpflichtig, ratenbegrenzt     | Test-TSA in `ci`, echte TSA `manual`                         |
| 100k-Soak                     | Laufzeit                           | `nightly`, plus 1k-Smoke in `ci`                             |
| Echtes Disk-Full              | braucht eigenes Volume             | `nightly` echt, `ENOSPC`-Injektion in `ci`                   |
| `chattr +i`                   | dateisystemabhängig                | übersprungen mit **sichtbarem** Hinweis, nie stillschweigend |
| 500× Kill-during-DATA         | Laufzeit                           | `nightly` voll, 20× in `ci`                                  |

## 6. Abnahmeregel

Ein Epic gilt erst als abgeschlossen, wenn `TEST` **unabhängig** abgenommen hat. Die Abnahme
berichtet je Akzeptanzkriterium: **erfüllt / nicht erfüllt / nicht prüfbar**, jeweils mit Kommando
und Ausgabe. „Nicht prüfbar ohne echten Tenant" ist ein legitimes und nützliches Ergebnis — ein
stillschweigend als erfüllt markiertes Kriterium ist es nicht.
