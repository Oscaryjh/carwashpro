CREATE TYPE "AiScopeType" AS ENUM ('BUSINESS', 'GROUP');
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT');
CREATE TYPE "AiUsageStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'RATE_LIMITED', 'DUPLICATE');

CREATE TABLE "ai_conversations" (
  "id" UUID NOT NULL,
  "scope_type" "AiScopeType" NOT NULL,
  "business_id" UUID,
  "group_id" UUID,
  "created_by_id" UUID NOT NULL,
  "title" TEXT,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_conversations_exact_scope_check" CHECK (
    ("scope_type" = 'BUSINESS' AND "business_id" IS NOT NULL AND "group_id" IS NULL)
    OR ("scope_type" = 'GROUP' AND "group_id" IS NOT NULL AND "business_id" IS NULL)
  )
);

CREATE TABLE "ai_messages" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "role" "AiMessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "structured_metadata" JSONB,
  "provider" TEXT,
  "model" TEXT,
  "prompt_version" TEXT,
  "context_version" TEXT,
  "context_digest" TEXT,
  "client_request_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_usage" (
  "id" UUID NOT NULL,
  "business_id" UUID,
  "group_id" UUID,
  "user_id" UUID NOT NULL,
  "conversation_id" UUID,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "request_key" TEXT NOT NULL,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "total_tokens" INTEGER,
  "latency_ms" INTEGER,
  "status" "AiUsageStatus" NOT NULL,
  "error_category" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_usage_exact_scope_check" CHECK (
    ("business_id" IS NOT NULL AND "group_id" IS NULL)
    OR ("group_id" IS NOT NULL AND "business_id" IS NULL)
  )
);

CREATE INDEX "ai_conversations_business_id_created_by_id_updated_at_idx" ON "ai_conversations"("business_id", "created_by_id", "updated_at");
CREATE INDEX "ai_conversations_group_id_created_by_id_updated_at_idx" ON "ai_conversations"("group_id", "created_by_id", "updated_at");
CREATE INDEX "ai_conversations_created_by_id_archived_at_updated_at_idx" ON "ai_conversations"("created_by_id", "archived_at", "updated_at");
CREATE UNIQUE INDEX "ai_messages_conversation_id_client_request_id_key" ON "ai_messages"("conversation_id", "client_request_id");
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");
CREATE UNIQUE INDEX "ai_usage_user_id_request_key_key" ON "ai_usage"("user_id", "request_key");
CREATE INDEX "ai_usage_business_id_user_id_created_at_idx" ON "ai_usage"("business_id", "user_id", "created_at");
CREATE INDEX "ai_usage_group_id_user_id_created_at_idx" ON "ai_usage"("group_id", "user_id", "created_at");
CREATE INDEX "ai_usage_user_id_status_created_at_idx" ON "ai_usage"("user_id", "status", "created_at");

ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "business_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "business_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
