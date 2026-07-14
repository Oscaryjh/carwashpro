import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateEarnedPoints,
  calculateRefundReversalPoints,
} from "../../src/lib/loyalty/rules";

test("earns configured points from a monetary payment", () => {
  assert.equal(calculateEarnedPoints(2550, 1), 25);
  assert.equal(calculateEarnedPoints(2550, 2), 51);
  assert.equal(calculateEarnedPoints(2550, 0.5), 12);
});

test("floors fractional points instead of creating decimals", () => {
  assert.equal(calculateEarnedPoints(199, 1), 1);
});

test("reverses points proportionally across partial refunds", () => {
  const first = calculateRefundReversalPoints({
    earnedPoints: 25,
    paymentCents: 2500,
    totalRefundedCents: 1000,
    previouslyReversedPoints: 0,
  });
  const second = calculateRefundReversalPoints({
    earnedPoints: 25,
    paymentCents: 2500,
    totalRefundedCents: 1500,
    previouslyReversedPoints: first,
  });

  assert.equal(first, 10);
  assert.equal(second, 5);
});

test("a full refund reverses every originally earned point", () => {
  assert.equal(
    calculateRefundReversalPoints({
      earnedPoints: 7,
      paymentCents: 999,
      totalRefundedCents: 999,
      previouslyReversedPoints: 3,
    }),
    4,
  );
});

test("does not reverse points twice", () => {
  assert.equal(
    calculateRefundReversalPoints({
      earnedPoints: 20,
      paymentCents: 2000,
      totalRefundedCents: 2000,
      previouslyReversedPoints: 20,
    }),
    0,
  );
});
