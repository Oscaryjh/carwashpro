ALTER TABLE "invoices" ALTER COLUMN "work_order_id" DROP NOT NULL;
ALTER TABLE "invoices" ADD COLUMN "customer_id" UUID;
ALTER TABLE "invoices" ADD COLUMN "customer_package_id" UUID;
CREATE UNIQUE INDEX "invoices_customer_package_id_key" ON "invoices"("customer_package_id");
CREATE INDEX "invoices_customer_id_idx" ON "invoices"("customer_id");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_package_id_fkey" FOREIGN KEY ("customer_package_id") REFERENCES "customer_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
