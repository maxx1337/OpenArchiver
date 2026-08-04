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

/**
 * ---------------------------------------------------------------------------------------------
 * `TLS_CIPHERS` -- an explicit TLS <= 1.2 cipher allow-list (`JR-4-21a`, finding F56)
 * ---------------------------------------------------------------------------------------------
 * Before this constant existed, `buildTlsSocketOptions()` (`smtp-server.ts`) set only `minVersion`,
 * so cipher selection under TLS 1.2 fell through to Node/OpenSSL's own default list -- which a
 * **client** can narrow, but which this server never narrowed itself. Measured directly against a
 * real `tls.TLSSocket({ isServer: true, secureContext, minVersion: 'TLSv1.2' })` built with exactly
 * that configuration: a client offering only `AES128-SHA` (`TLS_RSA_WITH_AES_128_CBC_SHA` -- plain
 * RSA key exchange, no forward secrecy, a SHA-1 MAC) negotiated it without objection.
 *
 * The risk is not an active attacker forcing a weak cipher -- TLS 1.2's `Finished` message binds the
 * negotiation cryptographically, so that is not on the table here. The risk is a legitimate but
 * outdated sender (an old Exchange server, a misconfigured relay) that offers nothing better than
 * `AES128-SHA` by default: its journal mail -- for a system whose entire purpose is archiving
 * sensitive content -- would then travel with no forward secrecy. A later compromise of that
 * connection's (or the server's own) private key would let a recording attacker decrypt the
 * captured traffic retroactively, exactly what forward secrecy exists to rule out.
 *
 * This list is deliberately narrow rather than merely "better": every suite requires an ephemeral
 * Diffie-Hellman key exchange (`ECDHE`/`DHE`, so a compromised static key cannot decrypt past
 * sessions) and an AEAD cipher (`GCM`/`ChaCha20-Poly1305`, so there is no separate, SHA-1-or-weaker
 * MAC to exclude one at a time). It excludes every plain-RSA-key-exchange suite and every CBC/SHA-1
 * suite by construction, without needing to name them. Loosely modelled on Mozilla's "intermediate"
 * TLS guidance, narrowed further to forward-secrecy-only for this project's own reason above, not
 * copied verbatim.
 *
 * `ciphers` (an OpenSSL cipher list string) governs TLS 1.2 and below only -- TLS 1.3 negotiates its
 * own, separate, always-AEAD-and-forward-secret suite set and is unaffected by this string one way
 * or the other, which is exactly why `minVersion` alone was left with no ceiling above it (see that
 * field's own doc comment) and why this constant does not need a TLS-1.3-shaped counterpart: TLS 1.3
 * already has no non-forward-secret, non-AEAD suite to exclude.
 *
 * Like `TLS_MIN_VERSION`, this is a fixed floor rather than a schema field: there is no compliance
 * reason an operator would ever need to loosen it, and every other adjustable knob in this file's
 * sibling (`smtp-config.ts`) is adjustable specifically because there *is* such a reason for those.
 *
 * ---------------------------------------------------------------------------------------------
 * Where this constant is actually applied -- it is not `buildTlsSocketOptions()`
 * ---------------------------------------------------------------------------------------------
 * `EsmtpServer`'s constructor passes this string (plus `honorCipherOrder: true`) to
 * `tls.createSecureContext({ cert, key, ciphers, honorCipherOrder })` at process start, not per
 * connection. A first version of the fix instead added `ciphers` to the options object
 * `buildTlsSocketOptions()` (`smtp-server.ts`) returns for `new tls.TLSSocket(plainSocket, options)`
 * -- the natural-looking place, right next to `minVersion` -- but that option is silently ignored by
 * Node whenever a `secureContext` is already supplied, which is always the case here. Measured both
 * ways against a real server socket and a real TLS client handshake before trusting either:
 * setting `ciphers` per-socket alongside an existing `secureContext` changed nothing (a client
 * offering only `AES128-SHA` still got it), while the identical string passed to
 * `createSecureContext()` made the server correctly answer "no shared cipher" to that same client.
 * See `buildTlsSocketOptions()`'s own doc comment for the fuller account.
 */
export const TLS_CIPHERS =
	'ECDHE-ECDSA-AES128-GCM-SHA256:' +
	'ECDHE-RSA-AES128-GCM-SHA256:' +
	'ECDHE-ECDSA-AES256-GCM-SHA384:' +
	'ECDHE-RSA-AES256-GCM-SHA384:' +
	'ECDHE-ECDSA-CHACHA20-POLY1305:' +
	'ECDHE-RSA-CHACHA20-POLY1305:' +
	'DHE-RSA-AES128-GCM-SHA256:' +
	'DHE-RSA-AES256-GCM-SHA384';

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
