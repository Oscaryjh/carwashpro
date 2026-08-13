import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyPasswordHash } from "./password-login";
import { decryptMfaSecret, encryptMfaSecret } from "./mfa-crypto";
import { MfaError, type MfaErrorCode } from "./mfa-errors";
import {
  generateRecoveryCodes,
  hashRecoveryCodes,
  recoveryCodeMatches,
} from "./mfa-recovery";
import {
  createTotpUri,
  generateTotpSecret,
  verifyTotp,
} from "./mfa-totp";
import {
  acquireMfaRateLimitLocks,
  checkMfaRateLimit,
  type AuthRequestContext,
  MFA_SECURITY_SURFACE,
  mfaRateLimitHashes,
  writeAuthSecurityEvent,
} from "./security";

export const MFA_ENROLLMENT_TTL_SECONDS = 10 * 60;

type MfaDatabase = Pick<PrismaClient, "$transaction" | "userMfaCredential">;
export type MfaTransaction = Pick<
  Prisma.TransactionClient,
  | "$queryRaw"
  | "authSecurityEvent"
  | "authSession"
  | "sensitiveActionAuthorization"
  | "userMfaCredential"
  | "userMfaRecoveryCode"
>;

export type MfaFactorInput = Readonly<{
  factorType: "TOTP" | "RECOVERY_CODE";
  code: string;
}>;

type MfaOperationInput = Readonly<{
  userId: string;
  sessionId: string;
  password: string;
  factor: MfaFactorInput;
  request: AuthRequestContext;
}>;

export async function beginMfaEnrollment(
  input: Omit<MfaOperationInput, "factor">,
  dependencies: { database?: MfaDatabase; now?: Date } = {},
) {
  const database = dependencies.database ?? prisma;
  const now = dependencies.now ?? new Date();
  const credentialId = randomUUID();
  const secret = generateTotpSecret();
  const encrypted = encryptMfaSecret(secret, {
    credentialId,
    userId: input.userId,
    type: "TOTP",
  });
  const result = await database.$transaction(
    async (transaction: MfaTransaction) => {
      await lockUserMfa(input.userId, transaction);
      const session = await usablePasswordSession(
        input.userId,
        input.sessionId,
        transaction,
        now,
      );
      const hashes = mfaRateLimitHashes({
        userId: input.userId,
        sessionId: input.sessionId,
        ipAddress: input.request.ipAddress,
        userAgent: input.request.userAgent,
      });
      const limited = await applyMfaRateLimit(
        input.userId,
        input.sessionId,
        hashes,
        transaction,
        now,
      );
      if (limited) return failure("MFA_RATE_LIMITED");
      const passwordValid = await verifyPasswordHash(
        input.password,
        session?.user.passwordHash,
      );
      if (!session || !passwordValid) {
        await failedMfaEvent(
          {
            input,
            hashes,
            reason: "PASSWORD_REAUTH_FAILED",
            now,
          },
          transaction,
        );
        return failure("MFA_PASSWORD_REAUTH_FAILED");
      }
      const active = await transaction.userMfaCredential.findFirst({
        where: { userId: input.userId, type: "TOTP", status: "ACTIVE" },
        select: { id: true },
      });
      if (active) return failure("MFA_ALREADY_ENROLLED");
      await transaction.userMfaCredential.updateMany({
        where: { userId: input.userId, type: "TOTP", status: "PENDING" },
        data: {
          status: "REVOKED",
          enrollmentSessionId: null,
          pendingExpiresAt: null,
          revokedAt: now,
          revokeReason: "ENROLLMENT_RESTARTED",
        },
      });
      const pendingExpiresAt = new Date(
        now.getTime() + MFA_ENROLLMENT_TTL_SECONDS * 1_000,
      );
      const credential = await transaction.userMfaCredential.create({
        data: {
          id: credentialId,
          userId: input.userId,
          type: "TOTP",
          status: "PENDING",
          ...encrypted,
          algorithm: "SHA1",
          digits: 6,
          periodSeconds: 30,
          enrollmentSessionId: input.sessionId,
          pendingExpiresAt,
        },
      });
      await writeAuthSecurityEvent(
        {
          eventType: "MFA_ENROLLMENT_STARTED",
          surface: MFA_SECURITY_SURFACE,
          outcome: "SUCCESS",
          ...hashes,
          userId: input.userId,
          sessionId: input.sessionId,
          metadata: { credentialId: credential.id, method: "TOTP" },
          createdAt: now,
        },
        transaction,
      );
      return { ok: true as const, credential, accountLabel: session.user.email! };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (!result.ok) throw new MfaError(result.code);
  return {
    credential: result.credential,
    manualSecret: secret,
    otpauthUri: createTotpUri({
      accountLabel: result.accountLabel,
      secret,
    }),
  };
}

export async function completeMfaEnrollment(
  input: {
    userId: string;
    sessionId: string;
    credentialId: string;
    code: string;
    request: AuthRequestContext;
  },
  dependencies: { database?: MfaDatabase; now?: Date } = {},
) {
  const database = dependencies.database ?? prisma;
  const now = dependencies.now ?? new Date();
  const result = await database.$transaction(
    async (transaction: MfaTransaction) => {
      await lockUserMfa(input.userId, transaction);
      const session = await usablePasswordSession(
        input.userId,
        input.sessionId,
        transaction,
        now,
      );
      const credential = await transaction.userMfaCredential.findUnique({
        where: { id: input.credentialId },
      });
      const hashes = mfaRateLimitHashes({
        userId: input.userId,
        sessionId: input.sessionId,
        credentialId: credential?.id,
        ipAddress: input.request.ipAddress,
        userAgent: input.request.userAgent,
      });
      const limited = await applyMfaRateLimit(
        input.userId,
        input.sessionId,
        hashes,
        transaction,
        now,
      );
      if (limited) return failure("MFA_RATE_LIMITED");
      if (!session || !credential || credential.userId !== input.userId) {
        await failedMfaEvent(
          { input, hashes, reason: "ENROLLMENT_NOT_FOUND", now },
          transaction,
        );
        return failure("MFA_VERIFICATION_FAILED");
      }
      if (credential.status === "ACTIVE") {
        return failure("MFA_ALREADY_ENROLLED");
      }
      if (
        credential.status !== "PENDING" ||
        credential.enrollmentSessionId !== input.sessionId
      ) {
        return failure("MFA_ENROLLMENT_SESSION_MISMATCH");
      }
      if (
        !credential.pendingExpiresAt ||
        credential.pendingExpiresAt.getTime() <= now.getTime()
      ) {
        await transaction.userMfaCredential.updateMany({
          where: { id: credential.id, status: "PENDING" },
          data: {
            status: "REVOKED",
            enrollmentSessionId: null,
            pendingExpiresAt: null,
            revokedAt: now,
            revokeReason: "ENROLLMENT_EXPIRED",
          },
        });
        return failure("MFA_ENROLLMENT_EXPIRED");
      }
      const secret = decryptCredentialSecret(credential);
      const acceptedCounter = verifyTotp({
        code: input.code,
        secret,
        timestamp: now.getTime(),
      });
      if (acceptedCounter === null) {
        await failedMfaEvent(
          { input, hashes, reason: "INVALID_TOTP", now },
          transaction,
        );
        return failure("MFA_VERIFICATION_FAILED");
      }
      const recoveryCodes = generateRecoveryCodes();
      const hashesForStorage = await hashRecoveryCodes(recoveryCodes);
      const activated = await transaction.userMfaCredential.updateMany({
        where: { id: credential.id, status: "PENDING" },
        data: {
          status: "ACTIVE",
          enrollmentSessionId: null,
          pendingExpiresAt: null,
          enrolledAt: now,
          verifiedAt: now,
          lastAcceptedCounter: acceptedCounter,
          recoveryVersion: 1,
        },
      });
      if (activated.count !== 1) return failure("MFA_CREDENTIAL_CHANGED");
      await transaction.userMfaRecoveryCode.createMany({
        data: hashesForStorage.map((item) => ({
          credentialId: credential.id,
          generation: 1,
          ordinal: item.ordinal,
          codeHash: item.codeHash,
          createdAt: now,
        })),
      });
      await writeAuthSecurityEvent(
        {
          eventType: "MFA_ENROLLMENT_COMPLETED",
          surface: MFA_SECURITY_SURFACE,
          outcome: "SUCCESS",
          ...hashes,
          userId: input.userId,
          sessionId: input.sessionId,
          metadata: {
            credentialId: credential.id,
            method: "TOTP",
            recoveryCodeCount: recoveryCodes.length,
          },
          createdAt: now,
        },
        transaction,
      );
      await writeAuthSecurityEvent(
        {
          eventType: "MFA_VERIFICATION_SUCCEEDED",
          surface: MFA_SECURITY_SURFACE,
          outcome: "SUCCESS",
          ...hashes,
          userId: input.userId,
          sessionId: input.sessionId,
          metadata: { credentialId: credential.id, method: "TOTP" },
          createdAt: now,
        },
        transaction,
      );
      return { ok: true as const, credentialId: credential.id, recoveryCodes };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (!result.ok) throw new MfaError(result.code);
  return result;
}

export async function getMfaSecurityState(input: {
  userId: string;
  sessionId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const [active, pending] = await Promise.all([
    prisma.userMfaCredential.findFirst({
      where: { userId: input.userId, type: "TOTP", status: "ACTIVE" },
      select: {
        id: true,
        enrolledAt: true,
        verifiedAt: true,
        recoveryCodes: {
          where: { consumedAt: null, revokedAt: null },
          select: { id: true },
        },
      },
    }),
    prisma.userMfaCredential.findFirst({
      where: {
        userId: input.userId,
        type: "TOTP",
        status: "PENDING",
        enrollmentSessionId: input.sessionId,
        pendingExpiresAt: { gt: now },
      },
    }),
  ]);
  if (active) {
    return {
      status: "ENROLLED" as const,
      credentialId: active.id,
      enrolledAt: active.enrolledAt,
      verifiedAt: active.verifiedAt,
      recoveryCodesAvailable: active.recoveryCodes.length,
      pending: null,
    };
  }
  if (!pending) {
    return {
      status: "NOT_ENROLLED" as const,
      credentialId: null,
      enrolledAt: null,
      verifiedAt: null,
      recoveryCodesAvailable: 0,
      pending: null,
    };
  }
  const secret = decryptCredentialSecret(pending);
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true },
  });
  return {
    status: "PENDING" as const,
    credentialId: null,
    enrolledAt: null,
    verifiedAt: null,
    recoveryCodesAvailable: 0,
    pending: {
      credentialId: pending.id,
      expiresAt: pending.pendingExpiresAt!,
      manualSecret: secret,
      otpauthUri: createTotpUri({
        accountLabel: user?.email ?? input.userId,
        secret,
      }),
    },
  };
}

export async function verifyMfaFactorInTransaction(
  input: {
    userId: string;
    sessionId: string;
    factor: MfaFactorInput;
    request: AuthRequestContext;
    actionKey?: string | null;
  },
  transaction: MfaTransaction,
  now: Date,
) {
  const credential = await transaction.userMfaCredential.findFirst({
    where: { userId: input.userId, type: "TOTP", status: "ACTIVE" },
    include: {
      recoveryCodes: {
        where: { consumedAt: null, revokedAt: null },
        orderBy: { ordinal: "asc" },
      },
    },
  });
  const hashes = mfaRateLimitHashes({
    userId: input.userId,
    sessionId: input.sessionId,
    credentialId: credential?.id,
    ipAddress: input.request.ipAddress,
    userAgent: input.request.userAgent,
  });
  const limited = await applyMfaRateLimit(
    input.userId,
    input.sessionId,
    hashes,
    transaction,
    now,
  );
  if (limited) return failure("MFA_RATE_LIMITED");
  if (!credential) return failure("MFA_NOT_ENROLLED");

  if (input.factor.factorType === "TOTP") {
    const acceptedCounter = verifyTotp({
      code: input.factor.code,
      secret: decryptCredentialSecret(credential),
      timestamp: now.getTime(),
    });
    if (acceptedCounter === null) {
      await failedMfaEvent(
        { input, hashes, reason: "INVALID_TOTP", now },
        transaction,
      );
      return failure("MFA_VERIFICATION_FAILED");
    }
    if (
      credential.lastAcceptedCounter !== null &&
      acceptedCounter <= credential.lastAcceptedCounter
    ) {
      await failedMfaEvent(
        { input, hashes, reason: "TOTP_REPLAY", now },
        transaction,
      );
      return failure("MFA_REPLAYED");
    }
    const accepted = await transaction.userMfaCredential.updateMany({
      where: {
        id: credential.id,
        status: "ACTIVE",
        OR: [
          { lastAcceptedCounter: null },
          { lastAcceptedCounter: { lt: acceptedCounter } },
        ],
      },
      data: { lastAcceptedCounter: acceptedCounter, verifiedAt: now },
    });
    if (accepted.count !== 1) return failure("MFA_REPLAYED");
    await successfulMfaEvent(
      { input, hashes, credentialId: credential.id, method: "TOTP", now },
      transaction,
    );
    return {
      ok: true as const,
      credentialId: credential.id,
      verificationMethod: "TOTP" as const,
      acceptedCounter,
    };
  }

  for (const recovery of credential.recoveryCodes) {
    if (!(await recoveryCodeMatches(input.factor.code, recovery.codeHash))) {
      continue;
    }
    const consumed = await transaction.userMfaRecoveryCode.updateMany({
      where: { id: recovery.id, consumedAt: null, revokedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) return failure("MFA_REPLAYED");
    await transaction.userMfaCredential.update({
      where: { id: credential.id },
      data: { verifiedAt: now },
    });
    await successfulMfaEvent(
      {
        input,
        hashes,
        credentialId: credential.id,
        method: "RECOVERY_CODE",
        now,
      },
      transaction,
    );
    return {
      ok: true as const,
      credentialId: credential.id,
      verificationMethod: "RECOVERY_CODE" as const,
      acceptedCounter: null,
    };
  }
  await failedMfaEvent(
    { input, hashes, reason: "INVALID_RECOVERY_CODE", now },
    transaction,
  );
  return failure("MFA_VERIFICATION_FAILED");
}

export async function disableMfa(
  input: MfaOperationInput,
  dependencies: { database?: MfaDatabase; now?: Date } = {},
) {
  const database = dependencies.database ?? prisma;
  const now = dependencies.now ?? new Date();
  const result = await database.$transaction(
    async (transaction: MfaTransaction) => {
      await lockUserMfa(input.userId, transaction);
      const passwordCheck = await verifyOperationPassword(
        input,
        transaction,
        now,
      );
      if (!passwordCheck.ok) return passwordCheck;
      const factor = await verifyMfaFactorInTransaction(
        input,
        transaction,
        now,
      );
      if (!factor.ok) return factor;
      const revoked = await transaction.userMfaCredential.updateMany({
        where: { id: factor.credentialId, status: "ACTIVE", revokedAt: null },
        data: {
          status: "REVOKED",
          revokedAt: now,
          revokeReason: "SELF_SERVICE_DISABLE",
        },
      });
      if (revoked.count !== 1) return failure("MFA_CREDENTIAL_CHANGED");
      await transaction.userMfaRecoveryCode.updateMany({
        where: {
          credentialId: factor.credentialId,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      await transaction.sensitiveActionAuthorization.updateMany({
        where: { userId: input.userId, consumedAt: null, revokedAt: null },
        data: { revokedAt: now, revokeReason: "MFA_DISABLED" },
      });
      await writeAuthSecurityEvent(
        {
          eventType: "MFA_CREDENTIAL_REVOKED",
          surface: MFA_SECURITY_SURFACE,
          outcome: "SUCCESS",
          userId: input.userId,
          sessionId: input.sessionId,
          metadata: { credentialId: factor.credentialId, method: "TOTP" },
          createdAt: now,
        },
        transaction,
      );
      return { ok: true as const };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (!result.ok) throw new MfaError(result.code);
  return result;
}

export async function regenerateRecoveryCodes(
  input: MfaOperationInput,
  dependencies: { database?: MfaDatabase; now?: Date } = {},
) {
  const database = dependencies.database ?? prisma;
  const now = dependencies.now ?? new Date();
  const recoveryCodes = generateRecoveryCodes();
  const hashesForStorage = await hashRecoveryCodes(recoveryCodes);
  const result = await database.$transaction(
    async (transaction: MfaTransaction) => {
      await lockUserMfa(input.userId, transaction);
      const passwordCheck = await verifyOperationPassword(
        input,
        transaction,
        now,
      );
      if (!passwordCheck.ok) return passwordCheck;
      const factor = await verifyMfaFactorInTransaction(
        input,
        transaction,
        now,
      );
      if (!factor.ok) return factor;
      const credential = await transaction.userMfaCredential.findUniqueOrThrow({
        where: { id: factor.credentialId },
        select: { recoveryVersion: true },
      });
      const nextGeneration = credential.recoveryVersion + 1;
      const versioned = await transaction.userMfaCredential.updateMany({
        where: {
          id: factor.credentialId,
          status: "ACTIVE",
          recoveryVersion: credential.recoveryVersion,
        },
        data: { recoveryVersion: nextGeneration },
      });
      if (versioned.count !== 1) return failure("MFA_CREDENTIAL_CHANGED");
      await transaction.userMfaRecoveryCode.updateMany({
        where: {
          credentialId: factor.credentialId,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      await transaction.userMfaRecoveryCode.createMany({
        data: hashesForStorage.map((item) => ({
          credentialId: factor.credentialId,
          generation: nextGeneration,
          ordinal: item.ordinal,
          codeHash: item.codeHash,
          createdAt: now,
        })),
      });
      await writeAuthSecurityEvent(
        {
          eventType: "RECOVERY_CODES_REGENERATED",
          surface: MFA_SECURITY_SURFACE,
          outcome: "SUCCESS",
          userId: input.userId,
          sessionId: input.sessionId,
          metadata: {
            credentialId: factor.credentialId,
            recoveryCodeCount: recoveryCodes.length,
          },
          createdAt: now,
        },
        transaction,
      );
      return { ok: true as const, recoveryCodes };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (!result.ok) throw new MfaError(result.code);
  return result;
}

function decryptCredentialSecret(credential: {
  id: string;
  userId: string;
  type: "TOTP";
  encryptedSecret: Uint8Array;
  secretIv: Uint8Array;
  secretAuthTag: Uint8Array;
  encryptionKeyVersion: string;
}) {
  return decryptMfaSecret({
    credentialId: credential.id,
    userId: credential.userId,
    type: credential.type,
    encryptedSecret: credential.encryptedSecret,
    secretIv: credential.secretIv,
    secretAuthTag: credential.secretAuthTag,
    encryptionKeyVersion: credential.encryptionKeyVersion,
  });
}

async function usablePasswordSession(
  userId: string,
  sessionId: string,
  transaction: MfaTransaction,
  now: Date,
) {
  const session = await transaction.authSession.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          passwordHash: true,
          status: true,
          loginEnabled: true,
        },
      },
    },
  });
  if (
    !session ||
    session.userId !== userId ||
    session.user.id !== userId ||
    session.revokedAt ||
    session.absoluteExpiresAt.getTime() <= now.getTime() ||
    session.idleExpiresAt.getTime() <= now.getTime() ||
    session.user.status !== "active" ||
    !session.user.loginEnabled ||
    !session.user.email ||
    !session.user.passwordHash
  ) {
    return null;
  }
  return session;
}

async function verifyOperationPassword(
  input: MfaOperationInput,
  transaction: MfaTransaction,
  now: Date,
) {
  const session = await usablePasswordSession(
    input.userId,
    input.sessionId,
    transaction,
    now,
  );
  const passwordValid = await verifyPasswordHash(
    input.password,
    session?.user.passwordHash,
  );
  if (session && passwordValid) return { ok: true as const };
  const hashes = mfaRateLimitHashes({
    userId: input.userId,
    sessionId: input.sessionId,
    ipAddress: input.request.ipAddress,
    userAgent: input.request.userAgent,
  });
  await failedMfaEvent(
    { input, hashes, reason: "PASSWORD_REAUTH_FAILED", now },
    transaction,
  );
  return failure("MFA_PASSWORD_REAUTH_FAILED");
}

async function applyMfaRateLimit(
  userId: string,
  sessionId: string,
  hashes: ReturnType<typeof mfaRateLimitHashes>,
  transaction: MfaTransaction,
  now: Date,
) {
  if (!hashes.identifierHash) return true;
  await acquireMfaRateLimitLocks(
    {
      userId,
      sessionId,
      identifierHash: hashes.identifierHash,
      ipAddressHash: hashes.ipAddressHash,
    },
    transaction,
  );
  const limit = await checkMfaRateLimit(
    {
      userId,
      sessionId,
      identifierHash: hashes.identifierHash,
      ipAddressHash: hashes.ipAddressHash,
      now,
    },
    transaction,
  );
  if (limit.allowed) return false;
  await writeAuthSecurityEvent(
    {
      eventType: "MFA_VERIFICATION_RATE_LIMITED",
      surface: MFA_SECURITY_SURFACE,
      outcome: "RATE_LIMITED",
      ...hashes,
      userId,
      sessionId,
      reason: limit.reasons.join("+"),
      createdAt: now,
    },
    transaction,
  );
  return true;
}

async function failedMfaEvent(
  args: {
    input: { userId: string; sessionId: string; actionKey?: string | null };
    hashes: ReturnType<typeof mfaRateLimitHashes>;
    reason: string;
    now: Date;
  },
  transaction: MfaTransaction,
) {
  await writeAuthSecurityEvent(
    {
      eventType: "MFA_VERIFICATION_FAILED",
      surface: MFA_SECURITY_SURFACE,
      outcome: "FAILURE",
      ...args.hashes,
      userId: args.input.userId,
      sessionId: args.input.sessionId,
      reason: args.reason,
      ...(args.input.actionKey
        ? { metadata: { actionKey: args.input.actionKey } }
        : {}),
      createdAt: args.now,
    },
    transaction,
  );
}

async function successfulMfaEvent(
  args: {
    input: { userId: string; sessionId: string; actionKey?: string | null };
    hashes: ReturnType<typeof mfaRateLimitHashes>;
    credentialId: string;
    method: "TOTP" | "RECOVERY_CODE";
    now: Date;
  },
  transaction: MfaTransaction,
) {
  await writeAuthSecurityEvent(
    {
      eventType: "MFA_VERIFICATION_SUCCEEDED",
      surface: MFA_SECURITY_SURFACE,
      outcome: "SUCCESS",
      ...args.hashes,
      userId: args.input.userId,
      sessionId: args.input.sessionId,
      metadata: {
        credentialId: args.credentialId,
        method: args.method,
        ...(args.input.actionKey ? { actionKey: args.input.actionKey } : {}),
      },
      createdAt: args.now,
    },
    transaction,
  );
}

async function lockUserMfa(userId: string, transaction: MfaTransaction) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mfa-user:${userId}`}, 0))::text AS acquired`,
  );
}

function failure(code: MfaErrorCode) {
  return { ok: false as const, code };
}
