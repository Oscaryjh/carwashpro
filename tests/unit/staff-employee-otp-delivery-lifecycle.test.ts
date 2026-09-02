import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { getEmployeeAuthConfig } from "../../src/lib/attendance/employee-auth/config";
import { verifyEmployeeOtpHash } from "../../src/lib/attendance/employee-auth/crypto";
import { requestEmployeeOtp } from "../../src/lib/attendance/employee-auth/otp-service";
import type {
  EmployeeOtpProvider,
  StartEmployeeVerificationInput,
} from "../../src/lib/attendance/employee-auth/provider";

const AUTH_SECRET =
  "staff-otp-delivery-lifecycle-secret-longer-than-thirty-two-bytes";
const NOW = new Date("2026-08-31T00:00:00.000Z");

test("SMS acceptance is outside the transaction and survives a transient follow-up write failure", async () => {
  const harness = createOtpRequestHarness({
    acceptedUpdateFailures: 1,
    auditFailures: 1,
  });
  const provider = createProvider(harness);

  const first = await requestEmployeeOtp(requestInput(), {
    database: harness.database,
    config: otpConfig(),
    provider,
    now: NOW,
  });

  assert.equal(provider.sendCount, 1);
  assert.equal(harness.acceptedUpdateAttempts, 2);
  assert.equal(harness.providerCalledInsideTransaction, false);
  assert.equal(harness.challengeWasDurableAtSend, true);
  assert.equal(harness.challenges.length, 1);

  const challenge = harness.challenges[0];
  assert.equal(challenge.id, first.challengeId);
  assert.equal(challenge.invalidatedAt, null);
  assert.equal(challenge.deliveryAcceptedAt, NOW);
  assert.equal(challenge.providerReference, `sms123:${challenge.id}`);
  assert.equal(
    verifyEmployeeOtpHash(
      challenge.id,
      provider.sentCode ?? "",
      challenge.otpHash ?? "",
      AUTH_SECRET,
    ),
    true,
    "the durable accepted challenge must remain verifiable",
  );

  const cooldown = await requestEmployeeOtp(requestInput(), {
    database: harness.database,
    config: otpConfig(),
    provider,
    now: new Date(NOW.getTime() + 1_000),
  });

  assert.equal(cooldown.challengeId, challenge.id);
  assert.equal(provider.sendCount, 1, "cooldown must not send a second SMS");
  assert.equal(harness.challenges.length, 1);
});

test("SMS failure invalidates the durable challenge and cooldown does not resend", async () => {
  const harness = createOtpRequestHarness();
  const provider = createProvider(harness, { failSend: true });

  const first = await requestEmployeeOtp(requestInput(), {
    database: harness.database,
    config: otpConfig(),
    provider,
    now: NOW,
  });

  assert.equal(provider.sendCount, 1);
  assert.equal(harness.challengeWasDurableAtSend, true);
  assert.equal(harness.challenges.length, 1);
  assert.equal(harness.challenges[0].id, first.challengeId);
  assert.equal(harness.challenges[0].invalidatedAt, NOW);
  assert.equal(harness.challenges[0].providerReference, null);
  assert.equal(harness.challenges[0].deliveryAcceptedAt, null);

  const cooldown = await requestEmployeeOtp(requestInput(), {
    database: harness.database,
    config: otpConfig(),
    provider,
    now: new Date(NOW.getTime() + 1_000),
  });

  assert.equal(cooldown.challengeId, first.challengeId);
  assert.equal(
    provider.sendCount,
    1,
    "a failed request remains cooldown-limited",
  );
  assert.equal(harness.challenges.length, 1);
});

test("persistent accepted-state failure keeps the durable challenge and never sends twice", async () => {
  const harness = createOtpRequestHarness({ acceptedUpdateFailures: 3 });
  const provider = createProvider(harness);

  await assert.rejects(
    requestEmployeeOtp(requestInput(), {
      database: harness.database,
      config: otpConfig(),
      provider,
      now: NOW,
    }),
    /simulated transient database failure/,
  );

  assert.equal(provider.sendCount, 1);
  assert.equal(harness.acceptedUpdateAttempts, 3);
  assert.equal(harness.challenges.length, 1);
  assert.equal(harness.challenges[0].invalidatedAt, null);
  assert.equal(harness.challenges[0].otpHash !== null, true);

  const cooldown = await requestEmployeeOtp(requestInput(), {
    database: harness.database,
    config: otpConfig(),
    provider,
    now: new Date(NOW.getTime() + 1_000),
  });

  assert.equal(cooldown.challengeId, harness.challenges[0].id);
  assert.equal(provider.sendCount, 1, "a retry must not duplicate an accepted SMS");
  assert.equal(harness.challenges.length, 1);
});

function requestInput() {
  return {
    phoneNumber: "01112212259",
    deviceIdentifier: "real-device-uat-iphone",
    request: { ipAddress: "192.0.2.10", userAgent: "Mobile Safari" },
  } as const;
}

function otpConfig() {
  return getEmployeeAuthConfig({
    NODE_ENV: "test",
    EMPLOYEE_AUTH_SECRET: AUTH_SECRET,
    OTP_PROVIDER: "sms123",
    OTP_CHANNEL: "sms",
    SMS123_API_KEY: "test-api-key-long-enough",
  });
}

type StoredChallenge = {
  id: string;
  createdAt: Date;
  phoneNumberNormalized: string;
  otpHash: string | null;
  expiresAt: Date;
  resendAvailableAt: Date;
  invalidatedAt: Date | null;
  providerReference: string | null;
  deliveryAcceptedAt: Date | null;
  [key: string]: unknown;
};

function createOtpRequestHarness(
  options: { acceptedUpdateFailures?: number; auditFailures?: number } = {},
) {
  const challenges: StoredChallenge[] = [];
  let inTransaction = false;
  let acceptedUpdateFailures = options.acceptedUpdateFailures ?? 0;
  let auditFailures = options.auditFailures ?? 0;
  let acceptedUpdateAttempts = 0;

  const employeeOtpChallenge = {
    count: async () => challenges.length,
    findFirst: async () => {
      const latest = challenges.at(-1);
      return latest
        ? {
            id: latest.id,
            expiresAt: latest.expiresAt,
            resendAvailableAt: latest.resendAvailableAt,
          }
        : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const challenge: StoredChallenge = {
        ...data,
        id: String(data.id),
        createdAt: (data.createdAt as Date | undefined) ?? NOW,
        phoneNumberNormalized: String(data.phoneNumberNormalized),
        otpHash: (data.otpHash as string | null | undefined) ?? null,
        expiresAt: data.expiresAt as Date,
        resendAvailableAt: data.resendAvailableAt as Date,
        invalidatedAt: null,
        providerReference: null,
        deliveryAcceptedAt: null,
      };
      challenges.push(challenge);
      return challenge;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      if ("providerReference" in data) {
        acceptedUpdateAttempts += 1;
        if (acceptedUpdateFailures > 0) {
          acceptedUpdateFailures -= 1;
          throw new Error("simulated transient database failure");
        }
      }

      const matching = challenges.filter((challenge) => {
        if (where.id && challenge.id !== where.id) return false;
        if (
          where.phoneNumberNormalized &&
          challenge.phoneNumberNormalized !== where.phoneNumberNormalized
        ) {
          return false;
        }
        if (where.invalidatedAt === null && challenge.invalidatedAt !== null) {
          return false;
        }
        if (
          where.providerReference === null &&
          challenge.providerReference !== null
        ) {
          return false;
        }
        return true;
      });

      for (const challenge of matching) Object.assign(challenge, data);
      return { count: matching.length };
    },
  };

  const database = {
    $queryRaw: async () => [],
    $transaction: async (
      operation: (transaction: unknown) => Promise<unknown>,
      transactionOptions?: { maxWait?: number; timeout?: number },
    ) => {
      assert.deepEqual(transactionOptions, { maxWait: 5_000, timeout: 15_000 });
      inTransaction = true;
      try {
        return await operation(database);
      } finally {
        inTransaction = false;
      }
    },
    employeeAccount: {
      findUnique: async () => eligibleEmployeeAccount(),
    },
    employeeDevice: {
      findUnique: async () => null,
      count: async () => 0,
    },
    employeeOtpChallenge,
    authSecurityEvent: {
      count: async () => 0,
      create: async ({ data }: { data: unknown }) => data,
    },
    auditLog: {
      create: async ({ data }: { data: unknown }) => {
        if (auditFailures > 0) {
          auditFailures -= 1;
          throw new Error("simulated audit write failure");
        }
        return data;
      },
    },
  };

  return {
    challenges,
    database: database as unknown as PrismaClient,
    get acceptedUpdateAttempts() {
      return acceptedUpdateAttempts;
    },
    get inTransaction() {
      return inTransaction;
    },
    providerCalledInsideTransaction: false,
    challengeWasDurableAtSend: false,
  };
}

function createProvider(
  harness: ReturnType<typeof createOtpRequestHarness>,
  options: { failSend?: boolean } = {},
) {
  let sendCount = 0;
  let sentCode: string | null = null;

  const provider: EmployeeOtpProvider & {
    readonly sendCount: number;
    readonly sentCode: string | null;
  } = {
    name: "sms123",
    channel: "sms",
    verificationMode: "application",
    get sendCount() {
      return sendCount;
    },
    get sentCode() {
      return sentCode;
    },
    async sendVerification(input: StartEmployeeVerificationInput) {
      sendCount += 1;
      sentCode = input.code ?? null;
      harness.providerCalledInsideTransaction = harness.inTransaction;
      harness.challengeWasDurableAtSend = harness.challenges.some(
        (challenge) => challenge.id === input.challengeId,
      );
      if (options.failSend) throw new Error("simulated SMS123 failure");
      return {
        status: "ACCEPTED",
        providerReference: `sms123:${input.challengeId}`,
      };
    },
    async checkVerification() {
      return { status: "APPROVED" };
    },
  };

  return provider;
}

function eligibleEmployeeAccount() {
  return {
    id: "employee-account-1",
    status: "ACTIVE",
    memberships: [
      {
        id: "membership-1",
        businessId: "business-1",
        employeeCode: "UAT-001",
        fullName: "Real Device UAT Employee",
        attendanceEnabled: true,
        business: {
          id: "business-1",
          name: "Royal Salon",
          status: "active",
        },
        branchAssignments: [
          {
            branchId: "branch-1",
            isPrimary: true,
            canClockIn: true,
            effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
            effectiveUntil: null,
            status: "ACTIVE",
            branch: {
              id: "branch-1",
              businessId: "business-1",
              name: "salon online",
              status: "ACTIVE",
              attendanceSetting: {
                businessId: "business-1",
                branchId: "branch-1",
                isEnabled: true,
              },
            },
          },
        ],
      },
    ],
  };
}
