ALTER TABLE "businesses"
ADD COLUMN "invoice_sequence" INTEGER NOT NULL DEFAULT 1000;

UPDATE "businesses" AS "business"
SET "invoice_sequence" = GREATEST(
  1000,
  COALESCE(
    (
      SELECT MAX("invoice"."invoice_number"::INTEGER)
      FROM "invoices" AS "invoice"
      WHERE "invoice"."business_id" = "business"."id"
        AND "invoice"."invoice_number" ~ '^[0-9]{1,9}$'
    ),
    0
  )
);
