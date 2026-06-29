-- CreateEnum
CREATE TYPE "PaymentRecordStatus" AS ENUM ('ACTIVE', 'VOID');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "status" "PaymentRecordStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "voided_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");
