-- Leave Management Phase 2D freezes approved Leave evidence at the existing
-- Attendance Timesheet and Payroll snapshot boundaries. No current Leave
-- policy, balance or request is queried by Payroll calculation.
ALTER TABLE "attendance_timesheet_p2_day_snapshots"
  ADD COLUMN "leave_request_id_snapshot" UUID,
  ADD COLUMN "leave_request_revision_snapshot" INTEGER,
  ADD COLUMN "leave_request_digest_snapshot" CHAR(64),
  ADD COLUMN "leave_policy_id_snapshot" UUID,
  ADD COLUMN "leave_policy_version_id_snapshot" UUID,
  ADD COLUMN "leave_policy_name_snapshot" TEXT,
  ADD COLUMN "leave_pay_treatment_snapshot" "LeavePayTreatment",
  ADD COLUMN "leave_unit_snapshot" "LeaveUnit",
  ADD COLUMN "leave_legal_status_snapshot" "LeaveLegalStatus",
  ADD COLUMN "leave_jurisdiction_code_snapshot" VARCHAR(32),
  ADD COLUMN "leave_statutory_rule_set_version_snapshot" VARCHAR(40),
  ADD COLUMN "leave_statutory_rule_set_status_snapshot" "LeaveStatutoryRuleSetStatus",
  ADD COLUMN "leave_statutory_category_snapshot" "LeaveStatutoryCategory",
  ADD COLUMN "leave_statutory_eligibility_snapshot" JSONB,
  ADD COLUMN "leave_statutory_pay_treatment_snapshot" JSONB,
  ADD COLUMN "leave_compliance_status_snapshot" "LeaveComplianceStatus";

CREATE INDEX "attendance_timesheet_p2_day_snapshots_business_id_leave_request_id_snapshot_idx"
  ON "attendance_timesheet_p2_day_snapshots"("business_id", "leave_request_id_snapshot");

ALTER TABLE "payroll_attendance_input_snapshots"
  ADD COLUMN "leave_facts" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "leave_category_breakdown" JSONB NOT NULL DEFAULT '[]'::jsonb;
