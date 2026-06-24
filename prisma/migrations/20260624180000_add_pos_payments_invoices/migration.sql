CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'DUITNOW', 'EWALLET', 'BANK_TRANSFER');
CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'VOID');

ALTER TABLE "work_orders"
  ADD COLUMN "paid_amount" DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "balance" DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "payment_status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID';

UPDATE "work_orders"
SET "balance" = "total"
WHERE "balance" = 0;

CREATE INDEX "work_orders_payment_status_idx" ON "work_orders"("payment_status");

CREATE TABLE "payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "amount" DECIMAL(10, 2) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "reference" TEXT,
  "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "invoice_number" TEXT NOT NULL,
  "subtotal" DECIMAL(10, 2) NOT NULL,
  "total" DECIMAL(10, 2) NOT NULL,
  "paid_amount" DECIMAL(10, 2) NOT NULL,
  "balance" DECIMAL(10, 2) NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payments_business_id_idx" ON "payments"("business_id");
CREATE INDEX "payments_work_order_id_idx" ON "payments"("work_order_id");
CREATE INDEX "payments_paid_at_idx" ON "payments"("paid_at");

CREATE UNIQUE INDEX "invoices_work_order_id_key" ON "invoices"("work_order_id");
CREATE UNIQUE INDEX "invoices_business_id_invoice_number_key" ON "invoices"("business_id", "invoice_number");
CREATE INDEX "invoices_business_id_idx" ON "invoices"("business_id");
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_business_id_fkey"
  FOREIGN KEY ("business_id")
  REFERENCES "businesses"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_work_order_id_fkey"
  FOREIGN KEY ("work_order_id")
  REFERENCES "work_orders"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_business_id_fkey"
  FOREIGN KEY ("business_id")
  REFERENCES "businesses"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_work_order_id_fkey"
  FOREIGN KEY ("work_order_id")
  REFERENCES "work_orders"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE TRIGGER payments_set_updated_at
BEFORE UPDATE ON "payments"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER invoices_set_updated_at
BEFORE UPDATE ON "invoices"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
