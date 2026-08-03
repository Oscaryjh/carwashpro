import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  payrollMonthStart,
  resolveEmployeeCompensationVersion,
} from "../../src/lib/payroll/compensation-version";

test("monthly compensation normalizes only by UTC payroll month", () => {
  assert.equal(
    payrollMonthStart(new Date("2026-11-30T23:59:59.000-08:00")).toISOString(),
    "2026-12-01T00:00:00.000Z",
  );
  assert.equal(
    payrollMonthStart(new Date("2026-08-31T23:59:59.999Z")).toISOString(),
    "2026-08-01T00:00:00.000Z",
  );
});

test("resolver selects latest active version applicable to the run month", async () => {
  let capturedWhere: Record<string, unknown> | undefined;
  const result = await resolveEmployeeCompensationVersion(
    {
      businessId: "business-1",
      membershipId: "membership-1",
      payrollPeriodStart: new Date("2026-08-27T12:00:00.000Z"),
    },
    {
      employeeCompensationVersion: {
        findFirst: async (query: { where: Record<string, unknown> }) => {
          capturedWhere = query.where;
          return {
            baseRate: { toString: () => "2500.00" },
            effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
            id: "version-august",
            payBasis: "MONTHLY",
            source: "LEGACY_BASELINE",
          };
        },
      },
    } as never,
  );

  assert.deepEqual(capturedWhere, {
    businessId: "business-1",
    effectiveFromMonth: { lte: new Date("2026-08-01T00:00:00.000Z") },
    membershipId: "membership-1",
    status: "ACTIVE",
  });
  assert.equal(result.versionId, "version-august");
  assert.equal(result.payBasis, "MONTHLY");
});

test("resolver fails closed without an applicable verified version", async () => {
  await assert.rejects(
    resolveEmployeeCompensationVersion(
      {
        businessId: "business-1",
        membershipId: "membership-1",
        payrollPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
      },
      {
        employeeCompensationVersion: { findFirst: async () => null },
      } as never,
    ),
    /No verified compensation version exists for this payroll period/,
  );
});

test("Phase 4.0C migration is additive and enforces immutable monthly versions", () => {
  const sql = readFileSync(
    "prisma/migrations/20260803100000_compensation_version_foundation/migration.sql",
    "utf8",
  );
  assert.match(sql, /effective_from_month.*date_trunc/s);
  assert.match(sql, /base_rate.*>= 0/s);
  assert.match(sql, /WHERE "status" = 'ACTIVE'/);
  assert.match(sql, /append-only and cannot be deleted/);
  assert.match(sql, /DATE '2026-08-01'/);
  assert.doesNotMatch(sql, /UPDATE "payroll_entries"/);
  assert.doesNotMatch(sql, /UPDATE "payroll_runs"/);
});

test("legacy team compensation writes are routed through canonical commands", () => {
  const employeeService = readFileSync(
    "src/lib/attendance/employee-service.ts",
    "utf8",
  );
  const teamActions = readFileSync(
    "src/app/(business)/team/actions.ts",
    "utf8",
  );
  assert.match(
    employeeService,
    /scheduleEmployeeCompensationChangeInTransaction/,
  );
  assert.match(employeeService, /updateEmployeePayrollWorkTargetInTransaction/);
  assert.doesNotMatch(
    employeeService,
    /data:\s*\{[\s\S]{0,700}?payBasis:\s*employee\.payBasis[\s\S]{0,100}?baseSalary:\s*employee\.baseSalary/,
  );
  assert.match(teamActions, /compensationAccess:\s*access/);
});
