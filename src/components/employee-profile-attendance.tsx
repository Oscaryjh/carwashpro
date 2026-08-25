import Link from "next/link";
import type { loadEmployeeAttendanceSection } from "@/lib/team/employee-profile-attendance-read";
import styles from "./employee-profile-shell.module.css";

type AttendanceData = NonNullable<
  Awaited<ReturnType<typeof loadEmployeeAttendanceSection>>
>;

export function EmployeeProfileAttendance({ data }: { data: AttendanceData }) {
  return (
    <div className={styles.sectionContent}>
      <section className={styles.sectionIntro}>
        <div>
          <h2>Attendance</h2>
          <p>Clock status, worked time and attendance targets.</p>
        </div>
        <Link
          className={styles.leaveBalanceAction}
          href={`/team/attendance?datePreset=all&month=${data.monthKey}&employeeId=${data.id}`}
        >
          View attendance history
        </Link>
      </section>

      <div className={styles.profileGrid}>
        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Today</p>
              <h3>Clock and time</h3>
            </div>
            <StatusBadge status={data.currentClockStatus ?? "NOT_CLOCKED_IN"} />
          </div>
          <div className={styles.detailList}>
            <AttendanceDetail
              label="Today clock in"
              value={formatDateTime(data.todayClockInAt, data.businessTimezone)}
            />
            <AttendanceDetail
              label="Today clock out"
              value={formatDateTime(data.todayClockOutAt, data.businessTimezone)}
            />
            <AttendanceDetail
              label="Current branch"
              value={data.currentBranchName ?? "Not clocked in"}
            />
            <AttendanceDetail
              label="Worked time"
              value={formatMinutes(data.todayWorkedMinutes)}
            />
            <AttendanceDetail
              label="Break time"
              value={formatMinutes(data.todayBreakMinutes)}
            />
          </div>
        </section>

        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>This month</p>
              <h3>Attendance totals</h3>
            </div>
            <span>{formatMonth(data.monthKey)}</span>
          </div>
          <div className={styles.detailList}>
            <AttendanceDetail
              label="Worked days"
              value={String(data.monthlyWorkedDays)}
            />
            <AttendanceDetail
              label="Completed shifts"
              value={String(data.completedShiftCount)}
            />
            <AttendanceDetail
              label="Incomplete shifts"
              value={String(data.incompleteShiftCount)}
            />
            <AttendanceDetail
              label="Needs review"
              value={String(data.pendingApprovalCount + data.pendingExceptionCount)}
            />
          </div>
        </section>
      </div>

      <div className={styles.profileGrid}>
        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <h3>Expected work &amp; break</h3>
            </div>
          </div>
          <div className={styles.detailList}>
            <AttendanceDetail
              label="Daily work target"
              value={formatTarget(data.normalWorkMinutesPerDay, data.normalWorkPolicySource)}
            />
            <AttendanceDetail
              label="Expected break"
              value={formatTarget(data.targetBreakMinutes, data.targetBreakPolicySource)}
            />
          </div>
          <p className={styles.policyNote}>
            These are attendance targets only. The employee&apos;s actual schedule
            comes from the published Roster; pay classification is handled
            separately.
          </p>
        </section>

        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <h3>Clock-in branches</h3>
            </div>
            <span>{formatCount(data.clockInBranches.length, "branch")}</span>
          </div>
          {data.clockInBranches.length ? (
            <div className={`${styles.assignmentList} ${styles.compactAssignmentList}`}>
              {data.clockInBranches.map((branch) => (
                <article key={branch.id}>
                  <div>
                    <strong>{branch.name}</strong>
                    <small>
                      {branch.isPrimary ? "Primary branch" : "Additional branch"}
                    </small>
                  </div>
                  <StatusBadge status="CLOCK_IN_ALLOWED" />
                </article>
              ))}
            </div>
          ) : (
            <AttendanceEmpty
              title="No authorized clock-in branch"
              description="No current clock-in assignment is available inside your authorized branch scope."
            />
          )}
        </section>
      </div>

      <section className={styles.profilePanel}>
        <div className={styles.panelHeading}>
          <div>
            <h3>Recent attendance</h3>
          </div>
          <span>{formatCount(data.recentAttendance.length, "record")}</span>
        </div>
        {data.recentAttendance.length ? (
          <div className={styles.assignmentList}>
            {data.recentAttendance.map((record) => {
              const timeZone =
                record.branch.attendanceSetting?.timezone ??
                data.businessTimezone;
              const inProgress =
                record.status === "OPEN" || record.status === "ON_BREAK";
              return (
                <article key={record.id}>
                  <div>
                    <strong>{formatWorkDate(record.workDate)}</strong>
                    <small>{record.branch.name}</small>
                  </div>
                  <div>
                    <span>
                      {formatTime(record.clockInAt, timeZone)} – {formatTime(record.clockOutAt, timeZone)}
                    </span>
                    <small>
                      {inProgress
                        ? "Shift in progress"
                        : `${formatMinutes(record.totalWorkedMinutes)} worked · ${formatMinutes(record.totalBreakMinutes)} break`}
                    </small>
                  </div>
                  <div>
                    <StatusBadge status={record.status} />
                    {record.requiresApproval &&
                    record.approvalStatus === "PENDING" ? (
                      <small>Pending approval</small>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <AttendanceEmpty
            title="No attendance records"
            description="No attendance record is available for this employee inside your authorized branch scope."
          />
        )}
      </section>
    </div>
  );
}

function AttendanceDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <strong className={styles.statusBadge} data-status={status.toLowerCase()}>
      {formatStatus(status)}
    </strong>
  );
}

function AttendanceEmpty({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className={styles.profileEmpty}>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function formatStatus(value: string) {
  if (value === "NOT_CLOCKED_IN") return "Not clocked in";
  if (value === "CLOCK_IN_ALLOWED") return "Clock in allowed";
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatMinutes(minutes: number) {
  const safeMinutes = Math.max(0, minutes);
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;
  if (!hours) return `${remainingMinutes}m`;
  return `${hours}h ${remainingMinutes.toString().padStart(2, "0")}m`;
}

function formatOptionalMinutes(minutes: number | null) {
  return minutes === null ? "Not configured" : formatMinutes(minutes);
}

function formatTarget(minutes: number | null, source: string) {
  return `${formatOptionalMinutes(minutes)} · ${source}`;
}

function formatCount(value: number, noun: string) {
  const suffix = value === 1 ? "" : noun.endsWith("ch") ? "es" : "s";
  return `${value} ${noun}${suffix}`;
}

function formatMonth(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}-01T00:00:00.000Z`));
}

function formatWorkDate(value: Date) {
  return value.toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
}

function formatDateTime(value: Date | null, timeZone: string) {
  if (!value) return "Not recorded";
  try {
    return value.toLocaleString("en-MY", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    });
  } catch {
    return value.toLocaleString("en-MY", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kuching",
    });
  }
}

function formatTime(value: Date | null, timeZone: string) {
  if (!value) return "Not recorded";
  try {
    return value.toLocaleTimeString("en-MY", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    });
  } catch {
    return value.toLocaleTimeString("en-MY", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kuching",
    });
  }
}
