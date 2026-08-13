-- Expense Phase 1: independent business-spending records. No Accounting, AP, Claim, Payroll or Inventory adapter effects.
ALTER TYPE "BusinessModuleKey" ADD VALUE IF NOT EXISTS 'EXPENSE';

CREATE TYPE "ExpenseCategoryGroup" AS ENUM ('OPERATIONS', 'MARKETING', 'STAFF', 'RENTAL', 'FINANCE', 'OTHER');
CREATE TYPE "ExpenseSourceType" AS ENUM ('MANUAL', 'CLAIM', 'PAYROLL', 'INVENTORY_PURCHASE', 'SYSTEM');
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'VOID');
CREATE TYPE "ExpensePaymentStatus" AS ENUM ('UNPAID', 'PAID');
CREATE TYPE "ExpensePaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'EWALLET', 'OTHER');
CREATE TYPE "ExpenseCommandType" AS ENUM ('CREATE_CATEGORY', 'UPDATE_CATEGORY', 'CREATE_EXPENSE', 'UPDATE_DRAFT', 'CONFIRM_EXPENSE', 'CORRECT_EXPENSE', 'MARK_PAID', 'VOID_EXPENSE', 'CREATE_RECURRING_TEMPLATE', 'UPDATE_RECURRING_TEMPLATE', 'GENERATE_RECURRING_EXPENSE');
CREATE TYPE "RecurringExpenseFrequency" AS ENUM ('MONTHLY');

ALTER TABLE "businesses" ADD COLUMN "expense_sequence" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "expense_categories" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "code" VARCHAR(40),
  "group" "ExpenseCategoryGroup" NOT NULL DEFAULT 'OTHER',
  "description" VARCHAR(500),
  "requires_receipt" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "expense_categories_sort_order_check" CHECK ("sort_order" >= 0)
);

CREATE TABLE "recurring_expense_templates" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID,
  "category_id" UUID NOT NULL,
  "payee_name" VARCHAR(160),
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'MYR',
  "frequency" "RecurringExpenseFrequency" NOT NULL DEFAULT 'MONTHLY',
  "start_date" DATE NOT NULL,
  "end_date" DATE,
  "default_description" VARCHAR(500) NOT NULL,
  "notes" VARCHAR(2000),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recurring_expense_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recurring_expense_templates_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "recurring_expense_templates_currency_check" CHECK ("currency" = 'MYR'),
  CONSTRAINT "recurring_expense_templates_date_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date")
);

CREATE TABLE "business_expenses" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID,
  "expense_number" VARCHAR(32) NOT NULL,
  "source_type" "ExpenseSourceType" NOT NULL DEFAULT 'MANUAL',
  "source_id" VARCHAR(180),
  "source_revision" VARCHAR(100),
  "recurring_template_id" UUID,
  "generated_period" CHAR(7),
  "category_id" UUID NOT NULL,
  "category_name_snapshot" VARCHAR(120) NOT NULL,
  "branch_name_snapshot" VARCHAR(160),
  "receipt_required_snapshot" BOOLEAN NOT NULL DEFAULT false,
  "expense_date" DATE NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'MYR',
  "payee_name" VARCHAR(160),
  "description" VARCHAR(500) NOT NULL,
  "notes" VARCHAR(2000),
  "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
  "payment_status" "ExpensePaymentStatus" NOT NULL DEFAULT 'UNPAID',
  "payment_method" "ExpensePaymentMethod",
  "payment_date" DATE,
  "payment_reference" VARCHAR(160),
  "created_by_id" UUID NOT NULL,
  "confirmed_by_id" UUID,
  "confirmed_at" TIMESTAMP(3),
  "paid_by_id" UUID,
  "paid_at" TIMESTAMP(3),
  "voided_by_id" UUID,
  "voided_at" TIMESTAMP(3),
  "void_reason" VARCHAR(500),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_expenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_expenses_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "business_expenses_currency_check" CHECK ("currency" = 'MYR'),
  CONSTRAINT "business_expenses_source_check" CHECK (("source_type" = 'MANUAL' AND "source_id" IS NULL AND "source_revision" IS NULL) OR ("source_type" <> 'MANUAL' AND "source_id" IS NOT NULL AND "source_revision" IS NOT NULL)),
  CONSTRAINT "business_expenses_period_check" CHECK ("generated_period" IS NULL OR "generated_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "business_expenses_payment_check" CHECK (("payment_status" = 'UNPAID' AND "payment_method" IS NULL AND "payment_date" IS NULL AND "paid_by_id" IS NULL AND "paid_at" IS NULL) OR ("payment_status" = 'PAID' AND "payment_method" IS NOT NULL AND "payment_date" IS NOT NULL AND "paid_by_id" IS NOT NULL AND "paid_at" IS NOT NULL)),
  CONSTRAINT "business_expenses_status_check" CHECK (("status" = 'DRAFT' AND "confirmed_by_id" IS NULL AND "confirmed_at" IS NULL AND "voided_by_id" IS NULL AND "voided_at" IS NULL AND "void_reason" IS NULL AND "payment_status" = 'UNPAID') OR ("status" = 'CONFIRMED' AND "confirmed_by_id" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "voided_by_id" IS NULL AND "voided_at" IS NULL AND "void_reason" IS NULL) OR ("status" = 'VOID' AND "confirmed_by_id" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "voided_by_id" IS NOT NULL AND "voided_at" IS NOT NULL AND "void_reason" IS NOT NULL AND "payment_status" = 'UNPAID'))
);

CREATE TABLE "business_expense_revisions" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "expense_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "revision_type" VARCHAR(40) NOT NULL,
  "reason" VARCHAR(500),
  "branch_id" UUID,
  "branch_name_snapshot" VARCHAR(160),
  "category_id" UUID NOT NULL,
  "category_name_snapshot" VARCHAR(120) NOT NULL,
  "receipt_required_snapshot" BOOLEAN NOT NULL,
  "expense_date" DATE NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "payee_name" VARCHAR(160),
  "description" VARCHAR(500) NOT NULL,
  "notes" VARCHAR(2000),
  "status" "ExpenseStatus" NOT NULL,
  "payment_status" "ExpensePaymentStatus" NOT NULL,
  "payment_method" "ExpensePaymentMethod",
  "payment_date" DATE,
  "payment_reference" VARCHAR(160),
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_expense_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_expense_revisions_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "business_expense_revisions_currency_check" CHECK ("currency" = 'MYR')
);

CREATE TABLE "business_expense_payment_events" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "expense_id" UUID NOT NULL,
  "payment_status" "ExpensePaymentStatus" NOT NULL,
  "payment_method" "ExpensePaymentMethod" NOT NULL,
  "payment_date" DATE NOT NULL,
  "payment_reference" VARCHAR(160),
  "actor_user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_expense_payment_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_expense_payment_events_status_check" CHECK ("payment_status" = 'PAID')
);

CREATE TABLE "business_expense_attachments" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "expense_id" UUID NOT NULL,
  "uploaded_by_id" UUID NOT NULL,
  "object_key" VARCHAR(300) NOT NULL,
  "sanitized_file_name" VARCHAR(120) NOT NULL,
  "mime_type" VARCHAR(80) NOT NULL,
  "byte_length" INTEGER NOT NULL,
  "checksum_sha256" CHAR(64) NOT NULL,
  "malware_status" "ClaimAttachmentMalwareStatus" NOT NULL DEFAULT 'NOT_SCANNED',
  "privacy_metadata_status" "ClaimAttachmentPrivacyStatus" NOT NULL DEFAULT 'NOT_CHECKED',
  "quarantine_disposition" VARCHAR(30) NOT NULL DEFAULT 'QUARANTINED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_expense_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_expense_attachments_size_check" CHECK ("byte_length" > 0 AND "byte_length" <= 10485760),
  CONSTRAINT "business_expense_attachments_quarantine_check" CHECK ("quarantine_disposition" = 'QUARANTINED')
);

CREATE TABLE "expense_commands" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "operation_key" VARCHAR(180) NOT NULL,
  "command_type" "ExpenseCommandType" NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_entity_type" VARCHAR(50) NOT NULL,
  "result_entity_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expense_commands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expense_categories_id_business_id_key" ON "expense_categories"("id", "business_id");
CREATE UNIQUE INDEX "expense_categories_business_id_name_key" ON "expense_categories"("business_id", "name");
CREATE UNIQUE INDEX "expense_categories_business_id_code_key" ON "expense_categories"("business_id", "code");
CREATE INDEX "expense_categories_business_id_active_sort_order_name_idx" ON "expense_categories"("business_id", "active", "sort_order", "name");
CREATE UNIQUE INDEX "recurring_expense_templates_id_business_id_key" ON "recurring_expense_templates"("id", "business_id");
CREATE INDEX "recurring_expense_templates_business_id_active_start_date_end_date_idx" ON "recurring_expense_templates"("business_id", "active", "start_date", "end_date");
CREATE INDEX "recurring_expense_templates_business_id_branch_id_category_id_idx" ON "recurring_expense_templates"("business_id", "branch_id", "category_id");
CREATE UNIQUE INDEX "business_expenses_id_business_id_key" ON "business_expenses"("id", "business_id");
CREATE UNIQUE INDEX "business_expenses_business_id_expense_number_key" ON "business_expenses"("business_id", "expense_number");
CREATE UNIQUE INDEX "business_expenses_business_id_source_type_source_id_source_revision_key" ON "business_expenses"("business_id", "source_type", "source_id", "source_revision");
CREATE UNIQUE INDEX "business_expenses_recurring_template_id_generated_period_key" ON "business_expenses"("recurring_template_id", "generated_period");
CREATE INDEX "business_expenses_business_id_expense_date_created_at_idx" ON "business_expenses"("business_id", "expense_date", "created_at");
CREATE INDEX "business_expenses_business_id_branch_id_expense_date_idx" ON "business_expenses"("business_id", "branch_id", "expense_date");
CREATE INDEX "business_expenses_business_id_category_id_expense_date_idx" ON "business_expenses"("business_id", "category_id", "expense_date");
CREATE INDEX "business_expenses_business_id_payment_status_expense_date_idx" ON "business_expenses"("business_id", "payment_status", "expense_date");
CREATE INDEX "business_expenses_business_id_status_expense_date_idx" ON "business_expenses"("business_id", "status", "expense_date");
CREATE INDEX "business_expenses_business_id_source_type_source_id_idx" ON "business_expenses"("business_id", "source_type", "source_id");
CREATE UNIQUE INDEX "business_expense_revisions_expense_id_revision_key" ON "business_expense_revisions"("expense_id", "revision");
CREATE INDEX "business_expense_revisions_business_id_expense_id_created_at_idx" ON "business_expense_revisions"("business_id", "expense_id", "created_at");
CREATE UNIQUE INDEX "business_expense_payment_events_expense_id_payment_status_key" ON "business_expense_payment_events"("expense_id", "payment_status");
CREATE INDEX "business_expense_payment_events_business_id_payment_date_idx" ON "business_expense_payment_events"("business_id", "payment_date");
CREATE UNIQUE INDEX "business_expense_attachments_object_key_key" ON "business_expense_attachments"("object_key");
CREATE UNIQUE INDEX "business_expense_attachments_id_business_id_key" ON "business_expense_attachments"("id", "business_id");
CREATE INDEX "business_expense_attachments_business_id_expense_id_idx" ON "business_expense_attachments"("business_id", "expense_id");
CREATE UNIQUE INDEX "expense_commands_business_id_operation_key_key" ON "expense_commands"("business_id", "operation_key");
CREATE INDEX "expense_commands_business_id_command_type_created_at_idx" ON "expense_commands"("business_id", "command_type", "created_at");

ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_expense_templates" ADD CONSTRAINT "recurring_expense_templates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_expense_templates" ADD CONSTRAINT "recurring_expense_templates_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_expense_templates" ADD CONSTRAINT "recurring_expense_templates_category_id_business_id_fkey" FOREIGN KEY ("category_id", "business_id") REFERENCES "expense_categories"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_expense_templates" ADD CONSTRAINT "recurring_expense_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_expense_templates" ADD CONSTRAINT "recurring_expense_templates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expenses" ADD CONSTRAINT "business_expenses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expenses" ADD CONSTRAINT "business_expenses_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expenses" ADD CONSTRAINT "business_expenses_category_id_business_id_fkey" FOREIGN KEY ("category_id", "business_id") REFERENCES "expense_categories"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expenses" ADD CONSTRAINT "business_expenses_recurring_template_id_business_id_fkey" FOREIGN KEY ("recurring_template_id", "business_id") REFERENCES "recurring_expense_templates"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expenses" ADD CONSTRAINT "business_expenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expenses" ADD CONSTRAINT "business_expenses_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expenses" ADD CONSTRAINT "business_expenses_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expenses" ADD CONSTRAINT "business_expenses_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expense_revisions" ADD CONSTRAINT "business_expense_revisions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expense_revisions" ADD CONSTRAINT "business_expense_revisions_expense_id_business_id_fkey" FOREIGN KEY ("expense_id", "business_id") REFERENCES "business_expenses"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expense_revisions" ADD CONSTRAINT "business_expense_revisions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expense_payment_events" ADD CONSTRAINT "business_expense_payment_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expense_payment_events" ADD CONSTRAINT "business_expense_payment_events_expense_id_business_id_fkey" FOREIGN KEY ("expense_id", "business_id") REFERENCES "business_expenses"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expense_payment_events" ADD CONSTRAINT "business_expense_payment_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expense_attachments" ADD CONSTRAINT "business_expense_attachments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expense_attachments" ADD CONSTRAINT "business_expense_attachments_expense_id_business_id_fkey" FOREIGN KEY ("expense_id", "business_id") REFERENCES "business_expenses"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_expense_attachments" ADD CONSTRAINT "business_expense_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_commands" ADD CONSTRAINT "expense_commands_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_commands" ADD CONSTRAINT "expense_commands_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_expense_append_only_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'expense history is immutable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER business_expense_revisions_prevent_update BEFORE UPDATE ON "business_expense_revisions" FOR EACH ROW EXECUTE FUNCTION prevent_expense_append_only_mutation();
CREATE TRIGGER business_expense_revisions_prevent_delete BEFORE DELETE ON "business_expense_revisions" FOR EACH ROW EXECUTE FUNCTION prevent_expense_append_only_mutation();
CREATE TRIGGER business_expense_payment_events_prevent_update BEFORE UPDATE ON "business_expense_payment_events" FOR EACH ROW EXECUTE FUNCTION prevent_expense_append_only_mutation();
CREATE TRIGGER business_expense_payment_events_prevent_delete BEFORE DELETE ON "business_expense_payment_events" FOR EACH ROW EXECUTE FUNCTION prevent_expense_append_only_mutation();
CREATE TRIGGER expense_commands_prevent_update BEFORE UPDATE ON "expense_commands" FOR EACH ROW EXECUTE FUNCTION prevent_expense_append_only_mutation();
CREATE TRIGGER expense_commands_prevent_delete BEFORE DELETE ON "expense_commands" FOR EACH ROW EXECUTE FUNCTION prevent_expense_append_only_mutation();
CREATE TRIGGER business_expenses_prevent_delete BEFORE DELETE ON "business_expenses" FOR EACH ROW EXECUTE FUNCTION prevent_expense_append_only_mutation();
CREATE TRIGGER recurring_expense_templates_prevent_delete BEFORE DELETE ON "recurring_expense_templates" FOR EACH ROW EXECUTE FUNCTION prevent_expense_append_only_mutation();
CREATE TRIGGER business_expense_attachments_prevent_delete BEFORE DELETE ON "business_expense_attachments" FOR EACH ROW EXECUTE FUNCTION prevent_expense_append_only_mutation();

CREATE OR REPLACE FUNCTION expense_actor_scope_guard() RETURNS trigger AS $$
DECLARE actor_id UUID;
BEGIN
  FOREACH actor_id IN ARRAY ARRAY[
    (to_jsonb(NEW)->>'created_by_id')::UUID,
    (to_jsonb(NEW)->>'confirmed_by_id')::UUID,
    (to_jsonb(NEW)->>'paid_by_id')::UUID,
    (to_jsonb(NEW)->>'voided_by_id')::UUID,
    (to_jsonb(NEW)->>'updated_by_id')::UUID,
    (to_jsonb(NEW)->>'uploaded_by_id')::UUID,
    (to_jsonb(NEW)->>'actor_user_id')::UUID
  ] LOOP
    IF actor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = actor_id AND "business_id" = NEW."business_id") THEN
      RAISE EXCEPTION 'expense actor is outside business scope';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER recurring_expense_templates_actor_scope BEFORE INSERT OR UPDATE ON "recurring_expense_templates" FOR EACH ROW EXECUTE FUNCTION expense_actor_scope_guard();
CREATE TRIGGER business_expenses_actor_scope BEFORE INSERT OR UPDATE ON "business_expenses" FOR EACH ROW EXECUTE FUNCTION expense_actor_scope_guard();
CREATE TRIGGER business_expense_revisions_actor_scope BEFORE INSERT ON "business_expense_revisions" FOR EACH ROW EXECUTE FUNCTION expense_actor_scope_guard();
CREATE TRIGGER business_expense_payment_events_actor_scope BEFORE INSERT ON "business_expense_payment_events" FOR EACH ROW EXECUTE FUNCTION expense_actor_scope_guard();
CREATE TRIGGER business_expense_attachments_actor_scope BEFORE INSERT OR UPDATE ON "business_expense_attachments" FOR EACH ROW EXECUTE FUNCTION expense_actor_scope_guard();
CREATE TRIGGER expense_commands_actor_scope BEFORE INSERT ON "expense_commands" FOR EACH ROW EXECUTE FUNCTION expense_actor_scope_guard();
