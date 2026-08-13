-- Expense Phase 2B: confirmed Supplier Bill materialization and AP settlement projection.
ALTER TABLE "supplier_bills" ADD COLUMN "confirmed_revision" INTEGER;
UPDATE "supplier_bills"
SET "confirmed_revision" = "revision"
WHERE "status" = 'CONFIRMED'
  AND "confirmed_revision" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "supplier_payments" payment
    WHERE payment."supplier_bill_id" = "supplier_bills"."id"
  );

-- Paid or void legacy bills do not expose their historical confirmation revision.
-- They intentionally remain NULL for controlled reconciliation instead of guessing.

ALTER TABLE "expense_integration_settings"
  ADD COLUMN "inventory_purchase_category_id" UUID;

ALTER TABLE "expense_integration_settings"
  ADD CONSTRAINT "expense_integration_settings_inventory_purchase_category_id_business_id_fkey"
  FOREIGN KEY ("inventory_purchase_category_id", "business_id")
  REFERENCES "expense_categories"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "expense_source_settlements" (
  "expense_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "source_type" "ExpenseSourceType" NOT NULL,
  "source_id" VARCHAR(180) NOT NULL,
  "source_revision" VARCHAR(100) NOT NULL,
  "source_status" VARCHAR(40) NOT NULL,
  "settlement_status" VARCHAR(40) NOT NULL,
  "paid_amount" DECIMAL(14,2) NOT NULL,
  "outstanding_amount" DECIMAL(14,2) NOT NULL,
  "source_digest" CHAR(64) NOT NULL,
  "source_updated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expense_source_settlements_pkey" PRIMARY KEY ("expense_id"),
  CONSTRAINT "expense_source_settlements_supported_source" CHECK ("source_type" = 'INVENTORY_PURCHASE'),
  CONSTRAINT "expense_source_settlements_status" CHECK ("source_status" IN ('CONFIRMED', 'VOID')),
  CONSTRAINT "expense_source_settlements_payment_status" CHECK ("settlement_status" IN ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOID')),
  CONSTRAINT "expense_source_settlements_money" CHECK ("paid_amount" >= 0 AND "outstanding_amount" >= 0)
);

CREATE UNIQUE INDEX "expense_source_settlements_business_id_source_type_source_id_source_revision_key"
  ON "expense_source_settlements"("business_id", "source_type", "source_id", "source_revision");
CREATE UNIQUE INDEX "expense_source_settlements_expense_id_business_id_key"
  ON "expense_source_settlements"("expense_id", "business_id");
CREATE INDEX "expense_source_settlements_business_id_source_type_settlement_status_idx"
  ON "expense_source_settlements"("business_id", "source_type", "settlement_status");
CREATE INDEX "expense_source_settlements_business_id_source_id_idx"
  ON "expense_source_settlements"("business_id", "source_id");

ALTER TABLE "expense_source_settlements"
  ADD CONSTRAINT "expense_source_settlements_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_source_settlements"
  ADD CONSTRAINT "expense_source_settlements_expense_id_business_id_fkey"
  FOREIGN KEY ("expense_id", "business_id") REFERENCES "business_expenses"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expense_integration_settings" DROP CONSTRAINT "expense_integration_settings_category_required";
ALTER TABLE "expense_integration_settings"
  ADD CONSTRAINT "expense_integration_settings_category_required"
  CHECK (
    "claim_default_category_id" IS NOT NULL OR
    "payroll_category_id" IS NOT NULL OR
    "inventory_purchase_category_id" IS NOT NULL
  );

ALTER TABLE "expense_source_snapshots" DROP CONSTRAINT "expense_source_snapshots_supported_source";
ALTER TABLE "expense_source_snapshots"
  ADD CONSTRAINT "expense_source_snapshots_supported_source"
  CHECK ("source_type" IN ('CLAIM', 'PAYROLL', 'INVENTORY_PURCHASE'));

DROP INDEX "business_expenses_one_active_system_source";
CREATE UNIQUE INDEX "business_expenses_one_active_system_source"
ON "business_expenses"("business_id", "source_type", "source_id")
WHERE "status" <> 'VOID' AND "source_type" IN ('CLAIM', 'PAYROLL', 'INVENTORY_PURCHASE');

CREATE OR REPLACE FUNCTION protect_supplier_bill_facts()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'supplier bills cannot be deleted; void a confirmed bill';
  END IF;
  IF OLD."status" IN ('CONFIRMED', 'VOID') AND
     ROW(NEW."business_id", NEW."branch_id", NEW."supplier_id", NEW."purchase_order_id", NEW."bill_number", NEW."supplier_invoice_number", NEW."supplier_invoice_number_normalized", NEW."invoice_date", NEW."due_date", NEW."currency", NEW."subtotal", NEW."total_amount", NEW."price_variance_acknowledged", NEW."price_variance_reason", NEW."notes", NEW."created_by_id", NEW."confirmed_by_id", NEW."confirmed_at", NEW."confirmed_revision", NEW."created_at")
     IS DISTINCT FROM
     ROW(OLD."business_id", OLD."branch_id", OLD."supplier_id", OLD."purchase_order_id", OLD."bill_number", OLD."supplier_invoice_number", OLD."supplier_invoice_number_normalized", OLD."invoice_date", OLD."due_date", OLD."currency", OLD."subtotal", OLD."total_amount", OLD."price_variance_acknowledged", OLD."price_variance_reason", OLD."notes", OLD."created_by_id", OLD."confirmed_by_id", OLD."confirmed_at", OLD."confirmed_revision", OLD."created_at") THEN
    RAISE EXCEPTION 'confirmed supplier bill facts are immutable';
  END IF;
  IF OLD."status" = 'VOID' AND NEW."status" <> 'VOID' THEN
    RAISE EXCEPTION 'void supplier bills are terminal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_expense_inventory_purchase_source()
RETURNS trigger AS $$
DECLARE bill_business UUID; bill_branch UUID; bill_status "SupplierBillStatus"; bill_revision INTEGER;
BEGIN
  IF NEW."source_type" <> 'INVENTORY_PURCHASE' THEN RETURN NEW; END IF;
  SELECT "business_id", "branch_id", "status", "confirmed_revision"
    INTO bill_business, bill_branch, bill_status, bill_revision
    FROM "supplier_bills" WHERE "id"::text = NEW."source_id";
  IF bill_business IS NULL OR bill_business <> NEW."business_id" OR bill_branch IS DISTINCT FROM NEW."branch_id" THEN
    RAISE EXCEPTION 'inventory purchase expense source is outside business or branch scope';
  END IF;
  IF bill_status NOT IN ('CONFIRMED', 'VOID') OR bill_revision::text <> NEW."source_revision" THEN
    RAISE EXCEPTION 'inventory purchase expense requires the confirmed supplier bill revision';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "business_expenses_inventory_purchase_source_guard"
BEFORE INSERT OR UPDATE ON "business_expenses"
FOR EACH ROW EXECUTE FUNCTION guard_expense_inventory_purchase_source();

CREATE OR REPLACE FUNCTION guard_expense_source_settlement()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "business_expenses" e
    WHERE e."id" = NEW."expense_id" AND e."business_id" = NEW."business_id"
      AND e."source_type" = NEW."source_type" AND e."source_id" = NEW."source_id"
      AND e."source_revision" = NEW."source_revision"
  ) THEN RAISE EXCEPTION 'expense settlement source identity mismatch'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "expense_source_settlements_scope_guard"
BEFORE INSERT OR UPDATE ON "expense_source_settlements"
FOR EACH ROW EXECUTE FUNCTION guard_expense_source_settlement();

-- Business transactions are intentionally not backfilled in this migration.
