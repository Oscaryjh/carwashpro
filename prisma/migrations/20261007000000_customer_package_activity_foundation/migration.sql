-- CreateEnum
CREATE TYPE "CustomerPackageActivityType" AS ENUM ('PURCHASED', 'USED', 'RESTORED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomerPackageActivitySource" AS ENUM ('CHECKOUT', 'PAYMENT_REFUND', 'INVOICE_VOID');

-- CreateTable
CREATE TABLE "customer_package_activities" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "customer_package_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "event_type" "CustomerPackageActivityType" NOT NULL,
    "source_type" "CustomerPackageActivitySource" NOT NULL,
    "total_uses_snapshot" INTEGER NOT NULL,
    "remaining_before" INTEGER NOT NULL,
    "remaining_after" INTEGER NOT NULL,
    "uses_delta" INTEGER NOT NULL,
    "requested_uses" INTEGER,
    "status_before" "CustomerPackageStatus" NOT NULL,
    "status_after" "CustomerPackageStatus" NOT NULL,
    "customer_package_service_balance_id" UUID,
    "service_id" UUID,
    "service_changes" JSONB NOT NULL,
    "invoice_id" UUID,
    "invoice_item_id" UUID,
    "payment_id" UUID,
    "payment_refund_id" UUID,
    "appointment_id" UUID,
    "work_order_id" UUID,
    "original_use_activity_id" UUID,
    "additional_source_refs" JSONB,
    "financial_operation_id" UUID NOT NULL,
    "entry_key" VARCHAR(160) NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "assigned_staff_id" UUID,
    "branch_id" UUID,
    "reason" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contract_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "customer_package_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "package_activity_business_time_idx" ON "customer_package_activities"("business_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "package_activity_branch_time_idx" ON "customer_package_activities"("business_id", "branch_id", "occurred_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "package_activity_package_sequence_key" ON "customer_package_activities"("customer_package_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "package_activity_operation_entry_key" ON "customer_package_activities"("business_id", "financial_operation_id", "entry_key");

-- AddForeignKey
ALTER TABLE "customer_package_activities" ADD CONSTRAINT "customer_package_activities_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_package_activities" ADD CONSTRAINT "customer_package_activities_customer_package_id_fkey" FOREIGN KEY ("customer_package_id") REFERENCES "customer_packages"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_package_activities" ADD CONSTRAINT "customer_package_activities_customer_package_service_balan_fkey" FOREIGN KEY ("customer_package_service_balance_id") REFERENCES "customer_package_service_balances"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_package_activities" ADD CONSTRAINT "customer_package_activities_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_package_activities" ADD CONSTRAINT "customer_package_activities_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_package_activities" ADD CONSTRAINT "customer_package_activities_invoice_item_id_fkey" FOREIGN KEY ("invoice_item_id") REFERENCES "invoice_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_package_activities" ADD CONSTRAINT "customer_package_activities_business_id_payment_id_fkey" FOREIGN KEY ("business_id", "payment_id") REFERENCES "payments"("business_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_package_activities" ADD CONSTRAINT "customer_package_activities_business_id_payment_refund_id_fkey" FOREIGN KEY ("business_id", "payment_refund_id") REFERENCES "payment_refunds"("business_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_package_activities" ADD CONSTRAINT "customer_package_activities_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_package_activities" ADD CONSTRAINT "customer_package_activities_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_package_activities" ADD CONSTRAINT "customer_package_activities_original_use_activity_id_fkey" FOREIGN KEY ("original_use_activity_id") REFERENCES "customer_package_activities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_package_activities" ADD CONSTRAINT "customer_package_activities_business_id_financial_operatio_fkey" FOREIGN KEY ("business_id", "financial_operation_id") REFERENCES "financial_operations"("business_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_package_activities" ADD CONSTRAINT "customer_package_activities_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_package_activities" ADD CONSTRAINT "customer_package_activities_assigned_staff_id_fkey" FOREIGN KEY ("assigned_staff_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_package_activities" ADD CONSTRAINT "customer_package_activities_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Only real source identities participate; invoice items are intentionally not unique.
CREATE UNIQUE INDEX package_activity_purchase_source_key ON customer_package_activities(customer_package_id) WHERE event_type = 'PURCHASED';
CREATE UNIQUE INDEX package_activity_use_source_key ON customer_package_activities(payment_id) WHERE event_type = 'USED';
CREATE UNIQUE INDEX package_activity_refund_source_key ON customer_package_activities(payment_refund_id, payment_id) WHERE event_type = 'RESTORED' AND source_type = 'PAYMENT_REFUND';
CREATE UNIQUE INDEX package_activity_void_source_key ON customer_package_activities(payment_id) WHERE event_type = 'RESTORED' AND source_type = 'INVOICE_VOID';
CREATE UNIQUE INDEX package_activity_cancel_source_key ON customer_package_activities(customer_package_id) WHERE event_type = 'CANCELLED';

ALTER TABLE customer_package_activities
  ADD CONSTRAINT package_activity_balance_check CHECK (
    total_uses_snapshot >= 0 AND remaining_before BETWEEN 0 AND total_uses_snapshot
    AND remaining_after BETWEEN 0 AND total_uses_snapshot
    AND remaining_after::bigint - remaining_before::bigint = uses_delta::bigint
    AND (requested_uses IS NULL OR requested_uses >= 0)
    AND sequence > 0 AND contract_version = 1
  ),
  ADD CONSTRAINT package_activity_sign_check CHECK (
    (event_type = 'USED' AND uses_delta < 0)
    OR (event_type IN ('PURCHASED', 'RESTORED') AND uses_delta >= 0)
    OR (event_type = 'CANCELLED' AND uses_delta <= 0)
  ),
  ADD CONSTRAINT package_activity_source_check CHECK (
    (event_type = 'PURCHASED' AND source_type = 'CHECKOUT' AND invoice_id IS NOT NULL)
    OR (event_type = 'USED' AND source_type = 'CHECKOUT' AND payment_id IS NOT NULL AND invoice_id IS NOT NULL)
    OR (event_type = 'RESTORED' AND source_type = 'PAYMENT_REFUND' AND payment_id IS NOT NULL AND payment_refund_id IS NOT NULL AND invoice_id IS NOT NULL)
    OR (event_type = 'RESTORED' AND source_type = 'INVOICE_VOID' AND payment_id IS NOT NULL AND invoice_id IS NOT NULL)
    OR (event_type = 'CANCELLED' AND source_type = 'PAYMENT_REFUND' AND invoice_id IS NOT NULL)
  ),
  ADD CONSTRAINT package_activity_json_check CHECK (jsonb_typeof(service_changes) = 'array' AND (additional_source_refs IS NULL OR jsonb_typeof(additional_source_refs) = 'object'));

CREATE FUNCTION package_activity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CustomerPackageActivity is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER package_activity_immutable BEFORE UPDATE OR DELETE ON customer_package_activities FOR EACH ROW EXECUTE FUNCTION package_activity_immutable();
