CREATE TYPE "ProductCategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "product_categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "status" "ProductCategoryStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_categories_business_id_name_key"
  ON "product_categories"("business_id", "name");
CREATE INDEX "product_categories_business_id_idx" ON "product_categories"("business_id");
CREATE INDEX "product_categories_status_idx" ON "product_categories"("status");

ALTER TABLE "product_categories"
  ADD CONSTRAINT "product_categories_business_id_fkey"
  FOREIGN KEY ("business_id")
  REFERENCES "businesses"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE TRIGGER product_categories_set_updated_at
BEFORE UPDATE ON "product_categories"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "products" ADD COLUMN "category_id" UUID;

INSERT INTO "product_categories" ("business_id", "name")
SELECT DISTINCT "business_id", BTRIM("category")
FROM "products"
WHERE "category" IS NOT NULL AND BTRIM("category") <> ''
ON CONFLICT ("business_id", "name") DO NOTHING;

UPDATE "products" AS p
SET "category_id" = c."id",
    "category" = c."name"
FROM "product_categories" AS c
WHERE p."business_id" = c."business_id"
  AND BTRIM(COALESCE(p."category", '')) = c."name";

CREATE INDEX "products_category_id_idx" ON "products"("category_id");

ALTER TABLE "products"
  ADD CONSTRAINT "products_category_id_fkey"
  FOREIGN KEY ("category_id")
  REFERENCES "product_categories"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
