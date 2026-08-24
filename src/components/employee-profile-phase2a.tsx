import type {
  getEmployeeProfileEmployment,
  getEmployeeProfileOverview,
  getEmployeeProfilePersonal,
} from "@/lib/team/employee-profile-read";
import type { loadEmployeeAttendanceSection } from "@/lib/team/employee-profile-attendance-read";
import type { loadEmployeeLeaveSection } from "@/lib/team/employee-profile-leave-read";
import type {
  EmployeePayrollSummaryResult,
} from "@/lib/team/employee-profile-payroll-summary-read";
import styles from "./employee-profile-shell.module.css";

type OverviewData = NonNullable<
  Awaited<ReturnType<typeof getEmployeeProfileOverview>>
>;
type EmploymentData = NonNullable<
  Awaited<ReturnType<typeof getEmployeeProfileEmployment>>
>;
type PersonalData = NonNullable<
  Awaited<ReturnType<typeof getEmployeeProfilePersonal>>
>;
type AttendanceData = NonNullable<
  Awaited<ReturnType<typeof loadEmployeeAttendanceSection>>
>;
type LeaveData = NonNullable<
  Awaited<ReturnType<typeof loadEmployeeLeaveSection>>
>;

export function EmployeeProfileOverview({
  employment,
  attendance,
  leave,
  overview,
  payroll,
  personal,
}: {
  employment: EmploymentData | null;
  attendance: AttendanceData | null;
  leave: LeaveData | null;
  overview: OverviewData;
  payroll: EmployeePayrollSummaryResult | null;
  personal: PersonalData;
}) {
  const attendanceAttention = attendance
    ? attendance.pendingApprovalCount +
      attendance.pendingExceptionCount +
      attendance.incompleteShiftCount
    : null;
  const payrollAttention = payroll?.status === "READY"
    ? payroll.data.readiness === "READY"
      ? "Ready"
      : payroll.data.issues[0]?.message ?? "Needs attention"
    : null;

  return (
    <div className={styles.sectionContent}>
      <div className={styles.profileGrid}>
        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <h3>Contact details</h3>
            </div>
          </div>
          <div className={styles.detailList}>
            <ProfileDetail
              label="Phone number"
              value={personal.phoneNumber || "Not recorded"}
            />
            <ProfileDetail
              label="Date of birth"
              value={
                personal.dateOfBirth
                  ? formatDateOfBirth(personal.dateOfBirth)
                  : "Not recorded"
              }
            />
            <ProfileDetail
              label="Login email"
              value={personal.staffUser?.email || "Not linked"}
            />
          </div>
        </section>

        {employment ? (
          <section className={styles.profilePanel}>
            <div className={styles.panelHeading}>
              <div>
                <h3>Employment details</h3>
              </div>
            </div>
            <div className={styles.detailList}>
              <ProfileDetail
                label="Employment type"
                value={formatEnum(employment.employmentType)}
              />
              <ProfileDetail label="Position" value={employment.position || "Not recorded"} />
              <ProfileDetail
                label="Staff level"
                value={employment.staffUser?.staffLevel?.name ?? "No level"}
              />
              <ProfileDetail
                label="Joined date"
                value={formatDate(
                  employment.joinedAt,
                  employment.business.timezone,
                )}
              />
              <ProfileDetail
                label="Termination date"
                value={
                  employment.terminatedAt
                    ? formatDate(
                        employment.terminatedAt,
                        employment.business.timezone,
                      )
                    : "Not applicable"
                }
              />
            </div>
          </section>
        ) : null}

        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <h3>Needs attention</h3>
            </div>
          </div>
          <div className={styles.detailList}>
            <ProfileDetail
              label="Attendance review"
              value={
                attendanceAttention === null
                  ? "Not available"
                  : attendanceAttention
                    ? `${attendanceAttention} item(s)`
                    : "No issues"
              }
            />
            {leave ? (
              <ProfileDetail
                label="Leave"
                value={
                  leave.pendingRequestCount
                    ? `${leave.pendingRequestCount} request(s) pending`
                    : "No issues"
                }
              />
            ) : null}
            {payrollAttention ? (
              <ProfileDetail label="Payroll" value={payrollAttention} />
            ) : null}
            <ProfileDetail
              label="Staff App"
              value={isStaffAppReady(overview.staffUser) ? "Ready" : "Needs setup"}
            />
            <ProfileDetail
              label="Workplace"
              value={overview.branchAssignments.length ? "Assigned" : "Needs setup"}
            />
          </div>
        </section>

        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}><div><h3>Today</h3></div></div>
          <div className={styles.detailList}>
            <ProfileDetail label="Clock status" value={attendance ? formatEnum(attendance.currentClockStatus ?? "NOT_CLOCKED_IN") : "Not available"} />
            <ProfileDetail label="Workplace" value={attendance?.currentBranchName ?? "Not clocked in"} />
            <ProfileDetail label="Worked time" value={attendance ? formatMinutes(attendance.todayWorkedMinutes) : "Not available"} />
          </div>
        </section>
      </div>
    </div>
  );
}

function isStaffAppReady(
  staff: OverviewData["staffUser"],
) {
  return Boolean(
    staff?.teamMemberLinkStatus === "LINKED" &&
      staff.employeeAccountId &&
      staff.employeeBusinessMembershipId,
  );
}

function formatMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return hours ? `${hours}h ${minutes ? `${minutes}m` : ""}`.trim() : `${minutes}m`;
}

function formatDateOfBirth(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(value);
}

function ProfileDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(value: Date, timezone: string) {
  try {
    return value.toLocaleDateString("en-MY", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: timezone,
    });
  } catch {
    return value.toLocaleDateString("en-MY", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kuching",
    });
  }
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
