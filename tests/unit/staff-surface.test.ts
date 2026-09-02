import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("Staff App uses the canonical 3000 runtime and has no 3100 runner", () => {
  const packageJson = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.equal(packageJson.scripts["dev:staff"], undefined);
  assert.equal(packageJson.scripts["start:staff"], undefined);
  assert.match(packageJson.scripts.start, /next start/);
  assert.equal(existsSync(join(root, "scripts", "run-staff-app.mjs")), false);
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

test("Staff OTP database transactions have a bounded cold-start tolerance", () => {
  const otpService = readFileSync(
    join(root, "src", "lib", "attendance", "employee-auth", "otp-service.ts"),
    "utf8",
  );

  assert.match(otpService, /EMPLOYEE_OTP_TRANSACTION_OPTIONS/);
  assert.match(otpService, /maxWait:\s*5_000/);
  assert.match(otpService, /timeout:\s*15_000/);
  assert.equal(
    otpService.match(/}, EMPLOYEE_OTP_TRANSACTION_OPTIONS\);/g)?.length,
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
