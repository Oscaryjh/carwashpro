import { getAuditRequestContext, tryWriteAuditLog } from "@/lib/audit";
import { requireWholeBusinessPayroll } from "@/lib/payroll/access";
import { loadPayrollDocumentRun } from "@/lib/payroll/documents";
import {
  buildPayrollExport,
  buildStatutoryExport,
  payrollExportFileName,
} from "@/lib/payroll/export";

export async function GET(request: Request) {
  const context = await requireWholeBusinessPayroll("VIEW_PAYROLL");
  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? "";
  const kind = url.searchParams.get("kind");
  const format = url.searchParams.get("format");
  if (
    (kind !== "payroll" && kind !== "statutory") ||
    (format !== "csv" && format !== "xlsx")
  ) {
    return new Response("Select a valid payroll export.", { status: 400 });
  }
  let run;
  try {
    run = await loadPayrollDocumentRun(context.businessId, month);
  } catch {
    return new Response("Select a valid payroll month.", { status: 400 });
  }
  if (!run) {
    return new Response("Payroll run not found.", { status: 404 });
  }
  const document =
    kind === "payroll"
      ? buildPayrollExport(run, format)
      : buildStatutoryExport(run, format);
  await tryWriteAuditLog({
    businessId: context.businessId,
    actor: context.user,
    request: await getAuditRequestContext(),
    action: "PAYROLL_EXPORT_DOWNLOADED",
    entityType: "PayrollRun",
    entityId: run.id,
    summary: `${kind} ${format.toUpperCase()} export downloaded.`,
    metadata: { month, kind, format, status: run.status },
  });
  const fileName = payrollExportFileName(run, kind, format);
  return new Response(new Uint8Array(document), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(document.length),
      "Content-Type":
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
