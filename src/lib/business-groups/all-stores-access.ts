import type {
  BusinessGroupUserRole,
  BusinessIndustry,
  Prisma,
} from "@prisma/client";
import { canGroupManager } from "@/lib/business-groups/capabilities";
import { prisma } from "@/lib/prisma";

export type AuthorizedGroupBusiness = {
  id: string;
  name: string;
  industryType: BusinessIndustry;
  logoUrl: string | null;
  timezone: string;
  businessDayCutoffTime: string;
  isCurrent: boolean;
  membershipPeriods?: BusinessGroupMembershipPeriod[];
};

export type BusinessGroupMembershipPeriod = {
  joinedAt: Date;
  removedAt: Date | null;
};

export type AuthorizedGroupReportingContext = {
  groupId: string;
  groupName: string;
  groupLogoUrl?: string | null;
  role: BusinessGroupUserRole;
  reportingBusinesses?: AuthorizedGroupBusiness[];
  canViewAllStores: boolean;
  businesses: AuthorizedGroupBusiness[];
};

type ReportingScopeDatabase = Pick<
  Prisma.TransactionClient,
  "user" | "businessGroupUser"
>;

type ReportingScopeDependencies = {
  canManagerViewReports?: () => boolean;
};

export async function getAvailableGroupReportingContexts(
  userId: string,
  currentBusinessId: string | null,
  database: ReportingScopeDatabase = prisma,
  dependencies: ReportingScopeDependencies = {},
): Promise<AuthorizedGroupReportingContext[]> {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      status: true,
      loginEnabled: true,
    },
  });

  if (
    !user ||
    user.status !== "active" ||
    !user.loginEnabled ||
    user.role === "PLATFORM_ADMIN"
  ) {
    return [];
  }

  const managerCanViewReports =
    dependencies.canManagerViewReports ??
    (() => canGroupManager("VIEW_REPORTS"));
  const grants = await database.businessGroupUser.findMany({
    where: {
      userId,
      status: "ACTIVE",
      group: { status: "ACTIVE" },
    },
    orderBy: [
      { group: { name: "asc" } },
      { groupId: "asc" },
      { grantedAt: "asc" },
    ],
    select: {
      role: true,
      accessScope: true,
      group: {
        select: {
          id: true,
          name: true,
          logoUrl: true,
          members: {
            orderBy: [
              { business: { name: "asc" } },
              { businessId: "asc" },
              { joinedAt: "asc" },
            ],
            select: {
              status: true,
              joinedAt: true,
              removedAt: true,
              business: {
                select: {
                  id: true,
                  name: true,
                  industryType: true,
                  logoUrl: true,
                  timezone: true,
                  businessDayCutoffTime: true,
                  status: true,
                },
              },
            },
          },
        },
      },
      businessAccesses: { select: { businessId: true } },
    },
  });

  return grants.flatMap((grant) => {
    if (grant.role === "GROUP_MANAGER" && !managerCanViewReports()) {
      return [];
    }

    const scopedBusinessIds = new Set(
      grant.businessAccesses.map((access) => access.businessId),
    );
    const authorizedMembers = grant.group.members.filter(
      (member) =>
        grant.role === "GROUP_OWNER" ||
        (grant.accessScope === "SELECTED_BUSINESSES" &&
          scopedBusinessIds.has(member.business.id)),
    );
    const reportingByBusiness = new Map<string, AuthorizedGroupBusiness>();
    for (const member of authorizedMembers) {
      const existing = reportingByBusiness.get(member.business.id);
      const membershipPeriods = existing?.membershipPeriods ?? [];
      membershipPeriods.push({
        joinedAt: member.joinedAt ?? new Date(0),
        removedAt: member.removedAt ?? null,
      });
      reportingByBusiness.set(member.business.id, {
        id: member.business.id,
        name: member.business.name,
        industryType: member.business.industryType,
        logoUrl: member.business.logoUrl,
        timezone: member.business.timezone,
        businessDayCutoffTime: member.business.businessDayCutoffTime,
        isCurrent: member.business.id === currentBusinessId,
        membershipPeriods,
      });
    }

    const currentBusinessIds = new Set(
      authorizedMembers
        .filter(
          (member) =>
            member.status !== "REMOVED" &&
            member.business.status !== "inactive",
        )
        .map((member) => member.business.id),
    );
    const reportingBusinesses = [...reportingByBusiness.values()];
    const businesses = reportingBusinesses.filter((business) =>
      currentBusinessIds.has(business.id),
    );

    if (!businesses.length) {
      return [];
    }

    return [
      {
        groupId: grant.group.id,
        groupName: grant.group.name,
        groupLogoUrl: grant.group.logoUrl ?? null,
        role: grant.role,
        canViewAllStores: businesses.length >= 2,
        businesses,
        reportingBusinesses,
      },
    ];
  });
}

export async function resolveAuthorizedGroupReportingScope(
  userId: string,
  groupId: string,
  currentBusinessId: string | null,
  database: ReportingScopeDatabase = prisma,
  dependencies: ReportingScopeDependencies = {},
) {
  const contexts = await getAvailableGroupReportingContexts(
    userId,
    currentBusinessId,
    database,
    dependencies,
  );

  return contexts.find((context) => context.groupId === groupId) ?? null;
}
