import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase, walletFixture } from "../helpers/wallet-fixture";
import { checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";

assert.equal(process.env.TETAMU_WALLET_LOCAL_TEST, "true", "Disposable runner required");
const db = walletTestDatabase();
process.env.TETAMU_PERFORMANCE_PHASE1 = "true";
after(() => db.$disconnect());
const cents = (value: unknown) => Math.round(Number(value) * 100);

async function fixture(options: { quantity?: number; covered?: number; price?: number; product?: number; tax?: boolean; points?: number } = {}) {
  const f = await walletFixture(db);
  await db.business.update({ where: { id: f.business.id }, data: { sstEnabled: options.tax ?? false, sstRate: 6 } });
  await db.loyaltyProgram.create({ data: { businessId: f.business.id, enabled: true, pointsPerRinggit: 1,
    redemptionEnabled: true, redemptionPointsPerRinggit: 100, minimumRedemptionPoints: 1 } });
  const member = await db.customerMembership.create({ data: { businessId: f.business.id, customerId: f.customer.id, pointsBalance: 50000 } });
  const service = await db.service.create({ data: { businessId: f.business.id, name: "Covered service", price: options.price ?? 100, taxable: true } });
  const visit = await db.appointment.create({ data: { businessId: f.business.id, branchId: f.branch.id,
    customerId: f.customer.id, assignedStaffId: f.actor.id, serviceId: service.id, serviceIds: [service.id],
    scheduledAt: new Date(), status: "COMPLETED" } });
  const pkg = await db.package.create({ data: { businessId: f.business.id, name: "Five service entitlement", serviceId: service.id, price: 200, totalUses: 5 } });
  const form = new FormData();
  for (const [key, value] of Object.entries({ operationId: randomUUID(), branchId: f.branch.id, customerId: f.customer.id,
    modeAtConfirmation: "ON", shiftId: f.shift.id, method: "CASH", paymentMethodCode: "BUILTIN_CASH", appointmentId: visit.id, assignedStaffId: f.actor.id,
    serviceId: service.id, serviceQuantity: String(options.quantity ?? 1), loyaltyPoints: String(options.points ?? 1000),
    performanceAttribution: JSON.stringify({ version: 1, sales: [], unassignedReason: "Disposable points eligibility test" }) })) form.set(key, value);
  const balances: { id: string; customerPackageId: string }[] = [];
  for (let index = 0; index < (options.covered ?? 1); index++) {
    const entitlement = await db.customerPackage.create({ data: { businessId: f.business.id, customerId: f.customer.id,
      packageId: pkg.id, branchId: f.branch.id, purchasePrice: 200, totalUses: 5, remainingUses: 5, status: "ACTIVE" } });
    const balance = await db.customerPackageServiceBalance.create({ data: { businessId: f.business.id,
      customerPackageId: entitlement.id, serviceId: service.id, totalUses: 5, remainingUses: 5 } });
    balances.push(balance);
    // The existing form contract names balance IDs customerPackageId; each selected entitlement covers one unit.
    form.append("customerPackageId", balance.id);
  }
  if (options.product !== undefined) {
    const product = await db.product.create({ data: { businessId: f.business.id, name: "Uncovered product", sku: randomUUID(), price: options.product, taxable: true } });
    form.set("productId", product.id); form.set("productQuantity", "1");
  }
  return { ...f, member, service, pkg, balances, form };
}

async function snapshot(businessId: string) {
  const where = { businessId }, orderBy = { id: "asc" as const };
  return JSON.stringify(await Promise.all([
    db.invoice.findMany({ where, orderBy }), db.invoiceItem.findMany({ where, orderBy }), db.payment.findMany({ where, orderBy }),
    db.customerPackage.findMany({ where, orderBy }), db.customerPackageServiceBalance.findMany({ where, orderBy }),
    db.customerMembership.findMany({ where, orderBy }), db.loyaltyTransaction.findMany({ where, orderBy }),
    db.walletAccount.findMany({ where, orderBy }), db.walletTransaction.findMany({ where, orderBy }),
    db.financialOperation.findMany({ where, orderBy }), db.auditLog.findMany({ where, orderBy }),
    db.performanceReceipt.findMany({ where, orderBy }), db.appointment.findMany({ where, orderBy }),
  ]), (_key, value) => typeof value === "bigint" ? value.toString() : value);
}

const cases: (Parameters<typeof fixture>[0] & { name: string; total: number; coverage: number; payable: number; redeemed: number; discount: number; taxCents: number })[] = [
  { name: "full coverage never burns points or reduces voucher value", quantity: 1, covered: 1, total: 10000, coverage: 10000, payable: 0, redeemed: 0, discount: 0, taxCents: 0 },
  { name: "qty2 voucher1 discounts only uncovered unit", quantity: 2, covered: 1, total: 19000, coverage: 10000, payable: 9000, redeemed: 1000, discount: 1000, taxCents: 0 },
  { name: "qty3 voucher1 leaves two eligible units", quantity: 3, covered: 1, total: 29000, coverage: 10000, payable: 19000, redeemed: 1000, discount: 1000, taxCents: 0 },
  { name: "qty3 voucher2 consumes two distinct entitlements", quantity: 3, covered: 2, total: 29000, coverage: 20000, payable: 9000, redeemed: 1000, discount: 1000, taxCents: 0 },
  { name: "mixed product receives all points when service fully covered", product: 100, total: 19000, coverage: 10000, payable: 9000, redeemed: 1000, discount: 1000, taxCents: 0 },
  { name: "mixed product and uncovered service quantity remain eligible", product: 100, quantity: 2, total: 29000, coverage: 10000, payable: 19000, redeemed: 1000, discount: 1000, taxCents: 0 },
  { name: "SST on fully covered service is preserved", tax: true, total: 10600, coverage: 10600, payable: 0, redeemed: 0, discount: 0, taxCents: 600 },
  { name: "SST qty2 voucher1 preserves covered tax", tax: true, quantity: 2, total: 20140, coverage: 10600, payable: 9540, redeemed: 1000, discount: 1000, taxCents: 1140 },
  { name: "SST qty3 voucher1 preserves covered tax", tax: true, quantity: 3, total: 30740, coverage: 10600, payable: 20140, redeemed: 1000, discount: 1000, taxCents: 1740 },
  { name: "SST qty3 voucher2 preserves both covered taxes", tax: true, quantity: 3, covered: 2, total: 30740, coverage: 21200, payable: 9540, redeemed: 1000, discount: 1000, taxCents: 1740 },
  { name: "mixed taxable service full coverage does not inherit product points", tax: true, product: 100, total: 20140, coverage: 10600, payable: 9540, redeemed: 1000, discount: 1000, taxCents: 1140 },
  { name: "odd cents residual stays in uncovered service and product", price: 33.33, product: 33.34, quantity: 3, covered: 2, total: 12333, coverage: 6666, payable: 5667, redeemed: 1000, discount: 1000, taxCents: 0 },
  { name: "odd cents plus SST reconcile after partial coverage", price: 33.33, quantity: 3, points: 100, tax: true, total: 10493, coverage: 3533, payable: 6960, redeemed: 100, discount: 100, taxCents: 594 },
  { name: "redemption cap is uncovered value only", quantity: 3, covered: 2, points: 50000, total: 20000, coverage: 20000, payable: 0, redeemed: 10000, discount: 10000, taxCents: 0 },
  { name: "no points preserves partial package baseline", quantity: 3, covered: 2, points: 0, tax: true, total: 31800, coverage: 21200, payable: 10600, redeemed: 0, discount: 0, taxCents: 1800 },
];

for (const row of cases) test(`Points eligibility: ${row.name}`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(row); await h.login(db, f);
    const result = await h.action.completeCashierSaleAction(f.form);
    assert.equal(result.status, "success", result.message);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: result.invoice!.id } });
    assert.equal(invoice.loyaltyPointsRedeemed, row.redeemed);
    assert.equal(cents(invoice.loyaltyDiscountAmount), row.discount);
    assert.equal(cents(invoice.taxAmount), row.taxCents);
    assert.equal(cents(invoice.total), row.total);
    assert.equal(cents(invoice.subtotal) - cents(invoice.discountAmount) + cents(invoice.taxAmount) + cents(invoice.tipAmount), row.total);
    const items = await db.invoiceItem.findMany({ where: { invoiceId: invoice.id } });
    assert.equal(items.reduce((sum, item) => sum + cents(item.taxAmount), 0), row.taxCents);
    if (row.tax && row.product === 100 && (row.quantity ?? 1) === 1) {
      assert.equal(cents(items.find(item => item.serviceId === f.service.id)!.taxAmount), 600);
      assert.equal(cents(items.find(item => item.productId)!.taxAmount), 540);
    }
    const payments = await db.payment.findMany({ where: { invoiceId: invoice.id } });
    assert.equal(payments.filter(p => p.method === "PACKAGE").length, row.covered ?? 1);
    assert.ok(payments.filter(p => p.method === "PACKAGE").every(p => p.packageUses === 1));
    assert.equal(payments.filter(p => p.method === "PACKAGE").reduce((sum, p) => sum + cents(p.amount), 0), row.coverage);
    assert.equal(payments.filter(p => p.method !== "PACKAGE").reduce((sum, p) => sum + cents(p.amount), 0), row.payable);
    assert.equal(payments.reduce((sum, p) => sum + cents(p.amount), 0), row.total);
    const facts = await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id } });
    assert.equal(facts.filter(p => p.type === "REDEEM").length, row.redeemed ? 1 : 0);
    assert.equal(facts.filter(p => p.type === "REDEEM").reduce((sum, p) => sum + p.points, 0), row.redeemed ? -row.redeemed : 0);
    assert.ok(facts.filter(p => p.type === "EARN").every(p => payments.find(payment => payment.id === p.paymentId)?.method !== "PACKAGE"));
    assert.equal((await db.customerMembership.findUniqueOrThrow({ where: { id: f.member.id } })).pointsBalance,
      50000 - row.redeemed + facts.filter(p => p.type === "EARN").reduce((sum, p) => sum + p.points, 0));
    if (row.payable === 0) assert.equal(facts.filter(p => p.type === "EARN").length, 0, "Package tender must never earn points");
    for (const balance of f.balances) {
      assert.equal((await db.customerPackageServiceBalance.findUniqueOrThrow({ where: { id: balance.id } })).remainingUses, 4);
      assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: balance.customerPackageId } })).remainingUses, 4);
    }
    const afterSale = await snapshot(f.business.id);
    assert.equal((await h.action.completeCashierSaleAction(f.form)).invoice?.id, invoice.id);
    assert.equal(await snapshot(f.business.id), afterSale, "Same operation replay must preserve every financial fact");
  } finally { await h.close(); }
});

async function purchaseFixture(tender: "cash" | "wallet" | "split") {
  const f = await fixture({ covered: 0 });
  if (tender !== "cash") {
    await postWalletTopUp(f.ctx, f.input, db);
    assert.equal(await db.loyaltyTransaction.count({ where: { businessId: f.business.id } }), 0, "Wallet top-up earns no points");
  }
  f.form.delete("serviceId"); f.form.delete("serviceQuantity");
  f.form.delete("appointmentId"); f.form.delete("assignedStaffId");
  f.form.set("packageId", f.pkg.id); f.form.set("packageQuantity", "1");
  if (tender !== "cash") f.form.set("walletAmount", tender === "wallet" ? "190" : "100");
  if (tender === "wallet") { f.form.set("method", "MEMBER_WALLET"); f.form.set("paymentMethodCode", "MEMBER_WALLET"); }
  return f;
}

for (const tender of ["cash", "wallet", "split"] as const) test(`Package PURCHASE plus points remains eligible with ${tender}`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await purchaseFixture(tender); await h.login(db, f);
    const result = await h.action.completeCashierSaleAction(f.form);
    assert.equal(result.status, "success", result.message);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: result.invoice!.id } });
    assert.equal(cents(invoice.total), 19000); assert.equal(invoice.loyaltyPointsRedeemed, 1000);
    assert.equal(cents(invoice.loyaltyDiscountAmount), 1000);
    const payments = await db.payment.findMany({ where: { invoiceId: invoice.id } });
    const expected = tender === "cash" ? [["CASH", 19000]] : tender === "wallet" ? [["MEMBER_WALLET", 19000]] : [["CASH", 9000], ["MEMBER_WALLET", 10000]];
    assert.deepEqual(payments.map(p => [p.method, cents(p.amount)]).sort(), expected);
    const packages = await db.customerPackage.findMany({ where: { businessId: f.business.id } });
    assert.equal(packages.length, 1); assert.equal(packages[0].status, "ACTIVE");
    assert.equal(packages[0].remainingUses, 5); assert.equal(packages[0].totalUses, 5);
    assert.ok(payments.every(p => p.customerPackageId === packages[0].id));
    const balances = await db.customerPackageServiceBalance.findMany({ where: { businessId: f.business.id } });
    assert.equal(balances.length, 1); assert.equal(balances[0].remainingUses, 5);
    const facts = await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id } });
    assert.equal(facts.filter(p => p.type === "REDEEM").length, 1);
    assert.equal(facts.filter(p => p.type === "REDEEM").reduce((sum, p) => sum + p.points, 0), -1000);
    assert.equal(facts.filter(p => p.type === "EARN").reduce((sum, p) => sum + p.points, 0), 190);
    assert.equal((await db.customerMembership.findUniqueOrThrow({ where: { id: f.member.id } })).pointsBalance, 49190);
    if (tender !== "cash") {
      const account = await db.walletAccount.findFirstOrThrow({ where: { businessId: f.business.id } });
      assert.equal(cents(account.paidBalance), tender === "wallet" ? 91000 : 100000);
      assert.equal(cents(account.bonusBalance), 0);
      const debit = await db.walletTransaction.findMany({ where: { businessId: f.business.id, type: "REDEMPTION" } });
      assert.equal(debit.length, 1);
    }
    const completed = await snapshot(f.business.id);
    assert.equal((await h.action.completeCashierSaleAction(f.form)).invoice?.id, invoice.id);
    assert.equal(await snapshot(f.business.id), completed);
  } finally { await h.close(); }
});

for (const failure of [
  { kind: "redemption", model: "customerPackageServiceBalance", method: "updateMany", call: 1 },
  { kind: "redemption", model: "payment", method: "create", call: 2 },
  { kind: "redemption", model: "loyaltyTransaction", method: "create", call: 1 },
  { kind: "redemption", model: "loyaltyTransaction", method: "create", call: 2 },
  { kind: "purchase", model: "customerPackage", method: "create", call: 1 },
  { kind: "purchase", model: "walletTransaction", method: "create", call: 1 },
  { kind: "purchase", model: "loyaltyTransaction", method: "create", call: 2 },
] as const) test(`Rollback ${failure.kind} after ${failure.model}.${failure.method} #${failure.call} preserves every financial fact`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = failure.kind === "purchase" ? await purchaseFixture("split") : await fixture({ quantity: 2 });
    await h.login(db, f);
    const before = await snapshot(f.business.id);
    h.failAfter(failure.model, failure.method, failure.call);
    const result = await h.action.completeCashierSaleAction(f.form);
    assert.equal(result.status, "error"); assert.equal(h.injections(), 1, "The intended transactional write must be reached");
    assert.equal(await snapshot(f.business.id), before, "Invoice, tender, points, package, wallet and operation changes must roll back together");
  } finally { await h.close(); }
});

for (const discountType of ["AMOUNT", "PERCENT"] as const) test(`Manual ${discountType} allocation precedes partial voucher and points`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture({ quantity: 2 }); await h.login(db, f);
    f.form.set("discountType", discountType); f.form.set("discountValue", discountType === "AMOUNT" ? "20" : "10");
    f.form.set("discountReference", "Approved synthetic manual discount");
    const result = await h.action.completeCashierSaleAction(f.form);
    assert.equal(result.status, "success", result.message);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: result.invoice!.id } });
    assert.equal(cents(invoice.subtotal), 20000); assert.equal(cents(invoice.discountAmount), 3000);
    assert.equal(invoice.loyaltyPointsRedeemed, 1000); assert.equal(cents(invoice.loyaltyDiscountAmount), 1000);
    assert.equal(cents(invoice.total), 17000);
    const payments = await db.payment.findMany({ where: { invoiceId: invoice.id } });
    assert.deepEqual(payments.map(p => [p.method, cents(p.amount)]).sort(), [["CASH", 8000], ["PACKAGE", 9000]],
      "Existing manual allocation reduces both units by RM10; points reduce only the uncovered unit");
    const redemption = await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id, type: "REDEEM" } });
    assert.equal(redemption.length, 1); assert.equal(redemption[0].points, -1000);
  } finally { await h.close(); }
});

for (const allowLoyaltyStacking of [true, false]) test(`Catalog partial voucher checkout honors allowLoyaltyStacking=${allowLoyaltyStacking}`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture({ quantity: 2 }); await h.login(db, f);
    const discount = await db.catalogDiscount.create({ data: { businessId: f.business.id, branchId: f.branch.id,
      name: "Synthetic ten percent catalog discount", discountType: "PERCENTAGE", percentage: 10, scope: "ALL", allowLoyaltyStacking } });
    f.form.set("catalogDiscountId", discount.id);
    const before = await snapshot(f.business.id);
    const result = await h.action.completeCashierSaleAction(f.form);
    if (!allowLoyaltyStacking) {
      assert.equal(result.status, "error");
      assert.match(result.message, /cannot be combined with loyalty/i);
      assert.equal(await snapshot(f.business.id), before);
      return;
    }
    assert.equal(result.status, "success", result.message);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: result.invoice!.id } });
    assert.equal(cents(invoice.discountAmount), 3000); assert.equal(cents(invoice.loyaltyDiscountAmount), 1000);
    assert.equal(invoice.loyaltyPointsRedeemed, 1000); assert.equal(cents(invoice.total), 17000);
    const payments = await db.payment.findMany({ where: { invoiceId: invoice.id } });
    assert.deepEqual(payments.map(p => [p.method, cents(p.amount)]).sort(), [["CASH", 8000], ["PACKAGE", 9000]]);
    const redemption = await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id, type: "REDEEM" } });
    assert.equal(redemption.length, 1); assert.equal(redemption[0].points, -1000);
  } finally { await h.close(); }
});

test("Server rejects two voucher entitlements for one service unit without financial mutation", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture({ quantity: 1, covered: 2 }); await h.login(db, f);
    // Even invented client coverage hints cannot authorize using more entitlements than the actual cart quantity.
    f.form.set("packageCoveredQuantity", "2"); f.form.set("pointsEligibleAmount", "100");
    const before = await snapshot(f.business.id);
    const result = await h.action.completeCashierSaleAction(f.form);
    assert.equal(result.status, "error");
    assert.equal(await snapshot(f.business.id), before);
  } finally { await h.close(); }
});

test("Balance below one redeemable ringgit produces zero invoice points and no REDEEM", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture({ quantity: 2 }); await h.login(db, f);
    await db.customerMembership.update({ where: { id: f.member.id }, data: { pointsBalance: 50 } });
    const result = await h.action.completeCashierSaleAction(f.form);
    assert.equal(result.status, "success", result.message);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: result.invoice!.id } });
    assert.equal(invoice.loyaltyPointsRedeemed, 0); assert.equal(cents(invoice.loyaltyDiscountAmount), 0);
    assert.equal(cents(invoice.total), 20000);
    const payments = await db.payment.findMany({ where: { invoiceId: invoice.id } });
    assert.deepEqual(payments.map(p => [p.method, cents(p.amount)]).sort(), [["CASH", 10000], ["PACKAGE", 10000]]);
    assert.equal(await db.loyaltyTransaction.count({ where: { businessId: f.business.id, type: "REDEEM" } }), 0);
    assert.equal((await db.customerMembership.findUniqueOrThrow({ where: { id: f.member.id } })).pointsBalance, 150,
      "The original 50 points remain, and the RM100 cash payment earns the existing 100 points");
  } finally { await h.close(); }
});
