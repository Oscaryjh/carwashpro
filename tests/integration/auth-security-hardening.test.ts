import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import {
  authenticatePasswordLogin,
} from "../../src/lib/auth/password-login";
import {
  authSecurityHashes,
  PASSWORD_LOGIN_IDENTIFIER_LIMIT,
  PASSWORD_LOGIN_WINDOW_MS,
} from "../../src/lib/auth/security";
import {
  persistSessionContext,
  revokeUserSessions,
} from "../../src/lib/auth/session";

const prisma = new PrismaClient();
const TEST_SECRET = "integration-auth-security-secret-0123456789";

test("password abuse protection and server-side session revocation are deterministic", async () => {
  assertLocalDatabase();
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = TEST_SECRET;
  const suffix = randomUUID().slice(0, 8);
  const email = `auth-owner-${suffix}@example.test`;
  const unknownEmail = `auth-unknown-${suffix}@example.test`;
  const business = await prisma.business.create({
    data: {
      name: `Auth Security ${suffix}`,
      slug: `auth-security-${suffix}`,
      industryType: "SALON_BEAUTY",
    },
  });
  const branch = await prisma.branch.create({
    data: { businessId: business.id, name: `Auth Branch ${suffix}` },
  });
  const password = `Valid-${suffix}-Password!`;
  const user = await prisma.user.create({
    data: {
      businessId: business.id,
      branchId: branch.id,
      name: `Auth Owner ${suffix}`,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "BUSINESS_OWNER",
      permissions: [],
    },
  });
  const knownHash = authSecurityHashes({ identifier: email }).identifierHash;
  const unknownHash = authSecurityHashes({ identifier: unknownEmail }).identifierHash;
  const base = new Date("2026-08-09T12:00:00.000Z");

  try {
    const success = await authenticatePasswordLogin(
      {
        email,
        password,
        request: { ipAddress: null, userAgent: "Integration Security Test" },
      },
      { now: base },
    );
    assert.equal(success.ok, true);

    const unknown = await authenticatePasswordLogin(
      {
        email: unknownEmail,
        password: "wrong-password",
        request: { ipAddress: null, userAgent: "Integration Security Test" },
      },
      { now: base },
    );
    assert.deepEqual(unknown, { ok: false, code: "INVALID_CREDENTIALS" });

    for (let attempt = 0; attempt < PASSWORD_LOGIN_IDENTIFIER_LIMIT; attempt += 1) {
      const failed = await authenticatePasswordLogin(
        {
          email,
          password: `wrong-${attempt}`,
          request: { ipAddress: null, userAgent: "Integration Security Test" },
        },
        { now: new Date(base.getTime() + attempt * 1_000) },
      );
      assert.deepEqual(failed, { ok: false, code: "INVALID_CREDENTIALS" });
    }

    const limited = await authenticatePasswordLogin(
      {
        email,
        password,
        request: { ipAddress: null, userAgent: "Integration Security Test" },
      },
      { now: new Date(base.getTime() + 10_000) },
    );
    assert.deepEqual(limited, { ok: false, code: "RATE_LIMITED" });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const rapidAttempt = await authenticatePasswordLogin(
        {
          email,
          password: `rapid-wrong-${attempt}`,
          request: { ipAddress: null, userAgent: "Integration Security Test" },
        },
        { now: new Date(base.getTime() + 11_000 + attempt) },
      );
      assert.deepEqual(rapidAttempt, { ok: false, code: "RATE_LIMITED" });
    }

    const recovered = await authenticatePasswordLogin(
      {
        email,
        password,
        request: { ipAddress: null, userAgent: "Integration Security Test" },
      },
      { now: new Date(base.getTime() + PASSWORD_LOGIN_WINDOW_MS + 60_000) },
    );
    assert.equal(recovered.ok, true);

    const sessionId = randomUUID();
    const stored = await persistSessionContext(
      {
        userId: user.id,
        sessionId,
        homeBusinessId: business.id,
        activeBusinessId: business.id,
        contextVersion: 1,
        industryType: business.industryType,
        branchId: branch.id,
        name: user.name,
        email,
        role: user.role,
        permissions: [],
        status: user.status,
      },
      {
        request: {
          ipAddress: "203.0.113.10",
          userAgent: "Integration Security Test",
        },
        now: base,
      },
    );
    assert.equal(stored.revokedAt, null);
    assert.ok(stored.idleExpiresAt.getTime() < stored.absoluteExpiresAt.getTime());

    const rotated = await persistSessionContext(
      {
        userId: user.id,
        sessionId,
        homeBusinessId: business.id,
        activeBusinessId: business.id,
        contextVersion: 2,
        industryType: business.industryType,
        branchId: branch.id,
        name: user.name,
        email,
        role: user.role,
        permissions: [],
        status: user.status,
      },
      { now: new Date(base.getTime() + 5_000) },
    );
    assert.equal(rotated.contextVersion, 2);

    assert.equal(
      (
        await revokeUserSessions(
          user.id,
          "Integration password reset revocation.",
        )
      ).count,
      1,
    );
    const revoked = await prisma.authSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    assert.ok(revoked.revokedAt);

    const securityEvents = await prisma.authSecurityEvent.findMany({
      where: {
        OR: [
          { userId: user.id },
          { identifierHash: { in: [knownHash, unknownHash].filter(Boolean) as string[] } },
        ],
      },
    });
    assert.ok(securityEvents.some((event) => event.eventType === "LOGIN_FAILED"));
    assert.ok(
      securityEvents.some((event) => event.eventType === "LOGIN_RATE_LIMITED"),
    );
    assert.equal(
      securityEvents.filter((event) => event.eventType === "LOGIN_RATE_LIMITED")
        .length,
      21,
    );
    assert.ok(securityEvents.some((event) => event.eventType === "SESSION_CREATED"));
    const serialized = JSON.stringify(securityEvents);
    assert.equal(serialized.includes(password), false);
    assert.equal(serialized.includes("wrong-password"), false);
    assert.equal(serialized.includes(email), false);
    assert.equal(serialized.includes(unknownEmail), false);
  } finally {
    await prisma.authSecurityEvent.deleteMany({
      where: {
        OR: [
          { userId: user.id },
          { identifierHash: { in: [knownHash, unknownHash].filter(Boolean) as string[] } },
        ],
      },
    });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.branch.delete({ where: { id: branch.id } });
    await prisma.business.delete({ where: { id: business.id } });
    process.env.SESSION_SECRET = previousSecret;
    await prisma.$disconnect();
  }
});

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error("Auth integration tests are restricted to Local database.");
  }
}
