-- Published sources remain frozen. Draft/review inputs retain invalidation.
ALTER TYPE "PayrollEntryComponentSourceType" ADD VALUE 'PRIOR_PERIOD_PCB';
CREATE OR REPLACE FUNCTION invalidate_manual_pcb_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous JSONB; current_input JSONB; entry_id UUID; member_id UUID; run_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN previous := to_jsonb(NEW); ELSE previous := to_jsonb(OLD); END IF;
  IF TG_OP = 'UPDATE' THEN
    current_input := to_jsonb(NEW);
    IF TG_TABLE_NAME = 'payroll_runs' AND previous->'period_start' = current_input->'period_start' AND previous->'period_end' = current_input->'period_end' AND NOT (previous->>'status' = 'FINALIZED' AND current_input->>'status' = 'DRAFT') THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'employee_business_memberships' AND NOT EXISTS (
      SELECT 1 FROM unnest(ARRAY['pcb_profile','tax_profile_revision','statutory_profile_revision','statutory_nationality','date_of_birth','tax_identification_number','compensation_revision','recurring_pay_revision']) k
      WHERE previous->k IS DISTINCT FROM current_input->k
    ) THEN RETURN NEW; END IF;
    IF previous = current_input THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'payroll_entries' THEN entry_id := (previous->>'id')::uuid;
  ELSIF TG_TABLE_NAME = 'employee_business_memberships' THEN member_id := (previous->>'id')::uuid;
  ELSIF TG_TABLE_NAME = 'payroll_runs' THEN run_id := (previous->>'id')::uuid;
  ELSE entry_id := (previous->>'payroll_entry_id')::uuid; END IF;
  INSERT INTO payroll_manual_pcb_invalidations(id, confirmation_id, reason)
    SELECT gen_random_uuid(), c.id, 'INPUT_CHANGED' FROM payroll_manual_pcb_confirmations c
    WHERE (c.payroll_entry_id = entry_id OR c.membership_id = member_id OR c.payroll_run_id = run_id)
      AND NOT EXISTS (SELECT 1 FROM payroll_payslip_publications p JOIN payroll_runs r ON r.id = p.payroll_run_id
        WHERE p.payroll_entry_id = c.payroll_entry_id AND p.business_id = c.business_id AND r.status = 'FINALIZED')
    ON CONFLICT (confirmation_id) DO NOTHING;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TABLE payroll_pcb_publication_versions (
  id UUID PRIMARY KEY, business_id UUID NOT NULL, membership_id UUID NOT NULL,
  payroll_run_id UUID NOT NULL, payroll_entry_id UUID NOT NULL, publication_id UUID NOT NULL,
  payroll_month VARCHAR(7) NOT NULL CHECK (payroll_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  version INTEGER NOT NULL CHECK (version > 0), supersedes_id UUID UNIQUE REFERENCES payroll_pcb_publication_versions(id),
  amount DECIMAL(12,2) NOT NULL CHECK (amount >= 0), delta DECIMAL(12,2) NOT NULL,
  source_kind VARCHAR(16) NOT NULL CHECK (source_kind IN ('MANUAL','CALCULATED')),
  confirmation_id UUID REFERENCES payroll_manual_pcb_confirmations(id),
  original_input_digest CHAR(64) NOT NULL CHECK (original_input_digest ~ '^[a-f0-9]{64}$'),
  input_digest CHAR(64) NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'), input_version INTEGER NOT NULL CHECK (input_version = 1),
  input_evidence JSONB NOT NULL, document_run JSONB NOT NULL, document_entry JSONB NOT NULL,
  document_bytes BYTEA NOT NULL, document_sha256 CHAR(64) NOT NULL,
  reason VARCHAR(500) NOT NULL, external_reference VARCHAR(500) NOT NULL,
  actor_id UUID NOT NULL REFERENCES users(id), recorded_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  authorization_id UUID UNIQUE,
  UNIQUE(publication_id,version),
  FOREIGN KEY (publication_id,business_id) REFERENCES payroll_payslip_publications(id,business_id),
  FOREIGN KEY (payroll_entry_id,business_id,membership_id) REFERENCES payroll_entries(id,business_id,membership_id),
  FOREIGN KEY (payroll_run_id,business_id) REFERENCES payroll_runs(id,business_id),
  CHECK ((version = 1 AND supersedes_id IS NULL AND delta = 0) OR
    (version > 1 AND supersedes_id IS NOT NULL AND authorization_id IS NOT NULL AND length(trim(reason)) >= 5 AND length(trim(external_reference)) >= 5))
);
CREATE INDEX pcb_versions_scope_idx ON payroll_pcb_publication_versions(business_id,membership_id,payroll_month);
CREATE INDEX pcb_versions_entry_idx ON payroll_pcb_publication_versions(payroll_entry_id);
CREATE TRIGGER pcb_publication_version_immutable BEFORE UPDATE OR DELETE ON payroll_pcb_publication_versions FOR EACH ROW EXECUTE FUNCTION pcb_ledger_append_only();
CREATE FUNCTION pcb_version_chain_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payroll_payslip_publications; previous payroll_pcb_publication_versions;
BEGIN
  SELECT * INTO STRICT p FROM payroll_payslip_publications WHERE id = NEW.publication_id;
  IF p.business_id <> NEW.business_id OR p.membership_id <> NEW.membership_id OR p.payroll_entry_id <> NEW.payroll_entry_id OR p.payroll_run_id <> NEW.payroll_run_id THEN RAISE EXCEPTION 'PCB_SCOPE_MISMATCH'; END IF;
  IF NEW.version > 1 THEN
    SELECT * INTO STRICT previous FROM payroll_pcb_publication_versions WHERE id = NEW.supersedes_id;
    IF previous.publication_id <> NEW.publication_id OR previous.version + 1 <> NEW.version OR NEW.delta <> NEW.amount - previous.amount OR NEW.original_input_digest <> previous.original_input_digest THEN RAISE EXCEPTION 'PCB_VERSION_CONFLICT'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER pcb_version_chain BEFORE INSERT ON payroll_pcb_publication_versions FOR EACH ROW EXECUTE FUNCTION pcb_version_chain_guard();
CREATE TABLE payroll_pcb_settlement_events (
  id UUID PRIMARY KEY, business_id UUID NOT NULL REFERENCES businesses(id),
  correction_id UUID NOT NULL REFERENCES payroll_pcb_publication_versions(id),
  state VARCHAR(48) NOT NULL CHECK (state IN ('UNSETTLED','PENDING_NEXT_OPEN_RUN','APPLIED_TO_PAYROLL_NOT_PAYMENT')),
  payroll_entry_id UUID, component_id UUID, actor_id UUID NOT NULL REFERENCES users(id),
  recorded_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX pcb_settlement_scope_idx ON payroll_pcb_settlement_events(business_id,correction_id,recorded_at);
CREATE TRIGGER pcb_settlement_immutable BEFORE UPDATE OR DELETE ON payroll_pcb_settlement_events FOR EACH ROW EXECUTE FUNCTION pcb_ledger_append_only();
-- A correction delta may be represented by only one live component, across runs.
CREATE UNIQUE INDEX pcb_adjustment_once ON payroll_entry_components(source_id) WHERE code = 'PRIOR_PERIOD_PCB_ADJUSTMENT';
CREATE FUNCTION pcb_adjustment_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code = 'PRIOR_PERIOD_PCB_ADJUSTMENT' OR NEW.source_type::text = 'PRIOR_PERIOD_PCB' THEN
    IF NOT EXISTS (SELECT 1 FROM payroll_pcb_publication_versions v
      JOIN payroll_runs r ON r.id = NEW.payroll_run_id
      JOIN employee_business_memberships m ON m.id = NEW.membership_id
      WHERE v.id = NEW.source_id AND v.business_id = NEW.business_id AND v.membership_id = NEW.membership_id
        AND v.version > 1 AND v.delta <> 0 AND NEW.amount = abs(v.delta)
        AND NEW.type::text = CASE WHEN v.delta > 0 THEN 'DEDUCTION' ELSE 'EARNING' END
        AND NEW.source_type::text = 'PRIOR_PERIOD_PCB' AND NEW.code = 'PRIOR_PERIOD_PCB_ADJUSTMENT'
        AND NEW.origin::text = 'SYSTEM' AND NEW.source_version_id = v.id AND NEW.source_revision = v.version
        AND r.status = 'DRAFT' AND to_char(r.period_start,'YYYY-MM') > v.payroll_month AND m.status = 'ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM payroll_entries e JOIN payroll_runs earlier ON earlier.id = e.payroll_run_id
          WHERE e.business_id = NEW.business_id AND e.membership_id = NEW.membership_id AND earlier.status IN ('DRAFT','REVIEW')
            AND to_char(earlier.period_start,'YYYY-MM') > v.payroll_month AND earlier.period_start < r.period_start))
    THEN RAISE EXCEPTION 'PCB_ADJUSTMENT_SOURCE_MISMATCH'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER pcb_adjustment_source BEFORE INSERT OR UPDATE ON payroll_entry_components FOR EACH ROW EXECUTE FUNCTION pcb_adjustment_source_guard();
CREATE FUNCTION pcb_correction_invalidates_later_drafts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version > 1 THEN
    INSERT INTO payroll_manual_pcb_invalidations(id,confirmation_id,reason)
    SELECT gen_random_uuid(), c.id, 'PRIOR_PERIOD_PCB_CORRECTED' FROM payroll_manual_pcb_confirmations c
    WHERE c.business_id = NEW.business_id AND c.membership_id = NEW.membership_id
      AND c.payroll_month > NEW.payroll_month AND left(c.payroll_month,4) = left(NEW.payroll_month,4)
      AND NOT EXISTS (SELECT 1 FROM payroll_payslip_publications p WHERE p.payroll_entry_id = c.payroll_entry_id AND p.business_id = c.business_id)
    ON CONFLICT (confirmation_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER pcb_correction_ytd_invalidation AFTER INSERT ON payroll_pcb_publication_versions FOR EACH ROW EXECUTE FUNCTION pcb_correction_invalidates_later_drafts();
CREATE TRIGGER pcb_version_no_truncate BEFORE TRUNCATE ON payroll_pcb_publication_versions FOR EACH STATEMENT EXECUTE FUNCTION pcb_ledger_append_only();
CREATE TRIGGER pcb_settlement_no_truncate BEFORE TRUNCATE ON payroll_pcb_settlement_events FOR EACH STATEMENT EXECUTE FUNCTION pcb_ledger_append_only();

CREATE OR REPLACE FUNCTION tetamu_reconcile_payroll_entry_components_by_id(target_entry_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  e payroll_entries; earnings DECIMAL(14,2); deductions DECIMAL(14,2); allowances_total DECIMAL(14,2);
  recurring_earnings DECIMAL(14,2); recurring_deductions DECIMAL(14,2); reimbursements DECIMAL(14,2);
  prior_pcb_refund DECIMAL(14,2); expected_net DECIMAL(14,2);
BEGIN
  SELECT * INTO e FROM payroll_entries WHERE id = target_entry_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE type = 'EARNING' AND code <> 'PRIOR_PERIOD_PCB_ADJUSTMENT'),0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'DEDUCTION' AND source_type <> 'STATUTORY'),0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'EARNING' AND source_type IN ('RECURRING_PAY','MANUAL_ADJUSTMENT')),0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'EARNING' AND source_type = 'RECURRING_PAY'),0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'DEDUCTION' AND source_type = 'RECURRING_PAY'),0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'EARNING' AND code = 'PRIOR_PERIOD_PCB_ADJUSTMENT'),0)
  INTO earnings,deductions,allowances_total,recurring_earnings,recurring_deductions,prior_pcb_refund
  FROM payroll_entry_components WHERE payroll_entry_id = target_entry_id;
  SELECT COALESCE(SUM(amount),0) INTO reimbursements FROM payroll_claim_reimbursement_snapshots
    WHERE payroll_entry_id = target_entry_id AND status IN ('READY','SETTLED');
  expected_net := GREATEST(0,earnings-deductions-e.epf_employee-e.socso_employee-e.eis_employee-e.lindung_24_employee-e.pcb-e.cp38+reimbursements+prior_pcb_refund);
  IF e.gross_pay <> earnings OR e.allowances <> allowances_total OR e.other_deductions <> deductions
    OR e.recurring_allowances_snapshot <> recurring_earnings OR e.recurring_deductions_snapshot <> recurring_deductions OR e.net_pay <> expected_net
  THEN RAISE EXCEPTION 'PAYROLL_COMPONENT_RECONCILIATION_FAILED'; END IF;
END; $$;
