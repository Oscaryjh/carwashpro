import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { refundWalletSale } from "../../src/lib/wallet/refunds";
import { readPerformanceLedger } from "../../src/lib/performance/read";
import { capturePerformancePayment } from "../../src/lib/performance/service";
import { slicePerformance } from "../../src/lib/performance/dashboard";
const db = walletTestDatabase();
after(() => db.$disconnect());
process.env.TETAMU_PERFORMANCE_PHASE1 = "true";

test("Wallet and Card retain tax, tip and two-staff attribution through cumulative partial refunds", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db, "CARD"); await h.login(db, f);
    await db.business.update({ where: { id: f.business.id }, data: { sstEnabled: true, sstRate: 8 } });
    await db.product.update({ where: { id: f.product.id }, data: { taxable: true } });
    const members: Array<{ id: string }> = [];
    for (let index = 0; index < 2; index++) {
      const phone = `+60${Date.now().toString().slice(-10)}${index}`;
      const employee = await db.employeeAccount.create({ data: { name: `P1F member ${index}`, phoneNumber: phone, phoneNormalized: phone } });
      const member = await db.employeeBusinessMembership.create({ data: { businessId: f.business.id, employeeAccountId: employee.id,
        employeeCode: `P1F-${index}`, fullName: employee.name, phoneNumber: phone, phoneNumberNormalized: phone, joinedAt: new Date("2020-01-01Z") } });
      await db.employeeBranchAssignment.create({ data: { businessId: f.business.id, branchId: f.branch.id, membershipId: member.id,
        isPrimary: true, canClockIn: false, effectiveFrom: new Date("2020-01-01Z") } });
      members.push(member);
    }
    f.form.set("performanceTipAmount", "2");
    f.form.set("performanceAttribution", JSON.stringify({ version: 1,
      sales: members.map(member => ({ membershipId: member.id, basisPoints: 5000 })), tipMembershipId: members[0].id }));
    const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: sale.invoice!.id } });
    assert.equal(invoice.total.toFixed(2), "45.20"); assert.equal(invoice.taxAmount.toFixed(2), "3.20");
    const receipts = await db.performanceReceipt.findMany({ where: { invoiceId: invoice.id } });
    assert.equal(receipts.reduce((n, row) => n + Number(row.salesCents), 0), 4000);
    assert.equal(receipts.reduce((n, row) => n + Number(row.taxCents), 0), 320);
    assert.equal(receipts.reduce((n, row) => n + Number(row.tipCents), 0), 200);
    const read = () => readPerformanceLedger({ businessId: f.business.id, branchId: f.branch.id, actorUserId: f.actor.id },
      { year: Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Kuching", year: "numeric" }).format(new Date())), asOf: new Date() }, db);
    const sold = await read(); assert.equal(sold.team.total, 4200);
    const allocations = sold.details.flatMap(row => row.allocations);
    assert.equal(allocations.filter(row => row.membershipId === members[0].id).reduce((n, row) => n + row.total, 0), 2200);
    assert.equal(allocations.filter(row => row.membershipId === members[1].id).reduce((n, row) => n + row.total, 0), 2000);
    const payments = await db.payment.findMany({ where: { invoiceId: invoice.id } });
    for (const payment of payments) for (const amountCents of [1, Number(payment.amount) * 100 - 1]) {
      const request = { operationKey: randomUUID(), invoiceId: invoice.id, reason: "P1F staff cumulative rounding", stockLines: [],
        legs: [{ paymentId: payment.id, method: payment.method as "CARD" | "MEMBER_WALLET", amountCents, reference: "synthetic" }] };
      const result = await refundWalletSale(f.ctx, request, db);
      assert.deepEqual(await refundWalletSale(f.ctx, request, db), result);
    }
    const refunded = await read(); assert.equal(refunded.team.total, 0);
    for (const member of members) {
      assert.equal(refunded.details.flatMap(row => row.allocations).filter(row => row.membershipId === member.id)
        .reduce((n, row) => n + row.total, 0), 0, "each employee's original credits plus refund entries must net to zero");
    }
    assert.equal(refunded.coverageStatus, "COMPLETE");
  } finally { await h.close(); }
});

for (const method of ["MEMBER_WALLET", "CARD"]) test(`Wallet ${method} performance excludes top-up and refunds the original sale once`, async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db, method); await h.login(db, f);
    const context = { businessId: f.business.id, branchId: f.branch.id, actorUserId: f.actor.id };
    const read = () => readPerformanceLedger(context, { year: Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Kuching", year: "numeric" }).format(new Date())), asOf: new Date() }, db);
    const before = await read();
    assert.equal(before.team.total, 0); assert.equal(before.coverageStatus, "COMPLETE");
    const topPayment = await db.payment.findFirstOrThrow({ where: { businessId: f.business.id, purpose: "WALLET_TOP_UP" } });
    await db.$transaction(tx => capturePerformancePayment(tx, topPayment.id, { ...context, input: null }));
    assert.equal(await db.performanceReceipt.count({ where: { paymentId: topPayment.id } }), 0);
    const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
    const sold = await read(); assert.equal(sold.team.total, 4000); assert.equal(sold.coverageStatus, "COMPLETE");
    const payments = await db.payment.findMany({ where: { invoiceId: sale.invoice!.id } });
    await refundWalletSale(f.ctx, { operationKey: randomUUID(), invoiceId: sale.invoice!.id,
      reason: "P1F performance full refund", stockLines: [], legs: payments.map(p => ({ paymentId: p.id, amountCents: Number(p.amount) * 100, method: p.method as "CARD" | "MEMBER_WALLET", reference: "synthetic" })) }, db);
    const refunded = await read(); assert.equal(refunded.team.total, 0); assert.equal(refunded.team.salesRefunds, 4000);
    assert.equal(refunded.coverageStatus, "COMPLETE");
  } finally { await h.close(); }
});

test("fully evidenced Wallet invoice void is excluded, not pending performance", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db); await h.login(db, f);
    const service = await db.service.create({ data: { businessId: f.business.id, name: "P1F service", price: 40, taxable: false } });
    const visit = await db.appointment.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id,
      assignedStaffId: f.actor.id, serviceId: service.id, serviceIds: [service.id], scheduledAt: new Date(), status: "COMPLETED" } });
    f.form.delete("productId"); f.form.delete("productQuantity");
    for (const [key, value] of Object.entries({ serviceId: service.id, serviceQuantity: "1", appointmentId: visit.id, assignedStaffId: f.actor.id })) f.form.set(key, value);
    const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
    const form = new FormData(); form.set("invoiceId", sale.invoice!.id); form.set("operationId", randomUUID()); form.set("voidReason", "P1F void evidence");
    const result = await h.invoices.voidInvoiceAction({ status: "idle", message: "" }, form); assert.equal(result.status, "success", result.message);
    const report = await readPerformanceLedger({ businessId: f.business.id, branchId: f.branch.id, actorUserId: f.actor.id }, { year: Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Kuching", year: "numeric" }).format(new Date())), asOf: new Date() }, db);
    assert.equal(report.team.total, 0); assert.equal(report.pending.total, 0);
    assert.equal(report.coverageStatus, "COMPLETE");
    assert.equal(slicePerformance(report, report.period.from, report.period.toExclusive, new Date()).pendingCount, 0);
    const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: sale.invoice!.id } });
    assert.equal(report.sourceDetails.find(row => row.paymentId === payment.id)?.classification, "EXCLUDED_WALLET_VOID");
    // Simulate unavailable reversal evidence at the read boundary; do not mutate
    // the immutable source ledger or pretend an undocumented void is reconciled.
    const missingEvidenceDb = db.$extends({ query: { walletTransaction: { async findMany({ args, query }) {
      const rows = await query(args);
      return rows.map(row => "related" in row ? { ...row, related: [] } : row);
    } } } });
    const incomplete = await readPerformanceLedger({ businessId: f.business.id, branchId: f.branch.id, actorUserId: f.actor.id },
      { year: Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Kuching", year: "numeric" }).format(new Date())), asOf: new Date() }, missingEvidenceDb as never);
    assert.equal(incomplete.team.total, 0);
    assert.equal(incomplete.pending.total, 4000);
    assert.notEqual(incomplete.sourceDetails.find(row => row.paymentId === payment.id)?.classification, "EXCLUDED_WALLET_VOID");
  } finally { await h.close(); }
});
