"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  brand: z.string().trim().min(1),
  model: z.string().trim().min(1),
  size: z.enum(["SMALL", "MEDIUM", "LARGE"]),
});

const normalize = (value: string) => value.trim().toLocaleLowerCase();

export async function createVehicleSizeDefaultAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const input = schema.parse({
    brand: formData.get("brand"),
    model: formData.get("model"),
    size: formData.get("size"),
  });

  await prisma.vehicleModelSizeDefault.upsert({
    where: {
      normalizedBrand_normalizedModel: {
        normalizedBrand: normalize(input.brand),
        normalizedModel: normalize(input.model),
      },
    },
    update: { brand: input.brand, model: input.model, size: input.size, active: true },
    create: {
      brand: input.brand,
      model: input.model,
      normalizedBrand: normalize(input.brand),
      normalizedModel: normalize(input.model),
      size: input.size,
    },
  });

  revalidatePath("/admin/vehicle-size-defaults");
  redirect("/admin/vehicle-size-defaults?saved=1");
}

export async function deactivateVehicleSizeDefaultAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const id = z.string().uuid().parse(formData.get("id"));
  await prisma.vehicleModelSizeDefault.update({ where: { id }, data: { active: false } });
  revalidatePath("/admin/vehicle-size-defaults");
}
