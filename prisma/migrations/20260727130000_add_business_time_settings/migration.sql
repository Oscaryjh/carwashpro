-- Expand: add nullable columns so existing businesses can be backfilled safely.
ALTER TABLE "businesses"
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "business_day_cutoff_time" TEXT;

-- Backfill the canonical timezone for every existing business.
UPDATE "businesses"
SET "timezone" = 'Asia/Kuching';

-- Preserve an existing closing cutoff when present. Businesses without a
-- closing automation row receive the product default.
UPDATE "businesses" AS business
SET "business_day_cutoff_time" = COALESCE(
  (
    SELECT setting."business_day_cutoff_time"
    FROM "closing_whatsapp_settings" AS setting
    WHERE setting."business_id" = business."id"
  ),
  '02:00'
);

-- Validate the backfill before enforcing required canonical values.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "businesses" AS business
    WHERE business."timezone" IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM pg_timezone_names AS zone
        WHERE zone.name = business."timezone"
      )
  ) THEN
    RAISE EXCEPTION 'Business timezone backfill contains an invalid IANA timezone';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "businesses"
    WHERE "business_day_cutoff_time" IS NULL
      OR "business_day_cutoff_time" !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
  ) THEN
    RAISE EXCEPTION 'Business day cutoff backfill contains an invalid HH:mm value';
  END IF;
END
$$;

-- Enforce the canonical fields after every existing row has been validated.
ALTER TABLE "businesses"
  ALTER COLUMN "timezone" SET DEFAULT 'Asia/Kuching',
  ALTER COLUMN "timezone" SET NOT NULL,
  ALTER COLUMN "business_day_cutoff_time" SET DEFAULT '02:00',
  ALTER COLUMN "business_day_cutoff_time" SET NOT NULL;

ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_timezone_nonempty_check"
    CHECK (length(trim("timezone")) > 0),
  ADD CONSTRAINT "businesses_business_day_cutoff_time_format_check"
    CHECK (
      "business_day_cutoff_time" ~
      '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    );
