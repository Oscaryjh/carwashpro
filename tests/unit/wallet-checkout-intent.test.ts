import assert from "node:assert/strict";
import test from "node:test";
test("pending checkout restores the original key and all repeated request fields, never current UI defaults", async () => {
  const module = await import("../../src/lib/wallet/checkout-intent").catch(() => null);
  assert.ok(module?.createWalletCheckoutIntent, "Wallet checkout needs frozen request recovery");
  const form = new FormData();
  for (const [key, value] of [["operationId", "checkout:original-key"], ["customerId", "customer"], ["walletAmount", "20"], ["method", "CARD"], ["reference", "card-123"], ["productId", "first"], ["productId", "second"], ["performanceAttribution", '{"version":1}']]) form.append(key, value);
  const intent = module.createWalletCheckoutIntent(form, "business:actor:branch", [{ label: "Customer", value: "Original customer" }, { label: "External method", value: "Card" }]);
  const restored = module.parseWalletCheckoutIntent(JSON.stringify(intent), "business:actor:branch");
  assert.ok(restored);
  assert.deepEqual([...module.toWalletCheckoutFormData(restored).entries()], [...form.entries()]);
  assert.equal(restored.summary[1].value, "Card");
  assert.equal(module.parseWalletCheckoutIntent(JSON.stringify(intent), "foreign:actor:branch"), null);
  assert.equal(module.parseWalletCheckoutIntent("broken", "business:actor:branch"), null);
});

test("recovery discovers original branch after shift closure without reading another actor or tenant", async () => {
  const module = await import("../../src/lib/wallet/checkout-intent");
  assert.ok("readWalletCheckoutRecovery" in module, "Recovery must use stable business/actor identity, not current branch");
  const form = new FormData(); form.set("operationId", "checkout:original-branch"); form.set("branchId", "branch-B"); form.set("walletAmount", "20");
  const intent = module.createWalletCheckoutIntent(form, "business:actor:branch-B", [{ label: "Branch", value: "branch-B" }]);
  const rows = new Map<string, string>([["wallet-checkout:foreign:actor:branch-B", "foreign secret"], ["wallet-checkout:business:other:branch-B", "other secret"],
    ["wallet-checkout:business:actor:branch-B", JSON.stringify(intent)]]);
  const storage = { get length() { return rows.size; }, key: (i: number) => [...rows.keys()][i] ?? null, getItem: (key: string) => rows.get(key) ?? null };
  const read = (module as typeof module & {readWalletCheckoutRecovery: (s: typeof storage, scope: string) => {key: string; intent: typeof intent | null; blocked: boolean} | null}).readWalletCheckoutRecovery;
  assert.deepEqual(read(storage, "business:actor"), {key: "wallet-checkout:business:actor:branch-B", intent, blocked: false});
  assert.equal(read(storage, "unrelated:actor"), null);
  rows.set("wallet-checkout:business:actor:branch-B", "corrupt");
  assert.equal(read(storage, "business:actor")?.blocked, true);
  rows.set("wallet-checkout:business:actor:branch-A", JSON.stringify(intent));
  assert.equal(read(storage, "business:actor")?.blocked, true);
});
