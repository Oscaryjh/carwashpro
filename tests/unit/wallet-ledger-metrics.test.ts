import assert from "node:assert/strict";
import test from "node:test";
import * as metrics from "../../src/lib/financial-metrics";

test("wallet buckets come from ledger deltas and never become sales or external cash", () => {
  assert.equal(typeof metrics.calculateWalletLedgerMetrics, "function");
  const result = metrics.calculateWalletLedgerMetrics([
    { type: "TOP_UP_PAID", paidCents: 100000, bonusCents: 0 },
    { type: "TOP_UP_BONUS", paidCents: 0, bonusCents: 10000 },
    { type: "REDEMPTION", paidCents: -8000, bonusCents: -10000 },
    { type: "REFUND", paidCents: 5000, bonusCents: 0 },
    { type: "REFUND", paidCents: 3000, bonusCents: 10000 },
    { type: "REVERSAL", originalType: "TOP_UP_PAID", paidCents: -100000, bonusCents: 0 },
    { type: "REVERSAL", originalType: "TOP_UP_BONUS", paidCents: 0, bonusCents: -10000 },
    { type: "REVERSAL", originalType: "REDEMPTION", paidCents: 2000, bonusCents: 4000 },
  ]);
  assert.deepEqual(result, {
    topUpPrincipalCents: 100000, topUpBonusCents: 10000,
    redemptionPaidCents: 8000, redemptionBonusCents: 10000,
    refundPaidCents: 8000, refundBonusCents: 10000,
    reversedPrincipalCents: 100000, reversedBonusCents: 10000,
    voidRestoredPaidCents: 2000, voidRestoredBonusCents: 4000,
  });
});

test("unexplained wallet adjustments or reversals cannot silently disappear", () => {
  assert.throws(() => metrics.calculateWalletLedgerMetrics([{ type: "REVERSAL", paidCents: 100, bonusCents: 0 }]), /source/i);
  assert.throws(() => metrics.calculateWalletLedgerMetrics([{ type: "ADJUSTMENT", paidCents: 100, bonusCents: 0 }]), /unsupported/i);
  assert.throws(() => metrics.calculateWalletLedgerMetrics([{ type: "REFUND", paidCents: -100, bonusCents: 0 }]), /sign/i);
});
