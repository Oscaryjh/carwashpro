import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { authenticatePasswordLogin } from "../../src/lib/auth/password-login";

const database = new PrismaClient();

test("SERVICE account cannot use a correct interactive password or create a session", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "integration-service-login-secret-0123456789";
  const suffix = randomUUID().slice(0, 8);
  const business = await database.business.create({
    data: { name: `Service Login ${suffix}`, slug: `service-login-${suffix}`, industryType: "SALON_BEAUTY" },
  });
  const password = `Valid-${suffix}-Password!`;
  const user = await database.user.create({
    data: {
      businessId: business.id,
      name: `Service Account ${suffix}`,
      email: `service-login-${suffix}@example.test`,
      passwordHash: await bcrypt.hash(password, 12),
      role: "STAFF",
      permissions: ["TEAM"],
    },
  });
  try {
    await database.$executeRaw`UPDATE users SET account_type = 'SERVICE'::"UserAccountType" WHERE id = ${user.id}::uuid`;
    const result = await authenticatePasswordLogin({
      email: user.email!,
      password,
      request: { ipAddress: null, userAgent: "Service Login Test" },
    }, { database });
    assert.deepEqual(result, { ok: false, code: "SERVICE_LOGIN_DENIED" });
    const wrongPassword = await authenticatePasswordLogin({
      email: user.email!,
      password: "not-the-service-password",
      request: { ipAddress: null, userAgent: "Service Login Test" },
    }, { database });
    assert.deepEqual(wrongPassword, { ok: false, code: "INVALID_CREDENTIALS" });
    const unknownEmail = await authenticatePasswordLogin({
      email: `unknown-service-login-${suffix}@example.test`,
      password,
      request: { ipAddress: null, userAgent: "Service Login Test" },
    }, { database });
    assert.deepEqual(unknownEmail, { ok: false, code: "INVALID_CREDENTIALS" });
    assert.equal(await database.authSession.count({ where: { userId: user.id } }), 0);
  } finally {
    await database.user.delete({ where: { id: user.id } });
    await database.business.delete({ where: { id: business.id } });
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("inactive account is distinguished only after the correct password and never creates a session", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "integration-inactive-login-secret-0123456789";
  const suffix = randomUUID().slice(0, 8);
  const business = await database.business.create({
    data: { name: `Inactive Login ${suffix}`, slug: `inactive-login-${suffix}`, industryType: "SALON_BEAUTY" },
  });
  const password = `Valid-${suffix}-Password!`;
  const user = await database.user.create({
    data: {
      businessId: business.id,
      name: `Inactive Account ${suffix}`,
      email: `inactive-login-${suffix}@example.test`,
      passwordHash: await bcrypt.hash(password, 12),
      role: "STAFF",
      status: "inactive",
      permissions: ["TEAM"],
    },
  });
  try {
    const wrongPassword = await authenticatePasswordLogin({
      email: user.email!,
      password: "not-the-account-password",
      request: { ipAddress: null, userAgent: "Inactive Login Test" },
    }, { database });
    assert.deepEqual(wrongPassword, { ok: false, code: "INVALID_CREDENTIALS" });
    const correctPassword = await authenticatePasswordLogin({
      email: user.email!,
      password,
      request: { ipAddress: null, userAgent: "Inactive Login Test" },
    }, { database });
    assert.deepEqual(correctPassword, { ok: false, code: "ACCOUNT_UNAVAILABLE" });
    assert.equal(await database.authSession.count({ where: { userId: user.id } }), 0);
  } finally {
    await database.user.delete({ where: { id: user.id } });
    await database.business.delete({ where: { id: business.id } });
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});
