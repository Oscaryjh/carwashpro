-- Keep the database component invariant aligned with the existing Claims-to-Payroll
-- bridge: a READY/SETTLED reimbursement increases net pay, never gross remuneration.
CREATE OR REPLACE FUNCTION tetamu_reconcile_payroll_entry_components_by_id(target_entry_id UUID)
RETURNS void AS $$
DECLARE
  entry_record RECORD;
  earning_total DECIMAL(14,2);
  deduction_total DECIMAL(14,2);
  allowance_total DECIMAL(14,2);
  recurring_earning_total DECIMAL(14,2);
  recurring_deduction_total DECIMAL(14,2);
  reimbursement_total DECIMAL(14,2);
  expected_net DECIMAL(14,2);
BEGIN
  SELECT * INTO entry_record FROM "payroll_entries" WHERE "id" = target_entry_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM("amount") FILTER (WHERE "type" = 'EARNING'), 0),
    COALESCE(SUM("amount") FILTER (WHERE "type" = 'DEDUCTION' AND "source_type" <> 'STATUTORY'), 0),
    COALESCE(SUM("amount") FILTER (WHERE "type" = 'EARNING' AND "source_type" IN ('RECURRING_PAY', 'MANUAL_ADJUSTMENT')), 0),
    COALESCE(SUM("amount") FILTER (WHERE "type" = 'EARNING' AND "source_type" = 'RECURRING_PAY'), 0),
    COALESCE(SUM("amount") FILTER (WHERE "type" = 'DEDUCTION' AND "source_type" = 'RECURRING_PAY'), 0)
  INTO earning_total, deduction_total, allowance_total, recurring_earning_total, recurring_deduction_total
  FROM "payroll_entry_components"
  WHERE "payroll_entry_id" = target_entry_id;

  SELECT COALESCE(SUM("amount"), 0)
  INTO reimbursement_total
  FROM "payroll_claim_reimbursement_snapshots"
  WHERE "payroll_entry_id" = target_entry_id
    AND "status" IN ('READY', 'SETTLED');

  expected_net := GREATEST(
    0,
    earning_total - deduction_total
      - entry_record."epf_employee"
      - entry_record."socso_employee"
      - entry_record."eis_employee"
      - entry_record."lindung_24_employee"
      - entry_record."pcb"
      + reimbursement_total
  );

  IF entry_record."gross_pay" <> earning_total
    OR entry_record."allowances" <> allowance_total
    OR entry_record."other_deductions" <> deduction_total
    OR entry_record."recurring_allowances_snapshot" <> recurring_earning_total
    OR entry_record."recurring_deductions_snapshot" <> recurring_deduction_total
    OR entry_record."net_pay" <> expected_net THEN
    RAISE EXCEPTION 'PAYROLL_COMPONENT_RECONCILIATION_FAILED';
  END IF;
END;
$$ LANGUAGE plpgsql;
