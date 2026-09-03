import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createAttendanceIdempotencyKey,
  createBrowserUuid,
  clearStaffTenantClientState,
  getOrCreateDeviceIdentifier,
  attendanceActionLabel,
  attendanceConfirmation,
  formatPhoneForConfirmation,
  formatMinutesAsHours,
  gpsStatusLabel,
  isEmployeeSessionError,
  maskPhoneForDisplay,
  wasBreakEndedRecently,
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
const profileSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-profile.tsx", import.meta.url),
  "utf8",
);
const profileCssSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-profile-v2.module.css", import.meta.url),
  "utf8",
);
const devicePageSource = readFileSync(
  new URL("../../src/app/staff/device/page.tsx", import.meta.url),
  "utf8",
);
const requestsSource = readFileSync(
  new URL("../../src/app/staff/requests/page.tsx", import.meta.url),
  "utf8",
);
const requestsModelSource = readFileSync(
  new URL("../../src/lib/staff-pwa/requests-hub.ts", import.meta.url),
  "utf8",
);
const paySource = readFileSync(
  new URL("../../src/app/staff/pay/page.tsx", import.meta.url),
  "utf8",
);
const payHubSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-pay-hub-v2.tsx", import.meta.url),
  "utf8",
);
const historySource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-history.tsx", import.meta.url),
  "utf8",
);
const timeHubSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-time-hub.tsx", import.meta.url),
  "utf8",
);
const employeeTimesheetSource = readFileSync(
  new URL("../../src/lib/attendance/employee-timesheet.ts", import.meta.url),
  "utf8",
);
const timesheetPageSource = readFileSync(
  new URL("../../src/app/staff/timesheet/page.tsx", import.meta.url),
  "utf8",
);
const timesheetV2Source = readFileSync(
  new URL("../../src/components/staff-pwa/staff-timesheet-v2.tsx", import.meta.url),
  "utf8",
);
const timesheetV2ModelSource = readFileSync(
  new URL("../../src/lib/staff-pwa/timesheet-v2.ts", import.meta.url),
  "utf8",
);
const homeOverviewSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-home-overview.tsx", import.meta.url),
  "utf8",
);
const leaveSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-leave.tsx", import.meta.url),
  "utf8",
);
const claimsSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-claims.tsx", import.meta.url),
  "utf8",
);
const payslipsSource = [
  readFileSync(new URL("../../src/app/staff/payslips/page.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src/components/staff-pwa/staff-payslips-v2.tsx", import.meta.url), "utf8"),
].join("\n");
const commissionSource = [
  readFileSync(new URL("../../src/app/staff/commission/page.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../src/components/staff-pwa/staff-commission-v2.tsx", import.meta.url), "utf8"),
].join("\n");
const chromeSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-pwa-chrome.tsx", import.meta.url),
  "utf8",
);
const switchWorkplaceRouteSource = readFileSync(
  new URL("../../src/app/api/employee-auth/switch-workplace/route.ts", import.meta.url),
  "utf8",
);
const serviceWorkerSource = readFileSync(
  new URL("../../public/sw.js", import.meta.url),
  "utf8",
);
const pwaRegisterSource = readFileSync(
  new URL("../../src/components/pwa-register.tsx", import.meta.url),
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
const meRouteSource = readFileSync(
  new URL("../../src/app/api/employee-auth/me/route.ts", import.meta.url),
  "utf8",
);
const staffCssSource = readFileSync(
  new URL("../../src/app/staff/staff.css", import.meta.url),
  "utf8",
);
const nextConfigSource = readFileSync(
  new URL("../../next.config.mjs", import.meta.url),
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
test("Staff PWA warns only when another break starts shortly after the previous one", () => {
  assert.equal(wasBreakEndedRecently({
    lastBreakEndedAt: "2026-08-15T01:10:02.000Z",
    serverTime: "2026-08-15T01:10:16.000Z",
  }), true);
  assert.equal(wasBreakEndedRecently({
    lastBreakEndedAt: "2026-08-15T01:10:02.000Z",
    serverTime: "2026-08-15T01:12:02.000Z",
  }), false);
  assert.equal(wasBreakEndedRecently({
    lastBreakEndedAt: null,
    serverTime: "2026-08-15T01:10:16.000Z",
  }), false);
});

test("Staff PWA formats employee-safe status without exposing the full phone", () => {
  assert.equal(maskPhoneForDisplay("+60123456789"), "•••• 6789");
  assert.equal(formatMinutesAsHours(450), "7h 30m");
  assert.equal(gpsStatusLabel("INSIDE"), "Inside Work Location");
  assert.equal(gpsStatusLabel("OUTSIDE"), "Outside Work Location");
  assert.equal(gpsStatusLabel("GEOFENCE_DISABLED"), "Geofence Disabled");
});

test("Staff verification formats the full Malaysian number for confirmation", () => {
  assert.equal(formatPhoneForConfirmation("01112212259"), "+60 11 1221 2259");
  assert.equal(formatPhoneForConfirmation("+60123456789"), "+60 12 345 6789");
});

test("Staff OTP rate limiting never opens a fake verification countdown", () => {
  assert.match(authSource, /result\.requestStatus === "RATE_LIMITED"/);
  assert.match(authSource, /setMessage\(result\.message\)/);
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

test("workplace switching clears tenant state without deleting the verified device", () => {
  const sessionValues = new Map<string, string>([
    ["tetamu.staff.auth-flow", "temporary"],
    ["tetamu.staff.tenant.home", "business-a"],
    ["unrelated", "keep"],
  ]);
  const localValues = new Map<string, string>([
    ["tetamu.staff.device", "verified-device"],
    ["tetamu.staff.tenant.filters", "business-a"],
  ]);
  const storage = (values: Map<string, string>) => ({
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: storage(sessionValues),
      localStorage: storage(localValues),
    },
  });

  try {
    clearStaffTenantClientState();
    assert.equal(sessionValues.has("tetamu.staff.auth-flow"), false);
    assert.equal(sessionValues.has("tetamu.staff.tenant.home"), false);
    assert.equal(localValues.has("tetamu.staff.tenant.filters"), false);
    assert.equal(localValues.get("tetamu.staff.device"), "verified-device");
    assert.equal(sessionValues.get("unrelated"), "keep");
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
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
  assert.match(todaySource, /label: "Clock out"/);
  assert.match(todaySource, /kicker="Shift done"/);
  assert.match(todaySource, /Manager approval pending/);
  assert.match(todaySource, /formatBranchDate\(today\.branchLocalTime\)/);
  assert.match(todaySource, /StaffV2CompactSummary items=\{summaryItems\}/);
  assert.match(todaySource, /meta=\{today\.expectedAttendance/);
  assert.doesNotMatch(todaySource, /staff-metrics/);
  assert.doesNotMatch(todaySource, /label="GPS"/);
  assert.doesNotMatch(todaySource, /<section className="staff-time-card">/);
});

test("Today offers an additional shift after a completed session", () => {
  assert.match(todaySource, /Start another shift/);
  assert.match(todaySource, /previous shift stays completed/);
  assert.match(todaySource, /today\.completedSessionCount > 0/);
});

test("Today shows only explicit expected-attendance evidence and never guesses an off day", () => {
  assert.match(todaySource, /Schedule not available/);
  assert.match(todaySource, /Check Schedule or ask your manager/);
  assert.match(todaySource, /expectedAttendance\.kind/);
  assert.doesNotMatch(todaySource, /!today\.expectedAttendance[^\n]*Off Day/i);
});

test("location failures offer recovery before manager approval", () => {
  assert.match(todaySource, /Try location again/);
  assert.match(todaySource, /Request manager approval/);
  assert.match(todaySource, /exceptionPrompt && !exceptionFormOpen/);
  assert.match(todaySource, /GPS_INSECURE_CONTEXT/);
  assert.match(todaySource, /GPS_TIMEOUT/);
  assert.match(todaySource, /GPS_POSITION_UNAVAILABLE/);
  assert.match(todaySource, /enableHighAccuracy: false/);
  assert.match(todaySource, /timeout: 30_000/);
  assert.match(todaySource, /Google Location Accuracy/);
  assert.doesNotMatch(
    todaySource,
    /This punch needs an exception reason and manager approval/,
  );
});

test("OTP UI never stores the entered OTP and supports paste plus resend timing", () => {
  assert.match(authSource, /onPaste=\{paste\}/);
  assert.match(authSource, /Resend in \$\{resendSeconds\}s/);
  assert.match(authSource, /Didn’t receive the SMS\?/);
  assert.match(authSource, /A new code was sent to/);
  assert.match(authSource, /digits\.join\(""\)\.length !== 6/);
  assert.doesNotMatch(authSource, /localStorage\.setItem\([^)]*otp/i);
  assert.doesNotMatch(authSource, /sessionStorage\.setItem\([^)]*otp/i);
});

test("successful Staff authentication always opens Home instead of More", () => {
  assert.equal(
    authSource.match(/window\.location\.replace\("\/staff"\)/g)?.length,
    2,
  );
  assert.doesNotMatch(authSource, /\/staff\/device\?verified=1/);
});

test("Staff manifest is installable and starts inside the isolated Staff scope", () => {
  const manifest = buildStaffManifest();
  assert.equal(manifest.name, "Tetamu Staff App");
  assert.equal(manifest.id, "/staff");
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
  assert.deepEqual(hrOnly.primary.map((item) => item.label), ["Home", "Time", "Requests", "Profile"]);
  assert.deepEqual(hrOnly.more, []);

  const full = buildStaffNavigation(["CORE", "HR", "CLAIMS", "COMMISSION", "PAYROLL"]);
  assert.deepEqual(full.primary.map((item) => item.label), ["Home", "Time", "Requests", "Pay", "Profile"]);
  assert.deepEqual(full.more, []);
  assert.equal(full.primary.length, 5, "Staff navigation is fixed to five mobile destinations");
});

test("Staff Requests separates employee self-service from role-aware manager approvals", () => {
  assert.match(requestsSource, /title="Approvals"/);
  assert.match(requestsModelSource, /waiting for you/);
  assert.match(requestsModelSource, /All clear/);
  assert.match(requestsSource, /loadRequestsApprovalEntry/);
  assert.match(requestsSource, /My requests/);
  assert.match(requestsSource, /Attendance correction/);
  assert.match(requestsSource, /href="\/staff\/history\/corrections"/);
  assert.match(requestsSource, /title="Attendance corrections"/);
  assert.doesNotMatch(requestsSource, /Review employee time corrections waiting/);
  assert.doesNotMatch(requestsSource, /canonical workflow/);
  assert.doesNotMatch(requestsSource, /Submit OT|Request overtime/);
  assert.match(leaveSource, /Supporting document required/);
  assert.match(leaveSource, /Supporting document optional/);
  assert.doesNotMatch(leaveSource, /readinessCode \?/);
  assert.match(claimsSource, /Receipt required/);
  assert.match(claimsSource, /Next: Waiting for review/);
  assert.match(claimsSource, /createBrowserUuid\(\)/);
});

test("Staff Home makes Clock In and Clock Out the dominant daily action", () => {
  assert.match(todaySource, /staff-attendance-primary-card/);
  assert.match(todaySource, /staff-primary-button staff-clock-action/);
});

test("Staff Time Hub groups personal time destinations while History owns the archive", () => {
  assert.match(timeHubSource, /title="Schedule"/);
  assert.match(timeHubSource, /title="Attendance history"/);
  assert.match(timeHubSource, /title="Timesheet & overtime"/);
  assert.match(timeHubSource, /href="\/staff\/history\/records"/);
  assert.doesNotMatch(timeHubSource, /Approval Center|Team approvals/);
  assert.match(historySource, /attendance-correction/);
  assert.match(historySource, /hasSingleBranch/);
  assert.match(historySource, /hasMultipleBranches/);
});

test("Staff monthly timesheet keeps attendance results and exceptions inside the displayed month", () => {
  assert.equal(
    employeeTimesheetSource.match(/workDate: \{ gte: monthStart, lt: monthEndExclusive \}/g)?.length,
    2,
  );
  assert.match(timesheetPageSource, /parseStaffTimesheetMonth\(query\.month\)/);
  assert.match(timesheetPageSource, /getEmployeeTimesheetOverview\(auth, \{ now: monthStart \}\)/);
  assert.match(timesheetV2ModelSource, /Action needed/);
  assert.match(timesheetV2ModelSource, /Waiting for manager/);
  assert.match(timesheetV2ModelSource, /Final/);
  assert.match(timesheetV2Source, /StaffV2DetailSection title="Result"/);
  assert.match(timesheetV2Source, /StaffV2DetailSection title="Why"/);
  assert.match(timesheetV2Source, /StaffV2DetailSection title="Next action"/);
  assert.doesNotMatch(timesheetV2Source, /final attendance results|snapshot|materialization|Submit OT|Request overtime/);
});

test("Staff Pay shows the latest available Gross and Net without inferred deductions", () => {
  assert.match(payHubSource, /Gross pay/);
  assert.doesNotMatch(`${paySource}\n${payHubSource}`, /Deductions/);
  assert.match(payHubSource, />Net pay</);
  assert.match(payHubSource, /Download PDF/);
  assert.match(payHubSource, />Available</);
  assert.match(payHubSource, /Payslip not available yet/);
  assert.doesNotMatch(payHubSource, />Published</);
  assert.match(payslipsSource, /Available since/);
  assert.match(commissionSource, /Your commission statements/);
  assert.match(commissionSource, /Payroll linkage does not prove payslip publication or salary settlement/);
});

test("Staff Profile V2 keeps one canonical workplace switch path and safe device semantics", () => {
  assert.match(profileSource, />Current workplace</);
  assert.match(profileSource, /workplaces\.length > 1/);
  assert.match(chromeSource, /openWorkplaceSwitcher/);
  assert.match(profileSource, /<details className=\{styles\.details\}>/);
  assert.match(profileSource, />This phone</);
  assert.match(profileSource, /Authorized on/);
  assert.match(profileSource, /label="Last active"/);
  assert.doesNotMatch(profileSource, /Signed in|Last signed in|displayName|Can view|Can punch/);
  assert.match(devicePageSource, /redirect\(verified === "1" \? "\/staff\/profile\?device=verified" : "\/staff\/profile"\)/);
});

test("Staff navigation refreshes live employee module entitlement after login", () => {
  assert.match(moduleRouteSource, /requireEmployeeSelfServiceAuthContext/);
  assert.match(moduleRouteSource, /loadBusinessModuleContext\(auth\.businessId\)/);
  assert.match(moduleRouteSource, /enabledModules: \[\.\.\.context\.enabledModules\]/);
});

test("Staff session refreshes on app open and foreground activity", () => {
  assert.match(chromeSource, /\/api\/employee-auth\/me/);
  assert.match(chromeSource, /visibilitychange/);
  assert.match(chromeSource, /isEmployeeSessionError/);
  assert.match(meRouteSource, /readEmployeeSessionToken\(request\)/);
  assert.match(meRouteSource, /response\.cookies\.set/);
  assert.match(meRouteSource, /employeeSessionCookieOptions\(config\)/);
});

test("Staff Home stays lightweight and delegates schedule and appointments to canonical readers", () => {
  assert.match(homeSource, /getEmployeePublishedRoster/);
  assert.match(homeSource, /getStaffAppointmentDay/);
  assert.match(homeSource, /loadStaffAppAppearance/);
  assert.match(homeSource, /modules\.has\("SALON"\)/);
  assert.doesNotMatch(homeOverviewSource, /<p>\{businessName\}<\/p>/);
  assert.doesNotMatch(homeOverviewSource, /staff-welcome-branch/);
  assert.match(homeSource, /domain: "APPOINTMENTS"/);
  assert.match(homeSource, /domain: "ROSTER"/);
  assert.match(homeSource, /domain: "LEAVE"/);
  assert.doesNotMatch(homeSource, /items\.push\(\{ domain: "TIMESHEET"/);
  assert.doesNotMatch(homeSource, /items\.push\(\{ domain: "CLAIMS"/);
  assert.doesNotMatch(homeSource, /items\.push\(\{ domain: "COMMISSION"/);
  assert.doesNotMatch(homeSource, /items\.push\(\{ domain: "PAYSLIP"/);
  assert.match(homeSource, /Schedule temporarily unavailable/);
  assert.match(homeSource, /showWelcome: true/);
});

test("Staff workplace switching is server-scoped and performs a hard tenant reset", () => {
  assert.match(switchWorkplaceRouteSource, /requireEmployeeSelfServiceAuthContext/);
  assert.match(switchWorkplaceRouteSource, /switchEmployeeWorkplace/);
  assert.match(switchWorkplaceRouteSource, /membershipId: z\.string\(\)\.uuid\(\)/);
  assert.doesNotMatch(switchWorkplaceRouteSource, /businessId/);
  assert.match(chromeSource, /clearStaffTenantClientState\(\)/);
  assert.match(chromeSource, /window\.location\.replace\("\/staff"\)/);
  assert.match(chromeSource, /Choose workplace/);
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

test("Local development removes stale PWA workers and caches", () => {
  assert.match(pwaRegisterSource, /process\.env\.NODE_ENV !== "production"/);
  assert.match(pwaRegisterSource, /navigator\.serviceWorker\s*\.getRegistrations\(\)/);
  assert.match(pwaRegisterSource, /registration\.unregister\(\)/);
  assert.match(pwaRegisterSource, /cacheName\.startsWith\("tetamu-pos-static-"\)/);
});

test("POS middleware does not treat Staff PWA as a POS user route", () => {
  const matcher = middlewareSource.slice(middlewareSource.indexOf("matcher:"));
  assert.doesNotMatch(matcher, /"\/staff/);
  assert.match(matcher, /"\/team\/:path\*"/);
});

test("port 3000 owns the canonical Staff routes without a 3100 redirect", () => {
  assert.doesNotMatch(nextConfigSource, /STAFF_APP_ORIGIN/);
  assert.doesNotMatch(nextConfigSource, /source:\s*"\/staff\/:path\*"/);
  assert.doesNotMatch(nextConfigSource, /localhost:3100/);
});

test("Staff PWA owns vertical scrolling when the POS body is locked", () => {
  const shellRule = staffCssSource.match(/\.staff-pwa-shell\s*\{[\s\S]*?\}/)?.[0];
  assert.ok(shellRule);
  assert.match(shellRule, /height:\s*100dvh/);
  assert.match(shellRule, /overflow-y:\s*auto/);
  assert.match(shellRule, /overflow-x:\s*hidden/);
  assert.match(shellRule, /-webkit-overflow-scrolling:\s*touch/);
});

test("Staff Profile V2 contains long identity and workplace labels on narrow phones", () => {
  assert.match(profileSource, /className=\{styles\.identityCopy\}/);
  assert.match(profileSource, /className=\{styles\.workplaceCopy\}/);
  assert.match(profileCssSource, /\.identityCopy\s*\{\s*min-width:\s*0/);
  assert.match(profileCssSource, /\.workplaceCopy\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(profileCssSource, /overflow-wrap:\s*anywhere/);
  assert.match(profileCssSource, /@media \(max-width: 380px\)/);
});

test("Local mobile Staff App can hydrate from loopback and the private Wi-Fi subnet", () => {
  assert.match(
    nextConfigSource,
    /allowedDevOrigins:\s*\["127\.0\.0\.1",\s*"192\.168\.1\.\*"\]/,
  );
});
