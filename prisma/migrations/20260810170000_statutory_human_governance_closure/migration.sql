ALTER TYPE "StatutoryRuleLifecycleAction" ADD VALUE IF NOT EXISTS 'RULESET_REGISTERED';
ALTER TYPE "StatutoryRuleLifecycleAction" ADD VALUE IF NOT EXISTS 'HUMAN_REVIEW_STARTED';
ALTER TYPE "StatutoryRuleLifecycleAction" ADD VALUE IF NOT EXISTS 'COMPONENT_CLASSIFICATION_REVIEWED';
ALTER TYPE "StatutoryRuleLifecycleAction" ADD VALUE IF NOT EXISTS 'COMPONENT_CLASSIFICATION_KEPT_UNKNOWN';
ALTER TYPE "StatutoryRuleLifecycleAction" ADD VALUE IF NOT EXISTS 'HUMAN_REVIEW_COMPLETED';
ALTER TYPE "StatutoryRuleLifecycleAction" ADD VALUE IF NOT EXISTS 'STEP_UP_REQUIRED';
ALTER TYPE "StatutoryRuleLifecycleAction" ADD VALUE IF NOT EXISTS 'STEP_UP_VERIFIED';

CREATE TYPE "StatutoryHumanReviewStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');
CREATE TYPE "StatutoryComponentReviewDecisionValue" AS ENUM ('INCLUDED', 'EXCLUDED', 'KEEP_UNKNOWN');
CREATE TYPE "StatutoryReviewBlockingScope" AS ENUM ('GLOBAL_ACTIVATION_BLOCKER', 'CONDITIONAL_RUNTIME_BLOCKER');

ALTER TABLE "statutory_rule_sets"
  ADD COLUMN "human_review_status" "StatutoryHumanReviewStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "human_review_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "human_classification_digest" CHAR(64),
  ADD COLUMN "human_review_started_at" TIMESTAMPTZ(3),
  ADD COLUMN "human_review_started_by_id" UUID,
  ADD COLUMN "human_review_completed_at" TIMESTAMPTZ(3),
  ADD COLUMN "human_review_completed_by_id" UUID,
  ADD CONSTRAINT "statutory_rule_sets_human_review_revision_check" CHECK ("human_review_revision" >= 0),
  ADD CONSTRAINT "statutory_rule_sets_human_classification_digest_check"
    CHECK ("human_classification_digest" IS NULL OR "human_classification_digest" ~ '^[a-f0-9]{64}$');

ALTER TABLE "statutory_rule_set_sign_offs"
  ADD COLUMN "review_checklist_answers" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "classification_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "human_classification_digest" CHAR(64) NOT NULL DEFAULT repeat('0', 64),
  ADD COLUMN "step_up_reference" VARCHAR(160) NOT NULL DEFAULT 'LEGACY_PRE_GOVERNANCE_RECORD',
  ADD CONSTRAINT "statutory_rule_set_sign_offs_human_digest_check"
    CHECK ("human_classification_digest" ~ '^[a-f0-9]{64}$');

ALTER TABLE "statutory_rule_set_sign_offs"
  ALTER COLUMN "review_checklist_answers" DROP DEFAULT,
  ALTER COLUMN "classification_revision" DROP DEFAULT,
  ALTER COLUMN "human_classification_digest" DROP DEFAULT,
  ALTER COLUMN "step_up_reference" DROP DEFAULT;

CREATE TABLE "statutory_component_review_decisions" (
  "id" UUID NOT NULL,
  "rule_set_id" UUID NOT NULL,
  "classification_id" UUID NOT NULL,
  "scheme" "StatutoryScheme" NOT NULL,
  "component_code" VARCHAR(64) NOT NULL,
  "classification_revision" VARCHAR(100) NOT NULL,
  "previous_classification" "StatutoryComponentTreatment" NOT NULL,
  "decision" "StatutoryComponentReviewDecisionValue" NOT NULL,
  "blocking_scope" "StatutoryReviewBlockingScope" NOT NULL,
  "evidence_reference" VARCHAR(1000) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "reviewer_user_id" UUID NOT NULL,
  "reviewed_at" TIMESTAMPTZ(3) NOT NULL,
  "decision_revision" INTEGER NOT NULL,
  "evidence_digest" CHAR(64) NOT NULL,
  "decision_digest" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "statutory_component_review_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "statutory_component_review_decisions_rule_set_id_fkey"
    FOREIGN KEY ("rule_set_id") REFERENCES "statutory_rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "statutory_component_review_decisions_classification_id_fkey"
    FOREIGN KEY ("classification_id") REFERENCES "statutory_component_classifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "statutory_component_review_decisions_reviewer_user_id_fkey"
    FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "statutory_component_review_decisions_reason_check" CHECK (length(trim("reason")) >= 10),
  CONSTRAINT "statutory_component_review_decisions_evidence_check" CHECK (length(trim("evidence_reference")) >= 3),
  CONSTRAINT "statutory_component_review_decisions_revision_check" CHECK ("decision_revision" > 0),
  CONSTRAINT "statutory_component_review_decisions_evidence_digest_check" CHECK ("evidence_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "statutory_component_review_decisions_decision_digest_check" CHECK ("decision_digest" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "statutory_component_review_decisions_classification_revision_key"
  ON "statutory_component_review_decisions"("classification_id", "decision_revision");
CREATE INDEX "statutory_component_review_decisions_ruleset_scheme_component_idx"
  ON "statutory_component_review_decisions"("rule_set_id", "scheme", "component_code", "created_at");
CREATE INDEX "statutory_component_review_decisions_reviewer_reviewed_idx"
  ON "statutory_component_review_decisions"("reviewer_user_id", "reviewed_at");

CREATE OR REPLACE FUNCTION tetamu_guard_statutory_review_decision_immutable()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM statutory_rule_sets rule
    WHERE rule.id = OLD.rule_set_id
      AND rule.authority = 'TEST_ONLY'
      AND rule.version LIKE 'TEST\_%' ESCAPE '\'
      AND rule.status = 'RETIRED'
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'STATUTORY_COMPONENT_REVIEW_DECISION_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "statutory_component_review_decisions_immutable_update"
BEFORE UPDATE ON "statutory_component_review_decisions"
FOR EACH ROW EXECUTE FUNCTION tetamu_guard_statutory_review_decision_immutable();
CREATE TRIGGER "statutory_component_review_decisions_immutable_delete"
BEFORE DELETE ON "statutory_component_review_decisions"
FOR EACH ROW EXECUTE FUNCTION tetamu_guard_statutory_review_decision_immutable();

CREATE OR REPLACE FUNCTION tetamu_guard_registered_statutory_classification_immutable()
RETURNS trigger AS $$
DECLARE
  parent statutory_rule_sets%ROWTYPE;
BEGIN
  SELECT * INTO parent FROM statutory_rule_sets WHERE id = OLD.rule_set_id;
  IF TG_OP = 'DELETE'
     AND parent.authority = 'TEST_ONLY'
     AND parent.version LIKE 'TEST\_%' ESCAPE '\'
     AND parent.status = 'RETIRED' THEN
    RETURN OLD;
  END IF;
  IF parent.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'STATUTORY_REGISTERED_CLASSIFICATION_IMMUTABLE';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "statutory_component_classifications_registered_immutable_update"
BEFORE UPDATE ON "statutory_component_classifications"
FOR EACH ROW EXECUTE FUNCTION tetamu_guard_registered_statutory_classification_immutable();
CREATE TRIGGER "statutory_component_classifications_registered_immutable_delete"
BEFORE DELETE ON "statutory_component_classifications"
FOR EACH ROW EXECUTE FUNCTION tetamu_guard_registered_statutory_classification_immutable();

CREATE OR REPLACE FUNCTION tetamu_guard_signed_statutory_rule_immutable()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('HUMAN_SIGNED_OFF', 'ACTIVE') AND (
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
    OR NEW.verification_evidence IS DISTINCT FROM OLD.verification_evidence
    OR NEW.rule_data IS DISTINCT FROM OLD.rule_data
    OR NEW.human_review_status IS DISTINCT FROM OLD.human_review_status
    OR NEW.human_review_revision IS DISTINCT FROM OLD.human_review_revision
    OR NEW.human_classification_digest IS DISTINCT FROM OLD.human_classification_digest
  ) THEN
    RAISE EXCEPTION 'STATUTORY_SIGNED_ARTIFACT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
