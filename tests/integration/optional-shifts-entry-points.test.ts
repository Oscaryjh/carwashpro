import assert from "node:assert/strict";
import test, { after } from "node:test";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { walletTestDatabase } from "../helpers/wallet-fixture";
import { randomUUID } from "node:crypto";

const db = walletTestDatabase();
after(() => db.$disconnect());

for (const method of ["FOREIGN_CURRENCY", "CRYPTO"] as const) test(`Cashier OFF retains supported ${method} conversion without a shift`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await checkoutFixture(db, "CASH");
    await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
    await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: false } });
    const tender = await db.businessPaymentMethod.create({ data: {
      businessId: f.business.id, code: method, label: method, normalizedLabel: method.toLowerCase(), canonicalMethod: method,
      paymentKind: method === "CRYPTO" ? "CRYPTO_ASSET" : "FOREIGN_CURRENCY", settlementCurrency: "MYR", assetSymbol: method === "CRYPTO" ? "USDT" : "USD",
    } });
    await h.login(db, f);
    for (const [key, value] of Object.entries({ modeAtConfirmation: "OFF", shiftId: "", walletAmount: "0", method, paymentMethodId: tender.id, paymentMethodCode: tender.code, tenderAmount: "10", exchangeRateToMyr: "4", reference: "Disposable converted tender" })) f.form.set(key, value);
    const result = await h.action.completeCashierSaleAction(f.form);
    assert.equal(result.status, "success", result.message);
    const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: result.invoice!.id } });
    assert.equal(payment.method, method); assert.equal(payment.amount.toFixed(2), "40.00");
    assert.equal(payment.shiftId, null); assert.equal(payment.branchId, f.branch.id);
    assert.equal(await db.cashierShift.count({ where: { businessId: f.business.id } }), 1);
  } finally { await h.close(); }
});

test("Cashier rejects missing confirmation and foreign Branch even when shifts are OFF", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await checkoutFixture(db, "CASH"), other = await checkoutFixture(db);
    await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
    await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: false } });
    await h.login(db, f); f.form.set("walletAmount", "0"); f.form.set("shiftId", "");
    f.form.delete("modeAtConfirmation");
    assert.match((await h.action.completeCashierSaleAction(f.form)).message, /CASHIER_SHIFT_MODE_CHANGED/);
    f.form.set("modeAtConfirmation", "OFF"); f.form.set("branchId", other.branch.id);
    assert.equal((await h.action.completeCashierSaleAction(f.form)).status, "error");
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 0);
  } finally { await h.close(); }
});

for (const mode of ["ON", "OFF"] as const) test(`Cashier ${mode} preserves every MYR tender and Wallet split in canonical facts`, async () => {
  const h = await checkoutHarness(db);
  try {
    for (const method of ["CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER", "MEMBER_WALLET"]) {
      for (const split of method === "MEMBER_WALLET" ? [false] : [false, true]) {
        const f = await checkoutFixture(db, method);
        if (mode === "OFF") {
          await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
          await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: false } });
        }
        await h.login(db, f);
        f.form.set("modeAtConfirmation", mode); f.form.set("shiftId", mode === "ON" ? f.shift.id : "");
        f.form.set("walletAmount", method === "MEMBER_WALLET" ? "40" : split ? "20" : "0");
        const result = await h.action.completeCashierSaleAction(f.form);
        assert.equal(result.status, "success", `${mode}/${method}/${split}: ${result.message}`);
        const invoice = await db.invoice.findUniqueOrThrow({ where: { id: result.invoice!.id } });
        assert.deepEqual([invoice.total.toFixed(2), invoice.paidAmount.toFixed(2), invoice.balance.toFixed(2)], ["40.00", "40.00", "0.00"]);
        const payments = await db.payment.findMany({ where: { invoiceId: invoice.id } });
        assert.equal(payments.length, split ? 2 : 1);
        assert.equal(payments.reduce((sum, row) => sum + row.amount.toNumber() * 100, 0), 4000);
        for (const payment of payments) {
          assert.equal(payment.shiftId, mode === "ON" ? f.shift.id : null);
          assert.equal(payment.branchId, f.branch.id); assert.equal(payment.cashierId, f.actor.id);
        }
        const account = await db.walletAccount.findFirstOrThrow({ where: { businessId: f.business.id } });
        const spent = method === "MEMBER_WALLET" ? 40 : split ? 20 : 0;
        assert.equal(account.paidBalance.plus(account.bonusBalance).toNumber(), 80 - spent);
        assert.equal(account.bonusBalance.toNumber(), Math.max(0, 30 - spent));
        assert.equal(await db.cashierShift.count({ where: { businessId: f.business.id } }), 1, "no hidden shift");
        assert.deepEqual(await h.action.completeCashierSaleAction(f.form), result);
        assert.equal(await db.payment.count({ where: { invoiceId: invoice.id } }), payments.length);
      }
    }
  } finally { await h.close(); }
});

for (const mode of ["ON", "OFF"] as const) test(`Direct package purchase ${mode} posts null shift and preserves purchased uses`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await checkoutFixture(db);
    if (mode === "OFF") {
      await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
      await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: false } });
    }
    const pkg = await db.package.create({ data: { businessId: f.business.id, name: "Direct package", price: 100, totalUses: 5 } });
    await db.businessModuleEntitlement.create({ data: { businessId: f.business.id, moduleKey: "AUTO", status: "ENABLED", source: "MANUAL", enabledFrom: new Date(0) } });
    await h.login(db, f);
    const form = new FormData();
    for (const [k,v] of Object.entries({ operationId: randomUUID(), branchId: f.branch.id, customerId: f.customer.id, packageId: pkg.id, quantity: "1", method: "CASH", preservePaymentForm: "1", modeAtConfirmation: mode, shiftId: mode === "ON" ? f.shift.id : "" })) form.set(k,v);
    if (mode === "ON") {
      await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
      assert.equal(JSON.parse(JSON.stringify(await h.workOrders.purchasePackageFromCashierAction(form))).code, "CASHIER_SHIFT_MODE_CHANGED");
      assert.equal(await db.invoice.count({where:{businessId:f.business.id}}),0);
      await db.cashierShift.update({where:{id:f.shift.id},data:{status:"OPEN"}});
    }
    await assert.rejects(h.workOrders.purchasePackageFromCashierAction(form), /NEXT_REDIRECT/);
    const owned = await db.customerPackage.findFirstOrThrow({ where: { businessId: f.business.id } });
    assert.equal(owned.remainingUses, 5); assert.equal(owned.status, "ACTIVE");
    const payment = await db.payment.findFirstOrThrow({ where: { customerPackageId: owned.id } });
    assert.equal(payment.shiftId, mode === "ON" ? f.shift.id : null); assert.equal(payment.amount.toFixed(2), "100.00");
    assert.equal(payment.branchId, f.branch.id);
  } finally { await h.close(); }
});

for (const mode of ["ON", "OFF"] as const) test(`Work order package redemption ${mode} retains PACKAGE classification and decrements one use`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await checkoutFixture(db);
    if (mode === "OFF") {
      await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
      await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: false } });
    }
    const vehicle = await db.vehicle.create({ data: { businessId: f.business.id, customerId: f.customer.id, plateNumber: randomUUID(), size: "SMALL" } });
    const workOrder = await db.workOrder.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id, vehicleId: vehicle.id, orderNumber: randomUUID(), subtotal: 40, total: 40, balance: 40, items: { create: { businessId: f.business.id, name: "Service", quantity: 1, unitPrice: 40, lineTotal: 40 } } } });
    const pkg = await db.package.create({ data: { businessId: f.business.id, name: "Phase2 prepaid", price: 100, totalUses: 5 } });
    const owned = await db.customerPackage.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id, packageId: pkg.id, purchasePrice: 100, totalUses: 5, remainingUses: 5, status: "ACTIVE" } });
    await h.login(db, f);
    const form = new FormData();
    for (const [k,v] of Object.entries({ operationId: randomUUID(), workOrderId: workOrder.id, customerPackageId: owned.id, modeAtConfirmation: mode, shiftId: mode === "ON" ? f.shift.id : "" })) form.set(k,v);
    if (mode === "ON") {
      await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
      assert.equal(JSON.parse(JSON.stringify(await h.pos.usePackagePaymentAction(form))).code, "CASHIER_SHIFT_MODE_CHANGED");
      assert.equal(await db.invoice.count({where:{businessId:f.business.id}}),0);
      await db.cashierShift.update({where:{id:f.shift.id},data:{status:"OPEN"}});
    }
    await assert.rejects(h.pos.usePackagePaymentAction(form), /NEXT_REDIRECT/);
    const payment = await db.payment.findFirstOrThrow({ where: { workOrderId: workOrder.id } });
    assert.equal(payment.shiftId, mode === "ON" ? f.shift.id : null); assert.equal(payment.method, "PACKAGE");
    assert.equal(payment.amount.toFixed(2), "40.00"); assert.equal(payment.packageUses, 1);
    assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: owned.id } })).remainingUses, 4);
  } finally { await h.close(); }
});

for (const mode of ["ON", "OFF"] as const) test(`POS pending package purchase ${mode} activates package with a null-shift payment`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await checkoutFixture(db);
    if (mode === "OFF") {
      await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
      await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: false } });
    }
    const pkg = await db.package.create({ data: { businessId: f.business.id, name: "Phase2 package", price: 100, totalUses: 5 } });
    const owned = await db.customerPackage.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id, packageId: pkg.id, purchasePrice: 100, totalUses: 5, remainingUses: 0 } });
    await h.login(db, f);
    const form = new FormData();
    for (const [k,v] of Object.entries({ operationId: randomUUID(), customerPackageId: owned.id, amount: "100", method: "CASH", modeAtConfirmation: mode, shiftId: mode === "ON" ? f.shift.id : "" })) form.set(k,v);
    if (mode === "ON") {
      await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
      assert.equal(JSON.parse(JSON.stringify(await h.pos.recordPackagePurchasePaymentAction(form))).code, "CASHIER_SHIFT_MODE_CHANGED");
      assert.equal(await db.invoice.count({where:{businessId:f.business.id}}),0);
      await db.cashierShift.update({where:{id:f.shift.id},data:{status:"OPEN"}});
    }
    await assert.rejects(h.pos.recordPackagePurchasePaymentAction(form), /NEXT_REDIRECT/);
    const payment = await db.payment.findFirstOrThrow({ where: { customerPackageId: owned.id } });
    assert.equal(payment.shiftId, mode === "ON" ? f.shift.id : null); assert.equal(payment.amount.toFixed(2), "100.00");
    assert.equal(payment.branchId, f.branch.id);
    const actual = await db.customerPackage.findUniqueOrThrow({ where: { id: owned.id } });
    assert.equal(actual.status, "ACTIVE"); assert.equal(actual.remainingUses, 5);
  } finally { await h.close(); }
});

for (const mode of ["ON", "OFF"] as const) test(`Work order ${mode} collects payment without a shift and settles the original order`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await checkoutFixture(db);
    if (mode === "OFF") {
      await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
      await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: false } });
    }
    const vehicle = await db.vehicle.create({ data: { businessId: f.business.id, customerId: f.customer.id, plateNumber: randomUUID() } });
    const workOrder = await db.workOrder.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id, vehicleId: vehicle.id, orderNumber: randomUUID(), subtotal: 40, total: 40, balance: 40, items: { create: { businessId: f.business.id, name: "Service", quantity: 1, unitPrice: 40, lineTotal: 40 } } } });
    await h.login(db, f);
    const form = new FormData();
    for (const [k,v] of Object.entries({ operationId: randomUUID(), workOrderId: workOrder.id, amount: "40", method: "CASH", modeAtConfirmation: mode, shiftId: mode === "ON" ? f.shift.id : "" })) form.set(k,v);
    if (mode === "ON") {
      await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
      assert.equal(JSON.parse(JSON.stringify(await h.pos.recordPaymentAction(form))).code, "CASHIER_SHIFT_MODE_CHANGED");
      assert.equal(await db.invoice.count({where:{businessId:f.business.id}}),0);
      await db.cashierShift.update({where:{id:f.shift.id},data:{status:"OPEN"}});
    }
    await assert.rejects(h.pos.recordPaymentAction(form), /NEXT_REDIRECT/);
    const payment = await db.payment.findFirstOrThrow({ where: { workOrderId: workOrder.id } });
    assert.equal(payment.shiftId, mode === "ON" ? f.shift.id : null); assert.equal(payment.amount.toFixed(2), "40.00");
    assert.equal(payment.branchId, f.branch.id); assert.equal(payment.cashierId, f.actor.id);
    const actual = await db.workOrder.findUniqueOrThrow({ where: { id: workOrder.id } });
    assert.equal(actual.paymentStatus, "PAID"); assert.equal(actual.balance.toFixed(2), "0.00");
  } finally { await h.close(); }
});

for (const mode of ["ON", "OFF"] as const) test(`Product ${mode} posts the original product total without assigning a shift`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await checkoutFixture(db, "CASH");
    if (mode === "OFF") {
      await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
      await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: false } });
    }
    await h.login(db, f);
    f.form.set("quantity", "2"); f.form.set("preservePaymentForm", "1");
    f.form.delete("walletAmount");
    f.form.set("modeAtConfirmation", mode); f.form.set("shiftId", mode === "ON" ? f.shift.id : "");
    if (mode === "ON") {
      await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
      assert.equal(JSON.parse(JSON.stringify(await h.products.sellProductAction(f.form))).code, "CASHIER_SHIFT_MODE_CHANGED");
      assert.equal(await db.invoice.count({where:{businessId:f.business.id}}),0);
      await db.cashierShift.update({where:{id:f.shift.id},data:{status:"OPEN"}});
    }
    await assert.rejects(h.products.sellProductAction(f.form), /NEXT_REDIRECT/);
    const invoice = await db.invoice.findFirstOrThrow({ where: { businessId: f.business.id } });
    assert.equal(invoice.total.toFixed(2), "80.00"); assert.equal(invoice.balance.toFixed(2), "0.00");
    const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    assert.equal(payment.shiftId, mode === "ON" ? f.shift.id : null); assert.equal(payment.amount.toFixed(2), "80.00");
    assert.equal(payment.branchId, f.branch.id); assert.equal(payment.cashierId, f.actor.id);
  } finally { await h.close(); }
});

for (const mode of ["ON", "OFF"] as const) test(`Appointment ${mode} preserves deposit plus settlement as two null-shift payments`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await checkoutFixture(db);
    if (mode === "OFF") {
      await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
      await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: false } });
    }
    await db.businessModuleEntitlement.create({ data: { businessId: f.business.id, moduleKey: "SALON", status: "ENABLED", source: "MANUAL", enabledFrom: new Date(0) } });
    const service = await db.service.create({ data: { businessId: f.business.id, name: "Phase2 service", price: 40 } });
    const appointment = await db.appointment.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id, assignedStaffId: f.actor.id, serviceId: service.id, serviceIds: [service.id], scheduledAt: new Date(), status: "COMPLETED" } });
    await h.login(db, f);
    const form = new FormData();
    for (const [key, value] of Object.entries({ operationId: randomUUID(), appointmentId: appointment.id, amount: "30", depositAmount: "10", method: "CASH", modeAtConfirmation: mode, shiftId: mode === "ON" ? f.shift.id : "" })) form.set(key, value);
    if (mode === "ON") {
      await db.cashierShift.update({where:{id:f.shift.id},data:{status:"CLOSED"}});
      const denied=await h.appointments.recordSalonAppointmentPaymentAction({status:"idle",message:"",invoiceId:null,invoice:null},form);
      assert.equal(denied.status,"error");assert.match(denied.message,/CASHIER_SHIFT_MODE_CHANGED|open shift/i);
      assert.equal(await db.invoice.count({where:{businessId:f.business.id}}),0);
      await db.cashierShift.update({where:{id:f.shift.id},data:{status:"OPEN"}});
    }
    const result = await h.appointments.recordSalonAppointmentPaymentAction({ status: "idle", message: "", invoiceId: null, invoice: null }, form);
    assert.equal(result.status, "success", result.message);
    const payments = await db.payment.findMany({ where: { invoiceId: result.invoiceId! }, orderBy: { amount: "asc" } });
    assert.deepEqual(payments.map(p => [p.amount.toFixed(2), p.shiftId, p.branchId, p.cashierId]), [["10.00", mode === "ON" ? f.shift.id : null, f.branch.id, f.actor.id], ["30.00", mode === "ON" ? f.shift.id : null, f.branch.id, f.actor.id]]);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: result.invoiceId! } });
    assert.equal(invoice.total.toFixed(2), "40.00");
    assert.equal(invoice.balance.toFixed(2), "0.00");
  } finally { await h.close(); }
});

test("Cashier OFF posts Cash with null shift, preserves settlement and replays after mode changes", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await checkoutFixture(db, "CASH");
    await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED", endedAt: new Date() } });
    await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: false } });
    await h.login(db, f);
    f.form.set("walletAmount", "0");
    f.form.set("modeAtConfirmation", "OFF");
    f.form.set("shiftId", "");
    const result = await h.action.completeCashierSaleAction(f.form);
    assert.equal(result.status, "success", result.message);
    const invoice = await db.invoice.findFirstOrThrow({ where: { businessId: f.business.id } });
    assert.equal(invoice.total.toFixed(2), "40.00");
    assert.equal(invoice.paidAmount.toFixed(2), "40.00");
    assert.equal(invoice.balance.toFixed(2), "0.00");
    const payments = await db.payment.findMany({ where: { invoiceId: invoice.id } });
    assert.equal(payments.length, 1);
    assert.equal(payments[0].shiftId, null);
    assert.equal(payments[0].branchId, f.branch.id);
    assert.equal(payments[0].cashierId, f.actor.id);
    assert.equal(payments[0].amount.toFixed(2), "40.00");
    assert.equal(await db.cashierShift.count({ where: { businessId: f.business.id } }), 1);
    const original = await db.financialOperation.findFirstOrThrow({ where: { businessId: f.business.id, operationType: "CASHIER_CHECKOUT" } });
    await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: true } });
    assert.deepEqual(await h.action.completeCashierSaleAction(f.form), result);
    assert.deepEqual(await db.financialOperation.findUniqueOrThrow({ where: { id: original.id } }), original);
    assert.equal(await db.payment.count({ where: { invoiceId: invoice.id } }), 1);
  } finally { await h.close(); }
});

test("Cashier rejects a changed confirmation mode before creating financial facts", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await checkoutFixture(db, "CASH");
    await h.login(db, f);
    f.form.set("walletAmount", "0");
    f.form.set("modeAtConfirmation", "OFF");
    f.form.set("shiftId", "");
    const result = await h.action.completeCashierSaleAction(f.form);
    assert.equal(result.status, "error");
    assert.match(result.message, /CASHIER_SHIFT_MODE_CHANGED/);
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 0);
    assert.equal(await db.financialOperation.count({ where: { businessId: f.business.id, operationType: "CASHIER_CHECKOUT" } }), 0);
    const current=await h.action.cashierActivityOptionsAction(f.branch.id);
    assert.equal(current.ok,true);
    if(current.ok){
      assert.equal(current.activity.modeAtConfirmation,"ON");
      f.form.set("modeAtConfirmation",current.activity.modeAtConfirmation); f.form.set("shiftId",current.activity.shiftId??"");
    }
    const confirmed=await h.action.completeCashierSaleAction(f.form);
    assert.equal(confirmed.status,"success",confirmed.message);
    assert.deepEqual(await h.action.completeCashierSaleAction(f.form),confirmed);
    assert.equal(await db.invoice.count({where:{businessId:f.business.id}}),1);
  } finally { await h.close(); }
});
