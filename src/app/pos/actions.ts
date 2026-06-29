"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { sendInvoiceIfConnected } from "@/lib/whatsapp/invoice-notifications";
import {
  fromCents,
  makeInvoiceNumber,
  packagePurchasePaymentSchema,
  paymentSchema,
  toCents,
} from "@/lib/validation/pos";
import { usePackagePaymentSchema } from "@/lib/validation/packages";

export async function recordPaymentAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  const input = paymentSchema.parse({
    workOrderId: formData.get("workOrderId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reference: formData.get("reference"),
  });

  const result = await prisma.$transaction(async (tx) => {
    const workOrder = await tx.workOrder.findFirstOrThrow({
      where: {
        id: input.workOrderId,
        businessId,
      },
      include: {
        invoice: true,
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
          branchId: workOrder.branchId,
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
        branchId: workOrder.branchId,
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
        voidedAt: null,
        voidReason: null,
      },
    });

    return {
      invoiceId: invoice.id,
      shouldSendInvoice: isPaid,
    };
  });

  revalidatePath("/pos");
  revalidatePath(`/pos/${input.workOrderId}`);
  revalidatePath("/work-orders");
  revalidatePath(`/work-orders/${input.workOrderId}`);
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${result.invoiceId}`);

  if (result.shouldSendInvoice) {
    await sendInvoiceIfConnected({
      businessId,
      invoiceId: result.invoiceId,
      sentByUserId: user.userId,
    });
  }

  redirect(`/invoices/${result.invoiceId}`);
}

export async function usePackagePaymentAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
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
          branchId: workOrder.branchId,
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
        branchId: workOrder.branchId,
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
        voidedAt: null,
        voidReason: null,
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
  await sendInvoiceIfConnected({
    businessId,
    invoiceId,
    sentByUserId: user.userId,
  });
  redirect(`/invoices/${invoiceId}`);
}

export async function recordPackagePurchasePaymentAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const input = packagePurchasePaymentSchema.parse({
    customerPackageId: formData.get("customerPackageId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reference: formData.get("reference"),
  });

  const customerId = await prisma.$transaction(async (tx) => {
    const customerPackage = await tx.customerPackage.findFirstOrThrow({
      where: {
        id: input.customerPackageId,
        businessId,
        status: "PENDING_PAYMENT",
      },
      include: {
        customer: true,
        package: true,
      },
    });

    const priceCents = toCents(customerPackage.purchasePrice);
    const amountCents = toCents(input.amount);

    if (amountCents !== priceCents) {
      throw new Error("Package purchase must be paid in full before activation.");
    }

    await tx.payment.create({
      data: {
        businessId,
        branchId: customerPackage.branchId,
        workOrderId: null,
        customerPackageId: customerPackage.id,
        amount: fromCents(amountCents),
        method: input.method,
        reference: input.reference || `${customerPackage.package.name} package purchase`,
      },
    });

    await tx.customerPackage.update({
      where: { id: customerPackage.id },
      data: {
        remainingUses: customerPackage.totalUses,
        status: "ACTIVE",
      },
    });

    return customerPackage.customer.id;
  });

  revalidatePath("/pos");
  revalidatePath(`/pos/packages/${input.customerPackageId}`);
  revalidatePath(`/crm/customers/${customerId}`);
  redirect(`/crm/customers/${customerId}`);
}
