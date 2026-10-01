import type { WalletLedgerMetrics } from "@/lib/financial-metrics";

export function WalletFinancialSummary({ activity, unassignedCashRefundCents, salesRefundsCents, externalRefundsCents }: {
  activity?: WalletLedgerMetrics;
  unassignedCashRefundCents?: number;
  salesRefundsCents?: number;
  externalRefundsCents?: number;
}) {
  if (!activity && unassignedCashRefundCents === undefined) return null;
  const rows: Array<[string, number]> = activity ? [
    ["Top-up principal", activity.topUpPrincipalCents],
    ["Bonus credited", activity.topUpBonusCents],
    ["Wallet redemption — paid credit", activity.redemptionPaidCents],
    ["Wallet redemption — bonus credit", activity.redemptionBonusCents],
    ["Wallet refund — paid credit", activity.refundPaidCents],
    ["Wallet refund — bonus credit", activity.refundBonusCents],
    ["Top-up reversal — principal", activity.reversedPrincipalCents],
    ["Top-up reversal — bonus removed", activity.reversedBonusCents],
    ["Invoice void — paid credit restored", activity.voidRestoredPaidCents],
    ["Invoice void — bonus credit restored", activity.voidRestoredBonusCents],
  ] : [];
  return <section className="daily-closing-section">
    {salesRefundsCents !== undefined && externalRefundsCents !== undefined ? <dl className="daily-closing-facts">
      <div><dt>Sales refunds</dt><dd>{money(salesRefundsCents)}</dd></div>
      <div><dt>External refunds</dt><dd>{money(externalRefundsCents)}</dd></div>
    </dl> : null}
    {activity ? <>
      <h3>Wallet activity</h3>
      <p>Top-ups are not sales. Wallet payments are not new external collections.</p>
      <dl className="daily-closing-facts">{rows.map(([label, cents]) =>
        <div key={label}><dt>{label}</dt><dd>{money(cents)}</dd></div>)}</dl>
    </> : null}
    {unassignedCashRefundCents !== undefined ? <div className="notice">
      <strong>Unassigned cash refund: {money(unassignedCashRefundCents)}</strong>
      <p>Recorded on this business day, but not assigned to a cashier shift or a specific cash drawer. Closed shifts are unchanged.</p>
    </div> : null}
  </section>;
}

function money(cents: number) {
  return `RM ${(cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
