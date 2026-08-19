CREATE TYPE "HrApprovalDomain" AS ENUM ('LEAVE', 'CLAIMS');
CREATE TYPE "HrApprovalPolicyMode" AS ENUM ('ONE_LEVEL', 'TWO_LEVEL_ALWAYS', 'TWO_LEVEL_THRESHOLD');
CREATE TYPE "HrApprovalDecisionStage" AS ENUM ('LEVEL_ONE', 'LEVEL_TWO');
CREATE TYPE "HrApprovalDecisionOutcome" AS ENUM ('APPROVED', 'REJECTED');

CREATE TABLE "hr_approval_policies" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "domain" "HrApprovalDomain" NOT NULL,
    "mode" "HrApprovalPolicyMode" NOT NULL DEFAULT 'ONE_LEVEL',
    "threshold_value" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_approval_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_approval_decisions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "domain" "HrApprovalDomain" NOT NULL,
    "subject_id" UUID NOT NULL,
    "subject_revision" INTEGER NOT NULL,
    "stage" "HrApprovalDecisionStage" NOT NULL,
    "outcome" "HrApprovalDecisionOutcome" NOT NULL,
    "policy_mode_snapshot" "HrApprovalPolicyMode" NOT NULL,
    "threshold_value_snapshot" DECIMAL(12,2),
    "subject_value_snapshot" DECIMAL(12,2),
    "decision_payload" JSONB,
    "payload_digest" CHAR(64),
    "reason" VARCHAR(500),
    "actor_user_id" UUID NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_approval_decisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hr_approval_policies_business_id_domain_key"
ON "hr_approval_policies"("business_id", "domain");
CREATE INDEX "hr_approval_policies_business_id_mode_idx"
ON "hr_approval_policies"("business_id", "mode");
CREATE UNIQUE INDEX "hr_approval_decision_subject_stage_key"
ON "hr_approval_decisions"("business_id", "domain", "subject_id", "subject_revision", "stage");
CREATE INDEX "hr_approval_decision_subject_idx"
ON "hr_approval_decisions"("business_id", "domain", "subject_id", "subject_revision");
CREATE INDEX "hr_approval_decisions_actor_user_id_decided_at_idx"
ON "hr_approval_decisions"("actor_user_id", "decided_at");

ALTER TABLE "hr_approval_policies"
ADD CONSTRAINT "hr_approval_policies_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hr_approval_decisions"
ADD CONSTRAINT "hr_approval_decisions_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hr_approval_decisions"
ADD CONSTRAINT "hr_approval_decisions_actor_user_id_fkey"
FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hr_approval_policies"
ADD CONSTRAINT "hr_approval_policies_threshold_check"
CHECK (
  ("mode" <> 'TWO_LEVEL_THRESHOLD' AND "threshold_value" IS NULL)
  OR ("mode" = 'TWO_LEVEL_THRESHOLD' AND "threshold_value" > 0)
);
