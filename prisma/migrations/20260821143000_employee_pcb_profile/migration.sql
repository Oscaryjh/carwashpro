ALTER TABLE "employee_business_memberships"
ADD COLUMN "pcb_profile" JSONB;

ALTER TABLE "employee_statutory_profile_versions"
ADD COLUMN "pcb_profile_snapshot" JSONB;
