import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  canReadPeopleRoute,
  routePermission,
} from "../../src/lib/auth/staff-permissions";
import { canDirectStaff } from "../../src/lib/business-groups/capabilities";
import { createSessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { middleware } from "../../src/middleware";

test("TEAM_READ admits only People read routes, never payroll or bank administration", () => {
  const read = ["TEAM_READ"];
  assert.equal(canDirectStaff(read, "VIEW_TEAM_DIRECTORY"), true);
  assert.equal(canDirectStaff(read, "VIEW_PAYROLL_RUN"), false);
  assert.equal(canDirectStaff(read, "VIEW_BANK_ACCOUNT"), false);
  assert.equal(routePermission("/team/people/11111111-1111-4111-8111-111111111111"), "TEAM");
  assert.equal(canReadPeopleRoute(read, "/team"), true);
  assert.equal(canReadPeopleRoute(read, "/team/people/11111111-1111-4111-8111-111111111111"), true);
  assert.equal(canReadPeopleRoute(read, "/team/people/11111111-1111-4111-8111-111111111111/payroll/bank/edit"), false);
  assert.equal(canReadPeopleRoute(read, "/team/payroll/runs"), false);
  assert.equal(canReadPeopleRoute([], "/team/people/11111111-1111-4111-8111-111111111111"), false);
});

test("signed STAFF cookie cannot bypass People route admission into payroll or bank", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "unit-people-route-secret-0123456789";
  try {
    const token = await createSessionToken({
      userId: "11111111-1111-4111-8111-111111111111",
      sessionId: "22222222-2222-4222-8222-222222222222",
      homeBusinessId: "33333333-3333-4333-8333-333333333333",
      activeBusinessId: "33333333-3333-4333-8333-333333333333",
      contextVersion: 1,
      industryType: "SALON_BEAUTY",
      branchId: "44444444-4444-4444-8444-444444444444",
      name: "People Reader",
      email: "people-reader@example.test",
      role: "STAFF",
      permissions: ["TEAM_READ"],
      status: "active",
    });
    for (const [path, expected] of [
      ["/team", 200],
      ["/team/people/55555555-5555-4555-8555-555555555555", 200],
      ["/team/people/55555555-5555-4555-8555-555555555555/payroll/bank/edit", 307],
      ["/team/payroll", 307],
    ] as const) {
      const response = await middleware(new NextRequest(`http://localhost:3000${path}`, {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }));
      assert.equal(response.status, expected, path);
    }
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});
