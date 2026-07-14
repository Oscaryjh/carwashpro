ALTER TABLE "payment_refunds"
ADD CONSTRAINT "payment_refunds_amount_positive"
CHECK ("amount" > 0);

ALTER TABLE "payment_refunds"
ADD CONSTRAINT "payment_refunds_package_uses_restored_nonnegative"
CHECK ("package_uses_restored" >= 0);
