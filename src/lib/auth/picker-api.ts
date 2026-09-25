import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasBusinessCapability, resolveBusinessAccess } from "@/lib/business-groups/business-access";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { modulesForCapability } from "@/lib/modules/registry";

const readCapabilities: readonly BusinessCapability[] = [
  "VIEW_CRM", "VIEW_APPOINTMENTS", "VIEW_WORK_ORDERS", "PROCESS_CASHIER_PAYMENT",
];
const writeCapabilities: readonly BusinessCapability[] = [
  "MODIFY_CRM", "MODIFY_APPOINTMENTS", "MODIFY_WORK_ORDERS", "PROCESS_CASHIER_PAYMENT",
];

export async function getPickerApiContext(operation: "read" | "write") {
  const session = await getSession();
  if (!session || session.status !== "active") {
    return { response: NextResponse.json({ ok: false, error: "Session expired." }, { status: 401 }) };
  }
  if (!session.businessId || !["BUSINESS_OWNER", "STAFF"].includes(session.role)) {
    return { response: NextResponse.json({ ok: false, error: "Access is not allowed." }, { status: 403 }) };
  }

  const access = await resolveBusinessAccess({
    userId: session.userId,
    requestedBusinessId: session.businessId,
  });
  if (!access.granted || access.source !== "DIRECT_BUSINESS" || !access.businessId || !access.industryType) {
    return { response: NextResponse.json({ ok: false, error: "Access is not allowed." }, { status: 403 }) };
  }

  const modules = await loadBusinessModuleContext(access.businessId);
  const capabilities = operation === "read" ? readCapabilities : writeCapabilities;
  const permitted = capabilities.some((capability) =>
    hasBusinessCapability(access, capability) &&
    modulesForCapability(capability, access.industryType!).every((moduleKey) =>
      modules.enabledModules.has(moduleKey),
    ),
  );
  if (!permitted) {
    return { response: NextResponse.json({ ok: false, error: "Access is not allowed." }, { status: 403 }) };
  }

  return {
    businessId: access.businessId,
    user: {
      ...session,
      businessId: access.businessId,
      branchId: access.branchId,
      permissions: access.permissions,
    },
  };
}
