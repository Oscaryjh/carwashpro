"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertCanManageBusiness, assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { businessSchema, createBusinessSchema } from "@/lib/validation/business";

export async function createBusinessAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);

  const input = createBusinessSchema.parse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    phone: formData.get("phone"),
    ownerName: formData.get("ownerName"),
    ownerEmail: formData.get("ownerEmail"),
    ownerPassword: formData.get("ownerPassword"),
  });
  const ownerEmail = input.ownerEmail.toLowerCase();

  const [existingBusiness, existingUser] = await Promise.all([
    prisma.business.findUnique({ where: { slug: input.slug } }),
    prisma.user.findUnique({ where: { email: ownerEmail } }),
  ]);

  if (existingBusiness) {
    throw new Error("Business slug already exists.");
  }

  if (existingUser) {
    throw new Error("Owner email already exists.");
  }

  const created = await prisma.$transaction(async (tx) => {
    const newBusiness = await tx.business.create({
      data: {
        name: input.name,
        slug: input.slug,
        phone: input.phone || null,
        status: "active",
      },
    });

    const passwordHash = await bcrypt.hash(input.ownerPassword, 12);

    await tx.user.create({
      data: {
        businessId: newBusiness.id,
        name: input.ownerName,
        email: ownerEmail,
        passwordHash,
        role: "BUSINESS_OWNER",
        status: "active",
      },
    });

    return newBusiness;
  });

  revalidatePath("/admin/businesses");
  redirect(`/admin/businesses/${created.id}`);
}

export async function updateBusinessAction(formData: FormData) {
  const user = await requireUser();
  const businessId = formData.get("businessId")?.toString();

  if (!businessId) {
    throw new Error("Business id is required.");
  }

  assertCanManageBusiness(user, businessId);

  const current = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
  });

  const parsed = businessSchema.parse({
    name: formData.get("name"),
    slug: formData.get("slug") ?? current.slug,
    phone: formData.get("phone"),
    email: formData.get("email"),
    address: formData.get("address"),
    status: user.role === "PLATFORM_ADMIN" ? formData.get("status") : current.status,
  });

  await prisma.business.update({
    where: { id: businessId },
    data: {
      name: parsed.name,
      phone: parsed.phone || null,
      email: parsed.email || null,
      address: parsed.address || null,
      status: parsed.status,
    },
  });

  revalidatePath("/admin/businesses");
  revalidatePath(`/admin/businesses/${businessId}`);
  revalidatePath("/business/settings");

  if (user.role === "PLATFORM_ADMIN") {
    redirect(`/admin/businesses/${businessId}`);
  }

  redirect("/business/settings");
}
