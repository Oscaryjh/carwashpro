import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createAttendanceIdempotencyKey,
  createBrowserUuid,
  getOrCreateDeviceIdentifier,
  attendanceActionLabel,
  attendanceConfirmation,
  formatMinutesAsHours,
  gpsStatusLabel,
  isEmployeeSessionError,
  maskPhoneForDisplay,
} from "../../src/lib/staff-pwa/client";
import { buildStaffManifest } from "../../src/lib/staff-pwa/manifest";
import { buildStaffNavigation } from "../../src/lib/staff-pwa/navigation";

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
const moduleRouteSource = readFileSync(
  new URL("../../src/app/api/employee-auth/modules/route.ts", import.meta.url),
  "utf8",
);
const staffCssSource = readFileSync(
  new URL("../../src/app/staff/staff.css", import.meta.url),
  "utf8",
);
const homeSource = readFileSync(
  new URL("../../src/lib/staff-pwa/home.ts", import.meta.url),
  "utf8",
);
const attendanceMutationSources = [
  "clock-in",
  "clock-out",
  "break-start",
  "break-end",
  "exception",
  "p2-corrections",
  "resolutions",
].map((route) => readFileSync(
  new URL(`../../src/app/api/employee-attendance/${route}/route.ts`, import.meta.url),
  "utf8",
));

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

test("Staff PWA replaces a malformed persisted device identifier", () => {
  const values = new Map<string, string>([["tetamu.staff.device", "x".repeat(257)]]);
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    },
  });

  try {
    const identifier = getOrCreateDeviceIdentifier();
    assert.ok(identifier.length >= 16 && identifier.length <= 256);
    assert.notEqual(identifier, "x".repeat(257));
    assert.equal(values.get("tetamu.staff.device"), identifier);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
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

test("Today prioritizes shift facts and shows explicit completion and approval states", () => {
  assert.match(todaySource, /label="Clock out"/);
  assert.match(todaySource, /Shift completed/);
  assert.match(todaySource, /Manager approval pending/);
  assert.match(todaySource, /formatBranchDate\(today\.branchLocalTime\)/);
  assert.match(todaySource, /formatWorkplace\(today\.business\.name, today\.branch\.name\)/);
  assert.doesNotMatch(todaySource, /label="GPS"/);
  assert.doesNotMatch(todaySource, /<section className="staff-time-card">/);
});

test("Today offers an additional shift after a completed session", () => {
  assert.match(todaySource, /Start another shift/);
  assert.match(todaySource, /previous shift stays completed/);
  assert.match(todaySource, /today\.completedSessionCount > 0/);
});

test("Today shows only explicit expected-attendance evidence and never guesses an off day", () => {
  assert.match(todaySource, /No published schedule available/);
  assert.match(todaySource, /will not infer that this is an off day/);
  assert.match(todaySource, /expectedAttendance\.kind/);
  assert.doesNotMatch(todaySource, /!today\.expectedAttendance[^\n]*Off Day/i);
});

test("OTP UI never stores the entered OTP and supports paste plus resend timing", () => {
  assert.match(authSource, /onPaste=\{paste\}/);
  assert.match(authSource, /Resend in \$\{resendSeconds\}s/);
  assert.doesNotMatch(authSource, /localStorage\.setItem\([^)]*otp/i);
  assert.doesNotMatch(authSource, /sessionStorage\.setItem\([^)]*otp/i);
});

test("Staff manifest is installable and starts inside the isolated Staff scope", () => {
  const manifest = buildStaffManifest();
  assert.equal(manifest.name, "Tetamu Staff App");
  assert.equal(manifest.start_url, "/staff");
  assert.equal(manifest.scope, "/staff");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons?.some((icon) => icon.purpose === "maskable"));
});

test("Staff navigation follows module entitlement without overcrowding the mobile bar", () => {
  const posOnly = buildStaffNavigation(["CORE", "POS", "SALON"]);
  assert.deepEqual(posOnly.primary.map((item) => item.label), ["Home", "Profile"]);
  assert.deepEqual(posOnly.more, []);

  const hrOnly = buildStaffNavigation(["CORE", "HR"]);
  assert.deepEqual(hrOnly.primary.map((item) => item.label), ["Home", "Attendance", "Leave", "Profile"]);
  assert.deepEqual(hrOnly.more.map((item) => item.label), ["My Schedule", "My Timesheets"]);

  const full = buildStaffNavigation(["CORE", "HR", "CLAIMS", "COMMISSION", "PAYROLL"]);
  assert.deepEqual(full.more.map((item) => item.label), ["My Schedule", "My Timesheets", "My Claims", "My Commission", "My Payslips"]);
  assert.ok(full.primary.length + 1 <= 5, "primary navigation plus More must fit five mobile slots");
});

test("Staff navigation refreshes live employee module entitlement after login", () => {
  assert.match(moduleRouteSource, /requireEmployeeSelfServiceAuthContext/);
  assert.match(moduleRouteSource, /loadBusinessModuleContext\(auth\.businessId\)/);
  assert.match(moduleRouteSource, /enabledModules: \[\.\.\.context\.enabledModules\]/);
});

test("Staff Home delegates summaries to canonical domain readers", () => {
  assert.match(homeSource, /getEmployeeLeaveOverview/);
  assert.match(homeSource, /getEmployeeClaimOverview/);
  assert.match(homeSource, /getEmployeeCommissionStatements/);
  assert.match(homeSource, /getEmployeeTimesheetOverview/);
  assert.match(homeSource, /loadPublishedPayslipsForEmployee/);
  assert.doesNotMatch(homeSource, /prisma\./);
  assert.match(homeSource, /Temporarily unavailable/);
  assert.match(homeSource, /showWelcome: !modules\.has\("HR"\)/);
});

test("every employee Attendance mutation rechecks the HR module server-side", () => {
  for (const source of attendanceMutationSources) {
    assert.match(source, /requireEmployeeBusinessModule\(auth, "HR"\)/);
  }
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

test("Staff PWA owns vertical scrolling when the POS body is locked", () => {
  const shellRule = staffCssSource.match(/\.staff-pwa-shell\s*\{[\s\S]*?\}/)?.[0];
  assert.ok(shellRule);
  assert.match(shellRule, /height:\s*100dvh/);
  assert.match(shellRule, /overflow-y:\s*auto/);
  assert.match(shellRule, /overflow-x:\s*hidden/);
  assert.match(shellRule, /-webkit-overflow-scrolling:\s*touch/);
});
