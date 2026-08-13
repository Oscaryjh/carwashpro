CREATE TYPE "SubscriptionInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'VOID');
CREATE TYPE "SubscriptionInvoicePaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');
CREATE TYPE "SubscriptionInvoiceLineType" AS ENUM ('BASE_PLAN', 'ADD_ON', 'EXTRA_BRANCH', 'EXTRA_EMPLOYEE', 'SETUP_FEE');
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('COMPLETED', 'REVERSED');
CREATE TYPE "SubscriptionPaymentMethod" AS ENUM ('BANK_TRANSFER', 'DUITNOW_QR', 'CASH', 'CHEQUE', 'CARD_MANUAL', 'OTHER');

CREATE TABLE "commercial_billing_sequences" (
  "id" VARCHAR(20) NOT NULL DEFAULT 'GLOBAL',
  "invoice_sequence" INTEGER NOT NULL DEFAULT 1000,
  "payment_sequence" INTEGER NOT NULL DEFAULT 1000,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commercial_billing_sequences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subscription_invoices" (
  "id" UUID NOT NULL,
  "scope_type" "CommercialScopeType" NOT NULL,
  "business_id" UUID,
  "group_id" UUID,
  "subscription_id" UUID NOT NULL,
  "invoice_number" VARCHAR(40) NOT NULL,
  "billing_period_start" DATE NOT NULL,
  "billing_period_end" DATE NOT NULL,
  "invoice_date" DATE NOT NULL,
  "due_date" DATE NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'MYR',
  "status" "SubscriptionInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "payment_status" "SubscriptionInvoicePaymentStatus" NOT NULL DEFAULT 'UNPAID',
  "billing_interval_snapshot" "CommercialBillingInterval" NOT NULL,
  "list_subtotal_cents" INTEGER NOT NULL,
  "promotion_discount_cents" INTEGER NOT NULL DEFAULT 0,
  "override_adjustment_cents" INTEGER NOT NULL DEFAULT 0,
  "setup_fee_amount_cents" INTEGER NOT NULL DEFAULT 0,
  "branch_unit_charge_cents" INTEGER NOT NULL DEFAULT 0,
  "employee_unit_charge_cents" INTEGER NOT NULL DEFAULT 0,
  "total_amount_cents" INTEGER NOT NULL,
  "paid_amount_cents" INTEGER NOT NULL DEFAULT 0,
  "outstanding_amount_cents" INTEGER NOT NULL,
  "active_branch_count_snapshot" INTEGER NOT NULL DEFAULT 0,
  "included_branch_count_snapshot" INTEGER NOT NULL DEFAULT 0,
  "billable_branch_count_snapshot" INTEGER NOT NULL DEFAULT 0,
  "active_employee_count_snapshot" INTEGER NOT NULL DEFAULT 0,
  "included_employee_count_snapshot" INTEGER NOT NULL DEFAULT 0,
  "billable_employee_count_snapshot" INTEGER NOT NULL DEFAULT 0,
  "price_snapshot" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" UUID NOT NULL,
  "issued_by_id" UUID,
  "issued_at" TIMESTAMP(3),
  "voided_by_id" UUID,
  "voided_at" TIMESTAMP(3),
  "void_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_invoice_scope_check" CHECK (
    ("scope_type" = 'BUSINESS' AND "business_id" IS NOT NULL AND "group_id" IS NULL) OR
    ("scope_type" = 'GROUP' AND "group_id" IS NOT NULL AND "business_id" IS NULL)
  ),
  CONSTRAINT "subscription_invoice_period_check" CHECK ("billing_period_end" > "billing_period_start"),
  CONSTRAINT "subscription_invoice_amount_check" CHECK (
    "list_subtotal_cents" >= 0 AND "promotion_discount_cents" >= 0 AND
    "setup_fee_amount_cents" >= 0 AND "branch_unit_charge_cents" >= 0 AND
    "employee_unit_charge_cents" >= 0 AND "total_amount_cents" >= 0 AND
    "paid_amount_cents" >= 0 AND "outstanding_amount_cents" >= 0 AND (
      ("status" = 'ISSUED' AND "paid_amount_cents" + "outstanding_amount_cents" = "total_amount_cents") OR
      ("status" <> 'ISSUED' AND "paid_amount_cents" = 0 AND "outstanding_amount_cents" = 0)
    )
  )
);

CREATE TABLE "subscription_invoice_lines" (
  "id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "line_type" "SubscriptionInvoiceLineType" NOT NULL,
  "plan_version_id" UUID,
  "plan_code_snapshot" VARCHAR(80),
  "plan_name_snapshot" VARCHAR(160),
  "plan_version_snapshot" INTEGER,
  "description" VARCHAR(240) NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unit_amount_cents" INTEGER NOT NULL,
  "line_amount_cents" INTEGER NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscription_invoice_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_invoice_line_amount_check" CHECK ("quantity" > 0 AND "unit_amount_cents" >= 0 AND "line_amount_cents" >= 0)
);

CREATE TABLE "subscription_payments" (
  "id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "payment_number" VARCHAR(40) NOT NULL,
  "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'COMPLETED',
  "payment_date" DATE NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "payment_method" "SubscriptionPaymentMethod" NOT NULL,
  "payment_reference" VARCHAR(160),
  "notes" TEXT,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_payment_amount_check" CHECK ("amount_cents" > 0)
);

CREATE TABLE "subscription_payment_reversals" (
  "id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscription_payment_reversals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_invoices_invoice_number_key" ON "subscription_invoices"("invoice_number");
CREATE UNIQUE INDEX "subscription_invoices_active_period_key" ON "subscription_invoices"("subscription_id", "billing_period_start", "billing_period_end") WHERE "status" <> 'VOID';
CREATE INDEX "subscription_invoices_scope_status_due_idx" ON "subscription_invoices"("scope_type", "status", "due_date");
CREATE INDEX "subscription_invoices_business_status_due_idx" ON "subscription_invoices"("business_id", "status", "due_date");
CREATE INDEX "subscription_invoices_group_status_due_idx" ON "subscription_invoices"("group_id", "status", "due_date");
CREATE INDEX "subscription_invoices_subscription_period_idx" ON "subscription_invoices"("subscription_id", "billing_period_start", "billing_period_end");
CREATE INDEX "subscription_invoices_payment_status_due_idx" ON "subscription_invoices"("payment_status", "due_date");
CREATE INDEX "subscription_invoice_lines_invoice_type_idx" ON "subscription_invoice_lines"("invoice_id", "line_type");
CREATE INDEX "subscription_invoice_lines_plan_version_idx" ON "subscription_invoice_lines"("plan_version_id");
CREATE UNIQUE INDEX "subscription_payments_payment_number_key" ON "subscription_payments"("payment_number");
CREATE INDEX "subscription_payments_invoice_status_date_idx" ON "subscription_payments"("invoice_id", "status", "payment_date");
CREATE INDEX "subscription_payments_status_date_idx" ON "subscription_payments"("status", "payment_date");
CREATE UNIQUE INDEX "subscription_payment_reversals_payment_id_key" ON "subscription_payment_reversals"("payment_id");
CREATE INDEX "subscription_payment_reversals_created_at_idx" ON "subscription_payment_reversals"("created_at");

ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "business_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "commercial_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_invoice_lines" ADD CONSTRAINT "subscription_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "subscription_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_invoice_lines" ADD CONSTRAINT "subscription_invoice_lines_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "commercial_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "subscription_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_payment_reversals" ADD CONSTRAINT "subscription_payment_reversals_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "subscription_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_payment_reversals" ADD CONSTRAINT "subscription_payment_reversals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutable billing facts: issued/void invoices and completed/reversed payments
-- can only move through the service-controlled lifecycle.
CREATE OR REPLACE FUNCTION protect_subscription_invoice_snapshot() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'DRAFT' AND (
    NEW.scope_type IS DISTINCT FROM OLD.scope_type OR NEW.business_id IS DISTINCT FROM OLD.business_id OR
    NEW.group_id IS DISTINCT FROM OLD.group_id OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id OR
    NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR NEW.billing_period_start IS DISTINCT FROM OLD.billing_period_start OR
    NEW.billing_period_end IS DISTINCT FROM OLD.billing_period_end OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date OR
    NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.currency IS DISTINCT FROM OLD.currency OR
    NEW.billing_interval_snapshot IS DISTINCT FROM OLD.billing_interval_snapshot OR NEW.list_subtotal_cents IS DISTINCT FROM OLD.list_subtotal_cents OR
    NEW.promotion_discount_cents IS DISTINCT FROM OLD.promotion_discount_cents OR NEW.override_adjustment_cents IS DISTINCT FROM OLD.override_adjustment_cents OR
    NEW.setup_fee_amount_cents IS DISTINCT FROM OLD.setup_fee_amount_cents OR NEW.branch_unit_charge_cents IS DISTINCT FROM OLD.branch_unit_charge_cents OR
    NEW.employee_unit_charge_cents IS DISTINCT FROM OLD.employee_unit_charge_cents OR NEW.total_amount_cents IS DISTINCT FROM OLD.total_amount_cents OR
    NEW.price_snapshot IS DISTINCT FROM OLD.price_snapshot
  ) THEN RAISE EXCEPTION 'ISSUED_SUBSCRIPTION_INVOICE_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "subscription_invoice_snapshot_immutable" BEFORE UPDATE ON "subscription_invoices" FOR EACH ROW EXECUTE FUNCTION protect_subscription_invoice_snapshot();

CREATE OR REPLACE FUNCTION prevent_subscription_financial_delete() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'SUBSCRIPTION_FINANCIAL_FACT_DELETE_FORBIDDEN'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "subscription_invoice_no_delete" BEFORE DELETE ON "subscription_invoices" FOR EACH ROW EXECUTE FUNCTION prevent_subscription_financial_delete();
CREATE TRIGGER "subscription_payment_no_delete" BEFORE DELETE ON "subscription_payments" FOR EACH ROW EXECUTE FUNCTION prevent_subscription_financial_delete();
CREATE TRIGGER "subscription_payment_reversal_no_delete" BEFORE DELETE ON "subscription_payment_reversals" FOR EACH ROW EXECUTE FUNCTION prevent_subscription_financial_delete();
CREATE TRIGGER "subscription_invoice_line_no_delete" BEFORE DELETE ON "subscription_invoice_lines" FOR EACH ROW EXECUTE FUNCTION prevent_subscription_financial_delete();
CREATE TRIGGER "subscription_invoice_line_no_update" BEFORE UPDATE ON "subscription_invoice_lines" FOR EACH ROW EXECUTE FUNCTION prevent_subscription_financial_delete();

CREATE OR REPLACE FUNCTION protect_subscription_payment_snapshot() RETURNS trigger AS $$
BEGIN
  IF NEW.invoice_id IS DISTINCT FROM OLD.invoice_id OR NEW.payment_number IS DISTINCT FROM OLD.payment_number OR
    NEW.payment_date IS DISTINCT FROM OLD.payment_date OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents OR
    NEW.payment_method IS DISTINCT FROM OLD.payment_method OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference OR
    NEW.notes IS DISTINCT FROM OLD.notes OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
  THEN RAISE EXCEPTION 'SUBSCRIPTION_PAYMENT_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "subscription_payment_snapshot_immutable" BEFORE UPDATE ON "subscription_payments" FOR EACH ROW EXECUTE FUNCTION protect_subscription_payment_snapshot();
