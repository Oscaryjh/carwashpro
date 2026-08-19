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
  const operationalChecks = [
    {
      label: "Back-office login",
      detail: data.staffUser?.loginEnabled
        ? "Ready to sign in"
        : "Login is not enabled",
      ready: Boolean(data.staffUser?.loginEnabled),
    },
    {
      label: "Service booking",
      detail: data.staffUser?.appointmentBookable
        ? "Available for appointment assignment"
        : "Not available for appointments",
      ready: Boolean(data.staffUser?.appointmentBookable),
    },
    {
      label: "Staff profile",
      detail:
        data.staffUser?.status === "active"
          ? "Operational profile is active"
          : "Operational profile needs review",
      ready: data.staffUser?.status === "active",
    },
  ];

  return (
    <div className={styles.sectionContent}>
      <section className={styles.sectionIntro}>
        <div>
          <h2>Overview</h2>
          <p>
            The employee&apos;s current work setup at a glance. Open a section only
            when you need its full details.
          </p>
        </div>
        <span className={styles.scopeBadge}>Read only</span>
      </section>

      <section aria-label="People snapshot" className={styles.metricGrid}>
        <ProfileMetric
          label="Access role"
          value={data.staffUser?.staffRoleProfile?.name ?? "Custom access"}
          note="System permissions"
        />
        <ProfileMetric
          label="Assigned services"
          value={String(data.staffUser?._count.serviceStaffAssignments ?? 0)}
          note="Available service assignments"
        />
        <ProfileMetric
          label="Back-office access"
          value={data.staffUser?.loginEnabled ? "Login enabled" : "No login"}
          note="Account access"
        />
        <ProfileMetric
          label="Branch coverage"
          value={`${data.branchAssignments.length} branch${
            data.branchAssignments.length === 1 ? "" : "es"
          }`}
          note={primaryAssignment ? "Primary branch assigned" : "Review branch setup"}
        />
      </section>

      <div className={styles.profileGrid}>
        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>People setup</p>
              <h3>Operational status</h3>
            </div>
            <span>
              {operationalChecks.filter((check) => check.ready).length}/
              {operationalChecks.length} ready
            </span>
          </div>
          <div className={styles.checkList}>
            {operationalChecks.map((check) => (
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
              <p className={styles.eyebrow}>Information structure</p>
              <h3>One section for each purpose</h3>
            </div>
          </div>
          <div className={styles.overviewNote}>
            <strong>Details now live in their own section</strong>
            <p>
              Employment keeps job and branch records. Personal keeps contact
              details. Payroll, leave and attendance stay permission-controlled.
            </p>
          </div>
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
          <h2>Employment</h2>
          <p>
            Job details and current branch assignments within your authorized
            business scope.
          </p>
        </div>
        <span className={styles.scopeBadge}>Read only</span>
      </section>

      <div className={styles.profileGrid}>
        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Job</p>
              <h3>Employment details</h3>
            </div>
          </div>
          <div className={styles.detailList}>
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
              <p className={styles.eyebrow}>Access</p>
              <h3>Staff access & services</h3>
            </div>
          </div>
          {data.staffUser ? (
            <>
              <div className={styles.detailList}>
                <ProfileDetail
                  label="Back-office login"
                  value={data.staffUser.loginEnabled ? "Enabled" : "Disabled"}
                />
                <ProfileDetail
                  label="Access role"
                  value={data.staffUser.staffRoleProfile?.name ?? "Custom access"}
                />
                <ProfileDetail
                  label="Service booking"
                  value={data.staffUser.appointmentBookable ? "Enabled" : "Not enabled"}
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
              title="No staff access profile"
              description="This employee does not currently have back-office or service access."
            />
          )}
        </section>
      </div>

      <section className={styles.profilePanel}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Branches</p>
            <h3>Current branch assignments</h3>
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
