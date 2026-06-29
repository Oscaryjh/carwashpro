import type { WhatsAppMessageType } from "@prisma/client";

export type WhatsAppTemplateDefault = {
  messageType: WhatsAppMessageType;
  title: string;
  body: string;
};

export const WHATSAPP_TEMPLATE_VARIABLES = [
  "companyName",
  "companyPhone",
  "companyNo",
  "companyAddress",
  "customerName",
  "customerPhone",
  "plateNumber",
  "vehicleName",
  "orderNumber",
  "services",
  "subtotal",
  "total",
  "paidAmount",
  "balance",
  "paymentStatus",
  "invoiceNumber",
  "invoiceUrl",
] as const;

export const DEFAULT_WHATSAPP_TEMPLATES: WhatsAppTemplateDefault[] = [
  {
    messageType: "NEW_CUSTOMER_WELCOME",
    title: "New customer welcome",
    body: [
      "Hi {{customerName}}, welcome to {{companyName}}.",
      "Your customer profile has been created.",
      "WhatsApp No: {{companyPhone}}",
      "Thank you.",
    ].join("\n"),
  },
  {
    messageType: "SERVICE_CONFIRMATION",
    title: "Service confirmation",
    body: [
      "Hi {{customerName}}, {{companyName}} has created job {{orderNumber}} for {{plateNumber}}.",
      "Services: {{services}}",
      "Total: {{total}}",
      "We will notify you when your vehicle is ready.",
    ].join("\n"),
  },
  {
    messageType: "READY_FOR_PICKUP",
    title: "Ready for pickup",
    body: [
      "Hi {{customerName}}, your vehicle {{plateNumber}} is ready for pickup at {{companyName}}.",
      "Job No: {{orderNumber}}",
      "Balance: {{balance}}",
      "Please proceed to the counter when you arrive. Thank you.",
    ].join("\n"),
  },
  {
    messageType: "INVOICE_SENT",
    title: "Invoice sent",
    body: [
      "Hi {{customerName}}, thank you for visiting {{companyName}}.",
      "Invoice No: {{invoiceNumber}}",
      "Vehicle: {{plateNumber}}",
      "Services: {{services}}",
      "Total: {{total}}",
      "Paid: {{paidAmount}}",
      "Balance: {{balance}}",
      "Payment status: {{paymentStatus}}",
      "{{invoiceUrl}}",
    ].join("\n"),
  },
];

export function getDefaultWhatsAppTemplate(messageType: WhatsAppMessageType) {
  return DEFAULT_WHATSAPP_TEMPLATES.find(
    (template) => template.messageType === messageType,
  );
}
