import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import type { AppSession } from "../../src/lib/auth/session";
import type { EmployeeAuthContext } from "../../src/lib/attendance/employee-auth";
import {
  cancelApprovedLeaveRequest,
  processDueCarryForwardExpiries,
  processLeavePeriodRollover,
  reviewLeaveRequest,
  submitEmployeeLeave,
} from "../../src/lib/leave/service";
import { prisma } from "../../src/lib/prisma";

test("Leave approval consumes the frozen balance and cancellation restores it exactly once", async () => {
  const fixture = await createFixture(2);
  const clientRequestId = randomUUID();
  const submitted = await submitEmployeeLeave(fixture.auth, {
    clientRequestId,
    policyId: fixture.policy.id,
    startsOn: "2026-09-07",
    endsOn: "2026-09-07",
    leaveUnit: "FULL_DAY",
    reason: "Integration lifecycle coverage",
  });

  const replay = await submitEmployeeLeave(fixture.auth, {
    clientRequestId,
    policyId: fixture.policy.id,
    startsOn: "2026-09-07",
    endsOn: "2026-09-07",
    leaveUnit: "FULL_DAY",
    reason: "Integration lifecycle coverage",
  });
  assert.equal(replay.id, submitted.id);

  await reviewLeaveRequest({
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: fixture.actor,
    rawInput: { requestId: submitted.id, expectedRevision: 0, decision: "APPROVED" },
  });

  const approved = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: submitted.id } });
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.policyVersionId, fixture.version.id);
  assert.equal(approved.payTreatmentSnapshot, "PAID");
  assert.equal(await ledgerBalance(fixture), 1);

  const cancelled = await cancelApprovedLeaveRequest({
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: fixture.actor,
    rawInput: { requestId: submitted.id, expectedRevision: 1, reason: "Employee withdrew with manager confirmation" },
  });
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(await ledgerBalance(fixture), 2);

  const replayedCancellation = await cancelApprovedLeaveRequest({
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: fixture.actor,
    rawInput: { requestId: submitted.id, expectedRevision: 1, reason: "Employee withdrew with manager confirmation" },
  });
  assert.equal(replayedCancellation.status, "CANCELLED");
  assert.equal(await prisma.leaveBalanceLedgerEntry.count({
    where: { leaveRequestId: submitted.id, eventType: "CANCELLATION_RESTORE" },
  }), 1);
  assert.equal(await ledgerBalance(fixture), 2);

  await assert.rejects(
    prisma.leavePolicyVersion.update({ where: { id: fixture.version.id }, data: { reason: "Illegal rewrite" } }),
    /immutable/i,
  );
  await assert.rejects(
    prisma.leaveBalanceLedgerEntry.deleteMany({ where: { leaveRequestId: submitted.id } }),
    /immutable|cannot be deleted/i,
  );
});

test("concurrent Leave approvals cannot overspend one entitlement", async () => {
  const fixture = await createFixture(1, ["2026-09-08", "2026-09-09"]);
  const first = await submitEmployeeLeave(fixture.auth, {
    clientRequestId: randomUUID(), policyId: fixture.policy.id,
    startsOn: "2026-09-08", endsOn: "2026-09-08", leaveUnit: "FULL_DAY", reason: "First concurrent request",
  });
  const second = await submitEmployeeLeave(fixture.auth, {
    clientRequestId: randomUUID(), policyId: fixture.policy.id,
    startsOn: "2026-09-09", endsOn: "2026-09-09", leaveUnit: "FULL_DAY", reason: "Second concurrent request",
  });

  const results = await Promise.allSettled([first, second].map((request) => reviewLeaveRequest({
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: fixture.actor,
    rawInput: { requestId: request.id, expectedRevision: 0, decision: "APPROVED" },
  })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(await prisma.leaveRequest.count({ where: { id: { in: [first.id, second.id] }, status: "APPROVED" } }), 1);
  assert.equal(await ledgerBalance(fixture), 0);
});

test("Leave submission blocks overlap and freezes policy treatment per request", async () => {
  const fixture = await createFixture(2);
  const first = await submitEmployeeLeave(fixture.auth, {
    clientRequestId: randomUUID(), policyId: fixture.policy.id,
    startsOn: "2026-09-07", endsOn: "2026-09-07", leaveUnit: "HALF_DAY_AM", reason: "Morning leave",
  });
  await assert.rejects(submitEmployeeLeave(fixture.auth, {
    clientRequestId: randomUUID(), policyId: fixture.policy.id,
    startsOn: "2026-09-07", endsOn: "2026-09-07", leaveUnit: "HALF_DAY_AM", reason: "Duplicate morning leave",
  }), /overlaps/i);

  const secondVersion = await prisma.leavePolicyVersion.create({ data: {
    businessId: fixture.business.id,
    policyId: fixture.policy.id,
    revision: 2,
    effectiveFrom: new Date("2026-09-08T00:00:00.000Z"),
    nameSnapshot: "Annual leave revised",
    payTreatment: "PAID",
    countMode: "WEEKDAYS",
    balanceTracked: true,
    defaultEntitlementDays: 5,
    origin: "BUSINESS_CUSTOM",
    legalStatus: "COMPANY_POLICY_ONLY",
    sourceReference: "COMPANY_POLICY",
    reason: "Future company policy revision",
    createdById: fixture.owner.id,
  } });
  const second = await submitEmployeeLeave(fixture.auth, {
    clientRequestId: randomUUID(), policyId: fixture.policy.id,
    startsOn: "2026-09-08", endsOn: "2026-09-08", leaveUnit: "HALF_DAY_PM", reason: "Future policy request",
  });
  const requests = await prisma.leaveRequest.findMany({ where: { id: { in: [first.id, second.id] } }, orderBy: { startsOn: "asc" } });
  assert.equal(requests[0]?.policyVersionId, fixture.version.id);
  assert.equal(requests[0]?.payTreatmentSnapshot, "PAID");
  assert.equal(requests[1]?.policyVersionId, secondVersion.id);
});

test("two-level Leave approval keeps canonical effects pending until a different owner gives final approval", async () => {
  const fixture = await createFixture(2);
  const manager = await prisma.user.create({
    data: {
      businessId: fixture.business.id,
      branchId: fixture.branch.id,
      name: "Leave QA Manager",
      email: `${randomUUID()}@leave-manager.test`,
      role: "STAFF",
    },
  });
  const managerActor: AppSession = {
    ...fixture.actor,
    userId: manager.id,
    name: manager.name,
    email: manager.email ?? "",
    role: "STAFF",
  };
  await prisma.hrApprovalPolicy.create({
    data: {
      businessId: fixture.business.id,
      domain: "LEAVE",
      mode: "TWO_LEVEL_ALWAYS",
    },
  });
  const submitted = await submitEmployeeLeave(fixture.auth, {
    clientRequestId: randomUUID(),
    policyId: fixture.policy.id,
    startsOn: "2026-09-07",
    endsOn: "2026-09-07",
    leaveUnit: "FULL_DAY",
    reason: "Two-level approval integration coverage",
  });
  const balanceBeforeApproval = await ledgerBalance(fixture);

  const firstLevel = await reviewLeaveRequest({
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: managerActor,
    actorLevel: "MANAGER",
    rawInput: { requestId: submitted.id, expectedRevision: 0, decision: "APPROVED", reviewNote: "Manager supports this request" },
  });
  assert.equal(firstLevel.finalized, false);
  assert.equal(firstLevel.approvalStage, "LEVEL_ONE");
  assert.equal((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: submitted.id } })).status, "PENDING");
  assert.equal(await ledgerBalance(fixture), balanceBeforeApproval);

  await prisma.hrApprovalPolicy.update({
    where: { businessId_domain: { businessId: fixture.business.id, domain: "LEAVE" } },
    data: { mode: "ONE_LEVEL", thresholdValue: null },
  });

  await assert.rejects(reviewLeaveRequest({
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: managerActor,
    actorLevel: "OWNER",
    rawInput: { requestId: submitted.id, expectedRevision: 0, decision: "APPROVED", reviewNote: "Illegal self-final approval" },
  }), /same person|同一个人/i);

  const finalLevel = await reviewLeaveRequest({
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: fixture.actor,
    actorLevel: "OWNER",
    rawInput: { requestId: submitted.id, expectedRevision: 0, decision: "APPROVED", reviewNote: "Owner final approval" },
  });
  assert.equal(finalLevel.finalized, true);
  assert.equal(finalLevel.approvalStage, "LEVEL_TWO");
  assert.equal((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: submitted.id } })).status, "APPROVED");
  assert.equal(await ledgerBalance(fixture), balanceBeforeApproval - 1);
  assert.deepEqual(
    await prisma.hrApprovalDecision.findMany({
      where: { businessId: fixture.business.id, subjectId: submitted.id },
      orderBy: { stage: "asc" },
      select: { stage: true, outcome: true, actorUserId: true },
    }),
    [
      { stage: "LEVEL_ONE", outcome: "APPROVED", actorUserId: manager.id },
      { stage: "LEVEL_TWO", outcome: "APPROVED", actorUserId: fixture.owner.id },
    ],
  );
});

test("Phase 2B rolls unused leave once, consumes expiring carry first and blocks restoration after expiry", async () => {
  const fixture = await createFixture(
    4,
    ["2025-09-07", "2026-08-10"],
    { carryForwardEnabled: true, carryForwardLimitUnits: 2, carryForwardExpiryRule: "FIXED_DATE_IN_DESTINATION_PERIOD", carryForwardExpiryValue: "12-31" },
  );
  const sourceRequest = await submitEmployeeLeave(fixture.auth, {
    clientRequestId: randomUUID(), policyId: fixture.policy.id,
    startsOn: "2025-09-07", endsOn: "2025-09-07", leaveUnit: "FULL_DAY", reason: "Use one day before rollover",
  });
  await reviewLeaveRequest({
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: fixture.actor,
    rawInput: { requestId: sourceRequest.id, expectedRevision: 0, decision: "APPROVED" },
  });

  const firstRollover = await processLeavePeriodRollover({
    businessId: fixture.business.id,
    membershipId: fixture.membership.id,
    policyId: fixture.policy.id,
    destinationAsOf: new Date("2026-01-01T00:00:00.000Z"),
    actor: fixture.actor,
  });
  const replayedRollover = await processLeavePeriodRollover({
    businessId: fixture.business.id,
    membershipId: fixture.membership.id,
    policyId: fixture.policy.id,
    destinationAsOf: new Date("2026-01-01T00:00:00.000Z"),
    actor: fixture.actor,
  });
  assert.equal(firstRollover.created, true);
  assert.equal(replayedRollover.created, false);
  assert.equal(Number(firstRollover.rollover.sourceRemainingUnits), 3);
  assert.equal(Number(firstRollover.rollover.carriedUnits), 2);
  assert.equal(Number(firstRollover.rollover.lapsedUnits), 1);
  assert.equal(await prisma.leavePeriodRollover.count({ where: { businessId: fixture.business.id } }), 1);

  const destinationRequest = await submitEmployeeLeave(fixture.auth, {
    clientRequestId: randomUUID(), policyId: fixture.policy.id,
    startsOn: "2026-08-10", endsOn: "2026-08-10", leaveUnit: "FULL_DAY", reason: "Consume carry-forward first",
  });
  await reviewLeaveRequest({
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: fixture.actor,
    rawInput: { requestId: destinationRequest.id, expectedRevision: 0, decision: "APPROVED" },
  });
  const allocations = await prisma.leaveConsumptionAllocation.findMany({
    where: { leaveRequestId: destinationRequest.id },
  });
  assert.equal(allocations.length, 1);
  const allocatedBucket = await prisma.leaveEntitlementBucket.findUniqueOrThrow({
    where: { id: allocations[0]!.bucketId },
  });
  assert.equal(allocatedBucket.sourceType, "CARRY_FORWARD");
  assert.equal(Number(allocations[0]?.units), 1);

  const firstExpiry = await processDueCarryForwardExpiries({
    businessId: fixture.business.id,
    actor: fixture.actor,
    asOf: new Date("2027-01-01T00:00:00.000Z"),
  });
  const replayedExpiry = await processDueCarryForwardExpiries({
    businessId: fixture.business.id,
    actor: fixture.actor,
    asOf: new Date("2027-01-01T00:00:00.000Z"),
  });
  assert.equal(firstExpiry.expiredBuckets, 1);
  assert.equal(firstExpiry.expiredUnits, 1);
  assert.equal(replayedExpiry.expiredBuckets, 0);
  assert.equal(await prisma.leaveBucketExpiry.count({ where: { businessId: fixture.business.id } }), 1);

  await assert.rejects(cancelApprovedLeaveRequest({
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: fixture.actor,
    rawInput: { requestId: destinationRequest.id, expectedRevision: 1, reason: "Cancellation after carry expiry requires review" },
  }), /LEAVE_CANCELLATION_REVIEW_REQUIRED/);
});

async function createFixture(
  entitlement: number,
  dates = ["2026-09-07", "2026-09-08"],
  carryForward?: {
    carryForwardEnabled: boolean;
    carryForwardLimitUnits: number | null;
    carryForwardExpiryRule: "NO_EXPIRY" | "DAYS_AFTER_ROLLOVER" | "MONTHS_AFTER_ROLLOVER" | "FIXED_DATE_IN_DESTINATION_PERIOD";
    carryForwardExpiryValue: string | null;
  },
) {
  assertLocalDatabase();
  const token = randomUUID();
  const business = await prisma.business.create({ data: { name: `Leave closure ${token}`, slug: `leave-closure-${token}`, timezone: "Asia/Kuala_Lumpur" } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: "Leave QA Branch" } });
  const owner = await prisma.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Leave QA Manager", email: `${token}@leave.test`, role: "BUSINESS_OWNER" } });
  const phone = `+601${randomInt(10_000_000, 99_999_999)}`;
  const account = await prisma.employeeAccount.create({ data: { phoneNumber: phone, phoneNormalized: phone, name: "Leave QA Employee" } });
  const membership = await prisma.employeeBusinessMembership.create({ data: {
    employeeAccountId: account.id,
    businessId: business.id,
    employeeCode: `LV-${token}`,
    fullName: "Leave QA Employee",
    phoneNumber: phone,
    phoneNumberNormalized: phone,
    attendanceEnabled: false,
    joinedAt: new Date("2025-01-01T00:00:00.000Z"),
  } });
  await prisma.employeeBranchAssignment.create({ data: {
    businessId: business.id, branchId: branch.id, membershipId: membership.id,
    isPrimary: true, canClockIn: true, effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
  } });
  const policy = await prisma.leavePolicy.create({ data: {
    businessId: business.id, code: "ANNUAL", name: "Annual leave", payTreatment: "PAID",
    countMode: "WEEKDAYS", balanceTracked: true, defaultEntitlementDays: entitlement,
    origin: "BUSINESS_CUSTOM", legalStatus: "COMPANY_POLICY_ONLY",
    ...carryForward,
  } });
  const version = await prisma.leavePolicyVersion.create({ data: {
    businessId: business.id, policyId: policy.id, revision: 1,
    effectiveFrom: new Date("2025-01-01T00:00:00.000Z"), nameSnapshot: "Annual leave",
    payTreatment: "PAID", countMode: "WEEKDAYS", balanceTracked: true,
    defaultEntitlementDays: entitlement, origin: "BUSINESS_CUSTOM", legalStatus: "COMPANY_POLICY_ONLY",
    sourceReference: "COMPANY_POLICY", reason: "Local integration fixture", createdById: owner.id,
    ...carryForward,
  } });
  for (const date of dates) {
    await prisma.attendanceExpectedDay.create({ data: {
      businessId: business.id, branchId: branch.id, membershipId: membership.id,
      workDate: new Date(`${date}T00:00:00.000Z`), kind: "WORKDAY", source: "MANUAL_EVIDENCE",
      expectedStartAt: new Date(`${date}T01:00:00.000Z`), expectedEndAt: new Date(`${date}T09:00:00.000Z`),
      timezoneSnapshot: "Asia/Kuala_Lumpur", evidenceReference: "LOCAL_LEAVE_CLOSURE_TEST", createdById: owner.id,
    } });
  }
  const auth: EmployeeAuthContext = {
    sessionId: randomUUID(), employeeAccountId: account.id, membershipId: membership.id,
    businessId: business.id, primaryBranchId: branch.id, attendanceBranchId: branch.id, deviceId: randomUUID(),
  };
  const actor: AppSession = {
    userId: owner.id, homeBusinessId: business.id, activeBusinessId: business.id, contextVersion: 1,
    businessId: business.id, branchId: branch.id, name: owner.name, email: owner.email ?? "",
    role: "BUSINESS_OWNER", permissions: [], status: "active",
  };
  return { business, branch, owner, account, membership, policy, version, auth, actor };
}

async function ledgerBalance(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const result = await prisma.leaveBalanceLedgerEntry.aggregate({ where: {
    businessId: fixture.business.id, membershipId: fixture.membership.id, policyId: fixture.policy.id,
    leaveYearStart: new Date("2026-01-01T00:00:00.000Z"),
  }, _sum: { units: true } });
  return Number(result._sum.units ?? 0);
}

function assertLocalDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value || !["localhost", "127.0.0.1"].includes(new URL(value).hostname)) {
    throw new Error("Leave closure integration tests require the Local database.");
  }
}
