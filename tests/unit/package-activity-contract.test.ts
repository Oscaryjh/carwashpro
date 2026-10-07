import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { activityEntryKey, derivePackageChange, serviceChangesSchema, additionalSourceRefsSchema } from "../../src/lib/packages/activity-types";

const state = (remainingUses: number, status: "ACTIVE" | "USED_UP" | "PENDING_PAYMENT" | "CANCELLED" = "ACTIVE") => ({ totalUses: 10, remainingUses, status });
test("derive actual capped restoration, not requested amount", () => {
  assert.deepEqual(derivePackageChange("RESTORED", state(9), state(10)), { totalUsesSnapshot: 10, remainingBefore: 9, remainingAfter: 10, usesDelta: 1, statusBefore: "ACTIVE", statusAfter: "ACTIVE" });
  assert.equal(derivePackageChange("RESTORED", state(10), state(10)).usesDelta, 0);
});
test("derive purchase, consumption and cancellation without changing state", () => {
  assert.equal(derivePackageChange("PURCHASED", state(0, "PENDING_PAYMENT"), state(10)).usesDelta, 10);
  assert.equal(derivePackageChange("USED", state(1), state(0, "USED_UP")).usesDelta, -1);
  assert.equal(derivePackageChange("CANCELLED", state(10), state(0, "CANCELLED")).usesDelta, -10);
});
test("reject wrong direction, invalid capacity and fractional uses", () => {
  for (const [type, before, after] of [
    ["USED", state(9), state(10)], ["USED", state(9), state(9)],
    ["RESTORED", state(10), state(9)], ["PURCHASED", state(10), state(9)],
    ["CANCELLED", state(9), state(10)], ["USED", state(11), state(10)],
    ["USED", state(1), state(-1)], ["USED", state(2), state(1.5)],
    ["USED", state(10), { ...state(9), totalUses: 11 }],
  ] as const) assert.throws(() => derivePackageChange(type, before, after));
});
test("strict JSON validates arithmetic, duplicate balance identity and unknown metadata", () => {
  const row = { balanceId: randomUUID(), serviceId: randomUUID(), totalUses: 5, remainingBefore: 5, remainingAfter: 4, usesDelta: -1 };
  assert.deepEqual(serviceChangesSchema.parse([row]), [row]);
  assert.deepEqual(serviceChangesSchema.parse([]), []);
  assert.throws(() => serviceChangesSchema.parse([{ ...row, usesDelta: -2 }]));
  assert.throws(() => serviceChangesSchema.parse([{ ...row, extra: "unsafe" }]));
  assert.throws(() => serviceChangesSchema.parse([row, row]));
  assert.throws(() => additionalSourceRefsSchema.parse({ other: "blob" }));
  assert.throws(() => additionalSourceRefsSchema.parse({ paymentIds: ["bad"], refundIds: [] }));
  assert.deepEqual(additionalSourceRefsSchema.parse({ paymentIds: [], refundIds: [] }), { paymentIds: [], refundIds: [] });
});
test("canonical source keys distinguish coverage sources, not invoice item", () => {
  const cp = randomUUID(), payment = randomUUID(), refund = randomUUID();
  assert.equal(activityEntryKey({ eventType: "PURCHASED", sourceType: "CHECKOUT", customerPackageId: cp }), `purchase:${cp}`);
  assert.equal(activityEntryKey({ eventType: "USED", sourceType: "CHECKOUT", customerPackageId: cp, paymentId: payment }), `use:${payment}`);
  assert.equal(activityEntryKey({ eventType: "RESTORED", sourceType: "PAYMENT_REFUND", customerPackageId: cp, paymentId: payment, paymentRefundId: refund }), `restore:${refund}:${payment}`);
  assert.equal(activityEntryKey({ eventType: "RESTORED", sourceType: "INVOICE_VOID", customerPackageId: cp, paymentId: payment }), `void-restore:${payment}`);
  assert.equal(activityEntryKey({ eventType: "CANCELLED", sourceType: "PAYMENT_REFUND", customerPackageId: cp }), `cancel:${cp}`);
  assert.throws(() => activityEntryKey({ eventType: "USED", sourceType: "CHECKOUT", customerPackageId: cp }));
  assert.throws(() => activityEntryKey({ eventType: "USED", sourceType: "INVOICE_VOID", customerPackageId: cp, paymentId: payment }));
});
