import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  buildRecurringPayComponentCode,
  recurringPayMonthStart,
  resolveRecurringPayForEmployee,
  sumRecurringPay,
} from "../../src/lib/payroll/recurring-pay";

test("recurring pay creates a stable internal code without asking HR to enter one", () => {
  const code = buildRecurringPayComponentCode({
    commandId: "command-transport-allowance",
    name: "Transport allowance",
    type: "EARNING",
  });
  assert.match(code, /^EMP_TRANSPORT_ALLOWANCE_[A-F0-9]{10}$/);
  assert.equal(code.length <= 64, true);
  assert.equal(
    code,
    buildRecurringPayComponentCode({
      commandId: "command-transport-allowance",
      name: "Transport allowance",
      type: "EARNING",
    }),
  );

  assert.match(
    buildRecurringPayComponentCode({
      commandId: "command-chinese-name",
      name: "交通津贴",
      type: "EARNING",
    }),
    /^EMP_MONTHLY_EARNING_[A-F0-9]{10}$/,
  );
});

test("recurring pay resolver is tenant scoped, deterministic and month effective", async () => {
  let capturedQuery: Record<string, unknown> | undefined;
  const resolved = await resolveRecurringPayForEmployee(
    {
      businessId: "business-a",
      membershipId: "membership-a",
      payrollPeriodStart: new Date("2026-08-18T12:00:00.000Z"),
    },
    {
      employeeRecurringPayComponent: {
        findMany: async (query: Record<string, unknown>) => {
          capturedQuery = query;
          return [
            {
              code: "STAFF_LOAN",
              id: "component-deduction",
              membershipId: "membership-a",
              type: "DEDUCTION",
              versions: [{
                amount: new Prisma.Decimal("200.05"),
                currency: "MYR",
                effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
                id: "version-deduction",
                name: "Staff Loan",
                revision: 2,
                state: "ACTIVE",
              }],
            },
            {
              code: "TRANSPORT_ALLOWANCE",
              id: "component-earning",
              membershipId: "membership-a",
              type: "EARNING",
              versions: [{
                amount: new Prisma.Decimal("300.10"),
                currency: "MYR",
                effectiveFromMonth: new Date("2026-07-01T00:00:00.000Z"),
                id: "version-earning",
                name: "Transport Allowance",
                revision: 1,
                state: "ACTIVE",
              }],
            },
            {
              code: "ENDED_ALLOWANCE",
              id: "component-ended",
              membershipId: "membership-a",
              type: "EARNING",
              versions: [{
                amount: new Prisma.Decimal(0),
                currency: "MYR",
                effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
                id: "version-ended",
                name: "Ended Allowance",
                revision: 3,
                state: "ENDED",
              }],
            },
          ];
        },
      },
    } as never,
  );

  assert.deepEqual(
    (capturedQuery?.where as Record<string, unknown>),
    {
      businessId: "business-a",
      membershipId: { in: ["membership-a"] },
    },
  );
  assert.deepEqual(resolved.map((item) => item.code), [
    "STAFF_LOAN",
    "TRANSPORT_ALLOWANCE",
  ]);
  assert.equal(sumRecurringPay(resolved, "EARNING").toString(), "300.1");
  assert.equal(sumRecurringPay(resolved, "DEDUCTION").toString(), "200.05");
});

test("recurring pay uses UTC payroll month and Decimal aggregation", () => {
  assert.equal(
    recurringPayMonthStart(new Date("2026-08-31T23:59:59.999Z")).toISOString(),
    "2026-08-01T00:00:00.000Z",
  );
  const amount = sumRecurringPay([
    recurring("0.10"),
    recurring("0.20"),
  ], "EARNING");
  assert.equal(amount.toFixed(2), "0.30");
});

test("P4A migration is additive and guards immutable recurring pay facts", () => {
  const sql = readFileSync(
    "prisma/migrations/20260808120000_payroll_p4a_recurring_pay_foundation/migration.sql",
    "utf8",
  );
  assert.match(sql, /employee_recurring_pay_components/);
  assert.match(sql, /payroll_entry_recurring_pay_snapshots/);
  assert.match(sql, /WHERE "status" = 'CURRENT'/);
  assert.match(sql, /append-only and cannot be deleted/);
  assert.match(sql, /Only Draft Payroll recurring pay snapshots may be removed/);
  assert.match(sql, /Payroll Entries outside Draft are immutable/);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)/i);
  assert.doesNotMatch(sql, /UPDATE\s+"employee_business_memberships"/i);
  assert.doesNotMatch(sql, /UPDATE\s+"payroll_entries"/i);
});

function recurring(amount: string) {
  return {
    amount: new Prisma.Decimal(amount),
    code: `ALLOWANCE_${amount}`,
    componentId: `component-${amount}`,
    currency: "MYR" as const,
    effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
    membershipId: "membership-a",
    name: "Allowance",
    revision: 1,
    type: "EARNING" as const,
    versionId: `version-${amount}`,
  };
}
