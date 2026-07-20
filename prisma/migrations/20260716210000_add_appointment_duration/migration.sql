ALTER TABLE "appointments"
ADD COLUMN "duration_minutes" INTEGER NOT NULL DEFAULT 15;

UPDATE "appointments" AS appointment
SET "duration_minutes" = CASE
  WHEN cardinality(appointment."service_ids") > 0 THEN COALESCE((
    SELECT SUM(COALESCE(service."duration_minutes", 15))::INTEGER
    FROM "services" AS service
    WHERE service."id"::TEXT = ANY(appointment."service_ids")
  ), 15)
  WHEN appointment."service_id" IS NOT NULL THEN COALESCE((
    SELECT COALESCE(service."duration_minutes", 15)
    FROM "services" AS service
    WHERE service."id" = appointment."service_id"
    LIMIT 1
  ), 15)
  ELSE 15
END;

CREATE INDEX "appointments_business_id_assigned_staff_id_scheduled_at_idx"
ON "appointments"("business_id", "assigned_staff_id", "scheduled_at");
