# RFC: SMTP Journaling Receiver for Compliance-Grade Ingestion

**Status:** Draft / Request for Comments
**Target:** Open Archiver
**Author:** (fill in)
**Date:** 2026-07-27

---

## 1. Motivation

Open Archiver currently ingests by **pulling** from mailboxes (IMAP, Microsoft Graph, PST/EML import). For general-purpose archiving this is fine. For *compliance* archiving it has a structural defect:

> Anything a user hard-deletes between message arrival and the next sync is never archived, and its absence is undetectable.

Regulatory regimes that mandate email retention (Germany: **GoBD** / §147 AO / §257 HGB; comparable elsewhere: SEC 17a-4, FINRA 4511, MiFID II) all require *completeness of capture*, not best-effort capture. Completeness can only be guaranteed at the **transport layer**, before a mailbox user can act on the message.

The standard mechanism for this is **journaling**: the mail system emits a copy of every inbound and outbound message to a dedicated external endpoint at transport time.

There is a second, more concrete reason:

> Exchange Online **cannot** deliver journal reports to an Exchange Online mailbox. The journal target must be an on-premises archiving system or a third-party archiving service reachable over SMTP.

Today this disqualifies Open Archiver as a journaling target for any Microsoft 365 tenant — which is the majority of the addressable user base. A workaround exists (transport rule with BCC to a shared mailbox, pulled via Graph), but it is strictly inferior: a BCC copy loses the P1 envelope, so blind-copy recipients and distribution-list expansion are not recorded.

**Goal of this RFC:** add an SMTP receiver that makes Open Archiver a valid journaling target, with *provable* completeness and tamper-evidence rather than asserted completeness.

### Non-goals

- Becoming a general-purpose MTA. No relaying, no outbound queue, no user mailboxes.
- Virus/spam scanning.
- Replacing pull-based ingestion. Pull remains necessary for backfill, historic import, and reconciliation.
- Making any deployment automatically compliant. See §13.

---

## 2. Architecture overview

```
                   ┌──────────────────────────────────────┐
  Exchange Online  │                                      │
  Postfix / Zimbra │  smtp-ingress          (new service) │
  Google (routing) │  ├─ TLS termination                  │
        │          │  ├─ source ACL                       │
        └──SMTP───▶│  ├─ recipient ACL                    │
                   │  └─ two-phase durable accept         │
                   └──────────┬───────────────────────────┘
                              │  (1) fsync raw bytes
                              ▼
                     ┌─────────────────┐
                     │  spool (disk)   │  authoritative until phase B confirms
                     └────────┬────────┘
                              │  (2) append + fsync
                              ▼
                     ┌─────────────────┐
                     │  ledger (chain) │  gapless seq, hash chain
                     └────────┬────────┘
                              │  (3) → SMTP 250 OK
                              │
                              │  ─── async boundary ───
                              ▼
                   ┌──────────────────────────────────────┐
                   │  ingest-worker                       │
                   │  ├─ parse journal report             │
                   │  ├─ extract inner message + envelope │
                   │  ├─ index (search)                   │
                   │  └─ upload object (WORM)             │
                   └──────────┬───────────────────────────┘
                              ▼
                  object store (S3 + Object Lock) + metadata DB
```

`smtp-ingress` MUST be a separate process/container from the web application, with its own credentials. It needs: write access to the spool, append access to the ledger. It does **not** need read access to archived content, and it does **not** need delete rights anywhere.

---

## 3. The acceptance contract (most important section)

Everything else in this document is negotiable. This is not.

> **`250 OK` is a promise that the message is durably stored and will not be lost. Never issue it before that is true.**

Concretely, in-session, before responding to end-of-DATA / final BDAT:

1. Write the **raw wire bytes** (after dot-unstuffing, before any parsing or transformation) to the spool.
2. `fsync()` the spool file **and** `fsync()` the containing directory.
3. Compute `SHA-256` over those exact bytes.
4. Append the ledger entry (§5) and `fsync()` it.
5. Only now: `250 2.0.0 Ok: queued as <seq>`.

If any step fails, respond with a **4xx** code so the sending MTA retries. Never 5xx for a local failure — a 5xx makes the sender generate an NDR and drop the message permanently, which is exactly the data loss this feature exists to prevent.

### Response code table

| Condition | Code | Notes |
|---|---|---|
| Accepted and durably stored | `250 2.0.0` | Include seq in the text for operator correlation |
| Spool write / fsync failure | `451 4.3.0` | Retry |
| Ledger append failure | `451 4.3.0` | Retry. Never accept without a ledger entry |
| Disk full / spool over high-water mark | `452 4.3.1` | Retry |
| Object store unreachable | `250` | Phase B is async; spool is authoritative. Do **not** reject |
| Metadata DB unreachable | `250` if ledger is on separate durable storage, else `451` | Design decision, see §5.4 |
| Recipient not a configured journal address | `550 5.1.1` | No catch-all, ever |
| Source IP not in ACL | `554 5.7.1` at connect | |
| STARTTLS required but refused | `530 5.7.0` | |
| Message exceeds SIZE limit | `552 5.3.4` | Log loudly; this is a silent data-loss vector |
| Shutdown in progress | `421 4.3.2` | Drain gracefully |

### Crash semantics

A crash at any point must leave the system in a state where the message is either (a) not acknowledged, or (b) fully present in spool and ledger. Never partially. On startup, `smtp-ingress` MUST scan the spool for entries without a ledger record (crash between steps 2 and 4) and either complete them or quarantine them with an alert — they were never acknowledged, so the sender will retry, and the dedupe logic (§4.5) handles the duplicate.

---

## 4. SMTP listener requirements

### 4.1 Transport

- ESMTP on port 25; optionally 587/2525 for deployments behind a proxy.
- **STARTTLS with a publicly trusted certificate.** Exchange Online uses opportunistic TLS by default; a self-signed cert will result in plaintext delivery. Provide a `require_tls: true` option that rejects plaintext sessions with `530`, and document that operators should also configure a matching outbound connector with TLS enforcement on the Exchange side.
- TLS 1.2 minimum, 1.3 preferred. Record negotiated version and cipher in the ledger — an auditor may ask how the data got there.

### 4.2 ESMTP extensions

- `SIZE` — default limit **150 MB**, configurable. Journal reports wrap the full original message including attachments; the default must not be a 10 MB Postfix-ism.
- `8BITMIME`, `SMTPUTF8`.
- **`CHUNKING` / `BDAT`** — Exchange Online uses BDAT. Not optional.
- `PIPELINING`.
- `AUTH` (PLAIN/LOGIN over TLS) — optional, for non-Exchange senders such as a Postfix `always_bcc` setup. Exchange Online journal rules cannot authenticate, so IP-based ACLs are the primary control for that path.

### 4.3 Access control

- `allowed_sources`: list of CIDRs. Ship a helper that refreshes the Microsoft 365 outbound IP ranges from the official endpoint list, with the ranges pinned in config and the refresh producing a diff for operator approval rather than auto-applying. A silently widened ACL is a security regression.
- `journal_recipients`: explicit list of accepted RCPT TO addresses. Anything else → `550`. **No catch-all.** An open journal endpoint is an open relay's uglier cousin: it accepts unlimited third-party content into an immutable store you cannot delete from.
- Per-source connection and rate limits, connection/command/data timeouts.

### 4.4 What must never happen

- Relaying. `smtp-ingress` has no outbound path. Ever.
- Rewriting, normalizing, re-encoding, or "cleaning" the received bytes. The archival record is the wire format.
- Rejecting a message because parsing failed. See §5.3.

### 4.5 Idempotency

Retries are normal (network hiccup after step 5, before the sender sees the response). Deduplicate the *stored object* on `content_sha256`, but **always write a ledger entry for every accepted SMTP transaction**, marking duplicates with a reference to the original `seq`. Reason: the ledger is a record of receipt events, not of unique messages. Collapsing receipt events breaks the completeness argument ("why does the count differ from the Exchange message trace?").

---

## 5. Ledger and hash chain

This is what turns "we store hashes" into "we can prove nothing was altered or removed."

### 5.1 Problem with the current design

Open Archiver already stores per-message hashes in PostgreSQL. That detects corruption. It does **not** detect a deliberate change, because whoever can modify the object can also modify the hash row, and it does not detect *deletion* at all — a removed row leaves no trace.

### 5.2 Chain construction

Each accepted SMTP transaction appends one entry:

```sql
CREATE TABLE journal_ledger (
  seq             BIGINT PRIMARY KEY,       -- gapless, strictly monotonic
  received_at     TIMESTAMPTZ NOT NULL,
  remote_ip       INET NOT NULL,
  ehlo_name       TEXT,
  tls_version     TEXT,
  tls_cipher      TEXT,
  envelope_from   TEXT,
  envelope_rcpt   TEXT[],
  size_bytes      BIGINT NOT NULL,
  content_sha256  BYTEA  NOT NULL,          -- over raw wire bytes
  duplicate_of    BIGINT NULL REFERENCES journal_ledger(seq),
  event_type      TEXT NOT NULL,            -- 'receipt' | 'anchor' | 'retention_expiry'
                                            -- | 'object_erased' | 'legal_hold_set' | ...
  event_payload   JSONB,
  prev_chain_hash BYTEA NOT NULL,
  chain_hash      BYTEA NOT NULL
);
```

```
chain_hash(n) = SHA256(
    canonical_encode(seq, received_at, content_sha256, event_type,
                     event_payload, envelope_from, envelope_rcpt, size_bytes)
  || prev_chain_hash(n-1)
)
```

Use a deterministic canonical encoding (length-prefixed fields, not JSON key ordering luck). `chain_hash(0)` = SHA-256 of a documented genesis string including the deployment ID.

**Writes must be serialized.** Simplest correct implementation: a single `smtp-ingress` writer plus a PostgreSQL advisory lock around the append. If horizontal scaling is needed later, partition into per-shard chains with a periodic cross-shard aggregate anchor — but do not start there.

### 5.3 Parse failures are ledger events, not rejections

If the journal report cannot be parsed (unexpected format, malformed MIME, S/MIME-encrypted inner message), the message is **still accepted, stored, hashed and chained**. Set a `parse_failed` flag, index whatever is extractable, and raise an operator alert. Completeness beats searchability. A message you cannot search is a problem; a message you refused is a violation.

### 5.4 Durability of the ledger itself

The ledger must be as durable as the spool before ack. Two options:

- **(a)** Ledger in PostgreSQL with `synchronous_commit = on`. Simple; couples ack latency to DB availability. Recommended default.
- **(b)** Append-only local WAL file, fsync'd, replicated into PostgreSQL asynchronously. Survives DB outages; more moving parts.

Implement (a) first. Make it pluggable.

### 5.5 Anchoring

A hash chain alone is only as trustworthy as the party holding it — an attacker with full DB access can recompute the whole chain. Anchoring fixes this by publishing the chain head where the attacker cannot reach backwards.

Daily (configurable), a job:

1. Reads the current head (`seq`, `chain_hash`).
2. Obtains an **RFC 3161 timestamp token** from a configured TSA. For German deployments this should be a qualified TSA under eIDAS; make the TSA URL configurable and ship no default.
3. Writes an `anchor` ledger event containing head seq, head hash and the timestamp token.
4. Ships the anchor to at least one **external, append-only** destination: a separate S3 bucket with Object Lock under *different credentials*, a syslog collector, or an email to the tax advisor. Operators choose; the code should support several and require at least one.

### 5.6 Verification tool

`open-archiver verify --from <seq> --to <seq>` must:

- Recompute the chain over the range from stored objects and ledger metadata.
- Verify every object's `content_sha256` against the stored bytes.
- Verify all anchors in range against their timestamp tokens.
- Report the **first divergence** with seq and field, not just pass/fail.
- Be runnable with **read-only** credentials, so an auditor can run it themselves without being granted write access.

Machine-readable output (JSON) plus a human-readable report. The report is an artifact people will hand to an auditor; treat its wording as part of the deliverable.

---

## 6. Journal report parsing

### 6.1 Exchange envelope journaling

A journal report is an ordinary message whose body is `multipart/mixed`:

- Part 1: `text/plain` — the journal report, with fields including `Sender`, `Subject`, `Message-Id`, `To`, `Cc`, **`Bcc`**, `Recipient`, `On-Behalf-Of`, and expansion entries for distribution group members.
- Part 2: `message/rfc822` — the original message, unmodified.

**Both must be preserved.** The archived object is the raw outer message as received. The parsed envelope goes into metadata. Do not store only the inner message: the envelope recipients are precisely the information a BCC transport rule cannot give you, and therefore the entire justification for this feature.

Parser must handle: multiple `Recipient:` lines, distribution list expansion, `On-Behalf-Of`, undisclosed recipients, messages with no inner part (rare, malformed), and inner messages that are themselves S/MIME-encrypted (store as-is, flag `content_encrypted`, index headers only).

### 6.2 Other sources

- **Plain BCC copies** (Postfix `always_bcc`, Zimbra, mailcow): no journal report wrapper. Detect the absence and treat the received message itself as the record, with envelope data taken from the SMTP transaction (`MAIL FROM` / `RCPT TO`). Note in metadata that envelope fidelity is reduced.
- **Google Workspace:** has no SMTP journaling equivalent; operators use routing rules with a "also deliver to" external address. Same handling as plain BCC. Document the limitation.
- **NDRs and bounces** addressed to the journal address: store and flag; they are evidence of delivery problems and an auditor may want them.

---

## 7. Storage

- Archived object = raw wire bytes, immutable, keyed by `seq` (not by hash — see §4.5, receipt events are the unit).
- Recommended backend: S3-compatible with **Object Lock in COMPLIANCE mode**, retention configured per policy. MinIO works.
- The ingest worker's credentials MUST NOT include `s3:DeleteObject`, `s3:DeleteObjectVersion`, `s3:BypassGovernanceRetention`, or `s3:PutObjectRetention` with shortening semantics.
- Local filesystem backend remains supported but must be documented as substantially weaker. If used, at minimum: dedicated mount, restrictive ownership, `chattr +i` on written files where the filesystem supports it.
- Existing at-rest encryption applies **after** hashing. `content_sha256` is over the plaintext wire bytes so it can be verified against a re-export.

---

## 8. Completeness monitoring

Capture guarantees are worthless if a silent outage goes unnoticed for a week.

- **Heartbeat alert:** no journal report received within *N* minutes (default 15) during configured business hours. In most organizations, zero mail for 15 minutes means something is broken.
- **Gap detection:** the ledger is gapless by construction, so any observed gap indicates tampering or a bug. Check on every verify run and nightly. Alert at critical severity.
- **Spool depth / age**, phase-B backlog, TSA reachability, object store write latency.
- **Alternate-mailbox reconciliation (recommended feature):** Exchange Online supports configuring an *alternate journaling mailbox* that receives journal reports when the primary target is unreachable. Open Archiver should let operators register that mailbox as a pull source and automatically ingest anything found there, deduplicating against the ledger. This closes outage gaps automatically instead of relying on someone noticing. Document configuring it as **mandatory** in the deployment guide.
- **Periodic reconciliation report:** allow importing an Exchange message trace CSV for a period and comparing counts, with a per-day breakdown of matched / missing / extra. Output a signed report. This is the single most useful artifact to have on hand when someone asks "how do you know nothing is missing?"

---

## 9. Compliance-facing features

- **Auditor role:** read-only. Search, view, export, run `verify`. No delete, no configuration, no user management. Distinct from admin.
- **Export for data handover:** EML files plus a manifest CSV (`seq`, `received_at`, envelope fields, `content_sha256`, `chain_hash`) plus a plain-language verification instruction file. This is what gets handed over on a data carrier during an audit; make it a first-class feature, not a scripting exercise.
- **Deletion only via retention expiry.** Every deletion is a typed ledger event (`retention_expiry`), so the chain records *why* an object is gone and the record of its prior existence survives. Optional four-eyes approval before a retention policy takes effect.
- **Legal hold:** minimum viable version — a flag that suppresses retention expiry for matching messages, itself recorded as a ledger event with who/when/why.
- **Build identity:** surface the exact container image digest and git commit in the UI, in `verify` output, and in the export manifest. Regulators ask which program version produced a record; "latest" is not an answer.

---

## 10. GDPR / retention conflict

Article 17 erasure requests and statutory retention obligations genuinely conflict, and immutable storage makes the conflict concrete rather than theoretical. The design should not pretend otherwise. Proposed resolution:

- **Never delete a ledger entry.** The chain must remain verifiable end to end.
- Erasure removes the **object**, and writes an `object_erased` event recording: seq of the erased object, timestamp, actor, stated legal basis, and the retained `content_sha256`.
- The result: the record's prior existence and its hash remain provable; the content is gone. `verify` reports the object as intentionally erased rather than as a chain break.
- Where a retention obligation applies, erasure is refused and the refusal is likewise logged.

Note in the docs that with Object Lock in COMPLIANCE mode, erasure before the retention period expires is *technically impossible* — that is the point of the mode, and operators must choose the retention period with the conflict in mind rather than discovering it later.

---

## 11. Configuration sketch

```yaml
smtp_ingress:
  listen: "0.0.0.0:25"
  hostname: "archive.example.com"
  tls:
    cert: /etc/oa/tls/fullchain.pem
    key:  /etc/oa/tls/privkey.pem
    require: true              # reject plaintext sessions
    min_version: "1.2"
  max_message_size: 157286400  # 150 MB
  allowed_sources:
    - 40.92.0.0/15             # pinned; refresh via helper, apply manually
  journal_recipients:
    - journal@archive.example.com
  auth:
    enabled: false
  spool:
    path: /var/lib/oa/spool
    high_water_bytes: 21474836480

ledger:
  backend: postgres
  synchronous_commit: true
  anchor:
    schedule: "0 3 * * *"
    tsa_url: ""                # RFC 3161; qualified TSA for eIDAS deployments
    external_targets:
      - type: s3
        bucket: oa-anchors
        credentials_ref: anchor_writer   # separate creds, write-only
      - type: syslog
        endpoint: "tls://logs.example.com:6514"

monitoring:
  heartbeat_window_minutes: 15
  business_hours: "Mon-Fri 07:00-20:00 Europe/Berlin"
  alert_targets: [...]
```

---

## 12. Test plan (acceptance criteria)

Completeness claims need adversarial tests, not happy-path tests.

1. **Kill during DATA.** `SIGKILL` the process at randomized points during a 50 MB transfer, 500 iterations. Assert: for every transaction, either no `250` was observed by the client, or the message is fully present and chained.
2. **fsync fault injection.** Simulate fsync failure; assert `451`, assert nothing acknowledged.
3. **Disk full.** Assert `452`, no partial spool entries, recovery after space is freed.
4. **Object store outage.** Assert messages still acked, backlog drains correctly on recovery, chain unaffected.
5. **Ledger tamper tests.** (a) modify a stored object → verify reports hash mismatch at correct seq; (b) delete a ledger row → verify reports chain break at correct seq; (c) rewrite the chain from seq N forward → verify reports divergence against the first anchor after N.
6. **Soak.** 100k messages, mixed sizes, concurrent connections. Assert gapless, assert verify passes, record throughput.
7. **BDAT path** exercised explicitly, including multi-chunk and `BDAT 0 LAST`.
8. **End-to-end with a real Exchange Online tenant:** journal rule covering internal and external, verify DL expansion members and BCC recipients appear in stored metadata; verify behavior when the receiver is offline and the alternate journaling mailbox catches reports; verify the reconciliation job then ingests them.
9. **Oversize message** at SIZE boundary: assert loud alerting, since this is a silent-loss vector.

---

## 13. Explicit non-claim (include in README)

> This feature enables an architecture capable of supporting compliance requirements. It does not make any deployment compliant. Compliance depends on the operator's configuration, retention settings, access controls, monitoring, operating procedures and written process documentation, and — in most jurisdictions — on obligations that no software can discharge. No certification or audit opinion is claimed or implied for this software.

This paragraph protects the project and is more honest than the "GoBD-compliant" badge that competitors put on their landing pages. Downstream users needing an audit opinion should be pointed at their auditor, not at a checkbox.

---

## 14. Rollout

1. Ship `smtp-ingress` behind a feature flag, disabled by default.
2. Run in parallel with existing IMAP/Graph ingestion during transition; deduplicate on `Message-ID` + content hash and prefer the journaled copy (richer envelope).
3. Deployment guide covering: Exchange Online journal rule creation, alternate journaling mailbox, DNS/MX and firewall, certificate issuance, Object Lock bucket setup with least-privilege credentials, TSA selection, monitoring targets.
4. Once stable, document pull-based ingestion as suitable for backfill and reconciliation rather than as the primary path for compliance deployments.

---

## 15. Open questions

- Multi-tenant deployments: one chain per tenant, or one global chain with tenant-tagged events? Per-tenant is cleaner for export and erasure; global is simpler to anchor.
- Should the anchor job fail closed (halt ingestion) if the TSA is unreachable for *N* days? Leaning no — ingestion must never stop — but it should escalate loudly.
- Chain migration path for existing installations: start a new chain at genesis with an event recording the pre-existing archive's aggregate state, or leave historic data outside the chain and mark it as such? The latter is more honest.
- Is a Merkle tree worth it over a linear chain for large deployments (faster partial verification)? Probably yes eventually, not for v1.
