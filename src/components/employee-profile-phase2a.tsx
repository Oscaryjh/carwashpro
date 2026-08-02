import Link from "next/link";
import type {
  getEmployeeProfileEmployment,
  getEmployeeProfileOverview,
} from "@/lib/team/employee-profile-read";
import styles from "./employee-profile-shell.module.css";

type OverviewData = NonNullable<
  Awaited<ReturnType<typeof getEmployeeProfileOverview>>
>;
type EmploymentData = NonNullable<
  Awaited<ReturnType<typeof getEmployeeProfileEmployment>>
>;

export function EmployeeProfileOverview({ data }: { data: OverviewData }) {
  const primaryAssignment =
    data.branchAssignments.find((assignment) => assignment.isPrimary) ?? null;
  const clockInBranches = data.branchAssignments.filter(
    (assignment) => assignment.canClockIn,
  );
  const workforceChecks = [
    {
      label: "Employment profile",
      detail: `${data.employeeCode} is linked to this business`,
      ready: true,
    },
    {
      label: "Primary branch",
      detail: primaryAssignment?.branch.name ?? "No active primary branch",
      ready: Boolean(primaryAssignment),
    },
    {
      label: "Attendance access",
      detail: data.attendanceEnabled
        ? "Attendance is enabled"
        : "Attendance is disabled",
      ready: data.attendanceEnabled,
    },
    {
      label: "Clock-in assignment",
      detail: `${clockInBranches.length} authorized branch${
        clockInBranches.length === 1 ? "" : "es"
      }`,
      ready: clockInBranches.length > 0,
    },
  ];

  return (
    <div className={styles.sectionContent}>
      <section className={styles.sectionIntro}>
        <div>
          <p className={styles.eyebrow}>Overview</p>
          <h2>Employee overview</h2>
          <p>
            Employment, branch access, attendance access and system connections
            at a glance. Sensitive payroll records are not included.
          </p>
        </div>
        <span className={styles.scopeBadge}>Read only</span>
      </section>

      <section aria-label="Employment snapshot" className={styles.metricGrid}>
        <ProfileMetric
          label="Employee code"
          value={data.employeeCode}
          note={formatEnum(data.employmentType)}
        />
        <ProfileMetric
          label="Position"
          value={data.position || "Not recorded"}
          note="Employment title"
        />
        <ProfileMetric
          label="Joined"
          value={formatDate(data.joinedAt, data.business.timezone)}
          note={formatEnum(data.status)}
        />
        <ProfileMetric
          label="Primary branch"
          value={primaryAssignment?.branch.name ?? "Not assigned"}
          note={`${Math.max(0, data.branchAssignments.length - 1)} additional branch${
            data.branchAssignments.length - 1 === 1 ? "" : "es"
          }`}
        />
      </section>

      <div className={styles.profileGrid}>
        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Workforce setup</p>
              <h3>Operational status</h3>
            </div>
            <span>
              {workforceChecks.filter((check) => check.ready).length}/
              {workforceChecks.length} ready
            </span>
          </div>
          <div className={styles.checkList}>
            {workforceChecks.map((check) => (
              <article data-ready={check.ready} key={check.label}>
                <span aria-hidden="true">{check.ready ? "✓" : "!"}</span>
                <div>
                  <strong>{check.label}</strong>
                  <small>{check.detail}</small>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>System connection</p>
              <h3>POS and services</h3>
            </div>
          </div>
          <div className={styles.detailList}>
            <ProfileDetail
              label="Staff profile"
              value={data.staffUser ? "Linked" : "Not linked"}
            />
            <ProfileDetail
              label="POS access"
              value={
                data.staffUser?.status === "active" &&
                data.staffUser.loginEnabled
                  ? "Enabled"
                  : "Not enabled"
              }
            />
            <ProfileDetail
              label="Provides services"
              value={data.staffUser?.appointmentBookable ? "Yes" : "No"}
            />
            <ProfileDetail
              label="Assigned services"
              value={String(
                data.staffUser?._count.serviceStaffAssignments ?? 0,
              )}
            />
          </div>
          <Link
            className={styles.inlineLink}
            href={`/team/people/${data.id}?section=employment`}
          >
            View employment details
          </Link>
        </section>
      </div>
    </div>
  );
}
export function EmployeeProfileEmployment({
  data,
}: {
  data: EmploymentData;
}) {
  return (
    <div className={styles.sectionContent}>
      <section className={styles.sectionIntro}>
        <div>
          <p className={styles.eyebrow}>Employment</p>
          <h2>Employment details</h2>
          <p>
            Read-only employment, branch, POS and service connections within
            your authorized business scope.
          </p>
        </div>
        <span className={styles.scopeBadge}>Read only</span>
      </section>

      <div className={styles.profileGrid}>
        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Employment record</p>
              <h3>Core details</h3>
            </div>
            <StatusBadge status={data.status} />
          </div>
          <div className={styles.detailList}>
            <ProfileDetail label="Employee code" value={data.employeeCode} />
            <ProfileDetail
              label="Employment type"
              value={formatEnum(data.employmentType)}
            />
            <ProfileDetail
              label="Position"
              value={data.position || "Not recorded"}
            />
            <ProfileDetail
              label="Joined date"
              value={formatDate(data.joinedAt, data.business.timezone)}
            />
            <ProfileDetail
              label="Termination date"
              value={
                data.terminatedAt
                  ? formatDate(data.terminatedAt, data.business.timezone)
                  : "Not applicable"
              }
            />
          </div>
        </section>

        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>System connection</p>
              <h3>POS and service profile</h3>
            </div>
          </div>
          {data.staffUser ? (
            <>
              <div className={styles.detailList}>
                <ProfileDetail label="Staff profile" value="Linked" />
                <ProfileDetail
                  label="Account status"
                  value={formatEnum(data.staffUser.status)}
                />
                <ProfileDetail
                  label="POS access"
                  value={data.staffUser.loginEnabled ? "Enabled" : "Disabled"}
                />
                <ProfileDetail
                  label="System access role"
                  value={data.staffUser.staffRoleProfile?.name ?? "Custom access"}
                />
                <ProfileDetail
                  label="Provides services"
                  value={data.staffUser.appointmentBookable ? "Yes" : "No"}
                />
              </div>
              <div className={styles.serviceList}>
                <span>Assigned services</span>
                {data.staffUser.serviceStaffAssignments.length ? (
                  <div>
                    {data.staffUser.serviceStaffAssignments.map(
                      ({ service }) => (
                        <span key={service.id}>{service.name}</span>
                      ),
                    )}
                  </div>
                ) : (
                  <small>No services assigned</small>
                )}
              </div>
            </>
          ) : (
            <ProfileEmpty
              title="No linked system profile"
              description="This employee does not currently have POS access or a service profile."
            />
          )}
        </section>
      </div>

      <section className={styles.profilePanel}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Branch scope</p>
            <h3>Current assignments</h3>
            <p>Only current assignments inside your authorized branches appear.</p>
          </div>
          <span>{data.branchAssignments.length} assignment(s)</span>
        </div>
        {data.branchAssignments.length ? (
          <div className={styles.assignmentList}>
            {data.branchAssignments.map((assignment) => (
              <article key={assignment.id}>
                <div>
                  <strong>{assignment.branch.name}</strong>
                  <small>
                    {assignment.isPrimary ? "Primary branch" : "Additional branch"}
                  </small>
                </div>
                <div>
                  <span>{assignment.canClockIn ? "Clock in allowed" : "Clock in not allowed"}</span>
                  <small>
                    From {formatDate(assignment.effectiveFrom, data.business.timezone)}
                    {assignment.effectiveUntil
                      ? ` to ${formatDate(assignment.effectiveUntil, data.business.timezone)}`
                      : " · Ongoing"}
                  </small>
                </div>
                <StatusBadge status={assignment.status} />
              </article>
            ))}
          </div>
        ) : (
          <ProfileEmpty
            title="No active branch assignment"
            description="No current assignment is available inside your authorized branch scope."
          />
        )}
      </section>
    </div>
  );
}

function ProfileMetric({
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

function ProfileDetail({ label, value }: { label: string; value: string }) {
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
      {formatEnum(status)}
    </strong>
  );
}

function ProfileEmpty({
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
