import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  AttendanceOvertimeError,
  decideAttendanceOvertime,
  listAttendanceOvertimeCandidates,
} from "../../src/lib/attendance/overtime-service";
import { beginMonthlyAttendanceTimesheetRevision } from "../../src/lib/attendance/timesheet-service";
import { prisma } from "../../src/lib/prisma";

const rollbackMessage = "PAYROLL_P6A_ROLLBACK";

test("P6A enforces scoped non-self OT review, lock immutability and reopen audit", async () => {
  assertLocalDatabase();
  let businessId: string | null = null;

  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      const fixture = await createFixture(transaction);
      businessId = fixture.businessId;
      const database = transactionDatabase(transaction);

      const candidates = await listAttendanceOvertimeCandidates({
        businessId: fixture.businessId,
        allowedBranchIds: [fixture.branchId],
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
        periodEndExclusive: new Date("2026-09-01T00:00:00.000Z"),
        database: transaction,
      });
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0]?.potentialOtMinutes, 60);
      assert.equal(candidates[0]?.effectiveStatus, "PENDING_REVIEW");
      assert.equal(candidates[0]?.context, "NORMAL");

      await assert.rejects(
        decideAttendanceOvertime({
          context: {
            businessId: fixture.businessId,
            allowedBranchIds: [fixture.branchId],
            actor: fixture.staffActor,
          },
          finalResultId: fixture.finalResultId,
          expectedRevision: 0,
          input: { decision: "APPROVE" },
          database,
        }),
        (error: unknown) =>
          error instanceof AttendanceOvertimeError &&
          error.code === "SELF_APPROVAL_NOT_ALLOWED",
      );

      await assert.rejects(
        decideAttendanceOvertime({
          context: {
            businessId: fixture.businessId,
            allowedBranchIds: [],
            actor: fixture.ownerActor,
          },
          finalResultId: fixture.finalResultId,
          expectedRevision: 0,
          input: { decision: "APPROVE" },
          database,
        }),
        (error: unknown) =>
          error instanceof AttendanceOvertimeError &&
          error.code === "OUTSIDE_BRANCH_SCOPE",
      );

      const adjusted = await decideAttendanceOvertime({
        context: {
          businessId: fixture.businessId,
          allowedBranchIds: [fixture.branchId],
          actor: fixture.ownerActor,
        },
        finalResultId: fixture.finalResultId,
        expectedRevision: 0,
        input: {
          decision: "ADJUST",
          approvedMinutes: 30,
          reason: "Only 30 minutes were manager-authorised OT.",
        },
        database,
      });
      assert.equal(adjusted.status, "ADJUSTED");
      assert.equal(adjusted.potentialOtMinutes, 60);
      assert.equal(adjusted.approvedOtMinutes, 30);
      assert.equal(adjusted.revision, 1);

      const decisionEvents = await transaction.attendanceOvertimeReviewEvent.findMany({
        where: { reviewId: adjusted.id },
        orderBy: { reviewRevision: "asc" },
      });
      assert.deepEqual(decisionEvents.map((event) => event.type), [
        "OT_REVIEW_CREATED",
        "OT_ADJUSTED",
      ]);
      assert.equal(
        await transaction.auditLog.count({
          where: {
            businessId: fixture.businessId,
            entityId: adjusted.id,
            action: "OT_ADJUSTED",
          },
        }),
        1,
      );

      const approved = await decideAttendanceOvertime({
        context: {
          businessId: fixture.businessId,
          allowedBranchIds: [fixture.branchId],
          actor: fixture.ownerActor,
        },
        finalResultId: fixture.finalResultId,
        expectedRevision: 1,
        input: { decision: "APPROVE" },
        database,
      });
      assert.equal(approved.status, "APPROVED");
      assert.equal(approved.approvedOtMinutes, 60);
      assert.equal(approved.revision, 2);

      const timesheet = await transaction.attendanceMonthlyTimesheet.create({
        data: {
          businessId: fixture.businessId,
          periodStart: new Date("2026-08-01T00:00:00.000Z"),
        },
      });
      const lockedRevision = await transaction.attendanceTimesheetRevision.create({
        data: {
          timesheetId: timesheet.id,
          businessId: fixture.businessId,
          revision: 1,
          periodStart: timesheet.periodStart,
          sourceDigest: "c".repeat(64),
          reason: "Locked fixture for overtime immutability verification.",
          lockedById: fixture.ownerActor.userId,
        },
      });
      await transaction.attendanceMonthlyTimesheet.update({
        where: { id: timesheet.id },
        data: { status: "LOCKED", currentRevisionId: lockedRevision.id },
      });
      await assert.rejects(
        decideAttendanceOvertime({
          context: {
            businessId: fixture.businessId,
            allowedBranchIds: [fixture.branchId],
            actor: fixture.ownerActor,
          },
          finalResultId: fixture.finalResultId,
          expectedRevision: 2,
          input: { decision: "APPROVE" },
          database,
        }),
        (error: unknown) =>
          error instanceof AttendanceOvertimeError && error.code === "TIMESHEET_LOCKED",
      );

      await beginMonthlyAttendanceTimesheetRevision({
        context: {
          businessId: fixture.businessId,
          allowedBranchIds: [fixture.branchId],
          wholeBusinessScope: true,
          actor: fixture.ownerActor,
        },
        month: "2026-08",
        reason: "Correction required after payroll review.",
        database,
      });
      const reopened = await transaction.attendanceOvertimeReviewEvent.findFirst({
        where: { reviewId: approved.id, type: "OT_REOPENED" },
      });
      assert.ok(reopened);
      assert.equal(reopened.reviewRevision, 2);
      assert.equal(reopened.approvedOtMinutes, 60);

      const rejected = await decideAttendanceOvertime({
        context: {
          businessId: fixture.businessId,
          allowedBranchIds: [fixture.branchId],
          actor: fixture.ownerActor,
        },
        finalResultId: fixture.finalResultId,
        expectedRevision: 2,
        input: {
          decision: "REJECT",
          reason: "The additional time was not authorised as overtime.",
        },
        database,
      });
      assert.equal(rejected.status, "REJECTED");
      assert.equal(rejected.approvedOtMinutes, 0);
      assert.equal(rejected.revision, 3);
      assert.equal(
        await transaction.attendanceOvertimeReviewEvent.count({
          where: { reviewId: approved.id, type: "OT_REJECTED" },
        }),
        1,
      );
      assert.equal(
        await transaction.auditLog.count({
          where: {
            businessId: fixture.businessId,
            entityId: approved.id,
            action: "OT_REJECTED",
          },
        }),
        1,
      );

      throw new Error(rollbackMessage);
    }),
    (error: unknown) => error instanceof Error && error.message === rollbackMessage,
  );

  assert.ok(businessId);
  assert.equal(await prisma.business.count({ where: { id: businessId } }), 0);
});

async function createFixture(transaction: Prisma.TransactionClient) {
  const token = randomUUID();
  const business = await transaction.business.create({
    data: { name: `Payroll P6A ${token}`, slug: `payroll-p6a-${token}` },
  });
  const branch = await transaction.branch.create({
    data: { businessId: business.id, name: `P6A Branch ${token}` },
  });
  const owner = await transaction.user.create({
    data: {
      businessId: business.id,
      branchId: branch.id,
      name: "Payroll P6A Owner",
      email: `payroll-p6a-owner-${token}@test.local`,
      role: "BUSINESS_OWNER",
    },
  });
  const phone = `+6011${String(Date.now()).slice(-8)}`;
  const employeeAccount = await transaction.employeeAccount.create({
    data: {
      name: "Payroll P6A Staff",
      phoneNumber: phone,
      phoneNormalized: phone,
    },
  });
  const membership = await transaction.employeeBusinessMembership.create({
    data: {
      businessId: business.id,
      employeeAccountId: employeeAccount.id,
      employeeCode: "P6A-STAFF",
      fullName: "Payroll P6A Staff",
      phoneNumber: employeeAccount.phoneNumber,
      phoneNumberNormalized: employeeAccount.phoneNormalized,
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      attendanceEnabled: true,
      payBasis: "HOURLY",
    },
  });
  const staff = await transaction.user.create({
    data: {
      businessId: business.id,
      branchId: branch.id,
      employeeAccountId: employeeAccount.id,
      employeeBusinessMembershipId: membership.id,
      teamMemberLinkStatus: "LINKED",
      teamMemberLinkedAt: new Date("2026-01-01T00:00:00.000Z"),
      name: membership.fullName,
      email: `payroll-p6a-staff-${token}@test.local`,
      role: "STAFF",
    },
  });
  const expectedDay = await transaction.attendanceExpectedDay.create({
    data: {
      businessId: business.id,
      branchId: branch.id,
      membershipId: membership.id,
      workDate: new Date("2026-08-18T00:00:00.000Z"),
      kind: "WORKDAY",
      source: "MANUAL_EVIDENCE",
      expectedStartAt: new Date("2026-08-18T01:00:00.000Z"),
      expectedEndAt: new Date("2026-08-18T09:00:00.000Z"),
      timezoneSnapshot: "Asia/Kuala_Lumpur",
      createdById: owner.id,
    },
  });
  const finalResult = await transaction.attendanceP2FinalResult.create({
    data: {
      businessId: business.id,
      branchId: branch.id,
      membershipId: membership.id,
      workDate: expectedDay.workDate,
      version: 1,
      outcome: "PRESENT",
      expectedDayKindSnapshot: "WORKDAY",
      expectedDayId: expectedDay.id,
      expectedStartAt: expectedDay.expectedStartAt,
      expectedEndAt: expectedDay.expectedEndAt,
      actualClockInAt: expectedDay.expectedStartAt,
      actualClockOutAt: new Date("2026-08-18T10:00:00.000Z"),
      totalBreakMinutes: 0,
      totalWorkedMinutes: 540,
      sourceDigest: "a".repeat(64),
      resolutionDigest: "b".repeat(64),
      createdById: owner.id,
    },
  });
  return {
    businessId: business.id,
    branchId: branch.id,
    finalResultId: finalResult.id,
    ownerActor: { userId: owner.id, name: owner.name, email: owner.email! },
    staffActor: { userId: staff.id, name: staff.name, email: staff.email! },
  };
}

function transactionDatabase(transaction: Prisma.TransactionClient) {
  return {
    $transaction: async <T>(operation: (client: Prisma.TransactionClient) => Promise<T>) =>
      operation(transaction),
  } as unknown as PrismaClient;
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error("Payroll P6A integration tests are restricted to the local database.");
  }
}
