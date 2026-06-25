CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "branches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "address" TEXT,
  "status" "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "customers" ADD COLUMN "branch_id" UUID;
ALTER TABLE "vehicles" ADD COLUMN "branch_id" UUID;
ALTER TABLE "services" ADD COLUMN "branch_id" UUID;
ALTER TABLE "packages" ADD COLUMN "branch_id" UUID;
ALTER TABLE "customer_packages" ADD COLUMN "branch_id" UUID;
ALTER TABLE "work_orders" ADD COLUMN "branch_id" UUID;
ALTER TABLE "payments" ADD COLUMN "branch_id" UUID;
ALTER TABLE "invoices" ADD COLUMN "branch_id" UUID;
ALTER TABLE "whatsapp_messages" ADD COLUMN "branch_id" UUID;

CREATE UNIQUE INDEX "branches_business_id_name_key" ON "branches"("business_id", "name");
CREATE INDEX "branches_business_id_idx" ON "branches"("business_id");
CREATE INDEX "branches_status_idx" ON "branches"("status");

CREATE INDEX "customers_branch_id_idx" ON "customers"("branch_id");
CREATE INDEX "vehicles_branch_id_idx" ON "vehicles"("branch_id");
CREATE INDEX "services_branch_id_idx" ON "services"("branch_id");
CREATE INDEX "packages_branch_id_idx" ON "packages"("branch_id");
CREATE INDEX "customer_packages_branch_id_idx" ON "customer_packages"("branch_id");
CREATE INDEX "work_orders_branch_id_idx" ON "work_orders"("branch_id");
CREATE INDEX "payments_branch_id_idx" ON "payments"("branch_id");
CREATE INDEX "invoices_branch_id_idx" ON "invoices"("branch_id");
CREATE INDEX "whatsapp_messages_branch_id_idx" ON "whatsapp_messages"("branch_id");

ALTER TABLE "branches"
  ADD CONSTRAINT "branches_business_id_fkey"
  FOREIGN KEY ("business_id")
  REFERENCES "businesses"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_branch_id_fkey"
  FOREIGN KEY ("branch_id")
  REFERENCES "branches"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_branch_id_fkey"
  FOREIGN KEY ("branch_id")
  REFERENCES "branches"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "services"
  ADD CONSTRAINT "services_branch_id_fkey"
  FOREIGN KEY ("branch_id")
  REFERENCES "branches"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "packages"
  ADD CONSTRAINT "packages_branch_id_fkey"
  FOREIGN KEY ("branch_id")
  REFERENCES "branches"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "customer_packages"
  ADD CONSTRAINT "customer_packages_branch_id_fkey"
  FOREIGN KEY ("branch_id")
  REFERENCES "branches"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "work_orders"
  ADD CONSTRAINT "work_orders_branch_id_fkey"
  FOREIGN KEY ("branch_id")
  REFERENCES "branches"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_branch_id_fkey"
  FOREIGN KEY ("branch_id")
  REFERENCES "branches"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_branch_id_fkey"
  FOREIGN KEY ("branch_id")
  REFERENCES "branches"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_branch_id_fkey"
  FOREIGN KEY ("branch_id")
  REFERENCES "branches"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE TRIGGER branches_set_updated_at
BEFORE UPDATE ON "branches"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
