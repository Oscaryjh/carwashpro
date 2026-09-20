CREATE TABLE "payroll_manual_pcb_confirmations" (
  "id" UUID PRIMARY KEY, "business_id" UUID NOT NULL, "membership_id" UUID NOT NULL,
  "payroll_run_id" UUID NOT NULL, "payroll_entry_id" UUID NOT NULL,
  "payroll_month" VARCHAR(7) NOT NULL CHECK ("payroll_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  "input_revision" INTEGER NOT NULL CHECK ("input_revision" >= 0),
  "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" >= 0),
  "external_reference" VARCHAR(500) NOT NULL CHECK (length(trim("external_reference")) >= 5),
  "input_digest" CHAR(64) NOT NULL CHECK ("input_digest" ~ '^[a-f0-9]{64}$'),
  "input_version" INTEGER NOT NULL CHECK ("input_version" = 1),
  "source_version" INTEGER NOT NULL CHECK ("source_version" > 0),
  "input_evidence" JSONB NOT NULL, "confirmed_by_id" UUID NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "authorization_id" UUID NOT NULL
);
CREATE UNIQUE INDEX "payroll_manual_pcb_confirmations_authorization_id_key" ON "payroll_manual_pcb_confirmations"("authorization_id");
CREATE UNIQUE INDEX "payroll_manual_pcb_confirmations_payroll_entry_id_source_versi_key" ON "payroll_manual_pcb_confirmations"("payroll_entry_id", "source_version");
CREATE INDEX "payroll_manual_pcb_confirmations_business_id_membership_id_pa_idx" ON "payroll_manual_pcb_confirmations"("business_id", "membership_id", "payroll_month");
CREATE INDEX "payroll_manual_pcb_confirmations_payroll_run_id_idx" ON "payroll_manual_pcb_confirmations"("payroll_run_id");
CREATE TABLE "payroll_manual_pcb_invalidations" (
  "id" UUID PRIMARY KEY, "confirmation_id" UUID NOT NULL REFERENCES "payroll_manual_pcb_confirmations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reason" VARCHAR(80) NOT NULL, "invalidated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "payroll_manual_pcb_invalidations_confirmation_id_key" ON "payroll_manual_pcb_invalidations"("confirmation_id");

CREATE FUNCTION pcb_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'PCB_LEDGER_APPEND_ONLY'; END;
$$;
CREATE TRIGGER pcb_confirmation_immutable BEFORE UPDATE OR DELETE ON payroll_manual_pcb_confirmations FOR EACH ROW EXECUTE FUNCTION pcb_ledger_append_only();
CREATE TRIGGER pcb_invalidation_immutable BEFORE UPDATE OR DELETE ON payroll_manual_pcb_invalidations FOR EACH ROW EXECUTE FUNCTION pcb_ledger_append_only();

CREATE FUNCTION invalidate_manual_pcb_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous JSONB; current_input JSONB; entry_id UUID; member_id UUID; run_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN previous := to_jsonb(NEW); ELSE previous := to_jsonb(OLD); END IF;
  IF TG_OP = 'UPDATE' THEN
    current_input := to_jsonb(NEW);
    IF TG_TABLE_NAME = 'payroll_runs' AND previous->'period_start' = current_input->'period_start' AND previous->'period_end' = current_input->'period_end' AND NOT (previous->>'status' = 'FINALIZED' AND current_input->>'status' = 'DRAFT') THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'employee_business_memberships' AND
       (previous - ARRAY['updated_at','full_name','avatar_url','phone_number','phone_number_normalized','position']) =
       (current_input - ARRAY['updated_at','full_name','avatar_url','phone_number','phone_number_normalized','position']) THEN RETURN NEW; END IF;
    IF previous = current_input THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'payroll_entries' THEN entry_id := (previous->>'id')::uuid;
  ELSIF TG_TABLE_NAME = 'employee_business_memberships' THEN member_id := (previous->>'id')::uuid;
  ELSIF TG_TABLE_NAME = 'payroll_runs' THEN run_id := (previous->>'id')::uuid;
  ELSE entry_id := (previous->>'payroll_entry_id')::uuid; END IF;
  INSERT INTO payroll_manual_pcb_invalidations(id, confirmation_id, reason)
    SELECT gen_random_uuid(), c.id, 'INPUT_CHANGED' FROM payroll_manual_pcb_confirmations c
    WHERE c.payroll_entry_id = entry_id OR c.membership_id = member_id OR c.payroll_run_id = run_id
    ON CONFLICT (confirmation_id) DO NOTHING;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER pcb_entry_invalidation AFTER UPDATE OR DELETE ON payroll_entries FOR EACH ROW EXECUTE FUNCTION invalidate_manual_pcb_inputs();
CREATE TRIGGER pcb_member_invalidation AFTER UPDATE OR DELETE ON employee_business_memberships FOR EACH ROW EXECUTE FUNCTION invalidate_manual_pcb_inputs();
CREATE TRIGGER pcb_run_invalidation AFTER UPDATE OR DELETE ON payroll_runs FOR EACH ROW EXECUTE FUNCTION invalidate_manual_pcb_inputs();
CREATE TRIGGER pcb_component_invalidation AFTER INSERT OR UPDATE OR DELETE ON payroll_entry_components FOR EACH ROW EXECUTE FUNCTION invalidate_manual_pcb_inputs();
CREATE TRIGGER pcb_snapshot_invalidation AFTER INSERT OR UPDATE OR DELETE ON payroll_entry_statutory_snapshots FOR EACH ROW EXECUTE FUNCTION invalidate_manual_pcb_inputs();
