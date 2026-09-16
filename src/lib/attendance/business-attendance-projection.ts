import type { EmployeeAttendanceStatus, Prisma, PrismaClient } from "@prisma/client";
import { effectiveAttendanceSession } from "./effective-session";

export const approvedAttendanceResolutionSelect = {
  select: {
    status: true,
    currentFinalResult: {
      select: {
        attendanceSessionId: true,
        source: true,
        disposition: true,
        clockInAt: true,
        clockOutAt: true,
        totalBreakMinutes: true,
        totalWorkedMinutes: true,
      },
    },
  },
} satisfies Prisma.AttendanceResolutionCaseDefaultArgs;

/** Read-only overlays; the caller's business/branch/date scope is always retained. */
export async function loadApprovedAttendanceCorrections(
  scopedWhere: Prisma.EmployeeAttendanceWhereInput,
  database: Pick<PrismaClient, "employeeAttendance">,
) {
  const rows = await database.employeeAttendance.findMany({
    where: {
      AND: [scopedWhere, { resolutionCase: { is: {
        status: "RESOLVED",
        currentFinalResult: { is: { source: "CORRECTION", disposition: "INCLUDED" } },
      } } }],
    },
    select: {
      id: true, status: true, clockInAt: true, clockOutAt: true,
      totalBreakMinutes: true, totalWorkedMinutes: true,
      resolutionCase: approvedAttendanceResolutionSelect,
    },
  });
  return rows.flatMap((raw) => {
    const effective = effectiveAttendanceSession(raw);
    return effective === raw ? [] : [{ id: raw.id, minuteDelta: effective.totalWorkedMinutes - raw.totalWorkedMinutes }];
  });
}

/** Apply effective status before pagination/counts, not after fetching a page. */
export function effectiveAttendanceStatusWhere(
  status: EmployeeAttendanceStatus | "ALL",
  correctionIds: string[],
): Prisma.EmployeeAttendanceWhereInput {
  if (status === "ALL") return {};
  if (!correctionIds.length) return { status };
  return status === "COMPLETED"
    ? { OR: [{ status: "COMPLETED" }, { id: { in: correctionIds } }] }
    : { AND: [{ status }, { id: { notIn: correctionIds } }] };
}
