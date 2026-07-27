import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShellFrame } from "@/components/app-shell-frame";
import { BusinessContextDrilldownButton } from "@/components/business-context-drilldown-button";
import { BusinessContextSwitcher } from "@/components/business-context-switcher";
import { createBusinessContextToken } from "@/lib/auth/business-context-token";
import { requireUser } from "@/lib/auth/session";
import { getAvailableGroupReportingContexts } from "@/lib/business-groups/all-stores-access";
import { AllStoresKpiRangeError } from "@/lib/business-groups/all-stores-kpi";
import { getAvailableBusinessContexts } from "@/lib/business-groups/business-context";
import {
  getGroupClosingReport,
  GroupClosingInputError,
  type GroupClosingReport,
} from "@/lib/business-groups/group-closing-report";
import { getBusinessGroupNavItems } from "@/lib/business-groups/navigation";

type SearchQuery = {
  range?: string;
  from?: string;
  to?: string;
  store?: string;
};

export default async function GroupClosingPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<SearchQuery>;
}) {
  const user = await requireUser();
  if (user.role === "PLATFORM_ADMIN") notFound();
  if (!user.activeBusinessId) redirect("/business-context/recover");

  const { groupId } = await params;
  const query = await searchParams;
  const [groups, businessContexts] = await Promise.all([
    getAvailableGroupReportingContexts(user.userId, user.activeBusinessId),
    getAvailableBusinessContexts(user.userId, user.activeBusinessId),
  ]);
  const selectedGroup = groups.find((group) => group.groupId === groupId);
  if (!selectedGroup?.canViewAllStores) notFound();

  let report: GroupClosingReport | null = null;
  let inputError: string | null = null;
  let queryFailed = false;
  try {
    report = await getGroupClosingReport({
      userId: user.userId,
      groupId,
      activeBusinessId: user.activeBusinessId,
      ...query,
    });
  } catch (error) {
    if (
      error instanceof GroupClosingInputError ||
      error instanceof AllStoresKpiRangeError
    ) {
      inputError = error.message;
    } else {
      console.error("[group-closing] Unable to load frozen closing reports.");
      queryFailed = true;
    }
  }
  if (!report && !inputError && !queryFailed) notFound();

  const contextToken = await createBusinessContextToken({
    userId: user.userId,
    businessId: user.activeBusinessId,
    contextVersion: user.contextVersion,
  });

  return (
    <AppShellFrame
      brandName={selectedGroup.groupName}
      homeHref={`/groups/${groupId}/overview`}
      navItems={getBusinessGroupNavItems(groupId)}
      businessSwitcher={
        <BusinessContextSwitcher
          groups={groups}
          homeBusiness={
            businessContexts.businesses.find((business) => business.isHome) ??
            null
          }
          contextToken={contextToken}
          selectedGroupId={groupId}
        />
      }
    >
      <div className="content group-closing-page">
        <header className="page-header group-closing-header">
          <div>
            <p className="eyebrow">Business Group</p>
            <h1>Daily Closing</h1>
            <p>
              Frozen branch snapshots for {selectedGroup.groupName}. Live sales
              are never recalculated here.
            </p>
          </div>
          <Link
            className="secondary-button"
            href={`/groups/${groupId}/reports?range=today`}
          >
            Group reports
          </Link>
        </header>

        <ClosingFilters
          groupId={groupId}
          query={query}
          stores={selectedGroup.businesses}
        />

        {inputError ? (
          <ReportState
            message={inputError}
            resetHref={`/groups/${groupId}/closing?range=today`}
            title="Check the closing filters"
          />
        ) : queryFailed ? (
          <ReportState
            message="No partial totals are shown. Refresh to retry."
            title="Group closing is unavailable"
          />
        ) : report ? (
          <>
            <section aria-labelledby="group-closing-summary">
              <div className="section-header">
                <div>
                  <h2 id="group-closing-summary">Closing summary</h2>
                  <p>
                    {rangeLabel(report)}. Each store uses its own timezone and
                    cutoff.
                  </p>
                </div>
                <span className="group-report-currency">Frozen snapshots</span>
              </div>
              {report.summary.invalidReportCount ? (
                <p className="group-closing-warning" role="alert">
                  {report.summary.invalidReportCount} legacy snapshot
                  {report.summary.invalidReportCount === 1 ? " has" : "s have"}{" "}
                  no valid frozen financial payload. Cash reconciliation remains
                  visible, but those sales values are excluded.
                </p>
              ) : null}
              <ClosingSummary report={report} />
            </section>

            <section aria-labelledby="group-closing-records">
              <div className="section-header">
                <div>
                  <h2 id="group-closing-records">Branch closings</h2>
                  <p>
                    {report.rows.length} immutable closing record
                    {report.rows.length === 1 ? "" : "s"} in this period.
                  </p>
                </div>
              </div>
              {report.rows.length ? (
                <div className="group-closing-table-wrap">
                  <table className="group-closing-table">
                    <thead>
                      <tr>
                        <th>Business date</th>
                        <th>Store</th>
                        <th>Branch</th>
                        <th>Gross</th>
                        <th>Net</th>
                        <th>Collected</th>
                        <th>Outstanding</th>
                        <th>Refunds</th>
                        <th>Expected cash</th>
                        <th>Actual cash</th>
                        <th>Difference</th>
                        <th>WhatsApp</th>
                        <th>Closed by</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row) => (
                        <tr key={row.id}>
                          <td>{formatDate(row.businessDate)}</td>
                          <td>{row.businessName}</td>
                          <td>
                            <strong>{row.branchName}</strong>
                            {row.closingNote ? <small>{row.closingNote}</small> : null}
                          </td>
                          <td>{money(row.financial?.grossSalesCents ?? null)}</td>
                          <td>{money(row.financial?.netSalesCents ?? null)}</td>
                          <td>{money(row.financial?.collectedCents ?? null)}</td>
                          <td>{money(row.financial?.outstandingCents ?? null)}</td>
                          <td>{money(row.financial?.refundsCents ?? null)}</td>
                          <td>{money(row.expectedCashCents)}</td>
                          <td>{money(row.actualCashCents)}</td>
                          <td>
                            <span className={differenceClass(row.cashDifferenceCents)}>
                              {signedMoney(row.cashDifferenceCents)}
                            </span>
                          </td>
                          <td>{formatEnum(row.whatsappStatus)}</td>
                          <td>
                            {row.closedByName}
                            <small>
                              {formatTimestamp(row.closedAt, row.timezone)}
                            </small>
                          </td>
                          <td>
                            <BusinessContextDrilldownButton
                              businessId={row.businessId}
                              contextToken={contextToken}
                              label="View"
                              returnTo={`/closing?branchId=${row.branchId}&date=${row.businessDate}`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="group-report-state">
                  <h3>No completed closings</h3>
                  <p>Try another business period or store.</p>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </AppShellFrame>
  );
}

function ClosingFilters({
  groupId,
  query,
  stores,
}: {
  groupId: string;
  query: SearchQuery;
  stores: Array<{ id: string; name: string }>;
}) {
  return (
    <section className="group-report-filter-panel" aria-labelledby="filters-heading">
      <div>
        <h2 id="filters-heading">Closing filters</h2>
        <p>Filters apply only to frozen closing snapshots.</p>
      </div>
      <form action={`/groups/${groupId}/closing`} method="get">
        <label>
          Period
          <select defaultValue={query.range ?? "today"} name="range">
            <option value="today">Today</option>
            <option value="7days">7 days</option>
            <option value="30days">30 days</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          From
          <input defaultValue={query.from ?? ""} name="from" type="date" />
        </label>
        <label>
          To
          <input defaultValue={query.to ?? ""} name="to" type="date" />
        </label>
        <label>
          Store
          <select defaultValue={query.store ?? "all"} name="store">
            <option value="all">All authorized stores</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
        <div className="group-report-filter-actions">
          <button type="submit">Apply filters</button>
          <Link href={`/groups/${groupId}/closing?range=today`}>Reset</Link>
        </div>
      </form>
    </section>
  );
}

function ClosingSummary({ report }: { report: GroupClosingReport }) {
  const { summary } = report;
  const metrics = [
    ["Snapshots", summary.snapshotCount.toString()],
    ["Stores", summary.storeCount.toString()],
    ["Branches", summary.branchCount.toString()],
    ["Gross sales", money(summary.grossSalesCents)],
    ["Net sales", money(summary.netSalesCents)],
    ["Collected", money(summary.collectedCents)],
    ["Outstanding", money(summary.outstandingCents)],
    ["Refunds", money(summary.refundsCents)],
    ["Expected cash", money(summary.expectedCashCents)],
    ["Actual cash", money(summary.actualCashCents)],
    ["Cash difference", signedMoney(summary.cashDifferenceCents)],
    [
      "Reconciliation",
      `${summary.balancedCount} balanced / ${summary.overCount} over / ${summary.shortCount} short`,
    ],
  ];
  return (
    <div className="group-closing-summary-grid">
      {metrics.map(([label, value]) => (
        <article key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
    </div>
  );
}

function ReportState({
  message,
  resetHref,
  title,
}: {
  message: string;
  resetHref?: string;
  title: string;
}) {
  return (
    <section className="group-report-state" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      {resetHref ? <Link href={resetHref}>Reset filters</Link> : null}
    </section>
  );
}

function rangeLabel(report: GroupClosingReport) {
  const { range, from, to } = report.filters;
  if (range === "custom" && from && to) {
    return `${formatDate(from)} to ${formatDate(to)}`;
  }
  return {
    today: "Today",
    "7days": "Last 7 business days",
    "30days": "Last 30 business days",
    custom: "Custom period",
  }[range];
}

function money(cents: number | null) {
  if (cents === null) return "Unavailable";
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
  }).format(cents / 100);
}

function signedMoney(cents: number) {
  return `${cents > 0 ? "+" : ""}${money(cents)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatTimestamp(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(value);
}

function formatEnum(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^\w/, (letter) =>
    letter.toUpperCase(),
  );
}

function differenceClass(cents: number) {
  if (cents === 0) return "group-closing-difference balanced";
  return cents > 0
    ? "group-closing-difference over"
    : "group-closing-difference short";
}
