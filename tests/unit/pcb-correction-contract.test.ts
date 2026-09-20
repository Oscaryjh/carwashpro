import test from "node:test";
import assert from "node:assert/strict";
import { correctionAmounts, latestPcbAmounts, correctionSettlementState } from "../../src/lib/payroll/pcb-correction-contract";
import { calculatePayrollComponentAggregates, type PayrollComponentLine } from "../../src/lib/payroll/component-calculation";

test("correction delta follows immediately preceding authoritative version, never sums original and corrected", () => {
  assert.deepEqual(correctionAmounts(12550, 15000), { amountCents: 15000, deltaCents: 2450 });
  assert.deepEqual(correctionAmounts(15000, 10000), { amountCents: 10000, deltaCents: -5000 });
  const totals = latestPcbAmounts([{ entryKey: "a", version: 1, amountCents: 12550 }, { entryKey: "a", version: 2, amountCents: 15000 }, { entryKey: "a", version: 3, amountCents: 10000 }, { entryKey: "b", version: 1, amountCents: 5000 }]);
  assert.equal(totals, 15000);
  assert.throws(() => latestPcbAmounts([{ entryKey: "a", version: 1, amountCents: 1 }, { entryKey: "a", version: 1, amountCents: 2 }]), /PCB_VERSION_CONFLICT/);
});
test("prior-period PCB refund changes take-home only, not gross income or current PCB", () => {
  const line: PayrollComponentLine = { lineKey: "PRIOR_PCB:synthetic", type: "EARNING", code: "PRIOR_PERIOD_PCB_ADJUSTMENT", name: "Prior-period PCB adjustment",
    amountCents: 5000, currency: "MYR", sourceType: "CORRECTION", sourceId: null, sourceVersionId: null, sourceRevision: 2,
    effectiveFromMonth: null, calculationBasis: "PRIOR_PERIOD_PCB", origin: "SYSTEM", reason: "Synthetic explicit correction", sortOrder: 9500 };
  const totals = calculatePayrollComponentAggregates([line], { epfEmployeeCents: 0, socsoEmployeeCents: 0, eisEmployeeCents: 0, lindung24EmployeeCents: 0, pcbCents: 0, cp38Cents: 0 });
  assert.equal(totals.grossPayCents, 0);
  assert.equal(totals.allowancesCents, 0);
  assert.equal(totals.netPayCents, 5000);
});
test("unknown amounts are rejected; zero is explicit; settlement is never a payment claim", () => {
  for (const value of [NaN, Infinity, -1, 1.1]) assert.throws(() => correctionAmounts(0, value));
  assert.equal(correctionAmounts(1, 0).deltaCents, -1);
  assert.equal(correctionSettlementState({ activeEmployee: false, hasNextRun: true, applied: false }), "UNSETTLED");
  assert.equal(correctionSettlementState({ activeEmployee: true, hasNextRun: false, applied: false }), "UNSETTLED");
  assert.equal(correctionSettlementState({ activeEmployee: true, hasNextRun: true, applied: true }), "APPLIED_TO_PAYROLL_NOT_PAYMENT");
});
