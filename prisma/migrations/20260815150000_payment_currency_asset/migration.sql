ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'FOREIGN_CURRENCY';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CRYPTO';

CREATE TYPE "BusinessPaymentMethodKind" AS ENUM (
  'LOCAL_TENDER',
  'FOREIGN_CURRENCY',
  'CRYPTO_ASSET'
);

ALTER TABLE "business_payment_methods"
  ADD COLUMN "payment_kind" "BusinessPaymentMethodKind" NOT NULL DEFAULT 'LOCAL_TENDER',
  ADD COLUMN "settlement_currency" VARCHAR(3) NOT NULL DEFAULT 'MYR',
  ADD COLUMN "asset_symbol" VARCHAR(12);

ALTER TABLE "payments"
  ADD COLUMN "tender_currency" VARCHAR(12) NOT NULL DEFAULT 'MYR',
  ADD COLUMN "tender_amount" DECIMAL(24, 8),
  ADD COLUMN "exchange_rate_to_myr" DECIMAL(20, 8);

ALTER TABLE "payment_refunds"
  ADD COLUMN "tender_currency" VARCHAR(12) NOT NULL DEFAULT 'MYR',
  ADD COLUMN "tender_amount" DECIMAL(24, 8),
  ADD COLUMN "exchange_rate_to_myr" DECIMAL(20, 8);
