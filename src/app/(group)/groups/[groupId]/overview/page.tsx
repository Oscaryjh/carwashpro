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
import { buildGroupStorePerformanceReportHref } from "@/lib/business-groups/group-report-navigation";
import { getBusinessGroupNavItems } from "@/lib/business-groups/navigation";
import {
  hasGroupStoreActivity,
  rankGroupStorePerformance,
} from "@/lib/business-groups/group-store-performance";
import { getBusinessIndustryLabel } from "@/lib/business-industry";
import { formatDateValue } from "@/lib/business-time";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";
import { getAuthorizedGroupPerformanceSpending } from "@/lib/business-performance/read-model";

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
  if (!(await isBusinessModuleEnabled(user.activeBusinessId, "BUSINESS_GROUP"))) {
    redirect("/module-not-enabled?module=BUSINESS_GROUP");
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
  const groupSpending = report
    ? await getAuthorizedGroupPerformanceSpending({
        businesses: report.businesses.map((business) => ({
          businessId: business.businessId,
          from: business.currentRange.fromDateValue,
          to: business.currentRange.toDateValue,
        })),
      })
    : null;
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
            {groupSpending ? (
              <section className="group-command-section" aria-labelledby="group-spending-heading">
                <div className="section-header">
                  <div>
                    <h2 id="group-spending-heading">Recorded Business Spending</h2>
                    <p>Canonical materialized Expense facts for authorized stores only. Outstanding AP is not added again.</p>
                  </div>
                  <span className="group-report-currency">
                    {groupSpending.completeCoverage ? "Complete coverage" : "Partial coverage"}
                  </span>
                </div>
                <div className="dashboard-kpis">
                  <div className="dashboard-kpi-card"><span>Known Group Spending</span><strong>RM {groupSpending.knownTotal}</strong></div>
                  <div className="dashboard-kpi-card"><span>Metric Coverage</span><strong>{groupSpending.completeCoverage ? "Included" : "Mixed modules"}</strong><small>Missing data is not treated as zero</small></div>
                </div>
                <div className="performance-table-wrap"><table><thead><tr><th>Business / Store</th><th>Recorded Spending</th><th>Coverage</th></tr></thead><tbody>{report.businesses.map((business) => { const spending = groupSpending.rows.find((row) => row.businessId === business.businessId); return <tr key={business.businessId}><td>{business.businessName}</td><td>{spending?.available ? `RM ${spending.recorded}` : "Not available"}</td><td>{spending?.available ? "Included" : "Expense module not enabled"}</td></tr>; })}</tbody></table></div>
                <p className="performance-coverage-note">Group totals include only businesses in the current authorised reporting scope. This operational view is not accounting profit.</p>
              </section>
            ) : null}
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
