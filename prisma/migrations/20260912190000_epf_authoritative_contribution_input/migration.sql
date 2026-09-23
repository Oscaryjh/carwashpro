CREATE TYPE "StatutoryContributionInputSourceType" AS ENUM (
  'EMPLOYEE_ELECTION',
  'OFFICIAL_REGULATOR_CASE',
  'EXTERNAL_PAYROLL_IMPORT',
  'STATUTORY_CORRECTION'
);

CREATE TYPE "StatutoryContributionInputStatus" AS ENUM ('VERIFIED', 'REVOKED');

CREATE TABLE "employee_statutory_contribution_inputs" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "scheme" "StatutoryScheme" NOT NULL,
  "contribution_month" DATE NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "StatutoryContributionInputStatus" NOT NULL,
  "employee_contribution" DECIMAL(12,2) NOT NULL,
  "normal_remuneration_employee_contribution" DECIMAL(12,2),
  "employee_rate_basis_points" INTEGER,
  "remuneration_basis" DECIMAL(12,2) NOT NULL,
  "applicability_confirmed" BOOLEAN NOT NULL DEFAULT false,
  "source_type" "StatutoryContributionInputSourceType" NOT NULL,
  "source_reference" VARCHAR(500) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "evidence_version" VARCHAR(100) NOT NULL,
  "evidence_nature" "StatutoryEvidenceNature" NOT NULL DEFAULT 'REAL',
  "evidence_environment" "StatutoryEvidenceEnvironment",
  "fixture_purpose" "StatutoryFixturePurpose",
  "official_export_eligible" BOOLEAN NOT NULL DEFAULT true,
  "source_digest" CHAR(64) NOT NULL,
  "recorded_by_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verified_by_id" UUID NOT NULL,
  "verified_at" TIMESTAMPTZ(3) NOT NULL,
  "supersedes_input_id" UUID,
  "superseded_at" TIMESTAMPTZ(3),
  CONSTRAINT "employee_statutory_contribution_inputs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "employee_statutory_contribution_inputs"
  ADD CONSTRAINT "employee_statutory_contribution_inputs_evidence_contract"
  CHECK (
    (
      "evidence_nature" = 'REAL'
      AND "evidence_environment" IS NULL
      AND "fixture_purpose" IS NULL
      AND "official_export_eligible" = TRUE
    )
    OR
    (
      "evidence_nature" = 'SYNTHETIC_TESTING'
      AND "evidence_environment" IS NOT NULL
      AND "fixture_purpose" IS NOT NULL
      AND "official_export_eligible" = FALSE
    )
  );

CREATE UNIQUE INDEX "employee_statutory_contribution_inputs_id_business_id_membership_id_key"
  ON "employee_statutory_contribution_inputs"("id", "business_id", "membership_id");
CREATE UNIQUE INDEX "employee_statutory_contribution_inputs_membership_id_scheme_contribution_month_revision_key"
  ON "employee_statutory_contribution_inputs"("membership_id", "scheme", "contribution_month", "revision");
CREATE UNIQUE INDEX "employee_statutory_contribution_inputs_supersedes_input_id_key"
  ON "employee_statutory_contribution_inputs"("supersedes_input_id");
CREATE INDEX "employee_statutory_contribution_inputs_business_id_membership_id_scheme_contribution_month_superseded_at_idx"
  ON "employee_statutory_contribution_inputs"("business_id", "membership_id", "scheme", "contribution_month", "superseded_at");

ALTER TABLE "employee_statutory_contribution_inputs"
  ADD CONSTRAINT "employee_statutory_contribution_inputs_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_statutory_contribution_inputs"
  ADD CONSTRAINT "employee_statutory_contribution_inputs_membership_id_business_id_fkey"
  FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_statutory_contribution_inputs"
  ADD CONSTRAINT "employee_statutory_contribution_inputs_recorded_by_id_fkey"
  FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_statutory_contribution_inputs"
  ADD CONSTRAINT "employee_statutory_contribution_inputs_verified_by_id_fkey"
  FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_statutory_contribution_inputs"
  ADD CONSTRAINT "employee_statutory_contribution_inputs_supersedes_input_id_fkey"
  FOREIGN KEY ("supersedes_input_id") REFERENCES "employee_statutory_contribution_inputs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_entry_statutory_snapshots"
  ADD COLUMN "statutory_contribution_input_id" UUID;
ALTER TABLE "payroll_entry_statutory_snapshots"
  ADD CONSTRAINT "payroll_entry_statutory_snapshots_contribution_input_fkey"
  FOREIGN KEY ("statutory_contribution_input_id", "business_id", "membership_id")
  REFERENCES "employee_statutory_contribution_inputs"("id", "business_id", "membership_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payroll_statutory_finalized_evidence_archive" (
  "source_snapshot_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "payroll_run_id" UUID NOT NULL,
  "payroll_entry_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "scheme" "StatutoryScheme" NOT NULL,
  "calculation_revision" INTEGER NOT NULL,
  "finalized_at" TIMESTAMP(3) NOT NULL,
  "snapshot_record" JSONB NOT NULL,
  CONSTRAINT "payroll_statutory_finalized_evidence_archive_pkey" PRIMARY KEY ("source_snapshot_id"),
  CONSTRAINT "statutory_archive_run_fk" FOREIGN KEY ("payroll_run_id", "business_id") REFERENCES "payroll_runs"("id", "business_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "statutory_archive_entry_fk" FOREIGN KEY ("payroll_entry_id", "business_id", "membership_id") REFERENCES "payroll_entries"("id", "business_id", "membership_id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX "statutory_archive_run_idx" ON "payroll_statutory_finalized_evidence_archive"("payroll_run_id", "business_id");
CREATE INDEX "statutory_archive_entry_idx" ON "payroll_statutory_finalized_evidence_archive"("payroll_entry_id", "business_id", "membership_id");

CREATE FUNCTION tetamu_archive_finalized_statutory_evidence() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'FINALIZED' AND NEW.status = 'FINALIZED' THEN
    INSERT INTO payroll_statutory_finalized_evidence_archive
      (source_snapshot_id, business_id, payroll_run_id, payroll_entry_id, membership_id,
       scheme, calculation_revision, finalized_at, snapshot_record)
    SELECT s.id, s.business_id, s.payroll_run_id, s.payroll_entry_id, s.membership_id,
           s.scheme, e.calculation_revision, NEW.finalized_at, to_jsonb(s)
    FROM payroll_entry_statutory_snapshots s
    JOIN payroll_entries e ON e.id = s.payroll_entry_id
    WHERE s.payroll_run_id = NEW.id
    ON CONFLICT (source_snapshot_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_statutory_archive_on_finalize
AFTER UPDATE OF status ON payroll_runs
FOR EACH ROW EXECUTE FUNCTION tetamu_archive_finalized_statutory_evidence();

CREATE FUNCTION tetamu_reject_statutory_archive_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PAYROLL_STATUTORY_FINALIZED_EVIDENCE_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_statutory_archive_immutable
BEFORE UPDATE OR DELETE ON payroll_statutory_finalized_evidence_archive
FOR EACH ROW EXECUTE FUNCTION tetamu_reject_statutory_archive_mutation();

CREATE FUNCTION tetamu_reject_contribution_input_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'STATUTORY_CONTRIBUTION_INPUT_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER statutory_contribution_input_append_only
BEFORE UPDATE OR DELETE ON employee_statutory_contribution_inputs
FOR EACH ROW EXECUTE FUNCTION tetamu_reject_contribution_input_mutation();
