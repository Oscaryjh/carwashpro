import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  payrollCalculationDescription,
  payrollCalculationLabel,
  payrollPayslipLabel,
  payrollPrimaryActionLabel,
  payrollStatutoryLabel,
} from "../../src/lib/payroll/workspace";

const root = process.cwd();

async function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("Payroll Workspace presents calculation status independently", () => {
  assert.equal(payrollCalculationLabel(), "Not generated");
  assert.equal(payrollCalculationLabel("DRAFT"), "Draft");
  assert.equal(payrollCalculationLabel("REVIEW"), "Awaiting review");
  assert.equal(payrollCalculationLabel("FINALIZED"), "Calculations locked");
  assert.match(
    payrollCalculationDescription("FINALIZED"),
    /does not mean employees have been paid/,
  );
});

test("Payroll Workspace primary actions only navigate to existing payroll views", () => {
  assert.equal(
    payrollPrimaryActionLabel(null, "August 2026", true),
    "Open August 2026 payroll setup",
  );
  assert.equal(
    payrollPrimaryActionLabel("DRAFT", "August 2026", true),
    "Continue August 2026 draft",
  );
  assert.equal(
    payrollPrimaryActionLabel("DRAFT", "August 2026", false),
    "View August 2026 draft",
  );
  assert.equal(
    payrollPrimaryActionLabel("REVIEW", "July 2026", false),
    "View payroll awaiting review",
  );
  assert.equal(
    payrollPrimaryActionLabel("FINALIZED", "June 2026", false),
    "View locked payroll",
  );
});

test("Payslip and statutory states do not imply payment completion", () => {
  assert.equal(payrollPayslipLabel("FINALIZED", true), "Available for download");
  assert.equal(payrollPayslipLabel("DRAFT", true), "Not available");
  assert.equal(payrollPayslipLabel("FINALIZED", false), "Restricted");
  assert.equal(payrollStatutoryLabel("DRAFT", []), "Not available");
  assert.equal(payrollStatutoryLabel("FINALIZED", []), "Not exported");
  assert.equal(payrollStatutoryLabel("FINALIZED", ["EXPORTED"]), "Exported");
  assert.equal(payrollStatutoryLabel("FINALIZED", ["SUBMITTED"]), "Submitted");
  assert.equal(payrollStatutoryLabel("FINALIZED", ["ACCEPTED"]), "Accepted");
  assert.equal(
    payrollStatutoryLabel("FINALIZED", ["ACCEPTED", "REJECTED"]),
    "Rejected",
  );
  assert.equal(payrollStatutoryLabel("FINALIZED", null), "Restricted");
});

test("W1 route is read-only, capability-aware and avoids Phase 3 data", async () => {
  const [page, loader, navigation] = await Promise.all([
    source("src/app/(business)/team/payroll/workspace/page.tsx"),
    source("src/lib/payroll/workspace.ts"),
    source("src/components/app-shell.tsx"),
  ]);

  const capabilityCheck = page.indexOf('hasBusinessCapability(\n    context.access,\n    "VIEW_PAYROLL_RUN"');
  const dataLoad = page.indexOf("loadPayrollWorkspace(context.businessId)");
  assert.ok(capabilityCheck >= 0 && capabilityCheck < dataLoad);
  assert.match(page, /identity\.activeBusinessId !== identity\.homeBusinessId[\s\S]*"VIEW_DASHBOARD"/);
  assert.match(page, /if \(!canViewPayroll\) \{[\s\S]*PayrollWorkspaceAccessDenied/);
  assert.match(page, /No payroll period, employee, calculation, payslip, payment or statutory[\s\S]*data was loaded/);
  assert.match(navigation, /href: "\/team\/payroll\/workspace"/);

  for (const forbiddenAction of [
    "generatePayrollRunAction",
    "submitPayrollRunForReviewAction",
    "finalizePayrollRunAction",
    "reopenPayrollRunAction",
    "updatePayrollEntryAction",
  ]) {
    assert.doesNotMatch(page, new RegExp(forbiddenAction));
  }

  for (const forbiddenData of [
    "baseSalary",
    "bankAccount",
    "employeeBusinessMembership",
    "payrollSetting",
    "payrollHoliday",
  ]) {
    assert.doesNotMatch(loader, new RegExp(forbiddenData, "i"));
  }
});

test("W1 exposes honest current, future and unavailable modules without fake payment actions", async () => {
  const page = await source("src/app/(business)/team/payroll/workspace/page.tsx");

  assert.match(page, /title="Payroll Runs"/);
  assert.match(page, /state="Future"[\s\S]*title="Employee Payroll Setup"/);
  assert.match(page, /state="Not available"[\s\S]*title="Payroll Payments"/);
  assert.match(page, /No payment batch, bank export or paid-status workflow exists/);
  assert.doesNotMatch(page, /Create payment batch/);
  assert.doesNotMatch(page, /Publish payslip/);
});

test("W1 includes dedicated loading and error states", async () => {
  const [loading, error] = await Promise.all([
    source("src/app/(business)/team/payroll/workspace/loading.tsx"),
    source("src/app/(business)/team/payroll/workspace/error.tsx"),
  ]);

  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Loading the current payroll state/);
  assert.match(error, /Payroll Workspace could not be loaded/);
  assert.match(error, /No stale calculation or employee data is shown/);
  assert.match(error, /reset/);
});
