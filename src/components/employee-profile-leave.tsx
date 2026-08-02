import Link from "next/link";
import type { loadEmployeeLeaveSection } from "@/lib/team/employee-profile-leave-read";
import styles from "./employee-profile-shell.module.css";

type LeaveData = NonNullable<
  Awaited<ReturnType<typeof loadEmployeeLeaveSection>>
>;

export function EmployeeProfileLeave({ data }: { data: LeaveData }) {
  return (
    <div className={styles.sectionContent}>
      <section className={styles.sectionIntro}>
        <div>
          <p className={styles.eyebrow}>Leave</p>
          <h2>Leave</h2>
          <p>
            Read-only balances and request status for the current leave year.
            Only authorized branch records are included.
          </p>
        </div>
        <span className={styles.scopeBadge}>Read only</span>
      </section>

      <section aria-label="Leave summary" className={styles.metricGrid}>
        <LeaveMetric
          label="Current leave year"
          note="Business local calendar"
          value={String(data.year)}
        />
        <LeaveMetric
          label="Applicable policies"
          note="Active company leave types"
          value={String(data.applicablePolicyCount)}
        />
        <LeaveMetric
          label="Pending requests"
          note="Inside authorized branch scope"
          value={String(data.pendingRequestCount)}
        />
        <LeaveMetric
          label="Approved this year"
          note="Approved leave days"
          value={formatDays(data.approvedLeaveDays)}
        />
      </section>

      <section className={styles.profilePanel}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Leave balances</p>
            <h3>Policy entitlement and usage</h3>
            <p>
              Entitlement, carry forward, adjustments and approved usage for {data.year}.
            </p>
          </div>
          <span>{data.policies.length} policy(s)</span>
        </div>
        {data.policies.length ? (
          <div className={styles.assignmentList}>
            {data.policies.map((policy) => (
              <article key={policy.id}>
                <div>
                  <strong>{policy.name}</strong>
                  <small>{formatEnum(policy.code)} · {formatCountMode(policy.countMode)}</small>
                </div>
                <div>
                  <span>
                    Entitlement {formatDays(policy.entitlementDays)} · Carry forward {formatDays(policy.carriedForwardDays)} · Adjustment {formatSignedDays(policy.adjustmentDays)}
                  </span>
                  <small>
                    Used {formatDays(policy.usedDays)} · Remaining {policy.remainingDays === null ? "Not tracked" : formatDays(policy.remainingDays)}
                  </small>
                </div>
                <div>
                  <StatusBadge status={policy.payTreatment} />
                  <small>{policy.balanceTracked ? "Balance tracked" : "Balance not tracked"}</small>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <LeaveEmpty
            title="No applicable leave policy"
            description="No active company leave policy is available for this employee."
          />
        )}
        <Link className={styles.inlineLink} href={`/team/leave?year=${data.year}`}>
          Open Leave Management
        </Link>
      </section>

      <div className={styles.profileGrid}>
        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Upcoming approved leave</p>
              <h3>Approved schedule</h3>
              <p>Current and upcoming approved requests.</p>
            </div>
            <span>{data.upcomingApprovedLeave.length} record(s)</span>
          </div>
          {data.upcomingApprovedLeave.length ? (
            <LeaveRequestList requests={data.upcomingApprovedLeave} />
          ) : (
            <LeaveEmpty
              title="No upcoming approved leave"
              description="There is no current or upcoming approved leave inside your authorized scope."
            />
          )}
        </section>

        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Recent leave history</p>
              <h3>Recent requests</h3>
              <p>Up to 20 requests, showing dates, type and status only.</p>
            </div>
            <span>{data.recentLeaveHistory.length} record(s)</span>
          </div>
          {data.recentLeaveHistory.length ? (
            <LeaveRequestList requests={data.recentLeaveHistory} />
          ) : (
            <LeaveEmpty
              title="No leave history"
              description="No leave request is available for this employee inside your authorized scope."
            />
          )}
        </section>
      </div>
    </div>
  );
}

function LeaveMetric({
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

function LeaveRequestList({
  requests,
}: {
  requests: LeaveData["recentLeaveHistory"];
}) {
  return (
    <div className={styles.assignmentList}>
      {requests.map((request) => (
        <article key={request.id}>
          <div>
            <strong>{request.policyName}</strong>
            <small>{formatDateRange(request.startsOn, request.endsOn)}</small>
          </div>
          <div>
            <span>{formatDays(request.requestedDays)}</span>
            <small>{formatEnum(request.payTreatment)}</small>
          </div>
          <StatusBadge status={request.status} />
        </article>
      ))}
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

function LeaveEmpty({
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

function formatDays(value: number) {
  const rounded = Number(value.toFixed(2));
  return `${rounded} ${Math.abs(rounded) === 1 ? "day" : "days"}`;
}

function formatSignedDays(value: number) {
  const rounded = Number(value.toFixed(2));
  return `${rounded > 0 ? "+" : ""}${formatDays(rounded)}`;
}

function formatCountMode(value: string) {
  return value === "WEEKDAYS" ? "Weekdays" : "Calendar days";
}

function formatDateRange(startsOn: Date, endsOn: Date) {
  const start = formatDate(startsOn);
  const end = formatDate(endsOn);
  return start === end ? start : `${start} – ${end}`;
}

function formatDate(value: Date) {
  return value.toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
