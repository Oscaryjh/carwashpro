CREATE TYPE "EmployeePcbProfileRevisionStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'SUPERSEDED');

CREATE TABLE "employee_pcb_profile_revisions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "tax_year" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "base_tax_profile_revision" INTEGER NOT NULL,
    "status" "EmployeePcbProfileRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "payload" JSONB NOT NULL,
    "payload_digest" CHAR(64) NOT NULL,
    "change_reason" VARCHAR(500) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_by_name" VARCHAR(160) NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "updated_by_name" VARCHAR(160) NOT NULL,
    "confirmed_by_id" UUID,
    "confirmed_by_name" VARCHAR(160),
    "confirmed_at" TIMESTAMPTZ(3),
    "superseded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_pcb_profile_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_pcb_profile_revisions_membership_id_tax_year_revision_key"
ON "employee_pcb_profile_revisions"("membership_id", "tax_year", "revision");

CREATE INDEX "employee_pcb_profile_revisions_business_id_membership_id_tax_year_status_idx"
ON "employee_pcb_profile_revisions"("business_id", "membership_id", "tax_year", "status");

CREATE INDEX "employee_pcb_profile_revisions_business_id_confirmed_at_idx"
ON "employee_pcb_profile_revisions"("business_id", "confirmed_at");

ALTER TABLE "employee_pcb_profile_revisions"
ADD CONSTRAINT "employee_pcb_profile_revisions_membership_id_business_id_fkey"
FOREIGN KEY ("membership_id", "business_id")
REFERENCES "employee_business_memberships"("id", "business_id")
ON DELETE RESTRICT ON UPDATE CASCADE;
