import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MODULE_REGISTRY } from "../../src/lib/modules/registry";
import {
  claimCategoryRevisionInputSchema,
  duplicateFingerprint,
  parseClaimDate,
  parseMoneyCents,
  reevaluateClaimPayrollTreatmentInputSchema,
  reviewClaimInputSchema,
  submitClaimInputSchema,
} from "../../src/lib/claim/policy";
import {
  createPayrollReadinessIssue,
  summarizePayrollReadiness,
} from "../../src/lib/payroll/readiness";
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

test("Claim category creation is simple while updates retain an audit reason", () => {
  const base = {
    name: "Parking",
    nature: "GENERAL",
    effectiveFrom: "2026-08-22",
    receiptRequired: true,
    descriptionRequired: false,
  };
  const created = claimCategoryRevisionInputSchema.parse(base);
  assert.equal(created.code, undefined);
  assert.equal(created.reason, undefined);
  assert.equal(created.statutoryTreatmentStatus, "REVIEW_REQUIRED");
  assert.throws(() => claimCategoryRevisionInputSchema.parse({
    ...base,
    categoryId: "11111111-1111-4111-8111-111111111111",
  }), /policy is changing/i);
  assert.equal(claimCategoryRevisionInputSchema.parse({
    ...base,
    categoryId: "11111111-1111-4111-8111-111111111111",
    reason: "Updated receipt policy.",
  }).reason, "Updated receipt policy.");
});

test("Claims manager UI exposes compact reimbursement workflow and category-level payroll treatment", async () => {
  const [page, form, service, reimbursement, readiness, css] = await Promise.all([
    readFile("src/app/(business)/team/claims/page.tsx", "utf8"),
    readFile("src/app/(business)/team/claims/claim-category-policy-form.tsx", "utf8"),
    readFile("src/lib/claim/service.ts", "utf8"),
    readFile("src/lib/claim/reimbursement.ts", "utf8"),
    readFile("src/lib/payroll/readiness.ts", "utf8"),
    readFile("src/app/(business)/team/claims/claims.module.css", "utf8"),
  ]);
  assert.match(page, /Claims waiting for a decision/);
  assert.match(page, /Choose how to reimburse/);
  assert.match(page, /Reject claim/);
  assert.match(page, /Through payroll/);
  assert.match(page, /Pay separately/);
  assert.match(page, /No eligible draft/);
  assert.match(page, /not included in an open payroll draft/);
  assert.match(service, /eligibleMembershipIds/);
  assert.match(form, /Maximum claim amount \(RM\)/);
  assert.match(form, /Saving creates a new policy version/);
  assert.match(form, /Business reimbursement/);
  assert.match(form, /Needs payroll review/);
  assert.match(page, /The employee's salary can continue/);
  assert.match(page, /Re-evaluate reimbursement/);
  assert.match(reimbursement, /PAYROLL_TREATMENT_REEVALUATED/);
  assert.match(reimbursement, /currentPolicies/);
  assert.match(readiness, /"REVIEW",\s*"CLAIM_STATUTORY_TREATMENT_NOT_READY"/);
  assert.doesNotMatch(form, /name="code"/);
  assert.match(service, /nextClaimCategoryCode/);
  assert.match(css, /@media\(max-width:520px\)/);
  assert.match(css, /@media\(max-width:820px\)/);
});

test("blocked reimbursements require an exact snapshot before re-evaluation", () => {
  const parsed = reevaluateClaimPayrollTreatmentInputSchema.parse({
    reimbursementId: "11111111-1111-4111-8111-111111111111",
    snapshotId: "22222222-2222-4222-8222-222222222222",
    expectedSourceDigest: "a".repeat(64),
  });
  assert.equal(parsed.expectedSourceDigest.length, 64);
  assert.throws(() => reevaluateClaimPayrollTreatmentInputSchema.parse({ ...parsed, expectedSourceDigest: "stale" }));
});

test("a claim awaiting payroll treatment does not block salary payroll", () => {
  const membership = {
    id: "11111111-1111-4111-8111-111111111111",
    employeeCode: "EMP-001",
    fullName: "Oscar Yong",
  };
  const readiness = summarizePayrollReadiness({
    businessId: "22222222-2222-4222-8222-222222222222",
    month: "2026-08",
    runId: "33333333-3333-4333-8333-333333333333",
    memberships: [membership],
    issues: [createPayrollReadinessIssue({
      code: "CLAIM_STATUTORY_TREATMENT_NOT_READY",
      severity: "REVIEW",
      membershipId: membership.id,
      employeeCode: membership.employeeCode,
      employeeName: membership.fullName,
      message: "This reimbursement is on hold.",
    })],
  });

  assert.equal(readiness.status, "REVIEW_REQUIRED");
  assert.equal(readiness.blockedCount, 0);
  assert.equal(readiness.canProceed, true);
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
  ], { epfEmployeeCents: 33_000, socsoEmployeeCents: 1_500, eisEmployeeCents: 500, lindung24EmployeeCents: 0, pcbCents: 4_000, cp38Cents: 0 }, 12_345);
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
