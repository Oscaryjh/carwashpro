ALTER TABLE "payroll_runs"
  ADD COLUMN "submitted_by_id" UUID,
  ADD COLUMN "submitted_at" TIMESTAMP(3);

UPDATE "payroll_runs"
SET
  "submitted_by_id" = "finalized_by_id",
  "submitted_at" = COALESCE("finalized_at", "updated_at")
WHERE "status" = 'FINALIZED';

ALTER TABLE "payroll_runs"
  DROP CONSTRAINT "payroll_runs_finalize_check";

ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "payroll_runs_finalize_check" CHECK (
    ("status" = 'DRAFT' AND "submitted_at" IS NULL AND "submitted_by_id" IS NULL AND "finalized_at" IS NULL AND "finalized_by_id" IS NULL) OR
    ("status" = 'REVIEW' AND "submitted_at" IS NOT NULL AND "finalized_at" IS NULL AND "finalized_by_id" IS NULL) OR
    ("status" = 'FINALIZED' AND "submitted_at" IS NOT NULL AND "finalized_at" IS NOT NULL)
  );

ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "payroll_runs_submitted_by_id_fkey"
  FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "payroll_runs_submitted_by_id_idx"
  ON "payroll_runs"("submitted_by_id");

CREATE OR REPLACE FUNCTION "payroll_lock_finalized"() RETURNS TRIGGER AS $$
DECLARE
  run_status "PayrollRunStatus";
  target_run_id UUID;
  reopen_token TEXT;
BEGIN
  IF TG_TABLE_NAME = 'payroll_runs' THEN
    IF TG_OP = 'DELETE' AND OLD."status" = 'FINALIZED' THEN
      RAISE EXCEPTION 'Finalized payroll runs are immutable.';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD."status" = 'FINALIZED' THEN
      reopen_token := current_setting('tetamu.payroll_reopen', TRUE);
      IF NOT (
        NEW."status" = 'DRAFT' AND
        reopen_token = OLD."id"::TEXT AND
        NEW."submitted_at" IS NULL AND
        NEW."submitted_by_id" IS NULL AND
        NEW."finalized_at" IS NULL AND
        NEW."finalized_by_id" IS NULL
      ) THEN
        RAISE EXCEPTION 'Finalized payroll runs are immutable.';
      END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'payroll_entries' THEN
    IF TG_OP = 'DELETE' THEN
      target_run_id := OLD."payroll_run_id";
    ELSE
      target_run_id := NEW."payroll_run_id";
    END IF;

    SELECT "status" INTO run_status
    FROM "payroll_runs"
    WHERE "id" = target_run_id;

    IF run_status IN ('REVIEW', 'FINALIZED') THEN
      RAISE EXCEPTION 'Entries in a reviewed or finalized payroll run are immutable.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
