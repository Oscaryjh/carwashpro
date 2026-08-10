-- Claims & reimbursements are tenant-scoped and intentionally separate from salary earnings.
CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PARTIALLY_APPROVED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED');
CREATE TYPE "ClaimLineReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED');
CREATE TYPE "ClaimPolicyRevisionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');
CREATE TYPE "ClaimExpenseNature" AS ENUM ('GENERAL', 'MILEAGE');
CREATE TYPE "ClaimStatutoryTreatmentStatus" AS ENUM ('VERIFIED_NON_WAGE', 'REVIEW_REQUIRED');
CREATE TYPE "ClaimAttachmentMalwareStatus" AS ENUM ('NOT_SCANNED', 'PENDING', 'CLEAN', 'INFECTED', 'ERROR');
CREATE TYPE "ClaimAttachmentPrivacyStatus" AS ENUM ('NOT_CHECKED', 'DETECTED', 'SANITIZED', 'SAFE');
CREATE TYPE "ClaimReimbursementChannel" AS ENUM ('OUTSIDE_PAYROLL', 'PAYROLL');
CREATE TYPE "ClaimReimbursementStatus" AS ENUM ('AWAITING_CHANNEL', 'OUTSIDE_PAYROLL_PENDING', 'OUTSIDE_PAYROLL_PAID', 'PAYROLL_LINKED', 'PAYROLL_SETTLED', 'CANCELLED');
CREATE TYPE "ClaimPayrollBridgeStatus" AS ENUM ('BLOCKED_STATUTORY', 'READY', 'SETTLED', 'CANCELLED');
CREATE TYPE "ClaimEventType" AS ENUM ('DRAFT_CREATED', 'SUBMITTED', 'DUPLICATE_WARNING_RECORDED', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'WITHDRAWN', 'REIMBURSEMENT_CHANNEL_SELECTED', 'OUTSIDE_PAYROLL_PAID', 'PAYROLL_LINKED', 'PAYROLL_SETTLED', 'REIMBURSEMENT_CANCELLED', 'CLAIM_CANCELLED');

ALTER TABLE "businesses" ADD COLUMN "claim_sequence" INTEGER NOT NULL DEFAULT 1000;

CREATE TABLE "claim_categories" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "nature" "ClaimExpenseNature" NOT NULL DEFAULT 'GENERAL',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "claim_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "claim_categories_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "claim_categories_business_id_code_key" ON "claim_categories"("business_id", "code");
CREATE UNIQUE INDEX "claim_categories_id_business_id_key" ON "claim_categories"("id", "business_id");
CREATE INDEX "claim_categories_business_id_active_name_idx" ON "claim_categories"("business_id", "active", "name");

CREATE TABLE "claim_policy_revisions" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "category_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "ClaimPolicyRevisionStatus" NOT NULL DEFAULT 'ACTIVE',
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "name_snapshot" VARCHAR(120) NOT NULL,
  "nature_snapshot" "ClaimExpenseNature" NOT NULL,
  "receipt_required" BOOLEAN NOT NULL DEFAULT false,
  "description_required" BOOLEAN NOT NULL DEFAULT true,
  "max_line_amount" DECIMAL(12,2),
  "mileage_rate_per_km" DECIMAL(8,4),
  "statutory_treatment_status" "ClaimStatutoryTreatmentStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
  "reason" VARCHAR(500) NOT NULL,
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_policy_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "claim_policy_revisions_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT,
  CONSTRAINT "claim_policy_revisions_category_scope_fkey" FOREIGN KEY ("category_id", "business_id") REFERENCES "claim_categories"("id", "business_id") ON DELETE RESTRICT,
  CONSTRAINT "claim_policy_revisions_amount_check" CHECK ("max_line_amount" IS NULL OR "max_line_amount" > 0),
  CONSTRAINT "claim_policy_revisions_mileage_check" CHECK (("nature_snapshot" <> 'MILEAGE') OR ("mileage_rate_per_km" IS NOT NULL AND "mileage_rate_per_km" > 0))
);
CREATE UNIQUE INDEX "claim_policy_revisions_category_id_revision_key" ON "claim_policy_revisions"("category_id", "revision");
CREATE UNIQUE INDEX "claim_policy_revisions_id_business_id_key" ON "claim_policy_revisions"("id", "business_id");
CREATE INDEX "claim_policy_revisions_business_category_status_effective_idx" ON "claim_policy_revisions"("business_id", "category_id", "status", "effective_from");

CREATE TABLE "employee_claims" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "claim_number" VARCHAR(32) NOT NULL,
  "client_request_id" UUID NOT NULL,
  "purpose" VARCHAR(500) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'MYR',
  "status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',
  "submitted_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "approved_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "duplicate_warning" BOOLEAN NOT NULL DEFAULT false,
  "duplicate_warning_note" VARCHAR(500),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "submitted_at" TIMESTAMP(3),
  "reviewed_by_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "review_reason" VARCHAR(500),
  "withdrawn_at" TIMESTAMP(3),
  "withdrawal_reason" VARCHAR(500),
  "decision_digest" CHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_claims_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_claims_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT,
  CONSTRAINT "employee_claims_membership_scope_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT,
  CONSTRAINT "employee_claims_branch_scope_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT,
  CONSTRAINT "employee_claims_reviewed_by_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "employee_claims_currency_check" CHECK ("currency" = 'MYR'),
  CONSTRAINT "employee_claims_totals_check" CHECK ("submitted_total" >= 0 AND "approved_total" >= 0 AND "approved_total" <= "submitted_total")
);
CREATE UNIQUE INDEX "employee_claims_business_id_claim_number_key" ON "employee_claims"("business_id", "claim_number");
CREATE UNIQUE INDEX "employee_claims_business_membership_client_key" ON "employee_claims"("business_id", "membership_id", "client_request_id");
CREATE UNIQUE INDEX "employee_claims_id_business_id_key" ON "employee_claims"("id", "business_id");
CREATE UNIQUE INDEX "employee_claims_id_business_membership_key" ON "employee_claims"("id", "business_id", "membership_id");
CREATE INDEX "employee_claims_business_branch_status_submitted_idx" ON "employee_claims"("business_id", "branch_id", "status", "submitted_at");
CREATE INDEX "employee_claims_business_membership_created_idx" ON "employee_claims"("business_id", "membership_id", "created_at");

CREATE TABLE "claim_lines" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "claim_id" UUID NOT NULL,
  "line_number" INTEGER NOT NULL,
  "category_id" UUID NOT NULL,
  "policy_revision_id" UUID NOT NULL,
  "category_code_snapshot" VARCHAR(40) NOT NULL,
  "category_name_snapshot" VARCHAR(120) NOT NULL,
  "expense_nature_snapshot" "ClaimExpenseNature" NOT NULL,
  "expense_date" DATE NOT NULL,
  "merchant" VARCHAR(160),
  "description" VARCHAR(500) NOT NULL,
  "submitted_amount" DECIMAL(12,2) NOT NULL,
  "approved_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "mileage_km" DECIMAL(10,2),
  "mileage_rate_snapshot" DECIMAL(8,4),
  "receipt_required_snapshot" BOOLEAN NOT NULL DEFAULT false,
  "statutory_treatment_status" "ClaimStatutoryTreatmentStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
  "review_status" "ClaimLineReviewStatus" NOT NULL DEFAULT 'PENDING',
  "review_reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "claim_lines_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT,
  CONSTRAINT "claim_lines_claim_scope_fkey" FOREIGN KEY ("claim_id", "business_id") REFERENCES "employee_claims"("id", "business_id") ON DELETE RESTRICT,
  CONSTRAINT "claim_lines_category_scope_fkey" FOREIGN KEY ("category_id", "business_id") REFERENCES "claim_categories"("id", "business_id") ON DELETE RESTRICT,
  CONSTRAINT "claim_lines_policy_scope_fkey" FOREIGN KEY ("policy_revision_id", "business_id") REFERENCES "claim_policy_revisions"("id", "business_id") ON DELETE RESTRICT,
  CONSTRAINT "claim_lines_amount_check" CHECK ("line_number" > 0 AND "submitted_amount" > 0 AND "approved_amount" >= 0 AND "approved_amount" <= "submitted_amount")
);
CREATE UNIQUE INDEX "claim_lines_claim_id_line_number_key" ON "claim_lines"("claim_id", "line_number");
CREATE UNIQUE INDEX "claim_lines_id_business_claim_key" ON "claim_lines"("id", "business_id", "claim_id");
CREATE INDEX "claim_lines_business_expense_category_idx" ON "claim_lines"("business_id", "expense_date", "category_id");
CREATE INDEX "claim_lines_claim_review_status_idx" ON "claim_lines"("claim_id", "review_status");

CREATE TABLE "claim_attachments" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "claim_id" UUID NOT NULL,
  "line_id" UUID,
  "membership_id" UUID NOT NULL,
  "object_key" VARCHAR(300) NOT NULL,
  "sanitized_file_name" VARCHAR(120) NOT NULL,
  "mime_type" VARCHAR(80) NOT NULL,
  "byte_length" INTEGER NOT NULL,
  "checksum_sha256" CHAR(64) NOT NULL,
  "malware_status" "ClaimAttachmentMalwareStatus" NOT NULL DEFAULT 'NOT_SCANNED',
  "privacy_metadata_status" "ClaimAttachmentPrivacyStatus" NOT NULL DEFAULT 'NOT_CHECKED',
  "quarantine_disposition" VARCHAR(30) NOT NULL DEFAULT 'QUARANTINED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "claim_attachments_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT,
  CONSTRAINT "claim_attachments_claim_scope_fkey" FOREIGN KEY ("claim_id", "business_id", "membership_id") REFERENCES "employee_claims"("id", "business_id", "membership_id") ON DELETE RESTRICT,
  CONSTRAINT "claim_attachments_line_scope_fkey" FOREIGN KEY ("line_id", "business_id", "claim_id") REFERENCES "claim_lines"("id", "business_id", "claim_id") ON DELETE RESTRICT,
  CONSTRAINT "claim_attachments_membership_scope_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT,
  CONSTRAINT "claim_attachments_size_check" CHECK ("byte_length" > 0 AND "byte_length" <= 10485760),
  CONSTRAINT "claim_attachments_checksum_check" CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "claim_attachments_disposition_check" CHECK ("quarantine_disposition" = 'QUARANTINED')
);
CREATE UNIQUE INDEX "claim_attachments_object_key_key" ON "claim_attachments"("object_key");
CREATE UNIQUE INDEX "claim_attachments_id_business_id_key" ON "claim_attachments"("id", "business_id");
CREATE INDEX "claim_attachments_business_claim_idx" ON "claim_attachments"("business_id", "claim_id");
CREATE INDEX "claim_attachments_business_membership_idx" ON "claim_attachments"("business_id", "membership_id");

CREATE TABLE "claim_reimbursements" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "claim_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'MYR',
  "channel" "ClaimReimbursementChannel",
  "status" "ClaimReimbursementStatus" NOT NULL DEFAULT 'AWAITING_CHANNEL',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "operation_key" UUID,
  "payment_operation_key" UUID,
  "selected_by_id" UUID,
  "selected_at" TIMESTAMP(3),
  "paid_by_id" UUID,
  "paid_at" TIMESTAMP(3),
  "payment_reference" VARCHAR(120),
  "note" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "claim_reimbursements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "claim_reimbursements_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT,
  CONSTRAINT "claim_reimbursements_claim_scope_fkey" FOREIGN KEY ("claim_id", "business_id", "membership_id") REFERENCES "employee_claims"("id", "business_id", "membership_id") ON DELETE RESTRICT,
  CONSTRAINT "claim_reimbursements_membership_scope_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT,
  CONSTRAINT "claim_reimbursements_selected_by_fkey" FOREIGN KEY ("selected_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "claim_reimbursements_paid_by_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "claim_reimbursements_amount_check" CHECK ("amount" > 0 AND "currency" = 'MYR')
);
CREATE UNIQUE INDEX "claim_reimbursements_claim_id_key" ON "claim_reimbursements"("claim_id");
CREATE UNIQUE INDEX "claim_reimbursements_operation_key_key" ON "claim_reimbursements"("operation_key");
CREATE UNIQUE INDEX "claim_reimbursements_payment_operation_key_key" ON "claim_reimbursements"("payment_operation_key");
CREATE UNIQUE INDEX "claim_reimbursements_id_business_claim_key" ON "claim_reimbursements"("id", "business_id", "claim_id");
CREATE UNIQUE INDEX "claim_reimbursements_claim_business_membership_key" ON "claim_reimbursements"("claim_id", "business_id", "membership_id");
CREATE INDEX "claim_reimbursements_business_status_channel_idx" ON "claim_reimbursements"("business_id", "status", "channel");
CREATE INDEX "claim_reimbursements_business_membership_created_idx" ON "claim_reimbursements"("business_id", "membership_id", "created_at");

CREATE TABLE "payroll_claim_reimbursement_snapshots" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "reimbursement_id" UUID NOT NULL,
  "claim_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "payroll_run_id" UUID NOT NULL,
  "payroll_entry_id" UUID NOT NULL,
  "claim_number_snapshot" VARCHAR(32) NOT NULL,
  "approved_claim_revision" INTEGER NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'MYR',
  "statutory_treatment_status" "ClaimStatutoryTreatmentStatus" NOT NULL,
  "blocker_code" VARCHAR(100),
  "status" "ClaimPayrollBridgeStatus" NOT NULL DEFAULT 'BLOCKED_STATUTORY',
  "source_digest" CHAR(64) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settled_at" TIMESTAMP(3),
  CONSTRAINT "payroll_claim_reimbursement_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_claim_snapshots_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_claim_snapshots_reimbursement_scope_fkey" FOREIGN KEY ("reimbursement_id", "business_id", "claim_id") REFERENCES "claim_reimbursements"("id", "business_id", "claim_id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_claim_snapshots_claim_scope_fkey" FOREIGN KEY ("claim_id", "business_id", "membership_id") REFERENCES "employee_claims"("id", "business_id", "membership_id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_claim_snapshots_membership_scope_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_claim_snapshots_run_scope_fkey" FOREIGN KEY ("payroll_run_id", "business_id") REFERENCES "payroll_runs"("id", "business_id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_claim_snapshots_entry_scope_fkey" FOREIGN KEY ("payroll_entry_id", "business_id", "membership_id") REFERENCES "payroll_entries"("id", "business_id", "membership_id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_claim_snapshots_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "payroll_claim_snapshots_amount_check" CHECK ("amount" > 0 AND "currency" = 'MYR'),
  CONSTRAINT "payroll_claim_snapshots_blocker_check" CHECK (("status" = 'BLOCKED_STATUTORY' AND "blocker_code" IS NOT NULL) OR ("status" <> 'BLOCKED_STATUTORY'))
);
CREATE UNIQUE INDEX "payroll_claim_snapshots_reimbursement_id_key" ON "payroll_claim_reimbursement_snapshots"("reimbursement_id");
CREATE UNIQUE INDEX "payroll_claim_snapshots_id_business_id_key" ON "payroll_claim_reimbursement_snapshots"("id", "business_id");
CREATE INDEX "payroll_claim_snapshots_business_run_entry_idx" ON "payroll_claim_reimbursement_snapshots"("business_id", "payroll_run_id", "payroll_entry_id");
CREATE INDEX "payroll_claim_snapshots_business_claim_idx" ON "payroll_claim_reimbursement_snapshots"("business_id", "claim_id");

CREATE TABLE "claim_events" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "claim_id" UUID NOT NULL,
  "claim_revision" INTEGER NOT NULL,
  "type" "ClaimEventType" NOT NULL,
  "actor_user_id" UUID,
  "actor_membership_id" UUID,
  "reason" VARCHAR(500),
  "metadata" JSONB,
  "source_digest" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "claim_events_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT,
  CONSTRAINT "claim_events_claim_scope_fkey" FOREIGN KEY ("claim_id", "business_id") REFERENCES "employee_claims"("id", "business_id") ON DELETE RESTRICT,
  CONSTRAINT "claim_events_digest_check" CHECK ("source_digest" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "claim_events_claim_revision_type_key" ON "claim_events"("claim_id", "claim_revision", "type");
CREATE INDEX "claim_events_business_claim_created_idx" ON "claim_events"("business_id", "claim_id", "created_at");

-- Policy revisions and workflow events are append-only evidence.
CREATE OR REPLACE FUNCTION "deny_claim_immutable_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CLAIM_IMMUTABLE_RECORD';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_employee_session_attendance_branch_scope"()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."attendance_branch_id" IS NULL THEN
        NEW."attendance_branch_id" := NEW."primary_branch_id";
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "branches" b
        WHERE b."id" = NEW."attendance_branch_id"
          AND b."business_id" = NEW."business_id"
          AND b."status" = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'Employee Session Attendance branch is outside tenant scope';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "employee_branch_assignments" a
        WHERE a."membership_id" = NEW."membership_id"
          AND a."business_id" = NEW."business_id"
          AND a."branch_id" = NEW."attendance_branch_id"
          AND a."status" = 'ACTIVE'
          AND a."effective_from" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          AND (
              a."effective_until" IS NULL
              OR a."effective_until" >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          )
    ) THEN
        RAISE EXCEPTION 'Employee Session branch assignment is not active';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "claim_policy_revisions_immutable" BEFORE UPDATE OR DELETE ON "claim_policy_revisions" FOR EACH ROW EXECUTE FUNCTION "deny_claim_immutable_mutation"();
CREATE TRIGGER "claim_events_immutable" BEFORE UPDATE OR DELETE ON "claim_events" FOR EACH ROW EXECUTE FUNCTION "deny_claim_immutable_mutation"();

-- Employee sessions are shared by Attendance, Leave, Payslips, and Claims.
-- Creating a self-service session therefore requires an active primary
-- employment assignment, while Attendance-specific can-clock-in and branch
-- policy checks remain enforced by the Attendance session reader/services.
CREATE OR REPLACE FUNCTION "enforce_employee_session_scope"()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "employee_business_memberships"
        WHERE "id" = NEW."membership_id"
          AND "employee_account_id" = NEW."employee_account_id"
          AND "business_id" = NEW."business_id"
    ) THEN
        RAISE EXCEPTION 'Employee Session membership scope mismatch';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "branches"
        WHERE "id" = NEW."primary_branch_id"
          AND "business_id" = NEW."business_id"
    ) THEN
        RAISE EXCEPTION 'Employee Session branch scope mismatch';
    END IF;

    IF NEW."employee_device_id" IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM "employee_devices"
           WHERE "id" = NEW."employee_device_id"
             AND "employee_account_id" = NEW."employee_account_id"
       ) THEN
        RAISE EXCEPTION 'Employee Session device scope mismatch';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (
            SELECT 1
            FROM "employee_branch_assignments"
            WHERE "membership_id" = NEW."membership_id"
              AND "business_id" = NEW."business_id"
              AND "branch_id" = NEW."primary_branch_id"
              AND "status" = 'ACTIVE'
              AND "is_primary" = true
              AND "effective_from" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
              AND (
                  "effective_until" IS NULL
                  OR "effective_until" >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
              )
        ) THEN
            RAISE EXCEPTION
                'Employee Session primary assignment is not active';
        END IF;

        IF NEW."employee_device_id" IS NOT NULL
           AND NOT EXISTS (
               SELECT 1
               FROM "employee_devices"
               WHERE "id" = NEW."employee_device_id"
                 AND "employee_account_id" = NEW."employee_account_id"
                 AND "status" = 'ACTIVE'
                 AND "can_view" = true
           ) THEN
            RAISE EXCEPTION
                'Employee Session device is not active';
        END IF;

        RETURN NEW;
    END IF;

    IF NEW."employee_account_id" IS DISTINCT FROM
       OLD."employee_account_id"
       OR NEW."membership_id" IS DISTINCT FROM OLD."membership_id"
       OR NEW."business_id" IS DISTINCT FROM OLD."business_id"
       OR NEW."primary_branch_id" IS DISTINCT FROM OLD."primary_branch_id"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'Employee Session tenant scope is immutable';
    END IF;

    IF OLD."employee_device_id" IS NOT NULL
       AND NEW."employee_device_id" IS DISTINCT FROM
           OLD."employee_device_id" THEN
        RAISE EXCEPTION 'Employee Session device is immutable once bound';
    END IF;

    IF OLD."employee_device_id" IS NULL
       AND NEW."employee_device_id" IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM "employee_devices"
           WHERE "id" = NEW."employee_device_id"
             AND "employee_account_id" = NEW."employee_account_id"
             AND "status" = 'ACTIVE'
             AND "can_view" = true
       ) THEN
        RAISE EXCEPTION 'Employee Session device is not active';
    END IF;

    IF NEW."last_active_at" < OLD."last_active_at" THEN
        RAISE EXCEPTION 'Employee Session last active time cannot decrease';
    END IF;

    IF OLD."revoked_at" IS NOT NULL
       AND NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at" THEN
        RAISE EXCEPTION 'Employee Session cannot be unrevoked';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
