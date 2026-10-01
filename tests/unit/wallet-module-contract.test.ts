import assert from "node:assert/strict";
import test from "node:test";
import type { BusinessModuleEntitlement } from "@prisma/client";
import { loadBusinessModuleContext } from "../../src/lib/modules/entitlements";
import { moduleDependencies, moduleDependents, defaultModulesForNewBusiness } from "../../src/lib/modules/registry";

const businessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = new Date("2026-10-01T00:00:00Z");
function record(moduleKey: string, status = "ENABLED", from = "2026-01-01", until: string | null = null) {
  return { id: `${moduleKey}-fixture`, businessId, moduleKey, status, enabledFrom: new Date(from), enabledUntil: until ? new Date(until) : null,
    source: "MANUAL", planCode: null, revision: 1, createdById: null, updatedById: null, createdAt: now, updatedAt: now } as BusinessModuleEntitlement;
}
async function enabled(rows: BusinessModuleEntitlement[]) {
  return (await loadBusinessModuleContext(businessId, { now, database: {
    businessModuleEntitlement: { findMany: async (input: { where: { businessId: string } }) => {
      assert.equal(input.where.businessId, businessId);
      return rows;
    } },
  } as never })).enabledModules.has("WALLET" as never);
}
test("Wallet becomes usable only when both Wallet and POS are effective", async () => {
  assert.equal(await enabled([record("POS"), record("WALLET")]), true);
  assert.equal(await enabled([record("WALLET")]), false);
  assert.equal(await enabled([record("POS")]), false);
  assert.equal(await enabled([record("POS", "DISABLED"), record("WALLET")]), false);
});
test("Wallet effective windows and POS dependency fail closed at the boundary", async () => {
  assert.equal(await enabled([record("POS"), record("WALLET", "DISABLED")]), false);
  assert.equal(await enabled([record("POS"), record("WALLET", "ENABLED", "2026-10-02")]), false);
  assert.equal(await enabled([record("POS"), record("WALLET", "ENABLED", "2026-01-01", "2026-10-01")]), false);
  assert.equal(await enabled([record("POS", "ENABLED", "2026-01-01", "2026-10-01"), record("WALLET")]), false);
});
test("declarative dependency exposes Wallet as a POS dependent without default enablement", () => {
  assert.deepEqual(moduleDependencies("WALLET" as never), ["POS"]);
  assert.ok(moduleDependents("POS").includes("WALLET" as never));
  for (const industry of ["SALON_BEAUTY", "AUTO_DETAILING"] as const) assert.equal(defaultModulesForNewBusiness(industry).includes("WALLET" as never), false);
});
