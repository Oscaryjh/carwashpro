CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "active_business_id" UUID,
    "branch_id" UUID,
    "context_version" INTEGER NOT NULL,
    "absolute_expires_at" TIMESTAMP(3) NOT NULL,
    "idle_expires_at" TIMESTAMP(3) NOT NULL,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,
    "ip_address_hash" TEXT,
    "user_agent_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_security_events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "identifier_hash" TEXT,
    "ip_address_hash" TEXT,
    "user_agent_hash" TEXT,
    "user_id" UUID,
    "business_id" UUID,
    "session_id" UUID,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),

    CONSTRAINT "auth_security_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_sessions_user_active_idx"
ON "auth_sessions"("user_id", "revoked_at", "absolute_expires_at");

CREATE INDEX "auth_sessions_idle_expires_idx"
ON "auth_sessions"("idle_expires_at");

CREATE INDEX "auth_security_events_surface_identifier_idx"
ON "auth_security_events"("surface", "identifier_hash", "created_at");

CREATE INDEX "auth_security_events_surface_ip_idx"
ON "auth_security_events"("surface", "ip_address_hash", "created_at");

CREATE INDEX "auth_security_events_type_created_idx"
ON "auth_security_events"("event_type", "created_at");

CREATE INDEX "auth_security_events_user_created_idx"
ON "auth_security_events"("user_id", "created_at");

ALTER TABLE "auth_sessions"
ADD CONSTRAINT "auth_sessions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
