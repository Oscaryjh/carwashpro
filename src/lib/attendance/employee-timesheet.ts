import type { PrismaClient } from "@prisma/client";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { prisma } from "@/lib/prisma";

export async function getEmployeeTimesheetOverview(
  auth: EmployeeAuthContext,
  options: { database?: PrismaClient; now?: Date } = {},
) {
  const database = options.database ?? prisma;
  const now = options.now ?? new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [rows, exceptions] = await Promise.all([
    database.attendanceP2FinalResult.findMany({
      where: {
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        workDate: { gte: monthStart },
      },
      orderBy: [{ workDate: "desc" }, { version: "desc" }],
    }),
    database.attendanceP2Exception.findMany({
      where: {
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        status: { in: ["OPEN", "PENDING_EMPLOYEE", "PENDING_MANAGER"] },
      },
      orderBy: [{ workDate: "desc" }, { detectedAt: "desc" }],
    }),
  ]);
  const latest = [
    ...new Map(
      rows.map((row) => [row.workDate.toISOString().slice(0, 10), row]),
    ).values(),
  ];
  return { monthStart, latest, exceptions };
}
