import assert from "node:assert/strict";
import test from "node:test";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import { resolvePayrollExceptionCenterCapabilities } from "../../src/lib/payroll/exception-center-access";
import { projectPayrollExceptionEmployees } from "../../src/lib/payroll/exception-center-projection";
import {
  loadLeavePayrollConflictContext,
  resolveLeavePayrollConflicts,
} from "../../src/lib/payroll/leave-conflict-read";

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const baseDay = {
  branchId: "branch-a",
  expectedDayKind: "WORKDAY" as const,
  evidenceRequired: false,
  evidenceStatus: "NOT_REVIEWED" as const,
  leaveDate: date("2026-09-15"),
  leaveRequestId: "request-a",
  leaveUnit: "FULL_DAY" as const,
  membershipId: "member-a",
};

function businessAccess(permissions: string[]): ResolvedBusinessAccess {
  return {
    granted: true,
    userId: "actor",
    homeBusinessId: "business-a",
    businessId: "business-a",
    branchId: "branch-a",
    identityRole: "STAFF",
    actorRole: "STAFF",
    effectiveBusinessRole: "STAFF",
    permissions,
    source: "DIRECT_BUSINESS",
    groupId: null,
    groupUserId: null,
    industryType: "GENERAL_SERVICE",
    capability: null,
  };
}

test("pending canonical Leave days produce one safe review fact while valid approved leave is absent from the input", () => {
  const facts = resolveLeavePayrollConflicts([
    baseDay,
    { ...baseDay, leaveDate: date("2026-09-16") },
  ]);
  assert.deepEqual(facts, [{
    branchId: "branch-a",
    kind: "PENDING_APPROVAL",
    membershipId: "member-a",
    relevantDates: ["2026-09-15", "2026-09-16"],
  }]);
  assert.deepEqual(resolveLeavePayrollConflicts([]), []);
});

test("required unresolved evidence is review-only and no evidence requirement creates no false evidence issue", () => {
  assert.equal(resolveLeavePayrollConflicts([{ ...baseDay, evidenceRequired: true }])[0]?.kind, "EVIDENCE_REVIEW");
  assert.equal(resolveLeavePayrollConflicts([{ ...baseDay, evidenceRequired: true, evidenceStatus: "VERIFIED" }])[0]?.kind, "PENDING_APPROVAL");
  assert.equal(resolveLeavePayrollConflicts([{ ...baseDay, evidenceRequired: false, evidenceStatus: "REVIEW_REQUIRED" }])[0]?.kind, "PENDING_APPROVAL");
});

test("half-day and cross-month canonical days are accepted; rest day and public holiday do not create payroll issues", () => {
  const facts = resolveLeavePayrollConflicts([
    { ...baseDay, leaveDate: date("2026-09-01"), leaveUnit: "HALF_DAY_AM" },
    { ...baseDay, leaveRequestId: "rest", expectedDayKind: "REST_DAY", leaveDate: date("2026-09-06") },
    { ...baseDay, leaveRequestId: "holiday", expectedDayKind: "PUBLIC_HOLIDAY", leaveDate: date("2026-09-16") },
  ]);
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0]?.relevantDates, ["2026-09-01"]);
});

test("locked Timesheet is authoritative and prevents any live Leave query", async () => {
  let calls = 0;
  const database = { leaveRequestDay: { findMany: async () => { calls += 1; return []; } } };
  const facts = await loadLeavePayrollConflictContext({
    allowedBranchIds: ["branch-a"],
    businessId: "business-a",
    membershipIds: ["member-a"],
    month: "2026-09",
    timesheetLocked: true,
  }, database as never);
  assert.deepEqual(facts, []);
  assert.equal(calls, 0);
});

test("Leave projection is permission-aware, private-data-free and suppressed by same-day Attendance action", () => {
  const employee = { branches: [{ id: "branch-a", name: "Branch A" }], employeeCode: "E-1", membershipId: "member-a", name: "Employee" };
  const editable = resolvePayrollExceptionCenterCapabilities(businessAccess(["TEAM_READ", "ATTENDANCE_EMPLOYEE_READ", "VIEW_LEAVE", "APPROVE_LEAVE"]), "business-a");
  const leaveFact = { branchId: "branch-a", kind: "EVIDENCE_REVIEW" as const, membershipId: "member-a", relevantDates: ["2026-09-15"] };
  const rows = projectPayrollExceptionEmployees({ access: editable, attendanceFacts: [], employees: [employee], leaveFacts: [leaveFact], month: "2026-09", payrollIssues: [], setupIssues: [] });
  assert.equal(rows[0]?.mainIssue?.area, "LEAVE");
  assert.equal(rows[0]?.mainIssue?.impact, "NEEDS_REVIEW");
  assert.equal(rows[0]?.mainIssue?.action?.label, "Review evidence");
  assert.match(rows[0]?.mainIssue?.action?.href ?? "", /team\/leave/);
  assert.doesNotMatch(JSON.stringify(rows), /request-a|NOT_REVIEWED|certificate|attachment|doctor|diagnosis/);

  const viewOnly = resolvePayrollExceptionCenterCapabilities(businessAccess(["TEAM_READ", "VIEW_LEAVE"]), "business-a");
  const viewRows = projectPayrollExceptionEmployees({ access: viewOnly, attendanceFacts: [], employees: [employee], leaveFacts: [leaveFact], month: "2026-09", payrollIssues: [], setupIssues: [] });
  assert.equal(viewRows[0]?.mainIssue?.action?.label, "View issue");

  const hidden = resolvePayrollExceptionCenterCapabilities(businessAccess(["TEAM_READ", "VIEW_PAYROLL_RUN"]), "business-a");
  const hiddenRows = projectPayrollExceptionEmployees({ access: hidden, attendanceFacts: [], employees: [employee], leaveFacts: [leaveFact], month: "2026-09", payrollIssues: [], setupIssues: [] });
  assert.equal(hiddenRows[0]?.issues.length, 0);

  const suppressed = projectPayrollExceptionEmployees({
    access: editable,
    attendanceFacts: [{ area: "ATTENDANCE", detail: "Review attendance.", membershipId: "member-a", title: "Attendance needs review", workDate: "2026-09-15" }],
    employees: [employee],
    leaveFacts: [leaveFact],
    month: "2026-09",
    payrollIssues: [],
    setupIssues: [],
  });
  assert.deepEqual(suppressed[0]?.issues.map((issue) => issue.area), ["ATTENDANCE"]);
});
