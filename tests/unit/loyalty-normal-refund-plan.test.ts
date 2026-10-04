import assert from "node:assert/strict";
import test from "node:test";
import { planNormalRefundLoyalty } from "../../src/lib/loyalty/normal-refund-plan";

const base = { balance: 0, redeemed: 100, earned: 10, paymentCents: 1000, refundedCents: 1000, restored: 0, reversed: 0, activityCount: 3 };
test("refund applies one net delta, not reverse-clamp-restore", () => {
  const p = planNormalRefundLoyalty(base);
  assert.equal(p.balance,90); assert.equal(p.restoreDelta,100); assert.equal(p.reverseDelta,10);
});
test("odd cumulative floors finish at exact original totals", () => {
  const a = planNormalRefundLoyalty({...base,redeemed:101,earned:11,refundedCents:250});
  assert.equal(a.balance,23); assert.equal(a.restoreDelta,25); assert.equal(a.reverseDelta,2);
  const b = planNormalRefundLoyalty({...base,redeemed:101,earned:11,refundedCents:500,balance:23,restored:25,reversed:2,activityCount:5,previous:a.sequence});
  assert.equal(b.balance,45); assert.equal(b.restoreDelta,25); assert.equal(b.reverseDelta,3);
  const c = planNormalRefundLoyalty({...base,redeemed:101,earned:11,balance:45,restored:50,reversed:5,activityCount:7,previous:b.sequence});
  assert.equal(c.balance,90); assert.equal(c.restoreDelta,51); assert.equal(c.reverseDelta,6);
});
test("rounding after a clamped partial does not manufacture points", () => {
  const a = planNormalRefundLoyalty({...base,redeemed:3,refundedCents:300});
  const b = planNormalRefundLoyalty({...base,redeemed:3,refundedCents:340,restored:0,reversed:3,activityCount:4,previous:a.sequence});
  assert.equal(b.balance,0); assert.equal(b.restoreDelta,1); assert.equal(b.reverseDelta,0);
  assert.equal(planNormalRefundLoyalty({...base,redeemed:3,refundedCents:340}).balance,0);
});
test("other activity starts from current balance without collecting old points debt", () => {
  const a = planNormalRefundLoyalty({...base,redeemed:3,refundedCents:300});
  const b = planNormalRefundLoyalty({...base,redeemed:3,refundedCents:340,balance:10,restored:0,reversed:3,activityCount:5,previous:a.sequence});
  assert.equal(b.balance,11);
});
test("legacy prior refunds use current balance and only uncompensated delta", () => {
  const p = planNormalRefundLoyalty({...base,balance:7,restored:50,reversed:5});
  assert.equal(p.balance,52); assert.equal(p.restoreDelta,50); assert.equal(p.reverseDelta,5);
});
test("invalid or over-compensated evidence fails closed", () => {
  assert.throws(() => planNormalRefundLoyalty({...base,restored:101}));
  assert.throws(() => planNormalRefundLoyalty({...base,balance:-1}));
});
