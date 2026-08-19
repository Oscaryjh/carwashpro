-- Leave Management Phase 2A adds a human-reviewed statutory rule layer and
-- immutable entitlement calculation evidence. It does not seed or assert any
-- statutory entitlement amount.

CREATE TYPE "LeaveStatutoryRuleSetStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'ACTIVE', 'SUPERSEDED');
CREATE TYPE "LeaveStatutoryCategory" AS ENUM ('ANNUAL_LEAVE', 'SICK_LEAVE', 'HOSPITALISATION_LEAVE', 'MATERNITY_LEAVE', 'PATERNITY_LEAVE');
CREATE TYPE "LeaveEntitlementPeriodType" AS ENUM ('CALENDAR_YEAR', 'SERVICE_ANNIVERSARY', 'CUSTOM_YEAR');
CREATE TYPE "LeaveEntitlementSemantics" AS ENUM ('PERIOD_BALANCE', 'EVENT_BASED', 'NON_ACCRUAL');
CREATE TYPE "LeaveProrationMethod" AS ENUM ('NONE', 'CALENDAR_DAY_RATIO');
CREATE TYPE "LeaveEntitlementRounding" AS ENUM ('NONE', 'DOWN_TO_HALF_DAY', 'NEAREST_HALF_DAY', 'UP_TO_HALF_DAY');

ALTER TABLE "leave_policies"
  ADD COLUMN "statutory_category" "LeaveStatutoryCategory",
  ADD COLUMN "entitlement_period_type" "LeaveEntitlementPeriodType" NOT NULL DEFAULT 'CALENDAR_YEAR',
  ADD COLUMN "custom_year_start_month" INTEGER,
  ADD COLUMN "custom_year_start_day" INTEGER,
  ADD COLUMN "proration_method" "LeaveProrationMethod" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "entitlement_rounding" "LeaveEntitlementRounding" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "eligible_employment_types" "EmployeeEmploymentType"[] NOT NULL DEFAULT ARRAY[]::"EmployeeEmploymentType"[];

ALTER TABLE "leave_policy_versions"
  ADD COLUMN "statutory_category" "LeaveStatutoryCategory",
  ADD COLUMN "entitlement_period_type" "LeaveEntitlementPeriodType" NOT NULL DEFAULT 'CALENDAR_YEAR',
  ADD COLUMN "custom_year_start_month" INTEGER,
  ADD COLUMN "custom_year_start_day" INTEGER,
  ADD COLUMN "proration_method" "LeaveProrationMethod" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "entitlement_rounding" "LeaveEntitlementRounding" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "eligible_employment_types" "EmployeeEmploymentType"[] NOT NULL DEFAULT ARRAY[]::"EmployeeEmploymentType"[],
  ADD COLUMN "statutory_rule_set_id" UUID,
  ADD COLUMN "statutory_rule_id" UUID;

ALTER TABLE "employee_leave_entitlements"
  ADD COLUMN "raw_entitled_units" DECIMAL(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN "proration_factor" DECIMAL(10,6) NOT NULL DEFAULT 1,
  ADD COLUMN "eligibility_snapshot" JSONB,
  ADD COLUMN "calculation_snapshot" JSONB,
  ADD COLUMN "statutory_rule_set_id" UUID,
  ADD COLUMN "statutory_rule_id" UUID;

CREATE TABLE "leave_statutory_rule_sets" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "jurisdiction_country_code" CHAR(2) NOT NULL,
  "jurisdiction_state_code" VARCHAR(16),
  "version" VARCHAR(40) NOT NULL,
  "status" "LeaveStatutoryRuleSetStatus" NOT NULL DEFAULT 'DRAFT',
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "source_title" VARCHAR(200) NOT NULL,
  "source_reference" VARCHAR(500) NOT NULL,
  "review_note" VARCHAR(500),
  "reviewed_by_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "activated_by_id" UUID,
  "activated_at" TIMESTAMP(3),
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leave_statutory_rule_sets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "leave_statutory_rules" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "rule_set_id" UUID NOT NULL,
  "category" "LeaveStatutoryCategory" NOT NULL,
  "entitlement_semantics" "LeaveEntitlementSemantics" NOT NULL DEFAULT 'PERIOD_BALANCE',
  "entitlement_period_type" "LeaveEntitlementPeriodType" NOT NULL DEFAULT 'CALENDAR_YEAR',
  "custom_year_start_month" INTEGER,
  "custom_year_start_day" INTEGER,
  "proration_method" "LeaveProrationMethod" NOT NULL DEFAULT 'NONE',
  "entitlement_rounding" "LeaveEntitlementRounding" NOT NULL DEFAULT 'NONE',
  "eligible_employment_types" "EmployeeEmploymentType"[] NOT NULL DEFAULT ARRAY[]::"EmployeeEmploymentType"[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_statutory_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "leave_statutory_entitlement_tiers" (
  "id" UUID NOT NULL,
  "rule_id" UUID NOT NULL,
  "min_service_months" INTEGER NOT NULL DEFAULT 0,
  "max_service_months" INTEGER,
  "entitlement_units" DECIMAL(6,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_statutory_entitlement_tiers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leave_statutory_rule_sets_business_id_jurisdiction_coun_key"
  ON "leave_statutory_rule_sets"("business_id", "jurisdiction_country_code", "jurisdiction_state_code", "version");
CREATE UNIQUE INDEX "leave_statutory_rule_sets_id_business_id_key"
  ON "leave_statutory_rule_sets"("id", "business_id");
CREATE INDEX "leave_statutory_rule_sets_business_id_jurisdiction_coun_idx"
  ON "leave_statutory_rule_sets"("business_id", "jurisdiction_country_code", "jurisdiction_state_code", "status", "effective_from");
CREATE UNIQUE INDEX "leave_statutory_rules_rule_set_id_category_key"
  ON "leave_statutory_rules"("rule_set_id", "category");
CREATE UNIQUE INDEX "leave_statutory_rules_id_business_id_key"
  ON "leave_statutory_rules"("id", "business_id");
CREATE INDEX "leave_statutory_rules_business_id_category_idx"
  ON "leave_statutory_rules"("business_id", "category");
CREATE UNIQUE INDEX "leave_statutory_entitlement_tiers_rule_id_min_servic_key"
  ON "leave_statutory_entitlement_tiers"("rule_id", "min_service_months");
CREATE INDEX "leave_statutory_entitlement_tiers_rule_id_min_service__idx"
  ON "leave_statutory_entitlement_tiers"("rule_id", "min_service_months", "max_service_months");

ALTER TABLE "leave_statutory_rule_sets"
  ADD CONSTRAINT "leave_statutory_rule_sets_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_statutory_rule_sets"
  ADD CONSTRAINT "leave_statutory_rule_sets_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_statutory_rule_sets"
  ADD CONSTRAINT "leave_statutory_rule_sets_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_statutory_rule_sets"
  ADD CONSTRAINT "leave_statutory_rule_sets_activated_by_id_fkey"
  FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_statutory_rules"
  ADD CONSTRAINT "leave_statutory_rules_rule_set_scope_fkey"
  FOREIGN KEY ("rule_set_id", "business_id") REFERENCES "leave_statutory_rule_sets"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_statutory_entitlement_tiers"
  ADD CONSTRAINT "leave_statutory_entitlement_tiers_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "leave_statutory_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leave_policies"
  ADD CONSTRAINT "leave_policies_custom_year_check"
  CHECK (
    "entitlement_period_type" <> 'CUSTOM_YEAR'
    OR ("custom_year_start_month" BETWEEN 1 AND 12 AND "custom_year_start_day" BETWEEN 1 AND 31)
  );

ALTER TABLE "leave_policy_versions"
  ADD CONSTRAINT "leave_policy_versions_statutory_rule_set_scope_fkey"
  FOREIGN KEY ("statutory_rule_set_id", "business_id") REFERENCES "leave_statutory_rule_sets"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_policy_versions"
  ADD CONSTRAINT "leave_policy_versions_statutory_rule_scope_fkey"
  FOREIGN KEY ("statutory_rule_id", "business_id") REFERENCES "leave_statutory_rules"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_leave_entitlements"
  ADD CONSTRAINT "employee_leave_entitlements_statutory_rule_set_scope_fkey"
  FOREIGN KEY ("statutory_rule_set_id", "business_id") REFERENCES "leave_statutory_rule_sets"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_leave_entitlements"
  ADD CONSTRAINT "employee_leave_entitlements_statutory_rule_scope_fkey"
  FOREIGN KEY ("statutory_rule_id", "business_id") REFERENCES "leave_statutory_rules"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION leave_phase2_statutory_evidence_guard() RETURNS trigger AS $$
DECLARE
  rule_set_status "LeaveStatutoryRuleSetStatus";
BEGIN
  IF TG_TABLE_NAME = 'leave_statutory_rule_sets' THEN
    IF OLD.status IN ('ACTIVE', 'SUPERSEDED') AND (
      NEW.business_id IS DISTINCT FROM OLD.business_id
      OR NEW.jurisdiction_country_code IS DISTINCT FROM OLD.jurisdiction_country_code
      OR NEW.jurisdiction_state_code IS DISTINCT FROM OLD.jurisdiction_state_code
      OR NEW.version IS DISTINCT FROM OLD.version
      OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
      OR NEW.effective_to IS DISTINCT FROM OLD.effective_to
      OR NEW.source_title IS DISTINCT FROM OLD.source_title
      OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
      OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
    ) THEN
      RAISE EXCEPTION 'Activated Leave statutory evidence is immutable.';
    END IF;
    IF OLD.status = 'SUPERSEDED' AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Superseded Leave statutory evidence cannot be reactivated.';
    END IF;
    RETURN NEW;
  END IF;

  SELECT status INTO rule_set_status
  FROM "leave_statutory_rule_sets"
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.rule_set_id ELSE NEW.rule_set_id END;
  IF rule_set_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Reviewed Leave statutory rules and tiers are immutable.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "leave_statutory_rule_sets_evidence_guard"
  BEFORE UPDATE ON "leave_statutory_rule_sets"
  FOR EACH ROW EXECUTE FUNCTION leave_phase2_statutory_evidence_guard();
CREATE TRIGGER "leave_statutory_rules_evidence_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_statutory_rules"
  FOR EACH ROW EXECUTE FUNCTION leave_phase2_statutory_evidence_guard();

CREATE OR REPLACE FUNCTION leave_phase2_statutory_tier_guard() RETURNS trigger AS $$
DECLARE
  rule_set_status "LeaveStatutoryRuleSetStatus";
BEGIN
  SELECT rs.status INTO rule_set_status
  FROM "leave_statutory_rules" r
  JOIN "leave_statutory_rule_sets" rs ON rs.id = r.rule_set_id
  WHERE r.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.rule_id ELSE NEW.rule_id END;
  IF rule_set_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Reviewed Leave statutory entitlement tiers are immutable.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "leave_statutory_tiers_evidence_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "leave_statutory_entitlement_tiers"
  FOR EACH ROW EXECUTE FUNCTION leave_phase2_statutory_tier_guard();
ALTER TABLE "leave_policy_versions"
  ADD CONSTRAINT "leave_policy_versions_custom_year_check"
  CHECK (
    "entitlement_period_type" <> 'CUSTOM_YEAR'
    OR ("custom_year_start_month" BETWEEN 1 AND 12 AND "custom_year_start_day" BETWEEN 1 AND 31)
  );
ALTER TABLE "leave_statutory_entitlement_tiers"
  ADD CONSTRAINT "leave_statutory_entitlement_tiers_service_months_check"
  CHECK (
    "min_service_months" >= 0
    AND ("max_service_months" IS NULL OR "max_service_months" >= "min_service_months")
  );
