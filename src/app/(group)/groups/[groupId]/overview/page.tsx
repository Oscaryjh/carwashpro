import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShellFrame, type NavItem } from "@/components/app-shell-frame";
import { BusinessContextDrilldownButton } from "@/components/business-context-drilldown-button";
import { BusinessContextSwitcher } from "@/components/business-context-switcher";
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
import { getBusinessIndustryLabel } from "@/lib/business-industry";
import { formatDateValue } from "@/lib/business-time";

const overviewNav: NavItem[] = [
  {
    href: "/groups",
    label: "All Stores",
    shortLabel: "All",
    icon: "businesses",
  },
];

export default async function GroupOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
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

  let report = null;
  let rangeError: string | null = null;
  let queryFailed = false;
  try {
    report = await getAllStoresKpiReport({
      userId: user.userId,
      groupId,
      activeBusinessId: user.activeBusinessId,
      range: query.range,
      from: query.from,
      to: query.to,
    });
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
  const navItems = overviewNav.map((item) => ({
    ...item,
    href: `/groups/${selectedGroup.groupId}/overview`,
  }));

  return (
    <AppShellFrame
      brandName={selectedGroup.groupName}
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
      <div className="content group-overview-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Business Group</p>
            <h1>All Stores</h1>
            <p>
              {selectedGroup.groupName} · {selectedGroup.businesses.length}{" "}
              active stores in your reporting scope
            </p>
          </div>
        </header>

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
              ["30days", "30 days"],
            ].map(([value, label]) => (
              <Link
                aria-current={
                  (report?.range ?? query.range ?? "today") === value
                    ? "page"
                    : undefined
                }
                href={`/groups/${groupId}/overview?range=${value}`}
                key={value}
              >
                {label}
              </Link>
            ))}
          </nav>
          <form method="get">
            <input name="range" type="hidden" value="custom" />
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
            <section aria-labelledby="group-performance-heading">
              <div className="section-header">
                <div>
                  <h2 id="group-performance-heading">Group performance</h2>
                  <p>
                    {getRangeLabel(
                      report.range,
                      report.customFrom,
                      report.customTo,
                    )}
                    {" · "}Previous period uses the same number of business days
                  </p>
                </div>
                <span className="group-report-currency">
                  MYR · {report.authorizedBusinessCount} stores
                </span>
              </div>
              <KpiGrid metrics={report.current} previous={report.previous} />
            </section>

            <section aria-labelledby="store-performance-heading">
              <div className="section-header">
                <div>
                  <h2 id="store-performance-heading">Store details</h2>
                  <p>
                    Results are limited to stores in your current reporting
                    scope.
                  </p>
                </div>
              </div>
              <div className="group-store-performance-list">
                {report.businesses.map((business) => (
                  <article
                    className="group-store-performance"
                    key={business.businessId}
                  >
                    <header>
                      <div className="group-store-identity">
                        {business.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt="" src={business.logoUrl} />
                        ) : (
                          <span aria-hidden="true">
                            {business.businessName.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        <div>
                          <h3>{business.businessName}</h3>
                          <p>
                            {getBusinessIndustryLabel(business.industryType)}
                            {" · "}
                            {formatBusinessRange(
                              business.currentRange.fromDateValue,
                              business.currentRange.toDateValue,
                            )}
                          </p>
                          <small>
                            {business.timezone} · cutoff{" "}
                            {business.businessDayCutoffTime}
                          </small>
                        </div>
                      </div>
                      <BusinessContextDrilldownButton
                        businessId={business.businessId}
                        contextToken={contextToken}
                      />
                    </header>
                    <KpiGrid
                      compact
                      metrics={business.current}
                      previous={business.previous}
                    />
                  </article>
                ))}
              </div>
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
    label: "Payments collected",
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
          <article className="group-kpi-card" key={definition.key}>
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
  if (range === "30days") return "Last 30 business days";
  return from && to
    ? formatBusinessRange(from, to)
    : "Custom business date range";
}
