CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TYPE "LoyaltyTransactionType" AS ENUM (
    'EARN',
    'WELCOME_BONUS',
    'REFUND_REVERSAL',
    'MANUAL_ADJUSTMENT'
);

CREATE TABLE "loyalty_programs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Loyalty Member',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "points_per_ringgit" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "welcome_points" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_memberships" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "points_balance" INTEGER NOT NULL DEFAULT 0,
    "lifetime_points_earned" INTEGER NOT NULL DEFAULT 0,
    "lifetime_points_reversed" INTEGER NOT NULL DEFAULT 0,
    "lifetime_points_adjusted" INTEGER NOT NULL DEFAULT 0,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "loyalty_transactions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID,
    "membership_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "payment_id" UUID,
    "refund_id" UUID,
    "created_by_id" UUID,
    "type" "LoyaltyTransactionType" NOT NULL,
    "points" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "loyalty_programs_business_id_key"
ON "loyalty_programs"("business_id");

CREATE UNIQUE INDEX "customer_memberships_customer_id_key"
ON "customer_memberships"("customer_id");

CREATE UNIQUE INDEX "customer_memberships_business_id_customer_id_key"
ON "customer_memberships"("business_id", "customer_id");

CREATE INDEX "customer_memberships_business_id_status_idx"
ON "customer_memberships"("business_id", "status");

CREATE INDEX "customer_memberships_business_id_points_balance_idx"
ON "customer_memberships"("business_id", "points_balance");

CREATE UNIQUE INDEX "loyalty_transactions_business_id_payment_id_earn_key"
ON "loyalty_transactions"("business_id", "payment_id")
WHERE "type" = 'EARN' AND "payment_id" IS NOT NULL;

CREATE UNIQUE INDEX "loyalty_transactions_business_id_refund_id_type_key"
ON "loyalty_transactions"("business_id", "refund_id", "type");

CREATE INDEX "loyalty_transactions_business_id_created_at_idx"
ON "loyalty_transactions"("business_id", "created_at");

CREATE INDEX "loyalty_transactions_branch_id_idx"
ON "loyalty_transactions"("branch_id");

CREATE INDEX "loyalty_transactions_membership_id_created_at_idx"
ON "loyalty_transactions"("membership_id", "created_at");

CREATE INDEX "loyalty_transactions_customer_id_created_at_idx"
ON "loyalty_transactions"("customer_id", "created_at");

CREATE INDEX "loyalty_transactions_payment_id_idx"
ON "loyalty_transactions"("payment_id");

CREATE INDEX "loyalty_transactions_refund_id_idx"
ON "loyalty_transactions"("refund_id");

ALTER TABLE "loyalty_programs"
ADD CONSTRAINT "loyalty_programs_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_memberships"
ADD CONSTRAINT "customer_memberships_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_memberships"
ADD CONSTRAINT "customer_memberships_customer_id_fkey"
FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "loyalty_transactions"
ADD CONSTRAINT "loyalty_transactions_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loyalty_transactions"
ADD CONSTRAINT "loyalty_transactions_branch_id_fkey"
FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "loyalty_transactions"
ADD CONSTRAINT "loyalty_transactions_membership_id_fkey"
FOREIGN KEY ("membership_id") REFERENCES "customer_memberships"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "loyalty_transactions"
ADD CONSTRAINT "loyalty_transactions_customer_id_fkey"
FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "loyalty_transactions"
ADD CONSTRAINT "loyalty_transactions_payment_id_fkey"
FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "loyalty_transactions"
ADD CONSTRAINT "loyalty_transactions_refund_id_fkey"
FOREIGN KEY ("refund_id") REFERENCES "payment_refunds"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "loyalty_transactions"
ADD CONSTRAINT "loyalty_transactions_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
