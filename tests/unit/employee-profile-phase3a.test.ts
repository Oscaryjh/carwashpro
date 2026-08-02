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
          payBasis: "MONTHLY",
          baseSalary: { toString: () => "3200.00" },
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
  assert.equal(result.data.normalWorkMinutesPerDay, 480);
  assert.equal(result.data.normalWorkPolicySource, "Company payroll settings");
  assert.equal(result.data.targetBreakMinutes, 45);
  assert.equal(result.data.targetBreakPolicySource, "Employee profile");

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

test("Phase 3A compensation loader remains isolated after later read-only phases", async () => {
  const root = process.cwd();
  const [route, loader, component] = await Promise.all([
    readFile(path.join(root, "src/app/(business)/team/people/[personId]/page.tsx"), "utf8"),
    readFile(path.join(root, "src/lib/team/employee-profile-compensation-read.ts"), "utf8"),
    readFile(path.join(root, "src/components/employee-profile-payroll.tsx"), "utf8"),
  ]);
  assert.match(route, /activeSection === "payroll"/);
  assert.match(route, /loadEmployeeCompensationSection/);
  assert.match(loader, /VIEW_COMPENSATION/);
  assert.match(component, /Sensitive · Read only/);
  assert.doesNotMatch(component, /<form|<input|<button/);
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
