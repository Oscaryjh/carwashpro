CREATE TABLE "payroll_payslip_publications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "payroll_run_id" UUID NOT NULL,
  "payroll_entry_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "document_bytes" BYTEA NOT NULL,
  "document_sha256" CHAR(64) NOT NULL,
  "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_by_id" UUID NOT NULL,
  CONSTRAINT "payroll_payslip_publications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payroll_payslip_publications_payroll_entry_id_key"
  ON "payroll_payslip_publications"("payroll_entry_id");
CREATE UNIQUE INDEX "payroll_payslip_publications_id_business_id_key"
  ON "payroll_payslip_publications"("id", "business_id");
CREATE UNIQUE INDEX "payroll_payslip_publications_entry_business_membership_key"
  ON "payroll_payslip_publications"("payroll_entry_id", "business_id", "membership_id");
CREATE INDEX "payroll_payslip_publications_business_id_payroll_run_id_idx"
  ON "payroll_payslip_publications"("business_id", "payroll_run_id");
CREATE INDEX "payroll_payslip_publications_business_id_membership_id_published_at_idx"
  ON "payroll_payslip_publications"("business_id", "membership_id", "published_at");

ALTER TABLE "payroll_payslip_publications"
  ADD CONSTRAINT "payroll_payslip_publications_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_payslip_publications_run_fkey"
  FOREIGN KEY ("payroll_run_id", "business_id") REFERENCES "payroll_runs"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_payslip_publications_entry_fkey"
  FOREIGN KEY ("payroll_entry_id", "business_id", "membership_id") REFERENCES "payroll_entries"("id", "business_id", "membership_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_payslip_publications_membership_fkey"
  FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_payslip_publications_published_by_id_fkey"
  FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION payroll_payslip_publication_guard() RETURNS trigger AS $$
DECLARE
  run_status "PayrollRunStatus";
  entry_run_id UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Published payslips are immutable';
  END IF;
  SELECT "status" INTO run_status
  FROM "payroll_runs"
  WHERE "id" = NEW."payroll_run_id" AND "business_id" = NEW."business_id";
  IF run_status IS DISTINCT FROM 'FINALIZED'::"PayrollRunStatus" THEN
    RAISE EXCEPTION 'Payslips can only be published from a finalized payroll run';
  END IF;
  SELECT "payroll_run_id" INTO entry_run_id
  FROM "payroll_entries"
  WHERE "id" = NEW."payroll_entry_id"
    AND "business_id" = NEW."business_id"
    AND "membership_id" = NEW."membership_id";
  IF entry_run_id IS DISTINCT FROM NEW."payroll_run_id" THEN
    RAISE EXCEPTION 'Payslip publication entry does not belong to the payroll run';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_payslip_publication_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON "payroll_payslip_publications"
FOR EACH ROW EXECUTE FUNCTION payroll_payslip_publication_guard();
