import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import {
  canViewEmployeeProfileTab,
  getVisibleEmployeeProfileTabs,
} from "../../src/lib/team/employee-profile-tabs";
import { routePermission } from "../../src/lib/auth/staff-permissions";

test("employee profile tabs follow capabilities instead of role-name UI checks", () => {
  const groupManager = buildAccess({
    actorRole: "GROUP_MANAGER",
    effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY",
    source: "GROUP_ACCESS",
  });
  const managerTabs = getVisibleEmployeeProfileTabs(groupManager).map(
    (tab) => tab.key,
  );

  assert.ok(managerTabs.includes("overview"));
  assert.ok(managerTabs.includes("attendance"));
  assert.equal(managerTabs.includes("payroll"), false);
  assert.equal(canViewEmployeeProfileTab(groupManager, "payroll"), false);

  const groupOwner = buildAccess({
    actorRole: "GROUP_OWNER",
    effectiveBusinessRole: "BUSINESS_OWNER",
    source: "GROUP_ACCESS",
  });
  assert.equal(canViewEmployeeProfileTab(groupOwner, "payroll"), true);

  const directoryOnlyStaff = buildAccess({
    actorRole: "STAFF",
    effectiveBusinessRole: "STAFF",
    permissions: ["TEAM"],
    source: "DIRECT_BUSINESS",
  });
  const directoryTabs = getVisibleEmployeeProfileTabs(directoryOnlyStaff).map(
    (tab) => tab.key,
  );
  assert.ok(directoryTabs.includes("personal"));
  assert.equal(directoryTabs.includes("attendance"), false);
  assert.equal(directoryTabs.includes("payroll"), false);
});

test("employee profile shell queries only non-sensitive header data", async () => {
  const root = process.cwd();
  const profilePage = await readFile(
    path.join(root, "src/app/(business)/team/people/[personId]/page.tsx"),
    "utf8",
  );

  for (const forbiddenField of [
    "baseSalary",
    "payBasis",
    "bankAccount",
    "bankName",
    "epfMemberNumber",
    "socsoMemberNumber",
    "taxIdentificationNumber",
    "statutoryIdentityNumber",
    "payrollEntries",
  ]) {
    assert.equal(
      profilePage.includes(forbiddenField),
      false,
      `${forbiddenField} must not be queried by the Phase 1 shell`,
    );
  }

  assert.match(profilePage, /buildPeopleMembershipScopeWhere/);
  assert.match(profilePage, /buildPeopleStaffScopeWhere/);
  assert.match(profilePage, /employeeCode: true/);
  assert.match(profilePage, /employmentType: true/);
  assert.match(profilePage, /fullName: true/);
  assert.match(profilePage, /status: true/);
});

test("People uses the canonical shell while legacy edit routes remain available", async () => {
  const root = process.cwd();
  const peoplePage = await readFile(
    path.join(root, "src/app/(business)/team/page.tsx"),
    "utf8",
  );
  const legacyStaffRoute = await readFile(
    path.join(root, "src/app/(business)/team/[staffId]/page.tsx"),
    "utf8",
  );
  const legacyEmployeeRoute = await readFile(
    path.join(root, "src/app/(business)/team/employees/[employeeId]/page.tsx"),
    "utf8",
  );

  assert.match(peoplePage, /href={`\/team\/people\/\$\{member\.id\}`}/);
  assert.match(peoplePage, /href={`\/team\/people\/\$\{employee\.id\}`}/);
  assert.match(legacyStaffRoute, /redirect\(`\/team\/people\/\$\{staff\.id\}`\)/);
  assert.match(legacyEmployeeRoute, /AttendanceEmployeeForm/);
  assert.equal(routePermission("/team/people/employee-1"), "TEAM");
});

test("employee profile route provides all required Phase 1 states", async () => {
  const root = process.cwd();
  for (const file of ["loading.tsx", "error.tsx", "not-found.tsx"]) {
    const source = await readFile(
      path.join(root, `src/app/(business)/team/people/[personId]/${file}`),
      "utf8",
    );
    assert.ok(source.length > 100, `${file} should provide a real UI state`);
  }

  const shell = await readFile(
    path.join(root, "src/components/employee-profile-shell.tsx"),
    "utf8",
  );
  assert.match(shell, /Access denied/);
  assert.match(shell, /Employment profile is not linked/);
  assert.match(shell, /No sensitive payroll data is queried/);
});

function buildAccess(
  overrides: Partial<Extract<ResolvedBusinessAccess, { granted: true }>>,
): ResolvedBusinessAccess {
  return {
    granted: true,
    userId: "user-1",
    homeBusinessId: "business-1",
    businessId: "business-1",
    branchId: null,
    identityRole: "STAFF",
    actorRole: "STAFF",
    effectiveBusinessRole: "STAFF",
    permissions: [],
    industryType: "SALON_BEAUTY",
    source: "DIRECT_BUSINESS",
    groupId: null,
    groupUserId: null,
    capability: null,
    ...overrides,
  };
}
