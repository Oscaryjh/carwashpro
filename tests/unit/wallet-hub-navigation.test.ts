import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { walletHubHarness, businessId } from "../helpers/wallet-hub-ui-harness";
let h: Awaited<ReturnType<typeof walletHubHarness>>;
before(async () => { h = await walletHubHarness(); }); after(() => h?.close());
async function nav(role = "BUSINESS_OWNER", modules = ["POS", "SALON", "WALLET", "EXPENSE"], denied = false) {
  Object.assign(h.state, { role, modules, denied });
  return (await h.api.AppShell({ user: { role, userId: "44444444-4444-4444-8444-444444444444", businessId, permissions: [] }, access: { granted: true, businessId, source: "DIRECT_BUSINESS", effectiveBusinessRole: role }, children: null })).props.navItems;
}
test("verified Owner sees Wallet within Customers and the approved top-level order", async () => {
  const entries = await nav();
  assert.deepEqual(entries.find(x => x.label === "Customers")?.children?.map(x => x.href), ["/crm", "/wallet"]);
  assert.deepEqual(entries.map(x => x.label), ["Dashboard", "Cashier", "Appointments", "Customers", "Catalog", "People", "Expenses", "Shift Closing", "Reports", "Company settings", "Security"]);
});
test("Staff, ALL_BRANCHES Staff, Group Manager, Platform Admin and disabled Wallet never see Hub", async () => {
  const flat = (items: Awaited<ReturnType<typeof nav>>) => items.flatMap(x => x.children ?? [x]);
  for (const role of ["STAFF", "GROUP_MANAGER_READ_ONLY", "PLATFORM_ADMIN"]) assert.ok(!flat(await nav(role)).some(x => x.href === "/wallet"));
  assert.ok(!flat(await nav("BUSINESS_OWNER", ["POS", "SALON"])).some(x => x.href === "/wallet"));
  assert.ok(!flat(await nav("BUSINESS_OWNER", ["WALLET"])).some(x => x.href === "/wallet"));
  assert.ok(!flat(await nav("BUSINESS_OWNER", undefined, true)).some(x => x.href === "/wallet"));
});
