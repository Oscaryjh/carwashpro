import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PrismaClient, Prisma, type EmployeeBusinessMembership } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createEmployeeSessionRecord } from "../src/lib/attendance/employee-auth/session";
import { capturePerformanceCheckout } from "../src/lib/performance/service";
import { previewTargets, publishTargets } from "../src/lib/performance/targets";
import { readPerformanceLedger } from "../src/lib/performance/read";
import { readStaffPerformance } from "../src/lib/staff-pwa/performance";
import { localPerformanceDate, performancePeriod } from "../src/lib/performance/time";

// Local-only operator fixture. No HTTP login bypass or OTP sender is added.
const directory = "/Users/innovdia/.codex/local-uat/tetamu-performance-20260905";
const slug = "performance-user-uat-20260905";
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.pathname, "/tetamu_performance_disposable_phase3_20260905_a");
assert.equal(process.env.TETAMU_ENVIRONMENT, "TESTING");
assert.equal(process.env.TETAMU_PERFORMANCE_PHASE1, "true");
const db = new PrismaClient();
async function main() {
  const config = JSON.parse(readFileSync(`${directory}/config.json`, "utf8"));
  const localDate = localPerformanceDate(new Date(), "Asia/Kuching");
  const [year, month] = localDate.split("-").map(Number);
  const previousYear = month === 1 ? year - 1 : year;
  const previousMonth = month === 1 ? 12 : month - 1;
  let business = await db.business.findUnique({ where: { slug } });
  if (!business) {
    // All initial identities, orders, money and capture records succeed together.
    business = await db.$transaction(async tx => {
      const b = await tx.business.create({ data: { name: "UAT TEST ONLY · Performance Salon", slug, timezone: "Asia/Kuching", industryType: "SALON_BEAUTY", sstEnabled: true, sstRate: 8 } });
      const branch = await tx.branch.create({ data: { businessId: b.id, name: "UAT ONLY · Test Salon", stateCode: "SARAWAK" } });
      const owner = await tx.user.create({ data: { businessId: b.id, branchId: branch.id, name: "UAT Owner (TEST ONLY)", email: "owner.performance.uat@tetamu.test", role: "BUSINESS_OWNER", passwordHash: await bcrypt.hash(config.ownerPassword, 10), loginEnabled: true, appointmentBookable: true } });
      await tx.businessModuleEntitlement.createMany({ data: (["POS", "INVENTORY", "SALON", "HR", "PAYROLL"] as const).map(moduleKey => ({ businessId: b.id, moduleKey, status: "ENABLED" as const, enabledFrom: new Date(`${previousYear}-01-01Z`), source: "SYSTEM" as const, createdById: owner.id, updatedById: owner.id })) });
      const members: EmployeeBusinessMembership[] = [];
      for (let index = 0; index < 7; index++) {
        const code = index === 0 ? "UAT-MGR" : `UAT-${String.fromCharCode(64 + index)}`;
        const name = index === 0 ? "UAT Manager" : `UAT Employee ${String.fromCharCode(64 + index)}`;
        // Deliberately non-routable synthetic contact identifiers; never call OTP.
        const phone = `+9996090500${index}`;
        const account = await tx.employeeAccount.create({ data: { name, phoneNumber: phone, phoneNormalized: phone } });
        const member = await tx.employeeBusinessMembership.create({ data: { businessId: b.id, employeeAccountId: account.id, employeeCode: code, fullName: name, phoneNumber: phone, phoneNumberNormalized: phone, joinedAt: new Date(`${previousYear}-01-01Z`), attendanceEnabled: true } });
        await tx.employeeBranchAssignment.create({ data: { businessId: b.id, branchId: branch.id, membershipId: member.id, isPrimary: true, canClockIn: true, effectiveFrom: new Date(`${previousYear}-01-01Z`) } });
        await tx.employeeDevice.create({ data: { employeeAccountId: account.id, deviceIdentifierHash: randomUUID(), displayName: `${code} isolated desktop UAT`, canView: true, canPunch: true } });
        if (index === 0) await tx.user.create({ data: { businessId: b.id, branchId: branch.id, name, role: "STAFF", loginEnabled: true, permissions: ["PERFORMANCE_VIEW_TEAM", "APPROVE_LEAVE"], employeeAccountId: account.id, employeeBusinessMembershipId: member.id, teamMemberLinkStatus: "LINKED", teamMemberLinkedAt: new Date() } });
        members.push(member);
      }
      await tx.branchAttendanceSetting.create({ data: { businessId: b.id, branchId: branch.id, timezone: "Asia/Kuching", latitude: 1.55, longitude: 110.35, isEnabled: true, requireGeofence: false } });
      const tomorrow = new Date(`${localDate}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      await tx.holidayOccurrence.create({ data: { businessId: b.id, branchId: branch.id, workDate: tomorrow, name: "UAT upcoming rest day", holidayType: "COMPANY_HOLIDAY", source: "CUSTOM", scope: "BRANCH", createdById: owner.id } });
      const service = await tx.service.create({ data: { businessId: b.id, branchId: branch.id, name: "UAT Service RM100 + 8% tax", price: 100, taxable: true, taxRate: 8 } });
      await tx.serviceStaffAssignment.create({ data: { businessId: b.id, serviceId: service.id, userId: owner.id } });
      await tx.customer.create({ data: { businessId: b.id, branchId: branch.id, name: "UAT Walk-in Customer (TEST ONLY)", phone: "+99960905999" } });
      await tx.cashierShift.create({ data: { businessId: b.id, branchId: branch.id, cashierId: owner.id, openingFloat: 0, startedAt: new Date() } });
      async function receipt(key: string, date: Date, sale: number, tax: number, tip: number, splits: { membershipId: string; basisPoints: number }[]) {
        const amount = new Prisma.Decimal(sale).add(tax).add(tip);
        assert.ok(!amount.eq(118), "The manual RM118 UAT must remain unexecuted");
        const invoice = await tx.invoice.create({ data: { businessId: b.id, branchId: branch.id, invoiceNumber: `UAT-BASE-${key}`, issuedAt: date, subtotal: sale, taxableSubtotal: tax ? sale : 0, taxRate: tax ? 8 : 0, taxAmount: tax, tipAmount: tip, total: amount, paidAmount: amount, balance: 0, status: "PAID", items: { create: { businessId: b.id, name: "Synthetic UAT sales receipt", unitPrice: sale, lineTotal: sale, taxable: tax > 0, taxRate: tax ? 8 : 0, taxAmount: tax } } } });
        const payment = await tx.payment.create({ data: { businessId: b.id, branchId: branch.id, invoiceId: invoice.id, amount, method: "CASH", paidAt: date } });
        await capturePerformanceCheckout(tx, { businessId: b.id, actorUserId: owner.id, paymentIds: [payment.id], input: { version: 1, sales: splits, tipMembershipId: tip ? members[3].id : null } });
      }
      const previousAt = new Date(performancePeriod(previousYear, "Asia/Kuching", previousMonth).from.getTime() + 1000);
      const currentAt = new Date(performancePeriod(year, "Asia/Kuching", month).from.getTime() + 1000);
      assert.ok(currentAt < new Date(), "Run after the first second of the business month");
      for (let i = 0; i < 7; i++) await receipt(`PREVIOUS-${i}`, previousAt, i === 0 ? 299000 : 49000, 0, 0, [{ membershipId: members[i].id, basisPoints: 10000 }]);
      for (const i of [0, 3, 4, 5, 6]) await receipt(`CURRENT-${i}`, currentAt, 1000, 0, 0, [{ membershipId: members[i].id, basisPoints: 10000 }]);
      await receipt("CURRENT-SPLIT-TIP", currentAt, 1900, 152, 100, [{ membershipId: members[1].id, basisPoints: 5000 }, { membershipId: members[2].id, basisPoints: 5000 }]);
      return b;
    }, { timeout: 60000 });
  }
  assert.equal(business.name, "UAT TEST ONLY · Performance Salon");
  const branch = await db.branch.findFirstOrThrow({ where: { businessId: business.id } });
  const owner = await db.user.findFirstOrThrow({ where: { businessId: business.id, role: "BUSINESS_OWNER" } });
  const service = await db.service.findFirstOrThrow({ where: { businessId: business.id, name: "UAT Service RM100 + 8% tax" } });
  const customer = await db.customer.findFirstOrThrow({ where: { businessId: business.id, name: "UAT Walk-in Customer (TEST ONLY)" } });
  // Salon checkout requires an appointment. Create a visit, never its invoice/payment.
  let appointment = await db.appointment.findFirst({ where: { businessId: business.id, customerId: customer.id, serviceId: service.id } });
  if (!appointment) {
    const vehicle = await db.vehicle.create({ data: { businessId: business.id, branchId: branch.id, customerId: customer.id, plateNumber: "UAT-SALON", size: "SMALL" } });
    appointment = await db.appointment.create({ data: { businessId: business.id, branchId: branch.id, customerId: customer.id, vehicleId: vehicle.id, serviceId: service.id, serviceIds: [service.id], assignedStaffId: owner.id, createdById: owner.id, scheduledAt: new Date(), completedAt: new Date(), status: "COMPLETED" } });
  }
  const members = await db.employeeBusinessMembership.findMany({ where: { businessId: business.id }, orderBy: { employeeCode: "asc" } });
  assert.equal(members.length, 7);
  const context = { businessId: business.id, branchId: branch.id, actorUserId: owner.id };
  // Resume a partially finished initial setup, but never overwrite published UAT changes.
  if (!await db.performanceTargetVersion.findFirst({ where: { businessId: business.id, branchId: branch.id, year } })) {
    const draft = { year, levels: [60000000, 80000000, 100000000], managerId: members.find(m => m.employeeCode === "UAT-MGR")!.id, people: members.map(m => ({ membershipId: m.id, amount: m.employeeCode === "UAT-MGR" ? 30000000 : 5000000 })), expectedRevision: 0, reason: "Initial isolated user UAT annual goals", confirmGap: false };
    const preview = await previewTargets(context, draft, db);
    await publishTargets(context, draft, preview.token, randomUUID(), db);
  }
  const sessions: Record<string, unknown> = {};
  const summaries: Record<string, unknown> = {};
  for (const role of ["manager", "A", "B", "C"]) {
    const code = role === "manager" ? "UAT-MGR" : `UAT-${role}`;
    const member = members.find(m => m.employeeCode === code)!;
    const device = await db.employeeDevice.findFirstOrThrow({ where: { employeeAccountId: member.employeeAccountId, displayName: `${code} isolated desktop UAT` } });
    const session = await db.$transaction(tx => createEmployeeSessionRecord({ employeeAccountId: member.employeeAccountId, membershipId: member.id, businessId: business.id, primaryBranchId: branch.id, attendanceBranchId: branch.id, deviceId: device.id, now: new Date() }, tx));
    sessions[role] = { token: session.token, expiresAt: session.expiresAt, context: session.context };
    summaries[role] = await readStaffPerformance(session.context, { view: "card", year, month }, db);
  }
  writeFileSync(`${directory}/sessions.json`, JSON.stringify(sessions), { mode: 0o600 });
  const ledger = await readPerformanceLedger(context, { year, asOf: new Date() }, db);
  const fixture = { businessId: business.id, branchId: branch.id, businessName: business.name, branchName: branch.name, year, month, ownerEmail: owner.email, manualAppointmentId: appointment.id, members: members.map(m => ({ id: m.id, name: m.fullName, code: m.employeeCode })), ledger, summaries };
  const baselineFile = `${directory}/baseline.json`;
  if (!existsSync(baselineFile)) writeFileSync(baselineFile, JSON.stringify(fixture, null, 2), { mode: 0o600, flag: "wx" });
  writeFileSync(`${directory}/current.json`, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  const payments = await db.payment.count({ where: { businessId: business.id } });
  console.log(JSON.stringify({ business: business.name, database: database.pathname.slice(1), payments, coverageStatus: ledger.coverageStatus, team: ledger.team, rerun: "Existing business/receipts/targets preserved; only local sessions renewed." }));
}
main().finally(() => db.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
