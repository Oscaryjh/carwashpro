import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShellFrame } from "@/components/app-shell-frame";
import { BusinessContextDrilldownButton } from "@/components/business-context-drilldown-button";
import { BusinessContextSwitcher } from "@/components/business-context-switcher";
import { GroupLogoUpload } from "@/components/group-logo-upload";
import {
  GroupLongTermTrendFallback,
  GroupLongTermTrendSection,
} from "@/components/group-long-term-trend-section";
import { GroupPageHero } from "@/components/group-page-hero";
import { createBusinessContextToken } from "@/lib/auth/business-context-token";
import { requireUser } from "@/lib/auth/session";
import { getAvailableGroupReportingContexts } from "@/lib/business-groups/all-stores-access";
import {
  AllStoresKpiRangeError,
  getAllStoresKpiReport,
  type AllStoresKpi,
  type AllStoresKpiComparison,
  type AllStoresKpiWithComparisons,
} from "@/lib/business-groups/all-stores-kpi";
import { getAvailableBusinessContexts } from "@/lib/business-groups/business-context";
import {
  getGroupDataConfidenceReport,
  type GroupDataConfidenceReport,
} from "@/lib/business-groups/group-data-confidence";
import { buildGroupStorePerformanceReportHref } from "@/lib/business-groups/group-report-navigation";
import { getBusinessGroupNavItems } from "@/lib/business-groups/navigation";
import {
  hasGroupStoreActivity,
  rankGroupStorePerformance,
} from "@/lib/business-groups/group-store-performance";
import { getBusinessIndustryLabel } from "@/lib/business-industry";
import { formatDateValue } from "@/lib/business-time";

export default async function GroupOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    trend?: string;
  }>;
}) {
  const user = await requireUser();
  if (user.role === "PLATFORM_ADMIN") {
    notFound();
  }
  if (!user.activeBusinessId) {
    redirect("/business-context/recover");
  }

  const { groupId } = await params;
  const query = await searchParams;
  const [groups, businessContexts] = await Promise.all([
    getAvailableGroupReportingContexts(user.userId, user.activeBusinessId),
    getAvailableBusinessContexts(user.userId, user.activeBusinessId),
  ]);
  const selectedGroup = groups.find((group) => group.groupId === groupId);
  if (!selectedGroup || !selectedGroup.canViewAllStores) {
    notFound();
  }

  const now = new Date();
  const resolveScope = async (
    requestedUserId: string,
    requestedGroupId: string,
    requestedBusinessId: string | null,
  ) =>
    requestedUserId === user.userId &&
    requestedGroupId === groupId &&
    requestedBusinessId === user.activeBusinessId
      ? selectedGroup
      : null;

  let report = null;
  let rangeError: string | null = null;
  let queryFailed = false;
  const reportInput = {
    userId: user.userId,
    groupId,
    activeBusinessId: user.activeBusinessId,
    range: query.range,
    from: query.from,
    to: query.to,
  };
  const reportLoad = getAllStoresKpiReport(
    reportInput,
    undefined,
    {
      now,
      resolveScope,
    },
  );
  const confidenceLoad = getGroupDataConfidenceReport(
    reportInput,
    undefined,
    {
      kpiReport: reportLoad,
      now,
      resolveScope,
    },
  )
    .then((confidence) => ({ confidence, failed: false }))
    .catch((error: unknown) => {
      if (!(error instanceof AllStoresKpiRangeError)) {
        console.error(
          "[group-data-confidence] Unable to reconcile group report.",
        );
      }
      return {
        confidence: null,
        failed: true,
      } satisfies DataConfidenceLoadResult;
    });
  try {
    report = await reportLoad;
  } catch (error) {
    if (error instanceof AllStoresKpiRangeError) {
      rangeError = error.message;
    } else {
      console.error("[all-stores-kpi] Unable to load group report.");
      queryFailed = true;
    }
  }
  if (!report && !rangeError && !queryFailed) {
    notFound();
  }

  const contextToken = await createBusinessContextToken({
    userId: user.userId,
    businessId: user.activeBusinessId,
    contextVersion: user.contextVersion,
  });
  const navItems = getBusinessGroupNavItems(selectedGroup.groupId);
  const rankedStores = report
    ? rankGroupStorePerformance(report.businesses)
    : [];
  const currentBusinessIds = new Set(
    selectedGroup.businesses.map((business) => business.id),
  );

  return (
    <AppShellFrame
      brandName={selectedGroup.groupName}
      brandLogoControl={
        <GroupLogoUpload
          canEdit={selectedGroup.role === "GROUP_OWNER"}
          currentLogoUrl={selectedGroup.groupLogoUrl}
          groupId={selectedGroup.groupId}
          groupName={selectedGroup.groupName}
        />
      }
      homeHref={`/groups/${selectedGroup.groupId}/overview`}
      navItems={navItems}
      businessSwitcher={
        <BusinessContextSwitcher
          groups={groups}
          homeBusiness={
            businessContexts.businesses.find((business) => business.isHome) ??
            null
          }
          contextToken={contextToken}
          selectedGroupId={selectedGroup.groupId}
        />
      }
    >
      <div className="content group-overview-page group-command-page">
        <GroupPageHero
          action={
            <Link
              className="secondary-button"
              href={`/groups/${groupId}/reports?range=today`}
            >
              Explore group reports
              <span aria-hidden="true">→</span>
            </Link>
          }
          description={
            <>
              A live executive view of performance across every store in{" "}
              <strong>{selectedGroup.groupName}</strong>.
            </>
          }
          meta={[
            `${selectedGroup.businesses.length} active stores`,
            selectedGroup.role === "GROUP_OWNER"
              ? "Group Owner"
              : "Group Manager",
            "MYR reporting",
          ]}
          title="All Stores"
          variant="overview"
        />

        <section className="group-overview-intro">
          <div>
            <h2>Group overview</h2>
            <p>
              Read-only financial performance across your authorized stores.
            </p>
          </div>
          <span>
            {selectedGroup.role === "GROUP_OWNER"
              ? "Group Owner"
              : "Group Manager"}
          </span>
        </section>

        <section
          className="group-report-controls"
          aria-labelledby="report-range-heading"
        >
          <div>
            <h2 id="report-range-heading">Performance period</h2>
            <p>Each store uses its own timezone and business-day cutoff.</p>
          </div>
          <nav aria-label="Report range">
            {[
              ["today", "Today"],
              ["7days", "7 days"],
              ["month", "This month"],
            ].map(([value, label]) => (
              <Link
                aria-current={
                  (report?.range ?? query.range ?? "today") === value
                    ? "page"
                    : undefined
                }
                href={buildOverviewRangeHref(
                  groupId,
                  value,
                  query.trend,
                )}
                key={value}
              >
                {label}
              </Link>
            ))}
          </nav>
          <form method="get">
            <input name="range" type="hidden" value="custom" />
            <input
              name="trend"
              type="hidden"
              value={query.trend ?? "month"}
            />
            <label>
              From
              <input
                defaultValue={query.from ?? ""}
                name="from"
                required
                type="date"
              />
            </label>
            <label>
              To
              <input
                defaultValue={query.to ?? ""}
                name="to"
                required
                type="date"
              />
            </label>
            <button type="submit">Apply</button>
          </form>
          {rangeError ? (
            <p className="form-error" role="alert">
              {rangeError}
            </p>
          ) : null}
        </section>

        {queryFailed ? (
          <section className="group-report-state" role="alert">
            <h2>Group performance is unavailable</h2>
            <p>No partial totals are shown. Refresh the page to try again.</p>
          </section>
        ) : report ? (
          <>
            <section
              aria-labelledby="group-performance-heading"
              className="group-command-section"
            >
              <div className="section-header">
                <div>
                  <h2 id="group-performance-heading">Group performance</h2>
                  <p>
                    {getRangeLabel(
                      report.range,
                      report.customFrom,
                      report.customTo,
                    )}
                    {" · "}
                    {getComparisonPeriodLabel(report.range)}
                  </p>
                </div>
                <span className="group-report-currency">
                  MYR · {report.authorizedBusinessCount} stores
                </span>
              </div>
              <KpiGrid metrics={report.current} previous={report.previous} />
            </section>

            <Suspense
              key={`group-long-term-trend:${query.trend ?? "month"}`}
              fallback={<GroupLongTermTrendFallback />}
            >
              <GroupLongTermTrendSection
                activeBusinessId={user.activeBusinessId}
                authorizedScope={selectedGroup}
                groupId={groupId}
                preset={query.trend}
                query={query}
                userId={user.userId}
              />
            </Suspense>

            <Suspense
              key={`group-data-confidence:${report.range}:${report.customFrom ?? ""}:${report.customTo ?? ""}`}
              fallback={<DataConfidenceFallback />}
            >
              <DataConfidenceSection
                closingHref={buildClosingHref(
                  groupId,
                  report.range,
                  report.customFrom,
                  report.customTo,
                )}
                load={confidenceLoad}
              />
            </Suspense>

            <section
              aria-labelledby="store-performance-heading"
              className="group-command-section"
            >
              <div className="section-header">
                <div>
                  <h2 id="store-performance-heading">
                    Store performance ranking
                  </h2>
                  <p>
                    Ranked by net sales for the selected period. Results are
                    limited to your authorized reporting scope.
                  </p>
                </div>
                <span className="group-report-currency">
                  {rankedStores.length} ranked stores
                </span>
              </div>
              <ol className="group-store-performance-list">
                {rankedStores.map(({ business, rank }) => {
                  const storeReportHref =
                    buildGroupStorePerformanceReportHref(
                      groupId,
                      business.businessId,
                      report,
                    );
                  const periodLabel = formatBusinessRange(
                    business.currentRange.fromDateValue,
                    business.currentRange.toDateValue,
                  );
                  const hasActivity = hasGroupStoreActivity(business.current);
                  const canOpenWorkspace = currentBusinessIds.has(
                    business.businessId,
                  );

                  return (
                    <li key={business.businessId}>
                      <article
                        className="group-store-performance"
                        data-store-rank={rank}
                      >
                        <header>
                          <div className="group-store-identity">
                            {business.logoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img alt="" src={business.logoUrl} />
                            ) : (
                              <span aria-hidden="true">
                                {business.businessName
                                  .slice(0, 2)
                                  .toUpperCase()}
                              </span>
                            )}
                            <div>
                              <span className="group-store-rank">
                                #{rank} by net sales
                              </span>
                              <h3>{business.businessName}</h3>
                              <p>
                                {getBusinessIndustryLabel(
                                  business.industryType,
                                )}
                                {" · "}
                                {periodLabel}
                              </p>
                              <small>
                                {business.timezone} · cutoff{" "}
                                {business.businessDayCutoffTime}
                              </small>
                            </div>
                          </div>
                          <div className="group-store-card-actions">
                            {!hasActivity ? (
                              <span className="group-store-no-activity">
                                No activity in this period
                              </span>
                            ) : null}
                            {storeReportHref ? (
                              <Link
                                className="group-store-report-link"
                                data-store-report={business.businessId}
                                href={storeReportHref}
                              >
                                View report{" "}
                                <span aria-hidden="true">→</span>
                                <span className="sr-only">
                                  {" "}
                                  for {business.businessName}, {periodLabel}
                                </span>
                              </Link>
                            ) : null}
                            {canOpenWorkspace ? (
                              <BusinessContextDrilldownButton
                                businessId={business.businessId}
                                contextToken={contextToken}
                                label="Open store workspace"
                              />
                            ) : (
                              <span className="group-store-history-note">
                                Historical store · report only
                              </span>
                            )}
                          </div>
                        </header>
                        <KpiGrid
                          compact
                          metrics={business.current}
                          previous={business.previous}
                        />
                      </article>
                    </li>
                  );
                })}
              </ol>
            </section>
          </>
        ) : null}

      </div>
    </AppShellFrame>
  );
}

const kpiDefinitions: Array<{
  key: keyof AllStoresKpi;
  label: string;
  money: boolean;
}> = [
  { key: "grossSalesCents", label: "Gross sales", money: true },
  { key: "netSalesCents", label: "Net sales", money: true },
  {
    key: "paymentsCollectedCents",
    label: "Gross collections",
    money: true,
  },
  { key: "refundsCents", label: "Refunds", money: true },
  { key: "transactionCount", label: "Transactions", money: false },
  {
    key: "averageTransactionValueCents",
    label: "Average transaction",
    money: true,
  },
];

const confidenceStatusContent: Record<
  GroupDataConfidenceReport["status"],
  { label: string; message: string }
> = {
  MATCHED: {
    label: "Reconciled",
    message:
      "Dashboard totals match every valid Daily Closing snapshot in this period.",
  },
  MISMATCH: {
    label: "Amount mismatch",
    message:
      "All expected closings are present, but at least one frozen total differs from live analytics.",
  },
  INCOMPLETE: {
    label: "Closing incomplete",
    message:
      "One or more active branches do not have a Daily Closing snapshot for this period.",
  },
  INVALID_SNAPSHOT: {
    label: "Invalid snapshot",
    message:
      "At least one Closing snapshot cannot be validated, so reconciled totals are not trusted.",
  },
  LEGACY_DEFINITION: {
    label: "Legacy definition",
    message:
      "Closing data uses an older metric or business-day definition and needs review.",
  },
  NOT_COMPARABLE: {
    label: "Audit only",
    message:
      "Closing coverage is valid, but live totals include an open or excluded branch-date, so financial reconciliation is not claimed.",
  },
  NOT_APPLICABLE: {
    label: "Not due",
    message:
      "No fully ended business days in this period require a Closing audit yet.",
  },
};

type DataConfidenceLoadResult = {
  confidence: GroupDataConfidenceReport | null;
  failed: boolean;
};

async function DataConfidenceSection({
  closingHref,
  load,
}: {
  closingHref: string;
  load: Promise<DataConfidenceLoadResult>;
}) {
  const { confidence, failed } = await load;
  return (
    <DataConfidencePanel
      closingHref={closingHref}
      confidence={confidence}
      failed={failed}
    />
  );
}

function DataConfidenceFallback() {
  return (
    <section
      aria-busy="true"
      aria-labelledby="data-confidence-heading"
      className="group-command-section group-confidence-panel is-loading"
    >
      <div className="section-header">
        <div>
          <h2 id="data-confidence-heading">Data confidence</h2>
          <p>Checking Daily Closing snapshots against live analytics.</p>
        </div>
        <span className="group-confidence-badge">Checking</span>
      </div>
    </section>
  );
}

function DataConfidencePanel({
  confidence,
  failed,
  closingHref,
}: {
  confidence: GroupDataConfidenceReport | null;
  failed: boolean;
  closingHref: string;
}) {
  if (!confidence) {
    return (
      <section
        aria-labelledby="data-confidence-heading"
        className="group-command-section group-confidence-panel is-unavailable"
      >
        <div className="section-header">
          <div>
            <h2 id="data-confidence-heading">Data confidence</h2>
            <p>
              {failed
                ? "Reconciliation is temporarily unavailable. Financial totals remain visible but are not marked as verified."
                : "No reconciliation result is available for this period."}
            </p>
          </div>
          <span className="group-confidence-badge">Not verified</span>
        </div>
      </section>
    );
  }

  const status = confidenceStatusContent[confidence.status];
  const issueCount =
    confidence.missingClosings.length +
    confidence.invalidSnapshotCount +
    confidence.definitionIssueCount;
  return (
    <section
      aria-labelledby="data-confidence-heading"
      className={`group-command-section group-confidence-panel status-${confidence.status.toLowerCase()}`}
      data-confidence-status={confidence.status}
    >
      <div className="section-header">
        <div>
          <h2 id="data-confidence-heading">Data confidence</h2>
          <p>{status.message}</p>
        </div>
        <span className="group-confidence-badge">{status.label}</span>
      </div>

      <div className="group-confidence-summary">
        <article>
          <span>Closing coverage</span>
          <strong>
            {confidence.closingCoveragePercent === null
              ? "N/A"
              : `${confidence.closingCoveragePercent.toFixed(1)}%`}
          </strong>
          <small>
            {confidence.expectedClosingCount
              ? `${confidence.capturedClosingCount} of ${confidence.expectedClosingCount} required`
              : "No ended business days due"}
          </small>
        </article>
        <article>
          <span>Metric agreement</span>
          <strong>
            {confidence.reconciliationApplicable
              ? `${confidence.metrics.filter((metric) => metric.matches).length}/${confidence.metrics.length}`
              : "N/A"}
          </strong>
          <small>
            {confidence.reconciliationApplicable
              ? "Exact cent-level checks"
              : "Date set is not comparable"}
          </small>
        </article>
        <article>
          <span>Data issues</span>
          <strong>{issueCount}</strong>
          <small>
            {confidence.invalidSnapshotCount} invalid ·{" "}
            {confidence.definitionIssueCount} legacy
          </small>
        </article>
        <article>
          <span>Definition</span>
          <strong>v{confidence.metricDefinitionVersion}</strong>
          <small>
            Checked {formatConfidenceTime(confidence.checkedAt)}
          </small>
        </article>
      </div>

      <div className="group-confidence-detail-grid">
        <div className="group-confidence-table-wrap">
          <table className="group-confidence-table">
          {!confidence.reconciliationApplicable ? (
            <p className="group-confidence-alert">
              Open or excluded branch-dates are outside the Closing audit
              denominator. Their live totals are shown but not compared with
              snapshots.
            </p>
          ) : null}
            <thead>
              <tr>
                <th>Metric</th>
                <th>Dashboard</th>
                <th>Closing</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {confidence.metrics.map((metric) => (
                <tr
                  data-matches={
                    confidence.reconciliationApplicable
                      ? metric.matches
                      : undefined
                  }
                  key={metric.key}
                >
                  <th>{metric.label}</th>
                  <td>{formatMoney(metric.analyticsCents)}</td>
                  <td>{formatMoney(metric.closingCents)}</td>
                  <td>
                    {!confidence.reconciliationApplicable
                      ? "Not compared"
                      : metric.matches
                      ? "Matched"
                      : formatSignedMoney(metric.differenceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="group-confidence-issues">
          <h3>Closing controls</h3>
          {confidence.missingClosings.length ? (
            <>
              <p>
                {confidence.missingClosings.length} branch-date closing
                {confidence.missingClosings.length === 1 ? " is" : "s are"}{" "}
                missing.
              </p>
              <ul>
                {confidence.missingClosings.slice(0, 6).map((closing) => (
                  <li
                    key={`${closing.businessId}:${closing.branchId}:${closing.businessDate}`}
                  >
                    <strong>{closing.businessName}</strong>
                    <span>
                      {closing.branchName} · {closing.businessDate}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>Every currently expected branch-date Closing is present.</p>
          )}
          {confidence.invalidSnapshotCount ? (
            <p className="group-confidence-alert">
              {confidence.invalidSnapshotCount} snapshot
              {confidence.invalidSnapshotCount === 1 ? "" : "s"} could not be
              validated.
            </p>
          ) : null}
          {confidence.definitionIssueCount ? (
            <p className="group-confidence-alert">
              {confidence.definitionIssueCount} snapshot
              {confidence.definitionIssueCount === 1 ? "" : "s"} use legacy
              definitions.
            </p>
          ) : null}
          <Link href={closingHref}>Review Daily Closing →</Link>
        </aside>
      </div>

      <details className="group-confidence-definition">
        <summary>Metric and date definitions</summary>
        <p>
          Gross and net sales, refunds, and net collections are checked in
          integer cents. Each store uses its own timezone and cutoff. Metric
          definition v{confidence.metricDefinitionVersion}; business-day
          definition v{confidence.businessDayDefinitionVersion}.
        </p>
      </details>
    </section>
  );
}

function KpiGrid({
  metrics,
  previous,
  compact = false,
}: {
  metrics: AllStoresKpiWithComparisons;
  previous: AllStoresKpi;
  compact?: boolean;
}) {
  return (
    <div className={`group-kpi-grid${compact ? " compact" : ""}`}>
      {kpiDefinitions.map((definition) => {
        const value = metrics[definition.key];
        const previousValue = previous[definition.key];
        const comparison = metrics.comparisons[definition.key];
        return (
          <article
            className="group-kpi-card"
            data-metric={definition.key}
            key={definition.key}
          >
            <span>{definition.label}</span>
            <strong>
              {value === null
                ? "—"
                : definition.money
                  ? formatMoney(value)
                  : value.toLocaleString("en-MY")}
            </strong>
            <small>
              <Comparison comparison={comparison} />
              {" · previous "}
              {previousValue === null
                ? "—"
                : definition.money
                  ? formatMoney(previousValue)
                  : previousValue.toLocaleString("en-MY")}
            </small>
          </article>
        );
      })}
    </div>
  );
}

function Comparison({ comparison }: { comparison: AllStoresKpiComparison }) {
  if (comparison.kind === "NEW") {
    return <b className="positive">New</b>;
  }
  if (comparison.kind === "NO_CHANGE") {
    return <b>No change</b>;
  }
  if (comparison.kind === "CHANGE") {
    return (
      <b className={comparison.direction === "UP" ? "positive" : "negative"}>
        {comparison.direction === "UP" ? "Up" : "Down"}
      </b>
    );
  }
  const positive = comparison.percentage >= 0;
  return (
    <b className={positive ? "positive" : "negative"}>
      {positive ? "+" : ""}
      {comparison.percentage.toFixed(1)}%
    </b>
  );
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatSignedMoney(cents: number) {
  const prefix = cents > 0 ? "+" : "";
  return `${prefix}${formatMoney(cents)}`;
}

function formatConfidenceTime(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kuching",
  }).format(value);
}

function buildClosingHref(
  groupId: string,
  range: string,
  from: string | null,
  to: string | null,
) {
  const params = new URLSearchParams({ range });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return `/groups/${groupId}/closing?${params.toString()}`;
}

function formatBusinessRange(from: string, to: string) {
  if (from === to) {
    return formatDateValue(from, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  return `${formatDateValue(from, {
    day: "numeric",
    month: "short",
  })} – ${formatDateValue(to, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

function getRangeLabel(
  range: string,
  from: string | null,
  to: string | null,
) {
  if (range === "today") return "Today by each store's business day";
  if (range === "7days") return "Last 7 business days";
  if (range === "month") {
    return "Month to date by each store's local business calendar";
  }
  return from && to
    ? formatBusinessRange(from, to)
    : "Custom business date range";
}

function getComparisonPeriodLabel(range: string) {
  return range === "month"
    ? "Compared with the same calendar progress in the previous month"
    : "Previous period uses the same number of business days";
}

function buildOverviewRangeHref(
  groupId: string,
  range: string,
  trend: string | undefined,
) {
  const params = new URLSearchParams({
    range,
    trend: trend ?? "month",
  });
  return `/groups/${groupId}/overview?${params.toString()}`;
}
