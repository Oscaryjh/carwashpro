import assert from "node:assert/strict";
import test from "node:test";
import { isWalletAccessAllowed, assertWalletAccessAllowed, WalletUnavailableError } from "../../src/lib/wallet/release-policy";

const businessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = new Date("2026-10-01T00:00:00Z");
function options(wallet: string | null, pos = "ENABLED", from = new Date(0), until: Date | null = null) {
  return { now, database: { businessModuleEntitlement: { findMany: async (query: { where: { businessId: string } }) => {
    assert.equal(query.where.businessId, businessId);
    return [ { moduleKey: "POS", status: pos, enabledFrom: new Date(0), enabledUntil: null },
      ...(wallet ? [{ moduleKey: "WALLET", status: wallet, enabledFrom: from, enabledUntil: until }] : []) ];
  } } } as never };
}
test("Wallet module is the sole current availability source, including transaction reader", async () => {
  assert.equal(await isWalletAccessAllowed({ businessId }, options("ENABLED")), true);
  await assertWalletAccessAllowed({ businessId }, options("ENABLED"));
});
test("missing, disabled, future, expired and missing POS Wallet access deny", async () => {
  for (const opt of [options(null), options("DISABLED"), options("ENABLED", "DISABLED"),
    options("ENABLED", "ENABLED", new Date("2026-10-02")), options("ENABLED", "ENABLED", new Date(0), now)]) {
    assert.equal(await isWalletAccessAllowed({ businessId }, opt), false);
    await assert.rejects(assertWalletAccessAllowed({ businessId }, opt), WalletUnavailableError);
  }
});
test("Wallet UUID validation fails closed without querying a database", async () => {
  const opt = { database: { businessModuleEntitlement: { findMany: async () => { throw new Error("must not query"); } } } as never };
  for (const id of ["", "not-a-uuid", "*"]) assert.equal(await isWalletAccessAllowed({ businessId: id }, opt), false);
});
test("Wallet does not convert database failures into authorization", async () => {
  const opt = { database: { businessModuleEntitlement: { findMany: async () => { throw new Error("database unavailable"); } } } as never };
  await assert.rejects(isWalletAccessAllowed({ businessId }, opt), /database unavailable/);
  await assert.rejects(assertWalletAccessAllowed({ businessId }, opt), /database unavailable/);
});
