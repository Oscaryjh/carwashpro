import assert from "node:assert/strict";
import test from "node:test";
import {
  attendanceEmployeeCreateInputSchema,
  attendanceEmployeeUpdateInputSchema,
  getPrimaryAttendanceBranchId,
  validateAttendanceEmployeeCreate,
  validateAttendanceEmployeeUpdate,
  type AttendanceEmployeeValidationDatabase,
} from "../../src/lib/attendance/employee";

const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const BRANCH_ONE = "33333333-3333-4333-8333-333333333333";
const BRANCH_TWO = "44444444-4444-4444-8444-444444444444";

function validEmployeeInput() {
  return {
    businessId: BUSINESS_ID,
    employeeCode: " emp-001 ",
    fullName: " Amy Tan ",
    phoneNumber: "012-345 6789",
    employmentType: "FULL_TIME",
    status: "ACTIVE",
    attendanceEnabled: true,
    joinedAt: "2026-07-01T00:00:00.000Z",
    terminatedAt: null as string | null,
    position: "Stylist",
    assignments: [
      {
        branchId: BRANCH_ONE,
        isPrimary: true,
        canClockIn: true,
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveUntil: null as string | null,
        status: "ACTIVE",
      },
    ],
  };
}

test("employee create input canonicalizes identity and resolves primary branch", () => {
  const employee = attendanceEmployeeCreateInputSchema.parse(
    validEmployeeInput(),
  );

  assert.equal(employee.employeeCode, "EMP-001");
  assert.equal(employee.fullName, "Amy Tan");
  assert.equal(employee.phoneNumber, "+60123456789");
  assert.equal(employee.attendanceEnabled, true);
  assert.equal(getPrimaryAttendanceBranchId(employee), BRANCH_ONE);
});

test("employee rules reject duplicate branches and invalid primary assignment counts", () => {
  const duplicate = validEmployeeInput();
  duplicate.assignments.push({
    ...duplicate.assignments[0],
  });
  const result = attendanceEmployeeCreateInputSchema.safeParse(duplicate);

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(
      result.error.issues.map((issue) => issue.message).join(" "),
      /assigned only once/,
    );
    assert.match(
      result.error.issues.map((issue) => issue.message).join(" "),
      /exactly one active primary/,
    );
  }

  const noPrimary = validEmployeeInput();
  noPrimary.assignments[0].isPrimary = false;
  assert.equal(
    attendanceEmployeeCreateInputSchema.safeParse(noPrimary).success,
    false,
  );
});

test("attendance requires the active primary assignment itself to allow clock in", () => {
  const employee = validEmployeeInput();
  employee.assignments[0].canClockIn = false;
  employee.assignments.push({
    branchId: BRANCH_TWO,
    isPrimary: false,
    canClockIn: true,
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    effectiveUntil: null,
    status: "ACTIVE",
  });

  const result = attendanceEmployeeCreateInputSchema.safeParse(employee);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(
      result.error.issues.map((issue) => issue.message).join(" "),
      /active primary branch that allows clock in/,
    );
  }
});

test("suspended employees cannot use attendance or clock in", () => {
  const suspended = validEmployeeInput();
  suspended.status = "SUSPENDED";
  assert.equal(
    attendanceEmployeeCreateInputSchema.safeParse(suspended).success,
    false,
  );

  suspended.attendanceEnabled = false;
  suspended.assignments[0].canClockIn = false;
  assert.equal(
    attendanceEmployeeCreateInputSchema.safeParse(suspended).success,
    true,
  );
});

test("terminated employees require a valid date and inactive assignments", () => {
  const terminated = validEmployeeInput();
  terminated.status = "TERMINATED";
  terminated.attendanceEnabled = false;
  terminated.assignments[0] = {
    ...terminated.assignments[0],
    isPrimary: false,
    canClockIn: false,
    status: "INACTIVE",
  };

  assert.equal(
    attendanceEmployeeCreateInputSchema.safeParse(terminated).success,
    false,
  );

  terminated.terminatedAt = "2026-07-31T00:00:00.000Z";
  assert.equal(
    attendanceEmployeeCreateInputSchema.safeParse(terminated).success,
    true,
  );

  terminated.terminatedAt = "2026-06-30T00:00:00.000Z";
  assert.equal(
    attendanceEmployeeCreateInputSchema.safeParse(terminated).success,
    false,
  );

  terminated.terminatedAt = "2026-07-31T00:00:00.000Z";
  terminated.assignments = [];
  assert.equal(
    attendanceEmployeeCreateInputSchema.safeParse(terminated).success,
    true,
  );
});

test("inactive assignments cannot be primary, clockable, or have an invalid range", () => {
  const employee = validEmployeeInput();
  employee.assignments.push({
    branchId: BRANCH_TWO,
    isPrimary: true,
    canClockIn: true,
    effectiveFrom: "2026-07-10T00:00:00.000Z",
    effectiveUntil: "2026-07-09T00:00:00.000Z",
    status: "INACTIVE",
  });
  const result = attendanceEmployeeCreateInputSchema.safeParse(employee);

  assert.equal(result.success, false);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => issue.message)
      .join(" ");
    assert.match(messages, /Inactive branch assignments/);
    assert.match(messages, /end must be after/);
  }
});

test("database validation is injectable and enforces branch tenant/status and uniqueness", async () => {
  const queries: unknown[] = [];
  const database: AttendanceEmployeeValidationDatabase = {
    branch: {
      findMany: async (query) => {
        queries.push(query);
        return [{ id: BRANCH_ONE, status: "ACTIVE" }];
      },
    },
    employeeBusinessMembership: {
      findMany: async (query) => {
        queries.push(query);
        return [];
      },
    },
  };

  const employee = await validateAttendanceEmployeeCreate(
    validEmployeeInput(),
    database,
  );
  assert.equal(employee.phoneNumber, "+60123456789");
  assert.equal(queries.length, 2);

  const missingBranchDatabase: AttendanceEmployeeValidationDatabase = {
    ...database,
    branch: { findMany: async () => [] },
  };
  await assert.rejects(
    validateAttendanceEmployeeCreate(
      validEmployeeInput(),
      missingBranchDatabase,
    ),
    /outside the selected business/,
  );

  const inactiveBranchDatabase: AttendanceEmployeeValidationDatabase = {
    ...database,
    branch: {
      findMany: async () => [{ id: BRANCH_ONE, status: "INACTIVE" }],
    },
  };
  await assert.rejects(
    validateAttendanceEmployeeCreate(
      validEmployeeInput(),
      inactiveBranchDatabase,
    ),
    /inactive branch/,
  );

  const duplicateCodeDatabase: AttendanceEmployeeValidationDatabase = {
    ...database,
    employeeBusinessMembership: {
      findMany: async () => [
        {
          id: EMPLOYEE_ID,
          employeeCode: "EMP-001",
          phoneNumberNormalized: "+60199999999",
        },
      ],
    },
  };
  await assert.rejects(
    validateAttendanceEmployeeCreate(
      validEmployeeInput(),
      duplicateCodeDatabase,
    ),
    /code is already used/,
  );

  const duplicatePhoneDatabase: AttendanceEmployeeValidationDatabase = {
    ...database,
    employeeBusinessMembership: {
      findMany: async () => [
        {
          id: EMPLOYEE_ID,
          employeeCode: "EMP-999",
          phoneNumberNormalized: "+60123456789",
        },
      ],
    },
  };
  await assert.rejects(
    validateAttendanceEmployeeCreate(
      validEmployeeInput(),
      duplicatePhoneDatabase,
    ),
    /phone is already used/,
  );
});

test("update validation excludes the current employee from conflict lookup", async () => {
  const queries: unknown[] = [];
  const database: AttendanceEmployeeValidationDatabase = {
    branch: {
      findMany: async (query) => {
        queries.push(query);
        return [{ id: BRANCH_ONE, status: "ACTIVE" }];
      },
    },
    employeeBusinessMembership: {
      findMany: async (query) => {
        queries.push(query);
        return [];
      },
    },
  };
  const input = {
    ...validEmployeeInput(),
    employeeId: EMPLOYEE_ID,
  };

  const employee = await validateAttendanceEmployeeUpdate(
    input,
    database,
  );
  assert.equal(
    attendanceEmployeeUpdateInputSchema.safeParse(input).success,
    true,
  );
  assert.equal(employee.employeeId, EMPLOYEE_ID);
  assert.deepEqual(
    queries[1],
    {
      where: {
        businessId: BUSINESS_ID,
        OR: [
          { employeeCode: "EMP-001" },
          { phoneNumberNormalized: "+60123456789" },
        ],
        id: { not: EMPLOYEE_ID },
      },
      select: {
        id: true,
        employeeCode: true,
        phoneNumberNormalized: true,
      },
    },
  );
});
