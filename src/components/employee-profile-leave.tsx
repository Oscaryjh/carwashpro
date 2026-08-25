import Link from "next/link";
import type { loadEmployeeLeaveSection } from "@/lib/team/employee-profile-leave-read";
import styles from "./employee-profile-shell.module.css";

type LeaveData = NonNullable<
  Awaited<ReturnType<typeof loadEmployeeLeaveSection>>
>;

export function EmployeeProfileLeave({
  canAdjustBalance,
  data,
}: {
  canAdjustBalance: boolean;
  data: LeaveData;
}) {
  return (
    <div className={styles.sectionContent}>
      <section className={styles.sectionIntro}>
        <div>
          <h2>Leave</h2>
          <p>Balances and requests for {data.year}.</p>
        </div>
      </section>

      <section
        aria-label="Leave summary"
        className={`${styles.metricGrid} ${styles.metricGridCompact}`}
      >
        <LeaveMetric
          label="Pending requests"
          note="Awaiting a decision"
          value={String(data.pendingRequestCount)}
        />
        <LeaveMetric
          label="Approved leave"
          note={`${data.year} total`}
          value={formatDays(data.approvedLeaveDays)}
        />
      </section>

      <section className={`${styles.profilePanel} ${styles.leaveBalancePanel}`}>
        <div className={styles.panelHeading}>
          <div>
            <h3>Leave balances</h3>
          </div>
          {canAdjustBalance ? (
            <Link
              aria-haspopup="dialog"
              className={styles.leaveBalanceAction}
              href={`/team/people/${data.id}?section=time&view=leave&manageLeave=1`}
            >
              Adjust balance
            </Link>
          ) : null}
        </div>
        {data.policies.length ? (
          <div className={styles.leaveBalanceList}>
            {data.policies.map((policy) => (
              <article className={styles.leaveBalanceItem} key={policy.id}>
                <div className={styles.leaveBalanceIdentity}>
                  <strong>{formatPolicyName(policy.name)}</strong>
                  <StatusBadge status={policy.payTreatment} />
                </div>
                <div className={styles.leaveBalanceAvailable}>
                  <strong>
                    {policy.remainingDays === null
                      ? "Not tracked"
                      : formatDays(policy.remainingDays)}
                  </strong>
                  <span>
                    {policy.remainingDays === null ? "No balance limit" : "Available"}
                  </span>
                </div>
                <dl className={styles.leaveBalanceStats}>
                  {policy.balanceTracked ? (
                    <div>
                      <dt>Entitled</dt>
                      <dd>{formatDays(policy.entitlementDays)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Used</dt>
                    <dd>{formatDays(policy.usedDays)}</dd>
                  </div>
                  {policy.carriedForwardDays !== 0 ? (
                    <div>
                      <dt>Carry forward</dt>
                      <dd>{formatDays(policy.carriedForwardDays)}</dd>
                    </div>
                  ) : null}
                  {policy.adjustmentDays !== 0 ? (
                    <div>
                      <dt>Adjustment</dt>
                      <dd>{formatSignedDays(policy.adjustmentDays)}</dd>
                    </div>
                  ) : null}
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <LeaveEmpty
            title="No applicable leave policy"
            description="No active company leave policy is available for this employee."
          />
        )}
      </section>

      <div className={styles.profileGrid}>
        <section className={styles.profilePanel}>
          <div className={styles.panelHeading}>
            <div>
              <h3>Upcoming leave</h3>
            </div>
            <span>{formatCount(data.upcomingApprovedLeave.length, "request")}</span>
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
              <h3>Recent requests</h3>
            </div>
            <span>{formatCount(data.recentLeaveHistory.length, "request")}</span>
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

function formatPolicyName(value: string) {
  return value.replace(/\s*\(company policy\)\s*$/i, "").trim();
}

function formatCount(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
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
