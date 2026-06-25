"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { branchSchema } from "@/lib/validation/branches";

async function requireBusinessOwner() {
  const context = await requireBusinessUser();

  if (context.user.role !== "BUSINESS_OWNER") {
    throw new Error("Only business owners can manage branches.");
  }

  return context;
}

export async function createBranchAction(formData: FormData) {
  const { businessId } = await requireBusinessOwner();
  const input = branchSchema.parse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    address: formData.get("address"),
    status: "ACTIVE",
  });

  const existing = await prisma.branch.findFirst({
    where: {
      businessId,
      name: input.name,
    },
  });

  if (existing) {
    throw new Error("Branch name already exists in this business.");
  }

  const branch = await prisma.branch.create({
    data: {
      businessId,
      name: input.name,
      phone: input.phone || null,
      address: input.address || null,
      status: "ACTIVE",
    },
  });

  revalidatePath("/branches");
  redirect(`/branches/${branch.id}`);
}

export async function updateBranchAction(formData: FormData) {
  const { businessId } = await requireBusinessOwner();
  const branchId = formData.get("branchId")?.toString();

  if (!branchId) {
    throw new Error("Branch id is required.");
  }

  const input = branchSchema.parse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    address: formData.get("address"),
    status: formData.get("status"),
  });

  const branch = await prisma.branch.findFirstOrThrow({
    where: {
      id: branchId,
      businessId,
    },
  });

  const duplicate = await prisma.branch.findFirst({
    where: {
      businessId,
      name: input.name,
      id: { not: branch.id },
    },
  });

  if (duplicate) {
    throw new Error("Branch name already exists in this business.");
  }

  await prisma.branch.update({
    where: { id: branch.id },
    data: {
      name: input.name,
      phone: input.phone || null,
      address: input.address || null,
      status: input.status,
    },
  });

  revalidatePath("/branches");
  revalidatePath(`/branches/${branch.id}`);
}

export async function deactivateBranchAction(formData: FormData) {
  const { businessId } = await requireBusinessOwner();
  const branchId = formData.get("branchId")?.toString();

  if (!branchId) {
    throw new Error("Branch id is required.");
  }

  const branch = await prisma.branch.findFirstOrThrow({
    where: {
      id: branchId,
      businessId,
    },
  });

  await prisma.branch.update({
    where: { id: branch.id },
    data: { status: "INACTIVE" },
  });

  revalidatePath("/branches");
  revalidatePath(`/branches/${branch.id}`);
}
