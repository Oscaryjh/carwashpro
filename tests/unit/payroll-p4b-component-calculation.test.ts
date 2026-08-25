import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildSystemPayrollEntryComponents,
  calculatePayrollComponentAggregates,
  parsePayrollComponentAmount,
  PAYROLL_COMPONENT_RECONCILIATION_FAILED,
  reconcilePayrollEntryComponents,
  type PayrollComponentLine,
} from "../../src/lib/payroll/component-calculation";
import {
  assertSupportedPayrollProration,
  MID_PERIOD_PRORATION_NOT_READY,
} from "../../src/lib/payroll/calculation";

test("P4B materialises deterministic salary and recurring component lines", () => {
  const first = buildSystemPayrollEntryComponents(frozenInput());
  const second = buildSystemPayrollEntryComponents(frozenInput());

  assert.deepEqual(first, second);
  assert.deepEqual(first.map((line) => line.code), [
    "BASIC_SALARY",
    "LEAVE_PAY",
    "OVERTIME_PAY",
    "PUBLIC_HOLIDAY_PAY",
    "STAFF_LOAN",
    "TRANSPORT_ALLOWANCE",
  ]);
  assert.equal(first[0]?.sourceType, "BASIC_SALARY");
  assert.equal(first[0]?.sourceVersionId, "10000000-0000-4000-8000-000000000001");
  assert.equal(first.at(-1)?.sourceRevision, 2);
  assert.equal(first.at(-1)?.effectiveFromMonth?.toISOString(), "2026-08-01T00:00:00.000Z");
});

test("P4B aggregates lines with integer cents and keeps statutory snapshots separate", () => {
  const lines = [
    ...buildSystemPayrollEntryComponents(frozenInput()),
    manual("EARNING", 30, "MANUAL:EARNING"),
    manual("DEDUCTION", 20, "MANUAL:DEDUCTION"),
  ];
  const totals = calculatePayrollComponentAggregates(lines, {
    epfEmployeeCents: 100,
    socsoEmployeeCents: 20,
    eisEmployeeCents: 10,
    lindung24EmployeeCents: 0,
    pcbCents: 50,
    cp38Cents: 0,
  });

  assert.deepEqual(totals, {
    grossPayCents: 40105,
    nonStatutoryDeductionsCents: 10025,
    allowancesCents: 30045,
    recurringAllowancesCents: 30015,
    recurringDeductionsCents: 10005,
    netPayCents: 29900,
  });
  assert.equal(parsePayrollComponentAmount("0.10") + parsePayrollComponentAmount("0.20"), 30);
});

test("P4B reconciliation fails closed on any aggregate mismatch", () => {
  const lines = buildSystemPayrollEntryComponents(frozenInput());
  const statutory = {
    epfEmployeeCents: 0,
    socsoEmployeeCents: 0,
    eisEmployeeCents: 0,
    lindung24EmployeeCents: 0,
    pcbCents: 0,
    cp38Cents: 0,
  };
  const stored = calculatePayrollComponentAggregates(lines, statutory);
  assert.deepEqual(reconcilePayrollEntryComponents(lines, statutory, stored), stored);
  assert.throws(
    () => reconcilePayrollEntryComponents(lines, statutory, { ...stored, grossPayCents: stored.grossPayCents + 1 }),
    new RegExp(PAYROLL_COMPONENT_RECONCILIATION_FAILED),
  );

  assert.deepEqual(calculatePayrollComponentAggregates([], statutory), {
    grossPayCents: 0,
    nonStatutoryDeductionsCents: 0,
    allowancesCents: 0,
    recurringAllowancesCents: 0,
    recurringDeductionsCents: 0,
    netPayCents: 0,
  });
});

test("manual adjustment validation requires a positive precise amount", () => {
  assert.equal(parsePayrollComponentAmount("123.45"), 12345);
  assert.throws(() => parsePayrollComponentAmount("0.00"), /greater than zero/);
  assert.throws(() => parsePayrollComponentAmount("1.001"), /valid positive RM amount/);
});

test("P4B fails clearly instead of approximating Monthly mid-period proration", () => {
  const common = {
    payBasis: "MONTHLY" as const,
    periodStart: new Date("2026-08-01T00:00:00.000Z"),
    periodEnd: new Date("2026-09-01T00:00:00.000Z"),
    terminatedAt: null,
  };
  assert.doesNotThrow(() =>
    assertSupportedPayrollProration({
      ...common,
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
  );
  assert.throws(
    () =>
      assertSupportedPayrollProration({
        ...common,
        joinedAt: new Date("2026-08-15T00:00:00.000Z"),
      }),
    new RegExp(MID_PERIOD_PRORATION_NOT_READY),
  );
});

test("P4B migration is additive, tenant-scoped, immutable and reconciled", () => {
  const sql = readFileSync(
    "prisma/migrations/20260808150000_payroll_p4b_component_calculation_foundation/migration.sql",
    "utf8",
  );
  assert.match(sql, /CREATE TABLE "payroll_entry_components"/);
  assert.match(sql, /FOREIGN KEY \("payroll_entry_id", "business_id", "membership_id"\)/);
  assert.match(sql, /PAYROLL_COMPONENT_RECONCILIATION_FAILED/);
  assert.match(sql, /Payroll component lines outside Draft are immutable/);
  assert.match(sql, /Manual payroll adjustment identity and provenance are immutable/);
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(sql, /BEFORE TRUNCATE/);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)/i);
  assert.doesNotMatch(sql, /UPDATE\s+"payroll_entries"/i);
});

test("normal P4B UI flow no longer posts editable aggregate earnings or deductions", () => {
  const actions = readFileSync("src/app/(business)/team/payroll/actions.ts", "utf8");
  const page = readFileSync(
    "src/app/(business)/team/payroll/runs/[runId]/entries/[entryId]/page.tsx",
    "utf8",
  );
  assert.doesNotMatch(actions, /allowances:\s*formData|get\("otherDeductions"\)/);
  assert.doesNotMatch(page, /name="allowances"|name="otherDeductions"/);
  assert.match(page, /type="EARNING"/);
  assert.match(page, /type="DEDUCTION"/);
  assert.match(actions, /requirePayrollComponentEdit/);
  assert.match(actions, /VIEW_COMPENSATION/);
});

function frozenInput() {
  return {
    compensation: {
      versionId: "10000000-0000-4000-8000-000000000001",
      effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
      payBasis: "MONTHLY" as const,
    },
    amounts: {
      basicPayCents: 10000,
      leavePayCents: 10,
      overtimePayCents: 20,
      publicHolidayPayCents: 30,
    },
    recurring: [
      {
        componentId: "20000000-0000-4000-8000-000000000001",
        versionId: "30000000-0000-4000-8000-000000000001",
        revision: 1,
        type: "DEDUCTION" as const,
        code: "STAFF_LOAN",
        name: "Staff Loan",
        amountCents: 10005,
        effectiveFromMonth: new Date("2026-07-01T00:00:00.000Z"),
      },
      {
        componentId: "20000000-0000-4000-8000-000000000002",
        versionId: "30000000-0000-4000-8000-000000000002",
        revision: 2,
        type: "EARNING" as const,
        code: "TRANSPORT_ALLOWANCE",
        name: "Transport Allowance",
        amountCents: 30015,
        effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
      },
    ],
  };
}

function manual(
  type: "EARNING" | "DEDUCTION",
  amountCents: number,
  lineKey: string,
): PayrollComponentLine {
  return {
    lineKey,
    type,
    code: "MANUAL_ADJUSTMENT",
    name: "Manual correction",
    amountCents,
    currency: "MYR",
    sourceType: "MANUAL_ADJUSTMENT",
    sourceId: null,
    sourceVersionId: null,
    sourceRevision: null,
    effectiveFromMonth: null,
    calculationBasis: "MANUAL_FIXED_AMOUNT",
    origin: "MANUAL",
    reason: "Approved correction",
    sortOrder: 9000,
  };
}
