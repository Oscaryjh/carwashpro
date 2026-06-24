CREATE TYPE "ServiceStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "WorkOrderStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED');

CREATE TABLE "services" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "price" DECIMAL(10, 2) NOT NULL,
  "status" "ServiceStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "vehicle_id" UUID NOT NULL,
  "order_number" TEXT NOT NULL,
  "status" "WorkOrderStatus" NOT NULL DEFAULT 'WAITING',
  "subtotal" DECIMAL(10, 2) NOT NULL,
  "total" DECIMAL(10, 2) NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_order_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "service_id" UUID,
  "name" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_price" DECIMAL(10, 2) NOT NULL,
  "line_total" DECIMAL(10, 2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "work_order_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "services_business_id_name_key" ON "services"("business_id", "name");
CREATE INDEX "services_business_id_idx" ON "services"("business_id");

CREATE UNIQUE INDEX "work_orders_business_id_order_number_key" ON "work_orders"("business_id", "order_number");
CREATE INDEX "work_orders_business_id_idx" ON "work_orders"("business_id");
CREATE INDEX "work_orders_customer_id_idx" ON "work_orders"("customer_id");
CREATE INDEX "work_orders_vehicle_id_idx" ON "work_orders"("vehicle_id");
CREATE INDEX "work_orders_status_idx" ON "work_orders"("status");

CREATE INDEX "work_order_items_business_id_idx" ON "work_order_items"("business_id");
CREATE INDEX "work_order_items_work_order_id_idx" ON "work_order_items"("work_order_id");
CREATE INDEX "work_order_items_service_id_idx" ON "work_order_items"("service_id");

ALTER TABLE "services"
  ADD CONSTRAINT "services_business_id_fkey"
  FOREIGN KEY ("business_id")
  REFERENCES "businesses"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "work_orders"
  ADD CONSTRAINT "work_orders_business_id_fkey"
  FOREIGN KEY ("business_id")
  REFERENCES "businesses"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "work_orders"
  ADD CONSTRAINT "work_orders_customer_id_fkey"
  FOREIGN KEY ("customer_id")
  REFERENCES "customers"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "work_orders"
  ADD CONSTRAINT "work_orders_vehicle_id_fkey"
  FOREIGN KEY ("vehicle_id")
  REFERENCES "vehicles"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "work_order_items"
  ADD CONSTRAINT "work_order_items_business_id_fkey"
  FOREIGN KEY ("business_id")
  REFERENCES "businesses"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "work_order_items"
  ADD CONSTRAINT "work_order_items_work_order_id_fkey"
  FOREIGN KEY ("work_order_id")
  REFERENCES "work_orders"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "work_order_items"
  ADD CONSTRAINT "work_order_items_service_id_fkey"
  FOREIGN KEY ("service_id")
  REFERENCES "services"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE TRIGGER services_set_updated_at
BEFORE UPDATE ON "services"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER work_orders_set_updated_at
BEFORE UPDATE ON "work_orders"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER work_order_items_set_updated_at
BEFORE UPDATE ON "work_order_items"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
