import Link from "next/link";
import type { EmployeeAttendanceStatus, Prisma } from "@prisma/client";
import {
  buildAttendanceSessionWhere,
  resolveAttendanceScope,
} from "@/lib/attendance/scope";
import { calculateAttendanceDurations } from "@/lib/attendance/state-machine";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import styles from "./attendance.module.css";

type AttendancePageProps = {
  searchParams: Promise<{
    branchId?: string;
    date?: string;
    datePreset?: string;
    status?: string;
    month?: string;
    employeeId?: string;
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
function getMonthRange(value?: string) {
  const fallback = getTodayValue().slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(value ?? "") ? value! : fallback;
  const [year, monthNumber] = month.split("-").map(Number);
  const from = new Date(Date.UTC(year, monthNumber - 1, 1));
  const to = new Date(Date.UTC(year, monthNumber, 1));
  if (
    !Number.isFinite(from.getTime()) ||
    from.toISOString().slice(0, 7) !== month
  ) {
    return getMonthRange(fallback);
  }
  return { month, from, to };
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
  const canModify = hasBusinessCapability(
    access,
    "MODIFY_ATTENDANCE_EMPLOYEES",
  );
  const canViewTeamDirectory = hasBusinessCapability(
    access,
    "VIEW_TEAM_DIRECTORY",
  );
  const canViewAttendanceSettings = hasBusinessCapability(
    access,
    "VIEW_ATTENDANCE_SETTINGS",
  );
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
  const monthRange = getMonthRange(params.month);
  const summaryNow = new Date();
  const supportingDataPromise = prisma.employeeBusinessMembership.findMany({
      where: {
        businessId,
        status: { in: ["ACTIVE", "SUSPENDED"] },
        branchAssignments: {
          some: {
            businessId,
            branchId: { in: [...scope.allowedBranchIds] },
            status: "ACTIVE",
            effectiveFrom: { lte: summaryNow },
            OR: [
              { effectiveUntil: null },
              { effectiveUntil: { gte: summaryNow } },
            ],
            ...(requestedBranchId ? { branchId: requestedBranchId } : {}),
          },
        },
      },
      orderBy: [{ fullName: "asc" }, { employeeCode: "asc" }],
      select: {
        id: true,
        employeeCode: true,
        fullName: true,
      },
    });
  const [totalRecords, monthlyMembers] = await Promise.all([
    prisma.employeeAttendance.count({ where }),
    supportingDataPromise,
  ]);
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const activeWhere: Prisma.EmployeeAttendanceWhereInput = {
    AND: [where, { status: { in: ["OPEN", "ON_BREAK"] } }],
  };
  const terminalWhere: Prisma.EmployeeAttendanceWhereInput = {
    AND: [where, { status: { notIn: ["OPEN", "ON_BREAK"] } }],
  };
  const selectedEmployeeId = monthlyMembers.some(
    (member) => member.id === params.employeeId,
  )
    ? params.employeeId!
    : "";
  const visibleMonthlyMembers = selectedEmployeeId
    ? monthlyMembers.filter((member) => member.id === selectedEmployeeId)
    : monthlyMembers;
  const monthlySessionsPromise = visibleMonthlyMembers.length
    ? prisma.employeeAttendance.findMany({
        where: buildAttendanceSessionWhere<Prisma.EmployeeAttendanceWhereInput>(
          scope,
          {
            membershipId: {
              in: visibleMonthlyMembers.map((member) => member.id),
            },
            workDate: {
              gte: monthRange.from,
              lt: monthRange.to,
            },
            ...(requestedBranchId ? { branchId: requestedBranchId } : {}),
          },
        ),
        select: {
          membershipId: true,
          workDate: true,
          status: true,
          totalBreakMinutes: true,
          totalWorkedMinutes: true,
          requiresApproval: true,
          approvalStatus: true,
        },
      })
    : Promise.resolve([]);
  const [
    [attendance, activeAttendance, completedCount, terminalMinutes],
    monthlySessions,
  ] = await Promise.all([
    Promise.all([
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
    ]),
    monthlySessionsPromise,
  ]);
  const monthlyAttendance = visibleMonthlyMembers.map((member) => {
    const sessions = monthlySessions.filter(
      (session) => session.membershipId === member.id,
    );
    const completedSessions = sessions.filter(
      (session) => session.status === "COMPLETED",
    );
    const workedDays = new Set(
      completedSessions.map((session) =>
        session.workDate.toISOString().slice(0, 10),
      ),
    ).size;
    return {
      ...member,
      workedDays,
      completedShifts: completedSessions.length,
      workedMinutes: completedSessions.reduce(
        (total, session) => total + session.totalWorkedMinutes,
        0,
      ),
      breakMinutes: completedSessions.reduce(
        (total, session) => total + session.totalBreakMinutes,
        0,
      ),
      incompleteCount: sessions.filter(
        (session) => session.status === "INCOMPLETE",
      ).length,
      pendingCount: sessions.filter(
        (session) =>
          session.requiresApproval &&
          session.approvalStatus === "PENDING",
      ).length,
    };
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
  function attendanceHref(targetPage = page) {
    const query = new URLSearchParams(exportParams);
    query.set("month", monthRange.month);
    if (selectedEmployeeId) query.set("employeeId", selectedEmployeeId);
    if (targetPage > 1) query.set("page", String(targetPage));
    const serialized = query.toString();
    return `/team/attendance${serialized ? `?${serialized}` : ""}`;
  }

  return (
    <section className={`content hr-module-page ${styles.page}`}>
      <header className={`page-header hr-module-header ${styles.pageHeader}`}>
        <div className={styles.headerCopy}>
          <span className={`hr-module-eyebrow ${styles.eyebrow}`}>HR &amp; PAYROLL</span>
          <h1>Staff Attendance</h1>
          <p>See who is working now and review clock-in records across your branches.</p>
        </div>
        <div className={`hr-module-actions ${styles.headerActions}`}>
          {canModify ? (
            <Link className="secondary-light-button" href="/team/attendance/resolutions">
              Resolution queue
            </Link>
          ) : null}
          <Link className="secondary-light-button" href={`/team/attendance/export?${exportParams}`}>
            Export CSV
          </Link>
          {canViewAttendanceSettings ? (
            <Link className="secondary-light-button" href="/team/attendance-settings">
              Attendance settings
            </Link>
          ) : null}
          {canViewTeamDirectory ? (
            <Link className="secondary-light-button" href="/team?section=people">
              People
            </Link>
          ) : null}
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
            <span className={styles.eyebrow}>MONTHLY SUMMARY</span>
            <h2>Days worked and net hours</h2>
            <p>
              One worked day is counted once even when the employee completes
              multiple shifts. Net hours already exclude unpaid breaks.
            </p>
          </div>
          <span className={styles.resultCount}>
            {monthlyAttendance.length} people
          </span>
        </div>

        <form action="/team/attendance" className={styles.filters} method="get">
          {requestedBranchId ? (
            <input name="branchId" type="hidden" value={requestedBranchId} />
          ) : null}
          <label>
            <span>Month</span>
            <input
              defaultValue={monthRange.month}
              name="month"
              required
              type="month"
            />
          </label>
          <label>
            <span>Employee</span>
            <select defaultValue={selectedEmployeeId} name="employeeId">
              <option value="">All employees</option>
              {monthlyMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName} ({member.employeeCode})
                </option>
              ))}
            </select>
          </label>
          <button className={styles.filterButton} type="submit">
            View month
          </button>
        </form>

        {monthlyAttendance.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.attendanceTable}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Days worked</th>
                  <th>Completed shifts</th>
                  <th>Net hours</th>
                  <th>Break</th>
                  <th>Needs attention</th>
                </tr>
              </thead>
              <tbody>
                {monthlyAttendance.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <div className={styles.employee}>
                        <span className={styles.avatar}>
                          {getInitials(member.fullName)}
                        </span>
                        <span>
                          {canViewTeamDirectory ? (
                            <Link
                              className={styles.employeeLink}
                              href={`/team/people/${member.id}`}
                            >
                              {member.fullName}
                            </Link>
                          ) : (
                            <strong>{member.fullName}</strong>
                          )}
                          <small>{member.employeeCode}</small>
                        </span>
                      </div>
                    </td>
                    <td><strong>{member.workedDays}</strong></td>
                    <td>{member.completedShifts}</td>
                    <td><strong>{formatDuration(member.workedMinutes)}</strong></td>
                    <td>{formatDuration(member.breakMinutes)}</td>
                    <td>
                      {member.pendingCount
                        ? `${member.pendingCount} pending`
                        : member.incompleteCount
                          ? `${member.incompleteCount} incomplete`
                          : "Clear"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <strong>No employees in this scope</strong>
            <span>Adjust the employee or branch filter.</span>
          </div>
        )}
      </section>
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
                            {canViewTeamDirectory ? (
                              <Link
                                className={styles.employeeLink}
                                href={`/team/people/${entry.membershipId}`}
                              >
                                {entry.employeeAccount.name}
                              </Link>
                            ) : (
                              <strong>{entry.employeeAccount.name}</strong>
                            )}
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
                        {canModify && !isOpen ? (
                          <Link className={styles.adjustLink} href={`/team/attendance/resolutions?employee=${encodeURIComponent(entry.employeeAccount.name)}`}>
                            Resolution queue
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
