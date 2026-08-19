-- Leave Management Phase 2C adds the governed Sabah statutory rule pack.
-- It is additive, effective-dated and never activates legal rules automatically.

ALTER TYPE "LeaveStatutoryRuleSetStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_HUMAN_SIGN_OFF' BEFORE 'ACTIVE';
ALTER TYPE "LeaveStatutoryCategory" ADD VALUE IF NOT EXISTS 'UNPAID_LEAVE';
ALTER TYPE "LeaveProrationMethod" ADD VALUE IF NOT EXISTS 'COMPLETED_MONTHS';
ALTER TYPE "LeaveEntitlementRounding" ADD VALUE IF NOT EXISTS 'STATUTORY_WHOLE_DAY';

CREATE TYPE "LeaveComplianceStatus" AS ENUM ('COMPLIANT', 'BELOW_MINIMUM', 'REVIEW_REQUIRED', 'NOT_APPLICABLE');

ALTER TABLE "leave_statutory_rule_sets"
  ADD COLUMN "jurisdiction_code" VARCHAR(32),
  ADD COLUMN "source_digest" CHAR(64),
  ADD COLUMN "validation_snapshot" JSONB,
  ADD COLUMN "sign_off_checklist" JSONB,
  ADD COLUMN "ready_for_sign_off_by_id" UUID,
  ADD COLUMN "ready_for_sign_off_at" TIMESTAMP(3);

-- Only exact, explicitly stored Sabah jurisdiction evidence is canonicalised.
-- Legacy rows without a recognised workplace jurisdiction remain unconfigured and
-- can never become ACTIVE until a human reviewer supplies an exact jurisdiction.
-- Phase 2A correctly freezes reviewed evidence during normal operation. This
-- migration pauses that guard only for this deterministic jurisdiction backfill,
-- then restores it before any application traffic can observe the schema.
ALTER TABLE "leave_statutory_rule_sets" DISABLE TRIGGER "leave_statutory_rule_sets_evidence_guard";
UPDATE "leave_statutory_rule_sets"
SET "jurisdiction_code" = 'MY-SABAH'
WHERE UPPER("jurisdiction_country_code") = 'MY'
  AND UPPER(COALESCE("jurisdiction_state_code", '')) IN ('SABAH', 'SBH', '12');
ALTER TABLE "leave_statutory_rule_sets" ENABLE TRIGGER "leave_statutory_rule_sets_evidence_guard";

ALTER TABLE "leave_statutory_rules"
  ADD COLUMN "statutory_section" VARCHAR(160),
  ADD COLUMN "requires_document" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "carry_forward_allowed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "event_rules" JSONB,
  ADD COLUMN "review_markers" JSONB;
ALTER TABLE "leave_statutory_rules" DISABLE TRIGGER "leave_statutory_rules_evidence_guard";
UPDATE "leave_statutory_rules" SET "statutory_section" = 'Legacy reviewed source - section confirmation required' WHERE "statutory_section" IS NULL;
ALTER TABLE "leave_statutory_rules" ENABLE TRIGGER "leave_statutory_rules_evidence_guard";
ALTER TABLE "leave_statutory_rules" ALTER COLUMN "statutory_section" SET NOT NULL;

CREATE TABLE "leave_statutory_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "business_id" UUID NOT NULL, "rule_set_id" UUID NOT NULL,
  "source_title" VARCHAR(240) NOT NULL, "source_url" VARCHAR(800) NOT NULL, "source_section" VARCHAR(160) NOT NULL,
  "retrieved_at" TIMESTAMP(3) NOT NULL, "content_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_statutory_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_statutory_sources_rule_set_scope_fkey" FOREIGN KEY ("rule_set_id", "business_id") REFERENCES "leave_statutory_rule_sets"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_statutory_sources_hash_check" CHECK ("content_hash" ~ '^[A-F0-9]{64}$')
);
CREATE UNIQUE INDEX "leave_statutory_sources_identity_key" ON "leave_statutory_sources"("rule_set_id", "source_url", "source_section");
CREATE INDEX "leave_statutory_sources_scope_idx" ON "leave_statutory_sources"("business_id", "rule_set_id");

ALTER TABLE "leave_requests"
  ADD COLUMN "jurisdiction_code_snapshot" VARCHAR(32),
  ADD COLUMN "statutory_rule_set_version_snapshot" VARCHAR(40),
  ADD COLUMN "statutory_category_snapshot" "LeaveStatutoryCategory",
  ADD COLUMN "statutory_eligibility_snapshot" JSONB,
  ADD COLUMN "statutory_duration_snapshot" JSONB,
  ADD COLUMN "statutory_pay_treatment_snapshot" JSONB,
  ADD COLUMN "compliance_status_snapshot" "LeaveComplianceStatus";

ALTER TABLE "leave_statutory_rule_sets"
  ADD CONSTRAINT "leave_statutory_rule_sets_ready_signoff_actor_fkey" FOREIGN KEY ("ready_for_sign_off_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "leave_statutory_rule_sets_effective_period_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  ADD CONSTRAINT "leave_statutory_rule_sets_digest_check" CHECK ("source_digest" IS NULL OR "source_digest" ~ '^[A-F0-9]{64}$');
ALTER TABLE "leave_statutory_rules" ADD CONSTRAINT "leave_statutory_rules_semantics_check" CHECK (
  ("entitlement_semantics" <> 'EVENT_BASED' OR "carry_forward_allowed" = false) AND
  ("entitlement_semantics" <> 'NON_ACCRUAL' OR "carry_forward_allowed" = false)
);

CREATE OR REPLACE FUNCTION leave_phase2c_rule_set_transition_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NOT ((OLD.status = 'DRAFT' AND NEW.status = 'READY_FOR_REVIEW') OR
          (OLD.status = 'READY_FOR_REVIEW' AND NEW.status = 'READY_FOR_HUMAN_SIGN_OFF') OR
          (OLD.status = 'READY_FOR_HUMAN_SIGN_OFF' AND NEW.status = 'ACTIVE') OR
          (OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED')) THEN
    RAISE EXCEPTION 'Invalid Leave statutory rule-pack status transition: % to %', OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'READY_FOR_HUMAN_SIGN_OFF' AND (NEW.ready_for_sign_off_by_id IS NULL OR NEW.ready_for_sign_off_at IS NULL OR NEW.validation_snapshot IS NULL OR NEW.sign_off_checklist IS NULL OR NEW.source_digest IS NULL) THEN
    RAISE EXCEPTION 'Human sign-off candidate requires reviewer, validation, checklist and source digest evidence';
  END IF;
  IF NEW.status = 'ACTIVE' AND (NEW.activated_by_id IS NULL OR NEW.activated_at IS NULL OR NEW.jurisdiction_code IS NULL) THEN RAISE EXCEPTION 'Activation requires exact jurisdiction, explicit human actor and timestamp'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "leave_phase2c_rule_set_transition_guard" BEFORE UPDATE OF "status" ON "leave_statutory_rule_sets" FOR EACH ROW EXECUTE FUNCTION leave_phase2c_rule_set_transition_guard();

CREATE OR REPLACE FUNCTION leave_phase2c_source_immutable_guard() RETURNS trigger AS $$
DECLARE pack_status "LeaveStatutoryRuleSetStatus";
BEGIN
  SELECT status INTO pack_status FROM "leave_statutory_rule_sets" WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.rule_set_id ELSE NEW.rule_set_id END;
  IF pack_status <> 'DRAFT' THEN RAISE EXCEPTION 'Reviewed Leave statutory source evidence is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "leave_phase2c_sources_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "leave_statutory_sources" FOR EACH ROW EXECUTE FUNCTION leave_phase2c_source_immutable_guard();

CREATE OR REPLACE FUNCTION leave_phase2c_request_snapshot_immutable_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.jurisdiction_code_snapshot IS DISTINCT FROM NEW.jurisdiction_code_snapshot OR
     OLD.statutory_rule_set_version_snapshot IS DISTINCT FROM NEW.statutory_rule_set_version_snapshot OR
     OLD.statutory_category_snapshot IS DISTINCT FROM NEW.statutory_category_snapshot OR
     OLD.statutory_eligibility_snapshot IS DISTINCT FROM NEW.statutory_eligibility_snapshot OR
     OLD.statutory_duration_snapshot IS DISTINCT FROM NEW.statutory_duration_snapshot OR
     OLD.statutory_pay_treatment_snapshot IS DISTINCT FROM NEW.statutory_pay_treatment_snapshot OR
     OLD.compliance_status_snapshot IS DISTINCT FROM NEW.compliance_status_snapshot THEN
    RAISE EXCEPTION 'Leave request statutory decision snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "leave_phase2c_request_snapshot_immutable"
BEFORE UPDATE OF "jurisdiction_code_snapshot", "statutory_rule_set_version_snapshot", "statutory_category_snapshot", "statutory_eligibility_snapshot", "statutory_duration_snapshot", "statutory_pay_treatment_snapshot", "compliance_status_snapshot"
ON "leave_requests" FOR EACH ROW EXECUTE FUNCTION leave_phase2c_request_snapshot_immutable_guard();

CREATE OR REPLACE FUNCTION leave_phase2c_active_overlap_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'ACTIVE' AND EXISTS (
    SELECT 1 FROM "leave_statutory_rule_sets" existing WHERE existing.business_id = NEW.business_id
      AND existing.jurisdiction_code = NEW.jurisdiction_code AND existing.status = 'ACTIVE' AND existing.id <> NEW.id
      AND daterange(existing.effective_from, COALESCE(existing.effective_to + 1, 'infinity'::date), '[)') && daterange(NEW.effective_from, COALESCE(NEW.effective_to + 1, 'infinity'::date), '[)')
  ) THEN RAISE EXCEPTION 'Overlapping active Leave statutory rule packs are not allowed'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "leave_phase2c_active_overlap_guard" BEFORE INSERT OR UPDATE OF "status", "effective_from", "effective_to" ON "leave_statutory_rule_sets" FOR EACH ROW EXECUTE FUNCTION leave_phase2c_active_overlap_guard();

CREATE OR REPLACE FUNCTION leave_phase2c_rule_tier_semantics_guard() RETURNS trigger AS $$
DECLARE semantics "LeaveEntitlementSemantics";
BEGIN
  SELECT entitlement_semantics INTO semantics FROM "leave_statutory_rules" WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.rule_id ELSE NEW.rule_id END;
  IF semantics IN ('EVENT_BASED', 'NON_ACCRUAL') THEN RAISE EXCEPTION 'Event-based and non-accrual statutory rules cannot create balance tiers'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "leave_phase2c_rule_tier_semantics_guard" BEFORE INSERT OR UPDATE ON "leave_statutory_entitlement_tiers" FOR EACH ROW EXECUTE FUNCTION leave_phase2c_rule_tier_semantics_guard();
