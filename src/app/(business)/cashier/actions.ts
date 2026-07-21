"use server";

import { revalidatePath } from "next/cache";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { resolveOperationalBranchId } from "@/lib/branches";
import {
  calculateCatalogDiscountCents,
  formatCatalogDiscountValue,
  type CatalogDiscountOption,
} from "@/lib/catalog-discounts";
import { makeInvoiceNumber } from "@/lib/invoices/invoice-number";
import {
  activateCustomerPackageServiceBalances,
  createCustomerPackageServiceBalances,
} from "@/lib/packages/service-balances";
import { calculateLoyaltyRedemption } from "@/lib/loyalty/rules";
import {
  awardLoyaltyPointsForPayment,
  redeemLoyaltyPointsForPayment,
} from "@/lib/loyalty/service";
import { prisma } from "@/lib/prisma";
import { calculateTax } from "@/lib/tax/calculator";
import { cashierSaleSchema } from "@/lib/validation/cashier";
import { fromCents } from "@/lib/validation/pos";
import { sendInvoiceIfConnected } from "@/lib/whatsapp/invoice-notifications";

export type CashierSaleInvoiceSummary = {
  id: string;
  invoiceNumber: string;
  status: string;
  issuedAt: string;
  customerName: string;
  customerPhone: string;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  discountAmount: number;
  tipAmount: number;
  taxAmount: number;
  taxRate: number;
  taxLabel: string;
  total: number;
  paidAmount: number;
  balance: number;
};

export type CashierSaleState = {
  status: "idle" | "success" | "error";
  message: string;
  invoice: CashierSaleInvoiceSummary | null;
};

function mergeQuantities(ids: string[], quantities: number[]) {
  const merged = new Map<string, number>();

  ids.forEach((id, index) => {
    merged.set(id, (merged.get(id) ?? 0) + quantities[index]);
  });

  return merged;
}

export async function completeCashierSaleAction(formData: FormData): Promise<CashierSaleState> {
  const { businessId, user } = await requireBusinessUser();
  assertStaffPermission(user, "POS");

  const parsed = cashierSaleSchema.safeParse({
    branchId: formData.get("branchId")?.toString() || "",
    customerId: formData.get("customerId")?.toString() || "",
    method: formData.get("method")?.toString(),
    packageIds: formData.getAll("packageId").map((value) => value.toString()),
    packageQuantities: formData.getAll("packageQuantity"),
    productIds: formData.getAll("productId").map((value) => value.toString()),
    productQuantities: formData.getAll("productQuantity"),
    serviceIds: formData.getAll("serviceId").map((value) => value.toString()),
    serviceQuantities: formData.getAll("serviceQuantity"),
    reference: formData.get("reference")?.toString() || undefined,
    discountType: formData.get("discountType")?.toString() || "AMOUNT",
    discountValue: formData.get("discountValue")?.toString() || "0",
    discountReference: formData.get("discountReference")?.toString() || undefined,
    catalogDiscountId: formData.get("catalogDiscountId")?.toString() || undefined,
    loyaltyPoints: formData.get("loyaltyPoints")?.toString() || "0",
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Cashier sale details are invalid.",
      invoice: null,
    };
  }

  const input = parsed.data;
  const auditRequest = await getAuditRequestContext();

  try {
    const branchId = await resolveOperationalBranchId(
      businessId,
      user,
      input.branchId || null,
    );

    if (!branchId) {
      throw new Error("An active branch is required before completing a sale.");
    }

    const result = await prisma.$transaction(async (tx) => {
      const shift = await tx.cashierShift.findFirst({
        where: { businessId, cashierId: user.userId, status: "OPEN" },
        select: { id: true, branchId: true },
      });

      if (!shift) {
        throw new Error("Start a cashier shift before completing a sale.");
      }

      if (shift.branchId !== branchId) {
        throw new Error("This sale does not belong to the current shift branch.");
      }

      const customer = input.customerId
        ? await tx.customer.findFirst({
            where: { id: input.customerId, businessId },
            select: { id: true, name: true, phone: true },
          })
        : null;

      if (input.customerId && !customer) {
        throw new Error("Customer could not be found.");
      }

      if (input.packageIds.length && !customer) {
        throw new Error("Select a customer before selling a package.");
      }

      const packageQuantities = mergeQuantities(
        input.packageIds,
        input.packageQuantities,
      );
      const productQuantities = mergeQuantities(
        input.productIds,
        input.productQuantities,
      );
      const serviceQuantities = mergeQuantities(
        input.serviceIds,
        input.serviceQuantities,
      );
      const now = new Date();
      const [business, packageDefinitions, products, services, loyaltyProgram, membership, catalogDiscountRecord] = await Promise.all([
        tx.business.findUniqueOrThrow({
          where: { id: businessId },
          select: { sstEnabled: true, sstLabel: true, sstRate: true },
        }),
        tx.package.findMany({
          where: {
            id: { in: [...packageQuantities.keys()] },
            businessId,
            status: "ACTIVE",
          },
          include: {
            service: { select: { taxable: true, taxRate: true } },
            serviceBenefits: { select: { serviceId: true, totalUses: true } },
          },
        }),
        tx.product.findMany({
          where: {
            id: { in: [...productQuantities.keys()] },
            businessId,
            status: "ACTIVE",
          },
        }),
        tx.service.findMany({
          where: {
            id: { in: [...serviceQuantities.keys()] },
            businessId,
            status: "ACTIVE",
            OR: [{ branchId: null }, { branchId }],
          },
        }),
        tx.loyaltyProgram.findUnique({
          where: { businessId },
          select: {
            enabled: true,
            redemptionEnabled: true,
            redemptionPointsPerRinggit: true,
            minimumRedemptionPoints: true,
          },
        }),
        customer
          ? tx.customerMembership.findFirst({
              where: { businessId, customerId: customer.id, status: "ACTIVE" },
              select: { pointsBalance: true },
            })
          : Promise.resolve(null),
        input.catalogDiscountId
          ? tx.catalogDiscount.findFirst({
              where: {
                id: input.catalogDiscountId,
                businessId,
                active: true,
                OR: [{ branchId: null }, { branchId }],
                AND: [
                  { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                  { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
                ],
              },
              select: {
                id: true,
                name: true,
                discountType: true,
                percentage: true,
                fixedAmount: true,
                scope: true,
                minimumSpend: true,
                maximumDiscount: true,
                allowLoyaltyStacking: true,
              },
            })
          : Promise.resolve(null),
      ]);

      if (input.catalogDiscountId && !catalogDiscountRecord) {
        throw new Error("This catalog discount is no longer available for this branch.");
      }

      if (packageDefinitions.length !== packageQuantities.size) {
        throw new Error("One of the selected packages is no longer available.");
      }

      if (products.length !== productQuantities.size) {
        throw new Error("One of the selected products is no longer available.");
      }

      if (services.length !== serviceQuantities.size) {
        throw new Error("One of the selected services is no longer available.");
      }

      const packageById = new Map(
        packageDefinitions.map((packageDefinition) => [packageDefinition.id, packageDefinition]),
      );
      const productById = new Map(products.map((product) => [product.id, product]));
      const serviceById = new Map(services.map((service) => [service.id, service]));
      const packageUnits = [...packageQuantities].flatMap(([packageId, quantity]) => {
        const packageDefinition = packageById.get(packageId);
        if (!packageDefinition) {
          throw new Error("One of the selected packages is no longer available.");
        }
        return Array.from({ length: quantity }, () => packageDefinition);
      });
      const productLines = [...productQuantities].map(([productId, quantity]) => {
        const product = productById.get(productId);
        if (!product) {
          throw new Error("One of the selected products is no longer available.");
        }
        return { product, quantity };
      });
      const serviceLines = [...serviceQuantities].map(([serviceId, quantity]) => {
        const service = serviceById.get(serviceId);
        if (!service) {
          throw new Error("One of the selected services is no longer available.");
        }
        return { service, quantity };
      });
      const stocks = await Promise.all(
        productLines.map(async ({ product, quantity }) => {
          const stock = await tx.productStock.findUnique({
            where: { branchId_productId: { branchId, productId: product.id } },
          });
          if (!stock || stock.quantity < quantity) {
            throw new Error(`Not enough stock for ${product.name}.`);
          }
          return { product, quantity, stock };
        }),
      );
      const productTotals = stocks.map(
        ({ product, quantity }) => Number(product.price) * quantity,
      );
      const serviceTotals = serviceLines.map(
        ({ service, quantity }) => Number(service.price) * quantity,
      );
      const subtotalCents = Math.round(
        (productTotals.reduce((sum, value) => sum + value, 0) +
          serviceTotals.reduce((sum, value) => sum + value, 0) +
          packageUnits.reduce(
            (sum, packageDefinition) => sum + Number(packageDefinition.price),
            0,
          )) *
          100,
      );
      const catalogDiscount = catalogDiscountRecord
        ? {
            id: catalogDiscountRecord.id,
            name: catalogDiscountRecord.name,
            discountType: catalogDiscountRecord.discountType,
            percentage: catalogDiscountRecord.percentage == null ? null : Number(catalogDiscountRecord.percentage),
            fixedAmount: catalogDiscountRecord.fixedAmount == null ? null : Number(catalogDiscountRecord.fixedAmount),
            scope: catalogDiscountRecord.scope,
            minimumSpend: Number(catalogDiscountRecord.minimumSpend),
            maximumDiscount: catalogDiscountRecord.maximumDiscount == null
              ? null
              : Number(catalogDiscountRecord.maximumDiscount),
            allowLoyaltyStacking: catalogDiscountRecord.allowLoyaltyStacking,
          } satisfies CatalogDiscountOption
        : null;
      const requestedManualDiscountCents = catalogDiscount
        ? calculateCatalogDiscountCents({
            discount: catalogDiscount,
            lines: [
              ...productTotals.map((total) => ({ lineTotalCents: Math.round(total * 100), type: "product" as const })),
              ...serviceTotals.map((total) => ({ lineTotalCents: Math.round(total * 100), type: "service" as const })),
              ...packageUnits.map((item) => ({
                lineTotalCents: Math.round(Number(item.price) * 100),
                type: "package" as const,
              })),
            ],
          })
        : input.discountType === "PERCENT"
          ? Math.round((subtotalCents * input.discountValue) / 100)
          : Math.round(input.discountValue * 100);
      const manualDiscountCents = Math.min(subtotalCents, requestedManualDiscountCents);

      if (catalogDiscount && manualDiscountCents <= 0) {
        throw new Error("This catalog discount does not apply to the current sale.");
      }

      if (catalogDiscount && input.loyaltyPoints > 0 && !catalogDiscount.allowLoyaltyStacking) {
        throw new Error("This catalog discount cannot be combined with loyalty points.");
      }

      const discountReason = catalogDiscount
        ? `Catalog: ${catalogDiscount.name} (${formatCatalogDiscountValue(catalogDiscount)}) · Reference: ${input.discountReference}`
        : input.discountReference ?? null;
      let loyaltyPointsRedeemed = 0;
      let loyaltyDiscountCents = 0;

      if (input.loyaltyPoints > 0) {
        if (!customer) {
          throw new Error("Select a customer before redeeming loyalty points.");
        }
        if (!loyaltyProgram?.enabled || !loyaltyProgram.redemptionEnabled) {
          throw new Error("Loyalty point redemption is not enabled.");
        }
        if (!membership) {
          throw new Error("This customer does not have an active loyalty membership.");
        }

        const redemption = calculateLoyaltyRedemption({
          availablePoints: membership.pointsBalance,
          maximumDiscountCents: Math.max(0, subtotalCents - manualDiscountCents),
          minimumPoints: loyaltyProgram.minimumRedemptionPoints,
          pointsPerRinggit: loyaltyProgram.redemptionPointsPerRinggit,
          requestedPoints: input.loyaltyPoints,
        });
        loyaltyPointsRedeemed = redemption.points;
        loyaltyDiscountCents = redemption.discountCents;
      }

      const totalDiscountCents = manualDiscountCents + loyaltyDiscountCents;
      const tax = calculateTax({
        sstEnabled: business.sstEnabled,
        sstLabel: business.sstLabel,
        sstRate: Number(business.sstRate),
        lines: [
          ...stocks.map(({ product }, index) => ({
            lineTotal: productTotals[index],
            taxable: product.taxable,
            taxRate: product.taxRate == null ? null : Number(product.taxRate),
          })),
          ...packageUnits.map((packageDefinition) => ({
            lineTotal: Number(packageDefinition.price),
            taxable: packageDefinition.service?.taxable ?? true,
            taxRate:
              packageDefinition.service?.taxRate == null
                ? null
                : Number(packageDefinition.service.taxRate),
          })),
          ...serviceLines.map(({ service }, index) => ({
            lineTotal: serviceTotals[index],
            taxable: service.taxable,
            taxRate: service.taxRate == null ? null : Number(service.taxRate),
          })),
        ],
        discount: totalDiscountCents / 100,
      });
      const customerPackages: Array<{ id: string }> = [];

      if (customer) {
        for (const packageDefinition of packageUnits) {
          const customerPackage = await tx.customerPackage.create({
              data: {
                businessId,
                branchId,
                customerId: customer.id,
                packageId: packageDefinition.id,
                purchasePrice: packageDefinition.price,
                totalUses: packageDefinition.totalUses,
                eligibleVehicleSize: packageDefinition.eligibleVehicleSize,
                remainingUses: 0,
                status: "PENDING_PAYMENT",
              },
            });
          await createCustomerPackageServiceBalances(tx, {
            businessId,
            customerPackageId: customerPackage.id,
            packagePlan: packageDefinition,
            active: false,
          });
          customerPackages.push(customerPackage);
        }
      }

      const primaryCustomerPackage = customerPackages[0] ?? null;
      const amountCents = Math.round(tax.total * 100);
      const invoice = await tx.invoice.create({
        data: {
          businessId,
          branchId,
          customerId: customer?.id ?? null,
          customerPackageId: primaryCustomerPackage?.id ?? null,
          invoiceNumber: makeInvoiceNumber(),
          subtotal: fromCents(Math.round(tax.subtotal * 100)),
          taxableSubtotal: fromCents(Math.round(tax.taxableSubtotal * 100)),
          taxAmount: fromCents(Math.round(tax.tax * 100)),
          taxRate: fromCents(Math.round(tax.taxRate * 100)),
          taxLabel: tax.tax > 0 ? tax.taxLabel : null,
          discountAmount: fromCents(totalDiscountCents),
          discountReason:
            manualDiscountCents > 0 ? discountReason : null,
          loyaltyPointsRedeemed,
          loyaltyDiscountAmount: fromCents(loyaltyDiscountCents),
          total: fromCents(amountCents),
          paidAmount: fromCents(amountCents),
          balance: "0.00",
          status: "PAID",
          items: {
            create: [
              ...stocks.map(({ product, quantity }, index) => ({
                businessId,
                productId: product.id,
                name: product.name,
                quantity,
                unitPrice: product.price,
                lineTotal: fromCents(Math.round(productTotals[index] * 100)),
                taxable: product.taxable,
                taxRate: fromCents(
                  Math.round(
                    (product.taxable
                      ? Number(product.taxRate ?? business.sstRate)
                      : 0) * 100,
                  ),
                ),
                taxAmount: fromCents(Math.round(tax.lineTax[index] * 100)),
              })),
              ...packageUnits.map((packageDefinition, index) => ({
                businessId,
                customerPackageId: customerPackages[index].id,
                serviceId: packageDefinition.serviceId,
                name: packageDefinition.name,
                quantity: 1,
                unitPrice: packageDefinition.price,
                lineTotal: packageDefinition.price,
                taxable: packageDefinition.service?.taxable ?? true,
                taxRate: fromCents(
                  Math.round(
                    ((packageDefinition.service?.taxable ?? true)
                      ? Number(packageDefinition.service?.taxRate ?? business.sstRate)
                      : 0) * 100,
                  ),
                ),
                taxAmount: fromCents(
                  Math.round(tax.lineTax[stocks.length + index] * 100),
                ),
              })),
              ...serviceLines.map(({ service, quantity }, index) => ({
                businessId,
                serviceId: service.id,
                name: service.name,
                quantity,
                unitPrice: service.price,
                lineTotal: fromCents(Math.round(serviceTotals[index] * 100)),
                taxable: service.taxable,
                taxRate: fromCents(
                  Math.round(
                    (service.taxable
                      ? Number(service.taxRate ?? business.sstRate)
                      : 0) * 100,
                  ),
                ),
                taxAmount: fromCents(
                  Math.round(tax.lineTax[stocks.length + packageUnits.length + index] * 100),
                ),
              })),
            ],
          },
        },
      });
      const payment = await tx.payment.create({
        data: {
          businessId,
          branchId,
          cashierId: user.userId,
          shiftId: shift.id,
          invoiceId: invoice.id,
          customerPackageId: primaryCustomerPackage?.id ?? null,
          amount: fromCents(amountCents),
          method: input.method,
          reference:
            input.reference ||
            `${stocks.length} product lines, ${serviceLines.length} service lines, ${packageUnits.length} packages`,
        },
      });

      for (const { stock, quantity } of stocks) {
        const updated = await tx.productStock.updateMany({
          where: { id: stock.id, quantity: { gte: quantity } },
          data: { quantity: { decrement: quantity } },
        });
        if (updated.count !== 1) {
          throw new Error(`Not enough stock for ${productById.get(stock.productId)?.name ?? "product"}.`);
        }
      }

      await Promise.all(
        customerPackages.map(async (customerPackage, index) => {
          await tx.customerPackage.update({
            where: { id: customerPackage.id },
            data: {
              remainingUses: packageUnits[index].totalUses,
              status: "ACTIVE",
            },
          });
          await activateCustomerPackageServiceBalances(tx, customerPackage.id);
        }),
      );

      if (customer) {
        if (loyaltyPointsRedeemed > 0) {
          await redeemLoyaltyPointsForPayment(tx, {
            businessId,
            branchId,
            customerId: customer.id,
            paymentId: payment.id,
            points: loyaltyPointsRedeemed,
            createdById: user.userId,
          });
        }
        await awardLoyaltyPointsForPayment(tx, {
          businessId,
          branchId,
          customerId: customer.id,
          paymentId: payment.id,
          amountCents,
          paymentMethod: payment.method,
          createdById: user.userId,
        });
      }

      await writeAuditLog(
        {
          businessId,
          branchId,
          actor: user,
          action: "CASHIER_SALE_PAID",
          entityType: "Payment",
          entityId: payment.id,
          summary: `Completed cashier sale with ${stocks.length} product lines, ${serviceLines.length} service lines, and ${packageUnits.length} packages`,
          after: {
            amount: payment.amount,
            method: payment.method,
            invoiceId: invoice.id,
            productLines: stocks.map(({ product, quantity }) => ({
              productId: product.id,
              quantity,
            })),
            serviceLines: serviceLines.map(({ service, quantity }) => ({
              serviceId: service.id,
              quantity,
            })),
            customerPackageIds: customerPackages.map((item) => item.id),
            manualDiscount: fromCents(manualDiscountCents),
            catalogDiscountId: catalogDiscount?.id ?? null,
            discountReference: input.discountReference ?? null,
            loyaltyPointsRedeemed,
            loyaltyDiscount: fromCents(loyaltyDiscountCents),
          },
          metadata: { customerId: customer?.id ?? null },
          request: auditRequest,
        },
        tx,
      );

      return {
        customerId: customer?.id ?? null,
        customerPackageIds: customerPackages.map((item) => item.id),
        invoiceId: invoice.id,
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
          issuedAt: invoice.issuedAt.toISOString(),
          customerName: customer?.name ?? "Walk-in customer",
          customerPhone: customer?.phone ?? "Not provided",
          items: [
            ...stocks.map(({ product, quantity }, index) => ({
              id: `${invoice.id}-product-${product.id}`,
              name: product.name,
              quantity,
              unitPrice: Number(product.price),
              lineTotal: productTotals[index],
            })),
            ...packageUnits.map((packageDefinition, index) => ({
              id: `${invoice.id}-package-${index}`,
              name: packageDefinition.name,
              quantity: 1,
              unitPrice: Number(packageDefinition.price),
              lineTotal: Number(packageDefinition.price),
            })),
            ...serviceLines.map(({ service, quantity }, index) => ({
              id: `${invoice.id}-service-${service.id}`,
              name: service.name,
              quantity,
              unitPrice: Number(service.price),
              lineTotal: serviceTotals[index],
            })),
          ],
          subtotal: tax.subtotal,
          discountAmount: totalDiscountCents / 100,
          tipAmount: 0,
          taxAmount: tax.tax,
          taxRate: tax.taxRate,
          taxLabel: tax.taxLabel,
          total: tax.total,
          paidAmount: tax.total,
          balance: 0,
        },
      };
    });

    if (result.customerId) {
      await sendInvoiceIfConnected({
        businessId,
        invoiceId: result.invoiceId,
        sentByUserId: user.userId,
      });
      revalidatePath(`/crm/customers/${result.customerId}`);
    }

    revalidatePath("/cashier");
    revalidatePath("/products");
    revalidatePath("/services");
    revalidatePath("/packages");
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${result.invoiceId}`);
    revalidatePath("/reports");
    revalidatePath("/dashboard");
    revalidatePath("/closing");
    result.customerPackageIds.forEach((customerPackageId) => {
      revalidatePath(`/pos/packages/${customerPackageId}`);
    });

    return {
      status: "success",
      message: "Sale completed successfully.",
      invoice: result.invoice,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to complete cashier sale.",
      invoice: null,
    };
  }
}
