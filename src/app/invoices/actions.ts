"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { makeCreditNoteNumber } from "@/lib/invoices/credit-note-number";
import {
  restoreRedeemedLoyaltyPointsForRefund,
  reverseLoyaltyPointsForRefund,
} from "@/lib/loyalty/service";
import { prisma } from "@/lib/prisma";
import { calculateCreditNoteAmounts } from "@/lib/tax/calculator";
import {
  getRefundableCents,
  getRefundedPaymentState,
} from "@/lib/refunds/rules";
import { fromCents, toCents } from "@/lib/validation/pos";

export type VoidInvoiceState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type RefundPaymentState = {
  status: "idle" | "success" | "error";
  message: string;
};

const refundPaymentSchema = z.object({
  invoiceId: z.string().uuid("Invoice is required."),
  paymentId: z.string().uuid("Payment is required."),
  amount: z.coerce.number().positive("Refund amount must be more than 0."),
  method: z.enum([
    "CASH",
    "CARD",
    "DUITNOW",
    "EWALLET",
    "BANK_TRANSFER",
    "PACKAGE",
  ]),
  reason: z.string().trim().min(3, "Please enter a clear refund reason."),
  reference: z.string().trim().optional(),
});

export async function refundPaymentAction(
  _previousState: RefundPaymentState,
  formData: FormData,
): Promise<RefundPaymentState> {
  const { businessId, user } = await requireBusinessUser();
  const auditRequest = await getAuditRequestContext();

  if (user.role !== "BUSINESS_OWNER") {
    return {
      status: "error",
      message: "Only the business owner can process refunds.",
    };
  }

  const parsed = refundPaymentSchema.safeParse({
    invoiceId: formData.get("invoiceId"),
    paymentId: formData.get("paymentId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reason: formData.get("reason"),
    reference: formData.get("reference"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid refund details.",
    };
  }

  const input = parsed.data;
  const amountCents = Math.round(input.amount * 100);

  if (Math.abs(input.amount * 100 - amountCents) > 0.0001) {
    return {
      status: "error",
      message: "Refund amount can have at most two decimal places.",
    };
  }

  if (
    input.method !== "CASH" &&
    input.method !== "PACKAGE" &&
    !input.reference
  ) {
    return {
      status: "error",
      message: "Reference is required for non-cash refunds.",
    };
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const shift = await tx.cashierShift.findFirst({
          where: {
            businessId,
            cashierId: user.userId,
            status: "OPEN",
          },
          orderBy: { startedAt: "desc" },
        });

        if (!shift) {
          throw new Error("Start a cashier shift before processing a refund.");
        }

        const invoice = await tx.invoice.findFirst({
          where: {
            id: input.invoiceId,
            businessId,
          },
          include: {
            workOrder: true,
            customerPackage: {
              include: {
                package: true,
              },
            },
            items: {
              include: {
                customerPackage: {
                  include: { package: true },
                },
              },
            },
          },
        });

        if (!invoice) {
          throw new Error("Invoice not found.");
        }
        const purchasedPackages = Array.from(
          new Map(
            [
              ...invoice.items
                .map((item) => item.customerPackage)
                .filter((item): item is NonNullable<typeof item> => Boolean(item)),
              ...(invoice.customerPackage ? [invoice.customerPackage] : []),
            ].map((item) => [item.id, item]),
          ).values(),
        );
        if (invoice.status === "VOID") {
          throw new Error("A void invoice cannot be refunded.");
        }

        const payment = await tx.payment.findFirst({
          where: {
            id: input.paymentId,
            businessId,
            OR: [
              { invoiceId: invoice.id },
              ...(invoice.workOrderId
                ? [{ workOrderId: invoice.workOrderId }]
                : []),
            ],
            status: "ACTIVE",
          },
          include: {
            refunds: true,
            customerPackage: true,
          },
        });

        if (!payment) {
          throw new Error("Active payment not found for this invoice.");
        }

        if (!payment.invoiceId) {
          await tx.payment.update({
            where: { id: payment.id },
            data: { invoiceId: invoice.id },
          });
        }

        if (
          shift.branchId &&
          payment.branchId &&
          shift.branchId !== payment.branchId
        ) {
          throw new Error("This refund belongs to a different branch shift.");
        }

        const refundableCents = getRefundableCents(
          toCents(payment.amount),
          payment.refunds.map((refund) => toCents(refund.amount)),
        );

        if (refundableCents <= 0) {
          throw new Error("This payment has already been fully refunded.");
        }

        if (amountCents > refundableCents) {
          throw new Error(
            `Refund cannot exceed RM${fromCents(refundableCents)}.`,
          );
        }

        if (!invoice.workOrder) {
          if (!purchasedPackages.length) {
            throw new Error("This invoice is not linked to a refundable package.");
          }
          if (amountCents !== refundableCents) {
            throw new Error("Package purchases must be refunded in full.");
          }
          if (
            purchasedPackages.some(
              (customerPackage) =>
                customerPackage.status !== "ACTIVE" ||
                customerPackage.remainingUses !== customerPackage.totalUses,
            )
          ) {
            throw new Error(
              "All packages in this invoice must be unused before they can be refunded.",
            );
          }
        }

        if (payment.method === "PACKAGE" && amountCents !== refundableCents) {
          throw new Error("Package voucher payments must be refunded in full.");
        }

        if (payment.method === "PACKAGE" && input.method !== "PACKAGE") {
          throw new Error("Package voucher refunds must restore the package use.");
        }

        if (payment.method !== "PACKAGE" && input.method === "PACKAGE") {
          throw new Error("Package is not a valid refund method for this payment.");
        }

        let packageUsesRestored = 0;

        if (
          payment.method === "PACKAGE" &&
          payment.customerPackage &&
          payment.packageUses > 0
        ) {
          packageUsesRestored = payment.packageUses;
          const nextRemainingUses = Math.min(
            payment.customerPackage.totalUses,
            payment.customerPackage.remainingUses + packageUsesRestored,
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

        const refund = await tx.paymentRefund.create({
          data: {
            businessId,
            branchId: payment.branchId,
            paymentId: payment.id,
            workOrderId: invoice.workOrderId,
            invoiceId: invoice.id,
            processedById: user.userId,
            shiftId: shift.id,
            amount: fromCents(amountCents),
            method: input.method,
            reason: input.reason,
            reference: input.reference || null,
            packageUsesRestored,
          },
        });

        if (!invoice.workOrder && purchasedPackages.length) {
          await tx.customerPackage.updateMany({
            where: { id: { in: purchasedPackages.map((item) => item.id) } },
            data: {
              status: "CANCELLED",
              remainingUses: 0,
            },
          });
        }

        await reverseLoyaltyPointsForRefund(tx, {
          businessId,
          branchId: payment.branchId,
          paymentId: payment.id,
          refundId: refund.id,
          paymentAmountCents: toCents(payment.amount),
          createdById: user.userId,
        });
        await restoreRedeemedLoyaltyPointsForRefund(tx, {
          businessId,
          branchId: payment.branchId,
          paymentId: payment.id,
          refundId: refund.id,
          paymentAmountCents: toCents(payment.amount),
          createdById: user.userId,
        });

        const nextPaidCents = Math.max(0, toCents(invoice.paidAmount) - amountCents);
        const totalCents = toCents(invoice.total);
        const nextBalanceCents = Math.max(0, totalCents - nextPaidCents);
        const nextStatus = getRefundedPaymentState(
          totalCents,
          nextPaidCents,
          true,
        );

        if (invoice.workOrder) {
          await tx.workOrder.update({
            where: { id: invoice.workOrder.id },
            data: {
              paidAmount: fromCents(nextPaidCents),
              balance: fromCents(nextBalanceCents),
              paymentStatus: nextStatus,
            },
          });
        }

        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: fromCents(nextPaidCents),
            balance: fromCents(nextBalanceCents),
            status: nextStatus,
          },
        });

        const creditNoteAmounts = calculateCreditNoteAmounts({
          invoiceSubtotal: Number(invoice.subtotal),
          invoiceTax: Number(invoice.taxAmount),
          invoiceTotal: Number(invoice.total),
          refundTotal: amountCents / 100,
        });
        const creditNote = await tx.creditNote.create({
          data: {
            businessId,
            branchId: payment.branchId,
            invoiceId: invoice.id,
            refundId: refund.id,
            customerId: invoice.customerId,
            createdById: user.userId,
            creditNoteNumber: makeCreditNoteNumber(),
            reason: input.reason,
            subtotal: fromCents(toCents(creditNoteAmounts.subtotal)),
            taxableSubtotal: fromCents(toCents(creditNoteAmounts.taxableSubtotal)),
            taxAmount: fromCents(toCents(creditNoteAmounts.tax)),
            taxRate: invoice.taxRate,
            taxLabel: invoice.taxLabel,
            total: fromCents(toCents(creditNoteAmounts.total)),
            items: {
              create: {
                businessId,
                name: purchasedPackages.length
                  ? purchasedPackages.length === 1
                    ? `${purchasedPackages[0].package.name} refund`
                    : `${purchasedPackages.length} package purchases refund`
                  : `Refund for ${invoice.invoiceNumber}`,
                quantity: 1,
                unitPrice: fromCents(toCents(creditNoteAmounts.subtotal)),
                lineTotal: fromCents(toCents(creditNoteAmounts.subtotal)),
                taxable: creditNoteAmounts.tax > 0,
                taxRate: invoice.taxRate,
                taxAmount: fromCents(toCents(creditNoteAmounts.tax)),
              },
            },
          },
        });

        await writeAuditLog(
          {
            businessId,
            branchId: payment.branchId,
            actor: user,
            action: "PAYMENT_REFUNDED",
            entityType: "PaymentRefund",
            entityId: refund.id,
            summary: `Refunded RM${fromCents(amountCents)} from invoice ${invoice.invoiceNumber}`,
            before: {
              invoiceStatus: invoice.status,
              paidAmount: invoice.paidAmount,
              balance: invoice.balance,
              workOrderStatus: invoice.workOrder?.status ?? null,
              paymentStatus: invoice.workOrder?.paymentStatus ?? null,
              refundableAmount: fromCents(refundableCents),
            },
            after: {
              invoiceStatus: nextStatus,
              paidAmount: fromCents(nextPaidCents),
              balance: fromCents(nextBalanceCents),
              workOrderStatus: invoice.workOrder?.status ?? null,
              paymentStatus: nextStatus,
              creditNoteNumber: creditNote.creditNoteNumber,
            },
            metadata: {
              originalPaymentId: payment.id,
              originalPaymentMethod: payment.method,
              refundMethod: input.method,
              refundReason: input.reason,
              refundReference: input.reference || null,
              packageUsesRestored,
            },
            request: auditRequest,
          },
          tx,
        );

        return {
          invoiceId: invoice.id,
          workOrderId: invoice.workOrderId,
          customerId: invoice.customerId ?? invoice.workOrder?.customerId ?? null,
          creditNoteNumber: creditNote.creditNoteNumber,
        };
      },
      { isolationLevel: "Serializable" },
    );

    revalidatePath("/closing");
    revalidatePath("/dashboard");
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${result.invoiceId}`);
    revalidatePath("/loyalty");
    if (result.customerId) {
      revalidatePath(`/crm/customers/${result.customerId}`);
    }
    revalidatePath("/reports");
    revalidatePath("/work-orders");
    if (result.workOrderId) {
      revalidatePath(`/work-orders/${result.workOrderId}`);
    }

    return {
      status: "success",
      message: `Refund recorded. Credit Note ${result.creditNoteNumber} created.`,
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Unable to process refund.",
    };
  }
}

export async function voidInvoiceAction(
  _previousState: VoidInvoiceState,
  formData: FormData,
): Promise<VoidInvoiceState> {
  const { businessId, user } = await requireBusinessUser();
  const auditRequest = await getAuditRequestContext();
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
      if (!invoice.workOrder) {
        throw new Error("Package invoices cannot be voided from this screen yet.");
      }

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
          refunds: {
            select: { id: true },
          },
        },
      });

      if (activePayments.some((payment) => payment.refunds.length > 0)) {
        throw new Error(
          "This invoice has refund records and can no longer be voided.",
        );
      }

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
        where: { id: invoice.workOrder.id },
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

      await writeAuditLog(
        {
          businessId,
          branchId: invoice.branchId,
          actor: user,
          action: "INVOICE_VOIDED",
          entityType: "Invoice",
          entityId: invoice.id,
          summary: `Voided invoice ${invoice.invoiceNumber}`,
          before: {
            invoiceStatus: invoice.status,
            paidAmount: invoice.paidAmount,
            balance: invoice.balance,
            workOrderStatus: invoice.workOrder.status,
            paymentStatus: invoice.workOrder.paymentStatus,
          },
          after: {
            invoiceStatus: "VOID",
            paidAmount: 0,
            balance: invoice.total,
            workOrderStatus:
              invoice.workOrder.status === "COMPLETED"
                ? "READY_FOR_PICKUP"
                : invoice.workOrder.status,
            paymentStatus: "UNPAID",
          },
          metadata: {
            voidReason,
            voidedPaymentCount: activePayments.length,
          },
          request: auditRequest,
        },
        tx,
      );

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
