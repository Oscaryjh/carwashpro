BEGIN;

CREATE TYPE "LeavePolicyCode" AS ENUM ('ANNUAL', 'SICK', 'HOSPITALISATION', 'MATERNITY', 'PATERNITY', 'UNPAID', 'COMPASSIONATE', 'OTHER');
CREATE TYPE "LeavePayTreatment" AS ENUM ('PAID', 'UNPAID');
CREATE TYPE "LeaveCountMode" AS ENUM ('WEEKDAYS', 'CALENDAR_DAYS');
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "leave_policies" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "code" "LeavePolicyCode" NOT NULL,
  "name" TEXT NOT NULL,
  "pay_treatment" "LeavePayTreatment" NOT NULL DEFAULT 'PAID',
  "count_mode" "LeaveCountMode" NOT NULL DEFAULT 'WEEKDAYS',
  "balance_tracked" BOOLEAN NOT NULL DEFAULT true,
  "default_entitlement_days" DECIMAL(6,2),
  "under_two_years_days" DECIMAL(6,2),
  "two_to_five_years_days" DECIMAL(6,2),
  "five_years_plus_days" DECIMAL(6,2),
  "requires_document" BOOLEAN NOT NULL DEFAULT false,
  "allow_negative_balance" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leave_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_policies_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_policies_nonnegative_days" CHECK (
    COALESCE("default_entitlement_days", 0) >= 0 AND
    COALESCE("under_two_years_days", 0) >= 0 AND
    COALESCE("two_to_five_years_days", 0) >= 0 AND
    COALESCE("five_years_plus_days", 0) >= 0
  )
);
CREATE UNIQUE INDEX "leave_policies_business_id_code_key" ON "leave_policies"("business_id", "code");
CREATE INDEX "leave_policies_business_id_active_name_idx" ON "leave_policies"("business_id", "active", "name");

CREATE TABLE "employee_leave_balances" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "policy_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "entitlement_override_days" DECIMAL(6,2),
  "carried_forward_days" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "adjustment_days" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_leave_balances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_leave_balances_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_leave_balances_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "employee_business_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_leave_balances_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "leave_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_leave_balances_year_check" CHECK ("year" BETWEEN 2000 AND 2200),
  CONSTRAINT "employee_leave_balances_entitlement_check" CHECK ("entitlement_override_days" IS NULL OR "entitlement_override_days" >= 0)
);
CREATE UNIQUE INDEX "employee_leave_balances_membership_id_policy_id_year_key" ON "employee_leave_balances"("membership_id", "policy_id", "year");
CREATE INDEX "employee_leave_balances_business_id_year_policy_id_idx" ON "employee_leave_balances"("business_id", "year", "policy_id");

CREATE TABLE "leave_requests" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "policy_id" UUID NOT NULL,
  "policy_name_snapshot" TEXT NOT NULL,
  "pay_treatment_snapshot" "LeavePayTreatment" NOT NULL,
  "starts_on" DATE NOT NULL,
  "ends_on" DATE NOT NULL,
  "requested_days" DECIMAL(6,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "document_reference" TEXT,
  "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "review_note" TEXT,
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_requests_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "employee_business_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_requests_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "leave_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "leave_requests_date_check" CHECK ("ends_on" >= "starts_on"),
  CONSTRAINT "leave_requests_days_check" CHECK ("requested_days" > 0 AND "requested_days" <= 366),
  CONSTRAINT "leave_requests_review_check" CHECK (
    ("status" IN ('APPROVED', 'REJECTED') AND "reviewed_at" IS NOT NULL) OR
    ("status" IN ('PENDING', 'CANCELLED'))
  )
);
CREATE INDEX "leave_requests_business_id_branch_id_status_starts_on_idx" ON "leave_requests"("business_id", "branch_id", "status", "starts_on");
CREATE INDEX "leave_requests_membership_id_status_starts_on_idx" ON "leave_requests"("membership_id", "status", "starts_on");
CREATE INDEX "leave_requests_policy_id_status_starts_on_idx" ON "leave_requests"("policy_id", "status", "starts_on");

CREATE TABLE "leave_request_days" (
  "id" UUID NOT NULL,
  "leave_request_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "leave_date" DATE NOT NULL,
  "day_fraction" DECIMAL(3,2) NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_request_days_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_request_days_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "leave_request_days_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_request_days_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "employee_business_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_request_days_fraction_check" CHECK ("day_fraction" > 0 AND "day_fraction" <= 1)
);
CREATE UNIQUE INDEX "leave_request_days_leave_request_id_leave_date_key" ON "leave_request_days"("leave_request_id", "leave_date");
CREATE INDEX "leave_request_days_business_id_leave_date_idx" ON "leave_request_days"("business_id", "leave_date");
CREATE INDEX "leave_request_days_membership_id_leave_date_idx" ON "leave_request_days"("membership_id", "leave_date");

ALTER TABLE "payroll_entries"
  ADD COLUMN "paid_leave_days" DECIMAL(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN "unpaid_leave_days" DECIMAL(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN "leave_pay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "unpaid_leave_deduction" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "staff_time_off" ADD COLUMN "leave_request_id" UUID;
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_leave_request_id_fkey"
  FOREIGN KEY ("leave_request_id") REFERENCES "leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "staff_time_off_leave_request_id_key" ON "staff_time_off"("leave_request_id");

CREATE OR REPLACE FUNCTION enforce_leave_tenant_scope() RETURNS trigger AS $$
DECLARE
  membership_business UUID;
  policy_business UUID;
  branch_business UUID;
  request_business UUID;
  request_membership UUID;
BEGIN
  SELECT business_id INTO membership_business FROM employee_business_memberships WHERE id = NEW.membership_id;
  IF membership_business IS NULL OR membership_business <> NEW.business_id THEN
    RAISE EXCEPTION 'Leave membership tenant mismatch';
  END IF;

  IF TG_TABLE_NAME = 'employee_leave_balances' OR TG_TABLE_NAME = 'leave_requests' THEN
    SELECT business_id INTO policy_business FROM leave_policies WHERE id = NEW.policy_id;
    IF policy_business IS NULL OR policy_business <> NEW.business_id THEN
      RAISE EXCEPTION 'Leave policy tenant mismatch';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'leave_requests' THEN
    SELECT business_id INTO branch_business FROM branches WHERE id = NEW.branch_id;
    IF branch_business IS NULL OR branch_business <> NEW.business_id THEN
      RAISE EXCEPTION 'Leave branch tenant mismatch';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'leave_request_days' THEN
    SELECT business_id, membership_id INTO request_business, request_membership
      FROM leave_requests WHERE id = NEW.leave_request_id;
    IF request_business IS NULL OR request_business <> NEW.business_id OR request_membership <> NEW.membership_id THEN
      RAISE EXCEPTION 'Leave request day tenant mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER employee_leave_balances_tenant_guard BEFORE INSERT OR UPDATE ON "employee_leave_balances"
  FOR EACH ROW EXECUTE FUNCTION enforce_leave_tenant_scope();
CREATE TRIGGER leave_requests_tenant_guard BEFORE INSERT OR UPDATE ON "leave_requests"
  FOR EACH ROW EXECUTE FUNCTION enforce_leave_tenant_scope();
CREATE TRIGGER leave_request_days_tenant_guard BEFORE INSERT OR UPDATE ON "leave_request_days"
  FOR EACH ROW EXECUTE FUNCTION enforce_leave_tenant_scope();

COMMIT;
