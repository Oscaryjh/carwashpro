import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { EmployeeAuthContext } from "../../src/lib/attendance/employee-auth/session";
import { canAccessStaffApprovals } from "../../src/lib/staff-pwa/approval-navigation";
import { buildStaffNavigation, isStaffNavigationItemActive } from "../../src/lib/staff-pwa/navigation";
import type { StaffTeamApprovalAccess } from "../../src/lib/staff-pwa/team-approvals";
import type { StaffOvertimeAccess } from "../../src/lib/staff-pwa/overtime-approvals";

const modules = ["CORE", "HR", "CLAIMS", "PAYROLL", "COMMISSION"];
const auth = { membershipId: "staff-one", businessId: "business-one" } as EmployeeAuthContext;
const team = { canReviewLeave: true } as StaffTeamApprovalAccess;
const overtime = {} as StaffOvertimeAccess;

test("ordinary staff and unknown capability have no Approvals or Requests button", () => {
  for (const options of [undefined, {}, { canApprove: false }]) {
    const navigation = buildStaffNavigation(modules, options);
    assert.deepEqual(navigation.primary.map(item => item.label), ["Home", "Time", "Pay", "Profile"]);
    assert(!navigation.primary.some(item => /approvals|requests/.test(item.href)));
    assert.deepEqual(navigation.more, []);
  }
});

test("authorized staff go straight to Approvals and disabled HR cannot show the button", () => {
  const navigation = buildStaffNavigation(modules, { canApprove: true });
  assert.deepEqual(navigation.primary.map(item => item.label), ["Home", "Time", "Approvals", "Pay", "Profile"]);
  assert.equal(navigation.primary[2].href, "/staff/approvals");
  assert.equal(buildStaffNavigation(["CORE", "CLAIMS", "PAYROLL"], { canApprove: true }).primary.some(item => item.label === "Approvals"), false);
});

test("a permission change or a different workplace recomputes the button without cached role assumptions", async () => {
  let allowed = true;
  const dependencies = {
    resolveTeamAccess: async (received: EmployeeAuthContext) => {
      assert.equal(received, auth);
      return allowed ? team : null;
    },
    resolveOvertimeAccess: async () => null,
  };
  assert.equal(await canAccessStaffApprovals(auth, dependencies), true);
  allowed = false;
  assert.equal(await canAccessStaffApprovals(auth, dependencies), false);
});

test("team-only and overtime-only reviewers keep Approvals without fetching pending counts", async () => {
  assert.equal(await canAccessStaffApprovals(auth, {
    resolveTeamAccess: async () => team, resolveOvertimeAccess: async () => null,
  }), true);
  assert.equal(await canAccessStaffApprovals(auth, {
    resolveTeamAccess: async () => null, resolveOvertimeAccess: async () => overtime,
  }), true);
  assert.equal(await canAccessStaffApprovals(auth, {
    resolveTeamAccess: async () => null, resolveOvertimeAccess: async () => null,
  }), false);
});

test("permission lookup failures cannot grant access but a known independent capability still works", async () => {
  const fail = async () => { throw new Error("permission unavailable"); };
  assert.equal(await canAccessStaffApprovals(auth, { resolveTeamAccess: fail, resolveOvertimeAccess: fail }), false);
  assert.equal(await canAccessStaffApprovals(auth, { resolveTeamAccess: fail, resolveOvertimeAccess: async () => null }), false);
  assert.equal(await canAccessStaffApprovals(auth, { resolveTeamAccess: fail, resolveOvertimeAccess: async () => overtime }), true);
});

test("each self-service and manager detail highlights its own canonical tab", () => {
  const navigation = buildStaffNavigation(modules, { canApprove: true });
  for (const [path, label] of [
    ["/staff", "Home"], ["/staff/leave", "Home"], ["/staff/leave/new", "Home"], ["/staff/claims/123", "Home"],
    ["/staff/history/corrections", "Time"], ["/staff/history/records", "Time"], ["/staff/timesheet", "Time"],
    ["/staff/approvals", "Approvals"], ["/staff/approvals/history/leave/123", "Approvals"],
    ["/staff/requests/attendance-corrections", "Approvals"], ["/staff/requests/overtime/123", "Approvals"],
    ["/staff/pay", "Pay"], ["/staff/payslips", "Pay"], ["/staff/device", "Profile"],
  ]) {
    assert.deepEqual(navigation.primary.filter(item => isStaffNavigationItemActive(path, item)).map(item => item.label), [label], path);
  }
  assert.equal(navigation.primary.some(item => isStaffNavigationItemActive("/staff/approvals-unknown", item)), false);
});

test("server shell and live refresh share the same authenticated approval gate", async () => {
  const [layout, api, chrome, approvals, legacy, gate] = await Promise.all([
    "src/app/staff/layout.tsx", "src/app/api/employee-auth/modules/route.ts",
    "src/components/staff-pwa/staff-pwa-chrome.tsx", "src/app/staff/approvals/page.tsx",
    "src/app/staff/requests/page.tsx", "src/lib/staff-pwa/approval-navigation.ts",
  ].map(path => readFile(path, "utf8")));
  assert.match(layout, /canAccessStaffApprovals\(auth\)/);
  assert.match(layout, /canApprove=\{canApprove\}/);
  assert.match(api, /requireEmployeeSelfServiceAuthContext\(request\)/);
  assert.match(api, /canAccessStaffApprovals\(auth\)/);
  assert.match(chrome, /canApprove: liveCanApprove/);
  assert.match(chrome, /result\.canApprove === true/);
  assert.match(chrome, /version !== requestVersion/);
  assert.match(chrome, /setLiveCanApprove\(false\)/);
  assert.match(chrome, /addEventListener\("visibilitychange", refreshNavigation\)/);
  assert.match(chrome, /removeEventListener\("visibilitychange", refreshNavigation\)/);
  assert.match(legacy, /redirect\(await canAccessStaffApprovals\(auth\) \? "\/staff\/approvals" : "\/staff"\)/);
  assert.match(approvals, /if \(!summary && !overtime\?\.canReviewOvertime\) redirect\("\/staff"\)/);
  assert.doesNotMatch(gate, /getStaffTeamApprovalSummary|getStaffOvertimeSummary|pending/);
});
