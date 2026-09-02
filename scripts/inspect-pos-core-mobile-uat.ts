import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const businesses = await prisma.business.findMany({
    where: { slug: { in: ["tetamu-uat-salon", "tetamu-uat-auto"] } },
    orderBy: { slug: "asc" },
    select: { id: true, name: true, slug: true },
  });

  const output = [];
  for (const business of businesses) {
    const [appointments, invoices, packages, workOrders] = await Promise.all([
      prisma.appointment.findMany({
        where: { businessId: business.id },
        orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
        take: 25,
        select: {
          id: true,
          scheduledAt: true,
          status: true,
          customer: { select: { name: true } },
          service: { select: { name: true } },
          invoice: {
            select: {
              balance: true,
              id: true,
              invoiceNumber: true,
              status: true,
              total: true,
            },
          },
        },
      }),
      prisma.invoice.findMany({
        where: { businessId: business.id },
        orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
        take: 25,
        select: {
          appointmentId: true,
          balance: true,
          customer: { select: { name: true } },
          discountAmount: true,
          id: true,
          invoiceNumber: true,
          issuedAt: true,
          paidAmount: true,
          status: true,
          subtotal: true,
          total: true,
          workOrderId: true,
          items: { select: { name: true, quantity: true, lineTotal: true } },
          payments: {
            select: {
              amount: true,
              method: true,
              status: true,
              refunds: { select: { amount: true, reason: true } },
            },
          },
        },
      }),
      prisma.customerPackage.findMany({
        where: { businessId: business.id },
        orderBy: { updatedAt: "desc" },
        take: 15,
        select: {
          id: true,
          remainingUses: true,
          status: true,
          totalUses: true,
          customer: { select: { name: true } },
          package: { select: { name: true } },
          serviceBalances: {
            select: {
              remainingUses: true,
              totalUses: true,
              service: { select: { name: true } },
            },
          },
        },
      }),
      prisma.workOrder.findMany({
        where: { businessId: business.id },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          balance: true,
          id: true,
          orderNumber: true,
          paidAmount: true,
          paymentStatus: true,
          status: true,
          total: true,
          customer: { select: { name: true } },
          vehicle: { select: { plateNumber: true, brand: true, model: true } },
          items: { select: { name: true, quantity: true, lineTotal: true } },
          invoice: { select: { id: true, invoiceNumber: true, balance: true, status: true } },
        },
      }),
    ]);

    output.push({ business, appointments, invoices, packages, workOrders });
  }

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
