import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { decodeJwt } from "jose";
import {
  assertSameOrigin,
  authSecurityHashes,
  getAuthRequestContext,
  PASSWORD_LOGIN_IDENTIFIER_LIMIT,
} from "../../src/lib/auth/security";
import {
  createSessionToken,
  isStoredSessionUsable,
  sessionCookieOptions,
} from "../../src/lib/auth/session";
import {
  canDirectStaff,
  canGroupManager,
} from "../../src/lib/business-groups/capabilities";

const SESSION_SECRET = "unit-auth-security-secret-0123456789abcdef";

test("proxy IP parsing is explicit, spoof-resistant, and normalized", () => {
  const headers = new Headers({
    "x-forwarded-for": "198.51.100.99, ::ffff:203.0.113.10",
    "x-real-ip": "192.0.2.4",
    "user-agent": "Tetamu Security Test",
  });

  assert.deepEqual(getAuthRequestContext(headers, process.env), {
    ipAddress: null,
    userAgent: "Tetamu Security Test",
  });
  assert.deepEqual(
    getAuthRequestContext(headers, {
      ...process.env,
      AUTH_TRUST_PROXY_HOPS: "1",
    }),
    {
      ipAddress: "203.0.113.10",
      userAgent: "Tetamu Security Test",
    },
  );
  assert.throws(
    () =>
      getAuthRequestContext(headers, {
        ...process.env,
        AUTH_TRUST_PROXY_HOPS: "99",
      }),
    /AUTH_TRUST_PROXY_HOPS/,
  );
});

test("auth limiter keys are stable hashes and never contain account PII", () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SESSION_SECRET;
  try {
    const first = authSecurityHashes({
      identifier: " Admin@Example.Test ",
      ipAddress: "203.0.113.5",
      userAgent: "Test Browser",
    });
    const second = authSecurityHashes({
      identifier: "admin@example.test",
      ipAddress: "203.0.113.5",
      userAgent: "Test Browser",
    });
    assert.deepEqual(first, second);
    assert.match(first.identifierHash ?? "", /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(first).includes("admin@example.test"), false);
    assert.equal(PASSWORD_LOGIN_IDENTIFIER_LIMIT, 5);
  } finally {
    process.env.SESSION_SECRET = previousSecret;
  }
});

test("same-origin guard rejects cross-site auth mutations", () => {
  assert.throws(
    () =>
      assertSameOrigin(
        new Request("https://testing.example.test/logout", {
          headers: {
            host: "testing.example.test",
            origin: "https://attacker.example",
            "sec-fetch-site": "cross-site",
          },
        }),
      ),
    /AUTH_CROSS_SITE_REQUEST/,
  );
  assert.doesNotThrow(() =>
    assertSameOrigin(
      new Request("https://testing.example.test/logout", {
        headers: {
          host: "testing.example.test",
          origin: "https://testing.example.test",
          "sec-fetch-site": "same-origin",
        },
      }),
    ),
  );
});

test("app session token is rotated, bounded, and cookie flags are hardened", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SESSION_SECRET;
  try {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const token = await createSessionToken({
      userId: "22222222-2222-4222-8222-222222222222",
      sessionId,
      homeBusinessId: null,
      activeBusinessId: null,
      contextVersion: 1,
      branchId: null,
      name: "Security Test",
      email: "security@example.test",
      role: "PLATFORM_ADMIN",
      permissions: [],
      status: "active",
    });
    const claims = decodeJwt(token);
    assert.equal(claims.jti, sessionId);
    assert.ok(Number(claims.exp) > Number(claims.iat));

    const cookie = sessionCookieOptions(undefined, {
      ...process.env,
      NODE_ENV: "production",
    });
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "lax");
    assert.equal(cookie.secure, true);
    assert.equal(cookie.path, "/");
    assert.ok(cookie.maxAge > 0);
  } finally {
    process.env.SESSION_SECRET = previousSecret;
  }
});

test("server session validation rejects replay, expiry, revocation, and disabled users", () => {
  const now = new Date("2026-08-09T10:00:00.000Z");
  const payload = {
    userId: "22222222-2222-4222-8222-222222222222",
    sessionId: "11111111-1111-4111-8111-111111111111",
    homeBusinessId: null,
    activeBusinessId: null,
    businessId: null,
    contextVersion: 2,
    branchId: null,
    name: "Security Test",
    email: "security@example.test",
    role: "PLATFORM_ADMIN" as const,
    permissions: [],
    status: "active" as const,
  };
  const stored = {
    userId: payload.userId,
    activeBusinessId: null,
    branchId: null,
    contextVersion: 2,
    absoluteExpiresAt: new Date(now.getTime() + 60_000),
    idleExpiresAt: new Date(now.getTime() + 30_000),
    revokedAt: null,
    user: {
      id: payload.userId,
      status: "active" as const,
      loginEnabled: true,
      email: payload.email,
    },
  };

  assert.equal(isStoredSessionUsable(stored, payload, now), true);
  assert.equal(
    isStoredSessionUsable(stored, { ...payload, contextVersion: 1 }, now),
    false,
  );
  assert.equal(
    isStoredSessionUsable(
      { ...stored, revokedAt: new Date(now) },
      payload,
      now,
    ),
    false,
  );
  assert.equal(
    isStoredSessionUsable(stored, payload, new Date(now.getTime() + 31_000)),
    false,
  );
  assert.equal(
    isStoredSessionUsable(
      { ...stored, user: { ...stored.user, loginEnabled: false } },
      payload,
      now,
    ),
    false,
  );
});

test("sensitive business pages and mutations enforce live server capabilities", () => {
  const source = (path: string) =>
    readFileSync(resolve(process.cwd(), path), "utf8");

  assert.match(
    source("src/app/(business)/cashier/page.tsx"),
    /requireBusinessUser\(\s*"PROCESS_CASHIER_PAYMENT"/,
  );
  assert.match(
    source("src/app/(business)/cashier/actions.ts"),
    /requireBusinessUser\(\s*"PROCESS_CASHIER_PAYMENT"/,
  );
  assert.match(
    source("src/app/(business)/closing/page.tsx"),
    /requireBusinessContext\(\{ capability: "RUN_CLOSING" \}\)/,
  );
  assert.match(
    source("src/app/(business)/business/settings/page.tsx"),
    /capability: "MODIFY_BUSINESS_SETTINGS"/,
  );
  assert.match(
    source("src/app/(business)/business/settings/vehicle-size-actions.ts"),
    /requireBusinessUser\(\s*"MODIFY_BUSINESS_SETTINGS"/,
  );
  assert.match(
    source("src/app/(business)/crm/actions.ts"),
    /requireCrmUser\("MODIFY_CRM"\)/,
  );
  assert.match(
    source("src/app/(business)/invoices/actions.ts"),
    /requireBusinessUser\("PROCESS_REFUND"\)/,
  );
  assert.match(
    source("src/lib/tenant.ts"),
    /eventType: "PERMISSION_DENIED"/,
  );

  assert.equal(canDirectStaff(["POS"], "PROCESS_CASHIER_PAYMENT"), true);
  assert.equal(canDirectStaff([], "PROCESS_CASHIER_PAYMENT"), false);
  assert.equal(canDirectStaff(["CRM"], "MODIFY_CRM"), true);
  assert.equal(canGroupManager("MODIFY_APPOINTMENTS"), false);
  assert.equal(canGroupManager("MODIFY_WORK_ORDERS"), false);
  assert.equal(canGroupManager("MODIFY_CRM"), false);
});
