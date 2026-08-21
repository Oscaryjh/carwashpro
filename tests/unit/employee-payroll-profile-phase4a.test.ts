import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("Phase 4A actions delegate exclusively to canonical payroll profile commands", async () => {
  const source = await readFile(
    path.join(root, "src/app/(business)/team/people/[personId]/payroll/actions.ts"),
    "utf8",
  );
  assert.match(source, /requireWholeBusinessPayroll\("EDIT_COMPENSATION"\)/);
  assert.match(source, /scheduleEmployeeCompensationChange\(/);
  assert.match(source, /updateEmployeePayrollWorkTarget\(/);
  assert.match(source, /expectedRevision/);
  assert.match(source, /reasonNote/);
  assert.match(source, /affectedDrafts/);
  assert.doesNotMatch(source, /prisma\./);
  assert.doesNotMatch(source, /employeeBusinessMembership\.(update|upsert|create)/);
});

test("Phase 4A UI is capability-aware and explains monthly and draft boundaries", async () => {
  const source = await readFile(
    path.join(root, "src/components/employee-profile-payroll.tsx"),
    "utf8",
  );
  assert.match(source, /data\.canEdit \? <CompensationEditForm/);
  assert.match(source, /data\.canEdit \? <WorkTargetEditForm/);
  assert.match(source, /type="month"/);
  assert.match(source, /Finalized and locked Payroll Runs retain/);
  assert.match(source, /Saving does not recalculate an existing Draft/);
  assert.match(source, /Refresh the Draft manually/);
  assert.match(source, /Applies to the next payroll/);
  assert.match(source, /Changes will be applied automatically/);
  assert.doesNotMatch(source, /No payroll draft exists yet/);
  assert.match(source, /payroll draft needs refreshing/);
  assert.match(source, /Monthly pay updated/);
  assert.match(source, /The change will apply automatically to the next payroll/);
  assert.doesNotMatch(source, /View change details/);
  assert.doesNotMatch(source, /Saved revision/);
  assert.doesNotMatch(source, /Changed fields:/);
  assert.match(source, /Monthly additions/);
  assert.match(source, /Monthly deductions/);
  assert.match(source, /Transport allowance/);
  assert.match(source, /Payroll status/);
  assert.match(source, /Complete statutory & tax details/);
  assert.match(source, /Bank account added/);
  assert.match(source, /Confirm the bank name and account number before the first salary payment/);
  assert.doesNotMatch(source, /Verify bank account/);
  assert.doesNotMatch(source, /No payroll run includes this employee yet/);
  assert.doesNotMatch(source, /How payroll records are updated/);
  assert.match(source, /result\.payslip\.status !== "AVAILABLE"/);
  assert.doesNotMatch(source, /No published payslip available/);
  assert.doesNotMatch(source, /Payment tracking is not available/);
  assert.doesNotMatch(source, /title="Recurring earnings"/);
  assert.doesNotMatch(source, /title="Recurring deductions"/);
  assert.match(source, /Change reason/);
  assert.match(source, /calculated and reviewed in individual Payroll Runs/);
  assert.match(source, /Payroll Runs/);
  assert.doesNotMatch(source, /View Payroll Runs in Workspace|Payroll Workspace/);
});

test("legacy employee editors no longer expose existing compensation fields", async () => {
  const [teamForm, attendanceForm, teamPage] = await Promise.all([
    readFile(path.join(root, "src/components/staff-form.tsx"), "utf8"),
    readFile(path.join(root, "src/app/(business)/team/employees/employee-form.tsx"), "utf8"),
    readFile(path.join(root, "src/app/(business)/team/page.tsx"), "utf8"),
  ]);
  assert.match(teamForm, /!isEdit \|\| createEmploymentProfile/);
  assert.match(teamForm, /Open Payroll Profile/);
  assert.doesNotMatch(attendanceForm, /name="baseSalary"/);
  assert.doesNotMatch(attendanceForm, /name="payBasis"/);
  assert.doesNotMatch(teamPage, /baseSalary: canViewCompensation/);
  assert.doesNotMatch(teamPage, /normalWorkMinutesPerDay: true/);
});
