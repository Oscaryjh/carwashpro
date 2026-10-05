import Link from "next/link";
import type { DailySalesReport } from "@/lib/reports/daily-sales";
import { formatReportMoney } from "@/lib/reports/presentation";

type ExpenseDetail = { oneOff: unknown; recurring: unknown; paymentsInPeriod: unknown; paid: unknown; unpaid: unknown };
type Props = { report: DailySalesReport; expense: ExpenseDetail | null; baseHref: string };
type Row = [string, number];
const money = (cents: number) => formatReportMoney(cents / 100);
function rowsFor({ report, expense }: Pick<Props, "report" | "expense">) {
  const w = report.walletActivity;
  return {
    refunds: [
      ["Sales refunds", report.summary.refundsCents],
      ["External refunds", report.paymentMethods.reduce((sum, method) => sum + method.refundCents, 0)],
    ].filter(([, value]) => Number(value) > 0) as Row[],
    wallet: w ? [
      ["Top-ups", w.topUpPrincipalCents], ["Bonus credited", w.topUpBonusCents],
      ["Wallet used", w.redemptionPaidCents + w.redemptionBonusCents],
      ["Wallet refunds", w.refundPaidCents + w.refundBonusCents],
    ].filter(([, value]) => Number(value) !== 0) as Row[] : [],
    walletDetail: w ? [
      ["Redemption paid credit", w.redemptionPaidCents], ["Redemption bonus credit", w.redemptionBonusCents],
      ["Refund paid credit", w.refundPaidCents], ["Refund bonus credit", w.refundBonusCents],
      ["Top-up reversal principal", w.reversedPrincipalCents], ["Top-up reversal bonus removed", w.reversedBonusCents],
      ["Invoice void paid restored", w.voidRestoredPaidCents], ["Invoice void bonus restored", w.voidRestoredBonusCents],
    ].filter(([, value]) => Number(value) !== 0) as Row[] : [],
    expenses: expense ? [["One-off Expenses", Number(expense.oneOff) * 100], ["Recurring Expenses", Number(expense.recurring) * 100]].filter(([, value]) => Number(value) !== 0) as Row[] : [],
    settlement: expense ? [
      ["Payments in Period", Number(expense.paymentsInPeriod) * 100],
      ["Paid against selected expenses", Number(expense.paid) * 100],
      ["Outstanding selected expenses", Number(expense.unpaid) * 100],
    ].filter(([, value]) => Number(value) !== 0) as Row[] : [],
    payments: report.paymentMethods.filter(method => method.paymentCount > 0 || method.grossCents !== 0 || method.refundCents !== 0 || method.netCents !== 0),
  };
}
export function hasAdvancedReportDetails(props: Pick<Props, "report" | "expense">) {
  return Object.values(rowsFor(props)).some(rows => rows.length > 0);
}
function Metrics({ rows }: { rows: Row[] }) {
  return <dl className="report-metric-list">{rows.map(([label, cents]) => <div key={label}><dt>{label}</dt><dd>{money(cents)}</dd></div>)}</dl>;
}
export function AdvancedReportDetails(props: Props) {
  const rows = rowsFor(props);
  return <>
    {rows.refunds.length ? <section className="panel report-card"><h3>Refund Breakdown</h3><Metrics rows={rows.refunds} /></section> : null}
    {rows.payments.length ? <section className="panel report-card"><h3>Payment Breakdown</h3>
      {rows.payments.map(method => {
        const [path, query] = props.baseHref.split("?");
        const params = new URLSearchParams(query);
        params.set("paymentMethod", method.label);
        return <div className="report-payment-breakdown" key={method.label}>
          <strong>{method.label}</strong><span>{method.paymentCount} {method.paymentCount === 1 ? "payment" : "payments"}</span>
          <span>Gross {money(method.grossCents)}{method.refundCents !== 0 ? ` · Refunds ${money(method.refundCents)} · Net ${money(method.netCents)}` : ""}</span>
          <Link href={`${path}?${params.toString()}`}>View payments →</Link>
        </div>;
      })}</section> : null}
    {rows.wallet.length || rows.walletDetail.length ? <section className="panel report-card"><h3>Wallet Activity</h3>
      {rows.wallet.length ? <Metrics rows={rows.wallet} /> : null}
      {rows.walletDetail.length ? <details><summary>View wallet breakdown</summary><Metrics rows={rows.walletDetail} /></details> : null}
    </section> : null}
    {rows.expenses.length ? <section className="panel report-card"><h3>Expense Breakdown</h3><Metrics rows={rows.expenses} /></section> : null}
    {rows.settlement.length ? <section className="panel report-card"><h3>Expense Settlement</h3><Metrics rows={rows.settlement} /></section> : null}
  </>;
}
