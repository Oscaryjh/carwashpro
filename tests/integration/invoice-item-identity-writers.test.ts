import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { walletTestDatabase, walletFixture } from "../helpers/wallet-fixture";
import { checkoutHarness } from "../helpers/wallet-checkout-fixture";

assert.equal(process.env.TETAMU_WALLET_LOCAL_TEST, "true", "Disposable Local runner required");
const db = walletTestDatabase();
after(() => db.$disconnect());

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

async function fixture() {
  const f = await walletFixture(db);
  for (const moduleKey of ["SALON", "AUTO"] as const) await db.businessModuleEntitlement.create({ data: {
    businessId: f.business.id, moduleKey, status: "ENABLED", source: "MANUAL", enabledFrom: new Date(0),
  } });
  const service = await db.service.create({ data: { businessId: f.business.id, name: "Identity service", price: 2 } });
  const second = await db.service.create({ data: { businessId: f.business.id, name: "Identity covered service", price: 3 } });
  await db.serviceStaffAssignment.createMany({ data: [service, second].map(s => ({ businessId: f.business.id, serviceId: s.id, userId: f.actor.id })) });
  const product = await db.product.create({ data: { businessId: f.business.id, name: "Identity product", sku: randomUUID(), price: 1 } });
  const packages = await Promise.all(["A", "B"].map(name => db.package.create({ data: {
    businessId: f.business.id, name: `Identity package ${name}`, price: 5, totalUses: 2, serviceId: second.id,
    serviceBenefits: { create: { businessId: f.business.id, serviceId: second.id, totalUses: 2 } },
  } })));
  const owned = await db.customerPackage.create({ data: {
    businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id, packageId: packages[0].id,
    purchasePrice: 5, totalUses: 2, remainingUses: 2, status: "ACTIVE",
    serviceBalances: { create: { businessId: f.business.id, serviceId: second.id, totalUses: 2, remainingUses: 2 } },
  }, include: { serviceBalances: true } });
  const appointment = await db.appointment.create({ data: {
    businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id, assignedStaffId: f.actor.id,
    serviceId: service.id, serviceIds: [service.id, second.id], productIds: [product.id], packageIds: packages.map(p => p.id),
    scheduledAt: new Date(), status: "COMPLETED",
  } });
  const confirmation = { operationId: randomUUID(), modeAtConfirmation: "ON", shiftId: f.shift.id, method: "CASH", preservePaymentForm: "1" };
  return { ...f, service, second, product, packages, owned, appointment, confirmation };
}

async function invoiceItems(businessId: string) {
  return db.invoiceItem.findMany({ where: { businessId }, orderBy: { name: "asc" } });
}

test("Cashier mixed service/product/two package purchases/covered service persist source identity, never primary-package heuristics", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(); await h.login(db, f);
    const sale = form({ ...f.confirmation, branchId: f.branch.id, customerId: f.customer.id,
      appointmentId: f.appointment.id, assignedStaffId: f.actor.id, paymentMethodCode: "BUILTIN_CASH", walletAmount: "0" });
    for (const s of [f.service, f.second]) { sale.append("serviceId", s.id); sale.append("serviceQuantity", "1"); }
    sale.append("productId", f.product.id); sale.append("productQuantity", "1");
    for (const p of f.packages) { sale.append("packageId", p.id); sale.append("packageQuantity", "1"); }
    sale.append("customerPackageId", f.owned.serviceBalances[0].id);
    const result = await h.action.completeCashierSaleAction(sale);
    assert.equal(result.status, "success", result.message);
    const items = await invoiceItems(f.business.id);
    assert.deepEqual(items.map(row => [row.name, row.kind]), [
      ["Identity covered service", "SERVICE"], ["Identity package A", "PACKAGE_PURCHASE"],
      ["Identity package B", "PACKAGE_PURCHASE"], ["Identity product", "PRODUCT"], ["Identity service", "SERVICE"],
    ]);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: result.invoice!.id } });
    const purchases = items.filter(row => row.kind === "PACKAGE_PURCHASE");
    assert.equal(purchases.length, 2); assert.equal(purchases.filter(row => row.customerPackageId !== invoice.customerPackageId).length, 1);
    assert.equal(items.find(row => row.name === f.second.name)?.customerPackageId, f.owned.id);
    assert.equal(invoice.total.toFixed(2), "16.00");
    assert.equal(invoice.balance.toFixed(2), "0.00");
    assert.equal((await db.customerPackageServiceBalance.findUniqueOrThrow({ where: { id: f.owned.serviceBalances[0].id } })).remainingUses, 1);
    assert.equal(await db.walletTransaction.count({ where: { businessId: f.business.id } }), 0);
  } finally { await h.close(); }
});

test("Appointment temporary source kinds survive persistence for service/product/multiple purchases and package coverage", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(); await h.login(db, f);
    const payment = form({ ...f.confirmation, appointmentId: f.appointment.id, amount: "13", discountAmount: "0", depositAmount: "0", tipAmount: "0" });
    payment.append("customerPackageIds", f.owned.serviceBalances[0].id);
    const result = await h.appointments.recordSalonAppointmentPaymentAction({ status: "idle", message: "", invoiceId: null, invoice: null }, payment);
    assert.equal(result.status, "success", result.message);
    assert.deepEqual((await invoiceItems(f.business.id)).map(row => [row.name, row.kind]), [
      ["Identity covered service", "SERVICE"], ["Identity package A", "PACKAGE_PURCHASE"],
      ["Identity package B", "PACKAGE_PURCHASE"], ["Identity product", "PRODUCT"], ["Identity service", "SERVICE"],
    ]);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: result.invoiceId! } });
    assert.equal(invoice.total.toFixed(2), "16.00"); assert.equal(invoice.balance.toFixed(2), "0.00");
  } finally { await h.close(); }
});

test("Product checkout explicitly persists PRODUCT while retaining quantity and amount", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(); await h.login(db, f);
    await assert.rejects(h.products.sellProductAction(form({ ...f.confirmation, branchId: f.branch.id,
      customerId: f.customer.id, productId: f.product.id, quantity: "2" })), /NEXT_REDIRECT/);
    const [item] = await invoiceItems(f.business.id);
    assert.equal(item.kind, "PRODUCT"); assert.equal(item.quantity, 2); assert.equal(item.lineTotal.toFixed(2), "2.00");
  } finally { await h.close(); }
});

test("Work-order package purchase marks every package, including the non-primary second purchase", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(); await h.login(db, f);
    const sale = form({ ...f.confirmation, branchId: f.branch.id, customerId: f.customer.id });
    for (const p of f.packages) { sale.append("packageId", p.id); sale.append("quantity", "1"); }
    await assert.rejects(h.workOrders.purchasePackageFromCashierAction(sale), /NEXT_REDIRECT/);
    const items = await invoiceItems(f.business.id);
    assert.deepEqual(items.map(row => row.kind), ["PACKAGE_PURCHASE", "PACKAGE_PURCHASE"]);
    const invoice = await db.invoice.findFirstOrThrow({ where: { businessId: f.business.id } });
    assert.equal(items.filter(row => row.customerPackageId !== invoice.customerPackageId).length, 1);
    assert.equal(invoice.total.toFixed(2), "10.00");
  } finally { await h.close(); }
});

for (const redemption of [false, true]) test(`Old POS ${redemption ? "package redemption" : "normal cash payment"} copies known service-origin work order lines as SERVICE`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(); await h.login(db, f);
    const vehicle = await db.vehicle.create({ data: { businessId: f.business.id, customerId: f.customer.id, plateNumber: randomUUID(), size: "SMALL" } });
    const job = await db.workOrder.create({ data: { businessId: f.business.id, branchId: f.branch.id,
      customerId: f.customer.id, vehicleId: vehicle.id, orderNumber: randomUUID(), subtotal: 3, total: 3, balance: 3,
      items: { create: { businessId: f.business.id, serviceId: f.second.id, name: f.second.name, quantity: 1, unitPrice: 3, lineTotal: 3 } },
    } });
    const payment = form({ ...f.confirmation, workOrderId: job.id, amount: "3", customerPackageId: f.owned.id });
    await assert.rejects(redemption ? h.pos.usePackagePaymentAction(payment) : h.pos.recordPaymentAction(payment), /NEXT_REDIRECT/);
    const [item] = await invoiceItems(f.business.id);
    assert.equal(item.kind, "SERVICE"); assert.equal(item.customerPackageId, null, "do not expand old coverage reference contract");
    assert.equal(item.lineTotal.toFixed(2), "3.00");
    const persisted = await db.payment.findFirstOrThrow({ where: { workOrderId: job.id } });
    assert.equal(persisted.method, redemption ? "PACKAGE" : "CASH");
    assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: f.owned.id } })).remainingUses, redemption ? 1 : 2);
  } finally { await h.close(); }
});

test("Old POS reuses a historical invoice without classifying its existing null-kind rows", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(); await h.login(db, f);
    const vehicle = await db.vehicle.create({ data: { businessId: f.business.id, customerId: f.customer.id, plateNumber: randomUUID(), size: "SMALL" } });
    const job = await db.workOrder.create({ data: { businessId: f.business.id, branchId: f.branch.id,
      customerId: f.customer.id, vehicleId: vehicle.id, orderNumber: randomUUID(), subtotal: 3, total: 3, balance: 3,
      items: { create: { businessId: f.business.id, serviceId: f.second.id, name: f.second.name, quantity: 1, unitPrice: 3, lineTotal: 3 } },
    } });
    const historical = await db.invoice.create({ data: { businessId: f.business.id, branchId: f.branch.id,
      customerId: f.customer.id, workOrderId: job.id, invoiceNumber: randomUUID(), subtotal: 3, total: 3, paidAmount: 0, balance: 3,
      items: { create: { businessId: f.business.id, serviceId: f.second.id, name: f.second.name, quantity: 1, unitPrice: 3, lineTotal: 3 } },
    }, include: { items: true } });
    await assert.rejects(h.pos.recordPaymentAction(form({ ...f.confirmation, workOrderId: job.id, amount: "3" })), /NEXT_REDIRECT/);
    const items = await invoiceItems(f.business.id);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, historical.items[0].id);
    assert.equal(items[0].kind, null);
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: historical.id } })).balance.toFixed(2), "0.00");
  } finally { await h.close(); }
});

test("Old POS package purchase writes explicit PACKAGE_PURCHASE even without an item-level package reference", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(); await h.login(db, f);
    const pending = await db.customerPackage.create({ data: { businessId: f.business.id, branchId: f.branch.id,
      customerId: f.customer.id, packageId: f.packages[1].id, purchasePrice: 5, totalUses: 2, remainingUses: 0 } });
    await assert.rejects(h.pos.recordPackagePurchasePaymentAction(form({ ...f.confirmation, customerPackageId: pending.id, amount: "5" })), /NEXT_REDIRECT/);
    const [item] = await invoiceItems(f.business.id);
    assert.equal(item.kind, "PACKAGE_PURCHASE"); assert.equal(item.customerPackageId, null);
    assert.equal(item.serviceId, f.second.id); assert.equal(item.lineTotal.toFixed(2), "5.00");
  } finally { await h.close(); }
});

test("Nullable identity migration preserves old rows and permits old inserts without a default or backfill", async () => {
  const sql = await readFile("prisma/migrations/20261006000000_invoice_item_explicit_kind/migration.sql", "utf8");
  const schema = `identity_${randomUUID().replaceAll("-", "")}`;
  const rollback = new Error("ROLLBACK_IDENTITY_COMPATIBILITY_PROBE");
  await assert.rejects(db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    await tx.$executeRawUnsafe('CREATE TABLE "invoice_items" (id integer PRIMARY KEY, name text NOT NULL)');
    await tx.$executeRawUnsafe("INSERT INTO invoice_items (id, name) VALUES (1, 'legacy')");
    for (const statement of sql.replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
    await tx.$executeRawUnsafe("INSERT INTO invoice_items (id, name) VALUES (2, 'old application')");
    await tx.$executeRawUnsafe("INSERT INTO invoice_items (id, name, kind) VALUES (3, 'new application', 'PACKAGE_PURCHASE')");
    assert.deepEqual(await tx.$queryRawUnsafe('SELECT id, kind FROM invoice_items ORDER BY id'), [
      { id: 1, kind: null }, { id: 2, kind: null }, { id: 3, kind: "PACKAGE_PURCHASE" },
    ]);
    throw rollback;
  }), error => error === rollback);
});
