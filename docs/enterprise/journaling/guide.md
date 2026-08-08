# SMTP Journaling

SMTP Journaling allows Open Archiver to receive journal reports directly from your corporate mail transfer agent (MTA) — such as Microsoft Exchange, Microsoft 365, or Postfix — via an embedded SMTP listener. This provides a real-time, unaltered copy of every email including BCC and envelope routing data.

## Overview

When journaling is enabled, Open Archiver runs an embedded SMTP server alongside the main application. Your MTA is configured to send journal reports to a unique routing address for each journaling source. The SMTP listener validates each connection by IP whitelist, optional TLS, and optional SMTP AUTH credentials before accepting the email and queuing it for archival processing.

## Prerequisites

- Open Archiver Enterprise license with the **Journaling** feature enabled.
- A domain or subdomain with an **MX record** pointing to the server running Open Archiver (e.g., `journal.yourdomain.com`).
- Network/firewall rules allowing inbound SMTP traffic on the configured port (default: `2525`).

## Environment Variables

Add the following to your `.env` file:

| Variable                               | Default     | Description                                                                                                                                                    |
| -------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMTP_JOURNALING_PORT`                 | `2525`      | The port the SMTP listener binds to inside the container. The `docker-compose.yml` maps this to the host.                                                      |
| `SMTP_JOURNALING_DOMAIN`               | `localhost` | The domain used to generate routing addresses (e.g., `journal-abc12345@journal.yourdomain.com`). Set this to the domain whose MX record points to this server. |
| `JOURNAL_QUEUE_BACKPRESSURE_THRESHOLD` | `10000`     | Maximum waiting jobs before the listener returns 4xx temporary failures.                                                                                       |

## Docker Deployment

The `docker-compose.yml` exposes the SMTP port on the host:

```yaml
ports:
    - '25:${SMTP_JOURNALING_PORT:-2525}'
```

The host-side port is configurable via `.env`. The container-side port is fixed at `25`, which is the default SMTP listening port.

### Firewall Configuration

Ensure your server's firewall allows inbound TCP on the SMTP listening port:

```bash
# UFW example
sudo ufw allow 25/tcp

# iptables example
sudo iptables -A INPUT -p tcp --dport 25 -j ACCEPT
```

If using a cloud provider (AWS, GCP, Azure), add an inbound rule to your security group or firewall for TCP port `25` (or your custom port).

## DNS Configuration

Create an MX record for the journaling subdomain pointing to your Open Archiver server:

```
journal.yourdomain.com.  IN  MX  10  archiver.yourdomain.com.
```

Where `archiver.yourdomain.com` resolves to the IP address of your Open Archiver server.

## Creating a Journaling Source

1. Navigate to **Dashboard → Ingestions → Journaling** in the Open Archiver UI.
2. Click **Create Journaling Source**.
3. Configure:
    - **Name**: A descriptive name (e.g., "Exchange Production").
    - **Allowed IPs**: The IP addresses or CIDR blocks of your MTA servers (e.g., `10.0.0.0/8`, `203.0.113.50`).
    - **Require TLS**: Enable if your MTA supports STARTTLS (recommended for GDPR compliance).
    - **Organization Domains** (optional): Define domain groups to correctly identify which inbox each journaled email belongs to. See [Organization Domain Groups](#organization-domain-groups) for details.
    - **SMTP Username / Password** (optional): If set, the sending MTA must authenticate with these credentials before delivering journal reports. If the sender does not authenticate, the email is rejected.
4. After creation, the UI displays a **Routing Address** (e.g., `journal-abc12345@journal.yourdomain.com`). Configure this address as the journal recipient in your MTA.

## Editing a Journaling Source

When editing a source that has an SMTP password configured:

- The password field is always empty when the edit form opens (the existing password is stored as a bcrypt hash and cannot be retrieved).
- If a password is currently set, the form shows a hint: **"A password is currently set. Leave this field blank to keep it, or type a new password to replace it."**
- To **keep the existing password**: leave the password field blank and save.
- To **change the password**: type the new password and save.
- To **remove password authentication entirely**: clear the username field and leave the password field blank, then save. Both fields being empty disables SMTP AUTH for that source.

---

## Organization Domain Groups

Organization Domain Groups tell Open Archiver which email addresses belong to your organization. This is used to determine **which inbox (`userEmail`) a journaled email is filed under** — a value that drives IAM access control (who can search which emails) and Meilisearch scoping.

### Why This Matters

A journal report received via SMTP contains all participants: To, CC, BCC, and From. Open Archiver must decide which of those addresses is the "owner" — the internal inbox the email belongs to. Without domain configuration, it uses a simple heuristic (first To address). With domain groups configured, it correctly identifies internal recipients even when your organization uses multiple domains or has migrated from an old domain.

### Structure

Each domain group has:

- **Primary domain** (`main`): The canonical domain used for storage and search. All email addresses from alias domains are normalized to this domain before being stored.
- **Alias domains** (`aliases`): Zero or more additional domains that belong to the same organization. Addresses at these domains are treated identically to the primary domain.

**Example configuration:**

```json
[
	{
		"main": "company.com",
		"aliases": ["company.co.uk", "old-brand.com"]
	},
	{
		"main": "subsidiary.io",
		"aliases": []
	}
]
```

Multiple groups are supported — useful when your Open Archiver instance archives emails for multiple organizations or subsidiaries.

### How Owner Resolution Works

For each inbound journaled email, Open Archiver resolves the owner address using the following priority order:

1. **Inbound check (To / CC / BCC)**: Scan all recipient addresses in order (To first, then CC, then BCC). The first recipient whose domain matches any configured domain (either `main` or an `alias`) is selected as the owner.

2. **Outbound check (From)**: If no recipient matched, check whether the sender's domain matches a configured domain. If so, the email is outgoing from an internal mailbox and the sender is the owner.

3. **Fallback (no groups configured)**: If no domain groups are configured at all, a simple heuristic is used: `To[0] → CC[0] → BCC[0] → From[0] → 'journal-unknown'`.

4. **No match with groups configured**: If domain groups exist but no participant matched any of them (e.g., a forwarded external email with no internal participants), the address is set to `default_fallback@<primary domain of first group>` and a warning is logged.

### Domain Normalization (Alias Handling)

When an owner is matched via an alias domain, the address is automatically normalized to the primary domain before being stored. This ensures that emails sent to `user@old-brand.com` and emails sent to `user@company.com` are stored under the same mailbox identity.

**Example:**

| Journaled email recipient | Configured group                                      | Stored `userEmail`             |
| ------------------------- | ----------------------------------------------------- | ------------------------------ |
| `alice@old-brand.com`     | `{ main: "company.com", aliases: ["old-brand.com"] }` | `alice@company.com`            |
| `alice@company.com`       | `{ main: "company.com", aliases: ["old-brand.com"] }` | `alice@company.com`            |
| `bob@subsidiary.io`       | `{ main: "subsidiary.io", aliases: [] }`              | `bob@subsidiary.io`            |
| `external@gmail.com`      | _(no match)_                                          | `default_fallback@company.com` |

### Practical Scenarios

**Single domain, no migration:**
Leave Organization Domains empty. The system uses the heuristic `To[0]` address. This works correctly for most single-domain setups.

**Domain migration or rebrand:**
Your company moved from `old-brand.com` to `company.com`. Configure:

```
main: company.com
aliases: old-brand.com
```

Emails addressed to either domain are now filed under `company.com` addresses, giving users a unified view of their archive regardless of when the email was sent.

**Multiple alias domains (e.g., regional TLDs):**

```
main: company.com
aliases: company.co.uk, company.de, company.fr
```

**Multiple subsidiaries, one Open Archiver instance:**
Create two groups:

```
Group 1: main: parent.com,      aliases: []
Group 2: main: subsidiary.io,   aliases: [sub-old.com]
```

---

## MTA Configuration Examples

### Google Workspace

Google Workspace does not have a native journaling feature like Exchange. Instead, use a **Routing** rule to deliver a copy of all email to the Open Archiver journaling address:

1. In the Google Admin Console, go to **Apps → Google Workspace → Gmail → Routing**.
2. Under **Routing**, click **Configure** (or **Add another rule**).
3. Configure the rule:
    - **Name**: "Journal to Open Archiver"
    - **Email messages to affect**: Select **Inbound**, **Outbound**, and **Internal - sending** as needed.
    - Under **For the above types of messages, do the following**, select **Modify message**.
    - Check **Also deliver to** → **Add more recipients** → enter the routing address from Open Archiver (e.g., `journal-abc12345@journal.yourdomain.com`).
    - For the added recipient, click **Advanced settings** → **Change route** and configure the SMTP route to point to `archiver.yourdomain.com` on port `2525`. Enable **Require TLS** if your journaling source has TLS enabled.
    - Optionally check **Do not deliver spam to this recipient** to avoid archiving spam.
4. Click **Save**.

> **Note**: Changes to Gmail routing rules may take up to 24 hours to propagate across all users. For the allowed IPs in your journaling source, use Google's SMTP relay IP ranges (see [Google IP ranges](https://support.google.com/a/answer/60764)).

### Microsoft 365 / Exchange Online

1. In the Exchange Admin Center, go to **Compliance Management → Journal Rules**.
2. Create a new journal rule:
    - **Send journal reports to**: The routing address from Open Archiver (e.g., `journal-abc12345@journal.yourdomain.com`).
    - **Scope**: Select "All messages" or scope to specific users/groups.
3. Ensure your Exchange connector allows outbound SMTP to the Open Archiver server on port `2525`.

#### Keeping the Microsoft 365 IP ranges current

Microsoft changes the IP ranges Exchange Online sends from. When a range is added and your source's
IP allow-list does not have it, journal reports from those hosts are refused with `554 5.7.1` — and
Exchange eventually gives up and generates NDRs.

The `refresh-m365-ranges` helper compares the official Microsoft endpoint list against every
journaling source's allow-list and prints what is missing. **It never changes anything**: a silently
widened allow-list would be a security regression, so applying a suggestion is always your decision.
It does not download the list either — you do, which means the mail-receiving host needs no outbound
internet access:

```bash
# 1. Fetch the official list. clientRequestId must be a GUID you generate.
curl -s 'https://endpoints.office.com/endpoints/worldwide?clientRequestId=b10c5ed1-bad1-445f-b386-b919946339a7' \
    > m365-endpoints.json

# 2. Compare it against the configured sources (reads the database, writes nothing).
pnpm --filter smtp-ingress-app refresh-m365-ranges m365-endpoints.json

# The list can also be piped in:
curl -s 'https://endpoints.office.com/endpoints/worldwide?clientRequestId=<GUID>' \
    | pnpm --filter smtp-ingress-app refresh-m365-ranges
```

Only Exchange entries that actually serve **port 25** are considered. The Exchange web front ends
(ports 80/443) are deliberately ignored — copying them in would widen your allow-list by an order of
magnitude for hosts that never deliver mail to you.

Sample output:

```
journaling source: Contoso <journal-abc12345@journal.example.com> (7f3c…)
official feed: 1 Exchange/port-25 entry (id 10) of 78 in the feed
missing from allowed_ips (1) -- mail from these would be
refused with 554 5.7.1:
  + 40.107.0.0/16
in allowed_ips but not in the official list (1) -- NOT a removal
recommendation: an on-premises connector, test relay or smart host belongs here and
this helper cannot know about it:
  ? 192.0.2.0/24

Nothing was changed. This helper only reads; apply additions yourself after review.
```

Entries the official list does not contain are reported with `?`, never as something to delete: an
on-premises connector, a test relay or a regional smart host legitimately belongs in the allow-list
and the helper cannot know about it. Add missing ranges through **Dashboard → Ingestions →
Journaling** after reviewing them.

Exit codes make this usable as a scheduled check: `0` — nothing to do; `2` — at least one source is
missing a range (open a change ticket); `1` — the helper could not do its job (unreadable list,
database unreachable, no `SMTP_INGRESS_DATABASE_URL`). An unreadable list is never reported as "your
allow-list is fine".

### On-Premises Exchange

1. Open the Exchange Management Shell.
2. Create a journal rule:
    ```powershell
    New-JournalRule -Name "Open Archiver" -JournalEmailAddress "journal-abc12345@journal.yourdomain.com" -Scope Global -Enabled $true
    ```
3. Create a Send Connector for the journaling subdomain pointing to the Open Archiver server's IP and port.

### Postfix

Add a transport map entry to route journal emails to the Open Archiver SMTP listener:

```
# /etc/postfix/transport
journal.yourdomain.com    smtp:[archiver.yourdomain.com]:2525
```

Then run `postmap /etc/postfix/transport` and reload Postfix.

---

## Security Considerations

### Authentication

Each journaling source can optionally require SMTP AUTH (username + password). When credentials are configured on a source, the sending MTA **must** authenticate before delivering email. Unauthenticated connections are rejected at the RCPT TO stage.

Sources without credentials configured rely solely on IP whitelisting for access control.

Passwords are stored as bcrypt hashes in the database and are never returned by the API. When editing a source in the UI, the password field is always empty — see [Editing a Journaling Source](#editing-a-journaling-source) for instructions on changing or clearing a password.

### IP Whitelisting

Every connection is validated against the IP whitelist in two stages:

1. **onConnect**: Rejects IPs not whitelisted by _any_ active source (early filter).
2. **onRcptTo**: After resolving the specific source by routing address, validates the IP against _that source's_ whitelist.

### TLS

When `requireTls` is enabled on a source, connections without TLS (STARTTLS) are rejected. This is recommended for compliance with GDPR and other data protection regulations.

---

## WORM Storage (Object Lock)

Open Archiver can store every archived object — the raw EML and its extracted attachments — under a **WORM** (Write Once, Read Many) guarantee: once written, an object cannot be deleted or have its retention shortened, by anyone, for as long as its retention period runs. This section explains what that guarantee actually is, what it costs you, and how to configure it responsibly. Read the whole section — in the order it is written — before you set a retention period.

### Retention under COMPLIANCE mode is irreversible — read this before choosing a period

The only backend that provides a real WORM guarantee is S3-compatible object storage with **Object Lock in COMPLIANCE mode** (see [Choosing a Retention Period](#choosing-a-retention-period-and-enabling-object-lock) below for how to enable it). Once you turn this on and Open Archiver writes an object under it, the following is true for the entire retention period **and there is no override**:

- Amazon S3 (and Object-Lock-compliant alternatives such as MinIO) itself — not Open Archiver's code, not your IAM policy — refuses every request to delete that object version, to shorten its retention date, or to change its lock mode away from COMPLIANCE. This applies to **every** principal, including the bucket owner and the AWS account root user.
- There is no support escalation, no "break glass" procedure, and no emergency override for a bucket administrator who changes their mind. AWS is explicit about this: COMPLIANCE mode is designed so that _nobody_ can undo it before the retention date, full stop.
- This is enforced **per object version**, from the moment it is written, for exactly the number of days configured at that time (`STORAGE_S3_OBJECT_LOCK_RETAIN_DAYS`). Extending an object's retention later is possible; shortening it is not.
- Object Lock must be enabled on the bucket **at bucket-creation time**. It cannot be turned on for an existing bucket. If you decide to adopt this after already running against a bucket without Object Lock, you need a new bucket and a migration of existing objects — objects already written are not retroactively protected.

Practical consequence: whatever number of days you configure is a number of days you are **committing to**, including against your own future operational needs — a decommissioned deployment, a storage-cost reduction, a data subject erasure request under a "right to be forgotten" regime, or simply outgrowing the retention you originally picked. Confirm with your own legal/compliance function what retention period your jurisdiction and industry actually require before you commit to a number (this is a factual description of the AWS mechanism, not legal advice). Article 17(3) GDPR and equivalent regimes generally carve out an exception for retention required by law — but whether that exception covers your specific case is a question for counsel, not for this guide.

If you are not ready to make that commitment yet, do not set `STORAGE_S3_OBJECT_LOCK_MODE` — running without it costs you the WORM guarantee, not the archiving feature itself; everything else in this guide works identically either way.

### Choosing a retention period and enabling Object Lock

1. Create a **new** S3 bucket with Object Lock enabled at creation time (the AWS console has an "Enable Object Lock" checkbox on bucket creation; via CLI, `aws s3api create-bucket ... --object-lock-enabled-for-bucket` followed by `aws s3api put-object-lock-configuration`). For MinIO, pass `--with-lock` to `mc mb`, or enable it via the console at bucket creation.
2. Decide on a retention period, in days, having read the section above.
3. Set in `.env`:

    ```
    STORAGE_TYPE=s3
    STORAGE_S3_OBJECT_LOCK_MODE=COMPLIANCE
    STORAGE_S3_OBJECT_LOCK_RETAIN_DAYS=<your chosen number of days>
    ```

    (plus the usual `STORAGE_S3_*` connection settings — see [Environment Variables](#environment-variables) in `.env.example`.) `COMPLIANCE` is the only supported mode; `GOVERNANCE` mode allows a sufficiently-privileged principal to shorten or remove retention (`s3:BypassGovernanceRetention`), which defeats the point of a WORM guarantee against an insider or a compromised credential, so Open Archiver does not offer it as an option.

4. Restart Open Archiver. From that point on, every object `StorageService`/`S3StorageProvider` writes carries `ObjectLockMode: COMPLIANCE` and `ObjectLockRetainUntilDate` computed as write-time + the configured number of days.
5. This is not retroactive: objects written before you enabled Object Lock, or to a bucket that did not have it enabled at creation, are not protected. Only new writes after this configuration is live are covered.

### Least-privilege credentials for the S3 backend

The IAM credentials Open Archiver uses to reach the bucket should be able to write and read objects, but should **not** be able to defeat the WORM guarantee even if the credential itself is ever compromised. Concretely, the policy attached to that principal must **not** grant:

- `s3:DeleteObject` / `s3:DeleteObjectVersion` — no path to remove an object at all.
- `s3:BypassGovernanceRetention` — irrelevant under COMPLIANCE mode (S3 rejects it outright there), but denying it explicitly means the credential can never be used to defeat retention if the bucket is ever misconfigured or downgraded to GOVERNANCE mode.
- `s3:PutObjectRetention` without a floor — Open Archiver itself needs `s3:PutObjectRetention` (it is required for the `x-amz-object-lock-*` headers sent with every `PutObject`/multipart upload; see the AWS documentation on Object Lock permissions), but the policy should restrict what that permission can be used for via the `s3:object-lock-remaining-retention-days` condition key: deny any `PutObjectRetention` call that would leave **fewer** days of retention remaining than your configured minimum. This lets the credential extend retention (harmless) but not shorten it (defeats the guarantee) — the AWS-documented pattern for "extend-only" retention changes. Note this is defense-in-depth: under COMPLIANCE mode, S3 already refuses a shortening `PutObjectRetention` call unconditionally at the service level; this condition additionally protects against the credential being reused against a GOVERNANCE-mode bucket, or against a future mode change.

Example policy (replace `YOUR_BUCKET` and the numeric floor with your configured `STORAGE_S3_OBJECT_LOCK_RETAIN_DAYS`):

```json
{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Sid": "AllowArchiveWrites",
			"Effect": "Allow",
			"Action": [
				"s3:PutObject",
				"s3:PutObjectRetention",
				"s3:GetObject",
				"s3:GetObjectRetention",
				"s3:ListBucket",
				"s3:GetBucketObjectLockConfiguration"
			],
			"Resource": ["arn:aws:s3:::YOUR_BUCKET", "arn:aws:s3:::YOUR_BUCKET/*"]
		},
		{
			"Sid": "DenyDeletion",
			"Effect": "Deny",
			"Action": ["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:BypassGovernanceRetention"],
			"Resource": "arn:aws:s3:::YOUR_BUCKET/*"
		},
		{
			"Sid": "DenyRetentionShortening",
			"Effect": "Deny",
			"Action": "s3:PutObjectRetention",
			"Resource": "arn:aws:s3:::YOUR_BUCKET/*",
			"Condition": {
				"NumericLessThan": {
					"s3:object-lock-remaining-retention-days": "365"
				}
			}
		}
	]
}
```

This is a starting point, not a certified compliance artifact — review it against your own security baseline before use. `JR-7-05` (a separate, later task) verifies against a real MinIO instance with Object Lock enabled that a deletion attempt under this policy actually fails; this document only describes the intended policy shape.

### What Object Lock protects — and what the application does not show you

Object Lock's guarantee, as configured above, is about **stored bytes and object versions inside S3**. It is not the same thing as what Open Archiver's own screens and APIs will tell you happened. That gap matters if you ever need to prove the guarantee to an auditor, or if something in your archive appears to have been deleted or changed and you need to know whether that is real.

Confirmed against a real MinIO instance with Object Lock enabled (`JR-7-05`):

- **An "overwrite" of a locked object does not fail — and does not touch the locked bytes.** If a new write lands on the same object key, S3 does not reject it: it creates a **new, separately locked version** at that key. The original, locked version is untouched and still fully retrievable — but only by its specific version ID. Open Archiver's normal read path always reads the _latest_ version, so it will silently show the new content, with no error and no indication that an earlier, still-protected version exists underneath it.
- **A "deletion" of a locked object does not fail either — and does not remove the locked bytes.** A delete request sent the ordinary way (no specific version ID, which is how Open Archiver issues it) does not delete the locked version at all: on a versioned bucket, it creates a **delete marker**, a standard S3 mechanism that makes the object _appear_ deleted to ordinary reads. Open Archiver's `get()`/`exists()` will report the object as gone. The bytes themselves are still there, still under Object Lock, still protected against real deletion or truncation for the rest of the retention period — they have only become unreachable through the application's normal view. A delete aimed at the specific locked version, by contrast, genuinely fails while the lock is active, confirmed the same way.

**What this means for you as an operator:** the WORM guarantee is real and it holds. It protects the physical bytes and every version ever written, enforced by S3 itself, independent of Open Archiver's code, its database, or its credentials. But **the application — its archive UI, `get()`, `exists()` — is not where you verify that guarantee**, because it only ever shows you the current version, and both a delete marker and an overwrite look, from that view, exactly like an ordinary successful delete or update. In short: the data is physically safe, but the application will not show you that directly.

If you need to demonstrate to an auditor that a specific archived item is still intact, or you need to recover something that looks "deleted" or "changed" in the application, go around the application and query S3's versioning directly — `ListObjectVersions` on the object key to see every version and any delete markers, then `GetObject` / `GetObjectRetention` with the specific `VersionId` to read or confirm the protected version. Do not treat the application's normal screens as evidence of the guarantee either way.

This is a known, deliberate limitation of the current release, not an oversight: `IStorageProvider`/`S3StorageProvider` have no version-aware read or delete path today, so closing this gap would mean extending that interface end-to-end. It is tracked as future work rather than fixed here.

### Local filesystem storage is not WORM

`STORAGE_TYPE=local` provides **no real WORM guarantee**. It is a plain filesystem: the same OS user that runs Open Archiver already has write and delete permission on it (it needs that for normal ingestion), and anyone with OS-level access to the host — a compromised application process, an administrator with shell access, a container escape — can modify or delete archived files with no vendor-enforced or cryptographic barrier stopping them. If your compliance requirement is a real, audit-defensible WORM guarantee, use the S3 backend with Object Lock in COMPLIANCE mode described above; that guarantee is enforced by the storage layer itself, independent of Open Archiver's own code, its database, or its credentials.

The measures below are **deterrence, not WORM**. Each one can be bypassed by whoever has root/administrator privileges on the host — that is a fundamental limit of any OS-level control compared to Object Lock, not a bug in how it's configured here.

- **Dedicated mount.** Put `STORAGE_LOCAL_ROOT_PATH` on its own partition or volume, separate from the application and the OS. This limits the blast radius of an unrelated filesystem incident (a `rm -rf` typo elsewhere, a disk-full condition on another volume) and makes it possible to remount the volume read-only for periods where no new archival writes are expected.
- **Restrictive Unix permissions.** Run the Open Archiver process under a dedicated, unprivileged user. Do not make the storage root group- or world-writable. Consider a periodic job that changes completed subdirectories to `500` (read + execute only, no write) for the owning user once you are confident no further writes are expected there — this removes the running application's own casual ability to overwrite or delete without first explicitly reversing the permission change.
- **`chattr +i` (immutable flag) — Linux only, and only on filesystems that support extended attributes** (ext2/3/4, XFS, Btrfs; **not** overlayfs, which is what many container runtimes use for the root filesystem — this generally still works if `STORAGE_LOCAL_ROOT_PATH` is a bind mount or named volume backed by a real filesystem on the host, which is the setup this project's `docker-compose.yml` uses, but verify on your own host). Setting this flag means even the owning process cannot write, truncate, rename, or delete the file without first clearing the flag with `chattr -i`, which itself requires root or the `CAP_LINUX_IMMUTABLE` capability.

    Open Archiver can set this automatically: set `STORAGE_LOCAL_HARDEN_IMMUTABLE=true` in `.env`. After each successful write, `LocalFileSystemProvider` attempts `chattr +i` on the file, best-effort — it is skipped entirely on non-Linux platforms, and any failure (missing `chattr` binary, unsupported filesystem, insufficient privilege) is logged and does **not** fail the write, since local storage is not real WORM regardless of whether the flag succeeds.

    **This also blocks Open Archiver's own later deletion of that file**, including any retention-policy-driven expiry — until an operator manually runs `chattr -i` on it, deletion of that specific file will fail. That is the deterrence model working as intended (nobody, including the running application, can casually undo it), but it means you should not enable this flag on a deployment where automatic retention-expiry deletion of local-storage objects is something you rely on, without also planning for the manual `chattr -i` step that expiry would then require.

---

## Health Check

The SMTP listener exposes a health endpoint:

```
GET /v1/enterprise/journaling/health
```

Returns `200` with `{ "smtp": "listening", "port": "2525" }` when healthy, or `503` when the listener is down.

---

## Troubleshooting

### SMTP listener not starting

Check the application logs for errors like "Failed to start SMTP journaling listener". Common causes:

- Port already in use by another process.
- Missing database migration (the `journaling_sources` table must exist).
- The Journaling feature is not enabled in the license.

### Emails not being received

1. Verify the MX record resolves correctly: `dig MX journal.yourdomain.com`
2. Verify the port is reachable: `telnet archiver.yourdomain.com 2525`
3. Check the allowed IPs on the journaling source match the MTA's outbound IP.
4. If SMTP AUTH is configured, ensure the MTA is sending credentials.
5. Check application logs for rejection messages (IP not whitelisted, TLS required, authentication required).

### Emails filed under wrong mailbox

If archived emails are appearing under unexpected mailbox addresses (e.g., `default_fallback@company.com` or an external sender's address), the **Organization Domains** configuration may be missing or incomplete.

1. Edit the journaling source and add Organization Domain Groups covering your company's domains.
2. If you have alias or legacy domains, add them as aliases under the correct primary domain.
3. New emails received after saving will use the updated configuration. Previously archived emails are not retroactively re-filed.

### Queue backpressure (4xx errors)

If the MTA receives temporary 4xx failures, the journal-inbound queue has exceeded the backpressure threshold. This means workers can't keep up with inbound volume. Solutions:

- Increase `JOURNAL_QUEUE_BACKPRESSURE_THRESHOLD` if the server has capacity.
- Scale up the journaling worker processes.
- Check for processing errors in the worker logs.
