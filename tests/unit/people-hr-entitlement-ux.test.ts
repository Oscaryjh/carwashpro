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
  assert.deepEqual(posOnly, ["overview", "personal"]);

  const hrOnly = tabs(owner, ["CORE", "HR"]);
  assert.deepEqual(hrOnly, ["overview", "personal", "employment", "attendance", "leave"]);
  assert.equal(hrOnly.includes("payroll"), false);
  assert.equal(hrOnly.includes("statutory"), false);
  assert.equal(hrOnly.includes("claims"), false);

  const full = tabs(owner, ["CORE", "HR", "PAYROLL", "STATUTORY", "CLAIMS"]);
  for (const section of ["employment", "attendance", "leave", "payroll", "statutory", "claims"] as const) {
    assert.ok(full.includes(section));
  }
});

test("permission editor and actions classify permissions by entitled module", () => {
  assert.deepEqual(modulesForStaffPermission("TEAM", "SALON_BEAUTY"), []);
  assert.deepEqual(modulesForStaffPermission("ATTENDANCE_EMPLOYEE_READ", "SALON_BEAUTY"), ["HR"]);
  assert.deepEqual(modulesForStaffPermission("VIEW_COMPENSATION", "SALON_BEAUTY"), ["PAYROLL"]);
  assert.deepEqual(modulesForStaffPermission("VIEW_STATUTORY_PROFILE", "SALON_BEAUTY"), ["STATUTORY"]);
  assert.deepEqual(modulesForStaffPermission("VIEW_CLAIM", "SALON_BEAUTY"), ["CLAIMS"]);
  assert.deepEqual(modulesForCapability("VIEW_TEAM_DIRECTORY", "SALON_BEAUTY"), []);
  assert.throws(
    () => assertStaffPermissionsEntitled(["VIEW_COMPENSATION"], new Set<ModuleKey>(["CORE", "POS"]), "SALON_BEAUTY"),
    /disabled business modules/,
  );
  assert.doesNotThrow(() =>
    assertStaffPermissionsEntitled(["TEAM", "VIEW_COMPENSATION"], new Set<ModuleKey>(["CORE", "PAYROLL"]), "SALON_BEAUTY"),
  );
});

test("People Profile loaders keep core, payroll and statutory data separate", async () => {
  const root = process.cwd();
  const profilePage = await readFile(path.join(root, "src/app/(business)/team/people/[personId]/page.tsx"), "utf8");
  const reads = await readFile(path.join(root, "src/lib/team/employee-profile-read.ts"), "utf8");
  const payrollStart = profilePage.indexOf('activeSection === "payroll"');
  const statutoryStart = profilePage.indexOf('activeSection === "statutory"');
  const payrollBlock = profilePage.slice(payrollStart, statutoryStart);
  assert.doesNotMatch(payrollBlock, /loadEmployeeStatutoryProfileSection/);
  assert.match(profilePage.slice(statutoryStart), /loadEmployeeStatutoryProfileSection/);

  const overviewRead = reads.slice(reads.indexOf("getEmployeeProfileOverview"), reads.indexOf("getEmployeeProfilePersonal"));
  assert.doesNotMatch(overviewRead, /attendanceEnabled|employmentType|joinedAt|baseSalary|payBasis/);
  const personalRead = reads.slice(reads.indexOf("getEmployeeProfilePersonal"), reads.indexOf("getEmployeeProfileEmployment"));
  assert.doesNotMatch(personalRead, /dateOfBirth|statutory|taxIdentification|bank|salary/);
});

test("People list and core actions avoid disabled HR and payroll reads", async () => {
  const root = process.cwd();
  const teamPage = await readFile(path.join(root, "src/app/(business)/team/page.tsx"), "utf8");
  const actions = await readFile(path.join(root, "src/app/(business)/team/actions.ts"), "utf8");
  const form = await readFile(path.join(root, "src/components/staff-form.tsx"), "utf8");
  assert.match(teamPage, /employeeOnlyDataRequired = section === "people" && hrEnabled/);
  assert.match(teamPage, /canViewAttendance &&[\s\S]*section === "attendance"/);
  assert.match(teamPage, /allowHrFields=\{hrEnabled\}/);
  assert.match(teamPage, /allowPayrollFields=\{canEditCompensation\}/);
  assert.match(form, /value=\{allowHrFields \? "" : "on"\}/);
  assert.match(form, /name="peopleCoreOnly"/);
  assert.match(actions, /formData\.get\("peopleCoreOnly"\) === "on"/);
  assert.match(actions, /createCoreStaff/);
  assert.match(actions, /assertStaffPermissionsEntitled/);
});

function tabs(access: ResolvedBusinessAccess, enabled: ModuleKey[]) {
  return getVisibleEmployeeProfileTabs(access, new Set(enabled)).map((tab) => tab.key);
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
