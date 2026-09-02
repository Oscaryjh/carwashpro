import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasStaffPermission, normalizeStaffPermissions } from "../../src/lib/auth/staff-permissions";
import {
  closingMoneySchema,
  DailyClosingDifferenceReasonError,
  requireDailyClosingDifferenceReason,
} from "../../src/lib/closing/money-validation";

test("Daily Closing authority is separate and safely defaulted", () => {
  assert.equal(hasStaffPermission({ role: "BUSINESS_OWNER", permissions: [] }, "CONFIRM_DAILY_CLOSING"), true);
  assert.equal(hasStaffPermission({ role: "STAFF", permissions: ["CLOSING"] }, "CONFIRM_DAILY_CLOSING"), false);
  assert.deepEqual(
    normalizeStaffPermissions(["CONFIRM_DAILY_CLOSING"]),
    ["CLOSING", "CONFIRM_DAILY_CLOSING"],
  );
});

test("Closing money accepts canonical values and rejects unsafe input", () => {
  for (const value of ["0", "0.01", "100", "21474836.47"]) {
    assert.equal(closingMoneySchema.safeParse(value).success, true, value);
  }
  for (const value of ["", "-0.01", "1.999", "NaN", "21474836.48", Number.POSITIVE_INFINITY]) {
    assert.equal(closingMoneySchema.safeParse(value).success, false, String(value));
  }
});

test("manual Daily Closing requires a trimmed reason for every non-zero difference", () => {
  assert.equal(requireDailyClosingDifferenceReason({ actualCashCents: 500_000, expectedCashCents: 500_000, reason: "   " }), null);
  assert.equal(requireDailyClosingDifferenceReason({ actualCashCents: 500_100, expectedCashCents: 500_000, reason: "  Till over  " }), "Till over");
  assert.throws(() => requireDailyClosingDifferenceReason({ actualCashCents: 500_100, expectedCashCents: 500_000, reason: " " }), DailyClosingDifferenceReasonError);
  assert.throws(() => requireDailyClosingDifferenceReason({ actualCashCents: 499_900, expectedCashCents: 500_000 }), DailyClosingDifferenceReasonError);
});

test("server actions enforce P1 control boundaries", () => {
  const source = readFileSync("src/app/(business)/closing/actions.ts", "utf8");
  const start = source.slice(source.indexOf("export async function startShiftAction"), source.indexOf("function normalizeCashierReturnTo"));
  const manual = source.slice(source.indexOf("export async function closeDailySnapshotAction"), source.indexOf("export async function resolveStaleShiftAction"));
  const stale = source.slice(source.indexOf("export async function resolveStaleShiftAction"), source.indexOf("export async function manualClosingWhatsAppSendAction"));
  assert.match(start, /acquireCashierOpenShiftLock/);
  assert.match(start, /cashierId: user\.userId/);
  assert.match(manual, /CONFIRM_DAILY_CLOSING/);
  assert.match(manual, /requireDailyClosingDifferenceReason/);
  assert.ok(manual.indexOf("requireDailyClosingDifferenceReason") < manual.indexOf("createDailyClosingSnapshotInTransaction"));
  assert.match(stale, /CONFIRM_DAILY_CLOSING/);
  assert.match(stale, /STALE_SHIFT_RESOLVED/);
  assert.match(stale, /assertShiftActivityWithinBusinessDate/);
});

test("Closing UI separates manager controls, frozen data, and late activity", () => {
  const page = readFileSync("src/app/(business)/closing/page.tsx", "utf8");
  const panel = readFileSync("src/components/daily-closing-snapshot-panel.tsx", "utf8");
  assert.match(page, /canConfirmDailyClosing && dailyClosing/);
  assert.match(page, /Branch View/);
  assert.match(page, /Closes at/);
  assert.doesNotMatch(page, /00:00 to next/);
  assert.match(panel, /FROZEN DAILY CLOSING/);
  assert.match(panel, /Activity recorded after Daily Closing/);
  assert.match(panel, /Expected Net Cash Movement/);
  assert.match(panel, /Daily cash movement excludes opening floats/);
  assert.match(panel, /event\.key === "Escape"/);
  assert.match(panel, /focusable/);
});
