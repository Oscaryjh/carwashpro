-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('LEGACY', 'SALE', 'WALLET_TOP_UP');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('TOP_UP_PAID', 'TOP_UP_BONUS', 'REDEMPTION', 'REFUND', 'REVERSAL', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "purpose" "PaymentPurpose" NOT NULL DEFAULT 'LEGACY';

-- CreateTable
CREATE TABLE "wallet_accounts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'MYR',
    "paid_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "bonus_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_top_up_offers" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "paid_amount" DECIMAL(10,2) NOT NULL,
    "bonus_amount" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_top_up_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_top_ups" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "wallet_account_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "offer_version" INTEGER NOT NULL,
    "offer_name_snapshot" TEXT NOT NULL,
    "paid_amount" DECIMAL(10,2) NOT NULL,
    "bonus_amount" DECIMAL(10,2) NOT NULL,
    "total_credited" DECIMAL(18,2) NOT NULL,
    "external_payment_id" UUID NOT NULL,
    "financial_operation_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_top_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_top_up_reversals" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "top_up_id" UUID NOT NULL,
    "external_refund_id" UUID NOT NULL,
    "financial_operation_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_top_up_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "wallet_account_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "paid_delta" DECIMAL(18,2) NOT NULL,
    "bonus_delta" DECIMAL(18,2) NOT NULL,
    "paid_balance_after" DECIMAL(18,2) NOT NULL,
    "bonus_balance_after" DECIMAL(18,2) NOT NULL,
    "policy_version" TEXT NOT NULL,
    "financial_operation_id" UUID NOT NULL,
    "entry_key" TEXT NOT NULL,
    "top_up_id" UUID,
    "payment_id" UUID,
    "refund_id" UUID,
    "original_transaction_id" UUID,
    "branch_id" UUID,
    "actor_user_id" UUID NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_accounts_business_id_customer_id_key" ON "wallet_accounts"("business_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_accounts_business_id_id_key" ON "wallet_accounts"("business_id", "id");

-- CreateIndex
CREATE INDEX "wallet_top_up_offers_business_id_active_idx" ON "wallet_top_up_offers"("business_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_top_up_offers_business_id_id_key" ON "wallet_top_up_offers"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_top_ups_external_payment_id_key" ON "wallet_top_ups"("external_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_top_ups_financial_operation_id_key" ON "wallet_top_ups"("financial_operation_id");

-- CreateIndex
CREATE INDEX "wallet_top_ups_business_id_wallet_account_id_posted_at_idx" ON "wallet_top_ups"("business_id", "wallet_account_id", "posted_at");

-- CreateIndex
CREATE INDEX "wallet_top_ups_business_id_offer_id_idx" ON "wallet_top_ups"("business_id", "offer_id");

-- CreateIndex
CREATE INDEX "wallet_top_ups_business_id_branch_id_idx" ON "wallet_top_ups"("business_id", "branch_id");

-- CreateIndex
CREATE INDEX "wallet_top_ups_business_id_shift_id_idx" ON "wallet_top_ups"("business_id", "shift_id");

-- CreateIndex
CREATE INDEX "wallet_top_ups_actor_user_id_idx" ON "wallet_top_ups"("actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_top_ups_business_id_id_key" ON "wallet_top_ups"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_top_up_reversals_top_up_id_key" ON "wallet_top_up_reversals"("top_up_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_top_up_reversals_external_refund_id_key" ON "wallet_top_up_reversals"("external_refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_top_up_reversals_financial_operation_id_key" ON "wallet_top_up_reversals"("financial_operation_id");

-- CreateIndex
CREATE INDEX "wallet_top_up_reversals_business_id_created_at_idx" ON "wallet_top_up_reversals"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_top_up_reversals_actor_user_id_idx" ON "wallet_top_up_reversals"("actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_payment_id_key" ON "wallet_transactions"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_refund_id_key" ON "wallet_transactions"("refund_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_business_id_wallet_account_id_created_a_idx" ON "wallet_transactions"("business_id", "wallet_account_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_transactions_business_id_original_transaction_id_idx" ON "wallet_transactions"("business_id", "original_transaction_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_business_id_top_up_id_idx" ON "wallet_transactions"("business_id", "top_up_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_business_id_branch_id_created_at_idx" ON "wallet_transactions"("business_id", "branch_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_transactions_actor_user_id_idx" ON "wallet_transactions"("actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_business_id_id_key" ON "wallet_transactions"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_wallet_account_id_sequence_key" ON "wallet_transactions"("wallet_account_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_business_id_financial_operation_id_entr_key" ON "wallet_transactions"("business_id", "financial_operation_id", "entry_key");

-- CreateIndex
CREATE UNIQUE INDEX "branches_wallet_scope_key" ON "branches"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_wallet_scope_key" ON "customers"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_wallet_scope_key" ON "payments"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_wallet_scope_key" ON "payment_refunds"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "operations_wallet_scope_key" ON "financial_operations"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_wallet_scope_key" ON "cashier_shifts"("business_id", "id");

-- AddForeignKey
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_business_id_customer_id_fkey" FOREIGN KEY ("business_id", "customer_id") REFERENCES "customers"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_up_offers" ADD CONSTRAINT "wallet_top_up_offers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_business_id_wallet_account_id_fkey" FOREIGN KEY ("business_id", "wallet_account_id") REFERENCES "wallet_accounts"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_business_id_offer_id_fkey" FOREIGN KEY ("business_id", "offer_id") REFERENCES "wallet_top_up_offers"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_business_id_external_payment_id_fkey" FOREIGN KEY ("business_id", "external_payment_id") REFERENCES "payments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_business_id_financial_operation_id_fkey" FOREIGN KEY ("business_id", "financial_operation_id") REFERENCES "financial_operations"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_business_id_branch_id_fkey" FOREIGN KEY ("business_id", "branch_id") REFERENCES "branches"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_business_id_shift_id_fkey" FOREIGN KEY ("business_id", "shift_id") REFERENCES "cashier_shifts"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_up_reversals" ADD CONSTRAINT "wallet_top_up_reversals_business_id_top_up_id_fkey" FOREIGN KEY ("business_id", "top_up_id") REFERENCES "wallet_top_ups"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_up_reversals" ADD CONSTRAINT "wallet_top_up_reversals_business_id_external_refund_id_fkey" FOREIGN KEY ("business_id", "external_refund_id") REFERENCES "payment_refunds"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_up_reversals" ADD CONSTRAINT "wallet_top_up_reversals_business_id_financial_operation_id_fkey" FOREIGN KEY ("business_id", "financial_operation_id") REFERENCES "financial_operations"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_up_reversals" ADD CONSTRAINT "wallet_top_up_reversals_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_business_id_wallet_account_id_fkey" FOREIGN KEY ("business_id", "wallet_account_id") REFERENCES "wallet_accounts"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_business_id_financial_operation_id_fkey" FOREIGN KEY ("business_id", "financial_operation_id") REFERENCES "financial_operations"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_business_id_top_up_id_fkey" FOREIGN KEY ("business_id", "top_up_id") REFERENCES "wallet_top_ups"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_business_id_payment_id_fkey" FOREIGN KEY ("business_id", "payment_id") REFERENCES "payments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_business_id_refund_id_fkey" FOREIGN KEY ("business_id", "refund_id") REFERENCES "payment_refunds"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_business_id_original_transaction_id_fkey" FOREIGN KEY ("business_id", "original_transaction_id") REFERENCES "wallet_transactions"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_business_id_branch_id_fkey" FOREIGN KEY ("business_id", "branch_id") REFERENCES "branches"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Local checks cannot validate relations: deferred triggers below validate the committed graph.
ALTER TABLE wallet_accounts ADD CONSTRAINT wallet_account_values CHECK
  (currency = 'MYR' AND paid_balance >= 0 AND bonus_balance >= 0 AND version >= 0);
ALTER TABLE wallet_top_up_offers ADD CONSTRAINT wallet_offer_values CHECK
  (paid_amount > 0 AND bonus_amount >= 0 AND version >= 0 AND length(trim(name)) > 0);
ALTER TABLE wallet_top_ups ADD CONSTRAINT wallet_top_up_values CHECK
  (paid_amount > 0 AND bonus_amount >= 0 AND total_credited = paid_amount + bonus_amount AND offer_version >= 0);
ALTER TABLE wallet_top_up_reversals ADD CONSTRAINT wallet_reversal_reason CHECK (length(trim(reason)) > 0);
ALTER TABLE payments ADD CONSTRAINT wallet_payment_purpose CHECK
  ((method <> 'MEMBER_WALLET' OR (purpose = 'SALE' AND amount > 0 AND invoice_id IS NOT NULL))
   AND (purpose <> 'WALLET_TOP_UP' OR (method IN ('CASH','CARD','DUITNOW','EWALLET','BANK_TRANSFER')
     AND amount > 0 AND invoice_id IS NULL AND work_order_id IS NULL AND appointment_id IS NULL AND tender_currency = 'MYR')));
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_ledger_shape CHECK (
  sequence > 0 AND paid_balance_after >= 0 AND bonus_balance_after >= 0
  AND length(trim(policy_version)) > 0 AND length(trim(entry_key)) > 0
  AND (
    (type = 'TOP_UP_PAID' AND paid_delta > 0 AND bonus_delta = 0 AND top_up_id IS NOT NULL AND payment_id IS NULL AND refund_id IS NULL AND original_transaction_id IS NULL)
    OR (type = 'TOP_UP_BONUS' AND bonus_delta > 0 AND paid_delta = 0 AND top_up_id IS NOT NULL AND payment_id IS NULL AND refund_id IS NULL AND original_transaction_id IS NULL)
    OR (type = 'REDEMPTION' AND paid_delta <= 0 AND bonus_delta <= 0 AND paid_delta + bonus_delta < 0 AND payment_id IS NOT NULL AND top_up_id IS NULL AND refund_id IS NULL AND original_transaction_id IS NULL)
    OR (type = 'REFUND' AND paid_delta >= 0 AND bonus_delta >= 0 AND paid_delta + bonus_delta > 0 AND refund_id IS NOT NULL AND original_transaction_id IS NOT NULL AND top_up_id IS NULL AND payment_id IS NULL)
    OR (type = 'REVERSAL' AND paid_delta + bonus_delta <> 0 AND original_transaction_id IS NOT NULL AND top_up_id IS NULL AND payment_id IS NULL AND refund_id IS NULL)
  )
); -- ADJUSTMENT reserved but deliberately not writable in Phase 1.
CREATE UNIQUE INDEX wallet_top_up_component_unique ON wallet_transactions(top_up_id, type) WHERE top_up_id IS NOT NULL;
CREATE UNIQUE INDEX wallet_full_reversal_unique ON wallet_transactions(original_transaction_id) WHERE type = 'REVERSAL';

CREATE FUNCTION wallet_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WALLET_IMMUTABLE_HISTORY' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER wallet_ledger_immutable BEFORE UPDATE OR DELETE ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION wallet_immutable();
CREATE TRIGGER wallet_top_up_immutable BEFORE UPDATE OR DELETE ON wallet_top_ups FOR EACH ROW EXECUTE FUNCTION wallet_immutable();
CREATE TRIGGER wallet_reversal_immutable BEFORE UPDATE OR DELETE ON wallet_top_up_reversals FOR EACH ROW EXECUTE FUNCTION wallet_immutable();

-- Protect identifiers and financial source facts, not unrelated legacy payments.
CREATE FUNCTION wallet_protect_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='wallet_accounts' THEN
    IF ROW(NEW.id,NEW.business_id,NEW.customer_id,NEW.currency) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.customer_id,OLD.currency) THEN
      RAISE EXCEPTION 'WALLET_ACCOUNT_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='payments' THEN
    IF EXISTS(SELECT 1 FROM wallet_top_ups WHERE external_payment_id=OLD.id)
      OR EXISTS(SELECT 1 FROM wallet_transactions WHERE payment_id=OLD.id) THEN
      IF ROW(NEW.id,NEW.business_id,NEW.amount,NEW.method,NEW.purpose,NEW.invoice_id,NEW.branch_id,NEW.shift_id,NEW.tender_currency,NEW.work_order_id,NEW.appointment_id)
        IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.amount,OLD.method,OLD.purpose,OLD.invoice_id,OLD.branch_id,OLD.shift_id,OLD.tender_currency,OLD.work_order_id,OLD.appointment_id)
        OR (OLD.purpose='WALLET_TOP_UP' AND NEW.status IS DISTINCT FROM OLD.status) THEN
        RAISE EXCEPTION 'WALLET_PAYMENT_SOURCE_IMMUTABLE' USING ERRCODE='23514';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME='payment_refunds' THEN
    IF EXISTS(SELECT 1 FROM wallet_top_up_reversals WHERE external_refund_id=OLD.id)
      OR EXISTS(SELECT 1 FROM wallet_transactions WHERE refund_id=OLD.id) THEN
      IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
        RAISE EXCEPTION 'WALLET_REFUND_SOURCE_IMMUTABLE' USING ERRCODE='23514';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME='invoices' THEN
    IF EXISTS(SELECT 1 FROM payments WHERE invoice_id=OLD.id AND method='MEMBER_WALLET')
      AND ROW(NEW.id,NEW.business_id,NEW.customer_id,NEW.branch_id) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.customer_id,OLD.branch_id) THEN
      RAISE EXCEPTION 'WALLET_INVOICE_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_account_identity BEFORE UPDATE ON wallet_accounts FOR EACH ROW EXECUTE FUNCTION wallet_protect_source();
CREATE TRIGGER wallet_payment_identity BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION wallet_protect_source();
CREATE TRIGGER wallet_refund_identity BEFORE UPDATE ON payment_refunds FOR EACH ROW EXECUTE FUNCTION wallet_protect_source();
CREATE TRIGGER wallet_invoice_identity BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION wallet_protect_source();

CREATE FUNCTION wallet_validate_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE aid uuid; a wallet_accounts; p numeric; b numeric; n integer;
BEGIN
  IF TG_TABLE_NAME = 'wallet_accounts' THEN
    aid := NEW.id;
  ELSE
    aid := NEW.wallet_account_id;
  END IF;
  SELECT * INTO a FROM wallet_accounts WHERE id=aid;
  SELECT coalesce(sum(paid_delta),0),coalesce(sum(bonus_delta),0),count(*) INTO p,b,n FROM wallet_transactions WHERE wallet_account_id=aid;
  IF a.paid_balance <> p OR a.bonus_balance <> b OR a.version <> n THEN
    RAISE EXCEPTION 'WALLET_BALANCE_LEDGER_MISMATCH' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM (
    SELECT sequence, paid_balance_after,bonus_balance_after,
      row_number() OVER (ORDER BY sequence) AS seq,
      sum(paid_delta) OVER (ORDER BY sequence) AS paid,
      sum(bonus_delta) OVER (ORDER BY sequence) AS bonus
    FROM wallet_transactions WHERE wallet_account_id=aid
  ) h WHERE sequence<>seq OR paid_balance_after<>paid OR bonus_balance_after<>bonus) THEN
    RAISE EXCEPTION 'WALLET_SEQUENCE_SNAPSHOT_MISMATCH' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER wallet_account_ledger_match AFTER INSERT OR UPDATE ON wallet_accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallet_validate_account();
CREATE CONSTRAINT TRIGGER wallet_ledger_account_match AFTER INSERT ON wallet_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallet_validate_account();

CREATE FUNCTION wallet_validate_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o wallet_transactions; t wallet_top_ups; p payments; r payment_refunds; a wallet_accounts; paid numeric; bonus numeric;
BEGIN
  SELECT * INTO a FROM wallet_accounts WHERE id=NEW.wallet_account_id;
  IF NEW.type IN ('TOP_UP_PAID','TOP_UP_BONUS') THEN
    SELECT * INTO t FROM wallet_top_ups WHERE id=NEW.top_up_id;
    IF t.wallet_account_id<>NEW.wallet_account_id OR t.financial_operation_id<>NEW.financial_operation_id
      OR NEW.branch_id IS DISTINCT FROM t.branch_id
      OR (NEW.type='TOP_UP_PAID' AND NEW.paid_delta<>t.paid_amount)
      OR (NEW.type='TOP_UP_BONUS' AND NEW.bonus_delta<>t.bonus_amount) THEN
      RAISE EXCEPTION 'WALLET_TOP_UP_SOURCE_MISMATCH' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.type='REDEMPTION' THEN
    SELECT * INTO p FROM payments WHERE id=NEW.payment_id;
    IF p.method<>'MEMBER_WALLET' OR p.purpose<>'SALE' OR p.amount<>-(NEW.paid_delta+NEW.bonus_delta)
      OR p.branch_id IS DISTINCT FROM NEW.branch_id OR NOT EXISTS (
        SELECT 1 FROM invoices i WHERE i.id=p.invoice_id AND i.business_id=NEW.business_id AND i.customer_id=a.customer_id)
    THEN RAISE EXCEPTION 'WALLET_PAYMENT_SOURCE_MISMATCH' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT * INTO o FROM wallet_transactions WHERE id=NEW.original_transaction_id;
    IF o.wallet_account_id<>NEW.wallet_account_id OR o.sequence>=NEW.sequence THEN
      RAISE EXCEPTION 'WALLET_ORIGINAL_SOURCE_MISMATCH' USING ERRCODE='23514';
    END IF;
    IF NEW.type='REFUND' THEN
      SELECT * INTO r FROM payment_refunds WHERE id=NEW.refund_id;
      IF o.type<>'REDEMPTION' OR r.payment_id IS DISTINCT FROM o.payment_id OR r.method<>'MEMBER_WALLET'
        OR r.amount<>NEW.paid_delta+NEW.bonus_delta OR r.branch_id IS DISTINCT FROM NEW.branch_id THEN
        RAISE EXCEPTION 'WALLET_REFUND_SOURCE_MISMATCH' USING ERRCODE='23514';
      END IF;
      SELECT coalesce(sum(paid_delta),0),coalesce(sum(bonus_delta),0) INTO paid,bonus
        FROM wallet_transactions WHERE original_transaction_id=o.id AND type='REFUND';
      IF paid > -o.paid_delta OR bonus > -o.bonus_delta OR EXISTS(
        SELECT 1 FROM wallet_transactions WHERE original_transaction_id=o.id AND type='REVERSAL') THEN
        RAISE EXCEPTION 'WALLET_REFUND_EXCEEDS_SOURCE' USING ERRCODE='23514';
      END IF;
    ELSE
      IF NEW.paid_delta<>-o.paid_delta OR NEW.bonus_delta<>-o.bonus_delta
        OR o.type NOT IN ('REDEMPTION','TOP_UP_PAID','TOP_UP_BONUS')
        OR EXISTS(SELECT 1 FROM wallet_transactions WHERE original_transaction_id=o.id AND type='REFUND') THEN
        RAISE EXCEPTION 'WALLET_REVERSAL_SOURCE_MISMATCH' USING ERRCODE='23514';
      END IF;
      IF o.type='REDEMPTION' AND NOT EXISTS(SELECT 1 FROM payments WHERE id=o.payment_id AND status='VOID') THEN
        RAISE EXCEPTION 'WALLET_REVERSAL_REQUIRES_VOID' USING ERRCODE='23514';
      ELSIF o.type IN ('TOP_UP_PAID','TOP_UP_BONUS') AND NOT EXISTS(
        SELECT 1 FROM wallet_top_up_reversals WHERE top_up_id=o.top_up_id AND financial_operation_id=NEW.financial_operation_id) THEN
        RAISE EXCEPTION 'WALLET_REVERSAL_REQUIRES_TOP_UP_SOURCE' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER wallet_transaction_source AFTER INSERT ON wallet_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallet_validate_transaction();

CREATE FUNCTION wallet_validate_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payments; rid uuid;
BEGIN
  IF TG_TABLE_NAME='payments' THEN
    SELECT * INTO p FROM payments WHERE id=NEW.id;
    IF p.method='MEMBER_WALLET' AND NOT EXISTS(SELECT 1 FROM wallet_transactions WHERE payment_id=p.id AND type='REDEMPTION') THEN
      RAISE EXCEPTION 'WALLET_PAYMENT_REQUIRES_LEDGER' USING ERRCODE='23514';
    END IF;
    IF p.method='MEMBER_WALLET' AND p.status='VOID' AND NOT EXISTS(
      SELECT 1 FROM wallet_transactions o JOIN wallet_transactions r ON r.original_transaction_id=o.id WHERE o.payment_id=p.id AND r.type='REVERSAL') THEN
      RAISE EXCEPTION 'WALLET_VOID_REQUIRES_REVERSAL' USING ERRCODE='23514';
    END IF;
    IF p.method='MEMBER_WALLET' AND p.status<>'VOID' AND EXISTS(
      SELECT 1 FROM wallet_transactions o JOIN wallet_transactions r ON r.original_transaction_id=o.id
      WHERE o.payment_id=p.id AND r.type='REVERSAL') THEN
      RAISE EXCEPTION 'WALLET_REVERSAL_REQUIRES_VOID' USING ERRCODE='23514';
    END IF;
    IF p.purpose='WALLET_TOP_UP' AND NOT EXISTS(SELECT 1 FROM wallet_top_ups WHERE external_payment_id=p.id) THEN
      RAISE EXCEPTION 'WALLET_PAYMENT_REQUIRES_TOP_UP' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO p FROM payments WHERE id=NEW.payment_id;
    IF p.method='MEMBER_WALLET' AND (NEW.method<>'MEMBER_WALLET' OR NOT EXISTS(
      SELECT 1 FROM wallet_transactions WHERE refund_id=NEW.id AND type='REFUND')) THEN
      RAISE EXCEPTION 'WALLET_REFUND_REQUIRES_LEDGER' USING ERRCODE='23514';
    END IF;
    IF NEW.method='MEMBER_WALLET' AND p.method<>'MEMBER_WALLET' THEN
      RAISE EXCEPTION 'WALLET_REFUND_WRONG_TENDER' USING ERRCODE='23514';
    END IF;
    IF p.purpose='WALLET_TOP_UP' AND NOT EXISTS(SELECT 1 FROM wallet_top_up_reversals WHERE external_refund_id=NEW.id) THEN
      RAISE EXCEPTION 'WALLET_REFUND_REQUIRES_TOP_UP_REVERSAL' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER wallet_payment_graph AFTER INSERT OR UPDATE ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallet_validate_payment();
CREATE CONSTRAINT TRIGGER wallet_refund_graph AFTER INSERT OR UPDATE ON payment_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallet_validate_payment();

CREATE FUNCTION wallet_validate_top_up() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t wallet_top_ups; p payments; r payment_refunds;
BEGIN
  IF TG_TABLE_NAME='wallet_top_ups' THEN
    t := NEW;
    SELECT * INTO p FROM payments WHERE id=t.external_payment_id;
    IF p.purpose<>'WALLET_TOP_UP' OR p.status<>'ACTIVE' OR p.amount<>t.paid_amount OR p.branch_id IS DISTINCT FROM t.branch_id OR p.shift_id IS DISTINCT FROM t.shift_id
      OR NOT EXISTS(SELECT 1 FROM cashier_shifts WHERE id=t.shift_id AND branch_id=t.branch_id)
      OR NOT EXISTS(SELECT 1 FROM wallet_transactions WHERE top_up_id=t.id AND type='TOP_UP_PAID')
      OR (t.bonus_amount>0 AND NOT EXISTS(SELECT 1 FROM wallet_transactions WHERE top_up_id=t.id AND type='TOP_UP_BONUS')) THEN
      RAISE EXCEPTION 'WALLET_TOP_UP_GRAPH_MISMATCH' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO t FROM wallet_top_ups WHERE id=NEW.top_up_id;
    SELECT * INTO r FROM payment_refunds WHERE id=NEW.external_refund_id;
    SELECT * INTO p FROM payments WHERE id=t.external_payment_id;
    IF r.payment_id<>p.id OR r.amount<>t.paid_amount OR r.method<>p.method
      OR (SELECT count(*) FROM wallet_transactions o JOIN wallet_transactions v ON v.original_transaction_id=o.id
          WHERE o.top_up_id=t.id AND v.type='REVERSAL' AND v.financial_operation_id=NEW.financial_operation_id)
          <> (CASE WHEN t.bonus_amount>0 THEN 2 ELSE 1 END) THEN
      RAISE EXCEPTION 'WALLET_TOP_UP_REVERSAL_GRAPH_MISMATCH' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER wallet_top_up_graph AFTER INSERT ON wallet_top_ups DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallet_validate_top_up();
CREATE CONSTRAINT TRIGGER wallet_top_up_reversal_graph AFTER INSERT ON wallet_top_up_reversals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallet_validate_top_up();
