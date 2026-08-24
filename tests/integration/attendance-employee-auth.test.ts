import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  getEmployeeAuthConfig,
  type EmployeeAuthConfig,
} from "../../src/lib/attendance/employee-auth/config";
import { revokeEmployeeDevice } from "../../src/lib/attendance/employee-auth/device-service";
import { EmployeeAuthError } from "../../src/lib/attendance/employee-auth/errors";
import {
  EMPLOYEE_OTP_REQUEST_MESSAGE,
  requestEmployeeOtp,
  selectEmployeeMembership,
  verifyEmployeeOtp,
} from "../../src/lib/attendance/employee-auth/otp-service";
import { CapturingEmployeeOtpProvider } from "../../src/lib/attendance/employee-auth/provider";
import {
  authenticateEmployeeSessionToken,
  createEmployeeSessionRecord,
  getEmployeeAuthProfile,
  getEmployeeWorkplaces,
  revokeEmployeeSessionToken,
  switchEmployeeWorkplace,
} from "../../src/lib/attendance/employee-auth/session";

const prisma = new PrismaClient();
const TEST_SECRET =
  "phase-1c-integration-secret-longer-than-thirty-two-bytes";

after(async () => {
  await prisma.$disconnect();
});

test("Phase 1C employee auth enforces OTP, membership, device, session, and tenant safety", async () => {
  assertLocalDatabase();
  const baseTime = new Date(Date.now() - 3 * 60_000);
  const fixture = await createFixture();
  const config = authConfig({
    EMPLOYEE_OTP_MOCK_CODE: "000000",
  });
  let dynamicSessionToken: string | null = null;

  try {
    const unknownProvider = new CapturingEmployeeOtpProvider();
    const unknownResponse = await requestEmployeeOtp(
      {
        phoneNumber: randomPhone(),
        deviceIdentifier: "unknown-device-identifier-0001",
        request: requestContext("10.0.0.1"),
      },
      {
        database: prisma,
        config,
        provider: unknownProvider,
        now: baseTime,
      },
    );
    assert.equal(unknownProvider.sent.length, 0);
    assert.equal(unknownResponse.message, EMPLOYEE_OTP_REQUEST_MESSAGE);

    await prisma.branchAttendanceSetting.update({
      where: { branchId: fixture.branchA.id },
      data: { isEnabled: false },
    });
    const disabledSettingProvider = new CapturingEmployeeOtpProvider();
    const disabledSettingResponse = await requestEmployeeOtp(
      {
        phoneNumber: fixture.single.phone,
        deviceIdentifier: "single-primary-device-0001",
        request: requestContext("10.0.0.2"),
      },
      {
        database: prisma,
        config,
        provider: disabledSettingProvider,
        now: baseTime,
      },
    );
    assert.equal(disabledSettingProvider.sent.length, 0);
    assert.equal(
      disabledSettingResponse.message,
      unknownResponse.message,
      "unknown and ineligible employees must receive the same public message",
    );
    await clearChallenges(fixture.single.phone);
    await prisma.branchAttendanceSetting.update({
      where: { branchId: fixture.branchA.id },
      data: { isEnabled: true },
    });

    await prisma.employeeBusinessMembership.update({
      where: { id: fixture.single.membershipId },
      data: { status: "SUSPENDED" },
    });
    const suspendedProvider = new CapturingEmployeeOtpProvider();
    await requestEmployeeOtp(
      {
        phoneNumber: fixture.single.phone,
        deviceIdentifier: "single-primary-device-0001",
        request: requestContext("10.0.0.3"),
      },
      {
        database: prisma,
        config,
        provider: suspendedProvider,
        now: baseTime,
      },
    );
    assert.equal(suspendedProvider.sent.length, 0);
    await clearChallenges(fixture.single.phone);

    await prisma.employeeBusinessMembership.update({
      where: { id: fixture.single.membershipId },
      data: { status: "TERMINATED", terminatedAt: new Date() },
    });
    const terminatedProvider = new CapturingEmployeeOtpProvider();
    await requestEmployeeOtp(
      {
        phoneNumber: fixture.single.phone,
        deviceIdentifier: "single-primary-device-0001",
        request: requestContext("10.0.0.31"),
      },
      {
        database: prisma,
        config,
        provider: terminatedProvider,
        now: baseTime,
      },
    );
    assert.equal(terminatedProvider.sent.length, 0);
    await clearChallenges(fixture.single.phone);

    await prisma.employeeBusinessMembership.update({
      where: { id: fixture.single.membershipId },
      data: {
        status: "ACTIVE",
        attendanceEnabled: false,
        terminatedAt: null,
      },
    });
    const attendanceDisabledProvider =
      new CapturingEmployeeOtpProvider();
    await requestEmployeeOtp(
      {
        phoneNumber: fixture.single.phone,
        deviceIdentifier: "single-primary-device-0001",
        request: requestContext("10.0.0.4"),
      },
      {
        database: prisma,
        config,
        provider: attendanceDisabledProvider,
        now: baseTime,
      },
    );
    assert.equal(attendanceDisabledProvider.sent.length, 0);
    await clearChallenges(fixture.single.phone);
    await prisma.employeeBusinessMembership.update({
      where: { id: fixture.single.membershipId },
      data: { attendanceEnabled: true },
    });

    await prisma.employeeAccount.update({
      where: { id: fixture.single.accountId },
      data: { status: "INACTIVE" },
    });
    const inactiveProvider = new CapturingEmployeeOtpProvider();
    await requestEmployeeOtp(
      {
        phoneNumber: fixture.single.phone,
        deviceIdentifier: "single-primary-device-0001",
        request: requestContext("10.0.0.5"),
      },
      {
        database: prisma,
        config,
        provider: inactiveProvider,
        now: baseTime,
      },
    );
    assert.equal(inactiveProvider.sent.length, 0);
    await clearChallenges(fixture.single.phone);
    await prisma.employeeAccount.update({
      where: { id: fixture.single.accountId },
      data: { status: "ACTIVE" },
    });

    await prisma.employeeBranchAssignment.updateMany({
      where: { membershipId: fixture.single.membershipId },
      data: { canClockIn: false },
    });
    const noValidPrimaryProvider = new CapturingEmployeeOtpProvider();
    await requestEmployeeOtp(
      {
        phoneNumber: fixture.single.phone,
        deviceIdentifier: "single-primary-device-0001",
        request: requestContext("10.0.0.6"),
      },
      {
        database: prisma,
        config,
        provider: noValidPrimaryProvider,
        now: baseTime,
      },
    );
    assert.equal(
      noValidPrimaryProvider.sent.length,
      0,
      "an employee without a clock-in eligible primary assignment must not receive OTP",
    );
    await clearChallenges(fixture.single.phone);
    await prisma.employeeBranchAssignment.updateMany({
      where: { membershipId: fixture.single.membershipId },
      data: { canClockIn: true },
    });

    const providerFailureResponse = await requestEmployeeOtp(
      {
        phoneNumber: fixture.single.phone,
        deviceIdentifier: "single-primary-device-0001",
        request: requestContext("10.0.0.7"),
      },
      {
        database: prisma,
        config,
        provider: {
          name: "mock",
          channel: "local",
          verificationMode: "provider",
          async sendVerification() {
            throw new Error("simulated provider failure");
          },
          async checkVerification() {
            return { status: "REJECTED" as const };
          },
        },
        now: baseTime,
      },
    );
    assert.equal(
      providerFailureResponse.message,
      EMPLOYEE_OTP_REQUEST_MESSAGE,
      "provider failures must keep the uniform public response",
    );
    assert.deepEqual(
      Object.keys(providerFailureResponse).sort(),
      ["challengeId", "expiresInSeconds", "message", "resendAfterSeconds"],
      "provider errors must not leak into the public result",
    );
    const providerFailureChallenge =
      await prisma.employeeOtpChallenge.findUniqueOrThrow({
        where: { id: providerFailureResponse.challengeId },
      });
    assert.equal(
      providerFailureChallenge.invalidatedAt?.getTime(),
      baseTime.getTime(),
    );
    assert.equal(providerFailureChallenge.createdAt.getTime(), baseTime.getTime());
    assert.equal(
      (providerFailureChallenge.invalidatedAt?.getTime() ?? 0) >=
        providerFailureChallenge.createdAt.getTime(),
      true,
    );
    await clearChallenges(fixture.single.phone);

    let delayedProviderStarted = false;
    let markProviderStarted!: () => void;
    let releaseProvider!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const delayedDeliveryPromise = requestEmployeeOtp(
      {
        phoneNumber: fixture.single.phone,
        deviceIdentifier: "single-primary-device-0001",
        request: requestContext("10.0.0.8"),
      },
      {
        database: prisma,
        config,
        provider: {
          name: "mock",
          channel: "local",
          verificationMode: "provider",
          async sendVerification(input) {
            delayedProviderStarted = true;
            markProviderStarted();
            await providerRelease;
            return {
              status: "ACCEPTED" as const,
              providerReference: `mock:${input.challengeId}`,
            };
          },
          async checkVerification() {
            return { status: "REJECTED" as const };
          },
        },
        now: baseTime,
      },
    );
    await providerStarted;
    assert.equal(delayedProviderStarted, true);
    releaseProvider();
    const delayedDeliveryResponse = await delayedDeliveryPromise;
    assert.equal(delayedDeliveryResponse.message, EMPLOYEE_OTP_REQUEST_MESSAGE);
    assert.equal(
      await prisma.auditLog.count({
        where: {
          action: "STAFF_OTP_SEND_ACCEPTED",
          entityId: delayedDeliveryResponse.challengeId,
        },
      }),
      1,
      "executing the queued task must send and write the success audit",
    );
    await clearChallenges(fixture.single.phone);

    const singleRequest = await requestWithCapture({
      phone: fixture.single.phone,
      deviceIdentifier: "single-primary-device-0001",
      ipAddress: "10.1.0.1",
      now: baseTime,
      config,
    });
    assert.equal(singleRequest.provider.sent.length, 1);
    assert.equal(singleRequest.provider.sent[0].otp, "000000");
    assert.equal(singleRequest.provider.sent[0].purpose, "LOGIN");
    assert.equal(singleRequest.provider.sent[0].locale, "en-MY");
    const singleChallengeBeforeVerify =
      await prisma.employeeOtpChallenge.findUniqueOrThrow({
        where: { id: singleRequest.result.challengeId },
      });
    assert.equal(singleChallengeBeforeVerify.invalidatedAt, null);
    assert.equal(singleChallengeBeforeVerify.verifiedAt, null);
    assert.equal(singleChallengeBeforeVerify.attempts, 0);
    assert.equal(singleChallengeBeforeVerify.otpHash, null);
    assert.equal(singleChallengeBeforeVerify.provider, "mock");
    assert.equal(singleChallengeBeforeVerify.deliveryChannel, "local");
    assert.notEqual(singleChallengeBeforeVerify.providerReference, null);
    assert.equal(
      singleChallengeBeforeVerify.expiresAt.getTime() >
        singleChallengeBeforeVerify.createdAt.getTime(),
      true,
    );
    const [databaseClock] = await prisma.$queryRaw<
      Array<{ databaseNow: Date; timezone: string }>
    >`
      SELECT
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS "databaseNow",
        current_setting('TIMEZONE') AS timezone
    `;
    assert.equal(
      singleChallengeBeforeVerify.expiresAt.getTime() >
        databaseClock.databaseNow.getTime(),
      true,
      `challenge must be unexpired at DB clock (${databaseClock.timezone})`,
    );
    assert.equal(
      singleChallengeBeforeVerify.attempts <
        singleChallengeBeforeVerify.maxAttempts,
      true,
    );
    const singleLogin = await verifyEmployeeOtp(
      {
        challengeId: singleRequest.result.challengeId,
        otp: singleRequest.provider.sent[0].otp,
        deviceIdentifier: "single-primary-device-0001",
        displayName: "Front Desk Tablet",
        platform: "PWA",
        browser: "Chromium",
        request: requestContext("10.1.0.1"),
      },
      {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 1),
      },
    );
    if (singleLogin.status !== "AUTHENTICATED") {
      assert.fail("Single membership should authenticate directly.");
    }
    const singleContext = await authenticateEmployeeSessionToken(
      singleLogin.token,
      {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 2),
      },
    );
    assert.deepEqual(singleContext, {
      sessionId: singleLogin.context.sessionId,
      employeeAccountId: fixture.single.accountId,
      membershipId: fixture.single.membershipId,
      businessId: fixture.businessA.id,
      primaryBranchId: fixture.branchA.id,
      attendanceBranchId: fixture.branchA.id,
      deviceId: singleLogin.context.deviceId,
    });
    const safeProfile = await getEmployeeAuthProfile(
      singleContext,
      prisma,
    );
    assert.equal(safeProfile.employee.fullName, "Single Employee");
    assert.equal(safeProfile.workplace.businessName, fixture.businessA.name);
    assert.equal(safeProfile.workplace.primaryBranchName, fixture.branchA.name);
    const serializedProfile = JSON.stringify(safeProfile);
    for (const internalId of Object.values(singleContext)) {
      assert.equal(serializedProfile.includes(internalId), false);
    }

    assert.equal(
      await revokeEmployeeSessionToken(singleLogin.token, {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 2),
        reason: "Employee logged out.",
      }),
      true,
    );
    assert.equal(
      await revokeEmployeeSessionToken(singleLogin.token, {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 3),
        reason: "Repeated logout.",
      }),
      false,
    );
    await assert.rejects(
      authenticateEmployeeSessionToken(singleLogin.token, {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 4),
      }),
      isAuthError("SESSION_REVOKED"),
    );
    const logoutActions = (
      await prisma.auditLog.findMany({
        where: {
          entityType: "EmployeeSession",
          entityId: singleLogin.context.sessionId,
          action: {
            in: ["EMPLOYEE_LOGOUT", "EMPLOYEE_SESSION_REVOKED"],
          },
        },
        select: { action: true },
      })
    ).map((audit) => audit.action).sort();
    assert.deepEqual(logoutActions, [
      "EMPLOYEE_LOGOUT",
      "EMPLOYEE_SESSION_REVOKED",
    ]);

    await assert.rejects(
      verifyEmployeeOtp(
        {
          challengeId: singleRequest.result.challengeId,
          otp: singleRequest.provider.sent[0].otp,
          deviceIdentifier: "single-primary-device-0001",
        },
        {
          database: prisma,
          config,
          now: plusSeconds(baseTime, 3),
        },
      ),
      isAuthError("OTP_INVALID"),
    );

    await clearChallenges(fixture.single.phone);
    const oldRequest = await requestWithCapture({
      phone: fixture.single.phone,
      deviceIdentifier: "single-primary-device-0001",
      ipAddress: "10.1.0.2",
      now: baseTime,
      config,
    });
    const newRequest = await requestWithCapture({
      phone: fixture.single.phone,
      deviceIdentifier: "single-primary-device-0001",
      ipAddress: "10.1.0.2",
      now: plusSeconds(baseTime, 61),
      config,
    });
    assert.equal(newRequest.provider.sent.length, 1);
    await assert.rejects(
      verifyEmployeeOtp(
        {
          challengeId: oldRequest.result.challengeId,
          otp: oldRequest.provider.sent[0].otp,
          deviceIdentifier: "single-primary-device-0001",
        },
        {
          database: prisma,
          config,
          now: plusSeconds(baseTime, 62),
        },
      ),
      isAuthError("OTP_INVALID"),
    );
    const replacementLogin = await verifyEmployeeOtp(
      {
        challengeId: newRequest.result.challengeId,
        otp: newRequest.provider.sent[0].otp,
        deviceIdentifier: "single-primary-device-0001",
      },
      {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 62),
      },
    );
    assert.equal(replacementLogin.status, "AUTHENTICATED");

    await clearChallenges(fixture.single.phone);
    const expiredRequest = await requestWithCapture({
      phone: fixture.single.phone,
      deviceIdentifier: "single-primary-device-0001",
      ipAddress: "10.1.0.3",
      now: baseTime,
      config,
    });
    await assert.rejects(
      verifyEmployeeOtp(
        {
          challengeId: expiredRequest.result.challengeId,
          otp: expiredRequest.provider.sent[0].otp,
          deviceIdentifier: "single-primary-device-0001",
        },
        {
          database: prisma,
          config,
          now: plusSeconds(baseTime, 301),
        },
      ),
      isAuthError("OTP_INVALID"),
    );
    const expiredChallenge =
      await prisma.employeeOtpChallenge.findUniqueOrThrow({
        where: { id: expiredRequest.result.challengeId },
      });
    assert.notEqual(expiredChallenge.invalidatedAt, null);

    await clearChallenges(fixture.single.phone);
    const attemptsRequest = await requestWithCapture({
      phone: fixture.single.phone,
      deviceIdentifier: "single-primary-device-0001",
      ipAddress: "10.1.0.4",
      now: baseTime,
      config,
    });
    const wrongOtp =
      attemptsRequest.provider.sent[0].otp === "000000"
        ? "111111"
        : "000000";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(
        verifyEmployeeOtp(
          {
            challengeId: attemptsRequest.result.challengeId,
            otp: wrongOtp,
            deviceIdentifier: "single-primary-device-0001",
          },
          {
            database: prisma,
            config,
            now: plusSeconds(baseTime, 1),
          },
        ),
        isAuthError(attempt === 4 ? "OTP_LOCKED" : "OTP_INVALID"),
      );
    }
    const exhaustedChallenge =
      await prisma.employeeOtpChallenge.findUniqueOrThrow({
        where: { id: attemptsRequest.result.challengeId },
      });
    assert.equal(exhaustedChallenge.attempts, 5);
    assert.notEqual(exhaustedChallenge.invalidatedAt, null);
    assert.equal(
      await prisma.auditLog.count({
        where: {
          action: "EMPLOYEE_OTP_FAILED",
          entityId: attemptsRequest.result.challengeId,
        },
      }),
      1,
      "terminal OTP failure audit must be emitted once",
    );

    await exerciseVerifyRateLimit(fixture, plusSeconds(baseTime, 4 * 60 * 60));
    await exerciseRateLimits(fixture, baseTime);

    await clearChallenges(fixture.multi.phone);
    const multiDevice = "multi-membership-device-0001";
    const multiRequest = await requestWithCapture({
      phone: fixture.multi.phone,
      deviceIdentifier: multiDevice,
      ipAddress: "10.2.0.1",
      now: baseTime,
      config,
    });
    const firstSelection = await verifyEmployeeOtp(
      {
        challengeId: multiRequest.result.challengeId,
        otp: multiRequest.provider.sent[0].otp,
        deviceIdentifier: multiDevice,
      },
      {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 1),
      },
    );
    if (firstSelection.status !== "MEMBERSHIP_SELECTION_REQUIRED") {
      assert.fail("Multiple memberships must require explicit selection.");
    }
    assert.equal(firstSelection.memberships.length, 2);

    const newerMultiRequest = await requestWithCapture({
      phone: fixture.multi.phone,
      deviceIdentifier: multiDevice,
      ipAddress: "10.2.0.1",
      now: plusSeconds(baseTime, 61),
      config,
    });
    await assert.rejects(
      selectEmployeeMembership(
        {
          selectionToken: firstSelection.selectionToken,
          membershipId: fixture.multi.membershipBId,
          deviceIdentifier: multiDevice,
        },
        {
          database: prisma,
          config,
          now: plusSeconds(baseTime, 62),
        },
      ),
      isAuthError("OTP_INVALID"),
      "a new OTP must invalidate an older verified selection",
    );
    const secondSelection = await verifyEmployeeOtp(
      {
        challengeId: newerMultiRequest.result.challengeId,
        otp: newerMultiRequest.provider.sent[0].otp,
        deviceIdentifier: multiDevice,
      },
      {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 62),
      },
    );
    if (secondSelection.status !== "MEMBERSHIP_SELECTION_REQUIRED") {
      assert.fail("Multiple memberships must require explicit selection.");
    }
    await assert.rejects(
      selectEmployeeMembership(
        {
          selectionToken: secondSelection.selectionToken,
          membershipId: randomUUID(),
          deviceIdentifier: multiDevice,
        },
        {
          database: prisma,
          config,
          now: plusSeconds(baseTime, 63),
        },
      ),
      isAuthError("MEMBERSHIP_NOT_AVAILABLE"),
    );
    const selectedLogin = await selectEmployeeMembership(
      {
        selectionToken: secondSelection.selectionToken,
        membershipId: fixture.multi.membershipBId,
        deviceIdentifier: multiDevice,
        displayName: "Multi Business Phone",
      },
      {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 63),
      },
    );
    assert.equal(selectedLogin.context.businessId, fixture.businessB.id);
    assert.equal(
      selectedLogin.context.membershipId,
      fixture.multi.membershipBId,
    );
    await assert.rejects(
      selectEmployeeMembership(
        {
          selectionToken: secondSelection.selectionToken,
          membershipId: fixture.multi.membershipBId,
          deviceIdentifier: multiDevice,
        },
        {
          database: prisma,
          config,
          now: plusSeconds(baseTime, 64),
        },
      ),
      isAuthError("OTP_INVALID"),
      "selection token must be one-time",
    );

    const multiDeviceBefore =
      await prisma.employeeDevice.findUniqueOrThrow({
        where: { id: selectedLogin.context.deviceId },
      });
    const multiSessionBefore =
      await prisma.employeeSession.findUniqueOrThrow({
        where: { id: selectedLogin.context.sessionId },
      });
    const multiDeviceRevokeAuditCountBefore = await prisma.auditLog.count({
      where: {
        action: "EMPLOYEE_DEVICE_REVOKED",
        entityId: selectedLogin.context.deviceId,
      },
    });
    await assert.rejects(
      revokeEmployeeDevice(
        {
          businessId: fixture.businessA.id,
          allowedBranchIds: [fixture.branchA.id],
          wholeBusinessScope: true,
          membershipId: fixture.multi.membershipAId,
          deviceId: selectedLogin.context.deviceId,
          reason: "Business A attempted shared-device revoke",
          actor: {
            userId: fixture.actor.id,
            name: fixture.actor.name,
            email: fixture.actor.email ?? "",
          },
          now: plusSeconds(baseTime, 64),
        },
        prisma,
      ),
      isAuthError("MEMBERSHIP_NOT_AVAILABLE"),
      "one business must not account-globally revoke a shared employee device",
    );
    const multiDeviceAfter =
      await prisma.employeeDevice.findUniqueOrThrow({
        where: { id: selectedLogin.context.deviceId },
      });
    const multiSessionAfter =
      await prisma.employeeSession.findUniqueOrThrow({
        where: { id: selectedLogin.context.sessionId },
      });
    assert.equal(multiDeviceAfter.status, multiDeviceBefore.status);
    assert.equal(multiDeviceAfter.revokedAt, multiDeviceBefore.revokedAt);
    assert.equal(multiSessionAfter.revokedAt, multiSessionBefore.revokedAt);
    assert.equal(
      await prisma.auditLog.count({
        where: {
          action: "EMPLOYEE_DEVICE_REVOKED",
          entityId: selectedLogin.context.deviceId,
        },
      }),
      multiDeviceRevokeAuditCountBefore,
      "rejected cross-business revoke must not leave an audit claiming success",
    );
    await authenticateEmployeeSessionToken(selectedLogin.token, {
      database: prisma,
      config,
      now: plusSeconds(baseTime, 64),
    });

    const multiBusinessASession = await prisma.$transaction((transaction) =>
      createEmployeeSessionRecord(
        {
          employeeAccountId: fixture.multi.accountId,
          membershipId: fixture.multi.membershipAId,
          businessId: fixture.businessA.id,
          primaryBranchId: fixture.branchA.id,
          deviceId: selectedLogin.context.deviceId,
          ipAddressHash: null,
          userAgent: "Phase1CMultiBusiness/1.0",
          now: plusSeconds(baseTime, 65),
        },
        transaction,
        config,
      ),
    );
    await clearChallenges(fixture.multi.phone);
    const multiReplacementDevice = "multi-membership-device-0002";
    const multiReplacementRequest = await requestWithCapture({
      phone: fixture.multi.phone,
      deviceIdentifier: multiReplacementDevice,
      ipAddress: "10.2.0.2",
      now: plusSeconds(baseTime, 122),
      config,
    });
    assert.equal(
      multiReplacementRequest.provider.sent[0].purpose,
      "REGISTER_DEVICE",
    );
    const multiReplacementSelection = await verifyEmployeeOtp(
      {
        challengeId: multiReplacementRequest.result.challengeId,
        otp: multiReplacementRequest.provider.sent[0].otp,
        deviceIdentifier: multiReplacementDevice,
      },
      {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 123),
      },
    );
    if (
      multiReplacementSelection.status !== "MEMBERSHIP_SELECTION_REQUIRED"
    ) {
      assert.fail("Multi-business replacement must require membership selection.");
    }
    const multiReplacementLogin = await selectEmployeeMembership(
      {
        selectionToken: multiReplacementSelection.selectionToken,
        membershipId: fixture.multi.membershipAId,
        deviceIdentifier: multiReplacementDevice,
      },
      {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 124),
      },
    );
    const multiScopeAudits = await prisma.auditLog.findMany({
      where: {
        action: "EMPLOYEE_SESSION_REVOKED",
        entityType: "EmployeeAccount",
        entityId: fixture.multi.accountId,
        summary: "Employee sessions revoked after device replacement",
      },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(
      multiScopeAudits.length,
      2,
      "shared-device replacement must emit one session audit per affected business",
    );
    const multiScopeByBusiness = new Map(
      multiScopeAudits.map((audit) => [
        audit.businessId,
        audit.metadata as {
          membershipId?: string;
          revokedSessionCount?: number;
        } | null,
      ]),
    );
    assert.deepEqual(multiScopeByBusiness.get(fixture.businessA.id), {
      membershipId: fixture.multi.membershipAId,
      replacedDeviceIds: [selectedLogin.context.deviceId],
      revokedSessionCount: 1,
    });
    assert.deepEqual(multiScopeByBusiness.get(fixture.businessB.id), {
      membershipId: fixture.multi.membershipBId,
      replacedDeviceIds: [selectedLogin.context.deviceId],
      revokedSessionCount: 1,
    });
    assert.equal(
      (
        await prisma.employeeSession.findUniqueOrThrow({
          where: { id: multiBusinessASession.context.sessionId },
        })
      ).revokedAt !== null,
      true,
    );

    const workplaces = await getEmployeeWorkplaces(
      multiReplacementLogin.context,
      prisma,
      plusSeconds(baseTime, 125),
    );
    assert.equal(workplaces.length, 2);
    assert.equal(
      workplaces.find((workplace) => workplace.membershipId === fixture.multi.membershipAId)?.current,
      true,
    );
    assert.equal(
      workplaces.find((workplace) => workplace.membershipId === fixture.multi.membershipBId)?.current,
      false,
      "the session must expose only eligible workplaces owned by the same employee account",
    );
    await prisma.employeeBusinessMembership.update({
      where: { id: fixture.multi.membershipBId },
      data: { status: "SUSPENDED" },
    });
    assert.equal(
      (await getEmployeeWorkplaces(
        multiReplacementLogin.context,
        prisma,
        plusSeconds(baseTime, 125),
      )).some((workplace) => workplace.membershipId === fixture.multi.membershipBId),
      false,
      "inactive workplaces must be hidden",
    );
    await assert.rejects(
      switchEmployeeWorkplace(
        {
          auth: multiReplacementLogin.context,
          membershipId: fixture.multi.membershipBId,
        },
        { database: prisma, config, now: plusSeconds(baseTime, 125) },
      ),
      isAuthError("MEMBERSHIP_NOT_AVAILABLE"),
      "inactive workplaces must not be switchable",
    );
    await prisma.employeeBusinessMembership.update({
      where: { id: fixture.multi.membershipBId },
      data: { status: "ACTIVE" },
    });
    await assert.rejects(
      switchEmployeeWorkplace(
        {
          auth: multiReplacementLogin.context,
          membershipId: fixture.single.membershipId,
          request: requestContext("10.2.0.3"),
        },
        { database: prisma, config, now: plusSeconds(baseTime, 126) },
      ),
      isAuthError("MEMBERSHIP_NOT_AVAILABLE"),
      "a session must never switch to another employee account's membership",
    );

    const switchedToB = await switchEmployeeWorkplace(
      {
        auth: multiReplacementLogin.context,
        membershipId: fixture.multi.membershipBId,
        request: requestContext("10.2.0.3"),
      },
      { database: prisma, config, now: plusSeconds(baseTime, 127) },
    );
    assert.equal(switchedToB.context.businessId, fixture.businessB.id);
    assert.equal(switchedToB.context.membershipId, fixture.multi.membershipBId);
    await assert.rejects(
      authenticateEmployeeSessionToken(multiReplacementLogin.token, {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 128),
        requireAttendance: false,
      }),
      isAuthError("SESSION_REVOKED"),
      "switching workplace must revoke the old tenant-scoped session",
    );
    assert.equal(
      (await getEmployeeAuthProfile(switchedToB.context, prisma)).workplace.businessName,
      fixture.businessB.name,
    );

    const switchedBackToA = await switchEmployeeWorkplace(
      {
        auth: switchedToB.context,
        membershipId: fixture.multi.membershipAId,
        request: requestContext("10.2.0.3"),
      },
      { database: prisma, config, now: plusSeconds(baseTime, 129) },
    );
    assert.equal(switchedBackToA.context.businessId, fixture.businessA.id);
    assert.equal(switchedBackToA.context.membershipId, fixture.multi.membershipAId);
    await assert.rejects(
      authenticateEmployeeSessionToken(switchedToB.token, {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 130),
        requireAttendance: false,
      }),
      isAuthError("SESSION_REVOKED"),
    );

    const concurrentSwitches = await Promise.allSettled([
      switchEmployeeWorkplace(
        {
          auth: switchedBackToA.context,
          membershipId: fixture.multi.membershipBId,
          request: requestContext("10.2.0.4"),
        },
        { database: prisma, config, now: plusSeconds(baseTime, 131) },
      ),
      switchEmployeeWorkplace(
        {
          auth: switchedBackToA.context,
          membershipId: fixture.multi.membershipBId,
          request: requestContext("10.2.0.5"),
        },
        { database: prisma, config, now: plusSeconds(baseTime, 131) },
      ),
    ]);
    assert.equal(
      concurrentSwitches.filter((result) => result.status === "fulfilled").length,
      1,
      "concurrent workplace switches must create only one replacement session",
    );
    assert.equal(
      await prisma.employeeSession.count({
        where: {
          employeeAccountId: fixture.multi.accountId,
          employeeDeviceId: switchedBackToA.context.deviceId,
          membershipId: fixture.multi.membershipBId,
          revokedAt: null,
          expiresAt: { gt: plusSeconds(baseTime, 131) },
        },
      }),
      1,
    );

    await clearChallenges(fixture.single.phone);
    const secondDevice = "single-secondary-device-0002";
    const registerSecondDevice = await requestWithCapture({
      phone: fixture.single.phone,
      deviceIdentifier: secondDevice,
      ipAddress: "10.3.0.1",
      now: baseTime,
      config,
    });
    assert.equal(
      registerSecondDevice.provider.sent[0].purpose,
      "REGISTER_DEVICE",
    );
    const secondDeviceLogin = await verifyEmployeeOtp(
      {
        challengeId: registerSecondDevice.result.challengeId,
        otp: registerSecondDevice.provider.sent[0].otp,
        deviceIdentifier: secondDevice,
      },
      {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 1),
      },
    );
    if (secondDeviceLogin.status !== "AUTHENTICATED") {
      assert.fail("Verified replacement device should authenticate.");
    }
    const primaryDeviceHash =
      await findDeviceHash("single-primary-device-0001", config);
    const primaryDevice =
      await prisma.employeeDevice.findUniqueOrThrow({
        where: {
          employeeAccountId_deviceIdentifierHash: {
            employeeAccountId: fixture.single.accountId,
            deviceIdentifierHash: primaryDeviceHash,
          },
        },
      });
    assert.equal(primaryDevice.status, "REPLACED");
    assert.equal(primaryDevice.canView, false);
    assert.equal(primaryDevice.canPunch, false);
    assert.equal(
      await prisma.employeeSession.count({
        where: {
          employeeAccountId: fixture.single.accountId,
          employeeDeviceId: primaryDevice.id,
          revokedAt: { not: null },
        },
      }) > 0,
      true,
    );
    const replacementSessionAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "EMPLOYEE_SESSION_REVOKED",
        entityType: "EmployeeAccount",
        entityId: fixture.single.accountId,
        summary: "Employee sessions revoked after device replacement",
      },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(
      (
        replacementSessionAudit.metadata as {
          revokedSessionCount?: number;
        } | null
      )?.revokedSessionCount,
      1,
      "device replacement audit must use the pre-trigger active session count",
    );

    await clearChallenges(fixture.single.phone);
    const reactivatePrimary = await requestWithCapture({
      phone: fixture.single.phone,
      deviceIdentifier: "single-primary-device-0001",
      ipAddress: "10.3.0.2",
      now: plusSeconds(baseTime, 70),
      config,
    });
    assert.equal(
      reactivatePrimary.provider.sent[0].purpose,
      "REGISTER_DEVICE",
    );
    const reactivatedLogin = await verifyEmployeeOtp(
      {
        challengeId: reactivatePrimary.result.challengeId,
        otp: reactivatePrimary.provider.sent[0].otp,
        deviceIdentifier: "single-primary-device-0001",
      },
      {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 71),
      },
    );
    if (reactivatedLogin.status !== "AUTHENTICATED") {
      assert.fail("REPLACED device should reactivate after REGISTER_DEVICE OTP.");
    }
    dynamicSessionToken = reactivatedLogin.token;
    assert.equal(
      (
        await prisma.employeeDevice.findUniqueOrThrow({
          where: { id: reactivatedLogin.context.deviceId },
        })
      ).status,
      "ACTIVE",
    );

    await authenticateEmployeeSessionToken(dynamicSessionToken, {
      database: prisma,
      config,
      now: plusSeconds(baseTime, 72),
    });
    await prisma.branchAttendanceSetting.update({
      where: { branchId: fixture.branchA.id },
      data: { isEnabled: false },
    });
    await assert.rejects(
      authenticateEmployeeSessionToken(dynamicSessionToken, {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 73),
      }),
      isAuthError("PRIMARY_BRANCH_UNAVAILABLE"),
    );
    await prisma.branchAttendanceSetting.update({
      where: { branchId: fixture.branchA.id },
      data: { isEnabled: true },
    });

    const createDynamicSession = (sessionNow: Date) =>
      prisma.$transaction((transaction) =>
        createEmployeeSessionRecord(
          {
            employeeAccountId: reactivatedLogin.context.employeeAccountId,
            membershipId: reactivatedLogin.context.membershipId,
            businessId: reactivatedLogin.context.businessId,
            primaryBranchId: reactivatedLogin.context.primaryBranchId,
            deviceId: reactivatedLogin.context.deviceId,
            ipAddressHash: null,
            userAgent: "Phase1CDynamicSession/1.0",
            now: sessionNow,
          },
          transaction,
          config,
        ),
      );

    const suspendedSession = await createDynamicSession(
      plusSeconds(baseTime, 74),
    );
    await prisma.employeeBusinessMembership.update({
      where: { id: fixture.single.membershipId },
      data: { status: "SUSPENDED" },
    });
    await assert.rejects(
      authenticateEmployeeSessionToken(suspendedSession.token, {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 75),
      }),
      isAuthError("MEMBERSHIP_INACTIVE"),
    );
    await prisma.employeeBusinessMembership.update({
      where: { id: fixture.single.membershipId },
      data: { status: "ACTIVE" },
    });

    const terminatedSession = await createDynamicSession(
      plusSeconds(baseTime, 76),
    );
    await prisma.employeeBusinessMembership.update({
      where: { id: fixture.single.membershipId },
      data: {
        status: "TERMINATED",
        terminatedAt: new Date(),
      },
    });
    await assert.rejects(
      authenticateEmployeeSessionToken(terminatedSession.token, {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 77),
      }),
      isAuthError("MEMBERSHIP_INACTIVE"),
    );
    await prisma.employeeBusinessMembership.update({
      where: { id: fixture.single.membershipId },
      data: { status: "ACTIVE", terminatedAt: null },
    });

    const attendanceDisabledSession = await createDynamicSession(
      plusSeconds(baseTime, 78),
    );
    await prisma.employeeBusinessMembership.update({
      where: { id: fixture.single.membershipId },
      data: { attendanceEnabled: false },
    });
    await assert.rejects(
      authenticateEmployeeSessionToken(attendanceDisabledSession.token, {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 79),
      }),
      isAuthError("ATTENDANCE_DISABLED"),
    );
    await prisma.employeeBusinessMembership.update({
      where: { id: fixture.single.membershipId },
      data: { attendanceEnabled: true },
    });

    const invalidatedSessionIds = [
      suspendedSession.context.sessionId,
      terminatedSession.context.sessionId,
      attendanceDisabledSession.context.sessionId,
    ];
    assert.equal(
      await prisma.employeeSession.count({
        where: {
          id: { in: invalidatedSessionIds },
          revokedAt: { not: null },
        },
      }),
      invalidatedSessionIds.length,
      "all sessions must be revoked immediately after dynamic membership invalidation",
    );

    await clearChallenges(fixture.single.phone);
    const freshSessionRequest = await requestWithCapture({
      phone: fixture.single.phone,
      deviceIdentifier: "single-primary-device-0001",
      ipAddress: "10.3.0.3",
      now: plusSeconds(baseTime, 90),
      config,
    });
    assert.equal(freshSessionRequest.provider.sent[0].purpose, "LOGIN");
    const freshSessionLogin = await verifyEmployeeOtp(
      {
        challengeId: freshSessionRequest.result.challengeId,
        otp: freshSessionRequest.provider.sent[0].otp,
        deviceIdentifier: "single-primary-device-0001",
      },
      {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 91),
      },
    );
    if (freshSessionLogin.status !== "AUTHENTICATED") {
      assert.fail("Active device should login.");
    }

    const adminDeviceRevoke = await revokeEmployeeDevice(
      {
        businessId: fixture.businessA.id,
        allowedBranchIds: [fixture.branchA.id],
        wholeBusinessScope: true,
        membershipId: fixture.single.membershipId,
        deviceId: freshSessionLogin.context.deviceId,
        reason: "Admin security reset",
        actor: {
          userId: fixture.actor.id,
          name: fixture.actor.name,
          email: fixture.actor.email ?? "",
        },
        now: plusSeconds(baseTime, 92),
      },
      prisma,
    );
    assert.equal(
      adminDeviceRevoke.revokedSessionCount,
      1,
      "administrator revoke must report the pre-trigger active session count",
    );
    assert.equal(
      await prisma.auditLog.count({
        where: {
          businessId: fixture.businessA.id,
          action: "EMPLOYEE_SESSION_REVOKED",
          entityType: "EmployeeDevice",
          entityId: freshSessionLogin.context.deviceId,
        },
      }),
      1,
      "administrator device revoke must emit exact EMPLOYEE_SESSION_REVOKED audit",
    );
    await assert.rejects(
      authenticateEmployeeSessionToken(freshSessionLogin.token, {
        database: prisma,
        config,
        now: plusSeconds(baseTime, 93),
      }),
      isAuthError("SESSION_REVOKED"),
    );
    await clearChallenges(fixture.single.phone);
    const revokedDeviceProvider = new CapturingEmployeeOtpProvider();
    await requestEmployeeOtp(
      {
        phoneNumber: fixture.single.phone,
        deviceIdentifier: "single-primary-device-0001",
        request: requestContext("10.3.0.4"),
      },
      {
        database: prisma,
        config,
        provider: revokedDeviceProvider,
        now: baseTime,
      },
    );
    assert.equal(
      revokedDeviceProvider.sent.length,
      0,
      "a revoked device must not receive self-service OTP",
    );

    const requiredActions = new Set(
      (
        await prisma.auditLog.findMany({
          where: {
            businessId: {
              in: [fixture.businessA.id, fixture.businessB.id],
            },
          },
          select: { action: true },
        })
      ).map((audit) => audit.action),
    );
    for (const action of [
      "EMPLOYEE_OTP_REQUESTED",
      "EMPLOYEE_OTP_VERIFIED",
      "EMPLOYEE_OTP_FAILED",
      "EMPLOYEE_LOGIN",
      "EMPLOYEE_DEVICE_REGISTERED",
      "EMPLOYEE_DEVICE_REVOKED",
      "EMPLOYEE_LOGOUT",
      "EMPLOYEE_SESSION_REVOKED",
    ]) {
      assert.equal(requiredActions.has(action), true, `${action} audit is required`);
    }

    const serializedAudit = JSON.stringify(
      await prisma.auditLog.findMany({
        where: {
          businessId: {
            in: [fixture.businessA.id, fixture.businessB.id],
          },
        },
      }),
    );
    for (const secret of [
      fixture.single.phone,
      fixture.multi.phone,
      "single-primary-device-0001",
      "single-secondary-device-0002",
      attemptsRequest.provider.sent[0].otp,
      "10.1.0.4",
    ]) {
      assert.equal(
        serializedAudit.includes(secret),
        false,
        "Audit must not contain raw phone, OTP, IP, or device identifier",
      );
    }
  } finally {
    await cleanupFixture(fixture);
  }
});

async function exerciseRateLimits(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  now: Date,
) {
  await clearAllFixtureChallenges(fixture);
  const phoneLimited = authConfig({
    EMPLOYEE_OTP_PHONE_HOURLY_LIMIT: "1",
    EMPLOYEE_OTP_IP_HOURLY_LIMIT: "50",
    EMPLOYEE_OTP_DEVICE_HOURLY_LIMIT: "50",
    EMPLOYEE_OTP_PROVIDER_HOURLY_LIMIT: "50",
  });
  const phoneProvider = new CapturingEmployeeOtpProvider();
  await requestEmployeeOtp(
    {
      phoneNumber: fixture.single.phone,
      deviceIdentifier: "rate-phone-device-0001",
      request: requestContext("10.4.0.1"),
    },
    {
      database: prisma,
      config: phoneLimited,
      provider: phoneProvider,
      now,
    },
  );
  await requestEmployeeOtp(
    {
      phoneNumber: fixture.single.phone,
      deviceIdentifier: "rate-phone-device-0001",
      request: requestContext("10.4.0.2"),
    },
    {
      database: prisma,
      config: phoneLimited,
      provider: phoneProvider,
      now: plusSeconds(now, 61),
    },
  );
  assert.equal(phoneProvider.sent.length, 1);

  await clearAllFixtureChallenges(fixture);
  const ipLimited = authConfig({
    EMPLOYEE_OTP_PHONE_HOURLY_LIMIT: "50",
    EMPLOYEE_OTP_IP_HOURLY_LIMIT: "1",
    EMPLOYEE_OTP_DEVICE_HOURLY_LIMIT: "50",
    EMPLOYEE_OTP_PROVIDER_HOURLY_LIMIT: "50",
  });
  const ipProvider = new CapturingEmployeeOtpProvider();
  await requestEmployeeOtp(
    {
      phoneNumber: fixture.single.phone,
      deviceIdentifier: "rate-ip-device-a-0001",
      request: requestContext("10.4.1.1"),
    },
    { database: prisma, config: ipLimited, provider: ipProvider, now },
  );
  await requestEmployeeOtp(
    {
      phoneNumber: fixture.rate.phone,
      deviceIdentifier: "rate-ip-device-b-0001",
      request: requestContext("10.4.1.1"),
    },
    {
      database: prisma,
      config: ipLimited,
      provider: ipProvider,
      now: plusSeconds(now, 61),
    },
  );
  assert.equal(ipProvider.sent.length, 1);

  await clearAllFixtureChallenges(fixture);
  const deviceLimited = authConfig({
    EMPLOYEE_OTP_PHONE_HOURLY_LIMIT: "50",
    EMPLOYEE_OTP_IP_HOURLY_LIMIT: "50",
    EMPLOYEE_OTP_DEVICE_HOURLY_LIMIT: "1",
    EMPLOYEE_OTP_PROVIDER_HOURLY_LIMIT: "50",
  });
  const deviceProvider = new CapturingEmployeeOtpProvider();
  await requestEmployeeOtp(
    {
      phoneNumber: fixture.single.phone,
      deviceIdentifier: "shared-rate-device-0001",
      request: requestContext("10.4.2.1"),
    },
    {
      database: prisma,
      config: deviceLimited,
      provider: deviceProvider,
      now,
    },
  );
  await requestEmployeeOtp(
    {
      phoneNumber: fixture.rate.phone,
      deviceIdentifier: "shared-rate-device-0001",
      request: requestContext("10.4.2.2"),
    },
    {
      database: prisma,
      config: deviceLimited,
      provider: deviceProvider,
      now: plusSeconds(now, 61),
    },
  );
  assert.equal(deviceProvider.sent.length, 1);

  await clearAllFixtureChallenges(fixture);
  const providerLimited = authConfig({
    EMPLOYEE_OTP_PHONE_HOURLY_LIMIT: "50",
    EMPLOYEE_OTP_IP_HOURLY_LIMIT: "50",
    EMPLOYEE_OTP_DEVICE_HOURLY_LIMIT: "50",
    EMPLOYEE_OTP_PROVIDER_HOURLY_LIMIT: "1",
  });
  const globalProvider = new CapturingEmployeeOtpProvider();
  // Provider throttling is intentionally global. Move this assertion into an
  // isolated hour so Local browser QA challenges cannot pollute the fixture.
  const providerNow = plusSeconds(now, 2 * 60 * 60);
  await requestEmployeeOtp(
    {
      phoneNumber: fixture.single.phone,
      deviceIdentifier: "provider-rate-device-a",
      request: requestContext("10.4.3.1"),
    },
    {
      database: prisma,
      config: providerLimited,
      provider: globalProvider,
      now: providerNow,
    },
  );
  await requestEmployeeOtp(
    {
      phoneNumber: fixture.rate.phone,
      deviceIdentifier: "provider-rate-device-b",
      request: requestContext("10.4.3.2"),
    },
    {
      database: prisma,
      config: providerLimited,
      provider: globalProvider,
      now: plusSeconds(providerNow, 61),
    },
  );
  assert.equal(globalProvider.sent.length, 1);
  await clearAllFixtureChallenges(fixture);
}

async function exerciseVerifyRateLimit(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  now: Date,
) {
  await clearChallenges(fixture.rate.phone);
  const config = authConfig({
    STAFF_OTP_VERIFY_PHONE_HOURLY_LIMIT: "1",
    STAFF_OTP_VERIFY_IP_HOURLY_LIMIT: "50",
  });
  const requested = await requestWithCapture({
    phone: fixture.rate.phone,
    deviceIdentifier: "verify-rate-device-0001",
    ipAddress: "10.5.0.1",
    now,
    config,
  });
  const wrongOtp = requested.provider.sent[0].otp === "000000" ? "111111" : "000000";
  await assert.rejects(
    verifyEmployeeOtp(
      {
        challengeId: requested.result.challengeId,
        otp: wrongOtp,
        deviceIdentifier: "verify-rate-device-0001",
        request: requestContext("10.5.0.1"),
      },
      { database: prisma, config, now: plusSeconds(now, 1) },
    ),
    isAuthError("OTP_INVALID"),
  );
  await assert.rejects(
    verifyEmployeeOtp(
      {
        challengeId: requested.result.challengeId,
        otp: wrongOtp,
        deviceIdentifier: "verify-rate-device-0001",
        request: requestContext("10.5.0.2"),
      },
      { database: prisma, config, now: plusSeconds(now, 2) },
    ),
    isAuthError("RATE_LIMITED"),
  );
}

async function requestWithCapture(input: {
  phone: string;
  deviceIdentifier: string;
  ipAddress: string;
  now: Date;
  config: EmployeeAuthConfig;
}) {
  const provider = new CapturingEmployeeOtpProvider();
  const result = await requestEmployeeOtp(
    {
      phoneNumber: input.phone,
      deviceIdentifier: input.deviceIdentifier,
      request: requestContext(input.ipAddress),
    },
    {
      database: prisma,
      config: input.config,
      provider,
      now: input.now,
    },
  );
  return { provider, result };
}

async function createFixture() {
  const token = randomUUID();
  const businessA = await prisma.business.create({
    data: {
      name: `Auth Business A ${token}`,
      slug: `attendance-auth-a-${token}`,
    },
  });
  const businessB = await prisma.business.create({
    data: {
      name: `Auth Business B ${token}`,
      slug: `attendance-auth-b-${token}`,
    },
  });
  const branchA = await prisma.branch.create({
    data: {
      businessId: businessA.id,
      name: `Auth Branch A ${token}`,
    },
  });
  const branchB = await prisma.branch.create({
    data: {
      businessId: businessB.id,
      name: `Auth Branch B ${token}`,
    },
  });
  await prisma.branchAttendanceSetting.createMany({
    data: [
      attendanceSetting(businessA.id, branchA.id),
      attendanceSetting(businessB.id, branchB.id),
    ],
  });
  const actor = await prisma.user.create({
    data: {
      businessId: businessA.id,
      branchId: branchA.id,
      name: "Attendance Auth Owner",
      email: `attendance-auth-owner-${token}@test.local`,
      role: "BUSINESS_OWNER",
    },
  });
  const single = await createEmployeeIdentity({
    phone: randomPhone(),
    name: "Single Employee",
    memberships: [
      {
        businessId: businessA.id,
        branchId: branchA.id,
        employeeCode: `S-${token.slice(0, 8)}`,
      },
    ],
  });
  const rate = await createEmployeeIdentity({
    phone: randomPhone(),
    name: "Rate Employee",
    memberships: [
      {
        businessId: businessA.id,
        branchId: branchA.id,
        employeeCode: `R-${token.slice(0, 8)}`,
      },
    ],
  });
  const multi = await createEmployeeIdentity({
    phone: randomPhone(),
    name: "Multi Employee",
    memberships: [
      {
        businessId: businessA.id,
        branchId: branchA.id,
        employeeCode: `MA-${token.slice(0, 8)}`,
      },
      {
        businessId: businessB.id,
        branchId: branchB.id,
        employeeCode: `MB-${token.slice(0, 8)}`,
      },
    ],
  });

  return {
    businessA,
    businessB,
    branchA,
    branchB,
    actor,
    single: {
      ...single,
      membershipId: single.memberships[0].id,
    },
    rate: {
      ...rate,
      membershipId: rate.memberships[0].id,
    },
    multi: {
      ...multi,
      membershipAId: multi.memberships[0].id,
      membershipBId: multi.memberships[1].id,
    },
  };
}

async function createEmployeeIdentity(input: {
  phone: string;
  name: string;
  memberships: Array<{
    businessId: string;
    branchId: string;
    employeeCode: string;
  }>;
}) {
  const account = await prisma.employeeAccount.create({
    data: {
      phoneNumber: input.phone,
      phoneNormalized: input.phone,
      name: input.name,
      status: "ACTIVE",
    },
  });
  const memberships = [];

  for (const membershipInput of input.memberships) {
    const membership = await prisma.employeeBusinessMembership.create({
      data: {
        employeeAccountId: account.id,
        businessId: membershipInput.businessId,
        employeeCode: membershipInput.employeeCode,
        fullName: input.name,
        phoneNumber: input.phone,
        phoneNumberNormalized: input.phone,
        employmentType: "FULL_TIME",
        status: "ACTIVE",
        attendanceEnabled: false,
        position: "Technician",
      },
    });
    await prisma.employeeBranchAssignment.create({
      data: {
        membershipId: membership.id,
        businessId: membershipInput.businessId,
        branchId: membershipInput.branchId,
        isPrimary: true,
        canClockIn: true,
        effectiveFrom: new Date(Date.now() - 10 * 60_000),
        status: "ACTIVE",
      },
    });
    memberships.push(
      await prisma.employeeBusinessMembership.update({
        where: { id: membership.id },
        data: { attendanceEnabled: true },
      }),
    );
  }

  return {
    accountId: account.id,
    phone: input.phone,
    memberships,
  };
}

async function cleanupFixture(
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  const businessIds = [fixture.businessA.id, fixture.businessB.id];
  const accountIds = [
    fixture.single.accountId,
    fixture.rate.accountId,
    fixture.multi.accountId,
  ];
  await prisma.auditLog.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.employeeSession.deleteMany({
    where: { employeeAccountId: { in: accountIds } },
  });
  await prisma.employeeDevice.deleteMany({
    where: { employeeAccountId: { in: accountIds } },
  });
  await prisma.employeeOtpChallenge.deleteMany({
    where: {
      OR: [
        { employeeAccountId: { in: accountIds } },
        {
          phoneNumberNormalized: {
            in: [
              fixture.single.phone,
              fixture.rate.phone,
              fixture.multi.phone,
            ],
          },
        },
      ],
    },
  });
  await prisma.employeeBusinessMembership.updateMany({
    where: { businessId: { in: businessIds } },
    data: { attendanceEnabled: false },
  });
  await prisma.employeeBranchAssignment.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.employeeBusinessMembership.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.employeeAccount.deleteMany({
    where: { id: { in: accountIds } },
  });
  await prisma.branchAttendanceSetting.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.user.delete({ where: { id: fixture.actor.id } });
  await prisma.branch.deleteMany({
    where: { businessId: { in: businessIds } },
  });
  await prisma.business.deleteMany({
    where: { id: { in: businessIds } },
  });
}

async function clearChallenges(phone: string) {
  await prisma.employeeOtpChallenge.deleteMany({
    where: { phoneNumberNormalized: phone },
  });
}

async function clearAllFixtureChallenges(
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  await prisma.employeeOtpChallenge.deleteMany({
    where: {
      phoneNumberNormalized: {
        in: [
          fixture.single.phone,
          fixture.rate.phone,
          fixture.multi.phone,
        ],
      },
    },
  });
}

function attendanceSetting(businessId: string, branchId: string) {
  return {
    businessId,
    branchId,
    latitude: 1.5,
    longitude: 110.3,
    geofenceRadiusMeters: 100,
    minimumAccuracyMeters: 80,
    requireGeofence: true,
    allowOutsideGeofenceRequest: true,
    requirePhoto: false,
    timezone: "Asia/Kuching",
    isEnabled: true,
  };
}

function requestContext(ipAddress: string) {
  return {
    ipAddress,
    userAgent: "Phase1CIntegration/1.0",
  };
}

function authConfig(
  overrides: Partial<NodeJS.ProcessEnv> = {},
) {
  return getEmployeeAuthConfig({
    NODE_ENV: "test",
    EMPLOYEE_AUTH_SECRET: TEST_SECRET,
    EMPLOYEE_OTP_SEND_MODE: "mock",
    EMPLOYEE_OTP_MOCK_ACCESS_KEY: "phase-1c-integration-mock-key",
    EMPLOYEE_OTP_PHONE_HOURLY_LIMIT: "50",
    EMPLOYEE_OTP_IP_HOURLY_LIMIT: "50",
    EMPLOYEE_OTP_DEVICE_HOURLY_LIMIT: "50",
    EMPLOYEE_OTP_PROVIDER_HOURLY_LIMIT: "1000",
    STAFF_OTP_VERIFY_PHONE_HOURLY_LIMIT: "100",
    STAFF_OTP_VERIFY_IP_HOURLY_LIMIT: "100",
    ...overrides,
  });
}

async function findDeviceHash(
  deviceIdentifier: string,
  config: EmployeeAuthConfig,
) {
  const { hashEmployeeIdentifier } = await import(
    "../../src/lib/attendance/employee-auth/crypto"
  );
  return hashEmployeeIdentifier(
    "device",
    deviceIdentifier,
    config.authSecret,
  );
}

function plusSeconds(value: Date, seconds: number) {
  return new Date(value.getTime() + seconds * 1_000);
}

function isAuthError(code: string) {
  return (error: unknown) =>
    error instanceof EmployeeAuthError && error.code === code;
}

function randomPhone() {
  return `+601${randomInt(10_000_000, 99_999_999)}`;
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for Attendance auth integration tests.",
    );
  }

  const hostname = new URL(databaseUrl).hostname;

  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error(
      "Attendance auth integration tests are restricted to the local database.",
    );
  }
}
