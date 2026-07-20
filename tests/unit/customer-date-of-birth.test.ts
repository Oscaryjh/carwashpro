import assert from "node:assert/strict";
import test from "node:test";
import {
  customerSchema,
  parseDateOfBirth,
} from "../../src/lib/validation/crm";

const validCustomer = {
  name: "Test Customer",
  phone: "0123456789",
  email: "",
  notes: "",
};

test("accepts an optional valid date of birth", () => {
  const parsed = customerSchema.parse({
    ...validCustomer,
    dateOfBirth: "1990-05-20",
  });

  assert.equal(parsed.dateOfBirth, "1990-05-20");
  assert.equal(parseDateOfBirth(parsed.dateOfBirth)?.toISOString(), "1990-05-20T00:00:00.000Z");
});

test("accepts a blank date of birth", () => {
  const parsed = customerSchema.parse({
    ...validCustomer,
    dateOfBirth: "",
  });

  assert.equal(parsed.dateOfBirth, "");
  assert.equal(parseDateOfBirth(parsed.dateOfBirth), null);
});

test("rejects impossible and future dates of birth", () => {
  assert.equal(
    customerSchema.safeParse({
      ...validCustomer,
      dateOfBirth: "2025-02-31",
    }).success,
    false,
  );

  assert.equal(
    customerSchema.safeParse({
      ...validCustomer,
      dateOfBirth: "2999-01-01",
    }).success,
    false,
  );
});
