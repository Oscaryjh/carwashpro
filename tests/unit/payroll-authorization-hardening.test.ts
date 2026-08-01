import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  canDirectStaff,
  canGroupManager,
  canGroupOwner,
  type BusinessCapability,
} from "../../src/lib/business-groups/capabilities";
import { sanitizeAuditValue } from "../../src/lib/audit/sanitize";
import {
  defaultStaffPermissions,
  normalizeStaffPermissions,
  staffPermissions,
} from "../../src/lib/auth/staff-permissions";

const sensitiveCapabilities: BusinessCapability[] = [
  "VIEW_COMPENSATION", "EDIT_COMPENSATION", "VIEW_PAYROLL_RUN",
  "CREATE_PAYROLL_RUN", "EDIT_PAYROLL_ENTRY", "SUBMIT_PAYROLL_REVIEW",
  "RETURN_PAYROLL_TO_DRAFT", "APPROVE_PAYROLL", "REOPEN_PAYROLL",
  "EXPORT_PAYROLL", "VIEW_PAYSLIP", "PUBLISH_PAYSLIP",
  "VIEW_BANK_ACCOUNT", "EDIT_BANK_ACCOUNT", "VIEW_PAYMENT_BATCH",
  "PROCESS_PAYMENT", "EXPORT_PAYMENT_FILE", "VIEW_STATUTORY_PROFILE",
  "EDIT_STATUTORY_PROFILE", "VIEW_TAX_PROFILE", "EDIT_TAX_PROFILE",
  "VIEW_STATUTORY_SUBMISSION", "EXPORT_STATUTORY", "SUBMIT_STATUTORY",
  "RESOLVE_STATUTORY_SUBMISSION",
];

test("group managers receive no payroll or compensation capability by default", () => {
  for (const capability of sensitiveCapabilities) {
    assert.equal(canGroupManager(capability), false, capability);
  }
  assert.equal(canGroupManager("VIEW_ATTENDANCE_EMPLOYEES"), true);
});

test("group owners retain explicit owner-equivalent capability policy", () => {
  for (const capability of sensitiveCapabilities) {
    assert.equal(canGroupOwner(capability), true, capability);
  }
});

test("legacy payroll manage cannot approve, reopen, export or submit statutory", () => {
  const permissions = ["PAYROLL_MANAGE"];
  for (const capability of [
    "VIEW_PAYROLL_RUN", "CREATE_PAYROLL_RUN", "EDIT_PAYROLL_ENTRY",
    "SUBMIT_PAYROLL_REVIEW",
  ] as BusinessCapability[]) {
    assert.equal(canDirectStaff(permissions, capability), true, capability);
  }
  for (const capability of [
    "RETURN_PAYROLL_TO_DRAFT", "APPROVE_PAYROLL", "REOPEN_PAYROLL",
    "EXPORT_PAYROLL", "PUBLISH_PAYSLIP", "PROCESS_PAYMENT",
    "EXPORT_PAYMENT_FILE", "EXPORT_STATUTORY", "SUBMIT_STATUTORY",
    "RESOLVE_STATUTORY_SUBMISSION",
  ] as BusinessCapability[]) {
    assert.equal(canDirectStaff(permissions, capability), false, capability);
  }
});

test("payroll read is never promoted into a mutation capability", () => {
  const permissions = ["PAYROLL_READ"];
  assert.equal(canDirectStaff(permissions, "VIEW_PAYROLL_RUN"), true);
  for (const capability of sensitiveCapabilities.filter((value) =>
    value !== "VIEW_PAYROLL_RUN")) {
    assert.equal(canDirectStaff(permissions, capability), false, capability);
  }
});

test("salary, identity, tax and statutory values are redacted from audit payloads", () => {
  assert.deepEqual(sanitizeAuditValue({
    baseSalary: "2000.00", grossPay: "2500.00", netPay: "2200.00",
    identityNumber: "900101010101", passportNumber: "A12345678",
    taxIdentificationNumber: "IG123", epfNumber: "EPF123",
    socsoNumber: "SOC123", eisNumber: "EIS123", safeStatus: "ACTIVE",
  }), {
    baseSalary: "[REDACTED]", grossPay: "[REDACTED]", netPay: "[REDACTED]",
    identityNumber: "[REDACTED]", passportNumber: "[REDACTED]",
    taxIdentificationNumber: "[REDACTED]", epfNumber: "[REDACTED]",
    socsoNumber: "[REDACTED]", eisNumber: "[REDACTED]", safeStatus: "ACTIVE",
  });
});

test("all P0 capabilities are configurable, grouped and never selected by default", async () => {
  const available = new Set(staffPermissions.map((permission) => permission.key));
  for (const capability of sensitiveCapabilities) {
    assert.equal(available.has(capability), true, capability);
    assert.equal(defaultStaffPermissions.includes(capability), false, capability);
  }
  const legacyManage = normalizeStaffPermissions(["PAYROLL_MANAGE"]);
  assert.deepEqual(legacyManage.sort(), ["PAYROLL_MANAGE", "PAYROLL_READ"]);
  const root = process.cwd();
  const permissionUi = await readFile(path.join(root, "src/components/staff-form.tsx"), "utf8");
  const roleAction = await readFile(path.join(root, "src/app/(business)/team/configuration-actions.ts"), "utf8");
  assert.match(permissionUi, /Payroll & sensitive data/);
  assert.match(permissionUi, /Attendance/);
  assert.match(permissionUi, /defaultChecked=\{selected\.has\(permission\.key\)\}/);
  assert.match(roleAction, /formData\.getAll\("permissions"\)/);
  assert.match(roleAction, /data: \{ name: input\.name, permissions, active: input\.active \}/);
});

test("deployed sensitive entry points use dedicated capabilities and immutable GET exports", async () => {
  const root = process.cwd();
  const payrollActions = await readFile(path.join(root, "src/app/(business)/team/payroll/actions.ts"), "utf8");
  const attendanceActions = await readFile(path.join(root, "src/app/(business)/team/employees/actions.ts"), "utf8");
  const statutoryActions = await readFile(path.join(root, "src/app/(business)/team/payroll/statutory/actions.ts"), "utf8");
  const statutoryExport = await readFile(path.join(root, "src/app/(business)/team/payroll/statutory/export/route.ts"), "utf8");
  const payslipRoute = await readFile(path.join(root, "src/app/(business)/team/payroll/payslips/[entryId]/route.ts"), "utf8");
  const payrollExport = await readFile(path.join(root, "src/app/(business)/team/payroll/export/route.ts"), "utf8");

  assert.match(payrollActions, /requireWholeBusinessPayroll\("APPROVE_PAYROLL"\)/);
  assert.match(payrollActions, /requireWholeBusinessPayroll\("REOPEN_PAYROLL"\)/);
  assert.doesNotMatch(attendanceActions, /formData\.get\("baseSalary"\)/);
  assert.doesNotMatch(attendanceActions, /formData\.get\("payBasis"\)/);
  assert.match(attendanceActions, /baseSalary: null/);
  assert.match(attendanceActions, /baseSalary:\s*existing\.baseSalary/);
  assert.match(statutoryActions, /markStatutoryFileExportedAction/);
  assert.match(statutoryActions, /"SUBMIT_STATUTORY"/);
  assert.match(statutoryActions, /"RESOLVE_STATUTORY_SUBMISSION"/);
  assert.match(statutoryExport, /requireWholeBusinessPayroll\("EXPORT_STATUTORY"\)/);
  assert.doesNotMatch(statutoryExport, /payrollStatutorySubmission\.(upsert|update|create)/);
  assert.match(payslipRoute, /document\.run\.status !== "FINALIZED"/);
  for (const exportRoute of [payrollExport, statutoryExport]) {
    assert.match(exportRoute, /checksumSha256/);
    assert.match(exportRoute, /byteLength/);
    assert.match(exportRoute, /private, no-store/);
  }
  assert.match(statutoryExport, /recordCount: data\.run\.entries\.length/);
});
