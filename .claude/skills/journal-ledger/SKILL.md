---
name: journal-ledger
description: The acceptance contract, SMTP response codes, and hash-chain ledger invariants for Open Archiver's compliance-grade SMTP journaling receiver. Use whenever working on the SMTP receive path, the spool, the journal_ledger table, chain hashing, anchoring, crash recovery, deduplication of journal receipts, or the verify command — and whenever deciding what SMTP status code to return.
---

# Journaling Acceptance Contract & Ledger Invariants

These rules define whether the archive is legally defensible. They are not stylistic preferences and
they are not negotiable without a Product Owner decision recorded in
`docs/dev/journaling/05-entscheidungen.md`.

Source of truth: `docs/dev/journaling/00-rfc.md` (§3, §4, §5). This skill is the operative summary.

---

## 1. The acceptance contract

> **`250 OK` is a promise that the message is durably stored and will not be lost. Never issue it
> before that is true.**

In-session, **before** responding to end-of-DATA / final BDAT, in this order:

1. Write the **raw wire bytes** to the spool — after dot-unstuffing, before any parsing or
   transformation.
2. `fsync()` the spool file **and** `fsync()` the containing directory. Both. A file fsync alone
   does not make the directory entry durable.
3. Compute `SHA-256` over those exact bytes.
4. Append the ledger entry and `fsync()` it (Postgres: `synchronous_commit = on` for that
   transaction).
5. Only now: `250 2.0.0 Ok: queued as <seq>`.

If any step fails, respond `4xx`. Everything after step 5 is asynchronous and must never influence
the response code.

### Why 4xx and never 5xx for local failures

A `5xx` tells the sending MTA the message is permanently undeliverable. Exchange generates an NDR
and **drops the message**. That is irreversible data loss caused by our own disk being full. A `4xx`
makes the sender retry. Local failure ⇒ `4xx`, always.

## 2. Response codes

| Condition                                  | Code                                                           | Notes                                                           |
| ------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------- |
| Accepted and durably stored                | `250 2.0.0`                                                    | Include `seq` in the text for operator correlation              |
| Spool write / fsync failure                | `451 4.3.0`                                                    | Retry                                                           |
| Ledger append failure                      | `451 4.3.0`                                                    | Retry. **Never accept without a ledger entry**                  |
| Disk full / spool over high-water mark     | `452 4.3.1`                                                    | Retry                                                           |
| Object store unreachable                   | `250`                                                          | Phase B is async; the spool is authoritative. Do **not** reject |
| Metadata DB unreachable                    | `250` if the ledger is on separate durable storage, else `451` | Depends on the chosen ledger backend                            |
| Recipient not a configured journal address | `550 5.1.1`                                                    | No catch-all, ever                                              |
| Source IP not in ACL                       | `554 5.7.1` at connect                                         |                                                                 |
| STARTTLS required but refused              | `530 5.7.0`                                                    |                                                                 |
| Message exceeds SIZE limit                 | `552 5.3.4`                                                    | Log loudly — this is a silent data-loss vector                  |
| Shutdown in progress                       | `421 4.3.2`                                                    | Drain gracefully                                                |

## 3. Crash semantics

A crash at any point must leave the system in one of two states — never between them:

- **(a)** the transaction was not acknowledged, or
- **(b)** the message is fully present in both spool and ledger.

On startup, scan the spool for entries with no ledger record (a crash between steps 2 and 4) and
either complete them or quarantine them **with an alert**. They were never acknowledged, so the
sender will retry; the dedup rule in §5 handles the resulting duplicate.

Never delete a spool file that has no ledger entry without recording that decision somewhere durable.

## 4. Ledger invariants

1. **`seq` is gapless and strictly monotonic.** A bare Postgres sequence is _not_ sufficient —
   sequences advance on rolled-back transactions and leave permanent holes. Since gap detection is a
   tamper signal (§6), a benign hole destroys the completeness argument.
2. **Writes are serialized.** Single writer plus a Postgres advisory lock held across
   read-head → compute → insert → commit. Do not compute a chain hash outside the lock.
3. **The chain covers the previous entry's hash:**

    ```
    chain_hash(n) = SHA256(
        canonical_encode(seq, received_at, content_sha256, event_type,
                         event_payload, envelope_from, envelope_rcpt, size_bytes)
      || prev_chain_hash(n-1)
    )
    ```

4. **Canonical encoding is length-prefixed and deterministic** — never JSON key ordering luck, never
   locale-dependent timestamp formatting. Same input must produce identical bytes on every platform
   and every version, forever. Changing the encoding invalidates every existing chain; if it must
   ever change, it needs a version field and a documented migration.
5. **`chain_hash(0)`** is the SHA-256 of a documented genesis string that includes the deployment ID.
6. **Nothing is ever deleted or updated.** No `UPDATE`, no `DELETE`, no exceptions. The ledger is
   append-only at the application level and should be constrained that way at the database level too.

## 5. Receipts, not messages

**Every accepted SMTP transaction gets a ledger entry — including duplicates.**

Deduplicate the _stored object_ on `content_sha256`; mark the duplicate ledger row with
`duplicate_of` pointing at the original `seq`. Do not collapse receipt events.

Reason: the ledger records _receipt events_, not unique messages. Collapsing them breaks the
completeness argument the moment an auditor compares the ledger count against an Exchange message
trace and the numbers disagree with no explanation.

## 6. Parse failures are events, not rejections

If a journal report cannot be parsed — unexpected format, malformed MIME, S/MIME-encrypted inner
message — the message is still **accepted, stored, hashed, and chained**. Set a `parse_failed` flag,
index whatever is extractable, alert the operator.

> A message you cannot search is a problem. A message you refused is a violation.

## 7. Typed events

The ledger records more than receipts. Every state change that affects the archive's contents is a
typed event so the chain explains _why_ something is gone:

`receipt` · `anchor` · `retention_expiry` · `object_erased` · `legal_hold_set` · …

**GDPR erasure never deletes a ledger entry.** It removes the _object_ and appends an
`object_erased` event recording the erased seq, timestamp, actor, stated legal basis, and the
retained `content_sha256`. The record's prior existence and its hash stay provable; the content is
gone. `verify` must report this as an intentional erasure, not a chain break.

## 8. Anchoring

A chain is only as trustworthy as whoever holds it — an attacker with full DB access can recompute
it end to end. Anchoring publishes the head where they cannot reach backwards:

1. Read the current head (`seq`, `chain_hash`).
2. Obtain an **RFC 3161 timestamp token** from a configured TSA. Ship **no default TSA URL**; for
   German deployments it should be a qualified TSA under eIDAS.
3. Append an `anchor` ledger event containing head seq, head hash, and the token.
4. Ship the anchor to at least one **external, append-only** destination under _different_
   credentials — a separate Object Lock bucket, a syslog collector, an email to the tax advisor.
   Support several; require at least one.

If the TSA is unreachable, **escalate loudly but never stop ingestion.** Refusing mail to protect a
timestamp inverts the priorities.

## 9. Verification

`verify` must:

- Recompute the chain over a seq range from stored objects and ledger metadata.
- Verify each object's `content_sha256` against the stored bytes.
- Verify all anchors in range against their timestamp tokens.
- Report the **first divergence** with seq and field — not just pass/fail.
- Run with **read-only** credentials, so an auditor can run it without being granted write access.
- Emit machine-readable JSON **and** a human-readable report. The report is an artifact handed to an
  auditor; its wording is part of the deliverable.

## 10. Hard prohibitions

- No relaying. The ingress has no outbound mail path.
- No rewriting, normalizing, re-encoding, or "cleaning" received bytes.
- No catch-all recipient. An open journal endpoint accepts unlimited third-party content into an
  immutable store you cannot delete from.
- No `s3:DeleteObject`, `s3:DeleteObjectVersion`, `s3:BypassGovernanceRetention`, or retention-shortening
  `s3:PutObjectRetention` in the ingest worker's credentials.
- No hashing after encryption — `content_sha256` is over plaintext wire bytes.

## 11. What must never be claimed

Do not describe this software, in code comments, UI copy, README, or docs, as making a deployment
"GoBD-compliant" or "audit-proof". The permitted claim is in RFC §13: the architecture is _capable of
supporting_ compliance requirements; actual compliance depends on the operator's configuration,
retention settings, access controls, monitoring, and written process documentation. No certification
or audit opinion is claimed or implied.
