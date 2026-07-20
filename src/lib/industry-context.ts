import { getIndustryConfig } from "@/config/industry-config";
import { requireBusinessUser } from "@/lib/auth/business-user";

/**
 * Loads the authenticated business context together with its shared industry
 * configuration so pages do not need to repeat industry-specific lookups.
 */
export async function requireBusinessIndustryContext() {
  const context = await requireBusinessUser();

  return {
    ...context,
    industry: getIndustryConfig(context.industryType),
  };
}
