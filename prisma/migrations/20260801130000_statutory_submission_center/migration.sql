-- Malaysia statutory submission foundation. All new employee fields are nullable
-- so existing production rows remain valid and can be completed progressively.
CREATE TYPE "EmployeeStatutoryIdentityType" AS ENUM ('NEW_IC', 'OLD_IC', 'PASSPORT', 'OTHER');
CREATE TYPE "PayrollStatutoryProvider" AS ENUM ('EPF', 'PERKESO', 'PCB');
CREATE TYPE "PayrollStatutorySubmissionStatus" AS ENUM ('EXPORTED', 'SUBMITTED', 'ACCEPTED', 'REJECTED');

ALTER TABLE "employee_business_memberships"
  ADD COLUMN "statutory_identity_type" "EmployeeStatutoryIdentityType",
  ADD COLUMN "statutory_identity_number" TEXT,
  ADD COLUMN "statutory_country_code" TEXT,
  ADD COLUMN "epf_member_number" TEXT,
  ADD COLUMN "socso_member_number" TEXT,
  ADD COLUMN "tax_identification_number" TEXT;

CREATE TABLE "business_statutory_profiles" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "epf_employer_number" TEXT,
  "perkeso_employer_code" TEXT,
  "perkeso_registration_number" TEXT,
  "lhdn_employer_number_hq" TEXT,
  "lhdn_employer_number" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_statutory_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payroll_statutory_submissions" (
  "id" UUID NOT NULL,
  "payroll_run_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "provider" "PayrollStatutoryProvider" NOT NULL,
  "status" "PayrollStatutorySubmissionStatus" NOT NULL DEFAULT 'EXPORTED',
  "export_version" TEXT NOT NULL,
  "exported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exported_by_id" UUID,
  "submitted_at" TIMESTAMP(3),
  "submitted_by_id" UUID,
  "resolved_at" TIMESTAMP(3),
  "resolved_by_id" UUID,
  "submission_reference" TEXT,
  "rejection_reason" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_statutory_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_statutory_profiles_business_id_key"
  ON "business_statutory_profiles"("business_id");
CREATE UNIQUE INDEX "payroll_statutory_submissions_payroll_run_id_provider_key"
  ON "payroll_statutory_submissions"("payroll_run_id", "provider");
CREATE INDEX "payroll_statutory_submissions_business_id_provider_status_created_at_idx"
  ON "payroll_statutory_submissions"("business_id", "provider", "status", "created_at");

ALTER TABLE "business_statutory_profiles"
  ADD CONSTRAINT "business_statutory_profiles_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_statutory_submissions"
  ADD CONSTRAINT "payroll_statutory_submissions_payroll_run_id_fkey"
  FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_statutory_submissions"
  ADD CONSTRAINT "payroll_statutory_submissions_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
