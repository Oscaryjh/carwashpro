import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase, walletFixture } from "../helpers/wallet-fixture";
import { checkoutHarness } from "../helpers/wallet-checkout-fixture";

const db = walletTestDatabase();
after(() => db.$disconnect());

test("legacy Appointment pending purchase can finish payment without rewriting kind, and its activation source must be representable", async () => {
  const f = await walletFixture(db);
  await db.businessModuleEntitlement.create({ data: { businessId: f.business.id, moduleKey: "SALON", status: "ENABLED", source: "MANUAL", enabledFrom: new Date(0) } });
  const service = await db.service.create({ data: { businessId: f.business.id, name: "Legacy activation service", price: 2 } });
  await db.serviceStaffAssignment.create({ data: { businessId: f.business.id, serviceId: service.id, userId: f.actor.id } });
  const plan = await db.package.create({ data: { businessId: f.business.id, name: "Legacy activation package", price: 5, totalUses: 2, serviceId: service.id,
    serviceBenefits: { create: { businessId: f.business.id, serviceId: service.id, totalUses: 2 } } } });
  const secondPlan = await db.package.create({ data: { businessId: f.business.id, name: "Legacy second package", price: 5, totalUses: 2, serviceId: service.id,
    serviceBenefits: { create: { businessId: f.business.id, serviceId: service.id, totalUses: 2 } } } });
  const appointment = await db.appointment.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id,
    assignedStaffId: f.actor.id, serviceId: service.id, serviceIds: [service.id], packageIds: [plan.id, secondPlan.id], scheduledAt: new Date(), status: "COMPLETED" } });
  const h = await checkoutHarness(db);
  try {
    await h.login(db, f);
    const pay = async (amount: string) => {
      const form = new FormData();
      for (const [key, value] of Object.entries({ operationId: randomUUID(), modeAtConfirmation: "ON", shiftId: f.shift.id, method: "CASH",
        preservePaymentForm: "1", appointmentId: appointment.id, amount, discountAmount: "0", depositAmount: "0", tipAmount: "0" })) form.set(key, value);
      return h.appointments.recordSalonAppointmentPaymentAction({ status: "idle", message: "", invoiceId: null, invoice: null }, form);
    };
    const partial = await pay("1");
    assert.equal(partial.status, "success", partial.message);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: partial.invoiceId! }, include: { items: true } });
    const cp = await db.customerPackage.findFirstOrThrow({ where: { businessId: f.business.id, id: { not: invoice.customerPackageId! } }, include: { serviceBalances: true } });
    assert.equal(cp.status, "PENDING_PAYMENT");
    assert.equal(cp.remainingUses, 0);
    assert.equal(await db.customerPackageActivity.count({ where: { businessId: f.business.id } }), 0, "pending is not purchased");
    assert.notEqual(invoice.customerPackageId, cp.id);
    const item = invoice.items.find(row => row.customerPackageId === cp.id)!;
    assert.ok(item);
    // Disposable-only representation of an invoice created before nullable kind existed.
    await db.invoiceItem.update({ where: { id: item.id }, data: { kind: null } });
    const paid = await pay("11");
    assert.equal(paid.status, "success", paid.message);
    assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: cp.id } })).status, "ACTIVE");
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, "PAID");
    assert.equal((await db.invoiceItem.findUniqueOrThrow({ where: { id: item.id } })).kind, null);
    console.log("REAL_WRITER_PASS: legacy kind=null, non-primary CP, pending0 -> active2, invoice paid12");

    const events = await db.customerPackageActivity.findMany({ where: { invoiceId: invoice.id, eventType: "PURCHASED" } });
    assert.equal(events.length, 2);
    const event = events.find(row => row.customerPackageId === cp.id)!;
    assert.equal(event.invoiceItemId, item.id);
    assert.equal(event.remainingBefore, 0); assert.equal(event.remainingAfter, 2);
    assert.equal(event.assignedStaffId, f.actor.id);
    assert.deepEqual(new Set((event.additionalSourceRefs as { paymentIds: string[] }).paymentIds),
      new Set((await db.payment.findMany({ where: { invoiceId: invoice.id } })).map(p => p.id)));
  } finally { await h.close(); }
});
