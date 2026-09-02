type DailySalesPresentationRow = {
  netSalesCents: number;
  transactionCount: number;
  refundsCents: number;
  discountsCents: number;
  grossCollectionsCents: number;
  paymentMethods: readonly unknown[];
};

export function formatReportMoney(value: unknown) {
  return `RM${new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0))}`;
}

export function hasDailySalesActivity(row: DailySalesPresentationRow) {
  return (
    row.netSalesCents !== 0 ||
    row.transactionCount > 0 ||
    row.refundsCents !== 0 ||
    row.discountsCents !== 0 ||
    row.grossCollectionsCents !== 0 ||
    row.paymentMethods.length > 0
  );
}

export function getVisibleDailySalesDays<Row extends DailySalesPresentationRow>(
  days: readonly Row[],
  showEmptyDays: boolean,
): Row[] {
  return showEmptyDays ? [...days] : days.filter(hasDailySalesActivity);
}

export function formatPaymentShare(sharePercent: number) {
  if (sharePercent === 0) {
    return "0%";
  }

  if (sharePercent > 0 && sharePercent < 0.1) {
    return "<0.1%";
  }

  return `${sharePercent.toFixed(1)}%`;
}

export function normalizeReportDateRange(fromValue: string, toValue: string) {
  return fromValue <= toValue
    ? { fromValue, toValue }
    : { fromValue: toValue, toValue: fromValue };
}
