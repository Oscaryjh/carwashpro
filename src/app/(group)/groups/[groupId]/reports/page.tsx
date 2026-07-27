import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShellFrame, type NavItem } from "@/components/app-shell-frame";
import { BusinessContextDrilldownButton } from "@/components/business-context-drilldown-button";
import { BusinessContextSwitcher } from "@/components/business-context-switcher";
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
import { formatDateValue } from "@/lib/business-time";

const reportsNav: NavItem[] = [
  { href: "/groups", label: "All Stores", shortLabel: "All", icon: "businesses" },
];

type SearchQuery = {
  range?: string;
  from?: string;
  to?: string;
  store?: string;
  paymentMethod?: string;
  status?: string;
  page?: string;
};

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
  const navItems = reportsNav.map((item) => ({
    ...item,
    href: `/groups/${groupId}/overview`,
  }));

  return (
    <AppShellFrame
      brandName={selectedGroup.groupName}
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
      <div className="content group-reports-page">
        <header className="page-header group-reports-header">
          <div>
            <p className="eyebrow">Business Group</p>
            <h1>Group Reports</h1>
            <p>
              {selectedGroup.groupName} · {selectedGroup.businesses.length}{" "}
              authorized stores · MYR
            </p>
          </div>
          <Link className="secondary-button" href={`/groups/${groupId}/overview`}>
            Overview
          </Link>
        </header>

        <ReportFilters groupId={groupId} query={query} stores={selectedGroup.businesses} />

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
            <section aria-labelledby="group-report-summary">
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
              <SummaryGrid summary={report.summary} />
            </section>

            <section aria-labelledby="group-transactions-heading">
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
                          <th>Collected</th>
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
    ["Payments collected", summary.paymentsCollectedCents, true],
    ["Refunds", summary.refundsCents, true],
    ["Transactions", summary.transactionCount, false],
    ["Average transaction", summary.averageTransactionValueCents, true],
  ] as const;
  return (
    <div className="group-kpi-grid">
      {values.map(([label, value, money]) => (
        <article className="group-kpi-card" key={label}>
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
          <Link href={reportHref(groupId, query, report.filters.page - 1)}>
            Previous
          </Link>
        ) : (
          <span aria-disabled="true">Previous</span>
        )}
        {report.filters.page < report.totalPages ? (
          <Link href={reportHref(groupId, query, report.filters.page + 1)}>
            Next
          </Link>
        ) : (
          <span aria-disabled="true">Next</span>
        )}
      </div>
    </nav>
  );
}

function reportHref(groupId: string, query: SearchQuery, page: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key !== "page" && value) params.set(key, value);
  }
  params.set("page", String(page));
  return `/groups/${groupId}/reports?${params.toString()}`;
}

function rangeLabel(report: GroupReportsResult) {
  if (report.filters.range !== "custom") {
    return report.filters.range === "today"
      ? "Today"
      : report.filters.range === "7days"
        ? "Last 7 business days"
        : "Last 30 business days";
  }
  return `${formatReportDate(report.filters.from!)} – ${formatReportDate(report.filters.to!)}`;
}

function formatReportDate(value: string) {
  return formatDateValue(value, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatIssuedAt(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
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
