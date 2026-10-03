import type {
  GroupClosingReport,
  GroupClosingRow,
} from "@/lib/business-groups/group-closing-report";
import {
  buildTabularCsv,
  buildTabularXlsx,
  buildTextPdf,
} from "@/lib/business-groups/group-report-export";

export type GroupClosingExportFormat = "csv" | "xlsx" | "pdf";

export function buildGroupClosingExportRows(report: GroupClosingReport) {
  const summary = report.summary;
  return [
    ["Group", report.groupName],
    ["Currency", "MYR"],
    ["Period", rangeValue(report)],
    ["Store filter", report.filters.storeId ?? "All authorized stores"],
    ["Historical closing records", "Saved historical records; not a complete sales report."],
    ["Frozen closing summary"],
    ["Snapshots", summary.snapshotCount],
    ["Gross sales", centsValue(summary.grossSalesCents)],
    ["Net sales", centsValue(summary.netSalesCents)],
    ["Net collections", centsValue(summary.collectedCents)],
    ["Outstanding", centsValue(summary.outstandingCents)],
    ["Refunds", centsValue(summary.refundsCents)],
    ["Expected cash", centsValue(summary.expectedCashCents)],
    ["Actual cash", centsValue(summary.actualCashCents)],
    ["Cash difference", centsValue(summary.cashDifferenceCents)],
    [],
    [
      "Business date",
      "Store",
      "Branch",
      "Gross",
      "Net",
      "Net collections",
      "Outstanding",
      "Refunds",
      "Expected cash",
      "Actual cash",
      "Difference",
      "WhatsApp",
      "Closed by",
      "Closed at",
      "Report version",
    ],
    ...report.rows.map(snapshotExportRow),
    ...report.rows.flatMap(row => row.walletActivity ? [
      [],
      ["Frozen wallet activity", row.businessDate, row.businessName, row.branchName, row.id, row.reportVersion],
      walletColumns.map(([label]) => label),
      walletColumns.map(([, key]) => centsValue(row.walletActivity![key])),
      ["Unassigned cash refund", row.unassignedCashRefundCents === undefined ? "Unavailable" : centsValue(row.unassignedCashRefundCents)],
    ] : []),
  ] satisfies Array<Array<string | number>>;
}

export function buildGroupClosingCsv(report: GroupClosingReport) {
  return buildTabularCsv(buildGroupClosingExportRows(report));
}

export function buildGroupClosingXlsx(report: GroupClosingReport) {
  return buildTabularXlsx(
    buildGroupClosingExportRows(report),
    "Closing Audit",
  );
}

export function buildGroupClosingPdf(report: GroupClosingReport) {
  const lines = [
    `CLOSING AUDIT - ${report.groupName}`,
    "Historical closing records; not a complete sales report.",
    `Period: ${rangeValue(report)}`,
    "Business date | Store | Branch | Net | Cash difference | Closed by",
    ...report.rows.map(
      (row) =>
        `${row.businessDate} | ${row.businessName} | ${row.branchName} | ${money(row.financial?.netSalesCents ?? null)} | ${money(row.cashDifferenceCents)} | ${row.closedByName}`,
    ),
    ...report.rows.flatMap(row => row.walletActivity ? [
      `Frozen wallet activity | ${row.businessDate} | ${row.businessName} | ${row.branchName} | ${row.id}`,
      ...walletColumns.map(([label, key]) => `${label}: ${money(row.walletActivity![key])}`),
      `Unassigned cash refund: ${money(row.unassignedCashRefundCents ?? null)}`,
    ] : []),
  ];
  return buildTextPdf(lines);
}

const walletColumns = [
  ["Wallet top-up principal", "topUpPrincipalCents"], ["Bonus credited", "topUpBonusCents"],
  ["Wallet redemption (paid)", "redemptionPaidCents"], ["Wallet redemption (bonus)", "redemptionBonusCents"],
  ["Wallet refund (paid)", "refundPaidCents"], ["Wallet refund (bonus)", "refundBonusCents"],
  ["Top-up reversal (principal)", "reversedPrincipalCents"], ["Top-up reversal (bonus)", "reversedBonusCents"],
  ["Void restoration (paid)", "voidRestoredPaidCents"], ["Void restoration (bonus)", "voidRestoredBonusCents"],
] as const;

export function groupClosingExportFileName(
  report: GroupClosingReport,
  extension: GroupClosingExportFormat,
) {
  const safeGroup =
    report.groupName.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") ||
    "group";
  return `${safeGroup.slice(0, 60)}-closing-audit.${extension}`;
}

function snapshotExportRow(row: GroupClosingRow) {
  return [
    row.businessDate,
    row.businessName,
    row.branchName,
    centsValue(row.financial?.grossSalesCents ?? 0),
    centsValue(row.financial?.netSalesCents ?? 0),
    centsValue(row.financial?.collectedCents ?? 0),
    centsValue(row.financial?.outstandingCents ?? 0),
    centsValue(row.financial?.refundsCents ?? 0),
    centsValue(row.expectedCashCents),
    centsValue(row.actualCashCents),
    centsValue(row.cashDifferenceCents),
    row.whatsappStatus,
    row.closedByName,
    row.closedAt.toISOString(),
    row.reportVersion,
  ];
}

function rangeValue(report: GroupClosingReport) {
  return report.filters.range === "custom"
    ? `${report.filters.from ?? ""} to ${report.filters.to ?? ""}`
    : report.filters.range;
}

function centsValue(value: number) {
  return value / 100;
}

function money(value: number | null) {
  return value === null ? "Unavailable" : `RM ${(value / 100).toFixed(2)}`;
}
