import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Phase 4.0D migration is additive and guards canonical payroll profile writes", () => {
  const sql = read("prisma/migrations/20260803130000_payroll_profile_canonical_write/migration.sql");
  assert.match(sql, /payroll_profile_command_records/);
  assert.match(sql, /UNIQUE INDEX "payroll_profile_command_actor_command_key"/);
  assert.match(sql, /compensation_revision/);
  assert.match(sql, /work_target_revision/);
  assert.match(sql, /statutory_profile_revision/);
  assert.match(sql, /tax_profile_revision/);
  assert.match(sql, /Payroll profile command records are append-only/);
  assert.match(sql, /Payroll profile fields must be changed through the canonical command service/);
  assert.doesNotMatch(sql, /UPDATE "payroll_entries"/i);
  assert.doesNotMatch(sql, /UPDATE "payroll_runs"/i);
  assert.doesNotMatch(sql, /UPDATE "statutory_export_artifacts"/i);
  assert.doesNotMatch(sql, /DELETE FROM/i);
});

test("four domain commands remain separate and do not expose a mass-update service", () => {
  const index = read("src/lib/payroll/employee-profile-write/index.ts");
  const compensation = read("src/lib/payroll/employee-profile-write/compensation.ts");
  const workTarget = read("src/lib/payroll/employee-profile-write/work-target.ts");
  const statutory = read("src/lib/payroll/employee-profile-write/statutory.ts");
  const tax = read("src/lib/payroll/employee-profile-write/tax.ts");
  assert.match(compensation, /scheduleEmployeeCompensationChange/);
  assert.match(workTarget, /updateEmployeePayrollWorkTarget/);
  assert.match(statutory, /updateEmployeeStatutoryProfile/);
  assert.match(tax, /updateEmployeeTaxProfile/);
  assert.doesNotMatch(index, /updateEmployeePayrollProfile/);
  assert.match(compensation, /VIEW_COMPENSATION[\s\S]*EDIT_COMPENSATION/);
  assert.match(workTarget, /VIEW_COMPENSATION[\s\S]*EDIT_COMPENSATION/);
  assert.match(statutory, /VIEW_STATUTORY_PROFILE[\s\S]*EDIT_STATUTORY_PROFILE/);
  assert.match(tax, /VIEW_TAX_PROFILE[\s\S]*EDIT_TAX_PROFILE/);
});

test("runtime actions use canonical commands and legacy payroll actions expose no profile writer", () => {
  const employeeService = read("src/lib/attendance/employee-service.ts");
  const employeeAction = read("src/app/(business)/team/employees/actions.ts");
  const payrollAction = read("src/app/(business)/team/payroll/actions.ts");
  const statutoryAction = read("src/app/(business)/team/payroll/statutory/actions.ts");
  const profilePayrollAction = read(
    "src/app/(business)/team/people/[personId]/payroll/actions.ts",
  );
  assert.match(employeeService, /scheduleEmployeeCompensationChangeInTransaction/);
  assert.match(employeeService, /updateEmployeePayrollWorkTargetInTransaction/);
  assert.doesNotMatch(
    employeeService,
    /data:\s*\{[\s\S]{0,700}?normalWorkMinutesPerDay:\s*employee\.normalWorkMinutesPerDay/,
  );
  assert.match(employeeAction, /normalWorkMinutesPerDay:\s*existing\.normalWorkMinutesPerDay/);
  assert.match(employeeAction, /normalWorkMinutesPerDay:\s*null/);
  assert.doesNotMatch(payrollAction, /updateEmployeeStatutoryProfile\(/);
  assert.doesNotMatch(payrollAction, /employeeBusinessMembership\.update\(/);
  assert.match(profilePayrollAction, /updateEmployeeStatutoryProfile\(/);
  assert.match(profilePayrollAction, /updateEmployeeTaxProfile\(/);
  assert.doesNotMatch(statutoryAction, /updateEmployeeTaxProfile\(/);
  assert.doesNotMatch(statutoryAction, /employeeBusinessMembership\.update\(/);
});

test("canonical command results and audits exclude raw sensitive values", () => {
  const compensation = read("src/lib/payroll/employee-profile-write/compensation.ts");
  const tax = read("src/lib/payroll/employee-profile-write/tax.ts");
  const common = read("src/lib/payroll/employee-profile-write/common.ts");
  assert.match(compensation, /baseRate:\s*"\[REDACTED\]"/);
  assert.doesNotMatch(compensation, /return\s*\{[\s\S]{0,500}?baseRate:/);
  assert.match(tax, /masked:\s*\{/);
  assert.doesNotMatch(tax, /return\s*\{[\s\S]{0,900}?statutoryIdentityNumber:\s*after\.statutoryIdentityNumber/);
  assert.match(common, /sanitizeAuditReason/);
  assert.match(common, /isolationLevel:\s*"Serializable"/);
  assert.match(common, /commandFingerprint/);
});
