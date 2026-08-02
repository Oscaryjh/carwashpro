import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import {
  loadEmployeeStatutoryProfileSection,
  maskPayrollIdentifier,
} from "../../src/lib/team/employee-profile-statutory-read";

const businessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const membershipId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("Phase 3B statutory capability selects only contribution fields and masks identifiers", async () => {
  const calls: unknown[] = [];
  const database = {
    branch: { count: () => Promise.resolve(1) },
    employeeBusinessMembership: {
      findFirst(query: unknown) {
        calls.push(query);
        return Promise.resolve({
          statutoryNationality: "MALAYSIAN",
          epfEnabled: true,
          epfMemberBeforeAug1998: false,
          epfMemberNumber: "1234567890",
          socsoEnabled: true,
          socsoCategory: "FIRST",
          socsoMemberNumber: "SOC-99887766",
          eisEnabled: true,
          eisPreviouslyContributed: true,
          lindung24OptIn: false,
          statutoryProfileUpdatedAt: new Date("2026-08-01T00:00:00.000Z"),
        });
      },
    },
  } as unknown as PrismaClient;

  const result = await loadEmployeeStatutoryProfileSection(
    {
      access: buildAccess(["VIEW_STATUTORY_PROFILE", "ALL_BRANCHES"]),
      allowedBranchIds: ["branch-1"],
      businessId,
      membershipId,
    },
    database,
  );

  assert.equal(result.status, "READY");
  if (result.status !== "READY") return;
  assert.equal(result.statutory.status, "READY");
  if (result.statutory.status !== "READY") return;
  assert.equal(result.statutory.data.epfMemberNumberMasked, "•••• 7890");
  assert.equal(result.statutory.data.socsoMemberNumberMasked, "•••• 7766");
  assert.deepEqual(result.tax, { status: "ACCESS_DENIED", reason: "CAPABILITY" });
  assert.equal(JSON.stringify(result).includes("1234567890"), false);
  assert.equal(JSON.stringify(result).includes("SOC-99887766"), false);

  assert.equal(calls.length, 1);
  const query = JSON.stringify(calls[0]);
  assert.match(query, /epfMemberNumber/);
  assert.match(query, /socsoMemberNumber/);
  assert.doesNotMatch(query, /statutoryIdentityNumber|taxIdentificationNumber/);
});

test("Phase 3B tax capability selects only submission identity fields and masks identifiers", async () => {
  const calls: unknown[] = [];
  const database = {
    branch: { count: () => Promise.resolve(1) },
    employeeBusinessMembership: {
      findFirst(query: unknown) {
        calls.push(query);
        return Promise.resolve({
          statutoryIdentityType: "NEW_IC",
          statutoryIdentityNumber: "900101145555",
          statutoryCountryCode: "MY",
          taxIdentificationNumber: "IG12345678901",
          statutoryProfileUpdatedAt: new Date("2026-08-01T00:00:00.000Z"),
        });
      },
    },
  } as unknown as PrismaClient;

  const result = await loadEmployeeStatutoryProfileSection(
    {
      access: buildAccess(["VIEW_TAX_PROFILE", "ALL_BRANCHES"]),
      allowedBranchIds: ["branch-1"],
      businessId,
      membershipId,
    },
    database,
  );

  assert.equal(result.status, "READY");
  if (result.status !== "READY") return;
  assert.deepEqual(result.statutory, {
    status: "ACCESS_DENIED",
    reason: "CAPABILITY",
  });
  assert.equal(result.tax.status, "READY");
  if (result.tax.status !== "READY") return;
  assert.equal(result.tax.data.identityNumberMasked, "•••• 5555");
  assert.equal(result.tax.data.tinMasked, "•••• 8901");
  assert.equal(JSON.stringify(result).includes("900101145555"), false);
  assert.equal(JSON.stringify(result).includes("IG12345678901"), false);

  assert.equal(calls.length, 1);
  const query = JSON.stringify(calls[0]);
  assert.match(query, /statutoryIdentityNumber/);
  assert.match(query, /taxIdentificationNumber/);
  assert.doesNotMatch(query, /epfMemberNumber|socsoMemberNumber/);
});

test("Phase 3B performs no sensitive query without statutory or tax capability", async () => {
  let queryCount = 0;
  const database = {
    branch: { count: () => { queryCount += 1; return Promise.resolve(1); } },
    employeeBusinessMembership: {
      findFirst: () => { queryCount += 1; return Promise.resolve(null); },
    },
  } as unknown as PrismaClient;

  const result = await loadEmployeeStatutoryProfileSection(
    {
      access: buildAccess(["VIEW_PAYROLL_RUN", "ALL_BRANCHES"]),
      allowedBranchIds: ["branch-1"],
      businessId,
      membershipId,
    },
    database,
  );

  assert.equal(result.status, "READY");
  assert.equal(queryCount, 0);
});

test("Phase 3B does not query statutory or tax values without whole-business scope", async () => {
  let sensitiveQueryCount = 0;
  const database = {
    branch: { count: () => Promise.resolve(2) },
    employeeBusinessMembership: {
      findFirst: () => { sensitiveQueryCount += 1; return Promise.resolve(null); },
    },
  } as unknown as PrismaClient;

  const result = await loadEmployeeStatutoryProfileSection(
    {
      access: buildAccess(["VIEW_STATUTORY_PROFILE", "VIEW_TAX_PROFILE"]),
      allowedBranchIds: ["branch-1"],
      businessId,
      membershipId,
    },
    database,
  );

  assert.equal(result.status, "READY");
  if (result.status !== "READY") return;
  assert.deepEqual(result.statutory, {
    status: "ACCESS_DENIED",
    reason: "WHOLE_BUSINESS_SCOPE",
  });
  assert.deepEqual(result.tax, {
    status: "ACCESS_DENIED",
    reason: "WHOLE_BUSINESS_SCOPE",
  });
  assert.equal(sensitiveQueryCount, 0);
});

test("Phase 3B masking never exposes short or formatted identifiers", () => {
  assert.equal(maskPayrollIdentifier(null), null);
  assert.equal(maskPayrollIdentifier(""), null);
  assert.equal(maskPayrollIdentifier("1234"), "••••");
  assert.equal(maskPayrollIdentifier("90-0101-14-5555"), "•••• 5555");
});

test("Phase 3B route and UI are read-only and exclude unrelated payroll domains", async () => {
  const root = process.cwd();
  const [route, loader, component] = await Promise.all([
    readFile(path.join(root, "src/app/(business)/team/people/[personId]/page.tsx"), "utf8"),
    readFile(path.join(root, "src/lib/team/employee-profile-statutory-read.ts"), "utf8"),
    readFile(path.join(root, "src/components/employee-profile-payroll.tsx"), "utf8"),
  ]);

  assert.match(route, /loadEmployeeStatutoryProfileSection/);
  assert.match(route, /Promise\.all/);
  assert.match(loader, /VIEW_STATUTORY_PROFILE/);
  assert.match(loader, /VIEW_TAX_PROFILE/);
  assert.match(component, /Statutory contributions/);
  assert.match(component, /Tax & submission identity/);
  assert.match(component, /Sensitive · Read only/);
  assert.doesNotMatch(component, /<form|<input|<button/);
  assert.doesNotMatch(
    loader,
    /bankAccount|paymentBatch|payrollEntry|payslip/i,
  );
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
