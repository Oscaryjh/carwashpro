import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { DATABASE_URL } from "./embedded-postgres-utils.mjs";

const configuredUrl = process.env.DATABASE_URL ?? DATABASE_URL;
const hostname = new URL(configuredUrl).hostname.toLowerCase();
if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
  throw new Error("Post-auth financial QA is restricted to the Local database.");
}

process.env.DATABASE_URL = configuredUrl;
const prisma = new PrismaClient();
const action = process.argv[2];
const suffix = process.argv[3];

try {
  if (action === "create") {
    const password = process.env.LOCAL_POST_AUTH_QA_PASSWORD;
    if (!password || password.length < 12) {
      throw new Error(
        "LOCAL_POST_AUTH_QA_PASSWORD must contain at least 12 characters.",
      );
    }
    const fixtureSuffix = new Date()
      .toISOString()
      .replace(/\D/g, "")
      .slice(0, 14);
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await prisma.$transaction(async (tx) => {
      const salonBusiness = await tx.business.create({
        data: {
          name: `POST AUTH SALON QA ${fixtureSuffix}`,
          slug: `post-auth-salon-qa-${fixtureSuffix}`,
          industryType: "SALON_BEAUTY",
        },
      });
      const salonBranch = await tx.branch.create({
        data: { businessId: salonBusiness.id, name: "Post-Auth Salon Branch" },
      });
      const salonOwner = await tx.user.create({
        data: {
          businessId: salonBusiness.id,
          branchId: salonBranch.id,
          name: "Post-Auth Salon Owner",
          email: `post-auth-salon-owner-${fixtureSuffix}@test.local`,
          passwordHash,
          role: "BUSINESS_OWNER",
          loginEnabled: true,
          appointmentBookable: true,
        },
      });
      const salonManager = await tx.user.create({
        data: {
          businessId: salonBusiness.id,
          branchId: salonBranch.id,
          name: "Post-Auth Salon Manager",
          email: `post-auth-salon-manager-${fixtureSuffix}@test.local`,
          passwordHash,
          role: "STAFF",
          loginEnabled: true,
          permissions: [
            "ALL_BRANCHES",
            "CRM",
            "APPOINTMENTS",
            "POS",
            "INVOICES",
            "CLOSING",
            "REPORTS",
          ],
        },
      });
      const salonCashier = await tx.user.create({
        data: {
          businessId: salonBusiness.id,
          branchId: salonBranch.id,
          name: "Post-Auth Salon Cashier",
          email: `post-auth-salon-cashier-${fixtureSuffix}@test.local`,
          passwordHash,
          role: "STAFF",
          loginEnabled: true,
          permissions: ["CRM", "APPOINTMENTS", "POS", "INVOICES", "CLOSING"],
        },
      });
      const salonDenied = await tx.user.create({
        data: {
          businessId: salonBusiness.id,
          branchId: salonBranch.id,
          name: "Post-Auth Salon Denied",
          email: `post-auth-salon-denied-${fixtureSuffix}@test.local`,
          passwordHash,
          role: "STAFF",
          loginEnabled: true,
          permissions: ["CRM"],
        },
      });
      const salonCustomer = await tx.customer.create({
        data: {
          businessId: salonBusiness.id,
          branchId: salonBranch.id,
          name: "Post-Auth Salon Customer",
          phone: `+6011${fixtureSuffix.slice(-8)}`,
        },
      });
      const salonService = await tx.service.create({
        data: {
          businessId: salonBusiness.id,
          branchId: salonBranch.id,
          name: `Post-Auth Salon Service ${fixtureSuffix}`,
          category: "Post-Auth QA",
          price: "88.00",
          durationMinutes: 45,
          taxable: false,
        },
      });
      const salonAppointment = await tx.appointment.create({
        data: {
          businessId: salonBusiness.id,
          branchId: salonBranch.id,
          customerId: salonCustomer.id,
          serviceId: salonService.id,
          serviceIds: [salonService.id],
          createdById: salonOwner.id,
          assignedStaffId: salonOwner.id,
          scheduledAt: new Date(),
          durationMinutes: 45,
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });
      await tx.cashierShift.create({
        data: {
          businessId: salonBusiness.id,
          branchId: salonBranch.id,
          cashierId: salonOwner.id,
          openingFloat: "0.00",
        },
      });

      const autoBusiness = await tx.business.create({
        data: {
          name: `POST AUTH AUTO QA ${fixtureSuffix}`,
          slug: `post-auth-auto-qa-${fixtureSuffix}`,
          industryType: "AUTO_DETAILING",
        },
      });
      const autoBranch = await tx.branch.create({
        data: { businessId: autoBusiness.id, name: "Post-Auth Auto Branch" },
      });
      const autoOwner = await tx.user.create({
        data: {
          businessId: autoBusiness.id,
          branchId: autoBranch.id,
          name: "Post-Auth Auto Owner",
          email: `post-auth-auto-owner-${fixtureSuffix}@test.local`,
          passwordHash,
          role: "BUSINESS_OWNER",
          loginEnabled: true,
        },
      });
      const autoCustomer = await tx.customer.create({
        data: {
          businessId: autoBusiness.id,
          branchId: autoBranch.id,
          name: "Post-Auth Auto Customer",
          phone: `+6012${fixtureSuffix.slice(-8)}`,
        },
      });
      const autoVehicle = await tx.vehicle.create({
        data: {
          businessId: autoBusiness.id,
          branchId: autoBranch.id,
          customerId: autoCustomer.id,
          plateNumber: `PA${fixtureSuffix.slice(-6)}`,
          brand: "QA",
          model: "Post-Auth",
        },
      });
      const autoService = await tx.service.create({
        data: {
          businessId: autoBusiness.id,
          branchId: autoBranch.id,
          name: `Post-Auth Auto Service ${fixtureSuffix}`,
          category: "Post-Auth QA",
          price: "150.00",
          durationMinutes: 60,
          taxable: false,
        },
      });
      const autoWorkOrder = await tx.workOrder.create({
        data: {
          businessId: autoBusiness.id,
          branchId: autoBranch.id,
          customerId: autoCustomer.id,
          vehicleId: autoVehicle.id,
          orderNumber: `PA-WO-${fixtureSuffix}`,
          status: "READY_FOR_PICKUP",
          subtotal: "150.00",
          total: "150.00",
          paidAmount: "0.00",
          balance: "150.00",
        },
      });
      await tx.workOrderItem.create({
        data: {
          businessId: autoBusiness.id,
          workOrderId: autoWorkOrder.id,
          serviceId: autoService.id,
          name: autoService.name,
          quantity: 1,
          unitPrice: "150.00",
          lineTotal: "150.00",
        },
      });
      await tx.cashierShift.create({
        data: {
          businessId: autoBusiness.id,
          branchId: autoBranch.id,
          cashierId: autoOwner.id,
          openingFloat: "0.00",
        },
      });

      return {
        fixtureSuffix,
        salon: {
          businessId: salonBusiness.id,
          businessName: salonBusiness.name,
          branchId: salonBranch.id,
          ownerEmail: salonOwner.email,
          managerEmail: salonManager.email,
          cashierEmail: salonCashier.email,
          deniedEmail: salonDenied.email,
          appointmentId: salonAppointment.id,
          expectedGross: "88.00",
        },
        auto: {
          businessId: autoBusiness.id,
          businessName: autoBusiness.name,
          branchId: autoBranch.id,
          ownerEmail: autoOwner.email,
          workOrderId: autoWorkOrder.id,
          expectedGross: "150.00",
        },
      };
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (
    action === "revoke-salon-cashier" ||
    action === "restore-salon-cashier"
  ) {
    if (!suffix || !/^\d{14}$/.test(suffix)) {
      throw new Error(`${action} requires the 14-digit fixture suffix.`);
    }
    const email = `post-auth-salon-cashier-${suffix}@test.local`;
    const permissions =
      action === "restore-salon-cashier"
        ? ["CRM", "APPOINTMENTS", "POS", "INVOICES", "CLOSING"]
        : ["CRM", "APPOINTMENTS", "INVOICES", "CLOSING"];
    await prisma.user.update({ where: { email }, data: { permissions } });
    console.log(
      JSON.stringify({ updated: email, pos: permissions.includes("POS") }),
    );
  } else if (action === "repair-auto-item") {
    if (!suffix || !/^\d{14}$/.test(suffix)) {
      throw new Error("repair-auto-item requires the 14-digit fixture suffix.");
    }
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: `post-auth-auto-qa-${suffix}` },
    });
    const workOrder = await prisma.workOrder.findFirstOrThrow({
      where: { businessId: business.id, orderNumber: `PA-WO-${suffix}` },
      include: { items: true },
    });
    if (workOrder.items.length === 0) {
      const service = await prisma.service.create({
        data: {
          businessId: business.id,
          branchId: workOrder.branchId,
          name: `Post-Auth Auto Service ${suffix}`,
          category: "Post-Auth QA",
          price: "150.00",
          durationMinutes: 60,
          taxable: false,
        },
      });
      await prisma.workOrderItem.create({
        data: {
          businessId: business.id,
          workOrderId: workOrder.id,
          serviceId: service.id,
          name: service.name,
          quantity: 1,
          unitPrice: "150.00",
          lineTotal: "150.00",
        },
      });
    }
    console.log(JSON.stringify({ repaired: workOrder.id }));
  } else if (action === "status") {
    if (!suffix || !/^\d{14}$/.test(suffix)) {
      throw new Error("status requires the 14-digit fixture suffix.");
    }
    const businesses = await prisma.business.findMany({
      where: {
        slug: {
          in: [
            `post-auth-salon-qa-${suffix}`,
            `post-auth-auto-qa-${suffix}`,
          ],
        },
      },
      orderBy: { industryType: "desc" },
      select: {
        id: true,
        name: true,
        industryType: true,
        invoices: {
          orderBy: { issuedAt: "asc" },
          select: {
            id: true,
            invoiceNumber: true,
            subtotal: true,
            total: true,
            paidAmount: true,
            balance: true,
            status: true,
            workOrderId: true,
            appointmentId: true,
            payments: {
              select: { id: true, amount: true, method: true, status: true },
            },
          },
        },
        cashierShifts: {
          orderBy: { startedAt: "asc" },
          select: {
            id: true,
            status: true,
            openingFloat: true,
            closingCash: true,
            expectedCash: true,
            cashDifference: true,
          },
        },
        dailyClosingSnapshots: {
          orderBy: { closedAt: "asc" },
          select: {
            id: true,
            businessDate: true,
            expectedCashCents: true,
            actualCashCents: true,
            cashDifferenceCents: true,
            reportDataJson: true,
          },
        },
        financialOperations: {
          orderBy: { createdAt: "asc" },
          select: { id: true, operationType: true, state: true },
        },
      },
    });
    console.log(JSON.stringify(businesses, decimalJsonReplacer, 2));
  } else {
    throw new Error(
      "Use create, revoke-salon-cashier <fixture-suffix>, restore-salon-cashier <fixture-suffix>, repair-auto-item <fixture-suffix>, or status <fixture-suffix>.",
    );
  }
} finally {
  await prisma.$disconnect();
}

function decimalJsonReplacer(_key, value) {
  if (value && typeof value === "object" && value.constructor?.name === "Decimal") {
    return value.toString();
  }
  return value;
}
