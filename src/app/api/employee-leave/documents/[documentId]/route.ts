import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { assertEmployeeAuthSameOrigin } from "@/lib/attendance/employee-auth/http";
import { employeeAttendanceErrorResponse, employeeAttendanceJson } from "@/lib/attendance/response";
import {
  getAuthorizedLeaveDocument,
  prepareLeaveDocuments,
  removeOwnLeaveDocument,
  replaceOwnLeaveDocument,
} from "@/lib/leave/document-service";
import { requireEmployeeBusinessModule } from "@/lib/modules/employee-access";
import { normalizeEmployeeLeaveApiError } from "@/lib/leave/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    await requireEmployeeBusinessModule(auth, "HR");
    const { documentId } = await context.params;
    const document = await getAuthorizedLeaveDocument({
      documentId,
      businessId: auth.businessId,
      membershipId: auth.membershipId,
    });
    return privateDocumentResponse(document);
  } catch (error) {
    return employeeAttendanceErrorResponse(normalizeEmployeeLeaveApiError(error));
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    await requireEmployeeBusinessModule(auth, "HR");
    const { documentId } = await context.params;
    return employeeAttendanceJson({ ok: true, data: await removeOwnLeaveDocument(auth, documentId) });
  } catch (error) {
    return employeeAttendanceErrorResponse(normalizeEmployeeLeaveApiError(error));
  }
}

export async function PUT(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    assertEmployeeAuthSameOrigin(request);
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    await requireEmployeeBusinessModule(auth, "HR");
    const { documentId } = await context.params;
    const form = await request.formData();
    const file = form.get("supportingDocument");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("Choose one replacement document.");
    }
    const documentType = normalizeDocumentType(form.get("documentType"));
    const [prepared] = await prepareLeaveDocuments([{
      bytes: new Uint8Array(await file.arrayBuffer()),
      claimedMimeType: file.type,
      originalFileName: file.name,
      documentType,
    }]);
    return employeeAttendanceJson({ ok: true, data: await replaceOwnLeaveDocument(auth, documentId, prepared) });
  } catch (error) {
    return employeeAttendanceErrorResponse(normalizeEmployeeLeaveApiError(error));
  }
}

function normalizeDocumentType(value: FormDataEntryValue | null) {
  const allowed = new Set([
    "SUPPORTING_DOCUMENT",
    "MEDICAL_CERTIFICATE",
    "HOSPITALISATION_SUPPORT",
    "MATERNITY_SUPPORT",
    "PATERNITY_SUPPORT",
    "OTHER",
  ]);
  const candidate = String(value ?? "SUPPORTING_DOCUMENT");
  return (allowed.has(candidate) ? candidate : "SUPPORTING_DOCUMENT") as
    | "SUPPORTING_DOCUMENT"
    | "MEDICAL_CERTIFICATE"
    | "HOSPITALISATION_SUPPORT"
    | "MATERNITY_SUPPORT"
    | "PATERNITY_SUPPORT"
    | "OTHER";
}

function privateDocumentResponse(document: { bytes: Uint8Array; fileName: string; mimeType: string }) {
  const body = document.bytes.buffer.slice(
    document.bytes.byteOffset,
    document.bytes.byteOffset + document.bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "content-type": document.mimeType,
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
      "cache-control": "private, no-store, max-age=0",
      pragma: "no-cache",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
