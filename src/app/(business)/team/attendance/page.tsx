import Link from "next/link";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";

type AttendancePageProps = {
  searchParams: Promise<{
    branchId?: string;
    date?: string;
    datePreset?: string;
    status?: string;
  }>;
};

const TIME_ZONE = "Asia/Kuala_Lumpur";

function getTodayValue() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getDateBounds(dateValue: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return null;
  }

  return {
    gte: new Date(`${dateValue}T00:00:00+08:00`),
    lt: new Date(new Date(`${dateValue}T00:00:00+08:00`).getTime() + 86_400_000),
  };
}

function formatDateTime(value: Date | null) {
  if (!value) return "-";
  return value.toLocaleString("en-MY", {
    timeZone: TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDuration(clockInAt: Date, clockOutAt: Date | null) {
  const end = clockOutAt ?? new Date();
  const minutes = Math.max(0, Math.floor((end.getTime() - clockInAt.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
}

export default async function StaffAttendancePage({ searchParams }: AttendancePageProps) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "TEAM");

  const params = await searchParams;
  const branches = await getOperationalBranches(businessId, user);
  const requestedBranchId = params.branchId && branches.some((branch) => branch.id === params.branchId)
    ? params.branchId
    : "";
  const dateFilter = params.datePreset === "all" || params.date === "all"
    ? "all"
    : params.date || getTodayValue();
  const statusFilter = params.status === "COMPLETED" ? "COMPLETED" : params.status === "OPEN" ? "OPEN" : "ALL";
  const dateBounds = dateFilter === "all" ? null : getDateBounds(dateFilter);
  const where = {
    businessId,
    ...(requestedBranchId ? { branchId: requestedBranchId } : { branchId: { in: branches.map((branch) => branch.id) } }),
    ...(statusFilter === "ALL" ? {} : { status: statusFilter as "OPEN" | "COMPLETED" }),
    ...(dateBounds ? { clockInAt: dateBounds } : {}),
  };
  const attendance = await prisma.employeeAttendance.findMany({
    where,
    include: {
      employeeAccount: { select: { name: true, phoneNormalized: true } },
      branch: { select: { name: true } },
    },
    orderBy: { clockInAt: "desc" },
    take: 200,
  });
  const openCount = attendance.filter((entry) => entry.status === "OPEN").length;
  const completedCount = attendance.filter((entry) => entry.status === "COMPLETED").length;
  const totalHours = attendance.reduce((total, entry) => {
    const end = entry.clockOutAt ?? new Date();
    return total + Math.max(0, end.getTime() - entry.clockInAt.getTime());
  }, 0) / 3_600_000;

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Staff Attendance</h1>
            <p>Review employee clock in and clock out records by branch.</p>
          </div>
          <Link className="secondary-light-button" href="/team">Back to team</Link>
        </div>

        <div className="staff-attendance-summary">
          <div className="stat-card"><span>Records</span><strong>{attendance.length}</strong></div>
          <div className="stat-card"><span>Currently clocked in</span><strong>{openCount}</strong></div>
          <div className="stat-card"><span>Completed records</span><strong>{completedCount}</strong></div>
          <div className="stat-card"><span>Total hours</span><strong>{totalHours.toFixed(1)}h</strong></div>
        </div>

        <div className="panel">
          <form className="staff-attendance-filters" action="/team/attendance">
            <label>
              <span>Date</span>
              <select name="datePreset" defaultValue={dateFilter === "all" ? "all" : params.date ? "custom" : "today"}>
                <option value="today">Today</option>
                <option value="custom">Specific date</option>
                <option value="all">All dates</option>
              </select>
            </label>
            <label>
              <span>Specific date</span>
              <input name="date" type="date" defaultValue={dateFilter === "all" || !params.date ? "" : dateFilter} />
            </label>
            <label>
              <span>Branch</span>
              <select name="branchId" defaultValue={requestedBranchId}>
                <option value="">All assigned branches</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select name="status" defaultValue={statusFilter}>
                <option value="ALL">All statuses</option>
                <option value="OPEN">Open</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </label>
            <button type="submit">Filter</button>
          </form>

          {attendance.length ? (
            <div className="table-scroll">
              <table className="table staff-attendance-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Phone</th>
                    <th>Branch</th>
                    <th>Status</th>
                    <th>Clock in</th>
                    <th>Clock out</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.map((entry) => (
                    <tr key={entry.id}>
                      <td><strong>{entry.employeeAccount.name}</strong></td>
                      <td>{entry.employeeAccount.phoneNormalized}</td>
                      <td>{entry.branch.name}</td>
                      <td><span className={`status ${entry.status === "OPEN" ? "attendance-open" : "attendance-closed"}`}>{entry.status === "OPEN" ? "Clocked in" : "Clocked out"}</span></td>
                      <td>{formatDateTime(entry.clockInAt)}</td>
                      <td>{formatDateTime(entry.clockOutAt)}</td>
                      <td>{formatDuration(entry.clockInAt, entry.clockOutAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-state">No attendance records match this filter.</p>
          )}
        </div>
      </section>
    </>
  );
}
