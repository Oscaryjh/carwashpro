import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { assertEmployeeAuthSameOrigin } from "@/lib/attendance/employee-auth/http";
import { employeeAttendanceErrorResponse, employeeAttendanceJson } from "@/lib/attendance/response";
import {
  attachOwnLeaveDocuments,
  prepareLeaveDocuments,
} from "@/lib/leave/document-service";
import { requireEmployeeBusinessModule } from "@/lib/modules/employee-access";
import type { LeaveSupportingDocumentType } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    await requireEmployeeBusinessModule(auth, "HR");
    const { requestId } = await context.params;
    const form = await request.formData();
    const documentType = normalizeDocumentType(form.get("documentType"));
    const files = form.getAll("supportingDocument").filter((item): item is File => item instanceof File && item.size > 0);
    const prepared = await prepareLeaveDocuments(await Promise.all(files.map(async (file) => ({
      bytes: new Uint8Array(await file.arrayBuffer()),
      claimedMimeType: file.type,
      originalFileName: file.name,
      documentType,
    }))));
    const result = await attachOwnLeaveDocuments(auth, requestId, prepared);
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
