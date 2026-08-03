import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("Phase 4B Employee Profile actions use only canonical statutory and tax commands", async () => {
  const source = await readFile(
    path.join(root, "src/app/(business)/team/people/[personId]/payroll/actions.ts"),
    "utf8",
  );

  assert.match(source, /requireWholeBusinessPayroll\(\s*"EDIT_STATUTORY_PROFILE"/);
  assert.match(source, /requireWholeBusinessPayroll\("EDIT_TAX_PROFILE"\)/);
  assert.match(source, /updateEmployeeStatutoryProfile\(/);
  assert.match(source, /updateEmployeeTaxProfile\(/);
  assert.match(source, /expectedRevision/);
  assert.match(source, /reasonNote/);
  assert.match(source, /existingArtifactWarning/);
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /employeeBusinessMembership\.(update|upsert|create)/);
});

test("Phase 4B forms are capability-aware and never preload full protected identifiers", async () => {
  const [component, loader] = await Promise.all([
    readFile(path.join(root, "src/components/employee-profile-payroll.tsx"), "utf8"),
    readFile(path.join(root, "src/lib/team/employee-profile-statutory-read.ts"), "utf8"),
  ]);

  assert.match(component, /data\.canEdit \? <StatutoryEditForm/);
  assert.match(component, /data\.canEdit \? <TaxEditForm/);
  assert.match(component, /Replacement fields are deliberately blank/);
  assert.match(component, /leaving it blank preserves/);
  assert.match(component, /Clear current value/);
  assert.match(component, /Historical payroll and exported artifacts stay unchanged/);
  assert.match(component, /Existing Draft\s+Payroll Runs must be refreshed manually/);
  assert.match(component, /Current impact preview/);
  assert.match(component, /EmployeeProfileProtectedSubmit/);
  assert.match(loader, /EDIT_STATUTORY_PROFILE/);
  assert.match(loader, /EDIT_TAX_PROFILE/);
  assert.match(loader, /expectedRevision/);
  assert.doesNotMatch(loader, /bankAccount|paymentBatch|payrollEntry|payslip/i);

  for (const field of [
    "statutoryIdentityNumber",
    "taxIdentificationNumber",
    "epfMemberNumber",
    "socsoMemberNumber",
  ]) {
    assert.doesNotMatch(
      component,
      new RegExp(`defaultValue=\\{data\\.${field}`),
    );
  }
});

test("Phase 4B tax command supports protected keep-current semantics inside canonical transaction", async () => {
  const source = await readFile(
    path.join(root, "src/lib/payroll/employee-profile-write/tax.ts"),
    "utf8",
  );

  assert.match(source, /command\.epfMemberNumber === undefined/);
  assert.match(source, /membership\.epfMemberNumber/);
  assert.match(source, /command\.statutoryIdentityNumber === undefined/);
  assert.match(source, /membership\.statutoryIdentityNumber/);
  assert.match(source, /Identity type and identity number must be supplied together/);
  assert.match(source, /executeCanonicalPayrollProfileCommand/);
});

test("Phase 4B retires legacy employee statutory and tax editing surfaces", async () => {
  const [monthlyPayroll, submissionPage] = await Promise.all([
    readFile(path.join(root, "src/app/(business)/team/payroll/page.tsx"), "utf8"),
    readFile(path.join(root, "src/app/(business)/team/payroll/statutory/page.tsx"), "utf8"),
  ]);

  assert.match(monthlyPayroll, /Employee statutory profile is managed in Employee Profile/);
  assert.match(monthlyPayroll, /Open employee payroll profile/);
  assert.doesNotMatch(monthlyPayroll, /saveEmployeeStatutoryProfileAction/);
  assert.doesNotMatch(monthlyPayroll, /Save statutory profile/);

  assert.match(submissionPage, /managed in Employee Profile/);
  assert.match(submissionPage, /monthly export readiness/);
  assert.doesNotMatch(submissionPage, /saveEmployeeSubmissionProfileAction/);
  assert.doesNotMatch(submissionPage, /Save employee profile/);
});
