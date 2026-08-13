import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { DATABASE_URL } from "./embedded-postgres-utils.mjs";

const configuredUrl = process.env.DATABASE_URL ?? DATABASE_URL;
const hostname = new URL(configuredUrl).hostname.toLowerCase();
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(hostname),
  "Commission browser verification is restricted to the Local database.",
);
process.env.DATABASE_URL = configuredUrl;

const prisma = new PrismaClient();
try {
  const business = await prisma.business.findUniqueOrThrow({
    where: { slug: "qa-commission-browser-salon" },
  });
  const statement = await prisma.commissionStatement.findFirstOrThrow({
    where: {
      businessId: business.id,
      membership: { employeeCode: "COMMISSION-BROWSER-A" },
      period: {
        earnedPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
        earnedPeriodEnd: new Date("2026-08-31T00:00:00.000Z"),
      },
    },
    include: { payrollVariablePay: true },
    orderBy: { calculationRevision: "desc" },
  });
  assert.equal(statement.eligibleSalesCents, 8_000);
  assert.equal(statement.calculatedCommissionCents, 800);
  assert.equal(statement.finalCommissionCents, 800);
  assert.equal(statement.status, "APPLIED_TO_PAYROLL");
  assert.equal(statement.payrollVariablePay?.amount.toFixed(2), "8.00");
  assert.equal(
    statement.payrollVariablePay?.payrollPeriodStart.toISOString().slice(0, 7),
    "2026-09",
  );

  const adjustment = await prisma.commissionAdjustment.findFirstOrThrow({
    where: {
      businessId: business.id,
      type: "REFUND",
      statementId: statement.id,
    },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(adjustment.eligibleAmountCents, -4_000);
  assert.equal(adjustment.commissionAmountCents, -400);
  assert.equal(adjustment.payrollStatus, "FUTURE_PAYROLL_REQUIRED");
  assert.equal(adjustment.appliedToStatementId, null);

  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    statement: {
      eligibleSalesCents: statement.eligibleSalesCents,
      calculatedCommissionCents: statement.calculatedCommissionCents,
      finalCommissionCents: statement.finalCommissionCents,
      status: statement.status,
      payrollAmount: statement.payrollVariablePay?.amount.toFixed(2),
      payrollMonth: statement.payrollVariablePay?.payrollPeriodStart.toISOString().slice(0, 7),
    },
    refundAdjustment: {
      eligibleAmountCents: adjustment.eligibleAmountCents,
      commissionAmountCents: adjustment.commissionAmountCents,
      payrollStatus: adjustment.payrollStatus,
    },
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
