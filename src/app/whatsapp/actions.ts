"use server";

import type { WhatsAppMessageType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { formatInvoiceNumber } from "@/lib/invoices/invoice-number";
import {
  formatInvoicePaymentStatus,
  getInvoicePaymentSummary,
} from "@/lib/invoices/payment-summary";
import { prisma } from "@/lib/prisma";
import { getDefaultWhatsAppInstanceId } from "@/lib/whatsapp/instance";
import { encodeWhatsAppStoredText } from "@/lib/whatsapp/message-codec";
import {
  generateWhatsAppAppLink,
  generateWhatsAppLink,
  normalizeMalaysiaWhatsAppPhone,
} from "@/lib/whatsappDeepLink";
import { renderManagedWhatsAppTemplate } from "@/lib/whatsapp/templates";

type OpenWhatsAppInput = {
  messageType: WhatsAppMessageType;
  customerId?: string;
  workOrderId?: string;
  invoiceId?: string;
};

export async function openWhatsAppDeepLinkAction(input: OpenWhatsAppInput) {
  try {
    const { user, businessId } = await requireBusinessUser();
    const senderPhone = await resolveSenderPhone(businessId, user.userId);

    const draft = await buildMessageDraft(input, businessId);
    const recipientPhone = normalizeMalaysiaWhatsAppPhone(draft.recipientPhone);

    if (!recipientPhone) {
      return { error: "Customer WhatsApp number is missing or invalid." };
    }

    const message = await prisma.whatsAppMessage.create({
      data: {
        businessId,
        branchId: draft.branchId,
        customerId: draft.customerId,
        vehicleId: draft.vehicleId,
        workOrderId: draft.workOrderId,
        invoiceId: draft.invoiceId,
        sentByUserId: user.userId,
        phone: recipientPhone,
        senderPhone,
        recipientPhone,
        messageType: input.messageType,
        messageBody: draft.messageBody,
        status: "OPENED",
        openedAt: new Date(),
      },
    });

    revalidateMessage(message.id);
    revalidateRelatedPaths(draft);

    return {
      appUrl: generateWhatsAppAppLink(recipientPhone, draft.messageBody),
      messageId: message.id,
      url: generateWhatsAppLink(recipientPhone, draft.messageBody),
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to prepare WhatsApp message.",
    };
  }
}

export async function markWhatsAppMessageSentAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const message = await getBusinessMessage(formData, businessId);
  const now = new Date();

  const updatedMessage = await prisma.whatsAppMessage.update({
    where: { id: message.id },
    data: {
      status: "SENT_MANUALLY",
      sentAt: now,
    },
  });

  if (message.status !== "SENT_MANUALLY") {
    await recordSentManualMessageToInbox(updatedMessage, businessId);
  }

  revalidateMessage(message.id);
  revalidatePath("/whatsapp/inbox");
}

export async function cancelWhatsAppMessageAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const message = await getBusinessMessage(formData, businessId);

  await prisma.whatsAppMessage.update({
    where: { id: message.id },
    data: {
      status: "CANCELLED",
      errorMessage: "Cancelled manually.",
    },
  });

  revalidateMessage(message.id);
}

async function resolveSenderPhone(businessId: string, userId: string) {
  const currentUser = await prisma.user.findFirst({
    where: { id: userId, businessId },
    select: { whatsappPhone: true },
  });

  if (currentUser?.whatsappPhone) {
    return normalizeMalaysiaWhatsAppPhone(currentUser.whatsappPhone);
  }

  const owner = await prisma.user.findFirst({
    where: {
      businessId,
      role: "BUSINESS_OWNER",
      whatsappPhone: { not: null },
      status: "active",
    },
    orderBy: { createdAt: "asc" },
    select: { whatsappPhone: true },
  });

  return owner?.whatsappPhone
    ? normalizeMalaysiaWhatsAppPhone(owner.whatsappPhone)
    : "";
}

async function buildMessageDraft(input: OpenWhatsAppInput, businessId: string) {
  if (input.invoiceId || input.messageType === "INVOICE_SENT") {
    if (!input.invoiceId) {
      throw new Error("Invoice id is required.");
    }

    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { id: input.invoiceId, businessId },
      include: {
        business: true,
        workOrder: {
          include: {
            customer: true,
            vehicle: true,
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
          },
        },
      },
    });

    const services = invoice.workOrder.items
      .map((item) => `${item.name} x${item.quantity}`)
      .join(", ");
    const paymentSummary = getInvoicePaymentSummary(invoice.workOrder.payments);
    const paidAmountText = paymentSummary.hasPackageVoucher
      ? `${money(paymentSummary.cashPaidAmount)}\nPackage voucher: ${money(
          paymentSummary.packageVoucherAmount,
        )}`
      : money(invoice.paidAmount);
    const messageBody = await renderManagedWhatsAppTemplate("INVOICE_SENT", {
      balance: money(invoice.balance),
      companyAddress: invoice.business.address,
      companyName: invoice.business.name,
      companyNo: invoice.business.companyNo,
      companyPhone: invoice.business.phone,
      customerName: invoice.workOrder.contactName || invoice.workOrder.customer.name,
      customerPhone: invoice.workOrder.contactPhone || invoice.workOrder.customer.phone,
      invoiceNumber: formatInvoiceNumber(invoice.invoiceNumber),
      invoiceUrl: "",
      paidAmount: paidAmountText,
      paymentStatus: formatInvoicePaymentStatus(invoice.status, paymentSummary),
      plateNumber: invoice.workOrder.vehicle.plateNumber,
      services,
      subtotal: money(invoice.subtotal),
      total: money(invoice.total),
      vehicleName: [
        invoice.workOrder.vehicle.brand,
        invoice.workOrder.vehicle.model,
        invoice.workOrder.vehicle.color,
      ]
        .filter(Boolean)
        .join(" "),
    });

    return {
      branchId: invoice.branchId,
      customerId: invoice.workOrder.customerId,
      vehicleId: invoice.workOrder.vehicleId,
      workOrderId: invoice.workOrderId,
      invoiceId: invoice.id,
      recipientPhone: invoice.workOrder.contactPhone || invoice.workOrder.customer.phone,
      messageBody,
    };
  }

  if (input.workOrderId) {
    const workOrder = await prisma.workOrder.findFirstOrThrow({
      where: { id: input.workOrderId, businessId },
      include: {
        business: true,
        customer: true,
        vehicle: true,
        items: { orderBy: { createdAt: "asc" } },
      },
    });

    if (input.messageType === "READY_FOR_PICKUP") {
      return {
        branchId: workOrder.branchId,
        customerId: workOrder.customerId,
        vehicleId: workOrder.vehicleId,
        workOrderId: workOrder.id,
        invoiceId: null,
        recipientPhone: workOrder.contactPhone || workOrder.customer.phone,
        messageBody: await renderManagedWhatsAppTemplate("READY_FOR_PICKUP", {
          balance: money(workOrder.balance),
          companyAddress: workOrder.business.address,
          companyName: workOrder.business.name,
          companyNo: workOrder.business.companyNo,
          companyPhone: workOrder.business.phone,
          customerName: workOrder.contactName || workOrder.customer.name,
          customerPhone: workOrder.contactPhone || workOrder.customer.phone,
          orderNumber: workOrder.orderNumber,
          plateNumber: workOrder.vehicle.plateNumber,
          services: workOrder.items.map((item) => item.name).join(", "),
          subtotal: money(workOrder.subtotal),
          total: money(workOrder.total),
          vehicleName: [
            workOrder.vehicle.brand,
            workOrder.vehicle.model,
            workOrder.vehicle.color,
          ]
            .filter(Boolean)
            .join(" "),
        }),
      };
    }

    return {
      branchId: workOrder.branchId,
      customerId: workOrder.customerId,
      vehicleId: workOrder.vehicleId,
      workOrderId: workOrder.id,
      invoiceId: null,
      recipientPhone: workOrder.contactPhone || workOrder.customer.phone,
      messageBody: await renderManagedWhatsAppTemplate("SERVICE_CONFIRMATION", {
        balance: money(workOrder.balance),
        companyAddress: workOrder.business.address,
        companyName: workOrder.business.name,
        companyNo: workOrder.business.companyNo,
        companyPhone: workOrder.business.phone,
        customerName: workOrder.contactName || workOrder.customer.name,
        customerPhone: workOrder.contactPhone || workOrder.customer.phone,
        orderNumber: workOrder.orderNumber,
        plateNumber: workOrder.vehicle.plateNumber,
        services: workOrder.items.map((item) => item.name).join(", "),
        subtotal: money(workOrder.subtotal),
        total: money(workOrder.total),
        vehicleName: [
          workOrder.vehicle.brand,
          workOrder.vehicle.model,
          workOrder.vehicle.color,
        ]
          .filter(Boolean)
          .join(" "),
      }),
    };
  }

  if (input.customerId && input.messageType === "NEW_CUSTOMER_WELCOME") {
    const customer = await prisma.customer.findFirstOrThrow({
      where: { id: input.customerId, businessId },
      include: { business: true },
    });

    return {
      branchId: customer.branchId,
      customerId: customer.id,
      vehicleId: null,
      workOrderId: null,
      invoiceId: null,
      recipientPhone: customer.phone,
      messageBody: await renderManagedWhatsAppTemplate("NEW_CUSTOMER_WELCOME", {
        companyAddress: customer.business.address,
        companyName: customer.business.name,
        companyNo: customer.business.companyNo,
        companyPhone: customer.business.phone,
        customerName: customer.name,
        customerPhone: customer.phone,
      }),
    };
  }

  throw new Error("Unable to build WhatsApp message.");
}

async function getBusinessMessage(formData: FormData, businessId: string) {
  const messageId = formData.get("messageId")?.toString();

  if (!messageId) {
    throw new Error("Message id is required.");
  }

  return prisma.whatsAppMessage.findFirstOrThrow({
    where: {
      id: messageId,
      businessId,
    },
  });
}

async function recordSentManualMessageToInbox(
  message: {
    businessId: string;
    customerId: string | null;
    sentByUserId: string | null;
    phone: string;
    recipientPhone: string | null;
    messageBody: string;
  },
  businessId: string,
) {
  const phone = message.recipientPhone ?? message.phone;
  const customer = message.customerId
    ? await prisma.customer.findFirst({
        where: {
          id: message.customerId,
          businessId,
        },
        select: {
          id: true,
          name: true,
          phone: true,
        },
      })
    : null;
  const displayName = customer?.name ?? phone;
  const storedBody =
    encodeWhatsAppStoredText(message.messageBody) ?? "[Message]";
  const instanceId = getDefaultWhatsAppInstanceId();

  const conversation = await prisma.whatsAppConversation.upsert({
    where: {
      businessId_instanceId_phone: {
        businessId,
        instanceId,
        phone,
      },
    },
    create: {
      businessId,
      instanceId,
      customerId: customer?.id ?? message.customerId,
      phone,
      displayName,
      lastMessageBody: storedBody,
      lastMessageAt: new Date(),
    },
    update: {
      customerId: customer?.id ?? message.customerId,
      displayName,
      lastMessageBody: storedBody,
      lastMessageAt: new Date(),
    },
  });

  await prisma.whatsAppChatMessage.create({
    data: {
      businessId,
      instanceId,
      conversationId: conversation.id,
      customerId: customer?.id ?? message.customerId,
      sentByUserId: message.sentByUserId,
      direction: "OUTBOUND",
      body: storedBody,
      status: "SENT",
    },
  });
}

function revalidateMessage(messageId: string) {
  revalidatePath("/whatsapp");
  revalidatePath(`/whatsapp/${messageId}`);
}

function revalidateRelatedPaths(draft: {
  workOrderId: string | null;
  invoiceId: string | null;
  customerId: string | null;
}) {
  if (draft.workOrderId) {
    revalidatePath(`/work-orders/${draft.workOrderId}`);
  }

  if (draft.invoiceId) {
    revalidatePath(`/invoices/${draft.invoiceId}`);
  }

  if (draft.customerId) {
    revalidatePath(`/crm/customers/${draft.customerId}`);
  }
}

function money(value: { toString(): string } | number | string) {
  return `RM${Number(value).toFixed(2)}`;
}
