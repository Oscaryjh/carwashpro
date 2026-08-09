BEGIN;

CREATE TYPE "StatutoryRuleLifecycleAction" AS ENUM (
  'CALCULATION_VERIFIED',
  'ACTIVATED',
  'RETIRED'
);

ALTER TABLE "statutory_rule_sets"
  ADD COLUMN "independent_review_digest" CHAR(64),
  ADD COLUMN "classification_version" VARCHAR(100),
  ADD COLUMN "classification_digest" CHAR(64),
  ADD COLUMN "calculator_version" VARCHAR(40),
  ADD COLUMN "calculator_test_digest" CHAR(64),
  ADD COLUMN "calculation_verified_at" TIMESTAMPTZ(3),
  ADD COLUMN "calculation_verified_by_id" UUID,
  ADD COLUMN "activated_at" TIMESTAMPTZ(3),
  ADD COLUMN "activated_by_id" UUID,
  ADD COLUMN "activation_reason" VARCHAR(500);

ALTER TABLE "payroll_entry_statutory_snapshots"
  ADD COLUMN "fixture_digest_snapshot" CHAR(64),
  ADD COLUMN "classification_version_snapshot" VARCHAR(100),
  ADD COLUMN "calculator_version_snapshot" VARCHAR(40),
  ADD COLUMN "calculation_input_digest" CHAR(64);

CREATE TABLE "statutory_rule_lifecycle_audits" (
  "id" UUID NOT NULL,
  "rule_set_id" UUID NOT NULL,
  "scheme" "StatutoryScheme" NOT NULL,
  "rule_version" VARCHAR(100) NOT NULL,
  "action" "StatutoryRuleLifecycleAction" NOT NULL,
  "actor_id" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "evidence_digest" CHAR(64) NOT NULL,
  "previous_status" "StatutoryRuleSetStatus" NOT NULL,
  "next_status" "StatutoryRuleSetStatus" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "statutory_rule_lifecycle_audits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "statutory_rule_lifecycle_audits_rule_set_id_fkey"
    FOREIGN KEY ("rule_set_id") REFERENCES "statutory_rule_sets"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "statutory_rule_lifecycle_audits_rule_set_id_created_at_idx"
  ON "statutory_rule_lifecycle_audits"("rule_set_id", "created_at");
CREATE INDEX "statutory_rule_lifecycle_audits_scheme_rule_version_created_at_idx"
  ON "statutory_rule_lifecycle_audits"("scheme", "rule_version", "created_at");

CREATE OR REPLACE FUNCTION tetamu_guard_statutory_rule_overlap()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'ACTIVE' AND (
    NEW.readiness <> 'CALCULATION_VERIFIED'
    OR NEW.source_digest IS NULL
    OR NEW.dataset_digest IS NULL
    OR NEW.golden_fixture_digest IS NULL
    OR NEW.independent_review_digest IS NULL
    OR NEW.classification_version IS NULL
    OR NEW.classification_digest IS NULL
    OR NEW.parser_name IS NULL
    OR NEW.parser_version IS NULL
    OR NEW.calculator_version IS NULL
    OR NEW.calculator_test_digest IS NULL
    OR NEW.dataset_row_count IS NULL
    OR NEW.dataset_row_count <= 0
    OR NEW.calculation_verified_at IS NULL
    OR NEW.calculation_verified_by_id IS NULL
    OR NEW.activated_at IS NULL
    OR NEW.activated_by_id IS NULL
    OR NEW.activation_reason IS NULL
    OR length(trim(NEW.activation_reason)) < 10
  ) THEN
    RAISE EXCEPTION 'UNVERIFIED_STATUTORY_RULE_CANNOT_ACTIVATE';
  END IF;

  IF NEW.status = 'ACTIVE' AND EXISTS (
    SELECT 1 FROM statutory_rule_sets existing
    WHERE existing.scheme = NEW.scheme
      AND existing.status = 'ACTIVE'
      AND existing.id <> NEW.id
      AND daterange(existing.effective_from, existing.effective_to, '[)') && daterange(NEW.effective_from, NEW.effective_to, '[)')
  ) THEN
    RAISE EXCEPTION 'STATUTORY_RULE_EFFECTIVE_DATE_OVERLAP';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tetamu_guard_active_statutory_rule_provenance()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'ACTIVE' AND (
    NEW.scheme IS DISTINCT FROM OLD.scheme
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
    OR NEW.effective_to IS DISTINCT FROM OLD.effective_to
    OR NEW.authority IS DISTINCT FROM OLD.authority
    OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
    OR NEW.source_document_name IS DISTINCT FROM OLD.source_document_name
    OR NEW.source_digest IS DISTINCT FROM OLD.source_digest
    OR NEW.dataset_digest IS DISTINCT FROM OLD.dataset_digest
    OR NEW.golden_fixture_digest IS DISTINCT FROM OLD.golden_fixture_digest
    OR NEW.independent_review_digest IS DISTINCT FROM OLD.independent_review_digest
    OR NEW.classification_version IS DISTINCT FROM OLD.classification_version
    OR NEW.classification_digest IS DISTINCT FROM OLD.classification_digest
    OR NEW.parser_name IS DISTINCT FROM OLD.parser_name
    OR NEW.parser_version IS DISTINCT FROM OLD.parser_version
    OR NEW.calculator_version IS DISTINCT FROM OLD.calculator_version
    OR NEW.calculator_test_digest IS DISTINCT FROM OLD.calculator_test_digest
    OR NEW.dataset_row_count IS DISTINCT FROM OLD.dataset_row_count
    OR NEW.calculation_verified_at IS DISTINCT FROM OLD.calculation_verified_at
    OR NEW.calculation_verified_by_id IS DISTINCT FROM OLD.calculation_verified_by_id
    OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
    OR NEW.activated_by_id IS DISTINCT FROM OLD.activated_by_id
    OR NEW.activation_reason IS DISTINCT FROM OLD.activation_reason
    OR NEW.rule_data IS DISTINCT FROM OLD.rule_data
  ) THEN
    RAISE EXCEPTION 'STATUTORY_ACTIVE_ARTIFACT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
