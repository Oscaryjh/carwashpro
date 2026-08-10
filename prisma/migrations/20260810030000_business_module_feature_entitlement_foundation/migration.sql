CREATE TYPE "BusinessModuleKey" AS ENUM (
  'CORE', 'POS', 'SALON', 'AUTO', 'WHATSAPP', 'BUSINESS_GROUP',
  'HR', 'PAYROLL', 'STATUTORY', 'CLAIMS', 'AI', 'LOYALTY'
);

CREATE TYPE "BusinessModuleEntitlementStatus" AS ENUM ('ENABLED', 'DISABLED');
CREATE TYPE "BusinessModuleEntitlementSource" AS ENUM ('SYSTEM', 'MANUAL', 'MIGRATION', 'PLAN', 'TRIAL');

CREATE TABLE "business_module_entitlements" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "module_key" "BusinessModuleKey" NOT NULL,
  "status" "BusinessModuleEntitlementStatus" NOT NULL,
  "enabled_from" TIMESTAMP(3) NOT NULL,
  "enabled_until" TIMESTAMP(3),
  "source" "BusinessModuleEntitlementSource" NOT NULL,
  "plan_code" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" UUID,
  "updated_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_module_entitlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_module_entitlements_no_core" CHECK ("module_key" <> 'CORE'),
  CONSTRAINT "business_module_entitlements_valid_window" CHECK ("enabled_until" IS NULL OR "enabled_until" > "enabled_from"),
  CONSTRAINT "business_module_entitlements_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "business_module_entitlements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "business_module_entitlements_business_id_module_key_key"
  ON "business_module_entitlements"("business_id", "module_key");
CREATE UNIQUE INDEX "business_module_entitlements_id_business_id_key"
  ON "business_module_entitlements"("id", "business_id");
CREATE INDEX "business_module_entitlements_business_status_window_idx"
  ON "business_module_entitlements"("business_id", "status", "enabled_from", "enabled_until");

CREATE TABLE "business_module_entitlement_events" (
  "id" UUID NOT NULL,
  "entitlement_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "module_key" "BusinessModuleKey" NOT NULL,
  "revision" INTEGER NOT NULL,
  "old_status" "BusinessModuleEntitlementStatus",
  "new_status" "BusinessModuleEntitlementStatus" NOT NULL,
  "old_enabled_from" TIMESTAMP(3),
  "new_enabled_from" TIMESTAMP(3) NOT NULL,
  "old_enabled_until" TIMESTAMP(3),
  "new_enabled_until" TIMESTAMP(3),
  "source" "BusinessModuleEntitlementSource" NOT NULL,
  "plan_code" TEXT,
  "reason" TEXT NOT NULL,
  "actor_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_module_entitlement_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_module_entitlement_events_reason_required" CHECK (length(btrim("reason")) >= 3),
  CONSTRAINT "business_module_entitlement_events_valid_window" CHECK ("new_enabled_until" IS NULL OR "new_enabled_until" > "new_enabled_from"),
  CONSTRAINT "business_module_entitlement_events_entitlement_business_fkey"
    FOREIGN KEY ("entitlement_id", "business_id") REFERENCES "business_module_entitlements"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "business_module_entitlement_events_entitlement_revision_key"
  ON "business_module_entitlement_events"("entitlement_id", "revision");
CREATE INDEX "business_module_entitlement_events_business_module_created_idx"
  ON "business_module_entitlement_events"("business_id", "module_key", "created_at");

WITH compatibility_modules AS (
  SELECT b."id" AS business_id, module_key::"BusinessModuleKey"
  FROM "businesses" b
  CROSS JOIN (VALUES ('POS'), ('WHATSAPP'), ('HR'), ('PAYROLL'), ('STATUTORY')) AS common(module_key)
  UNION
  SELECT b."id", 'SALON'::"BusinessModuleKey"
  FROM "businesses" b WHERE b."industry_type" = 'SALON_BEAUTY'
  UNION
  SELECT b."id", 'AUTO'::"BusinessModuleKey"
  FROM "businesses" b WHERE b."industry_type" = 'AUTO_DETAILING'
  UNION
  SELECT DISTINCT bgm."business_id", 'BUSINESS_GROUP'::"BusinessModuleKey"
  FROM "business_group_members" bgm WHERE bgm."status" = 'ACTIVE'
  UNION
  SELECT lp."business_id", 'LOYALTY'::"BusinessModuleKey"
  FROM "loyalty_programs" lp
)
INSERT INTO "business_module_entitlements" (
  "id", "business_id", "module_key", "status", "enabled_from", "source", "revision", "created_at", "updated_at"
)
SELECT gen_random_uuid(), business_id, module_key, 'ENABLED', CURRENT_TIMESTAMP, 'MIGRATION', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM compatibility_modules
ON CONFLICT ("business_id", "module_key") DO NOTHING;

INSERT INTO "business_module_entitlement_events" (
  "id", "entitlement_id", "business_id", "module_key", "revision", "old_status", "new_status",
  "old_enabled_from", "new_enabled_from", "old_enabled_until", "new_enabled_until", "source", "reason", "created_at"
)
SELECT gen_random_uuid(), e."id", e."business_id", e."module_key", 1, NULL, 'ENABLED',
       NULL, e."enabled_from", NULL, e."enabled_until", 'MIGRATION',
       'Compatibility backfill preserving existing Local/Testing business access.', CURRENT_TIMESTAMP
FROM "business_module_entitlements" e
WHERE e."source" = 'MIGRATION'
ON CONFLICT ("entitlement_id", "revision") DO NOTHING;

CREATE OR REPLACE FUNCTION protect_business_module_entitlement_identity()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BUSINESS_MODULE_ENTITLEMENT_DELETE_FORBIDDEN';
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."business_id" <> OLD."business_id" OR NEW."module_key" <> OLD."module_key" OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'BUSINESS_MODULE_ENTITLEMENT_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'BUSINESS_MODULE_ENTITLEMENT_REVISION_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "business_module_entitlement_identity_guard"
BEFORE UPDATE OR DELETE ON "business_module_entitlements"
FOR EACH ROW EXECUTE FUNCTION protect_business_module_entitlement_identity();

CREATE OR REPLACE FUNCTION protect_business_module_entitlement_event()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'BUSINESS_MODULE_ENTITLEMENT_EVENT_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "business_module_entitlement_event_guard"
BEFORE UPDATE OR DELETE ON "business_module_entitlement_events"
FOR EACH ROW EXECUTE FUNCTION protect_business_module_entitlement_event();
