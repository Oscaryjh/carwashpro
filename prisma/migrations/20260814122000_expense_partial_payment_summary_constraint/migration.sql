ALTER TABLE "business_expenses"
  DROP CONSTRAINT IF EXISTS "business_expenses_payment_check";

ALTER TABLE "business_expenses"
  ADD CONSTRAINT "business_expenses_payment_check" CHECK (
    (
      "payment_status" = 'UNPAID'
      AND "payment_method" IS NULL
      AND "payment_date" IS NULL
      AND "paid_by_id" IS NULL
      AND "paid_at" IS NULL
    )
    OR
    (
      "payment_status" = 'PARTIALLY_PAID'
      AND "payment_method" IS NOT NULL
      AND "payment_date" IS NOT NULL
      AND "paid_by_id" IS NULL
      AND "paid_at" IS NULL
    )
    OR
    (
      "payment_status" = 'PAID'
      AND "payment_method" IS NOT NULL
      AND "payment_date" IS NOT NULL
      AND "paid_by_id" IS NOT NULL
      AND "paid_at" IS NOT NULL
    )
  );
