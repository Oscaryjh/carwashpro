import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT, jwtVerify } from "jose";
import { NextRequest } from "next/server";
import { getLoginDestination } from "../../src/lib/auth/login-destination";
import {
  createSessionToken,
  normalizeSession,
  SESSION_CONTEXT_VERSION,
  SESSION_COOKIE,
} from "../../src/lib/auth/session";
import { middleware } from "../../src/middleware";

const secret = "unit-test-session-secret-that-is-long-enough";

test("group-only users log in through recovery while direct users keep their home route", () => {
  assert.equal(
    getLoginDestination({
      role: "STAFF",
      businessId: null,
      industryType: null,
    }),
    "/business-context/recover",
  );
  assert.equal(
    getLoginDestination({
      role: "BUSINESS_OWNER",
      businessId: "business-1",
      industryType: "SALON_BEAUTY",
    }),
    "/cashier",
  );
  assert.equal(
    getLoginDestination({
      role: "STAFF",
      businessId: "business-1",
      industryType: "AUTO_DETAILING",
    }),
    "/work-orders",
  );
  assert.equal(
    getLoginDestination({
      role: "PLATFORM_ADMIN",
      businessId: null,
      industryType: null,
    }),
    "/admin/businesses",
  );
});

test("recovery middleware accepts a group-only session without refreshing its stale cookie", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = secret;
  try {
    const token = await createSessionToken({
      userId: "group-user-1",
      homeBusinessId: null,
      activeBusinessId: null,
      contextVersion: SESSION_CONTEXT_VERSION,
      industryType: null,
      branchId: null,
      name: "Group User",
      email: "group-user@example.test",
      role: "STAFF",
      permissions: [],
      status: "active",
    });
    const request = new NextRequest(
      "http://localhost:3000/business-context/recover",
      { headers: { cookie: `${SESSION_COOKIE}=${token}` } },
    );

    const response = await middleware(request);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.cookies.getAll().length, 0);
  } finally {
    restoreSecret(previousSecret);
  }
});

test("a recovery-rotated token carries the new context into the next middleware request", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = secret;
  try {
    const token = await createSessionToken({
      userId: "group-user-1",
      homeBusinessId: null,
      activeBusinessId: "business-auto",
      contextVersion: 2,
      industryType: "AUTO_DETAILING",
      branchId: null,
      name: "Group User",
      email: "group-user@example.test",
      role: "STAFF",
      permissions: [],
      status: "active",
    });
    const verified = await jwtVerify(token, new TextEncoder().encode(secret));
    const normalized = normalizeSession(verified.payload);
    assert.equal(normalized.homeBusinessId, null);
    assert.equal(normalized.activeBusinessId, "business-auto");
    assert.equal(normalized.businessId, "business-auto");
    assert.equal(normalized.contextVersion, 2);
    assert.equal(normalized.industryType, "AUTO_DETAILING");
    assert.equal(normalized.branchId, null);

    const request = new NextRequest("http://localhost:3000/work-orders", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    const response = await middleware(request);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.cookies.getAll().length, 1);
  } finally {
    restoreSecret(previousSecret);
  }
});

test("legacy tokens without context fields still derive context from businessId", async () => {
  const token = await new SignJWT({
    userId: "legacy-user",
    businessId: "legacy-business",
    industryType: "SALON_BEAUTY",
    branchId: null,
    name: "Legacy User",
    email: "legacy@example.test",
    role: "BUSINESS_OWNER",
    permissions: [],
    status: "active",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));
  const verified = await jwtVerify(token, new TextEncoder().encode(secret));
  const session = normalizeSession(verified.payload);
  assert.equal(session.homeBusinessId, "legacy-business");
  assert.equal(session.activeBusinessId, "legacy-business");
});

function restoreSecret(previousSecret: string | undefined) {
  if (previousSecret === undefined) {
    delete process.env.SESSION_SECRET;
  } else {
    process.env.SESSION_SECRET = previousSecret;
  }
}
