"use server";

import { FinancialOperationType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { authorizedOperationalBranchWhere } from "@/lib/branches";
import { makeCreditNoteNumber } from "@/lib/invoices/credit-note-number";
import {
  restoreRedeemedLoyaltyPointsForRefund,
  reverseLoyaltyPointsForRefund,
} from "@/lib/loyalty/service";
import { clearCustomerPackageServiceBalances } from "@/lib/packages/service-balances";
import { calculateCreditNoteAmounts } from "@/lib/tax/calculator";
import {
  getRefundableCents,
} from "@/lib/refunds/rules";
import { reconcileInvoiceSettlementAfterRefund } from "@/lib/invoices/refund-settlement-service";
import { recordRefundInventory, recordVoidInventoryReversals } from "@/lib/inventory/service";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";
import { fromCents, toCents } from "@/lib/validation/pos";
import {
  financialOperationKeySchema,
  runFinancialOperation,
} from "@/lib/financial-idempotency";
import { assertCashierShiftAcceptsActivity } from "@/lib/closing/shift-control";

export type VoidInvoiceState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type RefundPaymentState = {
  status: "idle" | "success" | "error";
  message: string;
};

const refundPaymentSchema = z.object({
  operationId: financialOperationKeySchema,
  invoiceId: z.string().uuid("Invoice is required."),
  paymentId: z.string().uuid("Payment is required."),
  amount: z.coerce.number().positive("Refund amount must be more than 0."),
  method: z.enum([
    "CASH",
    "CARD",
    "DUITNOW",
    "EWALLET",
    "BANK_TRANSFER",
    "FOREIGN_CURRENCY",
    "CRYPTO",
    "PACKAGE",
  ]),
  reason: z.string().trim().min(3, "Please enter a clear refund reason."),
  reference: z.string().trim().optional(),
});

export async function refundPaymentAction(
  _previousState: RefundPaymentState,
  formData: FormData,
): Promise<RefundPaymentState> {
  const { businessId, user } = await requireBusinessUser("PROCESS_REFUND");
  const auditRequest = await getAuditRequestContext();

  if (user.role !== "BUSINESS_OWNER") {
    return {
      status: "error",
      message: "Only the business owner can process refunds.",
    };
  }

  const refundStockLines = formData.getAll("refundItemId").flatMap((entry) => {
    const invoiceItemId = entry.toString();
    const quantity = Number(formData.get(`refundQuantity_${invoiceItemId}`) ?? 0);
    if (!Number.isInteger(quantity) || quantity <= 0) return [];
    const disposition = formData.get(`refundDisposition_${invoiceItemId}`) === "NO_RESTOCK"
      ? "NO_RESTOCK" as const
      : "RESTOCK" as const;
    return [{
      disposition,
      invoiceItemId,
      noRestockReason: formData.get(`refundNoRestockReason_${invoiceItemId}`)?.toString() || null,
      quantity,
    }];
  });
  const parsed = refundPaymentSchema.safeParse({
    operationId: formData.get("operationId"),
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
  const operationalBranchWhere = authorizedOperationalBranchWhere(user);
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
    const { operationId, ...financialPayload } = input;
    const { result } = await runFinancialOperation({
      actorUserId: user.userId,
      branchId: null,
      businessId,
      operationKey: operationId,
      operationType: FinancialOperationType.PAYMENT_REFUND,
      payload: { ...financialPayload, refundStockLines },
      execute: async (tx) => {
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
        const shiftActivity = await assertCashierShiftAcceptsActivity(tx, {
          businessId,
          shift,
        });

        const invoice = await tx.invoice.findFirst({
          where: {
            id: input.invoiceId,
            businessId,
            ...operationalBranchWhere,
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
        const inventoryEnabled = await isBusinessModuleEnabled(businessId, "INVENTORY", { database: tx });
        const hasTrackedProducts = invoice.items.some((item) => item.inventoryTracked);
        if (inventoryEnabled && hasTrackedProducts && refundStockLines.length === 0) {
          throw new Error("Choose a refund quantity and RESTOCK or NO RESTOCK for the returned product.");
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
              customerPackageServiceBalance: true,
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

        const isStandalonePackagePurchase =
          !invoice.workOrder && !invoice.appointmentId && purchasedPackages.length > 0;
        if (isStandalonePackagePurchase) {
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

            if (payment.customerPackageServiceBalance) {
              const serviceBalance = payment.customerPackageServiceBalance;
              await tx.customerPackageServiceBalance.update({
                where: { id: serviceBalance.id },
                data: {
                  remainingUses: Math.min(
                    serviceBalance.totalUses,
                    serviceBalance.remainingUses + packageUsesRestored,
                  ),
                },
              });
            }
          }

        const refund = await tx.paymentRefund.create({
          data: {
            businessId,
            branchId: payment.branchId,
            paymentId: payment.id,
            workOrderId: invoice.workOrderId,
            invoiceId: invoice.id,
            processedById: user.userId,
            refundedAt: shiftActivity.activityAt,
            shiftId: shift.id,
            amount: fromCents(amountCents),
            method: input.method,
            tenderCurrency: input.method === payment.method ? payment.tenderCurrency : "MYR",
            tenderAmount: input.method === payment.method && payment.tenderAmount
              ? Number(payment.tenderAmount) * (amountCents / toCents(payment.amount))
              : fromCents(amountCents),
            exchangeRateToMyr: input.method === payment.method && payment.exchangeRateToMyr
              ? payment.exchangeRateToMyr
              : 1,
            reason: input.reason,
            reference: input.reference || null,
            packageUsesRestored,
          },
        });

        if (inventoryEnabled && refundStockLines.length > 0) {
          const refundBranchId = payment.branchId ?? invoice.branchId;
          if (!refundBranchId) throw new Error("Refund inventory branch is required.");
          await recordRefundInventory(tx, {
            actorUserId: user.userId,
            branchId: refundBranchId,
            businessId,
            lines: refundStockLines,
            paymentRefundId: refund.id,
          });
        }

        if (!invoice.workOrder && !invoice.appointmentId && purchasedPackages.length) {
          await tx.customerPackage.updateMany({
            where: { id: { in: purchasedPackages.map((item) => item.id) } },
            data: {
              status: "CANCELLED",
              remainingUses: 0,
              },
            });
            await clearCustomerPackageServiceBalances(
              tx,
              purchasedPackages.map((customerPackage) => customerPackage.id),
            );
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

        const settlement = await reconcileInvoiceSettlementAfterRefund(tx, {
          businessId,
          invoiceId: invoice.id,
          totalCents: toCents(invoice.total),
          workOrderId: invoice.workOrderId,
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
                name: payment.method === "PACKAGE"
                  ? "Package use restored"
                  : !invoice.appointmentId && purchasedPackages.length
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
              invoiceStatus: settlement.status,
              paidAmount: fromCents(settlement.settledObligationCents),
              balance: fromCents(settlement.outstandingCents),
              workOrderStatus: invoice.workOrder?.status ?? null,
              paymentStatus: settlement.status,
              refundLifecycle: settlement.refundLifecycle,
              refundedAmount: fromCents(settlement.refundedCents),
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
          appointmentId: invoice.appointmentId,
          workOrderId: invoice.workOrderId,
          customerId: invoice.customerId ?? invoice.workOrder?.customerId ?? null,
          creditNoteNumber: creditNote.creditNoteNumber,
        };
      },
    });

    revalidatePath("/closing");
    revalidatePath("/dashboard");
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${result.invoiceId}`);
    revalidatePath("/appointments");
    if (result.appointmentId) {
      revalidatePath(`/appointments/${result.appointmentId}`);
    }
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
  const { businessId, user } = await requireBusinessUser("PROCESS_REFUND");
  const auditRequest = await getAuditRequestContext();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const operationalBranchWhere = authorizedOperationalBranchWhere(user);
  const voidReason = String(formData.get("voidReason") ?? "").trim();
  const operationId = financialOperationKeySchema.safeParse(
    formData.get("operationId"),
  );

  if (!operationId.success) {
    return {
      status: "error",
      message: operationId.error.issues[0]?.message ?? "Invalid operation ID.",
    };
  }

  if (!voidReason) {
    return {
      status: "error",
      message: "Please enter a reason before voiding this invoice.",
    };
  }

  try {
    const { result } = await runFinancialOperation({
      actorUserId: user.userId,
      branchId: null,
      businessId,
      operationKey: operationId.data,
      operationType: FinancialOperationType.INVOICE_VOID,
      payload: { invoiceId, voidReason },
      execute: async (tx) => {
      const invoice = await tx.invoice.findFirstOrThrow({
        where: {
          id: invoiceId,
          businessId,
          ...operationalBranchWhere,
        },
        include: {
          workOrder: true,
          appointment: true,
          items: {
            select: {
              productId: true,
            },
          },
        },
      });
      if (!invoice.workOrder && !invoice.appointment) {
        throw new Error(
          "Product sales and package purchases must be refunded instead of voided.",
        );
      }

      if (
        invoice.appointment &&
        (invoice.customerPackageId || invoice.items.some((item) => item.productId))
      ) {
        throw new Error(
          "Invoices containing products or package purchases must be refunded instead of voided.",
        );
      }

      if (invoice.status === "VOID") {
        throw new Error("This invoice is already void.");
      }

      if (invoice.status === "REFUNDED") {
        throw new Error("Refunded invoices cannot be voided.");
      }

      const activePayments = await tx.payment.findMany({
        where: {
          businessId,
          status: "ACTIVE",
          OR: [
            { invoiceId: invoice.id },
            ...(invoice.workOrderId
              ? [{ workOrderId: invoice.workOrderId }]
              : []),
            ...(invoice.appointmentId
              ? [{ appointmentId: invoice.appointmentId }]
              : []),
          ],
        },
          include: {
            customerPackage: true,
            customerPackageServiceBalance: true,
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

      await recordVoidInventoryReversals(tx, {
        actorUserId: user.userId,
        businessId,
        invoiceId: invoice.id,
        reason: `Invoice void: ${voidReason}`,
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

            if (payment.customerPackageServiceBalance) {
              const serviceBalance = payment.customerPackageServiceBalance;
              await tx.customerPackageServiceBalance.update({
                where: { id: serviceBalance.id },
                data: {
                  remainingUses: Math.min(
                    serviceBalance.totalUses,
                    serviceBalance.remainingUses + payment.packageUses,
                  ),
                },
              });
            }
          }
      }

      await tx.payment.updateMany({
        where: {
          businessId,
          status: "ACTIVE",
          OR: [
            { invoiceId: invoice.id },
            ...(invoice.workOrderId
              ? [{ workOrderId: invoice.workOrderId }]
              : []),
            ...(invoice.appointmentId
              ? [{ appointmentId: invoice.appointmentId }]
              : []),
          ],
        },
        data: {
          status: "VOID",
          voidedAt: new Date(),
          voidReason,
        },
      });

      if (invoice.workOrder) {
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
      }

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
            workOrderStatus: invoice.workOrder?.status ?? null,
            paymentStatus: invoice.workOrder?.paymentStatus ?? null,
            appointmentStatus: invoice.appointment?.status ?? null,
          },
          after: {
            invoiceStatus: "VOID",
            paidAmount: 0,
            balance: invoice.total,
            workOrderStatus: invoice.workOrder
              ? invoice.workOrder.status === "COMPLETED"
                ? "READY_FOR_PICKUP"
                : invoice.workOrder.status
              : null,
            paymentStatus: invoice.workOrder ? "UNPAID" : null,
            appointmentStatus: invoice.appointment?.status ?? null,
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
        appointmentId: invoice.appointmentId,
      };
      },
    });

    revalidatePath("/dashboard");
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${result.invoiceId}`);
    revalidatePath("/pos");
    revalidatePath("/work-orders");
    if (result.workOrderId) {
      revalidatePath(`/pos/${result.workOrderId}`);
      revalidatePath(`/work-orders/${result.workOrderId}`);
    }
    if (result.appointmentId) {
      revalidatePath("/appointments");
      revalidatePath(`/appointments/${result.appointmentId}`);
    }

    return {
      status: "success",
      message: result.appointmentId
        ? "Invoice voided. The appointment is ready for payment correction."
        : "Invoice voided. Related payments were voided and the work order is open for POS correction.",
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
