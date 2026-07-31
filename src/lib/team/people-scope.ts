import type { Prisma } from "@prisma/client";

export type PeopleScopeInput = {
  allowedBranchIds: readonly string[];
  businessId: string;
  now: Date;
  wholeBusinessScope: boolean;
};

export function buildCurrentPeopleAssignmentWhere(
  scope: PeopleScopeInput,
): Prisma.EmployeeBranchAssignmentWhereInput {
  return {
    branchId: { in: [...scope.allowedBranchIds] },
    businessId: scope.businessId,
    effectiveFrom: { lte: scope.now },
    OR: [
      { effectiveUntil: null },
      { effectiveUntil: { gte: scope.now } },
    ],
    status: "ACTIVE",
  };
}

export function buildPeopleMembershipScopeWhere(
  scope: PeopleScopeInput,
): Prisma.EmployeeBusinessMembershipWhereInput {
  return {
    businessId: scope.businessId,
    ...(scope.wholeBusinessScope
      ? {}
      : {
          branchAssignments: {
            some: buildCurrentPeopleAssignmentWhere(scope),
          },
        }),
  };
}

export function buildPeopleStaffScopeWhere(
  scope: PeopleScopeInput,
): Prisma.UserWhereInput {
  return {
    businessId: scope.businessId,
    status: "active",
    ...(scope.wholeBusinessScope
      ? {}
      : {
          AND: [
            {
              OR: [
                {
                  AND: [
                    {
                      employeeBusinessMembershipId: null,
                    },
                    {
                      branchId: {
                        in: [...scope.allowedBranchIds],
                      },
                    },
                  ],
                },
                {
                  employeeBusinessMembership: {
                    is: {
                      branchAssignments: {
                        some: buildCurrentPeopleAssignmentWhere(scope),
                      },
                    },
                  },
                },
              ],
            },
          ],
        }),
  };
}

export function hasWholeBusinessPeopleScope(access: {
  effectiveBusinessRole: string | null;
  granted: boolean;
  permissions: readonly string[];
}) {
  return (
    access.granted &&
    (access.effectiveBusinessRole === "BUSINESS_OWNER" ||
      access.effectiveBusinessRole === "GROUP_MANAGER_READ_ONLY" ||
      access.permissions.includes("ALL_BRANCHES"))
  );
}
