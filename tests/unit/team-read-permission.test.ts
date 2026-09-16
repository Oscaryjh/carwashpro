import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { businessCapabilities, canDirectStaff, canGroupManager } from "../../src/lib/business-groups/capabilities";
import { canReadPeopleRoute, defaultStaffPermissions, getDefaultStaffPermissionsForIndustry, getStaffHomePath, hasStaffPermission, normalizeStaffPermissions, routePermission } from "../../src/lib/auth/staff-permissions";
import { buildPeopleMembershipScopeWhere, hasWholeBusinessPeopleScope } from "../../src/lib/team/people-scope";
import { resolveBusinessAccess } from "../../src/lib/business-groups/business-access";

test("TEAM_READ grants exactly the existing directory read capability and no mutations", () => {
  assert.deepEqual(businessCapabilities.filter(cap => canDirectStaff(["TEAM_READ"], cap)), ["VIEW_TEAM_DIRECTORY"]);
  assert.deepEqual(normalizeStaffPermissions(["TEAM_READ"]), ["TEAM_READ"]);
  assert.equal(hasStaffPermission({ role: "STAFF", permissions: ["TEAM_READ"] }, "TEAM"), false);
});
test("TEAM behavior, group manager policy and staff defaults are not widened", () => {
  assert.deepEqual(businessCapabilities.filter(cap => canDirectStaff(["TEAM"], cap)), ["VIEW_TEAM_DIRECTORY", "MODIFY_TEAM"]);
  assert.equal(canGroupManager("MODIFY_ATTENDANCE_EMPLOYEES"), true);
  assert.equal(defaultStaffPermissions.includes("TEAM_READ"), false);
  for (const industry of ["SALON_BEAUTY", "AUTO_DETAILING"]) assert.equal(getDefaultStaffPermissionsForIndustry(industry).includes("TEAM_READ"), false);
  assert.deepEqual(normalizeStaffPermissions(["TEAM"]), ["TEAM"]);
});
test("readonly admission is limited to directory and exact profile route", () => {
  assert.equal(getStaffHomePath(["TEAM_READ"]), "/team");
  for (const path of ["/team", "/team/people/employee-1"]) assert.equal(canReadPeopleRoute(["TEAM_READ"], path), true);
  for (const path of ["/team/new", "/team/employees/employee-1", "/team/roles", "/team/home", "/team/payroll", "/team/people/employee-1/payroll/bank/edit", "/team/people/employee-1/edit", "/team/people/", "/team/peopleevil/employee-1"]) assert.equal(canReadPeopleRoute(["TEAM_READ"], path), false, path);
  assert.equal(routePermission("/team/new"), "TEAM");
  assert.equal(canReadPeopleRoute([], "/team"), false);
});
test("readonly actor retains assigned branch and business membership filters", () => {
  const scope = { businessId: "synthetic-business", allowedBranchIds: ["assigned"], wholeBusinessScope: false, now: new Date("2026-09-09") };
  assert.equal(hasWholeBusinessPeopleScope({ granted: true, effectiveBusinessRole: "STAFF", permissions: ["TEAM_READ"] }), false);
  const where = buildPeopleMembershipScopeWhere(scope);
  assert.equal(where.businessId, "synthetic-business");
  assert.deepEqual(where.branchAssignments?.some?.branchId, { in: ["assigned"] });
});
test("normal Staff directory denied; readonly view allowed; readonly edit and cross-business denied", async () => {
  for (const permissions of [[], ["TEAM_READ"]]) {
    const database = {
      user: { findUnique: async () => ({ id: "actor", businessId: "business", branchId: "branch", role: "STAFF", permissions, status: "active", loginEnabled: true, business: { id: "business", status: "active", industryType: "SALON_BEAUTY" }, branch: { id: "branch", businessId: "business", status: "ACTIVE" } }) },
      business: { findUnique: async () => ({ id: "other-business", status: "active", industryType: "SALON_BEAUTY" }) },
      businessGroupUser: { findFirst: async () => null },
    } as unknown as Parameters<typeof resolveBusinessAccess>[1];
    assert.equal((await resolveBusinessAccess({ userId: "actor", requestedBusinessId: "business", capability: "VIEW_TEAM_DIRECTORY" }, database)).granted, permissions.length > 0);
    for (const capability of ["MODIFY_TEAM", "MODIFY_ATTENDANCE_EMPLOYEES", "EDIT_COMPENSATION", "EDIT_STATUTORY_PROFILE", "EDIT_BANK_ACCOUNT", "MANAGE_TEAM_PERMISSIONS", "APPROVE_PAYROLL"] as const) assert.equal((await resolveBusinessAccess({ userId: "actor", requestedBusinessId: "business", capability }, database)).granted, false);
    assert.equal((await resolveBusinessAccess({ userId: "actor", requestedBusinessId: "other-business", capability: "VIEW_TEAM_DIRECTORY" }, database)).granted, false);
  }
});
test("server edit and avatar actions still require mutation capability", () => {
  for (const file of ["src/app/(business)/team/employees/actions.ts", "src/app/(business)/team/people/[personId]/avatar-actions.ts", "src/app/(business)/team/actions.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /"MODIFY_TEAM"/);
    assert.doesNotMatch(source, /"TEAM_READ"/);
  }
  const profile = readFileSync("src/app/(business)/team/people/[personId]/page.tsx", "utf8");
  assert.match(profile, /query\.edit === "profile" && canManageTeam/);
  const directory = readFileSync("src/app/(business)/team/page.tsx", "utf8");
  assert.match(directory, /hasStaffPermission\(user, "TEAM_READ"\) && !canManageTeam/);
});

test("team workspace admits scoped group managers through an allowed child capability", () => {
  const layout = readFileSync("src/app/(business)/team/layout.tsx", "utf8");
  assert.match(layout, /requireBusinessUserWithAnyCapability/);
  for (const capability of [
    "VIEW_TEAM_DIRECTORY",
    "VIEW_ATTENDANCE_EMPLOYEES",
    "VIEW_ROSTER",
    "VIEW_LEAVE",
    "VIEW_CLAIM",
    "VIEW_PAYROLL_RUN",
  ]) {
    assert.match(layout, new RegExp(`"${capability}"`));
  }
  assert.doesNotMatch(layout, /requireBusinessUser\(\)/);
});
