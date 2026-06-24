import { redirect } from "next/navigation";
import { requireBusinessContext } from "@/lib/tenant";

export async function requireBusinessUser() {
  const context = await requireBusinessContext();

  if (context.user.role === "PLATFORM_ADMIN") {
    redirect("/admin/businesses");
  }

  if (!["BUSINESS_OWNER", "STAFF"].includes(context.user.role)) {
    redirect("/dashboard");
  }

  return context;
}
