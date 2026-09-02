import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

async function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("HR navigation keeps statutory work nested under Payroll", async () => {
  const [appShell, payrollNav] = await Promise.all([
    source("src/components/app-shell.tsx"),
    source("src/components/payroll-workspace-nav.tsx"),
  ]);

  assert.match(
    appShell,
    /canSeeCapability\("VIEW_PAYROLL_RUN", "VIEW_PAYROLL_RUN"\)/,
  );
  assert.doesNotMatch(appShell, /label: "Statutory & tax"/);
  assert.match(payrollNav, /href: "\/team\/payroll\/statutory"/);
  assert.match(payrollNav, /label: "Statutory"/);
});

test("attendance modules use capabilities instead of role-name UI checks", async () => {
  const [attendance, leave, settings] = await Promise.all([
    source("src/app/(business)/team/attendance/page.tsx"),
    source("src/app/(business)/team/leave/page.tsx"),
    source("src/app/(business)/team/attendance-settings/page.tsx"),
  ]);

  for (const page of [attendance, leave, settings]) {
    assert.match(page, /hasBusinessCapability/);
    assert.doesNotMatch(page, /effectiveBusinessRole/);
    assert.doesNotMatch(page, /permissions\.includes/);
  }

  assert.match(attendance, /canViewTeamDirectory \?/);
  assert.match(leave, /canEditPolicy \?/);
  assert.match(settings, /canManage \?/);
});

test("Attendance Settings stays inside the unified Time workspace navigation", async () => {
  const [appShell, attendanceLayout, settingsLayout, timeNav] = await Promise.all([
    source("src/components/app-shell.tsx"),
    source("src/app/(business)/team/attendance/layout.tsx"),
    source("src/app/(business)/team/attendance-settings/layout.tsx"),
    source("src/components/time-workspace-nav.tsx"),
  ]);

  assert.doesNotMatch(appShell, /label: "Attendance Settings"/);
  assert.match(
    timeNav,
    /href: "\/team\/attendance-settings", label: "Settings"/,
  );
  assert.match(attendanceLayout, /TimeWorkspaceNav/);
  assert.match(settingsLayout, /TimeWorkspaceNav/);
  assert.doesNotMatch(settingsLayout, /Expected work|Resolution queue/);
  assert.doesNotMatch(
    await source("src/app/(business)/team/attendance-settings/page.tsx"),
    />People<|>Attendance<|Attendance API enforcement/,
  );
});

test("Time overview presents the canonical monthly attendance-to-payroll handoff", async () => {
  const page = await source("src/app/(business)/team/time/page.tsx");

  assert.match(page, /loadMonthlyAttendanceTimesheet/);
  assert.match(page, /Attendance captured/);
  assert.match(page, /Exceptions to resolve/);
  assert.match(page, /Stores confirmed/);
  assert.match(page, /Payroll handoff/);
  assert.doesNotMatch(page, /prisma\./);
});

test("Payroll navigation uses workflow language instead of internal route names", async () => {
  const payrollNav = await source("src/components/payroll-workspace-nav.tsx");

  assert.match(payrollNav, /label: "Prepare payroll"/);
  assert.match(payrollNav, /label: "Calculate and review payroll"/);
  assert.match(payrollNav, /shortLabel: "Pay inputs"/);
  assert.match(payrollNav, /shortLabel: "Pay"/);
  assert.doesNotMatch(payrollNav, /label: "Workspace"/);
  assert.doesNotMatch(payrollNav, /label: "Runs"/);
});

test("Leave and Claims use the shared HR issue presentation for failed actions", async () => {
  const [leave, claims, issue] = await Promise.all([
    source("src/app/(business)/team/leave/page.tsx"),
    source("src/app/(business)/team/claims/page.tsx"),
    source("src/components/hr-payroll-issue.tsx"),
  ]);

  assert.match(leave, /HrPayrollIssue/);
  assert.match(claims, /HrPayrollIssue/);
  assert.match(issue, /What happened/);
  assert.match(issue, /Why it matters/);
  assert.match(issue, /Affected/);
  assert.match(issue, /Technical details/);
});

test("employee names use the unified profile route when directory access exists", async () => {
  const pages = await Promise.all([
    source("src/app/(business)/team/page.tsx"),
    source("src/app/(business)/team/attendance/page.tsx"),
    source("src/app/(business)/team/leave/page.tsx"),
    source("src/app/(business)/team/payroll/runs/[runId]/page.tsx"),
    source("src/app/(business)/team/payroll/statutory/page.tsx"),
  ]);

  for (const page of pages) {
    assert.match(page, /\/team\/people\/\$\{/);
  }
});

test("Payroll truthfully distinguishes locked calculations from payment completion", async () => {
  const [payroll, payslip] = await Promise.all([
    source("src/app/(business)/team/payroll/runs/[runId]/page.tsx"),
    source("src/app/(business)/team/payroll/payslips/[entryId]/route.ts"),
  ]);

  assert.match(payroll, /Calculations locked/);
  assert.match(payroll, /Finalize calculations/);
  assert.match(
    payroll,
    /Finalized does not mean paid[\s\S]*Payments and statutory submissions remain separate/,
  );
  assert.match(payroll, /access\.actions\.canViewPayslip/);
  assert.match(payroll, /Open draft payslip preview/);
  assert.match(payroll, /Download finalized payslip/);
  assert.match(payslip, /requireWholeBusinessPayroll\("VIEW_PAYSLIP"\)/);
  assert.match(payslip, /PAYSLIP_PREVIEWED/);
  assert.match(payslip, /const disposition = isFinalized \? "attachment" : "inline"/);
});

test("current and unavailable payroll modules are labelled honestly", async () => {
  const permissions = await source("src/lib/auth/staff-permissions.ts");

  assert.match(
    permissions,
    /\["PUBLISH_PAYSLIP", "Publish finalized employee payslips"\]/,
  );
  for (const capability of ["PROCESS_PAYMENT", "EXPORT_PAYMENT_FILE"]) {
    assert.match(
      permissions,
      new RegExp(`\\["${capability}", "[^"]+\\(not available yet\\)"\\]`),
    );
  }

  assert.match(
    permissions,
    /\["VIEW_PAYMENT_BATCH", "View payroll payment batches"\]/,
  );

  for (const capability of [
    "VIEW_BANK_ACCOUNT",
    "EDIT_BANK_ACCOUNT",
    "VERIFY_BANK_ACCOUNT",
  ]) {
    assert.match(
      permissions,
      new RegExp(`\\["${capability}", "[^"]+"\\]`),
    );
    assert.doesNotMatch(
      permissions,
      new RegExp(`\\["${capability}", "[^"]+\\(not available yet\\)"\\]`),
    );
  }
});

test("Leave balances provide audited employee-level add and deduct controls", async () => {
  const [page, actions, service] = await Promise.all([
    source("src/app/(business)/team/leave/page.tsx"),
    source("src/app/(business)/team/leave/actions.ts"),
    source("src/lib/leave/service.ts"),
  ]);

  assert.match(page, /Employee leave balances/);
  assert.match(page, /name="direction" value="ADD"/);
  assert.match(page, /name="direction" value="DEDUCT"/);
  assert.doesNotMatch(page, /Days to add or subtract/);
  assert.match(actions, /direction === "DEDUCT"/);
  assert.match(service, /eventType: "MANUAL_ADJUSTMENT"/);
  assert.match(service, /resolveLeaveEntitlementDays\(version, employee\.joinedAt, input\.year\)/);
});
