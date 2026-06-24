CREATE TABLE "customers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vehicles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "plate_number" TEXT NOT NULL,
  "brand" TEXT,
  "model" TEXT,
  "color" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customers_business_id_phone_key" ON "customers"("business_id", "phone");
CREATE INDEX "customers_business_id_idx" ON "customers"("business_id");

CREATE UNIQUE INDEX "vehicles_business_id_plate_number_key" ON "vehicles"("business_id", "plate_number");
CREATE INDEX "vehicles_business_id_idx" ON "vehicles"("business_id");
CREATE INDEX "vehicles_customer_id_idx" ON "vehicles"("customer_id");

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_business_id_fkey"
  FOREIGN KEY ("business_id")
  REFERENCES "businesses"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_business_id_fkey"
  FOREIGN KEY ("business_id")
  REFERENCES "businesses"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_customer_id_fkey"
  FOREIGN KEY ("customer_id")
  REFERENCES "customers"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE TRIGGER customers_set_updated_at
BEFORE UPDATE ON "customers"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER vehicles_set_updated_at
BEFORE UPDATE ON "vehicles"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
