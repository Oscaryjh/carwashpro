import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCurrentPeopleAssignmentWhere,
  buildPeopleMembershipScopeWhere,
  buildPeopleStaffScopeWhere,
} from "../../src/lib/team/people-scope";

const now = new Date("2026-07-30T12:00:00.000Z");
const scoped = {
  allowedBranchIds: [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ],
  businessId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  now,
  wholeBusinessScope: false,
};

test("branch-scoped People queries accept only current authorized assignments", () => {
  const currentAssignment = buildCurrentPeopleAssignmentWhere(scoped);

  assert.deepEqual(currentAssignment, {
    branchId: { in: scoped.allowedBranchIds },
    businessId: scoped.businessId,
    effectiveFrom: { lte: now },
    OR: [
      { effectiveUntil: null },
      { effectiveUntil: { gte: now } },
    ],
    status: "ACTIVE",
  });
  assert.deepEqual(buildPeopleMembershipScopeWhere(scoped), {
    businessId: scoped.businessId,
    branchAssignments: {
      some: currentAssignment,
    },
  });
});

test("branch-scoped Staff includes legacy branch Staff or linked current assignments", () => {
  const where = buildPeopleStaffScopeWhere(scoped);

  assert.equal(where.businessId, scoped.businessId);
  assert.deepEqual(where.AND, [
    {
      OR: [
        {
          AND: [
            { employeeBusinessMembershipId: null },
            {
              branchId: { in: scoped.allowedBranchIds },
            },
          ],
        },
        {
          employeeBusinessMembership: {
            is: {
              branchAssignments: {
                some: buildCurrentPeopleAssignmentWhere(scoped),
              },
            },
          },
        },
      ],
    },
  ]);
});

test("whole-business People queries retain business isolation without branch filtering", () => {
  const whole = {
    ...scoped,
    wholeBusinessScope: true,
  };

  assert.deepEqual(buildPeopleMembershipScopeWhere(whole), {
    businessId: scoped.businessId,
  });
  assert.deepEqual(buildPeopleStaffScopeWhere(whole), {
    businessId: scoped.businessId,
  });
});
