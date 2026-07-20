CREATE TABLE "package_service_benefits" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "total_uses" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_service_benefits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_package_service_balances" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "customer_package_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "total_uses" INTEGER NOT NULL,
    "remaining_uses" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_package_service_balances_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payments"
ADD COLUMN "customer_package_service_balance_id" UUID;

CREATE UNIQUE INDEX "package_service_benefits_package_id_service_id_key"
ON "package_service_benefits"("package_id", "service_id");
CREATE INDEX "package_service_benefits_business_id_idx"
ON "package_service_benefits"("business_id");
CREATE INDEX "package_service_benefits_service_id_idx"
ON "package_service_benefits"("service_id");

CREATE UNIQUE INDEX "customer_package_service_balances_customer_package_id_service_id_key"
ON "customer_package_service_balances"("customer_package_id", "service_id");
CREATE INDEX "customer_package_service_balances_business_id_idx"
ON "customer_package_service_balances"("business_id");
CREATE INDEX "customer_package_service_balances_service_id_idx"
ON "customer_package_service_balances"("service_id");
CREATE INDEX "payments_customer_package_service_balance_id_idx"
ON "payments"("customer_package_service_balance_id");

ALTER TABLE "package_service_benefits"
ADD CONSTRAINT "package_service_benefits_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "package_service_benefits"
ADD CONSTRAINT "package_service_benefits_package_id_fkey"
FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "package_service_benefits"
ADD CONSTRAINT "package_service_benefits_service_id_fkey"
FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_package_service_balances"
ADD CONSTRAINT "customer_package_service_balances_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_package_service_balances"
ADD CONSTRAINT "customer_package_service_balances_customer_package_id_fkey"
FOREIGN KEY ("customer_package_id") REFERENCES "customer_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_package_service_balances"
ADD CONSTRAINT "customer_package_service_balances_service_id_fkey"
FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments"
ADD CONSTRAINT "payments_customer_package_service_balance_id_fkey"
FOREIGN KEY ("customer_package_service_balance_id") REFERENCES "customer_package_service_balances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "package_service_benefits" (
    "id", "business_id", "package_id", "service_id", "total_uses", "created_at", "updated_at"
)
SELECT gen_random_uuid(), "business_id", "id", "service_id", "total_uses", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "packages"
WHERE "service_id" IS NOT NULL;

INSERT INTO "customer_package_service_balances" (
    "id", "business_id", "customer_package_id", "service_id", "total_uses", "remaining_uses", "created_at", "updated_at"
)
SELECT gen_random_uuid(), cp."business_id", cp."id", p."service_id", cp."total_uses", cp."remaining_uses", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "customer_packages" cp
JOIN "packages" p ON p."id" = cp."package_id"
WHERE p."service_id" IS NOT NULL;

UPDATE "payments" payment
SET "customer_package_service_balance_id" = balance."id"
FROM "customer_package_service_balances" balance
WHERE payment."customer_package_id" = balance."customer_package_id"
  AND payment."method" = 'PACKAGE';
