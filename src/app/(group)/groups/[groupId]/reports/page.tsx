import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShellFrame } from "@/components/app-shell-frame";
import { BusinessContextDrilldownButton } from "@/components/business-context-drilldown-button";
import { BusinessContextSwitcher } from "@/components/business-context-switcher";
import { GroupLogoUpload } from "@/components/group-logo-upload";
import { GroupPageHero } from "@/components/group-page-hero";
import { GroupStoreComparison } from "@/components/group-store-comparison";
import { createBusinessContextToken } from "@/lib/auth/business-context-token";
import { requireUser } from "@/lib/auth/session";
import { getAvailableGroupReportingContexts } from "@/lib/business-groups/all-stores-access";
import { AllStoresKpiRangeError, type AllStoresKpi } from "@/lib/business-groups/all-stores-kpi";
import { getAvailableBusinessContexts } from "@/lib/business-groups/business-context";
import {
  getGroupReports,
  GroupReportsInputError,
  GROUP_REPORT_INVOICE_STATUSES,
  GROUP_REPORT_PAYMENT_METHODS,
  type GroupReportsResult,
} from "@/lib/business-groups/group-reports";
import {
  buildGroupReportExportHref,
  buildGroupReportsPageHref,
  type GroupReportsSearchQuery,
} from "@/lib/business-groups/group-reports-navigation";
import { getBusinessGroupNavItems } from "@/lib/business-groups/navigation";
import { formatDateValue } from "@/lib/business-time";

type SearchQuery = GroupReportsSearchQuery;

export default async function GroupReportsPage({
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

  let report: GroupReportsResult | null = null;
  let inputError: string | null = null;
  let queryFailed = false;
  try {
    report = await getGroupReports({
      userId: user.userId,
      groupId,
      activeBusinessId: user.activeBusinessId,
      ...query,
    });
  } catch (error) {
    if (
      error instanceof GroupReportsInputError ||
      error instanceof AllStoresKpiRangeError
    ) {
      inputError = error.message;
    } else {
      console.error("[group-reports] Unable to load group report.");
      queryFailed = true;
    }
  }
  if (!report && !inputError && !queryFailed) notFound();

  const contextToken = await createBusinessContextToken({
    userId: user.userId,
    businessId: user.activeBusinessId,
    contextVersion: user.contextVersion,
  });
  const navItems = getBusinessGroupNavItems(groupId);

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
      homeHref={`/groups/${groupId}/overview`}
      navItems={navItems}
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
      <div className="content group-reports-page group-command-page">
        <GroupPageHero
          action={
            <Link
              className="secondary-button"
              href={`/groups/${groupId}/overview`}
            >
              Back to overview
              <span aria-hidden="true">→</span>
            </Link>
          }
          description={
            <>
              Explore sales, store rankings and transaction detail across{" "}
              <strong>{selectedGroup.groupName}</strong>.
            </>
          }
          meta={[
            `${selectedGroup.businesses.length} authorized stores`,
            "Business-day reporting",
            "CSV · Excel · PDF",
          ]}
          title="Group Reports"
          variant="reports"
        />

        <ReportFilters
          groupId={groupId}
          query={query}
          stores={selectedGroup.reportingBusinesses ?? selectedGroup.businesses}
        />

        {inputError ? (
          <section className="group-report-state" role="alert">
            <h2>Check the report filters</h2>
            <p>{inputError}</p>
            <Link href={`/groups/${groupId}/reports?range=today`}>
              Reset filters
            </Link>
          </section>
        ) : queryFailed ? (
          <section className="group-report-state" role="alert">
            <h2>Group reports are unavailable</h2>
            <p>No partial totals or transactions are shown. Refresh to retry.</p>
          </section>
        ) : report ? (
          <>
            <section
              aria-labelledby="group-report-summary"
              className="group-command-section"
            >
              <div className="section-header">
                <div>
                  <h2 id="group-report-summary">Report summary</h2>
                  <p>
                    {rangeLabel(report)}
                    {" · "}Each store uses its own timezone and cutoff
                  </p>
                </div>
                <span className="group-report-currency">
                  MYR · {report.filters.storeId ? "1 store" : `${report.authorizedBusinesses.length} stores`}
                </span>
              </div>
              <div
                className={`group-report-source-note ${
                  report.summaryDataSource === "DAILY_SUMMARY"
                    ? "verified"
                    : "fallback"
                }`}
              >
                <strong>
                  {report.summaryDataSource === "DAILY_SUMMARY"
                    ? "Verified daily summaries"
                    : "Live transaction fallback"}
                </strong>
                <span>{groupReportSourceDescription(report)}</span>
              </div>
              <ExportLinks groupId={groupId} query={query} />
              <SummaryGrid summary={report.summary} />
            </section>

            <GroupStoreComparison
              compareStore={query.compareStore}
              groupId={groupId}
              report={report}
            />

            <ReportAnalytics report={report} />

            <CatalogRankings report={report} />

            <section
              aria-labelledby="group-transactions-heading"
              className="group-command-section"
            >
              <div className="section-header">
                <div>
                  <h2 id="group-transactions-heading">Transactions</h2>
                  <p>
                    {report.totalRows} invoice records. Payment and refund
                    amounts shown are events inside the selected business period.
                  </p>
                </div>
              </div>
              {report.rows.length ? (
                <>
                  <div className="group-report-table-wrap">
                    <table className="group-report-table">
                      <thead>
                        <tr>
                          <th>Invoice</th>
                          <th>Store</th>
                          <th>Business date</th>
                          <th>Customer</th>
                          <th>Gross</th>
                          <th>Discount</th>
                          <th>Tip</th>
                          <th>Package</th>
                          <th>Net invoice</th>
                          <th>Gross collected</th>
                          <th>Refund</th>
                          <th>Balance</th>
                          <th>Status</th>
                          <th>Methods</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.rows.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <strong>{row.invoiceNumber}</strong>
                              <small>{formatIssuedAt(row.issuedAt, row.timezone)}</small>
                            </td>
                            <td>{row.businessName}</td>
                            <td>{formatReportDate(row.businessDate)}</td>
                            <td>{row.customerName ?? "Walk-in"}</td>
                            <td>{formatMoney(row.grossAmountCents)}</td>
                            <td>{formatMoney(row.discountCents)}</td>
                            <td>{formatMoney(row.tipCents)}</td>
                            <td>{formatMoney(row.packageRedemptionCents)}</td>
                            <td>{formatMoney(row.netInvoiceAmountCents)}</td>
                            <td>{formatMoney(row.paidAmountCents)}</td>
                            <td>{formatMoney(row.refundAmountCents)}</td>
                            <td>{formatMoney(row.balanceCents)}</td>
                            <td>
                              <span className={`status ${row.invoiceStatus.toLowerCase()}`}>
                                {formatEnum(row.invoiceStatus)}
                              </span>
                            </td>
                            <td>
                              {row.paymentMethods.length
                                ? row.paymentMethods.map(formatEnum).join(", ")
                                : "—"}
                            </td>
                            <td>
                              <BusinessContextDrilldownButton
                                businessId={row.businessId}
                                contextToken={contextToken}
                                label="View"
                                returnTo={`/invoices/${row.id}`}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination groupId={groupId} query={query} report={report} />
                </>
              ) : (
                <div className="group-report-state">
                  <h3>No transactions found</h3>
                  <p>Try another business period or reset the filters.</p>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </AppShellFrame>
  );
}

function ExportLinks({
  groupId,
  query,
}: {
  groupId: string;
  query: SearchQuery;
}) {
  return (
    <div className="group-report-export-group">
      <nav className="group-report-export-actions" aria-label="Report exports">
        {(["csv", "xlsx", "pdf"] as const).map((format) => (
          <a
            href={buildGroupReportExportHref(groupId, query, format)}
            key={format}
            download
          >
            {format === "xlsx" ? "Excel" : format.toUpperCase()}
          </a>
        ))}
      </nav>
      <small>
        Exports contain the full filtered report, not only compared stores.
      </small>
    </div>
  );
}

function CatalogRankings({ report }: { report: GroupReportsResult }) {
  const groups = [
    ["Top services", report.catalogRankings.services],
    ["Top products", report.catalogRankings.products],
    ["Top packages", report.catalogRankings.packages],
  ] as const;

  return (
    <section
      aria-labelledby="group-catalog-ranking-heading"
      className="group-command-section"
    >
      <div className="section-header">
        <div>
          <h2 id="group-catalog-ranking-heading">Catalog performance</h2>
          <p>Top invoice line items across the selected stores and filters.</p>
        </div>
      </div>
      <div className="group-report-ranking-grid">
        {groups.map(([title, items]) => (
          <div className="group-report-ranking-panel" key={title}>
            <h3>{title}</h3>
            {items.length ? (
              <ol>
                {items.map((item) => (
                  <li key={item.name.toLocaleLowerCase("en")}>
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {item.quantity} sold · {item.storeCount}{" "}
                        {item.storeCount === 1 ? "store" : "stores"}
                      </small>
                    </span>
                    <b>{formatMoney(item.salesCents)}</b>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="group-report-ranking-empty">No matching sales</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function ReportAnalytics({ report }: { report: GroupReportsResult }) {
  const trendMaximum = Math.max(
    1,
    ...report.trend.map((point) => Math.max(0, point.netSalesCents)),
  );
  const performanceMaximum = Math.max(
    1,
    ...report.businessPerformance.map((item) =>
      Math.max(0, item.metrics.netSalesCents),
    ),
  );

  return (
    <div className="group-report-analytics">
      <section
        className="group-report-analysis-panel"
        aria-labelledby="group-sales-trend-heading"
      >
        <div className="section-header">
          <div>
            <h2 id="group-sales-trend-heading">Net sales trend</h2>
            <p>Daily totals use each store&apos;s timezone and cutoff.</p>
          </div>
        </div>
        <div className="group-report-trend-scroll">
          <div
            className="group-report-trend"
            style={{
              gridTemplateColumns: `repeat(${report.trend.length}, minmax(46px, 1fr))`,
            }}
          >
            {report.trend.map((point) => {
              const barHeight =
                point.netSalesCents > 0
                  ? Math.max(
                      4,
                      Math.round((point.netSalesCents / trendMaximum) * 144),
                    )
                  : 2;
              return (
                <div className="group-report-trend-point" key={point.businessDate}>
                  <span className="group-report-trend-value">
                    {compactMoney(point.netSalesCents)}
                  </span>
                  <span
                    aria-label={`${formatReportDate(point.businessDate)} net sales ${formatMoney(point.netSalesCents)}`}
                    className="group-report-trend-bar"
                    style={{ height: `${barHeight}px` }}
                    title={`${formatReportDate(point.businessDate)}: ${formatMoney(point.netSalesCents)}`}
                  />
                  <time dateTime={point.businessDate}>
                    {formatShortDate(point.businessDate)}
                  </time>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section
        className="group-report-analysis-panel"
        aria-labelledby="group-store-performance-heading"
      >
        <div className="section-header">
          <div>
            <h2 id="group-store-performance-heading">Store performance</h2>
            <p>Sorted by net sales for the selected filters.</p>
          </div>
        </div>
        <div className="group-report-performance-wrap">
          <table className="group-report-performance-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Store</th>
                <th>Gross</th>
                <th>Net</th>
                <th>Gross collections</th>
                <th>Refunds</th>
                <th>Transactions</th>
                <th>Average</th>
              </tr>
            </thead>
            <tbody>
              {report.businessPerformance.map((item) => (
                <tr key={item.businessId}>
                  <td>{item.rank}</td>
                  <td>
                    <strong>{item.businessName}</strong>
                    <span className="group-report-performance-track">
                      <span
                        style={{
                          width: `${Math.max(
                            0,
                            Math.round(
                              (item.metrics.netSalesCents / performanceMaximum) *
                                100,
                            ),
                          )}%`,
                        }}
                      />
                    </span>
                  </td>
                  <td>{formatMoney(item.metrics.grossSalesCents)}</td>
                  <td>{formatMoney(item.metrics.netSalesCents)}</td>
                  <td>{formatMoney(item.metrics.paymentsCollectedCents)}</td>
                  <td>{formatMoney(item.metrics.refundsCents)}</td>
                  <td>{item.metrics.transactionCount}</td>
                  <td>
                    {item.metrics.averageTransactionValueCents === null
                      ? "—"
                      : formatMoney(item.metrics.averageTransactionValueCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ReportFilters({
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
        <h2 id="filters-heading">Report filters</h2>
        <p>Filters apply to the summary and invoice records.</p>
      </div>
      <form method="get">
        <label>
          Period
          <select
            defaultValue={query.range === "30days" ? "month" : query.range ?? "today"}
            name="range"
          >
            <option value="today">Today</option>
            <option value="7days">7 days</option>
            <option value="month">This month</option>
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
        <label>
          Payment method
          <select defaultValue={query.paymentMethod?.toUpperCase() ?? "all"} name="paymentMethod">
            <option value="all">All methods</option>
            {GROUP_REPORT_PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {formatEnum(method)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select defaultValue={query.status?.toUpperCase() ?? "all"} name="status">
            <option value="all">All statuses</option>
            {GROUP_REPORT_INVOICE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {formatEnum(status)}
              </option>
            ))}
          </select>
        </label>
        <input name="page" type="hidden" value="1" />
        {queryValues(query.compareStore).map((value, index) => (
          <input
            key={`${value}-${index}`}
            name="compareStore"
            type="hidden"
            value={value}
          />
        ))}
        <div className="group-report-filter-actions">
          <button type="submit">Apply filters</button>
          <Link href={`/groups/${groupId}/reports?range=today`}>Reset</Link>
        </div>
      </form>
    </section>
  );
}

function SummaryGrid({ summary }: { summary: AllStoresKpi }) {
  const values = [
    ["Gross sales", summary.grossSalesCents, true],
    ["Net sales", summary.netSalesCents, true],
    ["Gross collections", summary.paymentsCollectedCents, true],
    ["Refunds", summary.refundsCents, true],
    ["Transactions", summary.transactionCount, false],
    ["Average transaction", summary.averageTransactionValueCents, true],
  ] as const;
  return (
    <div className="group-kpi-grid">
      {values.map(([label, value, money]) => (
        <article
          className="group-kpi-card"
          data-metric={label.toLowerCase().replaceAll(" ", "-")}
          key={label}
        >
          <span>{label}</span>
          <strong>
            {value === null ? "—" : money ? formatMoney(value) : value}
          </strong>
        </article>
      ))}
    </div>
  );
}

function Pagination({
  groupId,
  query,
  report,
}: {
  groupId: string;
  query: SearchQuery;
  report: GroupReportsResult;
}) {
  return (
    <nav className="group-report-pagination" aria-label="Transaction pages">
      <span>
        Page {report.filters.page} of {report.totalPages}
      </span>
      <div>
        {report.filters.page > 1 ? (
          <Link
            href={buildGroupReportsPageHref(
              groupId,
              query,
              report.filters.page - 1,
            )}
          >
            Previous
          </Link>
        ) : (
          <span aria-disabled="true">Previous</span>
        )}
        {report.filters.page < report.totalPages ? (
          <Link
            href={buildGroupReportsPageHref(
              groupId,
              query,
              report.filters.page + 1,
            )}
          >
            Next
          </Link>
        ) : (
          <span aria-disabled="true">Next</span>
        )}
      </div>
    </nav>
  );
}

function rangeLabel(report: GroupReportsResult) {
  if (report.filters.range !== "custom") {
    return report.filters.range === "today"
      ? "Today"
      : report.filters.range === "7days"
        ? "Last 7 business days"
        : "Month to date";
  }
  return `${formatReportDate(report.filters.from!)} – ${formatReportDate(report.filters.to!)}`;
}

function groupReportSourceDescription(report: GroupReportsResult) {
  if (report.summaryDataSource === "DAILY_SUMMARY") {
    return "Summary, trend and store ranking use the versioned analytics layer. Catalog and transaction detail remain live drill-down data.";
  }
  const reason = report.analyticsFallbackReason;
  if (reason === "UNSUPPORTED_FILTERS") {
    return "Payment-method or invoice-status filters require live transaction data so filtered totals stay exact.";
  }
  if (reason === "MISSING_SUMMARIES") {
    return "One or more store-days are not summarized yet. The report safely used live transactions.";
  }
  if (reason === "STALE_SUMMARIES") {
    return "A source record changed after the latest summary. The report safely used live transactions.";
  }
  if (reason === "INVALID_SUMMARIES" || reason === "UNSAFE_MEMBERSHIP") {
    return "Analytics validation did not pass for this scope. The report safely used live transactions.";
  }
  if (reason === "SHADOW_MODE") {
    return "Analytics shadow mode is enabled; live transactions remain authoritative.";
  }
  return "Daily-summary reads are disabled. Summary, trend and store ranking use live transactions.";
}

function formatReportDate(value: string) {
  return formatDateValue(value, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function queryValues(value: unknown) {
  if (typeof value === "string") return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

function formatShortDate(value: string) {
  return formatDateValue(value, {
    day: "2-digit",
    month: "short",
  });
}

function formatIssuedAt(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function compactMoney(value: number) {
  return new Intl.NumberFormat("en-MY", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value / 100);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
  }).format(value / 100);
}

function formatEnum(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
