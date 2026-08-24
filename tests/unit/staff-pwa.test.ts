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
const staffAvatarSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-avatar-upload.tsx", import.meta.url),
  "utf8",
);
const staffAvatarRouteSource = readFileSync(
  new URL("../../src/app/api/employee-auth/avatar/route.ts", import.meta.url),
  "utf8",
);
const staffTypesSource = readFileSync(
  new URL("../../src/lib/staff-pwa/types.ts", import.meta.url),
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
const attentionSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-resolution-cases.tsx", import.meta.url),
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
const attendanceExceptionRouteSource = readFileSync(
  new URL("../../src/app/api/employee-attendance/exception/route.ts", import.meta.url),
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
const staffDatePickerSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-date-picker.tsx", import.meta.url),
  "utf8",
);
const staffDatePickerCssSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-date-picker.module.css", import.meta.url),
  "utf8",
);
const newLeavePageSource = readFileSync(
  new URL("../../src/app/staff/leave/new/page.tsx", import.meta.url),
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
const rosterLoadingSource = readFileSync(
  new URL("../../src/app/staff/roster/loading.tsx", import.meta.url),
  "utf8",
);
const rosterErrorSource = readFileSync(
  new URL("../../src/app/staff/roster/error.tsx", import.meta.url),
  "utf8",
);
const commissionPageSource = readFileSync(
  new URL("../../src/app/staff/commission/page.tsx", import.meta.url),
  "utf8",
);
const claimsComponentSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-claims.tsx", import.meta.url),
  "utf8",
);
const claimsCssSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-claims.module.css", import.meta.url),
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
  assert.match(todaySource, /className="staff-shift-summary"/);
  assert.match(todaySource, /className="staff-shift-summary-icon"/);
  assert.match(staffCssSource, /\.staff-shift-summary-copy strong\s*\{[\s\S]*?font-variant-numeric: tabular-nums/);
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
  assert.match(authSource, /sent to <strong>\{flow\.phoneNumber\}<\/strong>/);
  assert.doesNotMatch(authSource, /sent to <strong>\{flow\.phoneMasked\}<\/strong>/);
  assert.match(authSource, /onClick=\{changePhoneNumber\}/);
  assert.match(authSource, /<span>Development OTP<\/span>/);
  assert.match(authSource, /<strong>Ready now<\/strong>/);
  assert.match(verifyPageSource, /developmentFastPath=\{config\.otp\.developmentFastPath\}/);
  assert.match(staffCssSource, /\.staff-auth-shell \.staff-auth-card\.staff-verify-card/);
  assert.match(authSource, /formRef\.current\?\.requestSubmit\(\)/);
  assert.match(authSource, /verificationInFlightRef\.current/);
  assert.match(authSource, /Code checks automatically/);
  assert.match(authSource, /Incorrect OTP\. Please try again\./);
  assert.match(authSource, /function updateDigit[\s\S]*?setMessage\(""\);[\s\S]*?setDigits/);
  assert.match(authSource, /otpError \? "Code not accepted"/);
  assert.match(staffCssSource, /\.staff-otp-auto-status\.is-error/);
  assert.match(staffCssSource, /@media \(max-width: 430px\)[\s\S]*?\.staff-auth-shell \.staff-auth-card\.staff-verify-card\s*\{[\s\S]*?margin-top:\s*10px;[\s\S]*?\.staff-auth-shell \.staff-verify-heading h1\s*\{[\s\S]*?font-size:\s*28px/);
  assert.match(staffCssSource, /@media \(max-width: 430px\)[\s\S]*?\.staff-auth-shell \.staff-otp-inputs\s*\{[\s\S]*?gap:\s*6px;[\s\S]*?\.staff-auth-shell \.staff-otp-auto-status\s*\{[\s\S]*?min-height:\s*52px/);
  assert.doesNotMatch(authSource, /Verifying…" : "Verify code/);
  assert.doesNotMatch(authSource, /localStorage\.setItem\([^)]*otp/i);
  assert.doesNotMatch(authSource, /sessionStorage\.setItem\([^)]*otp/i);
});

test("workplace selection keeps internal employee codes out of the login UI", () => {
  assert.match(authSource, /showBranchName \? <small>\{membership\.primaryBranchName\}<\/small> : null/);
  assert.doesNotMatch(authSource, /\{membership\.primaryBranchName\} · \{membership\.employeeCode\}/);
});

test("temporary Staff authentication failures have a clear retry action", () => {
  assert.match(authSource, /<strong>Connection interrupted<\/strong>/);
  assert.match(authSource, /Your account is safe—please try again\./);
  assert.match(authSource, /onClick=\{retry\}/);
  assert.match(authSource, /function isTemporaryAuthError/);
  assert.match(staffCssSource, /\.staff-auth-service-alert button\s*\{[\s\S]*?min-height:\s*44px/);
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
  assert.deepEqual(posOnly.primary.map((item) => item.label), ["Home", "Appointments"]);
  assert.deepEqual(posOnly.more.map((item) => item.label), ["Profile"]);

  const hrOnly = buildStaffNavigation(["CORE", "HR"]);
  assert.deepEqual(hrOnly.primary.map((item) => item.label), ["Home", "Attendance"]);
  assert.deepEqual(hrOnly.more.map((item) => item.label), ["Profile"]);

  const full = buildStaffNavigation(["CORE", "SALON", "HR", "CLAIMS", "COMMISSION", "PAYROLL"]);
  assert.deepEqual(full.primary.map((item) => item.label), ["Home", "Attendance", "Appointments"]);
  assert.deepEqual(full.more.map((item) => item.label), ["Profile"]);
  assert.deepEqual(full.more.filter((item) => item.section === "ACCOUNT").map((item) => item.label), ["Profile"]);
  assert.ok(full.primary.length + full.more.length <= 5, "primary navigation plus Profile must fit five mobile slots");
});

test("Staff navigation refreshes live employee module entitlement after login", () => {
  assert.match(moduleRouteSource, /requireEmployeeSelfServiceAuthContext/);
  assert.match(moduleRouteSource, /loadBusinessModuleContext\(auth\.businessId\)/);
  assert.match(moduleRouteSource, /enabledModules: \[\.\.\.context\.enabledModules\]/);
});

test("Staff Home composes existing canonical readers without recalculating modules", () => {
  assert.match(homeSource, /getEmployeeAuthProfile/);
  assert.match(homeSource, /getEmployeePublishedRoster/);
  assert.match(homeSource, /buildStaffScheduleDay/);
  assert.match(homeSource, /businessId: auth\.businessId/);
  assert.match(homeSource, /membershipId: auth\.membershipId/);
  assert.match(homeSource, /const branchId = auth\.attendanceBranchId \?\? auth\.primaryBranchId/);
  assert.match(homeSource, /resolveBranchHolidays/);
  assert.match(homeSource, /leaveRequest: \{ branchId, status: "APPROVED" \}/);
  assert.doesNotMatch(homeSource, /getEmployeeTimesheetOverview|getEmployeeLeaveOverview|getEmployeeClaimOverview|getEmployeeCommissionStatements|loadPublishedPayslipsForEmployee/);
  assert.match(homeSource, /Schedule temporarily unavailable/);
  assert.match(homeSource, /showWelcome: true/);
  assert.match(homeSource, /getStaffAppointmentDay/);
});

test("Staff Home prioritizes a mobile today workspace without inventing new domains", () => {
  assert.match(homeComponentSource, /<p className="staff-kicker">TODAY<\/p>/);
  assert.match(homeComponentSource, /NEXT APPOINTMENT/);
  assert.match(homeComponentSource, /overview\.appointmentDay\?\.nextAppointment \? \(/);
  assert.doesNotMatch(homeComponentSource, /No appointments today|Today’s appointments are complete|Staff mapping needed/);
  assert.match(homeComponentSource, /UPCOMING SCHEDULE/);
  assert.match(homeComponentSource, /QUICK ACCESS/);
  assert.doesNotMatch(homeComponentSource, /MY WORKSPACE/);
  assert.match(homeComponentSource, /StaffAppIcon/);
  assert.match(homeComponentSource, /profile\.employee\.avatarUrl/);
  assert.match(homeComponentSource, /sizes="80px"/);
  assert.match(homeComponentSource, /<h1>\{displayName\}<\/h1>/);
  assert.doesNotMatch(homeComponentSource, /<h1>Hello,/);
  assert.match(employeeSessionSource, /avatarUrl:\s*true/);
  assert.doesNotMatch(homeComponentSource, /<strong>\{card\.value\}<\/strong>/);
  assert.doesNotMatch(homeComponentSource, /staff-home-card-arrow/);
  const quickAccessOrder = ["Schedule", "Leave", "Timesheets", "Claims", "Commission", "Payslips"]
    .map((label) => homeSource.indexOf(`label: "${label}"`));
  assert.ok(quickAccessOrder.every((index) => index >= 0));
  assert.deepEqual(quickAccessOrder, [...quickAccessOrder].sort((left, right) => left - right));
  assert.match(homeSource, /domain: "ROSTER", label: "Schedule", href: "\/staff\/roster"/);
  assert.match(homeSource, /domain: "LEAVE", label: "Leave", href: "\/staff\/leave"/);
  assert.match(todaySource, /staff-page-card staff-attendance-card/);
  assert.match(todaySource, /Today’s shift/);
  assert.doesNotMatch(todaySource, /Today&apos;s published evidence|Revision \{today\.expectedAttendance\.revision\}|Source:/);
  assert.ok(
    todaySource.indexOf("staff-action-grid") < todaySource.indexOf("aria-label=\"Today's attendance summary\""),
    "Attendance actions should appear before secondary metrics",
  );
  assert.match(attentionSource, /NEEDS YOUR ATTENTION/);
  assert.match(attentionSource, /if \(!actionableCases\.length\) return null/);
  assert.doesNotMatch(attentionSource, /You&apos;re all set|No items need your attention/);
  assert.match(attentionSource, /item\.status === "OPEN" \|\| item\.status === "RETURNED_FOR_CORRECTION" \|\| item\.canCancel/);
  assert.doesNotMatch(attentionSource, /Unauthorized absence|No-show/i);
  assert.match(staffCssSource, /@media \(max-width: 430px\)[\s\S]*?\.staff-home-grid\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(staffCssSource, /\.staff-home-up-next-card\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(staffCssSource, /\.staff-welcome-card h1\s*\{[\s\S]*?white-space:\s*nowrap/);
  assert.match(staffCssSource, /\.staff-welcome-card h1\s*\{[\s\S]*?line-height:\s*1\.15/);
  assert.match(staffCssSource, /\.staff-welcome-avatar\s*\{[\s\S]*?flex:\s*0 0 80px;[\s\S]*?height:\s*80px;[\s\S]*?width:\s*80px/);
});

test("Profile is a direct bottom navigation destination", () => {
  assert.match(chromeSource, /navigation\.more\.map\(\(item\) => \(/);
  assert.doesNotMatch(chromeSource, /moreOpen|MoreSection|staff-more-signout|StaffNavIcon name="more"/);
  assert.match(profileSource, /switching \? "Signing out…" : "Sign out"/);
  assert.doesNotMatch(staffCssSource, /\.staff-more-section|\.staff-more-signout/);
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
  assert.match(chromeSource, /const showBrandHeader = authRoutes\.has\(currentPath\) \|\| currentPath === "\/staff"/);
  assert.match(chromeSource, /\{showBrandHeader \? \(/);
  assert.match(historyComponentSource, /aria-expanded=\{filtersOpen\}/);
  assert.match(historyComponentSource, /setCorrectionOpen\(true\)/);
  assert.match(historyComponentSource, /aria-modal="true"/);
  assert.match(historyComponentSource, /className="staff-page-card staff-correction-sheet"/);
  assert.match(historyComponentSource, /className="staff-page-card staff-correction-sheet staff-filter-sheet"/);
  assert.match(historyComponentSource, /setDraftFrom\(from\)/);
  assert.match(historyComponentSource, /id="staff-history-filters"/);
  assert.match(historyComponentSource, /staff-filter-date-grid/);
  assert.match(historyComponentSource, /staff-filter-status-grid/);
  assert.match(historyComponentSource, /Choose up to 31 days\./);
  assert.match(historyComponentSource, /staff-correction-field-grid/);
  assert.match(historyComponentSource, /staff-correction-time-grid/);
  assert.match(historyComponentSource, /Finalized timesheet records stay locked\./);
  assert.doesNotMatch(historyComponentSource, />\s*Branch\s*</);
  assert.doesNotMatch(historyComponentSource, /Select branch|All branches/);
  assert.doesNotMatch(historyComponentSource, /branchId: correctionBranchId/);
  assert.match(attendanceExceptionRouteSource, /auth\.attendanceBranchId \?\? auth\.primaryBranchId/);
  assert.match(historyComponentSource, /history\.pagination\.totalPages > 1 \? \(\s*<div className="staff-pagination">/);
  assert.doesNotMatch(staffCssSource, /\.staff-pagination\.single-page/);
  assert.doesNotMatch(historyComponentSource, />\s*Reason\s*</);
  assert.match(historyComponentSource, /Employee requested a missing clock-out correction\./);
  assert.match(staffCssSource, /@media \(max-width: 640px\)[\s\S]*?\.staff-correction-backdrop\s*\{[\s\S]*?align-items:\s*flex-end/);
  assert.match(staffCssSource, /\.staff-correction-sheet\s*\{[\s\S]*?max-height:\s*calc\(100dvh - 32px\);[\s\S]*?overflow-y:\s*auto/);
  assert.match(staffCssSource, /\.staff-filter-field-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(staffCssSource, /\.staff-correction-field-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(staffCssSource, /\.staff-correction-action-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(staffCssSource, /\.staff-filter-field-grid > label\s*\{[\s\S]*?\.staff-filter-status-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(staffCssSource, /@media \(max-width: 430px\)[\s\S]*?\.staff-correction-time-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(staffCssSource, /@media \(max-width: 350px\)[\s\S]*?\.staff-filter-field-grid,\s*[\s\S]*?\.staff-correction-field-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(staffCssSource, /\.staff-history-stack > \.staff-section-hero > \.staff-secondary-button\s*\{[\s\S]*?grid-area:\s*action;[\s\S]*?min-height:\s*38px/);
  assert.match(leaveComponentSource, /href="\/staff\/leave\/new"/);
  assert.match(leaveComponentSource, /<span aria-hidden="true">\+<\/span>[\s\S]*?New request/);
  assert.match(leaveComponentSource, /view === "new-request"/);
  assert.match(leaveComponentSource, /href="\/staff\/leave" aria-label="Back to Leave"/);
  assert.doesNotMatch(leaveComponentSource, /href="#staff-leave-apply"|id="staff-leave-apply"/);
  assert.match(newLeavePageSource, /requireEmployeeModulePage\("HR"\)/);
  assert.match(newLeavePageSource, /<StaffLeave view="new-request" \/>/);
  assert.match(leaveCssSource, /\.heroAction\{[^}]*min-height:42px[^}]*padding:0 13px/);
  assert.match(leaveCssSource, /\.heroAction>span\{[^}]*height:20px[^}]*width:20px/);
  assert.doesNotMatch(leaveCssSource, /\.hero\{align-items:stretch\}|\.heroAction\{min-width:112px\}/);
  assert.match(leaveCssSource, /\.requestPage \.dateRange\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(leaveCssSource, /\.requestPage \.form select,[\s\S]*?min-height:\s*50px/);
  assert.match(leaveCssSource, /\.requestPage\s*\{[^}]*padding-bottom:\s*12px/);
  assert.doesNotMatch(leaveCssSource, /\.requestPage\s*\{[^}]*padding-bottom:\s*96px/);
  assert.match(leaveCssSource, /@media \(max-width: 369px\)[\s\S]*?\.requestPage \.dateRange\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(leaveComponentSource, /<StaffDatePicker label="From" name="startsOn"/);
  assert.match(leaveComponentSource, /<StaffDatePicker label="To" min=\{startsOn \|\| undefined\}/);
  assert.match(leaveComponentSource, /clientRequestId:\s*createBrowserUuid\(\)/);
  assert.doesNotMatch(leaveComponentSource, /crypto\.randomUUID\(\)/);
  assert.match(leaveComponentSource, /className=\{styles\.historyRequestCard\}/);
  assert.match(leaveComponentSource, /requestStatusLabel\(request\.status\)/);
  assert.match(leaveComponentSource, /formatRequestedDays\(request\.requestedDays\)/);
  assert.match(leaveComponentSource, /request\.supportingDocuments\.length > 0[\s\S]*?request\.status === "PENDING"/);
  assert.doesNotMatch(leaveComponentSource, /day\(s\)|request\.leaveUnit\.replaceAll/);
  assert.match(leaveComponentSource, /className=\{`\$\{styles\.card\} \$\{styles\.historySection\}`\}/);
  assert.match(leaveCssSource, /\.card\.historySection\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;[\s\S]*?padding:\s*0/);
  assert.match(leaveCssSource, /\.requests \.historyRequestCard\s*\{[\s\S]*?border-radius:\s*18px;[\s\S]*?padding:\s*14px/);
  assert.match(leaveCssSource, /\.requestHeader\s*\{[\s\S]*?justify-content:\s*space-between/);
  assert.match(leaveCssSource, /@media \(max-width: 350px\)[\s\S]*?\.requestFacts\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(staffDatePickerSource, /createPortal\([\s\S]*?role="dialog" aria-modal="true"/);
  assert.match(staffDatePickerSource, /WEEKDAYS[\s\S]*?calendarDays\(visibleMonth\)/);
  assert.match(staffDatePickerSource, /aria-haspopup="dialog"/);
  assert.match(staffDatePickerCssSource, /\.sheet\s*\{[\s\S]*?border-radius:\s*28px 28px 0 0[\s\S]*?env\(safe-area-inset-bottom\)/);
  assert.match(staffDatePickerCssSource, /\.grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(staffDatePickerCssSource, /\.trigger svg,[\s\S]*?stroke:\s*#111/);
  assert.doesNotMatch(leaveCssSource, /\.form button\{/);
  assert.match(leaveCssSource, /\.form>button\{/);
  assert.match(leaveComponentSource, /setCameraDocumentNames\(Array\.from\(event\.currentTarget\.files/);
  assert.match(leaveComponentSource, /setUploadedDocumentNames\(Array\.from\(event\.currentTarget\.files/);
  assert.match(leaveComponentSource, /className=\{styles\.selectedFiles\} role="status" aria-live="polite"/);
  assert.match(leaveCssSource, /\.fileButton input,\.fileButtonSecondary input\{[^}]*inset:0[^}]*inline-size:100%!important[^}]*block-size:100%/);
  assert.doesNotMatch(leaveCssSource, /\.fileButton input,[^}]*clip:rect|\.fileButtonSecondary input[^}]*inline-size:1px/);
  assert.doesNotMatch(leaveCssSource, /grid-auto-flow:column|overflow-x:auto|scroll-snap-type/);
  assert.match(leaveCssSource, /@media\(max-width:600px\)[\s\S]*?\.balances\{display:grid;grid-template-columns:1fr/);
  assert.match(timesheetPageSource, /staff-timesheet-summary/);
  assert.match(timesheetPageSource, /Monthly work record/);
  assert.match(timesheetPageSource, /Review your confirmed work results before payroll/);
  assert.match(timesheetPageSource, /staff-timesheet-attention/);
  assert.match(timesheetPageSource, /staff-timesheet-list/);
  assert.doesNotMatch(timesheetPageSource, /Version \{row\.version\}/);
  assert.match(rosterPageSource, /<h1 id="staff-roster-heading">Schedule<\/h1>/);
  assert.doesNotMatch(rosterPageSource, /Work week/);
  assert.match(rosterPageSource, /<small>Today<\/small>/);
  assert.match(rosterPageSource, /<small>This week<\/small>/);
  assert.match(rosterPageSource, /aria-label="Previous week"/);
  assert.match(rosterPageSource, /aria-current=\{isToday \? "date" : undefined\}/);
  assert.match(rosterPageSource, /<details className=/);
  assert.match(rosterPageSource, /No schedule yet/);
  assert.match(rosterPageSource, /status: "APPROVED"/);
  assert.match(rosterPageSource, /Promise\.all\(input\.branchIds\.map/);
  assert.doesNotMatch(rosterPageSource, /Absent|No-show/);
  assert.match(rosterLoadingSource, /Loading schedule/);
  assert.match(rosterErrorSource, /Unable to load schedule/);
  assert.match(rosterErrorSource, /Try again/);
  assert.match(commissionPageSource, /staff-commission-empty/);
  assert.match(claimsComponentSource, /<span>Claim title<\/span>/);
  assert.match(claimsComponentSource, /<span>Expense details<\/span>/);
  assert.match(claimsComponentSource, /className=\{styles\.moneyField\}/);
  assert.match(claimsComponentSource, /className=\{styles\.receiptField\}/);
  assert.match(claimsComponentSource, /disabled=\{submitting\}/);
  assert.match(claimsComponentSource, /clientRequestId:\s*createBrowserUuid\(\)/);
  assert.doesNotMatch(claimsComponentSource, /crypto\.randomUUID\(\)/);
  assert.match(claimsCssSource, /\.formRow\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(claimsCssSource, /@media \(min-width: 700px\)[\s\S]*?\.formRow\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(staffCssSource, /font-size: 16px/);
  assert.match(
    staffCssSource,
    /@media \(max-width: 430px\)[\s\S]*?\.staff-app-shell\s*\{[\s\S]*?display:\s*flex;[\s\S]*?inset:\s*0;[\s\S]*?overflow:\s*hidden;[\s\S]*?position:\s*fixed/,
  );
  assert.match(staffCssSource, /\.staff-app-shell > \.staff-pwa-main\s*\{[^}]*flex:\s*1 1 auto;[^}]*overflow-y:\s*auto;[^}]*padding-bottom:\s*calc\(72px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(staffCssSource, /\.staff-app-shell > \.staff-pwa-main\s*\{[^}]*scrollbar-width:\s*none/);
  assert.match(staffCssSource, /\.staff-app-shell > \.staff-pwa-main::\-webkit-scrollbar\s*\{[^}]*display:\s*none/);
  assert.match(staffCssSource, /@media \(max-width: 430px\)[\s\S]*?\.staff-pwa-nav\s*\{[^}]*bottom:\s*0;[^}]*left:\s*0;[^}]*position:\s*fixed;[^}]*width:\s*100%/);
  assert.doesNotMatch(staffCssSource, /\.staff-pwa-nav::after/);
  assert.match(staffCssSource, /\.staff-pwa-nav\s*\{[^}]*background:\s*#fff/);
  assert.match(staffCssSource, /\.staff-pwa-nav\s*\{[^}]*display:\s*grid;[^}]*grid-auto-columns:\s*minmax\(0, 1fr\);[^}]*grid-auto-flow:\s*column/);
  assert.doesNotMatch(staffCssSource, /\.staff-pwa-nav\s*\{[^}]*backdrop-filter:/);
  assert.match(staffCssSource, /\.staff-current-workplace\s*\{[^}]*background:\s*#fff/);
  assert.match(staffCssSource, /@media \(max-width: 430px\)[\s\S]*?\.staff-pwa-nav a,[\s\S]*?\.staff-pwa-nav > button\s*\{[^}]*font-size:\s*clamp\(8\.5px, 2\.35vw, 10px\);[^}]*min-height:\s*54px;[^}]*text-align:\s*center/);
  assert.match(staffCssSource, /\.staff-roster-day summary\s*\{[\s\S]*?grid-template-columns:\s*50px minmax\(0, 1fr\) 22px;[\s\S]*?min-height:\s*62px/);
  assert.match(staffCssSource, /\.staff-roster-page\s*\{[\s\S]*?overflow-x:\s*clip/);
  assert.match(staffCssSource, /@media \(max-width: 430px\)[\s\S]*?\.staff-roster-day summary/);
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

test("Staff Profile shows employee identifiers once inside the mobile details card", () => {
  assert.match(profileSource, /className="staff-profile-identity"/);
  assert.doesNotMatch(profileSource, /className="staff-profile-meta"/);
  assert.match(profileSource, /staff-device-details staff-employment-details/);
  assert.match(staffCssSource, /\.staff-profile-identity\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(staffCssSource, /\.staff-device-details strong,[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(staffCssSource, /@media \(max-width: 430px\)[\s\S]*?\.staff-profile-stack \.staff-device-details/);
  assert.doesNotMatch(profileSource, /WORKPLACES|staff-profile-workplaces|openWorkplaceSwitcher|employers/);
  assert.doesNotMatch(staffCssSource, /\.staff-profile-workplaces/);
});

test("Staff Profile lets an authenticated employee replace their own photo", () => {
  assert.match(staffTypesSource, /fullName:\s*string;[\s\S]*?avatarUrl:\s*string \| null;/);
  assert.match(profileSource, /<StaffAvatarUpload/);
  assert.match(profileSource, /employee:\s*\{ \.\.\.current\.employee, avatarUrl \}/);
  assert.match(staffAvatarSource, /accept="image\/\*"/);
  assert.match(staffAvatarSource, /prepareAvatar\(source\)/);
  assert.match(staffAvatarSource, /staffApiFetch<\{ ok: true; avatarUrl: string \}>/);
  assert.match(staffAvatarSource, /"\/api\/employee-auth\/avatar"/);
  assert.match(staffAvatarSource, /aria-modal="true"/);
  assert.match(staffAvatarRouteSource, /assertEmployeeAuthSameOrigin\(request\)/);
  assert.match(staffAvatarRouteSource, /requireEmployeeSelfServiceAuthContext\(request\)/);
  assert.match(staffAvatarRouteSource, /employeeAccountId:\s*auth\.employeeAccountId/);
  assert.match(staffAvatarRouteSource, /limitInputPixels:\s*40_000_000/);
  assert.match(staffAvatarRouteSource, /EMPLOYEE_SELF_AVATAR_UPDATED/);
  assert.match(staffAvatarRouteSource, /uploadedAvatarUrl && !avatarPersisted/);
  assert.match(staffAvatarRouteSource, /deleteRuntimeEmployeeAvatarByUrl\(membership\.avatarUrl\)/);
  assert.match(staffCssSource, /\.staff-profile-avatar-button\s*\{[\s\S]*?height:\s*76px;[\s\S]*?width:\s*76px/);
  assert.match(staffCssSource, /\.staff-avatar-sheet\s*\{[\s\S]*?env\(safe-area-inset-bottom\)/);
});

test("Local mobile Staff App can hydrate from the private Wi-Fi subnet", () => {
  assert.match(nextConfigSource, /allowedDevOrigins:\s*\["192\.168\.1\.\*"\]/);
});
