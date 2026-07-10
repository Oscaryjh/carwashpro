-- CreateEnum
CREATE TYPE "CashierShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "cashier_id" UUID,
ADD COLUMN     "shift_id" UUID;

-- CreateTable
CREATE TABLE "cashier_shifts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID,
    "cashier_id" UUID NOT NULL,
    "status" "CashierShiftStatus" NOT NULL DEFAULT 'OPEN',
    "opening_float" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "closing_cash" DECIMAL(10,2),
    "expected_cash" DECIMAL(10,2),
    "cash_difference" DECIMAL(10,2),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashier_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cashier_shifts_business_id_idx" ON "cashier_shifts"("business_id");

-- CreateIndex
CREATE INDEX "cashier_shifts_branch_id_idx" ON "cashier_shifts"("branch_id");

-- CreateIndex
CREATE INDEX "cashier_shifts_cashier_id_idx" ON "cashier_shifts"("cashier_id");

-- CreateIndex
CREATE INDEX "cashier_shifts_status_idx" ON "cashier_shifts"("status");

-- CreateIndex
CREATE INDEX "cashier_shifts_started_at_idx" ON "cashier_shifts"("started_at");

-- CreateIndex
CREATE INDEX "payments_cashier_id_idx" ON "payments"("cashier_id");

-- CreateIndex
CREATE INDEX "payments_shift_id_idx" ON "payments"("shift_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "cashier_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
