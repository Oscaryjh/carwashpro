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
  assert.match(source, /Change reason/);
  assert.match(source, /Payroll Workspace/);
  assert.match(source, /Payroll Runs/);
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
