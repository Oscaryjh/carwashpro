import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Prisma, type PayrollCorrection, type PayrollVariablePay } from "@prisma/client";
import { buildP4CComponentLines } from "../../src/lib/payroll/variable-pay";

test("P4C materialises frozen variable and correction sources deterministically", () => {
  const variable = variableSource({
    id: "00000000-0000-0000-0000-000000000002",
    type: "COMMISSION",
    code: "COMMISSION",
    amount: new Prisma.Decimal("1234.56"),
    revision: 4,
  });
  const recovery = correctionSource({
    id: "00000000-0000-0000-0000-000000000001",
    deltaType: "DEDUCTION",
    deltaAmount: new Prisma.Decimal("200.00"),
    code: "PAYROLL_RECOVERY",
    revision: 3,
  });
  const first = buildP4CComponentLines({ variablePay: [variable], corrections: [recovery] });
  const second = buildP4CComponentLines({ variablePay: [variable], corrections: [recovery] });
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((line) => [line.type, line.code, line.amountCents, line.sourceType]), [
    ["EARNING", "COMMISSION", 123456, "VARIABLE_PAY"],
    ["DEDUCTION", "PAYROLL_RECOVERY", 20000, "CORRECTION"],
  ]);
  assert.equal(first[0]?.sourceRevision, 4);
  assert.equal(first[1]?.amountCents, 20000);
});

test("P4C applied lifecycle revision does not alter the frozen source revision", () => {
  const applied = variableSource({ status: "APPLIED", revision: 7 });
  const [line] = buildP4CComponentLines({ variablePay: [applied], corrections: [] });
  assert.equal(line?.sourceRevision, 6);
  assert.equal(line?.lineKey, `VARIABLE:${applied.id.toUpperCase()}`);
});

test("P4C migration is additive and protects approval, tenant and delta invariants", async () => {
  const migration = await source("prisma/migrations/20260808180000_payroll_p4c_variable_pay_correction_foundation/migration.sql");
  assert.match(migration, /CREATE TABLE "payroll_variable_pay"/);
  assert.match(migration, /CREATE TABLE "payroll_corrections"/);
  assert.match(migration, /corrected_amount.*original_amount[\s\S]*delta_type.*EARNING/);
  assert.match(migration, /approved_by_id" = NEW\."created_by_id"/);
  assert.match(migration, /payroll_variable_pay_source_reference_key/);
  assert.match(migration, /Variable Pay line must match its approved frozen source/);
  assert.match(migration, /Correction line must match its approved delta source/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE TABLE|UPDATE "payroll_entries"/i);
});

test("P4C payroll generation does not read live POS sales or appointments", async () => {
  const [service, variablePay] = await Promise.all([
    source("src/lib/payroll/service.ts"),
    source("src/lib/payroll/variable-pay.ts"),
  ]);
  const combined = `${service}\n${variablePay}`;
  assert.match(combined, /resolveP4CSourcesForPayroll/);
  assert.match(combined, /status: "APPROVED"/);
  assert.doesNotMatch(combined, /workOrder\.|invoice\.|appointment\.|serviceStaffAssignment\.|product sale/i);
});

test("P4C UI does not expose direct aggregate editing and requires source lifecycle", async () => {
  const [page, actions] = await Promise.all([
    source("src/app/(business)/team/payroll/runs/[runId]/entries/[entryId]/page.tsx"),
    source("src/app/(business)/team/payroll/actions.ts"),
  ]);
  assert.match(page, /Create variable pay draft/);
  assert.match(page, /Create correction draft/);
  assert.match(page, /Approve source/);
  assert.match(actions, /requireWholeBusinessPayroll\("APPROVE_PAYROLL"\)/);
  assert.match(actions, /VIEW_COMPENSATION/);
  assert.doesNotMatch(page, /name="grossPay"|name="netPay"|name="allowances"|name="otherDeductions"/);
});

function variableSource(overrides: Partial<PayrollVariablePay> = {}): PayrollVariablePay {
  const now = new Date("2026-08-01T00:00:00.000Z");
  return {
    id: "00000000-0000-0000-0000-000000000010",
    businessId: "00000000-0000-0000-0000-000000000020",
    membershipId: "00000000-0000-0000-0000-000000000030",
    type: "BONUS",
    code: "BONUS",
    name: "Approved bonus",
    amount: new Prisma.Decimal("10.25"),
    currency: "MYR",
    earnedPeriodStart: now,
    earnedPeriodEnd: now,
    payrollPeriodStart: now,
    origin: "MANUAL",
    sourceReference: "BONUS-AUG",
    reason: "Approved variable pay source.",
    status: "APPROVED",
    revision: 1,
    createdById: "00000000-0000-0000-0000-000000000040",
    approvedById: "00000000-0000-0000-0000-000000000041",
    approvedAt: now,
    cancelledById: null,
    cancelledAt: null,
    cancellationReason: null,
    appliedPayrollEntryId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function correctionSource(overrides: Partial<PayrollCorrection> = {}): PayrollCorrection {
  const now = new Date("2026-08-01T00:00:00.000Z");
  return {
    id: "00000000-0000-0000-0000-000000000050",
    businessId: "00000000-0000-0000-0000-000000000020",
    membershipId: "00000000-0000-0000-0000-000000000030",
    originalPayrollEntryId: "00000000-0000-0000-0000-000000000060",
    appliedPayrollEntryId: null,
    applyToPeriodStart: now,
    originalAmount: new Prisma.Decimal("500.00"),
    correctedAmount: new Prisma.Decimal("300.00"),
    deltaType: "DEDUCTION",
    deltaAmount: new Prisma.Decimal("200.00"),
    code: "PAYROLL_RECOVERY",
    name: "Payroll recovery",
    sourceReference: "CORR-AUG",
    reason: "Approved future correction delta.",
    status: "APPROVED",
    revision: 1,
    createdById: "00000000-0000-0000-0000-000000000040",
    approvedById: "00000000-0000-0000-0000-000000000041",
    approvedAt: now,
    cancelledById: null,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function source(relative: string) {
  return readFile(new URL(`../../${relative}`, import.meta.url), "utf8");
}
