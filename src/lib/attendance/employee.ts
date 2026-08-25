import { z } from "zod";
import { normalizeAttendancePhone } from "@/lib/attendance/phone";
import { prisma } from "@/lib/prisma";

const employeeEmploymentTypeSchema = z.enum([
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "DAILY",
  "HOURLY",
]);
const employeePayBasisSchema = z.enum(["MONTHLY", "DAILY", "HOURLY"]);


const employeeStatusSchema = z.enum([
  "ACTIVE",
  "SUSPENDED",
  "TERMINATED",
]);

const assignmentStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

const employeeCodeSchema = z
  .string()
  .trim()
  .min(1, "Employee code is required.")
  .max(50, "Employee code cannot exceed 50 characters.")
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => /^[A-Z0-9][A-Z0-9_-]*$/.test(value),
    "Employee code may contain only letters, numbers, underscores, and hyphens.",
  );

const employeePhoneSchema = z
  .string()
  .trim()
  .transform((value, context) => {
    const normalized = normalizeAttendancePhone(value);

    if (!normalized) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid E.164 phone number.",
      });
      return z.NEVER;
    }

    return normalized;
  });

const nullableDateSchema = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.coerce.date().nullable(),
);

const nullableDateOfBirthSchema = nullableDateSchema.refine(
  (value) => value === null || value <= new Date(),
  "Date of birth cannot be in the future.",
);

const optionalTextSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
  z.string().max(100).nullable(),
);
const optionalMoneySchema = z.preprocess(
  (value) => (value === "" || value === undefined || value === null ? null : value),
  z.coerce.number().finite().min(0, "Base salary cannot be negative.").max(100000000).nullable(),
);

const optionalMinutesSchema = z.preprocess(
  (value) => (value === "" || value === undefined || value === null ? null : value),
  z.coerce.number().int().min(0).max(1440).nullable(),
);


export const attendanceEmployeeAssignmentSchema = z.object({
  branchId: z.string().uuid("Branch is invalid."),
  isPrimary: z.boolean().default(false),
  canClockIn: z.boolean().default(true),
  effectiveFrom: z.coerce.date().optional(),
  effectiveUntil: nullableDateSchema.default(null),
  status: assignmentStatusSchema.default("ACTIVE"),
});

const employeeInputShape = {
  businessId: z.string().uuid("Business is invalid."),
  employeeCode: employeeCodeSchema,
  fullName: z
    .string()
    .trim()
    .min(1, "Employee name is required.")
    .max(120, "Employee name cannot exceed 120 characters."),
  phoneNumber: employeePhoneSchema,
  dateOfBirth: nullableDateOfBirthSchema.default(null),
  payBasis: employeePayBasisSchema.default("MONTHLY"),
  baseSalary: optionalMoneySchema.default(null),
  normalWorkMinutesPerDay: optionalMinutesSchema.default(null),
  targetBreakMinutes: optionalMinutesSchema.default(null),
  employmentType: employeeEmploymentTypeSchema.default("FULL_TIME"),
  status: employeeStatusSchema.default("ACTIVE"),
  attendanceEnabled: z.boolean().default(false),
  terminatedAt: nullableDateSchema.default(null),
  position: optionalTextSchema.default(null),
  assignments: z
    .array(attendanceEmployeeAssignmentSchema)
    .max(100, "Too many branch assignments."),
};

const attendanceEmployeeCreateObjectSchema = z.object({
  ...employeeInputShape,
  joinedAt: z.coerce.date().default(() => new Date()),
});

const attendanceEmployeeUpdateObjectSchema = z.object({
  employeeId: z.string().uuid("Employee is invalid."),
  ...employeeInputShape,
  joinedAt: z.coerce.date(),
});

export const attendanceEmployeeCreateInputSchema =
  attendanceEmployeeCreateObjectSchema.superRefine(validateEmployeeRules);

export const attendanceEmployeeUpdateInputSchema =
  attendanceEmployeeUpdateObjectSchema.superRefine(validateEmployeeRules);

export type AttendanceEmployeeCreateInput = z.infer<
  typeof attendanceEmployeeCreateInputSchema
>;

export type AttendanceEmployeeUpdateInput = z.infer<
  typeof attendanceEmployeeUpdateInputSchema
>;

type EmployeeRuleInput = z.infer<
  typeof attendanceEmployeeCreateObjectSchema
>;

type BranchLookupQuery = {
  where: {
    businessId: string;
    id: {
      in: string[];
    };
  };
  select: {
    id: true;
    status: true;
  };
};

type EmployeeConflictQuery = {
  where: {
    businessId: string;
    OR: Array<
      | { employeeCode: string }
      | { phoneNumberNormalized: string }
    >;
    id?: {
      not: string;
    };
  };
  select: {
    id: true;
    employeeCode: true;
    phoneNumberNormalized: true;
  };
};

export type AttendanceEmployeeValidationDatabase = {
  branch: {
    findMany(
      query: BranchLookupQuery,
    ): Promise<Array<{ id: string; status: "ACTIVE" | "INACTIVE" }>>;
  };
  employeeBusinessMembership: {
    findMany(
      query: EmployeeConflictQuery,
    ): Promise<
      Array<{
        id: string;
        employeeCode: string;
        phoneNumberNormalized: string;
      }>
    >;
  };
};

export async function validateAttendanceEmployeeCreate(
  input: unknown,
  database: AttendanceEmployeeValidationDatabase = prisma,
) {
  const employee = attendanceEmployeeCreateInputSchema.parse(input);
  await validateEmployeePersistenceRules(employee, undefined, database);
  return employee;
}

export async function validateAttendanceEmployeeUpdate(
  input: unknown,
  database: AttendanceEmployeeValidationDatabase = prisma,
) {
  const employee = attendanceEmployeeUpdateInputSchema.parse(input);
  await validateEmployeePersistenceRules(
    employee,
    employee.employeeId,
    database,
  );
  return employee;
}

export function getPrimaryAttendanceBranchId(
  employee:
    | AttendanceEmployeeCreateInput
    | AttendanceEmployeeUpdateInput,
) {
  return (
    employee.assignments.find(
      (assignment) =>
        assignment.status === "ACTIVE" && assignment.isPrimary,
    )?.branchId ?? null
  );
}

function validateEmployeeRules(
  employee: EmployeeRuleInput,
  context: z.RefinementCtx,
) {
  const seenBranchIds = new Set<string>();

  employee.assignments.forEach((assignment, index) => {
    if (seenBranchIds.has(assignment.branchId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each branch can be assigned only once.",
        path: ["assignments", index, "branchId"],
      });
    }
    seenBranchIds.add(assignment.branchId);

    if (
      assignment.effectiveFrom &&
      assignment.effectiveUntil &&
      assignment.effectiveUntil <= assignment.effectiveFrom
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Assignment end must be after its start.",
        path: ["assignments", index, "effectiveUntil"],
      });
    }

    if (
      assignment.status === "INACTIVE" &&
      (assignment.isPrimary || assignment.canClockIn)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Inactive branch assignments cannot be primary or allow clock in.",
        path: ["assignments", index],
      });
    }
  });

  if (
    employee.terminatedAt &&
    employee.terminatedAt < employee.joinedAt
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Termination date cannot be before join date.",
      path: ["terminatedAt"],
    });
  }

  const activeAssignments = employee.assignments.filter(
    (assignment) => assignment.status === "ACTIVE",
  );
  const activePrimaryAssignments = activeAssignments.filter(
    (assignment) => assignment.isPrimary,
  );

  if (employee.status === "TERMINATED") {
    if (!employee.terminatedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Termination date is required for a terminated employee.",
        path: ["terminatedAt"],
      });
    }
    if (employee.attendanceEnabled) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Terminated employees cannot use attendance.",
        path: ["attendanceEnabled"],
      });
    }
    if (activeAssignments.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Terminated employees cannot have active branch assignments.",
        path: ["assignments"],
      });
    }
    return;
  }

  if (employee.terminatedAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Only terminated employees may have a termination date.",
      path: ["terminatedAt"],
    });
  }

  if (activeAssignments.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Employee requires at least one active branch assignment.",
      path: ["assignments"],
    });
  }

  if (activePrimaryAssignments.length !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Employee requires exactly one active primary branch.",
      path: ["assignments"],
    });
  }

  if (employee.status === "SUSPENDED") {
    if (employee.attendanceEnabled) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Suspended employees cannot use attendance.",
        path: ["attendanceEnabled"],
      });
    }
    if (activeAssignments.some((assignment) => assignment.canClockIn)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Suspended employees cannot clock in.",
        path: ["assignments"],
      });
    }
  }

  const validationTime = new Date();
  const hasCurrentClockInPrimary = activePrimaryAssignments.some(
    (assignment) => {
      const effectiveFrom =
        assignment.effectiveFrom ?? employee.joinedAt;

      return (
        assignment.canClockIn &&
        effectiveFrom <= validationTime &&
        (!assignment.effectiveUntil ||
          assignment.effectiveUntil > validationTime)
      );
    },
  );

  if (employee.attendanceEnabled && !hasCurrentClockInPrimary) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Attendance requires a current active primary branch that allows clock in.",
      path: ["attendanceEnabled"],
    });
  }
}

async function validateEmployeePersistenceRules(
  employee:
    | AttendanceEmployeeCreateInput
    | AttendanceEmployeeUpdateInput,
  excludedEmployeeId: string | undefined,
  database: AttendanceEmployeeValidationDatabase,
) {
  const branchIds = employee.assignments.map(
    (assignment) => assignment.branchId,
  );
  const [branches, conflicts] = await Promise.all([
    database.branch.findMany({
      where: {
        businessId: employee.businessId,
        id: { in: branchIds },
      },
      select: {
        id: true,
        status: true,
      },
    }),
    database.employeeBusinessMembership.findMany({
      where: {
        businessId: employee.businessId,
        OR: [
          { employeeCode: employee.employeeCode },
          { phoneNumberNormalized: employee.phoneNumber },
        ],
        ...(excludedEmployeeId
          ? { id: { not: excludedEmployeeId } }
          : {}),
      },
      select: {
        id: true,
        employeeCode: true,
        phoneNumberNormalized: true,
      },
    }),
  ]);

  const branchStatusById = new Map(
    branches.map((branch) => [branch.id, branch.status]),
  );
  for (const assignment of employee.assignments) {
    const branchStatus = branchStatusById.get(assignment.branchId);
    if (!branchStatus) {
      throw new Error(
        "Employee branch assignment is outside the selected business.",
      );
    }
    if (assignment.status === "ACTIVE" && branchStatus !== "ACTIVE") {
      throw new Error(
        "Employee cannot have an active assignment to an inactive branch.",
      );
    }
  }

  if (
    conflicts.some(
      (conflict) => conflict.employeeCode === employee.employeeCode,
    )
  ) {
    throw new Error("Employee code is already used in this business.");
  }
  if (
    conflicts.some(
      (conflict) =>
        conflict.phoneNumberNormalized === employee.phoneNumber,
    )
  ) {
    throw new Error("Employee phone is already used in this business.");
  }
}
