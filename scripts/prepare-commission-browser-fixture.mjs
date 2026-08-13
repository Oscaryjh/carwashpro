import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DATABASE_URL } from "./embedded-postgres-utils.mjs";

const configuredUrl = process.env.DATABASE_URL ?? DATABASE_URL;
const hostname = new URL(configuredUrl).hostname.toLowerCase();
if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
  throw new Error("Commission browser fixtures are restricted to the Local database.");
}

process.env.DATABASE_URL = configuredUrl;
const prisma = new PrismaClient();
const qaPassword = process.env.LOCAL_MODULE_QA_PASSWORD;
if (!qaPassword || qaPassword.length < 12) {
  throw new Error("LOCAL_MODULE_QA_PASSWORD must contain at least 12 characters.");
}

try {
  const business = await prisma.business.findUniqueOrThrow({
    where: { slug: "qa-module-full-business" },
  });
  const branch = await prisma.branch.findFirstOrThrow({
    where: { businessId: business.id, name: "QA Main Branch" },
  });
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: "module-full-owner@test.local" },
  });
  const passwordHash = await bcrypt.hash(qaPassword, 12);
  const approver = await prisma.user.upsert({
    where: { email: "module-full-commission-approver@test.local" },
    create: {
      businessId: business.id,
      branchId: branch.id,
      name: "Commission QA Independent Approver",
      email: "module-full-commission-approver@test.local",
      passwordHash,
      role: "BUSINESS_OWNER",
      status: "active",
      loginEnabled: true,
    },
    update: {
      businessId: business.id,
      branchId: branch.id,
      name: "Commission QA Independent Approver",
      passwordHash,
      role: "BUSINESS_OWNER",
      status: "active",
      loginEnabled: true,
    },
  });

  const employeeAccount = await prisma.employeeAccount.upsert({
    where: { phoneNormalized: "+601155500001" },
    create: {
      phoneNumber: "+601155500001",
      phoneNormalized: "+601155500001",
      name: "Commission QA Staff A",
    },
    update: { name: "Commission QA Staff A", status: "ACTIVE" },
  });
  const membership = await prisma.employeeBusinessMembership.upsert({
    where: {
      employeeAccountId_businessId: {
        employeeAccountId: employeeAccount.id,
        businessId: business.id,
      },
    },
    create: {
      employeeAccountId: employeeAccount.id,
      businessId: business.id,
      employeeCode: "COMMISSION-QA-A",
      fullName: "Commission QA Staff A",
      phoneNumber: "+601155500001",
      phoneNumberNormalized: "+601155500001",
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    update: {
      fullName: "Commission QA Staff A",
      status: "ACTIVE",
      terminatedAt: null,
    },
  });
  const staff = await prisma.user.upsert({
    where: { email: "commission-staff-a@test.local" },
    create: {
      businessId: business.id,
      branchId: branch.id,
      employeeAccountId: employeeAccount.id,
      employeeBusinessMembershipId: membership.id,
      teamMemberLinkStatus: "LINKED",
      teamMemberLinkedAt: new Date(),
      name: "Commission QA Staff A",
      email: "commission-staff-a@test.local",
      role: "STAFF",
      status: "active",
      loginEnabled: false,
      appointmentBookable: true,
      permissions: ["APPOINTMENTS"],
    },
    update: {
      businessId: business.id,
      branchId: branch.id,
      employeeAccountId: employeeAccount.id,
      employeeBusinessMembershipId: membership.id,
      teamMemberLinkStatus: "LINKED",
      teamMemberLinkedAt: new Date(),
      name: "Commission QA Staff A",
      role: "STAFF",
      status: "active",
      loginEnabled: false,
      appointmentBookable: true,
      permissions: ["APPOINTMENTS"],
    },
  });

  const activeAssignment = await prisma.employeeBranchAssignment.findFirst({
    where: { membershipId: membership.id, branchId: branch.id, status: "ACTIVE" },
  });
  if (!activeAssignment) {
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
    where: {
      businessId_name: {
        businessId: business.id,
        name: "Commission QA Haircut RM100",
      },
    },
    create: {
      businessId: business.id,
      branchId: branch.id,
      name: "Commission QA Haircut RM100",
      category: "Commission QA",
      price: "100.00",
      durationMinutes: 45,
      taxable: false,
    },
    update: {
      branchId: branch.id,
      price: "100.00",
      durationMinutes: 45,
      taxable: false,
      status: "ACTIVE",
    },
  });

  let customer = await prisma.customer.findFirst({
    where: { businessId: business.id, phone: "+601155500002" },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        businessId: business.id,
        branchId: branch.id,
        name: "Commission QA Customer",
        phone: "+601155500002",
      },
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
        scheduledAt: new Date("2026-08-10T08:00:00.000Z"),
        durationMinutes: 45,
        status: "COMPLETED",
        completedAt: new Date("2026-08-10T08:45:00.000Z"),
        notes: "LOCAL / TESTING ONLY Commission browser fixture.",
      },
    });
  }

  const openShift = await prisma.cashierShift.findFirst({
    where: { businessId: business.id, cashierId: owner.id, status: "OPEN" },
  });
  if (!openShift) {
    await prisma.cashierShift.create({
      data: {
        businessId: business.id,
        branchId: branch.id,
        cashierId: owner.id,
        openingFloat: "0.00",
        notes: "LOCAL / TESTING ONLY Commission browser fixture.",
      },
    });
  }
  const approverShift = await prisma.cashierShift.findFirst({
    where: { businessId: business.id, cashierId: approver.id, status: "OPEN" },
  });
  if (!approverShift) {
    await prisma.cashierShift.create({
      data: {
        businessId: business.id,
        branchId: branch.id,
        cashierId: approver.id,
        openingFloat: "0.00",
        notes: "LOCAL / TESTING ONLY Commission refund browser fixture.",
      },
    });
  }

  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    businessId: business.id,
    branchId: branch.id,
    ownerId: owner.id,
    approverId: approver.id,
    staffId: staff.id,
    membershipId: membership.id,
    serviceId: service.id,
    customerId: customer.id,
    appointmentId: appointment.id,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
