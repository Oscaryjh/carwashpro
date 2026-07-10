ALTER TABLE "appointments"
ADD COLUMN "contact_type" "WorkOrderContactType" NOT NULL DEFAULT 'REGISTERED_OWNER',
ADD COLUMN "contact_name" TEXT,
ADD COLUMN "contact_phone" TEXT;
