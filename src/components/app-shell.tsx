import type { ReactNode } from "react";
import { AppShellFrame } from "@/components/app-shell-frame";
import type { NavItem } from "@/components/app-shell-frame";
import { BusinessContextSwitcher } from "@/components/business-context-switcher";
import { createBusinessContextToken } from "@/lib/auth/business-context-token";
import { isMfaFeatureEnabled } from "@/lib/auth/mfa-feature";
import { hasStaffPermission } from "@/lib/auth/staff-permissions";
import type { AppSession } from "@/lib/auth/session";
import {
  actionCenterDomains,
  getUnifiedApprovalCounts,
  isUnifiedApprovalCenterAvailable,
  resolveUnifiedApprovalContext,
} from "@/lib/approvals/service";
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
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import type { ModuleKey } from "@/lib/modules/registry";

type AppShellProps = {
  user: AppSession;
  access?: ResolvedBusinessAccess;
  children: ReactNode;
};

export async function AppShell({ user, access, children }: AppShellProps) {
  const mfaFeatureEnabled = isMfaFeatureEnabled();
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
  const [business, moduleContext] = user.businessId
    ? await Promise.all([
        prisma.business.findUnique({
          where: { id: user.businessId },
          select: { name: true, logoUrl: true, industryType: true },
        }),
        loadBusinessModuleContext(user.businessId),
      ])
    : [null, null];
  const moduleEnabled = (moduleKey: ModuleKey) =>
    moduleKey === "CORE" || Boolean(moduleContext?.enabledModules.has(moduleKey));
  const isSalonBusiness = business?.industryType === "SALON_BEAUTY";
  const operationalIndustryEnabled = isSalonBusiness
    ? moduleEnabled("SALON")
    : moduleEnabled("AUTO");
  const homeHref = isPlatformAdmin
    ? "/admin/businesses"
    : moduleEnabled("POS") && operationalIndustryEnabled
      ? getBusinessHomeHref(business?.industryType ?? "AUTO_DETAILING")
      : "/team";
  const whatsAppUnreadCount =
    user.businessId && isStoreUser && moduleEnabled("WHATSAPP") && canSee("WHATSAPP")
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
  let approvalNavigationVisible = false;
  let approvalBadgeCount: number | null = null;
  if (isStoreUser && grantedAccess && moduleContext) {
    const approvalContext = await resolveUnifiedApprovalContext({
      access: grantedAccess,
      actorUserId: user.userId,
      moduleContext,
    });
    if (approvalContext && isUnifiedApprovalCenterAvailable(approvalContext)) {
      approvalNavigationVisible = true;
      const result = await getUnifiedApprovalCounts(approvalContext, prisma, {
        domains: actionCenterDomains,
      });
      approvalBadgeCount = result.complete ? result.counts.total : null;
    }
  }
  const brandName = business?.name ?? "TETAMU POS";
  const catalogChildren: NavItem[] = [
    ...(isStoreUser && moduleEnabled("POS") && canSeeCapability("SERVICES", "VIEW_CATALOG")
      ? [{ href: "/services", label: "Services", shortLabel: "Svc", icon: "services" as const }]
      : []),
    ...(isStoreUser && moduleEnabled("POS") && canSeeCapability("PACKAGES", "VIEW_CATALOG")
      ? [{ href: "/packages", label: "Packages", shortLabel: "Pkg", icon: "packages" as const }]
      : []),
    ...(isStoreUser && moduleEnabled("POS") && canSeeCapability("PRODUCTS", "VIEW_CATALOG")
      ? [{ href: "/products", label: "Products", shortLabel: "Prod", icon: "products" as const }]
      : []),
    ...(isStoreUser && moduleEnabled("INVENTORY") && canSeeCapability("INVENTORY_VIEW", "VIEW_INVENTORY")
      ? [{ href: "/inventory", label: "Inventory", shortLabel: "Stock", icon: "inventory" as const }]
      : []),
    ...(isStoreUser && moduleEnabled("POS") && canSeeCapability("DISCOUNTS", "VIEW_CATALOG")
      ? [{ href: "/discounts", label: "Discounts", shortLabel: "Disc", icon: "discounts" as const }]
      : []),
  ];
  const teamWorkspaceItems: NavItem[] = [
    ...(process.env.TETAMU_PERFORMANCE_PHASE2 === "true" && isStoreUser && grantedAccess?.source === "DIRECT_BUSINESS" &&
      (canSee("PERFORMANCE_VIEW_TEAM") || canSee("PERFORMANCE_MANAGE_TARGETS"))
      ? [{ href: "/team/performance", label: "业绩管理 / Performance", shortLabel: "Performance", icon: "reports" as const }] : []),
    ...(approvalNavigationVisible
      ? [
          {
            href: "/team/approvals",
            label: "Overview",
            shortLabel: "Overview",
            icon: "reports" as const,
            ...(approvalBadgeCount !== null ? { badgeCount: approvalBadgeCount } : {}),
          },
        ]
      : []),
    ...(isStoreUser &&
    (canSeeCapability("TEAM", "VIEW_TEAM_DIRECTORY") ||
      (moduleEnabled("HR") && canSeeCapability(
        "ATTENDANCE_EMPLOYEE_READ",
        "VIEW_ATTENDANCE_EMPLOYEES",
      )))
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
    moduleEnabled("HR") &&
    (canSeeCapability("ATTENDANCE_EMPLOYEE_READ", "VIEW_ATTENDANCE_EMPLOYEES") ||
      canSeeCapability("ROSTER_VIEW", "VIEW_ROSTER"))
      ? [
          {
            href: "/team/time",
            label: "Time",
            shortLabel: "Time",
            icon: "reports" as const,
          },
        ]
      : []),
    ...(isStoreUser && moduleEnabled("HR") && canSeeCapability("VIEW_LEAVE", "VIEW_LEAVE")
      ? [{ href: "/team/leave", label: "Leave", shortLabel: "Leave", icon: "team" as const }]
      : []),
    ...(isStoreUser && moduleEnabled("CLAIMS") && canSeeCapability("VIEW_CLAIM", "VIEW_CLAIM")
      ? [{ href: "/team/claims", label: "Claims", shortLabel: "Claims", icon: "reports" as const }]
      : []),
    ...(isStoreUser &&
    moduleEnabled("PAYROLL") && canSeeCapability("VIEW_PAYROLL_RUN", "VIEW_PAYROLL_RUN")
      ? [
          {
            href: "/team/payroll",
            label: "Payroll",
            shortLabel: "Pay",
            icon: "reports" as const,
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
            icon: "businessGroups" as const,
          },
          {
            href: "/admin/commercial",
            label: "Commercial",
            shortLabel: "Plans",
            icon: "commercial" as const,
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
            icon: "vehicle" as const,
          },
          {
            href: "/admin/statutory/rulesets",
            label: "Statutory Rules",
            shortLabel: "Rules",
            icon: "statutory" as const,
          },
          {
            href: "/admin/otp-support",
            label: "OTP Support",
            shortLabel: "OTP",
            icon: "otpSupport" as const,
          },
        ]
      : []),
    ...(!isSalonBusiness &&
    moduleEnabled("POS") &&
    moduleEnabled("AUTO") &&
    isStoreUser &&
    canSeeCapability("JOBS", "VIEW_WORK_ORDERS")
      ? [
          {
            href: "/work-orders",
            label: "Cashier",
            shortLabel: "Cashier",
            icon: "cashier" as const,
          },
        ]
      : []),
    ...(isSalonBusiness &&
    isStoreUser &&
    moduleEnabled("POS") &&
    moduleEnabled("SALON") &&
    !isGroupManager &&
    canSee("POS")
      ? [
          {
            href: "/cashier",
            label: "Cashier",
            shortLabel: "Cashier",
            icon: "cashier" as const,
          },
        ]
      : []),
    ...(isStoreUser && operationalIndustryEnabled &&
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
    ...(isStoreUser && moduleEnabled("POS") && canSeeCapability("CRM", "VIEW_CRM")
      ? [{ href: "/crm", label: "CRM", shortLabel: "CRM", icon: "crm" as const }]
      : []),
    ...(isStoreUser && moduleEnabled("LOYALTY") && !isGroupManager && canSee("LOYALTY")
      ? [
          {
            href: "/loyalty",
            label: "Membership",
            shortLabel: "Member",
            icon: "membership" as const,
          },
        ]
      : []),
    ...(isStoreUser && moduleEnabled("EXPENSE") && canSeeCapability("EXPENSE_VIEW", "VIEW_EXPENSE")
      ? [
          {
            href: "/expenses",
            label: "Expenses",
            shortLabel: "Expense",
            icon: "expenses" as const,
          },
        ]
      : []),
    ...(isStoreUser && moduleEnabled("POS") && !isGroupManager && canSee("CLOSING")
      ? [
          {
            href: "/closing",
            label: "Shift Closing",
            shortLabel: "Close",
            icon: "shiftClosing" as const,
          },
        ]
      : []),
    ...(isStoreUser && moduleEnabled("WHATSAPP") && !isGroupManager && canSee("WHATSAPP")
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
    ...(teamWorkspaceItems.length
      ? [
          {
            href: canSeeCapability("TEAM", "VIEW_TEAM_DIRECTORY") ? "/team" : teamWorkspaceItems[0].href,
            label: moduleEnabled("HR") ? "People & HR" : "People",
            shortLabel: "People",
            icon: "team" as const,
            ...(approvalBadgeCount !== null ? { badgeCount: approvalBadgeCount } : {}),
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
    ...(isStoreUser && moduleEnabled("AI") && canSeeCapability("AI_ANALYSIS_VIEW", "VIEW_AI_ANALYSIS")
      ? [{ href: "/ai", label: "Ask Tetamu", shortLabel: "AI", icon: "askTetamu" as const }]
      : []),
    ...(catalogChildren.length
      ? [
          {
            href: "/catalog",
            label: "Catalog",
            shortLabel: "Catalog",
            icon: "catalog" as const,
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
            icon: "companySettings" as const,
          },
        ]
      : []),
    ...(mfaFeatureEnabled
      ? [
          {
            href: "/security/mfa",
            label: "Security",
            shortLabel: "Security",
            icon: "security" as const,
            children: [
              {
                href: "/security/mfa",
                label: "Account security",
                shortLabel: "Account",
                icon: "accountSecurity" as const,
              },
              ...(isStoreUser && canSeeCapability("TEAM", "MANAGE_TEAM_PERMISSIONS")
                ? [
                    {
                      href: "/team?section=roles&focus=roles",
                      label: "Staff access roles",
                      shortLabel: "Roles",
                      icon: "permissions" as const,
                    },
                  ]
                : []),
            ],
          },
        ]
      : isStoreUser && canSeeCapability("TEAM", "MANAGE_TEAM_PERMISSIONS")
        ? [
            {
              href: "/team?section=roles&focus=roles",
              label: "Security",
              shortLabel: "Security",
              icon: "security" as const,
            },
          ]
        : []),
  ];
  const businessContexts =
    !isPlatformAdmin && user.businessId && moduleEnabled("BUSINESS_GROUP")
      ? await getAvailableBusinessContexts(user.userId, user.businessId)
      : null;
  const groupReportingContexts =
    !isPlatformAdmin && moduleEnabled("BUSINESS_GROUP")
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
