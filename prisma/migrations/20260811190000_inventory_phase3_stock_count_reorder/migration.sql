-- Inventory Phase 3: physical-count evidence, variance approval and branch reorder targets.
CREATE TYPE "StockCountType" AS ENUM ('FULL_BRANCH_COUNT', 'SELECTED_PRODUCTS');
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'CANCELLED');
CREATE TYPE "StockCountCommandType" AS ENUM ('CREATE_COUNT', 'START_COUNT', 'RECORD_LINE', 'SUBMIT_COUNT', 'REOPEN_COUNT', 'APPROVE_COUNT', 'CANCEL_COUNT', 'SET_REORDER_SETTINGS');

ALTER TABLE "businesses" ADD COLUMN "stock_count_sequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "product_stocks" ADD COLUMN "target_stock_level" INTEGER;
ALTER TABLE "product_stocks" ADD CONSTRAINT "product_stocks_target_stock_level_check" CHECK ("target_stock_level" IS NULL OR "target_stock_level" >= 0);

CREATE TABLE "stock_count_sessions" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "count_number" VARCHAR(40) NOT NULL,
  "count_type" "StockCountType" NOT NULL,
  "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "transition_reason" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" UUID NOT NULL,
  "started_by_id" UUID,
  "submitted_by_id" UUID,
  "approved_by_id" UUID,
  "cancelled_by_id" UUID,
  "started_at" TIMESTAMP(3),
  "submitted_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stock_count_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_count_lines" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "expected_quantity_at_count" INTEGER,
  "actual_quantity" INTEGER,
  "variance_quantity" INTEGER,
  "counted_at" TIMESTAMP(3),
  "counted_by_id" UUID,
  "ledger_watermark_at_count" TIMESTAMP(3),
  "ledger_digest" VARCHAR(64),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_count_lines_quantity_check" CHECK (
    ("expected_quantity_at_count" IS NULL AND "actual_quantity" IS NULL AND "variance_quantity" IS NULL AND "counted_at" IS NULL AND "counted_by_id" IS NULL AND "ledger_digest" IS NULL)
    OR
    ("expected_quantity_at_count" >= 0 AND "actual_quantity" >= 0 AND "variance_quantity" = "actual_quantity" - "expected_quantity_at_count" AND "counted_at" IS NOT NULL AND "counted_by_id" IS NOT NULL AND "ledger_digest" IS NOT NULL)
  )
);

CREATE TABLE "stock_count_line_revisions" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "line_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "expected_quantity_at_count" INTEGER NOT NULL,
  "actual_quantity" INTEGER NOT NULL,
  "variance_quantity" INTEGER NOT NULL,
  "counted_at" TIMESTAMP(3) NOT NULL,
  "counted_by_id" UUID NOT NULL,
  "ledger_watermark_at_count" TIMESTAMP(3),
  "ledger_digest" VARCHAR(64) NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_count_line_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_count_line_revisions_quantity_check" CHECK ("expected_quantity_at_count" >= 0 AND "actual_quantity" >= 0 AND "variance_quantity" = "actual_quantity" - "expected_quantity_at_count")
);

CREATE TABLE "stock_count_commands" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "session_id" UUID,
  "operation_key" VARCHAR(180) NOT NULL,
  "command_type" "StockCountCommandType" NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "result_entity_type" VARCHAR(50) NOT NULL,
  "result_entity_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_count_commands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_count_sessions_id_business_id_key" ON "stock_count_sessions"("id", "business_id");
CREATE UNIQUE INDEX "stock_count_sessions_business_id_count_number_key" ON "stock_count_sessions"("business_id", "count_number");
CREATE INDEX "stock_count_sessions_business_id_status_created_at_idx" ON "stock_count_sessions"("business_id", "status", "created_at");
CREATE INDEX "stock_count_sessions_business_id_branch_id_status_idx" ON "stock_count_sessions"("business_id", "branch_id", "status");
CREATE INDEX "stock_count_sessions_approved_at_idx" ON "stock_count_sessions"("approved_at");
CREATE UNIQUE INDEX "stock_count_lines_id_business_id_key" ON "stock_count_lines"("id", "business_id");
CREATE UNIQUE INDEX "stock_count_lines_session_id_product_id_key" ON "stock_count_lines"("session_id", "product_id");
CREATE UNIQUE INDEX "stock_count_lines_one_active_product_per_branch_key" ON "stock_count_lines"("branch_id", "product_id") WHERE "active" = true;
CREATE INDEX "stock_count_lines_business_id_branch_id_product_id_idx" ON "stock_count_lines"("business_id", "branch_id", "product_id");
CREATE INDEX "stock_count_lines_business_id_session_id_counted_at_idx" ON "stock_count_lines"("business_id", "session_id", "counted_at");
CREATE UNIQUE INDEX "stock_count_line_revisions_line_id_revision_key" ON "stock_count_line_revisions"("line_id", "revision");
CREATE INDEX "stock_count_line_revisions_business_id_product_id_counted_at_idx" ON "stock_count_line_revisions"("business_id", "product_id", "counted_at");
CREATE UNIQUE INDEX "stock_count_commands_business_id_operation_key_key" ON "stock_count_commands"("business_id", "operation_key");
CREATE INDEX "stock_count_commands_business_id_command_type_created_at_idx" ON "stock_count_commands"("business_id", "command_type", "created_at");
CREATE INDEX "stock_count_commands_session_id_idx" ON "stock_count_commands"("session_id");

ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_session_id_business_id_fkey" FOREIGN KEY ("session_id", "business_id") REFERENCES "stock_count_sessions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_counted_by_id_fkey" FOREIGN KEY ("counted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_line_revisions" ADD CONSTRAINT "stock_count_line_revisions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_line_revisions" ADD CONSTRAINT "stock_count_line_revisions_line_id_business_id_fkey" FOREIGN KEY ("line_id", "business_id") REFERENCES "stock_count_lines"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_line_revisions" ADD CONSTRAINT "stock_count_line_revisions_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_line_revisions" ADD CONSTRAINT "stock_count_line_revisions_counted_by_id_fkey" FOREIGN KEY ("counted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_commands" ADD CONSTRAINT "stock_count_commands_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_commands" ADD CONSTRAINT "stock_count_commands_session_id_business_id_fkey" FOREIGN KEY ("session_id", "business_id") REFERENCES "stock_count_sessions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_commands" ADD CONSTRAINT "stock_count_commands_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_stock_count_append_only_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock count history is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_count_line_revisions_prevent_update BEFORE UPDATE ON "stock_count_line_revisions" FOR EACH ROW EXECUTE FUNCTION prevent_stock_count_append_only_mutation();
CREATE TRIGGER stock_count_line_revisions_prevent_delete BEFORE DELETE ON "stock_count_line_revisions" FOR EACH ROW EXECUTE FUNCTION prevent_stock_count_append_only_mutation();
CREATE TRIGGER stock_count_commands_prevent_update BEFORE UPDATE ON "stock_count_commands" FOR EACH ROW EXECUTE FUNCTION prevent_stock_count_append_only_mutation();
CREATE TRIGGER stock_count_commands_prevent_delete BEFORE DELETE ON "stock_count_commands" FOR EACH ROW EXECUTE FUNCTION prevent_stock_count_append_only_mutation();

CREATE OR REPLACE FUNCTION protect_approved_stock_count()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."status" = 'APPROVED' THEN
    RAISE EXCEPTION 'approved stock count is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER stock_count_sessions_protect_approved_update BEFORE UPDATE ON "stock_count_sessions" FOR EACH ROW EXECUTE FUNCTION protect_approved_stock_count();
CREATE TRIGGER stock_count_sessions_prevent_delete BEFORE DELETE ON "stock_count_sessions" FOR EACH ROW EXECUTE FUNCTION protect_approved_stock_count();

CREATE OR REPLACE FUNCTION protect_approved_stock_count_line()
RETURNS trigger AS $$
DECLARE session_status "StockCountStatus";
BEGIN
  SELECT "status" INTO session_status FROM "stock_count_sessions" WHERE "id" = OLD."session_id";
  IF TG_OP = 'DELETE' OR session_status = 'APPROVED' THEN
    RAISE EXCEPTION 'approved stock count line is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER stock_count_lines_protect_approved_update BEFORE UPDATE ON "stock_count_lines" FOR EACH ROW EXECUTE FUNCTION protect_approved_stock_count_line();
CREATE TRIGGER stock_count_lines_prevent_delete BEFORE DELETE ON "stock_count_lines" FOR EACH ROW EXECUTE FUNCTION protect_approved_stock_count_line();

CREATE OR REPLACE FUNCTION stock_count_user_scope_guard()
RETURNS trigger AS $$
DECLARE user_id UUID;
BEGIN
  FOREACH user_id IN ARRAY ARRAY[NEW."created_by_id", NEW."started_by_id", NEW."submitted_by_id", NEW."approved_by_id", NEW."cancelled_by_id"] LOOP
    IF user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = user_id AND "business_id" = NEW."business_id") THEN
      RAISE EXCEPTION 'stock count actor is outside business scope';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER stock_count_sessions_user_scope BEFORE INSERT OR UPDATE ON "stock_count_sessions" FOR EACH ROW EXECUTE FUNCTION stock_count_user_scope_guard();

CREATE OR REPLACE FUNCTION stock_count_single_user_scope_guard()
RETURNS trigger AS $$
DECLARE user_id UUID;
BEGIN
  user_id := COALESCE((to_jsonb(NEW)->>'counted_by_id')::UUID, (to_jsonb(NEW)->>'actor_user_id')::UUID);
  IF user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = user_id AND "business_id" = NEW."business_id") THEN
    RAISE EXCEPTION 'stock count user is outside business scope';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER stock_count_lines_user_scope BEFORE INSERT OR UPDATE ON "stock_count_lines" FOR EACH ROW EXECUTE FUNCTION stock_count_single_user_scope_guard();
CREATE TRIGGER stock_count_line_revisions_user_scope BEFORE INSERT ON "stock_count_line_revisions" FOR EACH ROW EXECUTE FUNCTION stock_count_single_user_scope_guard();
CREATE TRIGGER stock_count_commands_user_scope BEFORE INSERT ON "stock_count_commands" FOR EACH ROW EXECUTE FUNCTION stock_count_single_user_scope_guard();
