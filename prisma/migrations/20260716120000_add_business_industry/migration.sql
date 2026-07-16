CREATE TYPE "BusinessIndustry" AS ENUM ('AUTO_DETAILING', 'SALON_BEAUTY');

ALTER TABLE "businesses"
ADD COLUMN "industry_type" "BusinessIndustry" NOT NULL DEFAULT 'AUTO_DETAILING';

CREATE INDEX "businesses_industry_type_idx" ON "businesses"("industry_type");
