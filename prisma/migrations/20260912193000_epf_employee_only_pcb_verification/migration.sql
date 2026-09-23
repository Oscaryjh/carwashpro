-- Permit a narrowly-scoped LOCAL synthetic EPF snapshot to preserve an official
-- employee contribution supplied by a regulator test case when employer EPF and
-- statutory nationality are intentionally not part of the PCB verification input.
-- The snapshot remains BLOCKED for statutory submission and cannot be exported.
ALTER TABLE "payroll_entry_statutory_snapshots"
  DROP CONSTRAINT IF EXISTS "payroll_entry_statutory_snapshots_evidence_contract";

ALTER TABLE "payroll_entry_statutory_snapshots"
  ADD CONSTRAINT "payroll_entry_statutory_snapshots_evidence_contract"
  CHECK (
    (
      "evidence_nature" = 'REAL'
      AND "evidence_environment" IS NULL
      AND "fixture_purpose" IS NULL
      AND "official_export_eligible" = TRUE
    )
    OR
    (
      "evidence_nature" = 'SYNTHETIC_TESTING'
      AND "evidence_environment" IS NOT NULL
      AND "fixture_purpose" IS NOT NULL
      AND "official_export_eligible" = FALSE
      AND (
        "statutory_nationality_snapshot" IS NOT NULL
        OR (
          "scheme" = 'EPF'
          AND "status" = 'BLOCKED'
          AND "blocker_code" = 'EPF_EMPLOYER_FACT_NOT_REQUIRED_FOR_PCB_VERIFICATION'
          AND "statutory_contribution_input_id" IS NOT NULL
          AND "evidence_environment" = 'LOCAL'
          AND "fixture_purpose" = 'PAYROLL_PAYSLIP_UAT'
        )
      )
    )
  );
