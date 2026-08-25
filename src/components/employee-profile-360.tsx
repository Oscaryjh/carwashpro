import Link from "next/link";
import type { ReactNode } from "react";
import type { loadEmployeeAttendanceSection } from "@/lib/team/employee-profile-attendance-read";
import type { loadEmployeeLeaveSection } from "@/lib/team/employee-profile-leave-read";
import type {
  getEmployeeProfileEmployment,
  getEmployeeProfileOverview,
  getEmployeeProfilePersonal,
} from "@/lib/team/employee-profile-read";
import styles from "./employee-profile-shell.module.css";

type AttendanceData = NonNullable<
  Awaited<ReturnType<typeof loadEmployeeAttendanceSection>>
>;
type LeaveData = NonNullable<Awaited<ReturnType<typeof loadEmployeeLeaveSection>>>;
type OverviewData = NonNullable<Awaited<ReturnType<typeof getEmployeeProfileOverview>>>;
type PersonalData = NonNullable<Awaited<ReturnType<typeof getEmployeeProfilePersonal>>>;
type EmploymentData = NonNullable<
  Awaited<ReturnType<typeof getEmployeeProfileEmployment>>
>;

export function EmployeeProfileAreaTabs({
  activeView,
  items,
  personId,
  section,
}: {
  activeView: string;
  items: readonly { key: string; label: string }[];
  personId: string;
  section: "time" | "compensation";
}) {
  return (
    <nav aria-label={`${section} sections`} className={styles.areaTabs}>
      {items.map((item) => (
        <Link
          aria-current={activeView === item.key ? "page" : undefined}
          href={`/team/people/${personId}?section=${section}&view=${item.key}`}
          key={item.key}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function EmployeeProfileWork({
  employment,
  overview,
}: {
  employment: EmploymentData | null;
  overview: OverviewData;
}) {
  const staff = employment?.staffUser ?? overview.staffUser;
  const services = employment?.staffUser?.serviceStaffAssignments ?? [];
  return (
    <div className={styles.sectionContent}>
      <SectionIntro
        title="Work"
        description="Workplaces, services and clock-in access for this employee."
      />
      <div className={styles.profileGrid}>
        <Panel title="Work setup">
          <Detail label="Position" value={employment?.position || "Not recorded"} />
          <Detail
            label="Appointment booking"
            value={staff?.appointmentBookable ? "Allowed" : "Not allowed"}
          />
          <Detail
            label="Assigned services"
            value={`${services.length || overview.staffUser?._count.serviceStaffAssignments || 0}`}
          />
          {services.length ? (
            <details className={styles.compactDisclosure}>
              <summary>View assigned services</summary>
              <div className={styles.compactPills}>
                {services.map(({ service }) => (
                  <span key={service.id}>{service.name}</span>
                ))}
              </div>
            </details>
          ) : null}
        </Panel>
        <Panel title="Workplaces">
          {employment?.branchAssignments.length ? (
            <div className={styles.compactList}>
              {employment.branchAssignments.map((assignment) => (
                <div key={assignment.id}>
                  <span>
                    <strong>{assignment.branch.name}</strong>
                    <small>{assignment.isPrimary ? "Primary workplace" : "Additional workplace"}</small>
                  </span>
                  <span className={styles.compactState}>
                    {assignment.canClockIn ? "Clock-in allowed" : "No clock-in"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="No active workplace assignment." />
          )}
        </Panel>
      </div>
    </div>
  );
}

export function EmployeeProfileTimeSummary({
  attendance,
  canAdjustBalance,
  leave,
  personId,
}: {
  attendance: AttendanceData;
  canAdjustBalance: boolean;
  leave: LeaveData;
  personId: string;
}) {
  const attention =
    attendance.pendingApprovalCount +
    attendance.pendingExceptionCount +
    attendance.incompleteShiftCount;
  return (
    <div className={styles.sectionContent}>
      <SectionIntro
        title="Time & Leave"
        description="A current summary from Attendance, Roster and Leave records."
      />
      <div className={styles.profileGrid}>
        <Panel
          action={{
            href: `/team/people/${personId}?section=time&view=attendance`,
            label: "View attendance",
          }}
          title="Attendance"
        >
          <div className={styles.compactMetrics}>
            <Metric label="Worked days" value={String(attendance.monthlyWorkedDays)} />
            <Metric label="Needs review" value={String(attention)} />
            <Metric
              label="Today"
              value={formatStatus(attendance.currentClockStatus ?? "NOT_CLOCKED_IN")}
            />
          </div>
          <p className={styles.compactNote}>
            Schedule details remain owned by the published Roster.
          </p>
        </Panel>
        <Panel
          action={{
            href: `/team/people/${personId}?section=time&view=leave`,
            label: "View leave",
          }}
          title="Leave"
        >
          <div className={styles.compactLeaveRows}>
            {leave.policies.slice(0, 4).map((policy) => (
              <div key={policy.id}>
                <span>{policy.name}</span>
                <strong>
                  {policy.remainingDays === null
                    ? "Not tracked"
                    : `${Number(policy.remainingDays.toFixed(2))} days`}
                </strong>
              </div>
            ))}
          </div>
          {canAdjustBalance ? (
            <Link
              className={styles.inlineAction}
              href={`/team/people/${personId}?section=time&view=leave&manageLeave=1`}
            >
              Adjust balance
            </Link>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}

export type EmployeeCompensationOverviewItem = {
  description: string;
  key: "claims" | "commission" | "payroll" | "statutory";
  primary: string;
  secondary: string;
  title: string;
  tone: "attention" | "neutral" | "ready";
};

export function EmployeeProfileCompensationHome({
  items,
  personId,
}: {
  items: EmployeeCompensationOverviewItem[];
  personId: string;
}) {
  return (
    <div className={styles.sectionContent}>
      <SectionIntro
        title="Compensation"
        description="Employee pay setup and records, grouped without duplicating payroll logic."
      />
      <div className={styles.areaCardGrid}>
        {items.map((item) => (
          <Link
            data-tone={item.tone}
            href={`/team/people/${personId}?section=compensation&view=${item.key}`}
            key={item.key}
          >
            <span className={styles.areaCardHeading}>
              <strong>{item.title}</strong>
              <small>{item.primary}</small>
            </span>
            <span>{item.description}</span>
            <em>{item.secondary}</em>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function EmployeeProfileAccess({
  employment,
  overview,
  personal,
}: {
  employment: EmploymentData | null;
  overview: OverviewData;
  personal: PersonalData;
}) {
  const staff = employment?.staffUser ?? overview.staffUser;
  const clockInBranches =
    employment?.branchAssignments.filter((assignment) => assignment.canClockIn)
      .length ?? 0;
  const staffAppReady = Boolean(
    staff?.teamMemberLinkStatus === "LINKED" &&
      staff.employeeAccountId &&
      staff.employeeBusinessMembershipId,
  );
  const activeDevices = overview.employeeAccount.devices.filter(
    (device) => device.status === "ACTIVE",
  );
  const punchDevices = activeDevices.filter((device) => device.canPunch).length;
  return (
    <div className={styles.sectionContent}>
      <SectionIntro
        title="Access"
        description="Staff App, permissions and workplace access in one operational view."
      />
      <div className={styles.profileGrid}>
        <Panel title="Staff access">
          <Detail label="Staff App" value={staffAppReady ? "Ready" : "Needs setup"} />
          <Detail label="Login email" value={personal.staffUser?.email || "Not linked"} />
          <Detail label="POS access" value={staff?.loginEnabled ? "Enabled" : "Disabled"} />
          <Detail
            label="Appointment access"
            value={staff?.appointmentBookable ? "Enabled" : "Disabled"}
          />
        </Panel>
        <Panel title="Permissions & punch access">
          <Detail
            label="System role"
            value={employment?.staffUser?.staffRoleProfile?.name ?? "No role assigned"}
          />
          <Detail
            label="Staff level"
            value={employment?.staffUser?.staffLevel?.name ?? "No level"}
          />
          <Detail label="Clock-in workplaces" value={String(clockInBranches)} />
          <p className={styles.compactNote}>
            System role controls permissions. Position is an employee job title and does not grant access.
          </p>
        </Panel>
        <Panel title="Verified devices">
          <Detail label="Active devices" value={String(activeDevices.length)} />
          <Detail label="Punch-enabled devices" value={String(punchDevices)} />
          <Detail
            label="Latest activity"
            value={activeDevices[0] ? formatShortDate(activeDevices[0].lastActiveAt) : "No device"}
          />
        </Panel>
      </div>
    </div>
  );
}

function formatShortDate(value: Date) {
  return value.toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function SectionIntro({ title, description }: { title: string; description: string }) {
  return (
    <section className={styles.sectionIntro}>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </section>
  );
}

function Panel({
  action,
  children,
  title,
}: {
  action?: { href: string; label: string };
  children: ReactNode;
  title: string;
}) {
  return (
    <section className={styles.profilePanel}>
      <div className={styles.panelHeading}>
        <h3>{title}</h3>
        {action ? <Link href={action.href}>{action.label}</Link> : null}
      </div>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.compactDetail}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className={styles.compactNote}>{text}</p>;
}

function formatStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
