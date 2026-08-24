import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("Staff App scripts use the dedicated 3100 runner", () => {
  const packageJson = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  const runner = readFileSync(
    join(root, "scripts", "run-staff-app.mjs"),
    "utf8",
  );

  assert.equal(packageJson.scripts["dev:staff"], "node scripts/run-staff-app.mjs dev");
  assert.equal(packageJson.scripts["start:staff"], "node scripts/run-staff-app.mjs start");
  assert.equal(packageJson.scripts.start, "node scripts/run-staff-app.mjs start");
  assert.match(runner, /TETAMU_APP_SURFACE: "staff"/);
  assert.match(runner, /\|\| "3100"/);
  assert.doesNotMatch(runner, /dev-supervisor/);
  assert.match(runner, /tetamu-local-development-employee-auth-secret-v1/);
  assert.match(runner, /"migrate",\s*"deploy"/);
});

test("Staff App surface redirects back-office pages to staff login", () => {
  const middleware = readFileSync(
    join(root, "src", "middleware.ts"),
    "utf8",
  );

  assert.match(middleware, /process\.env\.TETAMU_APP_SURFACE === "staff"/);
  assert.match(middleware, /new URL\("\/staff\/login", request\.url\)/);
  assert.match(middleware, /"\/reports\/:path\*"/);
});

test("Staff OTP transactions allow enough time to finish security audits", () => {
  const otpService = readFileSync(
    join(root, "src", "lib", "attendance", "employee-auth", "otp-service.ts"),
    "utf8",
  );

  assert.match(otpService, /EMPLOYEE_AUTH_TRANSACTION_OPTIONS/);
  assert.match(otpService, /maxWait:\s*5_000/);
  assert.match(otpService, /timeout:\s*20_000/);
  assert.equal(
    otpService.match(/}, EMPLOYEE_AUTH_TRANSACTION_OPTIONS\);/g)?.length,
    5,
  );
});

test("Staff Attendance reads tolerate normal production database latency", () => {
  const attendanceReadService = readFileSync(
    join(root, "src", "lib", "attendance", "read-service.ts"),
    "utf8",
  );

  assert.match(
    attendanceReadService,
    /EMPLOYEE_ATTENDANCE_READ_TRANSACTION_OPTIONS/,
  );
  assert.match(attendanceReadService, /timeout:\s*20_000/);
  assert.equal(
    attendanceReadService.match(
      /}, EMPLOYEE_ATTENDANCE_READ_TRANSACTION_OPTIONS\);/g,
    )?.length,
    2,
  );
});
