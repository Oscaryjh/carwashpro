CREATE TYPE "AnalyticsRefreshStatus" AS ENUM (
  'RUNNING',
  'SUCCEEDED',
  'FAILED'
);

CREATE TYPE "AnalyticsRefreshTrigger" AS ENUM (
  'MANUAL',
  'BACKFILL',
  'LATE_EVENT'
);

CREATE TABLE "analytics_refresh_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "status" "AnalyticsRefreshStatus" NOT NULL DEFAULT 'RUNNING',
  "trigger" "AnalyticsRefreshTrigger" NOT NULL,
  "requested_from_date" DATE NOT NULL,
  "requested_to_date" DATE NOT NULL,
  "metric_definition_version" INTEGER NOT NULL,
  "business_day_definition_version" INTEGER NOT NULL,
  "business_count" INTEGER NOT NULL DEFAULT 0,
  "summary_count" INTEGER NOT NULL DEFAULT 0,
  "source_watermark" TIMESTAMP(3),
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "analytics_refresh_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analytics_refresh_runs_valid_range_check"
    CHECK ("requested_from_date" <= "requested_to_date"),
  CONSTRAINT "analytics_refresh_runs_counts_check"
    CHECK ("business_count" >= 0 AND "summary_count" >= 0),
  CONSTRAINT "analytics_refresh_runs_completion_check"
    CHECK (
      ("status" = 'RUNNING' AND "completed_at" IS NULL)
      OR
      ("status" IN ('SUCCEEDED', 'FAILED') AND "completed_at" IS NOT NULL)
    )
);

CREATE TABLE "analytics_daily_store_summaries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "refresh_run_id" UUID,
  "business_date" DATE NOT NULL,
  "timezone" TEXT NOT NULL,
  "business_day_cutoff_time" TEXT NOT NULL,
  "business_day_definition_version" INTEGER NOT NULL,
  "metric_definition_version" INTEGER NOT NULL,
  "gross_sales_cents" INTEGER NOT NULL,
  "discounts_cents" INTEGER NOT NULL,
  "net_sales_cents" INTEGER NOT NULL,
  "gross_collections_cents" INTEGER NOT NULL,
  "net_collections_cents" INTEGER NOT NULL,
  "refunds_cents" INTEGER NOT NULL,
  "outstanding_cents" INTEGER NOT NULL,
  "tips_cents" INTEGER NOT NULL,
  "package_voucher_cents" INTEGER NOT NULL,
  "transaction_count" INTEGER NOT NULL,
  "average_transaction_value_cents" INTEGER,
  "source_from" TIMESTAMP(3) NOT NULL,
  "source_to_exclusive" TIMESTAMP(3) NOT NULL,
  "source_watermark" TIMESTAMP(3),
  "computed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "analytics_daily_store_summaries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analytics_daily_store_summaries_range_check"
    CHECK ("source_from" < "source_to_exclusive"),
  CONSTRAINT "analytics_daily_store_summaries_counts_check"
    CHECK ("transaction_count" >= 0)
);

CREATE TABLE "analytics_daily_payment_method_summaries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "daily_summary_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "business_date" DATE NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "metric_definition_version" INTEGER NOT NULL,
  "gross_collections_cents" INTEGER NOT NULL,
  "refunds_cents" INTEGER NOT NULL,
  "net_collections_cents" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "analytics_daily_payment_method_summaries_pkey"
    PRIMARY KEY ("id"),
  CONSTRAINT "analytics_daily_payment_method_summaries_method_check"
    CHECK ("method" <> 'PACKAGE')
);

CREATE UNIQUE INDEX "analytics_daily_store_summary_version_key"
  ON "analytics_daily_store_summaries"(
    "business_id",
    "business_date",
    "metric_definition_version",
    "business_day_definition_version"
  );
CREATE INDEX "analytics_daily_store_summary_business_date_idx"
  ON "analytics_daily_store_summaries"("business_id", "business_date");
CREATE INDEX "analytics_daily_store_summary_date_version_idx"
  ON "analytics_daily_store_summaries"(
    "business_date",
    "metric_definition_version",
    "business_day_definition_version"
  );
CREATE INDEX "analytics_daily_store_summary_refresh_run_idx"
  ON "analytics_daily_store_summaries"("refresh_run_id");

CREATE UNIQUE INDEX "analytics_daily_payment_method_key"
  ON "analytics_daily_payment_method_summaries"(
    "daily_summary_id",
    "method"
  );
CREATE INDEX "analytics_daily_payment_business_date_method_idx"
  ON "analytics_daily_payment_method_summaries"(
    "business_id",
    "business_date",
    "method"
  );

CREATE INDEX "analytics_refresh_runs_status_started_idx"
  ON "analytics_refresh_runs"("status", "started_at");
CREATE INDEX "analytics_refresh_runs_trigger_started_idx"
  ON "analytics_refresh_runs"("trigger", "started_at");

CREATE INDEX "invoices_business_issued_status_idx"
  ON "invoices"("business_id", "issued_at", "status");
CREATE INDEX "invoices_business_updated_idx"
  ON "invoices"("business_id", "updated_at");
CREATE INDEX "payments_business_paid_status_method_idx"
  ON "payments"("business_id", "paid_at", "status", "method");
CREATE INDEX "payments_business_updated_idx"
  ON "payments"("business_id", "updated_at");
CREATE INDEX "payment_refunds_business_updated_idx"
  ON "payment_refunds"("business_id", "updated_at");

ALTER TABLE "analytics_daily_store_summaries"
  ADD CONSTRAINT "analytics_daily_store_summaries_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "analytics_daily_store_summaries_refresh_run_id_fkey"
  FOREIGN KEY ("refresh_run_id") REFERENCES "analytics_refresh_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "analytics_daily_payment_method_summaries"
  ADD CONSTRAINT "analytics_daily_payment_method_daily_summary_id_fkey"
  FOREIGN KEY ("daily_summary_id")
  REFERENCES "analytics_daily_store_summaries"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "analytics_daily_payment_method_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
