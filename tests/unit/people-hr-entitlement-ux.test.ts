import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import {
  modulesForCapability,
  modulesForStaffPermission,
  type ModuleKey,
} from "../../src/lib/modules/registry";
import { getVisibleEmployeeProfileTabs } from "../../src/lib/team/employee-profile-tabs";
import { assertStaffPermissionsEntitled } from "../../src/lib/team/permission-administration";

test("People Core remains visible while extension tabs follow module entitlement", () => {
  const owner = ownerAccess();
  const posOnly = tabs(owner, ["CORE", "POS", "SALON"]);
  assert.deepEqual(posOnly, ["overview", "work", "access"]);

  const hrOnly = tabs(owner, ["CORE", "HR"]);
  assert.deepEqual(hrOnly, ["overview", "work", "time", "access"]);
  assert.equal(hrOnly.includes("compensation"), false);

  const full = tabs(owner, ["CORE", "HR", "PAYROLL", "STATUTORY", "CLAIMS"]);
  for (const section of ["overview", "work", "time", "compensation", "access"] as const) {
    assert.ok(full.includes(section));
  }
});

test("permission editor and actions classify permissions by entitled module", () => {
  assert.deepEqual(modulesForStaffPermission("TEAM", "SALON_BEAUTY"), []);
  assert.deepEqual(
    modulesForStaffPermission("ATTENDANCE_EMPLOYEE_READ", "SALON_BEAUTY"),
    ["HR"],
  );
  assert.deepEqual(
    modulesForStaffPermission("VIEW_COMPENSATION", "SALON_BEAUTY"),
    ["PAYROLL"],
  );
  assert.deepEqual(
    modulesForStaffPermission("VIEW_STATUTORY_PROFILE", "SALON_BEAUTY"),
    ["STATUTORY"],
  );
  assert.deepEqual(modulesForStaffPermission("VIEW_CLAIM", "SALON_BEAUTY"), [
    "CLAIMS",
  ]);
  assert.deepEqual(
    modulesForCapability("VIEW_TEAM_DIRECTORY", "SALON_BEAUTY"),
    [],
  );
  assert.throws(
    () =>
      assertStaffPermissionsEntitled(
        ["VIEW_COMPENSATION"],
        new Set<ModuleKey>(["CORE", "POS"]),
        "SALON_BEAUTY",
      ),
    /disabled business modules/,
  );
  assert.doesNotThrow(() =>
    assertStaffPermissionsEntitled(
      ["TEAM", "VIEW_COMPENSATION"],
      new Set<ModuleKey>(["CORE", "PAYROLL"]),
      "SALON_BEAUTY",
    ),
  );
});

test("People Profile loaders keep core, payroll and statutory data separate", async () => {
  const root = process.cwd();
  const profilePage = await readFile(
    path.join(root, "src/app/(business)/team/people/[personId]/page.tsx"),
    "utf8",
  );
  const reads = await readFile(
    path.join(root, "src/lib/team/employee-profile-read.ts"),
    "utf8",
  );
  const compensationStart = profilePage.indexOf('activeSection === "compensation"');
  const payrollStart = profilePage.indexOf('activeView === "payroll"', compensationStart);
  const statutoryStart = profilePage.indexOf('activeView === "statutory"', payrollStart);
  const payrollBlock = profilePage.slice(payrollStart, statutoryStart);
  assert.doesNotMatch(payrollBlock, /loadEmployeeStatutoryProfileSection/);
  assert.match(
    profilePage.slice(statutoryStart),
    /loadEmployeeStatutoryProfileSection/,
  );

  const overviewRead = reads.slice(
    reads.indexOf("getEmployeeProfileOverview"),
    reads.indexOf("getEmployeeProfilePersonal"),
  );
  assert.doesNotMatch(
    overviewRead,
    /attendanceEnabled|employmentType|joinedAt|baseSalary|payBasis/,
  );
  const personalRead = reads.slice(
    reads.indexOf("getEmployeeProfilePersonal"),
    reads.indexOf("getEmployeeProfileEmployment"),
  );
  assert.doesNotMatch(
    personalRead,
    /statutory|taxIdentification|bank|salary/,
  );
  assert.match(personalRead, /dateOfBirth: true/);
});

test("People list and core actions avoid disabled HR and payroll reads", async () => {
  const root = process.cwd();
  const teamPage = await readFile(
    path.join(root, "src/app/(business)/team/page.tsx"),
    "utf8",
  );
  const actions = await readFile(
    path.join(root, "src/app/(business)/team/actions.ts"),
    "utf8",
  );
  const form = await readFile(
    path.join(root, "src/components/staff-form.tsx"),
    "utf8",
  );
  assert.match(
    teamPage,
    /employeeOnlyDataRequired = section === "people" && hrEnabled/,
  );
  assert.match(teamPage, /canViewAttendance &&[\s\S]*section === "attendance"/);
  assert.match(teamPage, /allowHrFields=\{hrEnabled\}/);
  assert.match(teamPage, /allowPayrollFields=\{canEditCompensation\}/);
  assert.match(form, /value=\{allowHrFields \? "" : "on"\}/);
  assert.match(form, /name="peopleCoreOnly"/);
  assert.match(actions, /formData\.get\("peopleCoreOnly"\) === "on"/);
  assert.match(actions, /createCoreStaff/);
  assert.match(actions, /assertStaffPermissionsEntitled/);
  assert.match(teamPage, /Staff App ready/);
  assert.match(teamPage, /team-member-compact-status/);
  assert.doesNotMatch(teamPage, /enableStaffAppAction/);
  assert.match(actions, /enableStaffAppForLegacyUser/);
});

test("People navigation keeps one HR workspace entry and hides legacy availability scheduling", async () => {
  const root = process.cwd();
  const appShell = await readFile(
    path.join(root, "src/components/app-shell.tsx"),
    "utf8",
  );
  const teamPage = await readFile(
    path.join(root, "src/app/(business)/team/page.tsx"),
    "utf8",
  );
  const commissionPage = await readFile(
    path.join(root, "src/app/(business)/team/commission/page.tsx"),
    "utf8",
  );

  assert.doesNotMatch(appShell, /children:\s*teamWorkspaceItems/);
  assert.match(
    appShell,
    /label: moduleEnabled\("HR"\) \? "People & HR" : "People"/,
  );
  assert.doesNotMatch(teamPage, /aria-label="People tools"/);
  assert.doesNotMatch(teamPage, /className="team-section-nav"/);
  assert.match(teamPage, /label: "Availability & Services"/);
  assert.match(appShell, /label: "Staff access roles"/);
  assert.match(appShell, /\/team\?section=roles&focus=roles/);
  assert.match(commissionPage, />Staff levels<\/Link>/);
  assert.match(commissionPage, /\/team\?section=roles&focus=levels/);
});

test("Team activity sits after Payroll in the workspace navigation and is paginated at ten records", async () => {
  const root = process.cwd();
  const teamPage = await readFile(
    path.join(root, "src/app/(business)/team/page.tsx"),
    "utf8",
  );
  const teamLayout = await readFile(
    path.join(root, "src/app/(business)/team/layout.tsx"),
    "utf8",
  );
  const workspaceNav = await readFile(
    path.join(root, "src/components/hr-payroll-workspace-nav.tsx"),
    "utf8",
  );

  assert.match(
    teamPage,
    /section === "schedule" && !params\.modal[\s\S]*ariaLabel="Availability and services"/,
  );
  assert.match(
    teamPage,
    /section === "roles" && !params\.modal[\s\S]*ariaLabel=\{configurationTitle\}/,
  );
  assert.match(
    teamPage,
    /section === "activity" && !params\.modal[\s\S]*ariaLabel="Team activity"/,
  );
  assert.doesNotMatch(teamPage, /team-activity-header-link/);
  assert.match(
    teamLayout,
    /label: "Payroll"[\s\S]*href: "\/team\?section=activity"[\s\S]*label: "Team activity"/,
  );
  assert.match(teamLayout, /activeQuery: \{ name: "section", value: "activity" \}/);
  assert.match(workspaceNav, /\| "activity"/);
  assert.match(workspaceNav, /queryActiveItem/);
  assert.doesNotMatch(teamPage, /aria-label="People tools"/);
  assert.match(teamPage, /slice\(firstEntryIndex, firstEntryIndex \+ 10\)/);
  assert.match(teamPage, /aria-label="Activity pages"/);
  assert.match(teamPage, /activityPage=\$\{page - 1\}/);
  assert.match(teamPage, /activityPage=\$\{page \+ 1\}/);
});

function tabs(access: ResolvedBusinessAccess, enabled: ModuleKey[]) {
  return getVisibleEmployeeProfileTabs(access, new Set(enabled)).map(
    (tab) => tab.key,
  );
}

function ownerAccess(): ResolvedBusinessAccess {
  return {
    granted: true,
    userId: "user-1",
    homeBusinessId: "business-1",
    businessId: "business-1",
    branchId: null,
    identityRole: "BUSINESS_OWNER",
    actorRole: "BUSINESS_OWNER",
    effectiveBusinessRole: "BUSINESS_OWNER",
    permissions: [],
    industryType: "SALON_BEAUTY",
    source: "DIRECT_BUSINESS",
    groupId: null,
    groupUserId: null,
    capability: null,
  };
}
