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

test("Phase 4B forms reveal identity and TIN only through the authorized tax editor", async () => {
  const [component, loader] = await Promise.all([
    readFile(path.join(root, "src/components/employee-profile-payroll.tsx"), "utf8"),
    readFile(path.join(root, "src/lib/team/employee-profile-statutory-read.ts"), "utf8"),
  ]);

  assert.match(component, /data\.canEdit && showStandaloneEdit \? \(/);
  assert.match(component, /<StatutoryAndTaxEditForm/);
  assert.match(component, /action={updateEmployeeStatutoryAndTaxProfilesAction}/);
  assert.match(component, /<TaxEditForm/);
  assert.match(component, /Tax & government IDs/);
  assert.match(component, /name="statutoryCountryCode" type="hidden" value="MY"/);
  assert.doesNotMatch(component, /<span>Tax country code<\/span>/);
  assert.match(component, /Only enter a new number when it changes/);
  assert.match(component, /<span>Remove<\/span>/);
  assert.match(component, /Full identifiers are visible to authorized HR editors/);
  assert.match(component, /Full numbers are visible only to HR users who can edit tax details/);
  assert.match(component, /currentValue=\{data\.identityNumber\}/);
  assert.match(component, /currentValue=\{data\.tin\}/);
  assert.match(component, /defaultValue=\{currentValue \?\? undefined\}/);
  assert.match(loader, /identityNumber: canEditTax/);
  assert.match(loader, /tin: canEditTax/);
  assert.match(component, /Tax and government IDs updated from the employee profile/);
  assert.match(component, /EmployeeProfileProtectedSubmit/);
  assert.match(loader, /EDIT_STATUTORY_PROFILE/);
  assert.match(loader, /EDIT_TAX_PROFILE/);
  assert.match(loader, /expectedRevision/);
  assert.doesNotMatch(
    loader,
    /database\.(?:bankAccount|paymentBatch|payrollEntry|payslip)/i,
  );

  for (const field of ["epfMemberNumber", "socsoMemberNumber"]) {
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

test("Phase 4B combined statutory and tax save is atomic", async () => {
  const source = await readFile(
    path.join(
      root,
      "src/lib/payroll/employee-profile-write/statutory-tax.ts",
    ),
    "utf8",
  );

  assert.match(source, /prisma\.\$transaction/);
  assert.match(source, /updateEmployeeStatutoryProfileInTransaction/);
  assert.match(source, /updateEmployeeTaxProfileInTransaction/);
});

test("Phase 4B retires legacy employee statutory and tax editing surfaces", async () => {
  const [monthlyPayroll, submissionPage] = await Promise.all([
    readFile(path.join(root, "src/app/(business)/team/payroll/page.tsx"), "utf8"),
    readFile(path.join(root, "src/app/(business)/team/payroll/statutory/page.tsx"), "utf8"),
  ]);

  assert.match(monthlyPayroll, /Compatibility route/);
  assert.match(monthlyPayroll, /`\/team\/payroll\/runs\/\$\{run\.id\}`/);
  assert.doesNotMatch(monthlyPayroll, /saveEmployeeStatutoryProfileAction/);
  assert.doesNotMatch(monthlyPayroll, /Save statutory profile/);

  assert.match(submissionPage, /managed in Employee Profile/);
  assert.match(submissionPage, /monthly export readiness/);
  assert.doesNotMatch(submissionPage, /saveEmployeeSubmissionProfileAction/);
  assert.doesNotMatch(submissionPage, /Save employee profile/);
});
