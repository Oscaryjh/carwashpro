import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function assertLocal() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("POS_CORE_UAT_READ_FORBIDDEN_IN_PRODUCTION");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  if (!new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(hostname)) {
    throw new Error("POS_CORE_UAT_READ_REQUIRES_LOCAL_DATABASE");
  }
}

async function main() {
  assertLocal();
  const invoiceId = process.argv[2];
  if (!invoiceId) throw new Error("INVOICE_ID_REQUIRED");

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      invoiceNumber: true,
      paidAmount: true,
      balance: true,
      status: true,
      payments: {
        orderBy: { paidAt: "asc" },
        select: {
          amount: true,
          method: true,
          status: true,
          packageUses: true,
          paidAt: true,
        },
      },
      refunds: {
        orderBy: { refundedAt: "asc" },
        select: {
          amount: true,
          method: true,
          reason: true,
          refundedAt: true,
        },
      },
    },
  });

  console.log(JSON.stringify(invoice));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
