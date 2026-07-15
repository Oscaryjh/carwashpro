"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCrmUser } from "@/lib/auth/crm";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { resolveBranchId } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import {
  customerPhoneSearchVariants,
  customerVehicleSchema,
  customerSchema,
  normalizePlateNumber,
  vehicleSchema,
} from "@/lib/validation/crm";
import { sendNewCustomerWelcomeIfConnected } from "@/lib/whatsapp/customer-welcome";
import { resolveVehicleSize } from "@/lib/vehicle-size";

export type DeleteCustomerState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function createCustomerAction(formData: FormData) {
  const { businessId, user } = await requireCrmUser();
  const branchId = await resolveBranchId(businessId, formData.get("branchId"));
  const whatsappConversationId = formData.get("whatsappConversationId")?.toString().trim();
  const input = customerSchema.parse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    notes: formData.get("notes"),
  });
  const rawPlateNumber = formData.get("plateNumber")?.toString().trim() ?? "";
  const vehicleInput = rawPlateNumber
    ? customerVehicleSchema.parse({
        plateNumber: rawPlateNumber,
        brand: formData.get("brand"),
        model: formData.get("model"),
        color: formData.get("color"),
        notes: formData.get("vehicleNotes"),
      })
    : null;
  const resolvedVehicleSize = vehicleInput
    ? await resolveVehicleSize(businessId, vehicleInput.brand, vehicleInput.model)
    : null;

  if (vehicleInput) {
    const existingPlate = await prisma.vehicle.findFirst({
      where: {
        businessId,
        plateNumber: normalizePlateNumber(vehicleInput.plateNumber),
      },
      select: { id: true },
    });

    if (existingPlate) {
      throw new Error("Another vehicle in this business already uses this plate.");
    }
  }

  const existingPhone = await prisma.customer.findFirst({
    where: {
      businessId,
      phone: {
        in: customerPhoneSearchVariants(input.phone),
      },
    },
    select: { id: true, name: true },
  });

  if (existingPhone && !whatsappConversationId) {
    throw new Error("Another customer in this business already uses this phone.");
  }

  const customer = await prisma.$transaction(async (tx) => {
    const existingCustomer = whatsappConversationId
      ? await tx.customer.findFirst({
          where: {
            businessId,
            phone: {
              in: customerPhoneSearchVariants(input.phone),
            },
          },
        })
      : null;

    const savedCustomer =
      existingCustomer ??
      (await tx.customer.create({
        data: {
          businessId,
          branchId,
          name: input.name,
          phone: input.phone,
          email: input.email || null,
          notes: input.notes || null,
        },
      }));

    if (vehicleInput) {
      await tx.vehicle.create({
        data: {
          businessId,
          branchId,
          customerId: savedCustomer.id,
          plateNumber: normalizePlateNumber(vehicleInput.plateNumber),
          brand: vehicleInput.brand || null,
          model: vehicleInput.model || null,
          color: vehicleInput.color || null,
          size: resolvedVehicleSize?.size ?? "UNCLASSIFIED",
          sizeSource: resolvedVehicleSize?.source ?? "UNCLASSIFIED",
          notes: vehicleInput.notes || null,
        },
      });
    }

    if (whatsappConversationId) {
      await tx.whatsAppConversation.updateMany({
        where: {
          id: whatsappConversationId,
          businessId,
        },
        data: {
          customerId: savedCustomer.id,
          displayName: savedCustomer.name,
          phone: savedCustomer.phone,
        },
      });

      await tx.whatsAppChatMessage.updateMany({
        where: {
          businessId,
          conversationId: whatsappConversationId,
          customerId: null,
        },
        data: {
          customerId: savedCustomer.id,
        },
      });

      await tx.whatsAppMessage.updateMany({
        where: {
          businessId,
          customerId: null,
          OR: [
            { phone: savedCustomer.phone },
            { senderPhone: savedCustomer.phone },
            { recipientPhone: savedCustomer.phone },
          ],
        },
        data: {
          customerId: savedCustomer.id,
        },
      });
    }

    return savedCustomer;
  });

  revalidatePath("/crm");
  revalidatePath("/crm/customers");
  revalidatePath("/crm/vehicles");
  if (whatsappConversationId) {
    revalidatePath("/whatsapp/inbox");
    redirect(
      `/whatsapp/inbox?conversation=${whatsappConversationId}&type=success&message=${encodeURIComponent(
        `${customer.name} saved to CRM.`,
      )}`,
    );
  }

  await sendNewCustomerWelcomeIfConnected({
    businessId,
    branchId,
    customerId: customer.id,
    customerName: customer.name,
    customerPhone: customer.phone,
    sentByUserId: user.userId,
  });
  redirect(`/crm/customers/${customer.id}`);
}

export async function updateCustomerAction(formData: FormData) {
  const { businessId } = await requireCrmUser();
  const customerId = formData.get("customerId")?.toString();

  if (!customerId) {
    throw new Error("Customer id is required.");
  }

  const branchId = await resolveBranchId(businessId, formData.get("branchId"));
  const input = customerSchema.parse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    notes: formData.get("notes"),
  });

  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      businessId,
    },
    select: { id: true },
  });

  if (!customer) {
    throw new Error("Customer not found.");
  }

  const existingPhone = await prisma.customer.findFirst({
    where: {
      businessId,
      phone: {
        in: customerPhoneSearchVariants(input.phone),
      },
      id: { not: customer.id },
    },
    select: { id: true },
  });

  if (existingPhone) {
    throw new Error("Another customer in this business already uses this phone.");
  }

  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      branchId,
      name: input.name,
      phone: input.phone,
      email: input.email || null,
      notes: input.notes || null,
    },
  });

  revalidatePath("/crm");
  revalidatePath("/crm/customers");
  revalidatePath(`/crm/customers/${customer.id}`);
  redirect(`/crm/customers/${customer.id}`);
}

export async function updateCustomerProfileAction(formData: FormData) {
  const { businessId } = await requireCrmUser();
  const customerId = formData.get("customerId")?.toString();

  if (!customerId) {
    throw new Error("Customer id is required.");
  }

  const branchId = await resolveBranchId(
    businessId,
    formData.get("customerBranchId"),
  );
  const input = customerSchema.parse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    notes: formData.get("notes"),
  });

  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      businessId,
    },
    include: {
      vehicles: {
        select: { id: true, customerId: true },
      },
    },
  });

  if (!customer) {
    throw new Error("Customer not found.");
  }

  const existingPhone = await prisma.customer.findFirst({
    where: {
      businessId,
      phone: {
        in: customerPhoneSearchVariants(input.phone),
      },
      id: { not: customer.id },
    },
    select: { id: true },
  });

  if (existingPhone) {
    throw new Error("Another customer in this business already uses this phone.");
  }

  const vehicleIds = formData
    .getAll("vehicleId")
    .map((value) => value.toString())
    .filter(Boolean);
  const vehicleBranchIds = formData.getAll("vehicleBranchId");
  const plateNumbers = formData.getAll("vehiclePlateNumber");
  const brands = formData.getAll("vehicleBrand");
  const models = formData.getAll("vehicleModel");
  const colors = formData.getAll("vehicleColor");
  const notes = formData.getAll("vehicleNotes");
  const ownedVehicleIds = new Set(customer.vehicles.map((vehicle) => vehicle.id));
  const parsedVehicles: {
    id: string;
    branchId: string | null;
    plateNumber: string;
    brand: string | null;
    model: string | null;
    color: string | null;
    notes: string | null;
  }[] = [];
  const seenPlates = new Set<string>();

  for (let index = 0; index < vehicleIds.length; index += 1) {
    const vehicleId = vehicleIds[index];

    if (!ownedVehicleIds.has(vehicleId)) {
      throw new Error("Vehicle not found.");
    }

    const vehicleInput = vehicleSchema.parse({
      customerId: customer.id,
      plateNumber: plateNumbers[index],
      brand: brands[index],
      model: models[index],
      color: colors[index],
      notes: notes[index],
    });
    const plateNumber = normalizePlateNumber(vehicleInput.plateNumber);

    if (seenPlates.has(plateNumber)) {
      throw new Error("Duplicate plate number in this form.");
    }

    seenPlates.add(plateNumber);
    parsedVehicles.push({
      id: vehicleId,
      branchId: await resolveBranchId(
        businessId,
        vehicleBranchIds[index] ?? null,
      ),
      plateNumber,
      brand: vehicleInput.brand || null,
      model: vehicleInput.model || null,
      color: vehicleInput.color || null,
      notes: vehicleInput.notes || null,
    });
  }

  if (parsedVehicles.length) {
    const conflictingVehicle = await prisma.vehicle.findFirst({
      where: {
        businessId,
        plateNumber: {
          in: parsedVehicles.map((vehicle) => vehicle.plateNumber),
        },
        id: { notIn: parsedVehicles.map((vehicle) => vehicle.id) },
      },
      select: { id: true },
    });

    if (conflictingVehicle) {
      throw new Error("Another vehicle in this business already uses this plate.");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customer.id },
      data: {
        branchId,
        name: input.name,
        phone: input.phone,
        email: input.email || null,
        notes: input.notes || null,
      },
    });

    for (const vehicle of parsedVehicles) {
      await tx.vehicle.update({
        where: { id: vehicle.id },
        data: {
          branchId: vehicle.branchId,
          plateNumber: vehicle.plateNumber,
          brand: vehicle.brand,
          model: vehicle.model,
          color: vehicle.color,
          notes: vehicle.notes,
        },
      });
    }
  });

  revalidatePath("/crm");
  revalidatePath("/crm/customers");
  revalidatePath("/crm/vehicles");
  revalidatePath(`/crm/customers/${customer.id}`);
  redirect(`/crm/customers/${customer.id}`);
}

export async function deleteCustomerAction(
  _previousState: DeleteCustomerState,
  formData: FormData,
): Promise<DeleteCustomerState> {
  const { businessId, user } = await requireCrmUser();
  assertStaffPermission(user, "DELETE_CUSTOMER");
  const customerId = formData.get("customerId")?.toString();

  if (!customerId) {
    return {
      status: "error",
      message: "Customer id is required.",
    };
  }

  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      businessId,
    },
    include: {
      vehicles: {
        include: {
          _count: {
            select: {
              workOrders: true,
              ownershipHistories: true,
            },
          },
        },
      },
      _count: {
        select: {
          workOrders: true,
          customerPackages: true,
          previousVehicleOwnerships: true,
          newVehicleOwnerships: true,
        },
      },
    },
  });

  if (!customer) {
    return {
      status: "error",
      message: "Customer not found.",
    };
  }

  const blockingReasons: string[] = [];

  if (customer._count.workOrders > 0) {
    blockingReasons.push("work orders");
  }

  if (customer._count.customerPackages > 0) {
    blockingReasons.push("packages");
  }

  if (
    customer._count.previousVehicleOwnerships > 0 ||
    customer._count.newVehicleOwnerships > 0
  ) {
    blockingReasons.push("ownership history");
  }

  if (
    customer.vehicles.some(
      (vehicle) =>
        vehicle._count.workOrders > 0 || vehicle._count.ownershipHistories > 0,
    )
  ) {
    blockingReasons.push("vehicle history");
  }

  if (blockingReasons.length > 0) {
    return {
      status: "error",
      message: `Cannot delete this customer because it has ${blockingReasons.join(
        ", ",
      )}. Keep it for history accuracy.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.vehicle.deleteMany({
      where: {
        businessId,
        customerId: customer.id,
      },
    });

    await tx.customer.delete({
      where: { id: customer.id },
    });
  });

  revalidatePath("/crm");
  revalidatePath("/crm/customers");
  revalidatePath("/crm/vehicles");
  redirect("/crm/customers");
}

export async function createVehicleAction(formData: FormData) {
  const { businessId } = await requireCrmUser();
  const branchId = await resolveBranchId(businessId, formData.get("branchId"));
  const input = vehicleSchema.parse({
    customerId: formData.get("customerId"),
    plateNumber: formData.get("plateNumber"),
    brand: formData.get("brand"),
    model: formData.get("model"),
    color: formData.get("color"),
    notes: formData.get("notes"),
  });

  const customer = await prisma.customer.findFirstOrThrow({
    where: {
      id: input.customerId,
      businessId,
    },
  });
  const resolvedVehicleSize = await resolveVehicleSize(businessId, input.brand, input.model);

  await prisma.vehicle.create({
    data: {
      businessId,
      branchId,
      customerId: customer.id,
      plateNumber: normalizePlateNumber(input.plateNumber),
      brand: input.brand || null,
      model: input.model || null,
      color: input.color || null,
      size: resolvedVehicleSize.size,
      sizeSource: resolvedVehicleSize.source,
      notes: input.notes || null,
    },
  });

  revalidatePath("/crm");
  revalidatePath("/crm/vehicles");
  revalidatePath(`/crm/customers/${customer.id}`);
  redirect(`/crm/customers/${customer.id}`);
}

export async function updateVehicleAction(formData: FormData) {
  const { businessId } = await requireCrmUser();
  const vehicleId = formData.get("vehicleId")?.toString();

  if (!vehicleId) {
    throw new Error("Vehicle id is required.");
  }

  const branchId = await resolveBranchId(businessId, formData.get("branchId"));
  const input = vehicleSchema.parse({
    customerId: formData.get("customerId"),
    plateNumber: formData.get("plateNumber"),
    brand: formData.get("brand"),
    model: formData.get("model"),
    color: formData.get("color"),
    notes: formData.get("notes"),
  });

  const [vehicle, customer] = await Promise.all([
    prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        businessId,
      },
      select: { id: true, customerId: true },
    }),
    prisma.customer.findFirst({
      where: {
        id: input.customerId,
        businessId,
      },
      select: { id: true },
    }),
  ]);

  if (!vehicle || !customer || vehicle.customerId !== customer.id) {
    throw new Error("Vehicle not found.");
  }

  const plateNumber = normalizePlateNumber(input.plateNumber);
  const resolvedVehicleSize = await resolveVehicleSize(businessId, input.brand, input.model);
  const existingPlate = await prisma.vehicle.findFirst({
    where: {
      businessId,
      plateNumber,
      id: { not: vehicle.id },
    },
    select: { id: true },
  });

  if (existingPlate) {
    throw new Error("Another vehicle in this business already uses this plate.");
  }

  await prisma.vehicle.update({
    where: { id: vehicle.id },
    data: {
      branchId,
      plateNumber,
      brand: input.brand || null,
      model: input.model || null,
      color: input.color || null,
      size: resolvedVehicleSize.size,
      sizeSource: resolvedVehicleSize.source,
      notes: input.notes || null,
    },
  });

  revalidatePath("/crm");
  revalidatePath("/crm/vehicles");
  revalidatePath(`/crm/customers/${customer.id}`);
  redirect(`/crm/customers/${customer.id}`);
}
