CREATE OR REPLACE FUNCTION "deny_expense_source_snapshot_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ExpenseSourceSnapshot is immutable';
END;
$$;

CREATE TRIGGER "expense_source_snapshots_immutable"
BEFORE UPDATE OR DELETE ON "expense_source_snapshots"
FOR EACH ROW
EXECUTE FUNCTION "deny_expense_source_snapshot_mutation"();
