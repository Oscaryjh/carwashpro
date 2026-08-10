import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import type { AppSession } from "../../src/lib/auth/session";
import type { EmployeeAuthContext } from "../../src/lib/attendance/employee-auth";
import {
  cancelApprovedLeaveRequest,
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

async function createFixture(entitlement: number, dates = ["2026-09-07", "2026-09-08"]) {
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
  } });
  const version = await prisma.leavePolicyVersion.create({ data: {
    businessId: business.id, policyId: policy.id, revision: 1,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), nameSnapshot: "Annual leave",
    payTreatment: "PAID", countMode: "WEEKDAYS", balanceTracked: true,
    defaultEntitlementDays: entitlement, origin: "BUSINESS_CUSTOM", legalStatus: "COMPANY_POLICY_ONLY",
    sourceReference: "COMPANY_POLICY", reason: "Local integration fixture", createdById: owner.id,
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
