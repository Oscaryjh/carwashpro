import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  compareDailyStoreSummary,
  compareDailyStoreSummaryRange,
  refreshDailyStoreSummaries,
  refreshLateAnalyticsEvents,
} from "../../src/lib/analytics/daily-store-summary";
import { DAILY_CLOSING_PAYMENT_METHODS } from "../../src/lib/daily-closing/types";

const prisma = new PrismaClient();

test("daily analytics refresh is idempotent and repairs late voids", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const business = await prisma.business.create({
    data: {
      name: `Analytics Store ${suffix}`,
      slug: `analytics-store-${suffix}`,
      timezone: "UTC",
      businessDayCutoffTime: "00:00",
    },
  });
  const runIds: string[] = [];

  try {
    const invoice = await prisma.invoice.create({
      data: {
        businessId: business.id,
        invoiceNumber: `AN-${suffix}`,
        subtotal: "100.00",
        discountAmount: "10.00",
        loyaltyDiscountAmount: "0",
        tipAmount: "10.00",
        total: "100.00",
        paidAmount: "80.00",
        balance: "20.00",
        status: "PARTIAL",
        issuedAt: new Date("2026-07-01T12:00:00.000Z"),
      },
    });
    await prisma.payment.create({
      data: {
        businessId: business.id,
        invoiceId: invoice.id,
        amount: "20.00",
        method: "PACKAGE",
        paidAt: new Date("2026-07-01T12:00:00.000Z"),
      },
    });
    const cash = await prisma.payment.create({
      data: {
        businessId: business.id,
        invoiceId: invoice.id,
        amount: "80.00",
        method: "CASH",
        paidAt: new Date("2026-07-01T12:05:00.000Z"),
      },
    });
    await prisma.paymentRefund.create({
      data: {
        businessId: business.id,
        paymentId: cash.id,
        invoiceId: invoice.id,
        amount: "5.00",
        method: "CASH",
        reason: "Analytics test",
        refundedAt: new Date("2026-07-01T13:00:00.000Z"),
      },
    });

    const first = await refreshDailyStoreSummaries(
      {
        businessIds: [business.id],
        fromDate: "2026-07-01",
        toDate: "2026-07-01",
        trigger: "BACKFILL",
      },
      prisma,
    );
    runIds.push(first.runId);
    const second = await refreshDailyStoreSummaries(
      {
        businessIds: [business.id],
        fromDate: "2026-07-01",
        toDate: "2026-07-01",
        trigger: "BACKFILL",
      },
      prisma,
    );
    runIds.push(second.runId);

    assert.equal(first.summaryCount, 1);
    assert.equal(second.summaryCount, 1);
    assert.equal(
      await prisma.analyticsDailyStoreSummary.count({
        where: { businessId: business.id },
      }),
      1,
    );
    assert.equal(
      await prisma.analyticsDailyPaymentMethodSummary.count({
        where: { businessId: business.id },
      }),
      DAILY_CLOSING_PAYMENT_METHODS.length,
    );

    const stored = await prisma.analyticsDailyStoreSummary.findFirstOrThrow({
      where: { businessId: business.id },
    });
    assert.equal(stored.grossSalesCents, 8_000);
    assert.equal(stored.netSalesCents, 6_500);
    assert.equal(stored.grossCollectionsCents, 8_000);
    assert.equal(stored.netCollectionsCents, 7_500);
    assert.equal(
      (
        await compareDailyStoreSummary(
          { businessId: business.id, businessDate: "2026-07-01" },
          prisma,
        )
      ).status,
      "MATCHED",
    );
    const rangeComparison = await compareDailyStoreSummaryRange(
      {
        businessIds: [business.id],
        fromDate: "2026-07-01",
        toDate: "2026-07-01",
      },
      prisma,
    );
    assert.equal(rangeComparison.status, "MATCHED");
    assert.equal(rangeComparison.comparisonCount, 1);
    assert.equal(rangeComparison.matchedCount, 1);
    assert.deepEqual(rangeComparison.issues, []);

    const beforeVoid = new Date();
    await prisma.payment.update({
      where: { id: cash.id },
      data: {
        status: "VOID",
        voidedAt: new Date(),
        voidReason: "Analytics late-event test",
      },
    });
    assert.equal(
      (
        await compareDailyStoreSummary(
          { businessId: business.id, businessDate: "2026-07-01" },
          prisma,
        )
      ).status,
      "MISMATCH",
    );

    const lateRuns = await refreshLateAnalyticsEvents(
      beforeVoid,
      prisma,
      { businessIds: [business.id] },
    );
    runIds.push(...lateRuns.map((run) => run.runId));
    const repaired = await prisma.analyticsDailyStoreSummary.findFirstOrThrow({
      where: { businessId: business.id },
    });
    assert.equal(repaired.grossCollectionsCents, 0);
    assert.equal(repaired.netCollectionsCents, -500);
    assert.equal(
      (
        await compareDailyStoreSummary(
          { businessId: business.id, businessDate: "2026-07-01" },
          prisma,
        )
      ).status,
      "MATCHED",
    );
  } finally {
    await prisma.analyticsDailyStoreSummary.deleteMany({
      where: { businessId: business.id },
    });
    await prisma.analyticsRefreshRun.deleteMany({
      where: { id: { in: runIds } },
    });
    await prisma.paymentRefund.deleteMany({
      where: { businessId: business.id },
    });
    await prisma.payment.deleteMany({ where: { businessId: business.id } });
    await prisma.invoice.deleteMany({ where: { businessId: business.id } });
    await prisma.business.delete({ where: { id: business.id } });
  }
});

test.after(async () => {
  await prisma.$disconnect();
});

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  assert.match(databaseUrl, /(?:localhost|127\.0\.0\.1)/);
}
