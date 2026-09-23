-- Additive, separate from formal statutory approval/activation and its triggers.
CREATE TABLE "statutory_engineering_activations" (
  "id" UUID PRIMARY KEY,
  "rule_set_id" UUID NOT NULL REFERENCES "statutory_rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "business_id" UUID NOT NULL REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "tax_year" INTEGER NOT NULL CHECK ("tax_year" BETWEEN 2000 AND 9999),
  "state" VARCHAR(16) NOT NULL CHECK ("state" IN ('ENABLED','REVOKED')),
  "previous_state" VARCHAR(16) NOT NULL CHECK ("previous_state" IN ('NONE','ENABLED','REVOKED')),
  "environment" VARCHAR(16) NOT NULL DEFAULT 'TESTING' CHECK ("environment" = 'TESTING'),
  "purpose" VARCHAR(32) NOT NULL DEFAULT 'ENGINEERING_UAT' CHECK ("purpose" = 'ENGINEERING_UAT'),
  "official_export_eligible" BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT "official_export_eligible"),
  "production_eligible" BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT "production_eligible"),
  "verification_digest" CHAR(64) NOT NULL CHECK ("verification_digest" ~ '^[a-f0-9]{64}$'),
  "rule_binding_digest" CHAR(64) NOT NULL CHECK ("rule_binding_digest" ~ '^[a-f0-9]{64}$'),
  "evidence" JSONB NOT NULL,
  "actor_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actor_type" VARCHAR(24) NOT NULL CHECK ("actor_type" IN ('CODEX','SCRIPT','HUMAN_USER')),
  "actor_capability" VARCHAR(64) NOT NULL CHECK ("actor_capability" = 'ACTIVATE_TESTING_STATUTORY_RULESET'),
  "reason" VARCHAR(500) NOT NULL CHECK (length(trim("reason")) >= 10),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "statutory_engineering_activation_revision_key" UNIQUE("business_id", "rule_set_id", "revision")
);
CREATE INDEX "statutory_engineering_scope_idx"
  ON "statutory_engineering_activations"("business_id", "rule_set_id", "created_at");
CREATE FUNCTION guard_statutory_engineering_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'STATUTORY_ENGINEERING_HISTORY_IMMUTABLE';
END;
$$;
CREATE TRIGGER statutory_engineering_history_immutable
  BEFORE UPDATE OR DELETE ON "statutory_engineering_activations"
  FOR EACH ROW EXECUTE FUNCTION guard_statutory_engineering_history();
