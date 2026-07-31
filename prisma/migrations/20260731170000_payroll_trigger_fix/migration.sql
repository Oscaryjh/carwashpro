BEGIN;

-- Avoid evaluating OLD while inserting a payroll entry. PostgreSQL records do
-- not expose OLD during INSERT triggers, so the operation branch must be chosen
-- before the row value is accessed.
CREATE OR REPLACE FUNCTION "payroll_lock_finalized"() RETURNS TRIGGER AS $$
DECLARE
  run_status "PayrollRunStatus";
  target_run_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'payroll_runs' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."status" = 'FINALIZED' THEN
      RAISE EXCEPTION 'Finalized payroll runs are immutable.';
    END IF;

    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'payroll_entries' THEN
    IF TG_OP = 'DELETE' THEN
      target_run_id := OLD."payroll_run_id";
    ELSE
      target_run_id := NEW."payroll_run_id";
    END IF;

    SELECT "status"
      INTO run_status
      FROM "payroll_runs"
      WHERE "id" = target_run_id;

    IF run_status = 'FINALIZED' THEN
      RAISE EXCEPTION 'Entries in a finalized payroll run are immutable.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
