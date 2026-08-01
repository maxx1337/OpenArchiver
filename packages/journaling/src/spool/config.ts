import { z } from 'zod';

/**
 * Spool configuration (`JR-3-01`), validated with `zod` per CLAUDE.md section 5.6.
 *
 * Field names are camelCase, matching every other config shape in this repository, even though
 * `docs/dev/journaling/00-rfc.md` section 11's YAML sketch uses `spool.path` /
 * `spool.high_water_bytes`. Mapping from that YAML (or from environment variables) into this shape
 * is `apps/smtp-ingress`'s job (`JR-4-01`) -- this package never reads configuration from the
 * environment itself (`docs/dev/journaling/02-architektur.md` section 2: configuration is injected,
 * never imported).
 *
 * `highWaterBytes` is coerced from a string on purpose: it will most often arrive as an environment
 * variable or a YAML scalar that a loader has not necessarily parsed to a number yet, and the value
 * has to survive as a `bigint` (spool usage is summed as `bigint` in `./layout.ts` to avoid the
 * float precision cliff at 2^53 bytes -- unlikely at spool scale today, but a truncation bug that
 * only appears past 9 PB is exactly the kind of thing that should not be possible by construction).
 */
export const spoolConfigSchema = z.object({
	/** Absolute path to the spool root. `incoming/` and `quarantine/` live directly under it. */
	rootPath: z.string().min(1, 'spool.rootPath must not be empty'),
	/** Absolute byte budget for the whole spool (`incoming/` + `quarantine/`). Must be positive. */
	highWaterBytes: z.coerce.bigint().positive(),
});

export type SpoolConfig = z.infer<typeof spoolConfigSchema>;

/** Parse and validate a spool configuration. Throws a `ZodError` on anything invalid. */
export function parseSpoolConfig(input: unknown): SpoolConfig {
	return spoolConfigSchema.parse(input);
}
