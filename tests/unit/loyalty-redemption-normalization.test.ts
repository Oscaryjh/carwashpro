import assert from "node:assert/strict";
import test from "node:test";
import { calculateLoyaltyRedemption } from "../../src/lib/loyalty/rules";
import { redeemCheckoutPoints } from "../../src/lib/loyalty/checkout-coverage";

const base = { availablePoints:1307, maximumDiscountCents:2000, minimumPoints:100, pointsPerRinggit:100, requestedPoints:1500 };
for (const [name,overrides,points,cents] of [
  ["balance cap",{},1300,1300],
  ["request equals irregular balance",{requestedPoints:1307},1300,1300],
  ["below one block",{availablePoints:99,requestedPoints:1000},0,0],
  ["raw request floors",{requestedPoints:550},500,500],
  ["order cents cap",{availablePoints:5000,requestedPoints:5000,maximumDiscountCents:1380},1300,1300],
  ["minimum after flooring valid",{minimumPoints:500,requestedPoints:550},500,500],
  ["exact block",{requestedPoints:1300},1300,1300],
  ["rate250",{pointsPerRinggit:250,availablePoints:1499,requestedPoints:2000},1250,500],
] as const) test(`canonical redemption ${name}`,()=>{
  const input={...base,...overrides};
  const result=calculateLoyaltyRedemption(input);
  assert.deepEqual(result,{points,discountCents:cents});
  assert.equal(result.points%input.pointsPerRinggit,0);
  assert.deepEqual(redeemCheckoutPoints(input),result);
});
test("normalized result below minimum rejects even when raw request passes",()=>{
  assert.throws(()=>calculateLoyaltyRedemption({...base,minimumPoints:500,availablePoints:499,requestedPoints:550}),/available points cannot/);
  assert.throws(()=>calculateLoyaltyRedemption({...base,minimumPoints:501,requestedPoints:550}),/available points cannot/);
});
