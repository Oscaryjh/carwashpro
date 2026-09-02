BEGIN;

-- Canonical 3000 Staff App presentation settings. These columns are additive
-- and intentionally do not import the retired 3100 migration lineage.
ALTER TABLE "businesses"
    ADD COLUMN IF NOT EXISTS "staff_app_logo_url" TEXT,
    ADD COLUMN IF NOT EXISTS "staff_app_appearance" JSONB;

COMMIT;
