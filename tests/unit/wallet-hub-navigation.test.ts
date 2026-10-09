import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { walletHubHarness, businessId } from "../helpers/wallet-hub-ui-harness";
let h: Awaited<ReturnType<typeof walletHubHarness>>;
before(async () => { h = await walletHubHarness(); }); after(() => h?.close());
async function nav(role = "BUSINESS_OWNER", modules = ["POS", "SALON", "WALLET", "EXPENSE"], denied = false) {
  Object.assign(h.state, { role, modules, denied });
  return (await h.api.AppShell({ user: { role, userId: "44444444-4444-4444-8444-444444444444", businessId, permissions: [] }, access: { granted: true, businessId, source: "DIRECT_BUSINESS", effectiveBusinessRole: role }, children: null })).props.navItems;
}
test("verified Owner sees Wallet immediately after Cashier without reordering existing navigation", async () => {
  const entries = await nav(); const index = entries.findIndex(x => x.href === "/cashier");
  assert.equal(entries[index + 1].href, "/wallet"); assert.equal(entries[index + 1].label, "Wallet");
  assert.deepEqual(entries.filter(x => x.href !== "/wallet").map(x => x.label), ["Dashboard", "Cashier", "Packages", "Services", "Products", "Appointments", "CRM", "Expenses", "Shift Closing", "People", "Reports", "Catalog", "Company settings", "Security"]);
});
test("Staff, ALL_BRANCHES Staff, Group Manager, Platform Admin and disabled Wallet never see Hub", async () => {
  for (const role of ["STAFF", "GROUP_MANAGER_READ_ONLY", "PLATFORM_ADMIN"]) assert.ok(!(await nav(role)).some(x => x.href === "/wallet"));
  assert.ok(!(await nav("BUSINESS_OWNER", ["POS", "SALON"])).some(x => x.href === "/wallet"));
  assert.ok(!(await nav("BUSINESS_OWNER", ["WALLET"])).some(x => x.href === "/wallet"));
  assert.ok(!(await nav("BUSINESS_OWNER", undefined, true)).some(x => x.href === "/wallet"));
});
