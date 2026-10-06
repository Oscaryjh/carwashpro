import Link from "next/link";
import type { StaffPerformanceDetail } from "@/lib/business-performance/staff-performance";
import { dashboardPerformanceHref, staffPerformanceHref, type StaffPerformanceQuery } from "@/lib/business-performance/staff-performance-navigation";
import { formatReportMoney } from "@/lib/reports/presentation";
import styles from "./staff-performance-detail.module.css";

export function StaffPerformanceDetailView({ data, query, period, timezone, invoiceViewIds }: {
  data: StaffPerformanceDetail; query: StaffPerformanceQuery; period: string; timezone: string; invoiceViewIds: string[];
}) {
  const token = data.subject.type === "staff" ? data.subject.userId : "unassigned";
  const summary = data.summary;
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "2-digit", month: "short", year: "numeric" });
  const [from, to] = period.split(" — ");
  const periodDate = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
  const shortDate = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  const periodText = from === to ? periodDate.format(fromDate) : `${from.slice(0, 4) === to.slice(0, 4) ? shortDate.format(fromDate) : periodDate.format(fromDate)} – ${periodDate.format(toDate)}`;
  const rangeLabels: Record<string, string> = { today: "Today", yesterday: "Yesterday", "7days": "Last 7 Days", this_week: "This Week", last_week: "Last Week", month: "This Month", last_month: "Last Month", custom: "Custom" };
  const periodLabel = query.range === "custom" && (query.from !== from || query.to !== to) ? "Today" : rangeLabels[query.range ?? "today"] ?? "Today";
  return <section className={`content ${styles.page}`}>
    <header className={styles.header}><div><h1>{data.name}</h1><p className={styles.subtitle}>Staff Performance · {periodLabel}</p><p>{periodText}</p></div><Link className={styles.action} href={dashboardPerformanceHref(query)}>Back to Dashboard</Link></header>
    <section className={styles.summary} aria-label="Summary"><h2>Summary</h2><dl className={styles.metrics}>
      <div><dt>Attributed Sales</dt><dd>{formatReportMoney(summary.attributedSales)}</dd></div>
      <div><dt>Appointments</dt><dd>{summary.appointments}</dd></div>
      <div><dt>Completed Appointments</dt><dd>{summary.completedAppointments}</dd></div>
      <div><dt>Customers Served</dt><dd>{summary.customersServed}</dd></div>
      <div><dt>Services Sold</dt><dd>{summary.servicesSold}</dd></div>
    </dl><div className={styles.summaryHelp}><p><strong>Customers Served:</strong> Distinct CRM customers from completed appointments in this period.</p><p><strong>Services Sold:</strong> Quantity of service items sold; not a count of services performed.</p></div></section>
    {data.averageAttributedInvoice !== null || data.topService !== null ? <section className={`panel ${styles.panel} ${styles.insightsPanel}`} aria-label="Insights"><h2>Insights</h2><dl className={styles.insights}>
      <div><dt>Average Attributed Invoice</dt><dd>{data.averageAttributedInvoice === null ? "—" : formatReportMoney(data.averageAttributedInvoice)}</dd></div>
      <div><dt>Top Service</dt><dd>{data.topService?.name ?? "—"}</dd><small>By quantity sold{data.topService ? ` · ${data.topService.quantity}` : ""}</small></div>
    </dl></section> : null}
    {data.serviceBreakdown.length > 0 || data.otherAttributedItems !== 0 ? <section className={`panel ${styles.panel}`}><h2>Service Breakdown</h2>
      {data.serviceBreakdown.length ? <div className={styles.tableWrap}><table className={styles.breakdown}><thead><tr><th>Service</th><th>Quantity Sold</th><th className={styles.amount}>Attributed Sales</th></tr></thead><tbody>{data.serviceBreakdown.map(row => <tr key={row.serviceId}><td>{row.name}</td><td>{row.quantity}</td><td className={styles.amount}>{formatReportMoney(row.amount)}</td></tr>)}</tbody></table></div> : null}
      {data.otherAttributedItems !== 0 ? <div><dl className={styles.other}><dt>Other attributed sales</dt><dd>{formatReportMoney(data.otherAttributedItems)}</dd></dl><p className={styles.helper}>Includes attributed sales from products, packages, or other non-service items.</p></div> : null}
    </section> : null}
    <section className={`panel ${styles.panel}`}><h2>Invoice Activity</h2>
      {data.activity.length ? <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Invoice Activity table"><table className={styles.activity}><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Services</th><th className={styles.amount}>Attributed Sales</th><th>View</th></tr></thead><tbody>{data.activity.map(row => <tr key={row.id}><td>{date.format(row.issuedAt)}</td><td>{row.invoiceNumber}</td><td>{row.customerName}</td><td>{row.serviceNames.join(", ") || "—"}</td><td className={styles.amount}>{formatReportMoney(row.amount)}</td><td>{invoiceViewIds.includes(row.id) ? <Link className={styles.action} href={`/invoices/${row.id}`} aria-label={`View invoice ${row.invoiceNumber}`}>View →</Link> : "—"}</td></tr>)}</tbody></table></div> : <p className={styles.empty}>No attributed invoices in this period.</p>}
      {data.invoiceCount > 0 ? <nav className={styles.pagination} aria-label="Invoice Activity pages">{data.page > 1 ? <Link className={styles.action} href={staffPerformanceHref(token, query, data.page - 1)}>Previous</Link> : null}<span>Page {data.page} of {data.pageCount} · {data.invoiceCount} invoices</span>{data.page < data.pageCount ? <Link className={styles.action} href={staffPerformanceHref(token, query, data.page + 1)}>Next</Link> : null}</nav> : null}
    </section>
    <details className={styles.notes}><summary>About these metrics</summary><div><p>Sales metrics follow invoice date.</p><p>Appointment metrics follow appointment date.</p><p>Customers Served counts distinct CRM customer records in completed appointments.</p><p>Attributed Sales includes original eligible invoice items; refunds are not deducted; void invoices are excluded.</p></div></details>
  </section>;
}
