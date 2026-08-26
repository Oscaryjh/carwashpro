import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  adapter: "src/lib/staff-pwa/team-approvals.ts",
  reader: "src/lib/attendance/resolution-read-service.ts",
  workflow: "src/lib/attendance/resolution-workflow-service.ts",
  requests: "src/app/staff/requests/page.tsx",
  queue: "src/app/staff/requests/attendance-corrections/page.tsx",
  action: "src/app/staff/requests/attendance-corrections/actions.ts",
  css: "src/app/staff/staff.css",
};

test("manager attendance route is separate from employee self-service history", async () => {
  const [requests, queue] = await Promise.all([
    readFile(files.requests, "utf8"),
    readFile(files.queue, "utf8"),
  ]);
  assert.match(requests, /approvals\?\.canReviewAttendance/);
  assert.match(requests, /"\/staff\/requests\/attendance-corrections"/);
  assert.match(requests, /: "\/staff\/history"/);
  assert.match(queue, /Manager access required/);
});

test("manager queue is server scoped to business, branches, pending cases and another employee", async () => {
  const [adapter, reader] = await Promise.all([
    readFile(files.adapter, "utf8"),
    readFile(files.reader, "utf8"),
  ]);
  assert.match(adapter, /MODIFY_ATTENDANCE_EMPLOYEES/);
  assert.match(adapter, /businessId: access\.businessId/);
  assert.match(adapter, /allowedBranchIds: access\.allowedBranchIds/);
  assert.match(adapter, /status: "UNDER_REVIEW"/);
  assert.match(adapter, /excludedStaffUserId: access\.actor\.userId/);
  assert.match(reader, /branchId: \{ in: branchIds \}/);
  assert.match(reader, /staffUser: \{ isNot: \{ id: args\.excludedStaffUserId \} \}/);
});

test("manager decision reuses canonical resolution workflow and its self/cross-branch guards", async () => {
  const [adapter, workflow, action] = await Promise.all([
    readFile(files.adapter, "utf8"),
    readFile(files.workflow, "utf8"),
    readFile(files.action, "utf8"),
  ]);
  assert.match(adapter, /applyManagerAttendanceResolution\(/);
  assert.match(workflow, /SELF_RESOLUTION_FORBIDDEN/);
  assert.match(workflow, /allowedBranchIds/);
  assert.match(action, /APPLY_CORRECTION/);
  assert.match(action, /RETURN_TO_EMPLOYEE/);
  assert.doesNotMatch(action, /prisma\.attendanceResolutionCase\.(update|create)/);
});

test("attendance correction page has explicit mobile states and safe touch layout", async () => {
  const [queue, css, loading] = await Promise.all([
    readFile(files.queue, "utf8"),
    readFile(files.css, "utf8"),
    readFile("src/app/staff/requests/attendance-corrections/loading.tsx", "utf8"),
  ]);
  assert.match(queue, /No attendance corrections waiting/);
  assert.match(queue, /Manager access required/);
  assert.match(queue, /Pending review/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(css, /\.staff-attendance-approval-page/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /min-height: 44px/);
});
