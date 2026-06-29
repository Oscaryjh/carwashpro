CREATE TYPE "PackageCategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "package_categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "status" "PackageCategoryStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "package_categories_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "package_categories"
  ADD CONSTRAINT "package_categories_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "package_categories_business_id_name_key" ON "package_categories"("business_id", "name");
CREATE INDEX "package_categories_business_id_idx" ON "package_categories"("business_id");
CREATE INDEX "package_categories_status_idx" ON "package_categories"("status");

ALTER TABLE "packages" ADD COLUMN "category_id" UUID;

ALTER TABLE "packages"
  ADD CONSTRAINT "packages_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "package_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "packages_category_id_idx" ON "packages"("category_id");
