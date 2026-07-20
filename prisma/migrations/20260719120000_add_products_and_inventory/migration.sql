CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "products" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT,
  "description" TEXT,
  "category" TEXT,
  "price" DECIMAL(10,2) NOT NULL,
  "cost_price" DECIMAL(10,2),
  "taxable" BOOLEAN NOT NULL DEFAULT false,
  "tax_rate" DECIMAL(5,2),
  "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_stocks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "reorder_level" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_stocks_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "invoice_items" ADD COLUMN "product_id" UUID;

CREATE UNIQUE INDEX "products_business_id_name_key" ON "products"("business_id", "name");
CREATE INDEX "products_business_id_status_idx" ON "products"("business_id", "status");
CREATE INDEX "products_business_id_category_idx" ON "products"("business_id", "category");
CREATE UNIQUE INDEX "product_stocks_branch_id_product_id_key" ON "product_stocks"("branch_id", "product_id");
CREATE INDEX "product_stocks_business_id_branch_id_idx" ON "product_stocks"("business_id", "branch_id");
CREATE INDEX "product_stocks_product_id_idx" ON "product_stocks"("product_id");
CREATE INDEX "invoice_items_product_id_idx" ON "invoice_items"("product_id");

ALTER TABLE "products"
  ADD CONSTRAINT "products_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_stocks"
  ADD CONSTRAINT "product_stocks_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_stocks"
  ADD CONSTRAINT "product_stocks_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_stocks"
  ADD CONSTRAINT "product_stocks_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_items"
  ADD CONSTRAINT "invoice_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
