import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  AttendanceOvertimeError,
  decideAttendanceOvertime,
} from "../../src/lib/attendance/overtime-service";

const files = {
  adapter: "src/lib/staff-pwa/overtime-approvals.ts",
  requestsModel: "src/lib/staff-pwa/requests-hub.ts",
  requests: "src/app/staff/requests/page.tsx",
  approvals: "src/app/staff/approvals/page.tsx",
  queue: "src/app/staff/requests/overtime/page.tsx",
  detail: "src/app/staff/requests/overtime/[finalResultId]/page.tsx",
  actions: "src/app/staff/requests/overtime/actions.ts",
  overtime: "src/lib/attendance/overtime-service.ts",
  employee: "src/lib/attendance/employee-timesheet.ts",
  payroll: "src/lib/attendance/timesheet-service.ts",
  css: "src/app/staff/staff.css",
};

test("Approval Center shows Overtime only through the attendance management capability", async () => {
  const [adapter, requests, requestsModel, approvals] = await Promise.all([
    readFile(files.adapter, "utf8"),
    readFile(files.requests, "utf8"),
    readFile(files.requestsModel, "utf8"),
    readFile(files.approvals, "utf8"),
  ]);
  assert.match(adapter, /canDirectStaff\(user\.permissions, "MODIFY_ATTENDANCE_EMPLOYEES"\)/);
  assert.match(adapter, /moduleContext\.enabledModules\.has\("HR"\)/);
  assert.match(requests, /loadRequestsApprovalEntry/);
  assert.match(requestsModel, /resolveStaffOvertimeAccess/);
  assert.match(requestsModel, /overtimeCapability === "capable"/);
  assert.match(requests, /href="\/staff\/approvals"/);
  assert.match(approvals, /href="\/staff\/requests\/overtime"/);
  assert.doesNotMatch(requests, /employee OT request|submit overtime/i);
});

test("mobile OT queue is scoped by tenant and authorized branches and hides self review", async () => {
  const adapter = await readFile(files.adapter, "utf8");
  assert.match(adapter, /businessId: access\.businessId/);
  assert.match(adapter, /allowedBranchIds: access\.allowedBranchIds/);
  assert.match(adapter, /actorMembershipId: auth\.membershipId/);
  assert.match(adapter, /excludedMembershipId: access\.actorMembershipId/);
  assert.match(adapter, /candidate\.membershipId !== access\.actorMembershipId/);
  assert.match(adapter, /branchId: \{ in: \[\.\.\.access\.allowedBranchIds\] \}/);
  assert.match(adapter, /listAttendanceOvertimeCandidates\(/);
});

test("Home, Approval Center and OT queue reuse one membership-filtered candidate reader", async () => {
  const adapter = await readFile(files.adapter, "utf8");
  assert.equal(adapter.match(/listVisibleStaffOvertimeCandidates\(/g)?.length, 3);
  assert.doesNotMatch(adapter, /employeeUserId !== access\.actor\.userId/);
});

test("direct OT detail resolves only through the membership-filtered queue", async () => {
  const adapter = await readFile(files.adapter, "utf8");
  assert.match(adapter, /const queue = await getStaffOvertimeQueue\(\{ auth, month, database \}\)/);
  assert.match(adapter, /if \(!item\) return null/);
});

test("mobile OT decisions reuse canonical approve, adjust and reject service", async () => {
  const [adapter, actions, detail] = await Promise.all([
    readFile(files.adapter, "utf8"),
    readFile(files.actions, "utf8"),
    readFile(files.detail, "utf8"),
  ]);
  assert.match(adapter, /decideAttendanceOvertime\(/);
  assert.match(adapter, /actorMembershipId: access\.actorMembershipId/);
  assert.match(detail, /value="APPROVE"/);
  assert.match(detail, /value="ADJUST"/);
  assert.match(detail, /value="REJECT"/);
  assert.match(detail, /expectedRevision/);
  assert.match(detail, /Reason for adjustment/);
  assert.match(detail, /Reason for rejection/);
  assert.match(actions, /requireEmployeeSelfServiceAuthContext/);
  assert.match(actions, /getAuditRequestContext/);
});

test("canonical OT guards self approval, branch scope, locked Timesheet and concurrent changes", async () => {
  const overtime = await readFile(files.overtime, "utf8");
  assert.match(overtime, /OUTSIDE_BRANCH_SCOPE/);
  assert.match(overtime, /SELF_APPROVAL_NOT_ALLOWED/);
  assert.match(overtime, /finalResult\.membershipId === args\.actorMembershipId/);
  assert.match(overtime, /TIMESHEET_LOCKED/);
  assert.match(overtime, /CONCURRENT_CHANGE/);
  assert.match(overtime, /existing\?\.revision \?\? 0/);
  assert.match(overtime, /review\.sourceDigest !== derived\.sourceDigest/);
  assert.match(overtime, /seenEmployeeDays/);
});

for (const scenario of [
  { name: "approve", input: { decision: "APPROVE" as const } },
  { name: "adjust", input: { decision: "ADJUST" as const, approvedMinutes: 30, reason: "Manager adjustment" } },
  { name: "reject", input: { decision: "REJECT" as const, reason: "Manager rejection" } },
]) {
  test(`canonical ${scenario.name} action rejects membership-level self review before any write`, async () => {
    let writeAttempted = false;
    const transaction = {
      attendanceP2FinalResult: {
        findUnique: async () => ({
          id: "11111111-1111-4111-8111-111111111111",
          businessId: "22222222-2222-4222-8222-222222222222",
          branchId: "33333333-3333-4333-8333-333333333333",
          membershipId: "44444444-4444-4444-8444-444444444444",
        }),
      },
      attendanceOvertimeReview: {
        create: async () => { writeAttempted = true; },
        updateMany: async () => { writeAttempted = true; },
      },
    };
    const database = {
      $transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction),
    } as unknown as PrismaClient;

    await assert.rejects(
      decideAttendanceOvertime({
        context: {
          businessId: "22222222-2222-4222-8222-222222222222",
          allowedBranchIds: ["33333333-3333-4333-8333-333333333333"],
          wholeBusinessScope: false,
          actor: {
            userId: "55555555-5555-4555-8555-555555555555",
            name: "Self reviewer",
            email: "self-reviewer@test.local",
          },
        },
        actorMembershipId: "44444444-4444-4444-8444-444444444444",
        finalResultId: "11111111-1111-4111-8111-111111111111",
        expectedRevision: 0,
        input: scenario.input,
        database,
      }),
      (error: unknown) => error instanceof AttendanceOvertimeError && error.code === "SELF_APPROVAL_NOT_ALLOWED",
    );
    assert.equal(writeAttempted, false);
  });
}

test("employee overtime remains read-only and payroll keeps the approved-only frozen boundary", async () => {
  const [employee, payroll] = await Promise.all([
    readFile(files.employee, "utf8"),
    readFile(files.payroll, "utf8"),
  ]);
  assert.match(employee, /listAttendanceOvertimeCandidates/);
  assert.doesNotMatch(employee, /decideAttendanceOvertime/);
  assert.match(payroll, /approvedOtMinutes: overtime\?\.review\?\.approvedOtMinutes \?\? 0/);
  assert.match(payroll, /otApprovalRevision: overtime\?\.review\?\.revision \?\? null/);
});

test("mobile OT surface covers compact widths, loading/error states and safe actions", async () => {
  const [queue, detail, css, loading, error] = await Promise.all([
    readFile(files.queue, "utf8"),
    readFile(files.detail, "utf8"),
    readFile(files.css, "utf8"),
    readFile("src/app/staff/requests/overtime/loading.tsx", "utf8"),
    readFile("src/app/staff/requests/overtime/error.tsx", "utf8"),
  ]);
  assert.match(queue, /No overtime to review/);
  assert.match(detail, /monthly Timesheet is locked/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /overflow-x: clip/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(error, /No decision was changed/);
});
