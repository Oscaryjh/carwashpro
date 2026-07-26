import { redirect } from "next/navigation";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import { requireBusinessContext } from "@/lib/tenant";

export async function requireBusinessUser(capability?: BusinessCapability) {
  const context = await requireBusinessContext({ capability });

  if (context.access.source === "PLATFORM_ADMIN") {
    redirect("/admin/businesses");
  }

  if (
    !["BUSINESS_OWNER", "STAFF", "GROUP_MANAGER_READ_ONLY"].includes(
      context.access.effectiveBusinessRole,
    )
  ) {
    redirect("/dashboard");
  }

  return context;
}
