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
          <p className={styles.eyebrow}>Attendance</p>
          <h2>Attendance</h2>
          <p>
            Read-only clock status, monthly attendance and policy targets from
            authorized branches. No sensitive or location evidence is included.
          </p>
        </div>
        <span className={styles.scopeBadge}>Read only</span>
      </section>

      <section aria-label="Attendance summary" className={styles.metricGrid}>
        <AttendanceMetric
          label="Attendance access"
          note="Employee attendance setting"
          value={data.attendanceEnabled ? "Enabled" : "Disabled"}
        />
        <AttendanceMetric
          label="Current clock status"
          note={data.currentBranchName ?? "No active branch"}
          value={formatCurrentStatus(data.currentClockStatus)}
        />
        <AttendanceMetric
          label="Worked days this month"
          note={formatMonth(data.monthKey)}
          value={String(data.monthlyWorkedDays)}
        />
        <AttendanceMetric
          label="Pending review"
          note={`${data.pendingApprovalCount} approval(s) / ${data.pendingExceptionCount} exception(s)`}
          value={String(data.pendingApprovalCount + data.pendingExceptionCount)}
        />
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
              label="Pending approvals"
              value={String(data.pendingApprovalCount)}
            />
            <AttendanceDetail
              label="Pending exceptions"
              value={String(data.pendingExceptionCount)}
            />
          </div>
          <Link
            className={styles.inlineLink}
            href={`/team/attendance?datePreset=all&month=${data.monthKey}&employeeId=${data.id}`}
          >
            Open Attendance Management
          </Link>
        </section>
      </div>

      <div className={styles.profileGrid}>
        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Attendance policy</p>
              <h3>Work and break targets</h3>
            </div>
          </div>
          <div className={styles.detailList}>
            <AttendanceDetail
              label="Attendance work target"
              value={formatOptionalMinutes(data.normalWorkMinutesPerDay)}
            />
            <AttendanceDetail
              label="Work target policy source"
              value={data.normalWorkPolicySource}
            />
            <AttendanceDetail
              label="Expected break"
              value={formatOptionalMinutes(data.targetBreakMinutes)}
            />
            <AttendanceDetail
              label="Break policy source"
              value={data.targetBreakPolicySource}
            />
          </div>
          <p className={styles.policyNote}>
            Targets are shown for attendance context only. Worked time above a
            target is not classified here.
          </p>
        </section>

        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Branch access</p>
              <h3>Clock-in branches</h3>
            </div>
            <span>{data.clockInBranches.length} branch(es)</span>
          </div>
          {data.clockInBranches.length ? (
            <div className={styles.assignmentList}>
              {data.clockInBranches.map((branch) => (
                <article key={branch.id}>
                  <div>
                    <strong>{branch.name}</strong>
                    <small>
                      {branch.isPrimary ? "Primary branch" : "Additional branch"}
                    </small>
                  </div>
                  <div>
                    <span>Attendance permission</span>
                    <small>Current assignment</small>
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
            <p className={styles.eyebrow}>Recent attendance</p>
            <h3>Recent records</h3>
            <p>Up to 10 records from authorized branches.</p>
          </div>
          <span>{data.recentAttendance.length} record(s)</span>
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

function AttendanceMetric({
  label,
  note,
  value,
}: {
  label: string;
  note: string;
  value: string;
}) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
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

function formatCurrentStatus(status: string | null) {
  if (status === "OPEN") return "Clocked in";
  if (status === "ON_BREAK") return "On break";
  return "Not clocked in";
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
