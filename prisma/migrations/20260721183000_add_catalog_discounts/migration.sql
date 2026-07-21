CREATE TYPE "CatalogDiscountScope" AS ENUM ('ALL', 'SERVICES', 'PRODUCTS', 'PACKAGES');

CREATE TABLE "catalog_discounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "branch_id" UUID,
    "name" TEXT NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "scope" "CatalogDiscountScope" NOT NULL DEFAULT 'ALL',
    "minimum_spend" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "maximum_discount" DECIMAL(10,2),
    "allow_loyalty_stacking" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_discounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "catalog_discounts_business_id_name_key"
ON "catalog_discounts"("business_id", "name");

CREATE INDEX "catalog_discounts_business_id_active_idx"
ON "catalog_discounts"("business_id", "active");

CREATE INDEX "catalog_discounts_branch_id_idx"
ON "catalog_discounts"("branch_id");

CREATE INDEX "catalog_discounts_starts_at_ends_at_idx"
ON "catalog_discounts"("starts_at", "ends_at");

ALTER TABLE "catalog_discounts"
ADD CONSTRAINT "catalog_discounts_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "catalog_discounts"
ADD CONSTRAINT "catalog_discounts_branch_id_fkey"
FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
