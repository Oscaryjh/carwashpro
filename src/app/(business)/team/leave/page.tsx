import { randomUUID } from "node:crypto";
import Link from "next/link";
import { HrPayrollIssue } from "@/components/hr-payroll-issue";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { getManagerLeaveDashboard } from "@/lib/leave/service";
import { getStatutoryRuleSetOverview } from "@/lib/leave/statutory-service";
import {
  cancelApprovedLeaveAction,
  deactivateLeavePolicyAction,
  generateLeaveEntitlementsAction,
  installSabahStatutoryRulePackDraftAction,
  installLeaveStarterAction,
  markStatutoryRuleSetReadyForHumanSignOffAction,
  processLeaveLifecycleAction,
  reviewLeaveDocumentAction,
  reviewLeaveRequestAction,
  submitStatutoryRuleSetAction,
  updateLeaveBalanceAction,
} from "./actions";
import { LeavePolicyEditor } from "./leave-policy-editor";
import { LeaveTypeCreateForm } from "./leave-type-create-form";
import styles from "./leave.module.css";

type Props = {
  searchParams: Promise<{
    year?: string;
    employee?: string;
    branch?: string;
    status?: string;
    policy?: string;
    date?: string;
    queue?: "pending" | "approved" | "closed";
    balanceEmployee?: string;
    type?: string;
    message?: string;
    newLeaveType?: string;
    manage?: "menu" | "balances" | "types" | "policy" | "compliance" | "maintenance";
    policyId?: string;
    request?: string;
  }>;
};

export default async function LeavePage({ searchParams }: Props) {
  const { access } = await requireBusinessUser("VIEW_LEAVE");
  const scope = await resolveAttendanceScope(access);
  const params = await searchParams;
  const requestedYear = Number(params.year);
  const year = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2200
    ? requestedYear
    : new Date().getUTCFullYear();
  const canApprove = hasBusinessCapability(access, "APPROVE_LEAVE");
  const canEditPolicy = hasBusinessCapability(access, "EDIT_LEAVE_POLICY");
  const canAdjust = hasBusinessCapability(access, "ADJUST_LEAVE_BALANCE");
  const canViewTeamDirectory = hasBusinessCapability(access, "VIEW_TEAM_DIRECTORY");
  const [data, statutoryOverview] = await Promise.all([
    getManagerLeaveDashboard({
      businessId: scope.businessId,
      allowedBranchIds: scope.allowedBranchIds,
      year,
    }),
    canEditPolicy ? getStatutoryRuleSetOverview(scope.businessId) : Promise.resolve(null),
  ]);
  const requestQueue = params.queue ?? "pending";
  const employeeQuery = params.employee?.trim().toLowerCase();
  const filteredRequests = data.requests.filter((request) => (
    (!employeeQuery
      || request.employee.fullName.toLowerCase().includes(employeeQuery)
      || request.employee.employeeCode.toLowerCase().includes(employeeQuery))
    && (!params.branch || request.branch.id === params.branch)
    && (!params.policy || request.policyId === params.policy)
    && (!params.date || (request.startsOn <= params.date && request.endsOn >= params.date))
    && (requestQueue === "pending"
      ? request.status === "PENDING"
      : requestQueue === "approved"
        ? request.status === "APPROVED"
        : request.status === "REJECTED" || request.status === "CANCELLED")
  ));
  const branches = [...new Map(data.requests.map((request) => [request.branch.id, request.branch])).values()];
  const hasActiveFilters = Boolean(params.employee || params.branch || params.policy || params.date);
  const pendingCount = data.requests.filter((request) => request.status === "PENDING").length;
  const approvedCount = data.requests.filter((request) => request.status === "APPROVED").length;
  const closedCount = data.requests.filter((request) => request.status === "REJECTED" || request.status === "CANCELLED").length;
  const today = new Date().toISOString().slice(0, 10);
  const onLeaveToday = data.requests.filter((request) => (
    request.status === "APPROVED" && request.startsOn <= today && request.endsOn >= today
  ));
  const upcomingLeave = data.requests
    .filter((request) => request.status === "APPROVED" && request.startsOn > today)
    .sort((left, right) => left.startsOn.localeCompare(right.startsOn));
  const trackedPolicies = data.policies.filter((policy) => policy.latestVersion?.balanceTracked);
  const selectedPolicy = data.policies.find((policy) => policy.id === params.policyId) ?? data.policies[0] ?? null;
  const selectedPolicyVersion = selectedPolicy?.latestVersion ?? null;
  const selectedBalanceEmployee = data.employees.find((employee) => employee.id === params.balanceEmployee)
    ?? data.employees[0]
    ?? null;
  const selectedBalanceRows = selectedBalanceEmployee
    ? trackedPolicies.map((policy) => {
        const available = data.balances.find((balance) => (
          balance.membershipId === selectedBalanceEmployee.id && balance.policyId === policy.id
        ))?.units ?? 0;
        const buckets = data.bucketBalances.filter((bucket) => (
          bucket.membershipId === selectedBalanceEmployee.id && bucket.policyId === policy.id
        ));
        const current = buckets.filter((bucket) => bucket.sourceType === "CURRENT_ENTITLEMENT")
          .reduce((total, bucket) => total + bucket.remainingUnits, 0);
        const carryForward = buckets.filter((bucket) => bucket.sourceType === "CARRY_FORWARD")
          .reduce((total, bucket) => total + bucket.remainingUnits, 0);
        const carryExpiryDates = buckets.filter((bucket) => bucket.sourceType === "CARRY_FORWARD" && bucket.expiresAt && bucket.remainingUnits > 0)
          .map((bucket) => bucket.expiresAt as string);
        return {
          policy,
          available,
          current,
          carryForward,
          manualAdjustment: Number((available - current - carryForward).toFixed(2)),
          carryExpiryDates,
          pending: data.requests
          .filter((request) => (
            request.employee.id === selectedBalanceEmployee.id
            && request.policyId === policy.id
            && request.status === "PENDING"
          ))
          .reduce((total, request) => total + request.requestedDays, 0),
        };
      })
    : [];

  const earliestPolicyEffectiveDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const noticeMessage = leaveNoticeMessage(params.message);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>People & HR</p>
          <h1>Leave</h1>
          <p>Review requests first. Open balances and policy settings only when you need them.</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.reportsButton} href={`/team/leave/reports?year=${year}`}>Reports & export</Link>
          {(canAdjust || canEditPolicy) ? (
          <Link className={styles.manageButton} href={`/team/leave?year=${year}&manage=menu`}>
              Manage leave
            </Link>
          ) : null}
        </div>
      </header>

      {noticeMessage ? params.type === "error" ? (
        <HrPayrollIssue
          affected="The leave request, balance or policy action you just attempted"
          impact="No leave request or employee balance was changed."
          nextAction={{ href: canEditPolicy ? `/team/leave?year=${year}&manage=menu` : `/team/leave?year=${year}`, label: canEditPolicy ? "Open leave settings" : "Review leave" }}
          title="Leave action needs attention"
          tone="error"
          whatHappened={noticeMessage}
        />
      ) : (
        <div className={styles.success} role="status">{noticeMessage}</div>
      ) : null}

      <section className={styles.summary} aria-label="Leave overview">
        <article className={data.summary.pending > 0 ? styles.summaryAttention : undefined}>
          <span>Needs approval</span>
          <strong>{data.summary.pending}</strong>
          <small>Requests requiring a decision</small>
        </article>
        <article>
          <span>On leave today</span>
          <strong>{onLeaveToday.length}</strong>
          <small>Approved leave only</small>
        </article>
        <article>
          <span>Upcoming leave</span>
          <strong>{upcomingLeave.length}</strong>
          <small>Next approved absences</small>
        </article>
        <form className={styles.yearPicker}>
          <label>
            Leave year
            <input type="number" name="year" min="2000" max="2200" defaultValue={year} />
          </label>
          <button type="submit">View year</button>
        </form>
      </section>

      {data.policies.length === 0 ? (
        <section className={styles.setup}>
          <div>
            <p className={styles.eyebrow}>Setup required</p>
            <h2>Create your first leave types</h2>
            <p>Starter policies begin at zero entitlement so your company can configure them deliberately.</p>
          </div>
          {canEditPolicy ? (
            <form action={installLeaveStarterAction}>
              <button type="submit">Install starter leave types</button>
            </form>
          ) : null}
        </section>
      ) : null}

      <section className={styles.panel}>
        <div className={styles.panelTitle}>
          <div>
            <p className={styles.eyebrow}>Approval inbox</p>
            <h2>{requestQueue === "pending" ? "Pending approval" : requestQueue === "approved" ? "Approved leave" : "Rejected & cancelled"}</h2>
            <p>{requestQueue === "pending"
              ? "Review requests that still need a decision."
              : requestQueue === "approved"
                ? "View approved leave. Open a request only when details or cancellation are needed."
                : "Review completed requests kept for reference."}</p>
          </div>
          <span>{filteredRequests.length} shown</span>
        </div>

        <nav className={styles.requestQueues} aria-label="Leave request views">
          <Link className={requestQueue === "pending" ? styles.requestQueueActive : styles.requestQueue} href={`/team/leave?year=${year}&queue=pending`}>
            <span>Pending approval</span><b>{pendingCount}</b>
          </Link>
          <Link className={requestQueue === "approved" ? styles.requestQueueActive : styles.requestQueue} href={`/team/leave?year=${year}&queue=approved`}>
            <span>Approved</span><b>{approvedCount}</b>
          </Link>
          <Link className={requestQueue === "closed" ? styles.requestQueueActive : styles.requestQueue} href={`/team/leave?year=${year}&queue=closed`}>
            <span>Rejected & cancelled</span><b>{closedCount}</b>
          </Link>
        </nav>

        <details className={styles.filters} open={hasActiveFilters}>
          <summary>
            <span>{hasActiveFilters ? "Filters applied" : "Filter requests"}</span>
            <small>{hasActiveFilters ? "Change or clear this view" : "Search by employee, leave type or date"}</small>
          </summary>
          <form className={styles.filterForm}>
            <input type="hidden" name="year" value={year} />
            <input type="hidden" name="queue" value={requestQueue} />
            <label>
              Employee
              <input name="employee" defaultValue={params.employee} placeholder="Name or employee code" />
            </label>
            {branches.length > 1 ? (
              <label>
                Branch
                <select name="branch" defaultValue={params.branch ?? ""}>
                  <option value="">All authorised branches</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </label>
            ) : null}
            <label>
              Leave type
              <select name="policy" defaultValue={params.policy ?? ""}>
                <option value="">All leave types</option>
                {data.policies.map((policy) => <option key={policy.id} value={policy.id}>{policy.name}</option>)}
              </select>
            </label>
            <label>
              Covers date
              <input type="date" name="date" defaultValue={params.date} />
            </label>
            <div className={styles.filterActions}>
              {hasActiveFilters ? <Link href={`/team/leave?year=${year}&queue=${requestQueue}`}>Clear filters</Link> : null}
              <button type="submit">Apply filters</button>
            </div>
          </form>
        </details>

        <div className={styles.requestList}>
          {filteredRequests.length === 0 ? (
            <div className={styles.emptyState}>
              <div aria-hidden="true">✓</div>
              <h3>{hasActiveFilters
                ? "No matching requests"
                : requestQueue === "pending"
                  ? "No leave requests need approval."
                  : requestQueue === "approved"
                    ? "No approved leave to show"
                    : "No rejected or cancelled leave"}</h3>
              {hasActiveFilters || requestQueue !== "pending" ? <p>{hasActiveFilters
                ? "Try clearing one or more filters."
                : "Approved requests will appear here automatically."}</p> : null}
            </div>
          ) : filteredRequests.map((request) => (
            <article className={styles.request} id={`leave-request-${request.id}`} key={request.id}>
              <div className={styles.requestMain}>
                <div className={styles.avatar} aria-hidden="true">{initials(request.employee.fullName)}</div>
                <div className={styles.requestCopy}>
                  <div className={styles.employeeLine}>
                    {canViewTeamDirectory ? (
                      <Link className={styles.employeeLink} href={`/team/people/${request.employee.id}?section=leave`}>
                        {request.employee.fullName}
                      </Link>
                    ) : <strong>{request.employee.fullName}</strong>}
                    <span>{request.employee.employeeCode} · {request.branch.name}</span>
                  </div>
                  <h3>{request.policyName}</h3>
                  <p className={styles.dateRange}>
                    {formatDate(request.startsOn)} – {formatDate(request.endsOn)}
                    <span>{formatDays(request.requestedDays)} · {leaveUnitLabel(request.leaveUnit)}</span>
                  </p>
                  <div className={styles.requestFacts}>
                    <span>{payTreatmentLabel(request.payTreatment)}</span>
                    <span>Balance {formatBalance(request.currentBalance)} → {formatBalance(request.resultingBalance)}</span>
                    {request.supportingEvidenceRequired ? <span>Evidence required</span> : null}
                    {request.supportingDocuments.length > 0 ? <span>{request.supportingDocuments.length} {request.supportingDocuments.length === 1 ? "document" : "documents"}</span> : null}
                  </div>
                </div>
              </div>
              <div className={styles.requestSide}>
                <span className={`${styles.badge} ${styles[request.status.toLowerCase()]}`}>{statusLabel(request.status)}</span>
              </div>

              <details className={styles.requestDetails} open={params.request === request.id}>
                <summary>
                  <span>{requestQueue === "pending" ? "Review request" : "View details"}</span>
                  <small>{request.supportingDocuments.length > 0 ? `${request.supportingDocuments.length} supporting ${request.supportingDocuments.length === 1 ? "document" : "documents"}` : "Employee note and balance details"}</small>
                </summary>
                <div className={styles.requestDetailsBody}>
                  <div className={styles.requestReason}>
                    <strong>Employee note</strong>
                    <p>{request.reason || "No note provided."}</p>
                  </div>

              {request.supportingDocuments.length > 0 ? (
                <section className={styles.evidencePanel} aria-label="Private supporting documents">
                  <div className={styles.evidenceHeading}>
                    <div><strong>Supporting evidence</strong><span>Private HR document · access is audited</span></div>
                    <b className={styles.evidenceStatus}>{evidenceStatusLabel(request.supportingEvidenceStatus)}</b>
                  </div>
                  <div className={styles.evidenceList}>
                    {request.supportingDocuments.map((document) => (
                      <article key={document.id} className={styles.evidenceItem}>
                        <div>
                          <strong>{document.fileName}</strong>
                          <span>{documentTypeLabel(document.documentType)} · {formatDocumentSize(document.byteLength)}</span>
                          <small>{document.securityStatus === "SCAN_NOT_AVAILABLE" ? "Stored privately · security scan not configured" : document.securityStatus.replaceAll("_", " ")}</small>
                        </div>
                        <div className={styles.evidenceActions}>
                          {document.source === "UPLOAD" ? <a href={`/api/leave/documents/${document.id}`} target="_blank" rel="noreferrer">Preview</a> : <span>Legacy reference</span>}
                          <b>{evidenceStatusLabel(document.reviewStatus)}</b>
                        </div>
                        {canApprove && request.status === "PENDING" ? (
                          <form action={reviewLeaveDocumentAction} className={styles.evidenceReview}>
                            <input type="hidden" name="documentId" value={document.id} />
                            <input name="note" placeholder="Note required if rejected or follow-up is needed" maxLength={500} />
                            <button name="status" value="VERIFIED" type="submit">Verify</button>
                            <button name="status" value="REVIEW_REQUIRED" type="submit">Needs follow-up</button>
                            <button className={styles.reject} name="status" value="REJECTED" type="submit">Reject evidence</button>
                          </form>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>
              ) : request.supportingEvidenceRequired ? <div className={styles.evidenceMissing}>Supporting evidence is required before this request can be approved.</div> : null}

              {canApprove && request.status === "PENDING" ? (
                <form action={reviewLeaveRequestAction} className={styles.reviewForm}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <input type="hidden" name="expectedRevision" value={request.revision} />
                  <label>
                    Decision note
                    <input name="reviewNote" placeholder="Required only when rejecting" maxLength={500} />
                  </label>
                  <button name="decision" value="APPROVED" type="submit">Approve request</button>
                  <button className={styles.reject} name="decision" value="REJECTED" type="submit">Reject</button>
                </form>
              ) : null}
              {canApprove && request.status === "APPROVED" ? (
                <details className={styles.cancellation}>
                  <summary>Cancel approved leave</summary>
                  <form action={cancelApprovedLeaveAction} className={styles.cancelForm}>
                    <input type="hidden" name="requestId" value={request.id} />
                    <input type="hidden" name="expectedRevision" value={request.revision} />
                    <label>
                      Cancellation reason
                      <input name="reason" required minLength={3} maxLength={500} placeholder="Explain why this approved leave is being cancelled" />
                    </label>
                    <button className={styles.reject} type="submit">Confirm cancellation</button>
                  </form>
                </details>
              ) : null}
              {request.reviewNote ? <p className={styles.reviewNote}>Decision note: {request.reviewNote}</p> : null}
              {request.cancellationReason ? <p className={styles.reviewNote}>Cancellation reason: {request.cancellationReason}</p> : null}
                </div>
              </details>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.dailyOverview} aria-label="Approved leave schedule">
        <div>
          <p className={styles.eyebrow}>Today</p>
          <h2>On leave today</h2>
          {onLeaveToday.length ? (
            <div className={styles.peopleChips}>{onLeaveToday.map((request) => (
              <span key={request.id}>{request.employee.fullName} · {request.policyName}</span>
            ))}</div>
          ) : <p>No one is on approved leave today.</p>}
        </div>
        <div>
          <p className={styles.eyebrow}>Coming up</p>
          <h2>Upcoming leave</h2>
          {upcomingLeave.length ? (
            <div className={styles.upcomingList}>{upcomingLeave.slice(0, 6).map((request) => (
              <span key={request.id}><b>{formatDate(request.startsOn)}</b>{request.employee.fullName} · {request.policyName}</span>
            ))}</div>
          ) : <p>No upcoming approved leave.</p>}
        </div>
      </section>

      {(canAdjust || canEditPolicy) && params.manage === "menu" ? (
        <div className={styles.modalBackdrop}>
          <section className={`${styles.management} ${styles.managementModal}`} role="dialog" aria-modal="true" aria-labelledby="leave-management-menu-title">
            <header className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Leave settings</p>
                <h2 id="leave-management-menu-title">Manage leave</h2>
                <p>Choose one focused workspace. Daily approvals remain on the main Leave page.</p>
              </div>
              <Link className={styles.modalClose} href={`/team/leave?year=${year}`} aria-label="Close leave management">{"\u00d7"}</Link>
            </header>
            <nav className={styles.leaveToolGrid} aria-label="Leave management tools">
              {canEditPolicy ? <Link className={styles.leaveTool} href={`/team/leave?year=${year}&manage=types`}><span className={styles.leaveToolIcon}>T</span><span><strong>Leave types</strong><small>Create and review the categories employees can request</small></span></Link> : null}
              {canAdjust ? <Link className={styles.leaveTool} href={`/team/leave?year=${year}&manage=balances`}><span className={styles.leaveToolIcon}>B</span><span><strong>Employee balances</strong><small>Review or correct one employee&apos;s available days</small></span></Link> : null}
              {canEditPolicy ? <Link className={styles.leaveTool} href={`/team/leave?year=${year}&manage=policy`}><span className={styles.leaveToolIcon}>P</span><span><strong>Company policies</strong><small>Change future allowance, eligibility and carry-forward rules</small></span></Link> : null}
            </nav>
            {canEditPolicy ? (
              <details className={styles.advancedTools}>
                <summary>Advanced compliance & maintenance</summary>
                <p>Restricted controls for statutory evidence and safe entitlement repairs.</p>
                <div>
                  <Link href={`/team/leave?year=${year}&manage=compliance`}>Compliance review</Link>
                  <Link href={`/team/leave?year=${year}&manage=maintenance`}>Maintenance tools</Link>
                </div>
              </details>
            ) : null}
          </section>
        </div>
      ) : null}

      {canEditPolicy && statutoryOverview && params.manage === "compliance" ? (
        <div className={styles.modalBackdrop}>
        <section
          className={`${styles.entitlementWorkspace} ${styles.managementModal}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-entitlements-modal-title"
        >
          <header className={styles.modalHeader}>
            <div>
              <p className={styles.eyebrow}>Restricted compliance</p>
              <h2 id="leave-entitlements-modal-title">Statutory leave review</h2>
              <p>Review sourced legal rule packs. Draft rules never affect employee balances or Payroll.</p>
            </div>
            <Link className={styles.modalClose} href={`/team/leave?year=${year}&manage=menu`} aria-label="Close entitlements">{"\u00d7"}</Link>
          </header>

          {statutoryOverview.branches.some((branch) => !branch.countryCode || !branch.stateCode) ? (
            <div className={styles.entitlementWarning}>
              At least one active branch has incomplete country/state jurisdiction. Statutory-backed entitlement generation will stop for affected employees until the branch jurisdiction is corrected.
            </div>
          ) : null}

          <div className={styles.ruleSetGrid}>
            {statutoryOverview.ruleSets.length === 0 ? (
              <div className={styles.emptyState}>
                <h3>No Sabah statutory rule pack installed</h3>
                <p>Install the versioned official-source pack as Draft. Installation never activates legal rules.</p>
                <form action={installSabahStatutoryRulePackDraftAction}>
                  <input type="hidden" name="year" value={year} />
                  <button type="submit">Install official Sabah pack as Draft</button>
                </form>
              </div>
            ) : statutoryOverview.ruleSets.map((ruleSet) => (
              <article className={styles.ruleSetCard} key={ruleSet.id}>
                <div className={styles.ruleSetHeading}>
                  <div>
                    <span className={styles.ruleStatus}>{ruleSetStatusLabel(ruleSet.status)}</span>
                    <h3>{ruleSet.jurisdictionCode ?? `${ruleSet.jurisdictionCountryCode}${ruleSet.jurisdictionStateCode ? `-${ruleSet.jurisdictionStateCode}` : ""}`} · {ruleSet.version}</h3>
                    <p>{ruleSet.effectiveFrom}{ruleSet.effectiveTo ? ` - ${ruleSet.effectiveTo}` : " onward"}</p>
                  </div>
                  <a href={ruleSet.sourceReference} target="_blank" rel="noreferrer">Open source</a>
                </div>
                <p className={styles.ruleSource}>{ruleSet.sourceTitle}</p>
                {ruleSet.sources.map((source) => (
                  <div className={styles.ruleSummary} key={source.id}>
                    <strong>{source.sourceTitle}</strong>
                    <span>{source.sourceSection} · retrieved {source.retrievedAt.toISOString().slice(0, 10)}</span>
                    <span>SHA-256 {source.contentHash.slice(0, 16)}…{source.contentHash.slice(-8)}</span>
                  </div>
                ))}
                {ruleSet.rules.map((rule) => (
                  <div className={styles.ruleSummary} key={rule.id}>
                    <strong>{statutoryCategoryLabel(rule.category)}</strong>
                    <span>{rule.statutorySection}</span>
                    <span>{entitlementPeriodLabel(rule.entitlementPeriodType)} · {prorationLabel(rule.prorationMethod)}</span>
                    <div className={styles.tierList}>
                      {rule.tiers.map((tier) => (
                        <span key={tier.id}>{serviceTierLabel(tier.minServiceMonths, tier.maxServiceMonths)}: {tier.entitlementUnits} days</span>
                      ))}
                    </div>
                  </div>
                ))}
                {ruleSet.status === "DRAFT" ? (
                  <form action={submitStatutoryRuleSetAction} className={styles.ruleAction}>
                    <input type="hidden" name="year" value={year} />
                    <input type="hidden" name="ruleSetId" value={ruleSet.id} />
                    <button type="submit">Submit for independent review</button>
                  </form>
                ) : null}
                {ruleSet.status === "READY_FOR_REVIEW" ? (
                  <form action={markStatutoryRuleSetReadyForHumanSignOffAction} className={styles.ruleReviewForm}>
                    <input type="hidden" name="year" value={year} />
                    <input type="hidden" name="ruleSetId" value={ruleSet.id} />
                    <label>
                      Reviewer note
                      <input name="reviewNote" required minLength={3} maxLength={1000} placeholder="What was checked against the official source?" />
                    </label>
                    <label className={styles.confirmation}>
                      <input name="confirmed" type="checkbox" required />
                      <span>I independently checked the source, effective dates, eligibility and every entitlement tier.</span>
                    </label>
                    <button type="submit">Complete independent review</button>
                  </form>
                ) : null}
                {ruleSet.status === "READY_FOR_HUMAN_SIGN_OFF" ? (
                  <div className={styles.entitlementWarning}>
                    Engineering review is complete. This pack is not active and now awaits explicit sign-off by an authorised Platform statutory administrator.
                  </div>
                ) : null}
              </article>
            ))}
          </div>

        </section>
        </div>
      ) : null}

      {canEditPolicy && params.manage === "maintenance" ? (
        <div className={styles.modalBackdrop}>
          <section className={`${styles.management} ${styles.managementModal}`} role="dialog" aria-modal="true" aria-labelledby="leave-maintenance-title">
            <header className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Restricted maintenance</p>
                <h2 id="leave-maintenance-title">Entitlement repair tools</h2>
                <p>Use only to repair missing records. These actions are idempotent and never replace manual balance history.</p>
              </div>
              <Link className={styles.modalClose} href={`/team/leave?year=${year}&manage=menu`} aria-label="Close maintenance tools">{"\u00d7"}</Link>
            </header>
            <div className={styles.entitlementToolbar}>
              <div><strong>Repair missing {year} entitlements</strong><span>Creates only missing immutable entitlement and ledger records. Existing records remain unchanged.</span></div>
              <form action={generateLeaveEntitlementsAction}><input type="hidden" name="year" value={year} /><button type="submit">Repair missing records</button></form>
            </div>
            <div className={styles.entitlementToolbar}>
              <div><strong>Run due carry-forward processing</strong><span>Creates due rollovers and expires only unused carry-forward days. Safe to run again.</span></div>
              <form action={processLeaveLifecycleAction}>
                <input type="hidden" name="year" value={year} />
                <input type="hidden" name="asOf" value={new Date().toISOString().slice(0, 10)} />
                <button type="submit">Run maintenance</button>
              </form>
            </div>
          </section>
        </div>
      ) : null}

      {(params.manage === "balances" || params.manage === "types" || params.manage === "policy") ? (
      <div className={styles.modalBackdrop}>
      <section
        className={`${styles.management} ${styles.managementModal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-management-modal-title"
      >
        <header className={styles.modalHeader}>
          <div>
            <p className={styles.eyebrow}>Leave settings</p>
            <h2 id="leave-management-modal-title">{params.manage === "balances" ? "Employee balances" : params.manage === "types" ? "Leave types" : "Company policies"}</h2>
            <p>{params.manage === "balances" ? "Review and correct one employee's available leave." : params.manage === "types" ? "Manage the categories employees can request." : "Change future rules without changing past requests or balances."}</p>
          </div>
          <Link className={styles.modalClose} href={`/team/leave?year=${year}&manage=menu`} aria-label="Close leave management">{"\u00d7"}</Link>
        </header>

        <div className={styles.grid}>
          {params.manage === "types" ? (
          <article className={styles.policyCard}>
            <div className={styles.cardHeading}>
              <div>
                <h3>Leave types</h3>
                <p>{data.policies.length} configured</p>
              </div>
              {canEditPolicy ? (
                <Link className={styles.newLeaveButton} href={`/team/leave?year=${year}&newLeaveType=1`}>
                  <span aria-hidden="true">+</span> New leave type
                </Link>
              ) : null}
            </div>
            <div className={styles.policyList}>
              {data.policies.map((policy) => {
                const version = policy.latestVersion;
                return (
                  <div key={policy.id} className={styles.policyRow}>
                    <div>
                      <strong>{version?.nameSnapshot ?? policy.name}</strong>
                      <span>{version?.balanceTracked ? `${formatDays(version.defaultEntitlementDays ?? 0)} yearly allowance` : "No balance limit"}</span>
                    </div>
                    <div>
                      <b>{payTreatmentLabel(version?.payTreatment ?? policy.payTreatment)}</b>
                      <small>{version?.requiresDocument ? "Document required" : "No document required"}</small>
                    </div>
                    {canEditPolicy ? (
                      <details className={styles.deactivateMenu}>
                        <summary>Deactivate</summary>
                        <form action={deactivateLeavePolicyAction}>
                          <input type="hidden" name="year" value={year} />
                          <input type="hidden" name="policyId" value={policy.id} />
                          <p>Employees will no longer be able to request this type. Historical records are retained.</p>
                          <label>
                            Reason
                            <input name="reason" minLength={3} maxLength={500} required placeholder="For example, replaced by a new leave type" />
                          </label>
                          <button type="submit">Confirm deactivation</button>
                        </form>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {data.policies.length ? <p className={styles.policyNote}>These are the current settings employees see when requesting leave.</p> : null}
          </article>
          ) : null}

          {canAdjust && params.manage === "balances" ? (
            <article className={styles.balanceManager} id="employee-leave-balances">
              <div className={styles.cardHeading}>
                <div>
                  <h3>Employee leave balances</h3>
                  <p>Use corrections only. Regular yearly allowance comes from Company policies.</p>
                </div>
                <span className={styles.auditBadge}>Audited</span>
              </div>

              {trackedPolicies.length && selectedBalanceEmployee ? (
                <>
                  <form className={styles.balancePicker}>
                    <input type="hidden" name="year" value={year} />
                    <input type="hidden" name="manage" value="balances" />
                    <label>
                      Employee
                      <select name="balanceEmployee" defaultValue={selectedBalanceEmployee.id}>
                        {data.employees.map((employee) => (
                          <option key={employee.id} value={employee.id}>{employee.fullName} ({employee.employeeCode})</option>
                        ))}
                      </select>
                    </label>
                    <button type="submit">View balance</button>
                  </form>

                  <div className={styles.balanceEmployeeHeader}>
                    <div className={styles.avatar} aria-hidden="true">{initials(selectedBalanceEmployee.fullName)}</div>
                    <div>
                      <strong>{selectedBalanceEmployee.fullName}</strong>
                      <span>{selectedBalanceEmployee.employeeCode} · {year}</span>
                    </div>
                  </div>

                  <div className={styles.balanceRows} aria-label={`${selectedBalanceEmployee.fullName} leave balances`}>
                    {selectedBalanceRows.map(({ policy, available, pending, current, carryForward, manualAdjustment, carryExpiryDates }) => (
                      <div className={styles.balanceRow} key={policy.id}>
                        <div>
                          <strong>{policy.latestVersion?.nameSnapshot ?? policy.name}</strong>
                          {pending > 0 ? <span>{formatDays(pending)} pending request</span> : <span>No pending request</span>}
                          <div className={styles.balanceBreakdown}>
                            <span>Current entitlement <b>{formatDays(current)}</b></span>
                            <span>Carry forward <b>{formatDays(carryForward)}</b></span>
                            {manualAdjustment !== 0 ? <span>Manual adjustments <b>{formatDays(manualAdjustment)}</b></span> : null}
                            {carryExpiryDates.length ? <span>Carry expires <b>{carryExpiryDates.map(formatDate).join(", ")}</b></span> : null}
                          </div>
                        </div>
                        <div className={styles.balanceAmount}>
                          <strong>{formatBalance(available)}</strong>
                          <span>Available</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <form action={updateLeaveBalanceAction} className={styles.balanceForm}>
                    <input type="hidden" name="membershipId" value={selectedBalanceEmployee.id} />
                    <input type="hidden" name="sourceKey" value={randomUUID()} />
                    <input type="hidden" name="year" value={year} />
                    <label>
                      Leave type
                      <select name="policyId" required>
                        {trackedPolicies.map((policy) => (
                          <option key={policy.id} value={policy.id}>{policy.latestVersion?.nameSnapshot ?? policy.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Days
                      <input name="days" type="number" min="0.5" max="366" step="0.5" placeholder="For example, 1 or 0.5" required />
                    </label>
                    <label className={styles.full}>
                      Reason for correction
                      <input name="reason" required minLength={3} maxLength={500} placeholder="For example, opening balance correction" />
                    </label>
                    <div className={`${styles.balanceActions} ${styles.full}`}>
                      <button name="direction" value="ADD" type="submit">Add days</button>
                      <button className={styles.deductButton} name="direction" value="DEDUCT" type="submit">Deduct days</button>
                    </div>
                  </form>
                  <p className={styles.policyNote}>Every correction is recorded separately. Re-running entitlement generation will not duplicate this adjustment.</p>
                </>
              ) : <p className={styles.empty}>Create a balance-tracked leave type before managing employee balances.</p>}
            </article>
          ) : null}
        </div>

        {canEditPolicy && data.policies.length && params.manage === "policy" ? (
          <details className={styles.adminCard} open>
            <summary>
              <span>{selectedPolicyVersion?.nameSnapshot ?? selectedPolicy?.name ?? "Company policy"}</span>
              <small>Current policy · select Save changes only when a future rule should change</small>
            </summary>
            <nav className={styles.policySelector} aria-label="Select company policy">
              {data.policies.map((policy) => (
                <Link key={policy.id} className={policy.id === selectedPolicy?.id ? styles.policySelectorActive : undefined} href={`/team/leave?year=${year}&manage=policy&policyId=${policy.id}`}>
                  {policy.latestVersion?.nameSnapshot ?? policy.name}
                </Link>
              ))}
            </nav>
            <div className={styles.policySnapshot}>
              <span><b>{selectedPolicyVersion?.balanceTracked ? formatDays(selectedPolicyVersion.defaultEntitlementDays ?? 0) : "No balance limit"}</b>Allowance</span>
              <span><b>{payTreatmentLabel(selectedPolicyVersion?.payTreatment ?? selectedPolicy?.payTreatment ?? "UNPAID")}</b>Payment</span>
              <span><b>{selectedPolicyVersion?.requiresDocument ? "Required" : "Not required"}</b>Supporting document</span>
              <span><b>{selectedPolicyVersion?.carryForwardEnabled ? "Enabled" : "Off"}</b>Carry forward</span>
            </div>
            {selectedPolicy && selectedPolicyVersion ? (
              <LeavePolicyEditor
                earliestEffectiveDate={earliestPolicyEffectiveDate}
                value={{
                  id: selectedPolicy.id,
                  name: selectedPolicyVersion.nameSnapshot,
                  payTreatment: selectedPolicyVersion.payTreatment,
                  countMode: selectedPolicyVersion.countMode,
                  balanceTracked: selectedPolicyVersion.balanceTracked,
                  defaultEntitlementDays: selectedPolicyVersion.defaultEntitlementDays,
                  underTwoYearsDays: selectedPolicyVersion.underTwoYearsDays,
                  twoToFiveYearsDays: selectedPolicyVersion.twoToFiveYearsDays,
                  fiveYearsPlusDays: selectedPolicyVersion.fiveYearsPlusDays,
                  requiresDocument: selectedPolicyVersion.requiresDocument,
                  allowNegativeBalance: selectedPolicyVersion.allowNegativeBalance,
                  statutoryCategory: selectedPolicyVersion.statutoryCategory,
                  entitlementPeriodType: selectedPolicyVersion.entitlementPeriodType,
                  customYearStartMonth: selectedPolicyVersion.customYearStartMonth,
                  customYearStartDay: selectedPolicyVersion.customYearStartDay,
                  prorationMethod: selectedPolicyVersion.prorationMethod,
                  entitlementRounding: selectedPolicyVersion.entitlementRounding,
                  eligibleEmploymentTypes: selectedPolicyVersion.eligibleEmploymentTypes,
                  carryForwardEnabled: selectedPolicyVersion.carryForwardEnabled,
                  carryForwardLimitUnits: selectedPolicyVersion.carryForwardLimitUnits === null ? null : Number(selectedPolicyVersion.carryForwardLimitUnits),
                  carryForwardExpiryRule: selectedPolicyVersion.carryForwardExpiryRule,
                  carryForwardExpiryValue: selectedPolicyVersion.carryForwardExpiryValue,
                  consumptionPriority: selectedPolicyVersion.consumptionPriority,
                }}
              />
            ) : null}
          </details>
        ) : null}
      </section>
      </div>
      ) : null}

      {canEditPolicy && params.newLeaveType === "1" ? (
        <div className={styles.modalBackdrop}>
          <section className={styles.leaveTypeModal} role="dialog" aria-modal="true" aria-labelledby="new-leave-type-title">
            <header className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Leave settings</p>
                <h2 id="new-leave-type-title">Create leave type</h2>
                <p>Add a company leave category, then assign its balance to employees when needed.</p>
              </div>
              <Link className={styles.modalClose} href={`/team/leave?year=${year}&manage=types`} aria-label="Close">{"\u00d7"}</Link>
            </header>

            <LeaveTypeCreateForm year={year} existingNames={data.policies.map((policy) => policy.latestVersion?.nameSnapshot ?? policy.name)} />
          </section>
        </div>
      ) : null}
    </div>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((value) => value[0]).join("").slice(0, 2).toUpperCase();
}

function formatBalance(value: number | null) {
  return value === null ? "Not tracked" : formatDays(value);
}

function leaveNoticeMessage(message?: string) {
  if (!message) return null;
  if (message.includes("LEAVE_POLICY_NOT_READY")) {
    return "This leave type has no active policy yet. Open Company policies and add an effective policy before changing balances.";
  }
  return message;
}

function formatDays(value: number) {
  const formatted = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} ${value === 1 ? "day" : "days"}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function statusLabel(status: string) {
  return ({ PENDING: "Pending review", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled" } as Record<string, string>)[status] ?? status;
}

function evidenceStatusLabel(status: string) {
  return ({ NOT_REVIEWED: "Not reviewed", VERIFIED: "Verified", REJECTED: "Rejected", REVIEW_REQUIRED: "Follow-up needed" } as Record<string, string>)[status] ?? status.replaceAll("_", " ").toLowerCase();
}

function documentTypeLabel(type: string) {
  return ({
    MEDICAL_CERTIFICATE: "Medical certificate",
    HOSPITALISATION_SUPPORT: "Hospitalisation support",
    MATERNITY_SUPPORT: "Maternity support",
    PATERNITY_SUPPORT: "Paternity support",
    SUPPORTING_DOCUMENT: "Supporting document",
    OTHER: "Other evidence",
  } as Record<string, string>)[type] ?? type.replaceAll("_", " ").toLowerCase();
}

function formatDocumentSize(bytes: number | null) {
  if (!bytes) return "Reference only";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function payTreatmentLabel(value: string) {
  return value === "PAID" ? "Paid leave" : value === "UNPAID" ? "Unpaid leave" : value.replaceAll("_", " ");
}

function leaveUnitLabel(value: string) {
  return ({ FULL_DAY: "Full day", HALF_DAY_AM: "Morning half day", HALF_DAY_PM: "Afternoon half day" } as Record<string, string>)[value] ?? value.replaceAll("_", " ").toLowerCase();
}

function ruleSetStatusLabel(value: string) {
  return ({
    DRAFT: "Draft",
    READY_FOR_REVIEW: "Ready for independent review",
    READY_FOR_HUMAN_SIGN_OFF: "Ready for human sign-off",
    ACTIVE: "Active",
    SUPERSEDED: "Superseded",
  } as Record<string, string>)[value] ?? value.replaceAll("_", " ").toLowerCase();
}

function statutoryCategoryLabel(value: string) {
  return ({
    ANNUAL_LEAVE: "Annual leave",
    SICK_LEAVE: "Sick leave",
    MEDICAL_LEAVE: "Medical leave",
    HOSPITALISATION_LEAVE: "Hospitalisation leave",
    MATERNITY_LEAVE: "Maternity leave",
    PATERNITY_LEAVE: "Paternity leave",
    UNPAID_LEAVE: "Unpaid leave",
  } as Record<string, string>)[value] ?? value.replaceAll("_", " ").toLowerCase();
}

function entitlementPeriodLabel(value: string) {
  return ({ CALENDAR_YEAR: "Calendar year", SERVICE_ANNIVERSARY: "Service anniversary", CUSTOM_YEAR: "Custom year" } as Record<string, string>)[value] ?? value;
}

function prorationLabel(value: string) {
  return ({ NONE: "No proration", CALENDAR_DAY_RATIO: "Calendar-day proration", COMPLETED_MONTHS: "Completed-month proration" } as Record<string, string>)[value] ?? value;
}

function serviceTierLabel(minimum: number, maximum: number | null) {
  if (maximum === null) return `${minimum}+ service months`;
  return `${minimum}–${maximum} service months`;
}
