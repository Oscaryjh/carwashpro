import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";

export type AttendanceScope = Readonly<{
  businessId: string;
  allowedBranchIds: readonly string[];
}>;

export type AttendanceEmployeeSelfScope = Readonly<{
  employeeId: string;
}>;

type ActiveBranchQuery = {
  where: {
    businessId: string;
    status: "ACTIVE";
    id?: string;
  };
  select: {
    id: true;
  };
};

export type AttendanceScopeDatabase = {
  branch: {
    findMany(query: ActiveBranchQuery): Promise<Array<{ id: string }>>;
  };
};

type AttendanceWhereInput = Record<string, unknown>;

type AttendanceScopedWhere<TWhere extends AttendanceWhereInput> = Omit<
  TWhere,
  "businessId" | "branchId"
> & {
  businessId: string;
  branchId: {
    in: string[];
  };
};

type AttendanceEmployeeScopedWhere<TWhere extends AttendanceWhereInput> = Omit<
  TWhere,
  "businessId" | "branchId" | "branchAssignments"
> & {
  businessId: string;
  branchAssignments: {
    some: {
      businessId: string;
      branchId: {
        in: string[];
      };
      status: "ACTIVE";
      effectiveFrom: {
        lte: Date;
      };
      OR: Array<
        | { effectiveUntil: null }
        | { effectiveUntil: { gte: Date } }
      >;
    };
  };
};

const ATTENDANCE_SCOPE_DENIED =
  "Attendance scope is not available for this access context.";

export async function resolveAttendanceScope(
  access: ResolvedBusinessAccess,
  database: AttendanceScopeDatabase = prisma,
): Promise<AttendanceScope> {
  if (
    !access.granted ||
    access.source === "PLATFORM_ADMIN" ||
    access.businessId === null ||
    access.effectiveBusinessRole === "PLATFORM_ADMIN"
  ) {
    throw new Error(ATTENDANCE_SCOPE_DENIED);
  }

  const businessId = access.businessId;
  const canReadAllActiveBranches =
    access.effectiveBusinessRole === "BUSINESS_OWNER" ||
    access.effectiveBusinessRole === "GROUP_MANAGER_READ_ONLY" ||
    (access.effectiveBusinessRole === "STAFF" &&
      access.permissions.includes("ALL_BRANCHES"));

  if (
    access.effectiveBusinessRole !== "BUSINESS_OWNER" &&
    access.effectiveBusinessRole !== "GROUP_MANAGER_READ_ONLY" &&
    access.effectiveBusinessRole !== "STAFF"
  ) {
    throw new Error(ATTENDANCE_SCOPE_DENIED);
  }

  if (!canReadAllActiveBranches && !access.branchId) {
    return {
      businessId,
      allowedBranchIds: [],
    };
  }

  const branches = await database.branch.findMany({
    where: {
      businessId,
      status: "ACTIVE",
      ...(!canReadAllActiveBranches && access.branchId
        ? { id: access.branchId }
        : {}),
    },
    select: {
      id: true,
    },
  });

  return {
    businessId,
    allowedBranchIds: branches.map((branch) => branch.id),
  };
}

export function buildAttendanceEmployeeWhere<
  TWhere extends AttendanceWhereInput = AttendanceWhereInput,
>(
  scope: AttendanceScope,
  where?: TWhere,
  at: Date = new Date(),
): AttendanceEmployeeScopedWhere<TWhere> {
  const sanitizedWhere = {
    ...(where ?? ({} as TWhere)),
  } as AttendanceWhereInput;
  delete sanitizedWhere.businessId;
  delete sanitizedWhere.branchId;
  delete sanitizedWhere.branchAssignments;

  return {
    ...sanitizedWhere,
    businessId: scope.businessId,
    branchAssignments: {
      some: {
        businessId: scope.businessId,
        branchId: {
          in: [...scope.allowedBranchIds],
        },
        status: "ACTIVE",
        effectiveFrom: {
          lte: at,
        },
        OR: [
          {
            effectiveUntil: null,
          },
          {
            effectiveUntil: {
              gte: at,
            },
          },
        ],
      },
    },
  } as AttendanceEmployeeScopedWhere<TWhere>;
}

export function buildAttendanceSessionWhere<
  TWhere extends AttendanceWhereInput = AttendanceWhereInput,
>(
  scope: AttendanceScope,
  where?: TWhere,
): AttendanceScopedWhere<TWhere> {
  return withAttendanceScope(scope, where);
}

export function buildAttendancePunchWhere<
  TWhere extends AttendanceWhereInput = AttendanceWhereInput,
>(
  scope: AttendanceScope,
  where?: TWhere,
): AttendanceScopedWhere<TWhere> {
  return withAttendanceScope(scope, where);
}

export function buildAttendanceExceptionWhere<
  TWhere extends AttendanceWhereInput = AttendanceWhereInput,
>(
  scope: AttendanceScope,
  where?: TWhere,
): AttendanceScopedWhere<TWhere> {
  return withAttendanceScope(scope, where);
}

export function buildAttendanceAdjustmentWhere<
  TWhere extends AttendanceWhereInput = AttendanceWhereInput,
>(
  scope: AttendanceScope,
  where?: TWhere,
): AttendanceScopedWhere<TWhere> {
  return withAttendanceScope(scope, where);
}

export function buildAttendanceEmployeeSelfScope(
  employeeId: string,
): AttendanceEmployeeSelfScope {
  const normalizedEmployeeId = employeeId.trim();

  if (!normalizedEmployeeId) {
    throw new Error("Employee identity is required for attendance self scope.");
  }

  return {
    employeeId: normalizedEmployeeId,
  };
}

function withAttendanceScope<
  TWhere extends AttendanceWhereInput = AttendanceWhereInput,
>(
  scope: AttendanceScope,
  where?: TWhere,
): AttendanceScopedWhere<TWhere> {
  return {
    ...(where ?? ({} as TWhere)),
    businessId: scope.businessId,
    branchId: {
      in: [...scope.allowedBranchIds],
    },
  };
}
