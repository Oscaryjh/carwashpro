import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aggregateBalanceLedger,
  formatLocalDate,
  safeCsvCell,
  sumApprovedUsageUnits,
  toCsv,
} from "../../src/lib/leave/reporting-service";

test("Phase 2F derives current balance only from canonical ledger events", () => {
  const balance = aggregateBalanceLedger([
    { eventType: "ENTITLEMENT", units: 14 },
    { eventType: "CARRY_FORWARD", units: 2 },
    { eventType: "MANUAL_ADJUSTMENT", units: 1 },
    { eventType: "APPROVED_CONSUMPTION", units: -3.5 },
    { eventType: "CANCELLATION_RESTORE", units: 0.5 },
    { eventType: "EXPIRY", units: -1 },
  ]);

  assert.deepEqual(balance, {
    entitlement: 14,
    carryForward: 2,
    manualAdjustment: 1,
    used: 3,
    expired: 1,
    lapsed: 0,
    remaining: 13,
  });
});

test("Pending units stay separate from the canonical balance", () => {
  const balance = aggregateBalanceLedger([{ eventType: "ENTITLEMENT", units: 5 }]);
  const pending = 1.5;
  assert.equal(balance.remaining, 5);
  assert.equal(balance.remaining - pending, 3.5);
});

test("Approved usage counts leave units including half days, not request rows", () => {
  assert.equal(sumApprovedUsageUnits([
    { dayFraction: 1 },
    { dayFraction: "0.5" },
    { dayFraction: 0.5 },
  ]), 2);
});

test("CSV export neutralises spreadsheet formulas and quotes all fields", () => {
  assert.equal(safeCsvCell("=2+2"), "\"'=2+2\"");
  assert.equal(safeCsvCell("  @SUM(A1:A2)"), "\"'  @SUM(A1:A2)\"");
  assert.equal(safeCsvCell('Hello, "Tetamu"'), '"Hello, ""Tetamu"""');
  const csv = toCsv(["Employee", "Value"], [["Oscar", "+CMD"]]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /\"'\+CMD\"/);
});

test("Malaysia-facing dates render day/month/year without timezone drift", () => {
  assert.equal(formatLocalDate(new Date("2026-08-01T00:00:00.000Z")), "01/08/2026");
  assert.equal(formatLocalDate(new Date("2026-12-31T23:59:59.999Z")), "31/12/2026");
});

test("Phase 2F routes retain scoped permissions, restricted adjustments and export audit", async () => {
  const page = await readFile("src/app/(business)/team/leave/reports/page.tsx", "utf8");
  const route = await readFile("src/app/(business)/team/leave/reports/export/route.ts", "utf8");
  const service = await readFile("src/lib/leave/reporting-service.ts", "utf8");

  assert.match(page, /requireBusinessUser\("VIEW_LEAVE"\)/);
  assert.match(page, /ADJUST_LEAVE_BALANCE/);
  assert.match(page, /Overview/);
  assert.match(page, /Balances/);
  assert.match(page, /Carry forward/);
  assert.match(page, /last_year/);
  assert.match(page, /Expiring within/);
  assert.match(page, /Supporting documents/);
  assert.match(page, /Approved leave trend/);
  assert.match(route, /LEAVE_REPORT_EXPORTED/);
  assert.match(route, /ADJUST_LEAVE_BALANCE/);
  assert.match(route, /toCsv/);
  assert.match(service, /allowedBranchIds/);
  assert.match(service, /status: "APPROVED"/);
  assert.match(service, /supportingEvidencePresentSnapshot/);
  assert.match(service, /expiryDays/);
  assert.match(service, /remaining_desc/);
  assert.match(service, /leaveDate\.getUTCMonth/);
  assert.doesNotMatch(page + route, /supportingEvidenceReference|objectKey|privateReason/);
});
