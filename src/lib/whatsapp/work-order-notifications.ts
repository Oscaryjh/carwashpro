"use server";

import { prisma } from "@/lib/prisma";
import { formatOrderNumber } from "@/lib/validation/work-orders";
import { getDefaultWhatsAppInstanceId } from "@/lib/whatsapp/instance";
import { encodeWhatsAppStoredText } from "@/lib/whatsapp/message-codec";
import { enqueueWhatsAppLogMessage } from "@/lib/whatsapp/notification-queue";
import { renderManagedWhatsAppTemplate } from "@/lib/whatsapp/templates";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";

type SendServiceConfirmationInput = {
  businessId: string;
  workOrderId: string;
  sentByUserId: string;
};

type SendReadyForPickupInput = {
  businessId: string;
  workOrderId: string;
  sentByUserId: string;
};

function formatMoney(value: unknown) {
  return `RM${Number(value ?? 0).toFixed(2)}`;
}

export async function sendServiceConfirmationQueued({
  businessId,
  workOrderId,
  sentByUserId,
}: SendServiceConfirmationInput) {
  const workOrder = await getWorkOrderForNotification(businessId, workOrderId);

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
  const vehicleName = getVehicleName(workOrder.vehicle);
  const messageBody = await renderManagedWhatsAppTemplate("SERVICE_CONFIRMATION", {
    balance: formatMoney(workOrder.balance),
    companyAddress: workOrder.business.address,
    companyName: workOrder.business.name,
    companyNo: workOrder.business.companyNo,
    companyPhone: workOrder.business.phone,
    customerName: recipientName,
    customerPhone: workOrder.contactPhone || workOrder.customer.phone,
    orderNumber: formatOrderNumber(workOrder.orderNumber),
    plateNumber: workOrder.vehicle.plateNumber,
    services: workOrder.items.map((item) => item.name).join(", "),
    subtotal: formatMoney(workOrder.subtotal),
    total: formatMoney(workOrder.total),
    vehicleName,
  });
  const storedMessageBody =
    encodeWhatsAppStoredText(messageBody) ?? "Your car wash job has been checked in.";

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
      messageType: "SERVICE_CONFIRMATION",
      messageBody: storedMessageBody,
      status: "DRAFT",
      provider: "WHATSAPP_WEB_AUTO",
    },
  });

  await upsertConversation({
    businessId,
    customerId: workOrder.customerId,
    displayName: recipientName,
    phone: recipientPhone,
    storedMessageBody,
  });

  try {
    await enqueueWhatsAppLogMessage({
      businessId,
      branchId: workOrder.branchId,
      message: messageBody,
      messageLogId: log.id,
      messageType: "SERVICE_CONFIRMATION",
      phone: recipientPhone,
    });
  } catch (error) {
    await prisma.whatsAppMessage.update({
      where: { id: log.id },
      data: {
        errorMessage:
          error instanceof Error ? error.message : "WhatsApp queue failed.",
      },
    });
  }
}

export async function sendReadyForPickupIfConnected({
  businessId,
  workOrderId,
  sentByUserId,
}: SendReadyForPickupInput) {
  const workOrder = await getWorkOrderForNotification(businessId, workOrderId);

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
  const vehicleName = getVehicleName(workOrder.vehicle);
  const messageBody = await renderManagedWhatsAppTemplate("READY_FOR_PICKUP", {
    balance: formatMoney(workOrder.balance),
    companyAddress: workOrder.business.address,
    companyName: workOrder.business.name,
    companyNo: workOrder.business.companyNo,
    companyPhone: workOrder.business.phone,
    customerName: recipientName,
    customerPhone: workOrder.contactPhone || workOrder.customer.phone,
    orderNumber: formatOrderNumber(workOrder.orderNumber),
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

  await upsertConversation({
    businessId,
    customerId: workOrder.customerId,
    displayName: recipientName,
    phone: recipientPhone,
    storedMessageBody,
  });

  try {
    await enqueueWhatsAppLogMessage({
      businessId,
      branchId: workOrder.branchId,
      message: messageBody,
      messageLogId: log.id,
      messageType: "READY_FOR_PICKUP",
      phone: recipientPhone,
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

function getWorkOrderForNotification(businessId: string, workOrderId: string) {
  return prisma.workOrder.findFirst({
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
}

function getVehicleName(vehicle: {
  brand: string | null;
  color: string | null;
  model: string | null;
}) {
  return [vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(" ");
}

function upsertConversation(input: {
  businessId: string;
  customerId: string;
  displayName: string;
  phone: string;
  storedMessageBody: string;
}) {
  const instanceId = getDefaultWhatsAppInstanceId();

  return prisma.whatsAppConversation.upsert({
    where: {
      businessId_instanceId_phone: {
        businessId: input.businessId,
        instanceId,
        phone: input.phone,
      },
    },
    create: {
      businessId: input.businessId,
      instanceId,
      customerId: input.customerId,
      phone: input.phone,
      remoteJid: `${input.phone}@s.whatsapp.net`,
      displayName: input.displayName,
      lastMessageBody: input.storedMessageBody,
      lastMessageAt: new Date(),
      unreadCount: 0,
    },
    update: {
      customerId: input.customerId,
      remoteJid: `${input.phone}@s.whatsapp.net`,
      displayName: input.displayName,
    },
  });
}
