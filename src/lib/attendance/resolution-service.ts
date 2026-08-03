import { createHash } from "node:crypto";
import {
  AttendanceFinalResultDisposition,
  AttendanceFinalResultSource,
  Prisma,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { AttendanceServiceContext } from "@/lib/attendance/employee-service";
import {
  assertAttendanceResolutionTransition,
  assertFinalAttendanceResultValues,
  classifyAttendanceSessionForResolution,
} from "@/lib/attendance/resolution-state-machine";
import { buildAttendanceSessionWhere } from "@/lib/attendance/scope";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const resolveCaseInputSchema = z.object({
  resolutionCaseId: z.string().uuid("Attendance Resolution Case is invalid."),
  disposition: z.enum(["INCLUDED", "EXCLUDED"]),
  source: z.enum([
    "RAW_SESSION",
    "APPROVED_EXCEPTION",
    "MANAGER_ADJUSTMENT",
    "CORRECTION",
  ]),
  expectedCurrentResultId: z.string().uuid().nullable().optional(),
  resultOverride: z
    .object({
      clockInAt: z.date().nullable(),
      clockOutAt: z.date().nullable(),
      totalBreakMinutes: z.number().int().nonnegative(),
      totalWorkedMinutes: z.number().int().nonnegative(),
      confirmedBreakMinutes: z.number().int().nonnegative().nullable(),
    })
    .optional(),
});

export type ResolveAttendanceCaseInput = z.infer<
  typeof resolveCaseInputSchema
>;

const transactionOptions = {
  isolationLevel: "Serializable" as const,
  maxWait: 5_000,
  timeout: 15_000,
};

export class AttendanceResolutionError extends Error {
  constructor(
    public readonly code:
      | "ACTIVE_SESSION"
      | "CASE_NOT_FOUND"
      | "CONCURRENT_CHANGE"
      | "INVALID_RESULT"
      | "SELF_RESOLUTION_FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "AttendanceResolutionError";
  }
}

type AttendanceResolutionMaterializationContext = Omit<
  AttendanceServiceContext,
  "actor"
> & {
  actor?: AttendanceServiceContext["actor"];
};

export async function materializeAttendanceResolutionFoundation(
  args: AttendanceResolutionMaterializationContext & {
    attendanceSessionId: string;
  },
  database: PrismaClient = prisma,
) {
  return withSerializableRetry(database, async () =>
    database.$transaction(
      (transaction) =>
        materializeAttendanceResolutionFoundationInTransaction(
          args,
          transaction,
        ),
      transactionOptions,
    ),
  );
}

export async function materializeAttendanceResolutionFoundationInTransaction(
  args: AttendanceResolutionMaterializationContext & {
    attendanceSessionId: string;
  },
  transaction: Prisma.TransactionClient,
) {
  const session = await transaction.employeeAttendance.findFirst({
    where: buildAttendanceSessionWhere<Prisma.EmployeeAttendanceWhereInput>(
      {
        businessId: args.businessId,
        allowedBranchIds: args.allowedBranchIds,
      },
      { id: args.attendanceSessionId },
    ),
    include: {
      adjustments: { select: { id: true }, take: 1 },
      resolutionCase: {
        include: { currentFinalResult: true },
      },
    },
  });
  if (!session) {
    throw new AttendanceResolutionError(
      "CASE_NOT_FOUND",
      "Attendance Session was not found in the authorized branch scope.",
    );
  }

  const classification = classifyAttendanceSessionForResolution({
    status: session.status,
    approvalStatus: session.approvalStatus,
    hasAdjustment: session.adjustments.length > 0,
    hasCompleteTime: Boolean(
      session.clockOutAt && session.clockOutAt > session.clockInAt,
    ),
  });
  if (classification.kind === "ACTIVE_SESSION") {
    throw new AttendanceResolutionError(
      "ACTIVE_SESSION",
      "An active Attendance Session cannot have a Final Attendance Result.",
    );
  }

  let resolutionCase = session.resolutionCase;
  if (!resolutionCase) {
    resolutionCase = await transaction.attendanceResolutionCase.create({
      data: {
        businessId: session.businessId,
        branchId: session.branchId,
        attendanceSessionId: session.id,
        employeeId: session.membershipId,
        status: classification.caseStatus,
        openedReason: classification.openedReason,
        createdById: args.actor?.userId ?? null,
        resolvedById:
          classification.kind === "FINAL_RESULT"
            ? args.actor?.userId ?? null
            : null,
        resolvedAt: classification.kind === "FINAL_RESULT" ? new Date() : null,
      },
      include: { currentFinalResult: true },
    });
  }

  if (
    classification.kind === "ACTION_REQUIRED" ||
    resolutionCase.currentFinalResult
  ) {
    return resolutionCase;
  }

  const result = await createFinalResultVersion(transaction, {
    caseId: resolutionCase.id,
    session,
    disposition: classification.disposition,
    source: classification.source,
    createdById: args.actor?.userId ?? null,
    supersedesResultId: null,
    version: 1,
  });
  const updatedCase = await transaction.attendanceResolutionCase.update({
    where: { id: resolutionCase.id },
    data: {
      status: "RESOLVED",
      currentFinalResultId: result.id,
      resolvedById: args.actor?.userId ?? null,
      resolvedAt: new Date(),
    },
    include: { currentFinalResult: true },
  });

  await writeAuditLog(
    {
      businessId: args.businessId,
      branchId: session.branchId,
      actor: args.actor,
      request: args.request,
      action: "ATTENDANCE_FINAL_RESULT_CREATED",
      entityType: "AttendanceFinalResult",
      entityId: result.id,
      summary: "Final Attendance Result created from the operational session.",
      after: {
        disposition: result.disposition,
        source: result.source,
        version: result.version,
      },
      metadata: {
        attendanceSessionId: session.id,
        membershipId: session.membershipId,
        resolutionCaseId: resolutionCase.id,
      },
    },
    transaction,
  );

  return updatedCase;
}

export async function resolveAttendanceCase(
  args: AttendanceServiceContext & { input: unknown },
  database: PrismaClient = prisma,
) {
  const input = resolveCaseInputSchema.parse(args.input);
  return database.$transaction(
    (transaction) => resolveAttendanceCaseInTransaction(args, input, transaction),
    transactionOptions,
  );
}

export async function resolveAttendanceCaseInTransaction(
  args: AttendanceServiceContext,
  input: ResolveAttendanceCaseInput,
  transaction: Prisma.TransactionClient,
) {
    const resolutionCase = await transaction.attendanceResolutionCase.findFirst({
      where: {
        id: input.resolutionCaseId,
        businessId: args.businessId,
        branchId: { in: [...args.allowedBranchIds] },
      },
      include: {
        attendanceSession: true,
        currentFinalResult: true,
        employee: {
          select: {
            staffUser: { select: { id: true } },
          },
        },
      },
    });
    if (!resolutionCase) {
      throw new AttendanceResolutionError(
        "CASE_NOT_FOUND",
        "Attendance Resolution Case was not found in the authorized branch scope.",
      );
    }
    if (resolutionCase.employee.staffUser?.id === args.actor.userId) {
      throw new AttendanceResolutionError(
        "SELF_RESOLUTION_FORBIDDEN",
        "A manager cannot resolve their own Attendance Session.",
      );
    }

    const actualCurrentResultId = resolutionCase.currentFinalResultId ?? null;
    if (
      input.expectedCurrentResultId !== undefined &&
      input.expectedCurrentResultId !== actualCurrentResultId
    ) {
      throw new AttendanceResolutionError(
        "CONCURRENT_CHANGE",
        "The Final Attendance Result changed. Reload before resolving it.",
      );
    }
    assertAttendanceResolutionTransition(resolutionCase.status, "RESOLVED");

    const session = resolutionCase.attendanceSession;
    if (session.status === "OPEN" || session.status === "ON_BREAK") {
      throw new AttendanceResolutionError(
        "ACTIVE_SESSION",
        "An active Attendance Session cannot be resolved.",
      );
    }

    const nextVersion = (resolutionCase.currentFinalResult?.version ?? 0) + 1;
    const result = await createFinalResultVersion(transaction, {
      caseId: resolutionCase.id,
      session,
      disposition: input.disposition,
      source: input.source,
      createdById: args.actor.userId,
      supersedesResultId: resolutionCase.currentFinalResultId,
      version: nextVersion,
      resultOverride: input.resultOverride,
    });
    const updatedCase = await transaction.attendanceResolutionCase.update({
      where: { id: resolutionCase.id },
      data: {
        status: "RESOLVED",
        currentFinalResultId: result.id,
        resolvedById: args.actor.userId,
        resolvedAt: new Date(),
      },
      include: { currentFinalResult: true },
    });

    await writeAuditLog(
      {
        businessId: args.businessId,
        branchId: resolutionCase.branchId,
        actor: args.actor,
        request: args.request,
        action:
          nextVersion === 1
            ? "ATTENDANCE_FINAL_RESULT_CREATED"
            : "ATTENDANCE_FINAL_RESULT_REVISED",
        entityType: "AttendanceFinalResult",
        entityId: result.id,
        summary:
          nextVersion === 1
            ? "Attendance Resolution Case resolved."
            : "Final Attendance Result revised without changing prior versions.",
        before: resolutionCase.currentFinalResult
          ? {
              disposition: resolutionCase.currentFinalResult.disposition,
              source: resolutionCase.currentFinalResult.source,
              version: resolutionCase.currentFinalResult.version,
            }
          : undefined,
        after: {
          disposition: result.disposition,
          source: result.source,
          version: result.version,
        },
        metadata: {
          attendanceSessionId: resolutionCase.attendanceSessionId,
          membershipId: resolutionCase.employeeId,
          resolutionCaseId: resolutionCase.id,
        },
      },
      transaction,
    );

    return updatedCase;
}

async function createFinalResultVersion(
  transaction: Prisma.TransactionClient,
  input: {
    caseId: string;
    session: ResolutionSession;
    disposition: AttendanceFinalResultDisposition;
    source: AttendanceFinalResultSource;
    createdById: string | null;
    supersedesResultId: string | null;
    version: number;
    resultOverride?: ResolveAttendanceCaseInput["resultOverride"];
  },
) {
  const resultValues = input.resultOverride ?? {
    clockInAt: input.session.clockInAt,
    clockOutAt: input.session.clockOutAt,
    totalBreakMinutes: input.session.totalBreakMinutes,
    totalWorkedMinutes: input.session.totalWorkedMinutes,
    confirmedBreakMinutes: input.session.confirmedBreakMinutes,
  };
  assertFinalAttendanceResultValues({
    disposition: input.disposition,
    clockInAt: resultValues.clockInAt,
    clockOutAt: resultValues.clockOutAt,
    totalBreakMinutes: resultValues.totalBreakMinutes,
    totalWorkedMinutes: resultValues.totalWorkedMinutes,
    expectedBreakMinutes: input.session.expectedBreakMinutes,
    confirmedBreakMinutes: resultValues.confirmedBreakMinutes,
  });

  const evidenceChecksum = attendanceResultChecksum({
    ...input,
    session: input.session,
  });
  return transaction.attendanceFinalResult.create({
    data: {
      businessId: input.session.businessId,
      branchId: input.session.branchId,
      attendanceSessionId: input.session.id,
      resolutionCaseId: input.caseId,
      employeeId: input.session.membershipId,
      version: input.version,
      disposition: input.disposition,
      source: input.source,
      workDate: input.session.workDate,
      clockInAt: resultValues.clockInAt,
      clockOutAt: resultValues.clockOutAt,
      totalBreakMinutes: resultValues.totalBreakMinutes,
      totalWorkedMinutes: resultValues.totalWorkedMinutes,
      breakPolicySnapshot: input.session.breakPolicySnapshot,
      expectedBreakMinutes: input.session.expectedBreakMinutes,
      confirmedBreakMinutes: resultValues.confirmedBreakMinutes,
      approvalStatusSnapshot: input.session.approvalStatus,
      sessionUpdatedAtSnapshot: input.session.updatedAt,
      evidenceChecksum,
      supersedesResultId: input.supersedesResultId,
      createdById: input.createdById,
    },
  });
}

type ResolutionSession = Pick<
  Prisma.EmployeeAttendanceGetPayload<Record<string, never>>,
  | "id"
  | "businessId"
  | "branchId"
  | "membershipId"
  | "workDate"
  | "clockInAt"
  | "clockOutAt"
  | "totalBreakMinutes"
  | "totalWorkedMinutes"
  | "breakPolicySnapshot"
  | "expectedBreakMinutes"
  | "confirmedBreakMinutes"
  | "approvalStatus"
  | "updatedAt"
>;

function attendanceResultChecksum(input: {
  caseId: string;
  session: ResolutionSession;
  disposition: AttendanceFinalResultDisposition;
  source: AttendanceFinalResultSource;
  supersedesResultId: string | null;
  version: number;
  resultOverride?: ResolveAttendanceCaseInput["resultOverride"];
}) {
  const resultValues = input.resultOverride ?? {
    clockInAt: input.session.clockInAt,
    clockOutAt: input.session.clockOutAt,
    totalBreakMinutes: input.session.totalBreakMinutes,
    totalWorkedMinutes: input.session.totalWorkedMinutes,
    confirmedBreakMinutes: input.session.confirmedBreakMinutes,
  };
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.caseId,
        input.session.id,
        input.session.businessId,
        input.session.branchId,
        input.session.membershipId,
        input.session.workDate.toISOString(),
        resultValues.clockInAt?.toISOString() ?? null,
        resultValues.clockOutAt?.toISOString() ?? null,
        resultValues.totalBreakMinutes,
        resultValues.totalWorkedMinutes,
        input.session.breakPolicySnapshot,
        input.session.expectedBreakMinutes,
        resultValues.confirmedBreakMinutes,
        input.session.approvalStatus,
        input.session.updatedAt.toISOString(),
        input.disposition,
        input.source,
        input.version,
        input.supersedesResultId,
      ]),
      "utf8",
    )
    .digest("hex");
}

async function withSerializableRetry<T>(
  database: PrismaClient,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      return operation();
    }
    throw error;
  }
}
