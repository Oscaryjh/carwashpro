import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

async function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("HR navigation gates Payroll and Statutory independently", async () => {
  const appShell = await source("src/components/app-shell.tsx");

  assert.match(
    appShell,
    /canSeeCapability\("VIEW_PAYROLL_RUN", "VIEW_PAYROLL_RUN"\)/,
  );
  assert.match(
    appShell,
    /canSeeCapability\(\s*"VIEW_STATUTORY_SUBMISSION",\s*"VIEW_STATUTORY_SUBMISSION"/,
  );
  assert.match(
    appShell,
    /canSeeCapability\("VIEW_STATUTORY_PROFILE", "VIEW_STATUTORY_PROFILE"\)/,
  );
  assert.match(
    appShell,
    /canSeeCapability\("VIEW_TAX_PROFILE", "VIEW_TAX_PROFILE"\)/,
  );
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
  assert.match(attendance, /canViewAttendanceSettings \?/);
  assert.match(leave, /canViewPayroll \?/);
  assert.match(settings, /canViewAttendance \?/);
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
  assert.match(payroll, /access\.actions\.canViewPayslip && data\.run\.status === "FINALIZED"/);
  assert.match(payslip, /document\.run\.status !== "FINALIZED"/);
});

test("unavailable payroll modules are labelled honestly", async () => {
  const permissions = await source("src/lib/auth/staff-permissions.ts");

  for (const capability of [
    "PUBLISH_PAYSLIP",
    "VIEW_PAYMENT_BATCH",
    "PROCESS_PAYMENT",
    "EXPORT_PAYMENT_FILE",
  ]) {
    assert.match(
      permissions,
      new RegExp(`\\["${capability}", "[^"]+\\(not available yet\\)"\\]`),
    );
  }

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
