-- Align category tables with the Prisma schema so migrate dev stays non-interactive.
ALTER TABLE "package_categories" ALTER COLUMN "id" DROP DEFAULT;

ALTER TABLE "service_categories" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "service_categories" ALTER COLUMN "updated_at" DROP DEFAULT;
