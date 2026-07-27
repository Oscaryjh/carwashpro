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
  isCurrent: boolean;
};

export type AuthorizedGroupReportingContext = {
  groupId: string;
  groupName: string;
  role: BusinessGroupUserRole;
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
          members: {
            where: {
              status: "ACTIVE",
              business: { status: "active" },
            },
            orderBy: [
              { business: { name: "asc" } },
              { businessId: "asc" },
            ],
            select: {
              business: {
                select: {
                  id: true,
                  name: true,
                  industryType: true,
                  logoUrl: true,
                },
              },
            },
          },
        },
      },
      businessAccesses: {
        where: { business: { status: "active" } },
        select: { businessId: true },
      },
    },
  });

  return grants.flatMap((grant) => {
    if (grant.role === "GROUP_MANAGER" && !managerCanViewReports()) {
      return [];
    }

    const scopedBusinessIds = new Set(
      grant.businessAccesses.map((access) => access.businessId),
    );
    const businesses = grant.group.members
      .filter(
        (member) =>
          grant.role === "GROUP_OWNER" ||
          (grant.accessScope === "SELECTED_BUSINESSES" &&
            scopedBusinessIds.has(member.business.id)),
      )
      .map((member) => ({
        ...member.business,
        isCurrent: member.business.id === currentBusinessId,
      }));

    if (!businesses.length) {
      return [];
    }

    return [
      {
        groupId: grant.group.id,
        groupName: grant.group.name,
        role: grant.role,
        canViewAllStores: businesses.length >= 2,
        businesses,
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
