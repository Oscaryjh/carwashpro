import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { comparePeriods, resolvePerformancePeriods } from "../../src/lib/business-performance/read-model";

test("business performance periods respect business timezone, cutoff and comparable windows", () => {
  const today = resolvePerformancePeriods({ range: "today", now: new Date("2026-08-11T17:30:00Z"), timezone: "Asia/Kuching", businessDayCutoffTime: "02:00" });
  assert.equal(today.current.fromDateValue, "2026-08-11");
  assert.equal(today.current.toDateValue, "2026-08-11");
  assert.equal(today.previous.fromDateValue, "2026-08-10");
  const lastWeek = resolvePerformancePeriods({ range: "last_week", now: new Date("2026-08-12T04:00:00Z"), timezone: "Asia/Kuching", businessDayCutoffTime: "02:00" });
  assert.equal(lastWeek.current.fromDateValue, "2026-08-03");
  assert.equal(lastWeek.current.toDateValue, "2026-08-09");
});

test("period comparison handles a zero denominator without Infinity", () => {
  assert.deepEqual(comparePeriods(0, 0), { kind: "NO_CHANGE" });
  assert.deepEqual(comparePeriods(100, 0), { kind: "NEW" });
  assert.deepEqual(comparePeriods(110, 100), { kind: "PERCENT", percentage: 10 });
});

test("dashboard contract keeps canonical and accounting boundaries visible", async () => {
  const page = await readFile("src/app/(business)/dashboard/page.tsx", "utf8");
  const model = await readFile("src/lib/business-performance/read-model.ts", "utf8");
  for (const wording of ["Recorded Business Spending", "Simple Operating Balance", "does not represent accounting profit", "Outstanding AP is settlement information", "Missing module data is not zero"]) assert.match(page, new RegExp(wording));
  assert.doesNotMatch(page, /label="Net Profit"|label="Gross Profit"|label="Operating Profit"/);
  assert.match(model, /getExpenseDashboard/);
  assert.match(model, /getAccountsPayableOverview/);
  assert.match(model, /reconcileInventory/);
  assert.match(model, /calculateFinancialMetrics/);
});

test("Salon and Auto converge on the same core performance route", async () => {
  const salon = await readFile("src/app/(business)/salon/dashboard/page.tsx", "utf8");
  assert.match(salon, /redirect\("\/dashboard"\)/);
});
