import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createAttendanceIdempotencyKey,
  createBrowserUuid,
  attendanceActionLabel,
  attendanceConfirmation,
  formatMinutesAsHours,
  gpsStatusLabel,
  isEmployeeSessionError,
  maskPhoneForDisplay,
} from "../../src/lib/staff-pwa/client";
import { buildStaffManifest } from "../../src/lib/staff-pwa/manifest";

const todaySource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-today.tsx", import.meta.url),
  "utf8",
);
const authSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-auth.tsx", import.meta.url),
  "utf8",
);
const serviceWorkerSource = readFileSync(
  new URL("../../public/sw.js", import.meta.url),
  "utf8",
);
const middlewareSource = readFileSync(
  new URL("../../src/middleware.ts", import.meta.url),
  "utf8",
);

test("Staff PWA action labels and confirmation copy cover the API action set", () => {
  assert.equal(attendanceActionLabel("CLOCK_IN"), "Clock In");
  assert.equal(attendanceActionLabel("BREAK_START"), "Start Break");
  assert.equal(attendanceActionLabel("BREAK_END"), "End Break");
  assert.equal(attendanceActionLabel("CLOCK_OUT"), "Clock Out");
  assert.match(attendanceConfirmation("CLOCK_IN"), /current branch/i);
  assert.match(attendanceConfirmation("CLOCK_OUT"), /ending today/i);
});

test("Staff PWA formats employee-safe status without exposing the full phone", () => {
  assert.equal(maskPhoneForDisplay("+60123456789"), "•••• 6789");
  assert.equal(formatMinutesAsHours(450), "7h 30m");
  assert.equal(gpsStatusLabel("INSIDE"), "Inside Work Location");
  assert.equal(gpsStatusLabel("OUTSIDE"), "Outside Work Location");
  assert.equal(gpsStatusLabel("GEOFENCE_DISABLED"), "Geofence Disabled");
});

test("Staff PWA creates secure identifiers without requiring randomUUID", () => {
  let nextByte = 0;
  const insecureContextCrypto = {
    getRandomValues<T extends ArrayBufferView | null>(array: T) {
      if (!array) return array;
      const bytes = new Uint8Array(
        array.buffer,
        array.byteOffset,
        array.byteLength,
      );
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = nextByte % 256;
        nextByte += 1;
      }
      return array;
    },
  } as Pick<Crypto, "getRandomValues">;

  const uuid = createBrowserUuid(insecureContextCrypto);
  assert.match(
    uuid,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.match(
    createAttendanceIdempotencyKey("CLOCK_IN"),
    /^staff-pwa:clock_in:[0-9a-f-]{36}$/,
  );
});

test("revoked and expired employee sessions are routed back to Staff login", () => {
  assert.equal(isEmployeeSessionError("SESSION_EXPIRED"), true);
  assert.equal(isEmployeeSessionError("SESSION_REVOKED"), true);
  assert.equal(isEmployeeSessionError("DEVICE_REVOKED"), true);
  assert.equal(isEmployeeSessionError("VALIDATION_ERROR"), false);
});

test("Today renders actions only from the Today API and preserves one idempotency key", () => {
  assert.match(todaySource, /today\.allowedActions\.map/);
  assert.match(todaySource, /createAttendanceIdempotencyKey\(action\)/);
  assert.match(todaySource, /Retry the same request/);
  assert.match(todaySource, /await load\(true\)/);
  assert.doesNotMatch(todaySource, /getAllowedAttendanceActions/);
});

test("OTP UI never stores the entered OTP and supports paste plus resend timing", () => {
  assert.match(authSource, /onPaste=\{paste\}/);
  assert.match(authSource, /Resend in \$\{resendSeconds\}s/);
  assert.doesNotMatch(authSource, /localStorage\.setItem\([^)]*otp/i);
  assert.doesNotMatch(authSource, /sessionStorage\.setItem\([^)]*otp/i);
});

test("Staff manifest is installable and starts inside the isolated Staff scope", () => {
  const manifest = buildStaffManifest();
  assert.equal(manifest.name, "Tetamu Attendance");
  assert.equal(manifest.start_url, "/staff");
  assert.equal(manifest.scope, "/staff");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons?.some((icon) => icon.purpose === "maskable"));
});

test("Service worker never caches Attendance APIs or navigations", () => {
  assert.match(serviceWorkerSource, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorkerSource, /request\.mode === "navigate"/);
  assert.match(serviceWorkerSource, /\/staff\/manifest\.webmanifest/);
  assert.doesNotMatch(serviceWorkerSource, /employee-attendance.*cache\.put/i);
});

test("POS middleware does not treat Staff PWA as a POS user route", () => {
  const matcher = middlewareSource.slice(middlewareSource.indexOf("matcher:"));
  assert.doesNotMatch(matcher, /"\/staff/);
  assert.match(matcher, /"\/team\/:path\*"/);
});
