"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireBusinessUser } from "@/lib/auth/business-user";

const schema = z.object({
  brand: z.string().trim().min(1),
  model: z.string().trim().min(1),
  size: z.enum(["SMALL", "MEDIUM", "LARGE"]),
});
const normalize = (value: string) => value.trim().toLocaleLowerCase();

export async function saveBusinessVehicleSizeOverrideAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const input = schema.parse({ brand: formData.get("brand"), model: formData.get("model"), size: formData.get("size") });
  await prisma.businessVehicleSizeOverride.upsert({
    where: { businessId_normalizedBrand_normalizedModel: { businessId, normalizedBrand: normalize(input.brand), normalizedModel: normalize(input.model) } },
    update: { brand: input.brand, model: input.model, size: input.size },
    create: { businessId, brand: input.brand, model: input.model, normalizedBrand: normalize(input.brand), normalizedModel: normalize(input.model), size: input.size },
  });
  revalidatePath("/business/settings");
}

export async function removeBusinessVehicleSizeOverrideAction(formData: FormData) {
  const { businessId } = await requireBusinessUser();
  const id = z.string().uuid().parse(formData.get("id"));
  await prisma.businessVehicleSizeOverride.deleteMany({ where: { id, businessId } });
  revalidatePath("/business/settings");
}
