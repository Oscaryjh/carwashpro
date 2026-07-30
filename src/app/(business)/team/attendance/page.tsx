import Link from "next/link";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import styles from "./attendance.module.css";

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

function getInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TM";
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
    <section className={`content ${styles.page}`}>
      <header className={`page-header ${styles.pageHeader}`}>
        <div className={styles.headerCopy}>
          <span className={styles.eyebrow}>TEAM OPERATIONS</span>
          <h1>Staff Attendance</h1>
          <p>See who is working now and review clock-in records across your branches.</p>
        </div>
        <div className={styles.headerActions}>
          <Link className="secondary-light-button" href="/team/attendance-settings">
            Attendance settings
          </Link>
          <Link className="secondary-light-button" href="/team">
            Back to team
          </Link>
        </div>
      </header>

      <div className={styles.summaryGrid}>
        <article className={styles.metricCard}>
          <div className={styles.metricHeading}>
            <span>Records</span>
            <span aria-hidden="true" className={styles.metricIndicator} />
          </div>
          <strong>{attendance.length}</strong>
          <small>Matching the current filters</small>
        </article>
        <article className={`${styles.metricCard} ${styles.metricCardActive}`}>
          <div className={styles.metricHeading}>
            <span>Clocked in now</span>
            <span aria-hidden="true" className={styles.metricIndicator} />
          </div>
          <strong>{openCount}</strong>
          <small>Active attendance sessions</small>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricHeading}>
            <span>Completed</span>
            <span aria-hidden="true" className={styles.metricIndicator} />
          </div>
          <strong>{completedCount}</strong>
          <small>Clocked-out records</small>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricHeading}>
            <span>Total hours</span>
            <span aria-hidden="true" className={styles.metricIndicator} />
          </div>
          <strong>{totalHours.toFixed(1)}h</strong>
          <small>Across the matching records</small>
        </article>
      </div>

      <section className={styles.recordsPanel}>
        <div className={styles.panelHeading}>
          <div>
            <span className={styles.eyebrow}>ATTENDANCE LOG</span>
            <h2>Attendance records</h2>
            <p>Filter by date, branch, or status to find the shift you need.</p>
          </div>
          <span className={styles.resultCount}>
            {attendance.length} {attendance.length === 1 ? "record" : "records"}
          </span>
        </div>

        <form className={styles.filters} action="/team/attendance">
          <label>
            <span>Date range</span>
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
              <option value="OPEN">Clocked in</option>
              <option value="COMPLETED">Clocked out</option>
            </select>
          </label>
          <button className={styles.filterButton} type="submit">Apply filters</button>
        </form>

        {attendance.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.attendanceTable}>
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Branch</th>
                  <th scope="col">Status</th>
                  <th scope="col">Clock in</th>
                  <th scope="col">Clock out</th>
                  <th scope="col">Duration</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((entry) => {
                  const isOpen = entry.status === "OPEN";
                  return (
                    <tr key={entry.id}>
                      <td className={styles.employeeCell} data-label="Employee">
                        <div className={styles.employee}>
                          <span aria-hidden="true" className={styles.employeeAvatar}>
                            {getInitials(entry.employeeAccount.name)}
                          </span>
                          <span>
                            <strong>{entry.employeeAccount.name}</strong>
                            <small>Team member</small>
                          </span>
                        </div>
                      </td>
                      <td className={styles.phone} data-label="Phone">
                        {entry.employeeAccount.phoneNormalized}
                      </td>
                      <td data-label="Branch">{entry.branch.name}</td>
                      <td data-label="Status">
                        <span className={`${styles.statusBadge} ${isOpen ? styles.open : styles.closed}`}>
                          {isOpen ? "Clocked in" : "Clocked out"}
                        </span>
                      </td>
                      <td className={styles.dateTime} data-label="Clock in">
                        {formatDateTime(entry.clockInAt)}
                      </td>
                      <td className={styles.dateTime} data-label="Clock out">
                        {entry.clockOutAt ? (
                          formatDateTime(entry.clockOutAt)
                        ) : (
                          <span className={styles.workingNow}>Still working</span>
                        )}
                      </td>
                      <td data-label="Duration">
                        <strong className={styles.duration}>
                          {formatDuration(entry.clockInAt, entry.clockOutAt)}
                        </strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <strong>No attendance records found</strong>
            <span>Try another date, branch, or attendance status.</span>
          </div>
        )}
      </section>
    </section>
  );
}
