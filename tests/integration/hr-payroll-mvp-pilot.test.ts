import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { generatePayrollRun } from "../../src/lib/payroll/service";
import { prisma } from "../../src/lib/prisma";

const rollbackMessage = "HR_PAYROLL_MVP_PILOT_ROLLBACK";

test("HR / Payroll MVP pilot freezes eight employee scenarios into one payroll month", async () => {
  assertLocalDatabase();
  let businessId: string | null = null;

  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      const fixture = await createPilotFixture(transaction);
      businessId = fixture.businessId;

      const run = await generatePayrollRun(
        {
          businessId: fixture.businessId,
          actor: fixture.actor,
          month: "2026-08",
        },
        transactionDatabase(transaction),
      );

      const entries = await transaction.payrollEntry.findMany({
        where: { payrollRunId: run.id },
        include: { attendanceInputSnapshot: true },
        orderBy: { employeeCodeSnapshot: "asc" },
      });
      assert.equal(entries.length, 8);
      const byCode = new Map(entries.map((entry) => [entry.employeeCodeSnapshot, entry]));

      assert.equal(byCode.get("PILOT-A")?.attendanceInputSnapshot?.regularMinutes, 600);
      assert.equal(byCode.get("PILOT-B")?.attendanceInputSnapshot?.regularMinutes, 450);
      assert.equal(byCode.get("PILOT-C")?.attendanceInputSnapshot?.regularMinutes, 480);
      assert.equal(byCode.get("PILOT-D")?.attendanceInputSnapshot?.paidLeaveDays.toString(), "1");
      assert.equal(byCode.get("PILOT-E")?.attendanceInputSnapshot?.unpaidLeaveDays.toString(), "1");
      assert.equal(byCode.get("PILOT-F")?.attendanceInputSnapshot?.approvedOvertimeMinutes, 60);
      assert.equal(byCode.get("PILOT-G")?.attendanceInputSnapshot?.restDayWorkedMinutes, 480);
      assert.equal(byCode.get("PILOT-H")?.attendanceInputSnapshot?.publicHolidayWorkedMinutes, 480);

      const crossMidnightFacts = byCode.get("PILOT-A")?.attendanceInputSnapshot?.segmentFacts;
      assert.ok(Array.isArray(crossMidnightFacts));
      assert.equal(crossMidnightFacts.length, 2);

      assert.equal(
        await transaction.attendanceTimesheetP2DaySnapshot.count({
          where: { revisionId: fixture.revisionId },
        }),
        9,
      );
      assert.equal(
        await transaction.attendanceTimesheetP2SegmentSnapshot.count({
          where: { revisionId: fixture.revisionId },
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

async function createPilotFixture(transaction: Prisma.TransactionClient) {
  const token = randomUUID();
  const business = await transaction.business.create({
    data: {
      name: `HR Payroll MVP Pilot ${token}`,
      slug: `hr-payroll-mvp-pilot-${token}`,
      timezone: "Asia/Kuala_Lumpur",
    },
  });
  const branch = await transaction.branch.create({
    data: {
      businessId: business.id,
      name: "Pilot Main Branch",
      countryCode: "MY",
      stateCode: "SBH",
    },
  });
  const owner = await transaction.user.create({
    data: {
      businessId: business.id,
      name: "Pilot Payroll Owner",
      email: `hr-payroll-pilot-${token}@test.local`,
      role: "BUSINESS_OWNER",
    },
  });
  const actor = { userId: owner.id, name: owner.name, email: owner.email! };
  const memberships = new Map<string, string>();

  for (const [index, code] of [
    "PILOT-A",
    "PILOT-B",
    "PILOT-C",
    "PILOT-D",
    "PILOT-E",
    "PILOT-F",
    "PILOT-G",
    "PILOT-H",
  ].entries()) {
    const phone = `+6018${String(index + 1).padStart(7, "0")}`;
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
        payBasis: "DAILY",
        phoneNumber: phone,
        phoneNumberNormalized: phone,
      },
    });
    await transaction.employeeBranchAssignment.create({
      data: {
        businessId: business.id,
        branchId: branch.id,
        membershipId: membership.id,
        isPrimary: true,
      },
    });
    await transaction.employeeCompensationVersion.create({
      data: {
        businessId: business.id,
        membershipId: membership.id,
        effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
        payBasis: "DAILY",
        baseRate: 120,
        source: "MANUAL",
        reasonType: "DATA_MIGRATION",
        reasonNote: "Local MVP Pilot verified input.",
        createdById: owner.id,
      },
    });
    memberships.set(code, membership.id);
  }

  const timesheet = await transaction.attendanceMonthlyTimesheet.create({
    data: {
      businessId: business.id,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
    },
  });
  const revision = await transaction.attendanceTimesheetRevision.create({
    data: {
      businessId: business.id,
      timesheetId: timesheet.id,
      revision: 1,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      sourceDigest: digest("pilot-timesheet-revision"),
      reason: "MVP Pilot canonical locked attendance evidence.",
      lockedById: owner.id,
    },
  });
  await transaction.attendanceMonthlyTimesheet.update({
    where: { id: timesheet.id },
    data: { currentRevisionId: revision.id, status: "LOCKED" },
  });

  const fixture = {
    businessId: business.id,
    branchId: branch.id,
    ownerId: owner.id,
    actor,
    memberships,
    revisionId: revision.id,
  };

  await addDay(transaction, fixture, revision.id, {
    code: "PILOT-A",
    day: 3,
    outcome: "PRESENT",
    kind: "WORKDAY",
    workedMinutes: 480,
  });
  const crossMidnight = await addDay(transaction, fixture, revision.id, {
    code: "PILOT-A",
    day: 9,
    outcome: "PRESENT",
    kind: "WORKDAY",
    workedMinutes: 120,
    crossMidnight: true,
  });
  await addCrossMidnightSegments(transaction, fixture, revision.id, crossMidnight);
  await addDay(transaction, fixture, revision.id, {
    code: "PILOT-B",
    day: 4,
    outcome: "PRESENT_LATE_UNAUTHORIZED",
    kind: "WORKDAY",
    workedMinutes: 450,
  });
  await addDay(transaction, fixture, revision.id, {
    code: "PILOT-C",
    day: 5,
    outcome: "PRESENT",
    kind: "WORKDAY",
    workedMinutes: 480,
    label: "manager-corrected-missing-punch",
  });
  await addDay(transaction, fixture, revision.id, {
    code: "PILOT-D",
    day: 6,
    outcome: "APPROVED_PAID_LEAVE",
    kind: "WORKDAY",
    workedMinutes: 0,
    leave: "PAID",
  });
  await addDay(transaction, fixture, revision.id, {
    code: "PILOT-E",
    day: 7,
    outcome: "APPROVED_UNPAID_LEAVE",
    kind: "WORKDAY",
    workedMinutes: 0,
    leave: "UNPAID",
  });
  await addDay(transaction, fixture, revision.id, {
    code: "PILOT-F",
    day: 8,
    outcome: "PRESENT",
    kind: "WORKDAY",
    workedMinutes: 540,
    potentialOtMinutes: 60,
    approvedOtMinutes: 60,
  });
  await addDay(transaction, fixture, revision.id, {
    code: "PILOT-G",
    day: 10,
    outcome: "PRESENT",
    kind: "REST_DAY",
    workedMinutes: 480,
  });
  await addDay(transaction, fixture, revision.id, {
    code: "PILOT-H",
    day: 31,
    outcome: "PRESENT",
    kind: "PUBLIC_HOLIDAY",
    workedMinutes: 480,
    holidayContextSnapshot: {
      name: "National Day",
      source: "OFFICIAL",
      jurisdiction: "MY",
    },
  });

  return fixture;
}

type PilotFixture = {
  businessId: string;
  branchId: string;
  ownerId: string;
  memberships: Map<string, string>;
};

type PilotDayInput = {
  code: string;
  day: number;
  outcome:
    | "PRESENT"
    | "PRESENT_LATE_UNAUTHORIZED"
    | "APPROVED_PAID_LEAVE"
    | "APPROVED_UNPAID_LEAVE";
  kind: "WORKDAY" | "REST_DAY" | "PUBLIC_HOLIDAY";
  workedMinutes: number;
  potentialOtMinutes?: number;
  approvedOtMinutes?: number;
  crossMidnight?: boolean;
  leave?: "PAID" | "UNPAID";
  label?: string;
  holidayContextSnapshot?: Prisma.InputJsonValue;
};

async function addDay(
  transaction: Prisma.TransactionClient,
  fixture: PilotFixture,
  revisionId: string,
  input: PilotDayInput,
) {
  const membershipId = fixture.memberships.get(input.code)!;
  const workDate = new Date(`2026-08-${String(input.day).padStart(2, "0")}T00:00:00.000Z`);
  const sourceDigest = digest(`${input.code}-${input.day}-${input.label ?? input.outcome}`);
  const finalResult = await transaction.attendanceP2FinalResult.create({
    data: {
      businessId: fixture.businessId,
      branchId: fixture.branchId,
      membershipId,
      workDate,
      version: 1,
      outcome: input.outcome,
      expectedDayKindSnapshot: input.kind,
      leaveDayFractionSnapshot: input.leave ? 1 : undefined,
      totalBreakMinutes: input.workedMinutes > 0 ? 60 : 0,
      totalWorkedMinutes: input.workedMinutes,
      sourceDigest,
      resolutionDigest: digest(`resolved-${sourceDigest}`),
      createdById: fixture.ownerId,
    },
  });
  const isLeave = Boolean(input.leave);
  const snapshot = await transaction.attendanceTimesheetP2DaySnapshot.create({
    data: {
      revisionId,
      businessId: fixture.businessId,
      branchId: fixture.branchId,
      membershipId,
      workDate,
      finalResultId: finalResult.id,
      finalResultVersion: 1,
      outcome: input.outcome,
      expectedDayKindSnapshot: input.kind,
      leaveDayFractionSnapshot: isLeave ? 1 : undefined,
      leaveRequestIdSnapshot: isLeave ? randomUUID() : undefined,
      leaveRequestRevisionSnapshot: isLeave ? 1 : undefined,
      leaveRequestDigestSnapshot: isLeave ? digest(`leave-${input.code}`) : undefined,
      leavePolicyIdSnapshot: isLeave ? randomUUID() : undefined,
      leavePolicyVersionIdSnapshot: isLeave ? randomUUID() : undefined,
      leavePolicyNameSnapshot: isLeave ? `Pilot ${input.leave} leave` : undefined,
      leavePayTreatmentSnapshot: input.leave,
      leaveUnitSnapshot: isLeave ? "FULL_DAY" : undefined,
      leaveLegalStatusSnapshot: isLeave ? "COMPANY_POLICY_ONLY" : undefined,
      leaveComplianceStatusSnapshot: isLeave ? "NOT_APPLICABLE" : undefined,
      timezoneSnapshot: "Asia/Kuala_Lumpur",
      crossMidnightSnapshot: input.crossMidnight ?? false,
      potentialOtMinutes: input.potentialOtMinutes ?? 0,
      approvedOtMinutes: input.approvedOtMinutes ?? 0,
      otContext: input.potentialOtMinutes ? "NORMAL" : undefined,
      otApprovalStatus: input.potentialOtMinutes ? "APPROVED" : "NOT_APPLICABLE",
      otApprovalRef: input.potentialOtMinutes ? randomUUID() : undefined,
      otApprovalRevision: input.potentialOtMinutes ? 1 : undefined,
      totalBreakMinutes: input.workedMinutes > 0 ? 60 : 0,
      totalWorkedMinutes: input.workedMinutes,
      sourceDigest,
      holidayContextSnapshot: input.holidayContextSnapshot,
    },
  });
  return { finalResult, snapshot };
}

async function addCrossMidnightSegments(
  transaction: Prisma.TransactionClient,
  fixture: PilotFixture,
  revisionId: string,
  input: Awaited<ReturnType<typeof addDay>>,
) {
  for (const segment of [
    {
      index: 0,
      localDate: "2026-08-09",
      startAt: "2026-08-09T15:00:00.000Z",
      endAt: "2026-08-09T16:00:00.000Z",
    },
    {
      index: 1,
      localDate: "2026-08-10",
      startAt: "2026-08-09T16:00:00.000Z",
      endAt: "2026-08-09T17:00:00.000Z",
    },
  ]) {
    await transaction.attendanceTimesheetP2SegmentSnapshot.create({
      data: {
        revisionId,
        businessId: fixture.businessId,
        branchId: fixture.branchId,
        membershipId: input.snapshot.membershipId,
        sourceDaySnapshotId: input.snapshot.id,
        sourceFinalResultId: input.finalResult.id,
        segmentIndex: segment.index,
        localDate: new Date(`${segment.localDate}T00:00:00.000Z`),
        startAt: new Date(segment.startAt),
        endAt: new Date(segment.endAt),
        timezoneSnapshot: "Asia/Kuala_Lumpur",
        context: "NORMAL",
        expectedDayKindSnapshot: "WORKDAY",
        grossMinutes: 60,
        breakMinutes: 0,
        workedMinutes: 60,
        potentialOtMinutes: 0,
        approvedOtMinutes: 0,
        sourceDigest: digest(`cross-midnight-${segment.index}`),
      },
    });
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
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
    throw new Error("HR / Payroll MVP Pilot tests are restricted to the local database.");
  }
}
