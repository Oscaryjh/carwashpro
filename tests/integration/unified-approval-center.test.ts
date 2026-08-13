import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import {
  getUnifiedApprovalInbox,
  type UnifiedApprovalContext,
} from "../../src/lib/approvals/service";
import { getPayrollPeriodReadiness } from "../../src/lib/payroll/readiness";
import { prisma } from "../../src/lib/prisma";

test("mixed canonical domains produce exact actionable counts with branch, tenant and self filters", async () => {
  assertLocalDatabase();
  const fixture = await createMixedFixture();
  await getPayrollPeriodReadiness({ businessId: fixture.businessId, month: "2026-10", runId: fixture.payrollRunId }, prisma);
  const inbox = await getUnifiedApprovalInbox(fixture.context, {}, prisma);

  assert.deepEqual(inbox.unavailableDomains, []);
  assert.deepEqual(inbox.counts, {
    ATTENDANCE: 2,
    LEAVE: 1,
    CLAIMS: 1,
    COMMISSION: 1,
    PAYROLL: 1,
    total: 6,
  });
  assert.equal(inbox.items.length, 6);
  assert.deepEqual(new Set(inbox.items.map((item) => item.businessId)), new Set([fixture.businessId]));
  assert.ok(inbox.items.every((item) => item.branchId === null || item.branchId === fixture.branchAId));
  assert.ok(inbox.items.every((item) => item.requestedBy !== fixture.actorMembershipId));
  assert.equal(inbox.counts.total, Object.values(inbox.counts).slice(0, 5).reduce((sum, value) => sum + value, 0));
});

test("module, capability, employee and branch filters never broaden the inbox", async () => {
  assertLocalDatabase();
  const fixture = await createMixedFixture();
  const hrOnly = await getUnifiedApprovalInbox({
    ...fixture.context,
    enabledModules: new Set(["CORE", "HR"]),
    capabilities: new Set(["MODIFY_ATTENDANCE_EMPLOYEES", "APPROVE_LEAVE"]),
  }, {}, prisma);
  assert.equal(hrOnly.counts.total, 3);
  assert.equal(hrOnly.counts.CLAIMS, 0);
  assert.equal(hrOnly.counts.COMMISSION, 0);
  assert.equal(hrOnly.counts.PAYROLL, 0);

  const branchB = await getUnifiedApprovalInbox(fixture.context, { branchId: fixture.branchBId }, prisma);
  assert.equal(branchB.counts.ATTENDANCE, 0);
  assert.equal(branchB.counts.LEAVE, 0);
  assert.equal(branchB.counts.CLAIMS, 0);

  const employee = await getUnifiedApprovalInbox(fixture.context, { employee: "Visible Worker" }, prisma);
  assert.equal(employee.counts.ATTENDANCE, 2);
  assert.equal(employee.counts.LEAVE, 1);
  assert.equal(employee.counts.CLAIMS, 1);
  assert.equal(employee.counts.PAYROLL, 0, "employee filters never expose whole-business salary totals");
});

async function createMixedFixture() {
  const token = randomUUID().slice(0, 8);
  const business = await prisma.business.create({
    data: { name: `Approval QA ${token}`, slug: `approval-qa-${token}` },
  });
  const branchA = await prisma.branch.create({ data: { businessId: business.id, name: "Branch A" } });
  const branchB = await prisma.branch.create({ data: { businessId: business.id, name: "Branch B" } });
  const actor = await prisma.user.create({
    data: { businessId: business.id, branchId: branchA.id, name: "Approval Manager", email: `${token}@approvals.test`, role: "BUSINESS_OWNER" },
  });
  const visible = await createMembership(business.id, branchA.id, `VISIBLE-${token}`, "Visible Worker");
  const actorMembership = await createMembership(business.id, branchA.id, `ACTOR-${token}`, "Approval Manager");
  await prisma.user.update({
    where: { id: actor.id },
    data: {
      employeeAccountId: actorMembership.employeeAccountId,
      employeeBusinessMembershipId: actorMembership.id,
      teamMemberLinkStatus: "LINKED",
      teamMemberLinkedAt: new Date(),
    },
  });

  for (const index of [1, 2]) {
    await prisma.attendanceP2Exception.create({ data: {
      businessId: business.id,
      branchId: branchA.id,
      membershipId: visible.id,
      workDate: new Date(`2026-08-${10 + index}T00:00:00.000Z`),
      type: index === 1 ? "MISSING_CLOCK_IN" : "LATE_ARRIVAL",
      stableKey: `approval:${token}:attendance:${index}`,
      reasonCode: index === 1 ? "MISSING_CLOCK_IN" : "LATE_AFTER_GRACE",
      sourceDigest: "a".repeat(64),
      exceptionMinutes: index === 1 ? 0 : 15,
    } });
  }

  const policy = await prisma.leavePolicy.create({ data: {
    businessId: business.id,
    code: "ANNUAL",
    name: "Annual Leave",
    payTreatment: "PAID",
    countMode: "WEEKDAYS",
    origin: "BUSINESS_CUSTOM",
    legalStatus: "COMPANY_POLICY_ONLY",
  } });
  const policyVersion = await prisma.leavePolicyVersion.create({ data: {
    businessId: business.id,
    policyId: policy.id,
    revision: 1,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    nameSnapshot: "Annual Leave",
    payTreatment: "PAID",
    countMode: "WEEKDAYS",
    balanceTracked: false,
    origin: "BUSINESS_CUSTOM",
    legalStatus: "COMPANY_POLICY_ONLY",
    sourceReference: "LOCAL_APPROVAL_QA",
    reason: "Local unified approval fixture",
    createdById: actor.id,
  } });
  await createLeave({ businessId: business.id, branchId: branchA.id, membershipId: visible.id, policyId: policy.id, policyVersionId: policyVersion.id, clientRequestId: randomUUID() });
  await createLeave({ businessId: business.id, branchId: branchA.id, membershipId: actorMembership.id, policyId: policy.id, policyVersionId: policyVersion.id, clientRequestId: randomUUID() });
  await createLeave({ businessId: business.id, branchId: branchB.id, membershipId: visible.id, policyId: policy.id, policyVersionId: policyVersion.id, clientRequestId: randomUUID() });

  await createClaim(business.id, branchA.id, visible.id, `VISIBLE-${token}`);
  await createClaim(business.id, branchA.id, actorMembership.id, `SELF-${token}`);
  await createClaim(business.id, branchB.id, visible.id, `BRANCH-B-${token}`);

  const period = await prisma.commissionPeriod.create({ data: {
    businessId: business.id,
    branchId: branchA.id,
    scopeKey: `approval-${token}`,
    earnedPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
    earnedPeriodEnd: new Date("2026-08-31T00:00:00.000Z"),
    status: "CALCULATED",
    currentRevision: 1,
    calculatedAt: new Date("2026-09-01T00:00:00.000Z"),
    sourceDigest: "b".repeat(64),
  } });
  await prisma.commissionStatement.create({ data: {
    businessId: business.id,
    periodId: period.id,
    membershipId: visible.id,
    calculationRevision: 1,
    status: "CALCULATED",
    eligibleSalesCents: 10_000,
    calculatedCommissionCents: 1_000,
    finalCommissionCents: 1_000,
    calculationDigest: "c".repeat(64),
  } });
  const selfPeriod = await prisma.commissionPeriod.create({ data: {
    businessId: business.id,
    branchId: branchA.id,
    scopeKey: `approval-self-${token}`,
    earnedPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
    earnedPeriodEnd: new Date("2026-07-31T00:00:00.000Z"),
    status: "CALCULATED",
    currentRevision: 1,
    calculatedById: actor.id,
    calculatedAt: new Date("2026-08-01T00:00:00.000Z"),
    sourceDigest: "d".repeat(64),
  } });
  await prisma.commissionStatement.create({ data: {
    businessId: business.id,
    periodId: selfPeriod.id,
    membershipId: visible.id,
    calculationRevision: 1,
    status: "CALCULATED",
    eligibleSalesCents: 10_000,
    calculatedCommissionCents: 1_000,
    finalCommissionCents: 1_000,
    calculationDigest: "e".repeat(64),
  } });

  const payrollRun = await prisma.payrollRun.create({ data: {
    businessId: business.id,
    periodStart: new Date("2026-10-01T00:00:00.000Z"),
    periodEnd: new Date("2026-11-01T00:00:00.000Z"),
    status: "REVIEW",
    attendanceSource: "LEGACY_OPERATIONAL_SESSION",
    workingDaysPerMonthSnapshot: 26,
    normalWorkMinutesPerDaySnapshot: 480,
    breakMinutesPerDaySnapshot: 60,
    overtimeMultiplierSnapshot: 1.5,
    publicHolidayExtraMultiplierSnapshot: 2,
    submittedById: actor.id,
    submittedAt: new Date("2026-11-01T00:00:00.000Z"),
  } });

  const otherBusiness = await prisma.business.create({ data: { name: `Other ${token}`, slug: `other-approval-${token}` } });
  const otherBranch = await prisma.branch.create({ data: { businessId: otherBusiness.id, name: "Other Branch" } });
  const otherMembership = await createMembership(otherBusiness.id, otherBranch.id, `OTHER-${token}`, "Other Tenant Worker");
  await prisma.attendanceP2Exception.create({ data: {
    businessId: otherBusiness.id,
    branchId: otherBranch.id,
    membershipId: otherMembership.id,
    workDate: new Date("2026-08-11T00:00:00.000Z"),
    type: "MISSING_CLOCK_OUT",
    stableKey: `approval:${token}:other-tenant`,
    reasonCode: "MISSING_CLOCK_OUT",
    sourceDigest: "f".repeat(64),
  } });

  const context: UnifiedApprovalContext = {
    actorUserId: actor.id,
    businessId: business.id,
    allowedBranchIds: [branchA.id],
    wholeBusinessScope: true,
    enabledModules: new Set(["CORE", "HR", "CLAIMS", "COMMISSION", "PAYROLL"]),
    capabilities: new Set(["MODIFY_ATTENDANCE_EMPLOYEES", "APPROVE_LEAVE", "REVIEW_CLAIM", "APPROVE_COMMISSION", "APPROVE_PAYROLL"]),
  };
  return {
    businessId: business.id,
    branchAId: branchA.id,
    branchBId: branchB.id,
    actorMembershipId: actorMembership.id,
    payrollRunId: payrollRun.id,
    context,
  };
}

async function createMembership(businessId: string, branchId: string, code: string, name: string) {
  const phone = `+601${randomInt(10_000_000, 99_999_999)}`;
  const account = await prisma.employeeAccount.create({ data: { name, phoneNumber: phone, phoneNormalized: phone } });
  const membership = await prisma.employeeBusinessMembership.create({ data: {
    businessId,
    employeeAccountId: account.id,
    employeeCode: code,
    fullName: name,
    phoneNumber: phone,
    phoneNumberNormalized: phone,
    joinedAt: new Date("2025-01-01T00:00:00.000Z"),
  } });
  await prisma.employeeBranchAssignment.create({ data: {
    businessId,
    branchId,
    membershipId: membership.id,
    isPrimary: true,
    canClockIn: true,
    effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
  } });
  return membership;
}

function createLeave(data: {
  businessId: string;
  branchId: string;
  membershipId: string;
  policyId: string;
  policyVersionId: string;
  clientRequestId: string;
}) {
  return prisma.leaveRequest.create({ data: {
    ...data,
    policyNameSnapshot: "Annual Leave",
    payTreatmentSnapshot: "PAID",
    legalStatusSnapshot: "COMPANY_POLICY_ONLY",
    startsOn: new Date("2026-12-01T00:00:00.000Z"),
    endsOn: new Date("2026-12-01T00:00:00.000Z"),
    requestedDays: 1,
    reason: "Private fixture reason",
  } });
}

function createClaim(businessId: string, branchId: string, membershipId: string, claimNumber: string) {
  return prisma.employeeClaim.create({ data: {
    businessId,
    branchId,
    membershipId,
    claimNumber,
    clientRequestId: randomUUID(),
    purpose: "Private claim purpose",
    status: "SUBMITTED",
    submittedTotal: 50,
    revision: 1,
    submittedAt: new Date("2026-08-11T00:00:00.000Z"),
  } });
}

function assertLocalDatabase() {
  const value = process.env.DATABASE_URL ?? "";
  assert.match(value, /(127\.0\.0\.1|localhost)/, "integration tests require the Local embedded database");
}
