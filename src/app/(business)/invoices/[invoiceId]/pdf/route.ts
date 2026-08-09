import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import {
  buildInvoicePdf,
  buildInvoiceReceiptPdf,
  invoicePdfFileName,
} from "@/lib/invoices/invoice-pdf";
import { formatInvoiceNumber } from "@/lib/invoices/invoice-number";
import { getInvoicePaymentSummary } from "@/lib/invoices/payment-summary";
import { prisma } from "@/lib/prisma";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";

type InvoicePdfRouteProps = {
  params: Promise<{
    invoiceId: string;
  }>;
};

export async function GET(request: Request, { params }: InvoicePdfRouteProps) {
  const { businessId } = await requireBusinessUser("VIEW_INVOICES");
  const { invoiceId } = await params;
  const isReceipt = new URL(request.url).searchParams.get("format") === "receipt";
  const buildPdfDocument = isReceipt ? buildInvoiceReceiptPdf : buildInvoicePdf;
  const invoice = await prisma.invoice.findFirst({
    where: {
      businessId,
      id: invoiceId,
    },
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
      workOrder: {
        include: {
          customer: true,
          items: { orderBy: { createdAt: "asc" } },
          payments: {
            include: {
              customerPackage: {
                include: {
                  package: true,
                },
              },
            },
            orderBy: { paidAt: "desc" },
          },
          vehicle: true,
        },
      },
      appointment: {
        include: {
          assignedStaff: { select: { name: true } },
          customer: true,
        },
      },
      items: { orderBy: { createdAt: "asc" } },
      payments: {
        where: { status: "ACTIVE" },
        include: { refunds: true },
        orderBy: { paidAt: "desc" },
      },
      customer: true,
      customerPackage: { include: { package: true } },
    },
  });

  if (!invoice) {
    notFound();
  }

  if (invoice.appointment) {
    const logo = await loadInvoiceLogo(invoice.business.logoUrl);
    const paymentSummary = getInvoicePaymentSummary(invoice.payments);
    const appointmentDate = invoice.appointment.scheduledAt.toLocaleDateString("en-MY");
    const appointmentTime = invoice.appointment.scheduledAt.toLocaleTimeString("en-MY", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const pdf = buildPdfDocument({
      company: { ...invoice.business, logo },
      customer: {
        name: invoice.appointment.customer.name,
        phone: invoice.appointment.customer.phone,
      },
      invoiceNumber: formatInvoiceNumber(invoice.invoiceNumber),
      issuedAt: invoice.issuedAt,
      items: invoice.items,
      paidAmount: invoice.paidAmount,
      cashPaidAmount: paymentSummary.cashPaidAmount,
      packageVoucherAmount: paymentSummary.packageVoucherAmount,
      discountAmount: invoice.discountAmount,
      loyaltyDiscountAmount: invoice.loyaltyDiscountAmount,
      loyaltyPointsRedeemed: invoice.loyaltyPointsRedeemed,
      depositAmount: invoice.depositAmount,
      taxAmount: invoice.taxAmount,
      taxLabel: invoice.taxLabel,
      taxRate: invoice.taxRate,
      tipAmount: invoice.tipAmount,
      balance: invoice.balance,
      status: invoice.status,
      subtotal: invoice.subtotal,
      total: invoice.total,
      reference: {
        label: "Appointment",
        value: appointmentDate,
        detail: `${appointmentTime} / ${invoice.appointment.assignedStaff?.name ?? "Unassigned"}`,
      },
    });
    const fileName = receiptFileName(formatInvoiceNumber(invoice.invoiceNumber), isReceipt);
    return pdfResponse(pdf, fileName, isReceipt);
  }

  if (!invoice.workOrder) {
    const packageItems = invoice.items.length
      ? invoice.items
      : [{
          name: invoice.customerPackage?.package.name ?? "Package purchase",
          quantity: 1,
          unitPrice: invoice.subtotal,
          lineTotal: invoice.subtotal,
        }];
    const packageCount = packageItems.reduce((sum, item) => sum + item.quantity, 0);
    const packageName =
      packageItems.length === 1 ? packageItems[0].name : `${packageCount} packages`;
    const logo = await loadInvoiceLogo(invoice.business.logoUrl);
    const pdf = buildPdfDocument({
      company: { ...invoice.business, logo },
      customer: {
        name: invoice.customer?.name ?? "Customer",
        phone: invoice.customer?.phone ?? "",
      },
      invoiceNumber: formatInvoiceNumber(invoice.invoiceNumber),
      issuedAt: invoice.issuedAt,
      items: packageItems,
      paidAmount: invoice.paidAmount,
      discountAmount: invoice.discountAmount,
      loyaltyDiscountAmount: invoice.loyaltyDiscountAmount,
      loyaltyPointsRedeemed: invoice.loyaltyPointsRedeemed,
      depositAmount: invoice.depositAmount,
      taxAmount: invoice.taxAmount,
      taxLabel: invoice.taxLabel,
      taxRate: invoice.taxRate,
      tipAmount: invoice.tipAmount,
      balance: invoice.balance,
      status: invoice.status,
      subtotal: invoice.subtotal,
      total: invoice.total,
      reference: {
        label: "Package",
        value: packageName,
        detail: packageItems.map((item) => `${item.name} x${item.quantity}`).join(", "),
      },
    });
    const fileName = receiptFileName(formatInvoiceNumber(invoice.invoiceNumber), isReceipt);
    return pdfResponse(pdf, fileName, isReceipt);
  }

  const displayInvoiceNumber = formatInvoiceNumber(invoice.invoiceNumber);
  const paymentSummary = getInvoicePaymentSummary(invoice.workOrder.payments);
  const logo = await loadInvoiceLogo(invoice.business.logoUrl);
  const pdf = buildPdfDocument({
    company: {
      ...invoice.business,
      logo,
    },
    customer: {
      name: invoice.workOrder.contactName || invoice.workOrder.customer.name,
      phone:
        normalizeMalaysiaWhatsAppPhone(
          invoice.workOrder.contactPhone || invoice.workOrder.customer.phone,
        ) ||
        invoice.workOrder.contactPhone ||
        invoice.workOrder.customer.phone,
    },
    invoiceNumber: displayInvoiceNumber,
    issuedAt: invoice.issuedAt,
    items: invoice.workOrder.items,
    paidAmount: invoice.paidAmount,
    cashPaidAmount: paymentSummary.cashPaidAmount,
    packageVoucherAmount: paymentSummary.packageVoucherAmount,
    discountAmount: invoice.discountAmount,
    loyaltyDiscountAmount: invoice.loyaltyDiscountAmount,
    loyaltyPointsRedeemed: invoice.loyaltyPointsRedeemed,
    depositAmount: invoice.depositAmount,
    taxAmount: invoice.taxAmount,
    taxLabel: invoice.taxLabel,
    taxRate: invoice.taxRate,
    tipAmount: invoice.tipAmount,
    balance: invoice.balance,
    status: invoice.status,
    subtotal: invoice.subtotal,
    total: invoice.total,
    vehicle: invoice.workOrder.vehicle,
  });
  const fileName = receiptFileName(displayInvoiceNumber, isReceipt);

  return pdfResponse(pdf, fileName, isReceipt);
}

function pdfResponse(pdf: Buffer, fileName: string, inline = false) {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fileName}"`,
      "Content-Length": String(pdf.length),
      "Content-Type": "application/pdf",
    },
  });
}

function receiptFileName(invoiceNumber: string, receipt: boolean) {
  const fileName = invoicePdfFileName(invoiceNumber);
  return receipt ? fileName.replace(/\.pdf$/i, "-58mm.pdf") : fileName;
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
