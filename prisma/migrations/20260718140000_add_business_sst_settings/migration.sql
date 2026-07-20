ALTER TABLE "businesses"
  ADD COLUMN "sst_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sst_label" TEXT NOT NULL DEFAULT 'SST',
  ADD COLUMN "sst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "sst_registration_no" TEXT;
