ALTER TABLE "businesses"
ADD COLUMN "product_sequence" INTEGER NOT NULL DEFAULT 0;

UPDATE "businesses" AS "business"
SET "product_sequence" = COALESCE(
  (
    SELECT MAX(SUBSTRING("product"."sku" FROM '[0-9]+$')::INTEGER)
    FROM "products" AS "product"
    WHERE "product"."business_id" = "business"."id"
      AND "product"."sku" ~* '^SKU-[0-9]+$'
  ),
  0
);
