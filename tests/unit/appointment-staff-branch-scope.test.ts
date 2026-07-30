import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAppointmentStaffWhere,
  NO_APPOINTMENT_BRANCH_ID,
} from "../../src/lib/appointments/staff-branch-scope";

const businessId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000002";
const staffId = "30000000-0000-4000-8000-000000000003";
const currentUserId = "40000000-0000-4000-8000-000000000004";
const at = new Date("2026-07-30T02:00:00.000Z");

test("whole-business staff query keeps tenant, active and bookable constraints", () => {
  assert.deepEqual(
    buildAppointmentStaffWhere({
      at,
      branchId: null,
      businessId,
      staffId,
    }),
    {
      appointmentBookable: true,
      businessId,
      id: staffId,
      status: "active",
    },
  );
});

test("branch staff query preserves owner, legacy staff and current-user compatibility", () => {
  const where = buildAppointmentStaffWhere({
    at,
    branchId,
    businessId,
    includeUserId: currentUserId,
  });

  assert.deepEqual(where.OR?.slice(0, 3), [
    { id: currentUserId },
    { role: "BUSINESS_OWNER" },
    {
      branchId,
      employeeBusinessMembershipId: null,
      role: "STAFF",
    },
  ]);
  assert.equal(where.businessId, businessId);
  assert.equal(where.status, "active");
  assert.equal(where.appointmentBookable, true);
});

test("linked staff eligibility is tenant-scoped and accepts every active authorized branch", () => {
  const where = buildAppointmentStaffWhere({
    at,
    branchId,
    businessId,
    staffId,
  });
  const linkedStaff = where.OR?.[2] as {
    employeeBusinessMembership: {
      is: {
        branchAssignments: {
          some: Record<string, unknown>;
        };
        businessId: string;
        status: string;
      };
    };
  };
  const membership = linkedStaff.employeeBusinessMembership.is;
  const assignment = membership.branchAssignments.some;

  assert.equal(where.id, staffId);
  assert.equal(membership.businessId, businessId);
  assert.equal(membership.status, "ACTIVE");
  assert.equal(assignment.businessId, businessId);
  assert.equal(assignment.branchId, branchId);
  assert.equal(assignment.status, "ACTIVE");
  assert.deepEqual(assignment.effectiveFrom, { lte: at });
});

test("assignment end is inclusive and clock-in permission is not used for appointments", () => {
  const where = buildAppointmentStaffWhere({
    at,
    branchId,
    businessId,
  });
  const serialized = JSON.stringify(where);

  assert.match(
    serialized,
    /"effectiveUntil":\{"gte":"2026-07-30T02:00:00.000Z"\}/,
  );
  assert.doesNotMatch(serialized, /canClockIn/);
});

test("missing staff branch can be represented without matching null-branch legacy users", () => {
  const where = buildAppointmentStaffWhere({
    at,
    branchId: NO_APPOINTMENT_BRANCH_ID,
    businessId,
    includeUserId: currentUserId,
  });

  assert.equal(where.businessId, businessId);
  assert.deepEqual(where.OR?.[0], { id: currentUserId });
  assert.equal(
    (where.OR?.[2] as { branchId: string }).branchId,
    NO_APPOINTMENT_BRANCH_ID,
  );
});
