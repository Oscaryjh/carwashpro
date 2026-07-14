import type { PackageVehicleSize, VehicleSize } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export function packageAllowsVehicle(eligible: PackageVehicleSize, vehicleSize: VehicleSize) {
  if (vehicleSize === "UNCLASSIFIED") return false;
  return eligible === "ALL" || eligible === vehicleSize;
}

export function vehicleSizeLabel(size: VehicleSize | PackageVehicleSize) {
  return size === "UNCLASSIFIED" ? "Unclassified" : size[0] + size.slice(1).toLowerCase();
}

const normalize = (value: string | null | undefined) =>
  value?.trim().toLocaleLowerCase() ?? "";

export async function resolveVehicleSize(
  businessId: string,
  brand: string | null | undefined,
  model: string | null | undefined,
): Promise<{ size: VehicleSize; source: "BUSINESS_OVERRIDE" | "PLATFORM_DEFAULT" | "UNCLASSIFIED" }> {
  const normalizedBrand = normalize(brand);
  const normalizedModel = normalize(model);
  if (!normalizedBrand || !normalizedModel) {
    return { size: "UNCLASSIFIED", source: "UNCLASSIFIED" };
  }

  const override = await prisma.businessVehicleSizeOverride.findUnique({
    where: { businessId_normalizedBrand_normalizedModel: { businessId, normalizedBrand, normalizedModel } },
    select: { size: true },
  });
  if (override) return { size: override.size, source: "BUSINESS_OVERRIDE" };

  const platformDefault = await prisma.vehicleModelSizeDefault.findUnique({
    where: { normalizedBrand_normalizedModel: { normalizedBrand, normalizedModel } },
    select: { size: true, active: true },
  });
  if (platformDefault?.active) return { size: platformDefault.size, source: "PLATFORM_DEFAULT" };

  return { size: "UNCLASSIFIED", source: "UNCLASSIFIED" };
}
