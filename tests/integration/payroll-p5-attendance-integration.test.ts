import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { addManualPayrollAdjustment } from "../../src/lib/payroll/component-service";
import { getPayrollPeriodReadiness } from "../../src/lib/payroll/readiness";
import {
  generatePayrollRun,
  submitPayrollRunForReview,
} from "../../src/lib/payroll/service";
import { prisma } from "../../src/lib/prisma";

const rollbackMessage = "PAYROLL_P5_ROLLBACK";

test("P5 materialises exact locked P2 outcomes, preserves manual lines and detects stale sources", async () => {
  assertLocalDatabase();
  let businessId: string | null = null;
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      const fixture = await createFixture(transaction);
      businessId = fixture.businessId;
      const database = transactionDatabase(transaction);
      const run = await generatePayrollRun(
        {
          businessId: fixture.businessId,
          actor: fixture.actor,
          month: "2026-08",
        },
        database,
      );

      const entries = await transaction.payrollEntry.findMany({
        where: { payrollRunId: run.id },
        include: {
          attendanceInputSnapshot: true,
          components: { orderBy: { lineKey: "asc" } },
        },
      });
      const byCode = new Map(entries.map((entry) => [entry.employeeCodeSnapshot, entry]));
      const monthly = byCode.get("P5-MONTHLY");
      const blockedMonthly = byCode.get("P5-BLOCKED");
      const daily = byCode.get("P5-DAILY");
      const hourly = byCode.get("P5-HOURLY");
      assert.ok(monthly && blockedMonthly && daily && hourly);

      assert.equal(monthly.basicPay.toString(), "3500");
      assert.equal(monthly.overtimeMinutes, 0);
      assert.deepEqual(monthly.components.map((line) => line.code), ["BASIC_SALARY"]);
      assert.equal(monthly.attendanceInputSnapshot?.regularMinutes, 600);

      assert.equal(blockedMonthly.basicPay.toString(), "3200");
      assert.equal(blockedMonthly.unpaidLeaveDeduction.toString(), "184.62");
      assert.equal(blockedMonthly.attendanceInputSnapshot?.unpaidLeaveDays.toString(), "0.5");
      assert.equal(blockedMonthly.attendanceInputSnapshot?.unauthorizedAbsenceDays.toString(), "1");
      assert.deepEqual(blockedMonthly.attendanceInputSnapshot?.policyBlockers, []);

      assert.deepEqual(
        daily.components.map((line) => [line.code, line.amount.toString(), line.sourceType]),
        [
          ["PAID_LEAVE_PAY", "50", "ATTENDANCE"],
          ["REGULAR_DAILY_PAY", "100", "ATTENDANCE"],
        ],
      );
      assert.deepEqual(daily.attendanceInputSnapshot?.leaveCategoryBreakdown, [
        {
          category: "COMPANY_PAID_LEAVE",
          dayHundredths: 50,
          payTreatment: "PAID",
          requestCount: 1,
        },
      ]);
      const dailyLeaveFacts = daily.attendanceInputSnapshot?.leaveFacts;
      assert.ok(Array.isArray(dailyLeaveFacts));
      assert.equal(dailyLeaveFacts.length, 1);
      assert.equal((dailyLeaveFacts[0] as { payTreatment?: string }).payTreatment, "PAID");
      assert.equal("reason" in (dailyLeaveFacts[0] as object), false);
      assert.equal("document" in (dailyLeaveFacts[0] as object), false);
      assert.equal(hourly.components[0]?.code, "REGULAR_HOURLY_PAY");
      assert.equal(hourly.components[0]?.amount.toString(), "22.75");
      assert.equal(hourly.overtimeMinutes, 0);
      assert.equal(
        await transaction.auditLog.count({
          where: {
            businessId: fixture.businessId,
            entityId: run.id,
            action: "PAYROLL_LEAVE_SNAPSHOT_CREATED",
          },
        }),
        1,
      );

      let editable = daily;
      await addManualPayrollAdjustment(
        {
          businessId: fixture.businessId,
          actor: fixture.actor,
          entryId: daily.id,
          expectedRevision: daily.calculationRevision,
          type: "EARNING",
          name: "Approved manual top-up",
          amount: "10.00",
          reason: "P5 refresh preservation test.",
        },
        database,
      );
      editable = await transaction.payrollEntry.findUniqueOrThrow({
        where: { id: daily.id },
        include: { components: true, attendanceInputSnapshot: true },
      });
      const revisionBeforeRefresh = editable.calculationRevision;
      await generatePayrollRun(
        {
          businessId: fixture.businessId,
          actor: fixture.actor,
          month: "2026-08",
        },
        database,
      );
      const refreshed = await transaction.payrollEntry.findUniqueOrThrow({
        where: { id: daily.id },
        include: { components: true },
      });
      assert.ok(refreshed.calculationRevision > revisionBeforeRefresh);
      assert.equal(refreshed.components.filter((line) => line.sourceType === "ATTENDANCE").length, 2);
      assert.equal(refreshed.components.filter((line) => line.origin === "MANUAL").length, 1);

      const readiness = await getPayrollPeriodReadiness(
        { businessId: fixture.businessId, month: "2026-08", runId: run.id },
        transaction,
      );
      assert.equal(readiness.counts.ATTENDANCE_PAY_POLICY_NOT_READY, 0);
      assert.equal(readiness.canProceed, false);

      const newerRevision = await createRevision(
        transaction,
        fixture,
        fixture.timesheetId,
        2,
        "b".repeat(64),
      );
      await transaction.attendanceMonthlyTimesheet.update({
        where: { id: fixture.timesheetId },
        data: { currentRevisionId: newerRevision.id },
      });
      await assert.rejects(
        submitPayrollRunForReview(
          { businessId: fixture.businessId, actor: fixture.actor, runId: run.id },
          database,
        ),
        /newer locked Timesheet revision|refresh/i,
      );
      const frozenBefore = await transaction.payrollAttendanceInputSnapshot.findUniqueOrThrow({
        where: { payrollEntryId: monthly.id },
      });
      assert.equal(frozenBefore.timesheetRevision, 1);

      await generatePayrollRun(
        {
          businessId: fixture.businessId,
          actor: fixture.actor,
          month: "2026-08",
        },
        database,
      );
      const frozenAfter = await transaction.payrollAttendanceInputSnapshot.findUniqueOrThrow({
        where: { payrollEntryId: monthly.id },
      });
      assert.equal(frozenAfter.timesheetRevision, 2);
      assert.equal(
        await transaction.payrollEntryComponent.count({
          where: { payrollEntryId: daily.id, sourceType: "ATTENDANCE" },
        }),
        2,
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
    data: { name: `Payroll P5 ${token}`, slug: `payroll-p5-${token}` },
  });
  const branch = await transaction.branch.create({
    data: { businessId: business.id, name: `P5 Branch ${token}` },
  });
  const owner = await transaction.user.create({
    data: {
      businessId: business.id,
      name: "Payroll P5 Owner",
      email: `payroll-p5-${token}@test.local`,
      role: "BUSINESS_OWNER",
    },
  });
  const actor = { userId: owner.id, name: owner.name, email: owner.email! };
  const membershipByCode = new Map<string, { id: string; payBasis: "MONTHLY" | "DAILY" | "HOURLY" }>();
  for (const [index, input] of ([
    ["P5-MONTHLY", "MONTHLY", 3500],
    ["P5-BLOCKED", "MONTHLY", 3200],
    ["P5-DAILY", "DAILY", 100],
    ["P5-HOURLY", "HOURLY", 15],
  ] as const).entries()) {
    const [code, payBasis, baseRate] = input;
    const phone = `+6019${String(index + 1).padStart(7, "0")}${token.charCodeAt(0)}`.slice(0, 15);
    const account = await transaction.employeeAccount.create({
      data: { name: code, phoneNumber: phone, phoneNormalized: phone },
    });
    const membership = await transaction.employeeBusinessMembership.create({
      data: {
        businessId: business.id,
        employeeAccountId: account.id,
        employeeCode: code,
        fullName: code,
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
        payBasis,
        phoneNumber: phone,
        phoneNumberNormalized: phone,
      },
    });
    await transaction.employeeCompensationVersion.create({
      data: {
        businessId: business.id,
        membershipId: membership.id,
        effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
        payBasis,
        baseRate,
        source: "MANUAL",
        reasonType: "OTHER",
        createdById: owner.id,
      },
    });
    membershipByCode.set(code, { id: membership.id, payBasis });
  }
  const timesheet = await transaction.attendanceMonthlyTimesheet.create({
    data: { businessId: business.id, periodStart: new Date("2026-08-01T00:00:00.000Z") },
  });
  const fixture = {
    businessId: business.id,
    branchId: branch.id,
    ownerId: owner.id,
    actor,
    memberships: membershipByCode,
    timesheetId: timesheet.id,
  };
  const revision = await createRevision(
    transaction,
    fixture,
    timesheet.id,
    1,
    "a".repeat(64),
  );
  await transaction.attendanceMonthlyTimesheet.update({
    where: { id: timesheet.id },
    data: { currentRevisionId: revision.id, status: "LOCKED" },
  });
  return fixture;
}

async function createRevision(
  transaction: Prisma.TransactionClient,
  fixture: {
    businessId: string;
    branchId: string;
    ownerId: string;
    memberships: Map<string, { id: string; payBasis: "MONTHLY" | "DAILY" | "HOURLY" }>;
  },
  timesheetId: string,
  revisionNumber: number,
  sourceDigest: string,
) {
  const revision = await transaction.attendanceTimesheetRevision.create({
    data: {
      businessId: fixture.businessId,
      timesheetId,
      revision: revisionNumber,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      sourceDigest,
      reason: `P5 revision ${revisionNumber}`,
      lockedById: fixture.ownerId,
    },
  });
  const inputs = [
    ["P5-MONTHLY", 1, "PRESENT", 600, "WORKDAY", null],
    ["P5-BLOCKED", 2, "APPROVED_UNPAID_LEAVE", 0, "WORKDAY", 0.5],
    ["P5-BLOCKED", 3, "UNAUTHORIZED_ABSENCE", 0, "WORKDAY", null],
    ["P5-DAILY", 4, "PRESENT", 480, "WORKDAY", null],
    ["P5-DAILY", 5, "APPROVED_PAID_LEAVE", 0, "WORKDAY", 0.5],
    ["P5-HOURLY", 6, "PRESENT", 91, "WORKDAY", null],
  ] as const;
  for (const [code, day, outcome, minutes, kind, leaveFraction] of inputs) {
    const membershipId = fixture.memberships.get(code)!.id;
    const workDate = new Date(`2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`);
    const digest = `${revisionNumber}${day}`.padEnd(64, "0").slice(0, 64);
    const isLeave =
      outcome === "APPROVED_PAID_LEAVE" ||
      outcome === "APPROVED_UNPAID_LEAVE";
    const leavePayTreatment =
      outcome === "APPROVED_PAID_LEAVE"
        ? ("PAID" as const)
        : outcome === "APPROVED_UNPAID_LEAVE"
          ? ("UNPAID" as const)
          : undefined;
    const finalResult = await transaction.attendanceP2FinalResult.create({
      data: {
        businessId: fixture.businessId,
        branchId: fixture.branchId,
        membershipId,
        workDate,
        version: revisionNumber,
        outcome,
        expectedDayKindSnapshot: kind,
        leaveDayFractionSnapshot: leaveFraction,
        totalBreakMinutes: 0,
        totalWorkedMinutes: minutes,
        sourceDigest: digest,
        resolutionDigest: "f".repeat(64),
        createdById: fixture.ownerId,
      },
    });
    await transaction.attendanceTimesheetP2DaySnapshot.create({
      data: {
        businessId: fixture.businessId,
        branchId: fixture.branchId,
        membershipId,
        workDate,
        revisionId: revision.id,
        finalResultId: finalResult.id,
        finalResultVersion: finalResult.version,
        outcome,
        expectedDayKindSnapshot: kind,
        leaveDayFractionSnapshot: leaveFraction,
        leaveRequestIdSnapshot: isLeave ? randomUUID() : undefined,
        leaveRequestRevisionSnapshot: isLeave ? revisionNumber : undefined,
        leaveRequestDigestSnapshot: isLeave ? digest : undefined,
        leavePolicyIdSnapshot: isLeave ? randomUUID() : undefined,
        leavePolicyVersionIdSnapshot: isLeave ? randomUUID() : undefined,
        leavePolicyNameSnapshot: isLeave ? "P5 Company Leave" : undefined,
        leavePayTreatmentSnapshot: leavePayTreatment,
        leaveUnitSnapshot:
          isLeave && leaveFraction === 0.5 ? "HALF_DAY_AM" : isLeave ? "FULL_DAY" : undefined,
        leaveLegalStatusSnapshot: isLeave ? "COMPANY_POLICY_ONLY" : undefined,
        leaveComplianceStatusSnapshot: isLeave ? "NOT_APPLICABLE" : undefined,
        totalBreakMinutes: 0,
        totalWorkedMinutes: minutes,
        sourceDigest: digest,
      },
    });
  }
  return revision;
}

function transactionDatabase(transaction: Prisma.TransactionClient) {
  return {
    $transaction: async <T>(
      operation: (client: Prisma.TransactionClient) => Promise<T>,
    ) => operation(transaction),
  } as unknown as PrismaClient;
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error("Payroll P5 integration tests are restricted to the local database.");
  }
}
