CREATE TYPE "FinancialOperationType" AS ENUM (
  'CASHIER_CHECKOUT',
  'SALON_APPOINTMENT_PAYMENT',
  'WORK_ORDER_PAYMENT',
  'PACKAGE_PURCHASE',
  'PACKAGE_REDEMPTION',
  'PAYMENT_REFUND',
  'INVOICE_VOID',
  'DAILY_CLOSING'
);

CREATE TYPE "FinancialOperationState" AS ENUM ('IN_PROGRESS', 'COMPLETED');

CREATE TABLE "financial_operations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "branch_id" UUID,
  "actor_user_id" UUID NOT NULL,
  "operation_type" "FinancialOperationType" NOT NULL,
  "operation_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "state" "FinancialOperationState" NOT NULL DEFAULT 'IN_PROGRESS',
  "result_json" JSONB,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "financial_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "financial_operations_operation_key_check"
    CHECK (char_length("operation_key") BETWEEN 16 AND 128 AND "operation_key" ~ '^[A-Za-z0-9._:-]+$'),
  CONSTRAINT "financial_operations_fingerprint_check"
    CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "financial_operations_completion_check"
    CHECK (
      ("state" = 'IN_PROGRESS' AND "result_json" IS NULL AND "completed_at" IS NULL)
      OR
      ("state" = 'COMPLETED' AND "result_json" IS NOT NULL AND "completed_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "financial_operations_business_type_key"
  ON "financial_operations"("business_id", "operation_type", "operation_key");
CREATE INDEX "financial_operations_business_created_idx"
  ON "financial_operations"("business_id", "created_at");
CREATE INDEX "financial_operations_branch_created_idx"
  ON "financial_operations"("branch_id", "created_at");
CREATE INDEX "financial_operations_actor_created_idx"
  ON "financial_operations"("actor_user_id", "created_at");

ALTER TABLE "financial_operations"
  ADD CONSTRAINT "financial_operations_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_operations"
  ADD CONSTRAINT "financial_operations_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_operations"
  ADD CONSTRAINT "financial_operations_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "guard_financial_operation_scope_and_immutability"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."branch_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "branches" b
    WHERE b."id" = NEW."branch_id" AND b."business_id" = NEW."business_id"
  ) THEN
    RAISE EXCEPTION 'Financial operation branch scope mismatch';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."state" = 'COMPLETED' THEN
      RAISE EXCEPTION 'Completed financial operation is immutable';
    END IF;
    IF NEW."business_id" IS DISTINCT FROM OLD."business_id"
      OR NEW."branch_id" IS DISTINCT FROM OLD."branch_id"
      OR NEW."actor_user_id" IS DISTINCT FROM OLD."actor_user_id"
      OR NEW."operation_type" IS DISTINCT FROM OLD."operation_type"
      OR NEW."operation_key" IS DISTINCT FROM OLD."operation_key"
      OR NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint" THEN
      RAISE EXCEPTION 'Financial operation request identity is immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "financial_operation_scope_immutability_guard"
  BEFORE INSERT OR UPDATE ON "financial_operations"
  FOR EACH ROW EXECUTE FUNCTION "guard_financial_operation_scope_and_immutability"();

CREATE OR REPLACE FUNCTION "block_completed_financial_operation_delete"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."state" = 'COMPLETED' THEN
    RAISE EXCEPTION 'Completed financial operation cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "financial_operation_delete_guard"
  BEFORE DELETE ON "financial_operations"
  FOR EACH ROW EXECUTE FUNCTION "block_completed_financial_operation_delete"();
