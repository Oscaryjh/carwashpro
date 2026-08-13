CREATE TYPE "AiAllowancePolicyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED');
CREATE TYPE "AiAllowancePolicySource" AS ENUM ('PLAN', 'PLATFORM_OVERRIDE', 'TRIAL', 'OTHER');
CREATE TYPE "AiQuotaReservationStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');
CREATE TYPE "AiUsageEventType" AS ENUM ('RESERVED', 'SUCCEEDED', 'FAILED', 'RELEASED', 'QUOTA_DENIED');

ALTER TABLE "ai_usage"
  ADD COLUMN "message_id" UUID,
  ADD COLUMN "provider_request_id" TEXT,
  ADD COLUMN "prompt_version" TEXT,
  ADD COLUMN "context_version" TEXT,
  ADD COLUMN "commercially_counted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reservation_id" UUID;

CREATE TABLE "ai_allowance_policies" (
  "id" UUID NOT NULL,
  "scope_type" "AiScopeType" NOT NULL,
  "scope_key" TEXT NOT NULL,
  "business_id" UUID,
  "group_id" UUID,
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_to" TIMESTAMP(3),
  "request_limit" INTEGER,
  "token_limit" INTEGER,
  "timezone" TEXT NOT NULL,
  "status" "AiAllowancePolicyStatus" NOT NULL,
  "source" "AiAllowancePolicySource" NOT NULL,
  "revision" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_allowance_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_allowance_policy_scope_check" CHECK (
    ("scope_type" = 'BUSINESS' AND "business_id" IS NOT NULL AND "group_id" IS NULL AND "scope_key" = 'BUSINESS:' || "business_id"::text)
    OR ("scope_type" = 'GROUP' AND "group_id" IS NOT NULL AND "business_id" IS NULL AND "scope_key" = 'GROUP:' || "group_id"::text)
  ),
  CONSTRAINT "ai_allowance_policy_limits_check" CHECK (("request_limit" IS NULL OR "request_limit" >= 0) AND ("token_limit" IS NULL OR "token_limit" >= 0)),
  CONSTRAINT "ai_allowance_policy_period_check" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from")
);

CREATE TABLE "ai_allowance_periods" (
  "id" UUID NOT NULL,
  "scope_type" "AiScopeType" NOT NULL,
  "scope_key" TEXT NOT NULL,
  "business_id" UUID,
  "group_id" UUID,
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "policy_id" UUID NOT NULL,
  "policy_revision" INTEGER NOT NULL,
  "request_limit_snapshot" INTEGER,
  "token_limit_snapshot" INTEGER,
  "reserved_requests" INTEGER NOT NULL DEFAULT 0,
  "consumed_requests" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_allowance_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_allowance_period_scope_check" CHECK (
    ("scope_type" = 'BUSINESS' AND "business_id" IS NOT NULL AND "group_id" IS NULL AND "scope_key" = 'BUSINESS:' || "business_id"::text)
    OR ("scope_type" = 'GROUP' AND "group_id" IS NOT NULL AND "business_id" IS NULL AND "scope_key" = 'GROUP:' || "group_id"::text)
  ),
  CONSTRAINT "ai_allowance_period_counter_check" CHECK ("reserved_requests" >= 0 AND "consumed_requests" >= 0 AND "period_end" > "period_start")
);

CREATE TABLE "ai_quota_reservations" (
  "id" UUID NOT NULL,
  "scope_type" "AiScopeType" NOT NULL,
  "scope_key" TEXT NOT NULL,
  "business_id" UUID,
  "group_id" UUID,
  "user_id" UUID NOT NULL,
  "conversation_id" UUID,
  "period_id" UUID NOT NULL,
  "policy_id" UUID NOT NULL,
  "policy_revision" INTEGER NOT NULL,
  "request_key" TEXT NOT NULL,
  "status" "AiQuotaReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumed_at" TIMESTAMP(3),
  "released_at" TIMESTAMP(3),
  CONSTRAINT "ai_quota_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_quota_reservation_scope_check" CHECK (
    ("scope_type" = 'BUSINESS' AND "business_id" IS NOT NULL AND "group_id" IS NULL AND "scope_key" = 'BUSINESS:' || "business_id"::text)
    OR ("scope_type" = 'GROUP' AND "group_id" IS NOT NULL AND "business_id" IS NULL AND "scope_key" = 'GROUP:' || "group_id"::text)
  )
);

CREATE TABLE "ai_usage_events" (
  "id" UUID NOT NULL,
  "event_type" "AiUsageEventType" NOT NULL,
  "scope_type" "AiScopeType" NOT NULL,
  "scope_key" TEXT NOT NULL,
  "business_id" UUID,
  "group_id" UUID,
  "user_id" UUID NOT NULL,
  "conversation_id" UUID,
  "usage_id" UUID,
  "reservation_id" UUID,
  "period_id" UUID,
  "policy_id" UUID,
  "policy_revision" INTEGER,
  "request_key" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "provider_request_id" TEXT,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "total_tokens" INTEGER,
  "latency_ms" INTEGER,
  "prompt_version" TEXT,
  "context_version" TEXT,
  "commercially_counted" BOOLEAN NOT NULL DEFAULT false,
  "error_category" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_usage_event_scope_check" CHECK (
    ("scope_type" = 'BUSINESS' AND "business_id" IS NOT NULL AND "group_id" IS NULL AND "scope_key" = 'BUSINESS:' || "business_id"::text)
    OR ("scope_type" = 'GROUP' AND "group_id" IS NOT NULL AND "business_id" IS NULL AND "scope_key" = 'GROUP:' || "group_id"::text)
  ),
  CONSTRAINT "ai_usage_event_tokens_check" CHECK (
    ("input_tokens" IS NULL OR "input_tokens" >= 0) AND ("output_tokens" IS NULL OR "output_tokens" >= 0) AND ("total_tokens" IS NULL OR "total_tokens" >= 0)
  )
);

CREATE UNIQUE INDEX "ai_allowance_policies_scope_key_revision_key" ON "ai_allowance_policies"("scope_key", "revision");
CREATE INDEX "ai_allowance_policies_scope_key_effective_from_effective_idx" ON "ai_allowance_policies"("scope_key", "effective_from", "effective_to", "status");
CREATE UNIQUE INDEX "ai_allowance_periods_scope_key_period_start_key" ON "ai_allowance_periods"("scope_key", "period_start");
CREATE INDEX "ai_allowance_periods_business_id_period_start_idx" ON "ai_allowance_periods"("business_id", "period_start");
CREATE INDEX "ai_allowance_periods_group_id_period_start_idx" ON "ai_allowance_periods"("group_id", "period_start");
CREATE UNIQUE INDEX "ai_quota_reservations_request_key_key" ON "ai_quota_reservations"("request_key");
CREATE INDEX "ai_quota_reservations_scope_key_status_created_at_idx" ON "ai_quota_reservations"("scope_key", "status", "created_at");
CREATE INDEX "ai_usage_events_scope_key_created_at_idx" ON "ai_usage_events"("scope_key", "created_at");
CREATE INDEX "ai_usage_events_request_key_created_at_idx" ON "ai_usage_events"("request_key", "created_at");
CREATE INDEX "ai_usage_events_usage_id_idx" ON "ai_usage_events"("usage_id");
CREATE UNIQUE INDEX "ai_usage_reservation_id_key" ON "ai_usage"("reservation_id");

ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "ai_quota_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_allowance_policies" ADD CONSTRAINT "ai_allowance_policies_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_allowance_policies" ADD CONSTRAINT "ai_allowance_policies_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "business_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_allowance_policies" ADD CONSTRAINT "ai_allowance_policies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_allowance_periods" ADD CONSTRAINT "ai_allowance_periods_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_allowance_periods" ADD CONSTRAINT "ai_allowance_periods_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "business_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_allowance_periods" ADD CONSTRAINT "ai_allowance_periods_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "ai_allowance_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_quota_reservations" ADD CONSTRAINT "ai_quota_reservations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_quota_reservations" ADD CONSTRAINT "ai_quota_reservations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "business_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_quota_reservations" ADD CONSTRAINT "ai_quota_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_quota_reservations" ADD CONSTRAINT "ai_quota_reservations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_quota_reservations" ADD CONSTRAINT "ai_quota_reservations_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "ai_allowance_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_quota_reservations" ADD CONSTRAINT "ai_quota_reservations_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "ai_allowance_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "business_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_usage_id_fkey" FOREIGN KEY ("usage_id") REFERENCES "ai_usage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "ai_quota_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "ai_allowance_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "ai_allowance_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_ai_usage_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ai_usage_events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_usage_events_immutable_update_delete"
BEFORE UPDATE OR DELETE ON "ai_usage_events"
FOR EACH ROW EXECUTE FUNCTION prevent_ai_usage_event_mutation();
