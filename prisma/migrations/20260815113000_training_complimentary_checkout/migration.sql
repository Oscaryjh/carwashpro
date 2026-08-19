CREATE TYPE "BusinessPaymentMethodBehavior" AS ENUM ('STANDARD_TENDER', 'TRAINING_COMPLIMENTARY');
CREATE TYPE "InvoiceCheckoutType" AS ENUM ('STANDARD', 'TRAINING_COMPLIMENTARY');

ALTER TABLE "business_payment_methods"
ADD COLUMN "behavior" "BusinessPaymentMethodBehavior" NOT NULL DEFAULT 'STANDARD_TENDER';

ALTER TABLE "invoices"
ADD COLUMN "checkout_type" "InvoiceCheckoutType" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN "checkout_reason" VARCHAR(500);

ALTER TABLE "commission_source_events"
ADD COLUMN "gross_basis_override" BOOLEAN NOT NULL DEFAULT false;
