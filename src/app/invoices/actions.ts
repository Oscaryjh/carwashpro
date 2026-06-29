"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

export type VoidInvoiceState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function voidInvoiceAction(
  _previousState: VoidInvoiceState,
  formData: FormData,
): Promise<VoidInvoiceState> {
  const { businessId } = await requireBusinessUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const voidReason = String(formData.get("voidReason") ?? "").trim();

  if (!voidReason) {
    return {
      status: "error",
      message: "Please enter a reason before voiding this invoice.",
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirstOrThrow({
        where: {
          id: invoiceId,
          businessId,
        },
        include: {
          workOrder: true,
        },
      });

      if (invoice.status === "VOID") {
        throw new Error("This invoice is already void.");
      }

      const activePayments = await tx.payment.findMany({
        where: {
          businessId,
          workOrderId: invoice.workOrderId,
          status: "ACTIVE",
        },
        include: {
          customerPackage: true,
        },
      });

      for (const payment of activePayments) {
        if (
          payment.method === "PACKAGE" &&
          payment.customerPackage &&
          payment.packageUses > 0
        ) {
          const nextRemainingUses = Math.min(
            payment.customerPackage.totalUses,
            payment.customerPackage.remainingUses + payment.packageUses,
          );

          await tx.customerPackage.update({
            where: { id: payment.customerPackage.id },
            data: {
              remainingUses: nextRemainingUses,
              status:
                payment.customerPackage.status === "USED_UP"
                  ? "ACTIVE"
                  : payment.customerPackage.status,
            },
          });
        }
      }

      await tx.payment.updateMany({
        where: {
          businessId,
          workOrderId: invoice.workOrderId,
          status: "ACTIVE",
        },
        data: {
          status: "VOID",
          voidedAt: new Date(),
          voidReason,
        },
      });

      await tx.workOrder.update({
        where: { id: invoice.workOrderId },
        data: {
          paidAmount: 0,
          balance: invoice.workOrder.total,
          paymentStatus: "UNPAID",
          status:
            invoice.workOrder.status === "COMPLETED"
              ? "READY_FOR_PICKUP"
              : invoice.workOrder.status,
        },
      });

      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: 0,
          balance: invoice.total,
          status: "VOID",
          voidedAt: new Date(),
          voidReason,
        },
      });

      return {
        invoiceId: invoice.id,
        workOrderId: invoice.workOrderId,
      };
    });

    revalidatePath("/dashboard");
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${result.invoiceId}`);
    revalidatePath("/pos");
    revalidatePath(`/pos/${result.workOrderId}`);
    revalidatePath("/work-orders");
    revalidatePath(`/work-orders/${result.workOrderId}`);

    return {
      status: "success",
      message:
        "Invoice voided. Related payments were voided and the work order is open for POS correction.",
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to void this invoice.",
    };
  }
}
