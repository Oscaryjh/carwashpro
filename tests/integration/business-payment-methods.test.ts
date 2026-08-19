import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
after(async () => prisma.$disconnect());

test("custom payment method snapshots are tenant-bound while canonical reporting stays stable", async () => {
  assertLocalDatabase();
  const token = randomUUID().slice(0, 8);
  const [salon, auto] = await Promise.all([
    prisma.business.create({ data: { name: `Payment Salon ${token}`, slug: `payment-salon-${token}`, industryType: "SALON_BEAUTY" } }),
    prisma.business.create({ data: { name: `Payment Auto ${token}`, slug: `payment-auto-${token}`, industryType: "AUTO_DETAILING" } }),
  ]);
  const method = await prisma.businessPaymentMethod.create({
    data: {
      businessId: salon.id,
      code: `CUSTOM_TNG_${token}`,
      label: "Touch & Go",
      normalizedLabel: "touch & go",
      canonicalMethod: "EWALLET",
      sortOrder: 60,
    },
  });
  const [salonInvoice, autoInvoice] = await Promise.all([
    prisma.invoice.create({ data: { businessId: salon.id, invoiceNumber: `PAY-S-${token}`, subtotal: 10, total: 10, paidAmount: 10, balance: 0, status: "PAID" } }),
    prisma.invoice.create({ data: { businessId: auto.id, invoiceNumber: `PAY-A-${token}`, subtotal: 10, total: 10, paidAmount: 10, balance: 0, status: "PAID" } }),
  ]);

  const payment = await prisma.payment.create({
    data: {
      businessId: salon.id,
      invoiceId: salonInvoice.id,
      amount: 10,
      method: "EWALLET",
      businessPaymentMethodId: method.id,
      paymentMethodLabel: method.label,
    },
  });
  assert.equal(payment.method, "EWALLET");
  assert.equal(payment.paymentMethodLabel, "Touch & Go");

  await assert.rejects(
    prisma.payment.create({
      data: {
        businessId: auto.id,
        invoiceId: autoInvoice.id,
        amount: 10,
        method: "EWALLET",
        businessPaymentMethodId: method.id,
        paymentMethodLabel: method.label,
      },
    }),
    /Foreign key constraint violated/,
  );
});

function assertLocalDatabase() {
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(host), "Payment method integration requires Local database.");
}
