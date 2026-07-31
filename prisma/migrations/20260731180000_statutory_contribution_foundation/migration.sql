BEGIN;

CREATE TYPE "EmployeeStatutoryNationality" AS ENUM (
  'MALAYSIAN',
  'PERMANENT_RESIDENT',
  'NON_MALAYSIAN'
);

CREATE TYPE "EmployeeSocsoCategory" AS ENUM ('FIRST', 'SECOND');

CREATE TYPE "PayrollStatutoryStatus" AS ENUM (
  'NOT_CONFIGURED',
  'AUTO_CALCULATED',
  'REVIEW_REQUIRED',
  'MANUAL_OVERRIDE'
);

ALTER TABLE "employee_business_memberships"
  ADD COLUMN "date_of_birth" DATE,
  ADD COLUMN "statutory_nationality" "EmployeeStatutoryNationality",
  ADD COLUMN "epf_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "epf_member_before_aug_1998" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "socso_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "socso_category" "EmployeeSocsoCategory",
  ADD COLUMN "eis_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "eis_previously_contributed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lindung_24_opt_in" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "statutory_profile_updated_at" TIMESTAMP(3);

ALTER TABLE "payroll_entries"
  ADD COLUMN "epf_wage_base" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "perkeso_wage_base" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "lindung_24_employee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "statutory_status" "PayrollStatutoryStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
  ADD COLUMN "statutory_rule_version" TEXT,
  ADD COLUMN "statutory_calculated_at" TIMESTAMP(3),
  ADD COLUMN "statutory_warning" TEXT;

COMMENT ON COLUMN "employee_business_memberships"."statutory_nationality" IS
  'Statutory contribution classification; not a general identity or immigration record.';
COMMENT ON COLUMN "payroll_entries"."statutory_rule_version" IS
  'Version identifiers for the official schedules used for this payroll snapshot.';

COMMIT;
