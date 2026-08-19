import { createHash } from "node:crypto";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { getAuditRequestContext, tryWriteAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import {
  getLeaveAdjustmentReport,
  getLeaveBalanceReport,
  getLeaveCarryReport,
  getLeaveOverview,
  getLeaveUsageReport,
  toCsv,
  type LeaveReportFilters,
} from "@/lib/leave/reporting-service";

type ExportTab = "overview" | "balances" | "usage" | "carry" | "adjustments";

export async function GET(request: Request) {
  const { access, user } = await requireBusinessUser("VIEW_LEAVE");
  const scope = await resolveAttendanceScope(access);
  const url = new URL(request.url);
  const tab = exportTab(url.searchParams.get("tab"));
  if (tab === "adjustments" && !hasBusinessCapability(access, "ADJUST_LEAVE_BALANCE")) {
    return new Response("You do not have permission to export leave adjustments.", { status: 403 });
  }

  const filters = parseFilters(url.searchParams);
  const document = await buildExport(tab, scope, filters);
  const bytes = new TextEncoder().encode(document.csv);
  await tryWriteAuditLog({
    businessId: scope.businessId,
    actor: user,
    request: await getAuditRequestContext(),
    action: "LEAVE_REPORT_EXPORTED",
    entityType: "LeaveReport",
    summary: `${tab} leave report exported as CSV.`,
    metadata: {
      reportType: tab,
      format: "CSV",
      rowCount: document.rowCount,
      from: filters.from.toISOString().slice(0, 10),
      to: filters.to.toISOString().slice(0, 10),
      branchId: filters.branchId ?? null,
      policyId: filters.policyId ?? null,
      includeInactive: Boolean(filters.includeInactive),
      expiryDays: filters.expiryDays ?? null,
      sort: filters.sort ?? "employee",
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    },
  });

  const date = new Date().toISOString().slice(0, 10);
  return new Response(bytes, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="leave-${tab}-${date}.csv"`,
      "Content-Length": String(bytes.length),
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}

async function buildExport(
  tab: ExportTab,
  scope: Awaited<ReturnType<typeof resolveAttendanceScope>>,
  filters: LeaveReportFilters,
) {
  if (tab === "overview") {
    const report = await getLeaveOverview(scope, filters);
    const rows = [
      ["On leave today", report.onLeaveToday],
      ["Pending approvals", report.pendingApprovals],
      ["Approved in selected period (days)", report.approvedInPeriod],
      ["Upcoming approved leave in 7 days", report.upcomingSevenDays],
      ["Approved this month (days)", report.approvedThisMonth],
      ["Unpaid this month (days)", report.unpaidThisMonth],
      ["Carry-forward expiring in 30 days", report.expiringSoonUnits],
      ["Active employees", report.activeEmployees],
      ["Evidence required", report.evidenceSummary.required],
      ["Evidence attached", report.evidenceSummary.attached],
      ["Evidence verified", report.evidenceSummary.verified],
      ["Evidence needs follow-up", report.evidenceSummary.needsFollowUp],
      ["Evidence rejected", report.evidenceSummary.rejected],
      ...report.monthlyTrend.map((row) => ["Approved leave trend", row.month, "", "", "", "", "", row.units]),
      ...report.upcoming.map((row) => [
        "Upcoming approved leave", row.employeeCode, row.employeeName, row.branchName,
        row.policyName, row.startsOn, row.endsOn, row.units,
      ]),
    ];
    return { csv: toCsv(["Metric", "Value / employee code", "Employee", "Branch", "Leave type", "Starts", "Ends", "Units"], rows), rowCount: rows.length };
  }

  if (tab === "balances") {
    const rows = await collectRows((page) => getLeaveBalanceReport(scope, { ...filters, page, pageSize: 100 }));
    return {
      csv: toCsv(
        ["Employee code", "Employee", "Leave type", "Period from", "Period to", "Entitlement", "Carry forward", "Manual adjustment", "Used", "Pending", "Remaining", "Projected remaining", "Next expiry"],
        rows.map((row) => [row.employeeCode, row.employeeName, row.policyName, row.periodStart, row.periodEnd, row.entitlement, row.carryForward, row.manualAdjustment, row.used, row.pending, row.remaining, row.projectedRemaining, row.nextExpiry]),
      ),
      rowCount: rows.length,
    };
  }

  if (tab === "usage") {
    const rows = await collectRows((page) => getLeaveUsageReport(scope, { ...filters, page, pageSize: 100 }));
    return {
      csv: toCsv(
        ["Month", "Employee code", "Employee", "Leave type", "Branch", "Pay treatment", "Approved units"],
        rows.map((row) => [row.month, row.employeeCode, row.employeeName, row.policyName, row.branchName, row.payTreatment, row.approvedUnits]),
      ),
      rowCount: rows.length,
    };
  }

  if (tab === "carry") {
    const rows = await collectRows((page) => getLeaveCarryReport(scope, { ...filters, page, pageSize: 100 }));
    return {
      csv: toCsv(
        ["Employee code", "Employee", "Leave type", "Source period", "Granted", "Used", "Remaining", "Expiry", "Status"],
        rows.map((row) => [row.employeeCode, row.employeeName, row.policyName, row.sourcePeriod, row.granted, row.used, row.remaining, row.expiry, row.status]),
      ),
      rowCount: rows.length,
    };
  }

  const rows = await collectRows((page) => getLeaveAdjustmentReport(scope, { ...filters, page, pageSize: 100 }));
  return {
    csv: toCsv(
      ["Date", "Employee code", "Employee", "Leave type", "Units", "Authorised by", "Reason"],
      rows.map((row) => [row.createdAt, row.employeeCode, row.employeeName, row.policyName, row.units, row.actor, row.reason]),
    ),
    rowCount: rows.length,
  };
}

async function collectRows<Row>(
  load: (page: number) => Promise<{ rows: Row[]; pagination: { page: number; pages: number } }>,
) {
  const rows: Row[] = [];
  let page = 1;
  while (true) {
    const result = await load(page);
    rows.push(...result.rows);
    if (page >= result.pagination.pages) return rows;
    page += 1;
  }
}

function exportTab(value: string | null): ExportTab {
  return value === "balances" || value === "usage" || value === "carry" || value === "adjustments"
    ? value
    : "overview";
}

function parseFilters(params: URLSearchParams): LeaveReportFilters {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const preset = params.get("preset") ?? "this_year";
  let from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  let to = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
  if (preset === "this_month") {
    from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  } else if (preset === "last_month") {
    from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  } else if (preset === "last_year") {
    from = new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1));
    to = new Date(Date.UTC(today.getUTCFullYear() - 1, 11, 31));
  } else if (preset === "custom") {
    from = validDate(params.get("from")) ?? from;
    to = validDate(params.get("to")) ?? to;
  }
  if (from > to) [from, to] = [to, from];
  const expiry = Number(params.get("expiry"));
  const sort = params.get("sort");
  return {
    from,
    to,
    branchId: params.get("branch") || undefined,
    policyId: params.get("policy") || undefined,
    employee: params.get("employee") || undefined,
    includeInactive: params.get("inactive") === "1",
    expiryDays: expiry === 30 || expiry === 60 || expiry === 90 ? expiry : undefined,
    sort: sort === "remaining_desc" || sort === "remaining_asc" || sort === "used_desc" || sort === "pending_desc" || sort === "expiry" ? sort : "employee",
  };
}

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : null;
}
