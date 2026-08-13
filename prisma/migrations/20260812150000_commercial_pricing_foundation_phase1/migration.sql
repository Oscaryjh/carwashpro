CREATE TYPE "CommercialScopeType" AS ENUM ('BUSINESS', 'GROUP');
CREATE TYPE "CommercialPlanType" AS ENUM ('BASE', 'ADD_ON');
CREATE TYPE "CommercialPlanVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "CommercialBillingInterval" AS ENUM ('MONTHLY', 'ANNUAL');
CREATE TYPE "CommercialSubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "CommercialSubscriptionItemStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED');
CREATE TYPE "CommercialDiscountType" AS ENUM ('PERCENT', 'FIXED_AMOUNT');
CREATE TYPE "CommercialPromotionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "CommercialOverrideType" AS ENUM ('PRICE', 'BRANCH_ALLOWANCE', 'EMPLOYEE_ALLOWANCE', 'BUSINESS_AI_ALLOWANCE', 'GROUP_AI_ALLOWANCE');
CREATE TYPE "CommercialOverrideStatus" AS ENUM ('ACTIVE', 'REVOKED', 'SUPERSEDED');
CREATE TYPE "CommercialScheduledChangeStatus" AS ENUM ('SCHEDULED', 'APPLIED', 'CANCELLED');

CREATE TABLE "commercial_plans" (
  "id" UUID PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "display_name" TEXT NOT NULL,
  "description" TEXT, "scope_type" "CommercialScopeType" NOT NULL,
  "plan_type" "CommercialPlanType" NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" UUID NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "commercial_plans_scope_type_plan_type_active_idx" ON "commercial_plans"("scope_type", "plan_type", "active");

CREATE TABLE "commercial_plan_versions" (
  "id" UUID PRIMARY KEY, "plan_id" UUID NOT NULL, "version" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'MYR', "monthly_list_price_cents" INTEGER,
  "annual_list_price_cents" INTEGER, "setup_fee_cents" INTEGER,
  "included_branches" INTEGER, "included_employees" INTEGER,
  "extra_branch_unit_price_cents" INTEGER, "extra_employee_unit_price_cents" INTEGER,
  "business_ai_allowance" INTEGER, "group_ai_allowance" INTEGER,
  "effective_from" TIMESTAMP(3) NOT NULL, "effective_to" TIMESTAMP(3),
  "status" "CommercialPlanVersionStatus" NOT NULL DEFAULT 'DRAFT', "revision" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" UUID NOT NULL, "activated_by_id" UUID, "activated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commercial_plan_versions_plan_id_version_key" UNIQUE ("plan_id", "version"),
  CONSTRAINT "commercial_plan_version_currency_check" CHECK ("currency" = 'MYR'),
  CONSTRAINT "commercial_plan_version_period_check" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
  CONSTRAINT "commercial_plan_version_values_check" CHECK (
    ("monthly_list_price_cents" IS NULL OR "monthly_list_price_cents" >= 0) AND
    ("annual_list_price_cents" IS NULL OR "annual_list_price_cents" >= 0) AND
    ("setup_fee_cents" IS NULL OR "setup_fee_cents" >= 0) AND
    ("included_branches" IS NULL OR "included_branches" >= 0) AND
    ("included_employees" IS NULL OR "included_employees" >= 0) AND
    ("extra_branch_unit_price_cents" IS NULL OR "extra_branch_unit_price_cents" >= 0) AND
    ("extra_employee_unit_price_cents" IS NULL OR "extra_employee_unit_price_cents" >= 0) AND
    ("business_ai_allowance" IS NULL OR "business_ai_allowance" >= 0) AND
    ("group_ai_allowance" IS NULL OR "group_ai_allowance" >= 0)
  )
);
CREATE INDEX "commercial_plan_versions_plan_id_status_effective_from_effective_to_idx" ON "commercial_plan_versions"("plan_id", "status", "effective_from", "effective_to");
CREATE UNIQUE INDEX "commercial_one_active_plan_version_key" ON "commercial_plan_versions"("plan_id") WHERE "status" = 'ACTIVE';

CREATE TABLE "commercial_plan_version_modules" (
  "id" UUID PRIMARY KEY, "plan_version_id" UUID NOT NULL, "module_key" "BusinessModuleKey" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commercial_plan_version_modules_plan_version_id_module_key_key" UNIQUE ("plan_version_id", "module_key")
);
CREATE INDEX "commercial_plan_version_modules_module_key_idx" ON "commercial_plan_version_modules"("module_key");

CREATE TABLE "commercial_promotions" (
  "id" UUID PRIMARY KEY, "name" TEXT NOT NULL, "code" TEXT UNIQUE,
  "discount_type" "CommercialDiscountType" NOT NULL, "discount_value" INTEGER NOT NULL,
  "effective_from" TIMESTAMP(3) NOT NULL, "effective_to" TIMESTAMP(3),
  "status" "CommercialPromotionStatus" NOT NULL DEFAULT 'DRAFT', "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commercial_promotion_discount_check" CHECK ("discount_value" > 0 AND ("discount_type" <> 'PERCENT' OR "discount_value" <= 10000)),
  CONSTRAINT "commercial_promotion_period_check" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from")
);
CREATE INDEX "commercial_promotions_status_effective_from_effective_to_idx" ON "commercial_promotions"("status", "effective_from", "effective_to");

CREATE TABLE "commercial_promotion_plan_versions" (
  "id" UUID PRIMARY KEY, "promotion_id" UUID NOT NULL, "plan_version_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commercial_promotion_plan_versions_promotion_id_plan_version_id_key" UNIQUE ("promotion_id", "plan_version_id")
);

CREATE TABLE "commercial_subscriptions" (
  "id" UUID PRIMARY KEY, "scope_type" "CommercialScopeType" NOT NULL,
  "business_id" UUID, "group_id" UUID, "status" "CommercialSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
  "start_date" TIMESTAMP(3) NOT NULL, "renewal_date" TIMESTAMP(3) NOT NULL, "end_date" TIMESTAMP(3),
  "billing_interval_snapshot" "CommercialBillingInterval" NOT NULL, "promotion_id" UUID,
  "revision" INTEGER NOT NULL DEFAULT 1, "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commercial_subscription_scope_check" CHECK (
    ("scope_type" = 'BUSINESS' AND "business_id" IS NOT NULL AND "group_id" IS NULL) OR
    ("scope_type" = 'GROUP' AND "group_id" IS NOT NULL AND "business_id" IS NULL)
  ),
  CONSTRAINT "commercial_subscription_period_check" CHECK ("renewal_date" > "start_date" AND ("end_date" IS NULL OR "end_date" > "start_date"))
);
CREATE INDEX "commercial_subscriptions_business_id_status_renewal_date_idx" ON "commercial_subscriptions"("business_id", "status", "renewal_date");
CREATE INDEX "commercial_subscriptions_group_id_status_renewal_date_idx" ON "commercial_subscriptions"("group_id", "status", "renewal_date");
CREATE UNIQUE INDEX "commercial_active_business_subscription_key" ON "commercial_subscriptions"("business_id") WHERE "business_id" IS NOT NULL AND "status" IN ('PENDING','ACTIVE','SUSPENDED');
CREATE UNIQUE INDEX "commercial_active_group_subscription_key" ON "commercial_subscriptions"("group_id") WHERE "group_id" IS NOT NULL AND "status" IN ('PENDING','ACTIVE','SUSPENDED');

CREATE TABLE "commercial_subscription_items" (
  "id" UUID PRIMARY KEY, "subscription_id" UUID NOT NULL, "plan_version_id" UUID NOT NULL,
  "item_type" "CommercialPlanType" NOT NULL, "quantity" INTEGER NOT NULL DEFAULT 1,
  "start_date" TIMESTAMP(3) NOT NULL, "end_date" TIMESTAMP(3),
  "status" "CommercialSubscriptionItemStatus" NOT NULL DEFAULT 'SCHEDULED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commercial_subscription_item_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "commercial_subscription_item_period_check" CHECK ("end_date" IS NULL OR "end_date" > "start_date")
);
CREATE INDEX "commercial_subscription_items_subscription_id_item_type_status_start_date_end_date_idx" ON "commercial_subscription_items"("subscription_id", "item_type", "status", "start_date", "end_date");
CREATE INDEX "commercial_subscription_items_plan_version_id_status_idx" ON "commercial_subscription_items"("plan_version_id", "status");
CREATE UNIQUE INDEX "commercial_one_active_base_item_key" ON "commercial_subscription_items"("subscription_id") WHERE "item_type" = 'BASE' AND "status" = 'ACTIVE';

CREATE TABLE "commercial_overrides" (
  "id" UUID PRIMARY KEY, "subscription_id" UUID NOT NULL, "scope_type" "CommercialScopeType" NOT NULL,
  "business_id" UUID, "group_id" UUID, "type" "CommercialOverrideType" NOT NULL, "value" INTEGER NOT NULL,
  "effective_from" TIMESTAMP(3) NOT NULL, "effective_to" TIMESTAMP(3), "reason" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1, "status" "CommercialOverrideStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_by_id" UUID NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commercial_overrides_subscription_id_type_revision_key" UNIQUE ("subscription_id", "type", "revision"),
  CONSTRAINT "commercial_override_scope_check" CHECK (
    ("scope_type" = 'BUSINESS' AND "business_id" IS NOT NULL AND "group_id" IS NULL) OR
    ("scope_type" = 'GROUP' AND "group_id" IS NOT NULL AND "business_id" IS NULL)
  ),
  CONSTRAINT "commercial_override_value_check" CHECK ("value" >= 0),
  CONSTRAINT "commercial_override_reason_check" CHECK (length(trim("reason")) >= 5),
  CONSTRAINT "commercial_override_period_check" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from")
);
CREATE INDEX "commercial_overrides_business_id_type_status_effective_from_effective_to_idx" ON "commercial_overrides"("business_id", "type", "status", "effective_from", "effective_to");
CREATE INDEX "commercial_overrides_group_id_type_status_effective_from_effective_to_idx" ON "commercial_overrides"("group_id", "type", "status", "effective_from", "effective_to");

CREATE TABLE "commercial_scheduled_plan_changes" (
  "id" UUID PRIMARY KEY, "subscription_id" UUID NOT NULL, "new_base_plan_version_id" UUID NOT NULL,
  "effective_at" TIMESTAMP(3) NOT NULL, "status" "CommercialScheduledChangeStatus" NOT NULL DEFAULT 'SCHEDULED',
  "operation_key" TEXT NOT NULL UNIQUE, "reason" TEXT NOT NULL, "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "applied_at" TIMESTAMP(3)
);
CREATE INDEX "commercial_scheduled_plan_changes_subscription_id_status_effective_at_idx" ON "commercial_scheduled_plan_changes"("subscription_id", "status", "effective_at");
CREATE UNIQUE INDEX "commercial_one_scheduled_change_key" ON "commercial_scheduled_plan_changes"("subscription_id") WHERE "status" = 'SCHEDULED';

CREATE TABLE "commercial_commands" (
  "id" UUID PRIMARY KEY, "operation_key" TEXT NOT NULL UNIQUE, "command_type" TEXT NOT NULL,
  "actor_user_id" UUID NOT NULL, "result_id" UUID, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "commercial_commands_command_type_created_at_idx" ON "commercial_commands"("command_type", "created_at");

CREATE TABLE "commercial_audit_events" (
  "id" UUID PRIMARY KEY, "subscription_id" UUID, "action" TEXT NOT NULL, "entity_type" TEXT NOT NULL,
  "entity_id" UUID NOT NULL, "actor_user_id" UUID NOT NULL, "reason" TEXT, "before" JSONB, "after" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "commercial_audit_events_subscription_id_created_at_idx" ON "commercial_audit_events"("subscription_id", "created_at");
CREATE INDEX "commercial_audit_events_entity_type_entity_id_created_at_idx" ON "commercial_audit_events"("entity_type", "entity_id", "created_at");

ALTER TABLE "commercial_plans" ADD CONSTRAINT "commercial_plans_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_plan_versions" ADD CONSTRAINT "commercial_plan_versions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "commercial_plans"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_plan_versions" ADD CONSTRAINT "commercial_plan_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_plan_versions" ADD CONSTRAINT "commercial_plan_versions_activated_by_id_fkey" FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_plan_version_modules" ADD CONSTRAINT "commercial_plan_version_modules_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "commercial_plan_versions"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_promotions" ADD CONSTRAINT "commercial_promotions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_promotion_plan_versions" ADD CONSTRAINT "commercial_promotion_plan_versions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "commercial_promotions"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_promotion_plan_versions" ADD CONSTRAINT "commercial_promotion_plan_versions_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "commercial_plan_versions"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_subscriptions" ADD CONSTRAINT "commercial_subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_subscriptions" ADD CONSTRAINT "commercial_subscriptions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "business_groups"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_subscriptions" ADD CONSTRAINT "commercial_subscriptions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "commercial_promotions"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_subscriptions" ADD CONSTRAINT "commercial_subscriptions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_subscription_items" ADD CONSTRAINT "commercial_subscription_items_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "commercial_subscriptions"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_subscription_items" ADD CONSTRAINT "commercial_subscription_items_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "commercial_plan_versions"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_overrides" ADD CONSTRAINT "commercial_overrides_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "commercial_subscriptions"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_overrides" ADD CONSTRAINT "commercial_overrides_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_overrides" ADD CONSTRAINT "commercial_overrides_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "business_groups"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_overrides" ADD CONSTRAINT "commercial_overrides_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_scheduled_plan_changes" ADD CONSTRAINT "commercial_scheduled_plan_changes_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "commercial_subscriptions"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_scheduled_plan_changes" ADD CONSTRAINT "commercial_scheduled_plan_changes_new_base_plan_version_id_fkey" FOREIGN KEY ("new_base_plan_version_id") REFERENCES "commercial_plan_versions"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_scheduled_plan_changes" ADD CONSTRAINT "commercial_scheduled_plan_changes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_commands" ADD CONSTRAINT "commercial_commands_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_audit_events" ADD CONSTRAINT "commercial_audit_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "commercial_subscriptions"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_audit_events" ADD CONSTRAINT "commercial_audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION reject_used_commercial_plan_version_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Active or retired commercial plan versions are immutable.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF OLD.status = 'RETIRED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Active or retired commercial plan versions are immutable.';
  END IF;
  IF OLD.status = 'ACTIVE' AND NEW IS DISTINCT FROM OLD AND NEW.status <> 'RETIRED' THEN
    RAISE EXCEPTION 'Active commercial plan versions can only transition to retired.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "commercial_plan_version_immutable" BEFORE UPDATE OR DELETE ON "commercial_plan_versions" FOR EACH ROW EXECUTE FUNCTION reject_used_commercial_plan_version_mutation();

CREATE OR REPLACE FUNCTION reject_commercial_child_mutation_when_used() RETURNS trigger AS $$
DECLARE version_status "CommercialPlanVersionStatus";
BEGIN
  SELECT "status" INTO version_status FROM "commercial_plan_versions" WHERE "id" = COALESCE(NEW."plan_version_id", OLD."plan_version_id");
  IF version_status <> 'DRAFT' THEN RAISE EXCEPTION 'Used commercial plan version details are immutable.'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "commercial_plan_modules_immutable" BEFORE UPDATE OR DELETE ON "commercial_plan_version_modules" FOR EACH ROW EXECUTE FUNCTION reject_commercial_child_mutation_when_used();
