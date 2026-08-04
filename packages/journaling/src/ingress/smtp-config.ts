import { z } from 'zod';

/**
 * Configuration for the ESMTP protocol engine (`JR-4-02`), separate from `./config.ts`'s
 * process-level `IngressConfig` the same way `../spool/config.ts` is: a sibling schema this task
 * owns, embedded rather than duplicated by `ingress/config.ts`.
 *
 * ---------------------------------------------------------------------------------------------
 * Why every default here is a named export, not a number inlined into the zod schema
 * ---------------------------------------------------------------------------------------------
 * The Product Owner's instruction for this slice was explicit: the `SIZE` default belongs in the
 * package as a named constant, not as a bare number in an option. The same reasoning applies to the
 * three timeouts -- each one is a value someone will need to cite (in a test, in an operator runbook,
 * in a future ADR) by name rather than by re-deriving "150 * 1024 * 1024" from context.
 */

/**
 * 150 MB (`docs/dev/journaling/00-rfc.md`, SIZE section): "Journal reports wrap the full original
 * message including attachments; the default must not be a 10 MB Postfix-ism." Exchange Online
 * journal reports routinely exceed typical inbound-mail size limits because they wrap the entire
 * original MIME structure a second time.
 */
export const DEFAULT_SMTP_SIZE_LIMIT_BYTES = 150 * 1024 * 1024;

/**
 * Backstop idle timeout for the whole connection, independent of protocol state -- the same
 * vocabulary `node:net`'s own `Socket.setTimeout()` uses. Not specified by RFC 5321 (which only
 * timespecifies per-command/per-block waits, see below); ten minutes comfortably exceeds every
 * other timeout in this file so it never fires ahead of the more specific one that should.
 */
export const DEFAULT_CONNECTION_TIMEOUT_MS = 10 * 60_000;

/**
 * RFC 5321 section 4.5.3.2 gives five minutes as the minimum acceptable timeout a client may assume
 * for the MAIL and RCPT commands; this reuses that figure for "waiting for the next command line" in
 * every non-DATA state, rather than inventing a different number for each command.
 */
export const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60_000;

/**
 * RFC 5321 section 4.5.3.2's "Data Block" minimum -- the time a client may assume the server will
 * wait between successive lines while `DATA` content is being transferred.
 */
export const DEFAULT_DATA_TIMEOUT_MS = 3 * 60_000;

/**
 * `JR-4-21a`, finding F55: `handleRcpt()` (`smtp-server.ts`) had no limit at all on the number of
 * `RCPT TO` commands one transaction could accumulate before `DATA`/`BDAT` even began. Measured
 * against the real, compiled server: 1,000,000 pipelined `RCPT TO` commands for an already-matched
 * recipient (~30 MB sent) all answered `250 2.1.5` correctly, in under 4 seconds, while the server's
 * own heap grew by ~395 MB -- a ~13x amplification with no upper bound at all.
 *
 * RFC 5321 section 4.5.3.1.8 requires a server to accept **at least** 100 recipients per message, so
 * this default -- and the schema's own floor below -- must never be set below that without becoming
 * a protocol violation. 1000 mirrors Postfix's own `smtpd_recipient_limit` default, a number real
 * mail transfer agents already assume is a reasonable ceiling before falling back to
 * recipient-splitting (see the `452 4.5.3` response in `handleRcpt()`, and ADR-027's own use of that
 * same code for a different reason -- "too many recipients" is RFC 5321's own wording for it).
 */
export const DEFAULT_MAX_RECIPIENTS_PER_TRANSACTION = 1000;

/**
 * Used in the `220`/`EHLO` greeting only. Deliberately not derived from `os.hostname()`: a
 * dynamic OS-dependent default would make the greeting non-deterministic across environments and
 * across test runs. Operators who care about the banner (recommended: a real FQDN) set
 * `SMTP_INGRESS_HOSTNAME` explicitly -- see `.env.example`.
 */
export const DEFAULT_SMTP_HOSTNAME = 'smtp-ingress';

export const smtpServerConfigSchema = z.object({
	/** Used only in the `220` greeting and the first line of the `EHLO` reply. */
	hostname: z.string().min(1).optional().default(DEFAULT_SMTP_HOSTNAME),
	/**
	 * Advertised via `EHLO`'s `SIZE` line (RFC 1870) and enforced against a `MAIL FROM` `SIZE=`
	 * parameter and against the running byte count of an in-progress `DATA`/`BDAT` transfer.
	 */
	sizeLimitBytes: z.coerce
		.number()
		.int()
		.positive('sizeLimitBytes must be a positive number of bytes')
		.optional()
		.default(DEFAULT_SMTP_SIZE_LIMIT_BYTES),
	/** Idle timeout for the whole connection (see the constant's doc comment above). */
	connectionTimeoutMs: z.coerce
		.number()
		.int()
		.positive('connectionTimeoutMs must be a positive number of milliseconds')
		.optional()
		.default(DEFAULT_CONNECTION_TIMEOUT_MS),
	/** Timeout waiting for the next command line while not inside `DATA`/`BDAT` content. */
	commandTimeoutMs: z.coerce
		.number()
		.int()
		.positive('commandTimeoutMs must be a positive number of milliseconds')
		.optional()
		.default(DEFAULT_COMMAND_TIMEOUT_MS),
	/** Timeout waiting for the next chunk of `DATA`/`BDAT` content once transfer has started. */
	dataTimeoutMs: z.coerce
		.number()
		.int()
		.positive('dataTimeoutMs must be a positive number of milliseconds')
		.optional()
		.default(DEFAULT_DATA_TIMEOUT_MS),
	/** Maximum number of `RCPT TO` commands one transaction may accumulate before further ones are
	 * refused with `452 4.5.3` (`JR-4-21a`, finding F55). `min(100, ...)` is not an arbitrary
	 * hardening choice -- RFC 5321 section 4.5.3.1.8 requires a server to accept at least 100
	 * recipients per message, so a lower configured value would be a protocol violation, not merely
	 * a strict setting. See {@link DEFAULT_MAX_RECIPIENTS_PER_TRANSACTION}'s own doc comment for the
	 * measurement behind the default. */
	maxRecipientsPerTransaction: z.coerce
		.number()
		.int()
		.min(100, 'maxRecipientsPerTransaction must be at least 100 (RFC 5321 section 4.5.3.1.8)')
		.optional()
		.default(DEFAULT_MAX_RECIPIENTS_PER_TRANSACTION),
});

export type SmtpServerConfig = z.infer<typeof smtpServerConfigSchema>;
