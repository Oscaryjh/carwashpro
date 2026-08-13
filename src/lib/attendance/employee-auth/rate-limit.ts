import { Prisma, type PrismaClient } from "@prisma/client";
import type { EmployeeAuthConfig } from "./config";

type OtpRateLimitDatabase =
  | Pick<PrismaClient, "employeeOtpChallenge" | "authSecurityEvent">
  | Pick<Prisma.TransactionClient, "employeeOtpChallenge" | "authSecurityEvent">;

export type EmployeeOtpRateLimitInput = Readonly<{
  phoneNumberNormalized: string | null;
  phoneIdentifierHash: string | null;
  ipAddressHash: string | null;
  deviceFingerprintHash: string;
  purpose: "LOGIN" | "REGISTER_DEVICE";
  now: Date;
}>;

export type EmployeeOtpRateLimitResult = Readonly<{
  requestAllowed: boolean;
  providerAllowed: boolean;
  reasons: readonly (
    | "PHONE"
    | "IP"
    | "DEVICE"
    | "RESEND_COOLDOWN"
    | "PROVIDER"
  )[];
  cooldownChallenge: Readonly<{
    id: string;
    expiresAt: Date;
    resendAvailableAt: Date;
  }> | null;
}>;

export async function checkEmployeeOtpRateLimit(
  input: EmployeeOtpRateLimitInput,
  config: EmployeeAuthConfig,
  database: OtpRateLimitDatabase,
): Promise<EmployeeOtpRateLimitResult> {
  const hourAgo = new Date(input.now.getTime() - 60 * 60 * 1_000);
  const [
    phoneCount,
    ipCount,
    deviceCount,
    providerCount,
    latestPhoneChallenge,
  ] = await Promise.all([
    input.phoneNumberNormalized
      ? database.employeeOtpChallenge.count({
          where: {
            phoneNumberNormalized: input.phoneNumberNormalized,
            createdAt: { gte: hourAgo },
          },
        })
      : Promise.resolve(0),
    input.ipAddressHash
      ? database.employeeOtpChallenge.count({
          where: {
            ipAddressHash: input.ipAddressHash,
            createdAt: { gte: hourAgo },
          },
        })
      : Promise.resolve(0),
    database.employeeOtpChallenge.count({
      where: {
        deviceFingerprintHash: input.deviceFingerprintHash,
        createdAt: { gte: hourAgo },
      },
    }),
    database.employeeOtpChallenge.count({
      where: {
        employeeAccountId: { not: null },
        createdAt: { gte: hourAgo },
      },
    }),
    input.phoneNumberNormalized
      ? database.employeeOtpChallenge.findFirst({
          where: {
            phoneNumberNormalized: input.phoneNumberNormalized,
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, expiresAt: true, resendAvailableAt: true },
        })
      : Promise.resolve(null),
  ]);

  const reasons: EmployeeOtpRateLimitResult["reasons"][number][] = [];

  if (phoneCount >= config.otp.phoneRequestsPerHour) {
    reasons.push("PHONE");
  }

  if (ipCount >= config.otp.ipRequestsPerHour) {
    reasons.push("IP");
  }

  if (deviceCount >= config.otp.deviceRequestsPerHour) {
    reasons.push("DEVICE");
  }

  if (
    latestPhoneChallenge &&
    latestPhoneChallenge.resendAvailableAt.getTime() > input.now.getTime()
  ) {
    reasons.push("RESEND_COOLDOWN");
  }

  const providerAllowed =
    providerCount < config.otp.providerRequestsPerHour;

  if (!providerAllowed) {
    reasons.push("PROVIDER");
  }

  return {
    requestAllowed: !reasons.some((reason) => reason !== "PROVIDER"),
    providerAllowed,
    reasons,
    cooldownChallenge:
      latestPhoneChallenge &&
      latestPhoneChallenge.resendAvailableAt.getTime() > input.now.getTime()
        ? latestPhoneChallenge
        : null,
  };
}

export async function checkEmployeeOtpVerifyRateLimit(
  input: {
    phoneIdentifierHash: string;
    ipAddressHash: string | null;
    now: Date;
  },
  config: EmployeeAuthConfig,
  database: OtpRateLimitDatabase,
) {
  const hourAgo = new Date(input.now.getTime() - 60 * 60 * 1_000);
  const [phoneAttempts, ipAttempts] = await Promise.all([
    database.authSecurityEvent.count({
      where: {
        surface: "EMPLOYEE_OTP_VERIFY",
        identifierHash: input.phoneIdentifierHash,
        createdAt: { gte: hourAgo },
      },
    }),
    input.ipAddressHash
      ? database.authSecurityEvent.count({
          where: {
            surface: "EMPLOYEE_OTP_VERIFY",
            ipAddressHash: input.ipAddressHash,
            createdAt: { gte: hourAgo },
          },
        })
      : Promise.resolve(0),
  ]);

  return {
    allowed:
      phoneAttempts < config.otp.verifyPhoneAttemptsPerHour &&
      ipAttempts < config.otp.verifyIpAttemptsPerHour,
    phoneAttempts,
    ipAttempts,
  } as const;
}

export async function acquireEmployeeOtpVerifyRateLimitLocks(
  input: {
    phoneIdentifierHash: string;
    ipAddressHash: string | null;
  },
  transaction: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  const keys = [
    `employee-otp-verify:phone:${input.phoneIdentifierHash}`,
    ...(input.ipAddressHash
      ? [`employee-otp-verify:ip:${input.ipAddressHash}`]
      : []),
  ].sort();

  for (const key of keys) {
    await transaction.$queryRaw<Array<{ acquired: string }>>(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS acquired`,
    );
  }
}

export async function acquireEmployeeOtpRateLimitLocks(
  input: Pick<
    EmployeeOtpRateLimitInput,
    | "phoneIdentifierHash"
    | "ipAddressHash"
    | "deviceFingerprintHash"
  >,
  transaction: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  const lockKeys = [
    "employee-otp:provider",
    `employee-otp:device:${input.deviceFingerprintHash}`,
    ...(input.phoneIdentifierHash
      ? [`employee-otp:phone:${input.phoneIdentifierHash}`]
      : []),
    ...(input.ipAddressHash
      ? [`employee-otp:ip:${input.ipAddressHash}`]
      : []),
  ].sort();

  for (const lockKey of lockKeys) {
    await transaction.$queryRaw<Array<{ acquired: string }>>(
      Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${lockKey}, 0)
        )::text AS acquired
      `,
    );
  }
}
