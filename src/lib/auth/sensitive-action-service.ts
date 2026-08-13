import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyPasswordHash } from "./password-login";
import { MfaError } from "./mfa-errors";
import {
  type MfaFactorInput,
  type MfaTransaction,
  verifyMfaFactorInTransaction,
} from "./mfa-service";
import {
  acquireSensitiveActionRateLimitLocks,
  checkSensitiveActionRateLimit,
  type AuthRequestContext,
  SENSITIVE_ACTION_STEP_UP_SURFACE,
  sensitiveActionRateLimitHashes,
  writeAuthSecurityEvent,
} from "./security";
import {
  assuranceSatisfies,
  getSensitiveActionPolicy,
  type SensitiveActionAssurance,
  type SensitiveActionKey,
} from "./sensitive-actions";

export const SENSITIVE_ACTION_COOKIE = "tetamu_sensitive_action";

type SensitiveActionDatabase = Pick<PrismaClient, "$transaction">;

type SensitiveActionTransaction = Pick<
  Prisma.TransactionClient,
  | "authSecurityEvent"
  | "authSession"
  | "sensitiveActionAuthorization"
  | "user"
  | "userMfaCredential"
  | "userMfaRecoveryCode"
  | "$queryRaw"
>;

export type SensitiveActionScope = Readonly<{
  actionKey: SensitiveActionKey;
  resourceType: string;
  resourceId: string;
  businessId: string | null;
  requestFingerprint?: string | null;
}>;

export class SensitiveActionError extends Error {
  constructor(
    public readonly code:
      | "STEP_UP_REQUIRED"
      | "STEP_UP_FAILED"
      | "STEP_UP_RATE_LIMITED"
      | "STEP_UP_EXPIRED"
      | "STEP_UP_SCOPE_MISMATCH"
      | "STEP_UP_SESSION_MISMATCH"
      | "STEP_UP_ALREADY_CONSUMED"
      | "MFA_REQUIRED"
      | "MFA_NOT_ENROLLED"
      | "MFA_RATE_LIMITED"
      | "MFA_REPLAYED"
      | "MFA_VERIFICATION_FAILED",
  ) {
    super(code);
    this.name = "SensitiveActionError";
  }
}

export async function verifySensitiveActionMfa(
  input: SensitiveActionScope & {
    userId: string;
    sessionId: string;
    password: string;
    factor: MfaFactorInput;
    request: AuthRequestContext;
  },
  dependencies: { database?: SensitiveActionDatabase; now?: Date } = {},
) {
  const policy = getSensitiveActionPolicy(input.actionKey);
  assertScopeMatchesPolicy(input, policy.resourceType);
  const database = dependencies.database ?? prisma;
  const now = dependencies.now ?? new Date();
  const hashes = sensitiveActionRateLimitHashes({
    userId: input.userId,
    sessionId: input.sessionId,
    actionKey: input.actionKey,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    ipAddress: input.request.ipAddress,
    userAgent: input.request.userAgent,
  });
  const identifierHash = hashes.identifierHash;
  if (!identifierHash) throw new SensitiveActionError("MFA_VERIFICATION_FAILED");

  const result = await database.$transaction(
    async (transaction: SensitiveActionTransaction) => {
      await acquireSensitiveActionRateLimitLocks(
        {
          userId: input.userId,
          identifierHash,
          ipAddressHash: hashes.ipAddressHash,
        },
        transaction,
      );
      const limit = await checkSensitiveActionRateLimit(
        {
          userId: input.userId,
          identifierHash,
          ipAddressHash: hashes.ipAddressHash,
          now,
        },
        transaction,
      );
      if (!limit.allowed) {
        await writeAuthSecurityEvent(
          {
            eventType: "STEP_UP_RATE_LIMITED",
            surface: SENSITIVE_ACTION_STEP_UP_SURFACE,
            outcome: "RATE_LIMITED",
            ...hashes,
            userId: input.userId,
            businessId: input.businessId,
            sessionId: input.sessionId,
            reason: limit.reasons.join("+"),
            metadata: eventMetadata(input, "TOTP", "MFA"),
            createdAt: now,
          },
          transaction,
        );
        return { ok: false as const, code: "STEP_UP_RATE_LIMITED" as const };
      }
      const session = await transaction.authSession.findUnique({
        where: { id: input.sessionId },
        include: {
          user: {
            select: {
              id: true,
              passwordHash: true,
              status: true,
              loginEnabled: true,
            },
          },
        },
      });
      const usable = Boolean(
        session &&
          session.userId === input.userId &&
          session.activeBusinessId === input.businessId &&
          !session.revokedAt &&
          session.absoluteExpiresAt.getTime() > now.getTime() &&
          session.idleExpiresAt.getTime() > now.getTime() &&
          session.user.id === input.userId &&
          session.user.status === "active" &&
          session.user.loginEnabled &&
          session.user.passwordHash,
      );
      const passwordValid = await verifyPasswordHash(
        input.password,
        usable ? session?.user.passwordHash : null,
      );
      if (!usable || !passwordValid) {
        await writeAuthSecurityEvent(
          {
            eventType: "STEP_UP_FAILED",
            surface: SENSITIVE_ACTION_STEP_UP_SURFACE,
            outcome: "FAILURE",
            ...hashes,
            userId: input.userId,
            businessId: input.businessId,
            sessionId: input.sessionId,
            reason: "PASSWORD_REAUTH_FAILED",
            metadata: eventMetadata(input, "TOTP", "MFA"),
            createdAt: now,
          },
          transaction,
        );
        return { ok: false as const, code: "MFA_VERIFICATION_FAILED" as const };
      }
      const factor = await verifyMfaFactorInTransaction(
        {
          userId: input.userId,
          sessionId: input.sessionId,
          factor: input.factor,
          request: input.request,
          actionKey: input.actionKey,
        },
        transaction as MfaTransaction,
        now,
      );
      if (!factor.ok) {
        const code = sensitiveMfaCode(factor.code);
        await writeAuthSecurityEvent(
          {
            eventType: "STEP_UP_FAILED",
            surface: SENSITIVE_ACTION_STEP_UP_SURFACE,
            outcome: code === "MFA_RATE_LIMITED" ? "RATE_LIMITED" : "FAILURE",
            ...hashes,
            userId: input.userId,
            businessId: input.businessId,
            sessionId: input.sessionId,
            reason: code,
            metadata: eventMetadata(input, "TOTP", "MFA"),
            createdAt: now,
          },
          transaction,
        );
        return { ok: false as const, code };
      }
      const rawToken = randomBytes(32).toString("base64url");
      const tokenHash = hashSensitiveActionToken(rawToken);
      const expiresAt = new Date(now.getTime() + policy.ttlSeconds * 1_000);
      await transaction.sensitiveActionAuthorization.updateMany({
        where: {
          userId: input.userId,
          authSessionId: input.sessionId,
          actionKey: input.actionKey,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          businessId: input.businessId,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now, revokeReason: "SUPERSEDED" },
      });
      const authorization = await transaction.sensitiveActionAuthorization.create({
        data: {
          tokenHash,
          userId: input.userId,
          authSessionId: input.sessionId,
          businessId: input.businessId,
          actionKey: input.actionKey,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          verificationMethod: factor.verificationMethod,
          assuranceLevel: "MFA",
          requestFingerprint: normalizeFingerprint(
            input.requestFingerprint ?? null,
          ),
          issuedAt: now,
          expiresAt,
        },
      });
      await writeAuthSecurityEvent(
        {
          eventType: "STEP_UP_VERIFIED",
          surface: SENSITIVE_ACTION_STEP_UP_SURFACE,
          outcome: "SUCCESS",
          ...hashes,
          userId: input.userId,
          businessId: input.businessId,
          sessionId: input.sessionId,
          metadata: {
            ...eventMetadata(
              input,
              factor.verificationMethod,
              "MFA",
            ),
            authorizationId: authorization.id,
            expiresAt: expiresAt.toISOString(),
          },
          createdAt: now,
        },
        transaction,
      );
      return { ok: true as const, authorization, rawToken };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (!result.ok) throw new SensitiveActionError(result.code);
  return result;
}

export async function verifySensitiveActionPassword(
  input: SensitiveActionScope & {
    userId: string;
    sessionId: string;
    password: string;
    request: AuthRequestContext;
  },
  dependencies: { database?: SensitiveActionDatabase; now?: Date } = {},
) {
  const policy = getSensitiveActionPolicy(input.actionKey);
  assertScopeMatchesPolicy(input, policy.resourceType);
  if (policy.requiredAssurance === "MFA") {
    throw new SensitiveActionError("MFA_REQUIRED");
  }
  const database = dependencies.database ?? prisma;
  const now = dependencies.now ?? new Date();
  const hashes = sensitiveActionRateLimitHashes({
    userId: input.userId,
    sessionId: input.sessionId,
    actionKey: input.actionKey,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    ipAddress: input.request.ipAddress,
    userAgent: input.request.userAgent,
  });
  const identifierHash = hashes.identifierHash;
  if (!identifierHash) throw new SensitiveActionError("STEP_UP_FAILED");

  const result = await database.$transaction(
    async (transaction: SensitiveActionTransaction) => {
      await acquireSensitiveActionRateLimitLocks(
        {
          userId: input.userId,
          identifierHash,
          ipAddressHash: hashes.ipAddressHash,
        },
        transaction,
      );
      const limit = await checkSensitiveActionRateLimit(
        {
          userId: input.userId,
          identifierHash,
          ipAddressHash: hashes.ipAddressHash,
          now,
        },
        transaction,
      );
      if (!limit.allowed) {
        await writeAuthSecurityEvent(
          {
            eventType: "STEP_UP_RATE_LIMITED",
            surface: SENSITIVE_ACTION_STEP_UP_SURFACE,
            outcome: "RATE_LIMITED",
            ...hashes,
            userId: input.userId,
            businessId: input.businessId,
            sessionId: input.sessionId,
            reason: limit.reasons.join("+"),
            metadata: eventMetadata(input, "PASSWORD_REAUTH", "REAUTH"),
            createdAt: now,
          },
          transaction,
        );
        return {
          ok: false as const,
          code: "STEP_UP_RATE_LIMITED" as const,
        };
      }

      const session = await transaction.authSession.findUnique({
        where: { id: input.sessionId },
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
      const usable = Boolean(
        session &&
          session.userId === input.userId &&
          session.activeBusinessId === input.businessId &&
          !session.revokedAt &&
          session.absoluteExpiresAt.getTime() > now.getTime() &&
          session.idleExpiresAt.getTime() > now.getTime() &&
          session.user.id === input.userId &&
          session.user.status === "active" &&
          session.user.loginEnabled &&
          session.user.email &&
          session.user.passwordHash,
      );
      const passwordValid = await verifyPasswordHash(
        input.password,
        usable ? session?.user.passwordHash : null,
      );
      if (!usable || !passwordValid) {
        await writeAuthSecurityEvent(
          {
            eventType: "STEP_UP_FAILED",
            surface: SENSITIVE_ACTION_STEP_UP_SURFACE,
            outcome: "FAILURE",
            ...hashes,
            userId: input.userId,
            businessId: input.businessId,
            sessionId: input.sessionId,
            reason: "VERIFICATION_FAILED",
            metadata: eventMetadata(input, "PASSWORD_REAUTH", "REAUTH"),
            createdAt: now,
          },
          transaction,
        );
        return { ok: false as const, code: "STEP_UP_FAILED" as const };
      }

      const rawToken = randomBytes(32).toString("base64url");
      const tokenHash = hashSensitiveActionToken(rawToken);
      const expiresAt = new Date(now.getTime() + policy.ttlSeconds * 1_000);
      await transaction.sensitiveActionAuthorization.updateMany({
        where: {
          userId: input.userId,
          authSessionId: input.sessionId,
          actionKey: input.actionKey,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          businessId: input.businessId,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now, revokeReason: "SUPERSEDED" },
      });
      const authorization =
        await transaction.sensitiveActionAuthorization.create({
          data: {
            tokenHash,
            userId: input.userId,
            authSessionId: input.sessionId,
            businessId: input.businessId,
            actionKey: input.actionKey,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            verificationMethod: "PASSWORD_REAUTH",
            assuranceLevel: "REAUTH",
            requestFingerprint: normalizeFingerprint(
              input.requestFingerprint ?? null,
            ),
            issuedAt: now,
            expiresAt,
          },
        });
      await writeAuthSecurityEvent(
        {
          eventType: "STEP_UP_VERIFIED",
          surface: SENSITIVE_ACTION_STEP_UP_SURFACE,
          outcome: "SUCCESS",
          ...hashes,
          userId: input.userId,
          businessId: input.businessId,
          sessionId: input.sessionId,
          metadata: {
            ...eventMetadata(input, "PASSWORD_REAUTH", "REAUTH"),
            authorizationId: authorization.id,
            expiresAt: expiresAt.toISOString(),
          },
          createdAt: now,
        },
        transaction,
      );
      return { ok: true as const, authorization, rawToken };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (!result.ok) throw new SensitiveActionError(result.code);
  return {
    authorization: result.authorization,
    rawToken: result.rawToken,
  };
}

export async function consumeSensitiveActionAuthorization(
  input: SensitiveActionScope & {
    userId: string;
    sessionId: string;
    rawToken: string | null | undefined;
  },
  dependencies: { database?: SensitiveActionDatabase; now?: Date } = {},
) {
  const policy = getSensitiveActionPolicy(input.actionKey);
  assertScopeMatchesPolicy(input, policy.resourceType);
  if (!input.rawToken) throw new SensitiveActionError("STEP_UP_REQUIRED");
  const database = dependencies.database ?? prisma;
  const now = dependencies.now ?? new Date();
  return database.$transaction(
    (transaction: SensitiveActionTransaction) =>
      consumeSensitiveActionAuthorizationInTransaction(input, transaction, now),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function consumeSensitiveActionAuthorizationInTransaction(
  input: SensitiveActionScope & {
    userId: string;
    sessionId: string;
    rawToken: string | null | undefined;
  },
  transaction: SensitiveActionTransaction,
  now = new Date(),
) {
  const policy = getSensitiveActionPolicy(input.actionKey);
  assertScopeMatchesPolicy(input, policy.resourceType);
  if (!input.rawToken) throw new SensitiveActionError("STEP_UP_REQUIRED");
  const tokenHash = hashSensitiveActionToken(input.rawToken);
  const authorization =
    await transaction.sensitiveActionAuthorization.findUnique({
          where: { tokenHash },
          include: {
            authSession: true,
            user: {
              select: { id: true, status: true, loginEnabled: true },
            },
          },
        });
      if (!authorization) {
        throw new SensitiveActionError("STEP_UP_REQUIRED");
      }
      if (
        authorization.userId !== input.userId ||
        authorization.authSessionId !== input.sessionId
      ) {
        throw new SensitiveActionError("STEP_UP_SESSION_MISMATCH");
      }
      if (
        authorization.actionKey !== input.actionKey ||
        authorization.resourceType !== input.resourceType ||
        authorization.resourceId !== input.resourceId ||
        authorization.businessId !== input.businessId ||
        authorization.requestFingerprint !==
          normalizeFingerprint(input.requestFingerprint ?? null)
      ) {
        throw new SensitiveActionError("STEP_UP_SCOPE_MISMATCH");
      }
      if (authorization.consumedAt) {
        throw new SensitiveActionError("STEP_UP_ALREADY_CONSUMED");
      }
      if (authorization.revokedAt) {
        throw new SensitiveActionError("STEP_UP_REQUIRED");
      }
      if (authorization.expiresAt.getTime() <= now.getTime()) {
        throw new SensitiveActionError("STEP_UP_EXPIRED");
      }
      if (
        authorization.authSession.revokedAt ||
        authorization.authSession.absoluteExpiresAt.getTime() <= now.getTime() ||
        authorization.authSession.idleExpiresAt.getTime() <= now.getTime() ||
        authorization.user.status !== "active" ||
        !authorization.user.loginEnabled
      ) {
        throw new SensitiveActionError("STEP_UP_REQUIRED");
      }
      if (
        !assuranceSatisfies(
          authorization.assuranceLevel as SensitiveActionAssurance,
          policy.requiredAssurance,
        )
      ) {
        throw new SensitiveActionError("MFA_REQUIRED");
      }

      const consumed =
        await transaction.sensitiveActionAuthorization.updateMany({
          where: {
            id: authorization.id,
            tokenHash,
            userId: input.userId,
            authSessionId: input.sessionId,
            actionKey: input.actionKey,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            businessId: input.businessId,
            consumedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { consumedAt: now },
        });
      if (consumed.count !== 1) {
        throw new SensitiveActionError("STEP_UP_ALREADY_CONSUMED");
      }
      await writeAuthSecurityEvent(
        {
          eventType: "STEP_UP_CONSUMED",
          surface: SENSITIVE_ACTION_STEP_UP_SURFACE,
          outcome: "SUCCESS",
          userId: input.userId,
          businessId: input.businessId,
          sessionId: input.sessionId,
          metadata: {
            ...eventMetadata(
              input,
              authorization.verificationMethod,
              authorization.assuranceLevel,
            ),
            authorizationId: authorization.id,
          },
          createdAt: now,
        },
        transaction,
      );
  return { ...authorization, consumedAt: now };
}

export function hashSensitiveActionToken(rawToken: string) {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function sensitiveActionCookieOptions(
  maxAgeSeconds: number,
  env: NodeJS.ProcessEnv = process.env,
) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

function assertScopeMatchesPolicy(
  input: SensitiveActionScope,
  expectedResourceType: string,
) {
  if (
    input.resourceType !== expectedResourceType ||
    !input.resourceId.trim() ||
    input.resourceId.length > 200
  ) {
    throw new SensitiveActionError("STEP_UP_SCOPE_MISMATCH");
  }
  normalizeFingerprint(input.requestFingerprint ?? null);
}

function normalizeFingerprint(value: string | null) {
  if (value === null || value === "") return null;
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new SensitiveActionError("STEP_UP_SCOPE_MISMATCH");
  }
  return value;
}

function eventMetadata(
  input: SensitiveActionScope,
  method: string,
  assurance: string,
) {
  return {
    actionKey: input.actionKey,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    verificationMethod: method,
    assuranceLevel: assurance,
  } satisfies Prisma.InputJsonObject;
}

function sensitiveMfaCode(code: MfaError["code"]):
  | "MFA_NOT_ENROLLED"
  | "MFA_RATE_LIMITED"
  | "MFA_REPLAYED"
  | "MFA_VERIFICATION_FAILED" {
  if (code === "MFA_NOT_ENROLLED") return code;
  if (code === "MFA_RATE_LIMITED") return code;
  if (code === "MFA_REPLAYED") return code;
  return "MFA_VERIFICATION_FAILED";
}
