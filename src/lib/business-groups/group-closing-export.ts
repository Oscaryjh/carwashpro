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
  const audit = report.audit;
  const summary = report.summary;
  return [
    ["Group", report.groupName],
    ["Currency", "MYR"],
    ["Period", rangeValue(report)],
    ["Store filter", report.filters.storeId ?? "All authorized stores"],
    ["Audit status", report.filters.auditStatus ?? "All"],
    ["Checked at", audit.checkedAt.toISOString()],
    ["Required closings", audit.requiredCount],
    ["Completed closings", audit.completedCount],
    ["Missing closings", audit.missingCount],
    [
      "Completion percent",
      audit.completionPercent === null ? "Not applicable" : audit.completionPercent,
    ],
    ["Not due", audit.notDueCount],
    ["Not applicable", audit.notApplicableCount],
    ["Partial membership", audit.partialMembershipCount],
    ["Branch not open", audit.branchNotOpenCount],
    ["Branch history unknown", audit.branchHistoryUnknownCount],
    ["Unsupported industry", audit.unsupportedIndustryCount],
    ["Unexpected snapshots", audit.unexpectedSnapshotCount],
    [],
    ["Closing audit"],
    [
      "Business date",
      "Store",
      "Branch",
      "Due at",
      "Status",
      "Snapshot ID",
    ],
    ...audit.rows.map((row) => [
      row.businessDate,
      row.businessName,
      row.branchName,
      row.dueAt.toISOString(),
      row.status,
      row.snapshotId ?? "",
    ]),
    [],
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
  const completion =
    report.audit.completionPercent === null
      ? "Not applicable"
      : `${report.audit.completionPercent.toFixed(1)}%`;
  const lines = [
    `CLOSING AUDIT - ${report.groupName}`,
    `Period: ${rangeValue(report)}`,
    `Required: ${report.audit.requiredCount}`,
    `Completed: ${report.audit.completedCount}`,
    `Missing: ${report.audit.missingCount}`,
    `Completion: ${completion}`,
    "",
    "Business date | Store | Branch | Due at | Status",
    ...report.audit.rows.map(
      (row) =>
        `${row.businessDate} | ${row.businessName} | ${row.branchName} | ${row.dueAt.toISOString()} | ${row.status}`,
    ),
    "",
    "Business date | Store | Branch | Net | Cash difference | Closed by",
    ...report.rows.map(
      (row) =>
        `${row.businessDate} | ${row.businessName} | ${row.branchName} | ${money(row.financial?.netSalesCents ?? null)} | ${money(row.cashDifferenceCents)} | ${row.closedByName}`,
    ),
  ];
  return buildTextPdf(lines);
}

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
