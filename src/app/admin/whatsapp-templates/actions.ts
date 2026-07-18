"use server";

import type {
  BusinessIndustry,
  WhatsAppMessageType,
  WhatsAppTemplateStatus,
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { BUSINESS_INDUSTRY_OPTIONS } from "@/lib/business-industry";
import {
  getDefaultWhatsAppTemplate,
  getUnsupportedWhatsAppTemplateVariables,
} from "@/lib/whatsapp/template-defaults";

const messageTypes: WhatsAppMessageType[] = [
  "NEW_CUSTOMER_WELCOME",
  "APPOINTMENT_REMINDER",
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

function parseIndustryType(value: FormDataEntryValue | null): BusinessIndustry {
  const industryType = value?.toString();

  if (!BUSINESS_INDUSTRY_OPTIONS.some((option) => option.value === industryType)) {
    throw new Error("WhatsApp template industry is invalid.");
  }

  return industryType as BusinessIndustry;
}

export async function updateWhatsAppTemplateAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);

  const messageType = parseMessageType(formData.get("messageType"));
  const industryType = parseIndustryType(formData.get("industryType"));
  const defaultTemplate = getDefaultWhatsAppTemplate(messageType, industryType);
  const title = formData.get("title")?.toString().trim();
  const body = formData.get("body")?.toString().trim();
  const status = parseStatus(formData.get("status"));

  if (!title) {
    throw new Error("Template title is required.");
  }

  if (!body) {
    throw new Error("Template body is required.");
  }

  const { unsupportedVariables } = getUnsupportedWhatsAppTemplateVariables(
    body,
    industryType,
  );

  if (unsupportedVariables.length > 0) {
    redirect(
      `/admin/whatsapp-templates/${messageType}?industryType=${industryType}&type=error&message=${encodeURIComponent(
        `Unsupported variable(s): ${unsupportedVariables
          .map((variable) => `{{${variable}}}`)
          .join(", ")}`,
      )}`,
    );
  }

  await prisma.whatsAppTemplate.upsert({
    where: {
      messageType_industryType: { industryType, messageType },
    },
    create: {
      body,
      industryType,
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
    `/admin/whatsapp-templates/${messageType}?industryType=${industryType}&type=success&message=${encodeURIComponent(
      `${defaultTemplate?.title ?? "Template"} saved`,
    )}`,
  );
}

export async function resetWhatsAppTemplateAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);

  const messageType = parseMessageType(formData.get("messageType"));
  const industryType = parseIndustryType(formData.get("industryType"));
  const defaultTemplate = getDefaultWhatsAppTemplate(messageType, industryType);

  if (!defaultTemplate) {
    throw new Error("Default template not found.");
  }

  await prisma.whatsAppTemplate.upsert({
    where: {
      messageType_industryType: { industryType, messageType },
    },
    create: {
      body: defaultTemplate.body,
      industryType,
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
    `/admin/whatsapp-templates/${messageType}?industryType=${industryType}&type=success&message=${encodeURIComponent(
      "Template reset to default",
    )}`,
  );
}
