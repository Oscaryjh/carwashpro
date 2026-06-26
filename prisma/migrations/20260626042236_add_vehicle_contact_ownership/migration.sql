-- CreateEnum
CREATE TYPE "WorkOrderContactType" AS ENUM ('REGISTERED_OWNER', 'OTHER_PERSON', 'NEW_OWNER');

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "contact_name" TEXT,
ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "contact_type" "WorkOrderContactType" NOT NULL DEFAULT 'REGISTERED_OWNER';

-- CreateTable
CREATE TABLE "vehicle_ownership_histories" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID,
    "vehicle_id" UUID NOT NULL,
    "previous_customer_id" UUID,
    "new_customer_id" UUID NOT NULL,
    "transferred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_ownership_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_ownership_histories_business_id_idx" ON "vehicle_ownership_histories"("business_id");

-- CreateIndex
CREATE INDEX "vehicle_ownership_histories_branch_id_idx" ON "vehicle_ownership_histories"("branch_id");

-- CreateIndex
CREATE INDEX "vehicle_ownership_histories_vehicle_id_idx" ON "vehicle_ownership_histories"("vehicle_id");

-- CreateIndex
CREATE INDEX "vehicle_ownership_histories_previous_customer_id_idx" ON "vehicle_ownership_histories"("previous_customer_id");

-- CreateIndex
CREATE INDEX "vehicle_ownership_histories_new_customer_id_idx" ON "vehicle_ownership_histories"("new_customer_id");

-- CreateIndex
CREATE INDEX "vehicle_ownership_histories_transferred_at_idx" ON "vehicle_ownership_histories"("transferred_at");

-- AddForeignKey
ALTER TABLE "vehicle_ownership_histories" ADD CONSTRAINT "vehicle_ownership_histories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_ownership_histories" ADD CONSTRAINT "vehicle_ownership_histories_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_ownership_histories" ADD CONSTRAINT "vehicle_ownership_histories_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_ownership_histories" ADD CONSTRAINT "vehicle_ownership_histories_previous_customer_id_fkey" FOREIGN KEY ("previous_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_ownership_histories" ADD CONSTRAINT "vehicle_ownership_histories_new_customer_id_fkey" FOREIGN KEY ("new_customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
