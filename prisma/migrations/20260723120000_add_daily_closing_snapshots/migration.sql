CREATE TYPE "DailyClosingStatus" AS ENUM ('CLOSED');

CREATE TABLE "daily_closing_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "timezone" TEXT NOT NULL,
    "business_type" "BusinessIndustry" NOT NULL,
    "status" "DailyClosingStatus" NOT NULL DEFAULT 'CLOSED',
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by_user_id" UUID NOT NULL,
    "expected_cash_cents" INTEGER NOT NULL,
    "actual_cash_cents" INTEGER NOT NULL,
    "cash_difference_cents" INTEGER NOT NULL,
    "closing_note" TEXT,
    "report_data_json" JSONB NOT NULL,
    "whatsapp_text" TEXT NOT NULL,
    "report_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_closing_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_closing_snapshots_business_id_branch_id_business_date_key"
ON "daily_closing_snapshots"("business_id", "branch_id", "business_date");

CREATE INDEX "daily_closing_snapshots_business_id_business_date_idx"
ON "daily_closing_snapshots"("business_id", "business_date");

CREATE INDEX "daily_closing_snapshots_branch_id_business_date_idx"
ON "daily_closing_snapshots"("branch_id", "business_date");

CREATE INDEX "daily_closing_snapshots_closed_by_user_id_idx"
ON "daily_closing_snapshots"("closed_by_user_id");

ALTER TABLE "daily_closing_snapshots"
ADD CONSTRAINT "daily_closing_snapshots_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "daily_closing_snapshots"
ADD CONSTRAINT "daily_closing_snapshots_branch_id_fkey"
FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "daily_closing_snapshots"
ADD CONSTRAINT "daily_closing_snapshots_closed_by_user_id_fkey"
FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
