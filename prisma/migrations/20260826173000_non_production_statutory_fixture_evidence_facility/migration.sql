BEGIN;

CREATE TYPE "StatutoryEvidenceNature" AS ENUM ('REAL', 'SYNTHETIC_TESTING');
CREATE TYPE "StatutoryEvidenceEnvironment" AS ENUM ('LOCAL', 'TESTING');
CREATE TYPE "StatutoryFixturePurpose" AS ENUM ('PAYROLL_PAYSLIP_UAT');

ALTER TABLE "employee_lindung24_participation_versions"
  ALTER COLUMN "source_type" DROP NOT NULL,
  ALTER COLUMN "source_reference" DROP NOT NULL,
  ADD COLUMN "evidence_nature" "StatutoryEvidenceNature" NOT NULL DEFAULT 'REAL',
  ADD COLUMN "evidence_environment" "StatutoryEvidenceEnvironment",
  ADD COLUMN "fixture_purpose" "StatutoryFixturePurpose",
  ADD COLUMN "official_export_eligible" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "statutory_nationality_snapshot" "EmployeeStatutoryNationality";

-- Existing rows are provably REAL: the preceding schema required both an
-- official source type and a non-empty source reference for every revision.
-- We deliberately do not infer a historical nationality from today's profile.
ALTER TABLE "employee_lindung24_participation_versions"
  ADD CONSTRAINT "employee_lindung24_participation_versions_evidence_contract"
  CHECK (
    (
      "evidence_nature" = 'REAL'
      AND "evidence_environment" IS NULL
      AND "fixture_purpose" IS NULL
      AND "official_export_eligible" = TRUE
      AND "source_type" IS NOT NULL
      AND "source_reference" IS NOT NULL
      AND length(btrim("source_reference")) >= 5
    )
    OR
    (
      "evidence_nature" = 'SYNTHETIC_TESTING'
      AND "evidence_environment" IS NOT NULL
      AND "fixture_purpose" IS NOT NULL
      AND "official_export_eligible" = FALSE
      AND "statutory_nationality_snapshot" IS NOT NULL
      AND "source_type" IS NULL
      AND "source_reference" IS NULL
      AND "official_submitted_at" IS NULL
    )
  );

CREATE INDEX "employee_lindung24_participation_versions_evidence_idx"
  ON "employee_lindung24_participation_versions"
  ("business_id", "evidence_nature", "official_export_eligible");

ALTER TABLE "payroll_entry_statutory_snapshots"
  ADD COLUMN "evidence_nature" "StatutoryEvidenceNature" NOT NULL DEFAULT 'REAL',
  ADD COLUMN "evidence_environment" "StatutoryEvidenceEnvironment",
  ADD COLUMN "fixture_purpose" "StatutoryFixturePurpose",
  ADD COLUMN "official_export_eligible" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "statutory_nationality_snapshot" "EmployeeStatutoryNationality";

ALTER TABLE "payroll_entry_statutory_snapshots"
  ADD CONSTRAINT "payroll_entry_statutory_snapshots_evidence_contract"
  CHECK (
    (
      "evidence_nature" = 'REAL'
      AND "evidence_environment" IS NULL
      AND "fixture_purpose" IS NULL
      AND "official_export_eligible" = TRUE
    )
    OR
    (
      "evidence_nature" = 'SYNTHETIC_TESTING'
      AND "evidence_environment" IS NOT NULL
      AND "fixture_purpose" IS NOT NULL
      AND "official_export_eligible" = FALSE
      AND "statutory_nationality_snapshot" IS NOT NULL
    )
  );

CREATE INDEX "payroll_entry_statutory_snapshots_export_eligibility_idx"
  ON "payroll_entry_statutory_snapshots"
  ("business_id", "payroll_run_id", "official_export_eligible");

-- Preserve the original append-only semantics while including every new
-- provenance column in the immutable payload comparison.
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
      AND NEW.source_type IS NOT DISTINCT FROM OLD.source_type
      AND NEW.source_reference IS NOT DISTINCT FROM OLD.source_reference
      AND NEW.evidence_nature = OLD.evidence_nature
      AND NEW.evidence_environment IS NOT DISTINCT FROM OLD.evidence_environment
      AND NEW.fixture_purpose IS NOT DISTINCT FROM OLD.fixture_purpose
      AND NEW.official_export_eligible = OLD.official_export_eligible
      AND NEW.statutory_nationality_snapshot IS NOT DISTINCT FROM OLD.statutory_nationality_snapshot
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

COMMIT;
