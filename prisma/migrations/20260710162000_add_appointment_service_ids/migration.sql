ALTER TABLE "appointments"
ADD COLUMN "service_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
