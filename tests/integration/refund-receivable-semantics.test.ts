import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { reconcileInvoiceSettlementAfterRefund } from "../../src/lib/invoices/refund-settlement-service";
import { getRefundableCents } from "../../src/lib/refunds/rules";

const prisma = new PrismaClient();

after(async () => {
  await prisma.$disconnect();
});

test("refund reconciliation keeps settled obligation separate from merchant refunds", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const business = await prisma.business.create({
    data: {
      name: `Refund settlement ${suffix}`,
      slug: `refund-settlement-${suffix}`,
    },
  });

  try {
    const paidInvoice = await prisma.invoice.create({
      data: {
        balance: 0,
        businessId: business.id,
        invoiceNumber: `REF-PAID-${suffix}`,
        paidAmount: 135,
        status: "PAID",
        subtotal: 135,
        total: 135,
      },
    });
    const paidPayment = await prisma.payment.create({
      data: {
        amount: 135,
        businessId: business.id,
        invoiceId: paidInvoice.id,
        method: "CASH",
      },
    });
    await prisma.paymentRefund.create({
      data: {
        amount: 35,
        businessId: business.id,
        invoiceId: paidInvoice.id,
        method: "CASH",
        paymentId: paidPayment.id,
        reason: "Partial merchant refund",
      },
    });

    const partialRefundSettlement = await prisma.$transaction((tx) =>
      reconcileInvoiceSettlementAfterRefund(tx, {
        businessId: business.id,
        invoiceId: paidInvoice.id,
        totalCents: 13_500,
      }),
    );
    const afterPartialRefund = await prisma.invoice.findUniqueOrThrow({
      where: { id: paidInvoice.id },
    });

    assert.equal(partialRefundSettlement.refundLifecycle, "PARTIAL");
    assert.equal(partialRefundSettlement.refundedCents, 3_500);
    assert.equal(afterPartialRefund.status, "PAID");
    assert.equal(Number(afterPartialRefund.paidAmount), 135);
    assert.equal(Number(afterPartialRefund.balance), 0);

    await prisma.paymentRefund.create({
      data: {
        amount: 100,
        businessId: business.id,
        invoiceId: paidInvoice.id,
        method: "CASH",
        paymentId: paidPayment.id,
        reason: "Complete merchant refund",
      },
    });
    const fullRefundSettlement = await prisma.$transaction((tx) =>
      reconcileInvoiceSettlementAfterRefund(tx, {
        businessId: business.id,
        invoiceId: paidInvoice.id,
        totalCents: 13_500,
      }),
    );
    const afterFullRefund = await prisma.invoice.findUniqueOrThrow({
      where: { id: paidInvoice.id },
    });

    assert.equal(fullRefundSettlement.refundLifecycle, "FULL");
    assert.equal(afterFullRefund.status, "REFUNDED");
    assert.equal(Number(afterFullRefund.paidAmount), 135);
    assert.equal(Number(afterFullRefund.balance), 0);

    const partialInvoice = await prisma.invoice.create({
      data: {
        balance: 100,
        businessId: business.id,
        invoiceNumber: `REF-PARTIAL-${suffix}`,
        paidAmount: 100,
        status: "PARTIAL",
        subtotal: 200,
        total: 200,
      },
    });
    const partialPayment = await prisma.payment.create({
      data: {
        amount: 100,
        businessId: business.id,
        invoiceId: partialInvoice.id,
        method: "CARD",
      },
    });
    await prisma.paymentRefund.create({
      data: {
        amount: 30,
        businessId: business.id,
        invoiceId: partialInvoice.id,
        method: "CARD",
        paymentId: partialPayment.id,
        reason: "Partial payment refund",
      },
    });
    await prisma.$transaction((tx) =>
      reconcileInvoiceSettlementAfterRefund(tx, {
        businessId: business.id,
        invoiceId: partialInvoice.id,
        totalCents: 20_000,
      }),
    );
    const afterPartialPaymentRefund = await prisma.invoice.findUniqueOrThrow({
      where: { id: partialInvoice.id },
    });

    assert.equal(afterPartialPaymentRefund.status, "PARTIAL");
    assert.equal(Number(afterPartialPaymentRefund.paidAmount), 100);
    assert.equal(Number(afterPartialPaymentRefund.balance), 100);

    const concurrentInvoice = await prisma.invoice.create({
      data: {
        balance: 0,
        businessId: business.id,
        invoiceNumber: `REF-RACE-${suffix}`,
        paidAmount: 100,
        status: "PAID",
        subtotal: 100,
        total: 100,
      },
    });
    const concurrentPayment = await prisma.payment.create({
      data: {
        amount: 100,
        businessId: business.id,
        invoiceId: concurrentInvoice.id,
        method: "CASH",
      },
    });
    const concurrentRefund = (label: string) => prisma.$transaction(
      async (tx) => {
        const payment = await tx.payment.findUniqueOrThrow({
          where: { id: concurrentPayment.id },
          include: { refunds: { select: { amount: true } } },
        });
        const refundableCents = getRefundableCents(
          Math.round(Number(payment.amount) * 100),
          payment.refunds.map((refund) => Math.round(Number(refund.amount) * 100)),
        );
        if (8_000 > refundableCents) {
          throw new Error("Refund cannot exceed the remaining payment amount.");
        }
        await tx.paymentRefund.create({
          data: {
            amount: 80,
            businessId: business.id,
            invoiceId: concurrentInvoice.id,
            method: "CASH",
            paymentId: concurrentPayment.id,
            reason: `Concurrent refund ${label}`,
          },
        });
        await reconcileInvoiceSettlementAfterRefund(tx, {
          businessId: business.id,
          invoiceId: concurrentInvoice.id,
          totalCents: 10_000,
        });
        return { label };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    const concurrentResults = await Promise.allSettled([
      concurrentRefund("a"),
      concurrentRefund("b"),
    ]);

    assert.equal(
      concurrentResults.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      concurrentResults.filter((result) => result.status === "rejected").length,
      1,
    );
    assert.equal(
      await prisma.paymentRefund.count({
        where: { paymentId: concurrentPayment.id },
      }),
      1,
    );
  } finally {
    await prisma.paymentRefund.deleteMany({ where: { businessId: business.id } });
    await prisma.payment.deleteMany({ where: { businessId: business.id } });
    await prisma.invoice.deleteMany({ where: { businessId: business.id } });
    await prisma.business.delete({ where: { id: business.id } });
  }
});

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(
    new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(hostname),
    "Integration test requires a local database",
  );
}
