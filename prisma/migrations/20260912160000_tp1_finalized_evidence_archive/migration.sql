-- Additive only. No backfill: an old aggregate is never reclassified.
-- Current finalized snapshots remain the canonical YTD source; this archive
-- preserves superseded evidence when the existing run is reopened/recalculated.
CREATE TABLE payroll_pcb_finalized_evidence_archive (
  source_snapshot_id UUID PRIMARY KEY,
  business_id UUID NOT NULL,
  payroll_run_id UUID NOT NULL,
  payroll_entry_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  calculation_revision INTEGER NOT NULL,
  finalized_at TIMESTAMP(3) NOT NULL,
  snapshot_record JSONB NOT NULL,
  CONSTRAINT pcb_archive_run_fk FOREIGN KEY (payroll_run_id, business_id)
    REFERENCES payroll_runs(id, business_id) ON DELETE RESTRICT,
  CONSTRAINT pcb_archive_entry_fk FOREIGN KEY (payroll_entry_id, business_id, membership_id)
    REFERENCES payroll_entries(id, business_id, membership_id) ON DELETE RESTRICT
);
CREATE INDEX pcb_archive_run_idx ON payroll_pcb_finalized_evidence_archive(payroll_run_id, business_id);
CREATE INDEX pcb_archive_entry_idx ON payroll_pcb_finalized_evidence_archive(payroll_entry_id, business_id, membership_id);

CREATE FUNCTION tetamu_archive_finalized_pcb_evidence() RETURNS trigger AS $$
BEGIN
  -- Also retain pre-migration finalized evidence at canonical Reopen, before
  -- any Draft recalculation can replace it. Preserve raw JSON; never backfill items.
  IF OLD.status IS DISTINCT FROM NEW.status AND (NEW.status = 'FINALIZED' OR OLD.status = 'FINALIZED') THEN
    IF EXISTS (
      SELECT 1 FROM payroll_entry_statutory_snapshots s
      JOIN payroll_pcb_finalized_evidence_archive a ON a.source_snapshot_id = s.id
      WHERE s.payroll_run_id = NEW.id AND s.business_id = NEW.business_id
        AND a.snapshot_record IS DISTINCT FROM to_jsonb(s)
    ) THEN RAISE EXCEPTION 'FINALIZED_PCB_ARCHIVE_ID_REUSED'; END IF;
    INSERT INTO payroll_pcb_finalized_evidence_archive
      (source_snapshot_id, business_id, payroll_run_id, payroll_entry_id, membership_id,
       calculation_revision, finalized_at, snapshot_record)
    SELECT s.id, s.business_id, s.payroll_run_id, s.payroll_entry_id, s.membership_id,
           e.calculation_revision, CASE WHEN NEW.status = 'FINALIZED' THEN NEW.finalized_at ELSE OLD.finalized_at END, to_jsonb(s)
    FROM payroll_entry_statutory_snapshots s
    JOIN payroll_entries e ON e.id = s.payroll_entry_id AND e.business_id = s.business_id
    WHERE s.payroll_run_id = NEW.id AND s.business_id = NEW.business_id AND s.scheme = 'PCB'
    ON CONFLICT (source_snapshot_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_pcb_archive_on_finalize AFTER UPDATE OF status ON payroll_runs
FOR EACH ROW EXECUTE FUNCTION tetamu_archive_finalized_pcb_evidence();

CREATE FUNCTION tetamu_reject_pcb_archive_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'FINALIZED_PCB_ARCHIVE_IMMUTABLE'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_pcb_archive_immutable BEFORE UPDATE OR DELETE ON payroll_pcb_finalized_evidence_archive
FOR EACH ROW EXECUTE FUNCTION tetamu_reject_pcb_archive_mutation();
