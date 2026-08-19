-- Leave Management Phase 2B introduces immutable carry-forward, rollover,
-- bucket allocation, restoration and expiry evidence. Existing Leave Core
-- balances remain ledger-backed and no historical record is rewritten.

ALTER TYPE "LeaveLedgerEventType" ADD VALUE IF NOT EXISTS 'CARRY_FORWARD_LAPSE';

CREATE TYPE "LeaveCarryForwardExpiryRule" AS ENUM (
  'NO_EXPIRY',
  'DAYS_AFTER_ROLLOVER',
  'MONTHS_AFTER_ROLLOVER',
  'FIXED_DATE_IN_DESTINATION_PERIOD'
);
CREATE TYPE "LeaveConsumptionPriority" AS ENUM ('EARLIEST_EXPIRY_FIRST', 'OLDEST_ENTITLEMENT_FIRST');
CREATE TYPE "LeaveEntitlementBucketSourceType" AS ENUM ('CURRENT_ENTITLEMENT', 'CARRY_FORWARD');
CREATE TYPE "LeaveEntitlementBucketStatus" AS ENUM ('ACTIVE', 'EXHAUSTED', 'EXPIRED');

ALTER TABLE "leave_policies"
  ADD COLUMN "carry_forward_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "carry_forward_limit_units" DECIMAL(6,2),
  ADD COLUMN "carry_forward_expiry_rule" "LeaveCarryForwardExpiryRule" NOT NULL DEFAULT 'NO_EXPIRY',
  ADD COLUMN "carry_forward_expiry_value" VARCHAR(40),
  ADD COLUMN "consumption_priority" "LeaveConsumptionPriority" NOT NULL DEFAULT 'EARLIEST_EXPIRY_FIRST';

ALTER TABLE "leave_policy_versions"
  ADD COLUMN "carry_forward_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "carry_forward_limit_units" DECIMAL(6,2),
  ADD COLUMN "carry_forward_expiry_rule" "LeaveCarryForwardExpiryRule" NOT NULL DEFAULT 'NO_EXPIRY',
  ADD COLUMN "carry_forward_expiry_value" VARCHAR(40),
  ADD COLUMN "consumption_priority" "LeaveConsumptionPriority" NOT NULL DEFAULT 'EARLIEST_EXPIRY_FIRST';

ALTER TABLE "leave_policies"
  ADD CONSTRAINT "leave_policies_carry_limit_check"
  CHECK ("carry_forward_limit_units" IS NULL OR "carry_forward_limit_units" >= 0);
ALTER TABLE "leave_policy_versions"
  ADD CONSTRAINT "leave_policy_versions_carry_limit_check"
  CHECK ("carry_forward_limit_units" IS NULL OR "carry_forward_limit_units" >= 0);

CREATE TABLE "leave_period_rollovers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "policy_id" UUID NOT NULL,
  "policy_version_id" UUID NOT NULL,
  "source_period_start" DATE NOT NULL,
  "source_period_end" DATE NOT NULL,
  "destination_period_start" DATE NOT NULL,
  "destination_period_end" DATE NOT NULL,
  "source_remaining_units" DECIMAL(6,2) NOT NULL,
  "carried_units" DECIMAL(6,2) NOT NULL,
  "lapsed_units" DECIMAL(6,2) NOT NULL,
  "carry_expires_at" DATE,
  "carry_forward_rule_snapshot" JSONB NOT NULL,
  "source_digest" CHAR(64) NOT NULL,
  "actor_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_period_rollovers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_period_rollovers_tenant_key" UNIQUE ("id", "business_id"),
  CONSTRAINT "leave_period_rollovers_identity_key" UNIQUE ("business_id", "membership_id", "policy_id", "source_period_start", "destination_period_start"),
  CONSTRAINT "leave_period_rollovers_period_check" CHECK (
    "source_period_end" >= "source_period_start"
    AND "destination_period_end" >= "destination_period_start"
    AND "destination_period_start" > "source_period_end"
  ),
  CONSTRAINT "leave_period_rollovers_units_check" CHECK (
    "source_remaining_units" >= 0 AND "carried_units" >= 0 AND "lapsed_units" >= 0
    AND "carried_units" + "lapsed_units" = "source_remaining_units"
  ),
  CONSTRAINT "leave_period_rollovers_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_period_rollovers_membership_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_period_rollovers_policy_fkey" FOREIGN KEY ("policy_id") REFERENCES "leave_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_period_rollovers_version_fkey" FOREIGN KEY ("policy_version_id", "business_id") REFERENCES "leave_policy_versions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_period_rollovers_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "leave_period_rollovers_destination_idx" ON "leave_period_rollovers"("business_id", "destination_period_start", "policy_id");

CREATE TABLE "leave_entitlement_buckets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "policy_id" UUID NOT NULL,
  "policy_version_id" UUID NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "source_type" "LeaveEntitlementBucketSourceType" NOT NULL,
  "granted_units" DECIMAL(6,2) NOT NULL,
  "available_from" DATE NOT NULL,
  "expires_at" DATE,
  "status" "LeaveEntitlementBucketStatus" NOT NULL DEFAULT 'ACTIVE',
  "entitlement_id" UUID,
  "rollover_id" UUID,
  "source_digest" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_entitlement_buckets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_entitlement_buckets_tenant_key" UNIQUE ("id", "business_id"),
  CONSTRAINT "leave_entitlement_buckets_entitlement_key" UNIQUE ("entitlement_id"),
  CONSTRAINT "leave_entitlement_buckets_rollover_key" UNIQUE ("rollover_id"),
  CONSTRAINT "leave_entitlement_buckets_period_check" CHECK ("period_end" >= "period_start"),
  CONSTRAINT "leave_entitlement_buckets_units_check" CHECK ("granted_units" >= 0),
  CONSTRAINT "leave_entitlement_buckets_source_check" CHECK (
    ("source_type" = 'CURRENT_ENTITLEMENT' AND "entitlement_id" IS NOT NULL AND "rollover_id" IS NULL)
    OR ("source_type" = 'CARRY_FORWARD' AND "rollover_id" IS NOT NULL AND "entitlement_id" IS NULL)
  ),
  CONSTRAINT "leave_entitlement_buckets_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_entitlement_buckets_membership_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_entitlement_buckets_policy_fkey" FOREIGN KEY ("policy_id") REFERENCES "leave_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_entitlement_buckets_version_fkey" FOREIGN KEY ("policy_version_id", "business_id") REFERENCES "leave_policy_versions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_entitlement_buckets_entitlement_fkey" FOREIGN KEY ("entitlement_id", "business_id") REFERENCES "employee_leave_entitlements"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_entitlement_buckets_rollover_fkey" FOREIGN KEY ("rollover_id", "business_id") REFERENCES "leave_period_rollovers"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "leave_entitlement_buckets_scope_idx" ON "leave_entitlement_buckets"("business_id", "membership_id", "policy_id", "period_start", "status");
CREATE INDEX "leave_entitlement_buckets_expiry_idx" ON "leave_entitlement_buckets"("business_id", "expires_at", "status");

CREATE TABLE "leave_consumption_allocations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "leave_request_id" UUID NOT NULL,
  "bucket_id" UUID NOT NULL,
  "units" DECIMAL(6,2) NOT NULL,
  "source_key" VARCHAR(200) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_consumption_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_consumption_allocations_tenant_key" UNIQUE ("id", "business_id"),
  CONSTRAINT "leave_consumption_allocations_source_key" UNIQUE ("source_key"),
  CONSTRAINT "leave_consumption_allocations_request_bucket_key" UNIQUE ("leave_request_id", "bucket_id"),
  CONSTRAINT "leave_consumption_allocations_units_check" CHECK ("units" > 0),
  CONSTRAINT "leave_consumption_allocations_request_fkey" FOREIGN KEY ("leave_request_id", "business_id") REFERENCES "leave_requests"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_consumption_allocations_bucket_fkey" FOREIGN KEY ("bucket_id", "business_id") REFERENCES "leave_entitlement_buckets"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "leave_consumption_allocations_bucket_idx" ON "leave_consumption_allocations"("business_id", "bucket_id", "created_at");

CREATE TABLE "leave_allocation_restorations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "leave_request_id" UUID NOT NULL,
  "allocation_id" UUID NOT NULL,
  "bucket_id" UUID NOT NULL,
  "units" DECIMAL(6,2) NOT NULL,
  "source_key" VARCHAR(200) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_allocation_restorations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_allocation_restorations_tenant_key" UNIQUE ("id", "business_id"),
  CONSTRAINT "leave_allocation_restorations_source_key" UNIQUE ("source_key"),
  CONSTRAINT "leave_allocation_restorations_allocation_key" UNIQUE ("allocation_id"),
  CONSTRAINT "leave_allocation_restorations_units_check" CHECK ("units" > 0),
  CONSTRAINT "leave_allocation_restorations_request_fkey" FOREIGN KEY ("leave_request_id", "business_id") REFERENCES "leave_requests"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_allocation_restorations_allocation_fkey" FOREIGN KEY ("allocation_id", "business_id") REFERENCES "leave_consumption_allocations"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_allocation_restorations_bucket_fkey" FOREIGN KEY ("bucket_id", "business_id") REFERENCES "leave_entitlement_buckets"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "leave_allocation_restorations_request_idx" ON "leave_allocation_restorations"("business_id", "leave_request_id", "created_at");

CREATE TABLE "leave_bucket_expiries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "bucket_id" UUID NOT NULL,
  "units" DECIMAL(6,2) NOT NULL,
  "expires_at" DATE NOT NULL,
  "source_key" VARCHAR(200) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_bucket_expiries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_bucket_expiries_tenant_key" UNIQUE ("id", "business_id"),
  CONSTRAINT "leave_bucket_expiries_bucket_key" UNIQUE ("bucket_id"),
  CONSTRAINT "leave_bucket_expiries_source_key" UNIQUE ("source_key"),
  CONSTRAINT "leave_bucket_expiries_units_check" CHECK ("units" > 0),
  CONSTRAINT "leave_bucket_expiries_bucket_fkey" FOREIGN KEY ("bucket_id", "business_id") REFERENCES "leave_entitlement_buckets"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "leave_bucket_expiries_date_idx" ON "leave_bucket_expiries"("business_id", "expires_at");

ALTER TABLE "leave_balance_ledger_entries"
  ADD COLUMN "bucket_id" UUID,
  ADD COLUMN "allocation_id" UUID,
  ADD COLUMN "rollover_id" UUID,
  ADD COLUMN "bucket_expiry_id" UUID,
  ADD COLUMN "restoration_id" UUID,
  ADD CONSTRAINT "leave_balance_ledger_bucket_fkey" FOREIGN KEY ("bucket_id", "business_id") REFERENCES "leave_entitlement_buckets"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "leave_balance_ledger_allocation_fkey" FOREIGN KEY ("allocation_id", "business_id") REFERENCES "leave_consumption_allocations"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "leave_balance_ledger_rollover_fkey" FOREIGN KEY ("rollover_id", "business_id") REFERENCES "leave_period_rollovers"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "leave_balance_ledger_expiry_fkey" FOREIGN KEY ("bucket_expiry_id", "business_id") REFERENCES "leave_bucket_expiries"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "leave_balance_ledger_restoration_fkey" FOREIGN KEY ("restoration_id", "business_id") REFERENCES "leave_allocation_restorations"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION leave_phase2b_scope_guard() RETURNS trigger AS $$
DECLARE
  policy_business UUID;
  version_business UUID;
  version_policy UUID;
BEGIN
  SELECT "business_id" INTO policy_business FROM "leave_policies" WHERE "id" = NEW."policy_id";
  SELECT "business_id", "policy_id" INTO version_business, version_policy FROM "leave_policy_versions" WHERE "id" = NEW."policy_version_id";
  IF policy_business IS NULL OR policy_business <> NEW."business_id" OR
     version_business IS NULL OR version_business <> NEW."business_id" OR version_policy <> NEW."policy_id" THEN
    RAISE EXCEPTION 'Leave Phase 2B tenant or policy version mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leave_period_rollovers_scope_guard BEFORE INSERT ON "leave_period_rollovers"
  FOR EACH ROW EXECUTE FUNCTION leave_phase2b_scope_guard();
CREATE TRIGGER leave_entitlement_buckets_scope_guard BEFORE INSERT ON "leave_entitlement_buckets"
  FOR EACH ROW EXECUTE FUNCTION leave_phase2b_scope_guard();

CREATE TRIGGER leave_period_rollovers_immutable BEFORE UPDATE OR DELETE ON "leave_period_rollovers"
  FOR EACH ROW EXECUTE FUNCTION leave_immutable_row_guard();
CREATE TRIGGER leave_consumption_allocations_immutable BEFORE UPDATE OR DELETE ON "leave_consumption_allocations"
  FOR EACH ROW EXECUTE FUNCTION leave_immutable_row_guard();
CREATE TRIGGER leave_allocation_restorations_immutable BEFORE UPDATE OR DELETE ON "leave_allocation_restorations"
  FOR EACH ROW EXECUTE FUNCTION leave_immutable_row_guard();
CREATE TRIGGER leave_bucket_expiries_immutable BEFORE UPDATE OR DELETE ON "leave_bucket_expiries"
  FOR EACH ROW EXECUTE FUNCTION leave_immutable_row_guard();
