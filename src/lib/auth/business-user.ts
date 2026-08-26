import { redirect } from "next/navigation";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import {
  ModuleNotEnabledError,
  requireBusinessModules,
} from "@/lib/modules/entitlements";
import { modulesForCapability, type ModuleKey } from "@/lib/modules/registry";
import { requireBusinessContext } from "@/lib/tenant";

export async function requireBusinessUser(capability?: BusinessCapability) {
  return requireBusinessUserAccess(capability);
}

export async function requireBusinessUserWithAnyCapability(
  capabilities: readonly BusinessCapability[],
) {
  const context = await requireBusinessUserAccess();
  const matchedCapability = capabilities.find((capability) =>
    hasBusinessCapability(context.access, capability),
  );

  if (!matchedCapability) {
    redirect("/login?error=business-access-denied");
  }

  try {
    const moduleContext = await requireBusinessModules(
      context.businessId,
      modulesForCapability(matchedCapability, context.industryType),
    );
    return { ...context, moduleContext };
  } catch (error) {
    if (error instanceof ModuleNotEnabledError) {
      redirect(`/module-not-enabled?module=${error.moduleKey}`);
    }
    throw error;
  }
}

export async function requireBusinessUserForModule(
  moduleKey: ModuleKey,
  capability?: BusinessCapability,
) {
  return requireBusinessUserAccess(capability, [moduleKey]);
}

async function requireBusinessUserAccess(
  capability?: BusinessCapability,
  explicitModules: readonly ModuleKey[] = [],
) {
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

  const requiredModules = [
    ...new Set([
      ...modulesForCapability(capability, context.industryType),
      ...explicitModules,
    ]),
  ];
  try {
    const moduleContext = await requireBusinessModules(
      context.businessId,
      requiredModules,
    );
    return { ...context, moduleContext };
  } catch (error) {
    if (error instanceof ModuleNotEnabledError) {
      redirect(`/module-not-enabled?module=${error.moduleKey}`);
    }
    throw error;
  }

}
