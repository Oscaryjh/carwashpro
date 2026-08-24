import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import { loadEmployeeCompensationSection } from "../../src/lib/team/employee-profile-compensation-read";

const businessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const membershipId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("Phase 3A loads only current compensation after capability and whole-business scope checks", async () => {
  const calls: Array<{ model: string; query: unknown }> = [];
  const database = {
    business: {
      findUnique(query: unknown) {
        calls.push({ model: "business", query });
        return Promise.resolve({ timezone: "Asia/Kuala_Lumpur" });
      },
    },
    branch: {
      count(query: unknown) {
        calls.push({ model: "branch", query });
        return Promise.resolve(2);
      },
    },
    employeeBusinessMembership: {
      findFirst(query: unknown) {
        calls.push({ model: "membership", query });
        return Promise.resolve({
          id: membershipId,
          compensationRevision: 2,
          recurringPayRevision: 4,
          workTargetRevision: 3,
          payBasis: "MONTHLY",
          baseSalary: { toString: () => "3200.00" },
          workingDaysPerMonth: 24,
          normalWorkMinutesPerDay: null,
          targetBreakMinutes: 45,
        });
      },
    },
    payrollSetting: {
      findUnique(query: unknown) {
        calls.push({ model: "setting", query });
        return Promise.resolve({
          workingDaysPerMonth: 26,
          normalWorkMinutesPerDay: 480,
          breakMinutesPerDay: 60,
        });
      },
    },
    employeeCompensationVersion: {
      findFirst(query: { where?: { effectiveFromMonth?: { lte?: Date } } }) {
        calls.push({ model: "compensationVersion", query });
        return Promise.resolve(query.where?.effectiveFromMonth?.lte ? {
          baseRate: { toString: () => "3200.00" },
          effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
          payBasis: "MONTHLY",
        } : null);
      },
    },
    employeeRecurringPayComponent: {
      findMany(query: unknown) {
        calls.push({ model: "recurringPay", query });
        return Promise.resolve([]);
      },
    },
    payrollRun: {
      count(query: unknown) {
        calls.push({ model: "payrollRun", query });
        return Promise.resolve(1);
      },
    },
  } as unknown as PrismaClient;

  const result = await loadEmployeeCompensationSection(
    {
      access: buildAccess(["VIEW_COMPENSATION", "ALL_BRANCHES"]),
      allowedBranchIds: ["branch-1", "branch-2"],
      businessId,
      membershipId,
    },
    database,
  );

  assert.equal(result.status, "READY");
  if (result.status !== "READY") return;
  assert.equal(result.data.baseRate, "3200.00");
  assert.equal(result.data.workingDaysPerMonth, 24);
  assert.equal(result.data.workingDaysPolicySource, "Employee profile");
  assert.equal(result.data.normalWorkMinutesPerDay, 480);
  assert.equal(result.data.normalWorkPolicySource, "Company payroll settings");
  assert.equal(result.data.targetBreakMinutes, 45);
  assert.equal(result.data.targetBreakPolicySource, "Employee profile");
  assert.equal(result.data.compensationRevision, 2);
  assert.equal(result.data.recurringPayRevision, 4);
  assert.deepEqual(result.data.recurringPayComponents, []);
  assert.equal(result.data.workTargetRevision, 3);
  assert.equal(result.data.affectedDrafts, 1);
  assert.equal(result.data.effectiveFromMonth, "2026-08");

  const membershipQuery = calls.find((call) => call.model === "membership");
  const serialized = JSON.stringify(membershipQuery?.query);
  assert.match(serialized, new RegExp(businessId));
  assert.match(serialized, new RegExp(membershipId));
  assert.match(serialized, /baseSalary/);
  assert.match(serialized, /payBasis/);
  for (const forbidden of [
    "statutoryNationality",
    "statutoryIdentityNumber",
    "taxIdentificationNumber",
    "epfMemberNumber",
    "socsoMemberNumber",
    "bankAccount",
    "payrollEntries",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("Phase 3A performs no compensation query without VIEW_COMPENSATION", async () => {
  let queryCount = 0;
  const database = {
    branch: { count: () => { queryCount += 1; return Promise.resolve(1); } },
    employeeBusinessMembership: {
      findFirst: () => { queryCount += 1; return Promise.resolve(null); },
    },
    payrollSetting: {
      findUnique: () => { queryCount += 1; return Promise.resolve(null); },
    },
  } as unknown as PrismaClient;

  const result = await loadEmployeeCompensationSection(
    {
      access: buildAccess(["VIEW_PAYROLL_RUN", "ALL_BRANCHES"]),
      allowedBranchIds: ["branch-1"],
      businessId,
      membershipId,
    },
    database,
  );

  assert.deepEqual(result, { status: "ACCESS_DENIED", reason: "CAPABILITY" });
  assert.equal(queryCount, 0);
});

test("Phase 3A does not load salary for branch-restricted staff", async () => {
  let sensitiveQueryCount = 0;
  const database = {
    branch: { count: () => Promise.resolve(2) },
    employeeBusinessMembership: {
      findFirst: () => { sensitiveQueryCount += 1; return Promise.resolve(null); },
    },
    payrollSetting: {
      findUnique: () => { sensitiveQueryCount += 1; return Promise.resolve(null); },
    },
  } as unknown as PrismaClient;

  const result = await loadEmployeeCompensationSection(
    {
      access: buildAccess(["VIEW_COMPENSATION"]),
      allowedBranchIds: ["branch-1"],
      businessId,
      membershipId,
    },
    database,
  );

  assert.deepEqual(result, {
    status: "ACCESS_DENIED",
    reason: "WHOLE_BUSINESS_SCOPE",
  });
  assert.equal(sensitiveQueryCount, 0);
});

test("Phase 4A compensation UI uses canonical commands and keeps sensitive domains isolated", async () => {
  const root = process.cwd();
  const [route, loader, component, actions] = await Promise.all([
    readFile(path.join(root, "src/app/(business)/team/people/[personId]/page.tsx"), "utf8"),
    readFile(path.join(root, "src/lib/team/employee-profile-compensation-read.ts"), "utf8"),
    readFile(path.join(root, "src/components/employee-profile-payroll.tsx"), "utf8"),
    readFile(path.join(root, "src/app/(business)/team/people/[personId]/payroll/actions.ts"), "utf8"),
  ]);
  assert.match(route, /activeSection === "compensation"/);
  assert.match(route, /activeView === "payroll"/);
  assert.match(route, /loadEmployeeCompensationSection/);
  assert.match(loader, /VIEW_COMPENSATION/);
  assert.match(component, /Protected payroll data/);
  assert.match(component, /scheduleEmployeeCompensationChangeAction/);
  assert.match(component, /scheduleEmployeeRecurringPayAction/);
  assert.match(component, /updateEmployeePayrollWorkTargetAction/);
  assert.match(component, /Effective payroll month/);
  assert.match(component, /Change reason/);
  assert.match(component, /Applies to the next payroll/);
  assert.match(component, /payroll draft needs refreshing/);
  assert.match(component, /Edit salary/);
  assert.match(component, /Add monthly item/);
  assert.match(component, /Edit salary work basis/);
  assert.match(component, /Working days \/ month/);
  assert.match(component, /name="workingDaysPerMonth"/);
  assert.match(component, /Save salary/);
  assert.match(component, /Save salary work basis/);
  assert.match(component, /Item name/);
  const recurringPayForms = component.slice(
    component.indexOf("function RecurringPayCreateForm"),
    component.indexOf("function CompensationEditForm"),
  );
  assert.doesNotMatch(recurringPayForms, /<ReasonFields/);
  const everydayPayrollForms = component.slice(
    component.indexOf("function CompensationEditForm"),
    component.indexOf("function ReasonFields"),
  );
  assert.doesNotMatch(everydayPayrollForms, /<ReasonFields/);
  assert.match(actions, /Monthly payroll item added from the employee payroll profile/);
  assert.match(actions, /Salary updated from the employee payroll profile/);
  assert.match(actions, /Payroll work hours updated from the employee payroll profile/);
  assert.match(actions, /reasonType: "PAYROLL_POLICY_CHANGE"/);
  assert.doesNotMatch(
    component,
    /Edit compensation|Add recurring component|Edit payroll work target|Stable code|TRANSPORT_ALLOWANCE/,
  );
  assert.doesNotMatch(component, /prisma\./);
  for (const forbidden of [
    "statutoryNationality",
    "statutoryIdentityNumber",
    "taxIdentificationNumber",
    "epfMemberNumber",
    "socsoMemberNumber",
    "bankAccount",
    "paymentBatch",
  ]) {
    assert.equal(loader.includes(forbidden), false, forbidden);
  }
});

function buildAccess(permissions: string[]): ResolvedBusinessAccess {
  return {
    granted: true,
    userId: "user-1",
    homeBusinessId: businessId,
    businessId,
    branchId: "branch-1",
    identityRole: "STAFF",
    actorRole: "STAFF",
    effectiveBusinessRole: "STAFF",
    permissions,
    industryType: "SALON_BEAUTY",
    source: "DIRECT_BUSINESS",
    groupId: null,
    groupUserId: null,
    capability: null,
  };
}
