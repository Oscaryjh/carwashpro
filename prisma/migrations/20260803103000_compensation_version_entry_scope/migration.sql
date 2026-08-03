-- Phase 4.0C hardening: a Payroll Entry may only reference a Compensation
-- Version from the same Business. This is additive and does not rewrite Entries.

ALTER TABLE "employee_compensation_versions"
  ADD CONSTRAINT "employee_compensation_versions_id_business_id_key"
  UNIQUE ("id", "business_id");

ALTER TABLE "payroll_entries"
  DROP CONSTRAINT "payroll_entries_compensation_version_id_fkey",
  ADD CONSTRAINT "payroll_entries_compensation_version_business_fkey"
  FOREIGN KEY ("compensation_version_id", "business_id")
  REFERENCES "employee_compensation_versions"("id", "business_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
