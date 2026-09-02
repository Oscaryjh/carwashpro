import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { resolveStaffAppAppearance } from "./appearance-config";

export const loadStaffAppAppearance = cache(async (businessId: string) => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      staffAppLogoUrl: true,
      staffAppAppearance: true,
    },
  });

  return resolveStaffAppAppearance(
    business?.staffAppAppearance,
    business?.staffAppLogoUrl ?? null,
  );
});
