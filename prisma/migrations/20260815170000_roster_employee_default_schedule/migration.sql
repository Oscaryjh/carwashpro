CREATE TYPE "EmployeeRosterRestPolicy" AS ENUM ('FIXED', 'VARIABLE');
CREATE TYPE "RosterResolvedSource" AS ENUM (
  'DEFAULT_SHIFT',
  'FIXED_REST',
  'VARIABLE_REST',
  'WEEKLY_SHIFT_OVERRIDE',
  'WEEKLY_REST_OVERRIDE',
  'WEEKLY_NOT_SCHEDULED_OVERRIDE',
  'CUSTOM_SHIFT'
);

ALTER TABLE "roster_shift_templates"
ADD COLUMN "short_code" VARCHAR(12),
ADD COLUMN "break_paid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "display_order" INTEGER NOT NULL DEFAULT 100;

ALTER TABLE "roster_assignments"
ADD COLUMN "break_paid_snapshot" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "roster_published_assignments"
ADD COLUMN "break_paid_snapshot" BOOLEAN NOT NULL DEFAULT false;

DROP INDEX IF EXISTS "roster_shift_templates_business_id_branch_id_active_idx";
CREATE INDEX "roster_shift_templates_business_id_branch_id_active_display_order_idx"
ON "roster_shift_templates"("business_id", "branch_id", "active", "display_order");

CREATE TABLE "employee_roster_schedule_versions" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_until" DATE,
  "revision" INTEGER NOT NULL,
  "default_shift_template_id" UUID,
  "shift_name_snapshot" VARCHAR(80),
  "shift_short_code_snapshot" VARCHAR(12),
  "shift_color_snapshot" VARCHAR(20),
  "start_minute_snapshot" INTEGER,
  "end_minute_snapshot" INTEGER,
  "cross_midnight_snapshot" BOOLEAN,
  "break_minutes_snapshot" INTEGER NOT NULL DEFAULT 0,
  "break_paid_snapshot" BOOLEAN NOT NULL DEFAULT false,
  "rest_policy" "EmployeeRosterRestPolicy" NOT NULL,
  "fixed_rest_weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "required_rest_days" INTEGER NOT NULL DEFAULT 0,
  "source_digest" CHAR(64) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_roster_schedule_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_roster_schedule_bounds" CHECK (
    ("effective_until" IS NULL OR "effective_until" >= "effective_from")
    AND "required_rest_days" >= 0 AND "required_rest_days" <= 7
    AND "break_minutes_snapshot" >= 0 AND "break_minutes_snapshot" < 1440
    AND "fixed_rest_weekdays" <@ ARRAY[1,2,3,4,5,6,7]::INTEGER[]
  )
);

CREATE UNIQUE INDEX "employee_roster_schedule_versions_id_business_id_key"
ON "employee_roster_schedule_versions"("id", "business_id");
CREATE UNIQUE INDEX "employee_roster_schedule_scope_revision_key"
ON "employee_roster_schedule_versions"("business_id", "branch_id", "membership_id", "revision");
CREATE INDEX "employee_roster_schedule_effective_idx"
ON "employee_roster_schedule_versions"("business_id", "branch_id", "membership_id", "effective_from", "effective_until");

ALTER TABLE "employee_roster_schedule_versions"
ADD CONSTRAINT "employee_roster_schedule_versions_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_roster_schedule_versions"
ADD CONSTRAINT "employee_roster_schedule_versions_branch_id_business_id_fkey"
FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_roster_schedule_versions"
ADD CONSTRAINT "employee_roster_schedule_versions_membership_id_business_id_fkey"
FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_roster_schedule_versions"
ADD CONSTRAINT "employee_roster_schedule_versions_default_shift_template_id_business_id_fkey"
FOREIGN KEY ("default_shift_template_id", "business_id") REFERENCES "roster_shift_templates"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_roster_schedule_versions"
ADD CONSTRAINT "employee_roster_schedule_versions_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "roster_published_assignments"
ALTER COLUMN "source_assignment_id" DROP NOT NULL,
ADD COLUMN "source_schedule_version_id" UUID,
ADD COLUMN "resolved_source" "RosterResolvedSource";

UPDATE "roster_published_assignments"
SET "resolved_source" = CASE
  WHEN "kind" = 'REST_DAY' THEN 'WEEKLY_REST_OVERRIDE'::"RosterResolvedSource"
  WHEN "kind" = 'NOT_SCHEDULED' THEN 'WEEKLY_NOT_SCHEDULED_OVERRIDE'::"RosterResolvedSource"
  WHEN "shift_template_id" IS NULL THEN 'CUSTOM_SHIFT'::"RosterResolvedSource"
  ELSE 'WEEKLY_SHIFT_OVERRIDE'::"RosterResolvedSource"
END;

ALTER TABLE "roster_published_assignments"
ALTER COLUMN "resolved_source" SET NOT NULL;

ALTER TABLE "roster_published_assignments"
ADD CONSTRAINT "roster_published_assignments_source_schedule_version_id_business_id_fkey"
FOREIGN KEY ("source_schedule_version_id", "business_id") REFERENCES "employee_roster_schedule_versions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "roster_published_assignments_source_schedule_version_id_idx"
ON "roster_published_assignments"("source_schedule_version_id");
