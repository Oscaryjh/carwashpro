-- Tetamu Inventory Phase 1 is additive. Existing products remain untracked.
ALTER TYPE "BusinessModuleKey" ADD VALUE IF NOT EXISTS 'INVENTORY';

CREATE TYPE "InventoryMovementType" AS ENUM (
  'OPENING_BALANCE', 'SALE', 'REFUND_RESTOCK', 'STOCK_IN', 'STOCK_OUT',
  'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'TRANSFER_IN',
  'VOID_REVERSAL', 'SYSTEM_CORRECTION'
);
CREATE TYPE "InventoryTransferStatus" AS ENUM ('COMPLETED');
CREATE TYPE "InventoryRefundDisposition" AS ENUM ('RESTOCK', 'NO_RESTOCK');

ALTER TABLE "products"
  ADD COLUMN "track_inventory" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "product_stocks"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "invoice_items"
  ADD COLUMN "inventory_tracked" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "products_id_business_id_key" ON "products"("id", "business_id");
CREATE UNIQUE INDEX "products_business_id_sku_key" ON "products"("business_id", "sku");
CREATE UNIQUE INDEX "payment_refunds_id_business_id_key" ON "payment_refunds"("id", "business_id");
CREATE UNIQUE INDEX "invoice_items_id_business_id_key" ON "invoice_items"("id", "business_id");

ALTER TABLE "product_stocks" DROP CONSTRAINT "product_stocks_branch_id_fkey";
ALTER TABLE "product_stocks" DROP CONSTRAINT "product_stocks_product_id_fkey";
ALTER TABLE "product_stocks"
  ADD CONSTRAINT "product_stocks_branch_scope_fkey"
  FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_stocks"
  ADD CONSTRAINT "product_stocks_product_scope_fkey"
  FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "inventory_transfers" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "source_branch_id" UUID NOT NULL,
  "destination_branch_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "quantity" INTEGER NOT NULL,
  "status" "InventoryTransferStatus" NOT NULL DEFAULT 'COMPLETED',
  "operation_key" VARCHAR(160) NOT NULL,
  "reason" TEXT NOT NULL,
  "reference" TEXT,
  "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_transfers_positive_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "inventory_transfers_distinct_branches_check" CHECK ("source_branch_id" <> "destination_branch_id"),
  CONSTRAINT "inventory_transfers_reason_check" CHECK (length(btrim("reason")) >= 3)
);

CREATE TABLE "inventory_movements" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "transfer_id" UUID,
  "actor_user_id" UUID,
  "type" "InventoryMovementType" NOT NULL,
  "quantity_delta" INTEGER NOT NULL,
  "quantity_before" INTEGER NOT NULL,
  "quantity_after" INTEGER NOT NULL,
  "source_type" VARCHAR(50) NOT NULL,
  "source_id" VARCHAR(160) NOT NULL,
  "source_line_id" UUID,
  "operation_key" VARCHAR(180) NOT NULL,
  "reason" TEXT NOT NULL,
  "reference" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_movements_nonzero_delta_check" CHECK ("quantity_delta" <> 0),
  CONSTRAINT "inventory_movements_arithmetic_check" CHECK ("quantity_before" + "quantity_delta" = "quantity_after"),
  CONSTRAINT "inventory_movements_nonnegative_check" CHECK ("quantity_before" >= 0 AND "quantity_after" >= 0),
  CONSTRAINT "inventory_movements_reason_check" CHECK (length(btrim("reason")) >= 3)
);

CREATE TABLE "inventory_refund_lines" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "payment_refund_id" UUID NOT NULL,
  "invoice_item_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "quantity" INTEGER NOT NULL,
  "disposition" "InventoryRefundDisposition" NOT NULL,
  "no_restock_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_refund_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_refund_lines_positive_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "inventory_refund_lines_no_restock_reason_check" CHECK (
    "disposition" <> 'NO_RESTOCK' OR length(btrim(COALESCE("no_restock_reason", ''))) >= 3
  )
);

CREATE UNIQUE INDEX "inventory_transfers_id_business_id_key" ON "inventory_transfers"("id", "business_id");
CREATE UNIQUE INDEX "inventory_transfers_business_id_operation_key_key" ON "inventory_transfers"("business_id", "operation_key");
CREATE INDEX "inventory_transfers_business_id_completed_at_idx" ON "inventory_transfers"("business_id", "completed_at");
CREATE INDEX "inventory_transfers_source_branch_id_idx" ON "inventory_transfers"("source_branch_id");
CREATE INDEX "inventory_transfers_destination_branch_id_idx" ON "inventory_transfers"("destination_branch_id");

CREATE UNIQUE INDEX "inventory_movements_business_id_operation_key_key" ON "inventory_movements"("business_id", "operation_key");
CREATE INDEX "inventory_movements_business_branch_product_created_idx" ON "inventory_movements"("business_id", "branch_id", "product_id", "created_at");
CREATE INDEX "inventory_movements_business_source_idx" ON "inventory_movements"("business_id", "source_type", "source_id");
CREATE INDEX "inventory_movements_transfer_id_idx" ON "inventory_movements"("transfer_id");

CREATE UNIQUE INDEX "inventory_refund_lines_payment_refund_item_key" ON "inventory_refund_lines"("payment_refund_id", "invoice_item_id");
CREATE INDEX "inventory_refund_lines_business_branch_product_idx" ON "inventory_refund_lines"("business_id", "branch_id", "product_id");
CREATE INDEX "inventory_refund_lines_invoice_item_id_idx" ON "inventory_refund_lines"("invoice_item_id");

ALTER TABLE "inventory_transfers"
  ADD CONSTRAINT "inventory_transfers_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_transfers_source_branch_scope_fkey" FOREIGN KEY ("source_branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_transfers_destination_branch_scope_fkey" FOREIGN KEY ("destination_branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_transfers_product_scope_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_transfers_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_movements_branch_scope_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_movements_product_scope_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_movements_transfer_scope_fkey" FOREIGN KEY ("transfer_id", "business_id") REFERENCES "inventory_transfers"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_movements_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_refund_lines"
  ADD CONSTRAINT "inventory_refund_lines_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_refund_lines_branch_scope_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_refund_lines_payment_refund_scope_fkey" FOREIGN KEY ("payment_refund_id", "business_id") REFERENCES "payment_refunds"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_refund_lines_invoice_item_scope_fkey" FOREIGN KEY ("invoice_item_id", "business_id") REFERENCES "invoice_items"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_refund_lines_product_scope_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_refund_lines_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ledger rows are append-only. Corrections must be new reversing/correction movements.
CREATE OR REPLACE FUNCTION prevent_inventory_movement_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inventory_movements are immutable; append a correction movement';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_movements_prevent_update
BEFORE UPDATE ON "inventory_movements"
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_movement_mutation();

CREATE TRIGGER inventory_movements_prevent_delete
BEFORE DELETE ON "inventory_movements"
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_movement_mutation();

-- Actor scope is guarded in the database in addition to application authorization.
CREATE OR REPLACE FUNCTION enforce_inventory_actor_scope()
RETURNS trigger AS $$
BEGIN
  IF NEW."actor_user_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "users" u
    WHERE u."id" = NEW."actor_user_id" AND u."business_id" = NEW."business_id"
  ) THEN
    RAISE EXCEPTION 'inventory actor tenant scope mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_movements_actor_scope_guard
BEFORE INSERT ON "inventory_movements"
FOR EACH ROW EXECUTE FUNCTION enforce_inventory_actor_scope();
CREATE TRIGGER inventory_transfers_actor_scope_guard
BEFORE INSERT ON "inventory_transfers"
FOR EACH ROW EXECUTE FUNCTION enforce_inventory_actor_scope();
CREATE TRIGGER inventory_refund_lines_actor_scope_guard
BEFORE INSERT ON "inventory_refund_lines"
FOR EACH ROW EXECUTE FUNCTION enforce_inventory_actor_scope();
