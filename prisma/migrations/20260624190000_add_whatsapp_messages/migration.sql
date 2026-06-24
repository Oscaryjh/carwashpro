CREATE TYPE "WhatsAppMessageType" AS ENUM ('NEW_CUSTOMER_WELCOME', 'SERVICE_CONFIRMATION', 'READY_FOR_PICKUP', 'INVOICE_SENT');
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('DRAFT', 'READY', 'SENT', 'FAILED');

CREATE TABLE "whatsapp_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "customer_id" UUID,
  "vehicle_id" UUID,
  "work_order_id" UUID,
  "invoice_id" UUID,
  "phone" TEXT NOT NULL,
  "message_type" "WhatsAppMessageType" NOT NULL,
  "message_body" TEXT NOT NULL,
  "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'READY',
  "provider" TEXT,
  "provider_message_id" TEXT,
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "whatsapp_messages_business_id_idx" ON "whatsapp_messages"("business_id");
CREATE INDEX "whatsapp_messages_customer_id_idx" ON "whatsapp_messages"("customer_id");
CREATE INDEX "whatsapp_messages_vehicle_id_idx" ON "whatsapp_messages"("vehicle_id");
CREATE INDEX "whatsapp_messages_work_order_id_idx" ON "whatsapp_messages"("work_order_id");
CREATE INDEX "whatsapp_messages_invoice_id_idx" ON "whatsapp_messages"("invoice_id");
CREATE INDEX "whatsapp_messages_status_idx" ON "whatsapp_messages"("status");
CREATE INDEX "whatsapp_messages_message_type_idx" ON "whatsapp_messages"("message_type");

ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_business_id_fkey"
  FOREIGN KEY ("business_id")
  REFERENCES "businesses"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_customer_id_fkey"
  FOREIGN KEY ("customer_id")
  REFERENCES "customers"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_vehicle_id_fkey"
  FOREIGN KEY ("vehicle_id")
  REFERENCES "vehicles"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_work_order_id_fkey"
  FOREIGN KEY ("work_order_id")
  REFERENCES "work_orders"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_invoice_id_fkey"
  FOREIGN KEY ("invoice_id")
  REFERENCES "invoices"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE TRIGGER whatsapp_messages_set_updated_at
BEFORE UPDATE ON "whatsapp_messages"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
