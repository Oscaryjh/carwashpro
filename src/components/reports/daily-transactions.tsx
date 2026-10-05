import Link from "next/link";
import type { DailySalesReport } from "@/lib/reports/daily-sales";
import { formatReportMoney, getVisibleDailySalesDays } from "@/lib/reports/presentation";

const money = (cents: number) => formatReportMoney(cents / 100);
function detailHref(baseHref: string, key: string, value: string) {
  const [path, query] = baseHref.split("?");
  const params = new URLSearchParams(query);
  params.delete("transactionPage");
  params.set(key, value);
  return `${path}?${params.toString()}`;
}

export function SalesOverview({ report }: { report: DailySalesReport }) {
  return <section aria-labelledby="sales-overview-title" className="report-summary">
    <h2 id="sales-overview-title">Sales Overview</h2>
    <div className="report-kpis report-summary-primary">
      {[
        ["Net Sales", money(report.summary.netSalesCents)],
        ["Transactions", report.summary.transactionCount],
        ["Average Sale", money(report.summary.averageSaleCents)],
        ["Refunds", money(report.summary.refundsCents)],
        ["Discounts", money(report.summary.discountsCents)],
      ].map(([label, value]) => <div className="report-kpi-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
  </section>;
}

export function TransactionPagination({ report, baseHref }: { report: DailySalesReport; baseHref: string }) {
  const page = report.selectedDay?.page ?? 1;
  if (page === 1 && !report.selectedDay?.hasNext) return null;
  return <nav aria-label="Transaction pages" className="transaction-pagination">
    {page > 1 ? <Link href={detailHref(baseHref, "transactionPage", String(page - 1))}>Previous</Link> : null}
    <span>Page {page}</span>
    {report.selectedDay?.hasNext ? <Link href={detailHref(baseHref, "transactionPage", String(page + 1))}>Next</Link> : null}
  </nav>;
}

export function DailyTransactions({ report, today, timezone, baseHref }: {
  report: DailySalesReport; today: boolean; timezone: string; baseHref: string;
}) {
  const days = getVisibleDailySalesDays(report.days, false);
  const rows = report.selectedDay?.transactions ?? [];
  return <section className="panel daily-transactions" aria-labelledby="daily-transactions-title">
    <h2 id="daily-transactions-title">{today ? "Daily Transactions" : "Daily Sales by Day"}</h2>
    {today ? <>
      {rows.length ? <table className="table transaction-table">
        <thead><tr>{["Time", "Invoice", "Customer", "Staff", "Amount", "Payment", "Status", "View"].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td>{new Intl.DateTimeFormat("en-MY", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(row.issuedAt)}</td>
          <td>#{row.invoiceNumber}</td><td>{row.customerName}</td><td>{row.staffName}</td>
          <td>{money(row.totalCents)}</td><td>{row.paymentLabel}</td><td>{row.displayStatus ?? row.status}</td>
          <td><Link href={`/invoices/${row.id}`} aria-label={`View invoice ${row.invoiceNumber}`}>View</Link></td>
        </tr>)}</tbody>
      </table> : <p>{(report.selectedDay?.page ?? 1) > 1 ? "No transactions on this page." : "No transactions in this period."}</p>}
      <TransactionPagination report={report} baseHref={baseHref} />
    </> : days.length ? <table className="table daily-summary-table">
      <thead><tr>{["Date", "Transactions", "Net Sales", "Refunds", "Payments Collected", "View"].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{days.map(day => <tr key={day.dateValue}>
        <td>{new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day.dateValue}T12:00:00Z`))}</td>
        <td>{day.transactionCount}</td><td>{money(day.netSalesCents)}</td><td>{money(day.refundsCents)}</td><td>{money(day.netCollectionsCents)}</td>
        <td><Link href={detailHref(baseHref, "day", day.dateValue)}>View day</Link></td>
      </tr>)}</tbody></table> : <p>No transactions in this period.</p>}
  </section>;
}

export function CollectedPayments({ report, baseHref }: { report: DailySalesReport; baseHref: string }) {
  // Negative refund-only methods are real activity too, not empty payment rows.
  const methods = report.paymentMethods.filter(method => method.netCents !== 0 || method.paymentCount > 0 || method.refundCents > 0);
  return <section className="panel collected-payments" aria-labelledby="payments-collected-title">
    <div className="report-section-heading"><h2 id="payments-collected-title">Payments Collected</h2><strong>{money(report.summary.netCollectionsCents)}</strong></div>
    {methods.length ? <div className="collected-methods">{methods.map(method => <Link key={method.label} href={detailHref(baseHref, "paymentMethod", method.label)} aria-label={`View ${method.label} payment details`}>
      <span>{method.label}</span><strong>{money(method.netCents)}</strong>
    </Link>)}</div> : <p>No payments collected in this period.</p>}
    {(report.walletActivity?.topUpPrincipalCents ?? 0) > 0 ? <p className="report-note">Includes non-sales collections such as wallet top-ups.</p> : null}
  </section>;
}
