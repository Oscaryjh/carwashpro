"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { resolveBranchId } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { money } from "@/lib/validation/services";
import {
  canMoveWorkOrderStatus,
  createWorkOrderSchema,
  makeOrderNumber,
  updateWorkOrderStatusSchema,
} from "@/lib/validation/work-orders";
import {
  readyForPickupTemplate,
  serviceConfirmationTemplate,
} from "@/lib/whatsapp/templates";

function toCents(value: unknown) {
  return Math.round(Number(value) * 100);
}

export async function createWorkOrderAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const branchId = await resolveBranchId(businessId, formData.get("branchId"));
  const input = createWorkOrderSchema.parse({
    vehicleId: formData.get("vehicleId"),
    notes: formData.get("notes"),
  });
  const serviceIds = formData
    .getAll("serviceIds")
    .map((value) => value.toString())
    .filter(Boolean);

  if (!serviceIds.length) {
    throw new Error("Select at least one service.");
  }

  const vehicle = await prisma.vehicle.findFirstOrThrow({
    where: {
      id: input.vehicleId,
      businessId,
    },
    include: {
      customer: true,
    },
  });

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

  const workOrder = await prisma.$transaction(async (tx) => {
    const business = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
    });

    const created = await tx.workOrder.create({
      data: {
        businessId,
        branchId,
        customerId: vehicle.customer.id,
        vehicleId: vehicle.id,
        orderNumber: makeOrderNumber(),
        status: "WAITING",
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

    await tx.whatsAppMessage.create({
      data: {
        businessId,
        branchId,
        customerId: vehicle.customer.id,
        vehicleId: vehicle.id,
        workOrderId: created.id,
        phone: vehicle.customer.phone,
        messageType: "SERVICE_CONFIRMATION",
        messageBody: serviceConfirmationTemplate({
          businessName: business.name,
          customerName: vehicle.customer.name,
          plateNumber: vehicle.plateNumber,
          orderNumber: created.orderNumber,
          services: services.map((service) => service.name),
          total: money(subtotalCents / 100),
        }),
        status: "READY",
      },
    });

    return created;
  });

  revalidatePath("/work-orders");
  revalidatePath("/whatsapp");
  redirect(`/work-orders/${workOrder.id}`);
}

export async function updateWorkOrderStatusAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const input = updateWorkOrderStatusSchema.parse({
    workOrderId: formData.get("workOrderId"),
    status: formData.get("status"),
  });

  const workOrder = await prisma.workOrder.findFirstOrThrow({
    where: {
      id: input.workOrderId,
      businessId,
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
    await tx.workOrder.update({
      where: { id: workOrder.id },
      data: { status: input.status },
    });

    if (input.status === "READY_FOR_PICKUP") {
      await tx.whatsAppMessage.create({
        data: {
          businessId,
          branchId: workOrder.branchId,
          customerId: workOrder.customer.id,
          vehicleId: workOrder.vehicle.id,
          workOrderId: workOrder.id,
          phone: workOrder.customer.phone,
          messageType: "READY_FOR_PICKUP",
          messageBody: readyForPickupTemplate({
            businessName: workOrder.business.name,
            customerName: workOrder.customer.name,
            plateNumber: workOrder.vehicle.plateNumber,
            orderNumber: workOrder.orderNumber,
            balance: Number(workOrder.balance).toFixed(2),
          }),
          status: "READY",
        },
      });
    }
  });

  revalidatePath("/work-orders");
  revalidatePath(`/work-orders/${workOrder.id}`);
  revalidatePath("/whatsapp");
}
