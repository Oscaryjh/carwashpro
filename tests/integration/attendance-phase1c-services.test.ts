import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { PrismaClient as DatabaseClient } from "@prisma/client";
import { AttendanceApiError } from "../../src/lib/attendance/api-error";
import { hashEmployeeIdentifier } from "../../src/lib/attendance/employee-auth/crypto";
import type { EmployeeAuthContext } from "../../src/lib/attendance/employee-auth/session";
import { submitAttendanceException } from "../../src/lib/attendance/exception-service";
import { performAttendancePunch } from "../../src/lib/attendance/punch-service";
import { listAttendanceOvertimeCandidates } from "../../src/lib/attendance/overtime-service";
import {
  getEmployeeAttendanceHistory,
  getEmployeeAttendanceToday,
} from "../../src/lib/attendance/read-service";
import { getAttendanceWorkDate } from "../../src/lib/attendance/work-date";
import {
  getStaffOvertimeDetail,
  getStaffOvertimeQueue,
  getStaffOvertimeSummary,
} from "../../src/lib/staff-pwa/overtime-approvals";

process.env.EMPLOYEE_AUTH_SECRET =
  process.env.EMPLOYEE_AUTH_SECRET ??
  "attendance-phase1c-integration-secret-32-bytes";

const prisma = new DatabaseClient();
const rollbackSignal = new Error("ATTENDANCE_PHASE1C_TEST_ROLLBACK");

after(async () => {
  await prisma.$disconnect();
});

test("Phase 1C services enforce Punch flow, replay, GPS exceptions and self-only reads", async () => {
  assertLocalDatabase();

  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const database = transactionDatabase(transaction);
    const base = new Date();
    base.setUTCHours(1, 0, 0, 0);

    const clockInInput = punchInput(
      fixture.branchA.id,
      fixture.deviceIdentifier,
      "clock-in:phase1c-001",
    );
    const clockIn = await performAttendancePunch({
      database,
      auth: fixture.auth,
      type: "CLOCK_IN",
      input: clockInInput,
      now: base,
    });
    assert.equal(clockIn.resultingStatus, "OPEN");
    assert.equal(clockIn.replayed, false);

    await transaction.branchAttendanceSetting.update({
      where: {
        branchId: fixture.branchA.id,
      },
      data: {
        latitude: 20,
        longitude: 20,
      },
    });
    const replay = await performAttendancePunch({
      database,
      auth: fixture.auth,
      type: "CLOCK_IN",
      input: clockInInput,
      now: new Date(base.getTime() + 1_000),
    });
    assert.equal(replay.attendancePunchId, clockIn.attendancePunchId);
    assert.equal(replay.replayed, true);
    await transaction.branchAttendanceSetting.update({
      where: {
        branchId: fixture.branchA.id,
      },
      data: {
        latitude: 1.5535,
        longitude: 110.3593,
      },
    });

    await assertAttendanceError(
      performAttendancePunch({
        database,
        auth: fixture.auth,
        type: "CLOCK_IN",
        input: {
          ...clockInInput,
          accuracyMeters: 11,
        },
        now: new Date(base.getTime() + 2_000),
      }),
      "IDEMPOTENCY_CONFLICT",
    );

    const breakStart = await performAttendancePunch({
      database,
      auth: fixture.auth,
      type: "BREAK_START",
      input: punchInput(
        fixture.branchA.id,
        fixture.deviceIdentifier,
        "break-start:phase1c-001",
      ),
      now: new Date(base.getTime() + 60 * 60_000),
    });
    assert.equal(breakStart.resultingStatus, "ON_BREAK");

    await assertAttendanceError(
      performAttendancePunch({
        database,
        auth: fixture.auth,
        type: "CLOCK_OUT",
        input: punchInput(
          fixture.branchA.id,
          fixture.deviceIdentifier,
          "clock-out:on-break-001",
        ),
        now: new Date(base.getTime() + 75 * 60_000),
      }),
      "INVALID_ATTENDANCE_STATE",
    );

    const breakEnd = await performAttendancePunch({
      database,
      auth: fixture.auth,
      type: "BREAK_END",
      input: punchInput(
        fixture.branchA.id,
        fixture.deviceIdentifier,
        "break-end:phase1c-001",
      ),
      now: new Date(base.getTime() + 90 * 60_000),
    });
    assert.equal(breakEnd.resultingStatus, "OPEN");

    const clockOut = await performAttendancePunch({
      database,
      auth: fixture.auth,
      type: "CLOCK_OUT",
      input: punchInput(
        fixture.branchA.id,
        fixture.deviceIdentifier,
        "clock-out:phase1c-001",
      ),
      now: new Date(base.getTime() + 8 * 60 * 60_000),
    });
    assert.equal(clockOut.resultingStatus, "COMPLETED");
    assert.equal(clockOut.totalBreakMinutes, 30);
    assert.equal(clockOut.totalWorkedMinutes, 450);

    const completedToday = await getEmployeeAttendanceToday({
      auth: fixture.auth,
      database,
      now: new Date(base.getTime() + 8 * 60 * 60_000 + 60_000),
    });
    assert.equal(completedToday.status, "COMPLETED");
    assert.deepEqual(completedToday.allowedActions, ["CLOCK_IN"]);
    assert.equal(completedToday.currentWorkedMinutes, 450);
    assert.equal(
      completedToday.lastBreakEndedAt,
      new Date(base.getTime() + 90 * 60_000).toISOString(),
    );
    assert.equal(completedToday.sessionCount, 1);
    assert.equal(completedToday.completedSessionCount, 1);
    assert.equal(completedToday.expectedAttendance, null);

    await assertAttendanceError(
      performAttendancePunch({
        database,
        auth: fixture.auth,
        type: "CLOCK_IN",
        input: punchInput(
          fixture.branchB.id,
          fixture.deviceIdentifier,
          "clock-in:cross-business",
        ),
        now: new Date(base.getTime() + 9 * 60 * 60_000),
      }),
      "BRANCH_NOT_AUTHORIZED",
    );

    await transaction.branchAttendanceSetting.update({
      where: { branchId: fixture.branchA.id },
      data: {
        breakPolicy: "FLEXIBLE_CONFIRMATION",
        targetBreakMinutes: 10,
      },
    });
    const flexibleClockIn = await performAttendancePunch({
      database,
      auth: fixture.auth,
      type: "CLOCK_IN",
      input: punchInput(
        fixture.branchA.id,
        fixture.deviceIdentifier,
        "clock-in:flexible-break-001",
      ),
      now: new Date(base.getTime() + 9 * 60 * 60_000),
    });
    const flexibleClockOut = await performAttendancePunch({
      database,
      auth: fixture.auth,
      type: "CLOCK_OUT",
      input: {
        ...punchInput(
          fixture.branchA.id,
          fixture.deviceIdentifier,
          "clock-out:flexible-break-001",
        ),
        confirmedBreakMinutes: 5,
        breakExceptionReason: "Appointments ran through the planned break.",
      },
      now: new Date(base.getTime() + 9 * 60 * 60_000 + 30 * 60_000),
    });
    assert.equal(flexibleClockOut.attendanceSessionId, flexibleClockIn.attendanceSessionId);
    assert.equal(flexibleClockOut.totalBreakMinutes, 5);
    assert.equal(flexibleClockOut.totalWorkedMinutes, 25);
    assert.equal(flexibleClockOut.requiresApproval, true);
    const missedBreakException = await transaction.attendanceException.findFirst({
      where: {
        attendanceSessionId: flexibleClockIn.attendanceSessionId,
        type: "MISSED_BREAK",
      },
      select: {
        reason: true,
        status: true,
      },
    });
    assert.deepEqual(missedBreakException, {
      reason: "Appointments ran through the planned break.",
      status: "PENDING",
    });
    await transaction.branchAttendanceSetting.update({
      where: { branchId: fixture.branchA.id },
      data: {
        breakPolicy: "MANUAL_PUNCH",
        targetBreakMinutes: 60,
      },
    });

    const outsideClockIn = await performAttendancePunch({
      database,
      auth: fixture.auth,
      type: "CLOCK_IN",
      input: {
        ...punchInput(
          fixture.branchA.id,
          fixture.deviceIdentifier,
          "clock-in:outside-001",
        ),
        latitude: 1.5635,
        exceptionReason: "Traffic control required parking outside.",
      },
      now: new Date(base.getTime() + 10 * 60 * 60_000),
    });
    assert.equal(outsideClockIn.geofenceStatus, "OUTSIDE");
    assert.equal(outsideClockIn.requiresApproval, true);
    assert.ok(outsideClockIn.exceptionId);

    const duplicateException = await submitAttendanceException({
      database,
      auth: fixture.auth,
      input: {
        branchId: fixture.branchA.id,
        attendanceSessionId: outsideClockIn.attendanceSessionId,
        attendancePunchId: outsideClockIn.attendancePunchId,
        type: "OUTSIDE_GEOFENCE",
        reason: "Same pending request should not duplicate.",
        deviceIdentifier: fixture.deviceIdentifier,
      },
      now: new Date(base.getTime() + 10 * 60 * 60_000 + 1_000),
    });
    assert.equal(duplicateException.duplicate, true);
    assert.equal(duplicateException.id, outsideClockIn.exceptionId);

    await transaction.branchAttendanceSetting.update({
      where: {
        branchId: fixture.branchA.id,
      },
      data: {
        allowOutsideGeofenceRequest: false,
      },
    });
    await assertAttendanceError(
      submitAttendanceException({
        database,
        auth: fixture.auth,
        input: {
          branchId: fixture.branchA.id,
          attendanceSessionId: outsideClockIn.attendanceSessionId,
          attendancePunchId: outsideClockIn.attendancePunchId,
          type: "OUTSIDE_GEOFENCE",
          reason: "Current branch policy rejects GPS exceptions.",
          deviceIdentifier: fixture.deviceIdentifier,
        },
      }),
      "OUTSIDE_GEOFENCE",
    );
    const otherException = await submitAttendanceException({
      database,
      auth: fixture.auth,
      input: {
        branchId: fixture.branchA.id,
        attendanceSessionId: outsideClockIn.attendanceSessionId,
        type: "OTHER",
        reason: "Non-GPS exception remains available.",
        deviceIdentifier: fixture.deviceIdentifier,
      },
    });
    assert.equal(otherException.status, "PENDING");

    await transaction.attendanceExpectedDay.create({
      data: {
        businessId: fixture.businessA.id,
        branchId: fixture.branchA.id,
        membershipId: fixture.auth.membershipId,
        workDate: new Date(`${outsideClockIn.workDate}T00:00:00.000Z`),
        kind: "WORKDAY",
        source: "MANUAL_EVIDENCE",
        expectedStartAt: new Date(`${outsideClockIn.workDate}T01:00:00.000Z`),
        expectedEndAt: new Date(`${outsideClockIn.workDate}T09:00:00.000Z`),
        graceMinutes: 5,
        timezoneSnapshot: "Asia/Kuching",
        createdById: fixture.actorId,
      },
    });
    const today = await getEmployeeAttendanceToday({
      database,
      auth: fixture.auth,
      now: new Date(base.getTime() + 10 * 60 * 60_000 + 2_000),
    });
    assert.equal(today.currentSession?.id, outsideClockIn.attendanceSessionId);
    assert.equal(today.status, "OPEN");
    assert.equal(today.currentSession?.requiresApproval, true);
    assert.deepEqual(today.allowedActions, ["BREAK_START", "CLOCK_OUT"]);
    assert.equal(today.sessionCount, 3);
    assert.equal(today.completedSessionCount, 2);
    assert.equal(today.currentWorkedMinutes, 475);
    assert.equal(today.totalCompletedBreakMinutes, 35);
    assert.deepEqual(today.expectedAttendance, {
      kind: "WORKDAY",
      source: "MANUAL_EVIDENCE",
      expectedStartAt: `${outsideClockIn.workDate}T01:00:00.000Z`,
      expectedEndAt: `${outsideClockIn.workDate}T09:00:00.000Z`,
      graceMinutes: 5,
      timezone: "Asia/Kuching",
      revision: 1,
    });
    assert.deepEqual(Object.keys(today.employee).sort(), [
      "employeeCode",
      "fullName",
    ]);

    const history = await getEmployeeAttendanceHistory({
      database,
      auth: fixture.auth,
      input: {
        page: 1,
        pageSize: 25,
      },
      now: new Date(base.getTime() + 10 * 60 * 60_000 + 2_000),
    });
    assert.ok(history.items.length >= 2);
    assert.ok(
      history.items.every(
        (item) => item.branch.id === fixture.branchA.id,
      ),
    );
    assert.doesNotMatch(JSON.stringify(history), /phone/i);
    assert.equal(
      history.items.some(
        (item) => item.id === fixture.otherEmployeeAttendanceId,
      ),
      false,
    );

    await assertAttendanceError(
      getEmployeeAttendanceHistory({
        database,
        auth: fixture.auth,
        input: {
          branchId: fixture.branchB.id,
        },
      }),
      "BRANCH_NOT_AUTHORIZED",
    );

    const punchCount = await transaction.attendancePunch.count({
      where: {
        employeeId: fixture.auth.membershipId,
        businessId: fixture.auth.businessId,
      },
    });
    assert.equal(punchCount, 7);
  });
});

test("Clock Out projects the completed legacy session into one P2 day and OT candidate", async () => {
  assertLocalDatabase();

  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const database = transactionDatabase(transaction);
    const workDate = new Date("2026-08-27T00:00:00.000Z");
    const clockInAt = new Date("2026-08-27T08:44:41.076Z");
    const clockOutAt = new Date("2026-08-27T09:30:13.867Z");

    await transaction.attendanceExpectedDay.create({
      data: {
        businessId: fixture.businessA.id,
        branchId: fixture.branchA.id,
        membershipId: fixture.auth.membershipId,
        workDate,
        kind: "WORKDAY",
        source: "ROSTER",
        expectedStartAt: new Date("2026-08-27T08:50:00.000Z"),
        expectedEndAt: new Date("2026-08-27T09:20:00.000Z"),
        graceMinutes: 0,
        timezoneSnapshot: "Asia/Kuala_Lumpur",
        policySnapshot: { scheduledBreakMinutes: 0 },
        evidenceReference: "REAL_DEVICE_OT_UAT_TESTING_ONLY",
        createdById: fixture.actorId,
      },
    });

    await performAttendancePunch({
      database,
      auth: fixture.auth,
      type: "CLOCK_IN",
      input: punchInput(
        fixture.branchA.id,
        fixture.deviceIdentifier,
        "clock-in:p2-bridge-001",
      ),
      now: clockInAt,
    });
    assert.equal(await transaction.attendanceP2FinalResult.count({
      where: {
        businessId: fixture.businessA.id,
        membershipId: fixture.auth.membershipId,
        workDate,
      },
    }), 0, "A missing Clock Out must not produce a clean P2 result");
    const clockOutInput = punchInput(
      fixture.branchA.id,
      fixture.deviceIdentifier,
      "clock-out:p2-bridge-001",
    );
    const clockOut = await performAttendancePunch({
      database,
      auth: fixture.auth,
      type: "CLOCK_OUT",
      input: clockOutInput,
      now: clockOutAt,
    });

    assert.equal(clockOut.resultingStatus, "COMPLETED");
    assert.equal(clockOut.totalBreakMinutes, 0);
    assert.equal(clockOut.totalWorkedMinutes, 45);
    assert.equal(await transaction.attendanceFinalResult.count({
      where: { attendanceSessionId: clockOut.attendanceSessionId },
    }), 1);

    const finalResult = await transaction.attendanceP2FinalResult.findFirstOrThrow({
      where: {
        businessId: fixture.businessA.id,
        membershipId: fixture.auth.membershipId,
        workDate,
      },
    });
    assert.equal(finalResult.outcome, "PRESENT");
    assert.equal(finalResult.totalWorkedMinutes, 45);

    const candidates = await listAttendanceOvertimeCandidates({
      businessId: fixture.businessA.id,
      allowedBranchIds: [fixture.branchA.id],
      membershipId: fixture.auth.membershipId,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEndExclusive: new Date("2026-09-01T00:00:00.000Z"),
      database: transaction as unknown as PrismaClient,
    });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.potentialOtMinutes, 15);
    assert.equal(candidates[0]?.effectiveStatus, "PENDING_REVIEW");

    const managerPhone = `+601${randomInt(10_000_000, 99_999_999)}`;
    const managerAccount = await transaction.employeeAccount.create({
      data: {
        phoneNumber: managerPhone,
        phoneNormalized: managerPhone,
        name: "P2 Bridge Manager",
        status: "ACTIVE",
      },
    });
    const managerMembership = await transaction.employeeBusinessMembership.create({
      data: {
        employeeAccountId: managerAccount.id,
        businessId: fixture.businessA.id,
        employeeCode: `P2-MANAGER-${randomUUID()}`,
        fullName: "P2 Bridge Manager",
        phoneNumber: managerAccount.phoneNumber,
        phoneNumberNormalized: managerAccount.phoneNormalized,
        status: "ACTIVE",
        attendanceEnabled: true,
      },
    });
    const managerUser = await transaction.user.create({
      data: {
        businessId: fixture.businessA.id,
        branchId: fixture.branchA.id,
        employeeAccountId: managerAccount.id,
        employeeBusinessMembershipId: managerMembership.id,
        teamMemberLinkStatus: "LINKED",
        teamMemberLinkedAt: new Date("2026-08-01T00:00:00.000Z"),
        name: "P2 Bridge Manager",
        email: `p2-manager-${randomUUID()}@test.local`,
        role: "STAFF",
        permissions: ["ATTENDANCE_EMPLOYEE_MANAGE"],
        status: "active",
      },
    });
    const managerAuth = {
      sessionId: randomUUID(),
      employeeAccountId: managerAccount.id,
      membershipId: managerMembership.id,
      businessId: fixture.businessA.id,
      primaryBranchId: fixture.branchA.id,
      attendanceBranchId: fixture.branchA.id,
      deviceId: randomUUID(),
    } satisfies EmployeeAuthContext;
    const queue = await getStaffOvertimeQueue({
      auth: managerAuth,
      month: "2026-08",
      database: transaction as unknown as PrismaClient,
    });
    assert.equal(queue?.access.actor.userId, managerUser.id);
    assert.equal(queue?.pending, 1);
    assert.equal(queue?.items[0]?.membershipId, fixture.auth.membershipId);
    assert.equal(queue?.items[0]?.potentialOtMinutes, 15);

    const replay = await performAttendancePunch({
      database,
      auth: fixture.auth,
      type: "CLOCK_OUT",
      input: clockOutInput,
      now: clockOutAt,
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.attendanceSessionId, clockOut.attendanceSessionId);
    assert.equal(await transaction.attendanceP2FinalResult.count({
      where: {
        businessId: fixture.businessA.id,
        membershipId: fixture.auth.membershipId,
        workDate,
      },
    }), 1);
  });
});

test("Staff OT queue, counts and detail exclude the actor by canonical membership", async () => {
  assertLocalDatabase();

  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const database = transaction as unknown as PrismaClient;
    const actor = await createOvertimeManager(transaction, fixture.businessA.id, fixture.branchA.id, "Actor");
    const otherReviewer = await createOvertimeManager(transaction, fixture.businessA.id, fixture.branchA.id, "Other reviewer");
    const subjectA = await createOvertimeSubject(transaction, fixture.businessA.id, "Louis stylist");
    const subjectB = await createOvertimeSubject(transaction, fixture.businessA.id, "test");
    const ownResult = await createOvertimeFinalResult(transaction, {
      businessId: fixture.businessA.id,
      branchId: fixture.branchA.id,
      membershipId: actor.auth.membershipId,
      workDate: "2026-08-21",
      createdById: fixture.actorId,
    });
    await createOvertimeFinalResult(transaction, {
      businessId: fixture.businessA.id,
      branchId: fixture.branchA.id,
      membershipId: subjectA.id,
      workDate: "2026-08-22",
      createdById: fixture.actorId,
    });
    await createOvertimeFinalResult(transaction, {
      businessId: fixture.businessA.id,
      branchId: fixture.branchA.id,
      membershipId: subjectB.id,
      workDate: "2026-08-20",
      createdById: fixture.actorId,
    });

    const actorQueue = await getStaffOvertimeQueue({ auth: actor.auth, month: "2026-08", database });
    assert.equal(actorQueue?.pending, 2);
    assert.equal(actorQueue?.items.length, 2);
    assert.deepEqual(new Set(actorQueue?.items.map((item) => item.membershipId)), new Set([subjectA.id, subjectB.id]));
    assert.ok(actorQueue?.items.every((item) => item.membershipId !== actor.auth.membershipId));

    const summary = await getStaffOvertimeSummary(actor.auth, database);
    assert.equal(summary?.pending, actorQueue?.pending, "Home/All/OT must use the same filtered count as the queue");
    assert.equal(await getStaffOvertimeDetail(actor.auth, ownResult.id, database), null, "direct self-detail must fail closed");
    assert.ok(await getStaffOvertimeDetail(actor.auth, actorQueue!.items[0]!.finalResultId, database));

    const otherQueue = await getStaffOvertimeQueue({ auth: otherReviewer.auth, month: "2026-08", database });
    assert.equal(otherQueue?.pending, 3);
    assert.ok(otherQueue?.items.some((item) => item.membershipId === actor.auth.membershipId));
    assert.ok(await getStaffOvertimeDetail(otherReviewer.auth, ownResult.id, database));

    assert.equal(await transaction.attendanceOvertimeReview.count({ where: { finalResultId: ownResult.id } }), 0);
  });
});

test("Staff OT uses the newest immutable P2 result version for each employee day", async () => {
  assertLocalDatabase();

  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const database = transaction as unknown as PrismaClient;
    const reviewer = await createOvertimeManager(transaction, fixture.businessA.id, fixture.branchA.id, "Latest version reviewer");
    const subject = await createOvertimeSubject(transaction, fixture.businessA.id, "Superseded OT subject");
    const first = await createOvertimeFinalResult(transaction, {
      businessId: fixture.businessA.id,
      branchId: fixture.branchA.id,
      membershipId: subject.id,
      workDate: "2026-08-21",
      createdById: fixture.actorId,
    });
    const current = await transaction.attendanceP2FinalResult.create({
      data: {
        businessId: fixture.businessA.id,
        branchId: fixture.branchA.id,
        membershipId: subject.id,
        workDate: new Date("2026-08-21T00:00:00.000Z"),
        version: 2,
        outcome: "NOT_SCHEDULED",
        expectedDayKindSnapshot: "NOT_SCHEDULED",
        totalBreakMinutes: 0,
        totalWorkedMinutes: 0,
        sourceDigest: "c".repeat(64),
        resolutionDigest: "d".repeat(64),
        supersedesResultId: first.id,
        createdById: fixture.actorId,
      },
    });

    const queue = await getStaffOvertimeQueue({ auth: reviewer.auth, month: "2026-08", database });
    assert.equal(queue?.pending, 0);
    assert.equal(queue?.items.length, 0);
    assert.equal(await getStaffOvertimeDetail(reviewer.auth, first.id, database), null);
    assert.equal(await getStaffOvertimeDetail(reviewer.auth, current.id, database), null);
  });
});

test("Clock Out preserves the P2 full-day Leave conflict and creates no OT candidate", async () => {
  assertLocalDatabase();

  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const database = transactionDatabase(transaction);
    const workDate = new Date("2026-08-28T00:00:00.000Z");
    await transaction.attendanceExpectedDay.create({
      data: {
        businessId: fixture.businessA.id,
        branchId: fixture.branchA.id,
        membershipId: fixture.auth.membershipId,
        workDate,
        kind: "WORKDAY",
        source: "ROSTER",
        expectedStartAt: new Date("2026-08-28T08:50:00.000Z"),
        expectedEndAt: new Date("2026-08-28T09:20:00.000Z"),
        timezoneSnapshot: "Asia/Kuala_Lumpur",
        createdById: fixture.actorId,
      },
    });
    const policy = await transaction.leavePolicy.create({
      data: {
        businessId: fixture.businessA.id,
        code: `ANNUAL-${randomUUID()}`,
        name: "P2 bridge leave",
        payTreatment: "PAID",
        countMode: "WEEKDAYS",
        balanceTracked: true,
        defaultEntitlementDays: 10,
        origin: "BUSINESS_CUSTOM",
        legalStatus: "COMPANY_POLICY_ONLY",
      },
    });
    const policyVersion = await transaction.leavePolicyVersion.create({
      data: {
        businessId: fixture.businessA.id,
        policyId: policy.id,
        revision: 1,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        nameSnapshot: policy.name,
        payTreatment: "PAID",
        countMode: "WEEKDAYS",
        balanceTracked: true,
        defaultEntitlementDays: 10,
        origin: "BUSINESS_CUSTOM",
        legalStatus: "COMPANY_POLICY_ONLY",
        sourceReference: "P2 bridge integration fixture",
        reason: "Verify approved Leave remains an OT blocker.",
        createdById: fixture.actorId,
      },
    });
    const leave = await transaction.leaveRequest.create({
      data: {
        businessId: fixture.businessA.id,
        membershipId: fixture.auth.membershipId,
        branchId: fixture.branchA.id,
        policyId: policy.id,
        policyVersionId: policyVersion.id,
        policyNameSnapshot: policy.name,
        payTreatmentSnapshot: "PAID",
        legalStatusSnapshot: "COMPANY_POLICY_ONLY",
        leaveUnit: "FULL_DAY",
        startsOn: workDate,
        endsOn: workDate,
        requestedDays: 1,
        reason: "Approved full-day leave conflict fixture",
        status: "APPROVED",
        reviewedById: fixture.actorId,
        reviewedAt: new Date("2026-08-27T00:00:00.000Z"),
      },
    });
    await transaction.leaveRequestDay.create({
      data: {
        leaveRequestId: leave.id,
        businessId: fixture.businessA.id,
        membershipId: fixture.auth.membershipId,
        leaveDate: workDate,
        dayFraction: 1,
        leaveUnit: "FULL_DAY",
        policyVersionId: policyVersion.id,
        payTreatmentSnapshot: "PAID",
        balanceConsumptionUnits: 1,
      },
    });

    await performAttendancePunch({
      database,
      auth: fixture.auth,
      type: "CLOCK_IN",
      input: punchInput(
        fixture.branchA.id,
        fixture.deviceIdentifier,
        "clock-in:p2-leave-conflict-001",
      ),
      now: new Date("2026-08-28T08:44:41.076Z"),
    });
    const clockOut = await performAttendancePunch({
      database,
      auth: fixture.auth,
      type: "CLOCK_OUT",
      input: punchInput(
        fixture.branchA.id,
        fixture.deviceIdentifier,
        "clock-out:p2-leave-conflict-001",
      ),
      now: new Date("2026-08-28T09:30:13.867Z"),
    });
    assert.equal(clockOut.resultingStatus, "COMPLETED");
    assert.equal(await transaction.attendanceP2Exception.count({
      where: {
        businessId: fixture.businessA.id,
        membershipId: fixture.auth.membershipId,
        workDate,
        type: "LEAVE_ATTENDANCE_CONFLICT",
        status: "OPEN",
      },
    }), 1);
    assert.equal(await transaction.attendanceP2FinalResult.count({
      where: {
        businessId: fixture.businessA.id,
        membershipId: fixture.auth.membershipId,
        workDate,
      },
    }), 0);
    assert.deepEqual(await listAttendanceOvertimeCandidates({
      businessId: fixture.businessA.id,
      allowedBranchIds: [fixture.branchA.id],
      membershipId: fixture.auth.membershipId,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEndExclusive: new Date("2026-09-01T00:00:00.000Z"),
      database: transaction as unknown as PrismaClient,
    }), []);
  });
});

test("Clock In snapshots the published Roster break and Staff App uses the Roster daily target", async () => {
  assertLocalDatabase();

  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const database = transactionDatabase(transaction);
    const now = new Date();
    now.setUTCHours(1, 0, 0, 0);
    const workDate = getAttendanceWorkDate(now, "Asia/Kuching");

    await transaction.attendanceExpectedDay.create({
      data: {
        businessId: fixture.businessA.id,
        branchId: fixture.branchA.id,
        membershipId: fixture.auth.membershipId,
        workDate,
        kind: "WORKDAY",
        source: "ROSTER",
        expectedStartAt: now,
        expectedEndAt: new Date(now.getTime() + 5 * 60 * 60_000),
        graceMinutes: 0,
        timezoneSnapshot: "Asia/Kuching",
        policySnapshot: { scheduledBreakMinutes: 0 },
        evidenceReference: "roster:integration-test:revision:1",
        createdById: fixture.actorId,
      },
    });

    const clockIn = await performAttendancePunch({
      database,
      auth: fixture.auth,
      type: "CLOCK_IN",
      input: punchInput(
        fixture.branchA.id,
        fixture.deviceIdentifier,
        "clock-in:published-roster-target",
      ),
      now,
    });
    const session = await transaction.employeeAttendance.findUniqueOrThrow({
      where: { id: clockIn.attendanceSessionId },
      select: { expectedBreakMinutes: true },
    });
    assert.equal(session.expectedBreakMinutes, 0);

    const today = await getEmployeeAttendanceToday({
      database,
      auth: fixture.auth,
      now: new Date(now.getTime() + 60_000),
    });
    assert.deepEqual(today.workPolicy, {
      breakPolicy: "MANUAL_PUNCH",
      expectedBreakMinutes: 0,
      expectedBreakSource: "SESSION_SNAPSHOT",
      normalWorkMinutesPerDay: 300,
      normalWorkMinutesSource: "PUBLISHED_ROSTER",
    });
  });
});

async function createOvertimeManager(
  transaction: Prisma.TransactionClient,
  businessId: string,
  branchId: string,
  label: string,
) {
  const token = randomUUID();
  const phone = `+601${randomInt(10_000_000, 99_999_999)}`;
  const account = await transaction.employeeAccount.create({
    data: { phoneNumber: phone, phoneNormalized: phone, name: `OT ${label}`, status: "ACTIVE" },
  });
  const membership = await transaction.employeeBusinessMembership.create({
    data: {
      employeeAccountId: account.id,
      businessId,
      employeeCode: `OT-${label.toUpperCase().replaceAll(" ", "-")}-${token.slice(0, 8)}`,
      fullName: `OT ${label}`,
      phoneNumber: phone,
      phoneNumberNormalized: phone,
      status: "ACTIVE",
      attendanceEnabled: true,
    },
  });
  const user = await transaction.user.create({
    data: {
      businessId,
      branchId,
      employeeAccountId: account.id,
      employeeBusinessMembershipId: membership.id,
      teamMemberLinkStatus: "LINKED",
      teamMemberLinkedAt: new Date("2026-08-01T00:00:00.000Z"),
      name: `OT ${label}`,
      email: `ot-${token}@test.local`,
      role: "STAFF",
      permissions: ["ATTENDANCE_EMPLOYEE_MANAGE"],
      status: "active",
    },
  });
  return {
    user,
    auth: {
      sessionId: randomUUID(),
      employeeAccountId: account.id,
      membershipId: membership.id,
      businessId,
      primaryBranchId: branchId,
      attendanceBranchId: branchId,
      deviceId: randomUUID(),
    } satisfies EmployeeAuthContext,
  };
}

async function createOvertimeSubject(
  transaction: Prisma.TransactionClient,
  businessId: string,
  fullName: string,
) {
  const token = randomUUID();
  const phone = `+601${randomInt(10_000_000, 99_999_999)}`;
  const account = await transaction.employeeAccount.create({
    data: { phoneNumber: phone, phoneNormalized: phone, name: fullName, status: "ACTIVE" },
  });
  return transaction.employeeBusinessMembership.create({
    data: {
      employeeAccountId: account.id,
      businessId,
      employeeCode: `OT-SUBJECT-${token.slice(0, 8)}`,
      fullName,
      phoneNumber: phone,
      phoneNumberNormalized: phone,
      status: "ACTIVE",
      attendanceEnabled: true,
    },
  });
}

function createOvertimeFinalResult(
  transaction: Prisma.TransactionClient,
  input: {
    businessId: string;
    branchId: string;
    membershipId: string;
    workDate: string;
    createdById: string;
  },
) {
  return transaction.attendanceP2FinalResult.create({
    data: {
      businessId: input.businessId,
      branchId: input.branchId,
      membershipId: input.membershipId,
      workDate: new Date(`${input.workDate}T00:00:00.000Z`),
      version: 1,
      outcome: "PRESENT",
      expectedDayKindSnapshot: "NOT_SCHEDULED",
      actualClockInAt: new Date(`${input.workDate}T01:00:00.000Z`),
      actualClockOutAt: new Date(`${input.workDate}T02:00:00.000Z`),
      totalBreakMinutes: 0,
      totalWorkedMinutes: 60,
      sourceDigest: "a".repeat(64),
      resolutionDigest: "b".repeat(64),
      createdById: input.createdById,
    },
  });
}

async function createFixture(transaction: Prisma.TransactionClient) {
  const suffix = randomUUID().slice(0, 8);
  const businessA = await transaction.business.create({
    data: {
      name: `Attendance C A ${suffix}`,
      slug: `attendance-c-a-${suffix}`,
      timezone: "Asia/Kuching",
    },
  });
  const businessB = await transaction.business.create({
    data: {
      name: `Attendance C B ${suffix}`,
      slug: `attendance-c-b-${suffix}`,
    },
  });
  await transaction.businessModuleEntitlement.create({
    data: {
      businessId: businessA.id,
      moduleKey: "HR",
      status: "ENABLED",
      enabledFrom: new Date("2026-01-01T00:00:00.000Z"),
      source: "SYSTEM",
    },
  });
  const branchA = await transaction.branch.create({
    data: {
      businessId: businessA.id,
      name: `Attendance Branch A ${suffix}`,
    },
  });
  const branchB = await transaction.branch.create({
    data: {
      businessId: businessB.id,
      name: `Attendance Branch B ${suffix}`,
    },
  });
  const actor = await transaction.user.create({
    data: {
      name: `Attendance Manager ${suffix}`,
      email: `attendance-manager-${suffix}@test.local`,
      role: "BUSINESS_OWNER",
      status: "active",
      businessId: businessA.id,
    },
  });
  await transaction.branchAttendanceSetting.create({
    data: {
      businessId: businessA.id,
      branchId: branchA.id,
      latitude: 1.5535,
      longitude: 110.3593,
      geofenceRadiusMeters: 100,
      minimumAccuracyMeters: 80,
      requireGeofence: true,
      allowOutsideGeofenceRequest: true,
      requirePhoto: false,
      timezone: "Asia/Kuching",
      isEnabled: true,
    },
  });

  const employeeAccount = await transaction.employeeAccount.create({
    data: {
      phoneNumber: `+601${Date.now().toString().slice(-8)}`,
      phoneNormalized: `+601${Date.now().toString().slice(-8)}`,
      name: "Phase 1C Employee",
      status: "ACTIVE",
    },
  });
  const membership =
    await transaction.employeeBusinessMembership.create({
      data: {
        employeeAccountId: employeeAccount.id,
        businessId: businessA.id,
        employeeCode: `C-${suffix}`,
        fullName: "Phase 1C Employee",
        phoneNumber: employeeAccount.phoneNumber,
        phoneNumberNormalized: employeeAccount.phoneNormalized,
        employmentType: "FULL_TIME",
        status: "ACTIVE",
        attendanceEnabled: true,
      },
    });
  await transaction.employeeBranchAssignment.create({
    data: {
      membershipId: membership.id,
      businessId: businessA.id,
      branchId: branchA.id,
      isPrimary: true,
      canClockIn: true,
      // The fixture replays governed Attendance examples on fixed August 2026
      // work dates, so its canonical branch assignment must already be active.
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
    },
  });

  const deviceIdentifier = `phase1c-device-${randomUUID()}`;
  const device = await transaction.employeeDevice.create({
    data: {
      employeeAccountId: employeeAccount.id,
      deviceIdentifierHash: hashEmployeeIdentifier(
        "device",
        deviceIdentifier,
      ),
      status: "ACTIVE",
      canView: true,
      canPunch: true,
    },
  });
  const employeeSession = await transaction.employeeSession.create({
    data: {
      employeeAccountId: employeeAccount.id,
      membershipId: membership.id,
      businessId: businessA.id,
      primaryBranchId: branchA.id,
      employeeDeviceId: device.id,
      refreshTokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 48 * 60 * 60_000),
    },
  });

  const otherAccount = await transaction.employeeAccount.create({
    data: {
      phoneNumber: `+602${Date.now().toString().slice(-8)}`,
      phoneNormalized: `+602${Date.now().toString().slice(-8)}`,
      name: "Other Phase 1C Employee",
      status: "ACTIVE",
    },
  });
  const otherMembership =
    await transaction.employeeBusinessMembership.create({
      data: {
        employeeAccountId: otherAccount.id,
        businessId: businessA.id,
        employeeCode: `OTHER-${suffix}`,
        fullName: "Other Phase 1C Employee",
        phoneNumber: otherAccount.phoneNumber,
        phoneNumberNormalized: otherAccount.phoneNormalized,
        status: "ACTIVE",
        attendanceEnabled: false,
      },
    });
  const otherEmployeeAttendance =
    await transaction.employeeAttendance.create({
      data: {
        employeeAccountId: otherAccount.id,
        membershipId: otherMembership.id,
        businessId: businessA.id,
        branchId: branchA.id,
        workDate: new Date(),
        status: "COMPLETED",
        clockInAt: new Date(Date.now() - 60 * 60_000),
        clockOutAt: new Date(),
        totalWorkedMinutes: 60,
      },
    });

  return {
    businessA,
    businessB,
    branchA,
    branchB,
    actorId: actor.id,
    deviceIdentifier,
    auth: {
      sessionId: employeeSession.id,
      employeeAccountId: employeeAccount.id,
      membershipId: membership.id,
      businessId: businessA.id,
      primaryBranchId: branchA.id,
      deviceId: device.id,
    } satisfies EmployeeAuthContext,
    otherEmployeeAttendanceId: otherEmployeeAttendance.id,
  };
}

function punchInput(
  branchId: string,
  deviceIdentifier: string,
  idempotencyKey: string,
) {
  return {
    branchId,
    latitude: 1.5535,
    longitude: 110.3593,
    accuracyMeters: 10,
    deviceIdentifier,
    idempotencyKey,
  };
}

function transactionDatabase(
  transaction: Prisma.TransactionClient,
): PrismaClient {
  return {
    auditLog: transaction.auditLog,
    $transaction: async (
      callback: (transaction: Prisma.TransactionClient) => unknown,
    ) => callback(transaction),
  } as unknown as PrismaClient;
}

async function assertAttendanceError(
  promise: Promise<unknown>,
  code: AttendanceApiError["code"],
) {
  await assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof AttendanceApiError && error.code === code,
  );
}

async function withRollback(
  callback: (transaction: Prisma.TransactionClient) => Promise<void>,
) {
  try {
    await prisma.$transaction(async (transaction) => {
      await callback(transaction);
      throw rollbackSignal;
    });
  } catch (error) {
    if (error !== rollbackSignal) {
      throw error;
    }
  }
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Attendance integration tests.");
  }

  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname),
    "Attendance integration tests must use a local database.",
  );
}
import { switchEmployeeAttendanceBranch } from "../../src/lib/attendance/branch-switch-service";
import { reconcileStaleEmployeeAttendance } from "../../src/lib/attendance/stale-session-service";
import { adjustAttendanceSession, reviewAttendanceException } from "../../src/lib/attendance/management-service";

test("Attendance operations support branch switching, stale shifts, and missing-punch requests", async () => {
  assertLocalDatabase();

  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const database = transactionDatabase(transaction);
    const now = new Date();
    const branchA2 = await transaction.branch.create({
      data: {
        businessId: fixture.businessA.id,
        name: `Attendance Branch A2 ${randomUUID().slice(0, 8)}`,
      },
    });
    await transaction.branchAttendanceSetting.create({
      data: {
        businessId: fixture.businessA.id,
        branchId: branchA2.id,
        latitude: 1.5535,
        longitude: 110.3593,
        requirePhoto: false,
        timezone: "Asia/Kuching",
        isEnabled: true,
      },
    });
    await transaction.employeeBranchAssignment.create({
      data: {
        membershipId: fixture.auth.membershipId,
        businessId: fixture.businessA.id,
        branchId: branchA2.id,
        isPrimary: false,
        canClockIn: true,
        effectiveFrom: new Date(now.getTime() - 86_400_000),
        status: "ACTIVE",
      },
    });

    const switched = await switchEmployeeAttendanceBranch({
      auth: fixture.auth,
      input: { branchId: branchA2.id },
      database,
      now,
    });
    assert.equal(switched.branch.id, branchA2.id);
    assert.equal(
      (
        await transaction.employeeSession.findUniqueOrThrow({
          where: { id: fixture.auth.sessionId },
        })
      ).attendanceBranchId,
      branchA2.id,
    );

    const branchAuth = {
      ...fixture.auth,
      primaryBranchId: fixture.auth.primaryBranchId,
      attendanceBranchId: branchA2.id,
    } satisfies EmployeeAuthContext;
    const stale = await transaction.employeeAttendance.create({
      data: {
        employeeAccountId: branchAuth.employeeAccountId,
        membershipId: branchAuth.membershipId,
        businessId: branchAuth.businessId,
        branchId: branchA2.id,
        workDate: now,
        status: "OPEN",
        clockInAt: new Date(now.getTime() - 19 * 3_600_000),
      },
    });
    const reconciled = await reconcileStaleEmployeeAttendance({
      auth: branchAuth,
      database,
      now,
      staleAfterHours: 18,
    });
    assert.equal(reconciled?.sessionId, stale.id);
    const incomplete =
      await transaction.employeeAttendance.findUniqueOrThrow({
        where: { id: stale.id },
      });
    assert.equal(incomplete.status, "INCOMPLETE");
    assert.equal(incomplete.approvalStatus, "PENDING");
    assert.equal(incomplete.totalWorkedMinutes, 18 * 60);
    assert.equal(
      await transaction.attendanceException.count({
        where: {
          attendanceSessionId: stale.id,
          type: "OTHER",
          status: "PENDING",
        },
      }),
      1,
    );

    const correction = await submitAttendanceException({
      auth: branchAuth,
      database,
      now,
      input: {
        branchId: branchA2.id,
        attendanceSessionId: stale.id,
        attendancePunchId: null,
        type: "FORGOT_CLOCK_OUT",
        requestedClockOutAt: new Date(now.getTime() - 60 * 60_000),
        reason: "I forgot to clock out after the late shift.",
        deviceIdentifier: fixture.deviceIdentifier,
      },
    });
    assert.equal(correction.status, "PENDING");

    const manager = await transaction.user.create({
      data: {
        businessId: fixture.businessA.id,
        branchId: branchA2.id,
        name: "Attendance Manager",
        email: `attendance-manager-${randomUUID()}@example.test`,
        role: "BUSINESS_OWNER",
      },
    });
    const managerContext = {
      businessId: fixture.businessA.id,
      allowedBranchIds: [fixture.branchA.id, branchA2.id],
      wholeBusinessScope: true,
      actor: {
        userId: manager.id,
        name: manager.name,
        email: manager.email!,
      },
    } as const;
    await reviewAttendanceException(
      {
        ...managerContext,
        input: {
          exceptionId: correction.id,
          decision: "APPROVED",
          reviewNote: "Verified with the branch manager.",
        },
      },
      database,
    );
    const completed =
      await transaction.employeeAttendance.findUniqueOrThrow({
        where: { id: stale.id },
      });
    assert.equal(completed.status, "COMPLETED");
    assert.ok(completed.clockOutPunchId);
    assert.equal(
      await transaction.attendancePunch.count({
        where: {
          attendanceSessionId: stale.id,
          type: "CLOCK_OUT",
          source: "ADMIN_MANUAL",
        },
      }),
      1,
    );

    const localInput = (value: Date) => {
      const parts = new Map(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kuching",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        })
          .formatToParts(value)
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, part.value]),
      );
      return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}T${parts.get("hour")}:${parts.get("minute")}`;
    };
    const adjusted = await adjustAttendanceSession(
      {
        ...managerContext,
        input: {
          sessionId: stale.id,
          adjustedClockInLocal: localInput(stale.clockInAt),
          adjustedClockOutLocal: localInput(
            new Date(now.getTime() - 60 * 60_000),
          ),
          adjustedBreakMinutes: 30,
          reason: "Confirmed a thirty minute meal break.",
          expectedUpdatedAt: completed.updatedAt.toISOString(),
        },
      },
      database,
    );
    assert.equal(adjusted.totalBreakMinutes, 30);
    assert.equal(adjusted.totalWorkedMinutes, 17 * 60 + 30);
    assert.equal(
      await transaction.attendanceAdjustment.count({
        where: { attendanceSessionId: stale.id },
      }),
      2,
    );

    await assertAttendanceError(
      submitAttendanceException({
        auth: branchAuth,
        database,
        now,
        input: {
          branchId: branchA2.id,
          type: "FORGOT_CLOCK_IN",
          requestedClockInAt: new Date(now.getTime() + 3_600_000),
          reason: "This future request must be rejected.",
          deviceIdentifier: fixture.deviceIdentifier,
        },
      }),
      "VALIDATION_ERROR",
    );
  });
});
