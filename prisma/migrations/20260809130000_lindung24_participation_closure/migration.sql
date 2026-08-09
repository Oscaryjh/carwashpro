BEGIN;

CREATE TYPE "Lindung24ParticipationStatus" AS ENUM (
  'MANDATORY',
  'DEFAULT_PARTICIPATING',
  'VOLUNTARY_OPT_IN',
  'VOLUNTARY_OPT_OUT'
);

CREATE TYPE "Lindung24EmployerContext" AS ENUM (
  'SINGLE_EMPLOYER',
  'MULTIPLE_EMPLOYER'
);

CREATE TYPE "Lindung24SelectedEmployer" AS ENUM (
  'CURRENT_BUSINESS',
  'OTHER_EMPLOYER',
  'PERKESO_SELECTION_PENDING'
);

CREATE TYPE "Lindung24ParticipationSourceType" AS ENUM (
  'OFFICIAL_TRANSITION',
  'EMPLOYEE_OPT_IN',
  'EMPLOYEE_OPT_OUT',
  'PERKESO_EMPLOYER_SELECTION',
  'EMPLOYMENT_CHANGE',
  'LEGACY_REVIEW'
);

CREATE TYPE "Lindung24RefundReason" AS ENUM (
  'TRANSITION_OPT_OUT',
  'NON_SELECTED_EMPLOYER',
  'OFFICIAL_CORRECTION'
);

CREATE TYPE "Lindung24RefundStatus" AS ENUM (
  'REVIEW_REQUIRED',
  'SUBMITTED_TO_PERKESO',
  'REFUNDED',
  'REJECTED'
);

CREATE TABLE "employee_lindung24_participation_versions" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "effective_from_month" DATE NOT NULL,
  "effective_to_month" DATE,
  "status" "Lindung24ParticipationStatus" NOT NULL,
  "employer_context" "Lindung24EmployerContext" NOT NULL,
  "selected_employer" "Lindung24SelectedEmployer" NOT NULL,
  "act_4_covered" BOOLEAN NOT NULL,
  "official_submitted_at" TIMESTAMPTZ(3),
  "source_type" "Lindung24ParticipationSourceType" NOT NULL,
  "source_reference" VARCHAR(500) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "source_digest" CHAR(64) NOT NULL,
  "recorded_by_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersedes_version_id" UUID,
  "superseded_at" TIMESTAMPTZ(3),
  CONSTRAINT "employee_lindung24_participation_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_lindung24_participation_versions_period_check"
    CHECK ("effective_to_month" IS NULL OR "effective_to_month" > "effective_from_month"),
  CONSTRAINT "employee_lindung24_participation_versions_digest_check"
    CHECK ("source_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "employee_lindung24_participation_versions_membership_fkey"
    FOREIGN KEY ("membership_id", "business_id")
    REFERENCES "employee_business_memberships"("id", "business_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_lindung24_participation_versions_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_lindung24_participation_versions_recorded_by_fkey"
    FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_lindung24_participation_versions_supersedes_fkey"
    FOREIGN KEY ("supersedes_version_id")
    REFERENCES "employee_lindung24_participation_versions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "employee_lindung24_participation_versions_membership_revision_key"
  ON "employee_lindung24_participation_versions"("membership_id", "revision");
CREATE UNIQUE INDEX "employee_lindung24_participation_versions_supersedes_version_id_key"
  ON "employee_lindung24_participation_versions"("supersedes_version_id");
CREATE UNIQUE INDEX "employee_lindung24_participation_versions_id_business_membership_key"
  ON "employee_lindung24_participation_versions"("id", "business_id", "membership_id");
CREATE INDEX "employee_lindung24_participation_versions_scope_period_idx"
  ON "employee_lindung24_participation_versions"("business_id", "membership_id", "effective_from_month", "effective_to_month");

CREATE TABLE "employee_lindung24_refund_events" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "case_key" VARCHAR(160) NOT NULL,
  "revision" INTEGER NOT NULL,
  "contribution_month" DATE NOT NULL,
  "reason" "Lindung24RefundReason" NOT NULL,
  "status" "Lindung24RefundStatus" NOT NULL,
  "employee_amount" DECIMAL(12,2) NOT NULL,
  "payroll_entry_id" UUID,
  "official_reference" VARCHAR(500),
  "source_digest" CHAR(64) NOT NULL,
  "recorded_by_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_lindung24_refund_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_lindung24_refund_events_amount_check" CHECK ("employee_amount" >= 0),
  CONSTRAINT "employee_lindung24_refund_events_digest_check" CHECK ("source_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "employee_lindung24_refund_events_membership_fkey"
    FOREIGN KEY ("membership_id", "business_id")
    REFERENCES "employee_business_memberships"("id", "business_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_lindung24_refund_events_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_lindung24_refund_events_recorded_by_fkey"
    FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "employee_lindung24_refund_events_case_revision_key"
  ON "employee_lindung24_refund_events"("case_key", "revision");
CREATE INDEX "employee_lindung24_refund_events_scope_month_idx"
  ON "employee_lindung24_refund_events"("business_id", "membership_id", "contribution_month");

ALTER TABLE "payroll_entry_statutory_snapshots"
  ADD COLUMN "lindung24_participation_version_id" UUID,
  ADD COLUMN "lindung24_participation_revision_snapshot" INTEGER,
  ADD COLUMN "lindung24_employer_selection_snapshot" "Lindung24SelectedEmployer";

ALTER TABLE "payroll_entry_statutory_snapshots"
  ADD CONSTRAINT "payroll_entry_statutory_snapshots_lindung24_participation_fkey"
  FOREIGN KEY ("lindung24_participation_version_id", "business_id", "membership_id")
  REFERENCES "employee_lindung24_participation_versions"("id", "business_id", "membership_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION tetamu_guard_lindung24_participation()
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
      AND NEW.revision = OLD.revision
      AND NEW.effective_from_month = OLD.effective_from_month
      AND NEW.status = OLD.status
      AND NEW.employer_context = OLD.employer_context
      AND NEW.selected_employer = OLD.selected_employer
      AND NEW.act_4_covered = OLD.act_4_covered
      AND NEW.official_submitted_at IS NOT DISTINCT FROM OLD.official_submitted_at
      AND NEW.source_type = OLD.source_type
      AND NEW.source_reference = OLD.source_reference
      AND NEW.reason = OLD.reason
      AND NEW.source_digest = OLD.source_digest
      AND NEW.recorded_by_id = OLD.recorded_by_id
      AND NEW.recorded_at = OLD.recorded_at
      AND NEW.supersedes_version_id IS NOT DISTINCT FROM OLD.supersedes_version_id
    ) THEN
      RAISE EXCEPTION 'LINDUNG24_PARTICIPATION_VERSION_IMMUTABLE';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LINDUNG24_PARTICIPATION_VERSION_IMMUTABLE';
  END IF;

  IF TG_OP <> 'DELETE' AND EXISTS (
    SELECT 1
    FROM employee_lindung24_participation_versions existing
    WHERE existing.membership_id = NEW.membership_id
      AND existing.id <> NEW.id
      AND daterange(existing.effective_from_month, existing.effective_to_month, '[)')
          && daterange(NEW.effective_from_month, NEW.effective_to_month, '[)')
  ) THEN
    RAISE EXCEPTION 'LINDUNG24_PARTICIPATION_PERIOD_OVERLAP';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER employee_lindung24_participation_versions_guard
BEFORE INSERT OR UPDATE OR DELETE ON "employee_lindung24_participation_versions"
FOR EACH ROW EXECUTE FUNCTION tetamu_guard_lindung24_participation();

CREATE OR REPLACE FUNCTION tetamu_reject_lindung24_refund_event_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LINDUNG24_REFUND_EVENT_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER employee_lindung24_refund_events_immutable
BEFORE UPDATE OR DELETE ON "employee_lindung24_refund_events"
FOR EACH ROW EXECUTE FUNCTION tetamu_reject_lindung24_refund_event_change();

COMMIT;
