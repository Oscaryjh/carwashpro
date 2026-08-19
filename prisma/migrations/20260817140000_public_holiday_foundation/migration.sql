CREATE TYPE "HolidayType" AS ENUM ('PUBLIC_HOLIDAY', 'COMPANY_HOLIDAY', 'SPECIAL_CLOSURE');
CREATE TYPE "HolidaySource" AS ENUM ('OFFICIAL', 'CUSTOM');
CREATE TYPE "HolidayScope" AS ENUM ('NATIONAL', 'STATE', 'BUSINESS', 'BRANCH');
CREATE TYPE "HolidayStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'CANCELLED');

ALTER TABLE "branches"
  ADD COLUMN "country_code" VARCHAR(2) NOT NULL DEFAULT 'MY',
  ADD COLUMN "state_code" VARCHAR(12);

ALTER TABLE "attendance_timesheet_revision_entries"
  ADD COLUMN "holiday_context_snapshot" JSONB;

ALTER TABLE "attendance_timesheet_p2_day_snapshots"
  ADD COLUMN "holiday_context_snapshot" JSONB;

CREATE TABLE "holiday_occurrences" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID,
  "work_date" DATE NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "holiday_type" "HolidayType" NOT NULL,
  "source" "HolidaySource" NOT NULL,
  "scope" "HolidayScope" NOT NULL,
  "country_code" VARCHAR(2) NOT NULL DEFAULT 'MY',
  "state_code" VARCHAR(12),
  "statutory" BOOLEAN NOT NULL DEFAULT false,
  "official_reference" VARCHAR(500),
  "status" "HolidayStatus" NOT NULL DEFAULT 'ACTIVE',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "supersedes_holiday_id" UUID,
  "reason" VARCHAR(500),
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "holiday_occurrences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "holiday_occurrences_business_id_work_date_name_revision_key"
  ON "holiday_occurrences"("business_id", "work_date", "name", "revision");
CREATE INDEX "holiday_occurrences_business_id_work_date_status_idx"
  ON "holiday_occurrences"("business_id", "work_date", "status");
CREATE INDEX "holiday_occurrences_business_id_branch_id_work_date_status_idx"
  ON "holiday_occurrences"("business_id", "branch_id", "work_date", "status");
CREATE INDEX "holiday_occurrences_business_id_country_code_state_code_work_date_status_idx"
  ON "holiday_occurrences"("business_id", "country_code", "state_code", "work_date", "status");

ALTER TABLE "holiday_occurrences"
  ADD CONSTRAINT "holiday_occurrences_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "holiday_occurrences"
  ADD CONSTRAINT "holiday_occurrences_branch_id_business_id_fkey"
  FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "holiday_occurrences"
  ADD CONSTRAINT "holiday_occurrences_supersedes_holiday_id_fkey"
  FOREIGN KEY ("supersedes_holiday_id") REFERENCES "holiday_occurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "holiday_occurrences"
  ADD CONSTRAINT "holiday_occurrences_scope_fields_check" CHECK (
    ("scope" = 'BRANCH' AND "branch_id" IS NOT NULL) OR
    ("scope" = 'STATE' AND "branch_id" IS NULL AND "state_code" IS NOT NULL) OR
    ("scope" IN ('NATIONAL', 'BUSINESS') AND "branch_id" IS NULL)
  );
