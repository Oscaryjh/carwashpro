BEGIN;

CREATE TYPE "StatutoryParticipationStatus" AS ENUM (
  'PARTICIPATING',
  'NOT_PARTICIPATING'
);

CREATE TYPE "StatutoryParticipationSourceType" AS ENUM (
  'OFFICIAL_RECORD',
  'EMPLOYMENT_CHANGE',
  'EMPLOYEE_DECLARATION',
  'LEGACY_REVIEW',
  'OTHER'
);

CREATE TABLE "employee_statutory_participation_periods" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "scheme" "StatutoryScheme" NOT NULL,
  "revision" INTEGER NOT NULL,
  "effective_from_month" DATE NOT NULL,
  "effective_to_month" DATE,
  "status" "StatutoryParticipationStatus" NOT NULL,
  "source_type" "StatutoryParticipationSourceType" NOT NULL,
  "source_reference" VARCHAR(500),
  "reason" VARCHAR(500) NOT NULL,
  "source_digest" CHAR(64) NOT NULL,
  "recorded_by_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_by_id" UUID NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3) NOT NULL,
  "supersedes_period_id" UUID,
  "superseded_at" TIMESTAMPTZ(3),
  CONSTRAINT "employee_statutory_participation_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_statutory_participation_periods_period_check"
    CHECK ("effective_to_month" IS NULL OR "effective_to_month" > "effective_from_month"),
  CONSTRAINT "employee_statutory_participation_periods_digest_check"
    CHECK ("source_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "employee_statutory_participation_periods_membership_fkey"
    FOREIGN KEY ("membership_id", "business_id")
    REFERENCES "employee_business_memberships"("id", "business_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_statutory_participation_periods_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_statutory_participation_periods_recorded_by_fkey"
    FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_statutory_participation_periods_confirmed_by_fkey"
    FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_statutory_participation_periods_supersedes_fkey"
    FOREIGN KEY ("supersedes_period_id")
    REFERENCES "employee_statutory_participation_periods"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "employee_statutory_participation_periods_membership_scheme_revision_key"
  ON "employee_statutory_participation_periods"("membership_id", "scheme", "revision");
CREATE UNIQUE INDEX "employee_statutory_participation_periods_supersedes_period_id_key"
  ON "employee_statutory_participation_periods"("supersedes_period_id");
CREATE UNIQUE INDEX "employee_statutory_participation_periods_id_business_membership_key"
  ON "employee_statutory_participation_periods"("id", "business_id", "membership_id");
CREATE INDEX "employee_statutory_participation_periods_scope_period_idx"
  ON "employee_statutory_participation_periods"(
    "business_id", "membership_id", "scheme", "effective_from_month", "effective_to_month"
  );

ALTER TABLE "payroll_entry_statutory_snapshots"
  ADD COLUMN "statutory_participation_period_id" UUID,
  ADD COLUMN "statutory_participation_status_snapshot" "StatutoryParticipationStatus",
  ADD COLUMN "statutory_participation_from_snapshot" DATE,
  ADD COLUMN "statutory_participation_to_snapshot" DATE,
  ADD COLUMN "statutory_participation_revision_snapshot" INTEGER,
  ADD COLUMN "statutory_participation_source_snapshot" VARCHAR(500);

ALTER TABLE "payroll_entry_statutory_snapshots"
  ADD CONSTRAINT "payroll_entry_statutory_snapshots_statutory_participation_fkey"
  FOREIGN KEY ("statutory_participation_period_id", "business_id", "membership_id")
  REFERENCES "employee_statutory_participation_periods"("id", "business_id", "membership_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION tetamu_guard_statutory_participation_period()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT (
      OLD.effective_to_month IS NULL
      AND NEW.effective_to_month IS NOT NULL
      AND NEW.effective_to_month > OLD.effective_from_month
      AND OLD.superseded_at IS NULL
      AND NEW.superseded_at IS NOT NULL
      AND NEW.id = OLD.id
      AND NEW.business_id = OLD.business_id
      AND NEW.membership_id = OLD.membership_id
      AND NEW.scheme = OLD.scheme
      AND NEW.revision = OLD.revision
      AND NEW.effective_from_month = OLD.effective_from_month
      AND NEW.status = OLD.status
      AND NEW.source_type = OLD.source_type
      AND NEW.source_reference IS NOT DISTINCT FROM OLD.source_reference
      AND NEW.reason = OLD.reason
      AND NEW.source_digest = OLD.source_digest
      AND NEW.recorded_by_id = OLD.recorded_by_id
      AND NEW.recorded_at = OLD.recorded_at
      AND NEW.confirmed_by_id = OLD.confirmed_by_id
      AND NEW.confirmed_at = OLD.confirmed_at
      AND NEW.supersedes_period_id IS NOT DISTINCT FROM OLD.supersedes_period_id
    ) THEN
      RAISE EXCEPTION 'STATUTORY_PARTICIPATION_PERIOD_IMMUTABLE';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'STATUTORY_PARTICIPATION_PERIOD_IMMUTABLE';
  END IF;

  IF TG_OP <> 'DELETE' AND EXISTS (
    SELECT 1
    FROM employee_statutory_participation_periods existing
    WHERE existing.business_id = NEW.business_id
      AND existing.membership_id = NEW.membership_id
      AND existing.scheme = NEW.scheme
      AND existing.id <> NEW.id
      AND daterange(existing.effective_from_month, existing.effective_to_month, '[)')
          && daterange(NEW.effective_from_month, NEW.effective_to_month, '[)')
  ) THEN
    RAISE EXCEPTION 'STATUTORY_PARTICIPATION_PERIOD_OVERLAP';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER employee_statutory_participation_periods_guard
BEFORE INSERT OR UPDATE OR DELETE ON "employee_statutory_participation_periods"
FOR EACH ROW EXECUTE FUNCTION tetamu_guard_statutory_participation_period();

COMMIT;
