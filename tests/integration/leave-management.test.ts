import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { AppSession } from "../../src/lib/auth/session";
import { generateLeaveEntitlementsForYear } from "../../src/lib/leave/service";
import { prisma } from "../../src/lib/prisma";

test("Phase 2A generation applies the statutory floor, join/termination proration, and remains idempotent", async () => {
  assertLocalDatabase();
  const token = randomUUID();
  const business = await prisma.business.create({
    data: { name: `Leave P2A ${token}`, slug: `leave-p2a-${token}`, timezone: "Asia/Kuala_Lumpur" },
  });
  const branch = await prisma.branch.create({
    data: { businessId: business.id, name: "Leave P2A Sabah", countryCode: "MY", stateCode: "12" },
  });
  const owner = await prisma.user.create({
    data: { businessId: business.id, branchId: branch.id, name: "Leave P2A Owner", email: `${token}@leave-p2a.test`, role: "BUSINESS_OWNER" },
  });
  const phone = `+6018${token.replace(/\D/g, "").padEnd(7, "0").slice(0, 7)}`;
  const account = await prisma.employeeAccount.create({
    data: { phoneNumber: phone, phoneNormalized: phone, name: "Leave P2A Employee", status: "ACTIVE" },
  });
  const membership = await prisma.employeeBusinessMembership.create({
    data: {
      employeeAccountId: account.id,
      businessId: business.id,
      employeeCode: `P2A-${token.slice(0, 8)}`,
      fullName: "Leave P2A Employee",
      phoneNumber: phone,
      phoneNumberNormalized: phone,
      status: "ACTIVE",
      employmentType: "FULL_TIME",
      joinedAt: new Date("2026-07-01T00:00:00.000Z"),
      terminatedAt: new Date("2026-09-30T00:00:00.000Z"),
    },
  });
  await prisma.employeeBranchAssignment.create({
    data: {
      businessId: business.id,
      branchId: branch.id,
      membershipId: membership.id,
      isPrimary: true,
      effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
    },
  });

  const ruleSet = await prisma.leaveStatutoryRuleSet.create({
    data: {
      businessId: business.id,
      jurisdictionCountryCode: "MY",
      jurisdictionStateCode: "12",
      jurisdictionCode: "MY-SABAH",
      version: "P2A-INTEGRATION-1",
      status: "DRAFT",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      sourceTitle: "Local integration evidence only",
      sourceReference: "LOCAL_TEST_FIXTURE",
      createdById: owner.id,
    },
  });
  const statutoryRule = await prisma.leaveStatutoryRule.create({
    data: {
      businessId: business.id,
      ruleSetId: ruleSet.id,
      category: "ANNUAL_LEAVE",
      statutorySection: "LOCAL_TEST_FIXTURE",
      prorationMethod: "CALENDAR_DAY_RATIO",
      entitlementRounding: "NONE",
      eligibleEmploymentTypes: ["FULL_TIME"],
    },
  });
  await prisma.leaveStatutoryEntitlementTier.create({
    data: { ruleId: statutoryRule.id, minServiceMonths: 0, entitlementUnits: 12 },
  });
  await prisma.leaveStatutorySource.create({
    data: {
      businessId: business.id,
      ruleSetId: ruleSet.id,
      sourceTitle: "Local integration evidence only",
      sourceUrl: "https://example.test/local-integration-evidence",
      sourceSection: "LOCAL_TEST_FIXTURE",
      retrievedAt: new Date("2026-08-17T00:00:00.000Z"),
      contentHash: "A".repeat(64),
    },
  });
  await prisma.leaveStatutoryRuleSet.update({
    where: { id: ruleSet.id },
    data: { status: "READY_FOR_REVIEW" },
  });
  await prisma.leaveStatutoryRuleSet.update({
    where: { id: ruleSet.id },
    data: {
      status: "READY_FOR_HUMAN_SIGN_OFF",
      sourceDigest: "B".repeat(64),
      validationSnapshot: { valid: true, fixture: true },
      signOffChecklist: { fixture: true },
      readyForSignOffById: owner.id,
      readyForSignOffAt: new Date(),
      reviewedById: owner.id,
      reviewedAt: new Date(),
      reviewNote: "Local integration fixture; not legal sign-off.",
    },
  });
  await prisma.leaveStatutoryRuleSet.update({
    where: { id: ruleSet.id },
    data: {
      status: "ACTIVE",
      activatedById: owner.id,
      activatedAt: new Date(),
    },
  });

  const policy = await prisma.leavePolicy.create({
    data: {
      businessId: business.id,
      code: "ANNUAL_P2A",
      name: "Annual leave P2A",
      defaultEntitlementDays: 8,
      underTwoYearsDays: 8,
      statutoryCategory: "ANNUAL_LEAVE",
      prorationMethod: "CALENDAR_DAY_RATIO",
      legalStatus: "VERIFIED_LEGAL",
    },
  });
  const version = await prisma.leavePolicyVersion.create({
    data: {
      businessId: business.id,
      policyId: policy.id,
      revision: 1,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      nameSnapshot: policy.name,
      payTreatment: "PAID",
      countMode: "WEEKDAYS",
      balanceTracked: true,
      defaultEntitlementDays: 8,
      underTwoYearsDays: 8,
      origin: "BUSINESS_CUSTOM",
      legalStatus: "VERIFIED_LEGAL",
      statutoryCategory: "ANNUAL_LEAVE",
      prorationMethod: "CALENDAR_DAY_RATIO",
      statutoryRuleSetId: ruleSet.id,
      statutoryRuleId: statutoryRule.id,
      sourceReference: "LOCAL_TEST_FIXTURE",
      reason: "Phase 2A integration fixture",
      createdById: owner.id,
    },
  });
  const actor: AppSession = {
    userId: owner.id,
    homeBusinessId: business.id,
    activeBusinessId: business.id,
    contextVersion: 1,
    businessId: business.id,
    branchId: branch.id,
    name: owner.name,
    email: owner.email ?? "",
    role: "BUSINESS_OWNER",
    permissions: [],
    status: "active",
  };

  const first = await generateLeaveEntitlementsForYear({ businessId: business.id, actor, year: 2026 });
  const second = await generateLeaveEntitlementsForYear({ businessId: business.id, actor, year: 2026 });
  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(second.unchanged, 1);

  const entitlement = await prisma.employeeLeaveEntitlement.findUniqueOrThrow({
    where: {
      businessId_membershipId_policyId_leaveYearStart: {
        businessId: business.id,
        membershipId: membership.id,
        policyId: policy.id,
        leaveYearStart: new Date("2026-01-01T00:00:00.000Z"),
      },
    },
  });
  assert.equal(entitlement.policyVersionId, version.id);
  assert.equal(entitlement.statutoryRuleId, statutoryRule.id);
  assert.equal(entitlement.source, "STATUTORY_OVERLAY");
  assert.equal(Number(entitlement.prorationFactor).toFixed(6), (92 / 365).toFixed(6));
  assert.equal(Number(entitlement.rawEntitledUnits).toFixed(4), (12 * 92 / 365).toFixed(4));
  assert.equal(await prisma.leaveBalanceLedgerEntry.count({
    where: { businessId: business.id, membershipId: membership.id, policyId: policy.id, eventType: "ENTITLEMENT" },
  }), 1);
});

test("Leave balance database guard rejects a policy from another business", async () => {
  assertLocalDatabase();
  const token = randomUUID().slice(0, 8);

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const [businessA, businessB] = await Promise.all([
        tx.business.create({ data: { name: `Leave A ${token}`, slug: `leave-a-${token}` } }),
        tx.business.create({ data: { name: `Leave B ${token}`, slug: `leave-b-${token}` } }),
      ]);
      const account = await tx.employeeAccount.create({
        data: { phoneNumber: `+6018${token.replace(/\D/g, "").padEnd(7, "0").slice(0, 7)}`, phoneNormalized: `+6018${token.replace(/\D/g, "").padEnd(7, "0").slice(0, 7)}`, name: "Leave Tenant Test", status: "ACTIVE" },
      });
      const membership = await tx.employeeBusinessMembership.create({
        data: {
          employeeAccountId: account.id,
          businessId: businessA.id,
          employeeCode: `LV-${token}`,
          fullName: "Leave Tenant Test",
          phoneNumber: account.phoneNormalized,
          phoneNumberNormalized: account.phoneNormalized,
          status: "ACTIVE",
        },
      });
      const foreignPolicy = await tx.leavePolicy.create({
        data: { businessId: businessB.id, code: "ANNUAL", name: "Foreign annual" },
      });

      await tx.employeeLeaveBalance.create({
        data: {
          businessId: businessA.id,
          membershipId: membership.id,
          policyId: foreignPolicy.id,
          year: 2026,
          entitlementOverrideDays: 12,
        },
      });
    }),
    /Leave policy tenant mismatch/,
  );
});

test("Leave request database guard rejects a branch from another business", async () => {
  assertLocalDatabase();
  const token = randomUUID().slice(0, 8);

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const [businessA, businessB] = await Promise.all([
        tx.business.create({ data: { name: `Leave C ${token}`, slug: `leave-c-${token}` } }),
        tx.business.create({ data: { name: `Leave D ${token}`, slug: `leave-d-${token}` } }),
      ]);
      const foreignBranch = await tx.branch.create({ data: { businessId: businessB.id, name: "Foreign branch" } });
      const account = await tx.employeeAccount.create({
        data: { phoneNumber: `+6017${token.replace(/\D/g, "").padEnd(7, "1").slice(0, 7)}`, phoneNormalized: `+6017${token.replace(/\D/g, "").padEnd(7, "1").slice(0, 7)}`, name: "Leave Request Test", status: "ACTIVE" },
      });
      const membership = await tx.employeeBusinessMembership.create({
        data: { employeeAccountId: account.id, businessId: businessA.id, employeeCode: `LR-${token}`, fullName: "Leave Request Test", phoneNumber: account.phoneNormalized, phoneNumberNormalized: account.phoneNormalized, status: "ACTIVE" },
      });
      const policy = await tx.leavePolicy.create({ data: { businessId: businessA.id, code: "ANNUAL", name: "Annual" } });
      const version = await tx.leavePolicyVersion.create({ data: {
        businessId: businessA.id,
        policyId: policy.id,
        revision: 1,
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        nameSnapshot: "Annual",
        payTreatment: "PAID",
        countMode: "WEEKDAYS",
        balanceTracked: true,
        origin: "BUSINESS_CUSTOM",
        legalStatus: "COMPANY_POLICY_ONLY",
        reason: "Tenant guard test.",
      } });
      await tx.leaveRequest.create({
        data: {
          businessId: businessA.id,
          membershipId: membership.id,
          branchId: foreignBranch.id,
          policyId: policy.id,
          policyVersionId: version.id,
          policyNameSnapshot: policy.name,
          payTreatmentSnapshot: "PAID",
          startsOn: new Date("2026-08-03T00:00:00Z"),
          endsOn: new Date("2026-08-03T00:00:00Z"),
          requestedDays: 1,
          reason: "Tenant guard test",
        },
      });
    }),
    /Leave branch tenant mismatch/,
  );
});

function assertLocalDatabase() {
  assert.match(process.env.DATABASE_URL ?? "", /localhost|127\.0\.0\.1/i);
}
