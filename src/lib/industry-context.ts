import { getIndustryConfig } from "@/config/industry-config";
import { requireBusinessUser } from "@/lib/auth/business-user";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";

/**
 * Loads the authenticated business context together with its shared industry
 * configuration so pages do not need to repeat industry-specific lookups.
 */
export async function requireBusinessIndustryContext(
  capability?: BusinessCapability,
) {
  const context = await requireBusinessUser(capability);

  return {
    ...context,
    industry: getIndustryConfig(context.industryType),
  };
}
