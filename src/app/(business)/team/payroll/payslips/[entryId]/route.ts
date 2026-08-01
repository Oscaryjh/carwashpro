import { z } from "zod";
import { getAuditRequestContext, tryWriteAuditLog } from "@/lib/audit";
import { requireWholeBusinessPayroll } from "@/lib/payroll/access";
import { loadPayrollPayslip } from "@/lib/payroll/documents";
import { buildPayslipPdf, payslipFileName } from "@/lib/payroll/export";

type PayslipRouteProps = {
  params: Promise<{ entryId: string }>;
};

export async function GET(_request: Request, { params }: PayslipRouteProps) {
  const context = await requireWholeBusinessPayroll("VIEW_PAYROLL");
  const parsed = z.string().uuid().safeParse((await params).entryId);
  if (!parsed.success) {
    return new Response("Payslip not found.", { status: 404 });
  }
  const document = await loadPayrollPayslip(context.businessId, parsed.data);
  if (!document) {
    return new Response("Payslip not found.", { status: 404 });
  }
  const pdf = buildPayslipPdf(document.run, document.entry);
  await tryWriteAuditLog({
    businessId: context.businessId,
    actor: context.user,
    request: await getAuditRequestContext(),
    action: "PAYSLIP_DOWNLOADED",
    entityType: "PayrollEntry",
    entityId: document.entry.id,
    summary: `Payslip downloaded for ${document.entry.fullName}.`,
    metadata: {
      payrollRunId: document.run.id,
      employeeCode: document.entry.employeeCode,
      status: document.run.status,
    },
  });
  const fileName = payslipFileName(document.run, document.entry);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(pdf.length),
      "Content-Type": "application/pdf",
    },
  });
}
