import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { formatInvoiceNumber } from "@/lib/invoices/invoice-number";
import { buildInvoicePdf } from "@/lib/invoices/invoice-pdf";
import { prisma } from "@/lib/prisma";

type CreditNotePdfRouteProps = {
  params: Promise<{
    invoiceId: string;
    creditNoteId: string;
  }>;
};

export async function GET(_request: Request, { params }: CreditNotePdfRouteProps) {
  const { businessId } = await requireBusinessUser("VIEW_INVOICES");
  const { invoiceId, creditNoteId } = await params;
  const creditNote = await prisma.creditNote.findFirst({
    where: { id: creditNoteId, invoiceId, businessId },
    include: {
      business: {
        select: {
          address: true,
          companyNo: true,
          logoUrl: true,
          name: true,
          phone: true,
        },
      },
      customer: true,
      invoice: true,
      items: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!creditNote) {
    notFound();
  }

  const logo = await loadInvoiceLogo(creditNote.business.logoUrl);
  const pdf = buildInvoicePdf({
    company: { ...creditNote.business, logo },
    customer: {
      name: creditNote.customer?.name ?? "Customer",
      phone: creditNote.customer?.phone ?? "",
    },
    invoiceNumber: creditNote.creditNoteNumber,
    documentTitle: "Credit Note",
    numberLabel: "Credit Note No.",
    issuedAt: creditNote.issuedAt,
    items: creditNote.items,
    paidAmount: creditNote.total,
    balance: 0,
    status: "CREDIT_NOTE",
    subtotal: creditNote.subtotal,
    taxAmount: creditNote.taxAmount,
    taxLabel: creditNote.taxLabel,
    taxRate: creditNote.taxRate,
    total: creditNote.total,
    reference: {
      label: "Original Invoice",
      value: formatInvoiceNumber(creditNote.invoice.invoiceNumber),
      detail: creditNote.reason,
    },
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Disposition": `attachment; filename="${creditNote.creditNoteNumber}.pdf"`,
      "Content-Length": String(pdf.length),
      "Content-Type": "application/pdf",
    },
  });
}

async function loadInvoiceLogo(logoUrl?: string | null) {
  if (!logoUrl?.startsWith("/uploads/")) {
    return null;
  }

  const publicDir = path.join(process.cwd(), "public");
  const logoPath = path.normalize(path.join(publicDir, logoUrl.replace(/^\/+/, "")));

  if (!logoPath.startsWith(publicDir)) {
    return null;
  }

  try {
    return {
      data: await readFile(logoPath),
      mimeType: getLogoMimeType(logoPath),
    };
  } catch {
    return null;
  }
}

function getLogoMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  return null;
}
