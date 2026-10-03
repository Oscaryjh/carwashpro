import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase, walletFixture } from "../helpers/wallet-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";

const db = walletTestDatabase();
after(() => db.$disconnect());
async function adapter() {
  const module = await import("../../src/lib/wallet/ui-adapter").catch(() => null);
  assert.ok(module?.saveWalletOffer, "P1B.5 authenticated adapter must exist");
  return module;
}
const offerInput = { name: "RM1,000 Top-up", paidAmount: "1000.00", bonusAmount: "100.00", active: true };

test("legacy pending top-up requires explicit activity review while completed legacy replay remains original",async()=>{
  const a=await adapter(),f=await walletFixture(db);
  const {branchId: _branch,shiftId: _shift,modeAtConfirmation: _mode,...legacy}=f.input;
  await assert.rejects(a.submitWalletTopUp(f.ctx,legacy,db),{code:"CASHIER_SHIFT_MODE_CHANGED"});
  assert.equal(await db.walletTopUp.count({where:{businessId:f.business.id}}),0);
  const options=await a.getWalletTopUpOptions(f.ctx,f.customer.id,db);
  assert.ok(options.activity);
  const first=await a.submitWalletTopUp(f.ctx,{...legacy,...options.activity!},db);
  await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
  const replay=await a.submitWalletTopUp(f.ctx,legacy,db);
  assert.equal(replay.topUpId,first.topUpId);assert.equal(replay.replayed,true);
});

test("Owner manages versioned offers without changing historical top-up snapshots", async () => {
  const a = await adapter();
  const f = await walletFixture(db);
  const receipt = await postWalletTopUp(f.ctx, f.input, db);
  const created = await a.saveWalletOffer(f.ctx, offerInput, db);
  assert.equal(created.totalCredited, "1100.00");
  const edited = await a.saveWalletOffer(f.ctx, { ...offerInput, id: created.id, expectedVersion: 0, bonusAmount: "200", active: false }, db);
  assert.equal(edited.version, 1);
  assert.equal(edited.active, false);
  await assert.rejects(a.saveWalletOffer(f.ctx, { ...offerInput, id: created.id, expectedVersion: 0 }, db), { code: "OFFER_CHANGED_RECONFIRM" });
  const active = await a.saveWalletOffer(f.ctx, { ...offerInput, id: created.id, expectedVersion: 1 }, db);
  assert.equal(active.active, true);
  const snapshot = await db.walletTopUp.findUniqueOrThrow({ where: { id: receipt.topUpId } });
  assert.equal(snapshot.bonusAmount.toFixed(2), "100.00");
  assert.equal(snapshot.offerNameSnapshot, "Synthetic offer");
});

test("offer amount validation rejects zero paid, negative bonus and excessive precision", async () => {
  const a = await adapter(); const f = await walletFixture(db);
  for (const change of [{ paidAmount: "0" }, { bonusAmount: "-1" }, { paidAmount: "1.001" }]) {
    await assert.rejects(a.saveWalletOffer(f.ctx, { ...offerInput, ...change }, db));
  }
  assert.equal(await db.walletTopUpOffer.count({ where: { businessId: f.business.id } }), 1);
});

test("Staff cannot manage offers or read Owner history even with CRM and POS", async () => {
  const a = await adapter(); const f = await walletFixture(db);
  await db.user.update({ where: { id: f.actor.id }, data: { role: "STAFF", permissions: ["CRM", "POS"] } });
  await assert.rejects(a.saveWalletOffer(f.ctx, offerInput, db), { code: "WALLET_ACCESS_DENIED" });
  await assert.rejects(a.listWalletOffers(f.ctx, db), { code: "WALLET_ACCESS_DENIED" });
  await assert.rejects(a.getWalletHistory(f.ctx, f.customer.id, 0, db), { code: "WALLET_ACCESS_DENIED" });
  const panel = await a.getWalletPanel(f.ctx, f.customer.id, db);
  assert.equal(panel.totalBalance, "0.00");
  assert.equal(panel.ownerDetails, null);
  assert.equal(panel.canTopUp, true);
  assert.equal(await db.walletAccount.count({ where: { businessId: f.business.id } }), 0);
});

test("Owner history groups paid and bonus, retains historical balance and denies foreign customer", async () => {
  const a = await adapter(); const f = await walletFixture(db); const other = await walletFixture(db);
  await postWalletTopUp(f.ctx, f.input, db);
  await postWalletTopUp(f.ctx, { ...f.input, operationKey: randomUUID() }, db);
  const history = await a.getWalletHistory(f.ctx, f.customer.id, 0, db);
  assert.equal(history.rows.length, 2);
  assert.equal(history.rows[0].amount, "1100.00");
  assert.equal(history.rows[0].balanceAfter, "2200.00");
  assert.equal(history.rows[1].balanceAfter, "1100.00");
  assert.equal(history.rows[0].paidAmount, "1000.00");
  assert.equal(history.rows[0].bonusAmount, "100.00");
  await assert.rejects(a.getWalletHistory(f.ctx, other.customer.id, 0, db));
  await assert.rejects(a.saveWalletOffer(f.ctx, { ...offerInput, id: other.offer.id, expectedVersion: 0 }, db));
});

test("UI adapter resolves actor shift, replays original collection after closing, never creates invoice", async () => {
  const a = await adapter(); const f = await walletFixture(db);
  const ctx = { ...f.ctx, branchId: null, shiftId: null };
  const first = await a.submitWalletTopUp(ctx, f.input, db);
  assert.equal(first.totalBalance, "1100.00");
  await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED", endedAt: new Date() } });
  const retry = await a.submitWalletTopUp(ctx, f.input, db);
  assert.equal(retry.topUpId, first.topUpId);
  assert.equal(retry.replayed, true);
  assert.equal(await db.payment.count({ where: { businessId: f.business.id } }), 1);
  assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 0);
  await assert.rejects(a.submitWalletTopUp(ctx, { ...f.input, operationKey: randomUUID() }, db), { code: "CASHIER_SHIFT_MODE_CHANGED" });
});

test("adapter denies CRM-only, missing shift, stale offer, foreign tenant and excludes unsupported tenders", async () => {
  const a = await adapter(); const f = await walletFixture(db);
  const options = await a.getWalletTopUpOptions(f.ctx, f.customer.id, db);
  assert.deepEqual(options.paymentMethods.map(row => row.code), ["BUILTIN_CASH", "BUILTIN_CARD", "BUILTIN_DUITNOW", "BUILTIN_EWALLET", "BUILTIN_BANK_TRANSFER"]);
  await db.walletTopUpOffer.update({ where: { id: f.offer.id }, data: { version: { increment: 1 } } });
  await assert.rejects(a.submitWalletTopUp(f.ctx, f.input, db), { code: "OFFER_CHANGED_RECONFIRM" });
  await db.user.update({ where: { id: f.actor.id }, data: { role: "STAFF", permissions: ["CRM"] } });
  assert.equal((await a.getWalletPanel(f.ctx, f.customer.id, db)).canTopUp, false);
  await assert.rejects(a.submitWalletTopUp(f.ctx, f.input, db), { code: "WALLET_ACCESS_DENIED" });
});
