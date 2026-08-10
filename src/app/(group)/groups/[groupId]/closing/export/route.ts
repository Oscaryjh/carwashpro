import { requireUser } from "@/lib/auth/session";
import { getAvailableGroupReportingContexts } from "@/lib/business-groups/all-stores-access";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";
import { AllStoresKpiRangeError } from "@/lib/business-groups/all-stores-kpi";
import {
  buildGroupClosingCsv,
  buildGroupClosingPdf,
  buildGroupClosingXlsx,
  groupClosingExportFileName,
  type GroupClosingExportFormat,
} from "@/lib/business-groups/group-closing-export";
import {
  getGroupClosingExportData,
  GroupClosingExportLimitError,
  GroupClosingInputError,
} from "@/lib/business-groups/group-closing-report";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const user = await requireUser();
  if (!user.activeBusinessId || user.role === "PLATFORM_ADMIN") {
    return new Response("Not found", { status: 404 });
  }
  const { groupId } = await params;
  const groups = await getAvailableGroupReportingContexts(
    user.userId,
    user.activeBusinessId,
  );
  if (!groups.some((group) => group.groupId === groupId && group.canViewAllStores)) {
    return new Response("Not found", { status: 404 });
  }
  if (!(await isBusinessModuleEnabled(user.activeBusinessId, "BUSINESS_GROUP"))) {
    return Response.json({ code: "MODULE_NOT_ENABLED" }, { status: 403 });
  }
  const search = new URL(request.url).searchParams;
  const format = normalizeFormat(search.get("format"));
  if (!format) {
    return new Response("Select a valid export format.", { status: 400 });
  }

  try {
    const report = await getGroupClosingExportData({
      userId: user.userId,
      groupId,
      activeBusinessId: user.activeBusinessId,
      range: search.get("range") ?? undefined,
      from: search.get("from") ?? undefined,
      to: search.get("to") ?? undefined,
      store: search.get("store") ?? undefined,
      status: search.get("status") ?? undefined,
    });
    if (!report) return new Response("Not found", { status: 404 });

    const body =
      format === "csv"
        ? buildGroupClosingCsv(report)
        : format === "xlsx"
          ? buildGroupClosingXlsx(report)
          : buildGroupClosingPdf(report);
    const contentType =
      format === "csv"
        ? "text/csv; charset=utf-8"
        : format === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf";
    return new Response(new Uint8Array(body), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${groupClosingExportFileName(report, format)}"`,
        "Content-Length": String(body.length),
        "Content-Type": contentType,
      },
    });
  } catch (error) {
    if (
      error instanceof GroupClosingInputError ||
      error instanceof AllStoresKpiRangeError
    ) {
      return new Response(error.message, { status: 400 });
    }
    if (error instanceof GroupClosingExportLimitError) {
      return new Response(error.message, { status: 422 });
    }
    console.error("[group-closing-export] Export failed.");
    return new Response("Closing audit export is unavailable.", {
      status: 500,
    });
  }
}

function normalizeFormat(
  value: string | null,
): GroupClosingExportFormat | null {
  return value === "csv" || value === "xlsx" || value === "pdf"
    ? value
    : null;
}
