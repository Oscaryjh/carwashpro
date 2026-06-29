ALTER TABLE "services" ADD COLUMN "category" TEXT;

CREATE INDEX "services_business_id_category_idx" ON "services"("business_id", "category");
