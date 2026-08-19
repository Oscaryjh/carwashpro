CREATE TABLE "business_payment_methods" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "normalized_label" TEXT NOT NULL,
  "canonical_method" "PaymentMethod" NOT NULL,
  "built_in" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 100,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "business_payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_payment_methods_business_code_key"
  ON "business_payment_methods"("business_id", "code");

CREATE UNIQUE INDEX "business_payment_methods_business_label_key"
  ON "business_payment_methods"("business_id", "normalized_label");

CREATE UNIQUE INDEX "business_payment_methods_business_id_key"
  ON "business_payment_methods"("business_id", "id");

CREATE INDEX "business_payment_methods_business_active_sort_idx"
  ON "business_payment_methods"("business_id", "active", "sort_order");

ALTER TABLE "business_payment_methods"
  ADD CONSTRAINT "business_payment_methods_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD COLUMN "business_payment_method_id" UUID,
  ADD COLUMN "payment_method_label" TEXT;

CREATE INDEX "payments_business_id_business_payment_method_id_idx"
  ON "payments"("business_id", "business_payment_method_id");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_business_id_business_payment_method_id_fkey"
  FOREIGN KEY ("business_id", "business_payment_method_id")
  REFERENCES "business_payment_methods"("business_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
