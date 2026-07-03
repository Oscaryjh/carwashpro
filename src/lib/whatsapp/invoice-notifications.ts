"use server";

import { prisma } from "@/lib/prisma";
import { formatInvoiceNumber } from "@/lib/invoices/invoice-number";
import { encodeWhatsAppStoredText } from "@/lib/whatsapp/message-codec";
import { enqueueWhatsAppLogMessage } from "@/lib/whatsapp/notification-queue";
import { renderManagedWhatsAppTemplate } from "@/lib/whatsapp/templates";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";

type SendInvoiceInput = {
  businessId: string;
  invoiceId: string;
  sentByUserId: string;
};

function formatMoney(value: unknown) {
  return `RM${Number(value ?? 0).toFixed(2)}`;
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

export async function sendInvoiceIfConnected({
  businessId,
  invoiceId,
  sentByUserId,
}: SendInvoiceInput) {
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      businessId,
    },
    include: {
      business: {
        select: {
          address: true,
          companyNo: true,
          name: true,
          phone: true,
        },
      },
      workOrder: {
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
          items: { orderBy: { createdAt: "asc" } },
          vehicle: {
            select: {
              brand: true,
              color: true,
              id: true,
              model: true,
              plateNumber: true,
            },
          },
        },
      },
    },
  });

  if (!invoice) {
    return;
  }

  const recipientPhone = normalizeMalaysiaWhatsAppPhone(
    invoice.workOrder.contactPhone || invoice.workOrder.customer.phone,
  );

  if (!recipientPhone) {
    return;
  }

  const recipientName =
    invoice.workOrder.contactName || invoice.workOrder.customer.name;
  const services = invoice.workOrder.items
    .map((item) => `${item.name} x${item.quantity}`)
    .join(", ");
  const vehicleName = [
    invoice.workOrder.vehicle.brand,
    invoice.workOrder.vehicle.model,
    invoice.workOrder.vehicle.color,
  ]
    .filter(Boolean)
    .join(" ");
  const displayInvoiceNumber = formatInvoiceNumber(invoice.invoiceNumber);

  const messageBody = await renderManagedWhatsAppTemplate("INVOICE_SENT", {
    balance: formatMoney(invoice.balance),
    companyAddress: invoice.business.address,
    companyName: invoice.business.name,
    companyNo: invoice.business.companyNo,
    companyPhone: invoice.business.phone,
    customerName: recipientName,
    customerPhone: invoice.workOrder.contactPhone || invoice.workOrder.customer.phone,
    invoiceNumber: displayInvoiceNumber,
    invoiceUrl: "",
    paidAmount: formatMoney(invoice.paidAmount),
    paymentStatus: formatStatus(invoice.status),
    plateNumber: invoice.workOrder.vehicle.plateNumber,
    services,
    subtotal: formatMoney(invoice.subtotal),
    total: formatMoney(invoice.total),
    vehicleName,
  });
  const storedMessageBody =
    encodeWhatsAppStoredText(messageBody) ?? "Invoice has been paid.";

  const log = await prisma.whatsAppMessage.create({
    data: {
      businessId,
      branchId: invoice.branchId,
      customerId: invoice.workOrder.customerId,
      invoiceId: invoice.id,
      messageBody: storedMessageBody,
      messageType: "INVOICE_SENT",
      phone: recipientPhone,
      provider: "WHATSAPP_WEB_AUTO",
      recipientPhone,
      sentByUserId,
      status: "DRAFT",
      vehicleId: invoice.workOrder.vehicleId,
      workOrderId: invoice.workOrderId,
    },
  });

  await prisma.whatsAppConversation.upsert({
    where: {
      businessId_phone: {
        businessId,
        phone: recipientPhone,
      },
    },
    create: {
      businessId,
      customerId: invoice.workOrder.customerId,
      displayName: recipientName,
      lastMessageAt: new Date(),
      lastMessageBody: storedMessageBody,
      phone: recipientPhone,
      remoteJid: `${recipientPhone}@s.whatsapp.net`,
      unreadCount: 0,
    },
    update: {
      customerId: invoice.workOrder.customerId,
      displayName: recipientName,
      remoteJid: `${recipientPhone}@s.whatsapp.net`,
    },
  });

  try {
    await enqueueWhatsAppLogMessage({
      businessId,
      branchId: invoice.branchId,
      message: messageBody,
      messageLogId: log.id,
      messageType: "INVOICE_SENT",
      phone: recipientPhone,
    });
  } catch (error) {
    await prisma.whatsAppMessage.update({
      where: { id: log.id },
      data: {
        errorMessage:
          error instanceof Error
            ? error.message
            : "Unable to send WhatsApp invoice PDF.",
      },
    });
  }
}
