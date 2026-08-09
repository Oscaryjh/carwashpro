BEGIN;

ALTER TYPE "StatutoryScheme" ADD VALUE IF NOT EXISTS 'LINDUNG24';

ALTER TABLE "statutory_rule_sets"
  ADD COLUMN "dataset_digest" CHAR(64),
  ADD COLUMN "golden_fixture_digest" CHAR(64),
  ADD COLUMN "parser_name" VARCHAR(100),
  ADD COLUMN "parser_version" VARCHAR(40);

ALTER TABLE "payroll_entry_statutory_snapshots"
  ADD COLUMN "artifact_digest_snapshot" CHAR(64),
  ADD COLUMN "dataset_digest_snapshot" CHAR(64),
  ADD COLUMN "parser_version_snapshot" VARCHAR(40),
  ADD COLUMN "matched_rule_key" VARCHAR(120);

CREATE OR REPLACE FUNCTION tetamu_guard_statutory_rule_overlap()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'ACTIVE' AND (
    NEW.readiness <> 'CALCULATION_VERIFIED'
    OR NEW.source_digest IS NULL
    OR NEW.dataset_digest IS NULL
    OR NEW.golden_fixture_digest IS NULL
    OR NEW.parser_name IS NULL
    OR NEW.parser_version IS NULL
    OR NEW.dataset_row_count IS NULL
    OR NEW.dataset_row_count <= 0
  ) THEN
    RAISE EXCEPTION 'UNVERIFIED_STATUTORY_RULE_CANNOT_ACTIVATE';
  END IF;

  IF NEW.status = 'ACTIVE' AND EXISTS (
    SELECT 1 FROM statutory_rule_sets existing
    WHERE existing.scheme = NEW.scheme
      AND existing.status = 'ACTIVE'
      AND existing.id <> NEW.id
      AND daterange(existing.effective_from, existing.effective_to, '[)') && daterange(NEW.effective_from, NEW.effective_to, '[)')
  ) THEN
    RAISE EXCEPTION 'STATUTORY_RULE_EFFECTIVE_DATE_OVERLAP';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tetamu_guard_active_statutory_rule_provenance()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'ACTIVE' AND (
    NEW.scheme IS DISTINCT FROM OLD.scheme
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
    OR NEW.effective_to IS DISTINCT FROM OLD.effective_to
    OR NEW.authority IS DISTINCT FROM OLD.authority
    OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
    OR NEW.source_document_name IS DISTINCT FROM OLD.source_document_name
    OR NEW.source_digest IS DISTINCT FROM OLD.source_digest
    OR NEW.dataset_digest IS DISTINCT FROM OLD.dataset_digest
    OR NEW.golden_fixture_digest IS DISTINCT FROM OLD.golden_fixture_digest
    OR NEW.parser_name IS DISTINCT FROM OLD.parser_name
    OR NEW.parser_version IS DISTINCT FROM OLD.parser_version
    OR NEW.dataset_row_count IS DISTINCT FROM OLD.dataset_row_count
    OR NEW.rule_data IS DISTINCT FROM OLD.rule_data
  ) THEN
    RAISE EXCEPTION 'STATUTORY_ACTIVE_ARTIFACT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER statutory_rule_sets_active_provenance_immutable
BEFORE UPDATE ON "statutory_rule_sets"
FOR EACH ROW EXECUTE FUNCTION tetamu_guard_active_statutory_rule_provenance();

COMMIT;
