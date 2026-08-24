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
  assert.ok(managerTabs.includes("work"));
  assert.ok(managerTabs.includes("time"));
  assert.ok(managerTabs.includes("access"));
  assert.equal(managerTabs.includes("compensation"), false);
  assert.equal(canViewEmployeeProfileTab(groupManager, "payroll"), false);

  const groupOwner = buildAccess({
    actorRole: "GROUP_OWNER",
    effectiveBusinessRole: "BUSINESS_OWNER",
    source: "GROUP_ACCESS",
  });
  assert.equal(canViewEmployeeProfileTab(groupOwner, "compensation"), true);

  const directoryOnlyStaff = buildAccess({
    actorRole: "STAFF",
    effectiveBusinessRole: "STAFF",
    permissions: ["TEAM"],
    source: "DIRECT_BUSINESS",
  });
  const directoryTabs = getVisibleEmployeeProfileTabs(directoryOnlyStaff).map(
    (tab) => tab.key,
  );
  assert.deepEqual(directoryTabs, ["overview", "work", "access"]);
  assert.equal(directoryTabs.includes("time"), false);
  assert.equal(directoryTabs.includes("compensation"), false);
});

test("employee profile shell keeps sensitive payroll data out of the profile editor", async () => {
  const root = process.cwd();
  const profilePage = await readFile(
    path.join(root, "src/app/(business)/team/people/[personId]/page.tsx"),
    "utf8",
  );
  const profileEditorLoader = profilePage.slice(
    profilePage.indexOf("async function loadProfileEditData"),
    profilePage.indexOf("function parseProfileUpdateNotice"),
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
      profileEditorLoader.includes(forbiddenField),
      false,
      `${forbiddenField} must not be queried by the Phase 1 shell`,
    );
  }

  assert.match(profilePage, /buildPeopleMembershipScopeWhere/);
  assert.match(profilePage, /buildPeopleStaffScopeWhere/);
  assert.match(profilePage, /employeeCode: true/);
  assert.match(profilePage, /loadProfileEditData/);
  assert.match(profilePage, /StaffEditModal/);
  assert.match(profilePage, /returnTo={profilePath}/);
  assert.match(profilePage, /fullName: true/);
  assert.match(profilePage, /status: true/);
  assert.match(profilePage, /EmployeeProfileCoreStaffOverview/);
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
  assert.match(
    legacyStaffRoute,
    /redirect\(`\/team\/people\/\$\{staff\.id\}`\)/,
  );
  assert.match(legacyEmployeeRoute, /AttendanceEmployeeForm/);
  assert.equal(routePermission("/team/people/employee-1"), "TEAM");
});

test("People directory reuses the uploaded employee avatar with initials fallback", async () => {
  const root = process.cwd();
  const peoplePage = await readFile(
    path.join(root, "src/app/(business)/team/page.tsx"),
    "utf8",
  );

  assert.match(peoplePage, /avatarUrl: true/);
  assert.match(
    peoplePage,
    /avatarUrl={employment\?\.avatarUrl \?\? null}/,
  );
  assert.match(peoplePage, /avatarUrl={employee\.avatarUrl}/);
  assert.match(peoplePage, /function TeamAvatar/);
  assert.match(peoplePage, /<Image[\s\S]*?fill[\s\S]*?unoptimized/);
});

test("People directory keeps role and level editing inside the edit modal", async () => {
  const root = process.cwd();
  const peoplePage = await readFile(
    path.join(root, "src/app/(business)/team/page.tsx"),
    "utf8",
  );
  const staffForm = await readFile(
    path.join(root, "src/components/staff-form.tsx"),
    "utf8",
  );

  assert.doesNotMatch(peoplePage, />Apply role</);
  assert.doesNotMatch(peoplePage, />Apply level</);
  assert.match(staffForm, /name="staffRoleProfileId"/);
  assert.match(staffForm, /name="staffLevelId"/);
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
  assert.doesNotMatch(
    shell,
    /Salary, bank and statutory information will appear here/,
  );
});

test("employee profile presents one concise grouped record without exposing bank details", async () => {
  const root = process.cwd();
  const shell = await readFile(
    path.join(root, "src/components/employee-profile-shell.tsx"),
    "utf8",
  );
  const tabs = await readFile(
    path.join(root, "src/lib/team/employee-profile-tabs.ts"),
    "utf8",
  );

  assert.doesNotMatch(shell, /Employee hub/);
  assert.doesNotMatch(shell, /Employee record/);
  assert.doesNotMatch(shell, /One profile, organised by purpose/);
  assert.match(shell, /Bank\s+account numbers stay masked/);
  assert.doesNotMatch(shell, /accountNumber|bankAccountNumber/);
  assert.match(tabs, /group: "Employee 360"/);
  assert.match(tabs, /label: "Overview"/);
  assert.match(tabs, /label: "Work"/);
  assert.match(tabs, /label: "Time & Leave"/);
  assert.match(tabs, /label: "Compensation"/);
  assert.match(tabs, /label: "Access"/);
  assert.doesNotMatch(tabs, /label: "Personal"|label: "Employment"|label: "Payroll & bank"/);
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
