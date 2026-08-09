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
  createEmployeeOtp,
  hashEmployeeIdentifier,
  hashEmployeeOtp,
  safeEqual,
  verifyEmployeeOtpHash,
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
  checkEmployeeOtpRateLimit,
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

export type EmployeeOtpDeliveryTask = () => Promise<void>;

type EmployeeAuthServiceDependencies = Readonly<{
  database?: PrismaClient;
  config?: EmployeeAuthConfig;
  provider?: EmployeeOtpProvider;
  now?: Date;
  dispatchDelivery?: (task: EmployeeOtpDeliveryTask) => void;
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
    return uniformOtpRequestResult(randomUUID());
  }

  const phoneIdentifierHash = hashEmployeeIdentifier(
    "phone",
    phoneNumberNormalized,
    config.authSecret,
  );
  const challengeId = randomUUID();
  const otp = config.otp.mockCode ?? createEmployeeOtp();
  const expiresAt = new Date(
    now.getTime() + config.otp.expiresInSeconds * 1_000,
  );
  const resendAvailableAt = new Date(
    now.getTime() + config.otp.resendCooldownSeconds * 1_000,
  );
  const otpHash = hashEmployeeOtp(
    challengeId,
    otp,
    config.authSecret,
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
      };
    }

    const shouldDeliver =
      Boolean(identity) &&
      deviceAccess.deliveryAllowed &&
      rateLimit.providerAllowed;

    await transaction.employeeOtpChallenge.updateMany({
      where: {
        phoneNumberNormalized,
        purpose: { in: ["LOGIN", "REGISTER_DEVICE"] },
        invalidatedAt: null,
      },
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
        otpHash,
        expiresAt,
        attempts: 0,
        maxAttempts: config.otp.maxAttempts,
        resendAvailableAt,
        ipAddressHash,
        deviceFingerprintHash,
      },
    });

    return {
      created: true as const,
      identity,
      purpose: deviceAccess.purpose,
      shouldDeliver,
    };
  });

  if (!creation.created) {
    return uniformOtpRequestResult(challengeId);
  }

  if (!creation.shouldDeliver || !creation.identity) {
    return uniformOtpRequestResult(challengeId);
  }

  const deliveryIdentity = creation.identity;

  const deliveryTask: EmployeeOtpDeliveryTask = async () => {
    try {
      const provider =
        dependencies.provider ?? createEmployeeOtpProvider(config);
      await provider.sendOtp({
        challengeId,
        phoneNumber: phoneNumberNormalized,
        otp,
        purpose: creation.purpose,
        expiresAt,
        locale: config.otp.locale,
      });
    } catch (error) {
      const invalidated = await database.employeeOtpChallenge.updateMany({
        where: {
          id: challengeId,
          invalidatedAt: null,
        },
        data: { invalidatedAt: now },
      });
      console.error("[employee-auth] OTP delivery failed", {
        challengeId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });

      if (invalidated.count === 1) {
        await writeOtpAuditForBusinessIds(
          deliveryIdentity.memberships.map(
            (membership) => membership.businessId,
          ),
          deliveryIdentity.employeeAccountId,
          challengeId,
          "EMPLOYEE_OTP_FAILED",
          "Employee login verification delivery failed",
          { reason: "PROVIDER_DELIVERY_FAILED" },
          input.request?.userAgent ?? null,
          database,
        );
      }

      return;
    }

    await writeOtpAuditForBusinessIds(
      deliveryIdentity.memberships.map(
        (membership) => membership.businessId,
      ),
      deliveryIdentity.employeeAccountId,
      challengeId,
      "EMPLOYEE_OTP_REQUESTED",
      "Employee login verification code requested",
      {
        purpose: creation.purpose,
        phoneMasked: maskAttendancePhone(phoneNumberNormalized),
        deliveryAccepted: true,
      },
      input.request?.userAgent ?? null,
      database,
    );
  };

  if (dependencies.dispatchDelivery) {
    dependencies.dispatchDelivery(deliveryTask);
  } else {
    await deliveryTask();
  }

  return uniformOtpRequestResult(challengeId);
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
  const verification = await database.$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`
        SELECT id
        FROM employee_otp_challenges
        WHERE id::text = ${input.challengeId}
        FOR UPDATE
      `,
    );
    const record = await transaction.employeeOtpChallenge.findUnique({
      where: { id: input.challengeId },
      select: {
        id: true,
        employeeAccountId: true,
        purpose: true,
        otpHash: true,
        expiresAt: true,
        attempts: true,
        maxAttempts: true,
        verifiedAt: true,
        invalidatedAt: true,
        deviceFingerprintHash: true,
      },
    });

    const usable =
      record !== null &&
      record.employeeAccountId !== null &&
      (record.purpose === "LOGIN" ||
        record.purpose === "REGISTER_DEVICE") &&
      record.verifiedAt === null &&
      record.invalidatedAt === null &&
      record.expiresAt.getTime() > now.getTime() &&
      record.attempts < record.maxAttempts &&
      record.deviceFingerprintHash !== null &&
      safeEqual(
        record.deviceFingerprintHash,
        deviceFingerprintHash,
      );
    const otpMatches = record
      ? verifyEmployeeOtpHash(
          record.id,
          input.otp,
          record.otpHash,
          config.authSecret,
        )
      : verifyEmployeeOtpHash(
          input.challengeId,
          input.otp,
          "0".repeat(64),
          config.authSecret,
        );

    if (!usable || !record || !otpMatches) {
      let terminalFailure: "EXPIRED" | "MAX_ATTEMPTS" | null = null;
      if (
        record &&
        record.verifiedAt === null &&
        record.invalidatedAt === null
      ) {
        const nextAttempts = record.attempts + 1;
        terminalFailure =
          record.expiresAt.getTime() <= now.getTime()
            ? "EXPIRED"
            : nextAttempts >= record.maxAttempts
              ? "MAX_ATTEMPTS"
              : null;
        const attempted = await transaction.employeeOtpChallenge.updateMany({
          where: {
            id: record.id,
            attempts: record.attempts,
            verifiedAt: null,
            invalidatedAt: null,
          },
          data: {
            attempts: { increment: 1 },
            ...(terminalFailure
              ? { invalidatedAt: now }
              : {}),
          },
        });

        if (
          attempted.count === 1 &&
          terminalFailure &&
          record.employeeAccountId
        ) {
          await writeOtpFailureAudits(
            record.employeeAccountId,
            record.id,
            terminalFailure,
            input.request?.userAgent ?? null,
            transaction,
          );
        }
      }

      await writeAuthSecurityEvent(
        {
          eventType: "OTP_FAILED",
          surface: "EMPLOYEE_OTP_VERIFY",
          outcome: "FAILURE",
          ipAddressHash: verificationIpHash,
          userAgentHash: verificationUserAgentHash,
          userId: record?.employeeAccountId ?? null,
          reason: terminalFailure ?? "INVALID_OTP",
          createdAt: now,
        },
        transaction,
      );
      return { ok: false as const };
    }

    const verified = await transaction.employeeOtpChallenge.updateMany({
      where: {
        id: record.id,
        attempts: record.attempts,
        verifiedAt: null,
        invalidatedAt: null,
        expiresAt: { gt: now },
      },
      data: { verifiedAt: now },
    });

    if (verified.count !== 1) {
      await writeAuthSecurityEvent(
        {
          eventType: "OTP_FAILED",
          surface: "EMPLOYEE_OTP_VERIFY",
          outcome: "FAILURE",
          ipAddressHash: verificationIpHash,
          userAgentHash: verificationUserAgentHash,
          userId: record.employeeAccountId,
          reason: "CONCURRENT_REPLAY",
          createdAt: now,
        },
        transaction,
      );
      return { ok: false as const };
    }

    const employeeAccountId = record.employeeAccountId;

    if (!employeeAccountId) {
      return { ok: false as const };
    }

    await writeAuthSecurityEvent(
      {
        eventType: "OTP_VERIFIED",
        surface: "EMPLOYEE_OTP_VERIFY",
        outcome: "SUCCESS",
        ipAddressHash: verificationIpHash,
        userAgentHash: verificationUserAgentHash,
        userId: employeeAccountId,
        createdAt: now,
      },
      transaction,
    );

    return {
      ok: true as const,
      challenge: {
        id: record.id,
        employeeAccountId,
        deviceFingerprintHash,
      },
    };
  });

  if (!verification.ok) {
    throw new EmployeeAuthError("OTP_INVALID");
  }

  const challenge = verification.challenge;

  const identity = await findEligibleEmployeeIdentityById(
    challenge.employeeAccountId,
    now,
    database,
  );

  if (!identity) {
    await database.employeeOtpChallenge.updateMany({
      where: {
        id: challenge.id,
        invalidatedAt: null,
      },
      data: { invalidatedAt: now },
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
    { database, config },
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
    { database, config },
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

    return {
      status: "AUTHENTICATED",
      token: createdSession.token,
      expiresAt: createdSession.expiresAt,
      context: createdSession.context,
    };
  });
}

function uniformOtpRequestResult(challengeId: string) {
  return {
    challengeId,
    message: EMPLOYEE_OTP_REQUEST_MESSAGE,
  };
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
