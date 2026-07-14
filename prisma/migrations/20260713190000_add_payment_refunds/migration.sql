ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';

CREATE TABLE "payment_refunds" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID,
    "payment_id" UUID NOT NULL,
    "work_order_id" UUID,
    "invoice_id" UUID,
    "processed_by_id" UUID,
    "shift_id" UUID,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "package_uses_restored" INTEGER NOT NULL DEFAULT 0,
    "refunded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_refunds_business_id_refunded_at_idx"
ON "payment_refunds"("business_id", "refunded_at");

CREATE INDEX "payment_refunds_branch_id_idx"
ON "payment_refunds"("branch_id");

CREATE INDEX "payment_refunds_payment_id_idx"
ON "payment_refunds"("payment_id");

CREATE INDEX "payment_refunds_work_order_id_idx"
ON "payment_refunds"("work_order_id");

CREATE INDEX "payment_refunds_invoice_id_idx"
ON "payment_refunds"("invoice_id");

CREATE INDEX "payment_refunds_processed_by_id_idx"
ON "payment_refunds"("processed_by_id");

CREATE INDEX "payment_refunds_shift_id_idx"
ON "payment_refunds"("shift_id");

ALTER TABLE "payment_refunds"
ADD CONSTRAINT "payment_refunds_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_refunds"
ADD CONSTRAINT "payment_refunds_branch_id_fkey"
FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_refunds"
ADD CONSTRAINT "payment_refunds_payment_id_fkey"
FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_refunds"
ADD CONSTRAINT "payment_refunds_work_order_id_fkey"
FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_refunds"
ADD CONSTRAINT "payment_refunds_invoice_id_fkey"
FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_refunds"
ADD CONSTRAINT "payment_refunds_processed_by_id_fkey"
FOREIGN KEY ("processed_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_refunds"
ADD CONSTRAINT "payment_refunds_shift_id_fkey"
FOREIGN KEY ("shift_id") REFERENCES "cashier_shifts"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
