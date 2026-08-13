import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { hashSensitiveActionToken } from "../../src/lib/auth/sensitive-action-service";
import {
  getSensitiveActionPolicy,
  type SensitiveActionKey,
} from "../../src/lib/auth/sensitive-actions";

export async function issueTestHighRiskStepUp(
  database: PrismaClient,
  input: {
    actionKey: SensitiveActionKey;
    businessId: string;
    resourceId: string;
    userId: string;
  },
) {
  const now = new Date();
  const sessionId = randomUUID();
  const rawToken = randomBytes(32).toString("base64url");
  const policy = getSensitiveActionPolicy(input.actionKey);
  await database.authSession.create({
    data: {
      absoluteExpiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
      activeBusinessId: input.businessId,
      contextVersion: 1,
      id: sessionId,
      idleExpiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
      userId: input.userId,
    },
  });
  const authorization = await database.sensitiveActionAuthorization.create({
    data: {
      actionKey: input.actionKey,
      assuranceLevel: "MFA",
      authSessionId: sessionId,
      businessId: input.businessId,
      expiresAt: new Date(now.getTime() + policy.ttlSeconds * 1_000),
      issuedAt: now,
      resourceId: input.resourceId,
      resourceType: policy.resourceType,
      tokenHash: hashSensitiveActionToken(rawToken),
      userId: input.userId,
      verificationMethod: "TOTP",
    },
  });
  return {
    authorizationId: authorization.id,
    stepUp: { rawToken, sessionId },
  };
}
