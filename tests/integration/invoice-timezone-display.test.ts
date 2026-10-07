import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { formatInvoiceDate, formatInvoiceTime } from "../../src/lib/invoices/display-time";

test("persisted invoice/appointment instants and financial fields are unchanged by business-zone display", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/tetamu_pcb_verification_vc1_disposable_\d+_\d+$/);
  const prisma = new PrismaClient();
  const rollback = new Error("ROLLBACK_DISPLAY_FIXTURE");
  try {
    await assert.rejects(prisma.$transaction(async tx => {
      const business = await tx.business.create({ data: { name: "Invoice timezone test", slug: randomUUID(), timezone: "Asia/Kuching" } });
      const customer = await tx.customer.create({ data: { businessId: business.id, name: "Fixture", phone: "00000001" } });
      const appointment = await tx.appointment.create({ data: { businessId: business.id, customerId: customer.id, scheduledAt: new Date("2026-10-09T03:00:00Z") } });
      const invoice = await tx.invoice.create({ data: { businessId: business.id, customerId: customer.id, appointmentId: appointment.id, invoiceNumber: "DISPLAY", issuedAt: new Date("2026-10-07T16:30:00Z"), subtotal: 2, total: 2, paidAmount: 2, balance: 0, status: "PAID" } });
      const before = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { appointment: true, business: true } });
      const serialized = JSON.stringify(before);
      assert.equal(formatInvoiceDate(before.issuedAt, before.business.timezone), "08/10/2026");
      assert.equal(formatInvoiceTime(before.appointment!.scheduledAt, before.business.timezone, { hour: "2-digit", minute: "2-digit" }), "11:00 am");
      assert.equal(before.issuedAt.toISOString(), "2026-10-07T16:30:00.000Z");
      assert.equal(before.appointment!.scheduledAt.toISOString(), "2026-10-09T03:00:00.000Z");
      assert.equal(JSON.stringify(before), serialized);
      const after = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { appointment: true, business: true } });
      assert.equal(JSON.stringify(after), serialized);
      throw rollback;
    }), error => error === rollback);
  } finally { await prisma.$disconnect(); }
});
