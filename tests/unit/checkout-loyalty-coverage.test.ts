import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { prepareCheckoutCoverage, calculateCoveredCheckoutTax, redeemCheckoutPoints } from "../../src/lib/loyalty/checkout-coverage";
import { calculateTax } from "../../src/lib/tax/calculator";

const line = (quantity: number, coveredQuantity: number, price = 100) => ({ lineTotal: price * quantity, quantity, coveredQuantity, taxable: true });
for (const [quantity, coveredQuantity] of [[1, 1], [2, 1], [3, 1], [3, 2]]) {
  for (const rate of [0, 6]) test(`coverage ${coveredQuantity}/${quantity}, SST ${rate}`, () => {
    const input = { lines: [line(quantity, coveredQuantity)], sstEnabled: rate > 0, sstRate: rate, discount: 0 };
    const prepared = prepareCheckoutCoverage(input);
    const redemption = redeemCheckoutPoints({ availablePoints: 5000, minimumPoints: 100, pointsPerRinggit: 100, requestedPoints: 1000, maximumDiscountCents: prepared.eligibleCents });
    const result = calculateCoveredCheckoutTax(input, redemption.discountCents);
    assert.equal(redemption.points, quantity === coveredQuantity ? 0 : 1000);
    assert.equal(prepared.eligibleCents, (quantity - coveredQuantity) * 10000);
    assert.equal(result.coverageCents.flat().reduce((a,b)=>a+b,0), coveredQuantity * (10000 + rate * 100));
    assert.equal(Math.round(result.tax.total * 100), quantity * (10000 + rate * 100) - redemption.discountCents * (1 + rate / 100));
    assert.equal(result.loyaltyLineDiscountCents.reduce((a,b)=>a+b,0), redemption.discountCents);
  });
}
test("mixed odd cents: only uncovered value receives discount and residual", () => {
  const input = { lines: [line(1,0,10.03),line(3,1,10.01)], sstEnabled: true, sstRate: 6, discount: 0 };
  const before = prepareCheckoutCoverage(input);
  const result = calculateCoveredCheckoutTax(input, 100);
  assert.deepEqual(result.coverageCents, before.coverageCents);
  assert.equal(before.eligibleCents, 3005);
  assert.equal(result.loyaltyLineDiscountCents.reduce((a,b)=>a+b,0),100);
  assert.equal(Math.round(result.tax.total*100), Math.round(result.tax.subtotal*100)-100+Math.round(result.tax.tax*100));
  assert.equal(result.coverageCents[1][0],1061);
});
test("manual allocation baseline and no-points tax remain unchanged", () => {
  const input = { lines: [line(3,1,10.01),line(1,0,7.03)], sstEnabled: true, sstRate: 6, discount: 3.01, tip: 2.13 };
  assert.deepEqual(calculateCoveredCheckoutTax(input,0).tax,calculateTax(input));
  const after = calculateCoveredCheckoutTax(input,100);
  assert.deepEqual(after.coverageCents,prepareCheckoutCoverage(input).coverageCents);
  assert.equal(after.tax.tip,2.13);
});
test("without vouchers retains existing manual plus points allocation exactly, including purchase", () => {
  const input = { lines: [line(1,0,200),line(1,0,37.91)], sstEnabled: true, sstRate: 6, discount: 7.13 };
  assert.deepEqual(calculateCoveredCheckoutTax(input,1000).tax,calculateTax({...input,discount:17.13}));
});
test("cap excludes covered quantity; invalid coverage fails closed", () => {
  const prepared=prepareCheckoutCoverage({lines:[line(3,2)],sstEnabled:false});
  assert.deepEqual(redeemCheckoutPoints({availablePoints:50000,minimumPoints:100,pointsPerRinggit:100,requestedPoints:50000,maximumDiscountCents:prepared.eligibleCents}),{points:10000,discountCents:10000});
  assert.throws(()=>prepareCheckoutCoverage({lines:[line(1,2)],sstEnabled:false}));
});
test("a sub-ringgit balance cannot claim redeemed points with zero monetary benefit", () => {
  assert.deepEqual(redeemCheckoutPoints({availablePoints:50,minimumPoints:1,pointsPerRinggit:100,requestedPoints:1000,maximumDiscountCents:10000}),{points:0,discountCents:0});
});
test("manual allocation stays fixed and a fully covered last line receives no points residual", () => {
  const input = {lines:[line(1,0,33.33),line(1,0,33.34),line(1,1,100)],sstEnabled:true,sstRate:6,discount:16.67};
  const before=prepareCheckoutCoverage(input);
  assert.deepEqual(before.baseline.lineDiscount,[3.33,3.33,10.01]);
  const after=calculateCoveredCheckoutTax(input,1000);
  assert.deepEqual(after.loyaltyLineDiscountCents,[499,501,0]);
  assert.deepEqual(after.tax.lineDiscount,[8.32,8.34,10.01]);
  assert.deepEqual(after.coverageCents,[[],[],[9539]]);
  assert.deepEqual(after.coverageCents,before.coverageCents);
  assert.deepEqual(after.tax.lineTax,[1.5,1.5,5.4]);
  assert.equal(after.tax.total,148.4);
});
test("historical SST line rounding residual belongs to payable, not frozen coverage", () => {
  const input={lines:[line(6,5,1.02)],sstEnabled:true,sstRate:6,discount:0.02};
  const before=prepareCheckoutCoverage(input);
  const after=calculateCoveredCheckoutTax(input,100);
  assert.equal(before.eligibleCents,100);
  assert.deepEqual(after.coverageCents,[[108,108,108,108,108]]);
  assert.equal(Math.round(after.tax.total*100)-after.coverageCents.flat().reduce((a,b)=>a+b,0),1);
  assert.equal(after.tax.tax,0.31);
});
test("preview, draft Apply and server use one canonical coverage calculation without client monetary inputs", () => {
  const ui=readFileSync("src/components/cashier-unified-sale-form.tsx","utf8");
  const server=readFileSync("src/app/(business)/cashier/actions.ts","utf8");
  for(const source of [ui,server]) {
    assert.match(source, /calculateCoveredCheckoutTax/);
    assert.match(source, /prepareCheckoutCoverage/);
    assert.match(source, /redeemCheckoutPoints/);
  }
  assert.match(ui,/maximumDiscountCents: eligibleCents/);
  assert.match(ui,/maximumDiscountCents: draftEligibleCents/);
  assert.match(ui,/setLoyaltyPoints\(String\(draftRedemption.points\)\)/);
  assert.match(server,/maximumDiscountCents: coverage.eligibleCents/);
  assert.match(server,/coveredQuantityByServiceId.get\(service.id\)/);
  assert.match(server,/loyaltyPointsRedeemed > 0 && loyaltyDiscountCents > 0 && payment/);
  assert.doesNotMatch(server,/formData.get\("(?:coveredQuantity|coveredAmount|eligibleAmount)"\)/);
  assert.match(ui,/name="customerPackageId"/);
  assert.match(ui,/disabled=\{!selected && coverageFull\}/);
});
