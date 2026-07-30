ALTER TYPE "AnalyticsRefreshTrigger"
ADD VALUE IF NOT EXISTS 'SCHEDULED';

ALTER TABLE "analytics_refresh_checkpoints"
ADD COLUMN "last_coverage_at" TIMESTAMPTZ;
