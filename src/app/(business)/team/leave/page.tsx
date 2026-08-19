import { randomUUID } from "node:crypto";
import Link from "next/link";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { getManagerLeaveDashboard } from "@/lib/leave/service";
import { getStatutoryRuleSetOverview } from "@/lib/leave/statutory-service";
import {
  cancelApprovedLeaveAction,
  createLeavePolicyAction,
  createLeavePolicyVersionAction,
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
import styles from "./leave.module.css";

type Props = {
  searchParams: Promise<{
    year?: string;
    employee?: string;
    branch?: string;
    status?: string;
    policy?: string;
    date?: string;
    balanceEmployee?: string;
    type?: string;
    message?: string;
    newLeaveType?: string;
    manage?: "balances" | "types" | "entitlements" | "policy";
  }>;
};

const REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

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
  const employeeQuery = params.employee?.trim().toLowerCase();
  const filteredRequests = data.requests.filter((request) => (
    (!employeeQuery
      || request.employee.fullName.toLowerCase().includes(employeeQuery)
      || request.employee.employeeCode.toLowerCase().includes(employeeQuery))
    && (!params.branch || request.branch.id === params.branch)
    && (!params.status || request.status === params.status)
    && (!params.policy || request.policyId === params.policy)
    && (!params.date || (request.startsOn <= params.date && request.endsOn >= params.date))
  ));
  const branches = [...new Map(data.requests.map((request) => [request.branch.id, request.branch])).values()];
  const hasActiveFilters = Boolean(params.employee || params.branch || params.status || params.policy || params.date);
  const trackedPolicies = data.policies.filter((policy) => policy.latestVersion?.balanceTracked);
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
            <Link className={styles.manageButton} href={`/team/leave?year=${year}&manage=${canAdjust ? "balances" : "types"}`}>
              Manage leave
            </Link>
          ) : null}
        </div>
      </header>

      {params.message ? (
        <div className={params.type === "error" ? styles.error : styles.success} role="status">
          {params.message}
        </div>
      ) : null}

      <section className={styles.summary} aria-label="Leave overview">
        <article className={data.summary.pending > 0 ? styles.summaryAttention : undefined}>
          <span>Waiting for review</span>
          <strong>{data.summary.pending}</strong>
          <small>Requests requiring a decision</small>
        </article>
        <article>
          <span>Approved in {year}</span>
          <strong>{data.summary.approved}</strong>
          <small>Approved leave applications</small>
        </article>
        <article>
          <span>Employees</span>
          <strong>{data.summary.employees}</strong>
          <small>Active employees in scope</small>
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
            <h2>Leave requests</h2>
            <p>Review the employee, dates, balance impact and supporting evidence before deciding.</p>
          </div>
          <span>{filteredRequests.length} shown</span>
        </div>

        <details className={styles.filters} open={hasActiveFilters}>
          <summary>
            <span>{hasActiveFilters ? "Filters applied" : "Filter requests"}</span>
            <small>{hasActiveFilters ? "Change or clear this view" : "Search by employee, status, leave type or date"}</small>
          </summary>
          <form className={styles.filterForm}>
            <input type="hidden" name="year" value={year} />
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
              Status
              <select name="status" defaultValue={params.status ?? ""}>
                <option value="">All statuses</option>
                {REQUEST_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
              </select>
            </label>
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
              {hasActiveFilters ? <Link href={`/team/leave?year=${year}`}>Clear filters</Link> : null}
              <button type="submit">Apply filters</button>
            </div>
          </form>
        </details>

        <div className={styles.requestList}>
          {filteredRequests.length === 0 ? (
            <div className={styles.emptyState}>
              <div aria-hidden="true">✓</div>
              <h3>{hasActiveFilters ? "No matching requests" : "No leave requests to show"}</h3>
              <p>{hasActiveFilters ? "Try clearing one or more filters." : "New employee requests will appear here for review."}</p>
            </div>
          ) : filteredRequests.map((request) => (
            <article className={styles.request} key={request.id}>
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
                  <p className={styles.reason}>{request.reason}</p>
                  <div className={styles.requestFacts}>
                    <span>{payTreatmentLabel(request.payTreatment)}</span>
                    <span>Balance: {formatBalance(request.currentBalance)}</span>
                    <span>After decision: {formatBalance(request.resultingBalance)}</span>
                    {request.supportingEvidenceRequired ? <span>Evidence required</span> : null}
                    {request.supportingDocuments.length > 0 ? <span>{request.supportingDocuments.length} supporting {request.supportingDocuments.length === 1 ? "document" : "documents"}</span> : null}
                  </div>
                </div>
              </div>
              <div className={styles.requestSide}>
                <span className={`${styles.badge} ${styles[request.status.toLowerCase()]}`}>{statusLabel(request.status)}</span>
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
            </article>
          ))}
        </div>
      </section>

      {(canAdjust || canEditPolicy) ? (
        <section className={styles.leaveTools} aria-label="Leave administration">
          <div className={styles.leaveToolsIntro}>
            <p className={styles.eyebrow}>Leave administration</p>
            <h2>Open only what you need</h2>
            <p>Daily approvals stay above. Balances, leave types and legal rules are kept in focused workspaces.</p>
          </div>
          <nav className={styles.leaveToolGrid} aria-label="Leave management tools">
            {canAdjust ? (
              <Link className={params.manage === "balances" ? styles.leaveToolActive : styles.leaveTool} href={`/team/leave?year=${year}&manage=balances`}>
                <span className={styles.leaveToolIcon} aria-hidden="true">B</span>
                <span><strong>Employee balances</strong><small>Add, deduct and review available days</small></span>
              </Link>
            ) : null}
            {canEditPolicy ? (
              <>
                <Link className={params.manage === "types" ? styles.leaveToolActive : styles.leaveTool} href={`/team/leave?year=${year}&manage=types`}>
                  <span className={styles.leaveToolIcon} aria-hidden="true">T</span>
                  <span><strong>Leave types</strong><small>Manage the categories employees can request</small></span>
                </Link>
                <Link className={params.manage === "entitlements" ? styles.leaveToolActive : styles.leaveTool} href={`/team/leave?year=${year}&manage=entitlements`}>
                  <span className={styles.leaveToolIcon} aria-hidden="true">E</span>
                  <span><strong>Entitlements</strong><small>Run annual and statutory entitlement controls</small></span>
                </Link>
                <Link className={params.manage === "policy" ? styles.leaveToolActive : styles.leaveTool} href={`/team/leave?year=${year}&manage=policy`}>
                  <span className={styles.leaveToolIcon} aria-hidden="true">P</span>
                  <span><strong>Policy rules</strong><small>Create a future policy version</small></span>
                </Link>
              </>
            ) : null}
          </nav>
        </section>
      ) : null}

      {canEditPolicy && statutoryOverview && params.manage === "entitlements" ? (
        <section className={styles.entitlementWorkspace}>
          <div className={styles.managementHeader}>
            <div>
              <p className={styles.eyebrow}>Entitlement controls</p>
              <h2>Statutory minimums and annual entitlements</h2>
            </div>
            <p>Legal values are never guessed. A sourced rule pack must be independently reviewed before company policies can use it.</p>
          </div>

          <div className={styles.entitlementToolbar}>
            <div>
              <strong>{year} entitlement run</strong>
              <span>Creates missing immutable entitlement and ledger records only. Existing records are left unchanged.</span>
            </div>
            <form action={generateLeaveEntitlementsAction}>
              <input type="hidden" name="year" value={year} />
              <button type="submit">Generate missing entitlements</button>
            </form>
          </div>

          <div className={styles.entitlementToolbar}>
            <div>
              <strong>Carry-forward lifecycle</strong>
              <span>Runs due period rollovers and expires only unused carry-forward days. Safe to run again.</span>
            </div>
            <form action={processLeaveLifecycleAction}>
              <input type="hidden" name="year" value={year} />
              <input type="hidden" name="asOf" value={new Date().toISOString().slice(0, 10)} />
              <button type="submit">Process due leave</button>
            </form>
          </div>

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
      ) : null}

      {(params.manage === "balances" || params.manage === "types" || params.manage === "policy") ? (
      <section className={styles.management}>
        <div className={styles.managementHeader}>
          <div>
            <p className={styles.eyebrow}>Leave settings</p>
            <h2>{params.manage === "balances" ? "Employee balances" : params.manage === "types" ? "Leave types" : "Policy rules"}</h2>
          </div>
          <Link className={styles.closeWorkspace} href={`/team/leave?year=${year}`}>Close workspace</Link>
        </div>

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
                      <span>Revision {version?.revision ?? "not ready"}</span>
                    </div>
                    <div>
                      <b>{payTreatmentLabel(version?.payTreatment ?? policy.payTreatment)}</b>
                      <small>{legalStatusLabel(version?.legalStatus)}</small>
                    </div>
                  </div>
                );
              })}
            </div>
            {data.policies.length ? <p className={styles.policyNote}>Policy versions remain traceable; changing a policy does not rewrite past leave decisions.</p> : null}
          </article>
          ) : null}

          {canAdjust && params.manage === "balances" ? (
            <article className={styles.balanceManager}>
              <div className={styles.cardHeading}>
                <div>
                  <h3>Employee leave balances</h3>
                  <p>Add or deduct days for one employee at a time</p>
                </div>
                <span className={styles.auditBadge}>Audited</span>
              </div>

              {trackedPolicies.length && selectedBalanceEmployee ? (
                <>
                  <form className={styles.balancePicker}>
                    <input type="hidden" name="year" value={year} />
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
                      Reason
                      <input name="reason" required minLength={3} maxLength={500} placeholder="Why is this employee's balance changing?" />
                    </label>
                    <div className={`${styles.balanceActions} ${styles.full}`}>
                      <button name="direction" value="ADD" type="submit">+ Add leave</button>
                      <button className={styles.deductButton} name="direction" value="DEDUCT" type="submit">− Deduct leave</button>
                    </div>
                  </form>
                  <p className={styles.policyNote}>Every change creates a permanent ledger and audit record. Existing leave history is never overwritten.</p>
                </>
              ) : <p className={styles.empty}>Create a balance-tracked leave type before managing employee balances.</p>}
            </article>
          ) : null}
        </div>

        {canEditPolicy && data.policies.length && params.manage === "policy" ? (
          <details className={styles.adminCard} open>
            <summary>
              <span>Create a new policy version</span>
              <small>Change future leave rules without rewriting historical records</small>
            </summary>
            <form action={createLeavePolicyVersionAction} className={styles.balanceForm}>
              <label>
                Leave type
                <select name="policyId" required>{data.policies.map((policy) => <option key={policy.id} value={policy.id}>{policy.name}</option>)}</select>
              </label>
              <label>
                Effective from
                <input name="effectiveFrom" type="date" required defaultValue={`${year}-01-01`} />
              </label>
              <label>
                Display name
                <input name="name" required minLength={2} maxLength={120} />
              </label>
              <label>
                Pay treatment
                <select name="payTreatment"><option value="PAID">Paid company benefit</option><option value="UNPAID">Unpaid leave</option></select>
              </label>
              <label>
                Count leave using
                <select name="countMode"><option value="WEEKDAYS">Expected workdays only</option><option value="CALENDAR_DAYS">Calendar days</option></select>
              </label>
              <label>
                Default entitlement (days)
                <input name="defaultEntitlementDays" type="number" min="0" max="366" step="0.5" />
              </label>
              <label>
                Under 2 years (days)
                <input name="underTwoYearsDays" type="number" min="0" max="366" step="0.5" />
              </label>
              <label>
                2 to under 5 years (days)
                <input name="twoToFiveYearsDays" type="number" min="0" max="366" step="0.5" />
              </label>
              <label>
                5+ years (days)
                <input name="fiveYearsPlusDays" type="number" min="0" max="366" step="0.5" />
              </label>
              <label>
                Statutory minimum mapping
                <select name="statutoryCategory" defaultValue="">
                  <option value="">Company benefit only</option>
                  <option value="ANNUAL_LEAVE">Annual leave</option>
                  <option value="MEDICAL_LEAVE">Medical leave</option>
                  <option value="HOSPITALISATION_LEAVE">Hospitalisation leave</option>
                  <option value="MATERNITY_LEAVE">Maternity leave</option>
                  <option value="PATERNITY_LEAVE">Paternity leave</option>
                </select>
              </label>
              <label>
                Entitlement period
                <select name="entitlementPeriodType" defaultValue="CALENDAR_YEAR">
                  <option value="CALENDAR_YEAR">Calendar year</option>
                  <option value="SERVICE_ANNIVERSARY">Service anniversary</option>
                  <option value="CUSTOM_YEAR">Custom year</option>
                </select>
              </label>
              <label>
                Join / termination proration
                <select name="prorationMethod" defaultValue="NONE">
                  <option value="NONE">No proration</option>
                  <option value="CALENDAR_DAY_RATIO">Calendar-day ratio</option>
                </select>
              </label>
              <label>
                Entitlement rounding
                <select name="entitlementRounding" defaultValue="NONE">
                  <option value="NONE">No rounding</option>
                  <option value="DOWN_TO_HALF_DAY">Down to half day</option>
                  <option value="NEAREST_HALF_DAY">Nearest half day</option>
                  <option value="UP_TO_HALF_DAY">Up to half day</option>
                </select>
              </label>
              <fieldset className={styles.full}>
                <legend>Eligible employment types</legend>
                <label><input name="eligibleEmploymentTypes" type="checkbox" value="FULL_TIME" defaultChecked /> Full time</label>
                <label><input name="eligibleEmploymentTypes" type="checkbox" value="PART_TIME" /> Part time</label>
                <label><input name="eligibleEmploymentTypes" type="checkbox" value="CONTRACT" /> Contract</label>
              </fieldset>
              <div className={`${styles.optionGroup} ${styles.full}`}>
                <label><input name="balanceTracked" type="checkbox" /> Track employee balance</label>
                <label><input name="requiresDocument" type="checkbox" /> Require supporting document</label>
                <label><input name="allowNegativeBalance" type="checkbox" /> Allow negative balance</label>
                <label><input name="carryForwardEnabled" type="checkbox" /> Carry unused days forward</label>
              </div>
              <label>
                Carry-forward limit (days)
                <input name="carryForwardLimitUnits" type="number" min="0" max="366" step="0.5" placeholder="No limit" />
              </label>
              <label>
                Carry-forward expiry
                <select name="carryForwardExpiryRule" defaultValue="NO_EXPIRY">
                  <option value="NO_EXPIRY">No expiry</option>
                  <option value="DAYS_AFTER_ROLLOVER">Days after rollover</option>
                  <option value="MONTHS_AFTER_ROLLOVER">Months after rollover</option>
                  <option value="FIXED_DATE_IN_DESTINATION_PERIOD">Fixed date in new period</option>
                </select>
              </label>
              <label>
                Expiry value
                <input name="carryForwardExpiryValue" placeholder="For example 90, 3, or 03-31" />
              </label>
              <label>
                Days used first
                <select name="consumptionPriority" defaultValue="EARLIEST_EXPIRY_FIRST">
                  <option value="EARLIEST_EXPIRY_FIRST">Earliest expiry first</option>
                  <option value="OLDEST_ENTITLEMENT_FIRST">Oldest entitlement first</option>
                </select>
              </label>
              <label className={styles.full}>
                Change reason
                <input name="reason" required minLength={3} maxLength={500} placeholder="Why is this company policy changing?" />
              </label>
              <button className={styles.full} type="submit">Save new policy version</button>
            </form>
          </details>
        ) : null}
      </section>
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
              <Link className={styles.modalClose} href={`/team/leave?year=${year}`} aria-label="Close">{"\u00d7"}</Link>
            </header>

            <form action={createLeavePolicyAction} className={styles.leaveTypeForm}>
              <input type="hidden" name="year" value={year} />
              <label className={styles.full}>
                Leave type name
                <input name="name" required minLength={2} maxLength={120} placeholder="For example, Vacation leave or Study leave" autoFocus />
              </label>
              <label>
                Paid or unpaid
                <select name="payTreatment" defaultValue="PAID">
                  <option value="PAID">Paid leave</option>
                  <option value="UNPAID">Unpaid leave</option>
                </select>
              </label>
              <label>
                Count leave by
                <select name="countMode" defaultValue="WEEKDAYS">
                  <option value="WEEKDAYS">Scheduled workdays</option>
                  <option value="CALENDAR_DAYS">Calendar days</option>
                </select>
              </label>
              <label>
                Default days per year
                <input name="defaultEntitlementDays" type="number" min="0" max="366" step="0.5" placeholder="For example, 8" />
                <small>You can still add or deduct days for each employee later.</small>
              </label>
              <label>
                Effective from
                <input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
              </label>
              <div className={`${styles.leaveTypeOptions} ${styles.full}`}>
                <label>
                  <input name="balanceTracked" type="checkbox" />
                  <span><strong>Track employee balance</strong><small>Show remaining days and allow individual adjustments.</small></span>
                </label>
                <label>
                  <input name="requiresDocument" type="checkbox" />
                  <span><strong>Require supporting document</strong><small>Use for leave such as medical or study leave.</small></span>
                </label>
                <label>
                  <input name="allowNegativeBalance" type="checkbox" />
                  <span><strong>Allow negative balance</strong><small>Employees may request more than their available days.</small></span>
                </label>
              </div>
              <label className={styles.full}>
                Setup note <small>(optional)</small>
                <input name="reason" minLength={3} maxLength={500} placeholder="Why this leave type is being added" />
              </label>
              <footer className={`${styles.modalActions} ${styles.full}`}>
                <Link href={`/team/leave?year=${year}`}>Cancel</Link>
                <button type="submit">Create leave type</button>
              </footer>
            </form>
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

function legalStatusLabel(value?: string | null) {
  if (!value) return "Policy setup incomplete";
  if (value === "VERIFIED") return "Verified policy";
  return value.replaceAll("_", " ").toLowerCase();
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
