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
    contactType: formData.get("contactType"),
    contactName: formData.get("contactName"),
    contactPhone: formData.get("contactPhone"),
    newOwnerName: formData.get("newOwnerName"),
    newOwnerPhone: formData.get("newOwnerPhone"),
    ownershipNotes: formData.get("ownershipNotes"),
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

  if (input.contactType === "OTHER_PERSON") {
    if (!input.contactName || !input.contactPhone) {
      throw new Error("Other person name and phone are required.");
    }
  }

  if (input.contactType === "NEW_OWNER") {
    if (!input.newOwnerName || !input.newOwnerPhone) {
      throw new Error("New owner name and phone are required.");
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

  const workOrder = await prisma.$transaction(async (tx) => {
    const business = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
    });

    const currentVehicle = await tx.vehicle.findFirstOrThrow({
      where: {
        id: vehicle.id,
        businessId,
      },
      include: {
        customer: true,
      },
    });

    let workOrderCustomer = currentVehicle.customer;
    let contactName = currentVehicle.customer.name;
    let contactPhone = currentVehicle.customer.phone;

    if (input.contactType === "OTHER_PERSON") {
      contactName = input.contactName!;
      contactPhone = input.contactPhone!;
    }

    if (input.contactType === "NEW_OWNER") {
      let newOwner = await tx.customer.findFirst({
        where: {
          businessId,
          phone: input.newOwnerPhone!,
        },
      });

      if (!newOwner) {
        newOwner = await tx.customer.create({
          data: {
            businessId,
            branchId,
            name: input.newOwnerName!,
            phone: input.newOwnerPhone!,
          },
        });
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
        status: "WAITING",
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

    await tx.whatsAppMessage.create({
      data: {
        businessId,
        branchId,
        customerId: workOrderCustomer.id,
        vehicleId: currentVehicle.id,
        workOrderId: created.id,
        phone: contactPhone,
        messageType: "SERVICE_CONFIRMATION",
        messageBody: serviceConfirmationTemplate({
          businessName: business.name,
          customerName: contactName,
          plateNumber: currentVehicle.plateNumber,
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
  revalidatePath("/crm");
  revalidatePath(`/crm/customers/${vehicle.customer.id}`);
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
          phone: workOrder.contactPhone || workOrder.customer.phone,
          messageType: "READY_FOR_PICKUP",
          messageBody: readyForPickupTemplate({
            businessName: workOrder.business.name,
            customerName: workOrder.contactName || workOrder.customer.name,
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
