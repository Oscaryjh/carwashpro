import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";
const db = walletTestDatabase(); after(() => db.$disconnect());
test("simultaneous first submissions with one key create one invoice and one redemption", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db); await h.login(db, f);
    const results = await Promise.all([h.action.completeCashierSaleAction(f.form), h.action.completeCashierSaleAction(f.form)]);
    for (const result of results) assert.equal(result.status, "success", result.message);
    assert.equal(results[0].invoice!.id, results[1].invoice!.id);
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 1);
    assert.equal(await db.walletTransaction.count({ where: { businessId: f.business.id, type: "REDEMPTION" } }), 1);
    const account = await db.walletAccount.findFirstOrThrow({ where: { businessId: f.business.id } });
    assert.equal(account.paidBalance.toFixed(2), "40.00"); assert.equal(account.bonusBalance.toFixed(2), "0.00");
  } finally { await h.close(); }
});
test("two concurrent orders cannot overdraw, and one duplicated intent only settles once", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db); await h.login(db, f);
    await db.product.update({ where: { id: f.product.id }, data: { price: 60 } });
    f.form.set("walletAmount", "60");
    const other = new FormData(); for (const [k,v] of f.form) other.append(k,v); other.set("operationId", randomUUID());
    const result = await Promise.all([h.action.completeCashierSaleAction(f.form), h.action.completeCashierSaleAction(other)]);
    assert.equal(result.filter(row => row.status === "success").length, 1);
    assert.equal(result.filter(row => row.status === "error").length, 1);
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 1);
    const account = await db.walletAccount.findFirstOrThrow({ where: { businessId: f.business.id } });
    assert.equal(account.paidBalance.plus(account.bonusBalance).toFixed(2), "20.00");
    const winner = result[0].status === "success" ? f.form : other;
    const duplicate = await Promise.all([h.action.completeCashierSaleAction(winner), h.action.completeCashierSaleAction(winner)]);
    assert.equal(duplicate[0].invoice?.id, duplicate[1].invoice?.id);
    assert.equal(await db.walletTransaction.count({ where: { businessId: f.business.id, type: "REDEMPTION" } }), 1);
  } finally { await h.close(); }
});

test("affordable concurrent checkout and top-up preserve every delta and monotonic versions", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db); await h.login(db, f);
    const other = new FormData(); for (const [k,v] of f.form) other.append(k,v); other.set("operationId", randomUUID());
    const results = await Promise.all([h.action.completeCashierSaleAction(f.form), h.action.completeCashierSaleAction(other),
      postWalletTopUp(f.ctx, { ...f.input, operationKey: randomUUID() }, db)]);
    for (const result of results.slice(0, 2)) assert.equal((result as {status: string}).status, "success");
    const account = await db.walletAccount.findFirstOrThrow({ where: { businessId: f.business.id } });
    const ledger = await db.walletTransaction.findMany({ where: { businessId: f.business.id }, orderBy: { sequence: "asc" } });
    // Each paid+bonus top-up has two existing ledger entries; each redemption has one.
    assert.equal(account.version, 6); assert.equal(account.paidBalance.plus(account.bonusBalance).toFixed(2), "80.00");
    assert.deepEqual(ledger.map(row => row.sequence), [1, 2, 3, 4, 5, 6]);
    assert.equal(ledger.reduce((sum, row) => sum + Number(row.paidDelta) + Number(row.bonusDelta), 0), 80);
    assert.equal(ledger.filter(row => row.type === "REDEMPTION").length, 2);
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 2);
  } finally { await h.close(); }
});
