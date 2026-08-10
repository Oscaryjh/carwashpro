import { z } from "zod";
import { getEmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { loadOwnPublishedPayslip } from "@/lib/payroll/payslip-publication";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicationId: string }> },
) {
  const auth = await getEmployeeAuthContext(request);
  if (!auth) return new Response("Payslip not found.", { status: 404 });
  if (!(await isBusinessModuleEnabled(auth.businessId, "PAYROLL"))) {
    return Response.json({ ok: false, error: { code: "MODULE_NOT_ENABLED", message: "Payroll is not enabled for this business." } }, { status: 403 });
  }
  const id = z.string().uuid().safeParse((await params).publicationId);
  if (!id.success) return new Response("Payslip not found.", { status: 404 });
  const payslip = await loadOwnPublishedPayslip({
    businessId: auth.businessId,
    membershipId: auth.membershipId,
    publicationId: id.data,
  });
  if (!payslip) return new Response("Payslip not found.", { status: 404 });
  const month = payslip.payrollRun.periodStart.toISOString().slice(0, 7);
  const employeeCode = payslip.payrollEntry.employeeCodeSnapshot.replace(/[^A-Za-z0-9_-]+/g, "-");
  return new Response(new Uint8Array(payslip.documentBytes), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${employeeCode}-${month}-payslip.pdf"`,
      "Content-Length": String(payslip.documentBytes.length),
      "Content-Type": "application/pdf",
    },
  });
}
