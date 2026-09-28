import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { middleware } from "../../src/middleware";

test("back-office logout reaches its handler for every role and stale cookies", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  const previousSurface = process.env.TETAMU_APP_SURFACE;
  const secret = "logout-middleware-test-secret-at-least-32-characters";
  process.env.SESSION_SECRET = secret;
  process.env.TETAMU_APP_SURFACE = "web";
  try {
    for (const role of ["PLATFORM_ADMIN", "BUSINESS_OWNER", "STAFF"]) {
      const token = await new SignJWT({ role, sessionId: "logout-test", permissions: [] })
        .setProtectedHeader({ alg: "HS256" }).setExpirationTime("5m")
        .sign(new TextEncoder().encode(secret));
      const response = await middleware(new NextRequest("http://localhost/logout", {
        method: "POST", headers: { cookie: `car_wash_session=${token}` },
      }));
      assert.equal(response.headers.get("x-middleware-next"), "1", role);
      assert.equal(response.headers.get("location"), null, role);
      if (role === "PLATFORM_ADMIN") {
        const restricted = await middleware(new NextRequest("http://localhost/reports", {
          headers: { cookie: `car_wash_session=${token}` },
        }));
        assert.equal(restricted.headers.get("location"), "http://localhost/admin/businesses");
      }
    }
    for (const token of ["", "invalid-or-expired"]) {
      const response = await middleware(new NextRequest("http://localhost/logout", {
        method: "POST", headers: { cookie: `car_wash_session=${token}` },
      }));
      assert.equal(response.headers.get("x-middleware-next"), "1");
    }
    process.env.TETAMU_APP_SURFACE = "staff";
    const staff = await middleware(new NextRequest("http://localhost/logout", { method: "POST" }));
    assert.equal(staff.headers.get("location"), "http://localhost/staff/login");
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
    if (previousSurface === undefined) delete process.env.TETAMU_APP_SURFACE;
    else process.env.TETAMU_APP_SURFACE = previousSurface;
  }
});
