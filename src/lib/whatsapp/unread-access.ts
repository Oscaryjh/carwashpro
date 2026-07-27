import type { AppSession } from "@/lib/auth/session";
import { hasStaffPermission } from "@/lib/auth/staff-permissions";

type WhatsAppUnreadAccess =
  | {
      granted: true;
      businessId: string | null;
      effectiveBusinessRole:
        | "BUSINESS_OWNER"
        | "STAFF"
        | "GROUP_MANAGER_READ_ONLY"
        | "PLATFORM_ADMIN";
      source: "DIRECT_BUSINESS" | "GROUP_ACCESS" | "PLATFORM_ADMIN";
    }
  | { granted: false };

type WhatsAppNavItem = {
  href: string;
  children?: readonly WhatsAppNavItem[];
};

export function canReadWhatsAppUnreadCount(
  session: Pick<AppSession, "role" | "permissions">,
  access: WhatsAppUnreadAccess,
) {
  if (!access.granted || !access.businessId) {
    return false;
  }

  if (access.effectiveBusinessRole === "BUSINESS_OWNER") {
    return true;
  }

  return (
    access.source === "DIRECT_BUSINESS" &&
    hasStaffPermission(session, "WHATSAPP")
  );
}

export function shouldPollWhatsAppUnread(
  items: readonly WhatsAppNavItem[],
): boolean {
  return items.some(
    (item) =>
      item.href === "/whatsapp/inbox" ||
      (item.children ? shouldPollWhatsAppUnread(item.children) : false),
  );
}
