import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import {
  maskAttendancePhone,
  normalizeAttendancePhone,
} from "@/lib/attendance/phone";
import { prisma } from "@/lib/prisma";
import { writeAuthSecurityEvent } from "@/lib/auth/security";
import type { EmployeeAuthConfig } from "./config";
import { getEmployeeAuthConfig } from "./config";
import {
  hashEmployeeIdentifier,
  safeEqual,
} from "./crypto";
import {
  bindVerifiedEmployeeDevice,
  type VerifiedEmployeeDeviceInput,
} from "./device-service";
import { EmployeeAuthError } from "./errors";
import type { EmployeeAuthRequestContext } from "./http";
import {
  findEligibleEmployeeIdentityByPhone,
  findEligibleEmployeeIdentityById,
  resolveEligibleEmployeeMembership,
  type EligibleEmployeeMembership,
} from "./membership";
import type { EmployeeOtpProvider } from "./provider";
import { createEmployeeOtpProvider } from "./provider";
import {
  acquireEmployeeOtpRateLimitLocks,
  acquireEmployeeOtpVerifyRateLimitLocks,
  checkEmployeeOtpRateLimit,
  checkEmployeeOtpVerifyRateLimit,
} from "./rate-limit";
import {
  createEmployeeMembershipSelectionToken,
  verifyEmployeeMembershipSelectionToken,
} from "./selection-token";
import {
  createEmployeeSessionRecord,
  type EmployeeAuthContext,
} from "./session";

export const EMPLOYEE_OTP_REQUEST_MESSAGE =
  "If this phone number is registered, we will send a verification code.";

export type EmployeeMembershipChoice = Readonly<{
  membershipId: string;
  businessName: string;
  employeeCode: string;
  primaryBranchName: string;
}>;

export type RequestEmployeeOtpServiceInput = Readonly<{
  phoneNumber: string;
  deviceIdentifier: string;
  request?: EmployeeAuthRequestContext;
}>;

export type VerifyEmployeeOtpServiceInput = Readonly<{
  challengeId: string;
  otp: string;
  deviceIdentifier: string;
  displayName?: string | null;
  platform?: string | null;
  browser?: string | null;
  request?: EmployeeAuthRequestContext;
}>;

export type SelectEmployeeMembershipServiceInput = Readonly<{
  selectionToken: string;
  membershipId: string;
  deviceIdentifier: string;
  displayName?: string | null;
  platform?: string | null;
  browser?: string | null;
  request?: EmployeeAuthRequestContext;
}>;

export type EmployeeLoginResult =
  | Readonly<{
      status: "AUTHENTICATED";
      token: string;
      expiresAt: Date;
      context: EmployeeAuthContext;
    }>
  | Readonly<{
      status: "MEMBERSHIP_SELECTION_REQUIRED";
      selectionToken: string;
      memberships: readonly EmployeeMembershipChoice[];
    }>;

type EmployeeAuthServiceDependencies = Readonly<{
  database?: PrismaClient;
  config?: EmployeeAuthConfig;
  provider?: EmployeeOtpProvider;
  now?: Date;
  requireAttendance?: boolean;
}>;

export async function requestEmployeeOtp(
  input: RequestEmployeeOtpServiceInput,
  dependencies: EmployeeAuthServiceDependencies = {},
) {
  const database = dependencies.database ?? prisma;
  const config = dependencies.config ?? getEmployeeAuthConfig();
  const now = dependencies.now ?? new Date();
  const deviceFingerprintHash = hashEmployeeIdentifier(
    "device-fingerprint",
    input.deviceIdentifier,
    config.authSecret,
  );
  const ipAddressHash = input.request?.ipAddress
    ? hashEmployeeIdentifier(
        "ip",
        input.request.ipAddress,
        config.authSecret,
      )
    : null;
  const phoneNumberNormalized = normalizeAttendancePhone(input.phoneNumber);

  if (!phoneNumberNormalized) {
    return uniformOtpRequestResult(
      randomUUID(),
      config.otp.expiresInSeconds,
      config.otp.resendCooldownSeconds,
    );
  }

  const phoneIdentifierHash = hashEmployeeIdentifier(
    "phone",
    phoneNumberNormalized,
    config.authSecret,
  );
  const challengeId = randomUUID();
  const expiresAt = new Date(
    now.getTime() + config.otp.expiresInSeconds * 1_000,
  );
  const resendAvailableAt = new Date(
    now.getTime() + config.otp.resendCooldownSeconds * 1_000,
  );

  const creation = await database.$transaction(async (transaction) => {
    await acquireEmployeeOtpRateLimitLocks(
      {
        phoneIdentifierHash,
        ipAddressHash,
        deviceFingerprintHash,
      },
      transaction,
    );
    const identity = await findEligibleEmployeeIdentityByPhone(
      phoneNumberNormalized,
      now,
      transaction,
      dependencies.requireAttendance ?? true,
    );
    const deviceAccess = identity
      ? await resolveOtpDeviceAccess(
          identity.employeeAccountId,
          input.deviceIdentifier,
          config,
          transaction,
        )
      : {
          purpose: "LOGIN" as const,
          deliveryAllowed: false,
        };
    const rateLimit = await checkEmployeeOtpRateLimit(
      {
        phoneNumberNormalized,
        phoneIdentifierHash,
        ipAddressHash,
        deviceFingerprintHash,
        purpose: deviceAccess.purpose,
        now,
      },
      config,
      transaction,
    );

    if (!rateLimit.requestAllowed) {
      const userAgentHash = input.request?.userAgent
        ? hashEmployeeIdentifier(
            "user-agent",
            input.request.userAgent,
            config.authSecret,
          )
        : null;
      await writeAuthSecurityEvent(
        {
          eventType: "OTP_RATE_LIMITED",
          surface: "EMPLOYEE_OTP_REQUEST",
          outcome: "RATE_LIMITED",
          identifierHash: phoneIdentifierHash,
          ipAddressHash,
          userAgentHash,
          reason: rateLimit.reasons.join("+"),
          createdAt: now,
        },
        transaction,
      );
      return {
        created: false as const,
        identity: null,
        purpose: deviceAccess.purpose,
        shouldDeliver: false,
        cooldownChallenge: rateLimit.cooldownChallenge,
      };
    }

    const shouldDeliver =
      Boolean(identity) &&
      deviceAccess.deliveryAllowed &&
      rateLimit.providerAllowed;

    await transaction.employeeOtpChallenge.updateMany({
      where: buildEmployeeOtpChallengeInvalidationWhere({
        phoneNumberNormalized,
        deviceFingerprintHash,
        developmentFastPath: config.otp.developmentFastPath,
      }),
      data: { invalidatedAt: now },
    });

    await transaction.employeeOtpChallenge.create({
      data: {
        id: challengeId,
        createdAt: now,
        employeeAccountId: shouldDeliver
          ? identity?.employeeAccountId
          : null,
        phoneNumberNormalized,
        purpose: deviceAccess.purpose,
        otpHash: null,
        provider: config.otp.provider,
        deliveryChannel: config.otp.channel,
        expiresAt,
        attempts: 0,
        maxAttempts: config.otp.maxAttempts,
        resendAvailableAt,
        ipAddressHash,
        deviceFingerprintHash,
      },
    });
    await writeAuthSecurityEvent(
      {
        eventType: "STAFF_OTP_REQUESTED",
        surface: "EMPLOYEE_OTP_REQUEST",
        outcome: shouldDeliver ? "SUCCESS" : "DENIED",
        identifierHash: phoneIdentifierHash,
        ipAddressHash,
        userId: shouldDeliver ? identity?.employeeAccountId ?? null : null,
        createdAt: now,
      },
      transaction,
    );

    return {
      created: true as const,
      identity,
      purpose: deviceAccess.purpose,
      shouldDeliver,
      cooldownChallenge: null,
    };
  });

  if (!creation.created) {
    return creation.cooldownChallenge
      ? uniformOtpRequestResult(
          creation.cooldownChallenge.id,
          secondsUntil(creation.cooldownChallenge.expiresAt, now),
          secondsUntil(creation.cooldownChallenge.resendAvailableAt, now),
        )
      : uniformOtpRequestResult(
          challengeId,
          config.otp.expiresInSeconds,
          config.otp.resendCooldownSeconds,
        );
  }

  if (!creation.shouldDeliver || !creation.identity) {
    return uniformOtpRequestResult(
      challengeId,
      config.otp.expiresInSeconds,
      config.otp.resendCooldownSeconds,
    );
  }

  const deliveryIdentity = creation.identity;
  try {
    const provider = dependencies.provider ?? createEmployeeOtpProvider(config);
    const accepted = await provider.sendVerification({
      challengeId,
      phoneNumber: phoneNumberNormalized,
      purpose: creation.purpose,
      expiresAt,
      locale: config.otp.locale,
    });
    const deliveryAcceptedAt = now;
    await database.employeeOtpChallenge.updateMany({
      where: {
        id: challengeId,
        invalidatedAt: null,
        providerReference: null,
      },
      data: {
        providerReference: accepted.providerReference,
        deliveryAcceptedAt,
      },
    });
    await writeOtpAuditForBusinessIds(
      deliveryIdentity.memberships.map((membership) => membership.businessId),
      deliveryIdentity.employeeAccountId,
      challengeId,
      "STAFF_OTP_SEND_ACCEPTED",
      "Staff login verification delivery accepted",
      {
        purpose: creation.purpose,
        provider: provider.name,
        channel: provider.channel,
        phoneMasked: maskAttendancePhone(phoneNumberNormalized),
      },
      input.request?.userAgent ?? null,
      database,
    );
    await writeOtpAuditForBusinessIds(
      deliveryIdentity.memberships.map((membership) => membership.businessId),
      deliveryIdentity.employeeAccountId,
      challengeId,
      "EMPLOYEE_OTP_REQUESTED",
      "Employee login verification code requested",
      {
        purpose: creation.purpose,
        provider: provider.name,
        channel: provider.channel,
        phoneMasked: maskAttendancePhone(phoneNumberNormalized),
        deliveryAccepted: true,
      },
      input.request?.userAgent ?? null,
      database,
    );
  } catch (error) {
    const failedAt = now;
    const invalidated = await database.employeeOtpChallenge.updateMany({
      where: { id: challengeId, invalidatedAt: null },
      data: { invalidatedAt: failedAt },
    });
    console.error("[employee-auth] OTP delivery failed", {
      challengeId,
      provider: config.otp.provider,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    if (invalidated.count === 1) {
      await writeOtpAuditForBusinessIds(
        deliveryIdentity.memberships.map((membership) => membership.businessId),
        deliveryIdentity.employeeAccountId,
        challengeId,
        "STAFF_OTP_SEND_FAILED",
        "Staff login verification delivery failed",
        { provider: config.otp.provider, channel: config.otp.channel },
        input.request?.userAgent ?? null,
        database,
      );
    }
  }

  return uniformOtpRequestResult(
    challengeId,
    config.otp.expiresInSeconds,
    config.otp.resendCooldownSeconds,
  );
}

export function buildEmployeeOtpChallengeInvalidationWhere(input: {
  phoneNumberNormalized: string;
  deviceFingerprintHash: string;
  developmentFastPath: boolean;
}): Prisma.EmployeeOtpChallengeWhereInput {
  return {
    phoneNumberNormalized: input.phoneNumberNormalized,
    purpose: { in: ["LOGIN", "REGISTER_DEVICE"] },
    invalidatedAt: null,
    ...(input.developmentFastPath
      ? { deviceFingerprintHash: input.deviceFingerprintHash }
      : {}),
  };
}

export async function verifyEmployeeOtp(
  input: VerifyEmployeeOtpServiceInput,
  dependencies: EmployeeAuthServiceDependencies = {},
): Promise<EmployeeLoginResult> {
  const database = dependencies.database ?? prisma;
  const config = dependencies.config ?? getEmployeeAuthConfig();
  const now = dependencies.now ?? new Date();
  const deviceFingerprintHash = hashEmployeeIdentifier(
    "device-fingerprint",
    input.deviceIdentifier,
    config.authSecret,
  );
  const verificationIpHash = input.request?.ipAddress
    ? hashEmployeeIdentifier("ip", input.request.ipAddress, config.authSecret)
    : null;
  const verificationUserAgentHash = input.request?.userAgent
    ? hashEmployeeIdentifier(
        "user-agent",
        input.request.userAgent,
        config.authSecret,
      )
    : null;
  const verificationAttemptId = randomUUID();
  const verification = await database.$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT id FROM employee_otp_challenges WHERE id::text = ${input.challengeId} FOR UPDATE`,
    );
    const record = await transaction.employeeOtpChallenge.findUnique({
      where: { id: input.challengeId },
      select: {
        id: true,
        employeeAccountId: true,
        phoneNumberNormalized: true,
        purpose: true,
        provider: true,
        providerReference: true,
        deliveryAcceptedAt: true,
        expiresAt: true,
        attempts: true,
        maxAttempts: true,
        verifiedAt: true,
        invalidatedAt: true,
        deviceFingerprintHash: true,
        verificationAttemptId: true,
        verificationStartedAt: true,
      },
    });
    const phoneIdentifierHash = record
      ? hashEmployeeIdentifier(
          "phone",
          record.phoneNumberNormalized,
          config.authSecret,
        )
      : hashEmployeeIdentifier("phone", input.challengeId, config.authSecret);

    await acquireEmployeeOtpVerifyRateLimitLocks(
      { phoneIdentifierHash, ipAddressHash: verificationIpHash },
      transaction,
    );
    const rateLimit = await checkEmployeeOtpVerifyRateLimit(
      { phoneIdentifierHash, ipAddressHash: verificationIpHash, now },
      config,
      transaction,
    );
    const staleClaimBefore = new Date(now.getTime() - 30_000);
    const usable =
      rateLimit.allowed &&
      record !== null &&
      record.employeeAccountId !== null &&
      (record.purpose === "LOGIN" || record.purpose === "REGISTER_DEVICE") &&
      record.provider === config.otp.provider &&
      record.providerReference !== null &&
      record.deliveryAcceptedAt !== null &&
      record.verifiedAt === null &&
      record.invalidatedAt === null &&
      record.expiresAt.getTime() > now.getTime() &&
      record.attempts < record.maxAttempts &&
      record.deviceFingerprintHash !== null &&
      safeEqual(record.deviceFingerprintHash, deviceFingerprintHash) &&
      (record.verificationAttemptId === null ||
        (record.verificationStartedAt !== null &&
          record.verificationStartedAt.getTime() <= staleClaimBefore.getTime()));

    if (!usable || !record || !record.employeeAccountId || !record.providerReference) {
      const terminalFailure = record
        ? record.expiresAt.getTime() <= now.getTime()
          ? "EXPIRED"
          : record.attempts >= record.maxAttempts
            ? "MAX_ATTEMPTS"
            : null
        : null;
      if (
        terminalFailure &&
        record &&
        record.invalidatedAt === null &&
        record.verifiedAt === null
      ) {
        await transaction.employeeOtpChallenge.updateMany({
          where: {
            id: record.id,
            invalidatedAt: null,
            verifiedAt: null,
          },
          data: { invalidatedAt: now },
        });
      }
      await writeAuthSecurityEvent(
        {
          eventType: rateLimit.allowed ? "STAFF_OTP_VERIFY_FAILED" : "STAFF_OTP_VERIFY_RATE_LIMITED",
          surface: "EMPLOYEE_OTP_VERIFY",
          outcome: rateLimit.allowed ? "FAILURE" : "RATE_LIMITED",
          identifierHash: phoneIdentifierHash,
          ipAddressHash: verificationIpHash,
          userAgentHash: verificationUserAgentHash,
          userId: record?.employeeAccountId ?? null,
          reason: rateLimit.allowed
            ? terminalFailure ?? "UNUSABLE_CHALLENGE"
            : "VERIFY_RATE_LIMIT",
          createdAt: now,
        },
        transaction,
      );
      return { ok: false as const, rateLimited: !rateLimit.allowed };
    }

    const claimed = await transaction.employeeOtpChallenge.updateMany({
      where: {
        id: record.id,
        verifiedAt: null,
        invalidatedAt: null,
        expiresAt: { gt: now },
        OR: [
          { verificationAttemptId: null },
          { verificationStartedAt: { lte: staleClaimBefore } },
        ],
      },
      data: { verificationAttemptId, verificationStartedAt: now },
    });
    if (claimed.count !== 1) {
      return { ok: false as const, rateLimited: false };
    }
    return {
      ok: true as const,
      record: {
        id: record.id,
        employeeAccountId: record.employeeAccountId,
        phoneNumberNormalized: record.phoneNumberNormalized,
        providerReference: record.providerReference,
        attempts: record.attempts,
        maxAttempts: record.maxAttempts,
        phoneIdentifierHash,
      },
    };
  });

  if (!verification.ok) {
    throw new EmployeeAuthError(verification.rateLimited ? "RATE_LIMITED" : "OTP_INVALID");
  }

  const provider = dependencies.provider ?? createEmployeeOtpProvider(config);
  let providerCheck;
  try {
    providerCheck = await provider.checkVerification({
      challengeId: verification.record.id,
      phoneNumber: verification.record.phoneNumberNormalized,
      providerReference: verification.record.providerReference,
      code: input.otp,
    });
  } catch (error) {
    await database.employeeOtpChallenge.updateMany({
      where: {
        id: verification.record.id,
        verificationAttemptId,
        verifiedAt: null,
        invalidatedAt: null,
      },
      data: { verificationAttemptId: null, verificationStartedAt: null },
    });
    console.error("[employee-auth] OTP verification provider failed", {
      challengeId: verification.record.id,
      provider: provider.name,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw new EmployeeAuthError("OTP_PROVIDER_UNAVAILABLE");
  }

  if (providerCheck.status !== "APPROVED") {
    const terminalFailure = await database.$transaction(async (transaction) => {
      const keepDevelopmentChallenge =
        config.otp.developmentFastPath && providerCheck.status === "REJECTED";
      const nextAttempts = keepDevelopmentChallenge
        ? verification.record.attempts
        : verification.record.attempts + 1;
      const terminal =
        keepDevelopmentChallenge
          ? null
          : providerCheck.status === "EXPIRED"
            ? "EXPIRED"
            : providerCheck.status === "LOCKED" ||
              nextAttempts >= verification.record.maxAttempts
            ? "MAX_ATTEMPTS"
            : null;
      await transaction.employeeOtpChallenge.updateMany({
        where: {
          id: verification.record.id,
          verificationAttemptId,
          verifiedAt: null,
          invalidatedAt: null,
        },
        data: {
          ...(keepDevelopmentChallenge
            ? {}
            : { attempts: { increment: 1 } }),
          verificationAttemptId: null,
          verificationStartedAt: null,
          ...(terminal ? { invalidatedAt: now } : {}),
        },
      });
      await writeAuthSecurityEvent(
        {
          eventType: "STAFF_OTP_VERIFY_FAILED",
          surface: "EMPLOYEE_OTP_VERIFY",
          outcome: "FAILURE",
          identifierHash: verification.record.phoneIdentifierHash,
          ipAddressHash: verificationIpHash,
          userAgentHash: verificationUserAgentHash,
          userId: verification.record.employeeAccountId,
          reason: terminal ?? "INVALID_OTP",
          createdAt: now,
        },
        transaction,
      );
      if (terminal) {
        await writeOtpFailureAudits(
          verification.record.employeeAccountId,
          verification.record.id,
          terminal,
          input.request?.userAgent ?? null,
          transaction,
        );
      }
      return terminal;
    });
    throw new EmployeeAuthError(
      terminalFailure === "EXPIRED"
        ? "OTP_EXPIRED"
        : terminalFailure === "MAX_ATTEMPTS"
          ? "OTP_LOCKED"
          : "OTP_INVALID",
    );
  }

  const approved = await database.$transaction(async (transaction) => {
    const updated = await transaction.employeeOtpChallenge.updateMany({
      where: {
        id: verification.record.id,
        verificationAttemptId,
        verifiedAt: null,
        invalidatedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        verifiedAt: now,
        verificationAttemptId: null,
        verificationStartedAt: null,
      },
    });
    await writeAuthSecurityEvent(
      {
        eventType: updated.count === 1 ? "STAFF_OTP_VERIFY_SUCCEEDED" : "STAFF_OTP_VERIFY_FAILED",
        surface: "EMPLOYEE_OTP_VERIFY",
        outcome: updated.count === 1 ? "SUCCESS" : "FAILURE",
        identifierHash: verification.record.phoneIdentifierHash,
        ipAddressHash: verificationIpHash,
        userAgentHash: verificationUserAgentHash,
        userId: verification.record.employeeAccountId,
        reason: updated.count === 1 ? undefined : "CONCURRENT_REPLAY",
        createdAt: now,
      },
      transaction,
    );
    return updated.count === 1;
  });
  if (!approved) throw new EmployeeAuthError("OTP_INVALID");

  const verificationResult = {
    challenge: {
      id: verification.record.id,
      employeeAccountId: verification.record.employeeAccountId,
      deviceFingerprintHash,
    },
  };

  const challenge = verificationResult.challenge;

  const identity = await findEligibleEmployeeIdentityById(
    challenge.employeeAccountId,
    now,
    database,
    dependencies.requireAttendance ?? true,
  );

  if (!identity) {
    await database.employeeOtpChallenge.updateMany({
      where: {
        id: challenge.id,
        invalidatedAt: null,
      },
      data: { invalidatedAt: now },
    });
    await writeAuthSecurityEvent({
      eventType: "STAFF_LOGIN_REJECTED",
      surface: "EMPLOYEE_OTP_VERIFY",
      outcome: "DENIED",
      ipAddressHash: verificationIpHash,
      userAgentHash: verificationUserAgentHash,
      userId: challenge.employeeAccountId,
      reason: "EMPLOYEE_INELIGIBLE_AT_VERIFY",
      createdAt: now,
    });
    throw new EmployeeAuthError("OTP_INVALID");
  }

  if (identity.memberships.length > 1) {
    return {
      status: "MEMBERSHIP_SELECTION_REQUIRED",
      selectionToken: await createEmployeeMembershipSelectionToken(
        {
          challengeId: challenge.id,
          employeeAccountId: challenge.employeeAccountId,
          deviceFingerprintHash,
        },
        config,
      ),
      memberships: identity.memberships.map(toMembershipChoice),
    };
  }

  return completeEmployeeLogin(
    {
      challengeId: challenge.id,
      employeeAccountId: challenge.employeeAccountId,
      membershipId: identity.memberships[0].membershipId,
      deviceIdentifier: input.deviceIdentifier,
      deviceFingerprintHash,
      displayName: input.displayName,
      platform: input.platform,
      browser: input.browser,
      request: input.request,
      now,
    },
    {
      database,
      config,
      requireAttendance: dependencies.requireAttendance ?? true,
    },
  );
}

export async function selectEmployeeMembership(
  input: SelectEmployeeMembershipServiceInput,
  dependencies: Omit<EmployeeAuthServiceDependencies, "provider"> = {},
): Promise<Extract<EmployeeLoginResult, { status: "AUTHENTICATED" }>> {
  const database = dependencies.database ?? prisma;
  const config = dependencies.config ?? getEmployeeAuthConfig();
  const now = dependencies.now ?? new Date();
  const claims = await verifyEmployeeMembershipSelectionToken(
    input.selectionToken,
    config,
  );
  const deviceFingerprintHash = hashEmployeeIdentifier(
    "device-fingerprint",
    input.deviceIdentifier,
    config.authSecret,
  );

  if (
    !safeEqual(
      deviceFingerprintHash,
      claims.deviceFingerprintHash,
    )
  ) {
    throw new EmployeeAuthError("OTP_INVALID");
  }

  return completeEmployeeLogin(
    {
      challengeId: claims.challengeId,
      employeeAccountId: claims.employeeAccountId,
      membershipId: input.membershipId,
      deviceIdentifier: input.deviceIdentifier,
      deviceFingerprintHash,
      displayName: input.displayName,
      platform: input.platform,
      browser: input.browser,
      request: input.request,
      now,
    },
    {
      database,
      config,
      requireAttendance: dependencies.requireAttendance ?? true,
    },
  );
}

type CompleteEmployeeLoginInput = Readonly<{
  challengeId: string;
  employeeAccountId: string;
  membershipId: string;
  deviceIdentifier: string;
  deviceFingerprintHash: string;
  displayName?: string | null;
  platform?: string | null;
  browser?: string | null;
  request?: EmployeeAuthRequestContext;
  now: Date;
}>;

async function completeEmployeeLogin(
  input: CompleteEmployeeLoginInput,
  dependencies: {
    database: PrismaClient;
    config: EmployeeAuthConfig;
    requireAttendance: boolean;
  },
): Promise<Extract<EmployeeLoginResult, { status: "AUTHENTICATED" }>> {
  const deviceIdentifierHash = hashEmployeeIdentifier(
    "device",
    input.deviceIdentifier,
    dependencies.config.authSecret,
  );
  const ipAddressHash = input.request?.ipAddress
    ? hashEmployeeIdentifier(
        "ip",
        input.request.ipAddress,
        dependencies.config.authSecret,
      )
    : null;

  return dependencies.database.$transaction(async (transaction) => {
    const challenge = await transaction.employeeOtpChallenge.findFirst({
      where: {
        id: input.challengeId,
        employeeAccountId: input.employeeAccountId,
        purpose: { in: ["LOGIN", "REGISTER_DEVICE"] },
        verifiedAt: { not: null },
        invalidatedAt: null,
        expiresAt: { gt: input.now },
        deviceFingerprintHash: input.deviceFingerprintHash,
      },
      select: {
        id: true,
        purpose: true,
      },
    });

    if (!challenge) {
      throw new EmployeeAuthError("OTP_INVALID");
    }

    const membership = await resolveEligibleEmployeeMembership(
      input.employeeAccountId,
      input.membershipId,
      input.now,
      transaction,
      dependencies.requireAttendance,
    );

    if (!membership) {
      throw new EmployeeAuthError("MEMBERSHIP_NOT_AVAILABLE");
    }

    const consumed = await transaction.employeeOtpChallenge.updateMany({
      where: {
        id: challenge.id,
        employeeAccountId: input.employeeAccountId,
        verifiedAt: { not: null },
        invalidatedAt: null,
        expiresAt: { gt: input.now },
      },
      data: { invalidatedAt: input.now },
    });

    if (consumed.count !== 1) {
      throw new EmployeeAuthError("OTP_INVALID");
    }

    const deviceInput: VerifiedEmployeeDeviceInput = {
      employeeAccountId: input.employeeAccountId,
      deviceIdentifierHash,
      displayName: input.displayName,
      platform: input.platform,
      browser: input.browser,
      now: input.now,
      purpose: challenge.purpose,
    };
    const device = await bindVerifiedEmployeeDevice(
      deviceInput,
      transaction,
      dependencies.config,
    );

    if (!device.canView) {
      throw new EmployeeAuthError("DEVICE_NOT_ALLOWED");
    }

    const createdSession = await createEmployeeSessionRecord(
      {
        employeeAccountId: membership.employeeAccountId,
        membershipId: membership.membershipId,
        businessId: membership.businessId,
        primaryBranchId: membership.primaryBranchId,
        deviceId: device.deviceId,
        ipAddressHash,
        userAgent: input.request?.userAgent ?? null,
        now: input.now,
      },
      transaction,
      dependencies.config,
    );

    await writeAuditLog(
      {
        businessId: membership.businessId,
        branchId: membership.primaryBranchId,
        action: "EMPLOYEE_OTP_VERIFIED",
        entityType: "EmployeeAccount",
        entityId: membership.employeeAccountId,
        summary: "Employee login verification code accepted",
        metadata: {
          membershipId: membership.membershipId,
          sessionId: createdSession.context.sessionId,
          deviceId: device.deviceId,
        },
        request: {
          ipAddress: null,
          userAgent: input.request?.userAgent ?? null,
        },
      },
      transaction,
    );

    if (device.registered || device.replacedDeviceIds.length > 0) {
      await writeAuditLog(
        {
          businessId: membership.businessId,
          branchId: membership.primaryBranchId,
          action: "EMPLOYEE_DEVICE_REGISTERED",
          entityType: "EmployeeDevice",
          entityId: device.deviceId,
          summary: device.replacedDeviceIds.length
            ? "Employee attendance device replaced"
            : "Employee attendance device registered",
          metadata: {
            membershipId: membership.membershipId,
            replacedDeviceIds: device.replacedDeviceIds,
          },
          request: {
            ipAddress: null,
            userAgent: input.request?.userAgent ?? null,
          },
        },
        transaction,
      );
    }

    for (const revokedScope of device.revokedSessionScopes) {
      await writeAuditLog(
        {
          businessId: revokedScope.businessId,
          branchId:
            revokedScope.businessId === membership.businessId
              ? membership.primaryBranchId
              : null,
          action: "EMPLOYEE_SESSION_REVOKED",
          entityType: "EmployeeAccount",
          entityId: membership.employeeAccountId,
          summary: "Employee sessions revoked after device replacement",
          metadata: {
            membershipId: revokedScope.membershipId,
            replacedDeviceIds: device.replacedDeviceIds,
            revokedSessionCount: revokedScope.revokedSessionCount,
          },
          request: {
            ipAddress: null,
            userAgent: input.request?.userAgent ?? null,
          },
        },
        transaction,
      );
    }

    await writeAuditLog(
      {
        businessId: membership.businessId,
        branchId: membership.primaryBranchId,
        action: "EMPLOYEE_LOGIN",
        entityType: "EmployeeSession",
        entityId: createdSession.context.sessionId,
        summary: "Employee logged in",
        metadata: {
          membershipId: membership.membershipId,
          deviceId: device.deviceId,
        },
        request: {
          ipAddress: null,
          userAgent: input.request?.userAgent ?? null,
        },
      },
      transaction,
    );

    await writeAuthSecurityEvent(
      {
        eventType: "STAFF_LOGIN_SUCCEEDED",
        surface: "EMPLOYEE_OTP_VERIFY",
        outcome: "SUCCESS",
        ipAddressHash,
        userId: membership.employeeAccountId,
        businessId: membership.businessId,
        sessionId: createdSession.context.sessionId,
        createdAt: input.now,
      },
      transaction,
    );

    return {
      status: "AUTHENTICATED",
      token: createdSession.token,
      expiresAt: createdSession.expiresAt,
      context: createdSession.context,
    };
  });
}

function uniformOtpRequestResult(
  challengeId: string,
  expiresInSeconds: number,
  resendAfterSeconds: number,
) {
  return {
    challengeId,
    message: EMPLOYEE_OTP_REQUEST_MESSAGE,
    expiresInSeconds,
    resendAfterSeconds,
  };
}

function secondsUntil(value: Date, now: Date) {
  return Math.max(0, Math.ceil((value.getTime() - now.getTime()) / 1_000));
}

async function resolveOtpDeviceAccess(
  employeeAccountId: string,
  deviceIdentifier: string,
  config: EmployeeAuthConfig,
  database:
    | Pick<PrismaClient, "employeeDevice">
    | Pick<Prisma.TransactionClient, "employeeDevice">,
) {
  const deviceIdentifierHash = hashEmployeeIdentifier(
    "device",
    deviceIdentifier,
    config.authSecret,
  );
  const [existing, activeDeviceCount] = await Promise.all([
    database.employeeDevice.findUnique({
      where: {
        employeeAccountId_deviceIdentifierHash: {
          employeeAccountId,
          deviceIdentifierHash,
        },
      },
      select: {
        status: true,
        canView: true,
      },
    }),
    database.employeeDevice.count({
      where: {
        employeeAccountId,
        status: "ACTIVE",
      },
    }),
  ]);

  if (
    existing?.status === "REVOKED" ||
    (existing?.status === "ACTIVE" && existing.canView === false)
  ) {
    return {
      purpose: "REGISTER_DEVICE" as const,
      deliveryAllowed: false,
    };
  }

  if (
    existing?.status === "REPLACED" ||
    (activeDeviceCount > 0 && !existing)
  ) {
    return {
      purpose: "REGISTER_DEVICE" as const,
      deliveryAllowed: true,
    };
  }

  return {
    purpose: "LOGIN" as const,
    deliveryAllowed: true,
  };
}

function toMembershipChoice(
  membership: EligibleEmployeeMembership,
): EmployeeMembershipChoice {
  return {
    membershipId: membership.membershipId,
    businessName: membership.businessName,
    employeeCode: membership.employeeCode,
    primaryBranchName: membership.primaryBranchName,
  };
}

async function writeOtpFailureAudits(
  employeeAccountId: string,
  challengeId: string,
  reason: "EXPIRED" | "MAX_ATTEMPTS",
  userAgent: string | null,
  transaction: Prisma.TransactionClient,
) {
  const memberships =
    await transaction.employeeBusinessMembership.findMany({
      where: { employeeAccountId },
      select: { businessId: true },
    });

  await writeOtpAuditForBusinessIds(
    memberships.map((membership) => membership.businessId),
    employeeAccountId,
    challengeId,
    "EMPLOYEE_OTP_FAILED",
    "Employee login verification failed",
    { reason },
    userAgent,
    transaction,
  );
}

async function writeOtpAuditForBusinessIds(
  businessIds: readonly string[],
  employeeAccountId: string,
  challengeId: string,
  action: string,
  summary: string,
  metadata: Record<string, unknown>,
  userAgent: string | null,
  database:
    | Pick<PrismaClient, "auditLog">
    | Pick<Prisma.TransactionClient, "auditLog">,
) {
  await Promise.all(
    [...new Set(businessIds)].map((businessId) =>
      writeAuditLog(
        {
          businessId,
          action,
          entityType: "EmployeeOtpChallenge",
          entityId: challengeId,
          summary,
          metadata: {
            employeeAccountId,
            ...metadata,
          },
          request: {
            ipAddress: null,
            userAgent,
          },
        },
        database,
      ),
    ),
  );
}
