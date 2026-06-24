"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import {
  fromCents,
  makeInvoiceNumber,
  paymentSchema,
  toCents,
} from "@/lib/validation/pos";
import { usePackagePaymentSchema } from "@/lib/validation/packages";
import { invoiceSentTemplate } from "@/lib/whatsapp/templates";

export async function recordPaymentAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const input = paymentSchema.parse({
    workOrderId: formData.get("workOrderId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reference: formData.get("reference"),
  });

  const invoiceId = await prisma.$transaction(async (tx) => {
    const workOrder = await tx.workOrder.findFirstOrThrow({
      where: {
        id: input.workOrderId,
        businessId,
      },
      include: {
        invoice: true,
        business: true,
        customer: true,
        vehicle: true,
      },
    });

    if (workOrder.status === "CANCELLED") {
      throw new Error("Cannot take payment for a cancelled work order.");
    }

    if (workOrder.paymentStatus === "PAID") {
      throw new Error("This work order is already fully paid.");
    }

    const totalCents = toCents(workOrder.total);
    const paidCents = toCents(workOrder.paidAmount);
    const amountCents = toCents(input.amount);
    const balanceCents = totalCents - paidCents;

    if (amountCents > balanceCents) {
      throw new Error("Payment amount cannot exceed the outstanding balance.");
    }

    const nextPaidCents = paidCents + amountCents;
    const nextBalanceCents = totalCents - nextPaidCents;
    const isPaid = nextBalanceCents === 0;
    const paymentStatus = isPaid ? "PAID" : "PARTIAL";
    const invoiceStatus = isPaid ? "PAID" : "PARTIAL";

    const invoice =
      workOrder.invoice ??
      (await tx.invoice.create({
        data: {
          businessId,
          workOrderId: workOrder.id,
          invoiceNumber: makeInvoiceNumber(),
          subtotal: workOrder.subtotal,
          total: workOrder.total,
          paidAmount: fromCents(0),
          balance: workOrder.total,
          status: "UNPAID",
        },
      }));

    await tx.payment.create({
      data: {
        businessId,
        workOrderId: workOrder.id,
        amount: fromCents(amountCents),
        method: input.method,
        reference: input.reference || null,
      },
    });

    await tx.workOrder.update({
      where: { id: workOrder.id },
      data: {
        paidAmount: fromCents(nextPaidCents),
        balance: fromCents(nextBalanceCents),
        paymentStatus,
        status: isPaid ? "COMPLETED" : workOrder.status,
      },
    });

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount: fromCents(nextPaidCents),
        balance: fromCents(nextBalanceCents),
        status: invoiceStatus,
      },
    });

    if (isPaid) {
      await tx.whatsAppMessage.create({
        data: {
          businessId,
          customerId: workOrder.customer.id,
          vehicleId: workOrder.vehicle.id,
          workOrderId: workOrder.id,
          invoiceId: invoice.id,
          phone: workOrder.customer.phone,
          messageType: "INVOICE_SENT",
          messageBody: invoiceSentTemplate({
            businessName: workOrder.business.name,
            customerName: workOrder.customer.name,
            plateNumber: workOrder.vehicle.plateNumber,
            invoiceNumber: invoice.invoiceNumber,
            total: fromCents(totalCents),
            paidAmount: fromCents(nextPaidCents),
          }),
          status: "READY",
        },
      });
    }

    return invoice.id;
  });

  revalidatePath("/pos");
  revalidatePath(`/pos/${input.workOrderId}`);
  revalidatePath("/work-orders");
  revalidatePath(`/work-orders/${input.workOrderId}`);
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/whatsapp");
  redirect(`/invoices/${invoiceId}`);
}

export async function usePackagePaymentAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const input = usePackagePaymentSchema.parse({
    workOrderId: formData.get("workOrderId"),
    customerPackageId: formData.get("customerPackageId"),
  });

  const invoiceId = await prisma.$transaction(async (tx) => {
    const workOrder = await tx.workOrder.findFirstOrThrow({
      where: {
        id: input.workOrderId,
        businessId,
      },
      include: {
        invoice: true,
        business: true,
        customer: true,
        vehicle: true,
        items: true,
      },
    });

    if (workOrder.status === "CANCELLED") {
      throw new Error("Cannot use a package for a cancelled work order.");
    }

    if (workOrder.paymentStatus === "PAID") {
      throw new Error("This work order is already fully paid.");
    }

    const customerPackage = await tx.customerPackage.findFirstOrThrow({
      where: {
        id: input.customerPackageId,
        businessId,
        customerId: workOrder.customerId,
        status: "ACTIVE",
        remainingUses: {
          gt: 0,
        },
      },
      include: {
        package: true,
      },
    });

    if (
      customerPackage.package.serviceId &&
      !workOrder.items.some(
        (item) => item.serviceId === customerPackage.package.serviceId,
      )
    ) {
      throw new Error("This package cannot be used for the selected services.");
    }

    const totalCents = toCents(workOrder.total);
    const paidCents = toCents(workOrder.paidAmount);
    const balanceCents = totalCents - paidCents;

    if (balanceCents <= 0) {
      throw new Error("This work order has no outstanding balance.");
    }

    const nextRemainingUses = customerPackage.remainingUses - 1;
    const nextPaidCents = totalCents;

    const invoice =
      workOrder.invoice ??
      (await tx.invoice.create({
        data: {
          businessId,
          workOrderId: workOrder.id,
          invoiceNumber: makeInvoiceNumber(),
          subtotal: workOrder.subtotal,
          total: workOrder.total,
          paidAmount: fromCents(0),
          balance: workOrder.total,
          status: "UNPAID",
        },
      }));

    await tx.customerPackage.update({
      where: { id: customerPackage.id },
      data: {
        remainingUses: nextRemainingUses,
        status: nextRemainingUses === 0 ? "USED_UP" : "ACTIVE",
      },
    });

    await tx.payment.create({
      data: {
        businessId,
        workOrderId: workOrder.id,
        customerPackageId: customerPackage.id,
        amount: fromCents(balanceCents),
        method: "PACKAGE",
        packageUses: 1,
        reference: `${customerPackage.package.name} prepaid wash`,
      },
    });

    await tx.workOrder.update({
      where: { id: workOrder.id },
      data: {
        paidAmount: fromCents(nextPaidCents),
        balance: fromCents(0),
        paymentStatus: "PAID",
        status: "COMPLETED",
      },
    });

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount: fromCents(nextPaidCents),
        balance: fromCents(0),
        status: "PAID",
      },
    });

    await tx.whatsAppMessage.create({
      data: {
        businessId,
        customerId: workOrder.customer.id,
        vehicleId: workOrder.vehicle.id,
        workOrderId: workOrder.id,
        invoiceId: invoice.id,
        phone: workOrder.customer.phone,
        messageType: "INVOICE_SENT",
        messageBody: invoiceSentTemplate({
          businessName: workOrder.business.name,
          customerName: workOrder.customer.name,
          plateNumber: workOrder.vehicle.plateNumber,
          invoiceNumber: invoice.invoiceNumber,
          total: fromCents(totalCents),
          paidAmount: fromCents(nextPaidCents),
        }),
        status: "READY",
      },
    });

    return invoice.id;
  });

  revalidatePath("/pos");
  revalidatePath(`/pos/${input.workOrderId}`);
  revalidatePath("/work-orders");
  revalidatePath(`/work-orders/${input.workOrderId}`);
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/crm/customers");
  revalidatePath("/whatsapp");
  redirect(`/invoices/${invoiceId}`);
}
