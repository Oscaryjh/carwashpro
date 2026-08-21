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
  formatMinutesAsHours,
  gpsStatusLabel,
  isEmployeeSessionError,
  maskPhoneForDisplay,
  wasBreakEndedRecently,
} from "../../src/lib/staff-pwa/client";
import { buildStaffManifest } from "../../src/lib/staff-pwa/manifest";
import { buildStaffNavigation } from "../../src/lib/staff-pwa/navigation";
import {
  DEFAULT_STAFF_APP_ICONS,
  resolveStaffAppAppearance,
  toStoredStaffAppAppearance,
} from "../../src/lib/staff-pwa/appearance-config";

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
const nextConfigSource = readFileSync(
  new URL("../../next.config.mjs", import.meta.url),
  "utf8",
);
const rootLayoutSource = readFileSync(
  new URL("../../src/app/layout.tsx", import.meta.url),
  "utf8",
);
const verifyPageSource = readFileSync(
  new URL("../../src/app/staff/verify/page.tsx", import.meta.url),
  "utf8",
);
const clientInstrumentationSource = readFileSync(
  new URL("../../src/instrumentation-client.ts", import.meta.url),
  "utf8",
);
const homeSource = readFileSync(
  new URL("../../src/lib/staff-pwa/home.ts", import.meta.url),
  "utf8",
);
const employeeSessionSource = readFileSync(
  new URL(
    "../../src/lib/attendance/employee-auth/session.ts",
    import.meta.url,
  ),
  "utf8",
);
const homeComponentSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-home-overview.tsx", import.meta.url),
  "utf8",
);
const appearanceActionSource = readFileSync(
  new URL(
    "../../src/app/(business)/business/settings/staff-app/actions.ts",
    import.meta.url,
  ),
  "utf8",
);
const historyComponentSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-history.tsx", import.meta.url),
  "utf8",
);
const leaveComponentSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-leave.tsx", import.meta.url),
  "utf8",
);
const leaveCssSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-leave.module.css", import.meta.url),
  "utf8",
);
const timesheetPageSource = readFileSync(
  new URL("../../src/app/staff/timesheet/page.tsx", import.meta.url),
  "utf8",
);
const rosterPageSource = readFileSync(
  new URL("../../src/app/staff/roster/page.tsx", import.meta.url),
  "utf8",
);
const commissionPageSource = readFileSync(
  new URL("../../src/app/staff/commission/page.tsx", import.meta.url),
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
  assert.match(todaySource, /label="Clock out"/);
  assert.match(todaySource, /Shift completed/);
  assert.match(todaySource, /Manager approval pending/);
  assert.match(todaySource, /formatBranchDate\(today\.branchLocalTime\)/);
  assert.match(todaySource, /today\.branch\.name/);
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
  assert.match(todaySource, /Check Schedule or contact your manager for today’s shift/);
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
  assert.match(authSource, /className="staff-auth-card staff-verify-card"/);
  assert.match(authSource, /<h1>Check your phone<\/h1>/);
  assert.match(authSource, /onClick=\{changePhoneNumber\}/);
  assert.match(authSource, /<span>Development OTP<\/span>/);
  assert.match(authSource, /<strong>Ready now<\/strong>/);
  assert.match(verifyPageSource, /developmentFastPath=\{config\.otp\.developmentFastPath\}/);
  assert.match(staffCssSource, /\.staff-auth-shell \.staff-auth-card\.staff-verify-card/);
  assert.match(authSource, /formRef\.current\?\.requestSubmit\(\)/);
  assert.match(authSource, /verificationInFlightRef\.current/);
  assert.match(authSource, /Code checks automatically/);
  assert.match(authSource, /Incorrect OTP\. Please try again\./);
  assert.doesNotMatch(authSource, /Verifying…" : "Verify code/);
  assert.doesNotMatch(authSource, /localStorage\.setItem\([^)]*otp/i);
  assert.doesNotMatch(authSource, /sessionStorage\.setItem\([^)]*otp/i);
});

test("workplace selection keeps internal employee codes out of the login UI", () => {
  assert.match(authSource, /showBranchName \? <small>\{membership\.primaryBranchName\}<\/small> : null/);
  assert.doesNotMatch(authSource, /\{membership\.primaryBranchName\} · \{membership\.employeeCode\}/);
});

test("Staff login tolerates mobile browser form metadata added before hydration", () => {
  assert.match(authSource, /onSubmit=\{submit\} suppressHydrationWarning/);
  assert.match(authSource, /required\s+suppressHydrationWarning\s+value=\{phoneNumber\}/);
  assert.match(rootLayoutSource, /<html lang="en-MY" suppressHydrationWarning>/);
  assert.match(clientInstrumentationSource, /"__gcrremoteframetoken"/);
  assert.match(clientInstrumentationSource, /"__gcruniqueid"/);
  assert.match(clientInstrumentationSource, /element\.removeAttribute\(attribute\)/);
});

test("Staff login keeps the iPhone journey focused on one primary action", () => {
  assert.match(authSource, /<h1>Welcome back<\/h1>/);
  assert.match(authSource, /<span>\{busy \? "Requesting code…" : "Continue"\}<\/span>/);
  assert.match(authSource, /<details className="staff-testing-note">/);
  assert.match(chromeSource, /"staff-auth-shell"/);
  assert.match(chromeSource, /scrollTo\(\{ top: 0, behavior: "auto" \}\)/);
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
  assert.equal(manifest.start_url, "/staff");
  assert.equal(manifest.scope, "/staff");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons?.some((icon) => icon.purpose === "maskable"));
});

test("Staff navigation follows module entitlement without overcrowding the mobile bar", () => {
  const posOnly = buildStaffNavigation(["CORE", "POS", "SALON"]);
  assert.deepEqual(posOnly.primary.map((item) => item.label), ["Home"]);
  assert.deepEqual(posOnly.more.map((item) => item.label), ["My Profile"]);

  const hrOnly = buildStaffNavigation(["CORE", "HR"]);
  assert.deepEqual(hrOnly.primary.map((item) => item.label), ["Home", "Attendance", "Leave", "Timesheet"]);
  assert.deepEqual(hrOnly.more.map((item) => item.label), ["My Schedule", "My Profile"]);

  const full = buildStaffNavigation(["CORE", "HR", "CLAIMS", "COMMISSION", "PAYROLL"]);
  assert.deepEqual(full.more.map((item) => item.label), ["My Schedule", "My Claims", "My Commission", "My Payslips", "My Profile"]);
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
  assert.match(homeSource, /showWelcome: true/);
});

test("Staff Home prioritizes a mobile today workspace without inventing new domains", () => {
  assert.match(homeComponentSource, /<p className="staff-kicker">TODAY<\/p>/);
  assert.match(homeComponentSource, /Quick access/);
  assert.match(homeComponentSource, /StaffAppIcon/);
  assert.match(homeComponentSource, /profile\.employee\.avatarUrl/);
  assert.match(employeeSessionSource, /avatarUrl:\s*true/);
  assert.doesNotMatch(homeComponentSource, /<strong>\{card\.value\}<\/strong>/);
  assert.doesNotMatch(homeComponentSource, /staff-home-card-arrow/);
  assert.match(todaySource, /staff-page-card staff-attendance-card/);
  assert.match(todaySource, /Today’s shift/);
  assert.doesNotMatch(todaySource, /Today&apos;s published evidence|Revision \{today\.expectedAttendance\.revision\}|Source:/);
  assert.ok(
    todaySource.indexOf("staff-action-grid") < todaySource.indexOf("aria-label=\"Today's attendance summary\""),
    "Attendance actions should appear before secondary metrics",
  );
  assert.match(staffCssSource, /@media \(max-width: 430px\)[\s\S]*?\.staff-home-grid\s*\{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(staffCssSource, /\.staff-welcome-card h1\s*\{[\s\S]*?white-space:\s*nowrap/);
});

test("Staff App appearance keeps business icon choices safe and complete", () => {
  assert.equal(DEFAULT_STAFF_APP_ICONS.ROSTER, "schedule-3d");
  assert.equal(DEFAULT_STAFF_APP_ICONS.TIMESHEET, "timesheets-3d");
  assert.equal(DEFAULT_STAFF_APP_ICONS.LEAVE, "leave-3d");
  assert.equal(DEFAULT_STAFF_APP_ICONS.CLAIMS, "claims-3d");
  assert.equal(DEFAULT_STAFF_APP_ICONS.COMMISSION, "commission-3d");
  assert.equal(DEFAULT_STAFF_APP_ICONS.PAYSLIP, "payslips-3d");
  const customized = resolveStaffAppAppearance(
    {
      version: 1,
      quickAccessIcons: {
        ROSTER: "briefcase",
        TIMESHEET: "not-an-icon",
      },
    },
    "/uploads/staff-app-logos/staff-logo.webp",
  );

  assert.equal(customized.logoUrl, "/uploads/staff-app-logos/staff-logo.webp");
  assert.equal(customized.quickAccessIcons.ROSTER, "briefcase");
  assert.equal(
    customized.quickAccessIcons.TIMESHEET,
    DEFAULT_STAFF_APP_ICONS.TIMESHEET,
  );
  assert.deepEqual(
    resolveStaffAppAppearance(toStoredStaffAppAppearance(customized.quickAccessIcons)).quickAccessIcons,
    customized.quickAccessIcons,
  );
  assert.equal(Object.keys(customized.quickAccessIcons).length, 6);
  assert.match(chromeSource, /appearance\?\.logoUrl/);
  assert.match(homeSource, /loadStaffAppAppearance/);
  assert.match(
    appearanceActionSource,
    /requireBusinessUser\("MODIFY_BUSINESS_SETTINGS"\)/,
  );
  assert.match(appearanceActionSource, /assertRole\(user, \["BUSINESS_OWNER"\]\)/);
  assert.match(appearanceActionSource, /writeRuntimeStaffAppLogo/);
  assert.match(appearanceActionSource, /STAFF_APP_APPEARANCE_UPDATED/);
});

test("Staff App keeps key employee journeys compact and iPhone-first", () => {
  assert.match(historyComponentSource, /aria-expanded=\{filtersOpen\}/);
  assert.match(leaveComponentSource, /href="#staff-leave-apply"/);
  assert.match(leaveCssSource, /grid-auto-flow:column/);
  assert.match(timesheetPageSource, /staff-timesheet-summary/);
  assert.match(rosterPageSource, /aria-label="Previous week"/);
  assert.match(commissionPageSource, /staff-commission-empty/);
  assert.match(staffCssSource, /font-size: 16px/);
});

test("Staff workplace switching is server-scoped and performs a hard tenant reset", () => {
  assert.match(switchWorkplaceRouteSource, /requireEmployeeSelfServiceAuthContext/);
  assert.match(switchWorkplaceRouteSource, /switchEmployeeWorkplace/);
  assert.match(switchWorkplaceRouteSource, /membershipId: z\.string\(\)\.uuid\(\)/);
  assert.doesNotMatch(switchWorkplaceRouteSource, /businessId/);
  assert.match(chromeSource, /clearStaffTenantClientState\(\)/);
  assert.match(chromeSource, /window\.location\.replace\("\/staff"\)/);
  assert.match(chromeSource, /Choose workplace/);
  assert.match(chromeSource, /showBranchName \? <small>\{workplace\.primaryBranchName\}<\/small> : null/);
  assert.doesNotMatch(chromeSource, /\{workplace\.primaryBranchName\} · \{workplace\.employeeCode\}/);
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

test("Staff Profile keeps long employee identifiers inside the mobile card", () => {
  assert.match(profileSource, /className="staff-profile-identity"/);
  assert.match(profileSource, /className="staff-profile-meta"/);
  assert.match(staffCssSource, /\.staff-profile-identity\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(staffCssSource, /\.staff-profile-meta code\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(staffCssSource, /@media \(max-width: 430px\)[\s\S]*?\.staff-profile-stack \.staff-device-details/);
});

test("Local mobile Staff App can hydrate from the private Wi-Fi subnet", () => {
  assert.match(nextConfigSource, /allowedDevOrigins:\s*\["192\.168\.1\.\*"\]/);
});
