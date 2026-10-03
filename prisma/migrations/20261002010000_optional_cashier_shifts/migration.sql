ALTER TABLE "businesses" ADD COLUMN "cashier_shifts_enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "wallet_top_ups" ALTER COLUMN "shift_id" DROP NOT NULL;

-- Preserve every graph guard; only skip Shift existence for paired NULL legs.
CREATE OR REPLACE FUNCTION wallet_validate_top_up() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t wallet_top_ups; p payments; r payment_refunds;
BEGIN
  IF TG_TABLE_NAME='wallet_top_ups' THEN
    t := NEW;
    SELECT * INTO p FROM payments WHERE id=t.external_payment_id;
    IF p.purpose<>'WALLET_TOP_UP' OR p.status<>'ACTIVE' OR p.amount<>t.paid_amount OR p.branch_id IS DISTINCT FROM t.branch_id OR p.shift_id IS DISTINCT FROM t.shift_id
      OR (t.shift_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cashier_shifts WHERE id=t.shift_id AND branch_id=t.branch_id))
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
