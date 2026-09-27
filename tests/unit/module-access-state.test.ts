import assert from "node:assert/strict";
import test from "node:test";
import { moduleKeys } from "../../src/lib/modules/registry";
import { changedModules, coversModuleWindow, effectiveModuleKeys, moduleAccessCounts, proposeModuleEdit, shouldPreserveModuleDraft, type ModuleAccessRow } from "../../src/components/module-access-state";

const from = "2026-09-27T12:00:00.000Z";
const now = Date.parse("2026-09-27T13:00:00Z");
function fixture(): ModuleAccessRow[] {
  return moduleKeys.map((key) => ({ key, status: key === "CORE" ? "ENABLED" : "DISABLED", from, until: null, plan: "", revision: 1, source: "MANUAL" }));
}

test("unrelated server refresh preserves unsaved module edits; own save can reload the server result", () => {
  const baseline = fixture();
  const draft = baseline.map(row => row.key === "POS" ? { ...row, status: "ENABLED" as const } : row);
  assert.equal(shouldPreserveModuleDraft(baseline, draft, false), true);
  assert.equal(shouldPreserveModuleDraft(baseline, draft, true), false);
  assert.equal(shouldPreserveModuleDraft(baseline, baseline, false), false);
});
test("Core is counted as enabled but never included in pending writes", () => {
  const rows = fixture();
  assert.deepEqual(moduleAccessCounts(rows), { enabled: 1, disabled: 14, total: 15 });
  assert.deepEqual(changedModules(rows, rows), []);
  assert.match(proposeModuleEdit(rows, { ...rows[0], status: "DISABLED" }, now).error!, /required/);
});
test("enable Payroll proposes HR explicitly without mutating the existing draft", () => {
  const rows = fixture();
  const next = proposeModuleEdit(rows, { ...rows.find((row) => row.key === "PAYROLL")!, status: "ENABLED" }, now);
  assert.equal(next.error, null);
  assert.deepEqual(next.dependencies, ["HR"]);
  assert.equal(rows.find((row) => row.key === "HR")!.status, "DISABLED");
  assert.equal(changedModules(rows, next.rows).length, 2);
  assert.equal(next.rows.find((row) => row.key === "HR")!.until, null);
});
test("Statutory enable includes the full Payroll to HR dependency chain", () => {
  const rows = fixture();
  const next = proposeModuleEdit(rows, { ...rows.find((row) => row.key === "STATUTORY")!, status: "ENABLED" }, now);
  assert.equal(next.error, null);
  assert.deepEqual(next.dependencies, ["PAYROLL", "HR"]);
  assert.equal(changedModules(rows, next.rows).length, 3);
});
test("a previously disabled dependency uses the requested window, preserving plan and revision", () => {
  const rows = fixture();
  const hr = rows.find((row) => row.key === "HR")!;
  hr.from = "2025-01-01T00:00:00Z"; hr.until = "2025-02-01T00:00:00Z"; hr.plan = "HR trial"; hr.revision = 6;
  const payroll = { ...rows.find((row) => row.key === "PAYROLL")!, status: "ENABLED" as const, until: "2026-12-01T00:00:00Z" };
  const next = proposeModuleEdit(rows, payroll, now);
  const updated = next.rows.find((row) => row.key === "HR")!;
  assert.equal(updated.from, payroll.from); assert.equal(updated.until, payroll.until);
  assert.equal(updated.plan, "HR trial"); assert.equal(updated.revision, 6);
});
test("dependencies must cover the entire schedule and extensions require confirmation", () => {
  const rows = fixture();
  const hr = rows.find((row) => row.key === "HR")!;
  hr.status = "ENABLED"; hr.until = "2026-10-01T00:00:00Z";
  const payroll = { ...rows.find((row) => row.key === "PAYROLL")!, status: "ENABLED" as const };
  assert.equal(coversModuleWindow(hr, payroll), false);
  const next = proposeModuleEdit(rows, payroll, now);
  assert.deepEqual(next.dependencies, ["HR"]);
  assert.equal(next.rows.find((row) => row.key === "HR")!.until, null);
});
test("HR disable is blocked while Payroll or Claims is active or scheduled", () => {
  const rows = fixture();
  rows.find((row) => row.key === "HR")!.status = "ENABLED";
  const payroll = rows.find((row) => row.key === "PAYROLL")!;
  payroll.status = "ENABLED"; payroll.from = "2027-01-01T00:00:00Z";
  const next = proposeModuleEdit(rows, { ...rows.find((row) => row.key === "HR")!, status: "DISABLED" }, now);
  assert.match(next.error!, /Disable Payroll/);
  payroll.until = "2027-02-01T00:00:00Z";
  assert.equal(proposeModuleEdit(rows, { ...rows.find((row) => row.key === "HR")!, status: "DISABLED" }, Date.parse("2028-01-01")).error, null);
});
test("editing a parent schedule follows the existing service contract without adding a new hard restriction", () => {
  const rows = fixture();
  rows.find((row) => row.key === "HR")!.status = "ENABLED";
  rows.find((row) => row.key === "PAYROLL")!.status = "ENABLED";
  const next = proposeModuleEdit(rows, { ...rows.find((row) => row.key === "HR")!, until: "2026-10-01T00:00:00Z" }, now);
  assert.equal(next.error, null);
  assert.equal(changedModules(rows, next.rows).length, 1);
  assert.equal(next.rows.find((row) => row.key === "PAYROLL")!.until, null);
  assert.equal(effectiveModuleKeys(next.rows, Date.parse("2026-10-02T00:00:00Z")).has("PAYROLL"), false);
});
test("invalid dates fail before applying and disabled edits retain schedule", () => {
  const rows = fixture();
  assert.match(proposeModuleEdit(rows, { ...rows[1], from: "" }, now).error!, /dates must be valid/);
  assert.match(proposeModuleEdit(rows, { ...rows[1], until: from }, now).error!, /Expiry/);
  const next = proposeModuleEdit(rows, { ...rows[1], plan: "new plan" }, now);
  assert.equal(next.error, null);
  assert.equal(next.rows[1].from, rows[1].from);
});
test("effective access distinguishes configured, future, expired and inactive dependencies", () => {
  const rows = fixture();
  rows.find((row) => row.key === "PAYROLL")!.status = "ENABLED";
  const pos = rows.find((row) => row.key === "POS")!; pos.status = "ENABLED"; pos.from = "2027-01-01T00:00:00Z";
  const salon = rows.find((row) => row.key === "SALON")!; salon.status = "ENABLED"; salon.until = "2026-09-27T12:30:00Z";
  assert.equal(moduleAccessCounts(rows).enabled, 4);
  assert.deepEqual([...effectiveModuleKeys(rows, now)], ["CORE"]);
});
