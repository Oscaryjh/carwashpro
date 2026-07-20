import type { ReactNode } from "react";
import { AppShellFrame } from "@/components/app-shell-frame";
import { hasStaffPermission } from "@/lib/auth/staff-permissions";
import type { AppSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getBusinessHomeHref } from "@/lib/business-industry";

type AppShellProps = {
  user: AppSession;
  children: ReactNode;
};

export async function AppShell({ user, children }: AppShellProps) {
  const isPlatformAdmin = user.role === "PLATFORM_ADMIN";
  const isBusinessOwner = user.role === "BUSINESS_OWNER";
  const isStaff = user.role === "STAFF";
  const isStoreUser = isBusinessOwner || isStaff;
  const canSee = (permission: Parameters<typeof hasStaffPermission>[1]) =>
    isBusinessOwner || hasStaffPermission(user, permission);
  const business = user.businessId
    ? await prisma.business.findUnique({
        where: { id: user.businessId },
        select: { name: true, logoUrl: true, industryType: true },
      })
    : null;
  const isSalonBusiness = business?.industryType === "SALON_BEAUTY";
  const homeHref = isPlatformAdmin
    ? "/admin/businesses"
    : getBusinessHomeHref(business?.industryType ?? "AUTO_DETAILING");
  const whatsAppUnreadCount =
    user.businessId && isStoreUser && canSee("WHATSAPP")
      ? (
          await prisma.whatsAppConversation.aggregate({
            where: {
              businessId: user.businessId,
              unreadCount: { gt: 0 },
            },
            _sum: { unreadCount: true },
          })
        )._sum.unreadCount ?? 0
      : 0;
  const brandName = business?.name ?? "TETAMU POS";
  const navItems = [
    ...(isPlatformAdmin
      ? [
          {
            href: "/admin/businesses",
            label: "Businesses",
            shortLabel: "Biz",
            icon: "businesses" as const,
          },
          {
            href: "/admin/whatsapp-templates",
            label: "WhatsApp Templates",
            shortLabel: "WA",
            icon: "whatsapp" as const,
          },
          {
            href: "/admin/vehicle-size-defaults",
            label: "Vehicle Size Defaults",
            shortLabel: "Sizes",
            icon: "services" as const,
          },
        ]
      : []),
    ...(!isSalonBusiness && isStoreUser && canSee("JOBS")
      ? [
          {
            href: "/work-orders",
            label: "Cashier",
            shortLabel: "Cashier",
            icon: "jobs" as const,
          },
        ]
      : []),
    ...(isSalonBusiness && isStoreUser && canSee("POS")
      ? [
          {
            href: "/cashier",
            label: "Cashier",
            shortLabel: "Cashier",
            icon: "jobs" as const,
          },
        ]
      : []),
    ...(isStoreUser && canSee("APPOINTMENTS")
      ? [
          {
            href: "/appointments",
            label: "Appointments",
            shortLabel: "Appt",
            icon: "appointments" as const,
          },
        ]
      : []),
    ...(isStoreUser && canSee("CRM")
      ? [{ href: "/crm", label: "CRM", shortLabel: "CRM", icon: "crm" as const }]
      : []),
    ...(!isSalonBusiness && isStoreUser && canSee("LOYALTY")
      ? [
          {
            href: "/loyalty",
            label: "Membership",
            shortLabel: "Member",
            icon: "packages" as const,
          },
        ]
      : []),
    ...(isStoreUser && canSee("INVOICES")
      ? [
          {
            href: "/invoices",
            label: "Invoices",
            shortLabel: "Inv",
            icon: "invoices" as const,
          },
        ]
      : []),
    ...(isStoreUser && canSee("CLOSING")
      ? [
          {
            href: "/closing",
            label: "Shift Closing",
            shortLabel: "Close",
            icon: "reports" as const,
          },
        ]
      : []),
    ...(isStoreUser && canSee("WHATSAPP")
      ? [
          {
            href: "/whatsapp/inbox",
            label: "WhatsApp",
            shortLabel: "WA",
            icon: "whatsapp" as const,
            badgeCount: whatsAppUnreadCount,
          },
        ]
      : []),
    ...(isStoreUser && canSee("TEAM")
      ? [
          {
            href: "/team",
            label: "Team & Permissions",
            shortLabel: "Team & Permissions",
            icon: "team" as const,
          },
        ]
      : []),
    ...(isStoreUser && canSee("REPORTS")
      ? [
          {
            href: "/reports",
            label: "Reports",
            shortLabel: "Rpt",
            icon: "reports" as const,
          },
        ]
      : []),
    ...(isStoreUser && canSee("SERVICES")
      ? [
          {
            href: "/services",
            label: "Services",
            shortLabel: "Svc",
            icon: "services" as const,
          },
        ]
      : []),
    ...(isStoreUser && canSee("PACKAGES")
      ? [
          {
            href: "/packages",
            label: "Packages",
            shortLabel: "Pkg",
            icon: "packages" as const,
          },
        ]
      : []),
    ...(isStoreUser && canSee("PRODUCTS")
      ? [
          {
            href: "/products",
            label: "Products",
            shortLabel: "Prod",
            icon: "services" as const,
          },
        ]
      : []),
    ...(isBusinessOwner
      ? [
          {
            href: "/business/settings",
            label: "Company settings",
            shortLabel: "Set",
            icon: "settings" as const,
          },
        ]
      : []),
  ];

  return (
    <AppShellFrame
      brandName={brandName}
      logoUrl={business?.logoUrl}
      homeHref={homeHref}
      navItems={navItems}
    >
      {children}
    </AppShellFrame>
  );
}
