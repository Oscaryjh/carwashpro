-- Explicit classification replaces unsafe name-based guesses. Existing users remain
-- human accounts and existing employees remain non-test until reviewed and marked.
CREATE TYPE "UserAccountType" AS ENUM ('HUMAN', 'SERVICE');

ALTER TABLE "users"
  ADD COLUMN "account_type" "UserAccountType" NOT NULL DEFAULT 'HUMAN';

ALTER TABLE "employee_business_memberships"
  ADD COLUMN "is_test_account" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "users_business_id_account_type_status_idx"
  ON "users"("business_id", "account_type", "status");

CREATE INDEX "employee_business_memberships_business_id_is_test_account_status_idx"
  ON "employee_business_memberships"("business_id", "is_test_account", "status");
