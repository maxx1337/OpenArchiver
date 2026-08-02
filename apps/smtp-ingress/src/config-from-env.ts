/**
 * Map environment variables into the shape `parseIngressConfig()` (`@open-archiver/journaling`)
 * validates.
 *
 * This is the mapping job that `packages/journaling/src/spool/config.ts`'s doc comment assigns to
 * `apps/smtp-ingress`: the package validates a shaped object and never reads `process.env` itself
 * (`docs/dev/journaling/02-architektur.md` section 2 -- configuration is injected, never imported).
 * Everything with a decision behind it -- field names, defaults, error wording -- lives in the zod
 * schema in the package, where it is unit-tested; this function is a plain name-to-name mapping
 * with nothing to decide, which is why it has no dedicated test of its own. The env-var choices it
 * makes are still exercised end-to-end by
 * `packages/journaling/tests/unit/ingress-process-boot.test.ts`, which spawns this process both
 * with and without them set.
 *
 * Takes an env-like record rather than reaching for `process.env` itself so the same function can
 * be pointed at a synthetic environment in a test without mutating the real one.
 */
export function readIngressConfigInput(env: NodeJS.ProcessEnv): unknown {
	return {
		smtpPort: env.SMTP_INGRESS_PORT,
		spool: {
			rootPath: env.SMTP_INGRESS_SPOOL_ROOT_PATH,
			highWaterBytes: env.SMTP_INGRESS_SPOOL_HIGH_WATER_BYTES,
		},
		logLevel: env.SMTP_INGRESS_LOG_LEVEL,
	};
}
