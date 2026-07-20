import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateLoyaltyRedemption,
  calculateRedemptionRefundPoints,
} from "../../src/lib/loyalty/rules";

test("loyalty redemption converts whole point blocks into a capped discount", () => {
  assert.deepEqual(
    calculateLoyaltyRedemption({
      availablePoints: 1307,
      maximumDiscountCents: 2000,
      minimumPoints: 100,
      pointsPerRinggit: 100,
      requestedPoints: 550,
    }),
    { discountCents: 500, points: 500 },
  );

  assert.deepEqual(
    calculateLoyaltyRedemption({
      availablePoints: 1307,
      maximumDiscountCents: 300,
      minimumPoints: 100,
      pointsPerRinggit: 100,
      requestedPoints: 1000,
    }),
    { discountCents: 300, points: 300 },
  );
});

test("loyalty redemption enforces the minimum point threshold", () => {
  assert.throws(
    () =>
      calculateLoyaltyRedemption({
        availablePoints: 1000,
        maximumDiscountCents: 1000,
        minimumPoints: 200,
        pointsPerRinggit: 100,
        requestedPoints: 100,
      }),
    /Redeem at least 200 points/,
  );
});

test("refunds restore redeemed points proportionally and exactly once", () => {
  assert.equal(
    calculateRedemptionRefundPoints({
      paymentCents: 10000,
      previouslyRestoredPoints: 0,
      redeemedPoints: 500,
      totalRefundedCents: 2500,
    }),
    125,
  );
  assert.equal(
    calculateRedemptionRefundPoints({
      paymentCents: 10000,
      previouslyRestoredPoints: 125,
      redeemedPoints: 500,
      totalRefundedCents: 10000,
    }),
    375,
  );
});
