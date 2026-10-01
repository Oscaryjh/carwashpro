import { setWalletModule } from "../helpers/wallet-fixture";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { randomUUID } from "node:crypto";
const db = walletTestDatabase();
after(() => db.$disconnect());
test("Wallet transaction rechecks branch assignment and module after initial admission", async () => {
  const h = await checkoutHarness(db);
  try {
    for (const change of ["branch", "module", "role"] as const) {
      const f = await checkoutFixture(db);
      f.actor = await db.user.update({ where: { id: f.actor.id }, data: { role: "STAFF", permissions: ["POS"] } });
      await h.login(db, f);
      const other = await db.branch.create({ data: { businessId: f.business.id, name: "Synthetic reassignment" } });
      h.beforeTransaction(async () => {
        if (change === "branch") await db.user.update({ where: { id: f.actor.id }, data: { branchId: other.id } });
        else if (change === "role") await db.user.update({ where: { id: f.actor.id }, data: { role: "PLATFORM_ADMIN" } });
        else await db.businessModuleEntitlement.updateMany({ where: { businessId: f.business.id, moduleKey: "POS" }, data: { status: "DISABLED", revision: { increment: 1 } } });
      });
      const result = await h.action.completeCashierSaleAction(f.form);
      assert.equal(result.status, "error", `${change} changed after admission must deny`);
      if (change === "module") assert.equal((await db.businessModuleEntitlement.findFirstOrThrow({ where: { businessId: f.business.id, moduleKey: "POS" } })).status, "DISABLED");
      assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 0);
      assert.equal(await db.walletTransaction.count({ where: { businessId: f.business.id, type: "REDEMPTION" } }), 0);
    }
  } finally { await h.close(); }
});
test("authenticated cashier supports full Wallet and five MYR splits without duplicate checkout", async () => {
  const harness = await checkoutHarness();
  try {
    for (const method of ["MEMBER_WALLET", "CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER"]) {
      const f = await checkoutFixture(db, method); await harness.login(db, f);
      const result = await harness.action.completeCashierSaleAction(f.form);
      assert.equal(result.status, "success", `${method}: ${result.message}`);
      assert.ok(result.invoice);
      assert.equal(result.invoice.total, 40); assert.equal(result.invoice.balance, 0);
      const payments = await db.payment.findMany({ where: { invoiceId: result.invoice.id } });
      assert.equal(payments.length, method === "MEMBER_WALLET" ? 1 : 2);
      assert.equal(payments.filter(p => p.method === "MEMBER_WALLET").length, 1);
      assert.equal(payments.reduce((n, p) => n + Number(p.amount), 0), 40);
      const replay = await harness.action.completeCashierSaleAction(f.form);
      assert.equal(replay.invoice?.id, result.invoice.id);
      assert.equal(await db.walletTransaction.count({ where: { businessId: f.business.id, type: "REDEMPTION" } }), 1);
    }
  } finally { await harness.close(); }
});

test("Wallet split rejects foreign or missing configured payment ID instead of falling back to virtual Cash", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db, "CASH"); await h.login(db, f);
    f.form.set("paymentMethodId", randomUUID());
    const result = await h.action.completeCashierSaleAction(f.form);
    assert.equal(result.status, "error");
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 0);
  } finally { await h.close(); }
});

test("staff receipt privacy, actor replay binding, gate-closed replay and normal cash coexist", async () => {
  const h = await checkoutHarness();
  const flag = process.env.TETAMU_WALLET_LOCAL_TEST;
  try {
    const f = await checkoutFixture(db);
    f.actor = await db.user.update({ where: { id: f.actor.id }, data: { role: "STAFF", permissions: ["POS"] } });
    await h.login(db, f);
    const result = await h.action.completeCashierSaleAction(f.form);
    assert.equal(result.status, "success", result.message);
    assert.equal(result.invoice?.walletPaidAmount, 40);
    assert.doesNotMatch(JSON.stringify(result), /paidBalance|bonusBalance/);
    await setWalletModule(db, f.business.id, false);
    assert.equal((await h.action.completeCashierSaleAction(f.form)).status, "error");
    const cash = new FormData(); for (const [k,v] of f.form) cash.append(k,v);
    cash.set("operationId", randomUUID()); cash.delete("walletAmount"); cash.set("method", "CASH"); cash.set("paymentMethodCode", "BUILTIN_CASH");
    assert.equal((await h.action.completeCashierSaleAction(cash)).status, "success");
    await setWalletModule(db, f.business.id, true);
    const owner = await db.user.create({ data: { businessId: f.business.id, branchId: f.branch.id, name: "Other synthetic owner", role: "BUSINESS_OWNER" } });
    await h.login(db, { ...f, actor: owner });
    const replay = await h.action.completeCashierSaleAction(f.form);
    assert.equal(replay.status, "error"); assert.equal(replay.invoice, null);
    assert.equal(await db.walletTransaction.count({ where: { businessId: f.business.id, type: "REDEMPTION" } }), 1);
  } finally {  await h.close(); }
});

test("service checkout keeps completed appointment, customer and assigned staff contracts", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db); await h.login(db, f);
    const service = await db.service.create({ data: { businessId: f.business.id, name: "Synthetic service", price: 40, taxable: false } });
    const visit = await db.appointment.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id,
      assignedStaffId: f.actor.id, serviceId: service.id, serviceIds: [service.id], scheduledAt: new Date(), status: "SCHEDULED" } });
    f.form.delete("productId"); f.form.delete("productQuantity"); f.form.set("serviceId", service.id); f.form.set("serviceQuantity", "1");
    assert.equal((await h.action.completeCashierSaleAction(f.form)).status, "error");
    f.form.set("appointmentId", visit.id); f.form.set("assignedStaffId", f.actor.id);
    assert.equal((await h.action.completeCashierSaleAction(f.form)).status, "error");
    await db.appointment.update({ where: { id: visit.id }, data: { status: "COMPLETED" } });
    const result = await h.action.completeCashierSaleAction(f.form); assert.equal(result.status, "success", result.message);
    f.form.set("operationId", randomUUID());
    assert.equal((await h.action.completeCashierSaleAction(f.form)).status, "error");
    assert.equal(await db.invoice.count({ where: { appointmentId: visit.id } }), 1);
  } finally { await h.close(); }
});

test("gate, tenant, shift, amount and actor replay boundaries fail closed with no partial checkout", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db); const foreign = await checkoutFixture(db); await h.login(db, f);
    const originalFlag = process.env.TETAMU_WALLET_LOCAL_TEST;
    await setWalletModule(db, f.business.id, false);
    try { assert.match((await h.action.completeCashierSaleAction(f.form)).message, /Member Wallet is not enabled for this business/); }
    finally { await setWalletModule(db, f.business.id, true); }
    f.form.set("customerId", foreign.customer.id);
    assert.equal((await h.action.completeCashierSaleAction(f.form)).status, "error");
    f.form.set("customerId", f.customer.id); f.form.set("walletAmount", "41");
    assert.equal((await h.action.completeCashierSaleAction(f.form)).status, "error"); f.form.set("walletAmount", "40");
    await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
    assert.equal((await h.action.completeCashierSaleAction(f.form)).status, "error");
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 0);
    await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "OPEN" } });
    const success = await h.action.completeCashierSaleAction(f.form); assert.equal(success.status, "success");
    await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
    assert.equal((await h.action.completeCashierSaleAction(f.form)).invoice?.id, success.invoice?.id);
    f.form.set("reference", "changed"); assert.equal((await h.action.completeCashierSaleAction(f.form)).status, "error"); f.form.delete("reference");
    await db.user.update({ where: { id: f.actor.id }, data: { role: "STAFF", permissions: [] } });
    await assert.rejects(h.action.completeCashierSaleAction(f.form), /NEXT_REDIRECT/);
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 1);
  } finally { await h.close(); }
});

test("wallet checkout retains mandatory Loyalty and Performance calls with split payment and tip", async () => {
  const old = process.env.TETAMU_PERFORMANCE_PHASE1;
  process.env.TETAMU_PERFORMANCE_PHASE1 = "true";
  const harness = await checkoutHarness();
  try {
    const f = await checkoutFixture(db, "CASH"); await harness.login(db, f);
    await db.loyaltyProgram.upsert({ where: { businessId: f.business.id }, create: { businessId: f.business.id, enabled: true, pointsPerRinggit: 1 }, update: { enabled: true } });
    f.form.set("performanceTipAmount", "2");
    f.form.set("performanceAttribution", JSON.stringify({ version: 1, sales: [], unassignedReason: "Synthetic Local checkout compatibility check" }));
    const result = await harness.action.completeCashierSaleAction(f.form);
    assert.equal(result.status, "success", result.message);
    const payments = await db.payment.findMany({ where: { invoiceId: result.invoice!.id } });
    assert.equal(payments.reduce((sum, row) => sum + Number(row.amount), 0), 42);
    assert.equal(await db.loyaltyTransaction.count({ where: { businessId: f.business.id, type: "EARN" } }), 2);
    const receipts = await db.performanceReceipt.findMany({ where: { invoiceId: result.invoice!.id } });
    assert.equal(receipts.length, 2);
    assert.equal(receipts.reduce((sum, row) => sum + Number(row.salesCents), 0), 4000);
    assert.equal(receipts.reduce((sum, row) => sum + Number(row.tipCents), 0), 200);
  } finally { await harness.close(); if (old === undefined) delete process.env.TETAMU_PERFORMANCE_PHASE1; else process.env.TETAMU_PERFORMANCE_PHASE1 = old; }
});

test("Wallet split preserves rounding, valid staff allocation, zero-tip and required legacy rejection", async () => {
  const oldPhase = process.env.TETAMU_PERFORMANCE_PHASE1;
  const oldLegacy = process.env.TETAMU_PERFORMANCE_LEGACY_COMPAT;
  process.env.TETAMU_PERFORMANCE_PHASE1 = "true";
  process.env.TETAMU_PERFORMANCE_LEGACY_COMPAT = "false";
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db, "CARD"); await h.login(db, f);
    await db.product.update({ where: { id: f.product.id }, data: { price: "40.02" } });
    f.form.set("walletAmount", "20.99");
    await db.loyaltyProgram.create({ data: { businessId: f.business.id, enabled: true, pointsPerRinggit: 1 } });
    const rejected = await h.action.completeCashierSaleAction(f.form);
    assert.equal(rejected.status, "error"); assert.match(rejected.message, /Legacy unassigned checkout is disabled/);
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 0);
    const phone = `+60${Date.now()}`;
    const employee = await db.employeeAccount.create({ data: { name: "P1C synthetic employee", phoneNumber: phone, phoneNormalized: phone } });
    const member = await db.employeeBusinessMembership.create({ data: { businessId: f.business.id, employeeAccountId: employee.id,
      employeeCode: "P1C-EMP", fullName: employee.name, phoneNumber: phone, phoneNumberNormalized: phone, joinedAt: new Date("2026-01-01Z") } });
    await db.employeeBranchAssignment.create({ data: { businessId: f.business.id, branchId: f.branch.id, membershipId: member.id,
      isPrimary: true, canClockIn: false, effectiveFrom: new Date("2026-01-01Z") } });
    f.form.set("performanceAttribution", JSON.stringify({ version: 1, sales: [{ membershipId: member.id, basisPoints: 10000 }] }));
    const result = await h.action.completeCashierSaleAction(f.form); assert.equal(result.status, "success", result.message);
    const receipts = await db.performanceReceipt.findMany({ where: { invoiceId: result.invoice!.id } });
    assert.equal(receipts.length, 2); assert.equal(receipts.reduce((n, r) => n + Number(r.salesCents), 0), 4002);
    assert.equal(receipts.reduce((n, r) => n + Number(r.tipCents), 0), 0);
    const earned = await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id, type: "EARN" } });
    assert.equal(earned.reduce((n, r) => n + r.points, 0), 40); // P1F approved Wallet invoice flooring: floor(20.99 + 19.03).
    assert.equal(await db.performanceShare.count({ where: { businessId: f.business.id, membershipId: member.id } }), 1);
    process.env.TETAMU_PERFORMANCE_LEGACY_COMPAT = "true";
    f.form.set("operationId", randomUUID()); f.form.delete("performanceAttribution");
    assert.equal((await h.action.completeCashierSaleAction(f.form)).status, "success");
  } finally {
    await h.close();
    if (oldPhase === undefined) delete process.env.TETAMU_PERFORMANCE_PHASE1; else process.env.TETAMU_PERFORMANCE_PHASE1 = oldPhase;
    if (oldLegacy === undefined) delete process.env.TETAMU_PERFORMANCE_LEGACY_COMPAT; else process.env.TETAMU_PERFORMANCE_LEGACY_COMPAT = oldLegacy;
  }
});
