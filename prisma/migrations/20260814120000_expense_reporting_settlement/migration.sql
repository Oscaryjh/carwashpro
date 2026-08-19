-- Expense recognition remains on BusinessExpense. This migration makes
-- settlement events amount-bearing so partial payments can be derived from
-- immutable applied-payment facts.
ALTER TYPE "ExpensePaymentStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_PAID';

CREATE TYPE "ExpensePaymentSource" AS ENUM (
  'POS_DRAWER',
  'PETTY_CASH',
  'BANK_ACCOUNT',
  'COMPANY_CARD',
  'OWNER_ADVANCE',
  'STAFF_ADVANCE',
  'OTHER'
);

ALTER TABLE "business_expense_payment_events"
  ADD COLUMN "amount" DECIMAL(12,2),
  ADD COLUMN "payment_source" "ExpensePaymentSource";

DROP TRIGGER "business_expense_payment_events_prevent_update" ON "business_expense_payment_events";

UPDATE "business_expense_payment_events" AS event
SET
  "amount" = expense."amount",
  "payment_source" = CASE event."payment_method"
    WHEN 'BANK_TRANSFER' THEN 'BANK_ACCOUNT'::"ExpensePaymentSource"
    WHEN 'CARD' THEN 'COMPANY_CARD'::"ExpensePaymentSource"
    ELSE 'OTHER'::"ExpensePaymentSource"
  END
FROM "business_expenses" AS expense
WHERE expense."id" = event."expense_id";

CREATE TRIGGER "business_expense_payment_events_prevent_update"
  BEFORE UPDATE ON "business_expense_payment_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_expense_append_only_mutation();

ALTER TABLE "business_expense_payment_events"
  ALTER COLUMN "amount" SET NOT NULL,
  ALTER COLUMN "payment_source" SET NOT NULL;

ALTER TABLE "business_expense_payment_events"
  DROP CONSTRAINT "business_expense_payment_events_status_check";

DROP INDEX IF EXISTS "business_expense_payment_events_expense_id_payment_status_key";
DROP INDEX IF EXISTS "business_expense_payment_events_business_id_payment_date_idx";

CREATE INDEX "business_expense_payment_events_business_date_method_idx"
  ON "business_expense_payment_events"("business_id", "payment_date", "payment_method");

CREATE INDEX "business_expense_payment_events_business_expense_created_idx"
  ON "business_expense_payment_events"("business_id", "expense_id", "created_at");
