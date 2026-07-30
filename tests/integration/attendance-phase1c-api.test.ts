import assert from "node:assert/strict";
import test from "node:test";
import { POST as clockIn } from "../../src/app/api/employee-attendance/clock-in/route";
import { GET as history } from "../../src/app/api/employee-attendance/history/route";
import { SESSION_COOKIE } from "../../src/lib/auth/session";

process.env.EMPLOYEE_AUTH_SECRET =
  process.env.EMPLOYEE_AUTH_SECRET ??
  "attendance-phase1c-api-secret-at-least-32-bytes";

test("admin cookie cannot authenticate an Employee Punch API", async () => {
  const response = await clockIn(
    new Request("http://localhost/api/employee-attendance/clock-in", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE}=admin-cookie-must-not-work`,
        origin: "http://localhost",
      },
      body: JSON.stringify({
        branchId: "22222222-2222-4222-8222-222222222222",
        latitude: 1.5535,
        longitude: 110.3593,
        accuracyMeters: 10,
        deviceIdentifier: "phase1c-api-device",
        idempotencyKey: "phase1c-api-request",
      }),
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "UNAUTHENTICATED");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("Employee history rejects requests without Employee Session", async () => {
  const response = await history(
    new Request("http://localhost/api/employee-attendance/history"),
  );
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error.code, "UNAUTHENTICATED");
});

test("cross-site Punch requests are rejected before authentication", async () => {
  const response = await clockIn(
    new Request("http://localhost/api/employee-attendance/clock-in", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.invalid",
        "sec-fetch-site": "cross-site",
      },
      body: "{}",
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
});
