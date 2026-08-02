import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { routePermission } from "../../src/lib/auth/staff-permissions";
import {
  normalizePayrollEntrySearch,
  parsePayrollPage,
  payrollRunReturnPath,
  PAYROLL_ENTRIES_PAGE_SIZE,
  PAYROLL_RUNS_PAGE_SIZE,
} from "../../src/lib/payroll/runs";

const root = process.cwd();

async function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("W2A pagination and employee search inputs are bounded", () => {
  assert.equal(PAYROLL_RUNS_PAGE_SIZE, 12);
  assert.equal(PAYROLL_ENTRIES_PAGE_SIZE, 20);
  assert.equal(parsePayrollPage(), 1);
  assert.equal(parsePayrollPage("0"), 1);
  assert.equal(parsePayrollPage("-3"), 1);
  assert.equal(parsePayrollPage("abc"), 1);
  assert.equal(parsePayrollPage("4"), 4);
  assert.equal(normalizePayrollEntrySearch("  Oscar   Staff  "), "Oscar Staff");
  assert.equal(normalizePayrollEntrySearch("x".repeat(100)).length, 80);
});

test("W2A routes own their denied state instead of middleware redirecting", () => {
  assert.equal(routePermission("/team/payroll/runs"), null);
  assert.equal(routePermission("/team/payroll/runs/00000000-0000-0000-0000-000000000000"), null);
  assert.equal(routePermission("/team/payroll/runs/00000000-0000-0000-0000-000000000000/entries/00000000-0000-0000-0000-000000000000"), null);
  assert.equal(routePermission("/team/payroll"), "PAYROLL_READ");
  assert.equal(routePermission("/team/payroll/statutory"), "PAYROLL_READ");
});

test("W2A checks capability and whole-business scope before loading payroll data", async () => {
  const [access, listPage, detailPage] = await Promise.all([
    source("src/lib/payroll/runs-access.ts"),
    source("src/app/(business)/team/payroll/runs/page.tsx"),
    source("src/app/(business)/team/payroll/runs/[runId]/page.tsx"),
  ]);

  assert.match(access, /hasBusinessCapability\(context\.access, "VIEW_PAYROLL_RUN"\)/);
  assert.match(access, /resolveAttendanceScope\(context\.access\)/);
  assert.match(access, /activeBranchCount/);
  assert.match(access, /identity\.activeBusinessId !== identity\.homeBusinessId[\s\S]*"VIEW_DASHBOARD"/);

  for (const [page, loadCall] of [
    [listPage, "const data = await loadPayrollRunsList("],
    [detailPage, "const data = await loadPayrollRunDetail("],
  ] as const) {
    const accessResolution = page.indexOf("resolvePayrollRunsReadAccess()");
    const denial = page.indexOf("if (!access.granted)");
    const load = page.indexOf(loadCall);
    assert.ok(accessResolution >= 0 && accessResolution < denial && denial < load);
    assert.match(page, /PayrollRunsAccessDenied/);
  }
});

test("W2A loader is tenant-scoped and does not query Phase 3 or raw sensitive data", async () => {
  const loader = await source("src/lib/payroll/runs.ts");

  assert.match(loader, /where: \{ id: runId, businessId \}/);
  assert.match(loader, /businessId,[\s\S]*payrollRunId: runId/);
  assert.match(loader, /fullNameSnapshot/);
  assert.match(loader, /employeeCodeSnapshot/);

  for (const forbiddenData of [
    "bankAccount",
    "dateOfBirth",
    "statutoryNationality",
    "epfMember",
    "socsoCategory",
    "statutoryWarning",
    "notes: true",
    "membership:",
    "payrollSetting",
    "payrollHoliday",
  ]) {
    assert.doesNotMatch(loader, new RegExp(forbiddenData, "i"));
  }
});

test("W2C safe states remain while run actions use canonical routes", async () => {
  const files = await Promise.all([
    source("src/app/(business)/team/payroll/runs/page.tsx"),
    source("src/app/(business)/team/payroll/runs/[runId]/page.tsx"),
    source("src/app/(business)/team/payroll/runs/loading.tsx"),
    source("src/app/(business)/team/payroll/runs/error.tsx"),
    source("src/app/(business)/team/payroll/runs/[runId]/loading.tsx"),
    source("src/app/(business)/team/payroll/runs/[runId]/error.tsx"),
    source("src/app/(business)/team/payroll/runs/[runId]/not-found.tsx"),
  ]);
  const combined = files.join("\n");

  for (const migratedAction of [
    "submitPayrollRunForReviewAction",
    "returnPayrollRunToDraftAction",
    "finalizePayrollRunAction",
    "reopenPayrollRunAction",
  ]) {
    assert.match(combined, new RegExp(migratedAction));
  }

  assert.match(combined, /generatePayrollRunAction/);

  assert.match(combined, /No payroll runs yet/);
  assert.match(combined, /No matching employees/);
  assert.match(combined, /aria-busy="true"/);
  assert.match(combined, /Payroll Runs could not be loaded/);
  assert.match(combined, /Payroll run not found/);
  assert.match(combined, /Payroll Run workspace/);
  assert.doesNotMatch(combined, /Publish payslip|Create payment batch/);
});

test("W2B workflow actions retain granular capabilities and server-side scope", async () => {
  const [access, actions, detail] = await Promise.all([
    source("src/lib/payroll/runs-access.ts"),
    source("src/app/(business)/team/payroll/actions.ts"),
    source("src/app/(business)/team/payroll/runs/[runId]/page.tsx"),
  ]);

  for (const capability of [
    "SUBMIT_PAYROLL_REVIEW",
    "RETURN_PAYROLL_TO_DRAFT",
    "APPROVE_PAYROLL",
    "REOPEN_PAYROLL",
  ]) {
    assert.match(access, new RegExp(capability));
    assert.match(actions, new RegExp(`requireWholeBusinessPayroll\\(\"${capability}\"\\)`));
  }

  assert.match(actions, /payrollRunReturnPath/);
  assert.match(actions, /revalidatePath\("\/team\/payroll\/runs"\)/);
  assert.match(detail, /access\.workflow\.canSubmitReview/);
  assert.match(detail, /access\.workflow\.canReturnToDraft/);
  assert.match(detail, /access\.workflow\.canFinalize/);
  assert.match(detail, /access\.workflow\.canReopen/);
  assert.match(detail, /submittedById === access\.userId/);
  assert.match(detail, /Finalized does not mean paid/);
  assert.match(detail, /!data\.run\.hasStatutorySubmissions/);
  assert.match(detail, /Reopen unavailable[\s\S]*A statutory export or correction record exists/);
  assert.match(actions, /reopenPayrollRunAction/);
});

test("Phase 4.0B blocks direct reopen after any statutory export or correction record", async () => {
  const [service, loader] = await Promise.all([
    source("src/lib/payroll/service.ts"),
    source("src/lib/payroll/runs.ts"),
  ]);

  assert.match(service, /payrollStatutorySubmission\.count/);
  assert.match(service, /statutory export or correction record cannot be reopened directly/);
  assert.match(loader, /_count:[\s\S]*statutorySubmissions/);
  assert.match(loader, /hasStatutorySubmissions: run\._count\.statutorySubmissions > 0/);
});

test("W2B action return path cannot redirect outside the matching run", () => {
  const runId = "07bd7ea0-39ca-4f85-bd67-2298f6beab21";
  const expected = `/team/payroll/runs/${runId}`;

  assert.equal(payrollRunReturnPath(runId, expected), expected);
  assert.equal(
    payrollRunReturnPath(runId, `${expected}?q=Oscar%20Staff&page=2`),
    `${expected}?q=Oscar+Staff&page=2`,
  );
  assert.equal(payrollRunReturnPath(runId, "/team/payroll/runs/other"), null);
  assert.equal(payrollRunReturnPath(runId, "https://example.com"), null);
  assert.equal(payrollRunReturnPath(runId, `${expected}?redirect=https://example.com`), null);
  assert.equal(payrollRunReturnPath("not-a-uuid", "/team/payroll/runs/not-a-uuid"), null);
});

test("W2C migrates create and destructive refresh with granular capability checks", async () => {
  const [access, actions, list, detail] = await Promise.all([
    source("src/lib/payroll/runs-access.ts"),
    source("src/app/(business)/team/payroll/actions.ts"),
    source("src/app/(business)/team/payroll/runs/page.tsx"),
    source("src/app/(business)/team/payroll/runs/[runId]/page.tsx"),
  ]);

  assert.match(access, /canCreate:[\s\S]*"CREATE_PAYROLL_RUN"/);
  assert.match(actions, /generationMode"\) === "CREATE_ONLY"/);
  assert.match(actions, /Payroll run already exists\. Opened the existing run\./);
  assert.match(actions, /returnToRun/);
  assert.match(list, /access\.actions\.canCreate/);
  assert.match(list, /Create payroll draft/);
  assert.match(detail, /access\.actions\.canCreate/);
  assert.match(detail, /This deletes and rebuilds every employee entry/);
  assert.match(detail, /Manual allowances, deductions, EPF\/SOCSO\/EIS/);
  assert.match(detail, /Confirm refresh and clear manual adjustments/);
});

test("W2C entry editor is draft-only, tenant-scoped and separately authorized", async () => {
  const [access, loader, editor, actions] = await Promise.all([
    source("src/lib/payroll/runs-access.ts"),
    source("src/lib/payroll/entry-editor.ts"),
    source("src/app/(business)/team/payroll/runs/[runId]/entries/[entryId]/page.tsx"),
    source("src/app/(business)/team/payroll/actions.ts"),
  ]);

  assert.match(access, /canEditEntry:[\s\S]*"EDIT_PAYROLL_ENTRY"/);
  assert.match(loader, /id: entryId,[\s\S]*businessId,[\s\S]*payrollRunId: runId,[\s\S]*payrollRun: \{ status: "DRAFT" \}/);
  assert.match(editor, /!access\.granted \|\| !access\.actions\.canEditEntry/);
  assert.match(editor, /loadPayrollRunEntryEditor/);
  assert.match(editor, /This changes only this Payroll Run snapshot/);
  assert.doesNotMatch(editor, /bankAccount|baseSalary|statutoryNationality|dateOfBirth/i);
  assert.match(actions, /updatePayrollEntryAction[\s\S]*requireWholeBusinessPayroll\("EDIT_PAYROLL_ENTRY"\)/);
  assert.match(actions, /finish\("success", "Payroll entry updated\."[\s\S]*returnPath/);
});

test("W2C exposes payroll exports and finalized payslips only through their capabilities", async () => {
  const [access, detail, exportRoute, payslipRoute] = await Promise.all([
    source("src/lib/payroll/runs-access.ts"),
    source("src/app/(business)/team/payroll/runs/[runId]/page.tsx"),
    source("src/app/(business)/team/payroll/export/route.ts"),
    source("src/app/(business)/team/payroll/payslips/[entryId]/route.ts"),
  ]);

  assert.match(access, /canExportPayroll:[\s\S]*"EXPORT_PAYROLL"/);
  assert.match(access, /canViewPayslip:[\s\S]*"VIEW_PAYSLIP"/);
  assert.match(detail, /access\.actions\.canExportPayroll/);
  assert.match(detail, /kind=payroll&format=csv/);
  assert.match(detail, /kind=payroll&format=xlsx/);
  assert.match(detail, /access\.actions\.canViewPayslip && data\.run\.status === "FINALIZED"/);
  assert.match(exportRoute, /requireWholeBusinessPayroll\([\s\S]*"EXPORT_PAYROLL"/);
  assert.match(payslipRoute, /requireWholeBusinessPayroll\("VIEW_PAYSLIP"\)/);
  assert.match(payslipRoute, /document\.run\.status !== "FINALIZED"/);
});

test("W2C legacy monthly payroll keeps settings and statutory profile but removes duplicate run actions", async () => {
  const legacy = await source("src/app/(business)/team/payroll/page.tsx");

  assert.match(legacy, /savePayrollSettingAction/);
  assert.match(legacy, /addPayrollHolidayAction/);
  assert.match(legacy, /saveEmployeeStatutoryProfileAction/);
  assert.match(legacy, /Continue in Payroll Run/);
  assert.doesNotMatch(legacy, /generatePayrollRunAction|updatePayrollEntryAction/);
  assert.doesNotMatch(legacy, /submitPayrollRunForReviewAction|finalizePayrollRunAction|reopenPayrollRunAction/);
  assert.doesNotMatch(legacy, /kind=payroll&format=/);
  assert.doesNotMatch(legacy, /payslips\/\$\{entry\.id\}/);
});

test("W1 and legacy payroll retain compatible links into W2A", async () => {
  const [workspace, legacy] = await Promise.all([
    source("src/app/(business)/team/payroll/workspace/page.tsx"),
    source("src/app/(business)/team/payroll/page.tsx"),
  ]);

  assert.match(workspace, /href="\/team\/payroll\/runs"/);
  assert.match(workspace, /`\/team\/payroll\/runs\/\$\{data\.currentRun\.id\}`/);
  assert.match(workspace, /`\/team\/payroll\/runs\/\$\{run\.id\}`/);
  assert.match(legacy, /href="\/team\/payroll\/runs"/);
});
