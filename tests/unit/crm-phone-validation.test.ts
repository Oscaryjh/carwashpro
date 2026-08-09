import assert from "node:assert/strict";
import test from "node:test";
import { customerSchema } from "../../src/lib/validation/crm";

function customer(phone: string) {
  return customerSchema.safeParse({
    name: "QA Customer",
    phone,
    email: "",
    dateOfBirth: "",
    notes: "",
  });
}

test("customer phone accepts common Malaysian formatting and stores a canonical local value", () => {
  const result = customer("+60 12-345 6789");

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.phone, "0123456789");
  }
});

test("customer phone still rejects non-phone characters", () => {
  const result = customer("+60-CALL-ME");

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(
      result.error.issues[0]?.message,
      "Phone can only contain numbers and common separators.",
    );
  }
});
