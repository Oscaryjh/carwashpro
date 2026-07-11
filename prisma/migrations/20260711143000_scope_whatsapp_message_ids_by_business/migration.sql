DROP INDEX IF EXISTS "whatsapp_chat_messages_instance_id_external_message_id_key";

CREATE UNIQUE INDEX "whatsapp_chat_messages_business_id_instance_id_external_message_id_key"
ON "whatsapp_chat_messages"("business_id", "instance_id", "external_message_id");
