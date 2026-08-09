import type { WhatsAppMessageType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDefaultWhatsAppTemplate } from "@/lib/whatsapp/template-defaults";

type WelcomeTemplateInput = {
  businessName: string;
  customerName: string;
};

type ServiceConfirmationInput = {
  businessName: string;
  customerName: string;
  plateNumber: string;
  orderNumber: string;
  services: string[];
  total: string;
};

type ReadyForPickupInput = {
  businessName: string;
  customerName: string;
  plateNumber: string;
  orderNumber: string;
  balance: string;
};

type InvoiceSentInput = {
  businessName: string;
  customerName: string;
  plateNumber: string;
  invoiceNumber: string;
  total: string;
  paidAmount: string;
};

export type WhatsAppTemplateVariables = Record<
  string,
  number | string | null | undefined
>;

export class WhatsAppTemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppTemplateValidationError";
  }
}

export function renderWhatsAppTemplate(
  body: string,
  variables: WhatsAppTemplateVariables,
) {
  return body.replaceAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) =>
    variables[key] == null ? "" : String(variables[key]),
  );
}

export async function renderManagedWhatsAppTemplate(
  messageType: WhatsAppMessageType,
  variables: WhatsAppTemplateVariables,
  businessId?: string,
) {
  const business = businessId
    ? await prisma.business.findUnique({
        where: { id: businessId },
        select: { industryType: true },
      })
    : null;
  const industryType = business?.industryType ?? "AUTO_DETAILING";
  const savedTemplate = await prisma.whatsAppTemplate.findUnique({
    where: {
      messageType_industryType: {
        industryType,
        messageType,
      },
    },
    select: { body: true, status: true },
  });
  const defaultTemplate = getDefaultWhatsAppTemplate(messageType, industryType);
  const body =
    savedTemplate?.status === "ACTIVE"
      ? savedTemplate.body
      : defaultTemplate?.body ?? "";

  assertWhatsAppTemplateCanRender(body, variables);

  const rendered = renderWhatsAppTemplate(body, variables).trim();
  if (!rendered || /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(rendered)) {
    throw new WhatsAppTemplateValidationError(
      "WhatsApp template could not be rendered safely.",
    );
  }

  return rendered;
}

export function assertWhatsAppTemplateCanRender(
  body: string,
  variables: WhatsAppTemplateVariables,
) {
  if (!body.trim()) {
    throw new WhatsAppTemplateValidationError("WhatsApp template is empty.");
  }

  const missing = new Set<string>();
  for (const match of body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    if (!Object.prototype.hasOwnProperty.call(variables, match[1])) {
      missing.add(match[1]);
    }
  }

  if (missing.size) {
    throw new WhatsAppTemplateValidationError(
      `WhatsApp template is missing required variables: ${[...missing].join(", ")}.`,
    );
  }
}

function renderDefaultTemplate(
  messageType: WhatsAppMessageType,
  variables: WhatsAppTemplateVariables,
) {
  const template = getDefaultWhatsAppTemplate(messageType);
  return renderWhatsAppTemplate(template?.body ?? "", variables);
}

export function newCustomerWelcomeTemplate({
  businessName,
  customerName,
}: WelcomeTemplateInput) {
  return renderDefaultTemplate("NEW_CUSTOMER_WELCOME", {
    companyName: businessName,
    customerName,
  });
}

export function serviceConfirmationTemplate({
  businessName,
  customerName,
  plateNumber,
  orderNumber,
  services,
  total,
}: ServiceConfirmationInput) {
  return renderDefaultTemplate("SERVICE_CONFIRMATION", {
    companyName: businessName,
    customerName,
    plateNumber,
    orderNumber,
    services: services.join(", "),
    total,
  });
}

export function readyForPickupTemplate({
  businessName,
  customerName,
  plateNumber,
  orderNumber,
  balance,
}: ReadyForPickupInput) {
  return renderDefaultTemplate("READY_FOR_PICKUP", {
    companyName: businessName,
    customerName,
    plateNumber,
    orderNumber,
    balance,
  });
}

export function invoiceSentTemplate({
  businessName,
  customerName,
  plateNumber,
  invoiceNumber,
  total,
  paidAmount,
}: InvoiceSentInput) {
  return renderDefaultTemplate("INVOICE_SENT", {
    companyName: businessName,
    customerName,
    plateNumber,
    invoiceNumber,
    total,
    paidAmount,
  });
}
