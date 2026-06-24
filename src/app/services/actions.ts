"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { money, serviceSchema } from "@/lib/validation/services";

export async function createServiceAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const input = serviceSchema.parse({
    name: formData.get("name"),
    description: formData.get("description"),
    price: formData.get("price"),
    status: "ACTIVE",
  });

  const existing = await prisma.service.findFirst({
    where: {
      businessId,
      name: input.name,
    },
  });

  if (existing) {
    throw new Error("Service name already exists in this business.");
  }

  await prisma.service.create({
    data: {
      businessId,
      name: input.name,
      description: input.description || null,
      price: money(input.price),
      status: "ACTIVE",
    },
  });

  revalidatePath("/services");
  redirect("/services");
}

export async function updateServiceAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const serviceId = formData.get("serviceId")?.toString();

  if (!serviceId) {
    throw new Error("Service id is required.");
  }

  const input = serviceSchema.parse({
    name: formData.get("name"),
    description: formData.get("description"),
    price: formData.get("price"),
    status: formData.get("status"),
  });

  const service = await prisma.service.findFirstOrThrow({
    where: {
      id: serviceId,
      businessId,
    },
  });

  const duplicate = await prisma.service.findFirst({
    where: {
      businessId,
      name: input.name,
      id: {
        not: service.id,
      },
    },
  });

  if (duplicate) {
    throw new Error("Service name already exists in this business.");
  }

  await prisma.service.update({
    where: { id: service.id },
    data: {
      name: input.name,
      description: input.description || null,
      price: money(input.price),
      status: input.status,
    },
  });

  revalidatePath("/services");
}

export async function deactivateServiceAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const serviceId = formData.get("serviceId")?.toString();

  if (!serviceId) {
    throw new Error("Service id is required.");
  }

  const service = await prisma.service.findFirstOrThrow({
    where: {
      id: serviceId,
      businessId,
    },
  });

  await prisma.service.update({
    where: { id: service.id },
    data: { status: "INACTIVE" },
  });

  revalidatePath("/services");
}
