import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";

import { config, middleware } from "@/middleware";
import {
  issuePosPilotSmokeCapability,
  POS_PILOT_SMOKE_COOKIE,
} from "@/lib/release/pos-pilot-contract";

const secret = "s".repeat(64);
const sessionSecret = "x".repeat(64);
const scope = {
  actorId: "11111111-1111-4111-8111-111111111111",
  businessId: "22222222-2222-4222-8222-222222222222",
  branchId: "33333333-3333-4333-8333-333333333333",
};

const managedKeys = [
  "APP_ENVIRONMENT",
  "RAILWAY_ENVIRONMENT_NAME",
  "POS_PILOT_RELEASE_MODE",
  "POS_PILOT_FROZEN_DOMAINS",
  "POS_PILOT_WRITE_FREEZE_MODE",
  "POS_PILOT_SMOKE_SECRET",
  "POS_PILOT_SMOKE_OPERATOR_USER_ID",
  "POS_PILOT_SMOKE_BUSINESS_ID",
  "POS_PILOT_SMOKE_BRANCH_ID",
  "SESSION_SECRET",
] as const;

test("full freeze rejects a public mutation before session authentication", async () => {
  await withEnvironment("full", async () => {
    const response = await middleware(
      new NextRequest("https://pos.example/cashier", { method: "POST" }),
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(await response.text(), "POS_PILOT_WRITE_FROZEN");
    assert.equal(response.headers.get("location"), null);
  });
});

test("full freeze keeps health, reads and auth/session paths available", async () => {
  await withEnvironment("full", async () => {
    const health = await middleware(
      new NextRequest("https://pos.example/api/health", { method: "GET" }),
    );
    assert.equal(health.headers.get("x-middleware-next"), "1");

    const login = await middleware(
      new NextRequest("https://pos.example/login", { method: "POST" }),
    );
    assert.equal(login.headers.get("x-middleware-next"), "1");

    const read = await middleware(
      new NextRequest("https://pos.example/crm/customers", { method: "GET" }),
    );
    assert.equal(read.status, 307);
    assert.equal(new URL(read.headers.get("location")!).pathname, "/login");
  });
});

test("operator-smoke denies ordinary sessions and accepts only matching capability plus session scope", async () => {
  await withEnvironment("operator-smoke", async () => {
    const session = await sessionToken(scope);
    const ordinary = await middleware(request("/cashier", session));
    assert.equal(ordinary.status, 503);

    const capability = await issuePosPilotSmokeCapability({
      ...scope,
      secret,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    const allowed = await middleware(request("/cashier", session, capability));
    assert.equal(allowed.headers.get("x-middleware-next"), "1");

    const wrongBusinessSession = await sessionToken({
      ...scope,
      businessId: "44444444-4444-4444-8444-444444444444",
    });
    const wrongBusiness = await middleware(
      request("/cashier", wrongBusinessSession, capability),
    );
    assert.equal(wrongBusiness.status, 503);
    assert.equal(await wrongBusiness.text(), "POS_PILOT_WRITE_FROZEN");
  });
});

test("operator-smoke capability cannot open CRM, administration, WhatsApp or frozen domains", async () => {
  await withEnvironment("operator-smoke", async () => {
    const session = await sessionToken(scope);
    const capability = await issuePosPilotSmokeCapability({
      ...scope,
      secret,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    for (const path of ["/crm/customers", "/business/settings", "/api/whatsapp/send"]) {
      const response = await middleware(request(path, session, capability));
      assert.equal(response.status, 503, path);
      assert.equal(await response.text(), "POS_PILOT_WRITE_FROZEN", path);
    }

    const payroll = await middleware(request("/team/payroll", session, capability));
    assert.equal(payroll.status, 403);
    assert.equal(await payroll.text(), "FROZEN_DOMAIN_DENIED");
  });
});

test("middleware matcher includes API routes so mutation APIs cannot bypass the freeze", () => {
  assert.ok(config.matcher.includes("/api/:path*"));
});

test("middleware matcher covers every business route family that owns server actions", () => {
  for (const route of [
    "/ai/:path*",
    "/appointments/:path*",
    "/branches/:path*",
    "/business/:path*",
    "/business-context/:path*",
    "/cashier/:path*",
    "/closing/:path*",
    "/crm/:path*",
    "/discounts/:path*",
    "/expenses/:path*",
    "/inventory/:path*",
    "/invoices/:path*",
    "/loyalty/:path*",
    "/packages/:path*",
    "/pos/:path*",
    "/products/:path*",
    "/services/:path*",
    "/staff/:path*",
    "/team/:path*",
    "/whatsapp/:path*",
    "/work-orders/:path*",
  ]) {
    assert.ok(config.matcher.includes(route), route);
  }
});

function request(pathname: string, session: string, capability?: string) {
  const cookies = [`car_wash_session=${session}`];
  if (capability) cookies.push(`${POS_PILOT_SMOKE_COOKIE}=${capability}`);
  return new NextRequest(`https://pos.example${pathname}`, {
    method: "POST",
    headers: { cookie: cookies.join("; ") },
  });
}

async function sessionToken(input: typeof scope) {
  return new SignJWT({
    sessionId: "session-1",
    userId: input.actorId,
    homeBusinessId: input.businessId,
    activeBusinessId: input.businessId,
    businessId: input.businessId,
    branchId: input.branchId,
    contextVersion: 1,
    role: "BUSINESS_OWNER",
    status: "ACTIVE",
    industryType: "SALON_BEAUTY",
    permissions: [],
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(sessionSecret));
}

async function withEnvironment(
  mode: "full" | "operator-smoke" | "off",
  run: () => Promise<void>,
) {
  const original = Object.fromEntries(managedKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    APP_ENVIRONMENT: "production",
    RAILWAY_ENVIRONMENT_NAME: "production",
    POS_PILOT_RELEASE_MODE: "core-pilot",
    POS_PILOT_FROZEN_DOMAINS: "true",
    POS_PILOT_WRITE_FREEZE_MODE: mode,
    POS_PILOT_SMOKE_SECRET: secret,
    POS_PILOT_SMOKE_OPERATOR_USER_ID: scope.actorId,
    POS_PILOT_SMOKE_BUSINESS_ID: scope.businessId,
    POS_PILOT_SMOKE_BRANCH_ID: scope.branchId,
    SESSION_SECRET: sessionSecret,
  });
  try {
    await run();
  } finally {
    for (const key of managedKeys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
