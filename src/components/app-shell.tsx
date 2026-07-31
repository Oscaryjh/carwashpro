import type { ReactNode } from "react";
import { AppShellFrame } from "@/components/app-shell-frame";
import type { NavItem } from "@/components/app-shell-frame";
import { BusinessContextSwitcher } from "@/components/business-context-switcher";
import { createBusinessContextToken } from "@/lib/auth/business-context-token";
import { hasStaffPermission } from "@/lib/auth/staff-permissions";
import type { AppSession } from "@/lib/auth/session";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import {
  getAvailableBusinessContexts,
} from "@/lib/business-groups/business-context";
import { getAvailableGroupReportingContexts } from "@/lib/business-groups/all-stores-access";
import {
  canGroupManager,
  type BusinessCapability,
} from "@/lib/business-groups/capabilities";
import { prisma } from "@/lib/prisma";
import { getBusinessHomeHref } from "@/lib/business-industry";

type AppShellProps = {
  user: AppSession;
  access?: ResolvedBusinessAccess;
  children: ReactNode;
};

export async function AppShell({ user, access, children }: AppShellProps) {
  const isPlatformAdmin = user.role === "PLATFORM_ADMIN";
  const grantedAccess = access?.granted ? access : null;
  const isBusinessOwner =
    grantedAccess?.effectiveBusinessRole === "BUSINESS_OWNER" ||
    (!grantedAccess && user.role === "BUSINESS_OWNER");
  const isGroupManager =
    grantedAccess?.effectiveBusinessRole === "GROUP_MANAGER_READ_ONLY";
  const isStaff = user.role === "STAFF" || isGroupManager;
  const isStoreUser = isBusinessOwner || isStaff;
  const canSee = (permission: Parameters<typeof hasStaffPermission>[1]) =>
    isBusinessOwner || hasStaffPermission(user, permission);
  const canSeeCapability = (
    permission: Parameters<typeof hasStaffPermission>[1],
    capability: BusinessCapability,
  ) =>
    isBusinessOwner ||
    (isGroupManager ? canGroupManager(capability) : canSee(permission));
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
  const catalogChildren: NavItem[] = [
    ...(isStoreUser && canSeeCapability("SERVICES", "VIEW_CATALOG")
      ? [{ href: "/services", label: "Services", shortLabel: "Svc", icon: "services" as const }]
      : []),
    ...(isStoreUser && canSeeCapability("PACKAGES", "VIEW_CATALOG")
      ? [{ href: "/packages", label: "Packages", shortLabel: "Pkg", icon: "packages" as const }]
      : []),
    ...(isStoreUser && canSeeCapability("PRODUCTS", "VIEW_INVENTORY")
      ? [{ href: "/products", label: "Products", shortLabel: "Prod", icon: "services" as const }]
      : []),
    ...(isStoreUser && canSeeCapability("DISCOUNTS", "VIEW_CATALOG")
      ? [{ href: "/discounts", label: "Discounts", shortLabel: "Disc", icon: "reports" as const }]
      : []),
  ];
  const teamChildren: NavItem[] = [
    ...(isStoreUser &&
    (canSeeCapability("TEAM", "VIEW_TEAM_DIRECTORY") ||
      canSeeCapability(
        "ATTENDANCE_EMPLOYEE_READ",
        "VIEW_ATTENDANCE_EMPLOYEES",
      ))
      ? [
          {
            href: canSeeCapability("TEAM", "VIEW_TEAM_DIRECTORY")
              ? "/team"
              : "/team/employees",
            label: "People",
            shortLabel: "People",
            icon: "team" as const,
          },
        ]
      : []),
    ...(isStoreUser &&
    canSeeCapability(
      "ATTENDANCE_EMPLOYEE_READ",
      "VIEW_ATTENDANCE_EMPLOYEES",
    )
      ? [
          {
            href: "/team/attendance",
            label: "Attendance",
            shortLabel: "Attend",
            icon: "reports" as const,
          },
        ]
      : []),
    ...(isStoreUser &&
    canSeeCapability("PAYROLL_READ", "VIEW_PAYROLL")
      ? [
          {
            href: "/team/payroll",
            label: "Payroll",
            shortLabel: "Pay",
            icon: "reports" as const,
          },
        ]
      : []),
    ...(isStoreUser &&
    canSeeCapability(
      "ATTENDANCE_SETTINGS_READ",
      "VIEW_ATTENDANCE_SETTINGS",
    )
      ? [
          {
            href: "/team/attendance-settings",
            label: "Attendance Settings",
            shortLabel: "Attend",
            icon: "settings" as const,
          },
        ]
      : []),
  ];
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
            href: "/admin/business-groups",
            label: "Business Groups",
            shortLabel: "Groups",
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
    ...(!isSalonBusiness &&
    isStoreUser &&
    canSeeCapability("JOBS", "VIEW_WORK_ORDERS")
      ? [
          {
            href: "/work-orders",
            label: "Cashier",
            shortLabel: "Cashier",
            icon: "jobs" as const,
          },
        ]
      : []),
    ...(isSalonBusiness &&
    isStoreUser &&
    !isGroupManager &&
    canSee("POS")
      ? [
          {
            href: "/cashier",
            label: "Cashier",
            shortLabel: "Cashier",
            icon: "jobs" as const,
          },
        ]
      : []),
    ...(isStoreUser &&
    canSeeCapability("APPOINTMENTS", "VIEW_APPOINTMENTS")
      ? [
          {
            href: "/appointments",
            label: "Appointments",
            shortLabel: "Appt",
            icon: "appointments" as const,
          },
        ]
      : []),
    ...(isStoreUser && canSeeCapability("CRM", "VIEW_CRM")
      ? [{ href: "/crm", label: "CRM", shortLabel: "CRM", icon: "crm" as const }]
      : []),
    ...(isStoreUser && !isGroupManager && canSee("LOYALTY")
      ? [
          {
            href: "/loyalty",
            label: "Membership",
            shortLabel: "Member",
            icon: "packages" as const,
          },
        ]
      : []),
    ...(isStoreUser && !isGroupManager && canSee("CLOSING")
      ? [
          {
            href: "/closing",
            label: "Shift Closing",
            shortLabel: "Close",
            icon: "reports" as const,
          },
        ]
      : []),
    ...(isStoreUser && !isGroupManager && canSee("WHATSAPP")
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
    ...(teamChildren.length
      ? [
          {
            href: "/team",
            label: "Team",
            shortLabel: "Team",
            icon: "team" as const,
            children: teamChildren,
          },
        ]
      : []),
    ...(isStoreUser && canSeeCapability("REPORTS", "VIEW_REPORTS")
      ? [
          {
            href: "/reports?range=today",
            label: "Reports",
            shortLabel: "Rpt",
            icon: "reports" as const,
          },
        ]
      : []),
    ...(catalogChildren.length
      ? [
          {
            href: "/catalog",
            label: "Catalog",
            shortLabel: "Catalog",
            icon: "services" as const,
            children: catalogChildren,
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
  const businessContexts =
    !isPlatformAdmin && user.businessId
      ? await getAvailableBusinessContexts(user.userId, user.businessId)
      : null;
  const groupReportingContexts =
    !isPlatformAdmin
      ? await getAvailableGroupReportingContexts(
          user.userId,
          user.activeBusinessId,
        )
      : [];
  const contextToken =
    (businessContexts?.canSwitch ||
      groupReportingContexts.some((group) => group.canViewAllStores)) &&
    user.businessId
      ? await createBusinessContextToken({
          userId: user.userId,
          businessId: user.businessId,
          contextVersion: user.contextVersion,
        })
      : null;

  return (
    <AppShellFrame
      brandName={brandName}
      logoUrl={business?.logoUrl}
      homeHref={homeHref}
      navItems={navItems}
      businessSwitcher={
        (businessContexts?.canSwitch ||
          groupReportingContexts.some((group) => group.canViewAllStores)) &&
        contextToken ? (
          <BusinessContextSwitcher
            groups={groupReportingContexts}
            homeBusiness={
              businessContexts?.businesses.find((business) => business.isHome) ??
              null
            }
            contextToken={contextToken}
          />
        ) : undefined
      }
    >
      {children}
    </AppShellFrame>
  );
}
