import { z } from 'zod';

/**
 * TLS configuration for the ESMTP protocol engine (`JR-4-04`), separate from `./smtp-config.ts` for
 * the same reason that file gives for its own existence: a sibling schema this task owns, embedded
 * rather than duplicated by `ingress/config.ts`.
 *
 * ---------------------------------------------------------------------------------------------
 * This schema validates loaded PEM content, never a file path
 * ---------------------------------------------------------------------------------------------
 * Per CLAUDE.md section 5.6 and `docs/dev/journaling/02-architektur.md` section 2, configuration is
 * injected into `packages/journaling`, never read by it from ambient environment state or the
 * filesystem. Reading `SMTP_INGRESS_TLS_CERT_PATH`/`SMTP_INGRESS_TLS_KEY_PATH` and loading the files
 * they name is `apps/smtp-ingress`'s job (`config-from-env.ts`) -- this package only ever sees the
 * resulting PEM strings, exactly as `../spool/config.ts`'s doc comment already establishes for
 * `rootPath` and every other path-shaped field in this process.
 *
 * ---------------------------------------------------------------------------------------------
 * Why `TLS_MIN_VERSION` is a constant, not a configurable field
 * ---------------------------------------------------------------------------------------------
 * `JR-4-04`'s acceptance criterion is "TLS 1.1 is rejected" -- a floor, not a dial an operator can
 * lower. Every other numeric/string knob in this file's sibling (`smtp-config.ts`) is deliberately
 * adjustable because there is no compliance reason to fix it; the TLS floor is the opposite case, so
 * it is a named export next to the schema rather than a schema field with a default. Node's own
 * default ceiling (currently TLSv1.3) is left alone rather than pinned, so a future Node upgrade that
 * raises the supported ceiling does not require a code change here.
 *
 * ---------------------------------------------------------------------------------------------
 * `requireTls`: a process-wide default, not the whole story
 * ---------------------------------------------------------------------------------------------
 * `journaling_sources.require_tls` (the database column a future task reads) is per **source**, but
 * at the moment a connection is accepted the source is not known yet -- it is derived from the
 * remote IP or the eventual `RCPT TO`, and loading it is `JR-4-05`'s job. `requireTls` here is
 * therefore process configuration: the default every connection starts with before any per-source
 * lookup exists. `../ingress/smtp-server.ts`'s `RequireTlsResolver` seam is where `JR-4-05` plugs in
 * a per-source answer -- see that type's doc comment for the rule that governs it: a source may only
 * **tighten** this default (require TLS where the process would not have), never loosen it.
 *
 * Defaults to `false`: a fresh installation with no certificate configured yet must still be able to
 * receive plaintext journal mail rather than refuse every connection outright. This mirrors
 * `docs/dev/journaling/02-architektur.md` section 4's description of Exchange Online's default mode
 * as *opportunistic* TLS, not mandatory -- the operator opts into `require_tls: true` deliberately,
 * they are not defaulted into a state that can silently stop accepting all mail.
 */
export const TLS_MIN_VERSION = 'TLSv1.2' as const;

const pemContent = z.string().min(1, 'must be non-empty PEM content, not a file path');

export const ingressTlsConfigSchema = z
	.object({
		/** PEM-encoded certificate (and, if applicable, its chain). `undefined` -- together with
		 * `key` -- means this deployment does not offer STARTTLS at all: `EHLO` never advertises it,
		 * and the bare `STARTTLS` command itself is answered `454 4.7.0`. */
		cert: pemContent.optional(),
		/** PEM-encoded private key matching `cert`. See that field's doc comment for what "absent"
		 * means. **Never** given a default in this schema -- there is no fallback certificate/key
		 * baked into this package or this process; the Product Owner's instruction was explicit that
		 * a checked-in key must never be able to appear as a configuration default. */
		key: pemContent.optional(),
		/** Process-wide default for whether a plaintext session may proceed past
		 * `EHLO`/`HELO`/`STARTTLS`/`NOOP`/`QUIT` (`JR-4-04`). See the module doc comment's
		 * "requireTls" section. */
		requireTls: z.coerce.boolean().optional().default(false),
	})
	.refine((v) => (v.cert === undefined) === (v.key === undefined), {
		message: 'cert and key must both be configured, or both left unset',
		path: ['key'],
	})
	.refine((v) => !v.requireTls || (v.cert !== undefined && v.key !== undefined), {
		message:
			'requireTls is true but no certificate/key is configured -- STARTTLS would never be ' +
			'offered, so every session would be refused with 530 and no mail could ever be accepted',
		path: ['requireTls'],
	});

export type IngressTlsConfig = z.infer<typeof ingressTlsConfigSchema>;
