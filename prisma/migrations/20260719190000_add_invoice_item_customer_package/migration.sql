ALTER TABLE "invoice_items"
ADD COLUMN "customer_package_id" UUID;

CREATE INDEX "invoice_items_customer_package_id_idx"
ON "invoice_items"("customer_package_id");

ALTER TABLE "invoice_items"
ADD CONSTRAINT "invoice_items_customer_package_id_fkey"
FOREIGN KEY ("customer_package_id") REFERENCES "customer_packages"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
