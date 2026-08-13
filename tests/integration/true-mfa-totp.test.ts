import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { MfaError } from "../../src/lib/auth/mfa-errors";
import {
  beginMfaEnrollment,
  completeMfaEnrollment,
  disableMfa,
  getMfaSecurityState,
  regenerateRecoveryCodes,
} from "../../src/lib/auth/mfa-service";
import { generateTotpCode } from "../../src/lib/auth/mfa-totp";
import {
  consumeSensitiveActionAuthorization,
  SensitiveActionError,
  verifySensitiveActionMfa,
} from "../../src/lib/auth/sensitive-action-service";
import {
  persistSessionContext,
  revokeUserSessions,
} from "../../src/lib/auth/session";
import {
  signOffStatutoryRule,
  statutoryRuleEvidenceDigest,
} from "../../src/lib/payroll/statutory-activation-service";

const prisma = new PrismaClient();
const SESSION_SECRET = "true-mfa-integration-session-secret-0123456789";
const MFA_KEYRING = JSON.stringify({
  "integration-v1": Buffer.alloc(32, 23).toString("base64"),
});
const request = { ipAddress: "203.0.113.81", userAgent: "True MFA Integration" };

test("TOTP enrollment stays pending until verified and recovery codes are shown once", async () => {
  const fixture = await createFixture();
  const base = new Date("2026-08-10T12:00:00.000Z");
  try {
    const pending = await beginMfaEnrollment(
      {
        userId: fixture.user.id,
        sessionId: fixture.sessionId,
        password: fixture.password,
        request,
      },
      { now: base },
    );
    const storedPending = await prisma.userMfaCredential.findUniqueOrThrow({
      where: { id: pending.credential.id },
    });
    assert.equal(storedPending.status, "PENDING");
    assert.equal(
      Buffer.from(storedPending.encryptedSecret).toString("utf8").includes(pending.manualSecret),
      false,
    );
    await assert.rejects(
      completeMfaEnrollment(
        {
          userId: fixture.user.id,
          sessionId: fixture.sessionId,
          credentialId: pending.credential.id,
          code: "not-six-digits",
          request,
        },
        { now: new Date(base.getTime() + 1_000) },
      ),
      (error: unknown) => mfaCode(error) === "MFA_VERIFICATION_FAILED",
    );
    assert.equal(
      (await prisma.userMfaCredential.findUniqueOrThrow({ where: { id: pending.credential.id } })).status,
      "PENDING",
    );
    const completedAt = new Date(base.getTime() + 30_000);
    const completed = await completeMfaEnrollment(
      {
        userId: fixture.user.id,
        sessionId: fixture.sessionId,
        credentialId: pending.credential.id,
        code: generateTotpCode({ secret: pending.manualSecret, timestamp: completedAt.getTime() }),
        request,
      },
      { now: completedAt },
    );
    assert.equal(completed.recoveryCodes.length, 10);
    assert.equal(new Set(completed.recoveryCodes).size, 10);
    const active = await prisma.userMfaCredential.findUniqueOrThrow({
      where: { id: pending.credential.id },
      include: { recoveryCodes: true },
    });
    assert.equal(active.status, "ACTIVE");
    assert.equal(active.recoveryCodes.length, 10);
    assert.equal(
      active.recoveryCodes.some((item) => completed.recoveryCodes.includes(item.codeHash)),
      false,
    );
    const state = await getMfaSecurityState({
      userId: fixture.user.id,
      sessionId: fixture.sessionId,
      now: completedAt,
    });
    assert.equal(state.status, "ENROLLED");
    assert.equal(state.recoveryCodesAvailable, 10);
    await assert.rejects(
      completeMfaEnrollment(
        {
          userId: fixture.user.id,
          sessionId: fixture.sessionId,
          credentialId: pending.credential.id,
          code: generateTotpCode({ secret: pending.manualSecret, timestamp: completedAt.getTime() }),
          request,
        },
        { now: completedAt },
      ),
      (error: unknown) => mfaCode(error) === "MFA_ALREADY_ENROLLED",
    );
    const events = await prisma.authSecurityEvent.findMany({
      where: { userId: fixture.user.id, surface: "MFA_SECURITY" },
    });
    assert.ok(events.some((event) => event.eventType === "MFA_ENROLLMENT_STARTED"));
    assert.ok(events.some((event) => event.eventType === "MFA_ENROLLMENT_COMPLETED"));
    const serialized = JSON.stringify(events);
    assert.equal(serialized.includes(pending.manualSecret), false);
    assert.equal(completed.recoveryCodes.some((code) => serialized.includes(code)), false);
    await prisma.authSession.delete({ where: { id: fixture.sessionId } });
    assert.equal(
      await prisma.userMfaCredential.count({ where: { id: pending.credential.id, status: "ACTIVE" } }),
      1,
    );
  } finally {
    await cleanupFixture(fixture.user.id);
  }
});

test("pending enrollment is session-bound, expires, and concurrent confirmation has one winner", async () => {
  const fixture = await createFixture();
  const base = new Date("2026-08-10T12:30:00.000Z");
  try {
    const pending = await beginMfaEnrollment(
      {
        userId: fixture.user.id,
        sessionId: fixture.sessionId,
        password: fixture.password,
        request,
      },
      { now: base },
    );
    const otherSessionId = randomUUID();
    await persistSessionContext({
      userId: fixture.user.id,
      sessionId: otherSessionId,
      homeBusinessId: null,
      activeBusinessId: null,
      contextVersion: 1,
      branchId: null,
      name: fixture.user.name,
      email: fixture.user.email!,
      role: fixture.user.role,
      permissions: fixture.user.permissions,
      status: fixture.user.status,
    }, { now: base });
    const confirmedAt = new Date(base.getTime() + 30_000);
    const code = generateTotpCode({ secret: pending.manualSecret, timestamp: confirmedAt.getTime() });
    await assert.rejects(
      completeMfaEnrollment({
        userId: fixture.user.id,
        sessionId: otherSessionId,
        credentialId: pending.credential.id,
        code,
        request,
      }, { now: confirmedAt }),
      (error: unknown) => mfaCode(error) === "MFA_ENROLLMENT_SESSION_MISMATCH",
    );
    const results = await Promise.allSettled([
      completeMfaEnrollment({
        userId: fixture.user.id,
        sessionId: fixture.sessionId,
        credentialId: pending.credential.id,
        code,
        request,
      }, { now: confirmedAt }),
      completeMfaEnrollment({
        userId: fixture.user.id,
        sessionId: fixture.sessionId,
        credentialId: pending.credential.id,
        code,
        request,
      }, { now: confirmedAt }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(
      await prisma.userMfaCredential.count({ where: { userId: fixture.user.id, status: "ACTIVE" } }),
      1,
    );
  } finally {
    await cleanupFixture(fixture.user.id);
  }

  const expiredFixture = await createFixture();
  try {
    const pending = await beginMfaEnrollment({
      userId: expiredFixture.user.id,
      sessionId: expiredFixture.sessionId,
      password: expiredFixture.password,
      request,
    }, { now: base });
    const expiredAt = new Date(base.getTime() + 10 * 60_000 + 1);
    await assert.rejects(
      completeMfaEnrollment({
        userId: expiredFixture.user.id,
        sessionId: expiredFixture.sessionId,
        credentialId: pending.credential.id,
        code: generateTotpCode({ secret: pending.manualSecret, timestamp: expiredAt.getTime() }),
        request,
      }, { now: expiredAt }),
      (error: unknown) => mfaCode(error) === "MFA_ENROLLMENT_EXPIRED",
    );
    assert.equal(
      (await prisma.userMfaCredential.findUniqueOrThrow({ where: { id: pending.credential.id } })).status,
      "REVOKED",
    );
  } finally {
    await cleanupFixture(expiredFixture.user.id);
  }

  const abandonedFixture = await createFixture();
  try {
    const pending = await beginMfaEnrollment({
      userId: abandonedFixture.user.id,
      sessionId: abandonedFixture.sessionId,
      password: abandonedFixture.password,
      request,
    }, { now: base });
    await prisma.authSession.delete({ where: { id: abandonedFixture.sessionId } });
    assert.equal(
      await prisma.userMfaCredential.count({ where: { id: pending.credential.id } }),
      0,
    );
  } finally {
    await cleanupFixture(abandonedFixture.user.id);
  }
});

test("MFA step-up is replay-safe, action/resource/session bound and recovery codes are one-time", async () => {
  const fixture = await createFixture();
  const base = new Date("2026-08-10T13:00:00.000Z");
  try {
    const enrolled = await enrollFixture(fixture, base);
    const firstTime = new Date(base.getTime() + 60_000);
    const firstCode = generateTotpCode({
      secret: enrolled.secret,
      timestamp: firstTime.getTime(),
    });
    const scope = {
      actionKey: "STATUTORY_RULESET_SIGNOFF" as const,
      resourceType: "STATUTORY_RULESET",
      resourceId: randomUUID(),
      businessId: null,
      requestFingerprint: "a".repeat(64),
    };
    const verified = await verifySensitiveActionMfa(
      {
        ...scope,
        userId: fixture.user.id,
        sessionId: fixture.sessionId,
        password: fixture.password,
        factor: { factorType: "TOTP", code: firstCode },
        request,
      },
      { now: firstTime },
    );
    assert.equal(verified.authorization.assuranceLevel, "MFA");
    assert.equal(verified.authorization.verificationMethod, "TOTP");
    await assert.rejects(
      verifySensitiveActionMfa(
        {
          ...scope,
          resourceId: randomUUID(),
          userId: fixture.user.id,
          sessionId: fixture.sessionId,
          password: fixture.password,
          factor: { factorType: "TOTP", code: firstCode },
          request,
        },
        { now: firstTime },
      ),
      (error: unknown) => sensitiveCode(error) === "MFA_REPLAYED",
    );
    await assert.rejects(
      consumeSensitiveActionAuthorization({
        ...scope,
        resourceId: randomUUID(),
        userId: fixture.user.id,
        sessionId: fixture.sessionId,
        rawToken: verified.rawToken,
      }, { now: firstTime }),
      (error: unknown) => sensitiveCode(error) === "STEP_UP_SCOPE_MISMATCH",
    );
    await consumeSensitiveActionAuthorization({
      ...scope,
      userId: fixture.user.id,
      sessionId: fixture.sessionId,
      rawToken: verified.rawToken,
    }, { now: firstTime });
    await assert.rejects(
      consumeSensitiveActionAuthorization({
        ...scope,
        userId: fixture.user.id,
        sessionId: fixture.sessionId,
        rawToken: verified.rawToken,
      }, { now: firstTime }),
      (error: unknown) => sensitiveCode(error) === "STEP_UP_ALREADY_CONSUMED",
    );

    const recoveryScope = {
      actionKey: "STATUTORY_RULESET_ACTIVATE" as const,
      resourceType: "STATUTORY_RULESET",
      resourceId: randomUUID(),
      businessId: null,
      requestFingerprint: "b".repeat(64),
    };
    const recoveryVerified = await verifySensitiveActionMfa(
      {
        ...recoveryScope,
        userId: fixture.user.id,
        sessionId: fixture.sessionId,
        password: fixture.password,
        factor: { factorType: "RECOVERY_CODE", code: enrolled.recoveryCodes[0] },
        request,
      },
      { now: new Date(base.getTime() + 90_000) },
    );
    assert.equal(recoveryVerified.authorization.verificationMethod, "RECOVERY_CODE");
    await assert.rejects(
      verifySensitiveActionMfa(
        {
          ...recoveryScope,
          resourceId: randomUUID(),
          userId: fixture.user.id,
          sessionId: fixture.sessionId,
          password: fixture.password,
          factor: { factorType: "RECOVERY_CODE", code: enrolled.recoveryCodes[0] },
          request,
        },
        { now: new Date(base.getTime() + 91_000) },
      ),
      (error: unknown) => sensitiveCode(error) === "MFA_VERIFICATION_FAILED",
    );

    const concurrentRecoveryResults = await Promise.allSettled([
      verifySensitiveActionMfa({
        actionKey: "QA_SENSITIVE_ACTION",
        resourceType: "QA_FIXTURE",
        resourceId: "concurrent-recovery-a",
        businessId: null,
        userId: fixture.user.id,
        sessionId: fixture.sessionId,
        password: fixture.password,
        factor: { factorType: "RECOVERY_CODE", code: enrolled.recoveryCodes[1] },
        request,
      }, { now: new Date(base.getTime() + 91_500) }),
      verifySensitiveActionMfa({
        actionKey: "QA_SENSITIVE_ACTION",
        resourceType: "QA_FIXTURE",
        resourceId: "concurrent-recovery-b",
        businessId: null,
        userId: fixture.user.id,
        sessionId: fixture.sessionId,
        password: fixture.password,
        factor: { factorType: "RECOVERY_CODE", code: enrolled.recoveryCodes[1] },
        request,
      }, { now: new Date(base.getTime() + 91_500) }),
    ]);
    assert.equal(
      concurrentRecoveryResults.filter((result) => result.status === "fulfilled").length,
      1,
    );

    await revokeUserSessions(
      fixture.user.id,
      "MFA integration session revoke",
      prisma,
      new Date(base.getTime() + 92_000),
    );
    await assert.rejects(
      consumeSensitiveActionAuthorization({
        ...recoveryScope,
        userId: fixture.user.id,
        sessionId: fixture.sessionId,
        rawToken: recoveryVerified.rawToken,
      }, { now: new Date(base.getTime() + 92_000) }),
      (error: unknown) => sensitiveCode(error) === "STEP_UP_REQUIRED",
    );
  } finally {
    await cleanupFixture(fixture.user.id);
  }
});

test("MFA verification is rate-limited; regeneration and disable require password plus a fresh factor", async () => {
  const fixture = await createFixture();
  const base = new Date("2026-08-10T14:00:00.000Z");
  try {
    const enrolled = await enrollFixture(fixture, base);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(
        verifySensitiveActionMfa(
          {
            actionKey: "QA_SENSITIVE_ACTION",
            resourceType: "QA_FIXTURE",
            resourceId: `invalid-${attempt}`,
            businessId: null,
            userId: fixture.user.id,
            sessionId: fixture.sessionId,
            password: fixture.password,
            factor: { factorType: "TOTP", code: "invalid" },
            request,
          },
          { now: new Date(base.getTime() + 30_000 + attempt) },
        ),
        (error: unknown) => sensitiveCode(error) === "MFA_VERIFICATION_FAILED",
      );
    }
    const limitedAt = new Date(base.getTime() + 60_000);
    await assert.rejects(
      verifySensitiveActionMfa(
        {
          actionKey: "QA_SENSITIVE_ACTION",
          resourceType: "QA_FIXTURE",
          resourceId: "rate-limited-valid-factor",
          businessId: null,
          userId: fixture.user.id,
          sessionId: fixture.sessionId,
          password: fixture.password,
          factor: {
            factorType: "TOTP",
            code: generateTotpCode({ secret: enrolled.secret, timestamp: limitedAt.getTime() }),
          },
          request,
        },
        { now: limitedAt },
      ),
      (error: unknown) => sensitiveCode(error) === "MFA_RATE_LIMITED",
    );
    const afterWindow = new Date(base.getTime() + 16 * 60_000);
    const regenerated = await regenerateRecoveryCodes(
      {
        userId: fixture.user.id,
        sessionId: fixture.sessionId,
        password: fixture.password,
        factor: {
          factorType: "TOTP",
          code: generateTotpCode({ secret: enrolled.secret, timestamp: afterWindow.getTime() }),
        },
        request,
      },
      { now: afterWindow },
    );
    assert.equal(regenerated.recoveryCodes.length, 10);
    const credential = await prisma.userMfaCredential.findFirstOrThrow({
      where: { userId: fixture.user.id, status: "ACTIVE" },
      include: { recoveryCodes: true },
    });
    assert.equal(credential.recoveryVersion, 2);
    assert.equal(
      credential.recoveryCodes.filter((code) => !code.consumedAt && !code.revokedAt).length,
      10,
    );
    await assert.rejects(
      disableMfa(
        {
          userId: fixture.user.id,
          sessionId: fixture.sessionId,
          password: fixture.password,
          factor: { factorType: "TOTP", code: "invalid" },
          request,
        },
        { now: new Date(afterWindow.getTime() + 30_000) },
      ),
      (error: unknown) => mfaCode(error) === "MFA_VERIFICATION_FAILED",
    );
    const disableAt = new Date(afterWindow.getTime() + 60_000);
    const disableInput = {
        userId: fixture.user.id,
        sessionId: fixture.sessionId,
        password: fixture.password,
        factor: {
          factorType: "TOTP",
          code: generateTotpCode({ secret: enrolled.secret, timestamp: disableAt.getTime() }),
        },
        request,
      } as const;
    const disableResults = await Promise.allSettled([
      disableMfa(disableInput, { now: disableAt }),
      disableMfa(disableInput, { now: disableAt }),
    ]);
    assert.equal(disableResults.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(
      (await prisma.userMfaCredential.findUniqueOrThrow({ where: { id: credential.id } })).status,
      "REVOKED",
    );
  } finally {
    await cleanupFixture(fixture.user.id);
  }
});

test("dedicated statutory QA actors pass scoped MFA preconditions without activating a rule", async () => {
  const fixture = await createFixture();
  const activatorFixture = await createFixture();
  const base = new Date(Date.now() - 60_000);
  const ruleId = randomUUID();
  try {
    const enrolled = await enrollFixture(fixture, base);
    const activatorEnrolled = await enrollFixture(activatorFixture, base);
    assert.notEqual(fixture.user.id, activatorFixture.user.id);
    await prisma.statutoryRuleSet.create({
      data: {
        id: ruleId,
        scheme: "PCB",
        version: `TEST_TRUE_MFA_${ruleId.slice(0, 8)}`,
        effectiveFrom: new Date("2199-01-01T00:00:00.000Z"),
        authority: "TEST_ONLY",
        sourceReference: "Isolated local true-MFA integration fixture",
        sourceDocumentName: "true-mfa-integration-fixture.json",
        sourceDigest: "1".repeat(64),
        datasetDigest: "2".repeat(64),
        goldenFixtureDigest: "3".repeat(64),
        independentReviewDigest: "4".repeat(64),
        classificationVersion: "TEST_TRUE_MFA_V1",
        classificationDigest: "5".repeat(64),
        calculatorVersion: "TEST_TRUE_MFA_V1",
        calculatorTestDigest: "6".repeat(64),
        datasetRowCount: 1,
        readiness: "CALCULATION_VERIFIED",
        status: "READY_FOR_HUMAN_SIGN_OFF",
        humanReviewStatus: "COMPLETED",
        humanReviewRevision: 1,
        humanClassificationDigest: "5".repeat(64),
        ruleData: { id: `TEST_TRUE_MFA_${ruleId}`, eligibilityLogicRevision: "QA-ONLY" },
      },
    });
    const rule = await prisma.statutoryRuleSet.findUniqueOrThrow({
      where: { id: ruleId },
      include: { classifications: true, reviewDecisions: true },
    });
    const evidenceDigest = statutoryRuleEvidenceDigest(rule);
    const verifiedAt = new Date();
    const verified = await verifySensitiveActionMfa(
      {
        actionKey: "STATUTORY_RULESET_SIGNOFF",
        resourceType: "STATUTORY_RULESET",
        resourceId: ruleId,
        businessId: null,
        requestFingerprint: evidenceDigest,
        userId: fixture.user.id,
        sessionId: fixture.sessionId,
        password: fixture.password,
        factor: {
          factorType: "TOTP",
          code: generateTotpCode({ secret: enrolled.secret, timestamp: verifiedAt.getTime() }),
        },
        request,
      },
      { now: verifiedAt },
    );
    await assert.rejects(
      consumeSensitiveActionAuthorization({
        actionKey: "STATUTORY_RULESET_ACTIVATE",
        resourceType: "STATUTORY_RULESET",
        resourceId: ruleId,
        businessId: null,
        requestFingerprint: evidenceDigest,
        userId: fixture.user.id,
        sessionId: fixture.sessionId,
        rawToken: verified.rawToken,
      }, { now: verifiedAt }),
      (error: unknown) => sensitiveCode(error) === "STEP_UP_SCOPE_MISMATCH",
    );
    const signed = await signOffStatutoryRule({
      ruleSetId: ruleId,
      actor: {
        id: fixture.user.id,
        role: "PLATFORM_ADMIN",
        actorType: "HUMAN_USER",
        capabilities: ["SIGN_OFF_STATUTORY_RULESET"],
      },
      reason: "Local TEST_ONLY true-MFA sign-off integration verification",
      expectedEvidenceDigest: evidenceDigest,
      stepUpAuthorization: {
        sessionId: fixture.sessionId,
        rawToken: verified.rawToken,
      },
    });
    assert.equal(signed.rule.status, "HUMAN_SIGNED_OFF");
    assert.equal(await prisma.statutoryRuleSetSignOff.count({ where: { ruleSetId: ruleId } }), 1);
    assert.equal(await prisma.sensitiveActionAuthorization.count({
      where: { userId: fixture.user.id, consumedAt: { not: null } },
    }), 1);

    const activationVerifiedAt = new Date(verifiedAt.getTime() + 1_000);
    const activationVerified = await verifySensitiveActionMfa(
      {
        actionKey: "STATUTORY_RULESET_ACTIVATE",
        resourceType: "STATUTORY_RULESET",
        resourceId: ruleId,
        businessId: null,
        requestFingerprint: evidenceDigest,
        userId: activatorFixture.user.id,
        sessionId: activatorFixture.sessionId,
        password: activatorFixture.password,
        factor: {
          factorType: "TOTP",
          code: generateTotpCode({
            secret: activatorEnrolled.secret,
            timestamp: activationVerifiedAt.getTime(),
          }),
        },
        request,
      },
      { now: activationVerifiedAt },
    );
    await consumeSensitiveActionAuthorization({
      actionKey: "STATUTORY_RULESET_ACTIVATE",
      resourceType: "STATUTORY_RULESET",
      resourceId: ruleId,
      businessId: null,
      requestFingerprint: evidenceDigest,
      userId: activatorFixture.user.id,
      sessionId: activatorFixture.sessionId,
      rawToken: activationVerified.rawToken,
    }, { now: activationVerifiedAt });
    assert.equal(await prisma.sensitiveActionAuthorization.count({
      where: { userId: activatorFixture.user.id, consumedAt: { not: null } },
    }), 1);
    assert.equal((await prisma.statutoryRuleSet.findUniqueOrThrow({ where: { id: ruleId } })).status,
      "HUMAN_SIGNED_OFF");
  } finally {
    await cleanupStatutoryFixture(ruleId);
    await cleanupFixture(fixture.user.id);
    await cleanupFixture(activatorFixture.user.id);
  }
});

async function enrollFixture(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  base: Date,
) {
  const pending = await beginMfaEnrollment(
    {
      userId: fixture.user.id,
      sessionId: fixture.sessionId,
      password: fixture.password,
      request,
    },
    { now: base },
  );
  const completedAt = new Date(base.getTime() + 30_000);
  const completed = await completeMfaEnrollment(
    {
      userId: fixture.user.id,
      sessionId: fixture.sessionId,
      credentialId: pending.credential.id,
      code: generateTotpCode({ secret: pending.manualSecret, timestamp: completedAt.getTime() }),
      request,
    },
    { now: completedAt },
  );
  return { secret: pending.manualSecret, recoveryCodes: completed.recoveryCodes };
}

async function createFixture() {
  assertLocalDatabase();
  process.env.SESSION_SECRET = SESSION_SECRET;
  process.env.MFA_ACTIVE_KEY_VERSION = "integration-v1";
  process.env.MFA_ENCRYPTION_KEYS = MFA_KEYRING;
  const suffix = randomUUID().slice(0, 8);
  const password = `TrueMfa-${suffix}-Password!`;
  const user = await prisma.user.create({
    data: {
      name: `True MFA QA ${suffix}`,
      email: `true-mfa-${suffix}@example.test`,
      passwordHash: await bcrypt.hash(password, 12),
      role: "PLATFORM_ADMIN",
      permissions: [
        "SENSITIVE_ACTION_QA",
        "SIGN_OFF_STATUTORY_RULESET",
        "ACTIVATE_STATUTORY_RULESET",
      ],
    },
  });
  const sessionId = randomUUID();
  await persistSessionContext({
    userId: user.id,
    sessionId,
    homeBusinessId: null,
    activeBusinessId: null,
    contextVersion: 1,
    branchId: null,
    name: user.name,
    email: user.email!,
    role: user.role,
    permissions: user.permissions,
    status: user.status,
  });
  return { user, password, sessionId };
}

async function cleanupFixture(userId: string) {
  await prisma.authSecurityEvent.deleteMany({ where: { userId } });
  await prisma.sensitiveActionAuthorization.deleteMany({ where: { userId } });
  await prisma.userMfaCredential.deleteMany({ where: { userId } });
  await prisma.authSession.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

async function cleanupStatutoryFixture(ruleSetId: string) {
  await prisma.statutoryRuleSet.updateMany({
    where: { id: ruleSetId, authority: "TEST_ONLY" },
    data: { status: "RETIRED" },
  });
  await prisma.statutoryRuleLifecycleAudit.deleteMany({ where: { ruleSetId } });
  await prisma.statutoryRuleSetSignOff.deleteMany({ where: { ruleSetId } });
  await prisma.statutoryComponentReviewDecision.deleteMany({ where: { ruleSetId } });
  await prisma.statutoryComponentClassification.deleteMany({ where: { ruleSetId } });
  await prisma.statutoryRuleSet.deleteMany({ where: { id: ruleSetId, authority: "TEST_ONLY" } });
}

function mfaCode(error: unknown) {
  return error instanceof MfaError ? error.code : null;
}

function sensitiveCode(error: unknown) {
  return error instanceof SensitiveActionError ? error.code : null;
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error("True MFA integration tests are restricted to Local database.");
  }
}
