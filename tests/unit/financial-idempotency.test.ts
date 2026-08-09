import assert from "node:assert/strict";
import test from "node:test";
import {
  FinancialIdempotencyConflictError,
  financialOperationKeySchema,
  fingerprintFinancialRequest,
} from "../../src/lib/financial-idempotency";

test("financial request fingerprints are stable across object field order", () => {
  const first = fingerprintFinancialRequest({
    amountCents: 10_000,
    payment: { method: "CASH", reference: null },
    lines: [{ id: "service-a", quantity: 1 }],
  });
  const second = fingerprintFinancialRequest({
    lines: [{ quantity: 1, id: "service-a" }],
    payment: { reference: null, method: "CASH" },
    amountCents: 10_000,
  });

  assert.equal(first, second);
  assert.notEqual(first, fingerprintFinancialRequest({ amountCents: 15_000 }));
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("financial operation keys require a durable high-entropy shape", () => {
  assert.equal(
    financialOperationKeySchema.parse("checkout:550e8400-e29b-41d4-a716-446655440000"),
    "checkout:550e8400-e29b-41d4-a716-446655440000",
  );
  assert.throws(() => financialOperationKeySchema.parse("short"));
  assert.throws(() => financialOperationKeySchema.parse("contains spaces and symbols!"));
});

test("different payload reuse has a stable business error code", () => {
  const error = new FinancialIdempotencyConflictError();
  assert.equal(error.code, "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
});
