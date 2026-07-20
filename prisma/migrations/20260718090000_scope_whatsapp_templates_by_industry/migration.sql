-- Existing platform templates are the Auto Detailing defaults.
ALTER TABLE "whatsapp_templates"
ADD COLUMN "industry_type" "BusinessIndustry" NOT NULL DEFAULT 'AUTO_DETAILING';

DROP INDEX "whatsapp_templates_message_type_key";

CREATE UNIQUE INDEX "whatsapp_templates_message_type_industry_type_key"
ON "whatsapp_templates"("message_type", "industry_type");

CREATE INDEX "whatsapp_templates_industry_type_idx"
ON "whatsapp_templates"("industry_type");
