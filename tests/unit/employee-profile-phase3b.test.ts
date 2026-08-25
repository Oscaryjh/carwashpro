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
          id: membershipId,
          statutoryProfileRevision: 2,
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
  assert.equal(result.statutory.data.canEdit, false);
  assert.equal(result.statutory.data.expectedRevision, 2);
  assert.equal(result.statutory.data.epfMemberNumber, null);
  assert.equal(result.statutory.data.epfMemberNumberMasked, "•••• 7890");
  assert.equal(result.statutory.data.socsoMemberNumber, null);
  assert.equal(result.statutory.data.socsoMemberNumberMasked, "•••• 7766");
  assert.deepEqual(result.tax, {
    status: "ACCESS_DENIED",
    reason: "CAPABILITY",
  });
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
          id: membershipId,
          taxProfileRevision: 3,
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
  assert.equal(result.tax.data.canEdit, false);
  assert.equal(result.tax.data.expectedRevision, 3);
  assert.equal(result.tax.data.identityNumber, null);
  assert.equal(result.tax.data.identityNumberMasked, "•••• 5555");
  assert.equal(result.tax.data.tin, null);
  assert.equal(result.tax.data.tinMasked, "•••• 8901");
  assert.equal(JSON.stringify(result).includes("900101145555"), false);
  assert.equal(JSON.stringify(result).includes("IG12345678901"), false);

  assert.equal(calls.length, 1);
  const query = JSON.stringify(calls[0]);
  assert.match(query, /statutoryIdentityNumber/);
  assert.match(query, /taxIdentificationNumber/);
  assert.doesNotMatch(query, /epfMemberNumber|socsoMemberNumber/);
});

test("Phase 3B tax editors receive full identity and TIN values", async () => {
  const database = {
    branch: { count: () => Promise.resolve(1) },
    payrollRun: { findMany: () => Promise.resolve([]) },
    employeeBusinessMembership: {
      findFirst: () =>
        Promise.resolve({
          id: membershipId,
          taxProfileRevision: 3,
          statutoryIdentityType: "NEW_IC",
          statutoryIdentityNumber: "900101145555",
          statutoryCountryCode: "MY",
          taxIdentificationNumber: "IG12345678901",
          statutoryProfileUpdatedAt: new Date("2026-08-01T00:00:00.000Z"),
        }),
    },
  } as unknown as PrismaClient;

  const result = await loadEmployeeStatutoryProfileSection(
    {
      access: buildAccess([
        "VIEW_TAX_PROFILE",
        "EDIT_TAX_PROFILE",
        "ALL_BRANCHES",
      ]),
      allowedBranchIds: ["branch-1"],
      businessId,
      membershipId,
    },
    database,
  );

  assert.equal(result.status, "READY");
  if (result.status !== "READY" || result.tax.status !== "READY") return;
  assert.equal(result.tax.data.canEdit, true);
  assert.equal(result.tax.data.identityNumber, "900101145555");
  assert.equal(result.tax.data.tin, "IG12345678901");
});

test("Phase 3B tax editors receive full EPF and SOCSO values", async () => {
  const database = {
    branch: { count: () => Promise.resolve(1) },
    payrollRun: { findMany: () => Promise.resolve([]) },
    employeeBusinessMembership: {
      findFirst: () =>
        Promise.resolve({
          id: membershipId,
          statutoryProfileRevision: 2,
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
        }),
    },
  } as unknown as PrismaClient;

  const result = await loadEmployeeStatutoryProfileSection(
    {
      access: buildAccess([
        "VIEW_STATUTORY_PROFILE",
        "EDIT_TAX_PROFILE",
        "ALL_BRANCHES",
      ]),
      allowedBranchIds: ["branch-1"],
      businessId,
      membershipId,
    },
    database,
  );

  assert.equal(result.status, "READY");
  if (result.status !== "READY" || result.statutory.status !== "READY") return;
  assert.equal(result.statutory.data.epfMemberNumber, "1234567890");
  assert.equal(result.statutory.data.socsoMemberNumber, "SOC-99887766");
});

test("Phase 3B performs no sensitive query without statutory or tax capability", async () => {
  let queryCount = 0;
  const database = {
    branch: {
      count: () => {
        queryCount += 1;
        return Promise.resolve(1);
      },
    },
    employeeBusinessMembership: {
      findFirst: () => {
        queryCount += 1;
        return Promise.resolve(null);
      },
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
      findFirst: () => {
        sensitiveQueryCount += 1;
        return Promise.resolve(null);
      },
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

test("Phase 3B query isolation remains intact after controlled edit entry migration", async () => {
  const root = process.cwd();
  const [route, loader, component, statutoryFields, payrollActions] = await Promise.all([
    readFile(
      path.join(root, "src/app/(business)/team/people/[personId]/page.tsx"),
      "utf8",
    ),
    readFile(
      path.join(root, "src/lib/team/employee-profile-statutory-read.ts"),
      "utf8",
    ),
    readFile(
      path.join(root, "src/components/employee-profile-payroll.tsx"),
      "utf8",
    ),
    readFile(
      path.join(root, "src/components/employee-statutory-settings-fields.tsx"),
      "utf8",
    ),
    readFile(
      path.join(root, "src/app/(business)/team/people/[personId]/payroll/actions.ts"),
      "utf8",
    ),
  ]);

  assert.match(route, /loadEmployeeStatutoryProfileSection/);
  assert.match(route, /Promise\.all/);
  assert.match(loader, /VIEW_STATUTORY_PROFILE/);
  assert.match(loader, /VIEW_TAX_PROFILE/);
  assert.match(component, /Statutory contributions/);
  assert.match(component, /Tax & submission identity/);
  assert.match(component, /Protected payroll data/);
  assert.match(statutoryFields, /Standard coverage selected/);
  assert.match(statutoryFields, /Employment injury only selected/);
  assert.match(statutoryFields, /employer and employee contribute/);
  assert.match(statutoryFields, /no employee deduction/);
  assert.match(statutoryFields, /setSocsoIncluded\(true\)/);
  assert.match(statutoryFields, /setSelectedSocsoCategory\(""\)/);
  assert.match(statutoryFields, /nationality === "NON_MALAYSIAN"/);
  assert.match(statutoryFields, /employeeAge >= 57 &&\s+employeeAge < 60/);
  assert.match(statutoryFields, /Registered with EPF before 1 Aug 1998/);
  assert.match(statutoryFields, /Contributed to EIS before age 57/);
  assert.match(statutoryFields, /These switches control payroll calculations/);
  assert.match(component, /result\.reason === "CAPABILITY"\) return null/);
  assert.match(component, /statutorySetupStatus\(data\)/);
  assert.match(component, /taxSetupStatus\(data\)/);
  assert.match(component, /data\.canEdit && showStandaloneEdit \? \(/);
  assert.match(component, /<StatutoryAndTaxEditForm/);
  assert.match(component, /label="Edit details"/);
  assert.match(component, /action={updateEmployeeStatutoryAndTaxProfilesAction}/);
  assert.match(component, /Save statutory &amp; tax/);
  assert.match(component, /<TaxEditForm/);
  assert.match(component, /dialogId={`statutory-contributions-edit-/);
  assert.match(component, /dialogId={`lindung24-participation-/);
  assert.match(component, /title="Edit LINDUNG 24 coverage"/);
  assert.match(component, /automatically refreshes any eligible Draft payroll/);
  assert.doesNotMatch(component, /Official submission timestamp/);
  assert.match(payrollActions, /LINDUNG 24 coverage updated from the employee profile/);
  assert.match(payrollActions, /HR-confirmed LINDUNG 24 coverage/);
  assert.match(component, /dialogId={`tax-submission-identity-edit-/);
  assert.match(component, /title="Tax & government IDs"/);
  assert.match(component, /Government account numbers/);
  assert.match(component, /Save tax details/);
  assert.match(component, /Tax and government IDs updated from the employee profile/);
  assert.doesNotMatch(component, /Replacement identity number/);
  assert.doesNotMatch(component, /Clear current value/);
  assert.match(component, /name="reasonType" type="hidden" value="STATUTORY_CORRECTION"/);
  assert.match(component, /Statutory contribution settings updated from the employee profile/);
  assert.match(component, /Used for the next payroll/);
  assert.match(component, /Your changes will apply automatically to future payroll/);
  assert.doesNotMatch(component, /Applies to future payroll/);
  assert.doesNotMatch(component, /Finalized payroll and exported records stay unchanged/);
  assert.doesNotMatch(component, /<h3>Change record<\/h3>/);
  assert.doesNotMatch(component, /categoryLabel="Update type"/);
  assert.equal(component.match(/size="compact"/g)?.length, 4);
  assert.match(component, /eyebrow="Statutory & tax"/);
  assert.doesNotMatch(
    component,
    /<summary>Edit statutory contributions<\/summary>/,
  );
  assert.doesNotMatch(
    component,
    /<summary>Record LINDUNG 24 participation evidence<\/summary>/,
  );
  assert.doesNotMatch(
    component,
    /<summary>Edit tax &amp; submission identity<\/summary>/,
  );
  assert.match(component, /"Not enrolled"/);
  assert.match(component, /"Not applicable"/);
  assert.doesNotMatch(component, /Ready for submission/);
  assert.doesNotMatch(loader, /bankAccount|paymentBatch|payrollEntry|payslip/i);
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
