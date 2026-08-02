CREATE OR REPLACE FUNCTION "validate_payroll_statutory_artifact_identity"()
RETURNS TRIGGER AS $$
DECLARE
  submission_record RECORD;
BEGIN
  SELECT
    "business_id",
    "payroll_run_id",
    "provider",
    "revision"
  INTO submission_record
  FROM "payroll_statutory_submissions"
  WHERE "id" = NEW."submission_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Statutory artifact submission does not exist.'
      USING ERRCODE = '23503';
  END IF;

  IF
    submission_record."business_id" <> NEW."business_id" OR
    submission_record."payroll_run_id" <> NEW."payroll_run_id" OR
    submission_record."provider" <> NEW."provider" OR
    submission_record."revision" <> NEW."revision"
  THEN
    RAISE EXCEPTION 'Statutory artifact identity does not match its submission.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_statutory_export_artifacts_identity_guard"
BEFORE INSERT ON "payroll_statutory_export_artifacts"
FOR EACH ROW EXECUTE FUNCTION "validate_payroll_statutory_artifact_identity"();
