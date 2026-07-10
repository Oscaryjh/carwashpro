CREATE TYPE "AppointmentStatus" AS ENUM (
  'SCHEDULED',
  'CONFIRMED',
  'ARRIVED',
  'CONVERTED_TO_JOB',
  'CANCELLED',
  'NO_SHOW'
);

CREATE TABLE "appointments" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID,
  "customer_id" UUID NOT NULL,
  "vehicle_id" UUID NOT NULL,
  "service_id" UUID,
  "work_order_id" UUID,
  "created_by_id" UUID,
  "scheduled_at" TIMESTAMP(3) NOT NULL,
  "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
  "notes" TEXT,
  "confirmed_at" TIMESTAMP(3),
  "arrived_at" TIMESTAMP(3),
  "converted_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "no_show_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "appointments_work_order_id_key" ON "appointments"("work_order_id");
CREATE INDEX "appointments_business_id_idx" ON "appointments"("business_id");
CREATE INDEX "appointments_branch_id_idx" ON "appointments"("branch_id");
CREATE INDEX "appointments_customer_id_idx" ON "appointments"("customer_id");
CREATE INDEX "appointments_vehicle_id_idx" ON "appointments"("vehicle_id");
CREATE INDEX "appointments_service_id_idx" ON "appointments"("service_id");
CREATE INDEX "appointments_created_by_id_idx" ON "appointments"("created_by_id");
CREATE INDEX "appointments_scheduled_at_idx" ON "appointments"("scheduled_at");
CREATE INDEX "appointments_status_idx" ON "appointments"("status");

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_vehicle_id_fkey"
  FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
