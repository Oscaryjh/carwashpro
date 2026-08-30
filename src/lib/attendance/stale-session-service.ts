import type { PrismaClient } from "@prisma/client";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { calculateAttendanceDurations } from "@/lib/attendance/state-machine";
import { materializeAttendanceResolutionFoundationInTransaction } from "@/lib/attendance/resolution-service";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function reconcileStaleEmployeeAttendance(args: {
  auth: EmployeeAuthContext;
  database?: PrismaClient;
  now?: Date;
  staleAfterHours?: number;
}) {
  const database = args.database ?? prisma;
  const now = args.now ?? new Date();
  const staleAfterHours =
    args.staleAfterHours ?? readStaleSessionHours(process.env);
  const staleBefore = new Date(
    now.getTime() - staleAfterHours * 3_600_000,
  );

  return database.$transaction(async (transaction) => {
    const session = await transaction.employeeAttendance.findFirst({
      where: {
        employeeAccountId: args.auth.employeeAccountId,
        membershipId: args.auth.membershipId,
        businessId: args.auth.businessId,
        status: { in: ["OPEN", "ON_BREAK"] },
        clockInAt: { lte: staleBefore },
      },
      include: {
        punches: {
          where: { type: { in: ["BREAK_START", "BREAK_END"] } },
          orderBy: [{ serverTimestamp: "asc" }, { createdAt: "asc" }],
          select: { type: true, serverTimestamp: true },
        },
      },
    });
    if (!session) return null;

    const cutoff = new Date(
      session.clockInAt.getTime() + staleAfterHours * 3_600_000,
    );
    let totalBreakMinutes = Math.max(0, session.totalBreakMinutes);
    let totalWorkedMinutes = Math.max(
      0,
      staleAfterHours * 60 - totalBreakMinutes,
    );
    try {
      const durations = calculateAttendanceDurations({
        clockInAt: session.clockInAt,
        endAt: cutoff,
        breakPunches: session.punches
          .filter((punch) => punch.serverTimestamp <= cutoff)
          .map((punch) => ({
            type: punch.type as "BREAK_START" | "BREAK_END",
            serverTimestamp: punch.serverTimestamp,
          })),
        includeOpenBreakUntilEnd: session.status === "ON_BREAK",
      });
      totalBreakMinutes = durations.totalBreakMinutes;
      totalWorkedMinutes = durations.totalWorkedMinutes;
    } catch {
      totalBreakMinutes = Math.min(staleAfterHours * 60, totalBreakMinutes);
      totalWorkedMinutes = Math.max(
        0,
        staleAfterHours * 60 - totalBreakMinutes,
      );
    }

    const updated = await transaction.employeeAttendance.updateMany({
      where: { id: session.id, status: session.status },
      data: {
        status: "INCOMPLETE",
        totalBreakMinutes,
        totalWorkedMinutes,
        requiresApproval: true,
        approvalStatus: "PENDING",
      },
    });
    if (updated.count !== 1) return null;

    const existingException =
      await transaction.attendanceException.findFirst({
        where: {
          attendanceSessionId: session.id,
          type: "OTHER",
          status: "PENDING",
        },
        select: { id: true },
      });
    const exception =
      existingException ??
      (await transaction.attendanceException.create({
        data: {
          attendanceSessionId: session.id,
          attendancePunchId: null,
          employeeId: session.membershipId,
          businessId: session.businessId,
          branchId: session.branchId,
          type: "OTHER",
          reason: `System detected a shift open longer than ${staleAfterHours} hours. Manager adjustment is required.`,
          status: "PENDING",
        },
        select: { id: true },
      }));

    await writeAuditLog(
      {
        businessId: session.businessId,
        branchId: session.branchId,
        action: "ATTENDANCE_SESSION_MARKED_INCOMPLETE",
        entityType: "EmployeeAttendance",
        entityId: session.id,
        summary: "Stale Attendance session marked incomplete.",
        metadata: {
          membershipId: session.membershipId,
          exceptionId: exception.id,
          staleAfterHours,
        },
      },
      transaction,
    );
    await materializeAttendanceResolutionFoundationInTransaction(
      {
        businessId: session.businessId,
        allowedBranchIds: [session.branchId],
        attendanceSessionId: session.id,
      },
      transaction,
    );
    return { sessionId: session.id, exceptionId: exception.id };
  });
}

function readStaleSessionHours(env: NodeJS.ProcessEnv) {
  const parsed = Number(env.ATTENDANCE_STALE_SESSION_HOURS ?? 18);
  return Number.isInteger(parsed) && parsed >= 8 && parsed <= 72
    ? parsed
    : 18;
}
