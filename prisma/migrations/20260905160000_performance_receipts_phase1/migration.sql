-- AlterEnum
-- Phase 1 only. No historical backfill and no changes to commission/payroll/financial settlement.
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FinancialOperationType" ADD VALUE 'PERFORMANCE_SALES_CORRECTION';
ALTER TYPE "FinancialOperationType" ADD VALUE 'PERFORMANCE_TIP_CORRECTION';

-- CreateTable
CREATE TABLE "performance_attributions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "payment_id" UUID,
    "component" VARCHAR(8) NOT NULL,
    "scope_key" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_shares" (
    "id" UUID NOT NULL,
    "attribution_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "basis_points" INTEGER NOT NULL,
    "employee_name" TEXT NOT NULL,
    "employee_code" TEXT NOT NULL,

    CONSTRAINT "performance_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_receipts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID,
    "invoice_id" UUID,
    "payment_id" UUID NOT NULL,
    "refund_id" UUID,
    "source_key" TEXT NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "quality" VARCHAR(40) NOT NULL,
    "raw_cents" BIGINT NOT NULL,
    "sales_cents" BIGINT NOT NULL,
    "tax_cents" BIGINT NOT NULL,
    "tip_cents" BIGINT NOT NULL,
    "unresolved_cents" BIGINT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "local_date" VARCHAR(10) NOT NULL,
    "timezone" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_contributions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "attribution_id" UUID NOT NULL,
    "component" VARCHAR(8) NOT NULL,
    "membership_id" UUID,
    "recipient_key" TEXT NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_source_issues" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_source_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "performance_attributions_business_id_invoice_id_component_r_idx" ON "performance_attributions"("business_id", "invoice_id", "component", "revision");

-- CreateIndex
CREATE INDEX "performance_attributions_branch_id_idx" ON "performance_attributions"("branch_id");

-- CreateIndex
CREATE INDEX "performance_attributions_payment_id_idx" ON "performance_attributions"("payment_id");

-- CreateIndex
CREATE INDEX "performance_attributions_actor_user_id_idx" ON "performance_attributions"("actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "performance_attributions_business_id_scope_key_revision_key" ON "performance_attributions"("business_id", "scope_key", "revision");

-- CreateIndex
CREATE INDEX "performance_shares_membership_id_business_id_idx" ON "performance_shares"("membership_id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "performance_shares_attribution_id_membership_id_key" ON "performance_shares"("attribution_id", "membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "performance_receipts_refund_id_key" ON "performance_receipts"("refund_id");

-- CreateIndex
CREATE INDEX "performance_receipts_business_id_branch_id_occurred_at_id_idx" ON "performance_receipts"("business_id", "branch_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "performance_receipts_business_id_local_date_idx" ON "performance_receipts"("business_id", "local_date");

-- CreateIndex
CREATE INDEX "performance_receipts_payment_id_idx" ON "performance_receipts"("payment_id");

-- CreateIndex
CREATE INDEX "performance_receipts_invoice_id_idx" ON "performance_receipts"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "performance_receipts_business_id_source_key_key" ON "performance_receipts"("business_id", "source_key");

-- CreateIndex
CREATE INDEX "performance_contributions_business_id_membership_id_event_i_idx" ON "performance_contributions"("business_id", "membership_id", "event_id");

-- CreateIndex
CREATE INDEX "performance_contributions_attribution_id_idx" ON "performance_contributions"("attribution_id");

-- CreateIndex
CREATE UNIQUE INDEX "performance_contributions_event_id_attribution_id_component_key" ON "performance_contributions"("event_id", "attribution_id", "component", "recipient_key");

-- CreateIndex
CREATE INDEX "performance_source_issues_payment_id_idx" ON "performance_source_issues"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "performance_source_issues_business_id_payment_id_code_key" ON "performance_source_issues"("business_id", "payment_id", "code");

-- AddForeignKey
ALTER TABLE "performance_attributions" ADD CONSTRAINT "performance_attributions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_attributions" ADD CONSTRAINT "performance_attributions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_attributions" ADD CONSTRAINT "performance_attributions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_attributions" ADD CONSTRAINT "performance_attributions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_attributions" ADD CONSTRAINT "performance_attributions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_shares" ADD CONSTRAINT "performance_shares_attribution_id_fkey" FOREIGN KEY ("attribution_id") REFERENCES "performance_attributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_shares" ADD CONSTRAINT "performance_shares_membership_id_business_id_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_receipts" ADD CONSTRAINT "performance_receipts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_receipts" ADD CONSTRAINT "performance_receipts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_receipts" ADD CONSTRAINT "performance_receipts_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_receipts" ADD CONSTRAINT "performance_receipts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_receipts" ADD CONSTRAINT "performance_receipts_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "payment_refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_contributions" ADD CONSTRAINT "performance_contributions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "performance_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_contributions" ADD CONSTRAINT "performance_contributions_attribution_id_fkey" FOREIGN KEY ("attribution_id") REFERENCES "performance_attributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_contributions" ADD CONSTRAINT "performance_contributions_membership_id_business_id_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_source_issues" ADD CONSTRAINT "performance_source_issues_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_source_issues" ADD CONSTRAINT "performance_source_issues_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE performance_attributions ADD CONSTRAINT performance_attribution_shape CHECK (
  revision > 0 AND length(reason) >= 5 AND
  ((component = 'SALE' AND payment_id IS NULL AND scope_key = 'SALE:' || invoice_id::text) OR
   (component = 'TIP' AND payment_id IS NOT NULL AND scope_key = 'TIP:' || payment_id::text))
);
ALTER TABLE performance_shares ADD CONSTRAINT performance_share_bps CHECK (basis_points > 0 AND basis_points <= 10000);
ALTER TABLE performance_receipts ADD CONSTRAINT performance_receipt_conservation CHECK (
  raw_cents = sales_cents + tax_cents + tip_cents + unresolved_cents AND
  ((kind IN ('PAYMENT','PACKAGE') AND raw_cents >= 0 AND sales_cents >= 0 AND tax_cents >= 0 AND tip_cents >= 0 AND unresolved_cents >= 0 AND refund_id IS NULL) OR
   (kind IN ('REFUND','RESTORE') AND raw_cents <= 0 AND sales_cents <= 0 AND tax_cents <= 0 AND tip_cents <= 0 AND unresolved_cents <= 0 AND refund_id IS NOT NULL))
);
ALTER TABLE performance_contributions ADD CONSTRAINT performance_contribution_recipient CHECK (
  component IN ('SALE','TIP') AND
  ((membership_id IS NULL AND recipient_key = 'UNASSIGNED') OR (membership_id IS NOT NULL AND recipient_key = membership_id::text))
);
CREATE UNIQUE INDEX performance_origin_payment_unique ON performance_receipts(payment_id) WHERE refund_id IS NULL;
ALTER TABLE performance_receipts ADD CONSTRAINT performance_source_key CHECK (source_key = CASE WHEN refund_id IS NULL THEN 'PAYMENT:' || payment_id::text ELSE 'REFUND:' || refund_id::text END);

CREATE FUNCTION validate_performance_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attr performance_attributions; receipt performance_receipts; source_payment payments;
BEGIN
  IF TG_TABLE_NAME = 'performance_attributions' THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.actor_user_id AND business_id = NEW.business_id) THEN RAISE EXCEPTION 'Performance actor scope mismatch'; END IF;
    IF NOT EXISTS (SELECT 1 FROM invoices i JOIN branches b ON b.id = NEW.branch_id
      WHERE i.id = NEW.invoice_id AND i.business_id = NEW.business_id AND i.branch_id = NEW.branch_id AND b.business_id = NEW.business_id) THEN
      RAISE EXCEPTION 'Performance attribution tenant/branch mismatch';
    END IF;
    IF NEW.payment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = NEW.payment_id AND p.business_id = NEW.business_id AND p.invoice_id = NEW.invoice_id AND p.branch_id = NEW.branch_id) THEN
      RAISE EXCEPTION 'Performance tip payment scope mismatch';
    END IF;
  ELSIF TG_TABLE_NAME = 'performance_shares' THEN
    SELECT * INTO STRICT attr FROM performance_attributions WHERE id = NEW.attribution_id;
    -- Prisma supplies timestamps itself. Check the inserting transaction, not wall-clock equality.
    IF NOT EXISTS (SELECT 1 FROM performance_attributions WHERE id = NEW.attribution_id AND xmin::text::bigint = txid_current() % 4294967296) THEN RAISE EXCEPTION 'Performance shares require a new attribution version'; END IF;
    IF attr.business_id <> NEW.business_id OR (attr.component = 'TIP' AND NEW.basis_points <> 10000) THEN RAISE EXCEPTION 'Performance share scope mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'performance_receipts' THEN
    SELECT * INTO STRICT source_payment FROM payments WHERE id = NEW.payment_id;
    IF source_payment.business_id <> NEW.business_id OR source_payment.branch_id IS DISTINCT FROM NEW.branch_id OR source_payment.invoice_id IS DISTINCT FROM NEW.invoice_id THEN RAISE EXCEPTION 'Performance receipt source scope mismatch'; END IF;
    IF (NEW.kind IN ('PACKAGE','RESTORE')) <> (source_payment.method = 'PACKAGE') THEN RAISE EXCEPTION 'Performance noncash source mismatch'; END IF;
    IF NEW.refund_id IS NULL AND NEW.raw_cents <> (source_payment.amount * 100)::bigint THEN RAISE EXCEPTION 'Performance receipt source amount mismatch'; END IF;
    IF NEW.refund_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payment_refunds r WHERE r.id = NEW.refund_id AND r.business_id = NEW.business_id AND r.payment_id = NEW.payment_id AND r.branch_id IS NOT DISTINCT FROM NEW.branch_id AND (r.amount * 100)::bigint = -NEW.raw_cents) THEN RAISE EXCEPTION 'Performance refund source scope mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'performance_contributions' THEN
    SELECT * INTO STRICT attr FROM performance_attributions WHERE id = NEW.attribution_id;
    SELECT * INTO STRICT receipt FROM performance_receipts WHERE id = NEW.event_id;
    IF attr.business_id <> NEW.business_id OR receipt.business_id <> NEW.business_id OR attr.invoice_id IS DISTINCT FROM receipt.invoice_id OR attr.branch_id IS DISTINCT FROM receipt.branch_id OR attr.component <> NEW.component OR
      (attr.component = 'TIP' AND attr.payment_id <> receipt.payment_id) THEN RAISE EXCEPTION 'Performance contribution scope mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'performance_source_issues' THEN
    IF NOT EXISTS (SELECT 1 FROM payments WHERE id = NEW.payment_id AND business_id = NEW.business_id) THEN RAISE EXCEPTION 'Performance issue scope mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION performance_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Performance evidence is append-only; use a versioned correction'; END $$;

DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['performance_attributions','performance_shares','performance_receipts','performance_contributions','performance_source_issues'] LOOP
    EXECUTE format('CREATE TRIGGER performance_scope BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION validate_performance_scope()', table_name);
    EXECUTE format('CREATE TRIGGER performance_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION performance_append_only()', table_name);
  END LOOP;
END $$;

CREATE FUNCTION validate_performance_totals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_event_id uuid; target_attribution_id uuid; receipt performance_receipts; attr performance_attributions; sales bigint; tips bigint; ratio bigint; members bigint;
BEGIN
  IF TG_TABLE_NAME IN ('performance_receipts','performance_contributions') THEN
    IF TG_TABLE_NAME = 'performance_receipts' THEN target_event_id := NEW.id; ELSE target_event_id := NEW.event_id; END IF;
    SELECT * INTO STRICT receipt FROM performance_receipts WHERE id = target_event_id;
    SELECT COALESCE(sum(amount_cents) FILTER (WHERE component = 'SALE'),0), COALESCE(sum(amount_cents) FILTER (WHERE component = 'TIP'),0) INTO sales,tips FROM performance_contributions WHERE performance_contributions.event_id = target_event_id;
    IF (receipt.kind IN ('PAYMENT','REFUND') AND (sales <> receipt.sales_cents OR tips <> receipt.tip_cents)) OR (receipt.kind IN ('PACKAGE','RESTORE') AND (sales <> 0 OR tips <> 0)) THEN RAISE EXCEPTION 'Performance team/allocation conservation failed'; END IF;
  ELSE
    IF TG_TABLE_NAME = 'performance_attributions' THEN target_attribution_id := NEW.id; ELSE target_attribution_id := NEW.attribution_id; END IF;
    SELECT * INTO STRICT attr FROM performance_attributions WHERE id = target_attribution_id;
    SELECT COALESCE(sum(basis_points),0),count(*) INTO ratio,members FROM performance_shares WHERE performance_shares.attribution_id = target_attribution_id;
    IF ratio NOT IN (0,10000) OR (attr.component = 'TIP' AND members > 1) THEN RAISE EXCEPTION 'Performance shares must total 100 percent with one tip recipient'; END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER performance_receipt_totals AFTER INSERT ON performance_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_performance_totals();
CREATE CONSTRAINT TRIGGER performance_contribution_totals AFTER INSERT ON performance_contributions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_performance_totals();
CREATE CONSTRAINT TRIGGER performance_attribution_totals AFTER INSERT ON performance_attributions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_performance_totals();
CREATE CONSTRAINT TRIGGER performance_share_totals AFTER INSERT ON performance_shares DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_performance_totals();
