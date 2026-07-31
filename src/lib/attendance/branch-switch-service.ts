import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AttendanceApiError } from "@/lib/attendance/api-error";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const inputSchema = z.object({
  branchId: z.string().uuid("Branch is invalid."),
});

export async function switchEmployeeAttendanceBranch(args: {
  auth: EmployeeAuthContext;
  input: unknown;
  database?: PrismaClient;
  now?: Date;
}) {
  const database = args.database ?? prisma;
  const now = args.now ?? new Date();
  const input = inputSchema.parse(args.input);

  return database.$transaction(async (transaction) => {
    const activeSession =
      await transaction.employeeAttendance.findFirst({
        where: {
          employeeAccountId: args.auth.employeeAccountId,
          membershipId: args.auth.membershipId,
          businessId: args.auth.businessId,
          status: { in: ["OPEN", "ON_BREAK"] },
        },
        select: { id: true, branchId: true },
      });
    if (activeSession && activeSession.branchId !== input.branchId) {
      throw new AttendanceApiError(
        "INVALID_ATTENDANCE_STATE",
        "Complete the active shift before switching branch.",
      );
    }

    const assignment =
      await transaction.employeeBranchAssignment.findFirst({
        where: {
          membershipId: args.auth.membershipId,
          businessId: args.auth.businessId,
          branchId: input.branchId,
          status: "ACTIVE",
          canClockIn: true,
          effectiveFrom: { lte: now },
          OR: [
            { effectiveUntil: null },
            { effectiveUntil: { gte: now } },
          ],
          branch: {
            status: "ACTIVE",
            attendanceSetting: {
              is: {
                businessId: args.auth.businessId,
                isEnabled: true,
              },
            },
          },
        },
        select: {
          branch: { select: { id: true, name: true } },
        },
      });
    if (!assignment) {
      throw new AttendanceApiError("BRANCH_NOT_AUTHORIZED");
    }

    const updated = await transaction.employeeSession.updateMany({
      where: {
        id: args.auth.sessionId,
        employeeAccountId: args.auth.employeeAccountId,
        membershipId: args.auth.membershipId,
        businessId: args.auth.businessId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        attendanceBranchId: assignment.branch.id,
        lastActiveAt: now,
      },
    });
    if (updated.count !== 1) {
      throw new AttendanceApiError("SESSION_EXPIRED");
    }

    await writeAuditLog(
      {
        businessId: args.auth.businessId,
        branchId: assignment.branch.id,
        action: "EMPLOYEE_ATTENDANCE_BRANCH_SWITCHED",
        entityType: "EmployeeSession",
        entityId: args.auth.sessionId,
        summary: "Employee switched Attendance branch.",
        metadata: {
          membershipId: args.auth.membershipId,
          previousBranchId:
            args.auth.attendanceBranchId ?? args.auth.primaryBranchId,
          branchId: assignment.branch.id,
        },
      },
      transaction,
    );

    return {
      branch: assignment.branch,
    };
  });
}
