import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export async function getBusinessContext() {
  const user = await requireUser();

  if (user.role === "PLATFORM_ADMIN") {
    return {
      user,
      isPlatformAdmin: true,
      businessId: user.businessId,
    };
  }

  if (!user.businessId) {
    redirect("/login");
  }

  const business = await prisma.business.findUnique({
    where: { id: user.businessId },
    select: { id: true, industryType: true },
  });

  if (!business) {
    redirect("/logout?error=business-not-found");
  }

  return {
    user,
    isPlatformAdmin: false,
    businessId: user.businessId,
    industryType: business.industryType,
  };
}

export async function requireBusinessContext() {
  const context = await getBusinessContext();

  if (!context.businessId) {
    redirect("/admin/businesses");
  }

  return {
    user: context.user,
    businessId: context.businessId,
    industryType: context.industryType,
  };
}

export function withBusinessScope<TWhere extends Record<string, unknown>>(
  businessId: string,
  where?: TWhere,
) {
  return {
    ...where,
    businessId,
  };
}
