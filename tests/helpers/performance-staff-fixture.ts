import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createEmployeeSessionRecord } from "../../src/lib/attendance/employee-auth/session";
import { capturePerformanceCheckout, capturePerformanceRefund } from "../../src/lib/performance/service";
import { previewTargets, publishTargets } from "../../src/lib/performance/targets";
import { DEFAULT_LEVELS } from "../../src/lib/performance/targets-contract";

export function assertStaffTestDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && /^\/tetamu_performance_disposable_[a-z0-9_]+$/.test(url.pathname));
}
export async function staffPerformanceFixture(db: PrismaClient, count = 7) {
  assertStaffTestDatabase();
  const business = await db.business.create({ data: { name: "Staff Performance Isolated", slug: `phase3-${randomUUID()}`, timezone: "Asia/Kuching", industryType: "SALON_BEAUTY" } });
  const branch = await db.branch.create({ data: { businessId: business.id, name: "Central Salon" } });
  const other = await db.branch.create({ data: { businessId: business.id, name: "Previous Branch" } });
  const owner = await db.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Fixture owner", role: "BUSINESS_OWNER" } });
  const members = [], sessions = [];
  for (let i = 0; i < count; i++) {
    const phone = `+601${randomInt(10000000, 99999999)}`;
    const fullName = i === 0 ? "Alex Manager" : i === 2 ? "Tip Only Employee" : `Alex Employee ${String(i).padStart(2,"0")} Long Display Name`;
    const account = await db.employeeAccount.create({ data: { name: fullName, phoneNumber: phone, phoneNormalized: phone } });
    const member = await db.employeeBusinessMembership.create({ data: { businessId: business.id, employeeAccountId: account.id, employeeCode: `STAFF-${String(i).padStart(3,"0")}`, fullName, phoneNumber: phone, phoneNumberNormalized: phone, joinedAt: new Date("2025-01-01Z") } });
    await db.employeeBranchAssignment.create({ data: { membershipId: member.id, businessId: business.id, branchId: branch.id, isPrimary: true, canClockIn: false, effectiveFrom: new Date("2025-01-01Z") } });
    const device = await db.employeeDevice.create({ data: { employeeAccountId: account.id, deviceIdentifierHash: randomUUID(), displayName: "Isolated Chrome", canView: true, canPunch: false } });
    const session = await db.$transaction(tx => createEmployeeSessionRecord({ employeeAccountId: account.id, membershipId: member.id, businessId: business.id, primaryBranchId: branch.id, attendanceBranchId: branch.id, deviceId: device.id, now: new Date() }, tx));
    members.push(member); sessions.push(session);
  }
  const manager = await db.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Explicit performance reader", role: "STAFF", permissions: ["PERFORMANCE_VIEW_TEAM"], employeeAccountId: members[0].employeeAccountId, employeeBusinessMembershipId: members[0].id, teamMemberLinkStatus: "LINKED", teamMemberLinkedAt: new Date() } });
  const context = { businessId: business.id, branchId: branch.id, actorUserId: owner.id };
  return { business, branch, other, owner, manager, members, sessions, context };
}
export type StaffFixture = Awaited<ReturnType<typeof staffPerformanceFixture>>;
export async function staffCash(db: PrismaClient, f: StaffFixture, options: { at?: string; amount?: string; unassigned?: boolean; branchId?: string; memberIndex?: number } = {}) {
  return db.$transaction(async tx => {
    const branchId = options.branchId ?? f.branch.id, amount = new Prisma.Decimal(options.amount ?? "118"), regular = amount.eq(118);
    const invoice = await tx.invoice.create({ data: { businessId: f.business.id, branchId, invoiceNumber: `STAFF-ORDER-${randomUUID()}`, subtotal: regular ? 100 : amount, taxAmount: regular ? 8 : 0, tipAmount: regular ? 10 : 0, total: amount, paidAmount: amount, balance: 0, status: "PAID" } });
    const payment = await tx.payment.create({ data: { businessId: f.business.id, branchId, invoiceId: invoice.id, amount, method: "CASH", paidAt: new Date(options.at ?? "2026-08-01T04:00Z") } });
    await capturePerformanceCheckout(tx, { businessId: f.business.id, actorUserId: f.owner.id, paymentIds: [payment.id], input: options.unassigned ? null : {
      version: 1, sales: options.memberIndex !== undefined ? [{ membershipId: f.members[options.memberIndex].id, basisPoints: 10000 }] : [{ membershipId: f.members[0].id, basisPoints: 5000 }, { membershipId: f.members[1].id, basisPoints: 5000 }], tipMembershipId: regular ? f.members[2].id : null } });
    return payment;
  });
}
export async function staffRefund(db: PrismaClient, f: StaffFixture, paymentId: string, amount: number, at = "2026-08-20T04:00Z") {
  return db.$transaction(async tx => { const refund = await tx.paymentRefund.create({ data: { businessId: f.business.id, branchId: f.branch.id, paymentId, amount, method: "CASH", reason: "Isolated performance test", refundedAt: new Date(at) } });
    await capturePerformanceRefund(tx, refund.id, { businessId: f.business.id, actorUserId: f.owner.id }); return refund; });
}
export async function staffTargets(db: PrismaClient, f: StaffFixture, options: { year?: number; branchId?: string; amounts?: { membershipId: string; amount: number }[]; revision?: number } = {}) {
  const context = { ...f.context, branchId: options.branchId ?? f.branch.id };
  const draft = { year: options.year ?? 2026, levels: DEFAULT_LEVELS, managerId: null, people: options.amounts ?? f.members.slice(0,7).map((m,i) => ({ membershipId: m.id, amount: i === 0 ? 30000000 : 5000000 })), expectedRevision: options.revision ?? 0, reason: "Isolated Staff target fixture", confirmGap: true };
  const p = await previewTargets(context, draft, db); return publishTargets(context, draft, p.token, randomUUID(), db);
}
