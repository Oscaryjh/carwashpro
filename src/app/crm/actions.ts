"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCrmUser } from "@/lib/auth/crm";
import { prisma } from "@/lib/prisma";
import {
  customerSchema,
  normalizePlateNumber,
  vehicleSchema,
} from "@/lib/validation/crm";
import { newCustomerWelcomeTemplate } from "@/lib/whatsapp/templates";

export async function createCustomerAction(formData: FormData) {
  const { businessId } = await requireCrmUser();
  const input = customerSchema.parse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    notes: formData.get("notes"),
  });

  const customer = await prisma.$transaction(async (tx) => {
    const business = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
    });

    const created = await tx.customer.create({
      data: {
        businessId,
        name: input.name,
        phone: input.phone,
        email: input.email || null,
        notes: input.notes || null,
      },
    });

    await tx.whatsAppMessage.create({
      data: {
        businessId,
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

  revalidatePath("/crm/customers");
  revalidatePath("/whatsapp");
  redirect(`/crm/customers/${customer.id}`);
}

export async function createVehicleAction(formData: FormData) {
  const { businessId } = await requireCrmUser();
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
      customerId: customer.id,
      plateNumber: normalizePlateNumber(input.plateNumber),
      brand: input.brand || null,
      model: input.model || null,
      color: input.color || null,
      notes: input.notes || null,
    },
  });

  revalidatePath("/crm/vehicles");
  revalidatePath(`/crm/customers/${customer.id}`);
  redirect(`/crm/customers/${customer.id}`);
}
