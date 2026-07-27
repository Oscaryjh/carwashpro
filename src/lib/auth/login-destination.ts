import type { BusinessIndustry, UserRole } from "@prisma/client";
import { getBusinessHomeHref } from "@/lib/business-industry";

export function getLoginDestination(input: {
  role: UserRole;
  businessId: string | null;
  industryType: BusinessIndustry | null;
}) {
  if (input.role === "PLATFORM_ADMIN") {
    return "/admin/businesses";
  }

  if (!input.businessId) {
    return "/business-context/recover";
  }

  return getBusinessHomeHref(input.industryType ?? "AUTO_DETAILING");
}
