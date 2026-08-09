"use server";

import { FinancialOperationType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { makeInvoiceNumber } from "@/lib/invoices/invoice-number";
import { awardLoyaltyPointsForPayment } from "@/lib/loyalty/service";
import { activateCustomerPackageServiceBalances } from "@/lib/packages/service-balances";
import { prisma } from "@/lib/prisma";
import { calculatePackageTax, calculateTax } from "@/lib/tax/calculator";
import { sendInvoiceIfConnected } from "@/lib/whatsapp/invoice-notifications";
import {
  fromCents,
  packagePurchasePaymentSchema,
  paymentSchema,
  toCents,
} from "@/lib/validation/pos";
import { usePackagePaymentSchema } from "@/lib/validation/packages";
import { packageAllowsVehicle, vehicleSizeLabel } from "@/lib/vehicle-size";
import { runFinancialOperation } from "@/lib/financial-idempotency";

export async function recordPaymentAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser(
    "PROCESS_CASHIER_PAYMENT",
  );
  const auditRequest = await getAuditRequestContext();
  const input = paymentSchema.parse({
    operationId: formData.get("operationId"),
    workOrderId: formData.get("workOrderId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reference: formData.get("reference"),
  });

  const { operationId, ...financialPayload } = input;
  const { result } = await runFinancialOperation({
    actorUserId: user.userId,
    branchId: null,
    businessId,
    operationKey: operationId,
    operationType: FinancialOperationType.WORK_ORDER_PAYMENT,
    payload: financialPayload,
    execute: async (tx) => {
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
        business: {
          select: { sstEnabled: true, sstLabel: true, sstRate: true },
        },
        invoice: true,
        items: {
          orderBy: { createdAt: "asc" },
          include: {
            service: { select: { taxable: true, taxRate: true } },
          },
        },
      },
    });
    assertShiftBranch(shift.branchId, workOrder.branchId);

    if (workOrder.status === "CANCELLED") {
      throw new Error("Cannot take payment for a cancelled work order.");
    }

    if (workOrder.paymentStatus === "PAID") {
      throw new Error("This work order is already fully paid.");
    }

    const tax = workOrder.invoice
      ? null
      : calculateTax({
          sstEnabled: workOrder.business.sstEnabled,
          sstLabel: workOrder.business.sstLabel,
          sstRate: Number(workOrder.business.sstRate),
          lines: workOrder.items.map((item) => ({
            lineTotal: Number(item.lineTotal),
            taxable: item.service?.taxable ?? false,
            taxRate: item.service?.taxRate == null ? null : Number(item.service.taxRate),
          })),
        });
    const totalCents = workOrder.invoice
      ? toCents(workOrder.invoice.total)
      : toCents(tax?.total ?? workOrder.total);
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
          taxableSubtotal: fromCents(toCents(tax?.taxableSubtotal)),
          taxAmount: fromCents(toCents(tax?.tax)),
          taxRate: fromCents(toCents(tax?.taxRate)),
          taxLabel: tax?.tax && tax.tax > 0 ? tax.taxLabel : null,
          total: fromCents(totalCents),
          paidAmount: fromCents(0),
          balance: fromCents(totalCents),
          status: "UNPAID",
          items: {
            create: workOrder.items.map((item, index) => ({
              businessId,
              serviceId: item.serviceId,
              name: item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
              taxable: item.service?.taxable ?? false,
              taxRate: fromCents(toCents(
                item.service?.taxable && workOrder.business.sstEnabled
                  ? item.service.taxRate == null
                    ? Number(workOrder.business.sstRate)
                    : Number(item.service.taxRate)
                  : 0,
              )),
              taxAmount: fromCents(toCents(tax?.lineTax[index])),
            })),
          },
        },
      }));

    const payment = await tx.payment.create({
      data: {
        businessId,
        branchId: workOrder.branchId,
        cashierId: user.userId,
        shiftId: shift.id,
        workOrderId: workOrder.id,
        invoiceId: invoice.id,
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
        total: fromCents(totalCents),
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
    },
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
  const { businessId, user } = await requireBusinessUser(
    "PROCESS_CASHIER_PAYMENT",
  );
  const auditRequest = await getAuditRequestContext();
  const input = usePackagePaymentSchema.parse({
    operationId: formData.get("operationId"),
    workOrderId: formData.get("workOrderId"),
    customerPackageId: formData.get("customerPackageId"),
  });

  const { operationId, ...financialPayload } = input;
  const { result: packageResult } = await runFinancialOperation({
    actorUserId: user.userId,
    branchId: null,
    businessId,
    operationKey: operationId,
    operationType: FinancialOperationType.PACKAGE_REDEMPTION,
    payload: financialPayload,
    execute: async (tx) => {
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
        business: {
          select: { sstEnabled: true, sstLabel: true, sstRate: true },
        },
        invoice: true,
        items: {
          orderBy: { createdAt: "asc" },
          include: {
            service: { select: { taxable: true, taxRate: true } },
          },
        },
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
        serviceBalances: true,
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

    const tax = workOrder.invoice
      ? null
      : calculateTax({
          sstEnabled: workOrder.business.sstEnabled,
          sstLabel: workOrder.business.sstLabel,
          sstRate: Number(workOrder.business.sstRate),
          lines: workOrder.items.map((item) => ({
            lineTotal: Number(item.lineTotal),
            taxable: item.service?.taxable ?? false,
            taxRate: item.service?.taxRate == null ? null : Number(item.service.taxRate),
          })),
        });
    const totalCents = workOrder.invoice
      ? toCents(workOrder.invoice.total)
      : toCents(tax?.total ?? workOrder.total);
    const paidCents = toCents(workOrder.paidAmount);
    const balanceCents = totalCents - paidCents;

    if (balanceCents <= 0) {
      throw new Error("This work order has no outstanding balance.");
    }

    const nextRemainingUses = customerPackage.remainingUses - 1;
    const serviceBalance = customerPackage.package.serviceId
      ? customerPackage.serviceBalances.find(
          (balance) => balance.serviceId === customerPackage.package.serviceId,
        )
      : null;
    if (serviceBalance && serviceBalance.remainingUses <= 0) {
      throw new Error("This package has no remaining uses for the selected service.");
    }
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
          taxableSubtotal: fromCents(toCents(tax?.taxableSubtotal)),
          taxAmount: fromCents(toCents(tax?.tax)),
          taxRate: fromCents(toCents(tax?.taxRate)),
          taxLabel: tax?.tax && tax.tax > 0 ? tax.taxLabel : null,
          total: fromCents(totalCents),
          paidAmount: fromCents(0),
          balance: fromCents(totalCents),
          status: "UNPAID",
          items: {
            create: workOrder.items.map((item, index) => ({
              businessId,
              serviceId: item.serviceId,
              name: item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
              taxable: item.service?.taxable ?? false,
              taxRate: fromCents(toCents(
                item.service?.taxable && workOrder.business.sstEnabled
                  ? item.service.taxRate == null
                    ? Number(workOrder.business.sstRate)
                    : Number(item.service.taxRate)
                  : 0,
              )),
              taxAmount: fromCents(toCents(tax?.lineTax[index])),
            })),
          },
        },
      }));

    await tx.customerPackage.update({
      where: { id: customerPackage.id },
      data: {
        remainingUses: nextRemainingUses,
        status: nextRemainingUses === 0 ? "USED_UP" : "ACTIVE",
      },
    });
    if (serviceBalance) {
      await tx.customerPackageServiceBalance.update({
        where: { id: serviceBalance.id },
        data: { remainingUses: { decrement: 1 } },
      });
    }
    const payment = await tx.payment.create({
      data: {
        businessId,
        branchId: workOrder.branchId,
        cashierId: user.userId,
        workOrderId: workOrder.id,
        invoiceId: invoice.id,
        customerPackageId: customerPackage.id,
        customerPackageServiceBalanceId: serviceBalance?.id ?? null,
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
        total: fromCents(totalCents),
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

    return { invoiceId: invoice.id };
    },
  });
  const { invoiceId } = packageResult;

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
  const { businessId, user } = await requireBusinessUser(
    "PROCESS_CASHIER_PAYMENT",
  );
  const auditRequest = await getAuditRequestContext();
  const input = packagePurchasePaymentSchema.parse({
    operationId: formData.get("operationId"),
    customerPackageId: formData.get("customerPackageId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reference: formData.get("reference"),
  });

  const { operationId, ...financialPayload } = input;
  const { result } = await runFinancialOperation({
    actorUserId: user.userId,
    branchId: null,
    businessId,
    operationKey: operationId,
    operationType: FinancialOperationType.PACKAGE_PURCHASE,
    payload: financialPayload,
    execute: async (tx) => {
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
        package: {
          include: {
            service: true,
          },
        },
      },
    });
    assertShiftBranch(shift.branchId, customerPackage.branchId);

    const business = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        sstEnabled: true,
        sstLabel: true,
        sstRate: true,
      },
    });
    const packageTax = calculatePackageTax({
      price: Number(customerPackage.purchasePrice),
      taxable: customerPackage.package.service?.taxable ?? true,
      taxRate: customerPackage.package.service?.taxRate
        ? Number(customerPackage.package.service.taxRate)
        : null,
      sstEnabled: business.sstEnabled,
      sstLabel: business.sstLabel,
      sstRate: Number(business.sstRate),
    });

    const priceCents = toCents(packageTax.total);
    const amountCents = toCents(input.amount);

    if (amountCents !== priceCents) {
      throw new Error("Package purchase must be paid in full before activation.");
    }

    const invoice = await tx.invoice.create({
      data: {
        businessId,
        branchId: customerPackage.branchId,
        customerId: customerPackage.customerId,
        customerPackageId: customerPackage.id,
        invoiceNumber: makeInvoiceNumber(),
        subtotal: fromCents(toCents(packageTax.subtotal)),
        taxableSubtotal: fromCents(toCents(packageTax.taxableSubtotal)),
        taxAmount: fromCents(toCents(packageTax.tax)),
        taxRate: packageTax.taxRate,
        taxLabel: packageTax.taxLabel,
        total: fromCents(priceCents),
        paidAmount: fromCents(priceCents),
        balance: fromCents(0),
        status: "PAID",
        items: {
          create: {
            businessId,
            serviceId: customerPackage.package.serviceId,
            name: customerPackage.package.name,
            quantity: 1,
            unitPrice: fromCents(toCents(packageTax.subtotal)),
            lineTotal: fromCents(toCents(packageTax.subtotal)),
            taxable: customerPackage.package.service?.taxable ?? true,
            taxRate: customerPackage.package.service?.taxRate ?? packageTax.taxRate,
            taxAmount: fromCents(toCents(packageTax.lineTax[0] ?? 0)),
          },
        },
      },
    });

    const payment = await tx.payment.create({
      data: {
        businessId,
        branchId: customerPackage.branchId,
        cashierId: user.userId,
        workOrderId: null,
        invoiceId: invoice.id,
        customerPackageId: customerPackage.id,
        shiftId: shift.id,
        amount: fromCents(priceCents),
        method: input.method,
        reference: input.reference || `${customerPackage.package.name} package purchase`,
      },
    });

    await awardLoyaltyPointsForPayment(tx, {
      businessId,
      branchId: customerPackage.branchId,
      customerId: customerPackage.customerId,
      paymentId: payment.id,
      amountCents: priceCents,
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
    await activateCustomerPackageServiceBalances(tx, customerPackage.id);

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
          invoiceId: invoice.id,
        },
        request: auditRequest,
      },
      tx,
    );

    return {
      customerId: customerPackage.customer.id,
      invoiceId: invoice.id,
    };
    },
  });

  revalidatePath("/pos");
  revalidatePath(`/pos/packages/${input.customerPackageId}`);
  revalidatePath(`/crm/customers/${result.customerId}`);
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${result.invoiceId}`);
  await sendInvoiceIfConnected({
    businessId,
    invoiceId: result.invoiceId,
    sentByUserId: user.userId,
  });
  redirect(`/crm/customers/${result.customerId}`);
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
