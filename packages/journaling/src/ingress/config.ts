import { z } from 'zod';
import { spoolConfigSchema } from '../spool/config';

/**
 * `apps/smtp-ingress` process configuration (`JR-4-01`), validated with `zod` per CLAUDE.md
 * section 5.6 and following the shape of `../spool/config.ts` (`JR-3-01`), which this schema
 * embeds rather than duplicates.
 *
 * ---------------------------------------------------------------------------------------------
 * Scope: only what this slice uses
 * ---------------------------------------------------------------------------------------------
 * `JR-4-01`'s acceptance criteria are about the process boundary (starts standalone, no forbidden
 * imports, a clear message on bad configuration) -- not about the SMTP protocol itself. Fields for
 * `PIPELINING`/`8BITMIME`/`SMTPUTF8`/`SIZE`/timeouts (`JR-4-02`), TLS (`JR-4-04`), ACLs (`JR-4-05`)
 * and rate limits (`JR-4-08`) are deliberately **not** here: none of them is read by anything this
 * slice builds, and adding them now would be exactly the speculative configuration the Product
 * Owner asked not to carry. They join this schema in the tasks that consume them.
 *
 * Two fields earn their place because this slice genuinely uses them:
 *  - `smtpPort`: the skeleton binds a bare `net.createServer()` on this port so that "the process
 *    starts and stays up" is an observable, connectable fact rather than an unverifiable claim.
 *    The real ESMTP protocol handling is `JR-4-02`.
 *  - `spool`: the process owns the spool per the privilege-separation table in
 *    `docs/dev/journaling/02-architektur.md` section 1, and this skeleton calls
 *    `ensureSpoolLayout()` at startup so the directory structure exists before anything is ever
 *    written to it -- architecture section 5 notes the startup order has to be able to
 *    accommodate the crash-recovery scan later, and creating the directories is the first step of
 *    that order.
 *
 * ---------------------------------------------------------------------------------------------
 * Why this package validates the shaped object, not `process.env` (`JR-4-01`)
 * ---------------------------------------------------------------------------------------------
 * Per `../spool/config.ts`'s own doc comment, mapping environment variables into this shape is
 * `apps/smtp-ingress`'s job, not this package's -- `docs/dev/journaling/02-architektur.md` section 2
 * requires configuration to be **injected**, never read by this package from ambient environment
 * state. `apps/smtp-ingress/src/config-from-env.ts` does that mapping and is the only place that
 * reads `process.env` for this process.
 */
export const ingressConfigSchema = z.object({
	/** TCP port the SMTP listener binds. `JR-4-02` replaces the placeholder listener this binds. */
	smtpPort: z.coerce.number().int().min(1, 'smtpPort must be between 1 and 65535').max(65535),
	/** Spool configuration this process owns (`../spool/config.ts`, `JR-3-01`). */
	spool: spoolConfigSchema,
	/** Log verbosity. Optional -- a missing value is not a configuration error. */
	logLevel: z
		.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
		.optional()
		.default('info'),
});

export type IngressConfig = z.infer<typeof ingressConfigSchema>;

/** Parse and validate the ingress process configuration. Throws a `ZodError` on anything invalid. */
export function parseIngressConfig(input: unknown): IngressConfig {
	return ingressConfigSchema.parse(input);
}

/**
 * Turn a configuration error into the message `apps/smtp-ingress` prints on startup failure.
 *
 * This is the logic behind the `JR-4-01` acceptance criterion "fehlende Konfiguration führt zu
 * einer klaren Startmeldung, nicht zu einem Import-Crash": a `ZodError` becomes one line per
 * invalid field, naming the field and what is wrong with it -- never a raw stack trace, and never
 * the stack of whatever validated it. Anything that is not a `ZodError` (e.g. `EADDRINUSE` from
 * the placeholder listener, or a filesystem error creating the spool directories) falls back to
 * its own message rather than being rethrown, so the caller has exactly one thing to print.
 */
export function formatIngressConfigError(error: unknown): string {
	if (error instanceof z.ZodError) {
		const lines = error.issues.map((issue) => {
			const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
			return `  - ${path}: ${issue.message}`;
		});
		return ['smtp-ingress: configuration invalid, refusing to start:', ...lines].join('\n');
	}
	const message = error instanceof Error ? error.message : String(error);
	return `smtp-ingress: failed to start: ${message}`;
}
