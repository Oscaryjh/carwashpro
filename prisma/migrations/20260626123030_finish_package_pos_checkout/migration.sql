-- AlterTable
ALTER TABLE "customer_packages" ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "work_order_id" DROP NOT NULL;
