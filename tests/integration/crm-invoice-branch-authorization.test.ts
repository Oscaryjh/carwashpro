import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  authorizedCustomerPackageBranchWhere,
  authorizedOperationalBranchWhere,
} from "../../src/lib/branches";

const prisma = new PrismaClient();

after(async () => {
  await prisma.$disconnect();
});

test("Model C scopes a shared customer's activity while preserving business-wide identity", async () => {
  assertLocalDatabase();
  const suffix = randomUUID().slice(0, 8);
  const business = await prisma.business.create({
    data: { name: `CRM Model C ${suffix}`, slug: `crm-model-c-${suffix}` },
  });
  const otherBusiness = await prisma.business.create({
    data: { name: `CRM Other ${suffix}`, slug: `crm-other-${suffix}` },
  });

  try {
    const [branchA, branchB, otherBranch] = await Promise.all([
      prisma.branch.create({ data: { businessId: business.id, name: `Branch A ${suffix}` } }),
      prisma.branch.create({ data: { businessId: business.id, name: `Branch B ${suffix}` } }),
      prisma.branch.create({ data: { businessId: otherBusiness.id, name: `Other ${suffix}` } }),
    ]);
    const customer = await prisma.customer.create({
      data: {
        businessId: business.id,
        name: `Shared Customer ${suffix}`,
        phone: `011${suffix.replace(/\D/g, "").padEnd(8, "7").slice(0, 8)}`,
      },
    });
    const otherCustomer = await prisma.customer.create({
      data: {
        businessId: otherBusiness.id,
        name: `Other Customer ${suffix}`,
        phone: `012${suffix.replace(/\D/g, "").padEnd(8, "8").slice(0, 8)}`,
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        businessId: business.id,
        customerId: customer.id,
        plateNumber: `UAT${suffix.toUpperCase()}`,
      },
    });

    const [invoiceA, invoiceB, otherInvoice] = await Promise.all([
      prisma.invoice.create({
        data: {
          balance: 0,
          branchId: branchA.id,
          businessId: business.id,
          customerId: customer.id,
          invoiceNumber: `A-${suffix}`,
          paidAmount: 100,
          status: "PAID",
          subtotal: 100,
          total: 100,
        },
      }),
      prisma.invoice.create({
        data: {
          balance: 0,
          branchId: branchB.id,
          businessId: business.id,
          customerId: customer.id,
          invoiceNumber: `B-${suffix}`,
          paidAmount: 200,
          status: "PAID",
          subtotal: 200,
          total: 200,
        },
      }),
      prisma.invoice.create({
        data: {
          balance: 0,
          branchId: otherBranch.id,
          businessId: otherBusiness.id,
          customerId: otherCustomer.id,
          invoiceNumber: `OTHER-${suffix}`,
          paidAmount: 999,
          status: "PAID",
          subtotal: 999,
          total: 999,
        },
      }),
    ]);
    const [paymentA, paymentB] = await Promise.all([
      prisma.payment.create({
        data: {
          amount: 100,
          branchId: branchA.id,
          businessId: business.id,
          invoiceId: invoiceA.id,
          method: "CASH",
        },
      }),
      prisma.payment.create({
        data: {
          amount: 200,
          branchId: branchB.id,
          businessId: business.id,
          invoiceId: invoiceB.id,
          method: "CARD",
        },
      }),
    ]);
    await prisma.paymentRefund.create({
      data: {
        amount: 20,
        branchId: branchB.id,
        businessId: business.id,
        invoiceId: invoiceB.id,
        method: "CARD",
        paymentId: paymentB.id,
        reason: "Branch B only refund",
      },
    });
    await Promise.all([
      prisma.appointment.create({
        data: {
          branchId: branchA.id,
          businessId: business.id,
          customerId: customer.id,
          scheduledAt: new Date("2026-08-28T02:00:00.000Z"),
        },
      }),
      prisma.appointment.create({
        data: {
          branchId: branchB.id,
          businessId: business.id,
          customerId: customer.id,
          scheduledAt: new Date("2026-08-28T03:00:00.000Z"),
        },
      }),
      prisma.workOrder.create({
        data: {
          balance: 100,
          branchId: branchA.id,
          businessId: business.id,
          customerId: customer.id,
          orderNumber: `WO-A-${suffix}`,
          subtotal: 100,
          total: 100,
          vehicleId: vehicle.id,
        },
      }),
      prisma.workOrder.create({
        data: {
          balance: 200,
          branchId: branchB.id,
          businessId: business.id,
          customerId: customer.id,
          orderNumber: `WO-B-${suffix}`,
          subtotal: 200,
          total: 200,
          vehicleId: vehicle.id,
        },
      }),
    ]);
    const [packageA, packageB, packageGlobal] = await Promise.all([
      prisma.package.create({
        data: { branchId: branchA.id, businessId: business.id, name: `Pkg A ${suffix}`, price: 100 },
      }),
      prisma.package.create({
        data: { branchId: branchB.id, businessId: business.id, name: `Pkg B ${suffix}`, price: 200 },
      }),
      prisma.package.create({
        data: { businessId: business.id, name: `Pkg Global ${suffix}`, price: 300 },
      }),
    ]);
    await Promise.all([
      prisma.customerPackage.create({
        data: {
          branchId: branchA.id,
          businessId: business.id,
          customerId: customer.id,
          packageId: packageA.id,
          purchasePrice: 100,
          remainingUses: 1,
          status: "ACTIVE",
          totalUses: 1,
        },
      }),
      prisma.customerPackage.create({
        data: {
          branchId: branchB.id,
          businessId: business.id,
          customerId: customer.id,
          packageId: packageB.id,
          purchasePrice: 200,
          remainingUses: 1,
          status: "ACTIVE",
          totalUses: 1,
        },
      }),
      prisma.customerPackage.create({
        data: {
          businessId: business.id,
          customerId: customer.id,
          packageId: packageGlobal.id,
          purchasePrice: 300,
          remainingUses: 1,
          status: "ACTIVE",
          totalUses: 1,
        },
      }),
    ]);

    const staff = { branchId: branchA.id, role: "STAFF" as const };
    const owner = { branchId: null, role: "BUSINESS_OWNER" as const };
    const staffScope = authorizedOperationalBranchWhere(staff);

    const staffCustomer = await prisma.customer.findFirst({
      where: { businessId: business.id, id: customer.id },
      include: {
        appointments: { where: staffScope },
        invoices: {
          where: staffScope,
          include: {
            payments: {
              where: staffScope,
              include: { refunds: { where: staffScope } },
            },
          },
        },
        customerPackages: {
          where: authorizedCustomerPackageBranchWhere(staff),
        },
        workOrders: { where: staffScope },
      },
    });
    assert.ok(staffCustomer, "business-wide customer master remains visible");
    assert.equal(staffCustomer.appointments.length, 1);
    assert.equal(staffCustomer.invoices.length, 1);
    assert.equal(staffCustomer.invoices[0].id, invoiceA.id);
    assert.equal(staffCustomer.invoices[0].payments[0].id, paymentA.id);
    assert.equal(staffCustomer.invoices[0].payments[0].refunds.length, 0);
    assert.equal(staffCustomer.customerPackages.length, 2);
    assert.equal(staffCustomer.workOrders.length, 1);

    const [staffTotal, ownerTotal] = await Promise.all([
      prisma.invoice.aggregate({
        where: {
          businessId: business.id,
          customerId: customer.id,
          ...staffScope,
        },
        _sum: { paidAmount: true },
      }),
      prisma.invoice.aggregate({
        where: {
          businessId: business.id,
          customerId: customer.id,
          ...authorizedOperationalBranchWhere(owner),
        },
        _sum: { paidAmount: true },
      }),
    ]);
    assert.equal(Number(staffTotal._sum.paidAmount), 100);
    assert.equal(Number(ownerTotal._sum.paidAmount), 300);

    assert.equal(
      await prisma.invoice.findFirst({
        where: { businessId: business.id, id: invoiceB.id, ...staffScope },
      }),
      null,
    );
    assert.equal(
      await prisma.invoice.findFirst({
        where: { businessId: business.id, id: otherInvoice.id, ...staffScope },
      }),
      null,
    );
    await assert.rejects(
      prisma.customer.create({
        data: {
          businessId: business.id,
          name: "Duplicate phone",
          phone: customer.phone,
        },
      }),
    );
    await assert.rejects(
      prisma.vehicle.create({
        data: {
          businessId: business.id,
          customerId: customer.id,
          plateNumber: vehicle.plateNumber,
        },
      }),
    );
  } finally {
    await prisma.paymentRefund.deleteMany({ where: { businessId: { in: [business.id, otherBusiness.id] } } });
    await prisma.payment.deleteMany({ where: { businessId: { in: [business.id, otherBusiness.id] } } });
    await prisma.invoice.deleteMany({ where: { businessId: { in: [business.id, otherBusiness.id] } } });
    await prisma.customerPackage.deleteMany({ where: { businessId: business.id } });
    await prisma.package.deleteMany({ where: { businessId: business.id } });
    await prisma.appointment.deleteMany({ where: { businessId: business.id } });
    await prisma.workOrder.deleteMany({ where: { businessId: business.id } });
    await prisma.vehicle.deleteMany({ where: { businessId: business.id } });
    await prisma.customer.deleteMany({ where: { businessId: { in: [business.id, otherBusiness.id] } } });
    await prisma.branch.deleteMany({ where: { businessId: { in: [business.id, otherBusiness.id] } } });
    await prisma.business.deleteMany({ where: { id: { in: [business.id, otherBusiness.id] } } });
  }
});

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(
    new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(hostname),
    "Integration test requires a local database",
  );
}
