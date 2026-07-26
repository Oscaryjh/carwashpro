-- Business Group is a management layer only. Existing transactional tables
-- retain their current business_id ownership and are intentionally untouched.
CREATE TYPE "BusinessGroupStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "BusinessGroupMemberStatus" AS ENUM ('ACTIVE', 'REMOVED');
CREATE TYPE "BusinessGroupUserRole" AS ENUM ('GROUP_OWNER', 'GROUP_MANAGER');
CREATE TYPE "BusinessGroupUserStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "BusinessGroupAccessScope" AS ENUM ('ALL_GROUP_BUSINESSES', 'SELECTED_BUSINESSES');

CREATE TABLE "business_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "BusinessGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "business_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "business_group_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "status" "BusinessGroupMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "business_group_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "business_group_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "BusinessGroupUserRole" NOT NULL,
    "status" "BusinessGroupUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "access_scope" "BusinessGroupAccessScope" NOT NULL DEFAULT 'ALL_GROUP_BUSINESSES',
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "business_group_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "business_group_user_business_access" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_user_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_group_user_business_access_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "business_group_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "business_id" UUID,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_group_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_groups_code_key" ON "business_groups"("code");
CREATE INDEX "business_groups_status_idx" ON "business_groups"("status");
CREATE INDEX "business_group_members_group_id_status_idx" ON "business_group_members"("group_id", "status");
CREATE INDEX "business_group_members_business_id_status_idx" ON "business_group_members"("business_id", "status");
CREATE UNIQUE INDEX "business_group_members_one_active_business_key"
  ON "business_group_members"("business_id") WHERE "status" = 'ACTIVE';
CREATE INDEX "business_group_users_group_id_status_idx" ON "business_group_users"("group_id", "status");
CREATE INDEX "business_group_users_user_id_status_idx" ON "business_group_users"("user_id", "status");
CREATE UNIQUE INDEX "business_group_users_one_active_user_per_group_key"
  ON "business_group_users"("group_id", "user_id") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "business_group_user_business_access_group_user_id_business_id_key"
  ON "business_group_user_business_access"("group_user_id", "business_id");
CREATE INDEX "business_group_user_business_access_business_id_idx"
  ON "business_group_user_business_access"("business_id");
CREATE INDEX "business_group_audit_logs_group_id_created_at_idx"
  ON "business_group_audit_logs"("group_id", "created_at");
CREATE INDEX "business_group_audit_logs_business_id_created_at_idx"
  ON "business_group_audit_logs"("business_id", "created_at");
CREATE INDEX "business_group_audit_logs_actor_user_id_created_at_idx"
  ON "business_group_audit_logs"("actor_user_id", "created_at");
CREATE INDEX "business_group_audit_logs_group_id_action_created_at_idx"
  ON "business_group_audit_logs"("group_id", "action", "created_at");

ALTER TABLE "business_group_members"
  ADD CONSTRAINT "business_group_members_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "business_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "business_group_members_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "business_group_users"
  ADD CONSTRAINT "business_group_users_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "business_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "business_group_users_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "business_group_user_business_access"
  ADD CONSTRAINT "business_group_user_business_access_group_user_id_fkey"
  FOREIGN KEY ("group_user_id") REFERENCES "business_group_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "business_group_user_business_access_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "business_group_audit_logs"
  ADD CONSTRAINT "business_group_audit_logs_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "business_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "business_group_audit_logs_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "business_group_audit_logs_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
