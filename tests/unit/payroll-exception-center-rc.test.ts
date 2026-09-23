import assert from "node:assert/strict";
import test from "node:test";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import {
  canViewPayrollExceptionCenter,
  resolvePayrollExceptionCenterCapabilities,
} from "../../src/lib/payroll/exception-center-access";
import { projectPayrollExceptionEmployees } from "../../src/lib/payroll/exception-center-projection";
import {
  filterPayrollExceptionRows,
  summarizePayrollExceptionRows,
} from "../../src/lib/payroll/exception-center-types";
import type { PayrollReadinessIssue } from "../../src/lib/payroll/readiness";

function access(
  permissions: string[],
  role: "STAFF" | "BUSINESS_OWNER" | "PLATFORM_ADMIN" = "STAFF",
  businessId: string | null = "business-a",
): ResolvedBusinessAccess {
  return {
    granted: true,
    userId: "actor",
    homeBusinessId: businessId,
    businessId,
    branchId: "branch-a",
    identityRole: role,
    actorRole: role,
    effectiveBusinessRole: role,
    permissions,
    source: role === "PLATFORM_ADMIN" ? "PLATFORM_ADMIN" : "DIRECT_BUSINESS",
    groupId: null,
    groupUserId: null,
    industryType: role === "PLATFORM_ADMIN" ? null : "GENERAL_SERVICE",
    capability: null,
  };
}

test("exception access is tenant-scoped, read-bounded, and excludes Platform Admin", () => {
  const viewer = access(["TEAM_READ", "VIEW_PAYROLL_RUN"]);
  const capabilities = resolvePayrollExceptionCenterCapabilities(viewer, "business-a");

  assert.equal(capabilities.granted, true);
  assert.equal(capabilities.canViewPayroll, true);
  assert.equal(capabilities.canEditCompensation, false);
  assert.equal(canViewPayrollExceptionCenter(viewer, "business-b"), false);
  assert.equal(canViewPayrollExceptionCenter(access([], "PLATFORM_ADMIN", null), "business-a"), false);
});

test("canonical payroll facts become business-readable issues without leaking internals", () => {
  const capabilities = resolvePayrollExceptionCenterCapabilities(
    access(["TEAM_READ", "VIEW_PAYROLL_RUN"]),
    "business-a",
  );
  const rawIssue: PayrollReadinessIssue = {
    code: "MISSING_COMPENSATION",
    severity: "BLOCKING",
    employeeId: "employee-a",
    membershipId: "member-a",
    employeeCode: "EMP-001",
    employeeName: "Employee A",
    source: "INTERNAL_SOURCE_MUST_NOT_LEAK",
    message: "RAW_INTERNAL_MESSAGE",
    resolutionHint: "RAW_INTERNAL_HINT",
  };
  const rows = projectPayrollExceptionEmployees({
    access: capabilities,
    attendanceFacts: [],
    employees: [{
      branches: [{ id: "branch-a", name: "Kuching" }],
      employeeCode: "EMP-001",
      membershipId: "member-a",
      name: "Employee A",
    }],
    month: "2026-09",
    payrollIssues: [rawIssue],
    setupIssues: [],
  });

  assert.equal(rows[0]?.status, "BLOCKING_PAYROLL");
  assert.equal(rows[0]?.mainIssue?.area, "PAY_SETUP");
  assert.match(
    rows[0]?.mainIssue?.action?.href ?? "",
    /team\/payroll\/exceptions\/member-a\?month=2026-09/,
  );
  assert.doesNotMatch(JSON.stringify(rows), /INTERNAL_SOURCE|RAW_INTERNAL|resolutionHint/);
});

test("exception filters and summaries are pure and hide ready rows by default", () => {
  const ready = {
    branches: [{ id: "branch-a", name: "Kuching" }],
    employeeCode: "EMP-001",
    issues: [],
    mainIssue: null,
    membershipId: "member-a",
    name: "Alice",
    status: "READY" as const,
  };
  const blocking = {
    ...ready,
    employeeCode: "EMP-002",
    membershipId: "member-b",
    name: "Bob",
    status: "BLOCKING_PAYROLL" as const,
    issues: [{
      action: null,
      area: "TIMESHEET" as const,
      detail: "Lock the timesheet.",
      impact: "BLOCKING_PAYROLL" as const,
      owner: "Attendance manager",
      title: "Timesheet not locked",
    }],
  };
  const rows = [ready, blocking];

  assert.deepEqual(filterPayrollExceptionRows(rows, {}).map((row) => row.membershipId), ["member-b"]);
  assert.deepEqual(
    filterPayrollExceptionRows(rows, { showReady: true, branch: "branch-a", search: "alice" })
      .map((row) => row.membershipId),
    ["member-a"],
  );
  assert.deepEqual(summarizePayrollExceptionRows(rows), {
    blocking: 1,
    needsReview: 0,
    ready: 1,
    setupRequired: 0,
    total: 2,
  });
});
