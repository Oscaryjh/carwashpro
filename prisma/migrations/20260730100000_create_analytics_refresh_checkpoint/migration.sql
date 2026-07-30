CREATE TABLE "analytics_refresh_checkpoints" (
    "key" TEXT NOT NULL,
    "processed_through" TIMESTAMP(3) NOT NULL,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "last_sweep_started_at" TIMESTAMP(3),
    "last_sweep_completed_at" TIMESTAMP(3),
    "last_run_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_refresh_checkpoints_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "analytics_refresh_checkpoints_lease_pair_check"
      CHECK (("lease_owner" IS NULL) = ("lease_expires_at" IS NULL))
);

CREATE INDEX "analytics_refresh_checkpoints_lease_expires_idx"
  ON "analytics_refresh_checkpoints"("lease_expires_at");
