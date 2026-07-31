import type { EmployeeAttendanceStatus } from "@prisma/client";
import {
  buildAttendanceSessionWhere,
  resolveAttendanceScope,
} from "@/lib/attendance/scope";
import { calculateAttendanceDurations } from "@/lib/attendance/state-machine";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

const statuses = new Set<EmployeeAttendanceStatus>([
  "OPEN",
  "ON_BREAK",
  "COMPLETED",
  "INCOMPLETE",
  "CANCELLED",
]);

export async function GET(request: Request) {
  const { access } = await requireBusinessUser(
    "VIEW_ATTENDANCE_EMPLOYEES",
  );
  const scope = await resolveAttendanceScope(access);
  const url = new URL(request.url);
  const requestedBranchId = url.searchParams.get("branchId")?.trim() ?? "";
  const branchId = scope.allowedBranchIds.includes(requestedBranchId)
    ? requestedBranchId
    : "";
  const requestedStatus = url.searchParams.get("status")?.trim() ?? "";
  const status = statuses.has(requestedStatus as EmployeeAttendanceStatus)
    ? (requestedStatus as EmployeeAttendanceStatus)
    : null;
  const datePreset = url.searchParams.get("datePreset");
  const dateValue = url.searchParams.get("date")?.trim() ?? "";
  const workDate =
    datePreset === "all" || !dateValue ? null : parseWorkDate(dateValue);

  const rows = await prisma.employeeAttendance.findMany({
    where: buildAttendanceSessionWhere(scope, {
      ...(branchId ? { branchId } : {}),
      ...(status ? { status } : {}),
      ...(workDate ? { workDate } : {}),
    }),
    include: {
      membership: {
        select: {
          employeeCode: true,
          fullName: true,
          phoneNumberNormalized: true,
        },
      },
      branch: {
        select: {
          name: true,
          attendanceSetting: { select: { timezone: true } },
        },
      },
      punches: {
        where: { type: { in: ["BREAK_START", "BREAK_END"] } },
        orderBy: [{ serverTimestamp: "asc" }, { createdAt: "asc" }],
        select: { type: true, serverTimestamp: true },
      },
      _count: { select: { exceptions: true, adjustments: true } },
    },
    orderBy: [{ workDate: "desc" }, { clockInAt: "desc" }],
    take: 10_000,
  });

  const now = new Date();
  const records = rows.map((row) => {
    const workedMinutes = getWorkedMinutes(row, now);
    const timeZone =
      row.branch.attendanceSetting?.timezone ?? "Asia/Kuala_Lumpur";
    return [
      row.id,
      row.membership.employeeCode,
      row.membership.fullName,
      row.membership.phoneNumberNormalized,
      row.branch.name,
      row.workDate.toISOString().slice(0, 10),
      row.status,
      formatDateTime(row.clockInAt, timeZone),
      formatDateTime(row.clockOutAt, timeZone),
      String(row.totalBreakMinutes),
      String(workedMinutes),
      row.requiresApproval ? row.approvalStatus : "NOT_REQUIRED",
      String(row._count.exceptions),
      String(row._count.adjustments),
    ];
  });
  const csv = [
    [
      "Attendance ID",
      "Employee Code",
      "Employee",
      "Phone",
      "Branch",
      "Work Date",
      "Status",
      "Clock In",
      "Clock Out",
      "Break Minutes",
      "Worked Minutes",
      "Approval",
      "Exceptions",
      "Adjustments",
    ],
    ...records,
  ]
    .map((record) => record.map(csvCell).join(","))
    .join("\r\n");

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendance-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function parseWorkDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === value ? parsed : null;
}

function formatDateTime(value: Date | null, timeZone: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-MY", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

function getWorkedMinutes(
  row: {
    status: EmployeeAttendanceStatus;
    clockInAt: Date;
    totalBreakMinutes: number;
    totalWorkedMinutes: number;
    punches: Array<{
      type: string;
      serverTimestamp: Date;
    }>;
  },
  now: Date,
) {
  if (row.status !== "OPEN" && row.status !== "ON_BREAK") {
    return row.totalWorkedMinutes;
  }
  try {
    return calculateAttendanceDurations({
      clockInAt: row.clockInAt,
      endAt: now,
      breakPunches: row.punches.map((punch) => ({
        type: punch.type as "BREAK_START" | "BREAK_END",
        serverTimestamp: punch.serverTimestamp,
      })),
      includeOpenBreakUntilEnd: row.status === "ON_BREAK",
    }).totalWorkedMinutes;
  } catch {
    return Math.max(
      0,
      Math.floor((now.getTime() - row.clockInAt.getTime()) / 60_000) -
        row.totalBreakMinutes,
    );
  }
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
