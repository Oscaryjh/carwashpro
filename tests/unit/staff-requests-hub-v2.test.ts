import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { EmployeeAuthContext } from "../../src/lib/attendance/employee-auth/session";
import { buildStaffNavigation } from "../../src/lib/staff-pwa/navigation";
import { getStaffOvertimeSummary, resolveStaffOvertimeAccess } from "../../src/lib/staff-pwa/overtime-approvals";
import { loadRequestsApprovalEntry } from "../../src/lib/staff-pwa/requests-hub";
import { getStaffTeamApprovalSummary, resolveStaffTeamApprovalAccess } from "../../src/lib/staff-pwa/team-approvals";

const read = (path: string) => readFile(path, "utf8");
const auth = {} as EmployeeAuthContext;
const teamSummary = {
  attendance: 0,
  leave: 2,
  claims: 1,
  total: 3,
  complete: true,
  canReviewAttendance: false,
  canReviewLeave: true,
  canReviewClaims: true,
} satisfies NonNullable<Awaited<ReturnType<typeof getStaffTeamApprovalSummary>>>;
const teamAccess = {} as NonNullable<Awaited<ReturnType<typeof resolveStaffTeamApprovalAccess>>>;
const overtimeAccess = {} as NonNullable<Awaited<ReturnType<typeof resolveStaffOvertimeAccess>>>;

test("Requests Hub V2 is a compact gateway built from shared Staff V2 primitives", async () => {
  const page = await read("src/app/staff/requests/page.tsx");
  for (const primitive of [
    "StaffV2PageHeader",
    "StaffV2ActionRow",
    "StaffV2RowGroup",
    "StaffV2ListRow",
    "StaffV2SectionLabel",
  ]) {
    assert.match(page, new RegExp(primitive));
  }
  assert.doesNotMatch(page, /staff-hub-card|staff-hub-grid|RequestCard|RECENT ACTIVITY|No requests yet/);
  assert.doesNotMatch(page, /getEmployeeLeaveOverview|getEmployeeClaimOverview|loadEmployeeAttendanceResolutionCases/);
});

test("Requests Hub V2 keeps the approved employee copy and safe destinations", async () => {
  const page = await read("src/app/staff/requests/page.tsx");
  assert.match(page, /Manage your leave, claims and attendance corrections\./);
  assert.match(page, /Balances, requests and history/);
  assert.match(page, /Expenses you've submitted/);
  assert.match(page, /Missing or incorrect attendance/);
  assert.match(page, /href="\/staff\/leave"/);
  assert.match(page, /href="\/staff\/claims"/);
  assert.match(page, /href="\/staff\/history\/corrections"/);
  assert.doesNotMatch(page, /href="\/staff\/requests\/attendance-corrections"/);
  assert.doesNotMatch(page, /Overtime request|Submit OT|Request overtime|staff\/requests\/overtime/);
});

test("manager Approvals is permanent when capability exists and uses accepted copy", async () => {
  const [page, model] = await Promise.all([
    read("src/app/staff/requests/page.tsx"),
    read("src/lib/staff-pwa/requests-hub.ts"),
  ]);
  assert.match(page, /loadRequestsApprovalEntry/);
  assert.match(model, /resolveStaffTeamApprovalAccess/);
  assert.match(model, /resolveStaffOvertimeAccess/);
  assert.match(model, /hasKnownCapability/);
  assert.match(page, /title="Approvals"/);
  assert.match(page, /href="\/staff\/approvals"/);
  assert.match(model, /\$\{pending\} waiting for you/);
  assert.match(model, /"All clear"/);
  assert.match(model, /"Unavailable"/);
  assert.doesNotMatch(page, /Team approvals|You're all caught up|You’re all caught up/);
});

test("normal staff has no Approvals entry", async () => {
  const entry = await loadRequestsApprovalEntry(auth, {
    getTeamSummary: async () => null,
    getOvertimeSummary: async () => null,
    resolveTeamAccess: async () => null,
    resolveOvertimeAccess: async () => null,
  });
  assert.equal(entry, null);
});

test("manager pending and zero-pending states use the approved copy", async () => {
  const pending = await loadRequestsApprovalEntry(auth, {
    getTeamSummary: async () => teamSummary,
    getOvertimeSummary: async () => null,
    resolveTeamAccess: async () => teamAccess,
    resolveOvertimeAccess: async () => null,
  });
  assert.deepEqual(pending, { meta: "3 waiting for you" });

  const zero = await loadRequestsApprovalEntry(auth, {
    getTeamSummary: async () => ({ ...teamSummary, leave: 0, claims: 0, total: 0 }),
    getOvertimeSummary: async () => null,
    resolveTeamAccess: async () => teamAccess,
    resolveOvertimeAccess: async () => null,
  });
  assert.deepEqual(zero, { meta: "All clear" });
});

test("approval summary failure degrades only the manager row when capability is known", async () => {
  const entry = await loadRequestsApprovalEntry(auth, {
    getTeamSummary: async () => { throw new Error("summary unavailable"); },
    getOvertimeSummary: async () => null,
    resolveTeamAccess: async () => teamAccess,
    resolveOvertimeAccess: async () => null,
  });
  assert.deepEqual(entry, { meta: "Unavailable" });
});

test("OT-only capability keeps the permanent Approvals entry", async () => {
  const overtimeSummary = {
    canReviewOvertime: true as const,
    pending: 2,
  } satisfies NonNullable<Awaited<ReturnType<typeof getStaffOvertimeSummary>>>;
  const entry = await loadRequestsApprovalEntry(auth, {
    getTeamSummary: async () => null,
    getOvertimeSummary: async () => overtimeSummary,
    resolveTeamAccess: async () => null,
    resolveOvertimeAccess: async () => overtimeAccess,
  });
  assert.deepEqual(entry, { meta: "2 waiting for you" });
});

test("manager capability never removes personal employee request destinations", async () => {
  const page = await read("src/app/staff/requests/page.tsx");
  const approvalIndex = page.indexOf("{approvalEntry ? (");
  const personalIndex = page.indexOf("staff-my-requests-heading");
  assert.ok(approvalIndex >= 0 && personalIndex > approvalIndex);
  assert.equal((page.match(/title="Leave"/g) ?? []).length, 1);
  assert.equal((page.match(/title="Claims"/g) ?? []).length, 1);
  assert.equal((page.match(/title="Attendance corrections"/g) ?? []).length, 1);
});

test("bottom navigation stays Home, Time, Requests, Pay, Profile with Requests third", () => {
  const navigation = buildStaffNavigation(["CORE", "HR", "CLAIMS", "PAYROLL"]);
  assert.deepEqual(navigation.primary.map((item) => item.label), [
    "Home",
    "Time",
    "Requests",
    "Pay",
    "Profile",
  ]);
  assert.equal(navigation.primary[2]?.href, "/staff/requests");
  assert.deepEqual(navigation.more, []);
});

test("Requests loading keeps compact, stable row geometry", async () => {
  const loading = await read("src/app/staff/requests/loading.tsx");
  assert.match(loading, /aria-busy="true"/);
  assert.equal((loading.match(/styles\.skeleton/g) ?? []).length, 3);
  assert.doesNotMatch(loading, /Hero|Card/);
});
