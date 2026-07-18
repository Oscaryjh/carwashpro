import type { BusinessIndustry, WhatsAppMessageType } from "@prisma/client";

export type WhatsAppTemplateDefault = {
  messageType: WhatsAppMessageType;
  title: string;
  body: string;
};

const COMMON_TEMPLATE_VARIABLES = [
  "companyName",
  "companyPhone",
  "companyNo",
  "companyAddress",
  "customerName",
  "customerPhone",
  "services",
  "subtotal",
  "total",
  "paidAmount",
  "balance",
  "paymentStatus",
  "invoiceNumber",
  "invoiceUrl",
  "appointmentDate",
  "appointmentTime",
] as const;

const AUTO_TEMPLATE_VARIABLES = [
  ...COMMON_TEMPLATE_VARIABLES,
  "plateNumber",
  "vehicleBrand",
  "vehicleModel",
  "vehicleDisplayName",
  "vehicleName",
  "orderNumber",
] as const;

const SALON_TEMPLATE_VARIABLES = [
  ...COMMON_TEMPLATE_VARIABLES,
  "orderNumber",
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
    messageType: "APPOINTMENT_REMINDER",
    title: "Appointment reminder",
    body: [
      "Hi {{customerName}}, this is a reminder for your appointment at {{companyName}}.",
      "Date: {{appointmentDate}}",
      "Time: {{appointmentTime}}",
      "Vehicle: {{plateNumber}}",
      "Please contact us if you need to reschedule. Thank you.",
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

const SALON_WHATSAPP_TEMPLATES: WhatsAppTemplateDefault[] = [
  {
    messageType: "NEW_CUSTOMER_WELCOME",
    title: "New client welcome",
    body: [
      "Hi {{customerName}}, welcome to {{companyName}}.",
      "Your client profile has been created.",
      "We look forward to seeing you.",
    ].join("\n"),
  },
  {
    messageType: "APPOINTMENT_REMINDER",
    title: "Appointment reminder",
    body: [
      "Hi {{customerName}}, this is a reminder for your appointment at {{companyName}}.",
      "Date: {{appointmentDate}}",
      "Time: {{appointmentTime}}",
      "Please contact us if you need to reschedule. Thank you.",
    ].join("\n"),
  },
  {
    messageType: "SERVICE_CONFIRMATION",
    title: "Service confirmation",
    body: [
      "Hi {{customerName}}, your appointment at {{companyName}} is confirmed.",
      "Services: {{services}}",
      "Total: {{total}}",
      "We look forward to seeing you.",
    ].join("\n"),
  },
  {
    messageType: "READY_FOR_PICKUP",
    title: "Service completed",
    body: [
      "Hi {{customerName}}, your service at {{companyName}} is complete.",
      "Services: {{services}}",
      "Balance: {{balance}}",
      "Please contact us if you have any questions. Thank you.",
    ].join("\n"),
  },
  {
    messageType: "INVOICE_SENT",
    title: "Receipt sent",
    body: [
      "Hi {{customerName}}, thank you for visiting {{companyName}}.",
      "Receipt No: {{invoiceNumber}}",
      "Services: {{services}}",
      "Total: {{total}}",
      "Paid: {{paidAmount}}",
      "Balance: {{balance}}",
      "Payment status: {{paymentStatus}}",
      "{{invoiceUrl}}",
    ].join("\n"),
  },
];

function createGenericTemplates(subjectLabel: string): WhatsAppTemplateDefault[] {
  return [
    {
      messageType: "NEW_CUSTOMER_WELCOME",
      title: "New customer welcome",
      body: [
        "Hi {{customerName}}, welcome to {{companyName}}.",
        "Your customer profile has been created.",
        "Thank you.",
      ].join("\n"),
    },
    {
      messageType: "APPOINTMENT_REMINDER",
      title: "Appointment reminder",
      body: [
        "Hi {{customerName}}, this is a reminder for your appointment at {{companyName}}.",
        "Date: {{appointmentDate}}",
        "Time: {{appointmentTime}}",
        "Please contact us if you need to reschedule. Thank you.",
      ].join("\n"),
    },
    {
      messageType: "SERVICE_CONFIRMATION",
      title: `${subjectLabel} confirmation`,
      body: [
        "Hi {{customerName}}, your {{services}} appointment at {{companyName}} is confirmed.",
        "Total: {{total}}",
        "Thank you.",
      ].join("\n"),
    },
    {
      messageType: "READY_FOR_PICKUP",
      title: "Service ready",
      body: [
        "Hi {{customerName}}, your service at {{companyName}} is ready.",
        "Services: {{services}}",
        "Balance: {{balance}}",
        "Thank you.",
      ].join("\n"),
    },
    {
      messageType: "INVOICE_SENT",
      title: "Invoice sent",
      body: [
        "Hi {{customerName}}, thank you for visiting {{companyName}}.",
        "Invoice No: {{invoiceNumber}}",
        "Services: {{services}}",
        "Total: {{total}}",
        "Paid: {{paidAmount}}",
        "Balance: {{balance}}",
        "Payment status: {{paymentStatus}}",
        "{{invoiceUrl}}",
      ].join("\n"),
    },
  ];
}

export const DEFAULT_WHATSAPP_TEMPLATES_BY_INDUSTRY: Record<
  BusinessIndustry,
  WhatsAppTemplateDefault[]
> = {
  AUTO_DETAILING: DEFAULT_WHATSAPP_TEMPLATES,
  SALON_BEAUTY: SALON_WHATSAPP_TEMPLATES,
  PET_GROOMING: createGenericTemplates("service"),
  DEVICE_REPAIR: createGenericTemplates("repair"),
  BICYCLE_REPAIR: createGenericTemplates("repair"),
  SHOE_CLEANING: createGenericTemplates("cleaning"),
  LAUNDRY: createGenericTemplates("laundry"),
  WATCH_REPAIR: createGenericTemplates("repair"),
  GENERAL_SERVICE: createGenericTemplates("service"),
};

export const WHATSAPP_TEMPLATE_VARIABLES = AUTO_TEMPLATE_VARIABLES;

export function getWhatsAppTemplateVariables(
  industryType: BusinessIndustry = "AUTO_DETAILING",
) {
  return industryType === "AUTO_DETAILING"
    ? AUTO_TEMPLATE_VARIABLES
    : industryType === "SALON_BEAUTY"
      ? SALON_TEMPLATE_VARIABLES
      : COMMON_TEMPLATE_VARIABLES;
}

export function getDefaultWhatsAppTemplate(
  messageType: WhatsAppMessageType,
  industryType: BusinessIndustry = "AUTO_DETAILING",
) {
  const templates =
    DEFAULT_WHATSAPP_TEMPLATES_BY_INDUSTRY[industryType] ??
    DEFAULT_WHATSAPP_TEMPLATES;

  return templates.find((template) => template.messageType === messageType);
}

const TEMPLATE_LABELS: Partial<
  Record<BusinessIndustry, Partial<Record<WhatsAppMessageType, string>>>
> = {
  SALON_BEAUTY: {
    READY_FOR_PICKUP: "Service completed",
    INVOICE_SENT: "Receipt sent",
  },
};

const TEMPLATE_DESCRIPTIONS: Partial<
  Record<BusinessIndustry, Partial<Record<WhatsAppMessageType, string>>>
> = {
  AUTO_DETAILING: {
    NEW_CUSTOMER_WELCOME: "Sent when a new customer profile is created.",
    APPOINTMENT_REMINDER: "Sent before an appointment to reduce no-shows.",
    SERVICE_CONFIRMATION: "Sent when a vehicle service job is created.",
    READY_FOR_PICKUP: "Sent when a vehicle is ready for collection.",
    INVOICE_SENT: "Sent with the invoice or payment receipt.",
  },
  SALON_BEAUTY: {
    NEW_CUSTOMER_WELCOME: "Sent when a new client profile is created.",
    APPOINTMENT_REMINDER: "Sent before a salon appointment to reduce no-shows.",
    SERVICE_CONFIRMATION: "Sent when a salon appointment is confirmed.",
    READY_FOR_PICKUP: "Sent when the booked salon service is completed.",
    INVOICE_SENT: "Sent with the salon receipt or payment summary.",
  },
};

export function getWhatsAppTemplateLabel(
  messageType: WhatsAppMessageType,
  industryType: BusinessIndustry = "AUTO_DETAILING",
) {
  return (
    TEMPLATE_LABELS[industryType]?.[messageType] ??
    getDefaultWhatsAppTemplate(messageType, industryType)?.title ??
    messageType.toLowerCase().replaceAll("_", " ")
  );
}

export function getWhatsAppTemplateDescription(
  messageType: WhatsAppMessageType,
  industryType: BusinessIndustry = "AUTO_DETAILING",
) {
  return (
    TEMPLATE_DESCRIPTIONS[industryType]?.[messageType] ??
    "Sent automatically by the system when the related event occurs."
  );
}

export function getUnsupportedWhatsAppTemplateVariables(
  body: string,
  industryType: BusinessIndustry = "AUTO_DETAILING",
) {
  const allowedVariables = new Set<string>(
    getWhatsAppTemplateVariables(industryType),
  );
  const usedVariables = new Set<string>();
  const unsupportedVariables = new Set<string>();

  for (const match of body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    const variable = match[1];
    usedVariables.add(variable);
    if (!allowedVariables.has(variable)) {
      unsupportedVariables.add(variable);
    }
  }

  return {
    usedVariables: [...usedVariables],
    unsupportedVariables: [...unsupportedVariables],
  };
}
