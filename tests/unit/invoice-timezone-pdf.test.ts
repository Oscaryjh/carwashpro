import assert from "node:assert/strict";
import test from "node:test";
import { buildInvoicePdf, buildInvoiceReceiptPdf, type InvoicePdfInput } from "../../src/lib/invoices/invoice-pdf";

test("invoice PDF and printed receipt use company timezone without changing the instant", () => {
  const previous = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    const input = {
      company: { name: "Test", timezone: "Asia/Kuching" },
      customer: { name: "Customer", phone: "" }, invoiceNumber: "1006",
      issuedAt: new Date("2026-10-07T16:30:00Z"), items: [],
      subtotal: 2, total: 2, paidAmount: 2, balance: 0, status: "PAID",
    } satisfies InvoicePdfInput & { company: { name: string; timezone: string } };
    for (const build of [buildInvoicePdf, buildInvoiceReceiptPdf]) {
      assert.match(build(input).toString("latin1"), /08\/10\/2026/);
      input.company.timezone = "UTC";
      assert.match(build(input).toString("latin1"), /07\/10\/2026/);
      input.company.timezone = "Asia/Kuching";
    }
    assert.equal(input.issuedAt.toISOString(), "2026-10-07T16:30:00.000Z");
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
