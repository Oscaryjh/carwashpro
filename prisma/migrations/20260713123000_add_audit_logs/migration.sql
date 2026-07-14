CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID,
    "actor_user_id" UUID,
    "actor_name" TEXT,
    "actor_email" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_business_id_created_at_idx"
ON "audit_logs"("business_id", "created_at");

CREATE INDEX "audit_logs_business_id_actor_user_id_created_at_idx"
ON "audit_logs"("business_id", "actor_user_id", "created_at");

CREATE INDEX "audit_logs_business_id_action_created_at_idx"
ON "audit_logs"("business_id", "action", "created_at");

CREATE INDEX "audit_logs_business_id_entity_type_entity_id_idx"
ON "audit_logs"("business_id", "entity_type", "entity_id");

ALTER TABLE "audit_logs"
ADD CONSTRAINT "audit_logs_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
ADD CONSTRAINT "audit_logs_branch_id_fkey"
FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
ADD CONSTRAINT "audit_logs_actor_user_id_fkey"
FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
