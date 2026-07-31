import Link from "next/link";
import type { EmployeeAttendanceStatus, Prisma } from "@prisma/client";
import {
  adjustAttendanceSessionAction,
  reviewAttendanceExceptionAction,
} from "./actions";
import {
  buildAttendanceExceptionWhere,
  buildAttendanceSessionWhere,
  resolveAttendanceScope,
} from "@/lib/attendance/scope";
import { calculateAttendanceDurations } from "@/lib/attendance/state-machine";
import { formatBranchLocalDateTime } from "@/lib/attendance/work-date";
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
    adjust?: string;
    type?: string;
    message?: string;
    page?: string;
  }>;
};

function getTodayValue() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getWorkDate(dateValue: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return null;
  }
  const parsed = new Date(`${dateValue}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === dateValue ? parsed : null;
}

function formatDateTime(
  value: Date | null,
  timeZone: string,
) {
  if (!value) return "-";
  return value.toLocaleString("en-MY", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDuration(minutes: number) {
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
  const { access, user, businessId } = await requireBusinessUser(
    "VIEW_ATTENDANCE_EMPLOYEES",
  );
  const scope = await resolveAttendanceScope(access);
  const params = await searchParams;
  const canModify =
    access.effectiveBusinessRole !== "STAFF" ||
    access.permissions.includes("ATTENDANCE_EMPLOYEE_MANAGE");
  const branches = (await getOperationalBranches(businessId, user)).filter(
    (branch) => scope.allowedBranchIds.includes(branch.id),
  );
  const requestedBranchId = params.branchId && branches.some((branch) => branch.id === params.branchId)
    ? params.branchId
    : "";
  const dateFilter = params.datePreset === "all" || params.date === "all"
    ? "all"
    : params.date || getTodayValue();
  const supportedStatuses = new Set<EmployeeAttendanceStatus>([
    "OPEN",
    "ON_BREAK",
    "COMPLETED",
    "INCOMPLETE",
    "CANCELLED",
  ]);
  const statusFilter = supportedStatuses.has(
    params.status as EmployeeAttendanceStatus,
  )
    ? (params.status as EmployeeAttendanceStatus)
    : "ALL";
  const workDate = dateFilter === "all" ? null : getWorkDate(dateFilter);
  const where = buildAttendanceSessionWhere<Prisma.EmployeeAttendanceWhereInput>(scope, {
    ...(requestedBranchId ? { branchId: requestedBranchId } : {}),
    ...(statusFilter === "ALL" ? {} : { status: statusFilter }),
    ...(workDate ? { workDate } : {}),
  });
  const pageSize = 25;
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const totalRecords = await prisma.employeeAttendance.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const activeWhere: Prisma.EmployeeAttendanceWhereInput = {
    AND: [where, { status: { in: ["OPEN", "ON_BREAK"] } }],
  };
  const terminalWhere: Prisma.EmployeeAttendanceWhereInput = {
    AND: [where, { status: { notIn: ["OPEN", "ON_BREAK"] } }],
  };
  const [attendance, activeAttendance, completedCount, terminalMinutes] =
    await Promise.all([
      prisma.employeeAttendance.findMany({
        where,
        include: {
          employeeAccount: { select: { name: true, phoneNormalized: true } },
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
        orderBy: { clockInAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.employeeAttendance.findMany({
        where: activeWhere,
        select: {
          status: true,
          clockInAt: true,
          totalBreakMinutes: true,
          punches: {
            where: { type: { in: ["BREAK_START", "BREAK_END"] } },
            orderBy: [{ serverTimestamp: "asc" }, { createdAt: "asc" }],
            select: { type: true, serverTimestamp: true },
          },
        },
      }),
      prisma.employeeAttendance.count({
        where: { AND: [where, { status: "COMPLETED" }] },
      }),
      prisma.employeeAttendance.aggregate({
        where: terminalWhere,
        _sum: { totalWorkedMinutes: true },
      }),
    ]);
  const pendingExceptions = await prisma.attendanceException.findMany({
    where: buildAttendanceExceptionWhere<Prisma.AttendanceExceptionWhereInput>(scope, {
      status: "PENDING",
      ...(requestedBranchId ? { branchId: requestedBranchId } : {}),
    }),
    include: {
      employee: {
        select: {
          employeeCode: true,
          fullName: true,
        },
      },
      branch: {
        select: {
          name: true,
          attendanceSetting: { select: { timezone: true } },
        },
      },
      attendanceSession: {
        select: {
          id: true,
          workDate: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  const now = new Date();
  const rows = attendance.map((entry) => {
    let workedMinutes = entry.totalWorkedMinutes;
    if (entry.status === "OPEN" || entry.status === "ON_BREAK") {
      try {
        workedMinutes = calculateAttendanceDurations({
          clockInAt: entry.clockInAt,
          endAt: now,
          breakPunches: entry.punches.map((punch) => ({
            type: punch.type as "BREAK_START" | "BREAK_END",
            serverTimestamp: punch.serverTimestamp,
          })),
          includeOpenBreakUntilEnd: entry.status === "ON_BREAK",
        }).totalWorkedMinutes;
      } catch {
        workedMinutes = Math.max(
          0,
          Math.floor((now.getTime() - entry.clockInAt.getTime()) / 60_000) -
            entry.totalBreakMinutes,
        );
      }
    }
    return { ...entry, workedMinutes };
  });
  const adjustingSession = params.adjust
    ? rows.find((entry) => entry.id === params.adjust) ?? null
    : null;
  const openCount = activeAttendance.length;
  const activeWorkedMinutes = activeAttendance.reduce((total, entry) => {
    try {
      return total + calculateAttendanceDurations({
        clockInAt: entry.clockInAt,
        endAt: now,
        breakPunches: entry.punches.map((punch) => ({
          type: punch.type as "BREAK_START" | "BREAK_END",
          serverTimestamp: punch.serverTimestamp,
        })),
        includeOpenBreakUntilEnd: entry.status === "ON_BREAK",
      }).totalWorkedMinutes;
    } catch {
      return total + Math.max(
        0,
        Math.floor((now.getTime() - entry.clockInAt.getTime()) / 60_000) -
          entry.totalBreakMinutes,
      );
    }
  }, 0);
  const totalHours =
    ((terminalMinutes._sum.totalWorkedMinutes ?? 0) + activeWorkedMinutes) / 60;
  const exportParams = new URLSearchParams();
  if (dateFilter === "all") exportParams.set("datePreset", "all");
  else exportParams.set("date", dateFilter);
  if (requestedBranchId) exportParams.set("branchId", requestedBranchId);
  if (statusFilter !== "ALL") exportParams.set("status", statusFilter);
  function attendanceHref(targetPage = page, adjustId?: string) {
    const query = new URLSearchParams(exportParams);
    if (targetPage > 1) query.set("page", String(targetPage));
    if (adjustId) query.set("adjust", adjustId);
    const serialized = query.toString();
    return `/team/attendance${serialized ? `?${serialized}` : ""}`;
  }

  return (
    <section className={`content ${styles.page}`}>
      <header className={`page-header ${styles.pageHeader}`}>
        <div className={styles.headerCopy}>
          <span className={styles.eyebrow}>TEAM OPERATIONS</span>
          <h1>Staff Attendance</h1>
          <p>See who is working now and review clock-in records across your branches.</p>
        </div>
        <div className={styles.headerActions}>
          <Link className="secondary-light-button" href={`/team/attendance/export?${exportParams}`}>
            Export CSV
          </Link>
          <Link className="secondary-light-button" href="/team/attendance-settings">
            Attendance settings
          </Link>
          <Link className="secondary-light-button" href="/team">
            Back to team
          </Link>
        </div>
      </header>

      {params.message ? (
        <div className={`${styles.notice} ${params.type === "error" ? styles.noticeError : styles.noticeSuccess}`} role="status">
          {params.message}
        </div>
      ) : null}

      <div className={styles.summaryGrid}>
        <article className={styles.metricCard}>
          <div className={styles.metricHeading}>
            <span>Records</span>
            <span aria-hidden="true" className={styles.metricIndicator} />
          </div>
          <strong>{totalRecords}</strong>
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
          <small>Net worked time after breaks</small>
        </article>
      </div>

      <section className={styles.recordsPanel}>
        <div className={styles.panelHeading}>
          <div>
            <span className={styles.eyebrow}>REVIEW QUEUE</span>
            <h2>Pending Attendance exceptions</h2>
            <p>Review GPS and missing-punch requests within your authorized branches.</p>
          </div>
          <span className={styles.resultCount}>{pendingExceptions.length} pending</span>
        </div>
        {pendingExceptions.length ? (
          <div className={styles.reviewList}>
            {pendingExceptions.map((exception) => {
              const timeZone =
                exception.branch.attendanceSetting?.timezone ??
                "Asia/Kuala_Lumpur";
              return (
                <article className={styles.reviewCard} key={exception.id}>
                  <div className={styles.reviewSummary}>
                    <div>
                      <strong>{exception.employee.fullName}</strong>
                      <small>{exception.employee.employeeCode} / {exception.branch.name}</small>
                    </div>
                    <span className={styles.statusBadge}>{exception.type.replaceAll("_", " ")}</span>
                  </div>
                  <p>{exception.reason}</p>
                  <div className={styles.reviewFacts}>
                    {exception.requestedClockInAt ? (
                      <span>Requested in: <strong>{formatDateTime(exception.requestedClockInAt, timeZone)}</strong></span>
                    ) : null}
                    {exception.requestedClockOutAt ? (
                      <span>Requested out: <strong>{formatDateTime(exception.requestedClockOutAt, timeZone)}</strong></span>
                    ) : null}
                    <span>Submitted: <strong>{formatDateTime(exception.createdAt, timeZone)}</strong></span>
                  </div>
                  {canModify ? (
                    <form className={styles.reviewForm} action={reviewAttendanceExceptionAction}>
                      <input name="exceptionId" type="hidden" value={exception.id} />
                      <label>
                        <span>Review note</span>
                        <input maxLength={500} name="reviewNote" placeholder="Optional manager note" />
                      </label>
                      <div>
                        <button name="decision" type="submit" value="APPROVED">Approve</button>
                        <button className={styles.dangerButton} name="decision" type="submit" value="REJECTED">Reject</button>
                      </div>
                    </form>
                  ) : (
                    <small>Read-only access</small>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <strong>No pending Attendance exceptions</strong>
            <span>GPS and missing-punch requests will appear here.</span>
          </div>
        )}
      </section>

      {adjustingSession && canModify ? (
        <section className={styles.recordsPanel}>
          <div className={styles.panelHeading}>
            <div>
              <span className={styles.eyebrow}>AUDITED CORRECTION</span>
              <h2>Adjust {adjustingSession.employeeAccount.name}</h2>
              <p>Original punches remain immutable. This creates a separate adjustment record.</p>
            </div>
            <Link href={attendanceHref()}>Cancel</Link>
          </div>
          <form className={styles.adjustmentForm} action={adjustAttendanceSessionAction}>
            <input name="sessionId" type="hidden" value={adjustingSession.id} />
            <input name="expectedUpdatedAt" type="hidden" value={adjustingSession.updatedAt.toISOString()} />
            <label>
              <span>Clock in ({adjustingSession.branch.name})</span>
              <input
                defaultValue={formatBranchLocalDateTime(
                  adjustingSession.clockInAt,
                  adjustingSession.branch.attendanceSetting?.timezone ?? "Asia/Kuala_Lumpur",
                ).slice(0, 16)}
                name="adjustedClockInLocal"
                required
                type="datetime-local"
              />
            </label>
            <label>
              <span>Clock out</span>
              <input
                defaultValue={
                  adjustingSession.clockOutAt
                    ? formatBranchLocalDateTime(
                        adjustingSession.clockOutAt,
                        adjustingSession.branch.attendanceSetting?.timezone ?? "Asia/Kuala_Lumpur",
                      ).slice(0, 16)
                    : ""
                }
                name="adjustedClockOutLocal"
                required
                type="datetime-local"
              />
            </label>
            <label>
              <span>Break minutes</span>
              <input defaultValue={adjustingSession.totalBreakMinutes} min={0} name="adjustedBreakMinutes" required type="number" />
            </label>
            <label className={styles.adjustmentReason}>
              <span>Reason</span>
              <input maxLength={500} minLength={3} name="reason" required />
            </label>
            <button type="submit">Save audited adjustment</button>
          </form>
        </section>
      ) : null}

      <section className={styles.recordsPanel}>
        <div className={styles.panelHeading}>
          <div>
            <span className={styles.eyebrow}>ATTENDANCE LOG</span>
            <h2>Attendance records</h2>
            <p>Filter by date, branch, or status to find the shift you need.</p>
          </div>
          <span className={styles.resultCount}>
            {totalRecords} {totalRecords === 1 ? "record" : "records"}
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
              <option value="ON_BREAK">On break</option>
              <option value="COMPLETED">Clocked out</option>
              <option value="INCOMPLETE">Incomplete</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>
          <button className={styles.filterButton} type="submit">Apply filters</button>
        </form>

        {attendance.length ? (
          <>
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
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => {
                  const isOpen =
                    entry.status === "OPEN" ||
                    entry.status === "ON_BREAK";
                  const timeZone =
                    entry.branch.attendanceSetting?.timezone ??
                    "Asia/Kuala_Lumpur";
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
                          {entry.status === "OPEN"
                            ? "Clocked in"
                            : entry.status === "ON_BREAK"
                              ? "On break"
                              : entry.status === "COMPLETED"
                                ? "Clocked out"
                                : entry.status === "INCOMPLETE"
                                  ? "Incomplete"
                                  : "Cancelled"}
                        </span>
                      </td>
                      <td className={styles.dateTime} data-label="Clock in">
                        {formatDateTime(entry.clockInAt, timeZone)}
                      </td>
                      <td className={styles.dateTime} data-label="Clock out">
                        {entry.clockOutAt ? (
                          formatDateTime(entry.clockOutAt, timeZone)
                        ) : (
                          <span className={styles.workingNow}>
                            {isOpen ? "Still working" : "Not recorded"}
                          </span>
                        )}
                      </td>
                      <td data-label="Duration">
                        <strong className={styles.duration}>
                          {formatDuration(entry.workedMinutes)}
                        </strong>
                        <small>{entry._count.exceptions} exceptions / {entry._count.adjustments} adjustments</small>
                      </td>
                      <td data-label="Actions">
                        {canModify && entry.status !== "CANCELLED" ? (
                          <Link className={styles.adjustLink} href={attendanceHref(page, entry.id)}>
                            Adjust
                          </Link>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
                        </table>
          </div>
          <nav aria-label="Attendance pages" className={styles.pagination}>
            {page > 1 ? (
              <Link href={attendanceHref(page - 1)}>Previous</Link>
            ) : (
              <span aria-disabled="true">Previous</span>
            )}
            <strong>Page {page} of {totalPages}</strong>
            {page < totalPages ? (
              <Link href={attendanceHref(page + 1)}>Next</Link>
            ) : (
              <span aria-disabled="true">Next</span>
            )}
          </nav>
          </>
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
