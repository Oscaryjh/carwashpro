import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MODULE_REGISTRY } from "../../src/lib/modules/registry";
import {
  duplicateFingerprint,
  parseClaimDate,
  parseMoneyCents,
  reviewClaimInputSchema,
  submitClaimInputSchema,
} from "../../src/lib/claim/policy";
import { calculatePayrollComponentAggregates } from "../../src/lib/payroll/component-calculation";
import { CLAIM_STATUTORY_TREATMENT_NOT_READY } from "../../src/lib/claim/reimbursement";

test("Claims is operational, HR-dependent and does not depend on Payroll", () => {
  assert.equal(MODULE_REGISTRY.CLAIMS.operational, true);
  assert.deepEqual(MODULE_REGISTRY.CLAIMS.dependencies, ["HR"]);
  assert.equal(MODULE_REGISTRY.CLAIMS.dependencies.includes("PAYROLL"), false);
});

test("Claim submission validates MYR line input and unique line numbers", () => {
  const parsed = submitClaimInputSchema.parse({
    clientRequestId: "11111111-1111-4111-8111-111111111111",
    purpose: "Customer-site supplies",
    currency: "MYR",
    lines: [{ lineNumber: 1, categoryId: "22222222-2222-4222-8222-222222222222", expenseDate: "2026-08-10", description: "Parking", amount: "12.30" }],
  });
  assert.equal(parsed.lines.length, 1);
  assert.equal(parseMoneyCents("12.30"), 1230);
  assert.equal(parseClaimDate("2026-08-10").toISOString(), "2026-08-10T00:00:00.000Z");
  assert.throws(() => submitClaimInputSchema.parse({ ...parsed, lines: [parsed.lines[0], parsed.lines[0]] }));
});

test("partial and rejected line decisions are represented explicitly", () => {
  const parsed = reviewClaimInputSchema.parse({
    claimId: "11111111-1111-4111-8111-111111111111",
    expectedRevision: 1,
    reason: "Receipt supports only part of the spend.",
    lines: [{ lineId: "22222222-2222-4222-8222-222222222222", approvedAmount: "8.00", reason: "Personal item removed." }],
  });
  assert.equal(parsed.lines[0]?.approvedAmount, "8.00");
});

test("duplicate detection is a stable warning fingerprint", () => {
  const first = duplicateFingerprint({ membershipId: "m1", categoryId: "c1", expenseDate: "2026-08-10", amountCents: 1200 });
  const second = duplicateFingerprint({ membershipId: "m1", categoryId: "c1", expenseDate: "2026-08-10", amountCents: 1200 });
  assert.equal(first, second);
});

test("verified Claim reimbursement increases net without changing gross wage", () => {
  const totals = calculatePayrollComponentAggregates([
    {
      lineKey: "SYSTEM:BASIC_SALARY",
      type: "EARNING",
      code: "BASIC_SALARY",
      name: "Basic Salary",
      amountCents: 300_000,
      currency: "MYR",
      sourceType: "BASIC_SALARY",
      sourceId: null,
      sourceVersionId: null,
      sourceRevision: null,
      effectiveFromMonth: null,
      calculationBasis: "MONTHLY",
      origin: "SYSTEM",
      reason: null,
      sortOrder: 100,
    },
  ], { epfEmployeeCents: 33_000, socsoEmployeeCents: 1_500, eisEmployeeCents: 500, lindung24EmployeeCents: 0, pcbCents: 4_000 }, 12_345);
  assert.equal(totals.grossPayCents, 300_000);
  assert.equal(totals.netPayCents, 273_345);
  assert.equal(CLAIM_STATUTORY_TREATMENT_NOT_READY, "CLAIM_STATUTORY_TREATMENT_NOT_READY");
});

test("Claim implementation uses a dedicated reimbursement source, never one-off earnings or Public Bank", async () => {
  const reimbursement = await readFile("src/lib/claim/reimbursement.ts", "utf8");
  const schema = await readFile("prisma/schema.prisma", "utf8");
  assert.match(schema, /model ClaimReimbursement \{/);
  assert.match(schema, /model PayrollClaimReimbursementSnapshot \{/);
  assert.doesNotMatch(reimbursement, /ONE_OFF_EARNING|PUBLIC_BANK|PayrollVariablePay/);
});
