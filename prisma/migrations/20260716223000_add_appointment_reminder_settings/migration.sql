CREATE TABLE "appointment_reminder_settings" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lead_time_minutes" INTEGER NOT NULL DEFAULT 1440,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_reminder_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "appointment_reminder_settings_business_id_key"
ON "appointment_reminder_settings"("business_id");

ALTER TABLE "appointment_reminder_settings"
ADD CONSTRAINT "appointment_reminder_settings_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
