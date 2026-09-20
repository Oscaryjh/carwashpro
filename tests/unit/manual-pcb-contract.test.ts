import assert from "node:assert/strict";
import test from "node:test";
import { manualPcbDigest, parseManualPcbConfirmation, isManualPcbCurrent } from "../../src/lib/payroll/manual-pcb-contract";

test("manual PCB requires explicit amount, affirmative confirmation and evidence, including zero", () => {
  for (const amount of [undefined, null, "", " ", -1, "1.001", "1e2", "NaN"]) {
    assert.throws(() => parseManualPcbConfirmation({ amount, externalReference: "external reference", confirmed: true }));
  }
  assert.throws(() => parseManualPcbConfirmation({ amount: "0", externalReference: "", confirmed: true }));
  assert.throws(() => parseManualPcbConfirmation({ amount: "0", externalReference: "external reference", confirmed: false }));
  assert.deepEqual(parseManualPcbConfirmation({ amount: "0.00", externalReference: "reference 2026-09", confirmed: true }), { amountCents: 0, externalReference: "reference 2026-09" });
});

test("manual source digest is canonical but binds every input and revision", () => {
  const input = { businessId: "business", membershipId: "employee", payrollMonth: "2026-09", inputRevision: 4, components: [{ code: "SALARY", amount: "1000" }], tax: { revision: 2 }, statutoryInputDigest: "a" };
  const digest = manualPcbDigest(input);
  assert.equal(digest, manualPcbDigest({ ...input, tax: { revision: 2 } }));
  for (const changes of [{ businessId: "other" }, { membershipId: "other" }, { payrollMonth: "2026-10" }, { inputRevision: 5 }, { components: [{ code: "SALARY", amount: "1001" }] }, { tax: { revision: 3 } }, { statutoryInputDigest: "b" }]) {
    assert.notEqual(manualPcbDigest({ ...input, ...changes }), digest);
  }
});

test("missing, invalidated, stale or unconfirmed source never qualifies, including zero", () => {
  const current = { businessId: "b", membershipId: "m", payrollEntryId: "e", payrollMonth: "2026-09", inputRevision: 2, inputDigest: "a".repeat(64) };
  const source = { ...current, amount: "0.00", externalReference: "external reference", confirmedById: "actor", confirmedAt: new Date(), inputVersion: 1, invalidations: [] };
  assert.equal(isManualPcbCurrent(null, current), false);
  assert.equal(isManualPcbCurrent(source, current), true);
  for (const change of [{ inputRevision: 1 }, { inputDigest: "b".repeat(64) }, { businessId: "foreign" }, { membershipId: "foreign" }, { payrollEntryId: "other" }, { payrollMonth: "2026-10" }, { inputVersion: 0 }, { externalReference: "" }, { confirmedById: "" }, { invalidations: [{}] }]) {
    assert.equal(isManualPcbCurrent({ ...source, ...change }, current), false);
  }
});
