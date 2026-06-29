"use server";

import { prisma } from "@/lib/prisma";
import { sendWhatsAppTextMessage } from "@/lib/whatsapp/connector";
import { encodeWhatsAppStoredText } from "@/lib/whatsapp/message-codec";
import { renderManagedWhatsAppTemplate } from "@/lib/whatsapp/templates";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";

type SendReadyForPickupInput = {
  businessId: string;
  workOrderId: string;
  sentByUserId: string;
};

function formatMoney(value: unknown) {
  return `RM${Number(value ?? 0).toFixed(2)}`;
}

export async function sendReadyForPickupIfConnected({
  businessId,
  workOrderId,
  sentByUserId,
}: SendReadyForPickupInput) {
  const workOrder = await prisma.workOrder.findFirst({
    where: {
      id: workOrderId,
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
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
      vehicle: {
        select: {
          brand: true,
          color: true,
          id: true,
          model: true,
          plateNumber: true,
        },
      },
      items: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!workOrder) {
    return;
  }

  const recipientPhone = normalizeMalaysiaWhatsAppPhone(
    workOrder.contactPhone || workOrder.customer.phone,
  );

  if (!recipientPhone) {
    return;
  }

  const recipientName = workOrder.contactName || workOrder.customer.name;
  const vehicleName = [
    workOrder.vehicle.brand,
    workOrder.vehicle.model,
    workOrder.vehicle.color,
  ]
    .filter(Boolean)
    .join(" ");
  const messageBody = await renderManagedWhatsAppTemplate("READY_FOR_PICKUP", {
    balance: formatMoney(workOrder.balance),
    companyAddress: workOrder.business.address,
    companyName: workOrder.business.name,
    companyNo: workOrder.business.companyNo,
    companyPhone: workOrder.business.phone,
    customerName: recipientName,
    customerPhone: workOrder.contactPhone || workOrder.customer.phone,
    orderNumber: workOrder.orderNumber,
    plateNumber: workOrder.vehicle.plateNumber,
    services: workOrder.items.map((item) => item.name).join(", "),
    subtotal: formatMoney(workOrder.subtotal),
    total: formatMoney(workOrder.total),
    vehicleName,
  });
  const storedMessageBody =
    encodeWhatsAppStoredText(messageBody) ?? "Your car is ready for pickup.";

  const log = await prisma.whatsAppMessage.create({
    data: {
      businessId,
      branchId: workOrder.branchId,
      customerId: workOrder.customerId,
      vehicleId: workOrder.vehicleId,
      workOrderId: workOrder.id,
      sentByUserId,
      phone: recipientPhone,
      recipientPhone,
      messageType: "READY_FOR_PICKUP",
      messageBody: storedMessageBody,
      status: "DRAFT",
      provider: "WHATSAPP_WEB_AUTO",
    },
  });

  const conversation = await prisma.whatsAppConversation.upsert({
    where: {
      businessId_phone: {
        businessId,
        phone: recipientPhone,
      },
    },
    create: {
      businessId,
      customerId: workOrder.customerId,
      phone: recipientPhone,
      remoteJid: `${recipientPhone}@s.whatsapp.net`,
      displayName: recipientName,
      lastMessageBody: storedMessageBody,
      lastMessageAt: new Date(),
      unreadCount: 0,
    },
    update: {
      customerId: workOrder.customerId,
      remoteJid: `${recipientPhone}@s.whatsapp.net`,
      displayName: recipientName,
    },
  });

  const connection = await prisma.whatsAppConnection.findUnique({
    where: { businessId },
    select: { status: true },
  });

  if (connection?.status !== "CONNECTED") {
    await prisma.whatsAppMessage.update({
      where: { id: log.id },
      data: {
        errorMessage: "WhatsApp is not connected.",
      },
    });
    return;
  }

  try {
    const result = await sendWhatsAppTextMessage({
      businessId,
      conversationId: conversation.id,
      body: messageBody,
      sentByUserId,
    });

    await prisma.whatsAppMessage.update({
      where: { id: log.id },
      data: {
        status: "SENT_MANUALLY",
        providerMessageId: result.externalMessageId ?? null,
        sentAt: new Date(),
        errorMessage: null,
      },
    });
  } catch (error) {
    await prisma.whatsAppMessage.update({
      where: { id: log.id },
      data: {
        errorMessage:
          error instanceof Error ? error.message : "WhatsApp send failed.",
      },
    });
  }
}
