import type { Prisma } from "@prisma/client";

type InvoiceNumberTransaction = Pick<Prisma.TransactionClient, "business">;

export async function nextInvoiceNumber(
  transaction: InvoiceNumberTransaction,
  businessId: string,
) {
  const business = await transaction.business.update({
    where: { id: businessId },
    data: { invoiceSequence: { increment: 1 } },
    select: { invoiceSequence: true },
  });

  return String(business.invoiceSequence);
}

export function formatInvoiceNumber(invoiceNumber: string | null | undefined) {
  if (!invoiceNumber) {
    return "";
  }

  const oldFormat = invoiceNumber.match(
    /^INV-(20\d{6})-[^-]+-([A-Z0-9]{4})$/i,
  );

  if (oldFormat) {
    return `INV-${oldFormat[1].slice(2)}-${oldFormat[2].toUpperCase()}`;
  }

  return invoiceNumber;
}
