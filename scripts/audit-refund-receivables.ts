import { Prisma, PrismaClient } from "@prisma/client";
import { evaluateRefundReceivableRecord } from "../src/lib/invoices/refund-receivable-remediation";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("REFUND_RECEIVABLE_REPAIR_FORBIDDEN_IN_PRODUCTION");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  if (!new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(hostname)) {
    throw new Error("REFUND_RECEIVABLE_AUDIT_REQUIRES_LOCAL_DATABASE");
  }
  if (apply && process.env.ALLOW_LOCAL_REFUND_RECEIVABLE_REPAIR !== "1") {
    throw new Error(
      "Set ALLOW_LOCAL_REFUND_RECEIVABLE_REPAIR=1 for an explicit local repair.",
    );
  }
}

async function main() {
  assertSafeEnvironment();
  const invoices = await prisma.invoice.findMany({
    where: {
      OR: [
        { refunds: { some: {} } },
        { status: "REFUNDED", balance: { gt: 0 } },
      ],
    },
    orderBy: [{ businessId: "asc" }, { issuedAt: "asc" }, { id: "asc" }],
    select: {
      balance: true,
      branchId: true,
      businessId: true,
      id: true,
      invoiceNumber: true,
      paidAmount: true,
      status: true,
      total: true,
      workOrderId: true,
      payments: {
        select: {
          amount: true,
          id: true,
          status: true,
          refunds: { select: { amount: true, id: true } },
        },
      },
      workOrder: {
        select: {
          payments: {
            select: {
              amount: true,
              id: true,
              status: true,
              refunds: { select: { amount: true, id: true } },
            },
          },
        },
      },
    },
  });

  const rows = invoices.map((invoice) => {
    const payments = uniquePayments([
      ...invoice.payments,
      ...(invoice.workOrder?.payments ?? []),
    ]);
    const evaluation = evaluateRefundReceivableRecord({
      currentBalanceCents: toCents(invoice.balance),
      currentPaidAmountCents: toCents(invoice.paidAmount),
      currentStatus: invoice.status,
      payments,
      totalCents: toCents(invoice.total),
    });
    return {
      branchId: invoice.branchId,
      businessId: invoice.businessId,
      canonical: evaluation.canonical,
      category: evaluation.category,
      complex: evaluation.complex,
      current: {
        balanceCents: toCents(invoice.balance),
        paidAmountCents: toCents(invoice.paidAmount),
        status: invoice.status,
      },
      differsFromCanonical: evaluation.differsFromCanonical,
      exclusiveClassification: evaluation.complex
        ? "COMPLEX"
        : evaluation.category,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      paymentCount: evaluation.paymentCount,
      refundCount: evaluation.refundCount,
      workOrderId: invoice.workOrderId,
    };
  });
  const affected = rows.filter((row) => row.differsFromCanonical);
  const exclusiveCounts = countExclusiveClassifications(rows);
  const affectedExclusiveCounts = countExclusiveClassifications(affected);

  if (apply && affected.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const row of affected) {
        const data = {
          balance: fromCents(row.canonical.outstandingCents),
          paidAmount: fromCents(row.canonical.settledObligationCents),
          status: row.canonical.status,
        };
        await tx.invoice.update({
          where: { id: row.invoiceId, businessId: row.businessId },
          data,
        });
        if (row.workOrderId) {
          await tx.workOrder.update({
            where: { id: row.workOrderId, businessId: row.businessId },
            data: {
              balance: data.balance,
              paidAmount: data.paidAmount,
              paymentStatus: data.status,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            action: "REFUND_RECEIVABLE_SEMANTICS_REPAIRED",
            actorName: "Non-production repair script",
            after: asJson({ canonical: row.canonical }),
            before: asJson({ current: row.current }),
            branchId: row.branchId,
            businessId: row.businessId,
            entityId: row.invoiceId,
            entityType: "Invoice",
            metadata: asJson({
              category: row.category,
              complex: row.complex,
              paymentCount: row.paymentCount,
              refundCount: row.refundCount,
            }),
            summary: `Recalculated invoice ${row.invoiceNumber} settlement from canonical payment and refund records.`,
          },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  console.log(JSON.stringify({
    applied: apply,
    counts: {
      affected: affected.length,
      affectedExclusive: affectedExclusiveCounts,
      exclusive: exclusiveCounts,
      scanned: rows.length,
    },
    productionAccessed: false,
    rows,
  }, null, 2));
}

function countExclusiveClassifications(
  rows: Array<{ exclusiveClassification: string }>,
) {
  const counts = {
    complex: 0,
    fullyPaidFullRefund: 0,
    fullyPaidPartialRefund: 0,
    other: 0,
    partialPaidRefund: 0,
  };
  for (const row of rows) {
    if (row.exclusiveClassification === "COMPLEX") counts.complex += 1;
    else if (row.exclusiveClassification === "FULLY_PAID_FULL_REFUND") {
      counts.fullyPaidFullRefund += 1;
    } else if (row.exclusiveClassification === "FULLY_PAID_PARTIAL_REFUND") {
      counts.fullyPaidPartialRefund += 1;
    } else if (row.exclusiveClassification === "PARTIAL_PAID_REFUND") {
      counts.partialPaidRefund += 1;
    } else counts.other += 1;
  }
  return {
    ...counts,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}

function uniquePayments<T extends { id: string }>(payments: T[]) {
  return [...new Map(payments.map((payment) => [payment.id, payment])).values()];
}

function toCents(value: unknown) {
  return Math.round(Number(value ?? 0) * 100);
}

function fromCents(value: number) {
  return new Prisma.Decimal(value).div(100);
}

function asJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
