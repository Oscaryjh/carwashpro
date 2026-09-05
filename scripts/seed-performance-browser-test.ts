import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/tetamu_performance_disposable_[a-z0-9_]+$/.test(url.pathname)) throw new Error("Browser fixtures require an isolated local performance database.");
  const password = process.env.LOCAL_PERFORMANCE_TEST_PASSWORD;
  if (!password || password.length < 12) throw new Error("Set a local-only test password of at least 12 characters.");
  const db = new PrismaClient();
  const result = [];
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    for (const industry of ["SALON_BEAUTY", "AUTO_DETAILING"] as const) {
      const slug = industry === "SALON_BEAUTY" ? "performance-browser-salon" : "performance-browser-auto";
      if (await db.business.findUnique({ where: { slug } })) throw new Error("Browser fixture exists; refusing to overwrite it.");
      const business = await db.business.create({ data: { name: `Performance Browser ${industry}`, slug, industryType: industry, timezone: "Asia/Kuching", sstEnabled: true, sstRate: 8 } });
      const branch = await db.branch.create({ data: { businessId: business.id, name: "Test Branch", stateCode: "SARAWAK" } });
      const user = await db.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Alex Manager", email: `${slug}@tetamu.test`, role: "BUSINESS_OWNER", passwordHash, appointmentBookable: true, loginEnabled: true } });
      for (const moduleKey of ["POS", "INVENTORY", industry === "SALON_BEAUTY" ? "SALON" : "AUTO"] as const) {
        await db.businessModuleEntitlement.create({ data: { businessId: business.id, moduleKey, status: "ENABLED", enabledFrom: new Date("2026-01-01Z"), source: "SYSTEM", planCode: "ISOLATED_PERFORMANCE_TEST", createdById: user.id, updatedById: user.id } });
      }
      const members = [];
      for (let index = 0; index < 54; index++) {
        const phone = `+601${randomInt(10000000, 99999999)}`;
        const fullName = index === 0 ? "Alex Manager" : index === 1 ? "Alex Manager" : index === 2 ? "Tip Only Employee" : `Search Employee ${String(index).padStart(2, "0")} Long Name`;
        const account = await db.employeeAccount.create({ data: { name: fullName, phoneNumber: phone, phoneNormalized: phone } });
        const membership = await db.employeeBusinessMembership.create({ data: { businessId: business.id, employeeAccountId: account.id, employeeCode: `PERF-${String(index + 1).padStart(3, "0")}`, fullName, phoneNumber: phone, phoneNumberNormalized: phone, joinedAt: new Date("2026-01-01Z") } });
        await db.employeeBranchAssignment.create({ data: { businessId: business.id, membershipId: membership.id, branchId: branch.id, isPrimary: true, canClockIn: false, effectiveFrom: new Date("2026-01-01Z") } });
        members.push({ id: membership.id, employeeCode: membership.employeeCode });
        if (!index) await db.user.update({ where: { id: user.id }, data: { employeeAccountId: account.id, employeeBusinessMembershipId: membership.id, teamMemberLinkStatus: "LINKED", teamMemberLinkedAt: new Date() } });
      }
      const service = await db.service.create({ data: { businessId: business.id, branchId: branch.id, name: "Performance Service", price: 100, taxable: true, taxRate: 8 } });
      await db.serviceStaffAssignment.create({ data: { businessId: business.id, serviceId: service.id, userId: user.id } });
      const product = await db.product.create({ data: { businessId: business.id, name: "Performance Product", sku: "PERF-PRODUCT", price: 100, taxable: true, taxRate: 8, trackInventory: true } });
      await db.productStock.create({ data: { businessId: business.id, branchId: branch.id, productId: product.id, quantity: 50 } });
      const pkg = await db.package.create({ data: { businessId: business.id, branchId: branch.id, serviceId: service.id, name: "Performance Package", price: 100, totalUses: 5 } });
      const customer = await db.customer.create({ data: { businessId: business.id, branchId: branch.id, name: "Performance Test Customer", phone: `+601${randomInt(10000000,99999999)}` } });
      const vehicle = await db.vehicle.create({ data: { businessId: business.id, branchId: branch.id, customerId: customer.id, plateNumber: industry === "SALON_BEAUTY" ? "PERFS01" : "PERFA01", size: "SMALL" } });
      const appointment = await db.appointment.create({ data: { businessId: business.id, branchId: branch.id, customerId: customer.id, vehicleId: vehicle.id, serviceId: service.id, serviceIds: [service.id], assignedStaffId: user.id, createdById: user.id, scheduledAt: new Date(), completedAt: new Date(), status: "COMPLETED" } });
      const workOrder = await db.workOrder.create({ data: { businessId: business.id, branchId: branch.id, customerId: customer.id, vehicleId: vehicle.id, orderNumber: `PERF-${industry}`, subtotal: 100, total: 108, paidAmount: 0, balance: 108,
        items: { create: { businessId: business.id, serviceId: service.id, name: service.name, quantity: 1, unitPrice: 100, lineTotal: 100 } } } });
      const pendingPackage = await db.customerPackage.create({ data: { businessId: business.id, branchId: branch.id, customerId: customer.id, packageId: pkg.id, purchasePrice: 100, totalUses: 5, remainingUses: 0, status: "PENDING_PAYMENT" } });
      await db.customerPackageServiceBalance.create({ data: { businessId: business.id, customerPackageId: pendingPackage.id, serviceId: service.id, totalUses: 5, remainingUses: 0 } });
      await db.cashierShift.create({ data: { businessId: business.id, branchId: branch.id, cashierId: user.id, openingFloat: 0, startedAt: new Date() } });
      result.push({ businessId: business.id, branchId: branch.id, userId: user.id, email: user.email, members, productId: product.id, packageId: pkg.id, customerId: customer.id, vehicleId: vehicle.id, serviceId: service.id, appointmentId: appointment.id, workOrderId: workOrder.id, pendingPackageId: pendingPackage.id });
    }
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } finally { await db.$disconnect(); }
}
main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; });
