"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCrmUser } from "@/lib/auth/crm";
import { resolveBranchId } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import {
  customerVehicleSchema,
  customerSchema,
  normalizePlateNumber,
  vehicleSchema,
} from "@/lib/validation/crm";
import { newCustomerWelcomeTemplate } from "@/lib/whatsapp/templates";

export async function createCustomerAction(formData: FormData) {
  const { businessId } = await requireCrmUser();
  const branchId = await resolveBranchId(businessId, formData.get("branchId"));
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

  const customer = await prisma.$transaction(async (tx) => {
    const business = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
    });

    const created = await tx.customer.create({
      data: {
        businessId,
        branchId,
        name: input.name,
        phone: input.phone,
        email: input.email || null,
        notes: input.notes || null,
      },
    });

    if (vehicleInput) {
      await tx.vehicle.create({
        data: {
          businessId,
          branchId,
          customerId: created.id,
          plateNumber: normalizePlateNumber(vehicleInput.plateNumber),
          brand: vehicleInput.brand || null,
          model: vehicleInput.model || null,
          color: vehicleInput.color || null,
          notes: vehicleInput.notes || null,
        },
      });
    }

    await tx.whatsAppMessage.create({
      data: {
        businessId,
        branchId,
        customerId: created.id,
        phone: created.phone,
        messageType: "NEW_CUSTOMER_WELCOME",
        messageBody: newCustomerWelcomeTemplate({
          businessName: business.name,
          customerName: created.name,
        }),
        status: "READY",
      },
    });

    return created;
  });

  revalidatePath("/crm");
  revalidatePath("/crm/customers");
  revalidatePath("/crm/vehicles");
  revalidatePath("/whatsapp");
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
      phone: input.phone,
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

  await prisma.vehicle.create({
    data: {
      businessId,
      branchId,
      customerId: customer.id,
      plateNumber: normalizePlateNumber(input.plateNumber),
      brand: input.brand || null,
      model: input.model || null,
      color: input.color || null,
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
      notes: input.notes || null,
    },
  });

  revalidatePath("/crm");
  revalidatePath("/crm/vehicles");
  revalidatePath(`/crm/customers/${customer.id}`);
  redirect(`/crm/customers/${customer.id}`);
}
