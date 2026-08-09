import { requireBusinessUser } from "@/lib/auth/business-user";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";

export async function requireCrmUser(
  capability: BusinessCapability = "VIEW_CRM",
) {
  return requireBusinessUser(capability);
}
