-- Reconcile local migration history with the current Prisma datamodel.
-- These columns use Prisma-side UUID and updatedAt values, so the database
-- should not keep server-side defaults. Dropping a missing default is safe.

ALTER TABLE "products" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "product_stocks" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "product_categories" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "product_categories" ALTER COLUMN "updated_at" DROP DEFAULT;
