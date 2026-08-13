ALTER TYPE "StatutoryRuleSetStatus" ADD VALUE IF NOT EXISTS 'ENGINEERING_VERIFIED';
ALTER TYPE "StatutoryRuleSetStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_HUMAN_SIGN_OFF';
ALTER TYPE "StatutoryRuleSetStatus" ADD VALUE IF NOT EXISTS 'HUMAN_SIGNED_OFF';

ALTER TYPE "StatutoryRuleLifecycleAction" ADD VALUE IF NOT EXISTS 'READY_FOR_REVIEW';
ALTER TYPE "StatutoryRuleLifecycleAction" ADD VALUE IF NOT EXISTS 'SIGNED_OFF';
ALTER TYPE "StatutoryRuleLifecycleAction" ADD VALUE IF NOT EXISTS 'SIGNOFF_STALE';
ALTER TYPE "StatutoryRuleLifecycleAction" ADD VALUE IF NOT EXISTS 'SIGNOFF_REVOKED';

CREATE TYPE "StatutoryRuleSetSignOffDecision" AS ENUM (
  'APPROVED',
  'REJECTED',
  'REVOKED'
);

ALTER TABLE "statutory_rule_sets"
  ADD COLUMN "verification_evidence" JSONB;

CREATE TABLE "statutory_rule_set_sign_offs" (
  "id" UUID NOT NULL,
  "rule_set_id" UUID NOT NULL,
  "scheme" "StatutoryScheme" NOT NULL,
  "decision" "StatutoryRuleSetSignOffDecision" NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "actor_role" VARCHAR(40) NOT NULL,
  "actor_capabilities" TEXT[] NOT NULL,
  "signed_at" TIMESTAMPTZ(3) NOT NULL,
  "evidence_digest" CHAR(64) NOT NULL,
  "review_checklist_version" VARCHAR(80) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "statutory_rule_set_sign_offs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "statutory_rule_set_sign_offs_rule_set_id_fkey"
    FOREIGN KEY ("rule_set_id") REFERENCES "statutory_rule_sets"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "statutory_rule_set_sign_offs_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "statutory_rule_set_sign_offs_reason_check"
    CHECK (length(trim("reason")) >= 10),
  CONSTRAINT "statutory_rule_set_sign_offs_digest_check"
    CHECK ("evidence_digest" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "statutory_rule_set_sign_offs_rule_set_id_created_at_idx"
  ON "statutory_rule_set_sign_offs"("rule_set_id", "created_at");
CREATE INDEX "statutory_rule_set_sign_offs_scheme_decision_signed_at_idx"
  ON "statutory_rule_set_sign_offs"("scheme", "decision", "signed_at");
CREATE INDEX "statutory_rule_set_sign_offs_actor_user_id_created_at_idx"
  ON "statutory_rule_set_sign_offs"("actor_user_id", "created_at");

CREATE OR REPLACE FUNCTION tetamu_guard_statutory_sign_off_immutable()
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
  RAISE EXCEPTION 'STATUTORY_SIGN_OFF_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "statutory_rule_set_sign_offs_immutable_update"
BEFORE UPDATE ON "statutory_rule_set_sign_offs"
FOR EACH ROW EXECUTE FUNCTION tetamu_guard_statutory_sign_off_immutable();

CREATE TRIGGER "statutory_rule_set_sign_offs_immutable_delete"
BEFORE DELETE ON "statutory_rule_set_sign_offs"
FOR EACH ROW EXECUTE FUNCTION tetamu_guard_statutory_sign_off_immutable();

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
  ) THEN
    RAISE EXCEPTION 'STATUTORY_SIGNED_ARTIFACT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "statutory_rule_sets_signed_artifact_immutable"
BEFORE UPDATE ON "statutory_rule_sets"
FOR EACH ROW EXECUTE FUNCTION tetamu_guard_signed_statutory_rule_immutable();
