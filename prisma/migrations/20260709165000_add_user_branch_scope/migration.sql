-- Add optional branch assignment for staff users.
ALTER TABLE "users" ADD COLUMN "branch_id" UUID;

CREATE INDEX "users_branch_id_idx" ON "users"("branch_id");

ALTER TABLE "users"
  ADD CONSTRAINT "users_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
