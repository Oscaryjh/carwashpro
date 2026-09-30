import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { parseWalletAmount, planWalletDebit, planWalletRefund } from "../../src/lib/wallet/rules";

test("wallet parses exact cents without floating money and rejects invalid amounts", () => {
  assert.equal(parseWalletAmount("1000.01"), 100001);
  assert.equal(parseWalletAmount(new Prisma.Decimal("0.29")), 29);
  assert.equal(parseWalletAmount("0"), 0);
  assert.equal(parseWalletAmount("99999999.99"), 9999999999);
  for (const amount of ["-1", "NaN", "Infinity", "1.001", "1e3", "", "100000000", "9007199254740992", 0.1]) {
    assert.throws(() => parseWalletAmount(amount as string));
  }
});

test("wallet debit is bonus first, exact and cannot overdraw", () => {
  assert.deepEqual(planWalletDebit({ paidCents: 100000, bonusCents: 10000, amountCents: 8000 }), { paidUsedCents: 0, bonusUsedCents: 8000 });
  assert.deepEqual(planWalletDebit({ paidCents: 100000, bonusCents: 2000, amountCents: 5000 }), { paidUsedCents: 3000, bonusUsedCents: 2000 });
  assert.deepEqual(planWalletDebit({ paidCents: 100000, bonusCents: 10000, amountCents: 12000 }), { paidUsedCents: 2000, bonusUsedCents: 10000 });
  assert.deepEqual(planWalletDebit({ paidCents: 100, bonusCents: 20, amountCents: 120 }), { paidUsedCents: 100, bonusUsedCents: 20 });
  for (const amountCents of [0, -1, 121, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => planWalletDebit({ paidCents: 100, bonusCents: 20, amountCents }));
  }
});

test("partial refund restores paid first based on original and cumulative composition", () => {
  const original = { originalPaidCents: 5000, originalBonusCents: 10000 };
  assert.deepEqual(planWalletRefund({ ...original, refundedPaidCents: 0, refundedBonusCents: 0, refundCents: 6000 }), { paidCents: 5000, bonusCents: 1000 });
  assert.deepEqual(planWalletRefund({ ...original, refundedPaidCents: 5000, refundedBonusCents: 1000, refundCents: 3000 }), { paidCents: 0, bonusCents: 3000 });
  assert.deepEqual(planWalletRefund({ ...original, refundedPaidCents: 5000, refundedBonusCents: 4000, refundCents: 6000 }), { paidCents: 0, bonusCents: 6000 });
  assert.deepEqual(planWalletRefund({ ...original, refundedPaidCents: 0, refundedBonusCents: 0, refundCents: 15000 }), { paidCents: 5000, bonusCents: 10000 });
  for (const refundCents of [0, -1, 15001, 1.1, Infinity]) assert.throws(() => planWalletRefund({ ...original, refundedPaidCents: 0, refundedBonusCents: 0, refundCents }));
  assert.throws(() => planWalletRefund({ ...original, refundedPaidCents: 0, refundedBonusCents: 100, refundCents: 1 }));
});

test("single-component refund cannot convert bonus to paid or manufacture credit", () => {
  assert.deepEqual(planWalletRefund({ originalPaidCents: 0, originalBonusCents: 8000, refundedPaidCents: 0, refundedBonusCents: 0, refundCents: 8000 }), { paidCents: 0, bonusCents: 8000 });
  assert.deepEqual(planWalletRefund({ originalPaidCents: 8000, originalBonusCents: 0, refundedPaidCents: 0, refundedBonusCents: 0, refundCents: 8000 }), { paidCents: 8000, bonusCents: 0 });
});
