CREATE TYPE "VehicleSize" AS ENUM ('UNCLASSIFIED', 'SMALL', 'MEDIUM', 'LARGE');
CREATE TYPE "VehicleSizeSource" AS ENUM ('UNCLASSIFIED', 'PLATFORM_DEFAULT', 'BUSINESS_OVERRIDE', 'MANUAL');
CREATE TYPE "PackageVehicleSize" AS ENUM ('ALL', 'SMALL', 'MEDIUM', 'LARGE');

ALTER TABLE "vehicles" ADD COLUMN "size" "VehicleSize" NOT NULL DEFAULT 'UNCLASSIFIED';
ALTER TABLE "vehicles" ADD COLUMN "size_source" "VehicleSizeSource" NOT NULL DEFAULT 'UNCLASSIFIED';
ALTER TABLE "packages" ADD COLUMN "eligible_vehicle_size" "PackageVehicleSize" NOT NULL DEFAULT 'ALL';
ALTER TABLE "customer_packages" ADD COLUMN "eligible_vehicle_size" "PackageVehicleSize" NOT NULL DEFAULT 'ALL';

CREATE TABLE "vehicle_model_size_defaults" (
  "id" UUID NOT NULL,
  "brand" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "normalized_brand" TEXT NOT NULL,
  "normalized_model" TEXT NOT NULL,
  "size" "VehicleSize" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vehicle_model_size_defaults_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vehicle_model_size_defaults_brand_model_key" ON "vehicle_model_size_defaults"("normalized_brand", "normalized_model");
CREATE INDEX "vehicle_model_size_defaults_active_idx" ON "vehicle_model_size_defaults"("active");

CREATE TABLE "business_vehicle_size_overrides" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "brand" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "normalized_brand" TEXT NOT NULL,
  "normalized_model" TEXT NOT NULL,
  "size" "VehicleSize" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_vehicle_size_overrides_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "business_vehicle_size_overrides_lookup_key" ON "business_vehicle_size_overrides"("business_id", "normalized_brand", "normalized_model");
CREATE INDEX "business_vehicle_size_overrides_business_size_idx" ON "business_vehicle_size_overrides"("business_id", "size");
ALTER TABLE "business_vehicle_size_overrides" ADD CONSTRAINT "business_vehicle_size_overrides_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
