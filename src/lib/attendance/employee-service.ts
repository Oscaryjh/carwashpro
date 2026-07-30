import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  attendanceEmployeeAssignmentSchema,
  getPrimaryAttendanceBranchId,
  validateAttendanceEmployeeCreate,
  validateAttendanceEmployeeUpdate,
  type AttendanceEmployeeUpdateInput,
} from "@/lib/attendance/employee";
import { maskAttendancePhone } from "@/lib/attendance/phone";
import {
  writeAuditLog,
  type AuditRequestContext,
  type WriteAuditLogInput,
} from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { synchronizeTeamMemberEmploymentState } from "@/lib/team/people-status";

export type AttendanceServiceActor = NonNullable<
  WriteAuditLogInput["actor"]
>;

export type AttendanceServiceContext = {
  businessId: string;
  allowedBranchIds: readonly string[];
  actor: AttendanceServiceActor;
  request?: AuditRequestContext;
  wholeBusinessScope?: boolean;
};

export type AttendanceServiceDatabase = PrismaClient;

export type CreateAttendanceEmployeeArgs = AttendanceServiceContext & {
  input: unknown;
};

export type UpdateAttendanceEmployeeArgs = AttendanceServiceContext & {
  input: unknown;
  expectedUpdatedAt: string | Date;
};

const employeeServiceInclude = {
  employeeAccount: {
    select: {
      id: true,
      phoneNormalized: true,
      status: true,
    },
  },
  branchAssignments: {
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  },
} satisfies Prisma.EmployeeBusinessMembershipInclude;

export async function createAttendanceEmployee(
  args: CreateAttendanceEmployeeArgs,
  database: AttendanceServiceDatabase = prisma,
) {
  return database.$transaction((transaction) =>
    createAttendanceEmployeeInTransaction(args, transaction),
  );
}

export async function createAttendanceEmployeeInTransaction(
  args: CreateAttendanceEmployeeArgs,
  transaction: Prisma.TransactionClient,
) {
  const validatedEmployee = await validateAttendanceEmployeeCreate(
    bindTrustedBusinessId(args.input, args.businessId),
    transaction,
  );
  assertAllowedBranches(
    validatedEmployee.assignments,
    args.allowedBranchIds,
  );

  const employeeAccount = await transaction.employeeAccount.upsert({
    where: {
      phoneNormalized: validatedEmployee.phoneNumber,
    },
    create: {
      phoneNumber: validatedEmployee.phoneNumber,
      phoneNormalized: validatedEmployee.phoneNumber,
      name: validatedEmployee.fullName,
      status: "ACTIVE",
    },
    update: {
      phoneNumber: validatedEmployee.phoneNumber,
    },
    select: {
      id: true,
    },
  });

  const membership =
    await transaction.employeeBusinessMembership.create({
      data: {
        employeeAccountId: employeeAccount.id,
        businessId: args.businessId,
        employeeCode: validatedEmployee.employeeCode,
        fullName: validatedEmployee.fullName,
        phoneNumber: validatedEmployee.phoneNumber,
        phoneNumberNormalized: validatedEmployee.phoneNumber,
        employmentType: validatedEmployee.employmentType,
        status: validatedEmployee.status,
        attendanceEnabled: validatedEmployee.attendanceEnabled,
        joinedAt: validatedEmployee.joinedAt,
        terminatedAt: validatedEmployee.terminatedAt,
        position: validatedEmployee.position,
      },
    });

  for (const assignment of validatedEmployee.assignments) {
    await transaction.employeeBranchAssignment.create({
      data: {
        membershipId: membership.id,
        businessId: args.businessId,
        branchId: assignment.branchId,
        isPrimary: assignment.isPrimary,
        canClockIn: assignment.canClockIn,
        effectiveFrom:
          assignment.effectiveFrom ?? validatedEmployee.joinedAt,
        effectiveUntil: assignment.effectiveUntil,
        status: assignment.status,
      },
    });
  }

  const created =
    await transaction.employeeBusinessMembership.findUniqueOrThrow({
      where: {
        id: membership.id,
      },
      include: employeeServiceInclude,
    });

  await writeAuditLog(
    {
      businessId: args.businessId,
      branchId: getAllowedAuditBranchId(
        getPrimaryAttendanceBranchId(validatedEmployee),
        args.allowedBranchIds,
      ),
      actor: args.actor,
      request: args.request,
      action: "EMPLOYEE_CREATED",
      entityType: "EmployeeBusinessMembership",
      entityId: created.id,
      summary: `Employee ${created.employeeCode} created.`,
      after: employeeAuditSnapshot(
        created,
        args.allowedBranchIds,
      ),
    },
    transaction,
  );

  return created;
}

export async function updateAttendanceEmployee(
  args: UpdateAttendanceEmployeeArgs,
  database: AttendanceServiceDatabase = prisma,
) {
  return database.$transaction((transaction) =>
    updateAttendanceEmployeeInTransaction(args, transaction),
  );
}

export async function updateAttendanceEmployeeInTransaction(
  args: UpdateAttendanceEmployeeArgs,
  transaction: Prisma.TransactionClient,
) {
  const trustedInput = bindTrustedBusinessId(
    args.input,
    args.businessId,
  );
  const employeeId = z
    .string()
    .uuid("Employee is invalid.")
    .parse(trustedInput["employeeId"]);
  const expectedUpdatedAt = z.coerce
    .date()
    .parse(args.expectedUpdatedAt);
  const submittedAssignments =
    attendanceEmployeeAssignmentSchema
      .array()
      .max(100, "Too many branch assignments.")
      .parse(trustedInput["assignments"]);
  assertAllowedBranches(submittedAssignments, args.allowedBranchIds);

  const existing =
      await transaction.employeeBusinessMembership.findFirst({
        where: {
          id: employeeId,
          businessId: args.businessId,
        },
        include: employeeServiceInclude,
      });

    if (!existing) {
      throw new Error("Employee was not found in the selected business.");
    }

    const now = new Date();
    const allowedBranchIds = new Set(args.allowedBranchIds);
    if (
      !args.wholeBusinessScope &&
      !existing.branchAssignments.some(
        (assignment) =>
          allowedBranchIds.has(assignment.branchId) &&
          isAssignmentCurrentAt(assignment, now),
      )
    ) {
      throw new Error(
        "Employee is outside the allowed branch scope.",
      );
    }

    const preservedOutOfScopeAssignments =
      args.wholeBusinessScope
        ? []
        : existing.branchAssignments
            .filter(
              (assignment) =>
                assignment.status === "ACTIVE" &&
                !allowedBranchIds.has(assignment.branchId),
            )
            .map((assignment) => ({
              branchId: assignment.branchId,
              isPrimary: assignment.isPrimary,
              canClockIn: assignment.canClockIn,
              effectiveFrom: assignment.effectiveFrom,
              effectiveUntil: assignment.effectiveUntil,
              status: assignment.status,
            }));
    const employee = await validateAttendanceEmployeeUpdate(
      {
        ...trustedInput,
        assignments: [
          ...submittedAssignments,
          ...preservedOutOfScopeAssignments,
        ],
      },
      transaction,
    );

    const desiredBranchIds = new Set(
      submittedAssignments.map((assignment) => assignment.branchId),
    );
    const activeAssignmentsToEnd = existing.branchAssignments.filter(
      (assignment) =>
        assignment.status === "ACTIVE" &&
        (args.wholeBusinessScope ||
          allowedBranchIds.has(assignment.branchId)) &&
        !desiredBranchIds.has(assignment.branchId),
    );
    if (!args.wholeBusinessScope) {
      assertAllowedBranches(
        activeAssignmentsToEnd,
        args.allowedBranchIds,
      );
    }

    const previousSnapshot = employeeAuditSnapshot(
      existing,
      args.allowedBranchIds,
    );
    const previousPrimaryBranchId =
      getStoredPrimaryBranchId(existing.branchAssignments);
    const nextPrimaryBranchId = getPrimaryAttendanceBranchId(employee);

    const employeeAccountId = await resolveEmployeeAccountForUpdate(
      transaction,
      existing,
      employee,
    );

    if (previousPrimaryBranchId !== nextPrimaryBranchId) {
      const primaryAssignments = existing.branchAssignments.filter(
        (assignment) =>
          assignment.status === "ACTIVE" && assignment.isPrimary,
      );
      if (!args.wholeBusinessScope) {
        assertAllowedBranches(primaryAssignments, args.allowedBranchIds);
      }

      for (const assignment of primaryAssignments) {
        await transaction.employeeBranchAssignment.update({
          where: { id: assignment.id },
          data: { isPrimary: false },
        });
      }
    }

    const membershipUpdate =
      await transaction.employeeBusinessMembership.updateMany({
        where: {
          id: existing.id,
          businessId: args.businessId,
          updatedAt: expectedUpdatedAt,
        },
        data: {
          employeeAccountId,
          employeeCode: employee.employeeCode,
          fullName: employee.fullName,
          phoneNumber: employee.phoneNumber,
          phoneNumberNormalized: employee.phoneNumber,
          employmentType: employee.employmentType,
          status: employee.status,
          attendanceEnabled: employee.attendanceEnabled,
          joinedAt: employee.joinedAt,
          terminatedAt: employee.terminatedAt,
          position: employee.position,
        },
      });

    if (membershipUpdate.count === 0) {
      throw new Error(
        "Employee was changed by another user. Reload and try again.",
      );
    }

    const assignmentChanges = await reconcileAssignments({
      transaction,
      businessId: args.businessId,
      membershipId: existing.id,
      existingAssignments: existing.branchAssignments,
      desiredAssignments: submittedAssignments,
      allowedBranchIds: args.allowedBranchIds,
      wholeBusinessScope: args.wholeBusinessScope === true,
      now,
    });

    const updatedBeforePeopleSynchronization =
      await transaction.employeeBusinessMembership.findUniqueOrThrow({
        where: {
          id: existing.id,
        },
        include: employeeServiceInclude,
      });
    const peopleSynchronization = await synchronizeTeamMemberEmploymentState(
      transaction,
      {
        businessId: args.businessId,
        employeeAccountId:
          updatedBeforePeopleSynchronization.employeeAccountId,
        fullName: updatedBeforePeopleSynchronization.fullName,
        membershipId: updatedBeforePeopleSynchronization.id,
        phoneNumberNormalized:
          updatedBeforePeopleSynchronization.phoneNumberNormalized,
        status: updatedBeforePeopleSynchronization.status,
      },
    );
    const updated =
      await transaction.employeeBusinessMembership.findUniqueOrThrow({
        where: {
          id: existing.id,
        },
        include: employeeServiceInclude,
      });
    const nextSnapshot = employeeAuditSnapshot(
      updated,
      args.allowedBranchIds,
    );

    await writeAuditLog(
      {
        businessId: args.businessId,
        branchId:
          getAllowedAuditBranchId(
            getStoredPrimaryBranchId(updated.branchAssignments) ??
              previousPrimaryBranchId,
            args.allowedBranchIds,
          ),
        actor: args.actor,
        request: args.request,
        action: "EMPLOYEE_UPDATED",
        entityType: "EmployeeBusinessMembership",
        entityId: updated.id,
        summary: `Employee ${updated.employeeCode} updated.`,
        before: previousSnapshot,
        after: nextSnapshot,
        metadata: {
          statusChanged: existing.status !== updated.status,
          attendanceChanged:
            existing.attendanceEnabled !== updated.attendanceEnabled,
          primaryBranchChanged:
            previousPrimaryBranchId !==
            getStoredPrimaryBranchId(updated.branchAssignments),
          assignmentsChanged:
            assignmentFingerprint(existing.branchAssignments) !==
            assignmentFingerprint(updated.branchAssignments),
          peopleSynchronization,
        },
      },
      transaction,
    );

    const updatedPrimaryBranchId = getStoredPrimaryBranchId(
      updated.branchAssignments,
    );
    if (previousPrimaryBranchId !== updatedPrimaryBranchId) {
      await writeAuditLog(
        {
          businessId: args.businessId,
          branchId: getAllowedAuditBranchId(
            updatedPrimaryBranchId ?? previousPrimaryBranchId,
            args.allowedBranchIds,
          ),
          actor: args.actor,
          request: args.request,
          action: "EMPLOYEE_PRIMARY_BRANCH_CHANGED",
          entityType: "EmployeeBusinessMembership",
          entityId: updated.id,
          summary: `Primary branch changed for employee ${updated.employeeCode}.`,
          before: {
            primaryBranchId: getAllowedAuditBranchId(
              previousPrimaryBranchId,
              args.allowedBranchIds,
            ),
          },
          after: {
            primaryBranchId: getAllowedAuditBranchId(
              updatedPrimaryBranchId,
              args.allowedBranchIds,
            ),
          },
        },
        transaction,
      );
    }

    for (const change of assignmentChanges) {
      await writeAuditLog(
        {
          businessId: args.businessId,
          branchId: change.branchId,
          actor: args.actor,
          request: args.request,
          action:
            change.kind === "ASSIGNED"
              ? "EMPLOYEE_BRANCH_ASSIGNED"
              : "EMPLOYEE_BRANCH_ASSIGNMENT_UPDATED",
          entityType: "EmployeeBusinessMembership",
          entityId: updated.id,
          summary: `Branch assignment ${change.change.toLowerCase()} for employee ${updated.employeeCode}.`,
          before: change.before,
          after: change.after,
          metadata: {
            assignmentId: change.assignmentId,
            branchId: change.branchId,
            change: change.change,
          },
        },
        transaction,
      );
    }

    if (existing.status !== updated.status) {
      await writeAuditLog(
        {
          businessId: args.businessId,
          branchId: getAllowedAuditBranchId(
            updatedPrimaryBranchId ?? previousPrimaryBranchId,
            args.allowedBranchIds,
          ),
          actor: args.actor,
          request: args.request,
          action: "EMPLOYEE_STATUS_CHANGED",
          entityType: "EmployeeBusinessMembership",
          entityId: updated.id,
          summary: `Employee ${updated.employeeCode} status changed to ${updated.status}.`,
          before: { status: existing.status },
          after: { status: updated.status },
        },
        transaction,
      );

      const lifecycleAction =
        updated.status === "SUSPENDED"
          ? "EMPLOYEE_SUSPENDED"
          : updated.status === "TERMINATED"
            ? "EMPLOYEE_TERMINATED"
            : existing.status === "TERMINATED" &&
                updated.status === "ACTIVE"
              ? "EMPLOYEE_REACTIVATED"
              : null;

      if (lifecycleAction) {
        await writeAuditLog(
          {
            businessId: args.businessId,
            branchId: getAllowedAuditBranchId(
              updatedPrimaryBranchId ?? previousPrimaryBranchId,
              args.allowedBranchIds,
            ),
            actor: args.actor,
            request: args.request,
            action: lifecycleAction,
            entityType: "EmployeeBusinessMembership",
            entityId: updated.id,
            summary: `Employee ${updated.employeeCode} status changed to ${updated.status}.`,
            before: { status: existing.status },
            after: { status: updated.status },
          },
          transaction,
        );
      }
    }

    if (
      existing.attendanceEnabled !== updated.attendanceEnabled
    ) {
      await writeAuditLog(
        {
          businessId: args.businessId,
          branchId:
            getAllowedAuditBranchId(
              getStoredPrimaryBranchId(updated.branchAssignments) ??
                previousPrimaryBranchId,
              args.allowedBranchIds,
            ),
          actor: args.actor,
          request: args.request,
          action: updated.attendanceEnabled
            ? "EMPLOYEE_ATTENDANCE_ENABLED"
            : "EMPLOYEE_ATTENDANCE_DISABLED",
          entityType: "EmployeeBusinessMembership",
          entityId: updated.id,
          summary: `Attendance ${updated.attendanceEnabled ? "enabled" : "disabled"} for employee ${updated.employeeCode}.`,
          before: {
            attendanceEnabled: existing.attendanceEnabled,
          },
          after: {
            attendanceEnabled: updated.attendanceEnabled,
          },
        },
        transaction,
      );
    }

  return updated;
}

type StoredAssignment = {
  id: string;
  branchId: string;
  isPrimary: boolean;
  canClockIn: boolean;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  status: "ACTIVE" | "INACTIVE";
};

type ReconcileAssignmentsArgs = {
  transaction: Prisma.TransactionClient;
  businessId: string;
  membershipId: string;
  existingAssignments: StoredAssignment[];
  desiredAssignments: AttendanceEmployeeUpdateInput["assignments"];
  allowedBranchIds: readonly string[];
  wholeBusinessScope: boolean;
  now: Date;
};

type AssignmentAuditChange = {
  kind: "ASSIGNED" | "UPDATED";
  change: "CREATED" | "REACTIVATED" | "UPDATED" | "ENDED";
  assignmentId: string;
  branchId: string;
  before: ReturnType<typeof assignmentAuditSnapshot> | null;
  after: ReturnType<typeof assignmentAuditSnapshot>;
};

function assignmentAuditSnapshot(assignment: StoredAssignment) {
  return {
    branchId: assignment.branchId,
    isPrimary: assignment.isPrimary,
    canClockIn: assignment.canClockIn,
    effectiveFrom: assignment.effectiveFrom,
    effectiveUntil: assignment.effectiveUntil,
    status: assignment.status,
  };
}

async function reconcileAssignments({
  transaction,
  businessId,
  membershipId,
  existingAssignments,
  desiredAssignments,
  allowedBranchIds,
  wholeBusinessScope,
  now,
}: ReconcileAssignmentsArgs) {
  const changes: AssignmentAuditChange[] = [];
  const allowed = new Set(allowedBranchIds);
  const desiredBranchIds = new Set(
    desiredAssignments.map((assignment) => assignment.branchId),
  );

  for (const assignment of existingAssignments) {
    if (
      assignment.status === "ACTIVE" &&
      (wholeBusinessScope ||
        allowed.has(assignment.branchId)) &&
      !desiredBranchIds.has(assignment.branchId)
    ) {
      const ended = await transaction.employeeBranchAssignment.update({
        where: { id: assignment.id },
        data: {
          isPrimary: false,
          canClockIn: false,
          effectiveUntil: assignment.effectiveUntil ?? now,
          status: "INACTIVE",
        },
      });
      changes.push({
        kind: "UPDATED",
        change: "ENDED",
        assignmentId: ended.id,
        branchId: ended.branchId,
        before: assignmentAuditSnapshot(assignment),
        after: assignmentAuditSnapshot(ended),
      });
    }
  }

  for (const desired of desiredAssignments) {
    assertAllowedBranches([desired], allowedBranchIds);
    const candidates = existingAssignments.filter(
      (assignment) => assignment.branchId === desired.branchId,
    );
    const current = candidates.find(
      (assignment) => assignment.status === "ACTIVE",
    );

    if (!current && desired.status === "ACTIVE") {
      const created =
        await transaction.employeeBranchAssignment.create({
          data: {
            membershipId,
            businessId,
            branchId: desired.branchId,
            isPrimary: desired.isPrimary,
            canClockIn: desired.canClockIn,
            effectiveFrom: desired.effectiveFrom ?? now,
            effectiveUntil: desired.effectiveUntil,
            status: desired.status,
          },
        });
      changes.push({
        kind: "ASSIGNED",
        change:
          candidates.length > 0 ? "REACTIVATED" : "CREATED",
        assignmentId: created.id,
        branchId: created.branchId,
        before: null,
        after: assignmentAuditSnapshot(created),
      });
      continue;
    }

    const assignmentToUpdate = current ?? candidates[0];
    if (!assignmentToUpdate) {
      const created =
        await transaction.employeeBranchAssignment.create({
          data: {
            membershipId,
            businessId,
            branchId: desired.branchId,
            isPrimary: desired.isPrimary,
            canClockIn: desired.canClockIn,
            effectiveFrom: desired.effectiveFrom ?? now,
            effectiveUntil: desired.effectiveUntil ?? now,
            status: desired.status,
          },
        });
      changes.push({
        kind: "ASSIGNED",
        change: "CREATED",
        assignmentId: created.id,
        branchId: created.branchId,
        before: null,
        after: assignmentAuditSnapshot(created),
      });
      continue;
    }

    const updated = await transaction.employeeBranchAssignment.update({
      where: { id: assignmentToUpdate.id },
      data: {
        isPrimary: desired.isPrimary,
        canClockIn: desired.canClockIn,
        effectiveFrom:
          desired.effectiveFrom ??
          assignmentToUpdate.effectiveFrom,
        effectiveUntil:
          desired.status === "INACTIVE"
            ? desired.effectiveUntil ??
              assignmentToUpdate.effectiveUntil ??
              now
            : desired.effectiveUntil,
        status: desired.status,
      },
    });
    changes.push({
      kind: "UPDATED",
      change: "UPDATED",
      assignmentId: updated.id,
      branchId: updated.branchId,
      before: assignmentAuditSnapshot(assignmentToUpdate),
      after: assignmentAuditSnapshot(updated),
    });
  }

  return changes;
}

async function resolveEmployeeAccountForUpdate(
  transaction: Prisma.TransactionClient,
  existing: Prisma.EmployeeBusinessMembershipGetPayload<{
    include: typeof employeeServiceInclude;
  }>,
  employee: AttendanceEmployeeUpdateInput,
) {
  if (
    existing.employeeAccount.phoneNormalized === employee.phoneNumber
  ) {
    await transaction.employeeAccount.update({
      where: { id: existing.employeeAccountId },
      data: {
        phoneNumber: employee.phoneNumber,
      },
    });
    return existing.employeeAccountId;
  }

  const hasIdentityHistory = await hasAttendanceIdentityHistory(
    transaction,
    existing.id,
    existing.employeeAccountId,
  );

  const targetAccount = await transaction.employeeAccount.findUnique({
    where: {
      phoneNormalized: employee.phoneNumber,
    },
    select: {
      id: true,
    },
  });

  if (targetAccount) {
    if (hasIdentityHistory) {
      throw new Error(
        "Employee phone cannot be changed after Attendance identity history exists.",
      );
    }
    return targetAccount.id;
  }

  const accountMembershipCount =
    await transaction.employeeBusinessMembership.count({
      where: {
        employeeAccountId: existing.employeeAccountId,
      },
    });

  if (accountMembershipCount === 1) {
    if (hasIdentityHistory) {
      throw new Error(
        "Employee phone cannot be changed after Attendance identity history exists.",
      );
    }

    await transaction.employeeAccount.update({
      where: {
        id: existing.employeeAccountId,
      },
      data: {
        phoneNumber: employee.phoneNumber,
        phoneNormalized: employee.phoneNumber,
      },
    });
    return existing.employeeAccountId;
  }

  if (hasIdentityHistory) {
    throw new Error(
      "Employee phone cannot be changed after Attendance identity history exists.",
    );
  }

  const newAccount = await transaction.employeeAccount.create({
    data: {
      phoneNumber: employee.phoneNumber,
      phoneNormalized: employee.phoneNumber,
      name: employee.fullName,
      status: "ACTIVE",
    },
    select: {
      id: true,
    },
  });
  return newAccount.id;
}

async function hasAttendanceIdentityHistory(
  transaction: Prisma.TransactionClient,
  membershipId: string,
  employeeAccountId: string,
) {
  const [
    attendanceSessions,
    punches,
    exceptions,
    adjustments,
    otpChallenges,
    devices,
    employeeSessions,
    idempotencyRequests,
  ] = await Promise.all([
      transaction.employeeAttendance.count({
        where: { membershipId },
      }),
      transaction.attendancePunch.count({
        where: { employeeId: membershipId },
      }),
      transaction.attendanceException.count({
        where: { employeeId: membershipId },
      }),
      transaction.attendanceAdjustment.count({
        where: { employeeId: membershipId },
      }),
      transaction.employeeOtpChallenge.count({
        where: { employeeAccountId },
      }),
      transaction.employeeDevice.count({
        where: { employeeAccountId },
      }),
      transaction.employeeSession.count({
        where: { membershipId },
      }),
      transaction.attendanceRequestIdempotency.count({
        where: { membershipId },
      }),
    ]);

  return (
    attendanceSessions > 0 ||
    punches > 0 ||
    exceptions > 0 ||
    adjustments > 0 ||
    otpChallenges > 0 ||
    devices > 0 ||
    employeeSessions > 0 ||
    idempotencyRequests > 0
  );
}

function bindTrustedBusinessId(
  input: unknown,
  businessId: string,
): Record<string, unknown> & { businessId: string } {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    throw new Error("Employee input is invalid.");
  }

  return {
    ...(input as Record<string, unknown>),
    businessId,
  };
}

function isAssignmentCurrentAt(
  assignment: Pick<
    StoredAssignment,
    "status" | "effectiveFrom" | "effectiveUntil"
  >,
  at: Date,
) {
  return (
    assignment.status === "ACTIVE" &&
    assignment.effectiveFrom <= at &&
    (!assignment.effectiveUntil || assignment.effectiveUntil >= at)
  );
}

function assertAllowedBranches(
  assignments: ReadonlyArray<{ branchId: string }>,
  allowedBranchIds: readonly string[],
) {
  const allowed = new Set(allowedBranchIds);
  for (const assignment of assignments) {
    if (!allowed.has(assignment.branchId)) {
      throw new Error(
        "Employee branch assignment is outside the allowed branch scope.",
      );
    }
  }
}

function getStoredPrimaryBranchId(
  assignments: ReadonlyArray<{
    branchId: string;
    isPrimary: boolean;
    status: "ACTIVE" | "INACTIVE";
  }>,
) {
  return (
    assignments.find(
      (assignment) =>
        assignment.status === "ACTIVE" && assignment.isPrimary,
    )?.branchId ?? null
  );
}

function employeeAuditSnapshot(
  employee: Prisma.EmployeeBusinessMembershipGetPayload<{
    include: typeof employeeServiceInclude;
  }>,
  allowedBranchIds: readonly string[],
) {
  const allowed = new Set(allowedBranchIds);
  const assignments = employee.branchAssignments.filter(
    (assignment) => allowed.has(assignment.branchId),
  );

  return {
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    phoneMasked: maskAttendancePhone(employee.phoneNumberNormalized),
    employmentType: employee.employmentType,
    status: employee.status,
    attendanceEnabled: employee.attendanceEnabled,
    joinedAt: employee.joinedAt,
    terminatedAt: employee.terminatedAt,
    position: employee.position,
    primaryBranchId: getStoredPrimaryBranchId(
      assignments,
    ),
    assignments: assignments.map((assignment) => ({
      branchId: assignment.branchId,
      isPrimary: assignment.isPrimary,
      canClockIn: assignment.canClockIn,
      effectiveFrom: assignment.effectiveFrom,
      effectiveUntil: assignment.effectiveUntil,
      status: assignment.status,
    })),
  };
}

function getAllowedAuditBranchId(
  branchId: string | null,
  allowedBranchIds: readonly string[],
) {
  if (!branchId) {
    return null;
  }

  return allowedBranchIds.includes(branchId) ? branchId : null;
}

function assignmentFingerprint(
  assignments: ReadonlyArray<StoredAssignment>,
) {
  return assignments
    .map((assignment) => ({
      branchId: assignment.branchId,
      isPrimary: assignment.isPrimary,
      canClockIn: assignment.canClockIn,
      effectiveFrom: assignment.effectiveFrom.toISOString(),
      effectiveUntil:
        assignment.effectiveUntil?.toISOString() ?? null,
      status: assignment.status,
    }))
    .sort((left, right) =>
      `${left.branchId}:${left.effectiveFrom}`.localeCompare(
        `${right.branchId}:${right.effectiveFrom}`,
      ),
    )
    .map((assignment) => JSON.stringify(assignment))
    .join("|");
}
