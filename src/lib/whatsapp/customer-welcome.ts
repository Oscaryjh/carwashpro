"use server";

import { prisma } from "@/lib/prisma";
import { encodeWhatsAppStoredText } from "@/lib/whatsapp/message-codec";
import { enqueueWhatsAppLogMessage } from "@/lib/whatsapp/notification-queue";
import { renderManagedWhatsAppTemplate } from "@/lib/whatsapp/templates";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";

type SendNewCustomerWelcomeInput = {
  businessId: string;
  branchId?: string | null;
  customerId: string;
  customerName: string;
  customerPhone: string;
  sentByUserId: string;
};

export async function sendNewCustomerWelcomeIfConnected(
  input: SendNewCustomerWelcomeInput,
) {
  const recipientPhone = normalizeMalaysiaWhatsAppPhone(input.customerPhone);

  if (!recipientPhone) {
    return;
  }

  const business = await prisma.business.findFirst({
    where: { id: input.businessId },
    select: { address: true, companyNo: true, name: true, phone: true },
  });

  if (!business) {
    return;
  }

  const messageBody = await renderManagedWhatsAppTemplate("NEW_CUSTOMER_WELCOME", {
    companyAddress: business.address,
    companyName: business.name,
    companyNo: business.companyNo,
    companyPhone: business.phone,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
  });
  const storedMessageBody =
    encodeWhatsAppStoredText(messageBody) ?? "Welcome to our car wash.";

  const log = await prisma.whatsAppMessage.create({
    data: {
      businessId: input.businessId,
      branchId: input.branchId ?? null,
      customerId: input.customerId,
      sentByUserId: input.sentByUserId,
      phone: recipientPhone,
      recipientPhone,
      messageType: "NEW_CUSTOMER_WELCOME",
      messageBody: storedMessageBody,
      status: "DRAFT",
      provider: "WHATSAPP_WEB_AUTO",
    },
  });

  await prisma.whatsAppConversation.upsert({
    where: {
      businessId_phone: {
        businessId: input.businessId,
        phone: recipientPhone,
      },
    },
    create: {
      businessId: input.businessId,
      customerId: input.customerId,
      phone: recipientPhone,
      remoteJid: `${recipientPhone}@s.whatsapp.net`,
      displayName: input.customerName,
      lastMessageBody: storedMessageBody,
      lastMessageAt: new Date(),
      unreadCount: 0,
    },
    update: {
      customerId: input.customerId,
      remoteJid: `${recipientPhone}@s.whatsapp.net`,
      displayName: input.customerName,
    },
  });

  try {
    await enqueueWhatsAppLogMessage({
      businessId: input.businessId,
      branchId: input.branchId ?? null,
      message: messageBody,
      messageLogId: log.id,
      messageType: "NEW_CUSTOMER_WELCOME",
      phone: recipientPhone,
    });
  } catch (error) {
    await prisma.whatsAppMessage.update({
      where: { id: log.id },
      data: {
        errorMessage:
          error instanceof Error
            ? error.message
            : "Unable to send WhatsApp welcome message.",
      },
    });
  }
}
