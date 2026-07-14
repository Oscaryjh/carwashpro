"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { makeInvoiceNumber } from "@/lib/invoices/invoice-number";
import { awardLoyaltyPointsForPayment } from "@/lib/loyalty/service";
import { prisma } from "@/lib/prisma";
import { sendInvoiceIfConnected } from "@/lib/whatsapp/invoice-notifications";
import {
  fromCents,
  packagePurchasePaymentSchema,
  paymentSchema,
  toCents,
} from "@/lib/validation/pos";
import { usePackagePaymentSchema } from "@/lib/validation/packages";
import { packageAllowsVehicle, vehicleSizeLabel } from "@/lib/vehicle-size";

export async function recordPaymentAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  const auditRequest = await getAuditRequestContext();
  const input = paymentSchema.parse({
    workOrderId: formData.get("workOrderId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reference: formData.get("reference"),
  });

  const result = await prisma.$transaction(async (tx) => {
    const shift = await getOpenShift(tx, businessId, user.userId);
    const workOrder = await tx.workOrder.findFirstOrThrow({
      where: {
        id: input.workOrderId,
        businessId,
        ...(user.role === "BUSINESS_OWNER"
          ? {}
          : { branchId: user.branchId ?? "00000000-0000-0000-0000-000000000000" }),
      },
      include: {
        invoice: true,
      },
    });
    assertShiftBranch(shift.branchId, workOrder.branchId);

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

    const payment = await tx.payment.create({
      data: {
        businessId,
        branchId: workOrder.branchId,
        cashierId: user.userId,
        shiftId: shift.id,
        workOrderId: workOrder.id,
        amount: fromCents(amountCents),
        method: input.method,
        reference: input.reference || null,
      },
    });

    await awardLoyaltyPointsForPayment(tx, {
      businessId,
      branchId: workOrder.branchId,
      customerId: workOrder.customerId,
      paymentId: payment.id,
      amountCents,
      paymentMethod: payment.method,
      createdById: user.userId,
    });

    await tx.workOrder.update({
      where: { id: workOrder.id },
      data: {
        paidAmount: fromCents(nextPaidCents),
        balance: fromCents(nextBalanceCents),
        paymentStatus,
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

    await writeAuditLog(
      {
        businessId,
        branchId: workOrder.branchId,
        actor: user,
        action: "PAYMENT_RECORDED",
        entityType: "Payment",
        entityId: payment.id,
        summary: `Recorded ${fromCents(amountCents)} ${input.method} payment`,
        before: {
          workOrderId: workOrder.id,
          paidAmount: workOrder.paidAmount,
          balance: workOrder.balance,
          paymentStatus: workOrder.paymentStatus,
        },
        after: {
          workOrderId: workOrder.id,
          invoiceId: invoice.id,
          amount: payment.amount,
          method: payment.method,
          paidAmount: fromCents(nextPaidCents),
          balance: fromCents(nextBalanceCents),
          paymentStatus,
        },
        request: auditRequest,
      },
      tx,
    );

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

  redirect(
    `/work-orders?type=success&message=${encodeURIComponent(
      "Checkout completed.",
    )}`,
  );
}

export async function usePackagePaymentAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  const auditRequest = await getAuditRequestContext();
  const input = usePackagePaymentSchema.parse({
    workOrderId: formData.get("workOrderId"),
    customerPackageId: formData.get("customerPackageId"),
  });

  const invoiceId = await prisma.$transaction(async (tx) => {
    const shift = await getOpenShift(tx, businessId, user.userId);
    const workOrder = await tx.workOrder.findFirstOrThrow({
      where: {
        id: input.workOrderId,
        businessId,
        ...(user.role === "BUSINESS_OWNER"
          ? {}
          : { branchId: user.branchId ?? "00000000-0000-0000-0000-000000000000" }),
      },
      include: {
        invoice: true,
        items: true,
        vehicle: { select: { size: true } },
      },
    });
    assertShiftBranch(shift.branchId, workOrder.branchId);

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

    if (!packageAllowsVehicle(customerPackage.eligibleVehicleSize, workOrder.vehicle.size)) {
      throw new Error(
        workOrder.vehicle.size === "UNCLASSIFIED"
          ? "Classify this vehicle as Small, Medium, or Large before using a package."
          : `This package is for ${vehicleSizeLabel(customerPackage.eligibleVehicleSize)} vehicles and cannot be used for this ${vehicleSizeLabel(workOrder.vehicle.size)} vehicle.`,
      );
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

    const payment = await tx.payment.create({
      data: {
        businessId,
        branchId: workOrder.branchId,
        cashierId: user.userId,
        workOrderId: workOrder.id,
        customerPackageId: customerPackage.id,
        shiftId: shift.id,
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

    await writeAuditLog(
      {
        businessId,
        branchId: workOrder.branchId,
        actor: user,
        action: "PACKAGE_USE_RECORDED",
        entityType: "Payment",
        entityId: payment.id,
        summary: `Used ${customerPackage.package.name} for checkout`,
        before: {
          customerPackageId: customerPackage.id,
          remainingUses: customerPackage.remainingUses,
          workOrderPaymentStatus: workOrder.paymentStatus,
        },
        after: {
          customerPackageId: customerPackage.id,
          remainingUses: nextRemainingUses,
          workOrderPaymentStatus: "PAID",
          invoiceId: invoice.id,
        },
        request: auditRequest,
      },
      tx,
    );

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
  redirect(
    `/work-orders?type=success&message=${encodeURIComponent(
      "Checkout completed.",
    )}`,
  );
}

export async function recordPackagePurchasePaymentAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  const auditRequest = await getAuditRequestContext();
  const input = packagePurchasePaymentSchema.parse({
    customerPackageId: formData.get("customerPackageId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reference: formData.get("reference"),
  });

  const customerId = await prisma.$transaction(async (tx) => {
    const shift = await getOpenShift(tx, businessId, user.userId);
    const customerPackage = await tx.customerPackage.findFirstOrThrow({
      where: {
        id: input.customerPackageId,
        businessId,
        ...(user.role === "BUSINESS_OWNER"
          ? {}
          : { branchId: user.branchId ?? "00000000-0000-0000-0000-000000000000" }),
        status: "PENDING_PAYMENT",
      },
      include: {
        customer: true,
        package: true,
      },
    });
    assertShiftBranch(shift.branchId, customerPackage.branchId);

    const priceCents = toCents(customerPackage.purchasePrice);
    const amountCents = toCents(input.amount);

    if (amountCents !== priceCents) {
      throw new Error("Package purchase must be paid in full before activation.");
    }

    const payment = await tx.payment.create({
      data: {
        businessId,
        branchId: customerPackage.branchId,
        cashierId: user.userId,
        workOrderId: null,
        customerPackageId: customerPackage.id,
        shiftId: shift.id,
        amount: fromCents(amountCents),
        method: input.method,
        reference: input.reference || `${customerPackage.package.name} package purchase`,
      },
    });

    await awardLoyaltyPointsForPayment(tx, {
      businessId,
      branchId: customerPackage.branchId,
      customerId: customerPackage.customerId,
      paymentId: payment.id,
      amountCents,
      paymentMethod: payment.method,
      createdById: user.userId,
    });

    await tx.customerPackage.update({
      where: { id: customerPackage.id },
      data: {
        remainingUses: customerPackage.totalUses,
        status: "ACTIVE",
      },
    });

    await writeAuditLog(
      {
        businessId,
        branchId: customerPackage.branchId,
        actor: user,
        action: "PACKAGE_PURCHASE_PAID",
        entityType: "Payment",
        entityId: payment.id,
        summary: `Activated ${customerPackage.package.name} package`,
        before: {
          customerPackageId: customerPackage.id,
          status: customerPackage.status,
          remainingUses: customerPackage.remainingUses,
        },
        after: {
          customerPackageId: customerPackage.id,
          status: "ACTIVE",
          remainingUses: customerPackage.totalUses,
          amount: payment.amount,
          method: payment.method,
        },
        request: auditRequest,
      },
      tx,
    );

    return customerPackage.customer.id;
  });

  revalidatePath("/pos");
  revalidatePath(`/pos/packages/${input.customerPackageId}`);
  revalidatePath(`/crm/customers/${customerId}`);
  redirect(`/crm/customers/${customerId}`);
}

type PosTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function getOpenShift(
  tx: PosTransactionClient,
  businessId: string,
  cashierId: string,
) {
  const shift = await tx.cashierShift.findFirst({
    where: {
      businessId,
      cashierId,
      status: "OPEN",
    },
    select: { id: true, branchId: true },
  });

  if (!shift) {
    throw new Error("Start a cashier shift before checkout.");
  }

  return shift;
}

function assertShiftBranch(shiftBranchId: string | null, recordBranchId: string | null) {
  if (shiftBranchId !== recordBranchId) {
    throw new Error("This payment does not belong to the current shift branch.");
  }
}
