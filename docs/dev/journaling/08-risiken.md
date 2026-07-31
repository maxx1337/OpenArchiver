# Risiken

Bewertung: **Auswirkung** × **Eintrittswahrscheinlichkeit**. Aufgenommen wird nur, was eine konkrete
Gegenmaßnahme mit Task-Bezug hat — eine Risikoliste ohne Maßnahme ist Dekoration.

---

## R-01 — Durability-Semantik nachträglich nicht reparierbar

**Auswirkung:** kritisch · **Wahrscheinlichkeit:** mittel · **Epic:** E3, E4

Wird ein `250` gesendet, bevor Spool und Ledger durabel sind, ist die betroffene Nachricht
möglicherweise verloren — und zwar unbemerkt. Rückwirkend lässt sich das nicht heilen: bereits
quittierte Nachrichten werden nicht nachträglich durabel, und der Sender hat sie längst verworfen.

**Gegenmaßnahme:** Der Acceptance-Contract steht als Skill (`journal-ledger`) verbindlich fest und
wird nicht aus dem Gedächtnis reproduziert. `JR-304` fordert, dass der Codepfad nach erfolgreichem
Ledger-Append **strukturell** nicht mehr scheitern kann. `JR-410` prüft die zentrale Invariante aus
Client-Sicht über 500 randomisierte Kill-Punkte. Diese Tests sind die Abnahmebedingung für E3/E4, kein
optionales Extra.

## R-02 — Object Lock COMPLIANCE ist irreversibel

**Auswirkung:** kritisch · **Wahrscheinlichkeit:** mittel · **Epic:** E7

Im COMPLIANCE-Modus ist vorzeitige Löschung technisch unmöglich — auch für den Betreiber, auch für
uns, auch bei einem Fehler. Eine zu lang gewählte Aufbewahrungsfrist oder ein versehentlich
gesperrter Test-Bucket bleibt gesperrt. Das ist der Zweck des Modus, nicht ein Defekt.

**Gegenmaßnahme:** `JR-704` verlangt, dass der Deployment-Guide den Konflikt **vor** der Wahl der
Aufbewahrungsfrist erklärt, nicht danach. `JR-705` testet ausschließlich gegen MinIO, niemals gegen
einen produktiven Bucket. Der Auftraggeber entscheidet die Frist bewusst (siehe `07-session-handover.md`).

## R-03 — Falsche Dedupe-Semantik zerstört die Vollständigkeitsargumentation

**Auswirkung:** hoch · **Wahrscheinlichkeit:** mittel · **Epic:** E6

Werden Empfangsereignisse zu „eindeutigen Nachrichten" zusammengefasst, stimmt die Ledger-Anzahl nicht
mehr mit einem Exchange-Message-Trace überein — und man kann die Differenz nicht erklären. Genau diese
Frage stellt ein Prüfer.

**Gegenmaßnahme:** Die Regel „Empfangsereignis ≠ Nachricht" steht im Skill und wird in `JR-603`
getestet: zweifache Zustellung ⇒ ein Objekt, **zwei** Ledger-Einträge, zweiter mit `duplicate_of`.
ADR-010 verhindert, dass durch Wiederverwendung von `processEmail` eine zweite, abweichende
Dedupe-Semantik entsteht.

## R-04 — Verschlüsselung vor dem Hashing macht Hashes unprüfbar

**Auswirkung:** hoch · **Wahrscheinlichkeit:** niedrig · **Epic:** E6, E7

`StorageService` verschlüsselt transparent (AES-256-CBC, Präfix `oa_enc_idf_v1::`). Würde
`content_sha256` über die verschlüsselten Bytes gebildet, ließe sich der Hash nicht mehr gegen einen
Re-Export prüfen — und der Wert des Nachweises wäre null. Der Fehler ist leicht zu machen, weil die
Verschlüsselung unsichtbar ist.

**Gegenmaßnahme:** Der Bestand hasht bereits über Plaintext; diese Reihenfolge ist in `CLAUDE.md` §5.5
und im Skill festgehalten. `JR-605` testet sie explizit: exportieren, entschlüsseln, neu hashen ⇒
identisch zum Ledger-Wert.

## R-05 — Gelöschte Ledger-Zeile bei DSGVO-Löschung bricht die Kette

**Auswirkung:** hoch · **Wahrscheinlichkeit:** mittel · **Epic:** E11

Ein Auskunftsersuchen nach Art. 17 DSGVO trifft auf eine Kette, die keine Löschung verträgt. Wer
naheliegend die Ledger-Zeile entfernt, macht die gesamte Kette ab diesem Punkt unverifizierbar — und
zerstört den Nachweis für alle anderen Nachrichten mit.

**Gegenmaßnahme:** Ledger-Einträge werden nie gelöscht (Skill, ADR-Bereich „nicht verhandelbar").
`JR-1106` implementiert stattdessen ein `object_erased`-Event mit erhaltenem `content_sha256` und
benannter Rechtsgrundlage; `JR-905` stellt sicher, dass `verify` das als absichtliche Löschung
ausweist statt als Kettenbruch. `JR-205` erzwingt Append-Only in der Datenbank, damit der Fehler
technisch nicht möglich ist.

## R-06 — Fehlende Testinfrastruktur macht alle Aussagen unbelegt

**Auswirkung:** hoch · **Wahrscheinlichkeit:** hoch (Ist-Zustand) · **Epic:** E1

Das Repository hat null Tests und keinen Runner. Ohne Harness sind Durability- und
Tamper-Evidence-Aussagen Behauptungen. RFC §12 ist nicht optional, sondern der Beleg.

**Gegenmaßnahme:** E1 steht vor allem anderen. Zusatzrisiko: `pnpm lint` (Prettier über das ganze
Repository) könnte auf dem Bestand rot sein — dann blockiert Altlast jeden künftigen Pull Request.
Deshalb Vorprüfung vor `JR-105` und, falls nötig, ein separater Formatierungs-Commit.

## R-07 — Port 25 ist in vielen Umgebungen nicht erreichbar

**Auswirkung:** mittel · **Wahrscheinlichkeit:** hoch · **Epic:** E12

Cloud-Anbieter blockieren ausgehenden **und** teils eingehenden SMTP-Verkehr auf Port 25; ohne
korrekten MX-Record und Firewall-Freigabe erreicht kein Journal-Report den Receiver. Das ist kein
Codefehler, kostet aber im Rollout viel Zeit.

**Gegenmaßnahme:** `JR-1204` (Deployment-Guide) behandelt DNS/MX, Firewall und Ports explizit;
`.env.example` und `docker-compose.yml` dokumentieren die Port-Zuordnung bereits. Zusätzlich sind
587/2525 hinter einem Proxy vorgesehen (RFC §4.1).

## R-08 — Selbstsigniertes Zertifikat führt zu Klartextzustellung

**Auswirkung:** mittel · **Wahrscheinlichkeit:** hoch · **Epic:** E4, E12

Exchange Online nutzt standardmäßig opportunistisches TLS. Mit einem selbstsignierten Zertifikat
liefert es **im Klartext** aus — still, ohne Fehlermeldung. Der Betreiber glaubt, TLS sei aktiv.

**Gegenmaßnahme:** `JR-404` implementiert `require_tls` mit Abweisung per `530` und protokolliert
ausgehandelte TLS-Version und Cipher im Ledger, sodass ein Prüfer nachvollziehen kann, wie die Daten
angekommen sind. `JR-1204` verlangt ein öffentlich vertrauenswürdiges Zertifikat und einen
Exchange-Outbound-Connector mit TLS-Erzwingung.

## R-09 — Stiller Ausfall bleibt unbemerkt

**Auswirkung:** hoch · **Wahrscheinlichkeit:** mittel · **Epic:** E10

Ein Receiver, der eine Woche unbemerkt nichts empfängt, produziert genau die Lücke, die das Feature
verhindern soll — mit dem Zusatzschaden, dass alle glauben, es funktioniere.

**Gegenmaßnahme:** `JR-1001` (Heartbeat), `JR-1002` (Gap-Detection, kritische Schwere),
`JR-1004` (Ausweichpostfach-Reconciliation, im Deployment-Guide als **verpflichtend**),
`JR-1005` (Message-Trace-Abgleich). Das Ausweichpostfach schließt Ausfalllücken automatisch statt
darauf zu hoffen, dass jemand es merkt.

## R-10 — Offener Journal-Endpunkt

**Auswirkung:** hoch · **Wahrscheinlichkeit:** niedrig · **Epic:** E4

Ein Catch-all-Empfänger nimmt unbegrenzt fremde Inhalte in einen unveränderlichen Speicher auf, aus
dem sie nicht mehr entfernt werden können. In Kombination mit Object Lock COMPLIANCE ist der Schaden
permanent.

**Gegenmaßnahme:** `JR-405` verlangt explizite `journal_recipients` und stellt sicher, dass **kein**
Konfigurationspfad einen Catch-all erlaubt. `JR-409` liefert den M365-IP-Refresh nur als Diff zur
Operator-Freigabe — eine still erweiterte ACL wäre eine Sicherheitsregression.

## R-11 — Unzulässige Compliance-Behauptung

**Auswirkung:** mittel (rechtlich/reputativ) · **Wahrscheinlichkeit:** mittel · **Epic:** E12

Formulierungen wie „GoBD-konform" oder „revisionssicher" behaupten etwas, das keine Software
einlösen kann — Compliance hängt an Konfiguration, Aufbewahrung, Zugriffskontrollen, Monitoring und
schriftlicher Verfahrensdokumentation des Betreibers.

**Gegenmaßnahme:** `JR-1206` übernimmt die Nicht-Behauptung aus RFC §13 wortgetreu ins README. Der
Skill `journal-ledger` §11 verbietet solche Formulierungen in Code, UI, README und Doku. Abnahme
`JR-1209` prüft das Repository darauf.

## R-12 — Doku, die abwesenden Code beschreibt

**Auswirkung:** mittel · **Wahrscheinlichkeit:** hoch (Ist-Zustand) · **Epic:** E12

`docs/enterprise/journaling/guide.md` beschreibt den Closed-Source-Listener, der hier nicht existiert.
Betreiber richten sich danach ein und scheitern; Agenten nehmen an, das Feature sei implementiert, und
suchen nach Code, der nicht da ist.

**Gegenmaßnahme:** In `CLAUDE.md` §2 und `01-gap-analyse.md` §0 dokumentiert; `JR-1205` schreibt die
Datei auf die tatsächliche Implementierung um. Bis dahin gilt die Regel „grep vor jeder Annahme".

## R-13 — i18n-Aufwand wird unterschätzt

**Auswirkung:** niedrig · **Wahrscheinlichkeit:** hoch · **Epic:** E10, E11, E12

Zwei unabhängige i18n-Systeme × 11 Sprachen: ein Feature mit UI und API-Fehlermeldungen kostet 22
Dateien. Wird das übersehen, erscheinen Rohschlüssel in der Oberfläche — oder Strings fehlen nur in
Produktion, weil der `copy-assets`-Buildschritt vergessen wurde.

**Gegenmaßnahme:** Skill `oa-i18n` und die Definition of Done des Subagents `senior-dev` decken es ab.
Bei der Aufwandsschätzung für UI-Tasks mitrechnen.

## R-14 — Kein echter Exchange-Online-Tenant für die Abnahme

**Auswirkung:** hoch · **Wahrscheinlichkeit:** mittel · **Epic:** E12

`JR-1208` ist nicht durch Mocks ersetzbar: die tatsächliche Journal-Report-Struktur echter Tenants,
das Verhalten des Ausweichpostfachs und die DL-Expansion sind genau der Punkt. Ohne Tenant ist E12
nicht abnehmbar.

**Gegenmaßnahme:** Früh klären (steht in `07-session-handover.md` unter den offenen Fragen). Vorarbeit
ist der Parser-Korpus `JR-508`, der die bekannten Varianten als Fixtures abdeckt — er reduziert das
Risiko, beseitigt es aber nicht.

## R-15 — TSA-Auswahl und -Kosten

**Auswirkung:** mittel · **Wahrscheinlichkeit:** mittel · **Epic:** E8

Anchoring braucht eine RFC-3161-TSA; für deutsche Installationen sollte es eine qualifizierte TSA
unter eIDAS sein. Das ist kostenpflichtig, ratenbegrenzt und eine Betreiberentscheidung — kein
Default, den wir setzen dürfen.

**Seit ADR-007 kam ein Kostenhebel dazu, und ADR-022 hat ihn entschärft:** eine Kette je Mandant hätte
bei einem Token je Kette die TSA-Kosten mit der Mandantenzahl multipliziert (täglich × 50 Mandanten:
18.250 Token im Jahr). Der Merkle-Anker über alle Kettenköpfe braucht **ein** Token je Lauf, also 365 —
unabhängig von der Mandantenzahl.

**Drei Risiken einer kostenlosen TSA, benannt weil ADR-023 `open-tsa.eu` für `nightly` und für
Installationen ohne GoBD-Anspruch zulässt** (am 2026-07-31 gemessen):

1. **Kein qualifizierter Zeitstempel.** Keine Beweisvermutung nach eIDAS Art. 41. Die Policy-OID im Token
   ist eine private Enterprise-OID (`1.3.6.1.4.1.59085.1.1`), keine ETSI-Policy. Wer GoBD-Anspruch hat,
   braucht trotzdem eine qualifizierte TSA.
2. **Verfügbarkeit.** Ein Knoten, spendenfinanziert, Redundanz laut Roadmap erst 2028+. Fällt er aus,
   fehlt der Anker — die Annahme läuft nach ADR-008 weiter, aber die Nachweiskette hat eine Lücke.
   **Deshalb nicht in `ci`:** ein CI-Lauf darf nicht von einem fremden Dienst rot werden.
3. **Langzeitverifikation.** Der Root liegt in **keinem** Trust Store und muss gepinnt werden, und das
   Signing-Cert lebt **2 Jahre** bei einer Aufbewahrungsfrist von **10**. Das Token ist ohne seine
   Zertifikatskette später nicht mehr prüfbar — die Kette gehört **mit** archiviert.

**Gegenmaßnahme:** `JR-801` liefert **keinen** Standard-TSA-URL aus, meldet bei leerer Konfiguration einen
klaren Fehler, akzeptiert eine **Liste** von URLs (zweiter unabhängiger Zeitstempel möglich) und archiviert
die Zertifikatskette mit dem Token. `ci` bleibt hermetisch, `nightly` geht gegen `open-tsa.eu`, `manual`
gegen die qualifizierte TSA. `JR-804` und ADR-008 stellen sicher, dass eine nicht erreichbare TSA die
Ingestion niemals stoppt.

## R-16 — Geteilte Infrastruktur mischt Kundendaten, ohne einen Fehler zu erzeugen

**Auswirkung:** kritisch · **Wahrscheinlichkeit:** mittel · **Epic:** E12

Sobald mehr als ein Endkunde bedient wird, ist der naheliegende Sparschritt, Meilisearch und Valkey
zwischen Instanzen zu teilen. Beides scheitert **leise**, und das ist der eigentliche Schaden:

- **Meilisearch:** der Indexname ist das Literal `'emails'`, an 12 Stellen in
  `services/SearchService.ts` und `services/IndexingService.ts` hart verdrahtet, ohne Env-Var und
  ohne Prefix. Zwei Instanzen an einem Meili-Server schreiben in **denselben** Index. Es gibt keinen
  Fehler und keine Warnung — nur kundenübergreifende Suchtreffer in einem Archivprodukt.
- **Valkey:** die Queue-Namen sind global (`jobs/queues.ts:19`, `:24`, `:30`), und
  `config/redis.ts` bietet weder einen `db`-Index noch einen `keyPrefix`. Zwei Instanzen an einer
  Valkey übernehmen sich gegenseitig die Jobs, also auch Indexierungs- und Retention-Arbeit.

Verschärfend: bei `REDIS_TLS_ENABLED=true` setzt `config/redis.ts` `rejectUnauthorized: false` — für
eine geteilte Valkey über eine Netzgrenze ist das TLS ohne Zertifikatsprüfung.

**Gegenmaßnahme:** ADR-024 lässt als Dichteoption ausdrücklich nur den geteilten **Postgres-Server**
mit eigener Datenbank und Rolle je Kunde zu und benennt Meilisearch und Valkey als nicht teilbar. Die
technische Absicherung — `MEILI_INDEX_PREFIX` samt Ersetzung der 12 Literale sowie ein
Redis-`keyPrefix` bzw. `db`-Index — steht als Konsequenz 3 und 4 in ADR-024 und wird als E12-Task
angelegt, sobald das Betriebsmodell entschieden ist. Bis dahin gilt: Infrastruktur nicht teilen.

## R-17 — Ein SMTP-Frontproxy würde den Acceptance-Contract aushöhlen

**Auswirkung:** kritisch · **Wahrscheinlichkeit:** niedrig · **Epic:** E4, E12

Jede Instanz braucht MX und eingehend TCP 25. Weil Port 25 **vor** dem STARTTLS-Handshake kein SNI
hat, lässt sich auf einer gemeinsamen IP nicht nach Hostname routen — der naheliegende Ausweg ist ein
Proxy, der nach `RCPT TO` verteilt. Der stünde vor dem Acceptance-Contract und hätte nur zwei
Möglichkeiten: `250 OK` senden, bevor das Backend Spool und Ledger gefsynct hat — das verletzt den
ersten nicht verhandelbaren Punkt und ist nach R-01 rückwirkend nicht heilbar — oder eigenen
fsync-Spool mit eigenem Ledger führen, also E3 verdoppeln, inklusive einer zweiten Kette, deren
Verhältnis zur ersten begründet werden müsste.

**Gegenmaßnahme:** ADR-024 Begründung 2 legt **eine eigene IP je Instanz** fest und begründet sie
nicht mit Komfort, sondern mit diesem Konflikt. `JR-1204` nimmt das in den Deployment-Guide auf
(Konsequenz 5 der ADR): eine IP je Instanz, MX je Kunde, und ausdrücklich kein gemeinsamer
Port-25-Proxy. Der Skill `journal-ledger` hält den Contract fest, damit er nicht aus dem Gedächtnis
reproduziert wird.
