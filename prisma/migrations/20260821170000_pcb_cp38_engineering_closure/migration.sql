CREATE TYPE "EmployeeCp38InstructionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');

ALTER TABLE "payroll_entries"
ADD COLUMN "cp38" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE "employee_cp38_instructions" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "instruction_reference" VARCHAR(120) NOT NULL,
  "effective_from_month" DATE NOT NULL,
  "effective_to_month" DATE,
  "monthly_amount" DECIMAL(12,2) NOT NULL,
  "status" "EmployeeCp38InstructionStatus" NOT NULL DEFAULT 'ACTIVE',
  "evidence_reference" VARCHAR(500) NOT NULL,
  "revision" INTEGER NOT NULL,
  "recorded_by_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source_digest" CHAR(64) NOT NULL,
  CONSTRAINT "employee_cp38_instructions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_cp38_instructions_amount_check" CHECK ("monthly_amount" > 0),
  CONSTRAINT "employee_cp38_instructions_period_check" CHECK (
    "effective_to_month" IS NULL OR "effective_to_month" >= "effective_from_month"
  )
);

CREATE UNIQUE INDEX "employee_cp38_instructions_membership_reference_revision_key"
ON "employee_cp38_instructions"("membership_id", "instruction_reference", "revision");

CREATE INDEX "employee_cp38_instructions_scope_period_idx"
ON "employee_cp38_instructions"(
  "business_id",
  "membership_id",
  "status",
  "effective_from_month",
  "effective_to_month"
);
