"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getDefaultWhatsAppInstanceId } from "@/lib/whatsapp/instance";
import { formatInvoiceNumber } from "@/lib/invoices/invoice-number";
import {
  formatInvoicePaymentStatus,
  getInvoicePaymentSummary,
} from "@/lib/invoices/payment-summary";
import { buildInvoicePdf, invoicePdfFileName } from "@/lib/invoices/invoice-pdf";
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
          logoUrl: true,
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
      appointment: {
        include: {
          assignedStaff: { select: { name: true } },
          vehicle: {
            select: {
              brand: true,
              model: true,
              color: true,
              plateNumber: true,
            },
          },
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
        },
      },
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
      customerPackage: {
        include: {
          package: true,
        },
      },
      items: { orderBy: { createdAt: "asc" } },
      payments: {
        where: { status: "ACTIVE" },
        include: { refunds: true },
        orderBy: { paidAt: "desc" },
      },
    },
  });

  if (!invoice) {
    return;
  }

  if (invoice.appointment) {
    const recipientPhone = normalizeMalaysiaWhatsAppPhone(
      invoice.appointment.contactPhone || invoice.appointment.customer.phone,
    );

    if (!recipientPhone) {
      return;
    }

    const recipientName =
      invoice.appointment.contactName || invoice.appointment.customer.name;
    const services = invoice.items
      .map((item) => `${item.name} x${item.quantity}`)
      .join(", ");
    const displayInvoiceNumber = formatInvoiceNumber(invoice.invoiceNumber);
    const appointmentDate = invoice.appointment.scheduledAt.toLocaleDateString("en-MY");
    const appointmentTime = invoice.appointment.scheduledAt.toLocaleTimeString("en-MY", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const appointmentReference = `${appointmentDate} ${appointmentTime}`;
    const paymentSummary = getInvoicePaymentSummary(invoice.payments);
    const messageBody = await renderManagedWhatsAppTemplate("INVOICE_SENT", {
      balance: formatMoney(invoice.balance),
      companyAddress: invoice.business.address,
      companyName: invoice.business.name,
      companyNo: invoice.business.companyNo,
      companyPhone: invoice.business.phone,
      customerName: recipientName,
      customerPhone:
        invoice.appointment.contactPhone || invoice.appointment.customer.phone,
      invoiceNumber: displayInvoiceNumber,
      invoiceUrl: "",
      paidAmount: formatMoney(invoice.paidAmount),
      paymentStatus: formatInvoicePaymentStatus(invoice.status, paymentSummary),
      plateNumber: invoice.appointment.vehicle?.plateNumber ?? appointmentReference,
      services,
      subtotal: formatMoney(invoice.subtotal),
      total: formatMoney(invoice.total),
      vehicleBrand: invoice.appointment.vehicle?.brand ?? "",
      vehicleModel: invoice.appointment.vehicle?.model ?? "",
      vehicleDisplayName: [
        invoice.appointment.vehicle?.brand,
        invoice.appointment.vehicle?.model,
        invoice.appointment.vehicle?.color,
      ]
        .filter(Boolean)
        .join(" "),
      vehicleName: invoice.appointment.assignedStaff?.name
        ? `Staff: ${invoice.appointment.assignedStaff.name}`
        : "Salon appointment",
    }, businessId);
    const storedMessageBody =
      encodeWhatsAppStoredText(messageBody) ?? "Invoice has been paid.";
    const invoiceLogo = await loadInvoiceLogo(invoice.business.logoUrl);
    const invoicePdf = buildInvoicePdf({
      company: {
        ...invoice.business,
        logo: invoiceLogo,
      },
      customer: {
        name: recipientName,
        phone: recipientPhone,
      },
      invoiceNumber: displayInvoiceNumber,
      issuedAt: invoice.issuedAt,
      items: invoice.items,
      paidAmount: invoice.paidAmount,
      cashPaidAmount: paymentSummary.cashPaidAmount,
      packageVoucherAmount: paymentSummary.packageVoucherAmount,
      discountAmount: invoice.discountAmount,
      depositAmount: invoice.depositAmount,
      taxAmount: invoice.taxAmount,
      taxLabel: invoice.taxLabel,
      taxRate: invoice.taxRate,
      tipAmount: invoice.tipAmount,
      balance: invoice.balance,
      status: invoice.status,
      subtotal: invoice.subtotal,
      total: invoice.total,
      reference: {
        label: "Appointment",
        value: appointmentDate,
        detail: `${appointmentTime} / ${invoice.appointment.assignedStaff?.name ?? "Unassigned"}`,
      },
    });
    const invoiceFileName = invoicePdfFileName(displayInvoiceNumber);
    const log = await prisma.whatsAppMessage.create({
      data: {
        businessId,
        branchId: invoice.branchId,
        customerId: invoice.appointment.customerId,
        appointmentId: invoice.appointment.id,
        invoiceId: invoice.id,
        messageBody: storedMessageBody,
        messageType: "INVOICE_SENT",
        phone: recipientPhone,
        provider: "WHATSAPP_WEB_AUTO",
        recipientPhone,
        sentByUserId,
        status: "DRAFT",
      },
    });
    const instanceId = getDefaultWhatsAppInstanceId();

    await prisma.whatsAppConversation.upsert({
      where: {
        businessId_instanceId_phone: {
          businessId,
          instanceId,
          phone: recipientPhone,
        },
      },
      create: {
        businessId,
        instanceId,
        customerId: invoice.appointment.customerId,
        displayName: recipientName,
        lastMessageAt: new Date(),
        lastMessageBody: storedMessageBody,
        phone: recipientPhone,
        remoteJid: `${recipientPhone}@s.whatsapp.net`,
        unreadCount: 0,
      },
      update: {
        customerId: invoice.appointment.customerId,
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
        documentBase64: invoicePdf.toString("base64"),
        documentMimeType: "application/pdf",
        documentFileName: invoiceFileName,
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

    return;
  }

  if (invoice.customerPackage && invoice.customer) {
    const recipientPhone = normalizeMalaysiaWhatsAppPhone(invoice.customer.phone);

    if (!recipientPhone) {
      return;
    }

    const recipientName = invoice.customer.name;
    const packagePlan = invoice.customerPackage.package;
    const packageItems = invoice.items.length
      ? invoice.items
      : [{
          name: packagePlan.name,
          quantity: 1,
          unitPrice: packagePlan.price,
          lineTotal: packagePlan.price,
        }];
    const packageCount = packageItems.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    const packageSummary = packageItems
      .map((item) => `${item.name} x${item.quantity}`)
      .join(", ");
    const packageDisplayName =
      packageItems.length === 1 ? packageItems[0].name : `${packageCount} packages`;
    const displayInvoiceNumber = formatInvoiceNumber(invoice.invoiceNumber);
    const paymentSummary = getInvoicePaymentSummary(invoice.payments);
    const messageBody = await renderManagedWhatsAppTemplate("INVOICE_SENT", {
      balance: formatMoney(invoice.balance),
      companyAddress: invoice.business.address,
      companyName: invoice.business.name,
      companyNo: invoice.business.companyNo,
      companyPhone: invoice.business.phone,
      customerName: recipientName,
      customerPhone: invoice.customer.phone,
      invoiceNumber: displayInvoiceNumber,
      invoiceUrl: "",
      paidAmount: formatMoney(invoice.paidAmount),
      paymentStatus: formatInvoicePaymentStatus(invoice.status, paymentSummary),
      plateNumber: "Package purchase",
      services: packageSummary,
      subtotal: formatMoney(invoice.subtotal),
      total: formatMoney(invoice.total),
      vehicleBrand: "",
      vehicleModel: "",
      vehicleDisplayName: `Packages: ${packageSummary}`,
      vehicleName: `Packages: ${packageSummary}`,
    }, businessId);
    const storedMessageBody =
      encodeWhatsAppStoredText(messageBody) ?? "Package invoice has been paid.";
    const invoiceLogo = await loadInvoiceLogo(invoice.business.logoUrl);
    const invoicePdf = buildInvoicePdf({
      company: {
        ...invoice.business,
        logo: invoiceLogo,
      },
      customer: {
        name: recipientName,
        phone: recipientPhone,
      },
      invoiceNumber: displayInvoiceNumber,
      issuedAt: invoice.issuedAt,
      items: invoice.items,
      paidAmount: invoice.paidAmount,
      cashPaidAmount: paymentSummary.cashPaidAmount,
      packageVoucherAmount: paymentSummary.packageVoucherAmount,
      discountAmount: invoice.discountAmount,
      depositAmount: invoice.depositAmount,
      taxAmount: invoice.taxAmount,
      taxLabel: invoice.taxLabel,
      taxRate: invoice.taxRate,
      tipAmount: invoice.tipAmount,
      balance: invoice.balance,
      status: invoice.status,
      subtotal: invoice.subtotal,
      total: invoice.total,
      reference: {
        label: "Package",
        value: packageDisplayName,
        detail: packageSummary,
      },
    });
    const invoiceFileName = invoicePdfFileName(displayInvoiceNumber);
    const log = await prisma.whatsAppMessage.create({
      data: {
        businessId,
        branchId: invoice.branchId,
        customerId: invoice.customer.id,
        invoiceId: invoice.id,
        messageBody: storedMessageBody,
        messageType: "INVOICE_SENT",
        phone: recipientPhone,
        provider: "WHATSAPP_WEB_AUTO",
        recipientPhone,
        sentByUserId,
        status: "DRAFT",
      },
    });
    const instanceId = getDefaultWhatsAppInstanceId();

    await prisma.whatsAppConversation.upsert({
      where: {
        businessId_instanceId_phone: {
          businessId,
          instanceId,
          phone: recipientPhone,
        },
      },
      create: {
        businessId,
        instanceId,
        customerId: invoice.customer.id,
        displayName: recipientName,
        lastMessageAt: new Date(),
        lastMessageBody: storedMessageBody,
        phone: recipientPhone,
        remoteJid: `${recipientPhone}@s.whatsapp.net`,
        unreadCount: 0,
      },
      update: {
        customerId: invoice.customer.id,
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
        documentBase64: invoicePdf.toString("base64"),
        documentMimeType: "application/pdf",
        documentFileName: invoiceFileName,
      });
    } catch (error) {
      await prisma.whatsAppMessage.update({
        where: { id: log.id },
        data: {
          errorMessage:
            error instanceof Error
              ? error.message
              : "Unable to send WhatsApp package invoice PDF.",
        },
      });
    }

    return;
  }

  if (invoice.customer) {
    const recipientPhone = normalizeMalaysiaWhatsAppPhone(invoice.customer.phone);

    if (!recipientPhone) {
      return;
    }

    const recipientName = invoice.customer.name;
    const displayInvoiceNumber = formatInvoiceNumber(invoice.invoiceNumber);
    const services = invoice.items
      .map((item) => `${item.name} x${item.quantity}`)
      .join(", ");
    const paymentSummary = getInvoicePaymentSummary(invoice.payments);
    const messageBody = await renderManagedWhatsAppTemplate("INVOICE_SENT", {
      balance: formatMoney(invoice.balance),
      companyAddress: invoice.business.address,
      companyName: invoice.business.name,
      companyNo: invoice.business.companyNo,
      companyPhone: invoice.business.phone,
      customerName: recipientName,
      customerPhone: invoice.customer.phone,
      invoiceNumber: displayInvoiceNumber,
      invoiceUrl: "",
      paidAmount: formatMoney(invoice.paidAmount),
      paymentStatus: formatInvoicePaymentStatus(invoice.status, paymentSummary),
      plateNumber: "Product sale",
      services,
      subtotal: formatMoney(invoice.subtotal),
      total: formatMoney(invoice.total),
      vehicleBrand: "",
      vehicleModel: "",
      vehicleDisplayName: "Product sale",
      vehicleName: "Product sale",
    }, businessId);
    const storedMessageBody =
      encodeWhatsAppStoredText(messageBody) ?? "Your receipt has been issued.";
    const invoiceLogo = await loadInvoiceLogo(invoice.business.logoUrl);
    const invoicePdf = buildInvoicePdf({
      company: { ...invoice.business, logo: invoiceLogo },
      customer: { name: recipientName, phone: recipientPhone },
      invoiceNumber: displayInvoiceNumber,
      issuedAt: invoice.issuedAt,
      items: invoice.items,
      paidAmount: invoice.paidAmount,
      cashPaidAmount: paymentSummary.cashPaidAmount,
      packageVoucherAmount: paymentSummary.packageVoucherAmount,
      discountAmount: invoice.discountAmount,
      depositAmount: invoice.depositAmount,
      taxAmount: invoice.taxAmount,
      taxLabel: invoice.taxLabel,
      taxRate: invoice.taxRate,
      tipAmount: invoice.tipAmount,
      balance: invoice.balance,
      status: invoice.status,
      subtotal: invoice.subtotal,
      total: invoice.total,
      reference: { label: "Product sale", value: services },
    });
    const log = await prisma.whatsAppMessage.create({
      data: {
        businessId,
        branchId: invoice.branchId,
        customerId: invoice.customer.id,
        invoiceId: invoice.id,
        messageBody: storedMessageBody,
        messageType: "INVOICE_SENT",
        phone: recipientPhone,
        provider: "WHATSAPP_WEB_AUTO",
        recipientPhone,
        sentByUserId,
        status: "DRAFT",
      },
    });
    const instanceId = getDefaultWhatsAppInstanceId();

    await prisma.whatsAppConversation.upsert({
      where: {
        businessId_instanceId_phone: {
          businessId,
          instanceId,
          phone: recipientPhone,
        },
      },
      create: {
        businessId,
        instanceId,
        customerId: invoice.customer.id,
        displayName: recipientName,
        lastMessageAt: new Date(),
        lastMessageBody: storedMessageBody,
        phone: recipientPhone,
        remoteJid: `${recipientPhone}@s.whatsapp.net`,
        unreadCount: 0,
      },
      update: {
        customerId: invoice.customer.id,
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
        documentBase64: invoicePdf.toString("base64"),
        documentMimeType: "application/pdf",
        documentFileName: invoicePdfFileName(displayInvoiceNumber),
      });
    } catch (error) {
      await prisma.whatsAppMessage.update({
        where: { id: log.id },
        data: {
          errorMessage:
            error instanceof Error ? error.message : "Unable to send product receipt.",
        },
      });
    }

    return;
  }

  if (!invoice.workOrder) {
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
  const invoiceLogo = await loadInvoiceLogo(invoice.business.logoUrl);
  const paymentSummary = getInvoicePaymentSummary(invoice.workOrder.payments);
  const paidAmountText = paymentSummary.hasPackageVoucher
    ? `${formatMoney(paymentSummary.cashPaidAmount)}\nPackage voucher: ${formatMoney(
        paymentSummary.packageVoucherAmount,
      )}`
    : formatMoney(invoice.paidAmount);

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
    paidAmount: paidAmountText,
    paymentStatus: formatInvoicePaymentStatus(invoice.status, paymentSummary),
    plateNumber: invoice.workOrder.vehicle.plateNumber,
    services,
    subtotal: formatMoney(invoice.subtotal),
    total: formatMoney(invoice.total),
    vehicleBrand: invoice.workOrder.vehicle.brand,
    vehicleModel: invoice.workOrder.vehicle.model,
    vehicleDisplayName: vehicleName,
    vehicleName,
  }, businessId);
  const storedMessageBody =
    encodeWhatsAppStoredText(messageBody) ?? "Invoice has been paid.";
  const invoicePdf = buildInvoicePdf({
    company: {
      ...invoice.business,
      logo: invoiceLogo,
    },
    customer: {
      name: recipientName,
      phone: recipientPhone,
    },
    invoiceNumber: displayInvoiceNumber,
    issuedAt: invoice.issuedAt,
    items: invoice.workOrder.items,
    paidAmount: invoice.paidAmount,
    cashPaidAmount: paymentSummary.cashPaidAmount,
    packageVoucherAmount: paymentSummary.packageVoucherAmount,
    discountAmount: invoice.discountAmount,
    depositAmount: invoice.depositAmount,
    taxAmount: invoice.taxAmount,
    taxLabel: invoice.taxLabel,
    taxRate: invoice.taxRate,
    tipAmount: invoice.tipAmount,
    balance: invoice.balance,
    status: invoice.status,
    subtotal: invoice.subtotal,
    total: invoice.total,
    vehicle: invoice.workOrder.vehicle,
  });
  const invoiceFileName = invoicePdfFileName(displayInvoiceNumber);

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

  const instanceId = getDefaultWhatsAppInstanceId();

  await prisma.whatsAppConversation.upsert({
    where: {
      businessId_instanceId_phone: {
        businessId,
        instanceId,
        phone: recipientPhone,
      },
    },
    create: {
      businessId,
      instanceId,
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
      documentBase64: invoicePdf.toString("base64"),
      documentMimeType: "application/pdf",
      documentFileName: invoiceFileName,
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

async function loadInvoiceLogo(logoUrl?: string | null) {
  if (!logoUrl?.startsWith("/uploads/")) {
    return null;
  }

  const publicDir = path.join(process.cwd(), "public");
  const logoPath = path.normalize(path.join(publicDir, logoUrl.replace(/^\/+/, "")));

  if (!logoPath.startsWith(publicDir)) {
    return null;
  }

  try {
    return {
      data: await readFile(logoPath),
      mimeType: getLogoMimeType(logoPath),
    };
  } catch {
    return null;
  }
}

function getLogoMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  return null;
}
