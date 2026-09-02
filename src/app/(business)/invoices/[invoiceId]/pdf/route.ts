import { notFound } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { authorizedOperationalBranchWhere } from "@/lib/branches";
import {
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
  const { businessId, user } = await requireBusinessUser("VIEW_INVOICES");
  const operationalBranchWhere = authorizedOperationalBranchWhere(user);
  const { invoiceId } = await params;
  const isReceipt = new URL(request.url).searchParams.get("format") === "receipt";
  const buildPdfDocument = buildInvoiceReceiptPdf;
  const invoice = await prisma.invoice.findFirst({
    where: {
      businessId,
      id: invoiceId,
      ...operationalBranchWhere,
    },
    include: {
      business: {
        select: {
          address: true,
          companyNo: true,
          name: true,
          phone: true,
          sstRegistrationNo: true,
        },
      },
      workOrder: {
        include: {
          customer: true,
          items: { orderBy: { createdAt: "asc" } },
          payments: {
            where: operationalBranchWhere,
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
        where: { status: "ACTIVE", ...operationalBranchWhere },
        include: {
          refunds: { where: operationalBranchWhere },
        },
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
    const paymentSummary = getInvoicePaymentSummary(invoice.payments);
    const appointmentDate = invoice.appointment.scheduledAt.toLocaleDateString("en-MY");
    const appointmentTime = invoice.appointment.scheduledAt.toLocaleTimeString("en-MY", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const pdf = buildPdfDocument({
      company: invoice.business,
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
      taxableSubtotal: invoice.taxableSubtotal,
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
    const pdf = buildPdfDocument({
      company: invoice.business,
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
      taxableSubtotal: invoice.taxableSubtotal,
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
  const pdf = buildPdfDocument({
    company: invoice.business,
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
    taxableSubtotal: invoice.taxableSubtotal,
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
  return receipt ? fileName.replace(/\.pdf$/i, "-receipt.pdf") : fileName;
}
