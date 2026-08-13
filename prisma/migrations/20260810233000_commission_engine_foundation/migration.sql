-- TETAMU Commission Engine Foundation (Local/Testing engineering artifact).
-- Commission is an opt-in add-on; this migration deliberately creates no entitlement.
ALTER TYPE "BusinessModuleKey" ADD VALUE 'COMMISSION';

CREATE TYPE "CommissionSourceType" AS ENUM ('SERVICE', 'PRODUCT', 'PACKAGE_PURCHASE', 'PACKAGE_REDEMPTION');
CREATE TYPE "CommissionAttributionStatus" AS ENUM ('ATTRIBUTED', 'REVIEW_REQUIRED', 'INELIGIBLE_PACKAGE_REDEMPTION');
CREATE TYPE "CommissionRuleType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'TIERED_PERCENTAGE');
CREATE TYPE "CommissionRuleScope" AS ENUM ('ALL', 'CATEGORY', 'ITEM');
CREATE TYPE "CommissionBasis" AS ENUM ('GROSS', 'NET_AFTER_DISCOUNT');
CREATE TYPE "CommissionRuleStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "CommissionPeriodStatus" AS ENUM ('OPEN', 'CALCULATED', 'LOCKED');
CREATE TYPE "CommissionStatementStatus" AS ENUM ('CALCULATED', 'APPROVED', 'APPLIED_TO_PAYROLL');
CREATE TYPE "CommissionAccrualStatus" AS ENUM ('ACTIVE', 'REVERSED');
CREATE TYPE "CommissionAdjustmentType" AS ENUM ('REFUND', 'VOID', 'MANUAL_CORRECTION');
CREATE TYPE "CommissionAdjustmentPayrollStatus" AS ENUM ('UNLINKED', 'FUTURE_PAYROLL_REQUIRED', 'APPLIED_TO_FUTURE_STATEMENT');

ALTER TABLE "invoice_items" ADD COLUMN "commission_membership_id" UUID;

CREATE TABLE "commission_rules" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "source_type" "CommissionSourceType" NOT NULL,
  "status" "CommissionRuleStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_rules_name_required" CHECK (length(btrim("name")) >= 2)
);

CREATE TABLE "commission_rule_revisions" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "rule_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "branch_id" UUID,
  "scope" "CommissionRuleScope" NOT NULL,
  "scope_id" UUID,
  "rule_type" "CommissionRuleType" NOT NULL,
  "basis" "CommissionBasis" NOT NULL,
  "rate_basis_points" INTEGER,
  "fixed_amount_cents" INTEGER,
  "tier_mode" VARCHAR(32),
  "tiers" JSONB NOT NULL DEFAULT '[]',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "effective_from" DATE NOT NULL,
  "effective_until" DATE,
  "reason" VARCHAR(500) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commission_rule_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_rule_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "commission_rule_revision_window" CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from"),
  CONSTRAINT "commission_rule_revision_scope" CHECK (("scope" = 'ALL' AND "scope_id" IS NULL) OR ("scope" <> 'ALL' AND "scope_id" IS NOT NULL)),
  CONSTRAINT "commission_rule_revision_value" CHECK (
    ("rule_type" = 'PERCENTAGE' AND "rate_basis_points" BETWEEN 0 AND 100000 AND "fixed_amount_cents" IS NULL AND jsonb_array_length("tiers") = 0)
    OR ("rule_type" = 'FIXED_AMOUNT' AND "fixed_amount_cents" >= 0 AND "rate_basis_points" IS NULL AND jsonb_array_length("tiers") = 0)
    OR ("rule_type" = 'TIERED_PERCENTAGE' AND "rate_basis_points" IS NULL AND "fixed_amount_cents" IS NULL AND "tier_mode" = 'WHOLE_PERIOD_RATE' AND jsonb_array_length("tiers") > 0)
  ),
  CONSTRAINT "commission_rule_revision_reason_required" CHECK (length(btrim("reason")) >= 5)
);

CREATE TABLE "commission_source_events" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID,
  "invoice_id" UUID NOT NULL,
  "invoice_item_id" UUID NOT NULL,
  "membership_id" UUID,
  "source_type" "CommissionSourceType" NOT NULL,
  "source_item_id" UUID,
  "source_category_id" UUID,
  "source_revision" CHAR(64) NOT NULL,
  "attribution_status" "CommissionAttributionStatus" NOT NULL,
  "attribution_reference" VARCHAR(160),
  "business_date" DATE NOT NULL,
  "event_at" TIMESTAMP(3) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "gross_amount_cents" INTEGER NOT NULL,
  "discount_amount_cents" INTEGER NOT NULL,
  "net_amount_cents" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'MYR',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commission_source_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_source_amounts_check" CHECK ("quantity" > 0 AND "gross_amount_cents" >= 0 AND "discount_amount_cents" >= 0 AND "net_amount_cents" = "gross_amount_cents" - "discount_amount_cents"),
  CONSTRAINT "commission_source_attribution_check" CHECK (("attribution_status" = 'ATTRIBUTED' AND "membership_id" IS NOT NULL) OR "attribution_status" <> 'ATTRIBUTED')
);

CREATE TABLE "commission_periods" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID,
  "scope_key" VARCHAR(64) NOT NULL,
  "earned_period_start" DATE NOT NULL,
  "earned_period_end" DATE NOT NULL,
  "status" "CommissionPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "current_revision" INTEGER NOT NULL DEFAULT 0,
  "calculated_by_id" UUID,
  "calculated_at" TIMESTAMP(3),
  "approved_by_id" UUID,
  "approved_at" TIMESTAMP(3),
  "approval_reason" VARCHAR(500),
  "source_digest" CHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commission_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_period_window" CHECK ("earned_period_end" >= "earned_period_start"),
  CONSTRAINT "commission_period_revision" CHECK ("current_revision" >= 0),
  CONSTRAINT "commission_period_approval_state" CHECK (("status" <> 'LOCKED') OR ("approved_by_id" IS NOT NULL AND "approved_at" IS NOT NULL AND length(btrim("approval_reason")) >= 5))
);

CREATE TABLE "commission_statements" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "period_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "calculation_revision" INTEGER NOT NULL,
  "status" "CommissionStatementStatus" NOT NULL DEFAULT 'CALCULATED',
  "eligible_sales_cents" INTEGER NOT NULL,
  "calculated_commission_cents" INTEGER NOT NULL,
  "adjustment_cents" INTEGER NOT NULL DEFAULT 0,
  "final_commission_cents" INTEGER NOT NULL,
  "calculation_digest" CHAR(64) NOT NULL,
  "approved_by_id" UUID,
  "approved_at" TIMESTAMP(3),
  "payroll_variable_pay_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commission_statements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_statement_amounts" CHECK ("eligible_sales_cents" >= 0 AND "calculated_commission_cents" >= 0 AND "final_commission_cents" = "calculated_commission_cents" + "adjustment_cents" AND "final_commission_cents" >= 0),
  CONSTRAINT "commission_statement_approval_state" CHECK (("status" = 'CALCULATED' AND "approved_by_id" IS NULL AND "approved_at" IS NULL AND "payroll_variable_pay_id" IS NULL) OR ("status" = 'APPROVED' AND "approved_by_id" IS NOT NULL AND "approved_at" IS NOT NULL AND "payroll_variable_pay_id" IS NULL) OR ("status" = 'APPLIED_TO_PAYROLL' AND "approved_by_id" IS NOT NULL AND "approved_at" IS NOT NULL AND "payroll_variable_pay_id" IS NOT NULL))
);

CREATE TABLE "commission_accruals" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "statement_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "source_event_id" UUID NOT NULL,
  "rule_revision_id" UUID NOT NULL,
  "calculation_revision" INTEGER NOT NULL,
  "eligible_amount_cents" INTEGER NOT NULL,
  "commission_amount_cents" INTEGER NOT NULL,
  "status" "CommissionAccrualStatus" NOT NULL DEFAULT 'ACTIVE',
  "rule_snapshot" JSONB NOT NULL,
  "calculation_trace" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commission_accruals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_accrual_amounts" CHECK ("calculation_revision" > 0 AND "eligible_amount_cents" >= 0 AND "commission_amount_cents" >= 0)
);

CREATE TABLE "commission_adjustments" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "statement_id" UUID,
  "applied_to_statement_id" UUID,
  "accrual_id" UUID NOT NULL,
  "payment_refund_id" UUID,
  "type" "CommissionAdjustmentType" NOT NULL,
  "eligible_amount_cents" INTEGER NOT NULL,
  "commission_amount_cents" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "payroll_status" "CommissionAdjustmentPayrollStatus" NOT NULL DEFAULT 'UNLINKED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commission_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_adjustment_reason" CHECK (length(btrim("reason")) >= 5),
  CONSTRAINT "commission_refund_is_negative" CHECK ("type" <> 'REFUND' OR ("eligible_amount_cents" <= 0 AND "commission_amount_cents" <= 0)),
  CONSTRAINT "commission_adjustment_application" CHECK (("payroll_status" = 'APPLIED_TO_FUTURE_STATEMENT' AND "applied_to_statement_id" IS NOT NULL) OR ("payroll_status" <> 'APPLIED_TO_FUTURE_STATEMENT' AND "applied_to_statement_id" IS NULL))
);

CREATE UNIQUE INDEX "commission_rules_business_id_name_key" ON "commission_rules"("business_id", "name");
CREATE UNIQUE INDEX "commission_rules_id_business_id_key" ON "commission_rules"("id", "business_id");
CREATE INDEX "commission_rules_business_id_source_type_status_idx" ON "commission_rules"("business_id", "source_type", "status");
CREATE UNIQUE INDEX "commission_rule_revisions_rule_id_revision_key" ON "commission_rule_revisions"("rule_id", "revision");
CREATE UNIQUE INDEX "commission_rule_revisions_id_business_id_key" ON "commission_rule_revisions"("id", "business_id");
CREATE INDEX "commission_rule_revisions_business_id_branch_id_effective_idx" ON "commission_rule_revisions"("business_id", "branch_id", "effective_from", "effective_until");
CREATE UNIQUE INDEX "commission_source_events_business_id_invoice_item_id_s_key" ON "commission_source_events"("business_id", "invoice_item_id", "source_revision");
CREATE UNIQUE INDEX "commission_source_events_id_business_id_key" ON "commission_source_events"("id", "business_id");
CREATE INDEX "commission_source_events_business_id_business_date_attrib_idx" ON "commission_source_events"("business_id", "business_date", "attribution_status");
CREATE INDEX "commission_source_events_business_id_membership_id_busine_idx" ON "commission_source_events"("business_id", "membership_id", "business_date");
CREATE UNIQUE INDEX "commission_periods_business_id_scope_key_earned_period_key" ON "commission_periods"("business_id", "scope_key", "earned_period_start", "earned_period_end");
CREATE UNIQUE INDEX "commission_periods_id_business_id_key" ON "commission_periods"("id", "business_id");
CREATE INDEX "commission_periods_business_id_status_earned_period_start_idx" ON "commission_periods"("business_id", "status", "earned_period_start");
CREATE UNIQUE INDEX "commission_statements_payroll_variable_pay_id_key" ON "commission_statements"("payroll_variable_pay_id");
CREATE UNIQUE INDEX "commission_statements_period_id_membership_id_calcul_key" ON "commission_statements"("period_id", "membership_id", "calculation_revision");
CREATE UNIQUE INDEX "commission_statements_id_business_id_membership_id_key" ON "commission_statements"("id", "business_id", "membership_id");
CREATE INDEX "commission_statements_business_id_membership_id_status_cr_idx" ON "commission_statements"("business_id", "membership_id", "status", "created_at");
CREATE UNIQUE INDEX "commission_accruals_source_event_id_rule_revision_id_cal_key" ON "commission_accruals"("source_event_id", "rule_revision_id", "calculation_revision");
CREATE INDEX "commission_accruals_business_id_membership_id_calculation_idx" ON "commission_accruals"("business_id", "membership_id", "calculation_revision");
CREATE UNIQUE INDEX "commission_adjustments_accrual_id_payment_refund_id_key" ON "commission_adjustments"("accrual_id", "payment_refund_id");
CREATE INDEX "commission_adjustments_business_id_membership_id_payroll_idx" ON "commission_adjustments"("business_id", "membership_id", "payroll_status");
CREATE INDEX "commission_adjustments_applied_to_statement_id_idx" ON "commission_adjustments"("applied_to_statement_id");
CREATE INDEX "invoice_items_business_id_commission_membership_id_idx" ON "invoice_items"("business_id", "commission_membership_id");

ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_rule_revisions" ADD CONSTRAINT "commission_rule_revisions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_rule_revisions" ADD CONSTRAINT "commission_rule_revisions_rule_id_business_id_fkey" FOREIGN KEY ("rule_id", "business_id") REFERENCES "commission_rules"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_rule_revisions" ADD CONSTRAINT "commission_rule_revisions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_rule_revisions" ADD CONSTRAINT "commission_rule_revisions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_source_events" ADD CONSTRAINT "commission_source_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_source_events" ADD CONSTRAINT "commission_source_events_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_source_events" ADD CONSTRAINT "commission_source_events_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_source_events" ADD CONSTRAINT "commission_source_events_invoice_item_id_fkey" FOREIGN KEY ("invoice_item_id") REFERENCES "invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_source_events" ADD CONSTRAINT "commission_source_events_membership_id_business_id_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_periods" ADD CONSTRAINT "commission_periods_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_periods" ADD CONSTRAINT "commission_periods_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_periods" ADD CONSTRAINT "commission_periods_calculated_by_id_fkey" FOREIGN KEY ("calculated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_periods" ADD CONSTRAINT "commission_periods_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_period_id_business_id_fkey" FOREIGN KEY ("period_id", "business_id") REFERENCES "commission_periods"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_membership_id_business_id_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_payroll_variable_pay_id_fkey" FOREIGN KEY ("payroll_variable_pay_id") REFERENCES "payroll_variable_pay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_statement_scope_fkey" FOREIGN KEY ("statement_id", "business_id", "membership_id") REFERENCES "commission_statements"("id", "business_id", "membership_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_membership_scope_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_source_scope_fkey" FOREIGN KEY ("source_event_id", "business_id") REFERENCES "commission_source_events"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_rule_scope_fkey" FOREIGN KEY ("rule_revision_id", "business_id") REFERENCES "commission_rule_revisions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_membership_scope_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "commission_statements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_applied_to_statement_id_fkey" FOREIGN KEY ("applied_to_statement_id") REFERENCES "commission_statements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_accrual_id_fkey" FOREIGN KEY ("accrual_id") REFERENCES "commission_accruals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_payment_refund_id_fkey" FOREIGN KEY ("payment_refund_id") REFERENCES "payment_refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_commission_membership_scope_fkey" FOREIGN KEY ("commission_membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only evidence and calculation facts. Lifecycle state machines remain updateable only where required.
CREATE OR REPLACE FUNCTION protect_commission_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'COMMISSION_APPEND_ONLY_RECORD_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "commission_rule_revisions_immutable" BEFORE UPDATE OR DELETE ON "commission_rule_revisions" FOR EACH ROW EXECUTE FUNCTION protect_commission_append_only();
CREATE TRIGGER "commission_source_events_immutable" BEFORE UPDATE OR DELETE ON "commission_source_events" FOR EACH ROW EXECUTE FUNCTION protect_commission_append_only();
CREATE TRIGGER "commission_accruals_immutable" BEFORE UPDATE OR DELETE ON "commission_accruals" FOR EACH ROW EXECUTE FUNCTION protect_commission_append_only();

CREATE OR REPLACE FUNCTION protect_commission_statement_amounts() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'COMMISSION_STATEMENT_DELETE_FORBIDDEN'; END IF;
  IF NEW."business_id" <> OLD."business_id" OR NEW."period_id" <> OLD."period_id" OR NEW."membership_id" <> OLD."membership_id"
     OR NEW."calculation_revision" <> OLD."calculation_revision" OR NEW."eligible_sales_cents" <> OLD."eligible_sales_cents"
     OR NEW."calculated_commission_cents" <> OLD."calculated_commission_cents" OR NEW."adjustment_cents" <> OLD."adjustment_cents"
     OR NEW."final_commission_cents" <> OLD."final_commission_cents" OR NEW."calculation_digest" <> OLD."calculation_digest"
     OR NEW."created_at" <> OLD."created_at" THEN RAISE EXCEPTION 'COMMISSION_STATEMENT_AMOUNTS_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "commission_statement_amount_guard" BEFORE UPDATE OR DELETE ON "commission_statements" FOR EACH ROW EXECUTE FUNCTION protect_commission_statement_amounts();

CREATE OR REPLACE FUNCTION protect_locked_commission_period() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'COMMISSION_PERIOD_DELETE_FORBIDDEN'; END IF;
  IF OLD."status" = 'LOCKED' THEN RAISE EXCEPTION 'COMMISSION_PERIOD_LOCKED'; END IF;
  IF NEW."business_id" <> OLD."business_id" OR NEW."scope_key" <> OLD."scope_key" OR NEW."earned_period_start" <> OLD."earned_period_start" OR NEW."earned_period_end" <> OLD."earned_period_end" THEN RAISE EXCEPTION 'COMMISSION_PERIOD_IDENTITY_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "commission_period_lock_guard" BEFORE UPDATE OR DELETE ON "commission_periods" FOR EACH ROW EXECUTE FUNCTION protect_locked_commission_period();

CREATE OR REPLACE FUNCTION protect_paid_invoice_commission_attribution() RETURNS trigger AS $$
BEGIN
  IF NEW."commission_membership_id" IS DISTINCT FROM OLD."commission_membership_id" AND EXISTS (SELECT 1 FROM "invoices" i WHERE i."id" = OLD."invoice_id" AND i."status" = 'PAID') THEN
    RAISE EXCEPTION 'PAID_INVOICE_COMMISSION_ATTRIBUTION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "invoice_item_commission_attribution_guard" BEFORE UPDATE ON "invoice_items" FOR EACH ROW EXECUTE FUNCTION protect_paid_invoice_commission_attribution();
