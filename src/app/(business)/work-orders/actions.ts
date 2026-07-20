"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { resolveOperationalBranchId } from "@/lib/branches";
import { awardLoyaltyPointsForPayment } from "@/lib/loyalty/service";
import { prisma } from "@/lib/prisma";
import {
  customerPhoneSearchVariants,
  customerSchema,
  normalizeCustomerPhone,
  normalizePlateNumber,
  vehicleSchema,
} from "@/lib/validation/crm";
import { money } from "@/lib/validation/services";
import { cashierPackagePurchaseSchema } from "@/lib/validation/packages";
import { fromCents } from "@/lib/validation/pos";
import {
  canMoveWorkOrderStatus,
  createWorkOrderSchema,
  makeOrderNumber,
  updateWorkOrderContactSchema,
  updateWorkOrderStatusSchema,
} from "@/lib/validation/work-orders";
import { sendNewCustomerWelcomeIfConnected } from "@/lib/whatsapp/customer-welcome";
import { makeInvoiceNumber } from "@/lib/invoices/invoice-number";
import { resolveVehicleSize } from "@/lib/vehicle-size";
import { calculateTax } from "@/lib/tax/calculator";
import {
  activateCustomerPackageServiceBalances,
  createCustomerPackageServiceBalances,
} from "@/lib/packages/service-balances";
import { sendInvoiceIfConnected } from "@/lib/whatsapp/invoice-notifications";
import {
  sendReadyForPickupIfConnected,
  sendServiceConfirmationQueued,
} from "@/lib/whatsapp/work-order-notifications";

function toCents(value: unknown) {
  return Math.round(Number(value) * 100);
}

function packagePurchaseReturnPath(value: FormDataEntryValue | null) {
  const path = value?.toString().trim();

  return path && (path === "/cashier" || /^\/appointments\/[0-9a-f-]+$/i.test(path))
    ? path
    : "/work-orders";
}

function redirectToPackagePurchaseMessage(
  returnPath: string,
  type: "error" | "success",
  message: string,
): never {
  const params = new URLSearchParams({ type, message });
  redirect(`${returnPath}?${params.toString()}`);
}

function redirectToNewWorkOrderError(
  plateNumber: string,
  message: string,
  customerPhone?: string,
): never {
  const params = new URLSearchParams();

  if (plateNumber) {
    params.set("plate", plateNumber);
  }

  if (customerPhone) {
    params.set("customer", customerPhone);
  }

  params.set("error", message);
  redirect(`/work-orders/new?${params.toString()}`);
}

async function redirectToWorkOrderFormError(
  businessId: string,
  formData: FormData,
  message: string,
): Promise<never> {
  const vehicleId = formData.get("vehicleId")?.toString();
  let plateNumber = "";

  if (vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        businessId,
      },
      select: {
        plateNumber: true,
      },
    });

    plateNumber = vehicle?.plateNumber ?? "";
  }

  const params = new URLSearchParams();

  if (plateNumber) {
    params.set("plate", plateNumber);
  }

  params.set("error", message);
  redirect(`/work-orders/new?${params.toString()}`);
}

export async function createVehicleForWorkOrderAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  const branchId = await resolveOperationalBranchId(
    businessId,
    user,
    formData.get("branchId"),
  );
  const mode = formData.get("mode")?.toString();
  const plateNumber = normalizePlateNumber(
    formData.get("plateNumber")?.toString() ?? "",
  );

  if (!plateNumber) {
    throw new Error("Plate number is required.");
  }

  const existingVehicle = await prisma.vehicle.findFirst({
    where: {
      businessId,
      plateNumber,
    },
    select: { id: true },
  });

  if (existingVehicle) {
    redirect(`/work-orders/new?plate=${encodeURIComponent(plateNumber)}`);
  }

  const vehicleInput = vehicleSchema
    .omit({ customerId: true, plateNumber: true })
    .parse({
      brand: formData.get("brand") ?? "",
      model: formData.get("model") ?? "",
      color: formData.get("color") ?? "",
      notes: formData.get("vehicleNotes") ?? "",
    });
  const resolvedVehicleSize = await resolveVehicleSize(businessId, vehicleInput.brand, vehicleInput.model);

  const createdCustomerForWelcome = await prisma.$transaction(async (tx) => {
    let customerId = "";
    let customerForWelcome: { id: string; name: string; phone: string } | null =
      null;

    if (mode === "existing") {
      const existingCustomerId = formData.get("customerId")?.toString();

      if (!existingCustomerId) {
        throw new Error("Select an existing customer.");
      }

      const customer = await tx.customer.findFirst({
        where: {
          id: existingCustomerId,
          businessId,
        },
        select: { id: true },
      });

      if (!customer) {
        throw new Error("Customer not found.");
      }

      customerId = customer.id;
    } else if (mode === "new") {
      const parsedCustomer = customerSchema.safeParse({
        name: formData.get("customerName"),
        phone: formData.get("customerPhone"),
        email: formData.get("customerEmail"),
        notes: formData.get("customerNotes"),
      });
      const customerPhone = formData.get("customerPhone")?.toString() ?? "";

      if (!parsedCustomer.success) {
        redirectToNewWorkOrderError(
          plateNumber,
          parsedCustomer.error.issues[0]?.message ?? "Check customer details.",
          customerPhone,
        );
      }

      const customerInput = parsedCustomer.data;

      let customer = await tx.customer.findFirst({
        where: {
          businessId,
          phone: {
            in: customerPhoneSearchVariants(customerInput.phone),
          },
        },
      });

      if (!customer) {
        customer = await tx.customer.create({
          data: {
            businessId,
            branchId,
            name: customerInput.name,
            phone: customerInput.phone,
            email: customerInput.email || null,
            notes: customerInput.notes || null,
          },
        });
        customerForWelcome = {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
        };
      }

      customerId = customer.id;
    } else {
      throw new Error("Choose customer type.");
    }

    await tx.vehicle.create({
      data: {
        businessId,
        branchId,
        customerId,
        plateNumber,
        brand: vehicleInput.brand || null,
        model: vehicleInput.model || null,
        color: vehicleInput.color || null,
        size: resolvedVehicleSize.size,
        sizeSource: resolvedVehicleSize.source,
        notes: vehicleInput.notes || null,
      },
    });

    return customerForWelcome;
  });

  revalidatePath("/crm");
  revalidatePath("/crm/customers");
  revalidatePath("/crm/vehicles");
  revalidatePath("/work-orders/new");
  if (createdCustomerForWelcome) {
    await sendNewCustomerWelcomeIfConnected({
      businessId,
      branchId,
      customerId: createdCustomerForWelcome.id,
      customerName: createdCustomerForWelcome.name,
      customerPhone: createdCustomerForWelcome.phone,
      sentByUserId: user.userId,
    });
  }
  redirect(`/work-orders/new?plate=${encodeURIComponent(plateNumber)}`);
}

export async function createWorkOrderAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  const auditRequest = await getAuditRequestContext();
  const branchId = await resolveOperationalBranchId(
    businessId,
    user,
    formData.get("branchId"),
  );
  const parsedInput = createWorkOrderSchema.safeParse({
    vehicleId: formData.get("vehicleId"),
    contactType: formData.get("contactType"),
    contactName: formData.get("contactName"),
    contactPhone: formData.get("contactPhone"),
    newOwnerName: formData.get("newOwnerName"),
    newOwnerPhone: formData.get("newOwnerPhone"),
    ownershipNotes: formData.get("ownershipNotes"),
    notes: formData.get("notes"),
  });

  if (!parsedInput.success) {
    const message =
      parsedInput.error.issues[0]?.message ?? "Check the work order details.";

    return redirectToWorkOrderFormError(businessId, formData, message);
  }

  const input = parsedInput.data;
  const serviceIds = formData
    .getAll("serviceIds")
    .map((value) => value.toString())
    .filter(Boolean);

  if (!serviceIds.length) {
    await redirectToWorkOrderFormError(
      businessId,
      formData,
      "Select at least one service.",
    );
  }

  const vehicle = await prisma.vehicle.findFirstOrThrow({
    where: {
      id: input.vehicleId,
      businessId,
      ...(user.role === "BUSINESS_OWNER"
        ? {}
        : { branchId: user.branchId ?? "00000000-0000-0000-0000-000000000000" }),
    },
    include: {
      customer: true,
    },
  });

  if (input.contactType === "OTHER_PERSON") {
    if (!input.contactName || !input.contactPhone) {
      await redirectToWorkOrderFormError(
        businessId,
        formData,
        "Other person name and phone are required.",
      );
    }
  }

  if (input.contactType === "NEW_OWNER") {
    if (!input.newOwnerName || !input.newOwnerPhone) {
      await redirectToWorkOrderFormError(
        businessId,
        formData,
        "New owner name and phone are required.",
      );
    }
  }

  const services = await prisma.service.findMany({
    where: {
      businessId,
      id: {
        in: serviceIds,
      },
      status: "ACTIVE",
    },
  });

  if (services.length !== serviceIds.length) {
    throw new Error("One or more services are unavailable.");
  }

  const items = services.map((service) => {
    const quantityValue = formData.get(`quantity_${service.id}`)?.toString() ?? "1";
    const quantity = Math.max(1, Number.parseInt(quantityValue, 10) || 1);
    const unitPriceCents = toCents(service.price);
    const lineTotalCents = unitPriceCents * quantity;

    return {
      businessId,
      serviceId: service.id,
      name: service.name,
      quantity,
      unitPrice: money(unitPriceCents / 100),
      lineTotal: money(lineTotalCents / 100),
      lineTotalCents,
    };
  });
  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);

  const result = await prisma.$transaction(async (tx) => {
    const currentVehicle = await tx.vehicle.findFirstOrThrow({
      where: {
        id: vehicle.id,
        businessId,
        ...(user.role === "BUSINESS_OWNER"
          ? {}
          : { branchId: user.branchId ?? "00000000-0000-0000-0000-000000000000" }),
      },
      include: {
        customer: true,
      },
    });

    let workOrderCustomer = currentVehicle.customer;
    let contactName = currentVehicle.customer.name;
    let contactPhone = currentVehicle.customer.phone;
    let newOwnerForWelcome: { id: string; name: string; phone: string } | null =
      null;

    if (input.contactType === "OTHER_PERSON") {
      contactName = input.contactName!;
      contactPhone = normalizeCustomerPhone(input.contactPhone!);
    }

    if (input.contactType === "NEW_OWNER") {
      let newOwner = await tx.customer.findFirst({
        where: {
          businessId,
          phone: {
            in: customerPhoneSearchVariants(input.newOwnerPhone!),
          },
        },
      });

      if (!newOwner) {
        newOwner = await tx.customer.create({
          data: {
            businessId,
            branchId,
            name: input.newOwnerName!,
            phone: normalizeCustomerPhone(input.newOwnerPhone!),
          },
        });
        newOwnerForWelcome = {
          id: newOwner.id,
          name: newOwner.name,
          phone: newOwner.phone,
        };
      }

      if (newOwner.id === currentVehicle.customerId) {
        throw new Error(
          "This phone belongs to the current owner. Select registered owner instead.",
        );
      }

      await tx.vehicle.update({
        where: { id: currentVehicle.id },
        data: {
          customerId: newOwner.id,
        },
      });

      await tx.vehicleOwnershipHistory.create({
        data: {
          businessId,
          branchId,
          vehicleId: currentVehicle.id,
          previousCustomerId: currentVehicle.customerId,
          newCustomerId: newOwner.id,
          notes: input.ownershipNotes || null,
        },
      });

      workOrderCustomer = newOwner;
      contactName = newOwner.name;
      contactPhone = newOwner.phone;
    }

    const created = await tx.workOrder.create({
      data: {
        businessId,
        branchId,
        customerId: workOrderCustomer.id,
        vehicleId: currentVehicle.id,
        orderNumber: makeOrderNumber(),
        status: "IN_PROGRESS",
        contactType: input.contactType,
        contactName,
        contactPhone,
        subtotal: money(subtotalCents / 100),
        total: money(subtotalCents / 100),
        paidAmount: money(0),
        balance: money(subtotalCents / 100),
        paymentStatus: "UNPAID",
        notes: input.notes || null,
        items: {
          create: items.map((item) => ({
            businessId: item.businessId,
            serviceId: item.serviceId,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
          })),
        },
      },
    });

    await writeAuditLog(
      {
        businessId,
        branchId,
        actor: user,
        action: "WORK_ORDER_CREATED",
        entityType: "WorkOrder",
        entityId: created.id,
        summary: `Created job ${created.orderNumber}`,
        after: {
          orderNumber: created.orderNumber,
          customerId: created.customerId,
          vehicleId: created.vehicleId,
          status: created.status,
          paymentStatus: created.paymentStatus,
          total: created.total,
          contactType: created.contactType,
        },
        metadata: { serviceIds },
        request: auditRequest,
      },
      tx,
    );

    return { created, newOwnerForWelcome };
  });

  revalidatePath("/work-orders");
  revalidatePath("/crm");
  revalidatePath(`/crm/customers/${vehicle.customer.id}`);
  await sendServiceConfirmationQueued({
    businessId,
    workOrderId: result.created.id,
    sentByUserId: user.userId,
  });
  if (result.newOwnerForWelcome) {
    await sendNewCustomerWelcomeIfConnected({
      businessId,
      branchId,
      customerId: result.newOwnerForWelcome.id,
      customerName: result.newOwnerForWelcome.name,
      customerPhone: result.newOwnerForWelcome.phone,
      sentByUserId: user.userId,
    });
  }
  redirect("/work-orders");
}

export async function purchasePackageFromCashierAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  const auditRequest = await getAuditRequestContext();
  const returnPath = packagePurchaseReturnPath(formData.get("returnTo"));
  const parsed = cashierPackagePurchaseSchema.safeParse({
    branchId: formData.get("branchId")?.toString() ?? "",
    method: formData.get("method")?.toString(),
    packageIds: formData.getAll("packageId").map((value) => value.toString()),
    quantities: formData.getAll("quantity"),
    reference: formData.get("reference")?.toString() || undefined,
    customerId: formData.get("customerId")?.toString(),
  });

  if (!parsed.success) {
    redirectToPackagePurchaseMessage(
      returnPath,
      "error",
      parsed.error.issues[0]?.message ?? "Package purchase details are invalid.",
    );
  }

  const input = parsed.data;

  try {
    const branchId = await resolveOperationalBranchId(
      businessId,
      user,
      input.branchId || null,
    );

    const result = await prisma.$transaction(async (tx) => {
      const shift = await tx.cashierShift.findFirst({
        where: {
          businessId,
          cashierId: user.userId,
          status: "OPEN",
        },
        select: { id: true, branchId: true },
      });

      if (!shift) {
        throw new Error("Start a cashier shift before selling a package.");
      }

      if (shift.branchId !== branchId) {
        throw new Error("This package sale does not belong to the current shift branch.");
      }

      const customer = await tx.customer.findFirst({
        where: {
          id: input.customerId,
          businessId,
        },
        select: {
          id: true,
          name: true,
          phone: true,
          _count: {
            select: { vehicles: true },
          },
        },
      });

      if (!customer) {
        throw new Error("Customer account could not be found.");
      }

      const mergedQuantities = new Map<string, number>();
      input.packageIds.forEach((packageId, index) => {
        mergedQuantities.set(
          packageId,
          (mergedQuantities.get(packageId) ?? 0) + input.quantities[index],
        );
      });

      const packageDefinitions = await tx.package.findMany({
        where: {
          id: { in: [...mergedQuantities.keys()] },
          businessId,
          status: "ACTIVE",
        },
        include: {
          service: {
            select: { taxable: true, taxRate: true },
          },
          serviceBenefits: { select: { serviceId: true, totalUses: true } },
        },
      });

      if (packageDefinitions.length !== mergedQuantities.size) {
        throw new Error("One of the selected packages is no longer available.");
      }

      const business = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { sstEnabled: true, sstLabel: true, sstRate: true },
      });
      const purchaseLines = packageDefinitions.flatMap((packageDefinition) =>
        Array.from(
          { length: mergedQuantities.get(packageDefinition.id) ?? 0 },
          () => ({ packageDefinition }),
        ),
      );
      const lineTotals = purchaseLines.map(({ packageDefinition }) =>
        Number(packageDefinition.price),
      );
      const tax = calculateTax({
        sstEnabled: business.sstEnabled,
        sstLabel: business.sstLabel,
        sstRate: Number(business.sstRate),
        lines: purchaseLines.map(({ packageDefinition }, index) => ({
          lineTotal: lineTotals[index],
          taxable: packageDefinition.service?.taxable ?? true,
          taxRate:
            packageDefinition.service?.taxRate == null
              ? null
              : Number(packageDefinition.service.taxRate),
        })),
      });
      const customerPackages: Array<{ id: string }> = [];

      for (const { packageDefinition } of purchaseLines) {
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

      const primaryCustomerPackage = customerPackages[0];
      if (!primaryCustomerPackage) {
        throw new Error("Select at least one package.");
      }
      const amountCents = Math.round(tax.total * 100);
      const invoice = await tx.invoice.create({
        data: {
          businessId,
          branchId,
          customerId: customer.id,
          customerPackageId: primaryCustomerPackage.id,
          invoiceNumber: makeInvoiceNumber(),
          subtotal: fromCents(Math.round(tax.subtotal * 100)),
          taxableSubtotal: fromCents(Math.round(tax.taxableSubtotal * 100)),
          taxAmount: fromCents(Math.round(tax.tax * 100)),
          taxRate: fromCents(Math.round(tax.taxRate * 100)),
          taxLabel: tax.tax > 0 ? tax.taxLabel : null,
          total: fromCents(amountCents),
          paidAmount: fromCents(amountCents),
          balance: 0,
          status: "PAID",
          items: {
            create: purchaseLines.map(({ packageDefinition }, index) => ({
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
              taxAmount: fromCents(Math.round(tax.lineTax[index] * 100)),
            })),
          },
        },
      });
      const payment = await tx.payment.create({
        data: {
          businessId,
          branchId,
          cashierId: user.userId,
          invoiceId: invoice.id,
          customerPackageId: primaryCustomerPackage.id,
          shiftId: shift.id,
          amount: fromCents(amountCents),
          method: input.method,
          reference:
            input.reference || `${purchaseLines.length} package purchase`,
        },
      });

      await awardLoyaltyPointsForPayment(tx, {
        businessId,
        branchId,
        customerId: customer.id,
        paymentId: payment.id,
        amountCents,
        paymentMethod: payment.method,
        createdById: user.userId,
      });

      await Promise.all(
        customerPackages.map(async (customerPackage, index) => {
          await tx.customerPackage.update({
            where: { id: customerPackage.id },
            data: {
              remainingUses: purchaseLines[index].packageDefinition.totalUses,
              status: "ACTIVE",
            },
          });
          await activateCustomerPackageServiceBalances(tx, customerPackage.id);
        }),
      );

      const packageSummary = packageDefinitions.map((packageDefinition) => ({
        packageId: packageDefinition.id,
        name: packageDefinition.name,
        quantity: mergedQuantities.get(packageDefinition.id) ?? 0,
      }));

      await writeAuditLog(
        {
          businessId,
          branchId,
          actor: user,
          action: "PACKAGE_PURCHASE_PAID",
          entityType: "Payment",
          entityId: payment.id,
          summary: `Activated ${purchaseLines.length} customer packages`,
          before: {
            customerPackageIds: customerPackages.map((item) => item.id),
            status: "PENDING_PAYMENT",
            remainingUses: 0,
          },
          after: {
            customerPackageIds: customerPackages.map((item) => item.id),
            status: "ACTIVE",
            packages: packageSummary,
            amount: payment.amount,
            method: payment.method,
          },
          metadata: {
            customerId: customer.id,
            customerPhone: customer.phone,
            customerVehicleCount: customer._count.vehicles,
            packages: packageSummary,
          },
          request: auditRequest,
        },
        tx,
      );

      return {
        customerId: customer.id,
        customerPackageIds: customerPackages.map((item) => item.id),
        invoiceId: invoice.id,
      };
    });

    await sendInvoiceIfConnected({
      businessId,
      invoiceId: result.invoiceId,
      sentByUserId: user.userId,
    });

    revalidatePath("/work-orders");
    revalidatePath("/pos");
    revalidatePath("/closing");
    revalidatePath("/dashboard");
    revalidatePath("/reports");
    revalidatePath(`/crm/customers/${result.customerId}`);
    result.customerPackageIds.forEach((customerPackageId) => {
      revalidatePath(`/pos/packages/${customerPackageId}`);
    });
    revalidatePath(`/invoices/${result.invoiceId}`);
    revalidatePath(returnPath);
  } catch (error) {
    redirectToPackagePurchaseMessage(
      returnPath,
      "error",
      error instanceof Error ? error.message : "Unable to complete package purchase.",
    );
  }

  redirectToPackagePurchaseMessage(returnPath, "success", "Packages purchased and activated.");
}

export async function updateWorkOrderStatusAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  const auditRequest = await getAuditRequestContext();
  const input = updateWorkOrderStatusSchema.parse({
    workOrderId: formData.get("workOrderId"),
    status: formData.get("status"),
  });

  const workOrder = await prisma.workOrder.findFirstOrThrow({
    where: {
      id: input.workOrderId,
      businessId,
      ...(user.role === "BUSINESS_OWNER"
        ? {}
        : { branchId: user.branchId ?? "00000000-0000-0000-0000-000000000000" }),
    },
    include: {
      business: true,
      customer: true,
      vehicle: true,
    },
  });

  if (!canMoveWorkOrderStatus(workOrder.status, input.status)) {
    throw new Error("This status change is not allowed.");
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.workOrder.update({
      where: { id: workOrder.id },
      data: {
        status: input.status,
        ...(input.status === "COMPLETED" ? { pickedUpAt: new Date() } : {}),
      },
    });

    await writeAuditLog(
      {
        businessId,
        branchId: workOrder.branchId,
        actor: user,
        action:
          input.status === "CANCELLED"
            ? "WORK_ORDER_CANCELLED"
            : "WORK_ORDER_STATUS_CHANGED",
        entityType: "WorkOrder",
        entityId: workOrder.id,
        summary: `${workOrder.orderNumber}: ${workOrder.status} to ${updated.status}`,
        before: { status: workOrder.status, pickedUpAt: workOrder.pickedUpAt },
        after: { status: updated.status, pickedUpAt: updated.pickedUpAt },
        request: auditRequest,
      },
      tx,
    );
  });

  if (input.status === "READY_FOR_PICKUP") {
    await sendReadyForPickupIfConnected({
      businessId,
      workOrderId: workOrder.id,
      sentByUserId: user.userId,
    });
  }

  revalidatePath("/work-orders");
  revalidatePath(`/work-orders/${workOrder.id}`);
}

export async function updateWorkOrderContactAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  const auditRequest = await getAuditRequestContext();
  const workOrderId = formData.get("workOrderId")?.toString() ?? "";
  const parsedInput = updateWorkOrderContactSchema.safeParse({
    workOrderId: formData.get("workOrderId"),
    contactType: formData.get("contactType"),
    contactName: formData.get("contactName"),
    contactPhone: formData.get("contactPhone"),
  });

  if (!parsedInput.success) {
    const message =
      parsedInput.error.issues[0]?.message ?? "Check the contact details.";
    const params = new URLSearchParams({ error: message });

    redirect(`/work-orders/${workOrderId}?${params.toString()}`);
  }

  const input = parsedInput.data;
  const workOrder = await prisma.workOrder.findFirstOrThrow({
    where: {
      id: input.workOrderId,
      businessId,
      ...(user.role === "BUSINESS_OWNER"
        ? {}
        : { branchId: user.branchId ?? "00000000-0000-0000-0000-000000000000" }),
    },
    include: {
      customer: true,
    },
  });

  if (workOrder.contactType === "NEW_OWNER") {
    const params = new URLSearchParams({
      error:
        "This work order includes an ownership transfer. Edit ownership from the vehicle/customer flow.",
    });

    redirect(`/work-orders/${workOrder.id}?${params.toString()}`);
  }

  const contactName =
    input.contactType === "REGISTERED_OWNER"
      ? workOrder.customer.name
      : input.contactName;
  const contactPhone =
    input.contactType === "REGISTERED_OWNER"
      ? workOrder.customer.phone
      : normalizeCustomerPhone(input.contactPhone ?? "");

  await prisma.$transaction(async (tx) => {
    await tx.workOrder.update({
      where: {
        id: workOrder.id,
      },
      data: {
        contactType: input.contactType,
        contactName,
        contactPhone,
      },
    });

    await writeAuditLog(
      {
        businessId,
        branchId: workOrder.branchId,
        actor: user,
        action: "WORK_ORDER_CONTACT_UPDATED",
        entityType: "WorkOrder",
        entityId: workOrder.id,
        summary: `Updated pickup contact for ${workOrder.orderNumber}`,
        before: {
          contactType: workOrder.contactType,
          contactName: workOrder.contactName,
          contactPhone: workOrder.contactPhone,
        },
        after: { contactType: input.contactType, contactName, contactPhone },
        request: auditRequest,
      },
      tx,
    );
  });

  revalidatePath("/work-orders");
  revalidatePath(`/work-orders/${workOrder.id}`);

  const params = new URLSearchParams({ saved: "Contact updated." });
  redirect(`/work-orders/${workOrder.id}?${params.toString()}`);
}
