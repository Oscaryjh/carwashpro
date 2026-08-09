BEGIN;

ALTER TYPE "PayrollEntryComponentSourceType" ADD VALUE IF NOT EXISTS 'STATUTORY';

CREATE TYPE "StatutoryScheme" AS ENUM ('EPF', 'SOCSO', 'EIS', 'PCB');
CREATE TYPE "StatutoryRuleSetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "StatutoryRuleReadiness" AS ENUM ('METADATA_ONLY', 'DATASET_VERIFIED', 'CALCULATION_VERIFIED');
CREATE TYPE "StatutoryComponentTreatment" AS ENUM ('INCLUDED', 'EXCLUDED', 'ADDITIONAL_REMUNERATION', 'UNKNOWN');
CREATE TYPE "StatutoryCalculationSource" AS ENUM ('CALCULATED', 'MANUAL_OFFICIAL_PORTAL', 'IMPORTED', 'BLOCKED', 'NOT_APPLICABLE');
CREATE TYPE "StatutorySnapshotStatus" AS ENUM ('CALCULATED', 'MANUAL', 'BLOCKED', 'NOT_APPLICABLE');

CREATE TABLE "statutory_rule_sets" (
  "id" UUID NOT NULL,
  "scheme" "StatutoryScheme" NOT NULL,
  "version" VARCHAR(100) NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "authority" VARCHAR(80) NOT NULL,
  "source_reference" VARCHAR(500) NOT NULL,
  "source_document_name" VARCHAR(200) NOT NULL,
  "source_digest" CHAR(64),
  "dataset_row_count" INTEGER,
  "readiness" "StatutoryRuleReadiness" NOT NULL DEFAULT 'METADATA_ONLY',
  "status" "StatutoryRuleSetStatus" NOT NULL DEFAULT 'DRAFT',
  "rule_data" JSONB,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID,
  CONSTRAINT "statutory_rule_sets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "statutory_rule_sets_effective_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
  CONSTRAINT "statutory_rule_sets_verified_source_check" CHECK (
    "readiness" = 'METADATA_ONLY' OR ("source_digest" IS NOT NULL AND "dataset_row_count" IS NOT NULL AND "dataset_row_count" > 0)
  )
);

CREATE UNIQUE INDEX "statutory_rule_sets_scheme_version_key" ON "statutory_rule_sets"("scheme", "version");
CREATE INDEX "statutory_rule_sets_scheme_status_effective_from_effective_to_idx" ON "statutory_rule_sets"("scheme", "status", "effective_from", "effective_to");

CREATE TABLE "statutory_component_classifications" (
  "id" UUID NOT NULL,
  "rule_set_id" UUID NOT NULL,
  "scheme" "StatutoryScheme" NOT NULL,
  "component_code" VARCHAR(64) NOT NULL,
  "source_type" "PayrollEntryComponentSourceType",
  "treatment" "StatutoryComponentTreatment" NOT NULL,
  "rationale" VARCHAR(500) NOT NULL,
  "authority_ref" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "statutory_component_classifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "statutory_component_classifications_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "statutory_rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "statutory_component_classifications_unique" ON "statutory_component_classifications"("rule_set_id", "scheme", "component_code", "source_type");
CREATE INDEX "statutory_component_classifications_lookup_idx" ON "statutory_component_classifications"("scheme", "component_code", "source_type");

CREATE TABLE "employee_statutory_profile_versions" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "date_of_birth" DATE,
  "statutory_nationality" "EmployeeStatutoryNationality",
  "epf_enabled" BOOLEAN NOT NULL,
  "epf_member_before_aug_1998" BOOLEAN NOT NULL,
  "socso_enabled" BOOLEAN NOT NULL,
  "socso_category" "EmployeeSocsoCategory",
  "eis_enabled" BOOLEAN NOT NULL,
  "eis_previously_contributed" BOOLEAN NOT NULL,
  "lindung_24_opt_in" BOOLEAN NOT NULL,
  "tax_profile_revision" INTEGER NOT NULL,
  "source_digest" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID,
  CONSTRAINT "employee_statutory_profile_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_statutory_profile_versions_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "employee_statutory_profile_versions_membership_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "employee_statutory_profile_versions_id_business_membership_key" ON "employee_statutory_profile_versions"("id", "business_id", "membership_id");
CREATE UNIQUE INDEX "employee_statutory_profile_versions_membership_revision_key" ON "employee_statutory_profile_versions"("membership_id", "revision");
CREATE INDEX "employee_statutory_profile_versions_business_membership_created_idx" ON "employee_statutory_profile_versions"("business_id", "membership_id", "created_at");

CREATE TABLE "payroll_entry_statutory_snapshots" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "payroll_run_id" UUID NOT NULL,
  "payroll_entry_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "scheme" "StatutoryScheme" NOT NULL,
  "status" "StatutorySnapshotStatus" NOT NULL,
  "calculation_source" "StatutoryCalculationSource" NOT NULL,
  "rule_set_id" UUID,
  "rule_version_snapshot" VARCHAR(100),
  "profile_version_id" UUID,
  "profile_revision_snapshot" INTEGER NOT NULL,
  "tax_profile_revision_snapshot" INTEGER NOT NULL,
  "wage_base" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "employee_contribution" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "employer_contribution" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "blocker_code" VARCHAR(100),
  "calculation_metadata" JSONB NOT NULL DEFAULT '{}',
  "source_digest" CHAR(64) NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_entry_statutory_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_entry_statutory_snapshots_amounts_check" CHECK ("wage_base" >= 0 AND "employee_contribution" >= 0 AND "employer_contribution" >= 0),
  CONSTRAINT "payroll_entry_statutory_snapshots_blocker_check" CHECK (("status" = 'BLOCKED') = ("blocker_code" IS NOT NULL)),
  CONSTRAINT "payroll_entry_statutory_snapshots_run_fkey" FOREIGN KEY ("payroll_run_id", "business_id") REFERENCES "payroll_runs"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_entry_statutory_snapshots_entry_fkey" FOREIGN KEY ("payroll_entry_id", "business_id", "membership_id") REFERENCES "payroll_entries"("id", "business_id", "membership_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "payroll_entry_statutory_snapshots_membership_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_entry_statutory_snapshots_rule_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "statutory_rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_entry_statutory_snapshots_profile_fkey" FOREIGN KEY ("profile_version_id", "business_id", "membership_id") REFERENCES "employee_statutory_profile_versions"("id", "business_id", "membership_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payroll_entry_statutory_snapshots_entry_scheme_key" ON "payroll_entry_statutory_snapshots"("payroll_entry_id", "scheme");
CREATE UNIQUE INDEX "payroll_entry_statutory_snapshots_id_business_key" ON "payroll_entry_statutory_snapshots"("id", "business_id");
CREATE INDEX "payroll_entry_statutory_snapshots_business_run_scheme_idx" ON "payroll_entry_statutory_snapshots"("business_id", "payroll_run_id", "scheme");
CREATE INDEX "payroll_entry_statutory_snapshots_business_membership_idx" ON "payroll_entry_statutory_snapshots"("business_id", "membership_id");

CREATE TABLE "payroll_component_statutory_treatment_snapshots" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "payroll_entry_id" UUID NOT NULL,
  "component_id" UUID NOT NULL,
  "scheme" "StatutoryScheme" NOT NULL,
  "treatment" "StatutoryComponentTreatment" NOT NULL,
  "classification_id" UUID,
  "rule_version_snapshot" VARCHAR(100),
  "rationale_snapshot" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_component_statutory_treatment_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_component_statutory_treatment_snapshots_component_fkey" FOREIGN KEY ("component_id") REFERENCES "payroll_entry_components"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "payroll_component_statutory_treatment_snapshots_classification_fkey" FOREIGN KEY ("classification_id") REFERENCES "statutory_component_classifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payroll_component_statutory_treatment_component_scheme_key" ON "payroll_component_statutory_treatment_snapshots"("component_id", "scheme");
CREATE INDEX "payroll_component_statutory_treatment_business_entry_scheme_idx" ON "payroll_component_statutory_treatment_snapshots"("business_id", "payroll_entry_id", "scheme");

CREATE OR REPLACE FUNCTION tetamu_guard_statutory_rule_overlap()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'ACTIVE' AND EXISTS (
    SELECT 1 FROM statutory_rule_sets existing
    WHERE existing.scheme = NEW.scheme
      AND existing.status = 'ACTIVE'
      AND existing.id <> NEW.id
      AND daterange(existing.effective_from, existing.effective_to, '[)') && daterange(NEW.effective_from, NEW.effective_to, '[)')
  ) THEN
    RAISE EXCEPTION 'STATUTORY_RULE_EFFECTIVE_DATE_OVERLAP';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER statutory_rule_sets_overlap_guard
BEFORE INSERT OR UPDATE ON statutory_rule_sets
FOR EACH ROW EXECUTE FUNCTION tetamu_guard_statutory_rule_overlap();

CREATE OR REPLACE FUNCTION tetamu_guard_statutory_snapshot_mutation()
RETURNS trigger AS $$
DECLARE run_status "PayrollRunStatus";
BEGIN
  SELECT status INTO run_status FROM payroll_runs WHERE id = COALESCE(OLD.payroll_run_id, NEW.payroll_run_id);
  IF run_status = 'FINALIZED' THEN
    RAISE EXCEPTION 'FINALIZED_STATUTORY_SNAPSHOT_IMMUTABLE';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_entry_statutory_snapshots_immutable
BEFORE UPDATE OR DELETE ON payroll_entry_statutory_snapshots
FOR EACH ROW EXECUTE FUNCTION tetamu_guard_statutory_snapshot_mutation();

CREATE OR REPLACE FUNCTION tetamu_reject_immutable_statutory_history()
RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'IMMUTABLE_STATUTORY_HISTORY'; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER employee_statutory_profile_versions_immutable
BEFORE UPDATE OR DELETE ON employee_statutory_profile_versions
FOR EACH ROW EXECUTE FUNCTION tetamu_reject_immutable_statutory_history();

COMMIT;
