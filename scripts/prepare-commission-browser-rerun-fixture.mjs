import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { DATABASE_URL } from "./embedded-postgres-utils.mjs";

const configuredUrl = process.env.DATABASE_URL ?? DATABASE_URL;
const hostname = new URL(configuredUrl).hostname.toLowerCase();
if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
  throw new Error("Commission browser fixtures are restricted to the Local database.");
}
const qaPassword = process.env.LOCAL_MODULE_QA_PASSWORD;
if (!qaPassword || qaPassword.length < 12) {
  throw new Error("LOCAL_MODULE_QA_PASSWORD must contain at least 12 characters.");
}
process.env.DATABASE_URL = configuredUrl;
const prisma = new PrismaClient();

try {
  const passwordHash = await bcrypt.hash(qaPassword, 12);
  const business = await prisma.business.upsert({
    where: { slug: "qa-commission-browser-salon" },
    create: {
      name: "QA COMMISSION BROWSER SALON",
      slug: "qa-commission-browser-salon",
      industryType: "SALON_BEAUTY",
      timezone: "Asia/Kuala_Lumpur",
    },
    update: {
      name: "QA COMMISSION BROWSER SALON",
      industryType: "SALON_BEAUTY",
      timezone: "Asia/Kuala_Lumpur",
      status: "active",
    },
  });
  const branch = await prisma.branch.upsert({
    where: { businessId_name: { businessId: business.id, name: "QA Main Branch" } },
    create: { businessId: business.id, name: "QA Main Branch" },
    update: { status: "ACTIVE" },
  });
  const owner = await prisma.user.upsert({
    where: { email: "commission-browser-owner@test.local" },
    create: {
      businessId: business.id,
      branchId: branch.id,
      name: "Commission Browser Calculator",
      email: "commission-browser-owner@test.local",
      passwordHash,
      role: "BUSINESS_OWNER",
      loginEnabled: true,
    },
    update: {
      businessId: business.id,
      branchId: branch.id,
      name: "Commission Browser Calculator",
      passwordHash,
      role: "BUSINESS_OWNER",
      loginEnabled: true,
      status: "active",
    },
  });
  const approver = await prisma.user.upsert({
    where: { email: "commission-browser-approver@test.local" },
    create: {
      businessId: business.id,
      branchId: branch.id,
      name: "Commission Browser Approver",
      email: "commission-browser-approver@test.local",
      passwordHash,
      role: "BUSINESS_OWNER",
      loginEnabled: true,
    },
    update: {
      businessId: business.id,
      branchId: branch.id,
      name: "Commission Browser Approver",
      passwordHash,
      role: "BUSINESS_OWNER",
      loginEnabled: true,
      status: "active",
    },
  });

  const enabledModules = new Set(["POS", "SALON", "HR", "PAYROLL", "COMMISSION"]);
  const moduleKeys = ["POS", "SALON", "AUTO", "WHATSAPP", "BUSINESS_GROUP", "HR", "PAYROLL", "STATUTORY", "COMMISSION"];
  for (const moduleKey of moduleKeys) {
    await prisma.businessModuleEntitlement.upsert({
      where: { businessId_moduleKey: { businessId: business.id, moduleKey } },
      create: {
        businessId: business.id,
        moduleKey,
        status: enabledModules.has(moduleKey) ? "ENABLED" : "DISABLED",
        enabledFrom: new Date("2026-01-01T00:00:00.000Z"),
        source: "SYSTEM",
        createdById: owner.id,
        updatedById: owner.id,
      },
      update: {
        status: enabledModules.has(moduleKey) ? "ENABLED" : "DISABLED",
        enabledFrom: new Date("2026-01-01T00:00:00.000Z"),
        enabledUntil: null,
        source: "SYSTEM",
        updatedById: owner.id,
      },
    });
  }

  const account = await prisma.employeeAccount.upsert({
    where: { phoneNormalized: "+601155500101" },
    create: {
      phoneNumber: "+601155500101",
      phoneNormalized: "+601155500101",
      name: "Commission Browser Staff",
    },
    update: { name: "Commission Browser Staff", status: "ACTIVE" },
  });
  const membership = await prisma.employeeBusinessMembership.upsert({
    where: { employeeAccountId_businessId: { employeeAccountId: account.id, businessId: business.id } },
    create: {
      employeeAccountId: account.id,
      businessId: business.id,
      employeeCode: "COMMISSION-BROWSER-A",
      fullName: "Commission Browser Staff",
      phoneNumber: "+601155500101",
      phoneNumberNormalized: "+601155500101",
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    update: { fullName: "Commission Browser Staff", status: "ACTIVE", terminatedAt: null },
  });
  const staff = await prisma.user.upsert({
    where: { email: "commission-browser-staff@test.local" },
    create: {
      businessId: business.id,
      branchId: branch.id,
      employeeAccountId: account.id,
      employeeBusinessMembershipId: membership.id,
      teamMemberLinkStatus: "LINKED",
      teamMemberLinkedAt: new Date(),
      name: "Commission Browser Staff",
      email: "commission-browser-staff@test.local",
      role: "STAFF",
      loginEnabled: false,
      appointmentBookable: true,
      permissions: ["APPOINTMENTS"],
    },
    update: {
      businessId: business.id,
      branchId: branch.id,
      employeeAccountId: account.id,
      employeeBusinessMembershipId: membership.id,
      teamMemberLinkStatus: "LINKED",
      teamMemberLinkedAt: new Date(),
      name: "Commission Browser Staff",
      role: "STAFF",
      loginEnabled: false,
      appointmentBookable: true,
      permissions: ["APPOINTMENTS"],
      status: "active",
    },
  });
  if (!await prisma.employeeBranchAssignment.findFirst({ where: { membershipId: membership.id, branchId: branch.id, status: "ACTIVE" } })) {
    await prisma.employeeBranchAssignment.create({
      data: {
        membershipId: membership.id,
        businessId: business.id,
        branchId: branch.id,
        isPrimary: true,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
  }

  const service = await prisma.service.upsert({
    where: { businessId_name: { businessId: business.id, name: "Browser Haircut RM100" } },
    create: {
      businessId: business.id,
      branchId: branch.id,
      name: "Browser Haircut RM100",
      category: "Commission QA",
      price: "100.00",
      durationMinutes: 45,
      taxable: false,
    },
    update: { branchId: branch.id, price: "100.00", durationMinutes: 45, taxable: false, status: "ACTIVE" },
  });
  let customer = await prisma.customer.findFirst({ where: { businessId: business.id, phone: "+601155500102" } });
  if (!customer) {
    customer = await prisma.customer.create({
      data: { businessId: business.id, branchId: branch.id, name: "Commission Browser Customer", phone: "+601155500102" },
    });
  }
  let appointment = await prisma.appointment.findFirst({
    where: {
      businessId: business.id,
      customerId: customer.id,
      serviceId: service.id,
      assignedStaffId: staff.id,
      invoice: null,
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!appointment) {
    appointment = await prisma.appointment.create({
      data: {
        businessId: business.id,
        branchId: branch.id,
        customerId: customer.id,
        serviceId: service.id,
        serviceIds: [service.id],
        createdById: owner.id,
        assignedStaffId: staff.id,
        scheduledAt: new Date("2026-08-11T08:00:00.000Z"),
        durationMinutes: 45,
        status: "COMPLETED",
        completedAt: new Date("2026-08-11T08:45:00.000Z"),
        notes: "LOCAL / TESTING ONLY Commission refund rerun fixture.",
      },
    });
  }
  for (const cashier of [owner, approver]) {
    if (!await prisma.cashierShift.findFirst({ where: { businessId: business.id, cashierId: cashier.id, status: "OPEN" } })) {
      await prisma.cashierShift.create({
        data: { businessId: business.id, branchId: branch.id, cashierId: cashier.id, openingFloat: "0.00", notes: "LOCAL / TESTING ONLY." },
      });
    }
  }

  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    businessId: business.id,
    ownerEmail: owner.email,
    approverEmail: approver.email,
    staffMembershipId: membership.id,
    appointmentId: appointment.id,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
