-- Inventory Phase 2: business-scoped suppliers, purchase orders, immutable goods receipts and reversals.
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED', 'CLOSED');
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('RECEIVED', 'PARTIALLY_REVERSED', 'REVERSED');
CREATE TYPE "InventoryPurchasingCommandType" AS ENUM ('CREATE_SUPPLIER', 'UPDATE_SUPPLIER', 'CREATE_PURCHASE_ORDER', 'UPDATE_PURCHASE_ORDER', 'APPROVE_PURCHASE_ORDER', 'CANCEL_PURCHASE_ORDER', 'CLOSE_PURCHASE_ORDER', 'RECEIVE_PURCHASE_ORDER', 'REVERSE_GOODS_RECEIPT');

ALTER TABLE "businesses" ADD COLUMN "purchase_order_sequence" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "businesses" ADD COLUMN "goods_receipt_sequence" INTEGER NOT NULL DEFAULT 1000;

CREATE TABLE "suppliers" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "code" VARCHAR(40),
  "name" VARCHAR(160) NOT NULL,
  "contact_person" VARCHAR(120),
  "phone" VARCHAR(40),
  "email" VARCHAR(160),
  "address" TEXT,
  "notes" TEXT,
  "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_orders" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "po_number" VARCHAR(40) NOT NULL,
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "order_date" DATE NOT NULL,
  "expected_date" DATE,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'MYR',
  "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" UUID NOT NULL,
  "approved_by_id" UUID,
  "approved_at" TIMESTAMP(3),
  "cancelled_by_id" UUID,
  "cancelled_at" TIMESTAMP(3),
  "cancellation_reason" TEXT,
  "closed_by_id" UUID,
  "closed_at" TIMESTAMP(3),
  "close_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_order_lines" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "purchase_order_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "ordered_quantity" INTEGER NOT NULL,
  "received_quantity" INTEGER NOT NULL DEFAULT 0,
  "expected_unit_cost" DECIMAL(12,2) NOT NULL,
  "expected_total" DECIMAL(12,2) NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_lines_quantity_check" CHECK ("ordered_quantity" > 0 AND "received_quantity" >= 0 AND "received_quantity" <= "ordered_quantity"),
  CONSTRAINT "purchase_order_lines_cost_check" CHECK ("expected_unit_cost" >= 0 AND "expected_total" >= 0)
);

CREATE TABLE "goods_receipts" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "purchase_order_id" UUID NOT NULL,
  "receipt_number" VARCHAR(40) NOT NULL,
  "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'RECEIVED',
  "delivery_reference" VARCHAR(120),
  "notes" TEXT,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "received_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goods_receipt_lines" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "goods_receipt_id" UUID NOT NULL,
  "purchase_order_line_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "received_quantity" INTEGER NOT NULL,
  "unit_cost_snapshot" DECIMAL(12,2) NOT NULL,
  "ordered_quantity_snapshot" INTEGER NOT NULL,
  "previously_received" INTEGER NOT NULL,
  "remaining_after_receipt" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goods_receipt_lines_quantity_check" CHECK ("received_quantity" > 0 AND "ordered_quantity_snapshot" > 0 AND "previously_received" >= 0 AND "remaining_after_receipt" >= 0),
  CONSTRAINT "goods_receipt_lines_cost_check" CHECK ("unit_cost_snapshot" >= 0)
);

CREATE TABLE "goods_receipt_reversals" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "goods_receipt_id" UUID NOT NULL,
  "goods_receipt_line_id" UUID NOT NULL,
  "purchase_order_id" UUID NOT NULL,
  "purchase_order_line_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "reversed_quantity" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "goods_receipt_reversals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goods_receipt_reversals_quantity_check" CHECK ("reversed_quantity" > 0)
);

CREATE TABLE "inventory_purchasing_commands" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "operation_key" VARCHAR(180) NOT NULL,
  "command_type" "InventoryPurchasingCommandType" NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "result_entity_type" VARCHAR(50) NOT NULL,
  "result_entity_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_purchasing_commands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "suppliers_id_business_id_key" ON "suppliers"("id", "business_id");
CREATE UNIQUE INDEX "suppliers_business_id_code_key" ON "suppliers"("business_id", "code");
CREATE INDEX "suppliers_business_id_status_name_idx" ON "suppliers"("business_id", "status", "name");
CREATE UNIQUE INDEX "purchase_orders_id_business_id_key" ON "purchase_orders"("id", "business_id");
CREATE UNIQUE INDEX "purchase_orders_business_id_po_number_key" ON "purchase_orders"("business_id", "po_number");
CREATE INDEX "purchase_orders_business_id_status_order_date_idx" ON "purchase_orders"("business_id", "status", "order_date");
CREATE INDEX "purchase_orders_business_id_branch_id_status_idx" ON "purchase_orders"("business_id", "branch_id", "status");
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");
CREATE UNIQUE INDEX "purchase_order_lines_id_business_id_key" ON "purchase_order_lines"("id", "business_id");
CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_id_product_id_key" ON "purchase_order_lines"("purchase_order_id", "product_id");
CREATE INDEX "purchase_order_lines_business_id_product_id_idx" ON "purchase_order_lines"("business_id", "product_id");
CREATE UNIQUE INDEX "goods_receipts_id_business_id_key" ON "goods_receipts"("id", "business_id");
CREATE UNIQUE INDEX "goods_receipts_business_id_receipt_number_key" ON "goods_receipts"("business_id", "receipt_number");
CREATE INDEX "goods_receipts_business_id_purchase_order_id_received_at_idx" ON "goods_receipts"("business_id", "purchase_order_id", "received_at");
CREATE INDEX "goods_receipts_business_id_branch_id_received_at_idx" ON "goods_receipts"("business_id", "branch_id", "received_at");
CREATE UNIQUE INDEX "goods_receipt_lines_id_business_id_key" ON "goods_receipt_lines"("id", "business_id");
CREATE UNIQUE INDEX "goods_receipt_lines_goods_receipt_id_purchase_order_line_id_key" ON "goods_receipt_lines"("goods_receipt_id", "purchase_order_line_id");
CREATE INDEX "goods_receipt_lines_business_id_product_id_idx" ON "goods_receipt_lines"("business_id", "product_id");
CREATE UNIQUE INDEX "goods_receipt_reversals_id_business_id_key" ON "goods_receipt_reversals"("id", "business_id");
CREATE INDEX "goods_receipt_reversals_business_id_goods_receipt_line_id_created_at_idx" ON "goods_receipt_reversals"("business_id", "goods_receipt_line_id", "created_at");
CREATE INDEX "goods_receipt_reversals_business_id_purchase_order_line_id_idx" ON "goods_receipt_reversals"("business_id", "purchase_order_line_id");
CREATE UNIQUE INDEX "inventory_purchasing_commands_business_id_operation_key_key" ON "inventory_purchasing_commands"("business_id", "operation_key");
CREATE INDEX "inventory_purchasing_commands_business_id_command_type_created_at_idx" ON "inventory_purchasing_commands"("business_id", "command_type", "created_at");

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_business_id_fkey" FOREIGN KEY ("supplier_id", "business_id") REFERENCES "suppliers"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_business_id_fkey" FOREIGN KEY ("purchase_order_id", "business_id") REFERENCES "purchase_orders"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_business_id_fkey" FOREIGN KEY ("supplier_id", "business_id") REFERENCES "suppliers"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_business_id_fkey" FOREIGN KEY ("purchase_order_id", "business_id") REFERENCES "purchase_orders"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_goods_receipt_id_business_id_fkey" FOREIGN KEY ("goods_receipt_id", "business_id") REFERENCES "goods_receipts"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_purchase_order_line_id_business_id_fkey" FOREIGN KEY ("purchase_order_line_id", "business_id") REFERENCES "purchase_order_lines"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_reversals" ADD CONSTRAINT "goods_receipt_reversals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_reversals" ADD CONSTRAINT "goods_receipt_reversals_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_reversals" ADD CONSTRAINT "goods_receipt_reversals_goods_receipt_id_business_id_fkey" FOREIGN KEY ("goods_receipt_id", "business_id") REFERENCES "goods_receipts"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_reversals" ADD CONSTRAINT "goods_receipt_reversals_goods_receipt_line_id_business_id_fkey" FOREIGN KEY ("goods_receipt_line_id", "business_id") REFERENCES "goods_receipt_lines"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_reversals" ADD CONSTRAINT "goods_receipt_reversals_purchase_order_id_business_id_fkey" FOREIGN KEY ("purchase_order_id", "business_id") REFERENCES "purchase_orders"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_reversals" ADD CONSTRAINT "goods_receipt_reversals_purchase_order_line_id_business_id_fkey" FOREIGN KEY ("purchase_order_line_id", "business_id") REFERENCES "purchase_order_lines"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_reversals" ADD CONSTRAINT "goods_receipt_reversals_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_reversals" ADD CONSTRAINT "goods_receipt_reversals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_purchasing_commands" ADD CONSTRAINT "inventory_purchasing_commands_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_purchasing_commands" ADD CONSTRAINT "inventory_purchasing_commands_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Receipt facts and reversal facts are append-only. Only the derived receipt status may change.
CREATE OR REPLACE FUNCTION protect_goods_receipt_facts()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'goods receipts are immutable; create a receipt reversal';
  END IF;
  IF ROW(NEW."business_id", NEW."branch_id", NEW."supplier_id", NEW."purchase_order_id", NEW."receipt_number", NEW."delivery_reference", NEW."notes", NEW."received_at", NEW."received_by_id", NEW."created_at")
     IS DISTINCT FROM
     ROW(OLD."business_id", OLD."branch_id", OLD."supplier_id", OLD."purchase_order_id", OLD."receipt_number", OLD."delivery_reference", OLD."notes", OLD."received_at", OLD."received_by_id", OLD."created_at") THEN
    RAISE EXCEPTION 'goods receipt facts are immutable; create a receipt reversal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER goods_receipts_protect_update BEFORE UPDATE ON "goods_receipts" FOR EACH ROW EXECUTE FUNCTION protect_goods_receipt_facts();
CREATE TRIGGER goods_receipts_prevent_delete BEFORE DELETE ON "goods_receipts" FOR EACH ROW EXECUTE FUNCTION protect_goods_receipt_facts();

CREATE OR REPLACE FUNCTION prevent_purchasing_append_only_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'purchasing receipt records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER goods_receipt_lines_prevent_update BEFORE UPDATE ON "goods_receipt_lines" FOR EACH ROW EXECUTE FUNCTION prevent_purchasing_append_only_mutation();
CREATE TRIGGER goods_receipt_lines_prevent_delete BEFORE DELETE ON "goods_receipt_lines" FOR EACH ROW EXECUTE FUNCTION prevent_purchasing_append_only_mutation();
CREATE TRIGGER goods_receipt_reversals_prevent_update BEFORE UPDATE ON "goods_receipt_reversals" FOR EACH ROW EXECUTE FUNCTION prevent_purchasing_append_only_mutation();
CREATE TRIGGER goods_receipt_reversals_prevent_delete BEFORE DELETE ON "goods_receipt_reversals" FOR EACH ROW EXECUTE FUNCTION prevent_purchasing_append_only_mutation();
CREATE TRIGGER inventory_purchasing_commands_prevent_update BEFORE UPDATE ON "inventory_purchasing_commands" FOR EACH ROW EXECUTE FUNCTION prevent_purchasing_append_only_mutation();
CREATE TRIGGER inventory_purchasing_commands_prevent_delete BEFORE DELETE ON "inventory_purchasing_commands" FOR EACH ROW EXECUTE FUNCTION prevent_purchasing_append_only_mutation();
