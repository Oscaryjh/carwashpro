-- Supplier Bill / Accounts Payable Phase 1.
-- Bills and payments are financially effective only after explicit immutable transitions.
CREATE TYPE "SupplierBillStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'VOID');
CREATE TYPE "SupplierBillPaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');
CREATE TYPE "SupplierBillMatchStatus" AS ENUM ('MATCHED', 'PRICE_VARIANCE', 'QUANTITY_VARIANCE', 'RECEIPT_PENDING');
CREATE TYPE "SupplierPaymentStatus" AS ENUM ('COMPLETED', 'REVERSED');
CREATE TYPE "SupplierPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'EWALLET', 'CHEQUE', 'OTHER');
CREATE TYPE "SupplierApCommandType" AS ENUM ('CREATE_BILL', 'UPDATE_DRAFT_BILL', 'CONFIRM_BILL', 'VOID_BILL', 'RECORD_PAYMENT', 'REVERSE_PAYMENT', 'ATTACH_INVOICE');

ALTER TABLE "businesses" ADD COLUMN "supplier_bill_sequence" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "businesses" ADD COLUMN "supplier_payment_sequence" INTEGER NOT NULL DEFAULT 1000;

CREATE TABLE "supplier_bills" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "purchase_order_id" UUID NOT NULL,
  "bill_number" VARCHAR(40) NOT NULL,
  "supplier_invoice_number" VARCHAR(120) NOT NULL,
  "supplier_invoice_number_normalized" VARCHAR(120) NOT NULL,
  "status" "SupplierBillStatus" NOT NULL DEFAULT 'DRAFT',
  "payment_status" "SupplierBillPaymentStatus" NOT NULL DEFAULT 'UNPAID',
  "match_status" "SupplierBillMatchStatus" NOT NULL DEFAULT 'RECEIPT_PENDING',
  "invoice_date" DATE NOT NULL,
  "due_date" DATE NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'MYR',
  "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "price_variance_acknowledged" BOOLEAN NOT NULL DEFAULT false,
  "price_variance_reason" TEXT,
  "notes" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" UUID NOT NULL,
  "confirmed_by_id" UUID,
  "confirmed_at" TIMESTAMP(3),
  "voided_by_id" UUID,
  "voided_at" TIMESTAMP(3),
  "void_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_bills_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_bills_amount_check" CHECK ("subtotal" >= 0 AND "total_amount" >= 0 AND "subtotal" = "total_amount"),
  CONSTRAINT "supplier_bills_date_check" CHECK ("due_date" >= "invoice_date"),
  CONSTRAINT "supplier_bills_state_check" CHECK (
    ("status" = 'DRAFT' AND "confirmed_by_id" IS NULL AND "confirmed_at" IS NULL AND "voided_by_id" IS NULL AND "voided_at" IS NULL AND "void_reason" IS NULL)
    OR ("status" = 'CONFIRMED' AND "confirmed_by_id" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "voided_by_id" IS NULL AND "voided_at" IS NULL AND "void_reason" IS NULL)
    OR ("status" = 'VOID' AND "confirmed_by_id" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "voided_by_id" IS NOT NULL AND "voided_at" IS NOT NULL AND length(trim("void_reason")) >= 3)
  )
);

CREATE TABLE "supplier_bill_lines" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "supplier_bill_id" UUID NOT NULL,
  "purchase_order_line_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "description_snapshot" VARCHAR(240) NOT NULL,
  "billed_quantity" INTEGER NOT NULL,
  "unit_price" DECIMAL(12,2) NOT NULL,
  "line_total" DECIMAL(12,2) NOT NULL,
  "ordered_quantity_snapshot" INTEGER NOT NULL,
  "net_received_snapshot" INTEGER NOT NULL,
  "previously_billed_snapshot" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_bill_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_bill_lines_quantity_check" CHECK ("billed_quantity" > 0 AND "ordered_quantity_snapshot" > 0 AND "net_received_snapshot" >= 0 AND "previously_billed_snapshot" >= 0),
  CONSTRAINT "supplier_bill_lines_amount_check" CHECK ("unit_price" >= 0 AND "line_total" = "unit_price" * "billed_quantity")
);

CREATE TABLE "supplier_bill_attachments" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "supplier_bill_id" UUID NOT NULL,
  "object_key" VARCHAR(255) NOT NULL,
  "original_file_name" VARCHAR(160) NOT NULL,
  "sanitized_file_name" VARCHAR(120) NOT NULL,
  "mime_type" VARCHAR(80) NOT NULL,
  "byte_length" INTEGER NOT NULL,
  "checksum_sha256" VARCHAR(64) NOT NULL,
  "malware_status" VARCHAR(32) NOT NULL DEFAULT 'NOT_SCANNED',
  "privacy_metadata_status" VARCHAR(32) NOT NULL DEFAULT 'NOT_CHECKED',
  "uploaded_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_bill_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_bill_attachments_size_check" CHECK ("byte_length" > 0 AND "byte_length" <= 10485760),
  CONSTRAINT "supplier_bill_attachments_checksum_check" CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "supplier_bill_attachments_mime_check" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'))
);

CREATE TABLE "supplier_payments" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "supplier_bill_id" UUID NOT NULL,
  "payment_number" VARCHAR(40) NOT NULL,
  "status" "SupplierPaymentStatus" NOT NULL DEFAULT 'COMPLETED',
  "payment_date" DATE NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "payment_method" "SupplierPaymentMethod" NOT NULL,
  "payment_reference" VARCHAR(160),
  "notes" TEXT,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_payments_amount_check" CHECK ("amount" > 0)
);

CREATE TABLE "supplier_payment_reversals" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "supplier_payment_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_payment_reversals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_payment_reversals_reason_check" CHECK (length(trim("reason")) >= 3)
);

CREATE TABLE "supplier_ap_commands" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "operation_key" VARCHAR(180) NOT NULL,
  "command_type" "SupplierApCommandType" NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "result_entity_type" VARCHAR(50) NOT NULL,
  "result_entity_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_ap_commands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_bills_id_business_id_key" ON "supplier_bills"("id", "business_id");
CREATE UNIQUE INDEX "supplier_bills_business_id_bill_number_key" ON "supplier_bills"("business_id", "bill_number");
CREATE UNIQUE INDEX "supplier_bills_active_supplier_invoice_key" ON "supplier_bills"("business_id", "supplier_id", "supplier_invoice_number_normalized") WHERE "status" <> 'VOID';
CREATE INDEX "supplier_bills_business_id_branch_id_status_due_date_idx" ON "supplier_bills"("business_id", "branch_id", "status", "due_date");
CREATE INDEX "supplier_bills_business_id_supplier_id_status_due_date_idx" ON "supplier_bills"("business_id", "supplier_id", "status", "due_date");
CREATE INDEX "supplier_bills_business_id_purchase_order_id_status_idx" ON "supplier_bills"("business_id", "purchase_order_id", "status");
CREATE UNIQUE INDEX "supplier_bill_lines_id_business_id_key" ON "supplier_bill_lines"("id", "business_id");
CREATE UNIQUE INDEX "supplier_bill_lines_supplier_bill_id_purchase_order_line_id_key" ON "supplier_bill_lines"("supplier_bill_id", "purchase_order_line_id");
CREATE INDEX "supplier_bill_lines_business_id_purchase_order_line_id_idx" ON "supplier_bill_lines"("business_id", "purchase_order_line_id");
CREATE UNIQUE INDEX "supplier_bill_attachments_id_business_id_key" ON "supplier_bill_attachments"("id", "business_id");
CREATE UNIQUE INDEX "supplier_bill_attachments_supplier_bill_id_business_id_key" ON "supplier_bill_attachments"("supplier_bill_id", "business_id");
CREATE UNIQUE INDEX "supplier_bill_attachments_object_key_key" ON "supplier_bill_attachments"("object_key");
CREATE INDEX "supplier_bill_attachments_business_id_supplier_bill_id_idx" ON "supplier_bill_attachments"("business_id", "supplier_bill_id");
CREATE UNIQUE INDEX "supplier_payments_id_business_id_key" ON "supplier_payments"("id", "business_id");
CREATE UNIQUE INDEX "supplier_payments_business_id_payment_number_key" ON "supplier_payments"("business_id", "payment_number");
CREATE INDEX "supplier_payments_business_id_supplier_bill_id_status_idx" ON "supplier_payments"("business_id", "supplier_bill_id", "status");
CREATE INDEX "supplier_payments_business_id_supplier_id_payment_date_idx" ON "supplier_payments"("business_id", "supplier_id", "payment_date");
CREATE UNIQUE INDEX "supplier_payment_reversals_id_business_id_key" ON "supplier_payment_reversals"("id", "business_id");
CREATE UNIQUE INDEX "supplier_payment_reversals_supplier_payment_id_business_id_key" ON "supplier_payment_reversals"("supplier_payment_id", "business_id");
CREATE INDEX "supplier_payment_reversals_business_id_created_at_idx" ON "supplier_payment_reversals"("business_id", "created_at");
CREATE UNIQUE INDEX "supplier_ap_commands_business_id_operation_key_key" ON "supplier_ap_commands"("business_id", "operation_key");
CREATE INDEX "supplier_ap_commands_business_id_command_type_created_at_idx" ON "supplier_ap_commands"("business_id", "command_type", "created_at");

ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_supplier_id_business_id_fkey" FOREIGN KEY ("supplier_id", "business_id") REFERENCES "suppliers"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_purchase_order_id_business_id_fkey" FOREIGN KEY ("purchase_order_id", "business_id") REFERENCES "purchase_orders"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_supplier_bill_id_business_id_fkey" FOREIGN KEY ("supplier_bill_id", "business_id") REFERENCES "supplier_bills"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_purchase_order_line_id_business_id_fkey" FOREIGN KEY ("purchase_order_line_id", "business_id") REFERENCES "purchase_order_lines"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_bill_attachments" ADD CONSTRAINT "supplier_bill_attachments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_bill_attachments" ADD CONSTRAINT "supplier_bill_attachments_supplier_bill_id_business_id_fkey" FOREIGN KEY ("supplier_bill_id", "business_id") REFERENCES "supplier_bills"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_bill_attachments" ADD CONSTRAINT "supplier_bill_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_business_id_fkey" FOREIGN KEY ("supplier_id", "business_id") REFERENCES "suppliers"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_bill_id_business_id_fkey" FOREIGN KEY ("supplier_bill_id", "business_id") REFERENCES "supplier_bills"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payment_reversals" ADD CONSTRAINT "supplier_payment_reversals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payment_reversals" ADD CONSTRAINT "supplier_payment_reversals_supplier_payment_id_business_id_fkey" FOREIGN KEY ("supplier_payment_id", "business_id") REFERENCES "supplier_payments"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payment_reversals" ADD CONSTRAINT "supplier_payment_reversals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_ap_commands" ADD CONSTRAINT "supplier_ap_commands_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_ap_commands" ADD CONSTRAINT "supplier_ap_commands_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The duplicate key applies only to active financial facts; a void bill may be replaced.
-- Confirmed bill facts are immutable except for canonical, service-derived payment status.
CREATE OR REPLACE FUNCTION protect_supplier_bill_facts()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'supplier bills cannot be deleted; void a confirmed bill';
  END IF;
  IF OLD."status" IN ('CONFIRMED', 'VOID') AND
     ROW(NEW."business_id", NEW."branch_id", NEW."supplier_id", NEW."purchase_order_id", NEW."bill_number", NEW."supplier_invoice_number", NEW."supplier_invoice_number_normalized", NEW."invoice_date", NEW."due_date", NEW."currency", NEW."subtotal", NEW."total_amount", NEW."price_variance_acknowledged", NEW."price_variance_reason", NEW."notes", NEW."created_by_id", NEW."confirmed_by_id", NEW."confirmed_at", NEW."created_at")
     IS DISTINCT FROM
     ROW(OLD."business_id", OLD."branch_id", OLD."supplier_id", OLD."purchase_order_id", OLD."bill_number", OLD."supplier_invoice_number", OLD."supplier_invoice_number_normalized", OLD."invoice_date", OLD."due_date", OLD."currency", OLD."subtotal", OLD."total_amount", OLD."price_variance_acknowledged", OLD."price_variance_reason", OLD."notes", OLD."created_by_id", OLD."confirmed_by_id", OLD."confirmed_at", OLD."created_at") THEN
    RAISE EXCEPTION 'confirmed supplier bill facts are immutable';
  END IF;
  IF OLD."status" = 'VOID' AND NEW."status" <> 'VOID' THEN
    RAISE EXCEPTION 'void supplier bills are terminal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER supplier_bills_protect_update BEFORE UPDATE ON "supplier_bills" FOR EACH ROW EXECUTE FUNCTION protect_supplier_bill_facts();
CREATE TRIGGER supplier_bills_prevent_delete BEFORE DELETE ON "supplier_bills" FOR EACH ROW EXECUTE FUNCTION protect_supplier_bill_facts();

CREATE OR REPLACE FUNCTION protect_supplier_bill_line()
RETURNS trigger AS $$
DECLARE bill_status "SupplierBillStatus";
BEGIN
  SELECT "status" INTO bill_status FROM "supplier_bills" WHERE "id" = OLD."supplier_bill_id";
  IF bill_status <> 'DRAFT' OR TG_OP = 'DELETE' AND bill_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'confirmed supplier bill lines are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER supplier_bill_lines_protect_update BEFORE UPDATE OR DELETE ON "supplier_bill_lines" FOR EACH ROW EXECUTE FUNCTION protect_supplier_bill_line();

CREATE OR REPLACE FUNCTION protect_supplier_payment()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'supplier payments cannot be deleted; create a reversal';
  END IF;
  IF OLD."status" = 'REVERSED' OR NEW."status" <> 'REVERSED' OR
     ROW(NEW."business_id", NEW."branch_id", NEW."supplier_id", NEW."supplier_bill_id", NEW."payment_number", NEW."payment_date", NEW."amount", NEW."payment_method", NEW."payment_reference", NEW."notes", NEW."created_by_id", NEW."created_at")
     IS DISTINCT FROM
     ROW(OLD."business_id", OLD."branch_id", OLD."supplier_id", OLD."supplier_bill_id", OLD."payment_number", OLD."payment_date", OLD."amount", OLD."payment_method", OLD."payment_reference", OLD."notes", OLD."created_by_id", OLD."created_at") THEN
    RAISE EXCEPTION 'completed supplier payments are immutable; create a reversal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER supplier_payments_protect_update BEFORE UPDATE ON "supplier_payments" FOR EACH ROW EXECUTE FUNCTION protect_supplier_payment();
CREATE TRIGGER supplier_payments_prevent_delete BEFORE DELETE ON "supplier_payments" FOR EACH ROW EXECUTE FUNCTION protect_supplier_payment();

CREATE OR REPLACE FUNCTION prevent_supplier_ap_append_only_mutation()
RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'supplier AP history is immutable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER supplier_payment_reversals_prevent_update BEFORE UPDATE ON "supplier_payment_reversals" FOR EACH ROW EXECUTE FUNCTION prevent_supplier_ap_append_only_mutation();
CREATE TRIGGER supplier_payment_reversals_prevent_delete BEFORE DELETE ON "supplier_payment_reversals" FOR EACH ROW EXECUTE FUNCTION prevent_supplier_ap_append_only_mutation();
CREATE TRIGGER supplier_ap_commands_prevent_update BEFORE UPDATE ON "supplier_ap_commands" FOR EACH ROW EXECUTE FUNCTION prevent_supplier_ap_append_only_mutation();
CREATE TRIGGER supplier_ap_commands_prevent_delete BEFORE DELETE ON "supplier_ap_commands" FOR EACH ROW EXECUTE FUNCTION prevent_supplier_ap_append_only_mutation();
CREATE TRIGGER supplier_bill_attachments_prevent_update BEFORE UPDATE ON "supplier_bill_attachments" FOR EACH ROW EXECUTE FUNCTION prevent_supplier_ap_append_only_mutation();
CREATE TRIGGER supplier_bill_attachments_prevent_delete BEFORE DELETE ON "supplier_bill_attachments" FOR EACH ROW EXECUTE FUNCTION prevent_supplier_ap_append_only_mutation();

-- User references must belong to the same business; platform users are not AP actors.
CREATE OR REPLACE FUNCTION supplier_ap_user_scope_guard()
RETURNS trigger AS $$
DECLARE candidate UUID;
BEGIN
  FOREACH candidate IN ARRAY ARRAY[
    (to_jsonb(NEW)->>'created_by_id')::UUID,
    (to_jsonb(NEW)->>'confirmed_by_id')::UUID,
    (to_jsonb(NEW)->>'voided_by_id')::UUID,
    (to_jsonb(NEW)->>'uploaded_by_id')::UUID,
    (to_jsonb(NEW)->>'actor_user_id')::UUID
  ] LOOP
    IF candidate IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = candidate AND "business_id" = NEW."business_id") THEN
      RAISE EXCEPTION 'supplier AP actor is outside business scope';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER supplier_bills_user_scope BEFORE INSERT OR UPDATE ON "supplier_bills" FOR EACH ROW EXECUTE FUNCTION supplier_ap_user_scope_guard();
CREATE TRIGGER supplier_bill_attachments_user_scope BEFORE INSERT ON "supplier_bill_attachments" FOR EACH ROW EXECUTE FUNCTION supplier_ap_user_scope_guard();
CREATE TRIGGER supplier_payments_user_scope BEFORE INSERT OR UPDATE ON "supplier_payments" FOR EACH ROW EXECUTE FUNCTION supplier_ap_user_scope_guard();
CREATE TRIGGER supplier_payment_reversals_user_scope BEFORE INSERT ON "supplier_payment_reversals" FOR EACH ROW EXECUTE FUNCTION supplier_ap_user_scope_guard();
CREATE TRIGGER supplier_ap_commands_user_scope BEFORE INSERT ON "supplier_ap_commands" FOR EACH ROW EXECUTE FUNCTION supplier_ap_user_scope_guard();
