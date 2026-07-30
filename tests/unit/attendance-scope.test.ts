import assert from "node:assert/strict";
import test from "node:test";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import {
  buildAttendanceAdjustmentWhere,
  buildAttendanceEmployeeSelfScope,
  buildAttendanceEmployeeWhere,
  buildAttendanceExceptionWhere,
  buildAttendancePunchWhere,
  buildAttendanceSessionWhere,
  resolveAttendanceScope,
  type AttendanceScopeDatabase,
} from "../../src/lib/attendance/scope";

type BranchFixture = {
  id: string;
  businessId: string;
  status: "ACTIVE" | "INACTIVE";
};

test("attendance scope rejects denied, platform and null-business access", async () => {
  const database = createDatabase([]);
  const denied: ResolvedBusinessAccess = {
    granted: false,
    userId: "user-denied",
    requestedBusinessId: "business-a",
    reason: "CAPABILITY_DENIED",
    fallback: { kind: "NO_ACCESS" },
  };
  const platform = grantedAccess({
    businessId: null,
    effectiveBusinessRole: "PLATFORM_ADMIN",
    identityRole: "PLATFORM_ADMIN",
    actorRole: "PLATFORM_ADMIN",
    source: "PLATFORM_ADMIN",
  });
  const nullBusiness = grantedAccess({
    businessId: null,
    effectiveBusinessRole: "BUSINESS_OWNER",
    identityRole: "BUSINESS_OWNER",
    actorRole: "BUSINESS_OWNER",
    source: "DIRECT_BUSINESS",
  });

  await assert.rejects(
    resolveAttendanceScope(denied, database),
    /scope is not available/i,
  );
  await assert.rejects(
    resolveAttendanceScope(platform, database),
    /scope is not available/i,
  );
  await assert.rejects(
    resolveAttendanceScope(nullBusiness, database),
    /scope is not available/i,
  );
});

test("business owner scope includes only active branches from the current business", async () => {
  const database = createDatabase([
    { id: "branch-a-1", businessId: "business-a", status: "ACTIVE" },
    { id: "branch-a-off", businessId: "business-a", status: "INACTIVE" },
    { id: "branch-b-1", businessId: "business-b", status: "ACTIVE" },
  ]);

  const scope = await resolveAttendanceScope(
    grantedAccess({
      businessId: "business-a",
      effectiveBusinessRole: "BUSINESS_OWNER",
      identityRole: "BUSINESS_OWNER",
      actorRole: "BUSINESS_OWNER",
      source: "DIRECT_BUSINESS",
    }),
    database,
  );

  assert.deepEqual(scope, {
    businessId: "business-a",
    allowedBranchIds: ["branch-a-1"],
  });
});

test("group manager scope stays within the currently authorized business", async () => {
  const database = createDatabase([
    { id: "branch-a-1", businessId: "business-a", status: "ACTIVE" },
    { id: "branch-b-1", businessId: "business-b", status: "ACTIVE" },
    { id: "branch-b-2", businessId: "business-b", status: "ACTIVE" },
  ]);

  const scope = await resolveAttendanceScope(
    grantedAccess({
      businessId: "business-b",
      effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY",
      identityRole: "STAFF",
      actorRole: "GROUP_MANAGER",
      source: "GROUP_ACCESS",
      groupId: "group-1",
      groupUserId: "group-user-1",
    }),
    database,
  );

  assert.deepEqual(scope, {
    businessId: "business-b",
    allowedBranchIds: ["branch-b-1", "branch-b-2"],
  });
});

test("branch staff scope includes only its active branch", async () => {
  const database = createDatabase([
    { id: "branch-a-1", businessId: "business-a", status: "ACTIVE" },
    { id: "branch-a-2", businessId: "business-a", status: "ACTIVE" },
  ]);

  const scope = await resolveAttendanceScope(
    grantedAccess({
      businessId: "business-a",
      branchId: "branch-a-2",
      effectiveBusinessRole: "STAFF",
      identityRole: "STAFF",
      actorRole: "STAFF",
      source: "DIRECT_BUSINESS",
    }),
    database,
  );

  assert.deepEqual(scope, {
    businessId: "business-a",
    allowedBranchIds: ["branch-a-2"],
  });
});

test("ALL_BRANCHES staff scope includes every active branch in its business", async () => {
  const database = createDatabase([
    { id: "branch-a-1", businessId: "business-a", status: "ACTIVE" },
    { id: "branch-a-2", businessId: "business-a", status: "ACTIVE" },
    { id: "branch-a-off", businessId: "business-a", status: "INACTIVE" },
    { id: "branch-b-1", businessId: "business-b", status: "ACTIVE" },
  ]);

  const scope = await resolveAttendanceScope(
    grantedAccess({
      businessId: "business-a",
      branchId: "branch-a-1",
      effectiveBusinessRole: "STAFF",
      identityRole: "STAFF",
      actorRole: "STAFF",
      permissions: ["TEAM", "ALL_BRANCHES"],
      source: "DIRECT_BUSINESS",
    }),
    database,
  );

  assert.deepEqual(scope, {
    businessId: "business-a",
    allowedBranchIds: ["branch-a-1", "branch-a-2"],
  });
});

test("tampered staff branch fails closed when it belongs to another business", async () => {
  const database = createDatabase([
    { id: "branch-a-1", businessId: "business-a", status: "ACTIVE" },
    { id: "branch-b-1", businessId: "business-b", status: "ACTIVE" },
  ]);

  const scope = await resolveAttendanceScope(
    grantedAccess({
      businessId: "business-a",
      branchId: "branch-b-1",
      effectiveBusinessRole: "STAFF",
      identityRole: "STAFF",
      actorRole: "STAFF",
      source: "DIRECT_BUSINESS",
    }),
    database,
  );

  assert.deepEqual(scope, {
    businessId: "business-a",
    allowedBranchIds: [],
  });
});

test("attendance record where builders override tampered business and branch filters", () => {
  const scope = {
    businessId: "business-a",
    allowedBranchIds: ["branch-a-1", "branch-a-2"],
  };
  const builders = [
    buildAttendanceSessionWhere,
    buildAttendancePunchWhere,
    buildAttendanceExceptionWhere,
    buildAttendanceAdjustmentWhere,
  ];

  for (const buildWhere of builders) {
    assert.deepEqual(
      buildWhere(scope, {
        businessId: "business-b",
        branchId: "branch-b-1",
        status: "OPEN",
      }),
      {
        businessId: "business-a",
        branchId: {
          in: ["branch-a-1", "branch-a-2"],
        },
        status: "OPEN",
      },
    );
  }
});

test("employee where builder scopes through a currently effective branch assignment", () => {
  const at = new Date("2026-07-30T03:00:00.000Z");

  assert.deepEqual(
    buildAttendanceEmployeeWhere(
      {
        businessId: "business-a",
        allowedBranchIds: ["branch-a-1", "branch-a-2"],
      },
      {
        businessId: "business-b",
        branchId: "branch-b-1",
        branchAssignments: {
          some: {
            branchId: "branch-b-1",
          },
        },
        status: "ACTIVE",
      },
      at,
    ),
    {
      businessId: "business-a",
      branchAssignments: {
        some: {
          businessId: "business-a",
          branchId: {
            in: ["branch-a-1", "branch-a-2"],
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
      status: "ACTIVE",
    },
  );
});

test("future employee self scope contains only the verified employee id", () => {
  assert.deepEqual(buildAttendanceEmployeeSelfScope(" employee-a "), {
    employeeId: "employee-a",
  });
  assert.throws(
    () => buildAttendanceEmployeeSelfScope("   "),
    /employee identity is required/i,
  );
});

function createDatabase(
  branches: BranchFixture[],
): AttendanceScopeDatabase {
  return {
    branch: {
      async findMany(query) {
        return branches
          .filter(
            (branch) =>
              branch.businessId === query.where.businessId &&
              branch.status === query.where.status &&
              (!query.where.id || branch.id === query.where.id),
          )
          .map((branch) => ({ id: branch.id }));
      },
    },
  };
}

function grantedAccess(
  overrides: Partial<
    Extract<ResolvedBusinessAccess, { granted: true }>
  > = {},
): Extract<ResolvedBusinessAccess, { granted: true }> {
  return {
    granted: true,
    userId: "user-1",
    homeBusinessId: "business-a",
    businessId: "business-a",
    branchId: null,
    identityRole: "BUSINESS_OWNER",
    actorRole: "BUSINESS_OWNER",
    effectiveBusinessRole: "BUSINESS_OWNER",
    permissions: [],
    industryType: "AUTO_DETAILING",
    source: "DIRECT_BUSINESS",
    groupId: null,
    groupUserId: null,
    capability: null,
    ...overrides,
  };
}
