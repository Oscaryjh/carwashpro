"use server";

import type { Payment } from "@prisma/client";
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
  packageVoucherAmount: number;
  cashPaidAmount: number;
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
    appointmentId: formData.get("appointmentId")?.toString() || "",
    assignedStaffId: formData.get("assignedStaffId")?.toString() || "",
    customerId: formData.get("customerId")?.toString() || "",
    method: formData.get("method")?.toString(),
    packageIds: formData.getAll("packageId").map((value) => value.toString()),
    packageQuantities: formData.getAll("packageQuantity"),
    productIds: formData.getAll("productId").map((value) => value.toString()),
    productQuantities: formData.getAll("productQuantity"),
    serviceIds: formData.getAll("serviceId").map((value) => value.toString()),
    serviceQuantities: formData.getAll("serviceQuantity"),
    customerPackageIds: formData.getAll("customerPackageId").map((value) => value.toString()),
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

      const appointment = input.appointmentId
        ? await tx.appointment.findFirst({
            where: { id: input.appointmentId, businessId },
            select: {
              id: true,
              branchId: true,
              customerId: true,
              assignedStaffId: true,
              status: true,
              invoice: { select: { id: true } },
            },
          })
        : null;

      if (input.appointmentId && !appointment) {
        throw new Error("Appointment could not be found.");
      }

      if (appointment && appointment.status !== "COMPLETED") {
        throw new Error("Complete the appointment before checkout.");
      }

      if (appointment?.invoice) {
        throw new Error("This appointment already has an invoice.");
      }

      if (appointment?.branchId && appointment.branchId !== branchId) {
        throw new Error("Start a cashier shift for the appointment branch before checkout.");
      }

      if (appointment && input.customerId !== appointment.customerId) {
        throw new Error("This sale must use the appointment customer.");
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

      if (input.serviceIds.length && !customer) {
        throw new Error("Select a customer before selling a service.");
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
      const [
        business,
        packageDefinitions,
        products,
        services,
        loyaltyProgram,
        membership,
        catalogDiscountRecord,
        redeemedPackageBalances,
      ] = await Promise.all([
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
        input.customerPackageIds.length && customer
          ? tx.customerPackageServiceBalance.findMany({
              where: {
                businessId,
                id: { in: [...new Set(input.customerPackageIds)] },
                remainingUses: { gt: 0 },
                customerPackage: {
                  customerId: customer.id,
                  status: "ACTIVE",
                  OR: [{ branchId: null }, { branchId }],
                  package: { status: "ACTIVE" },
                },
              },
              include: {
                customerPackage: { include: { package: true } },
                service: true,
              },
              orderBy: [{ customerPackage: { purchasedAt: "asc" } }, { createdAt: "asc" }],
            })
          : Promise.resolve([]),
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

      if (redeemedPackageBalances.length !== new Set(input.customerPackageIds).size) {
        throw new Error("This customer package is no longer available.");
      }

      const packageById = new Map(
        packageDefinitions.map((packageDefinition) => [packageDefinition.id, packageDefinition]),
      );
      const productById = new Map(products.map((product) => [product.id, product]));
      const serviceById = new Map(services.map((service) => [service.id, service]));
      const redeemedPackageByServiceId = new Map<
        string,
        typeof redeemedPackageBalances[number]
      >();
      for (const balance of redeemedPackageBalances) {
        if (!serviceQuantities.has(balance.serviceId)) {
          throw new Error("This package cannot be used for the selected services.");
        }
        if (redeemedPackageByServiceId.has(balance.serviceId)) {
          throw new Error("Only one package can be used for each service.");
        }
        redeemedPackageByServiceId.set(balance.serviceId, balance);
      }
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
      const assignedStaff = serviceLines.length && input.assignedStaffId
        ? await tx.user.findFirst({
            where: {
              id: input.assignedStaffId,
              businessId,
              ...(appointment?.assignedStaffId === input.assignedStaffId
                ? {}
                : {
                    status: "active",
                    appointmentBookable: true,
                    OR: [
                      { branchId },
                      {
                        employeeAccount: {
                          memberships: {
                            some: {
                              businessId,
                              status: "ACTIVE",
                              branchAssignments: { some: { businessId, branchId } },
                            },
                          },
                        },
                      },
                    ],
                  }),
            },
            select: {
              id: true,
              serviceStaffAssignments: {
                where: { serviceId: { in: serviceLines.map(({ service }) => service.id) } },
                select: { serviceId: true },
              },
            },
          })
        : null;

      if (serviceLines.length && !assignedStaff) {
        throw new Error("Select an available staff member for the service.");
      }

      if (appointment?.assignedStaffId && appointment.assignedStaffId !== assignedStaff?.id) {
        throw new Error("This sale must use the appointment staff member.");
      }

      if (assignedStaff) {
        const restrictedServices = await tx.service.findMany({
          where: {
            id: { in: serviceLines.map(({ service }) => service.id) },
            businessId,
            staffAssignments: { some: {} },
          },
          select: { id: true, name: true },
        });
        const supportedServiceIds = new Set(
          assignedStaff.serviceStaffAssignments.map((assignment) => assignment.serviceId),
        );
        const unsupportedService = restrictedServices.find(
          (service) => !supportedServiceIds.has(service.id),
        );
        if (unsupportedService) {
          throw new Error(`The selected staff member is not assigned to ${unsupportedService.name}.`);
        }
      }

      let effectiveAppointmentId = appointment?.id ?? null;
      if (appointment && assignedStaff && !appointment.assignedStaffId) {
        await tx.appointment.update({
          where: { id: appointment.id },
          data: { assignedStaffId: assignedStaff.id },
        });
      }

      if (!appointment && serviceLines.length) {
        const completedAt = new Date();
        const durationMinutes = Math.max(
          15,
          serviceLines.reduce(
            (sum, { service, quantity }) =>
              sum + Math.max(1, service.durationMinutes || 15) * quantity,
            0,
          ),
        );
        const scheduledAt = new Date(completedAt.getTime() - durationMinutes * 60_000);
        const createdAppointment = await tx.appointment.create({
          data: {
            businessId,
            branchId,
            customerId: customer!.id,
            createdById: user.userId,
            assignedStaffId: assignedStaff!.id,
            serviceId: serviceLines[0].service.id,
            serviceIds: serviceLines.flatMap(({ service, quantity }) =>
              Array.from({ length: quantity }, () => service.id),
            ),
            productIds: stocks.flatMap(({ product, quantity }) =>
              Array.from({ length: quantity }, () => product.id),
            ),
            packageIds: packageUnits.map((packageDefinition) => packageDefinition.id),
            scheduledAt,
            durationMinutes,
            status: "COMPLETED",
            startedAt: scheduledAt,
            completedAt,
          },
          select: { id: true },
        });
        effectiveAppointmentId = createdAppointment.id;
      }
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
      const packageCoverageByBalanceId = new Map<string, number>();
      let packageCoverageCents = 0;
      for (const balance of redeemedPackageBalances) {
        const serviceLineIndex = serviceLines.findIndex(
          ({ service }) => service.id === balance.serviceId,
        );
        if (serviceLineIndex < 0) {
          throw new Error("This package cannot be used for the selected services.");
        }

        const quantity = serviceLines[serviceLineIndex].quantity;
        const taxLineIndex = stocks.length + packageUnits.length + serviceLineIndex;
        const coveredCents = Math.max(
          0,
          Math.round(Number(serviceLines[serviceLineIndex].service.price) * 100)
            - Math.round((tax.lineDiscount[taxLineIndex] ?? 0) * 100 / quantity)
            + Math.round((tax.lineTax[taxLineIndex] ?? 0) * 100 / quantity),
        );
        packageCoverageByBalanceId.set(balance.id, coveredCents);
        packageCoverageCents += coveredCents;
      }
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
      const invoiceTotalCents = Math.round(tax.total * 100);
      const amountCents = Math.max(0, invoiceTotalCents - packageCoverageCents);
      const invoice = await tx.invoice.create({
        data: {
          businessId,
          branchId,
          appointmentId: effectiveAppointmentId,
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
          total: fromCents(invoiceTotalCents),
          paidAmount: fromCents(invoiceTotalCents),
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
                customerPackageId:
                  redeemedPackageByServiceId.get(service.id)?.customerPackageId ?? null,
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
      const packagePayments: Payment[] = [];
      for (const balance of redeemedPackageBalances) {
        const updatedBalance = await tx.customerPackageServiceBalance.updateMany({
          where: {
            id: balance.id,
            businessId,
            remainingUses: balance.remainingUses,
          },
          data: { remainingUses: balance.remainingUses - 1 },
        });
        if (updatedBalance.count !== 1) {
          throw new Error("This customer package is no longer available.");
        }

        const updatedPackage = await tx.customerPackage.updateMany({
          where: {
            id: balance.customerPackageId,
            businessId,
            remainingUses: { gt: 0 },
            status: "ACTIVE",
          },
          data: { remainingUses: { decrement: 1 } },
        });
        if (updatedPackage.count !== 1) {
          throw new Error("This customer package is no longer available.");
        }

        packagePayments.push(await tx.payment.create({
          data: {
            businessId,
            branchId,
            cashierId: user.userId,
            shiftId: shift.id,
            appointmentId: effectiveAppointmentId,
            invoiceId: invoice.id,
            customerPackageId: balance.customerPackageId,
            customerPackageServiceBalanceId: balance.id,
            amount: fromCents(packageCoverageByBalanceId.get(balance.id) ?? 0),
            method: "PACKAGE",
            packageUses: 1,
            reference: `${balance.customerPackage.package.name} - ${balance.service.name}`,
          },
        }));
      }

      await tx.customerPackage.updateMany({
        where: {
          id: { in: redeemedPackageBalances.map((balance) => balance.customerPackageId) },
          businessId,
          remainingUses: 0,
          status: "ACTIVE",
        },
        data: { status: "USED_UP" },
      });

      const cashPayment = amountCents > 0 || !packagePayments.length
        ? await tx.payment.create({
            data: {
              businessId,
              branchId,
              cashierId: user.userId,
              shiftId: shift.id,
              appointmentId: effectiveAppointmentId,
              invoiceId: invoice.id,
              customerPackageId: primaryCustomerPackage?.id ?? null,
              amount: fromCents(amountCents),
              method: input.method,
              reference:
                input.reference ||
                `${stocks.length} product lines, ${serviceLines.length} service lines, ${packageUnits.length} packages`,
            },
          })
        : null;
      const createdPayments = [...packagePayments, ...(cashPayment ? [cashPayment] : [])];
      const payment = cashPayment ?? packagePayments.at(-1);
      if (!payment) {
        throw new Error("At least one payment is required.");
      }

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
        for (const createdPayment of createdPayments) {
          await awardLoyaltyPointsForPayment(tx, {
            businessId,
            branchId,
            customerId: customer.id,
            paymentId: createdPayment.id,
            amountCents: Math.round(Number(createdPayment.amount) * 100),
            paymentMethod: createdPayment.method,
            createdById: user.userId,
          });
        }
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
            amount: fromCents(invoiceTotalCents),
            amountDue: fromCents(amountCents),
            packageCoverage: fromCents(packageCoverageCents),
            methods: createdPayments.map((entry) => entry.method),
            invoiceId: invoice.id,
            appointmentId: effectiveAppointmentId,
            productLines: stocks.map(({ product, quantity }) => ({
              productId: product.id,
              quantity,
            })),
            serviceLines: serviceLines.map(({ service, quantity }) => ({
              serviceId: service.id,
              quantity,
            })),
            customerPackageIds: customerPackages.map((item) => item.id),
            redeemedCustomerPackageIds: redeemedPackageBalances.map(
              (balance) => balance.customerPackageId,
            ),
            manualDiscount: fromCents(manualDiscountCents),
            catalogDiscountId: catalogDiscount?.id ?? null,
            discountReference: input.discountReference ?? null,
            loyaltyPointsRedeemed,
            loyaltyDiscount: fromCents(loyaltyDiscountCents),
          },
          metadata: {
            appointmentId: effectiveAppointmentId,
            customerId: customer?.id ?? null,
          },
          request: auditRequest,
        },
        tx,
      );

      return {
        customerId: customer?.id ?? null,
        customerPackageIds: [
          ...new Set([
            ...customerPackages.map((item) => item.id),
            ...redeemedPackageBalances.map((balance) => balance.customerPackageId),
          ]),
        ],
        invoiceId: invoice.id,
        appointmentId: effectiveAppointmentId,
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
          packageVoucherAmount: packageCoverageCents / 100,
          cashPaidAmount: amountCents / 100,
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
    if (result.appointmentId) {
      revalidatePath("/appointments");
      revalidatePath(`/appointments/${result.appointmentId}`);
    }
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
