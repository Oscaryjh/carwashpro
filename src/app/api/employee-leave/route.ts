import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { assertEmployeeAuthSameOrigin, readEmployeeAuthJson } from "@/lib/attendance/employee-auth/http";
import { employeeAttendanceErrorResponse, employeeAttendanceJson } from "@/lib/attendance/response";
import { leaveCancelInputSchema, leaveRequestInputSchema } from "@/lib/leave/policy";
import { cancelEmployeeLeave, getEmployeeLeaveOverview, submitEmployeeLeave } from "@/lib/leave/service";
import { prepareLeaveDocuments } from "@/lib/leave/document-service";
import type { LeaveSupportingDocumentType } from "@prisma/client";
import { requireEmployeeBusinessModule } from "@/lib/modules/employee-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    await requireEmployeeBusinessModule(auth, "HR");
    return employeeAttendanceJson({ ok: true, data: await getEmployeeLeaveOverview(auth) });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    await requireEmployeeBusinessModule(auth, "HR");
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      const input = await readEmployeeAuthJson(request, leaveRequestInputSchema);
      const result = await submitEmployeeLeave(auth, input);
      return employeeAttendanceJson({ ok: true, data: result }, { status: 201 });
    }
    const form = await request.formData();
    const payload = leaveRequestInputSchema.parse(JSON.parse(String(form.get("payload") ?? "{}")));
    const documentType = normalizeDocumentType(form.get("documentType"));
    const files = form.getAll("supportingDocument").filter((item): item is File => item instanceof File && item.size > 0);
    const prepared = await prepareLeaveDocuments(await Promise.all(files.map(async (file) => ({
      bytes: new Uint8Array(await file.arrayBuffer()),
      claimedMimeType: file.type,
      originalFileName: file.name,
      documentType,
    }))));
    const result = await submitEmployeeLeave(auth, payload, prepared);
    return employeeAttendanceJson({ ok: true, data: result }, { status: 201 });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}

function normalizeDocumentType(value: FormDataEntryValue | null): LeaveSupportingDocumentType {
  const type = String(value ?? "SUPPORTING_DOCUMENT");
  return [
    "MEDICAL_CERTIFICATE",
    "HOSPITALISATION_SUPPORT",
    "MATERNITY_SUPPORT",
    "PATERNITY_SUPPORT",
    "SUPPORTING_DOCUMENT",
    "OTHER",
  ].includes(type) ? type as LeaveSupportingDocumentType : "SUPPORTING_DOCUMENT";
}

export async function DELETE(request: Request) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    await requireEmployeeBusinessModule(auth, "HR");
    const input = await readEmployeeAuthJson(request, leaveCancelInputSchema);
    await cancelEmployeeLeave(auth, input);
    return employeeAttendanceJson({ ok: true });
  } catch (error) {
    return employeeAttendanceErrorResponse(error);
  }
}
