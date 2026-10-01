import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { refundWalletSale } from "../../src/lib/wallet/refunds";
import { awardLoyaltyPointsForPayment } from "../../src/lib/loyalty/service";
const db = walletTestDatabase();
after(() => db.$disconnect());

test("unrelated invoice earnings end the refund sequence without collecting a points debt", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db); await h.login(db, f);
    await db.loyaltyProgram.upsert({ where: { businessId: f.business.id },
      create: { businessId: f.business.id, enabled: true, pointsPerRinggit: 1, welcomePoints: 0, redemptionEnabled: true, redemptionPointsPerRinggit: 1, minimumRedemptionPoints: 1 },
      update: { enabled: true, pointsPerRinggit: 1, welcomePoints: 0, redemptionEnabled: true, redemptionPointsPerRinggit: 1, minimumRedemptionPoints: 1 } });
    const member = await db.customerMembership.create({ data: { businessId: f.business.id, customerId: f.customer.id, pointsBalance: 3 } });
    await db.product.update({ where: { id: f.product.id }, data: { price: 13 } });
    f.form.set("walletAmount", "10"); f.form.set("loyaltyPoints", "3");
    const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
    await db.customerMembership.update({ where: { id: member.id }, data: { pointsBalance: 0 } });
    const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: sale.invoice!.id, method: "MEMBER_WALLET" } });
    const refund = (amountCents: number) => refundWalletSale(f.ctx, { operationKey: randomUUID(), invoiceId: sale.invoice!.id,
      reason: "P1F unrelated activity", stockLines: [], legs: [{ paymentId: payment.id, method: "MEMBER_WALLET", amountCents }] }, db);
    await refund(300);
    assert.equal((await db.customerMembership.findUniqueOrThrow({ where: { id: member.id } })).pointsBalance, 0);
    await db.product.update({ where: { id: f.product.id }, data: { price: 10 } });
    f.form.set("operationId", randomUUID()); f.form.delete("loyaltyPoints");
    const other = await h.action.completeCashierSaleAction(f.form); assert.equal(other.status, "success", other.message);
    assert.equal((await db.customerMembership.findUniqueOrThrow({ where: { id: member.id } })).pointsBalance, 10);
    await refund(40);
    assert.equal((await db.customerMembership.findUniqueOrThrow({ where: { id: member.id } })).pointsBalance, 11,
      "past clamped reversals must not consume newly earned points from another invoice");
  } finally { await h.close(); }
});

test("concurrent half refunds atomically restore 100 and reverse 10 exactly once", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db, "CARD"); await h.login(db, f);
    await db.loyaltyProgram.upsert({ where: { businessId: f.business.id },
      create: { businessId: f.business.id, enabled: true, pointsPerRinggit: 1, welcomePoints: 0, redemptionEnabled: true, redemptionPointsPerRinggit: 100, minimumRedemptionPoints: 100 },
      update: { enabled: true, pointsPerRinggit: 1, welcomePoints: 0, redemptionEnabled: true, redemptionPointsPerRinggit: 100, minimumRedemptionPoints: 100 } });
    const member = await db.customerMembership.create({ data: { businessId: f.business.id, customerId: f.customer.id, pointsBalance: 100 } });
    await db.product.update({ where: { id: f.product.id }, data: { price: 11 } });
    f.form.set("walletAmount", "5"); f.form.set("loyaltyPoints", "100");
    const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
    await db.customerMembership.update({ where: { id: member.id }, data: { pointsBalance: 0 } });
    const payments = await db.payment.findMany({ where: { invoiceId: sale.invoice!.id } });
    const requests = payments.map(payment => ({ operationKey: randomUUID(), invoiceId: sale.invoice!.id,
      reason: "P1F simultaneous halves", stockLines: [], legs: [{ paymentId: payment.id, method: payment.method as "CARD" | "MEMBER_WALLET", amountCents: 500, reference: "synthetic" }] }));
    const results = await Promise.all(requests.map(request => refundWalletSale(f.ctx, request, db)));
    assert.deepEqual(await Promise.all(requests.map(request => refundWalletSale(f.ctx, request, db))), results);
    assert.equal((await db.customerMembership.findUniqueOrThrow({ where: { id: member.id } })).pointsBalance, 90);
    const facts = await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id } });
    assert.equal(facts.filter(row => row.type === "REDEMPTION_REFUND").reduce((n, row) => n + row.points, 0), 100);
    assert.equal(facts.filter(row => row.type === "REFUND_REVERSAL").reduce((n, row) => n + row.points, 0), -10);
    assert.equal(await db.paymentRefund.count({ where: { invoiceId: sale.invoice!.id } }), 2);
  } finally { await h.close(); }
});

test("partial cumulative refunds are independent of batching at point-rounding boundaries", async () => {
  const h = await checkoutHarness();
  try {
    const balances: number[] = [];
    for (const amounts of [[340], [300, 40], [100, 200, 40]]) {
      const f = await checkoutFixture(db); await h.login(db, f);
      await db.loyaltyProgram.upsert({ where: { businessId: f.business.id },
        create: { businessId: f.business.id, enabled: true, pointsPerRinggit: 1, welcomePoints: 0, redemptionEnabled: true, redemptionPointsPerRinggit: 1, minimumRedemptionPoints: 1 },
        update: { enabled: true, pointsPerRinggit: 1, welcomePoints: 0, redemptionEnabled: true, redemptionPointsPerRinggit: 1, minimumRedemptionPoints: 1 } });
      const member = await db.customerMembership.create({ data: { businessId: f.business.id, customerId: f.customer.id, pointsBalance: 3 } });
      await db.product.update({ where: { id: f.product.id }, data: { price: 13 } });
      f.form.set("walletAmount", "10"); f.form.set("loyaltyPoints", "3");
      const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
      await db.customerMembership.update({ where: { id: member.id }, data: { pointsBalance: 0 } });
      const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: sale.invoice!.id, method: "MEMBER_WALLET" } });
      for (const amountCents of amounts) {
        const request = { operationKey: randomUUID(), invoiceId: sale.invoice!.id,
          reason: "P1F cumulative rounding boundary", stockLines: [],
          legs: [{ paymentId: payment.id, method: "MEMBER_WALLET" as const, amountCents }] };
        const result = await refundWalletSale(f.ctx, request, db);
        const beforeReplay = await db.customerMembership.findUniqueOrThrow({ where: { id: member.id } });
        assert.deepEqual(await refundWalletSale(f.ctx, request, db), result);
        assert.deepEqual(await db.customerMembership.findUniqueOrThrow({ where: { id: member.id } }), beforeReplay);
        await db.loyaltyProgram.update({ where: { businessId: f.business.id }, data: { pointsPerRinggit: 999 } });
      }
      balances.push((await db.customerMembership.findUniqueOrThrow({ where: { id: member.id } })).pointsBalance);
    }
    assert.deepEqual(balances, [0, 0, 0], "RM3.40 refunded in different batches must have the same visible balance");
  } finally { await h.close(); }
});

test("top-up cannot earn points even if the generic sales hook is invoked", async () => {
  const f = await checkoutFixture(db);
  await db.loyaltyProgram.upsert({ where: { businessId: f.business.id }, create: { businessId: f.business.id, enabled: true, pointsPerRinggit: 1, welcomePoints: 0 }, update: { enabled: true, pointsPerRinggit: 1, welcomePoints: 0 } });
  const payment = await db.payment.findFirstOrThrow({ where: { businessId: f.business.id, purpose: "WALLET_TOP_UP" } });
  await db.$transaction(tx => awardLoyaltyPointsForPayment(tx, { businessId: f.business.id, customerId: f.customer.id, paymentId: payment.id, paymentMethod: payment.method, amountCents: Number(payment.amount) * 100 }));
  assert.equal(await db.loyaltyTransaction.count({ where: { businessId: f.business.id } }), 0);
});

for (const corruption of ["missing", "duplicate", "changed basis"] as const) {
  test(`Wallet refund fails closed and rolls back funds when loyalty evidence is ${corruption}`, async () => {
    const h = await checkoutHarness();
    try {
      const f = await checkoutFixture(db); await h.login(db, f);
      const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
      const audit = await db.auditLog.findFirstOrThrow({ where: { businessId: f.business.id, action: "WALLET_LOYALTY_SETTLED" } });
      // Deliberate corruption of disposable synthetic data, never a product mutation path.
      if (corruption === "missing") await db.auditLog.delete({ where: { id: audit.id } });
      else if (corruption === "duplicate") await db.auditLog.create({ data: {
        businessId: audit.businessId, branchId: audit.branchId, action: audit.action,
        entityType: audit.entityType, entityId: audit.entityId, status: audit.status,
        summary: audit.summary, metadata: audit.metadata as never,
      } });
      else await db.auditLog.update({ where: { id: audit.id }, data: { metadata: { ...(audit.metadata as object), eligibleCents: 1 } } });
      const before = await db.walletAccount.findFirstOrThrow({ where: { businessId: f.business.id } });
      const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: sale.invoice!.id, method: "MEMBER_WALLET" } });
      await assert.rejects(refundWalletSale(f.ctx, { operationKey: randomUUID(), invoiceId: sale.invoice!.id, reason: "P1F invalid evidence", stockLines: [], legs: [{ paymentId: payment.id, method: "MEMBER_WALLET", amountCents: 100 }] }, db), /loyalty.*evidence/i);
      assert.deepEqual(await db.walletAccount.findUniqueOrThrow({ where: { id: before.id } }), before);
      assert.equal(await db.paymentRefund.count({ where: { businessId: f.business.id } }), 0);
      assert.equal(await db.walletTransaction.count({ where: { businessId: f.business.id, type: "REFUND" } }), 0);
    } finally { await h.close(); }
  });
}

test("wallet split earn uses the whole invoice and cumulative refunds use original points after a rate change", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db, "CARD"); await h.login(db, f);
    await db.loyaltyProgram.upsert({ where: { businessId: f.business.id }, create: { businessId: f.business.id, enabled: true, pointsPerRinggit: 1, welcomePoints: 0 }, update: { enabled: true, pointsPerRinggit: 1, welcomePoints: 0 } });
    await db.product.update({ where: { id: f.product.id }, data: { price: "1.20" } });
    f.form.set("walletAmount", "0.60");
    const sale = await h.action.completeCashierSaleAction(f.form);
    assert.equal(sale.status, "success", sale.message);
    const payments = await db.payment.findMany({ where: { invoiceId: sale.invoice!.id }, orderBy: { id: "asc" } });
    const earned = await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id, type: "EARN" } });
    assert.equal(earned.reduce((sum, row) => sum + row.points, 0), 1);
    assert.equal(await db.auditLog.count({ where: { businessId: f.business.id, action: "WALLET_LOYALTY_SETTLED", entityId: sale.invoice!.id } }), 1);
    await db.loyaltyProgram.update({ where: { businessId: f.business.id }, data: { pointsPerRinggit: 100 } });
    await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
    for (let i = 0; i < payments.length; i++) {
      const payment = payments[i];
      const request = { operationKey: randomUUID(), invoiceId: sale.invoice!.id, reason: "P1F loyalty refund", stockLines: [], legs: [{ paymentId: payment.id, amountCents: 60, method: payment.method as "MEMBER_WALLET" | "CARD", reference: "P1F refund" }] };
      const result = await refundWalletSale(f.ctx, request, db);
      assert.deepEqual(await refundWalletSale(f.ctx, request, db), result);
      const reversals = await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id, type: "REFUND_REVERSAL" } });
      assert.equal(reversals.reduce((sum, row) => sum - row.points, 0), i === 0 ? 0 : 1);
    }
    assert.equal((await db.customerMembership.findFirstOrThrow({ where: { businessId: f.business.id, customerId: f.customer.id } })).pointsBalance, 0);
  } finally { await h.close(); }
});

test("two-leg full refund restores redeemed points once when earned points have already been spent", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db, "CARD"); await h.login(db, f);
    await db.loyaltyProgram.upsert({ where: { businessId: f.business.id }, create: { businessId: f.business.id, enabled: true, pointsPerRinggit: 1, welcomePoints: 0, redemptionEnabled: true, redemptionPointsPerRinggit: 100, minimumRedemptionPoints: 100 }, update: { enabled: true, pointsPerRinggit: 1, welcomePoints: 0, redemptionEnabled: true, redemptionPointsPerRinggit: 100, minimumRedemptionPoints: 100 } });
    const member = await db.customerMembership.create({ data: { businessId: f.business.id, customerId: f.customer.id, pointsBalance: 100 } });
    await db.product.update({ where: { id: f.product.id }, data: { price: 11 } });
    f.form.set("walletAmount", "5"); f.form.set("loyaltyPoints", "100");
    const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
    const redeemed = await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id, type: "REDEEM" } });
    assert.equal(redeemed.reduce((n, row) => n - row.points, 0), 100);
    // Independent subsequent point spending is outside this invoice's refund basis.
    await db.customerMembership.update({ where: { id: member.id }, data: { pointsBalance: 0 } });
    const payments = await db.payment.findMany({ where: { invoiceId: sale.invoice!.id } });
    const request = { operationKey: randomUUID(), invoiceId: sale.invoice!.id, reason: "P1F full redeemed refund", stockLines: [], legs: payments.map(p => ({ paymentId: p.id, method: p.method as "CARD" | "MEMBER_WALLET", amountCents: Number(p.amount) * 100, reference: "synthetic" })) };
    await db.loyaltyProgram.update({ where: { businessId: f.business.id }, data: { pointsPerRinggit: 99 } });
    const result = await refundWalletSale(f.ctx, request, db);
    assert.equal((await db.customerMembership.findUniqueOrThrow({ where: { id: member.id } })).pointsBalance, 90);
    const factsBeforeReplay = await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id }, orderBy: { id: "asc" } });
    assert.deepEqual(await refundWalletSale(f.ctx, request, db), result);
    assert.deepEqual(await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id }, orderBy: { id: "asc" } }), factsBeforeReplay);
    assert.equal((await db.customerMembership.findUniqueOrThrow({ where: { id: member.id } })).pointsBalance, 90);
  } finally { await h.close(); }
});

test("separate refund operations restore the same redeemed-point balance as one full refund", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db, "CARD"); await h.login(db, f);
    await db.loyaltyProgram.upsert({ where: { businessId: f.business.id }, create: { businessId: f.business.id, enabled: true, pointsPerRinggit: 1, welcomePoints: 0, redemptionEnabled: true, redemptionPointsPerRinggit: 100, minimumRedemptionPoints: 100 }, update: { enabled: true, pointsPerRinggit: 1, welcomePoints: 0, redemptionEnabled: true, redemptionPointsPerRinggit: 100, minimumRedemptionPoints: 100 } });
    const member = await db.customerMembership.create({ data: { businessId: f.business.id, customerId: f.customer.id, pointsBalance: 100 } });
    await db.product.update({ where: { id: f.product.id }, data: { price: 11 } });
    f.form.set("walletAmount", "5"); f.form.set("loyaltyPoints", "100");
    const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
    await db.customerMembership.update({ where: { id: member.id }, data: { pointsBalance: 0 } });
    const payments = await db.payment.findMany({ where: { invoiceId: sale.invoice!.id }, orderBy: { id: "asc" } });
    for (const [index, payment] of payments.entries()) {
      await db.loyaltyProgram.update({ where: { businessId: f.business.id }, data: { pointsPerRinggit: 99 + index } });
      const request = { operationKey: randomUUID(), invoiceId: sale.invoice!.id, reason: "P1F separate cumulative refund", stockLines: [], legs: [{ paymentId: payment.id, method: payment.method as "CARD" | "MEMBER_WALLET", amountCents: Number(payment.amount) * 100, reference: "synthetic" }] };
      const result = await refundWalletSale(f.ctx, request, db);
      assert.equal((await db.customerMembership.findUniqueOrThrow({ where: { id: member.id } })).pointsBalance, (index + 1) * 45);
      const factsBeforeReplay = await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id }, orderBy: { id: "asc" } });
      assert.deepEqual(await refundWalletSale(f.ctx, request, db), result);
      assert.deepEqual(await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id }, orderBy: { id: "asc" } }), factsBeforeReplay);
      if (index === 0) {
        const audit = await db.auditLog.findFirstOrThrow({ where: { businessId: f.business.id, action: "WALLET_LOYALTY_REFUND_BALANCE" } });
        const before = await db.walletAccount.findFirstOrThrow({ where: { businessId: f.business.id } });
        const beforeMember = await db.customerMembership.findUniqueOrThrow({ where: { id: member.id } });
        await db.auditLog.update({ where: { id: audit.id }, data: { metadata: { ...(audit.metadata as object), baseBalance: 100 } } });
        const next = payments[1];
        await assert.rejects(refundWalletSale(f.ctx, { ...request, operationKey: randomUUID(), legs: [{
          paymentId: next.id, method: next.method as "CARD" | "MEMBER_WALLET", amountCents: Number(next.amount) * 100, reference: "synthetic corruption probe",
        }] }, db), /balance evidence/i);
        assert.deepEqual(await db.walletAccount.findUniqueOrThrow({ where: { id: before.id } }), before);
        assert.deepEqual(await db.customerMembership.findUniqueOrThrow({ where: { id: member.id } }), beforeMember);
        await db.auditLog.update({ where: { id: audit.id }, data: { metadata: audit.metadata as never } });
      }
    }
    const facts = await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id } });
    assert.equal(facts.filter(p => p.type === "REFUND_REVERSAL").reduce((sum, p) => sum + p.points, 0), -10);
    assert.equal(facts.filter(p => p.type === "REDEMPTION_REFUND").reduce((sum, p) => sum + p.points, 0), 100);
    assert.equal((await db.customerMembership.findUniqueOrThrow({ where: { id: member.id } })).pointsBalance, 90);
  } finally { await h.close(); }
});
