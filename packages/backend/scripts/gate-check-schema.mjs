/**
 * Tiny helper for `scripts/pre-push-gate.mjs` (the pre-push gate, tool infrastructure -- not an
 * E6 backlog task): reports whether `journal_ledger` exists at a given `DATABASE_URL`.
 *
 * Lives under `packages/backend/scripts/` rather than the root `scripts/` directory for exactly one
 * reason: `postgres` (the driver) is a `packages/backend` dependency, not a root one, and Node
 * resolves this file's own imports against `packages/backend/node_modules` because that is where the
 * file itself lives -- regardless of the working directory `node` was invoked from. That lets the
 * root gate script stay dependency-free rather than adding `postgres` (or a wrapper `pnpm --filter
 * ... exec`) just to answer one yes/no question.
 *
 * Why this question matters: the gate's whole point for this check is reproducing a class of bug
 * that only shows up against a **genuinely unmigrated** database -- `journal-inbound.worker.ts`'s
 * spawned child used to fall back to the raw `DATABASE_URL` instead of an isolated, migrated one
 * (fixed in `41c407e`), and that bug is invisible against a developer's own `DATABASE_URL` if it
 * happens to already carry the schema (true on at least one host measured in this project). The
 * gate answers "is this URL migrated" once, out loud, instead of assuming either answer.
 *
 * Usage: `node gate-check-schema.mjs <database-url>` -- prints exactly one line to stdout:
 *   `MIGRATED`     -- `journal_ledger` exists; this URL cannot exercise the bug class above.
 *   `UNMIGRATED`   -- it does not; safe to use as the gate's probe database.
 *   `UNREACHABLE:<message>` -- could not connect at all.
 * Always exits 0 -- the caller reads stdout, a nonzero exit here would look like the wrong kind of
 * failure (this script never fails the gate itself; not being able to answer is itself an answer).
 */
import postgres from 'postgres';

const url = process.argv[2];
if (!url) {
	console.log('UNREACHABLE:no database URL given');
	process.exit(0);
}

const sql = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} });
try {
	const rows = await sql`select to_regclass('journal_ledger') as exists`;
	console.log(rows[0]?.exists ? 'MIGRATED' : 'UNMIGRATED');
} catch (error) {
	console.log(`UNREACHABLE:${error instanceof Error ? error.message : String(error)}`);
} finally {
	await sql.end({ timeout: 2 }).catch(() => undefined);
}
