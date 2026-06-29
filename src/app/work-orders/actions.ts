"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { resolveBranchId } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { customerSchema, normalizePlateNumber, vehicleSchema } from "@/lib/validation/crm";
import { money } from "@/lib/validation/services";
import {
  canMoveWorkOrderStatus,
  createWorkOrderSchema,
  makeOrderNumber,
  updateWorkOrderContactSchema,
  updateWorkOrderStatusSchema,
} from "@/lib/validation/work-orders";
import { sendNewCustomerWelcomeIfConnected } from "@/lib/whatsapp/customer-welcome";
import { sendReadyForPickupIfConnected } from "@/lib/whatsapp/work-order-notifications";

function toCents(value: unknown) {
  return Math.round(Number(value) * 100);
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
  const branchId = await resolveBranchId(businessId, formData.get("branchId"));
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
          phone: customerInput.phone,
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
  const branchId = await resolveBranchId(businessId, formData.get("branchId"));
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

    return { created, newOwnerForWelcome };
  });

  revalidatePath("/work-orders");
  revalidatePath("/crm");
  revalidatePath(`/crm/customers/${vehicle.customer.id}`);
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

export async function updateWorkOrderStatusAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
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
  const { businessId } = await requireBusinessUser();
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
      : input.contactPhone;

  await prisma.workOrder.update({
    where: {
      id: workOrder.id,
    },
    data: {
      contactType: input.contactType,
      contactName,
      contactPhone,
    },
  });

  revalidatePath("/work-orders");
  revalidatePath(`/work-orders/${workOrder.id}`);

  const params = new URLSearchParams({ saved: "Contact updated." });
  redirect(`/work-orders/${workOrder.id}?${params.toString()}`);
}
