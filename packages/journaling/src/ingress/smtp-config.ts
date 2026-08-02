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
});

export type SmtpServerConfig = z.infer<typeof smtpServerConfigSchema>;
