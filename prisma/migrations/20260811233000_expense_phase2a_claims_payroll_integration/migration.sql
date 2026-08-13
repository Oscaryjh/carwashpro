-- Expense Phase 2A: explicit Claims and Payroll source settings plus immutable source facts.
CREATE TABLE "expense_integration_settings" (
    "business_id" UUID NOT NULL,
    "claim_default_category_id" UUID,
    "payroll_category_id" UUID,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expense_integration_settings_pkey" PRIMARY KEY ("business_id")
);

CREATE TABLE "expense_source_snapshots" (
    "expense_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "source_type" "ExpenseSourceType" NOT NULL,
    "source_id" VARCHAR(180) NOT NULL,
    "source_revision" VARCHAR(100) NOT NULL,
    "source_record_id" UUID NOT NULL,
    "source_number_snapshot" VARCHAR(64) NOT NULL,
    "source_status_snapshot" VARCHAR(64) NOT NULL,
    "submitted_amount" DECIMAL(12,2),
    "approved_amount" DECIMAL(12,2),
    "gross_remuneration" DECIMAL(14,2),
    "employer_contribution_total" DECIMAL(14,2),
    "other_employer_cost" DECIMAL(14,2),
    "excluded_pass_through" DECIMAL(14,2),
    "total_business_cost" DECIMAL(14,2) NOT NULL,
    "receipt_available" BOOLEAN NOT NULL DEFAULT false,
    "source_digest" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expense_source_snapshots_pkey" PRIMARY KEY ("expense_id")
);

CREATE INDEX "expense_integration_settings_business_id_revision_idx" ON "expense_integration_settings"("business_id", "revision");
CREATE UNIQUE INDEX "expense_source_snapshots_business_id_source_type_source_id_source_revision_key" ON "expense_source_snapshots"("business_id", "source_type", "source_id", "source_revision");
CREATE UNIQUE INDEX "expense_source_snapshots_expense_id_business_id_key" ON "expense_source_snapshots"("expense_id", "business_id");
CREATE INDEX "expense_source_snapshots_business_id_source_type_source_record_id_idx" ON "expense_source_snapshots"("business_id", "source_type", "source_record_id");
CREATE INDEX "expense_source_snapshots_business_id_source_digest_idx" ON "expense_source_snapshots"("business_id", "source_digest");

-- At most one non-void representation may be active for a canonical Claim or Payroll source.
CREATE UNIQUE INDEX "business_expenses_one_active_system_source"
ON "business_expenses"("business_id", "source_type", "source_id")
WHERE "status" <> 'VOID' AND "source_type" IN ('CLAIM', 'PAYROLL');

ALTER TABLE "expense_integration_settings"
  ADD CONSTRAINT "expense_integration_settings_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_integration_settings"
  ADD CONSTRAINT "expense_integration_settings_claim_default_category_id_business_id_fkey"
  FOREIGN KEY ("claim_default_category_id", "business_id") REFERENCES "expense_categories"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_integration_settings"
  ADD CONSTRAINT "expense_integration_settings_payroll_category_id_business_id_fkey"
  FOREIGN KEY ("payroll_category_id", "business_id") REFERENCES "expense_categories"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_source_snapshots"
  ADD CONSTRAINT "expense_source_snapshots_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_source_snapshots"
  ADD CONSTRAINT "expense_source_snapshots_expense_id_business_id_fkey"
  FOREIGN KEY ("expense_id", "business_id") REFERENCES "business_expenses"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expense_integration_settings"
  ADD CONSTRAINT "expense_integration_settings_category_required"
  CHECK ("claim_default_category_id" IS NOT NULL OR "payroll_category_id" IS NOT NULL);
ALTER TABLE "expense_source_snapshots"
  ADD CONSTRAINT "expense_source_snapshots_supported_source"
  CHECK ("source_type" IN ('CLAIM', 'PAYROLL'));
ALTER TABLE "expense_source_snapshots"
  ADD CONSTRAINT "expense_source_snapshots_money_nonnegative"
  CHECK (
    "total_business_cost" >= 0 AND
    ("submitted_amount" IS NULL OR "submitted_amount" >= 0) AND
    ("approved_amount" IS NULL OR "approved_amount" >= 0) AND
    ("gross_remuneration" IS NULL OR "gross_remuneration" >= 0) AND
    ("employer_contribution_total" IS NULL OR "employer_contribution_total" >= 0) AND
    ("other_employer_cost" IS NULL OR "other_employer_cost" >= 0) AND
    ("excluded_pass_through" IS NULL OR "excluded_pass_through" >= 0)
  );
