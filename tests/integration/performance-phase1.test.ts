import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { FinancialOperationType, Prisma, PrismaClient } from "@prisma/client";
import { runFinancialOperation } from "../../src/lib/financial-idempotency";
import { capturePerformanceCheckout, capturePerformanceRefund, capturePerformanceVoid } from "../../src/lib/performance/service";
import { correctPerformanceAttribution } from "../../src/lib/performance/corrections";
import type { PerformanceInput } from "../../src/lib/performance/input";
import type { Components } from "../../src/lib/performance/money";
import { readPerformanceLedger } from "../../src/lib/performance/read";
import { appendCheckoutTip } from "../../src/lib/performance/checkout-tip";
import { cents } from "../../src/lib/performance/money";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && /^\/tetamu_performance_disposable_[a-z0-9_]+$/.test(url.pathname), "Tests require an explicitly isolated local performance database.");
process.env.TETAMU_PERFORMANCE_PHASE1 = "true";
const db = new PrismaClient();
after(() => db.$disconnect());

async function fixture() {
  const suffix = randomUUID().slice(0, 8);
  const business = await db.business.create({ data: { name: `Performance ${suffix}`, slug: `performance-${suffix}`, timezone: "Asia/Kuching" } });
  const branch = await db.branch.create({ data: { businessId: business.id, name: "Performance branch" } });
  const otherBranch = await db.branch.create({ data: { businessId: business.id, name: "Other branch" } });
  const user = await db.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Owner", role: "BUSINESS_OWNER" } });
  const members = [];
  for (const code of ["A", "B", "C"]) {
    const phone = `+601${randomInt(10000000, 99999999)}`;
    const account = await db.employeeAccount.create({ data: { name: `Employee ${code}`, phoneNumber: phone, phoneNormalized: phone } });
    const member = await db.employeeBusinessMembership.create({ data: { employeeAccountId: account.id, businessId: business.id, employeeCode: code, fullName: `Employee ${code}`, phoneNumber: phone, phoneNumberNormalized: phone, joinedAt: new Date("2026-01-01Z") } });
    await db.employeeBranchAssignment.create({ data: { businessId: business.id, branchId: branch.id, membershipId: member.id, isPrimary: true, canClockIn: false, effectiveFrom: new Date("2026-01-01Z") } });
    members.push(member);
  }
  const invoice = await db.invoice.create({ data: { businessId: business.id, branchId: branch.id, invoiceNumber: `PERF-${suffix}`, subtotal: 100, taxAmount: 8, tipAmount: 10, total: 118, paidAmount: 0, balance: 118, status: "UNPAID" } });
  const context = { businessId: business.id, branchId: branch.id, actorUserId: user.id };
  return { business, branch, otherBranch, user, members, invoice, context };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const closurePeriod = { year: 2026, asOf: new Date("2028-01-01Z") };
const split = (f: Fixture, tipIndex = 0): PerformanceInput => ({ version: 1, sales: [{ membershipId: f.members[0].id, basisPoints: 5_000 }, { membershipId: f.members[1].id, basisPoints: 5_000 }], tipMembershipId: f.members[tipIndex].id });

test("coverage distinguishes empty, complete unassigned and flag-off gaps without guessing missing amounts", async () => {
  const f = await fixture();
  const empty = await readPerformanceLedger(f.context, closurePeriod, db);
  assert.equal(empty.coverageStatus, "COMPLETE"); assert.equal(empty.sourceCount, 0);
  await receive(f, "59", null);
  const complete = await readPerformanceLedger(f.context, closurePeriod, db);
  assert.equal(complete.coverageStatus, "COMPLETE"); assert.equal(complete.team.total, 5500);
  assert.equal(complete.unassignedAmount, 5500);
  assert.equal(complete.sourceDetails[0].classification, "CAPTURED_VERIFIED_UNASSIGNED");
  process.env.TETAMU_PERFORMANCE_PHASE1 = "false";
  try { await receive(f, "59", null); } finally { process.env.TETAMU_PERFORMANCE_PHASE1 = "true"; }
  const before = await Promise.all([db.payment.count(), db.performanceReceipt.count(), db.performanceContribution.count(), db.auditLog.count()]);
  const gap = await readPerformanceLedger(f.context, closurePeriod, db);
  assert.equal(gap.coverageStatus, "INCOMPLETE"); assert.equal(gap.uncapturedCount, 1);
  const missing = gap.sourceDetails.find((row) => row.classification === "UNCAPTURED")!;
  assert.equal(missing.rawCents, 5900); assert.equal(missing.qualifiedCents, null); assert.equal(missing.salesCents, null);
  assert.equal(missing.compositionStatus, "UNKNOWN"); assert.equal(gap.team.total, 5500);
  assert.deepEqual(await Promise.all([db.payment.count(), db.performanceReceipt.count(), db.performanceContribution.count(), db.auditLog.count()]), before);
});

test("read-only repeatable snapshot cannot report a false gap from concurrent source commits", async () => {
  const f = await fixture();
  let inserted = false;
  const client = db.$extends({ query: { performanceReceipt: { async findMany({ args, query }) {
    const rows = await query(args);
    if (!inserted) {
      inserted = true;
      await db.payment.create({ data: { businessId: f.business.id, branchId: f.branch.id, amount: 118, method: "CASH", paidAt: new Date("2026-08-01Z") } });
    }
    return rows;
  } } } });
  const snapshot = await readPerformanceLedger(f.context, closurePeriod, client as unknown as PrismaClient);
  assert.equal(inserted, true); assert.equal(snapshot.coverageStatus, "COMPLETE"); assert.equal(snapshot.sourceCount, 0);
  const next = await readPerformanceLedger(f.context, closurePeriod, db);
  assert.equal(next.coverageStatus, "INCOMPLETE"); assert.equal(next.uncapturedCount, 1);
  assert.equal(next.details.length, 0); assert.equal(next.sourceDetails[0].rawCents, 11800);
  await assert.rejects(readPerformanceLedger(f.context, { year: 2026, asOf: new Date("invalid") }, db), /asOf/);
});

test("coverage finds uncaptured refunds and refund-only missing original basis across years", async () => {
  const f = await fixture(); const p = await receive(f, "118");
  await db.paymentRefund.create({ data: { businessId: f.business.id, branchId: f.branch.id, paymentId: p.result.paymentId, amount: 10, method: "CASH", reason: "Uncaptured isolated test", refundedAt: new Date("2027-01-01Z") } });
  const gap = await readPerformanceLedger(f.context, { year: 2027, asOf: new Date("2028-01-01Z") }, db);
  assert.equal(gap.uncapturedCount, 1); assert.equal(gap.coverageStatus, "INCOMPLETE");
  assert.equal(gap.sourceDetails[0].rawCents, -1000); assert.equal(gap.sourceDetails[0].qualifiedCents, null);
  const g = await fixture();
  process.env.TETAMU_PERFORMANCE_PHASE1 = "false";
  let old: Awaited<ReturnType<typeof receive>>;
  try { old = await receive(g, "118"); } finally { process.env.TETAMU_PERFORMANCE_PHASE1 = "true"; }
  await refund(g, old.result.paymentId, "118");
  const pending = await readPerformanceLedger(g.context, { year: 2027, asOf: new Date("2028-01-01Z") }, db);
  assert.equal(pending.pendingCount, 1); assert.equal(pending.basisGapCount, 1); assert.equal(pending.totalsAreComplete, false);
  assert.equal(pending.sourceDetails[0].compositionStatus, "UNKNOWN");
});

test("uncaptured PACKAGE and RESTORE are explicit noncash exclusions, not missing performance", async () => {
  const f = await fixture();
  const p = await db.payment.create({ data: { businessId: f.business.id, branchId: f.branch.id, invoiceId: f.invoice.id, amount: 118, method: "PACKAGE", paidAt: new Date("2026-08-01Z") } });
  await db.paymentRefund.create({ data: { businessId: f.business.id, branchId: f.branch.id, paymentId: p.id, amount: 118, method: "PACKAGE", reason: "Restore isolated test", refundedAt: new Date("2026-08-02Z") } });
  const result = await readPerformanceLedger(f.context, closurePeriod, db);
  assert.equal(result.coverageStatus, "COMPLETE"); assert.equal(result.excludedCount, 2);
  assert.equal(result.uncapturedCount, 0); assert.equal(result.team.total, 0);
});

test("operating month/year cutoff and immutable timezone mismatches are quarantined in both periods", async () => {
  const f = await fixture();
  await db.branchAttendanceSetting.create({ data: { businessId: f.business.id, branchId: f.branch.id, latitude: 0, longitude: 0, timezone: "Pacific/Honolulu" } });
  const p = await receive(f, "59", split(f), randomUUID(), false, "2026-12-31T16:00:00Z");
  await db.branchAttendanceSetting.update({ where: { branchId: f.branch.id }, data: { timezone: "America/New_York" } });
  await receive(f, "59", split(f), randomUUID(), false, "2026-12-31T16:01:00Z");
  const original = await db.performanceReceipt.findFirstOrThrow({ where: { paymentId: p.result.paymentId } });
  assert.equal(original.localDate, "2027-01-01"); assert.equal(original.timezone, "Asia/Kuching");
  assert.equal((await readPerformanceLedger(f.context, closurePeriod, db)).sourceCount, 0);
  const limited = await readPerformanceLedger(f.context, { year: 2027, asOf: new Date("2026-12-31T16:00:00Z") }, db);
  assert.equal(limited.sourceCount, 1); assert.equal(limited.team.total, 5500);
  await db.business.update({ where: { id: f.business.id }, data: { timezone: "Pacific/Honolulu" } });
  for (const year of [2026, 2027]) {
    const result = await readPerformanceLedger(f.context, { ...closurePeriod, year }, db);
    assert.equal(result.coverageStatus, "INCOMPLETE"); assert.equal(result.pendingCount, 2);
    assert.equal(result.team.total, 0); assert.ok(result.details.every((event) => event.issues.includes("OPERATING_TIMEZONE_SNAPSHOT_MISMATCH")));
  }
  assert.deepEqual(await db.performanceReceipt.findUniqueOrThrow({ where: { id: original.id } }), original);
  await db.business.update({ where: { id: f.business.id }, data: { timezone: "Invalid/IANA" } });
  await assert.rejects(readPerformanceLedger(f.context, closurePeriod, db), /time zone/i);
});

async function receive(f: Fixture, amount: string, input: PerformanceInput | null = split(f), key = randomUUID(), fail = false, at = "2026-08-31T15:00:00Z", additionalTipCents = 0) {
  return runFinancialOperation({ ...f.context, operationType: FinancialOperationType.WORK_ORDER_PAYMENT, operationKey: key, payload: { amount, input, at, ...(additionalTipCents ? { additionalTipCents } : {}) }, execute: async (tx) => {
    if (additionalTipCents) await appendCheckoutTip(tx, f.context, { invoiceId: f.invoice.id, additionalTipCents, paymentCents: cents(amount), operationKey: key, attribution: input });
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } });
    const nextPaid = invoice.paidAmount.add(amount);
    if (nextPaid.gt(invoice.total)) throw new Error("Overpayment");
    const payment = await tx.payment.create({ data: { businessId: f.business.id, branchId: f.branch.id, invoiceId: f.invoice.id, cashierId: f.user.id, amount, method: "CASH", paidAt: new Date(at) } });
    await tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount: nextPaid, balance: invoice.total.sub(nextPaid), status: nextPaid.eq(invoice.total) ? "PAID" : "PARTIAL" } });
    await capturePerformanceCheckout(tx, { businessId: f.business.id, actorUserId: f.user.id, input, paymentIds: [payment.id] });
    if (fail) throw new Error("Injected failure after performance capture");
    return { paymentId: payment.id };
  } }, db);
}

async function refund(f: Fixture, paymentId: string, amount: string, exact?: Components, at = "2027-01-01T01:00:00Z") {
  return runFinancialOperation({ ...f.context, operationType: FinancialOperationType.PAYMENT_REFUND, operationKey: randomUUID(), payload: { paymentId, amount, exact }, execute: async (tx) => {
    const original = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { refunds: true } });
    const refunded = original.refunds.reduce((total, row) => total.add(row.amount), new Prisma.Decimal(0));
    if (refunded.add(amount).gt(original.amount)) throw new Error("Over-refund");
    const row = await tx.paymentRefund.create({ data: { paymentId, businessId: f.business.id, branchId: f.branch.id, invoiceId: f.invoice.id, processedById: f.user.id, amount, method: "CASH", reason: "Performance integration refund", refundedAt: new Date(at) } });
    const event = await capturePerformanceRefund(tx, row.id, { businessId: f.business.id, actorUserId: f.user.id, exact });
    return { refundId: row.id, eventId: event!.id };
  } }, db);
}

async function net(f: Fixture) {
  const rows = await db.performanceContribution.findMany({ where: { businessId: f.business.id } });
  return rows.reduce<Record<string, number>>((total, row) => { total[row.recipientKey] = (total[row.recipientKey] ?? 0) + Number(row.amountCents); return total; }, {});
}

test("RM118 example and a tip recipient outside sales shares; full refund restores each employee to zero", async () => {
  for (const tipIndex of [0, 2]) {
    const f = await fixture();
    const receipt = await receive(f, "118", split(f, tipIndex));
    const amounts = await net(f);
    assert.equal(amounts[f.members[0].id], tipIndex === 0 ? 6000 : 5000);
    assert.equal(amounts[f.members[1].id], 5000);
    if (tipIndex === 2) assert.equal(amounts[f.members[2].id], 1000);
    assert.equal(Object.values(amounts).reduce((a, b) => a + b, 0), 11000);
    const event = await db.performanceReceipt.findFirstOrThrow({ where: { paymentId: receipt.result.paymentId } });
    assert.equal(event.taxCents, 800n); assert.equal(event.tipCents, 1000n);
    const detail = (await readPerformanceLedger(f.context, { asOf: new Date("2028-01-01Z"), year: 2026, month: 8 }, db)).details[0];
    assert.equal(detail.allocations.find((row) => row.membershipId === f.members[0].id)?.salesReceived, 5000);
    assert.equal(detail.allocations.find((row) => row.membershipId === f.members[tipIndex].id)?.tipsReceived, 1000);
    assert.equal(detail.allocations.reduce((total, row) => total + row.total, 0), detail.totalCents);
    await refund(f, receipt.result.paymentId, "118");
    assert.ok(Object.values(await net(f)).every((amount) => amount === 0));
    assert.equal(await db.commissionSourceEvent.count({ where: { businessId: f.business.id } }), 0);
    assert.equal(await db.payrollVariablePay.count({ where: { businessId: f.business.id } }), 0);
  }
});

test("partial payment receives half the tax/tip; top-up keeps sales but names its own tip recipient", async () => {
  const f = await fixture();
  await receive(f, "59");
  const first = await db.performanceReceipt.findFirstOrThrow({ where: { businessId: f.business.id } });
  assert.equal(first.salesCents, 5000n); assert.equal(first.taxCents, 400n); assert.equal(first.tipCents, 500n);
  await receive(f, "59", { version: 1, tipMembershipId: f.members[2].id }, randomUUID(), false, "2026-09-01T01:00:00Z");
  assert.equal(await db.performanceAttribution.count({ where: { businessId: f.business.id, component: "SALE" } }), 1);
  assert.equal(await db.performanceAttribution.count({ where: { businessId: f.business.id, component: "TIP" } }), 2);
  const amounts = await net(f); assert.equal(amounts[f.members[0].id], 5500); assert.equal(amounts[f.members[1].id], 5000); assert.equal(amounts[f.members[2].id], 500);
});

test("sales correction cannot transfer tips; tip correction is explicitly payment scoped and refund aware", async () => {
  const f = await fixture(); const original = await receive(f, "118");
  await refund(f, original.result.paymentId, "11.80");
  const base = { ...f.context, invoiceId: f.invoice.id, reason: "Correct confirmed attribution", expectedRevision: 1 };
  const corrected = await correctPerformanceAttribution({ ...base, component: "SALE", shares: [{ membershipId: f.members[1].id, basisPoints: 10000 }], operationKey: randomUUID() }, db);
  assert.equal(corrected.result.teamDeltaCents, 0);
  let amounts = await net(f); assert.equal(amounts[f.members[0].id], 900); assert.equal(amounts[f.members[1].id], 9000);
  await correctPerformanceAttribution({ ...base, component: "TIP", paymentId: original.result.paymentId, shares: [{ membershipId: f.members[2].id, basisPoints: 10000 }], operationKey: randomUUID() }, db);
  amounts = await net(f); assert.equal(amounts[f.members[0].id], 0); assert.equal(amounts[f.members[1].id], 9000); assert.equal(amounts[f.members[2].id], 900);
  await refund(f, original.result.paymentId, "106.20");
  assert.ok(Object.values(await net(f)).every((amount) => amount === 0));
  await assert.rejects(correctPerformanceAttribution({ ...base, component: "SALE", shares: [], operationKey: randomUUID() }, db), /Refresh/);
  assert.equal(await db.auditLog.count({ where: { businessId: f.business.id, action: "PERFORMANCE_ATTRIBUTION_VERSION" } }), 4);
});

test("unassigned legacy client and explicit authorized exception conserve sales and tips separately", async () => {
  for (const input of [null, { version: 1, sales: [], unassignedReason: "No employee mapping available" } as PerformanceInput]) {
    const f = await fixture(); await receive(f, "118", input);
    assert.equal((await net(f)).UNASSIGNED, 11000);
    const rows = await db.performanceContribution.findMany({ where: { businessId: f.business.id } });
    assert.deepEqual(rows.map((row) => [row.component, Number(row.amountCents)]).sort(), [["SALE", 10000], ["TIP", 1000]]);
  }
});

test("duplicate and concurrent requests create one source; rollback leaves no financial/performance half", async () => {
  const f = await fixture(); const key = randomUUID();
  const [a, b] = await Promise.all([receive(f, "118", split(f), key), receive(f, "118", split(f), key)]);
  assert.equal(a.result.paymentId, b.result.paymentId);
  assert.equal(Number(a.replayed) + Number(b.replayed), 1);
  assert.equal(await db.performanceReceipt.count({ where: { businessId: f.business.id } }), 1);
  await assert.rejects(receive(f, "117", split(f), key), /different transaction/);
  const g = await fixture(); const retryKey = randomUUID();
  await assert.rejects(receive(g, "118", split(g), retryKey, true), /Injected/);
  assert.equal(await db.payment.count({ where: { businessId: g.business.id } }), 0);
  assert.equal(await db.performanceReceipt.count({ where: { businessId: g.business.id } }), 0);
  assert.equal(await db.performanceAttribution.count({ where: { businessId: g.business.id } }), 0);
  await receive(g, "118", split(g), retryKey);
});

test("tenant, branch, inactive employees, illegal shares and unauthorized corrections are rejected", async () => {
  const f = await fixture(), other = await fixture();
  await assert.rejects(receive(f, "118", { version: 1, sales: [{ membershipId: other.members[0].id, basisPoints: 10000 }], tipMembershipId: f.members[0].id }), /not eligible/);
  await db.employeeBusinessMembership.update({ where: { id: f.members[1].id }, data: { status: "TERMINATED" } });
  await assert.rejects(receive(f, "118"), /not eligible/);
  await assert.rejects(receive(f, "118", { version: 1, sales: [{ membershipId: f.members[0].id, basisPoints: 9900 }] }), /100%/);
  const staff = await db.user.create({ data: { businessId: f.business.id, branchId: f.branch.id, role: "STAFF", name: "Restricted cashier" } });
  await assert.rejects(correctPerformanceAttribution({ ...f.context, actorUserId: staff.id, invoiceId: f.invoice.id, component: "SALE", shares: [], reason: "Unauthorized correction attempt", expectedRevision: 0, operationKey: randomUUID() }, db), /permission denied/);
  await assert.rejects(correctPerformanceAttribution({ ...f.context, actorUserId: other.user.id, invoiceId: f.invoice.id, component: "SALE", shares: [], reason: "Cross tenant correction attempt", expectedRevision: 0, operationKey: randomUUID() }, db), /scope mismatch|access denied/);
});

test("many tiny refunds plus final refund preserve tax/tip and every employee's exact remainder", async () => {
  const f = await fixture(); const receipt = await receive(f, "118", split(f, 2));
  for (let i = 0; i < 12; i++) await refund(f, receipt.result.paymentId, "0.01");
  await refund(f, receipt.result.paymentId, "117.88");
  assert.ok(Object.values(await net(f)).every((amount) => amount === 0));
  const events = await db.performanceReceipt.findMany({ where: { businessId: f.business.id } });
  for (const field of ["rawCents", "salesCents", "taxCents", "tipCents"] as const) assert.equal(events.reduce((value, event) => value + event[field], 0n), 0n);
  assert.ok(events.filter((event) => event.kind === "REFUND").every((event) => event.localDate === "2027-01-01"));
});

test("package redemption and restoration are noncash, mixed cash uses only remaining pool", async () => {
  const f = await fixture();
  await db.invoice.update({ where: { id: f.invoice.id }, data: { total: 226, subtotal: 200, taxAmount: 16, tipAmount: 10, balance: 226 } });
  const result = await db.$transaction(async (tx) => {
    const packagePayment = await tx.payment.create({ data: { businessId: f.business.id, branchId: f.branch.id, invoiceId: f.invoice.id, cashierId: f.user.id, amount: 108, method: "PACKAGE" } });
    const cash = await tx.payment.create({ data: { businessId: f.business.id, branchId: f.branch.id, invoiceId: f.invoice.id, cashierId: f.user.id, amount: 118, method: "CASH" } });
    await capturePerformanceCheckout(tx, { businessId: f.business.id, actorUserId: f.user.id, input: split(f), paymentIds: [packagePayment.id, cash.id] });
    return { packagePayment, cash };
  });
  assert.equal(Object.values(await net(f)).reduce((a, b) => a + b, 0), 11000);
  const events = await db.performanceReceipt.findMany({ where: { businessId: f.business.id }, orderBy: { kind: "asc" } });
  assert.equal(events.find((event) => event.kind === "PACKAGE")!.quality, "EXCLUDED_PACKAGE");
  await refund(f, result.packagePayment.id, "108");
  assert.equal(Object.values(await net(f)).reduce((a, b) => a + b, 0), 11000);
  await refund(f, result.cash.id, "118"); assert.ok(Object.values(await net(f)).every((amount) => amount === 0));
});

test("paid VOID creates an explicit unresolved source issue, not a fabricated refund or disappearing evidence", async () => {
  const f = await fixture(); const original = await receive(f, "118");
  await db.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: original.result.paymentId }, data: { status: "VOID", voidedAt: new Date(), voidReason: "Existing financial void semantics" } });
    await capturePerformanceVoid(tx, { ...f.context, invoiceId: f.invoice.id, reason: "Existing financial void semantics" });
  });
  assert.equal(await db.paymentRefund.count({ where: { paymentId: original.result.paymentId } }), 0);
  assert.equal(await db.performanceReceipt.count({ where: { paymentId: original.result.paymentId } }), 1);
  assert.equal(await db.performanceSourceIssue.count({ where: { paymentId: original.result.paymentId } }), 1);
  await assert.rejects(correctPerformanceAttribution({ ...f.context, invoiceId: f.invoice.id, component: "SALE", shares: [], reason: "Should require source review", expectedRevision: 1, operationKey: randomUUID() }, db), /unresolved or voided/);
});

test("database prevents evidence overwrite and rejects a partial receipt without matching contributions", async () => {
  const f = await fixture(); await receive(f, "118");
  await assert.rejects(db.performanceReceipt.updateMany({ where: { businessId: f.business.id }, data: { salesCents: 1 } }), /append-only/);
  await assert.rejects(db.$transaction(async (tx) => {
    const source = await tx.performanceReceipt.findFirstOrThrow({ where: { businessId: f.business.id } });
    await tx.performanceContribution.create({ data: { businessId: f.business.id, eventId: source.id, attributionId: (await tx.performanceAttribution.findFirstOrThrow({ where: { businessId: f.business.id, component: "SALE" } })).id, component: "SALE", recipientKey: "UNASSIGNED", amountCents: 1n } });
  }), /conservation/);
});

test("exact tip-only refund never reduces sales or tax; month summaries reconcile", async () => {
  const f = await fixture(); const p = await receive(f, "118", split(f, 2));
  await refund(f, p.result.paymentId, "10", { sales: 0, tax: 0, tip: 1000, unresolved: 0 }, "2026-09-01T01:00:00Z");
  const august = await readPerformanceLedger(f.context, { asOf: new Date("2028-01-01Z"), year: 2026, month: 8 }, db);
  const september = await readPerformanceLedger(f.context, { asOf: new Date("2028-01-01Z"), year: 2026, month: 9 }, db);
  assert.equal(august.team.total, 11000); assert.equal(august.taxNetCents, 800);
  assert.equal(august.coverageStatus, "COMPLETE"); assert.equal(september.coverageStatus, "COMPLETE");
  assert.equal(september.team.salesRefunds, 0); assert.equal(september.team.tipsRefunds, 1000);
  assert.equal(september.employees[f.members[2].id].total, -1000);
  await refund(f, p.result.paymentId, "108");
  assert.ok(Object.values(await net(f)).every((amount) => amount === 0));
});

test("operating timezone ignores attendance settings and uses calendar midnight including cross-year refunds", async () => {
  const f = await fixture();
  await db.branchAttendanceSetting.create({ data: { businessId: f.business.id, branchId: f.branch.id, latitude: 0, longitude: 0, timezone: "Pacific/Honolulu" } });
  const p = await receive(f, "118", split(f), randomUUID(), false, "2026-09-01T09:30:00Z");
  const event = await db.performanceReceipt.findFirstOrThrow({ where: { paymentId: p.result.paymentId } });
  assert.equal(event.localDate, "2026-09-01"); assert.equal(event.timezone, "Asia/Kuching");
  await db.branchAttendanceSetting.update({ where: { branchId: f.branch.id }, data: { timezone: "Asia/Kuching" } });
  const r = await refund(f, p.result.paymentId, "118", undefined, "2026-12-31T16:30:00Z");
  const refunded = await db.performanceReceipt.findUniqueOrThrow({ where: { id: r.result.eventId } });
  assert.equal(refunded.localDate, "2027-01-01"); assert.equal(refunded.timezone, "Asia/Kuching");
  assert.equal((await readPerformanceLedger(f.context, { asOf: new Date("2028-01-01Z"), year: 2026, month: 9 }, db)).team.total, 11000);
});

test("transfers and termination retain original branch and original refund recipients", async () => {
  const f = await fixture(); const p = await receive(f, "118", split(f, 2));
  for (const member of f.members) {
    await db.employeeBranchAssignment.updateMany({ where: { membershipId: member.id }, data: { status: "INACTIVE", effectiveUntil: new Date("2026-09-01Z") } });
    await db.employeeBusinessMembership.update({ where: { id: member.id }, data: { status: "TERMINATED", terminatedAt: new Date("2026-09-02Z") } });
  }
  await refund(f, p.result.paymentId, "118");
  assert.ok(Object.values(await net(f)).every((amount) => amount === 0));
  assert.ok((await db.performanceReceipt.findMany({ where: { businessId: f.business.id } })).every((row) => row.branchId === f.branch.id));
  assert.equal((await readPerformanceLedger({ ...f.context, branchId: f.otherBranch.id }, { asOf: new Date("2028-01-01Z"), year: 2026 }, db)).team.total, 0);
});

test("late share insertion is forbidden even on an empty historical attribution", async () => {
  const f = await fixture(); await receive(f, "118", null);
  const attr = await db.performanceAttribution.findFirstOrThrow({ where: { businessId: f.business.id, component: "SALE" } });
  await assert.rejects(db.performanceShare.create({ data: { attributionId: attr.id, businessId: f.business.id, membershipId: f.members[0].id, employeeName: "A", employeeCode: "A", basisPoints: 10000 } }), /new attribution version/);
});

test("missing original payment/refund composition stays reviewable without blocking legacy refunds", async () => {
  const f = await fixture();
  const p = await db.payment.create({ data: { businessId: f.business.id, branchId: f.branch.id, invoiceId: f.invoice.id, cashierId: f.user.id, amount: 118, method: "CASH", paidAt: new Date("2026-08-31Z") } });
  const r = await refund(f, p.id, "11.80");
  const event = await db.performanceReceipt.findUniqueOrThrow({ where: { id: r.result.eventId } });
  assert.equal(event.unresolvedCents, -1180n); assert.equal(event.quality, "REVIEW_LEGACY_BASIS");
  const ledger = await readPerformanceLedger(f.context, { asOf: new Date("2028-01-01Z"), year: 2027 }, db);
  assert.equal(ledger.pendingRawCents, -1180); assert.equal(ledger.team.total, 0);
  assert.equal(await db.performanceContribution.count({ where: { businessId: f.business.id } }), 0);
});

test("VOID remains visible in pending evidence, not verified progress; reads are branch protected", async () => {
  const f = await fixture(); const p = await receive(f, "118");
  await db.payment.update({ where: { id: p.result.paymentId }, data: { status: "VOID" } });
  const ledger = await readPerformanceLedger(f.context, { asOf: new Date("2028-01-01Z"), year: 2026 }, db);
  assert.equal(ledger.team.total, 0); assert.equal(ledger.pending.total, 11000); assert.equal(ledger.pendingRawCents, 11800);
  assert.equal(ledger.coverageStatus, "INCOMPLETE"); assert.equal(ledger.pendingCount, 1);
  assert.equal(ledger.details[0].verified, false); assert.ok(ledger.details[0].issues.includes("VOID_SOURCE_REQUIRES_REVIEW"));
  const staff = await db.user.create({ data: { businessId: f.business.id, branchId: f.otherBranch.id, name: "Other branch manager", role: "STAFF", permissions: ["PERFORMANCE_VIEW_TEAM"] } });
  await assert.rejects(readPerformanceLedger({ ...f.context, actorUserId: staff.id }, { asOf: new Date("2028-01-01Z"), year: 2026 }, db), /branch access denied/);
});

test("sales and tips can be independently unassigned; legacy compatibility can be disabled server-side", async () => {
  const f = await fixture();
  await receive(f, "118", { version: 1, sales: [{ membershipId: f.members[0].id, basisPoints: 10000 }], unassignedReason: "Tip recipient awaiting confirmation" });
  let ledger = await readPerformanceLedger(f.context, { asOf: new Date("2028-01-01Z"), year: 2026 }, db);
  assert.equal(ledger.unassigned.salesReceived, 0); assert.equal(ledger.unassigned.tipsReceived, 1000);
  const g = await fixture();
  await receive(g, "118", { version: 1, sales: [], tipMembershipId: g.members[2].id, unassignedReason: "Sales recipient awaiting confirmation" });
  ledger = await readPerformanceLedger(g.context, { asOf: new Date("2028-01-01Z"), year: 2026 }, db);
  assert.equal(ledger.unassigned.salesReceived, 10000); assert.equal(ledger.unassigned.tipsReceived, 0);
  const h = await fixture();
  process.env.TETAMU_PERFORMANCE_LEGACY_COMPAT = "false";
  try { await assert.rejects(receive(h, "118", null), /Legacy unassigned checkout is disabled/); }
  finally { delete process.env.TETAMU_PERFORMANCE_LEGACY_COMPAT; }
  assert.equal(await db.payment.count({ where: { businessId: h.business.id } }), 0);
});

test("invoice discounts/points are not added back into received performance", async () => {
  const f = await fixture();
  await db.invoice.update({ where: { id: f.invoice.id }, data: { discountAmount: 10, taxAmount: 7.20, total: 107.20, balance: 107.20 } });
  await receive(f, "107.20");
  const event = await db.performanceReceipt.findFirstOrThrow({ where: { businessId: f.business.id } });
  assert.equal(event.salesCents, 9000n); assert.equal(event.taxCents, 720n); assert.equal(event.tipCents, 1000n);
  assert.equal(Object.values(await net(f)).reduce((a, b) => a + b, 0), 10000);
});

test("zero receipts and pure package redemption do not require an employee even with legacy compatibility disabled", async () => {
  const f = await fixture();
  process.env.TETAMU_PERFORMANCE_LEGACY_COMPAT = "false";
  try {
    await receive(f, "0", null);
    await db.$transaction(async (tx) => {
      const payment = await tx.payment.create({ data: { businessId: f.business.id, branchId: f.branch.id, invoiceId: f.invoice.id, cashierId: f.user.id, amount: 108, method: "PACKAGE", paidAt: new Date("2026-08-31Z") } });
      await capturePerformanceCheckout(tx, { businessId: f.business.id, actorUserId: f.user.id, input: null, paymentIds: [payment.id] });
    });
  } finally { delete process.env.TETAMU_PERFORMANCE_LEGACY_COMPAT; }
  assert.equal(await db.performanceAttribution.count({ where: { businessId: f.business.id } }), 0);
  assert.equal(await db.performanceContribution.count({ where: { businessId: f.business.id } }), 0);
  const ledger = await readPerformanceLedger(f.context, { asOf: new Date("2028-01-01Z"), year: 2026 }, db);
  assert.equal(ledger.team.total, 0); assert.equal(ledger.excludedPackageNetCents, 10800);
});

test("wrong-branch employees roll back payment and revoked correction permission also blocks replay", async () => {
  const f = await fixture();
  await db.employeeBranchAssignment.updateMany({ where: { membershipId: f.members[1].id }, data: { branchId: f.otherBranch.id } });
  await assert.rejects(receive(f, "118"), /not eligible/);
  assert.equal(await db.payment.count({ where: { businessId: f.business.id } }), 0);
  await receive(f, "118", { version: 1, sales: [{ membershipId: f.members[0].id, basisPoints: 10000 }], tipMembershipId: f.members[2].id });
  const admin = await db.user.create({ data: { businessId: f.business.id, branchId: f.branch.id, name: "Authorized correction admin", role: "STAFF", permissions: ["PERFORMANCE_CORRECT_SALES"] } });
  const correction = { ...f.context, actorUserId: admin.id, invoiceId: f.invoice.id, component: "SALE" as const, shares: [{ membershipId: f.members[2].id, basisPoints: 10000 }], expectedRevision: 1, reason: "Confirmed independent sales correction", operationKey: randomUUID() };
  await correctPerformanceAttribution(correction, db);
  assert.equal((await correctPerformanceAttribution(correction, db)).replayed, true);
  await db.user.update({ where: { id: admin.id }, data: { permissions: [] } });
  await assert.rejects(correctPerformanceAttribution(correction, db), /permission denied/);
  assert.equal(await db.performanceAttribution.count({ where: { businessId: f.business.id, component: "SALE" } }), 2);
  assert.equal(await db.performanceAttribution.count({ where: { businessId: f.business.id, component: "TIP" } }), 1);
});

test("new tip on a later payment preserves old tip evidence and counts only each received share", async () => {
  const f = await fixture(); const first = await receive(f, "59");
  const original = await db.performanceReceipt.findFirstOrThrow({ where: { paymentId: first.result.paymentId } });
  const second = await receive(f, "34.50", { version: 1, tipMembershipId: f.members[2].id }, randomUUID(), false, "2026-09-01T01:00:00Z", 1000);
  const event = await db.performanceReceipt.findFirstOrThrow({ where: { paymentId: second.result.paymentId } });
  assert.equal(event.salesCents, 2500n); assert.equal(event.taxCents, 200n); assert.equal(event.tipCents, 750n);
  assert.deepEqual(await db.performanceReceipt.findUniqueOrThrow({ where: { id: original.id } }), original);
  const invoice = await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } });
  assert.equal(invoice.total.toString(), "128"); assert.equal(invoice.tipAmount.toString(), "20"); assert.equal(invoice.balance.toString(), "34.5");
  const last = await receive(f, "34.50", { version: 1, tipMembershipId: f.members[1].id });
  assert.equal((await db.performanceReceipt.findFirstOrThrow({ where: { paymentId: last.result.paymentId } })).tipCents, 750n);
  assert.equal(await db.performanceAttribution.count({ where: { businessId: f.business.id, component: "SALE" } }), 1);
  assert.equal(await db.auditLog.count({ where: { businessId: f.business.id, action: "PERFORMANCE_CHECKOUT_TIP_ADDED" } }), 1);
  for (const payment of [first, second, last]) {
    const source = await db.payment.findUniqueOrThrow({ where: { id: payment.result.paymentId } });
    await refund(f, source.id, source.amount.toString());
  }
  assert.ok(Object.values(await net(f)).every((value) => value === 0));
});

test("additional tip and audit roll back with failed payment; retry adds once and paid invoice cannot be reopened", async () => {
  const f = await fixture(); await receive(f, "59");
  const input = { version: 1 as const, tipMembershipId: f.members[2].id }, key = randomUUID();
  await assert.rejects(receive(f, "69", input, key, true, "2026-09-01T01:00:00Z", 1000), /Injected/);
  assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).tipAmount.toString(), "10");
  assert.equal(await db.auditLog.count({ where: { businessId: f.business.id, action: "PERFORMANCE_CHECKOUT_TIP_ADDED" } }), 0);
  await receive(f, "69", input, key, false, "2026-09-01T01:00:00Z", 1000);
  assert.equal((await receive(f, "69", input, key, false, "2026-09-01T01:00:00Z", 1000)).replayed, true);
  assert.equal(await db.auditLog.count({ where: { businessId: f.business.id, action: "PERFORMANCE_CHECKOUT_TIP_ADDED" } }), 1);
  await assert.rejects(receive(f, "1", input, randomUUID(), false, "2026-09-02T01:00:00Z", 100), /outstanding-balance/);
  assert.equal(await db.payment.count({ where: { businessId: f.business.id } }), 2);
});
