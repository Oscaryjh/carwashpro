import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { findPosElement, posOutletPages } from "../helpers/pos-outlet-pages";

const db = walletTestDatabase();
after(() => db.$disconnect());
type SaleAction = (data: FormData) => Promise<{ status: string; message: string; invoice: { id: string } | null }>;
type AppointmentAction = (data: FormData) => Promise<unknown>;
const panel = (type: unknown) => typeof type === "function" && type.name === "CashierSalesPanel";

async function fixture() {
  const f = await checkoutFixture(db, "CASH");
  await db.businessModuleEntitlement.createMany({ data: ["SALON", "INVENTORY"].map(moduleKey => ({ businessId: f.business.id, moduleKey: moduleKey as "SALON", status: "ENABLED", source: "MANUAL", enabledFrom: new Date(0) })) });
  await db.product.update({ where: { id: f.product.id }, data: { trackInventory: true } });
  await db.productStock.create({ data: { businessId: f.business.id, branchId: f.branch.id, productId: f.product.id, quantity: 10 } });
  const history = await db.branch.create({ data: { businessId: f.business.id, name: "Historical branch", status: "INACTIVE" } });
  await db.productStock.create({ data: { businessId: f.business.id, branchId: history.id, productId: f.product.id, quantity: 99 } });
  return { ...f, history };
}

test("single page sale retains Invoice/Payment/Inventory/Shift/Appointment branch and replay", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(); await h.login(db, f);
    const appointment = await db.appointment.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id, status: "COMPLETED", scheduledAt: new Date(), productIds: [f.product.id] } });
    f.form.set("appointmentId", appointment.id); f.form.set("walletAmount", "0");
    const pages = await posOutletPages(db);
    const props = findPosElement(await pages.Cashier({ searchParams: Promise.resolve({ appointmentId: appointment.id }) }), panel);
    assert.equal(props.singleOutlet, true);
    const action = props.action as SaleAction;
    const result = await action(f.form);
    assert.equal(result.status, "success", result.message);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: result.invoice!.id } });
    assert.equal(invoice.branchId, f.branch.id); assert.equal(invoice.appointmentId, appointment.id);
    const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    assert.equal(payment.branchId, f.branch.id); assert.equal(payment.shiftId, f.shift.id);
    const movements = await db.inventoryMovement.findMany({ where: { businessId: f.business.id, type: "SALE" } });
    assert.equal(movements.length, 1); assert.equal(movements[0].branchId, f.branch.id); assert.equal(movements[0].quantityDelta, -1);
    assert.equal((await db.productStock.findUniqueOrThrow({ where: { branchId_productId: { branchId: f.branch.id, productId: f.product.id } } })).quantity, 9);
    assert.equal((await db.productStock.findUniqueOrThrow({ where: { branchId_productId: { branchId: f.history.id, productId: f.product.id } } })).quantity, 99);
    assert.deepEqual(await action(f.form), result);
    assert.equal(await db.inventoryMovement.count({ where: { businessId: f.business.id, type: "SALE" } }), 1);
  } finally { await h.close(); }
});

test("appointment page creates in the implicit branch; stale topology and explicit foreign branch never write", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(); await h.login(db, f); const pages = await posOutletPages(db);
    const formProps = findPosElement(await pages.NewAppointment({ searchParams: Promise.resolve({}) }), type => type === "form");
    const action = formProps.action as AppointmentAction;
    const data = new FormData();
    for (const [key, value] of Object.entries({ branchId: f.branch.id, customerId: f.customer.id, scheduledDate: "2026-11-01", scheduledTime: "10:00", notes: "Synthetic single outlet" })) data.set(key, value);
    await assert.rejects(action(data), /REDIRECT:\/appointments/);
    const created = await db.appointment.findFirstOrThrow({ where: { businessId: f.business.id } });
    assert.equal(created.branchId, f.branch.id);
    data.set("branchId", randomUUID());
    await assert.rejects(action(data), /location|access|Reload/i);
    data.set("branchId", f.branch.id);
    await db.branch.create({ data: { businessId: f.business.id, name: "New second active location" } });
    await assert.rejects(action(data), /changed|Reload/);
    assert.equal(await db.appointment.count({ where: { businessId: f.business.id } }), 1);
  } finally { await h.close(); }
});

test("stale Cashier topology rejects before financial operation and existing historical appointment is not reassigned", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(); await h.login(db, f); const pages = await posOutletPages(db);
    const props = findPosElement(await pages.Cashier({ searchParams: Promise.resolve({}) }), panel);
    const action = props.action as SaleAction;
    const before = await db.financialOperation.count({ where: { businessId: f.business.id } });
    await db.branch.create({ data: { businessId: f.business.id, name: "Topology changed" } });
    assert.equal((await action(f.form)).status, "error");
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 0);
    assert.equal(await db.financialOperation.count({ where: { businessId: f.business.id } }), before);
    const historical = await db.appointment.create({ data: { businessId: f.business.id, branchId: f.history.id, customerId: f.customer.id, scheduledAt: new Date(), status: "COMPLETED" } });
    const snapshot = await db.appointment.findUniqueOrThrow({ where: { id: historical.id } });
    await assert.rejects(pages.Detail({ params: Promise.resolve({ appointmentId: historical.id }), searchParams: Promise.resolve({}) }), /REDIRECT:\/appointments\?appointment=/);
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: historical.id } })).branchId, snapshot.branchId);
  } finally { await h.close(); }
});

test("legacy Staff remains multi-branch, rejects other-branch explicit input and revoked replay", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture();
    const second = await db.branch.create({ data: { businessId: f.business.id, name: "Second active location" } });
    const staff = await db.user.create({ data: { businessId: f.business.id, branchId: f.branch.id, name: "Scoped cashier", role: "STAFF", permissions: ["POS", "APPOINTMENTS"] } });
    await db.cashierShift.update({ where: { id: f.shift.id }, data: { cashierId: staff.id } });
    await h.login(db, { ...f, actor: staff }); const pages = await posOutletPages(db);
    const props = findPosElement(await pages.Cashier({ searchParams: Promise.resolve({}) }), panel);
    assert.equal(props.singleOutlet, false);
    const action = props.action as SaleAction;
    f.form.set("branchId", second.id); f.form.set("walletAmount", "0");
    assert.equal((await action(f.form)).status, "error");
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 0);
    f.form.set("branchId", f.branch.id);
    const result = await action(f.form); assert.equal(result.status, "success", result.message);
    await db.user.update({ where: { id: staff.id }, data: { branchId: second.id } });
    assert.equal((await action(f.form)).status, "error");
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 1);
    assert.equal(await db.inventoryMovement.count({ where: { businessId: f.business.id, type: "SALE" } }), 1);
  } finally { await h.close(); }
});

test("zero location pages expose guidance, not writable forms", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(); await h.login(db, f);
    await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
    await db.branch.update({ where: { id: f.branch.id }, data: { status: "INACTIVE" } });
    const pages = await posOutletPages(db);
    for (const page of [pages.Cashier, pages.NewAppointment]) {
      const tree = await page({ searchParams: Promise.resolve({}) });
      assert.ok(findPosElement(tree, type => typeof type === "function" && type.name === "PosLocationGuidance"));
      assert.throws(() => findPosElement(tree, type => type === "form" || panel(type)));
    }
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 0);
    assert.equal(await db.appointment.count({ where: { businessId: f.business.id } }), 0);
  } finally { await h.close(); }
});

test("historical inactive-branch appointment edits retain the document branch, never the new current outlet", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(); await h.login(db, f); const pages = await posOutletPages(db);
    const service = await db.service.create({ data: { businessId: f.business.id, branchId: f.history.id, name: "Historical service", price: 30, durationMinutes: 30 } });
    const appointment = await db.appointment.create({ data: { businessId: f.business.id, branchId: f.history.id, customerId: f.customer.id, serviceId: service.id, serviceIds: [service.id], scheduledAt: new Date("2099-11-01T02:00:00Z"), status: "SCHEDULED" } });
    const props = findPosElement(await pages.Appointments({ searchParams: Promise.resolve({ date: "2099-11-01" }) }), type => typeof type === "function" && type.name === "AppointmentCalendar");
    assert.equal(props.singleOutletBranchId, f.branch.id);
    assert.ok(!(props.creationServiceIds as string[]).includes(service.id));
    assert.ok((props.services as { id: string }[]).some(item => item.id === service.id));
    const form = new FormData();
    for (const [key, value] of Object.entries({ appointmentId: appointment.id, assignedStaffId: "", notes: "Historical edit preserved", scheduledDate: "2099-11-01", scheduledTime: "10:00" })) form.set(key, value);
    form.append("serviceIds", service.id);
    const result = await (props.updateAppointmentAction as (data: FormData) => Promise<unknown>)(form);
    assert.deepEqual(result, { ok: true });
    const updated = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    assert.equal(updated.branchId, f.history.id); assert.equal(updated.notes, "Historical edit preserved");
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 0);
  } finally { await h.close(); }
});

test("Notes-only calendar edit preserves singular service relation and historical branch in the database", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(); await h.login(db, f); const pages = await posOutletPages(db);
    const service = await db.service.create({ data: { businessId: f.business.id, name: "Singular service", price: 30, durationMinutes: 30 } });
    const appointment = await db.appointment.create({ data: { businessId: f.business.id, branchId: f.history.id, customerId: f.customer.id, serviceId: service.id, serviceIds: [], notes: "Before", scheduledAt: new Date("2099-11-02T02:00:00Z") } });
    const financialCounts = () => Promise.all([
      db.invoice.count({ where: { businessId: f.business.id } }),
      db.payment.count({ where: { businessId: f.business.id } }),
      db.inventoryMovement.count({ where: { businessId: f.business.id } }),
    ]);
    const financialBefore = await financialCounts();
    const before = await db.appointment.findMany({ where: { businessId: f.business.id } });
    const props = findPosElement(await pages.Appointments({ searchParams: Promise.resolve({ date: "2099-11-02" }) }), type => typeof type === "function" && type.name === "AppointmentCalendar");
    const item = (props.appointments as { id: string; serviceIds: string[] }[]).find(a => a.id === appointment.id)!;
    assert.deepEqual(item.serviceIds, [service.id]);
    const form = new FormData();
    for (const [key, value] of Object.entries({ appointmentId: appointment.id, assignedStaffId: "", notes: "Notes only", scheduledDate: "2099-11-02", scheduledTime: "10:00" })) form.set(key, value);
    item.serviceIds.forEach(id => form.append("serviceIds", id));
    assert.deepEqual(await (props.updateAppointmentAction as (data: FormData) => Promise<unknown>)(form), { ok: true });
    const updated = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    assert.equal(updated.notes, "Notes only"); assert.equal(updated.serviceId, service.id);
    assert.deepEqual(updated.serviceIds, [service.id]); assert.equal(updated.branchId, f.history.id);
    const after = await db.appointment.findMany({ where: { businessId: f.business.id } });
    assert.equal(after.length, before.length);
    assert.equal(after.filter(a => a.updatedAt.getTime() !== before.find(b => b.id === a.id)!.updatedAt.getTime()).length, 1);
    assert.deepEqual(await financialCounts(), financialBefore, "Notes edit must not add financial or inventory facts");
  } finally { await h.close(); }
});
