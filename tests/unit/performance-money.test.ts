import assert from "node:assert/strict";
import test from "node:test";
import { allocateSales, cents, emptyComponents, receiveComponents, subtractComponents, totalComponents, validateShares } from "../../src/lib/performance/money";
import { localPerformanceDate, performancePeriod } from "../../src/lib/performance/time";
import { parseCheckoutTipCents, performanceFingerprint } from "../../src/lib/performance/input";
import { fingerprintFinancialRequest } from "../../src/lib/financial-idempotency";
import type { Prisma } from "@prisma/client";
import { capturePerformanceCheckout, capturePerformanceRefund, capturePerformanceVoid } from "../../src/lib/performance/service";

test("legacy clients retain the original financial fingerprint when the new field is absent", () => {
  process.env.TETAMU_PERFORMANCE_PHASE1 = "true";
  const legacy = { amount: 59, method: "CASH" };
  assert.equal(fingerprintFinancialRequest(legacy), fingerprintFinancialRequest({ ...legacy, ...performanceFingerprint(new FormData()) }));
});

test("cashier tip input uses integer cents and rejects excess decimal precision", () => {
  process.env.TETAMU_PERFORMANCE_PHASE1 = "true";
  const data = new FormData(); data.set("performanceTipAmount", "10.01");
  assert.equal(parseCheckoutTipCents(data), 1001);
  for (const invalid of ["-1", "0.001", "1e2", "Infinity", "nan"]) {
    data.set("performanceTipAmount", invalid); assert.throws(() => parseCheckoutTipCents(data), /Tip must/);
  }
});

test("feature off preserves legacy checkout and does not touch the new database tables", async () => {
  const previous = process.env.TETAMU_PERFORMANCE_PHASE1;
  process.env.TETAMU_PERFORMANCE_PHASE1 = "false";
  try {
    const tx = new Proxy({} as Prisma.TransactionClient, { get() { throw new Error("Feature off must not query performance tables"); } });
    const form = new FormData(); form.set("performanceAttribution", "not parsed when disabled"); form.set("performanceTipAmount", "10");
    assert.deepEqual(performanceFingerprint(form), {}); assert.equal(parseCheckoutTipCents(form), 0);
    await capturePerformanceCheckout(tx, { businessId: "disabled", actorUserId: "disabled", input: null, paymentIds: ["disabled"] });
    assert.equal(await capturePerformanceRefund(tx, "disabled", { businessId: "disabled", actorUserId: "disabled" }), null);
    await capturePerformanceVoid(tx, { businessId: "disabled", actorUserId: "disabled", invoiceId: "disabled", reason: "Disabled feature" });
  } finally {
    if (previous === undefined) delete process.env.TETAMU_PERFORMANCE_PHASE1; else process.env.TETAMU_PERFORMANCE_PHASE1 = previous;
  }
});

test("RM118: RM100 sale split equally, RM8 tax excluded, RM10 tip belongs independently to A", () => {
  const components = receiveComponents(cents("118"), { sales: 10_000, tax: 800, tip: 1_000, unresolved: 0 });
  const shares = allocateSales(components.sales, [{ membershipId: "A", basisPoints: 5_000 }, { membershipId: "B", basisPoints: 5_000 }]);
  assert.deepEqual(components, { sales: 10_000, tax: 800, tip: 1_000, unresolved: 0 });
  assert.equal(shares.A + components.tip, 6_000);
  assert.equal(shares.B, 5_000);
  assert.equal(components.sales + components.tip, 11_000);
});

test("partial receipts allocate only the received fraction; last payment consumes the exact remainder", () => {
  const pool = { sales: 10_000, tax: 800, tip: 1_000, unresolved: 0 };
  const first = receiveComponents(5_900, pool);
  assert.deepEqual(first, { sales: 5_000, tax: 400, tip: 500, unresolved: 0 });
  const last = receiveComponents(5_900, subtractComponents(pool, first));
  assert.deepEqual(last, first);
  assert.deepEqual(subtractComponents(subtractComponents(pool, first), last), emptyComponents());
});

test("package coverage consumes its exact tax and sales, never tip; only cash remainder counts", () => {
  const pool = { sales: 20_000, tax: 800, tip: 1_000, unresolved: 0 };
  const coverage = receiveComponents(10_800, { ...pool, tip: 0 }, { sales: 10_000, tax: 800, tip: 0, unresolved: 0 });
  const cash = receiveComponents(11_000, subtractComponents(pool, coverage));
  assert.deepEqual(cash, { sales: 10_000, tax: 0, tip: 1_000, unresolved: 0 });
});

test("many tiny refunds use remaining components and full refund ends at zero", () => {
  let pool = { sales: 97, tax: 8, tip: 13, unresolved: 0 };
  for (let i = 0; i < 118; i++) {
    const refund = receiveComponents(1, pool);
    assert.equal(totalComponents(refund), 1);
    pool = subtractComponents(pool, refund);
  }
  assert.deepEqual(pool, emptyComponents());
});

test("exact refund evidence is checked, not silently replaced by proportional allocation", () => {
  const pool = { sales: 10_000, tax: 800, tip: 1_000, unresolved: 0 };
  assert.deepEqual(receiveComponents(1_000, pool, { ...emptyComponents(), tip: 1_000 }), { ...emptyComponents(), tip: 1_000 });
  assert.throws(() => receiveComponents(1_001, pool, { ...emptyComponents(), tip: 1_001 }), /exceeds/);
  assert.throws(() => receiveComponents(1_000, pool, { ...emptyComponents(), tax: 800 }), /equal/);
});

test("single, split and unassigned sales conserve every cent deterministically", () => {
  for (let amount = 0; amount < 200; amount++) {
    for (const shares of [[], [{ membershipId: "A", basisPoints: 10_000 }], [{ membershipId: "A", basisPoints: 3_334 }, { membershipId: "B", basisPoints: 3_333 }, { membershipId: "C", basisPoints: 3_333 }]]) {
      const result = allocateSales(amount, shares);
      assert.equal(Object.values(result).reduce((a, b) => a + b, 0), amount);
      assert.deepEqual(allocateSales(amount, [...shares].reverse()), result);
    }
  }
});

test("rejects float money, unsafe cents, duplicate staff and ratios other than exactly 100%", () => {
  assert.equal(cents("0.29"), 29);
  assert.throws(() => cents("0.001"), /two decimal/);
  assert.throws(() => cents("999999999999999999"), /safe integer/);
  assert.throws(() => validateShares([{ membershipId: "A", basisPoints: 9_999 }]), /100%/);
  assert.throws(() => validateShares([{ membershipId: "A", basisPoints: 5_000 }, { membershipId: "A", basisPoints: 5_000 }]), /Duplicate/);
});

test("natural month/year uses store midnight, not the 02:00 business-day boundary", () => {
  assert.equal(localPerformanceDate(new Date("2026-12-31T16:30:00Z"), "Asia/Kuching"), "2027-01-01");
  const january = performancePeriod(2027, "Asia/Kuching", 1);
  assert.equal(january.from.toISOString(), "2026-12-31T16:00:00.000Z");
  assert.equal(january.toExclusive.toISOString(), "2027-01-31T16:00:00.000Z");
  assert.equal(performancePeriod(2026, "Asia/Kuching").toExclusive.toISOString(), "2026-12-31T16:00:00.000Z");
});
