CREATE TYPE "ServiceCategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "service_categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "status" "ServiceCategoryStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_categories_business_id_name_key"
  ON "service_categories"("business_id", "name");
CREATE INDEX "service_categories_business_id_idx" ON "service_categories"("business_id");
CREATE INDEX "service_categories_status_idx" ON "service_categories"("status");

ALTER TABLE "service_categories"
  ADD CONSTRAINT "service_categories_business_id_fkey"
  FOREIGN KEY ("business_id")
  REFERENCES "businesses"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE TRIGGER service_categories_set_updated_at
BEFORE UPDATE ON "service_categories"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "services" ADD COLUMN "category_id" UUID;

INSERT INTO "service_categories" ("business_id", "name")
SELECT DISTINCT "business_id", BTRIM("category")
FROM "services"
WHERE "category" IS NOT NULL AND BTRIM("category") <> ''
ON CONFLICT ("business_id", "name") DO NOTHING;

UPDATE "services" AS s
SET "category_id" = c."id",
    "category" = c."name"
FROM "service_categories" AS c
WHERE s."business_id" = c."business_id"
  AND BTRIM(COALESCE(s."category", '')) = c."name";

CREATE INDEX "services_category_id_idx" ON "services"("category_id");

ALTER TABLE "services"
  ADD CONSTRAINT "services_category_id_fkey"
  FOREIGN KEY ("category_id")
  REFERENCES "service_categories"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
