CREATE TYPE "PackageStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "CustomerPackageStatus" AS ENUM ('ACTIVE', 'USED_UP', 'CANCELLED');

ALTER TYPE "PaymentMethod" ADD VALUE 'PACKAGE';

CREATE TABLE "packages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "service_id" UUID,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "price" DECIMAL(10, 2) NOT NULL,
  "total_uses" INTEGER NOT NULL DEFAULT 10,
  "status" "PackageStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_packages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "package_id" UUID NOT NULL,
  "purchase_price" DECIMAL(10, 2) NOT NULL,
  "total_uses" INTEGER NOT NULL,
  "remaining_uses" INTEGER NOT NULL,
  "status" "CustomerPackageStatus" NOT NULL DEFAULT 'ACTIVE',
  "purchased_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "customer_packages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payments"
  ADD COLUMN "customer_package_id" UUID,
  ADD COLUMN "package_uses" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "packages_business_id_name_key" ON "packages"("business_id", "name");
CREATE INDEX "packages_business_id_idx" ON "packages"("business_id");
CREATE INDEX "packages_service_id_idx" ON "packages"("service_id");
CREATE INDEX "packages_status_idx" ON "packages"("status");

CREATE INDEX "customer_packages_business_id_idx" ON "customer_packages"("business_id");
CREATE INDEX "customer_packages_customer_id_idx" ON "customer_packages"("customer_id");
CREATE INDEX "customer_packages_package_id_idx" ON "customer_packages"("package_id");
CREATE INDEX "customer_packages_status_idx" ON "customer_packages"("status");

CREATE INDEX "payments_customer_package_id_idx" ON "payments"("customer_package_id");

ALTER TABLE "packages"
  ADD CONSTRAINT "packages_business_id_fkey"
  FOREIGN KEY ("business_id")
  REFERENCES "businesses"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "packages"
  ADD CONSTRAINT "packages_service_id_fkey"
  FOREIGN KEY ("service_id")
  REFERENCES "services"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "customer_packages"
  ADD CONSTRAINT "customer_packages_business_id_fkey"
  FOREIGN KEY ("business_id")
  REFERENCES "businesses"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "customer_packages"
  ADD CONSTRAINT "customer_packages_customer_id_fkey"
  FOREIGN KEY ("customer_id")
  REFERENCES "customers"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "customer_packages"
  ADD CONSTRAINT "customer_packages_package_id_fkey"
  FOREIGN KEY ("package_id")
  REFERENCES "packages"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_customer_package_id_fkey"
  FOREIGN KEY ("customer_package_id")
  REFERENCES "customer_packages"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE TRIGGER packages_set_updated_at
BEFORE UPDATE ON "packages"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER customer_packages_set_updated_at
BEFORE UPDATE ON "customer_packages"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
