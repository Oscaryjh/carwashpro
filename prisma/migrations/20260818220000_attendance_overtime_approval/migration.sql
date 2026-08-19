CREATE TYPE "AttendanceOvertimeApprovalStatus" AS ENUM (
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'ADJUSTED',
  'NOT_APPLICABLE'
);

CREATE TYPE "AttendanceOvertimeContext" AS ENUM (
  'NORMAL',
  'REST_DAY',
  'PUBLIC_HOLIDAY'
);

CREATE TYPE "AttendanceOvertimeEventType" AS ENUM (
  'OT_REVIEW_CREATED',
  'OT_APPROVED',
  'OT_REJECTED',
  'OT_ADJUSTED',
  'OT_REOPENED'
);

CREATE TABLE "attendance_overtime_reviews" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "final_result_id" UUID NOT NULL,
  "final_result_version" INTEGER NOT NULL,
  "expected_day_id" UUID,
  "status" "AttendanceOvertimeApprovalStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "context" "AttendanceOvertimeContext" NOT NULL,
  "potential_ot_minutes" INTEGER NOT NULL,
  "approved_ot_minutes" INTEGER NOT NULL DEFAULT 0,
  "source_digest" VARCHAR(64) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "reviewed_by_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_overtime_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendance_overtime_review_events" (
  "id" UUID NOT NULL,
  "review_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "type" "AttendanceOvertimeEventType" NOT NULL,
  "review_revision" INTEGER NOT NULL,
  "potential_ot_minutes" INTEGER NOT NULL,
  "approved_ot_minutes" INTEGER NOT NULL,
  "context" "AttendanceOvertimeContext" NOT NULL,
  "actor_id" UUID NOT NULL,
  "reason" VARCHAR(500),
  "before_snapshot" JSONB,
  "after_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_overtime_review_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attendance_overtime_reviews_business_id_membership_id_work_date_key"
  ON "attendance_overtime_reviews"("business_id", "membership_id", "work_date");
CREATE UNIQUE INDEX "attendance_overtime_reviews_id_business_id_key"
  ON "attendance_overtime_reviews"("id", "business_id");
CREATE INDEX "attendance_overtime_reviews_business_id_branch_id_status_work_date_idx"
  ON "attendance_overtime_reviews"("business_id", "branch_id", "status", "work_date");
CREATE INDEX "attendance_overtime_reviews_business_id_final_result_id_final_result_version_idx"
  ON "attendance_overtime_reviews"("business_id", "final_result_id", "final_result_version");
CREATE INDEX "attendance_overtime_review_events_review_id_review_revision_idx"
  ON "attendance_overtime_review_events"("review_id", "review_revision");
CREATE INDEX "attendance_overtime_review_events_business_id_branch_id_created_at_idx"
  ON "attendance_overtime_review_events"("business_id", "branch_id", "created_at");
CREATE INDEX "attendance_overtime_review_events_business_id_membership_id_work_date_created_at_idx"
  ON "attendance_overtime_review_events"("business_id", "membership_id", "work_date", "created_at");

ALTER TABLE "attendance_overtime_review_events"
  ADD CONSTRAINT "attendance_overtime_review_events_review_id_fkey"
  FOREIGN KEY ("review_id") REFERENCES "attendance_overtime_reviews"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_timesheet_p2_day_snapshots"
  ADD COLUMN "potential_ot_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "approved_ot_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ot_context" "AttendanceOvertimeContext",
  ADD COLUMN "ot_approval_status" "AttendanceOvertimeApprovalStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN "ot_approval_ref" UUID,
  ADD COLUMN "ot_approval_revision" INTEGER;
