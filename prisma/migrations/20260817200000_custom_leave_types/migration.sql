BEGIN;

-- Preserve every existing policy code while allowing each business to create
-- more than one genuinely custom Leave type. The existing tenant-scoped
-- unique index on (business_id, code) remains in force.
ALTER TABLE "leave_policies"
  ALTER COLUMN "code" TYPE VARCHAR(80)
  USING "code"::text;

DROP TYPE "LeavePolicyCode";

COMMIT;
