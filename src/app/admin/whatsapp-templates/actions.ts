"use server";

import type { WhatsAppMessageType, WhatsAppTemplateStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getDefaultWhatsAppTemplate } from "@/lib/whatsapp/template-defaults";

const messageTypes: WhatsAppMessageType[] = [
  "NEW_CUSTOMER_WELCOME",
  "SERVICE_CONFIRMATION",
  "READY_FOR_PICKUP",
  "INVOICE_SENT",
];

function parseMessageType(value: FormDataEntryValue | null) {
  const messageType = value?.toString() as WhatsAppMessageType | undefined;

  if (!messageType || !messageTypes.includes(messageType)) {
    throw new Error("WhatsApp template type is invalid.");
  }

  return messageType;
}

function parseStatus(value: FormDataEntryValue | null) {
  return value?.toString() === "INACTIVE"
    ? ("INACTIVE" as WhatsAppTemplateStatus)
    : ("ACTIVE" as WhatsAppTemplateStatus);
}

export async function updateWhatsAppTemplateAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);

  const messageType = parseMessageType(formData.get("messageType"));
  const defaultTemplate = getDefaultWhatsAppTemplate(messageType);
  const title = formData.get("title")?.toString().trim();
  const body = formData.get("body")?.toString().trim();
  const status = parseStatus(formData.get("status"));

  if (!title) {
    throw new Error("Template title is required.");
  }

  if (!body) {
    throw new Error("Template body is required.");
  }

  await prisma.whatsAppTemplate.upsert({
    where: { messageType },
    create: {
      body,
      messageType,
      status,
      title,
    },
    update: {
      body,
      status,
      title,
    },
  });

  revalidatePath("/admin/whatsapp-templates");
  redirect(
    `/admin/whatsapp-templates/${messageType}?type=success&message=${encodeURIComponent(
      `${defaultTemplate?.title ?? "Template"} saved`,
    )}`,
  );
}

export async function resetWhatsAppTemplateAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);

  const messageType = parseMessageType(formData.get("messageType"));
  const defaultTemplate = getDefaultWhatsAppTemplate(messageType);

  if (!defaultTemplate) {
    throw new Error("Default template not found.");
  }

  await prisma.whatsAppTemplate.upsert({
    where: { messageType },
    create: {
      body: defaultTemplate.body,
      messageType,
      status: "ACTIVE",
      title: defaultTemplate.title,
    },
    update: {
      body: defaultTemplate.body,
      status: "ACTIVE",
      title: defaultTemplate.title,
    },
  });

  revalidatePath("/admin/whatsapp-templates");
  redirect(
    `/admin/whatsapp-templates/${messageType}?type=success&message=${encodeURIComponent(
      "Template reset to default",
    )}`,
  );
}
