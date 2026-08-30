import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  adapter: "src/lib/staff-pwa/team-approvals.ts",
  approvals: "src/app/staff/approvals/page.tsx",
  attendance: "src/app/staff/requests/attendance-corrections/page.tsx",
  reader: "src/lib/attendance/resolution-read-service.ts",
  overtime: "src/lib/staff-pwa/overtime-approvals.ts",
};

test("Staff Attendance parent count and child total share one actionable projection", async () => {
  const [adapter, approvals, attendance] = await Promise.all([
    readFile(files.adapter, "utf8"),
    readFile(files.approvals, "utf8"),
    readFile(files.attendance, "utf8"),
  ]);
  assert.match(adapter, /loadStaffAttendanceTaskProjection\(\{ access, page: 1, database \}\)/);
  assert.match(adapter, /const attendanceCount = attendance\?\.totalActionable \?\? 0/);
  assert.match(adapter, /totalActionable: corrections\.pagination\.total \+ pendingExceptions\.pagination\.total/);
  assert.match(adapter, /totalWaiting: projection\.totalActionable/);
  assert.match(approvals, /count=\{attendanceCount\}/);
  assert.match(attendance, /\{queue\.totalActionable\} need attention/);
});

test("Staff Attendance count excludes OT and business-only monthly Timesheet work", async () => {
  const [adapter, approvals, overtime] = await Promise.all([
    readFile(files.adapter, "utf8"),
    readFile(files.approvals, "utf8"),
    readFile(files.overtime, "utf8"),
  ]);
  assert.match(adapter, /domains: \["LEAVE", "CLAIMS"\]/);
  assert.doesNotMatch(adapter, /listAttendanceOvertimeCandidates/);
  assert.doesNotMatch(adapter, /attendanceMonthlyTimesheet/);
  assert.match(approvals, /href="\/staff\/requests\/overtime"/);
  assert.match(overtime, /effectiveStatus === "PENDING_REVIEW"/);
});

test("Attendance projection is tenant, branch, self-review and capability scoped", async () => {
  const [adapter, reader] = await Promise.all([
    readFile(files.adapter, "utf8"),
    readFile(files.reader, "utf8"),
  ]);
  assert.match(adapter, /businessId: access\.businessId/);
  assert.match(adapter, /allowedBranchIds: access\.allowedBranchIds/);
  assert.match(adapter, /excludedMembershipId: access\.actorMembershipId/g);
  assert.match(adapter, /!access\?\.canReviewAttendance \|\| !access\.allowedBranchIds\.length/);
  assert.match(adapter, /MODIFY_ATTENDANCE_EMPLOYEES/);
  assert.match(reader, /branchId: \{ in: branchIds \}/);
  assert.match(reader, /employeeId: \{ not: args\.excludedMembershipId \}/);
});

test("Attendance task taxonomy and zero state are manager-readable", async () => {
  const attendance = await readFile(files.attendance, "utf8");
  assert.match(attendance, /Missing punch ·/);
  assert.match(attendance, /Attendance correction ·/);
  assert.match(attendance, /No attendance items need your review/);
  assert.doesNotMatch(attendance, />0 waiting</);
  assert.doesNotMatch(attendance, /P2|Resolution Case|Materialization|Canonical Task/);
});

test("Staff projection remains read-only and canonical workflows own decisions", async () => {
  const adapter = await readFile(files.adapter, "utf8");
  assert.match(adapter, /reviewAttendanceException\(/);
  assert.match(adapter, /applyManagerAttendanceResolution\(/);
  assert.doesNotMatch(adapter, /attendance(P2Exception|ResolutionCase|Exception)\.(create|update|upsert)/);
  assert.doesNotMatch(adapter, /StaffApproval/);
});
