import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import {
  consumeSensitiveActionAuthorization,
  SensitiveActionError,
  verifySensitiveActionPassword,
} from "../../src/lib/auth/sensitive-action-service";
import { SENSITIVE_ACTION_STEP_UP_SCOPE_LIMIT } from "../../src/lib/auth/security";
import {
  persistSessionContext,
  revokeUserSessions,
} from "../../src/lib/auth/session";

const prisma = new PrismaClient();
const TEST_SECRET = "step-up-integration-secret-0123456789abcdef";

test("password step-up is session/action/resource bound, short-lived and one-time", async () => {
  assertLocalDatabase();
  const previousSecret = process.env.SESSION_SECRET;
  const previousMfaEnabled = process.env.TETAMU_MFA_ENABLED;
  process.env.SESSION_SECRET = TEST_SECRET;
  const suffix = randomUUID().slice(0, 8);
  const password = `StepUp-${suffix}-Password!`;
  const changedPassword = `Changed-${suffix}-Password!`;
  const user = await prisma.user.create({
    data: {
      name: `Step-up QA ${suffix}`,
      email: `step-up-${suffix}@example.test`,
      passwordHash: await bcrypt.hash(password, 12),
      role: "PLATFORM_ADMIN",
      permissions: ["SENSITIVE_ACTION_QA"],
    },
  });
  const base = new Date("2026-08-10T10:00:00.000Z");
  const sessionIds: string[] = [];

  const createSession = async (now = base) => {
    const sessionId = randomUUID();
    sessionIds.push(sessionId);
    await persistSessionContext(
      {
        userId: user.id,
        sessionId,
        homeBusinessId: null,
        activeBusinessId: null,
        contextVersion: 1,
        branchId: null,
        name: user.name,
        email: user.email!,
        role: "PLATFORM_ADMIN",
        permissions: ["SENSITIVE_ACTION_QA"],
        status: "active",
      },
      { now },
    );
    return sessionId;
  };

  const scope = {
    actionKey: "HIGH_RISK_PERMISSION_CHANGE" as const,
    resourceType: "USER",
    resourceId: `fixture-${suffix}`,
    businessId: null,
  };

  try {
    const sessionId = await createSession();
    await assert.rejects(
      verifySensitiveActionPassword({
        ...scope,
        userId: user.id,
        sessionId,
        password: "wrong-password",
        request: { ipAddress: "203.0.113.40", userAgent: "Step-up Integration" },
      }, { now: base }),
      (error: unknown) => sensitiveCode(error) === "STEP_UP_FAILED",
    );

    const verified = await verifySensitiveActionPassword({
      ...scope,
      userId: user.id,
      sessionId,
      password,
      request: { ipAddress: "203.0.113.40", userAgent: "Step-up Integration" },
    }, { now: new Date(base.getTime() + 1_000) });
    assert.equal(verified.authorization.assuranceLevel, "REAUTH");
    assert.equal(verified.authorization.verificationMethod, "PASSWORD_REAUTH");
    assert.equal(verified.authorization.tokenHash.includes(verified.rawToken), false);
    assert.equal(
      verified.authorization.expiresAt.getTime() -
        verified.authorization.issuedAt.getTime(),
      5 * 60 * 1_000,
    );

    await assert.rejects(
      consumeSensitiveActionAuthorization({
        ...scope,
        resourceId: `other-${suffix}`,
        userId: user.id,
        sessionId,
        rawToken: verified.rawToken,
      }, { now: new Date(base.getTime() + 2_000) }),
      (error: unknown) => sensitiveCode(error) === "STEP_UP_SCOPE_MISMATCH",
    );

    const otherSessionId = await createSession(new Date(base.getTime() + 2_000));
    await assert.rejects(
      consumeSensitiveActionAuthorization({
        ...scope,
        userId: user.id,
        sessionId: otherSessionId,
        rawToken: verified.rawToken,
      }, { now: new Date(base.getTime() + 3_000) }),
      (error: unknown) => sensitiveCode(error) === "STEP_UP_SESSION_MISMATCH",
    );

    const consumed = await consumeSensitiveActionAuthorization({
      ...scope,
      userId: user.id,
      sessionId,
      rawToken: verified.rawToken,
    }, { now: new Date(base.getTime() + 4_000) });
    assert.ok(consumed.consumedAt);
    await assert.rejects(
      consumeSensitiveActionAuthorization({
        ...scope,
        userId: user.id,
        sessionId,
        rawToken: verified.rawToken,
      }, { now: new Date(base.getTime() + 5_000) }),
      (error: unknown) => sensitiveCode(error) === "STEP_UP_ALREADY_CONSUMED",
    );

    const expiring = await verifySensitiveActionPassword({
      ...scope,
      resourceId: `expiry-${suffix}`,
      userId: user.id,
      sessionId,
      password,
      request: { ipAddress: null, userAgent: "Step-up Integration" },
    }, { now: new Date(base.getTime() + 10_000) });
    await assert.rejects(
      consumeSensitiveActionAuthorization({
        ...scope,
        resourceId: `expiry-${suffix}`,
        userId: user.id,
        sessionId,
        rawToken: expiring.rawToken,
      }, { now: new Date(base.getTime() + 311_000) }),
      (error: unknown) => sensitiveCode(error) === "STEP_UP_EXPIRED",
    );

    const concurrent = await verifySensitiveActionPassword({
      ...scope,
      resourceId: `concurrent-${suffix}`,
      userId: user.id,
      sessionId,
      password,
      request: { ipAddress: null, userAgent: "Step-up Integration" },
    }, { now: new Date(base.getTime() + 20_000) });
    const concurrentResults = await Promise.allSettled([
      consumeSensitiveActionAuthorization({
        ...scope,
        resourceId: `concurrent-${suffix}`,
        userId: user.id,
        sessionId,
        rawToken: concurrent.rawToken,
      }, { now: new Date(base.getTime() + 21_000) }),
      consumeSensitiveActionAuthorization({
        ...scope,
        resourceId: `concurrent-${suffix}`,
        userId: user.id,
        sessionId,
        rawToken: concurrent.rawToken,
      }, { now: new Date(base.getTime() + 21_000) }),
    ]);
    assert.equal(
      concurrentResults.filter((result) => result.status === "fulfilled").length,
      1,
    );

    const oldCredential = await verifySensitiveActionPassword({
      ...scope,
      resourceId: `password-change-${suffix}`,
      userId: user.id,
      sessionId,
      password,
      request: { ipAddress: null, userAgent: "Step-up Integration" },
    }, { now: new Date(base.getTime() + 30_000) });
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(changedPassword, 12) },
    });
    await revokeUserSessions(user.id, "Integration password change.", prisma,
      new Date(base.getTime() + 31_000));
    await assert.rejects(
      consumeSensitiveActionAuthorization({
        ...scope,
        resourceId: `password-change-${suffix}`,
        userId: user.id,
        sessionId,
        rawToken: oldCredential.rawToken,
      }, { now: new Date(base.getTime() + 32_000) }),
      (error: unknown) => sensitiveCode(error) === "STEP_UP_REQUIRED",
    );

    const freshSessionId = await createSession(new Date(base.getTime() + 40_000));
    await assert.rejects(
      verifySensitiveActionPassword({
        ...scope,
        resourceId: `old-password-${suffix}`,
        userId: user.id,
        sessionId: freshSessionId,
        password,
        request: { ipAddress: null, userAgent: "Step-up Integration" },
      }, { now: new Date(base.getTime() + 41_000) }),
      (error: unknown) => sensitiveCode(error) === "STEP_UP_FAILED",
    );

    for (let attempt = 0; attempt < SENSITIVE_ACTION_STEP_UP_SCOPE_LIMIT; attempt += 1) {
      await assert.rejects(
        verifySensitiveActionPassword({
          ...scope,
          resourceId: `rate-limit-${suffix}`,
          userId: user.id,
          sessionId: freshSessionId,
          password: `wrong-${attempt}`,
          request: { ipAddress: null, userAgent: "Step-up Integration" },
        }, { now: new Date(base.getTime() + 50_000 + attempt) }),
        (error: unknown) => sensitiveCode(error) === "STEP_UP_FAILED",
      );
    }
    await assert.rejects(
      verifySensitiveActionPassword({
        ...scope,
        resourceId: `rate-limit-${suffix}`,
        userId: user.id,
        sessionId: freshSessionId,
        password: changedPassword,
        request: { ipAddress: null, userAgent: "Step-up Integration" },
      }, { now: new Date(base.getTime() + 60_000) }),
      (error: unknown) => sensitiveCode(error) === "STEP_UP_RATE_LIMITED",
    );

    process.env.TETAMU_MFA_ENABLED = "false";
    const bypassed = await consumeSensitiveActionAuthorization({
      ...scope,
      resourceId: `mfa-disabled-${suffix}`,
      userId: user.id,
      sessionId: freshSessionId,
      rawToken: null,
    }, { now: new Date(base.getTime() + 70_000) });
    assert.equal(bypassed.verificationMethod, "MFA_TEMPORARILY_DISABLED");
    assert.ok(bypassed.consumedAt);
    assert.ok(bypassed.expiresAt.getTime() > bypassed.issuedAt.getTime());
    process.env.TETAMU_MFA_ENABLED = previousMfaEnabled;

    const events = await prisma.authSecurityEvent.findMany({
      where: { userId: user.id, surface: "SENSITIVE_ACTION_STEP_UP" },
    });
    assert.ok(events.some((event) => event.eventType === "STEP_UP_FAILED"));
    assert.ok(events.some((event) => event.eventType === "STEP_UP_VERIFIED"));
    assert.ok(events.some((event) => event.eventType === "STEP_UP_CONSUMED"));
    assert.ok(events.some((event) => event.eventType === "STEP_UP_RATE_LIMITED"));
    const serialized = JSON.stringify(events);
    assert.equal(serialized.includes(password), false);
    assert.equal(serialized.includes(changedPassword), false);
    assert.equal(serialized.includes(concurrent.rawToken), false);
  } finally {
    await prisma.authSecurityEvent.deleteMany({ where: { userId: user.id } });
    await prisma.sensitiveActionAuthorization.deleteMany({
      where: { userId: user.id },
    });
    await prisma.authSession.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.user.delete({ where: { id: user.id } });
    process.env.SESSION_SECRET = previousSecret;
    process.env.TETAMU_MFA_ENABLED = previousMfaEnabled;
    await prisma.$disconnect();
  }
});

function sensitiveCode(error: unknown) {
  return error instanceof SensitiveActionError ? error.code : null;
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error("Step-up integration tests are restricted to Local database.");
  }
}
