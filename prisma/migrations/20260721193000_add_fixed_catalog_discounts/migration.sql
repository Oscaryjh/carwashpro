CREATE TYPE "CatalogDiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

ALTER TABLE "catalog_discounts"
ADD COLUMN "discount_type" "CatalogDiscountType" NOT NULL DEFAULT 'PERCENTAGE',
ADD COLUMN "fixed_amount" DECIMAL(10,2),
ALTER COLUMN "percentage" DROP NOT NULL;

ALTER TABLE "catalog_discounts"
ADD CONSTRAINT "catalog_discounts_value_check" CHECK (
  ("discount_type" = 'PERCENTAGE' AND "percentage" IS NOT NULL AND "percentage" > 0 AND "percentage" <= 100 AND "fixed_amount" IS NULL)
  OR
  ("discount_type" = 'FIXED_AMOUNT' AND "fixed_amount" IS NOT NULL AND "fixed_amount" > 0 AND "percentage" IS NULL)
);
