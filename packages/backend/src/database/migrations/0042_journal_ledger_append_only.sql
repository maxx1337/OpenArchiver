-- Append-only enforcement for the ledger (JR-205, ADR-009).
--
-- A custom migration, not a generated one: drizzle-kit emits DDL derived from the schema and has no
-- representation for triggers. It was created with `drizzle-kit generate --custom` so the journal
-- entry and the file name follow the same sequence as every other migration.
--
-- WHAT THIS DOES AND DOES NOT PROTECT AGAINST -- read this before trusting it.
--
-- It stops `UPDATE`, `DELETE` and `TRUNCATE` on the two tables that carry the chain, for every role,
-- including the one the application connects as. That closes the path that matters in practice:
-- finding F1 showed that an application super-admin can inject raw SQL into a scoped query, and
-- without this trigger such an actor could rewrite a ledger row directly.
--
-- It does **not** stop someone who can `ALTER TABLE ... DISABLE TRIGGER`, `DROP TRIGGER`, or set
-- `session_replication_role = replica`. Those need table ownership or superuser, so the second half
-- of ADR-009 -- connecting the application as a role that owns nothing and holds no `UPDATE`/`DELETE`
-- grant -- is a deployment requirement, documented for E11. The trigger is the half that works
-- regardless of which role is used; the revocation is the half that works regardless of whether the
-- trigger is still in place. Neither alone is sufficient, which is why ADR-009 asks for both.
--
-- TRUNCATE needs its own statement-level trigger: it does not fire row-level triggers at all, so a
-- row trigger alone would leave `TRUNCATE journal_ledger` as an open door.

CREATE OR REPLACE FUNCTION journal_ledger_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION
		'% on % is refused: the journal ledger is append-only (JR-205, ADR-009).',
		TG_OP, TG_TABLE_NAME
		USING ERRCODE = 'restrict_violation',
			HINT = 'A ledger entry is never changed or removed. GDPR erasure appends an object_erased event and removes the object; it does not delete the receipt (RFC section 10).';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_ledger_append_only
	BEFORE UPDATE OR DELETE ON "journal_ledger"
	FOR EACH ROW EXECUTE FUNCTION journal_ledger_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER journal_ledger_no_truncate
	BEFORE TRUNCATE ON "journal_ledger"
	FOR EACH STATEMENT EXECUTE FUNCTION journal_ledger_reject_mutation();
--> statement-breakpoint
-- `deployment_identity` is in scope for the same reason: `deployment_id` sits inside the genesis hash
-- of every chain (ADR-006 section 4.2), so changing it invalidates every chain in the installation
-- just as surely as editing a ledger row would.
CREATE TRIGGER deployment_identity_append_only
	BEFORE UPDATE OR DELETE ON "deployment_identity"
	FOR EACH ROW EXECUTE FUNCTION journal_ledger_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER deployment_identity_no_truncate
	BEFORE TRUNCATE ON "deployment_identity"
	FOR EACH STATEMENT EXECUTE FUNCTION journal_ledger_reject_mutation();
